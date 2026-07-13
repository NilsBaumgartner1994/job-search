import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { fetchArrayBuffer, fetchText } from "../http.js";
import { SALARY_FILE, type SalaryData, type SalaryTable } from "./types.js";

/**
 * Lädt die Besoldungs- (Beamte) und Entgelttabellen (öffentlicher Dienst)
 * von academics.de und speichert sie als data/gehaltstabellen.json. Ergänzend
 * dazu zwei Tabellen von oeffentlicher-dienst.info, die academics.de nicht
 * führt: TV-BA (Bundesagentur für Arbeit) und TVöD-SuE (Sozial- und
 * Erziehungsdienst, "S"-Gruppen) — siehe fetchExtraTables() unten.
 *
 * Aufruf: yarn salaries
 */

const SOURCES = [
  "https://www.academics.de/ratgeber/besoldung-beamte-gehalt",
  "https://www.academics.de/ratgeber/gehalt-oeffentlicher-dienst",
];

/** Erste Spalte muss wie eine Besoldungs-/Entgeltgruppe aussehen (A 13, E 9a, EG 15Ü, B 2, ...). */
const GRADE_PATTERN = /^(?:A|B|R|W|E|EG)\s?\d{1,2}[a-zÜü]?(?:\s?\(.*\))?$/;

export async function fetchSalaryTables(): Promise<SalaryData> {
  const tables: SalaryTable[] = [];

  for (const source of SOURCES) {
    const html = await fetchText(source);
    const $ = cheerio.load(html);

    $("table").each((_, tableElement) => {
      const $table = $(tableElement);
      const heading = findHeading($, tableElement);
      const rows = $table.find("tr").toArray();
      if (rows.length < 2) return;

      const headerCells = $(rows[0])
        .find("th, td")
        .map((_, cell) => $(cell).text().replace(/\s+/g, " ").trim())
        .get();
      // Stufen-Spalten: alles außer der ersten Spalte; "Stufe 2" → "2"
      const stufen = headerCells.slice(1).map((cell) => cell.replace(/^Stufe\s*/i, "").trim());

      const gruppen: Record<string, Record<string, number | null>> = {};
      for (const row of rows.slice(1)) {
        const cells = $(row)
          .find("th, td")
          .map((_, cell) => $(cell).text().replace(/\s+/g, " ").trim())
          .get();
        const gruppe = normalizeGradeKey(cells[0] ?? "");
        if (!GRADE_PATTERN.test(cells[0] ?? "") && !GRADE_PATTERN.test(gruppe)) continue;
        const werte: Record<string, number | null> = {};
        stufen.forEach((stufe, index) => {
          werte[stufe] = parseEuro(cells[index + 1]);
        });
        gruppen[gruppe] = werte;
      }

      if (Object.keys(gruppen).length === 0) return; // z.B. Beihilfe-/Übersichtstabellen

      const system = Object.keys(gruppen)[0].startsWith("E") ? "entgelt" : "besoldung";
      tables.push({
        id: slugify(heading),
        titel: heading,
        quelle: source,
        system,
        stufen,
        gruppen,
      });
    });
  }

  const extra = await fetchExtraTables();
  tables.push(...extra.tables);

  return { abgerufen: new Date().toISOString(), quellen: [...SOURCES, ...extra.quellen], tabellen: tables };
}

const OEFFENTLICHER_DIENST_BASE = "https://oeffentlicher-dienst.info";
// Server liefert ISO-8859-15, nicht UTF-8 — response.text() würde Umlaute zerstören.
async function fetchLatin1(url: string): Promise<string> {
  const buffer = await fetchArrayBuffer(url);
  return new TextDecoder("iso-8859-15").decode(buffer);
}

/** Tätigkeitsebenen des TV-BA als römische Zahl → interner Schlüssel "T <Nummer>". */
const TV_BA_TAETIGKEITSEBENEN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8,
};

