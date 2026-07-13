import * as cheerio from "cheerio";
import { fetchText, mapLimit, postForm } from "../http.js";
import {
  cleanText,
  extractArbeitszeit,
  extractBefristung,
  extractLaufbahn,
  extractRemoteHint,
  extractSalary,
  extractSalaryGrade,
} from "../extract.js";
import type { AdapterResult, CrawlContext, JobOffer } from "../types.js";
import { JobPortalAdapter } from "./JobPortalAdapter.js";

interface Teaser {
  url: string;
  title: string;
  location: string;
  department: string;
}

/** Die numerische ID hängt am URL-Slug, z.B. ...-etl-dwh-m-w-d-68804 */
function teaserPortalId(teaser: Teaser): string {
  const match = teaser.url.match(/-(\d+)$/);
  return match ? match[1] : teaser.url;
}

/**
 * Adapter für die BWI GmbH (https://www.bwi.de/karriere/stellenangebote).
 *
 * Die Übersichtsseite lädt die Teaser seitenweise (15 Stück) per AJAX von
 * einem TYPO3-"job_loader"-Endpoint nach (Infinite Scroll). Wir stellen den
 * POST des Filterformulars nach: Formular-Action samt cHash und alle
 * Hidden-Felder (inkl. __trustedProperties) kommen aus der Übersichtsseite,
 * nur tx_bwi_joblist[page] wird hochgezählt, bis keine Teaser mehr kommen.
 * Details (Aufgaben, Profil, Benefits) stehen auf regulären HTML-Detailseiten.
 *
 * Hinweis: BWI nennt weder Bewerbungsfrist noch Tarifgruppen — diese Felder
 * bleiben leer; solche Jobs werden daher nie als "abgelaufen" gelöscht.
 */
export class BwiAdapter extends JobPortalAdapter {
  readonly name = "bwi";
  readonly label = "BWI GmbH";
  readonly baseUrl = "https://www.bwi.de";

  private readonly overviewUrl = `${this.baseUrl}/karriere/stellenangebote`;
  private readonly detailConcurrency = 4;
  private readonly maxPages = 50;

  async fetchJobs(context: CrawlContext): Promise<AdapterResult> {
    const result = this.createResult();

    const form = await this.loadFilterForm();
    const teasers: Teaser[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= this.maxPages; page++) {
      const fields = form.fields.map(([name, value]): [string, string] =>
        name === "tx_bwi_joblist[page]" ? [name, String(page)] : [name, value],
      );
      const html = await postForm(form.action, fields);
      const pageTeasers = this.parseTeasers(html).filter((teaser) => !seen.has(teaser.url));
      if (pageTeasers.length === 0) break;
      for (const teaser of pageTeasers) seen.add(teaser.url);
      teasers.push(...pageTeasers);
    }

    const jobs = await mapLimit(teasers, this.detailConcurrency, async (teaser) => {
      const id = this.buildId(teaserPortalId(teaser));
      try {
        let html = this.cachedDetail(context, id);
        if (html) {
          result.stats.cached++;
        } else {
          // Nur das .jobDetail-Fragment cachen — die volle Seite (~240 KB)
          // besteht überwiegend aus Slidern/Footer/fremden Teasern.
          html = this.detailFragment(await fetchText(teaser.url));
          result.stats.fetched++;
        }
        return this.parseDetail(id, teaser, html);
      } catch (error) {
        result.warnings.push(`Detailseite fehlgeschlagen (${teaser.url}): ${error}`);
        return undefined;
      }
    });

    result.jobs = jobs.filter((job): job is JobOffer => job !== undefined);
    return result;
  }

  /** Liest Action-URL und alle Felder des Job-Filterformulars aus der Übersichtsseite. */
  private async loadFilterForm(): Promise<{ action: string; fields: Array<[string, string]> }> {
    const html = await fetchText(this.overviewUrl);
    const $ = cheerio.load(html);
    const $form = $('form[action*="job_loader"]').first();
    if (!$form.length) {
      throw new Error("Job-Filterformular nicht in der Übersichtsseite gefunden — Seitenaufbau geändert?");
    }
    const fields: Array<[string, string]> = [];
    $form.find("input[name]").each((_, element) => {
      const type = $(element).attr("type") ?? "text";
      // Checkboxen/Radios sind Filter und bleiben wie im Original unangehakt.
      if (type === "checkbox" || type === "radio" || type === "submit") return;
      fields.push([$(element).attr("name")!, $(element).attr("value") ?? ""]);
    });
    return {
      action: new URL($form.attr("action")!, this.baseUrl).toString(),
      fields,
    };
  }

