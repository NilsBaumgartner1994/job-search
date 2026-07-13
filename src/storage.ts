import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JobOffer } from "./types.js";

export const DATA_FILE = join(process.cwd(), "data", "jobs.json");

interface JobsFile {
  updatedAt: string;
  jobs: JobOffer[];
}

export function loadJobs(): JobOffer[] {
  if (!existsSync(DATA_FILE)) return [];
  const parsed = JSON.parse(readFileSync(DATA_FILE, "utf8")) as JobsFile;
  return parsed.jobs ?? [];
}

export function saveJobs(jobs: JobOffer[]): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  const sorted = [...jobs].sort((a, b) => a.id.localeCompare(b.id));
  const file: JobsFile = { updatedAt: new Date().toISOString(), jobs: sorted };
  writeFileSync(DATA_FILE, JSON.stringify(file, null, 2) + "\n", "utf8");
}

/**
 * Mischt frisch gescrapte Angebote in den Bestand:
 * - bekannte Jobs behalten ihr firstSeen und bekommen ein neues lastSeen
 * - Jobs, die beim aktuellen Lauf nicht (mehr) auftauchen, bleiben erhalten
 *   (erkennbar am älteren lastSeen), bis ihre Bewerbungsfrist abläuft
 */
export function mergeJobs(existing: JobOffer[], fresh: JobOffer[]): JobOffer[] {
  const byId = new Map(existing.map((job) => [job.id, job]));
  for (const job of fresh) {
    const known = byId.get(job.id);
    byId.set(job.id, known ? { ...job, firstSeen: known.firstSeen } : job);
  }
  return [...byId.values()];
}

/** Entfernt Jobs, deren Bewerbungsfrist abgelaufen ist. */
export function pruneExpired(jobs: JobOffer[], today = new Date()): { kept: JobOffer[]; removed: JobOffer[] } {
  const todayIso = today.toISOString().slice(0, 10);
  const kept: JobOffer[] = [];
  const removed: JobOffer[] = [];
  for (const job of jobs) {
    if (job.bewerbungsfrist && job.bewerbungsfrist < todayIso) {
      removed.push(job);
    } else {
      kept.push(job);
    }
  }
  return { kept, removed };
}