interface ExtraSource {
  /** Übersichtsseite, auf der die aktuelle Tabellen-ID ermittelt wird. */
  landingUrl: string;
  /** Präfix der ID in Links wie "id=tv-ba-2026&matrix=1". */
  idPrefix: string;
  /** Pfad des Matrix-Endpunkts, z.B. "/c/t/rechner/tv-ba". */
  matrixPath: string;
  /** Wandelt die rohe erste Zellen-Spalte einer Zeile in unseren Gruppenschlüssel um,
      oder liefert null, um die Zeile zu überspringen (z.B. TV-BA "AT"-Ebenen). */
  normalizeGrade: (raw: string) => string | null;
}

const EXTRA_SOURCES: ExtraSource[] = [
  {
    landingUrl: `${OEFFENTLICHER_DIENST_BASE}/tv-ba/`,
    idPrefix: "tv-ba",
    matrixPath: "/c/t/rechner/tv-ba",
    normalizeGrade: (raw) =>
      Object.prototype.hasOwnProperty.call(TV_BA_TAETIGKEITSEBENEN, raw) ? `T ${TV_BA_TAETIGKEITSEBENEN[raw]}` : null,
  },
  {
    landingUrl: `${OEFFENTLICHER_DIENST_BASE}/tvoed/sue/`,
    idPrefix: "tvoed-sue",
    matrixPath: "/c/t/rechner/tvoed/sue",
    // Rohformat ist bereits "S 18", "S 11b" — normalizeGradeKey fügt bei Bedarf nur das Leerzeichen ein.
    // Die explizite Prüfung verwirft die Fußzeile der Tabelle ("Entgelttabelle mit
    // Monatswerten"), die sonst als vermeintliche Gruppe durchrutschen würde.
    normalizeGrade: (raw) => (/^S\s?\d{1,2}[ab]?$/i.test(raw) ? normalizeGradeKey(raw) : null),
  },
];

/** Findet auf der Übersichtsseite die ID der aktuellsten Tabelle (höchstes Jahr/Suffix, z.B. "2026" statt "2024b"). */
async function findCurrentTableId(landingUrl: string, idPrefix: string): Promise<string> {
  const html = await fetchLatin1(landingUrl);
  const pattern = new RegExp(`id=(${idPrefix}-\\d{4}[a-z]?)&matrix=1`, "g");
  const ids = new Set<string>();
  for (const match of html.matchAll(pattern)) ids.add(match[1]);
  if (ids.size === 0) throw new Error(`Keine Tabellen-ID auf ${landingUrl} gefunden — Seitenaufbau geändert?`);
  return [...ids].sort().pop()!; // "2026" > "2025" > "2024b" > "2024" (funktioniert lexikografisch)
}

/**
 * Lädt eine einzelne Zusatztabelle (TV-BA oder TVöD-SuE). Die Matrix-Ansicht enthält
 * mehrere <table>-Elemente (Haupttabelle, Sondertabellen wie TV-BA "AT"-Ebenen,
 * Rechner-Widgets); die gesuchte ist die erste, deren Kopfzeile mit "€" beginnt und
 * mehr als eine Stufen-Spalte hat (die AT-Sondertabelle hat nur eine Stufe "0").
 */
