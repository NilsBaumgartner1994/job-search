import { loadBoard, loadJobSnapshot } from "./store.js";
import type { BoardEntry, BoardStatus } from "./types.js";

/**
 * Notizen des Nutzers als zusätzlicher Prompt-Kontext.
 *
 * Das Profil (data/agent/profil.md) beschreibt die Wünsche abstrakt — die
 * Notizen zeigen sie am konkreten Fall: „bei dieser Stelle zählt für mich X“.
 * Genau diese Begründungen fehlen der KI sonst, weshalb sie bei jeder Triage
 * und jeder Folgefrage mitgeschickt werden. Der Nutzer muss dafür nichts tun
 * außer Notizen zu schreiben — jede neue Notiz verbessert die nächste Triage.
 */

/** Kopfzeile je Notiz, damit die KI Zustimmung und Ablehnung unterscheiden kann. */
const STATUS_TEXT: Record<BoardStatus, string> = {
  todo: "noch offen",
  interessant: "interessant",
  bewerben: "will ich mich bewerben",
  beworben: "beworben",
  abgelehnt: "Bewerbung abgelehnt",
  archiviert: "archiviert/aussortiert",
};

/** Mehr Notizen als das bringen keinen Zusatznutzen, blähen den Prompt aber auf. */
const MAX_NOTIZEN = 40;
/** Obergrenze je Notiz — lange Notizen werden gekürzt, nicht weggelassen. */
const MAX_ZEICHEN = 600;

function kuerzen(text: string): string {
  const sauber = text.trim().replace(/\s*\n\s*/g, " ");
  return sauber.length > MAX_ZEICHEN ? sauber.slice(0, MAX_ZEICHEN - 1) + "…" : sauber;
}

/** Kurze Kennzeichnung des Angebots: Titel (Arbeitgeber, Dienstort). */
function jobBezeichnung(jobId: string): string {
  const job = loadJobSnapshot(jobId);
  if (!job?.titel) return jobId;
  const zusatz = [job.employer, (job.dienstorte ?? [])[0]].filter(Boolean).join(", ");
  return zusatz ? `${job.titel} (${zusatz})` : job.titel;
}

/**
 * Die jüngsten Notizen zuerst: die letzten Einschätzungen des Nutzers wiegen
 * schwerer als Monate alte. Einträge ohne Notiz fallen heraus.
 */
function notizEintraege(): BoardEntry[] {
  return loadBoard()
    .entries.filter((entry) => entry.notiz?.trim())
    .sort((a, b) => (b.notizAt ?? b.updatedAt).localeCompare(a.notizAt ?? a.updatedAt))
    .slice(0, MAX_NOTIZEN);
}

/**
 * Baut den Notiz-Abschnitt für den System-Prompt. Leerer String, solange der
 * Nutzer noch keine Notiz geschrieben hat — dann bleibt der Prompt unverändert.
 */
export function notizenKontext(): string {
  const eintraege = notizEintraege();
  if (!eintraege.length) return "";
  return [
    "=== Eigene Notizen des Nutzers zu einzelnen Angeboten ===",
    "Diese Sätze hat der Nutzer selbst zu bereits eingeordneten Angeboten",
    "geschrieben. Sie zeigen, was ihm in der Praxis wirklich wichtig ist, und",
    "ergänzen das Profil: Erkenne die Muster darin (welche Aufgaben, Arbeitgeber",
    "und Rahmenbedingungen er hervorhebt bzw. ablehnt) und wende sie auf die",
    "neuen Angebote an. Bei Widersprüchen zum Profil zählt die neuere Notiz.",
    "",
    ...eintraege.map(
      (entry) => `- [${STATUS_TEXT[entry.status] ?? entry.status}] ${jobBezeichnung(entry.jobId)}: „${kuerzen(entry.notiz!)}“`,
    ),
  ].join("\n");
}

/** Notiz zu genau einem Angebot — für die Triage bzw. Rückfragen zu diesem Job. */
export function notizZuJob(jobId: string): string {
  const entry = loadBoard().entries.find((e) => e.jobId === jobId);
  const notiz = entry?.notiz?.trim();
  if (!notiz) return "";
  return [
    "=== Notiz des Nutzers zu genau diesem Angebot ===",
    "Sie wiegt schwerer als deine eigene Einschätzung — greife sie in der",
    "Begründung auf.",
    "",
    kuerzen(notiz),
  ].join("\n");
}
