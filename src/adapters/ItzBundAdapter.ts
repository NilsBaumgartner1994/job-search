import { fetchArrayBuffer, fetchJson, mapLimit } from "../http.js";
import {
  extractArbeitszeit,
  extractBefristung,
  extractLaufbahn,
  extractPdfSections,
  extractRemoteHint,
  extractSalaryGrade,
  extractVerbeamtung,
  normalizePdfText,
  parseGermanDate,
} from "../extract.js";
import { extractPdfText, pdfPathFor, readPdfIfExists, savePdf, toRelativePath } from "../pdf.js";
import type { AdapterResult, CrawlContext, JobOffer } from "../types.js";
import { JobPortalAdapter } from "./JobPortalAdapter.js";

/** Relevante Felder der SAP-OData-Antwort (/erec/odata/open/JobSet). */
interface ODataJob {
  JobID: string;
  Posting: number;
  Title: string;
  JobDetailsUrl: string;
  RefCode: string;
  ApplicationEndDate: string;
  Company?: { Text: string };
  ContractType?: { Text: string };
  HierarchyLevel?: { Text: string };
  FunctionalArea?: { Text: string };
  InterestGroup?: { Text: string };
  LocationSet?: { results: Array<{ Text?: string; City?: string; Title?: string }> };
}

interface ODataResponse {
  d: { results: ODataJob[] };
}

/**
 * Adapter für das SAP-E-Recruiting-Portal des ITZBund
 * (https://www.erecruiting.itzbund.de). Das Portal hostet mehrere
 * Arbeitgeber (ITZBund, Zoll, ...).
 *
 * Die UI5-Oberfläche lädt ihre Daten von einem offenen OData-Service — den
 * fragen wir direkt ab, ohne Browser. Der OData-Service selbst nennt weder
 * Besoldungs-/Entgeltgruppe noch Aufgaben/Anforderungen — diese Angaben
 * stehen nur im PDF (JobDetailsUrl). PDFs werden unter data/pdfs/itzbund/
 * abgelegt und ihr Text in raw.detail gespeichert; bekannte Jobs werden
 * beim nächsten Lauf daraus bedient statt erneut geladen.
 */
export class ItzBundAdapter extends JobPortalAdapter {
  readonly name = "itzbund";
  readonly label = "ITZBund E-Recruiting (Bundesverwaltung)";
  readonly baseUrl = "https://www.erecruiting.itzbund.de";

  private readonly sapClient = "800";
  private readonly pdfConcurrency = 5;

  async fetchJobs(context: CrawlContext): Promise<AdapterResult> {
    const result = this.createResult();
    const select =
      "JobID,Posting,Title,PostingAge,HierarchyLevel,ContractType,InterestGroup,FunctionalArea,Company,TravelRatio,JobDetailsUrl,RefCode,ApplicationEndDate,LocationSet";
    const expand = "LocationSet,HierarchyLevel,ContractType,FunctionalArea,Company,InterestGroup";
    const url =
      `${this.baseUrl}/erec/odata/open/JobSet?sap-client=${this.sapClient}&sap-language=DE` +
      `&$format=json&$select=${encodeURIComponent(select)}&$expand=${encodeURIComponent(expand)}`;

    const response = await fetchJson<ODataResponse>(url);

    const jobs = await mapLimit(response.d.results, this.pdfConcurrency, async (raw) => {
      try {
        return await this.mapJob(raw, context, result);
      } catch (error) {
        result.warnings.push(`Job ${raw.JobID} übersprungen: ${error}`);
        return undefined;
      }
    });
    result.jobs = jobs.filter((job): job is JobOffer => job !== undefined);
    return result;
  }

  private async mapJob(raw: ODataJob, context: CrawlContext, result: AdapterResult): Promise<JobOffer> {
    const portalId = raw.RefCode || raw.JobID;
    const id = this.buildId(portalId);
    const pdfUrl = raw.JobDetailsUrl ? `${this.baseUrl}${raw.JobDetailsUrl}` : undefined;
    const dienstorte = (raw.LocationSet?.results ?? [])
      .map((location) => location.Text ?? location.City ?? location.Title ?? "")
      .filter(Boolean);

    // Detail-Text besorgen: Cache aus jobs.json → lokale PDF → Netz.
    let detail = this.cachedDetail(context, id);
    let pdfPath: string | undefined = context.known.get(id)?.raw?.pdfPath;
    if (detail) {
      result.stats.cached++;
    } else if (pdfUrl) {
      const absolutePath = pdfPathFor(this.name, portalId);
      pdfPath = toRelativePath(absolutePath);
      try {
        let buffer = context.refresh ? undefined : readPdfIfExists(absolutePath);
        if (buffer) {
          result.stats.cached++;
        } else {
          buffer = Buffer.from(await fetchArrayBuffer(pdfUrl, { timeoutMs: 20_000 }));
          savePdf(absolutePath, buffer);
          result.stats.fetched++;
        }
        detail = await extractPdfText(buffer);
      } catch {
        // Manche PDFs sind gescannt/nicht abrufbar — dann bleibt es beim Titel.
        pdfPath = undefined;
      }
    }

    const pdfText = detail ? normalizePdfText(detail) : "";
    const fullText = [raw.Title, pdfText].filter(Boolean).join("\n");
    const sections = pdfText ? extractPdfSections(pdfText) : { aufgaben: undefined, zwingend: [], wuenschenswert: [] };
    const gehaltsstufe = extractSalaryGrade(fullText);
    const contractTypeChip = raw.ContractType?.Text ? [raw.ContractType.Text] : [];

    const descriptionParts = [
      sections.aufgaben,
      !sections.aufgaben && raw.FunctionalArea?.Text && `Funktionsbereich: ${raw.FunctionalArea.Text}`,
      raw.HierarchyLevel?.Text && `Karrierestufe: ${raw.HierarchyLevel.Text}`,
      raw.InterestGroup?.Text && `Zielgruppe: ${raw.InterestGroup.Text}`,
      pdfUrl && `Volltext (PDF): ${pdfUrl}`,
    ].filter(Boolean) as string[];

    return this.finalize({
      id,
      employer: raw.Company?.Text,
      titel: raw.Title.trim(),
      // Deep-Link in die Suchoberfläche; der PDF-Link steht in der Beschreibung.
      link: `${this.baseUrl}/erec/ext_ui/desktop.html?sap-sessioncmd=open#/SEARCH/DETAILS/${raw.Posting}`,
      referenzcode: raw.RefCode || String(raw.Posting),
      beschreibung: descriptionParts.join("\n\n") || undefined,
      gehaltsstufe,
      befristung: contractTypeChip.length ? contractTypeChip : extractBefristung(fullText),
      arbeitszeit: extractArbeitszeit(fullText),
      verbeamtung: extractVerbeamtung(fullText),
      laufbahn: extractLaufbahn(fullText, gehaltsstufe),
      dienstorte,
      homeoffice: extractRemoteHint(pdfText || raw.Title),
      bewerbungsfrist: parseGermanDate(raw.ApplicationEndDate),
      voraussetzungenZwingend: sections.zwingend,
      voraussetzungenWuenschenswert: sections.wuenschenswert,
      raw: { short: JSON.stringify({ ...raw, __metadata: undefined }), detail, pdfPath },
    });
  }
}
