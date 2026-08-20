import type { JobOffer } from "../types.js";
import { getEntry, loadBoard, saveBoard } from "./store.js";
import type { BoardStatus } from "./types.js";

/**
 * Abgelaufene Angebote landen ohne KI-Anfrage direkt im Archiv:
 * Eine Bewerbung ist nach Fristende nicht mehr möglich, jede Triage wäre
 * verschwendetes Gemini-Kontingent. Der Workflow (yarn agent) räumt damit
 * vor jedem Lauf auf; die Begründung im Board erklärt die Einstufung.
 */

/** Statuswerte, die die automatische Archivierung überschreiben darf. */
const ARCHIVIERBARE_STATUS: BoardStatus[] = ["todo", "interessant"];

/** Heutiges Datum als ISO-Tag (YYYY-MM-DD) — vergleichbar mit bewerbungsfrist. */
export function heuteIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** ISO-Tag (2026-07-16) → deutsches Format (16.07.2026). */
export function deutschesDatum(iso: string): string {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return treffer ? `${treffer[3]}.${treffer[2]}.${treffer[1]}` : iso;
}

/** true, wenn die Bewerbungsfrist vor dem heutigen Tag lag (heute zählt noch). */
export function istFristAbgelaufen(job: JobOffer, heute = heuteIso()): boolean {
  return Boolean(job.bewerbungsfrist && job.bewerbungsfrist < heute);
}

/**
 * Archiviert alle Jobs mit abgelaufener Frist, die noch in „Noch abzuarbeiten“
 * oder „Interessant“ liegen. Bereits beworbene/abgelehnte/archivierte Jobs
 * bleiben unangetastet — deren Status ist Historie.
 *
 * Gibt die archivierten Jobs zurück (für Logs und die Fortschrittsanzeige).
 */
export function archiviereAbgelaufene(jobs: JobOffer[], heute = heuteIso()): JobOffer[] {
  const board = loadBoard();
  const archiviert: JobOffer[] = [];

  for (const job of jobs) {
    if (!istFristAbgelaufen(job, heute)) continue;
    let entry = getEntry(board, job.id);
    if (entry && !ARCHIVIERBARE_STATUS.includes(entry.status)) continue;

    const hinweis =
      `Bewerbungsfrist am ${deutschesDatum(job.bewerbungsfrist!)} abgelaufen — ` +
      "automatisch archiviert (ohne KI-Anfrage).";
    if (!entry) {
      entry = { jobId: job.id, status: "archiviert", vonKi: true, updatedAt: "" };
      board.entries.push(entry);
    }
    entry.status = "archiviert";
    entry.vonKi = true;
    entry.updatedAt = new Date().toISOString();
    entry.begruendung = entry.begruendung
      ? `${hinweis}\n\nFrühere KI-Einschätzung: ${entry.begruendung}`
      : hinweis;
    archiviert.push(job);
  }

  // Nur einmal schreiben — setStatus() würde board.json je Job neu speichern
  if (archiviert.length) saveBoard(board);
  return archiviert;
}

/** Kurzer Log-Satz für die Konsole (leer, wenn nichts archiviert wurde). */
export function archivLogText(archiviert: JobOffer[]): string {
  if (!archiviert.length) return "✔ Keine abgelaufenen Angebote zu archivieren.";
  return `✔ ${archiviert.length} Angebot(e) mit abgelaufener Frist direkt archiviert (ohne KI-Anfrage).`;
}
