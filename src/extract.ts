/** Hilfsfunktionen, um typische Angaben aus deutschen Stellenausschreibungen zu ziehen. */

const GERMAN_MONTHS: Record<string, string> = {
  januar: "01",
  februar: "02",
  märz: "03",
  april: "04",
  mai: "05",
  juni: "06",
  juli: "07",
  august: "08",
  september: "09",
  oktober: "10",
  november: "11",
  dezember: "12",
};

/**
 * Parst deutsche Datumsangaben ("04.08.2026", "04. August 2026") sowie
 * ISO-Daten und SAP-OData-Daten ("/Date(1785456000000)/") zu YYYY-MM-DD.
 */
export function parseGermanDate(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();

  const odata = text.match(/\/Date\((\d+)\)\//);
  if (odata) {
    return new Date(Number(odata[1])).toISOString().slice(0, 10);
  }

  // Kein \b nach dem Tag: ISO-Datumszeiten ("2026-10-30T23:59") haben dort keine
  // Wortgrenze, weil "T" ebenfalls ein \w-Zeichen ist.
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const numeric = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (numeric) {
    return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }

  const written = text.toLowerCase().match(/\b(\d{1,2})\.?\s+([a-zä]+)\s+(\d{4})\b/);
  if (written && GERMAN_MONTHS[written[2]]) {
    return `${written[3]}-${GERMAN_MONTHS[written[2]]}-${written[1].padStart(2, "0")}`;
  }

  return undefined;
}

/**
 * Findet Entgelt-/Besoldungsgruppen wie "EG 13 TV EntgO Bund", "E 11 TVöD",
 * "A 9g/A 11", "BesGr. A7/A9m+Z" oder "Vergütung: E 12 (TVöD Bund) bzw. A 12 BBesO".
 */
export function extractSalaryGrade(text: string): string | undefined {
  const patterns = [
    // "Vergütung:"-Zeilen dürfen Klammern und "bzw." enthalten (z.B.
    // "E 12 (TVöD Bund) bzw. A 12 BBesO"); Boilerplate hinter Komma fällt weg.
    /Vergütung\s*:\s*([^,;\n]{1,90})/i,
    /\bE\s?G\s?\d{1,2}[a-z]?(?:\s*(?:bis|-|–|\/)\s*(?:E\s?G\s?)?\d{1,2}[a-z]?)?\s*(?:TV[\wöÖ]*(?:\s?EntgO\s?Bund)?)?/,
    /\bE\s?\d{1,2}\s?(?:TV[\wöÖ-]*(?:\s?EntgO\s?Bund)?|TVöD)/,
    /\bE\s?\d{1,2}[a-c]?\s?\((?:TVöD|TV-L|TV-H)[^)]{0,20}\)/,
    /Entgeltgruppe\s*:?\s*[^,;.\n(]{1,80}/i,
    /Bes(?:oldungsgruppe|Grn?\.?)\s*:?\s*[^,;.\n(]{1,80}/i,
    /\bA\s?\d{1,2}(?:[gm](?:\+Z)?)?(?:\s*\/\s*A?\s?\d{1,2}(?:[gm](?:\+Z)?)?)+/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return (match[1] ?? match[0]).replace(/\s+/g, " ").replace(/[\s.,-]+$/, "").trim();
  }
  return undefined;
}

/** Findet konkrete Gehaltsangaben in Euro, z.B. "57.700 €" oder "3.500 - 4.200 Euro". */
export function extractSalary(text: string): string | undefined {
  const match = text.match(
    /\d{1,3}(?:\.\d{3})+(?:,\d{2})?\s*(?:€|Euro)(?:\s*(?:bis|-|–)\s*\d{1,3}(?:\.\d{3})+(?:,\d{2})?\s*(?:€|Euro)?)?[^\n.;]{0,50}/,
  );
  return match ? match[0].replace(/\s+/g, " ").trim() : undefined;
}

/** Sucht Hinweise auf Homeoffice / mobiles Arbeiten und gibt den betreffenden Satz zurück. */
export function extractRemoteHint(text: string): string | undefined {
  const keyword = /(home\s?-?office|mobile[sn]?\s+arbeiten|telearbeit|remote)/i;
  const match = text.match(keyword);
  if (!match) return undefined;
  // Den umgebenden Satz (bzw. die Zeile) herausschneiden, damit der Kontext erhalten bleibt.
  const index = match.index ?? 0;
  const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf("\n", index)) + 1;
  const afterMatch = index + match[0].length;
  const boundaries = [text.indexOf(".", afterMatch), text.indexOf("\n", afterMatch)]
    .filter((position) => position !== -1);
  const end = Math.min(...(boundaries.length ? boundaries : [text.length]), start + 250);
  return text.slice(start, end + 1).replace(/\s+/g, " ").trim();
}

/** Erkennt "Unbefristet" / "Befristet" im Text. Chips-Liste, ggf. leer. */
export function extractBefristung(text: string): string[] {
  if (/\bunbefristet/i.test(text)) return ["Unbefristet"];
  const befristet = text.match(/befristet(?:\s+(?:bis|auf|für)\s+[^,;.\n]{1,40})?/i);
  if (befristet) return [capitalize(befristet[0].replace(/\s+/g, " ").trim())];
  return [];
}

/** Erkennt Vollzeit/Teilzeit als Chips-Liste (auch "Voll- oder Teilzeit"). */
export function extractArbeitszeit(text: string): string[] {
  const chips = new Set<string>();
  if (/voll-?\s*(?:und|oder|\/)\s*teilzeit/i.test(text)) {
    chips.add("Vollzeit");
    chips.add("Teilzeit");
  }
  if (/vollzeit/i.test(text)) chips.add("Vollzeit");
  if (/teilzeit/i.test(text)) chips.add("Teilzeit");
  return [...chips];
}

/** Erkennt, ob die Stelle verbeamtet ist bzw. eine Verbeamtung möglich ist. */
export function extractVerbeamtung(text: string): boolean {
  return /verbeamt|beamtenverhältnis|beamtin|\bbeamte\b|besoldungsgruppe|\bBesGrn?\b|BesGr\.|\bA\s?\d{1,2}[gm]?(?:\+Z)?\s*\/\s*A\s?\d{1,2}/i.test(
    text,
  );
}

const LAUFBAHN_PATTERNS: Array<[RegExp, string]> = [
  [/einfachen?\s+(?:nichttechnischen\s+|technischen\s+)?Dienst(?:es)?/i, "Einfacher Dienst"],
  [/mittleren?\s+(?:nichttechnischen\s+|technischen\s+|Verwaltungs-?)?Dienst(?:es)?/i, "Mittlerer Dienst"],
  [/gehobenen?\s+(?:nichttechnischen\s+|technischen\s+)?Dienst(?:es)?/i, "Gehobener Dienst"],
  [/(?:höheren?|hoeheren?)\s+(?:nichttechnischen\s+|technischen\s+)?Dienst(?:es)?/i, "Höherer Dienst"],
];

/**
 * Erkennt die Laufbahngruppe (Einfacher/Mittlerer/Gehobener/Höherer Dienst)
 * im Text. Fällt mangels expliziter Nennung auf eine grobe Ableitung aus der
 * Besoldungsgruppe zurück (A2–A5 einfach, A6–A9 mittel, A9–A13 gehoben,
 * A13–A16 höher — Überschneidungen an den Laufbahngrenzen sind Absicht).
 */
export function extractLaufbahn(text: string, gehaltsstufe?: string): string[] {
  const treffer = LAUFBAHN_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  if (treffer.length > 0) return treffer;

  const besoldung = (gehaltsstufe ?? "").match(/\bA\s?(\d{1,2})/g) ?? [];
  const ergebnis = new Set<string>();
  for (const match of besoldung) {
    const nummer = Number(match.replace(/\D/g, ""));
    if (nummer >= 2 && nummer <= 5) ergebnis.add("Einfacher Dienst");
    if (nummer >= 6 && nummer <= 9) ergebnis.add("Mittlerer Dienst");
    if (nummer >= 9 && nummer <= 13) ergebnis.add("Gehobener Dienst");
    if (nummer >= 13 && nummer <= 16) ergebnis.add("Höherer Dienst");
  }
  return [...ergebnis];
}

/**
 * Normalisiert PDF-Extrakttext: anders als HTML brechen PDFs Zeilen mitten im
 * Satz um (Layout, nicht Semantik). Einzelne Zeilenumbrüche (ohne Bullet
 * danach) werden zu Leerzeichen, damit Satz-/Abschnitts-Erkennung
 * funktioniert; Bullet-Zeilen und Absatzgrenzen (Leerzeile) bleiben erhalten.
 */
export function normalizePdfText(text: string): string {
  return text
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, "\n\n")
    // \n vor Bullet-Zeilen und vor "Feldname:"-Zeilen (z.B. "Referenzcode:") bleibt erhalten.
    .replace(/([^\n])\n(?!\n|\s*•|[A-ZÄÖÜ][\wäöüß]{2,30}\s*:)/g, "$1 ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface PdfSections {
  aufgaben?: string;
  zwingend: string[];
  wuenschenswert: string[];
}

const PDF_SECTION_HEADERS: Array<{ kind: keyof PdfSections | "bieten" | "stop"; pattern: RegExp }> = [
  { kind: "aufgaben", pattern: /Ihre[a-zäöü]*\s+(?:zukünftigen\s+)?Aufgaben(?:schwerpunkte)?\s*:/i },
  { kind: "aufgaben", pattern: /Aufgabenschwerpunkte\s*:/i },
  { kind: "aufgaben", pattern: /Was\s+sind\s+Ihre\s+Aufgaben\s*\??\s*:?/i },
  { kind: "zwingend", pattern: /Das\s+erwarten\s+wir\s+von\s+Ihnen\s*:/i },
  { kind: "zwingend", pattern: /Ihr\s+Profil\s*:/i },
  { kind: "zwingend", pattern: /Wir\s+erwarten\s*:/i },
  { kind: "zwingend", pattern: /Anforderungsprofil\s*:/i },
  { kind: "zwingend", pattern: /Was\s+sollten\s+Sie\s+mitbringen\s*\??\s*:?/i },
  { kind: "zwingend", pattern: /Ihr\s+Anforderungsprofil\s*:/i },
  { kind: "wuenschenswert", pattern: /Das\s+wünschen\s+wir\s+uns\s*:/i },
  { kind: "wuenschenswert", pattern: /(?:Zusätzlich\s+)?[Ww]ünschenswert[a-zäöü]*(?:[^:\n]{0,40})?:/i },
  { kind: "wuenschenswert", pattern: /Von\s+Vorteil\s*:/i },
  { kind: "bieten", pattern: /Wir\s+bieten\s+Ihnen\s*:/i },
  { kind: "bieten", pattern: /Was\s+bieten\s+wir\s*\??\s*:?/i },
  { kind: "stop", pattern: /Wichtige\s+Hinweise\s*:?/i },
  { kind: "stop", pattern: /Neugierig\s+geworden/i },
  { kind: "stop", pattern: /Bei\s+Fragen\s+freuen/i },
  { kind: "stop", pattern: /^Referenzcode\s*$/im },
  { kind: "stop", pattern: /Nähere\s+Informationen\s+zur\s+Bewerbung/i },
  { kind: "stop", pattern: /Zurück\s+zur\s+Trefferliste/i },
  { kind: "stop", pattern: /^Details\s*$/im },
  { kind: "stop", pattern: /INTERAMT\s+Angebots-ID/i },
];

/**
 * Zerlegt den Volltext einer Stellenausschreibung (PDF- oder aus dem Browser
 * gelesener Volltext) anhand typischer Zwischenüberschriften ("Ihre
 * Aufgaben:", "Das erwarten wir von Ihnen:", "Was sollten Sie mitbringen?",
 * ...). Genutzt von ITZBund (PDF) und Interamt (Freitext, sehr
 * unterschiedliche Vorlagen je nach den tausenden Arbeitgebern) — nicht jede
 * Sektion wird in jedem Text gefunden.
 */
export function extractPdfSections(text: string): PdfSections {
  const cleaned = text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, "\n");

  const hits = PDF_SECTION_HEADERS.map(({ kind, pattern }) => {
    const match = cleaned.match(pattern);
    return match ? { kind, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length } : undefined;
  }).filter((hit): hit is { kind: (typeof PDF_SECTION_HEADERS)[number]["kind"]; start: number; end: number } => !!hit);

  hits.sort((a, b) => a.start - b.start);

  const result: PdfSections = { zwingend: [], wuenschenswert: [] };
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (hit.kind === "stop" || hit.kind === "bieten") continue;
    const next = hits[i + 1];
    const body = cleaned.slice(hit.end, next ? next.start : cleaned.length).trim();
    if (!body) continue;

    if (hit.kind === "aufgaben") {
      if (!result.aufgaben) result.aufgaben = toBulletList(body).join("\n") || body;
    } else if (!result[hit.kind].length) {
      result[hit.kind] = toBulletList(body);
    }
  }
  return result;
}

