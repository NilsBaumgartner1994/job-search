import * as cheerio from "cheerio";
import type { JobOffer } from "../types.js";

/** Obergrenze, damit ein einzelner Prompt das Kontingent nicht sprengt. */
const MAX_RAW_CHARS = 80_000;

function looksLikeHtml(text: string): boolean {
  return /<\s*(html|body|div|p|table|span|section|article|ul|li|h[1-6])[\s>]/i.test(text);
}

/** HTML → lesbarer Fließtext (Scripte/Styles raus, Blöcke als Zeilen). */
function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe").remove();
  const text = $("body").length ? $("body").text() : $.root().text();
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Baut den kompletten Roh-Text eines Angebots für den KI-Agenten zusammen:
 * die gesamte Seite als kopierter Text (raw.detail, HTML wird zu Text) plus
 * die normalisierten Felder als kompakte Übersicht.
 */
export function jobToRawText(job: JobOffer): string {
  const fields: string[] = [
    `Titel: ${job.titel}`,
    job.employer ? `Arbeitgeber: ${job.employer}` : "",
    job.referenzcode ? `Referenzcode: ${job.referenzcode}` : "",
    job.dienstorte.length ? `Dienstorte: ${job.dienstorte.join(", ")}` : "",
    job.gehaltsstufe ? `Entgelt/Besoldung: ${job.gehaltsstufe}` : "",
    job.gehalt ? `Gehalt: ${job.gehalt}` : "",
    job.befristung.length ? `Befristung: ${job.befristung.join(", ")}` : "",
    job.arbeitszeit.length ? `Arbeitszeit: ${job.arbeitszeit.join(", ")}` : "",
    job.laufbahn.length ? `Laufbahn: ${job.laufbahn.join(", ")}` : "",
    `Verbeamtung: ${job.verbeamtung ? "ja" : "nein/unbekannt"}`,
    job.homeoffice ? `Homeoffice: ${job.homeoffice}` : "",
    job.bewerbungsfrist ? `Bewerbungsfrist: ${job.bewerbungsfrist}` : "",
    `Link: ${job.link}`,
  ].filter(Boolean);

  const parts: string[] = [
    "=== Normalisierte Felder ===",
    fields.join("\n"),
  ];

  const detail = job.raw?.detail?.trim();
  if (detail) {
    const text = looksLikeHtml(detail) ? htmlToText(detail) : detail;
    parts.push("=== Kompletter Seitentext der Ausschreibung ===", text);
  } else if (job.beschreibung) {
    parts.push("=== Beschreibung ===", job.beschreibung);
  }

  if (job.voraussetzungenZwingend.length) {
    parts.push(
      "=== Zwingende Voraussetzungen (extrahiert) ===",
      job.voraussetzungenZwingend.map((v) => `- ${v}`).join("\n"),
    );
  }
  if (job.voraussetzungenWuenschenswert.length) {
    parts.push(
      "=== Wünschenswerte Voraussetzungen (extrahiert) ===",
      job.voraussetzungenWuenschenswert.map((v) => `- ${v}`).join("\n"),
    );
  }

  let result = parts.join("\n\n");
  if (result.length > MAX_RAW_CHARS) {
    result = result.slice(0, MAX_RAW_CHARS) + "\n\n[… gekürzt …]";
  }
  return result;
}
