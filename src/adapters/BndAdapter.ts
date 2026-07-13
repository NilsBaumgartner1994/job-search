import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { fetchText, mapLimit } from "../http.js";
import {
  cleanText,
  extractArbeitszeit,
  extractBefristung,
  extractLaufbahn,
  extractRemoteHint,
  extractSalary,
  extractSalaryGrade,
  extractVerbeamtung,
  parseGermanDate,
} from "../extract.js";
import type { AdapterResult, CrawlContext, JobOffer } from "../types.js";
import { JobPortalAdapter } from "./JobPortalAdapter.js";

/** schema.org/JobPosting, wie es der BND auf jeder Detailseite einbettet. */
interface JobPostingLd {
  title?: string;
  description?: string;
  identifier?: { value?: string };
  employmentType?: string;
  validThrough?: string;
  jobLocation?: { address?: { addressLocality?: string } };
  jobBenefits?: string;
  skills?: string;
}

/**
 * Adapter für das BND-Karriereportal
 * (https://www.bnd.bund.de). Die Trefferliste liegt komplett auf einer
 * einzigen Seite (keine Pagination nötig — der BND zeigt "N offene
 * Ausschreibungen" und listet alle auf einmal). Jede Detailseite enthält
 * zusätzlich ein schema.org-JobPosting-JSON mit Frist, Kennziffer,
 * Entgelt-/Besoldungsangaben (im Feld "jobBenefits") und Voraussetzungen
 * (im Feld "skills", dort aber nur als Fließtext) — die sauber getrennten
 * Listen für "Ihre Aufgaben" und "Ihr Profil" (zwingend/wünschenswert)
 * holen wir stattdessen aus dem HTML, ebenso die "Laufbahn"-Angabe, die
 * dort im Klartext steht.
 */
export class BndAdapter extends JobPortalAdapter {
  readonly name = "bnd";
  readonly label = "BND Karriereportal";
  readonly baseUrl = "https://www.bnd.bund.de";

  private readonly listUrl = `${this.baseUrl}/SiteGlobals/Forms/Suche/erweiterte_Karrieresuche_Formular.html?nn=415896`;
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

  /** Die Kennziffer steckt im Dateinamen der Detail-URL, z.B. ".../AS-2026-078-objektschutz....html" → "AS-2026-078". */
  private idFromUrl(url: string): string {
    const match = url.match(/AS-\d{4}-\d+/);
    return match ? match[0] : url;
  }

  private async collectDetailUrls(): Promise<string[]> {
    const html = await fetchText(this.listUrl);
    const $ = cheerio.load(html);
    const urls = new Set<string>();
    $(".c-career-item__link").each((_, element) => {
      const href = $(element).attr("href");
      if (href) urls.add(new URL(href, this.baseUrl + "/").toString());
    });
    return [...urls];
  }

  private parseDetail(id: string, url: string, html: string): JobOffer {
    const $ = cheerio.load(html);
    const ld = this.parseJsonLd(html);

    const titel = cleanText(ld?.title ?? $("h1").first().text());
    const referenzcode = ld?.identifier?.value ?? this.idFromUrl(url);
    const dienstorte = (ld?.jobLocation?.address?.addressLocality ?? "")
      .split("//")
      .map((part) => part.trim())
      .filter(Boolean);

    const aufgaben = this.sectionItems($, "Ihre Aufgaben");
    const [zwingend, wuenschenswert] = this.profilItems($);

    // Die komplette Facts-Leiste steckt zweimal im HTML (Bildschirm- und
    // Druckansicht) — ohne .first() würden beide Kopien zusammengeklebt.
    const laufbahnFact = cleanText($(".c-job-fact--laufbahn").first().text()).replace(/^Laufbahn\s*:?\s*/i, "");
    const arbeitszeitFact = cleanText($(".c-job-fact--workingtime").first().text()).replace(/^Arbeitszeit\s*:?\s*/i, "");

    const fullText = [titel, ld?.jobBenefits, ld?.skills, laufbahnFact, arbeitszeitFact].filter(Boolean).join("\n");
    const gehaltsstufe = extractSalaryGrade(fullText);

    return this.finalize({
      id,
      employer: "Bundesnachrichtendienst",
      titel,
      link: url,
      referenzcode,
      beschreibung: aufgaben.join("\n") || (ld?.description ? cleanText(ld.description) : undefined),
      gehalt: extractSalary(fullText),
      gehaltsstufe,
      befristung: extractBefristung(fullText),
      arbeitszeit: extractArbeitszeit(arbeitszeitFact || fullText),
      verbeamtung: extractVerbeamtung(fullText),
      laufbahn: laufbahnFact ? [this.capitalize(laufbahnFact)] : extractLaufbahn(fullText, gehaltsstufe),
      dienstorte,
      homeoffice: extractRemoteHint(fullText),
      bewerbungsfrist: parseGermanDate(ld?.validThrough),
      voraussetzungenZwingend: zwingend,
      voraussetzungenWuenschenswert: wuenschenswert,
      raw: { detail: html },
    });
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

  /** Direkte <li>-Kindelemente der ersten <ul> im Abschnitt "Ihre Aufgaben". */
  private sectionItems($: cheerio.CheerioAPI, heading: string): string[] {
    const headline = $("h2").filter((_, element) => cleanText($(element).text()).startsWith(heading)).first();
    if (!headline.length) return [];
    const ul = headline.nextAll("ul").first();
    return ul
      .children("li")
      .map((_, element) => this.liText($, element))
      .get()
      .filter(Boolean);
  }

  /** "Ihr Profil": die erste <ul> nach der Überschrift ist zwingend, die zweite wünschenswert. */
  private profilItems($: cheerio.CheerioAPI): [string[], string[]] {
    const headline = $("h2").filter((_, element) => cleanText($(element).text()).startsWith("Ihr Profil")).first();
    if (!headline.length) return [[], []];
    const lists = headline.nextAll("ul").slice(0, 2);
    const toItems = (ul: cheerio.Cheerio<Element>) =>
      ul
        .children("li")
        .map((_, element) => this.liText($, element))
        .get()
        .filter(Boolean);
    const zwingend = lists.eq(0).length ? toItems(lists.eq(0)) : [];
    const wuenschenswert = lists.eq(1).length ? toItems(lists.eq(1)) : [];
    return [zwingend, wuenschenswert];
  }

  /**
   * Text eines <li>, das eine verschachtelte <ul> enthalten kann (z.B.
   * "Ihre Bereitschaft" → Unterpunkte "eine Dienstwaffe zu tragen", ...).
   * cheerio fügt beim Verketten von Textknoten keine Leerzeichen zwischen
   * benachbarten <li> ein, daher Unterpunkte separat holen und mit ", " verbinden.
   */
  private liText($: cheerio.CheerioAPI, li: Element): string {
    const $li = $(li);
    const nested = $li.find("> ul > li");
    if (!nested.length) return cleanText($li.text()).replace(/\n/g, " ");

    const clone = $li.clone();
    clone.find("ul").remove();
    const ownText = cleanText(clone.text()).replace(/\n/g, " ");
    const nestedTexts = nested
      .map((_, sub) => cleanText($(sub).text()).replace(/\n/g, " "))
      .get()
      .filter(Boolean);
    return ownText + (ownText.endsWith(":") ? " " : ": ") + nestedTexts.join(", ");
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
