import * as cheerio from "cheerio";
import { fetchText, mapLimit } from "../http.js";
import {
  cleanText,
  extractArbeitszeit,
  extractBefristung,
  extractLaufbahn,
  extractRemoteHint,
  extractSalary,
  extractSalaryGrade,
  parseGermanDate,
} from "../extract.js";
import type { AdapterResult, CrawlContext, JobOffer } from "../types.js";
import { JobPortalAdapter } from "./JobPortalAdapter.js";

/** schema.org/JobPosting, wie es das BKA auf jeder Detailseite einbettet. */
interface JobPostingLd {
  title?: string;
  description?: string;
  url?: string;
  identifier?: { value?: string };
  validThrough?: string;
  employmentType?: string | string[];
  jobLocation?: LdPlace | LdPlace[];
}

interface LdPlace {
  address?: { addressLocality?: string };
}

/**
 * Adapter für das BKA-Karriereportal
 * (https://www.karriere.bka.de). Die Trefferliste ist klassisches
 * Server-HTML mit Pagination; jede Detailseite enthält zusätzlich ein
 * schema.org-JobPosting-JSON, aus dem wir Frist, Kennziffer und
 * Voraussetzungen ziehen.
 *
 * Die Job-ID ist der Dateiname der Detail-URL (z.B. "T-2026-54") — der steht
 * schon in der Trefferliste, sodass bekannte Jobs ohne Detail-Abruf aus dem
 * raw-Cache bedient werden können.
 */
export class BkaAdapter extends JobPortalAdapter {
  readonly name = "bka";
  readonly label = "BKA Karriereportal";
  readonly baseUrl = "https://www.karriere.bka.de";

  private readonly listUrl =
    `${this.baseUrl}/SiteGlobals/Forms/Suche/Karriereportal/Stellenangebote_Formular.html?nn=186826`;
  private readonly maxPages = 20;
  private readonly detailConcurrency = 4;

  async fetchJobs(context: CrawlContext): Promise<AdapterResult> {
    const result = this.createResult();
    const detailUrls = await this.collectDetailUrls();

    const jobs = await mapLimit(detailUrls, this.detailConcurrency, async (url) => {
      const id = this.buildId(this.idFromUrl(url));
      try {
        let html = this.cachedDetail(context, id);
        if (html) {
          result.stats.cached++;
        } else {
          html = await fetchText(url);
          result.stats.fetched++;
        }
        return this.parseDetail(id, url, html);
      } catch (error) {
        result.warnings.push(`Detailseite fehlgeschlagen (${url}): ${error}`);
        return undefined;
      }
    });

    result.jobs = jobs.filter((job): job is JobOffer => job !== undefined);
    return result;
  }

  /** Der Dateiname der Detail-URL ist die Kennziffer (z.B. ".../T-2026-54.html" → "T-2026-54"). */
  private idFromUrl(url: string): string {
    const match = url.match(/\/([^/]+)\.html(?:[?#]|$)/);
    return match ? match[1] : url;
  }

  /** Sammelt die Links aller Angebote über die paginierte Trefferliste. */
  private async collectDetailUrls(): Promise<string[]> {
    const urls = new Set<string>();
    for (let page = 0; page < this.maxPages; page++) {
      const html = await fetchText(`${this.listUrl}&pageNo=${page}`);
      const $ = cheerio.load(html);
      const before = urls.size;
      $(".l-joboffer-result__item a.c-joboffer__wrapper").each((_, element) => {
        const href = $(element).attr("href");
        if (href) urls.add(new URL(href, this.baseUrl + "/").toString());
      });
      // Keine neuen Treffer mehr → letzte Seite erreicht.
      if (urls.size === before) break;
    }
    return [...urls];
  }

  private parseDetail(id: string, url: string, html: string): JobOffer {
    const $ = cheerio.load(html);
    const ld = this.parseJsonLd(html);

    const pageText = cleanText($("main").text() || $("body").text());

    // Die Fakten-Leiste (Ort, Arbeitszeit, Entgeltgruppe, Frist, Kennziffer).
    const facts: Record<string, string> = {};
    $(".c-job-description__item").each((_, element) => {
      const spans = $(element).find("span");
      if (spans.length >= 2) {
        facts[cleanText($(spans[0]).text()).replace(/:$/, "")] = cleanText($(spans[1]).text());
      }
    });

    const titel = cleanText(ld?.title ?? $("h1").first().text());
    const referenzcode = ld?.identifier?.value ?? facts["Kennziffer"];

    const locations = this.extractLocations(ld);

    const aufgaben = this.sectionText($, "Aufgaben");
    const gehaltsstufe = extractSalaryGrade(pageText);

    return this.finalize({
      id,
      employer: "Bundeskriminalamt",
      titel,
      link: url,
      referenzcode,
      beschreibung: aufgaben || cleanText($(".c-teasertext, .c-intro").first().text()) || undefined,
      gehalt: extractSalary(pageText),
      gehaltsstufe,
      befristung: extractBefristung(pageText),
      arbeitszeit: extractArbeitszeit(facts["Arbeitszeit"] ?? pageText),
      // Beamtenstellen liegen unter .../Stellenangebote_Beamte/; A-Besoldung
      // oder ein expliziter Verbeamtungs-Hinweis zählen ebenfalls.
      verbeamtung:
        /Stellenangebote_Beamte/i.test(url) ||
        /^(A\s?\d|Bes)/.test(gehaltsstufe ?? "") ||
        /verbeamtung/i.test(pageText),
      laufbahn: extractLaufbahn(pageText, gehaltsstufe),
      dienstorte: locations,
      homeoffice: extractRemoteHint(pageText),
      bewerbungsfrist: parseGermanDate(ld?.validThrough ?? facts["Bewerbungsfrist"]),
      voraussetzungenZwingend: this.sectionItems($, "Unsere Erwartungen"),
      voraussetzungenWuenschenswert: this.sectionItems($, "Wünschenswert"),
      raw: { detail: html },
    });
  }

  /** Listenpunkte (<li>) eines c-box-Abschnitts, dessen Überschrift `heading` enthält. */
  private sectionItems($: cheerio.CheerioAPI, heading: string): string[] {
    const box = $(".c-box")
      .filter((_, element) => cleanText($(element).find("h2").first().text()).includes(heading))
      .first();
    if (!box.length) return [];
    return box
      .find("li")
      .map((_, element) => cleanText($(element).text()).replace(/\n/g, " "))
      .get()
      .filter(Boolean);
  }

  private parseJsonLd(html: string): JobPostingLd | undefined {
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!match) return undefined;
    try {
      return JSON.parse(match[1]) as JobPostingLd;
    } catch {
      return undefined;
    }
  }

  private extractLocations(ld: JobPostingLd | undefined): string[] {
    if (!ld?.jobLocation) return [];
    const places = Array.isArray(ld.jobLocation) ? ld.jobLocation : [ld.jobLocation];
    return places
      .map((place) => place.address?.addressLocality ?? "")
      .filter(Boolean);
  }

  /** Liefert den Text des Abschnitts unter einer Überschrift wie "Aufgaben". */
  private sectionText($: cheerio.CheerioAPI, heading: string): string | undefined {
    const headline = $("h2, h3")
      .filter((_, element) => cleanText($(element).text()).startsWith(heading))
      .first();
    if (!headline.length) return undefined;
    const container = headline.parent();
    const text = cleanText(container.text()).replace(new RegExp(`^${heading}\\s*`), "");
    return text || undefined;
  }

}
