import * as cheerio from "cheerio";
import {
  cleanText,
  extractArbeitszeit,
  extractKennziffer,
  extractPdfSections,
  extractRemoteHint,
  parseGermanDate,
} from "../extract.js";
import type { AdapterResult, CrawlContext, JobOffer } from "../types.js";
import { PlaywrightAdapter } from "./PlaywrightAdapter.js";

/**
 * Interamts einziger dauerhaft gültiger Deep-Link auf ein Angebot: die
 * Trefferliste, eingeschränkt auf eine (hier: genau eine) Angebots-ID.
 * Interamt dokumentiert dieses Format selbst als offiziellen Verlinkungsweg
 * für Arbeitgeber; es ist sitzungsfrei, von Suchmaschinen indiziert und lässt
 * sich allein aus der Angebots-ID bauen — anders als die "crypt."-URL, die
 * beim Öffnen der Detailseite in der Adresszeile steht und nur zur laufenden
 * Wicket-Sitzung gehört ("Sitzung abgelaufen", sobald diese weg ist).
 */
export function interamtPermalink(offerId: string): string {
  return `https://interamt.de/koop/app/trefferliste?stellenangebotliste=${encodeURIComponent(offerId)}`;
}

/** Erkennt die alten, sitzungsgebundenen "crypt."-Links früherer Läufe. */
function isSessionBoundInteramtLink(link: string): boolean {
  return /interamt\.de\/koop\/app\/crypt\./i.test(link);
}

/**
 * Schreibt gespeicherte "crypt."-Links auf den stabilen Permalink um — ohne
 * Netz, denn Interamts Angebots-ID steckt bereits in der Job-ID
 * ("interamt:1467339"). Läuft bei jedem Crawl mit und erwischt so auch
 * Angebote, die inzwischen nicht mehr in der Trefferliste stehen.
 * Gibt zurück, wie viele Links repariert wurden.
 */
export function repairInteramtLinks(jobs: JobOffer[]): number {
  let repaired = 0;
  for (const job of jobs) {
    if (job.adapter !== "interamt" || !isSessionBoundInteramtLink(job.link)) continue;
    const offerId = job.id.slice(job.id.indexOf(":") + 1);
    if (!offerId) continue;
    job.link = interamtPermalink(offerId);
    repaired++;
  }
  return repaired;
}

interface ListRow {
  id: string;
  employer: string;
  titel: string;
  besoldung: string;
  entgelt: string;
  plzOrt: string;
  dienstort: string;
  bewerbungsfrist: string;
  editLinkSelector: string;
}

/**
 * Adapter für Interamt (https://interamt.de) — das größte Sammelportal für
 * Stellenangebote im öffentlichen Dienst (Bund/Länder/Kommunen/Hochschulen/
 * Kirchen, tausende verschiedene Arbeitgeber).
 *
 * Interamt ist eine stark verschleierte Apache-Wicket-Single-Page-App ohne
 * öffentlich erreichbares HTML/API — ein Playwright-Browser ist hier keine
 * Option, sondern zwingend nötig. Die Suchmaske wird bei jedem Lauf frisch
 * mit fest hinterlegten Filtern bestückt (siehe FILTER_* unten). Die
 * Trefferliste liefert bereits die wichtigsten Felder (ID, Behörde, Titel,
 * Besoldung/Entgelt, Ort, Dienstort-Art, Frist) direkt als Tabelle — nur für
 * Beschreibung/Voraussetzungen muss die Detailseite eines Jobs geöffnet
 * werden. Dank Crawl-Cache passiert das nur einmal pro Job.
 *
 * Der gespeicherte `link` wird immer aus der Angebots-ID gerechnet
 * (`interamtPermalink`) — die URL der geöffneten Detailseite wäre
 * sitzungsgebunden und liefe später ins Leere.
 */
export class InteramtAdapter extends PlaywrightAdapter {
  readonly name = "interamt";
  readonly label = "Interamt";
  readonly baseUrl = "https://interamt.de";

  /** Fest hinterlegte Sucheinstellungen (Label-Text der Checkboxen/Radios). */
  private readonly filterCheckboxes = ["Beamte", "Tarifbeschäftigte", "IT und Telekommunikation", "Naturwissenschaften"];
  private readonly filterRadio = /^unbefristet$/;

  private readonly maxLoadMoreClicks = 80; // Sicherheitsgrenze (~800 Treffer)
  private readonly detailNavTimeout = 30_000;

  async fetchJobs(context: CrawlContext): Promise<AdapterResult> {
    const result = this.createResult();

    await this.withPage(async (page) => {
      await this.openFilteredResults(page);
      const rows = await this.loadAllRows(page);

      for (const row of rows) {
        const id = this.buildId(row.id);
        try {
          let detailText = this.cachedDetail(context, id);
          if (detailText) {
            result.stats.cached++;
          } else {
            detailText = await this.openDetail(page, row.editLinkSelector);
            result.stats.fetched++;
          }

          // Der Link kommt bewusst nicht aus page.url() der Detailseite, sondern
          // aus der Angebots-ID — dadurch repariert jeder Lauf nebenbei auch die
          // alten "crypt."-Links bereits bekannter Jobs.
          result.jobs.push(this.mapJob(id, row, detailText, interamtPermalink(row.id)));
        } catch (error) {
          result.warnings.push(`Job ${row.id} übersprungen: ${error}`);
        }
      }
    });

    return result;
  }

