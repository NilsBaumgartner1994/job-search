import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobOffer } from "../types.js";
import { hasChat, loadBoard, loadChat, safeDirName } from "./store.js";

/**
 * Generiert die statischen JSON-Daten für die GitHub-Pages-Seite (docs/):
 *
 *   docs/index.html          die mobile Kanban-Seite (statisch, liegt im Git)
 *   docs/data.json           kompakte Job-Liste + komplettes Board
 *   docs/jobs/<id>.json      pro Job: alle Details + Chat-Verlauf (bei Klick geladen)
 *
 * Die Seite lädt data.json beim Öffnen und die (vielen, kleinen) Detail-
 * Dateien erst beim Antippen einer Karte — wichtig für mobile Geräte.
 */
export const DOCS_DIR = join(process.cwd(), "docs");
const DOCS_JOBS_DIR = join(DOCS_DIR, "jobs");

/** Kompakte Job-Daten für die Karten des Boards (ohne Beschreibung/Rohdaten). */
export function lightJob(job: JobOffer) {
  return {
    id: job.id,
    adapter: job.adapter,
    titel: job.titel,
    employer: job.employer,
    link: job.link,
    dienstorte: job.dienstorte,
    gehalt: job.gehalt,
    gehaltsstufe: job.gehaltsstufe,
    bewerbungsfrist: job.bewerbungsfrist,
    befristung: job.befristung,
    arbeitszeit: job.arbeitszeit,
    homeoffice: job.homeoffice,
    hasChat: hasChat(job.id),
  };
}

export function publishDocs(jobs: JobOffer[]): void {
  mkdirSync(DOCS_DIR, { recursive: true });

  const data = {
    generatedAt: new Date().toISOString(),
    jobs: jobs.map(lightJob),
    board: loadBoard(),
  };
  writeFileSync(join(DOCS_DIR, "data.json"), JSON.stringify(data) + "\n", "utf8");

  // Detail-Dateien komplett neu schreiben, damit entfernte Jobs verschwinden
  rmSync(DOCS_JOBS_DIR, { recursive: true, force: true });
  mkdirSync(DOCS_JOBS_DIR, { recursive: true });
  for (const job of jobs) {
    const { raw: _raw, ...detail } = job;
    const payload = { job: detail, chat: loadChat(job.id) };
    writeFileSync(
      join(DOCS_JOBS_DIR, `${safeDirName(job.id)}.json`),
      JSON.stringify(payload) + "\n",
      "utf8",
    );
  }
}
