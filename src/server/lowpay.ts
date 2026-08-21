import type { JobOffer } from "../types.js";
import { parseGradeCandidates } from "../salary/match.js";
import { getEntry, loadBoard, saveBoard } from "./store.js";
import type { BoardStatus } from "./types.js";

/**
 * Angebote, deren Gehalt eindeutig unter dem Zielniveau des Profils (E13/A13)
 * liegt, landen ohne KI-Anfrage direkt im Archiv — genau wie abgelaufene
 * Fristen (siehe expiry.ts). Der Nutzer will solche Stellen gar nicht erst
 * einzeln vorgelegt bekommen, und jede Anfrage dafür wäre verschwendetes
 * Gemini-Kontingent.
 *
 * Die Regel greift bewusst nur, wenn die Angabe eindeutig ist. Fehlt sie oder
 * lässt sie sich nicht sicher einordnen, bleibt der Job in der Warteschlange
 * und wird regulär bewertet — lieber eine Anfrage zu viel als ein zu Unrecht
 * archiviertes Angebot.
 */

/** Zielniveau aus dem Profil: ab dieser Gruppennummer ist eine Stelle interessant. */
const MIN_GRUPPE = 13;

/**
 * Untergrenze für Industriegehälter (Jahresbrutto, obere Bandgrenze).
 * E13 TVöD Bund liegt je nach Erfahrungsstufe bei rund 62.000–88.000 € —
 * ein Band, das oben nicht einmal 62.000 € erreicht, liegt sicher darunter.
 */
const MIN_JAHRESBRUTTO = 62_000;

/** Statuswerte, die die automatische Archivierung überschreiben darf. */
const ARCHIVIERBARE_STATUS: BoardStatus[] = ["todo"];

/**
 * Wertet die Entgelt-/Besoldungsangabe aus. Maßgeblich ist die *höchste*
 * erreichbare Gruppe: "A 9g - A 13" erreicht A13 und ist damit nicht zu niedrig.
 *
 * Nur A (Beamte) und E (Tarif) werden numerisch verglichen:
 *   B/W/R liegen sämtlich über A13 (Spitzenämter, Professuren, Richterämter),
 *   S (Sozial-/Erziehungsdienst) und T (TV-BA-Tätigkeitsebenen, invers
 *   nummeriert — I ist die höchste) lassen keinen direkten Vergleich zu.
 */
function stufeZuNiedrig(gehaltsstufe: string): boolean | undefined {
  const kandidaten = parseGradeCandidates(gehaltsstufe);
  if (!kandidaten.length) return undefined;
  if (kandidaten.some((k) => k.system === "B" || k.system === "W" || k.system === "R")) return false;
  const vergleichbar = kandidaten.filter((k) => k.system === "A" || k.system === "E");
  if (!vergleichbar.length) return undefined; // nur S/T — keine Aussage möglich
  return Math.max(...vergleichbar.map((k) => k.nummer)) < MIN_GRUPPE;
}

/** "71.000" → 71000, "1.365,50" → 1365.5 (deutsche Schreibweise). */
function zahl(rohtext: string): number {
  return Number(rohtext.replace(/\./g, "").replace(",", "."));
}

/**
 * Wertet eine Freitext-Gehaltsangabe aus, z.B. "71.000 € und 104" (die Extraktion
 * schneidet die obere Bandgrenze am Tausenderpunkt ab, gemeint sind 104.000 €)
 * oder "1.365 € pro Monat". Maßgeblich ist die höchste genannte Zahl.
 */
