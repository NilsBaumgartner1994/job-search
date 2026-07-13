import * as cheerio from "cheerio";
import { fetchJson, mapLimit } from "../http.js";
import { cleanText, extractArbeitszeit, extractBefristung, extractRemoteHint, extractSalary, extractSalaryGrade } from "../extract.js";
import type { AdapterResult, CrawlContext, JobOffer } from "../types.js";
import { JobPortalAdapter } from "./JobPortalAdapter.js";

interface ListResponse {
  total: number;
  jobPostings: ListItem[];
}

interface ListItem {
  title: string;
  externalPath: string;
  /** [0] = Referenzcode (z.B. "R00310806"), [1] = Ortstext */
  bulletFields?: string[];
}

interface JobDetail {
  jobPostingInfo: {
    title: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    timeType?: string;
    jobReqId: string;
    externalUrl: string;
  };
}

/**
 * Adapter für Accenture Karriere (https://www.accenture.com/de-de/careers/jobsearch).
 *
 * Die Seite selbst rendert clientseitig aus Workday; die Trefferliste und die
 * Details kommen über den öffentlich erreichbaren Workday-CXS-Service
 * (`accenture.wd103.myworkdayjobs.com`), ganz ohne Login oder Browser. Die
 * Trefferliste wird per POST mit dem Länder-Facet "Germany" gefiltert
 * (Facet-ID unten fest hinterlegt) und liefert max. 20 Treffer pro Seite.
 *
 * Hinweis: Accenture nennt weder Bewerbungsfrist noch Tarif-/Gehaltsstufen —
 * diese Felder bleiben leer; solche Jobs werden nie als "abgelaufen" gelöscht.
 * Da Workday Stellen mit "Location Negotiable" für mehrere Länder gleichzeitig
 * listet, tauchen auch Jobs mit primärem Standort außerhalb Deutschlands auf,
 * wenn Deutschland als möglicher Einsatzort in Frage kommt — das entspricht
 * dem Verhalten der echten Webseite.
 */
export class AccentureAdapter extends JobPortalAdapter {
  readonly name = "accenture";
  readonly label = "Accenture Karriere";
  readonly baseUrl = "https://www.accenture.com/de-de/careers/jobsearch";

  private readonly apiBase = "https://accenture.wd103.myworkdayjobs.com/wday/cxs/accenture/AccentureCareers";
  private readonly germanyFacetId = "dcc5b7608d8644b3a93716604e78e995";
  private readonly pageSize = 20;
  private readonly maxPages = 100;
  private readonly detailConcurrency = 4;

  async fetchJobs(context: CrawlContext): Promise<AdapterResult> {
    const result = this.createResult();
    const items = await this.collectListItems();

    const jobs = await mapLimit(items, this.detailConcurrency, async (item) => {
      const referenzcode = item.bulletFields?.[0];
      if (!referenzcode) {
        result.warnings.push(`Kein Referenzcode in Trefferliste: ${item.title}`);
        return undefined;
      }
      const id = this.buildId(referenzcode);
      try {
        let detail: JobDetail;
        const cached = this.cachedDetail(context, id);
        if (cached) {
          detail = JSON.parse(cached) as JobDetail;
          result.stats.cached++;
        } else {
          detail = await fetchJson<JobDetail>(`${this.apiBase}${item.externalPath}`);
          result.stats.fetched++;
        }
        return this.parseDetail(id, detail);
      } catch (error) {
        result.warnings.push(`Detailseite fehlgeschlagen (${item.externalPath}): ${error}`);
        return undefined;
      }
    });

    result.jobs = jobs.filter((job): job is JobOffer => job !== undefined);
    return result;
  }

  private async collectListItems(): Promise<ListItem[]> {
    const items: ListItem[] = [];
    // Workday liefert "total" nur auf der ersten Seite korrekt — bei jedem
    // weiteren Offset kommt "total":0 zurück, obwohl "jobPostings" gefüllt
    // ist. Der zuverlässige Wert von Seite 0 wird daher für alle folgenden
    // Abbruch-Entscheidungen zwischengespeichert.
    let total: number | undefined;
    for (let page = 0; page < this.maxPages; page++) {
      const offset = page * this.pageSize;
      const response = await fetchJson<ListResponse>(`${this.apiBase}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appliedFacets: { locationCountry: [this.germanyFacetId] },
          limit: this.pageSize,
          offset,
          searchText: "",
        }),
      });
      if (total === undefined) total = response.total;
      items.push(...response.jobPostings);
      if (offset + this.pageSize >= total || response.jobPostings.length === 0) break;
    }
    return items;
  }

  private parseDetail(id: string, detail: JobDetail): JobOffer {
    const info = detail.jobPostingInfo;
    const beschreibung = this.htmlToText(info.jobDescription ?? "");
    const fullText = [info.title, beschreibung].join("\n");

    const arbeitszeit = new Set(extractArbeitszeit(fullText));
    if (/vollzeit|full\s*time/i.test(info.timeType ?? "")) arbeitszeit.add("Vollzeit");
    if (/teilzeit|part\s*time/i.test(info.timeType ?? "")) arbeitszeit.add("Teilzeit");

    const dienstorte = [info.location, ...(info.additionalLocations ?? [])]
      .filter((ort): ort is string => !!ort?.trim())
      .filter((ort, index, arr) => arr.indexOf(ort) === index);

    return this.finalize({
      id,
      employer: "Accenture",
      titel: info.title,
      link: info.externalUrl,
      referenzcode: info.jobReqId,
      beschreibung: beschreibung || undefined,
      gehalt: extractSalary(fullText),
      gehaltsstufe: extractSalaryGrade(fullText),
      befristung: extractBefristung(fullText),
      arbeitszeit: [...arbeitszeit],
      verbeamtung: false,
      laufbahn: [],
      dienstorte,
      homeoffice: extractRemoteHint(fullText),
      voraussetzungenZwingend: [],
      voraussetzungenWuenschenswert: [],
      raw: { detail: JSON.stringify(detail) },
    });
  }

  /** Wandelt das Rich-Text-HTML der Jobbeschreibung in lesbaren Text mit Zeilenumbrüchen um. */
  private htmlToText(html: string): string {
    if (!html) return "";
    const withBreaks = html.replace(/<\/(p|li|div|h[1-6])>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
    const $ = cheerio.load(withBreaks);
    return cleanText($.root().text());
  }
}