async function fetchExtraTable(source: ExtraSource): Promise<SalaryTable | undefined> {
  const id = await findCurrentTableId(source.landingUrl, source.idPrefix);
  const matrixUrl = `${OEFFENTLICHER_DIENST_BASE}${source.matrixPath}?id=${id}&matrix=1`;
  const html = await fetchLatin1(matrixUrl);
  const $ = cheerio.load(html);

  let result: SalaryTable | undefined;
  $("table").each((_, table) => {
    if (result) return;
    const rows = $(table).find("tr").toArray();
    const headerIndex = rows.findIndex((row) => $(row).find("th, td").first().text().trim() === "€");
    if (headerIndex === -1) return;

    const headerCells = $(rows[headerIndex])
      .find("th, td")
      .map((_, cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .get();
    const stufen = headerCells.slice(1);
    if (stufen.length < 2) return; // Sondertabellen mit nur einer Stufe (z.B. TV-BA "AT") überspringen

    const gruppen: Record<string, Record<string, number | null>> = {};
    for (const row of rows.slice(headerIndex + 1)) {
      const cells = $(row)
        .find("th, td")
        .map((_, cell) => $(cell).text().replace(/\s+/g, " ").trim())
        .get();
      if (!cells.length) continue;
      const gruppe = source.normalizeGrade(cells[0] ?? "");
      if (!gruppe) continue;
      const werte: Record<string, number | null> = {};
      stufen.forEach((stufe, index) => {
        werte[stufe] = parseOeffentlicherDienstEuro(cells[index + 1]);
      });
      gruppen[gruppe] = werte;
    }
    if (Object.keys(gruppen).length === 0) return;

    const captionRow = rows[headerIndex - 1];
    const titel = (captionRow ? $(captionRow).text() : id).replace(/\s+/g, " ").trim() || id;
    result = { id: slugify(titel), titel, quelle: matrixUrl, system: "entgelt", stufen, gruppen };
  });
  return result;
}

/** "5508.23" → 5508.23; "–"/"-"/"" → null. Anders als academics.de nutzt diese Quelle "." als Dezimaltrennzeichen. */
function parseOeffentlicherDienstEuro(raw: string | undefined): number | null {
  if (!raw || !/^\d/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function fetchExtraTables(): Promise<{ tables: SalaryTable[]; quellen: string[] }> {
  const tables: SalaryTable[] = [];
  const quellen: string[] = [];
  for (const source of EXTRA_SOURCES) {
    try {
      const table = await fetchExtraTable(source);
      if (table) {
        tables.push(table);
        quellen.push(table.quelle);
      } else {
        console.warn(`⚠ Keine passende Tabelle auf ${source.landingUrl} gefunden — übersprungen.`);
      }
    } catch (error) {
      console.warn(`⚠ ${source.landingUrl} übersprungen: ${error}`);
    }
  }
  return { tables, quellen };
}

/** Nächste Überschrift (h2/h3) oberhalb der Tabelle im Dokumentfluss. */
function findHeading($: cheerio.CheerioAPI, tableElement: Element): string {
  const headings = $("h2, h3, table").toArray();
  let last = "Tabelle";
  for (const element of headings) {
    if (element === tableElement) break;
    if (element.tagName !== "table") {
      last = $(element).text().replace(/\s+/g, " ").trim();
    }
  }
  return last;
}

/** "3.107,26" → 3107.26; "–"/"-"/"" → null */
function parseEuro(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[€\s]/g, "");
  if (!/\d/.test(cleaned)) return null;
  return Number(cleaned.replace(/\./g, "").replace(",", "."));
}

/** "EG 15Ü" → "E 15Ü", "E16" → "E 16", "A13" → "A 13" — einheitliche Schlüssel. */
export function normalizeGradeKey(raw: string): string {
  return raw
    .replace(/\s?\(.*\)$/, "")
    .replace(/^EG\s?/, "E ")
    .replace(/^([ABRWES])\s?(\d)/, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function saveSalaryData(data: SalaryData): void {
  mkdirSync(dirname(SALARY_FILE), { recursive: true });
  writeFileSync(SALARY_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// Direktaufruf als Skript (yarn salaries)
if (process.argv[1]?.endsWith("fetchSalaryTables.ts")) {
  fetchSalaryTables()
    .then((data) => {
      saveSalaryData(data);
      for (const table of data.tabellen) {
        console.log(`✓ ${table.titel} — ${Object.keys(table.gruppen).length} Gruppen, Stufen: ${table.stufen.join(", ")}`);
      }
      console.log(`\nGespeichert → ${SALARY_FILE}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