function betragZuNiedrig(gehalt: string): boolean | undefined {
  // Monatsangaben ohne Einheit ("3000 - 4000") erkennen: vierstellige Beträge
  // im Bereich üblicher Monatsgehälter sind keine Jahresbeträge
  const nurZahlen = /^[\d.,\s€-]+$/.test(gehalt.trim());
  // Entweder mit Tausenderpunkten ("71.000") oder als reine Ziffernfolge ("4500") —
  // ein bloßes \d{1,3} würde "4500" als "450" lesen
  const zahlen = [...gehalt.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g)].map((m) => zahl(m[0]));
  if (!zahlen.length) return undefined;
  const monatlich =
    /pro\s*monat|im\s*monat|monatlich|\bmtl\b|studienjahr/i.test(gehalt) ||
    (nurZahlen && Math.max(...zahlen) < 20_000);
  // Zahlen unter 1000 sind abgeschnittene Tausender ("… und 104" = 104.000 €)
  const jahresbetraege = zahlen.map((wert) => {
    const jahr = monatlich ? wert * 12 : wert < 1000 ? wert * 1000 : wert;
    return jahr;
  });
  return Math.max(...jahresbetraege) < MIN_JAHRESBRUTTO;
}

/**
 * true, wenn das Angebot eindeutig unter dem Zielniveau liegt.
 * undefined-Ergebnisse der Teilprüfungen bedeuten "keine Aussage" — dann
 * entscheidet die jeweils andere Angabe, sonst bleibt der Job in der Warteschlange.
 */
export function istGehaltZuNiedrig(job: JobOffer): boolean {
  const stufe = job.gehaltsstufe?.trim();
  const ausStufe = stufe ? stufeZuNiedrig(stufe) : undefined;
  if (ausStufe !== undefined) return ausStufe;
  // Manche Portale schreiben den Betrag ins Stufen-Feld ("3000 - 4000") —
  // erst prüfen, wenn dort keine Entgeltgruppe erkannt wurde, sonst würde
  // die Gruppennummer aus "A 13" als Gehalt missverstanden
  const betragText = job.gehalt?.trim() || stufe;
  return (betragText ? betragZuNiedrig(betragText) : undefined) === true;
}

/** Kurzer, nachvollziehbarer Grund für den Board-Eintrag. */
export function gehaltHinweis(job: JobOffer): string {
  const angabe = job.gehaltsstufe?.trim() || job.gehalt?.trim() || "keine Angabe";
  return (
    `Gehalt liegt eindeutig unter deinem Zielniveau E13/A13 (Angabe: „${angabe}“) — ` +
    "automatisch archiviert (ohne KI-Anfrage)."
  );
}

/**
 * Archiviert alle Angebote unter Zielniveau, die noch in „Noch abzuarbeiten“
 * liegen. Bereits bewertete oder vom Menschen eingeordnete Jobs bleiben
 * unangetastet. Gibt die archivierten Jobs zurück (für Logs).
 */
export function archiviereZuNiedrigBezahlte(jobs: JobOffer[]): JobOffer[] {
  const board = loadBoard();
  const archiviert: JobOffer[] = [];

  for (const job of jobs) {
    if (!istGehaltZuNiedrig(job)) continue;
    let entry = getEntry(board, job.id);
    if (entry && !ARCHIVIERBARE_STATUS.includes(entry.status)) continue;

    if (!entry) {
      entry = { jobId: job.id, status: "archiviert", vonKi: true, updatedAt: "" };
      board.entries.push(entry);
    }
    entry.status = "archiviert";
    entry.vonKi = true;
    entry.updatedAt = new Date().toISOString();
    entry.punkte = 0;
    entry.begruendung = gehaltHinweis(job);
    archiviert.push(job);
  }

  // Nur einmal schreiben — setStatus() würde board.json je Job neu speichern
  if (archiviert.length) saveBoard(board);
  return archiviert;
}

/** Kurzer Log-Satz für die Konsole (leer, wenn nichts archiviert wurde). */
export function lowpayLogText(archiviert: JobOffer[]): string {
  if (!archiviert.length) return "✔ Keine Angebote unter Zielniveau zu archivieren.";
  return `✔ ${archiviert.length} Angebot(e) unter E13/A13 direkt archiviert (ohne KI-Anfrage).`;
}
