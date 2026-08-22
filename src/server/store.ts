import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JobOffer } from "../types.js";
import type { BoardEntry, BoardFile, BoardStatus, ChatMessage, TriageScores } from "./types.js";

/**
 * Alles rund um den KI-Agenten liegt lokal im Dateisystem unter data/agent/:
 *
 *   data/agent/board.json          Übersicht: Job-ID, Status, vonKi-Boolean
 *   data/agent/profil.md           Profil-Text des Nutzers (Wünsche, Studium, …)
 *   data/agent/jobs/<id>/job.json  Schnappschuss der Job-Informationen
 *   data/agent/jobs/<id>/chat.json Chat-Verlauf mit dem KI-Agenten
 */
export const AGENT_DIR = join(process.cwd(), "data", "agent");
export const BOARD_FILE = join(AGENT_DIR, "board.json");
export const PROFILE_FILE = join(AGENT_DIR, "profil.md");
const JOBS_DIR = join(AGENT_DIR, "jobs");

/** Job-IDs enthalten ":" u.ä. — als Ordnernamen unbrauchbar, daher ersetzen. */
export function safeDirName(jobId: string): string {
  return jobId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function jobDir(jobId: string): string {
  return join(JOBS_DIR, safeDirName(jobId));
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

// ---------- Board (Übersichtsdatei) ----------

export function loadBoard(): BoardFile {
  return readJson<BoardFile>(BOARD_FILE, { updatedAt: "", entries: [] });
}

export function saveBoard(board: BoardFile): void {
  board.updatedAt = new Date().toISOString();
  board.entries.sort((a, b) => a.jobId.localeCompare(b.jobId));
  writeJson(BOARD_FILE, board);
}

export function getEntry(board: BoardFile, jobId: string): BoardEntry | undefined {
  return board.entries.find((entry) => entry.jobId === jobId);
}

/** Setzt den Status eines Jobs und merkt sich, ob KI oder Mensch entschieden hat. */
export function setStatus(
  jobId: string,
  status: BoardStatus,
  vonKi: boolean,
  extra?: { punkte?: number; punkteDetails?: TriageScores; begruendung?: string; notiz?: string },
): BoardEntry {
  const board = loadBoard();
  let entry = getEntry(board, jobId);
  if (!entry) {
    entry = { jobId, status, vonKi, updatedAt: "" };
    board.entries.push(entry);
  }
  entry.status = status;
  entry.vonKi = vonKi;
  entry.updatedAt = new Date().toISOString();
  if (extra?.punkte !== undefined) entry.punkte = extra.punkte;
  if (extra?.punkteDetails !== undefined) entry.punkteDetails = extra.punkteDetails;
  if (extra?.begruendung !== undefined) entry.begruendung = extra.begruendung;
  if (extra?.notiz !== undefined) applyNote(entry, extra.notiz);
  saveBoard(board);
  return entry;
}

/** Schreibt die Notiz in den Eintrag; leerer Text löscht sie wieder. */
function applyNote(entry: BoardEntry, notiz: string): void {
  const text = notiz.trim();
  if (text) {
    entry.notiz = text;
    entry.notizAt = new Date().toISOString();
  } else {
    delete entry.notiz;
    delete entry.notizAt;
  }
}

/**
 * Setzt die Notiz des Nutzers zu einem Job — unabhängig vom Status, damit sich
 * auch ohne Spaltenwechsel festhalten lässt, warum ein Angebot wichtig ist.
 * Ein Job ohne Board-Eintrag bekommt dabei einen (Status "todo").
 */
export function setNote(jobId: string, notiz: string): BoardEntry {
  const board = loadBoard();
  let entry = getEntry(board, jobId);
  if (!entry) {
    entry = { jobId, status: "todo", vonKi: false, updatedAt: new Date().toISOString() };
    board.entries.push(entry);
  }
  applyNote(entry, notiz);
  saveBoard(board);
  return entry;
}

// ---------- Profil ----------

export function loadProfile(): string {
  if (!existsSync(PROFILE_FILE)) return "";
  return readFileSync(PROFILE_FILE, "utf8");
}

export function saveProfile(text: string): void {
  mkdirSync(AGENT_DIR, { recursive: true });
  writeFileSync(PROFILE_FILE, text, "utf8");
}

// ---------- Pro-Job-Dateien (Schnappschuss + Chat) ----------

/** Speichert die Job-Informationen (ohne die großen Rohdaten) im Job-Ordner. */
export function saveJobSnapshot(job: JobOffer): void {
  const dir = jobDir(job.id);
  mkdirSync(dir, { recursive: true });
  const { raw: _raw, ...snapshot } = job;
  writeJson(join(dir, "job.json"), snapshot);
}

/** Liest den Schnappschuss zurück — für Kontext (z.B. Titel) ohne data/jobs.json. */
export function loadJobSnapshot(jobId: string): Partial<JobOffer> | undefined {
  const path = join(jobDir(jobId), "job.json");
  if (!existsSync(path)) return undefined;
  return readJson<Partial<JobOffer> | undefined>(path, undefined);
}

export function loadChat(jobId: string): ChatMessage[] {
  return readJson<ChatMessage[]>(join(jobDir(jobId), "chat.json"), []);
}

export function appendChat(jobId: string, messages: ChatMessage[]): ChatMessage[] {
  const dir = jobDir(jobId);
  mkdirSync(dir, { recursive: true });
  const chat = loadChat(jobId).concat(messages);
  writeJson(join(dir, "chat.json"), chat);
  return chat;
}

export function hasChat(jobId: string): boolean {
  return existsSync(join(jobDir(jobId), "chat.json"));
}