  /** Öffnet die Stellensuche, akzeptiert Cookies, setzt die Filter und startet die Suche. */
  private async openFilteredResults(page: import("playwright").Page): Promise<void> {
    await page.goto(`${this.baseUrl}/koop/app/stellensuche`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(1000);

    const cookieBtn = page.getByRole("button", { name: /Cookies akzeptieren/i });
    if (await cookieBtn.count()) {
      await cookieBtn.first().click();
      await page.waitForTimeout(300);
    }

    for (const label of this.filterCheckboxes) {
      await this.checkByLabel(page, label);
      await page.waitForTimeout(300);
    }
    await this.checkByLabel(page, this.filterRadio);
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: /Detailsuche/i }).last().click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    await page.waitForTimeout(1000);
  }

  /** Interamt (Wicket) rendert Element-IDs bei jedem AJAX-Update neu — daher live per Label-Text suchen statt IDs zu cachen. */
  private async checkByLabel(page: import("playwright").Page, labelText: string | RegExp): Promise<void> {
    const label = page.locator("label", { hasText: labelText }).first();
    const forId = await label.getAttribute("for");
    if (!forId) throw new Error(`Label nicht gefunden: ${labelText}`);
    await page.locator(`#${forId}`).check({ force: true });
  }

  /** Klickt "mehr laden", bis alle Treffer geladen sind, und liest dann die Tabelle aus. */
  private async loadAllRows(page: import("playwright").Page): Promise<ListRow[]> {
    for (let i = 0; i < this.maxLoadMoreClicks; i++) {
      const loadMore = page.getByRole("button", { name: /mehr laden/i });
      if ((await loadMore.count()) === 0) break;
      await loadMore.click();
      await page.waitForTimeout(700);
    }

    const html = await page.content();
    const $ = cheerio.load(html);
    const rows: ListRow[] = [];

    $("table.ia-e-table--searchresults tbody tr").each((index, element) => {
      const $row = $(element);
      const field = (name: string) => {
        const $cell = $row.find(`td[data-field="${name}"]`).clone();
        $cell.find(".ia-sr-only").remove(); // Screenreader-only Text (z.B. "Stellenausschreibung öffnen")
        return cleanText($cell.text());
      };
      const id = field("StellenangebotId");
      if (!id) return;
      rows.push({
        id,
        employer: field("Behoerde"),
        titel: field("Stellenbezeichnung"),
        besoldung: field("BesoldungGruppeDisplayString"),
        entgelt: field("TarifEbeneDisplayString"),
        plzOrt: field("PLZOrte"),
        dienstort: field("Dienstort"),
        bewerbungsfrist: field("Bewerbungsfrist"),
        // Playwright-Selektor für den Klick auf genau diese Zeile (1-basiert wie im DOM).
        editLinkSelector: `table.ia-e-table--searchresults tbody tr:nth-child(${index + 1}) a.ia-e-link`,
      });
    });

    return rows;
  }

  /**
   * Öffnet die Detailseite einer Zeile, liest den Volltext, kehrt zur Liste
   * zurück. Die dabei entstehende URL wird bewusst verworfen — sie ist
   * sitzungsgebunden (siehe `interamtPermalink`).
   */
  private async openDetail(page: import("playwright").Page, editLinkSelector: string): Promise<string> {
    await page.locator(editLinkSelector).first().click();
    await page.waitForLoadState("networkidle", { timeout: this.detailNavTimeout });
    await page.waitForTimeout(500);
    const text = await page.locator("body").innerText();
    await page.goBack();
    await page.waitForLoadState("networkidle", { timeout: this.detailNavTimeout });
    await page.waitForTimeout(500);
    return text;
  }

  private mapJob(id: string, row: ListRow, detailText: string, link: string): JobOffer {
    const gehaltsstufe = row.besoldung || row.entgelt || undefined;
    const verbeamtung = Boolean(row.besoldung);
    const sections = detailText ? extractPdfSections(detailText) : { aufgaben: undefined, zwingend: [], wuenschenswert: [] };

    const remoteHint =
      /hybrid|home\s?office/i.test(row.dienstort)
        ? `Dienstort: ${row.dienstort}`
        : extractRemoteHint(detailText);

    // Der Arbeitgeber vergibt seine eigene Kennziffer/Chiffre — die steht (falls überhaupt
    // vorhanden) im Freitext der Detailseite. Interamts eigene Angebots-ID (row.id) bleibt
    // nur der Fallback, damit referenzcode nie leer ist; auf dieser Kennziffer lässt sich
    // die Stelle notfalls auch über die Original-Karriereseite des Arbeitgebers wiederfinden,
    // falls das Angebot bei Interamt selbst irgendwann verschwindet.
    const kennziffer = detailText ? extractKennziffer(detailText) : undefined;

    return this.finalize({
      id,
      employer: row.employer || undefined,
      titel: row.titel,
      link,
      referenzcode: kennziffer || row.id,
      beschreibung: sections.aufgaben || undefined,
      gehaltsstufe,
      // Ergebnis ist per Suchfilter bereits auf "unbefristet" beschränkt.
      befristung: ["Unbefristet"],
      arbeitszeit: extractArbeitszeit(detailText),
      verbeamtung,
      laufbahn: [],
      dienstorte: row.plzOrt ? [row.plzOrt] : [],
      homeoffice: remoteHint,
      bewerbungsfrist: parseGermanDate(row.bewerbungsfrist),
      voraussetzungenZwingend: sections.zwingend,
      voraussetzungenWuenschenswert: sections.wuenschenswert,
      raw: { detail: detailText || undefined },
    });
  }
}
