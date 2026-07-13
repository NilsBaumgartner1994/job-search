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
          const known = context.known.get(id);
          const cachedDetail = this.cachedDetail(context, id);

          let detailText = cachedDetail;
          let link = known?.link;
          if (detailText) {
            result.stats.cached++;
          } else {
            const detail = await this.openDetail(page, row.editLinkSelector);
            detailText = detail.text;
            link = detail.url;
            result.stats.fetched++;
          }

          result.jobs.push(this.mapJob(id, row, detailText ?? "", link ?? this.baseUrl));
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

  /** Öffnet die Detailseite einer Zeile, liest den Volltext, kehrt zur Liste zurück. */
  private async openDetail(
    page: import("playwright").Page,
    editLinkSelector: string,
  ): Promise<{ url: string; text: string }> {
    await page.locator(editLinkSelector).first().click();
    await page.waitForLoadState("networkidle", { timeout: this.detailNavTimeout });
    await page.waitForTimeout(500);
    const url = page.url();
    const text = await page.locator("body").innerText();
    await page.goBack();
    await page.waitForLoadState("networkidle", { timeout: this.detailNavTimeout });
    await page.waitForTimeout(500);
    return { url, text };
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
    // falls Interamts eigener "crypt."-Permalink irgendwann ins Leere läuft (Sitzung
    // abgelaufen o.ä. — dieser Link ist wicket-sitzungsgebunden und nicht dauerhaft stabil).
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