/**
 * Zerlegt einen Abschnitt in Listenpunkte: zuerst per "•" (PDF-Volltexte),
 * sonst per Zeilenumbruch (Browser-innerText von <li>-Listen kennt keine
 * Bullet-Zeichen); ohne beides bleibt der Abschnitt ein Einzeleintrag.
 */
function toBulletList(body: string): string[] {
  const bulletItems = body
    .split(/\n?•\s*/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (bulletItems.length > 1) return bulletItems;

  const lineItems = body
    .split(/\n+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lineItems.length > 1) return lineItems;

  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed ? [collapsed] : [];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Entfernt überflüssigen Whitespace aus extrahiertem HTML-Text. */
export function cleanText(value: string): string {
  return value
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * Sucht eine vom Arbeitgeber selbst vergebene Kennziffer/Chiffre im Freitext
 * (z.B. "Kennziffer: T-2026-50", "Chiffre: 42260702", "Referenznummer 074-H
 * dieser Stellenausschreibung") — anders als z.B. Interamts eigene, portal-
 * interne Angebots-ID ist das der Code, unter dem der Arbeitgeber die Stelle
 * auf seiner eigenen Seite oder in Papierform führt.
 *
 * Da nach dem Label oft direkt Fließtext folgt (kein Doppelpunkt als
 * Trenner), wird nur das erste "Wort" übernommen; ein zweites nur, wenn es
 * selbst wie ein Fortsetzungsteil des Codes aussieht (enthält eine Ziffer,
 * z.B. "D 195/16"), sonst ist es bereits der nächste Satz ("... dieser
 * Stellenausschreibung"). Ergebnisse ohne jede Ziffer (z.B. ein versehentlich
 * getroffenes Fließtext-Wort wie "fristgerecht") werden verworfen.
 */
export function extractKennziffer(text: string): string | undefined {
  const match = text.match(
    /\b(?:Kennziffer|Chiffre|Referenznummer|Ausschreibungs\w*nummer|Ausschreibungs\w*kennziffer|Stellen-?ID|Ref\.-?Nr\.?|Ausschreibungs-?ID)\b\s*:?\s*(\S+(?:\s\S+)?)/i,
  );
  if (!match) return undefined;
  const tokens = match[1].split(/\s+/);
  const code = tokens.length > 1 && /\d/.test(tokens[1]) ? `${tokens[0]} ${tokens[1]}` : tokens[0];
  const cleaned = code.replace(/[.,;:)]+$/, "");
  return /\d/.test(cleaned) ? cleaned : undefined;
}