  private parseTeasers(html: string): Teaser[] {
    const $ = cheerio.load(html);
    const teasers: Teaser[] = [];
    $(".jobTeaser").each((_, element) => {
      const link = $(element).find("a.jobTeaserLink").attr("href");
      if (!link) return;
      const url = new URL(link, this.baseUrl);
      url.search = ""; // Tracking-/cHash-Parameter abwerfen, damit URLs stabil sind
      teasers.push({
        url: url.toString(),
        title: cleanText($(element).find(".jobTeaserTitle").text()),
        location: cleanText($(element).find(".jobTeaserLocation").text()),
        department: cleanText($(element).find(".jobTeaserCategory .tagItemRound").first().text()),
      });
    });
    return teasers;
  }

  private parseDetail(id: string, teaser: Teaser, html: string): JobOffer {
    const $ = cheerio.load(html);
    const portalId = teaserPortalId(teaser);

    const subline = cleanText($(".jobSubline").first().text()); // "ab sofort und in Vollzeit in Bonn oder Meckenheim."
    const intro = cleanText($(".jobDetailTeaserText, .jobDetailTopText").first().text());
    const tasks = this.boxText($, ".jobTasks");
    const offers = this.boxText($, ".jobOffers");
    const profileItems = this.boxItems($, ".jobProfile");
    const fullText = [subline, intro, tasks, profileItems.join("\n"), offers].filter(Boolean).join("\n");

    const locations = this.parseLocations(teaser.location || subline);

    // BWI trennt zwingend/wünschenswert nicht explizit; wir sortieren die
    // Profil-Punkte anhand typischer Formulierungen.
    const wuenschenswert = profileItems.filter((item) => this.isNiceToHave(item));
    const zwingend = profileItems.filter((item) => !this.isNiceToHave(item));

    return this.finalize({
      id,
      employer: "BWI GmbH",
      titel: teaser.title || cleanText($(".jobTitle").first().text()),
      link: teaser.url,
      referenzcode: portalId,
      beschreibung: [subline, intro, tasks && `Aufgaben:\n${tasks}`, teaser.department && `Bereich: ${teaser.department}`]
        .filter(Boolean)
        .join("\n\n") || undefined,
      gehalt: extractSalary(fullText),
      gehaltsstufe: extractSalaryGrade(fullText),
      befristung: extractBefristung(fullText),
      arbeitszeit: extractArbeitszeit(subline || fullText),
      verbeamtung: false, // BWI ist eine GmbH, keine Verbeamtung
      laufbahn: extractLaufbahn(fullText),
      dienstorte: locations,
      homeoffice: extractRemoteHint(offers || fullText),
      voraussetzungenZwingend: zwingend,
      voraussetzungenWuenschenswert: wuenschenswert,
      raw: { short: JSON.stringify(teaser), detail: html },
    });
  }

  private detailFragment(html: string): string {
    const $ = cheerio.load(html);
    const detail = $(".jobDetail").first();
    return detail.length ? $.html(detail) : html;
  }

  private isNiceToHave(item: string): boolean {
    return /wünschenswert|von vorteil|idealerweise|vorteilhaft|nice to have|optional|plus\b/i.test(item);
  }

  private boxText($: cheerio.CheerioAPI, selector: string): string | undefined {
    const box = $(selector).first();
    if (!box.length) return undefined;
    const items = this.boxItems($, selector).map((item) => `- ${item}`);
    return items.length ? items.join("\n") : cleanText(box.text()) || undefined;
  }

  private boxItems($: cheerio.CheerioAPI, selector: string): string[] {
    return $(selector)
      .first()
      .find("li")
      .map((_, element) => cleanText($(element).text()).replace(/\n/g, " "))
      .get()
      .filter(Boolean);
  }

  /** Macht aus "in Bonn oder Meckenheim." eine Ortsliste. */
  private parseLocations(raw: string): string[] {
    const cleaned = raw
      .replace(/^.*?\bin\b\s+/i, "")
      .replace(/\.$/, "")
      .trim();
    if (!cleaned) return [];
    if (/bundesweit/i.test(raw)) return ["bundesweit"];
    return cleaned
      .split(/\s*(?:,|oder|und|alternativ)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part && part.length < 40);
  }
}
