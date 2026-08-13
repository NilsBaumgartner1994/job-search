import { loadJobs } from "../storage.js";
import { requireProfile, triageJob } from "./agent.js";
import { ensureEnv } from "./env.js";
import { GeminiError } from "./gemini.js";
import { publishDocs } from "./publish.js";
import { getEntry, hasChat, loadBoard, setStatus } from "./store.js";
import { BOARD_STATUSES, type BoardStatus } from "./types.js";

/**
 * Headless-Variante des KI-Agenten für GitHub Actions (oder lokal ohne UI):
 *
 *   yarn agent [--limit=200]
 *
 * 1. Wendet Änderungen aus dem Browser an (Umgebungsvariable AENDERUNGEN —
 *    das JSON, das die GitHub-Pages-Seite über "Änderungen kopieren" liefert):
 *    [{"jobId":"bka:T-2026-54","status":"beworben"}, …] → vonKi=false
 * 2. Triagiert bis zu --limit unbearbeitete Jobs mit Gemini (Gratis-Kontingent:
 *    das Tageslimit liegt bei ein paar hundert Anfragen, daher das Limit).
 * 3. Schreibt die JSON-Daten für die GitHub-Pages-Seite nach docs/.
 *
 * Der Workflow committet danach data/agent/ und docs/ zurück ins Repo.
 */

function parseLimit(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const limit = Number(arg.slice("--limit=".length));
      if (Number.isFinite(limit) && limit >= 0) return Math.floor(limit);
    }
  }
  return 200;
}

interface ChangeInput {
  jobId?: string;
  status?: string;
}

function applyChanges(raw: string, knownIds: Set<string>): void {
  let changes: ChangeInput[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    changes = Array.isArray(parsed) ? (parsed as ChangeInput[]) : [];
  } catch {
    console.error(`⚠ AENDERUNGEN ist kein gültiges JSON — übersprungen: ${raw.slice(0, 200)}`);
    return;
  }
  let applied = 0;
  for (const change of changes) {
    const jobId = String(change.jobId ?? "");
    const status = change.status as BoardStatus;
    if (!BOARD_STATUSES.includes(status)) {
      console.error(`⚠ Änderung mit ungültigem Status übersprungen: ${JSON.stringify(change)}`);
      continue;
    }
    if (!knownIds.has(jobId)) {
      console.error(`⚠ Änderung für unbekannten Job übersprungen: ${jobId}`);
      continue;
    }
    setStatus(jobId, status, false);
    applied++;
  }
  console.log(`✔ ${applied} Änderung(en) aus dem Browser übernommen (vonKi=false).`);
}

async function main(): Promise<void> {
  const limit = parseLimit(process.argv.slice(2));
  const env = await ensureEnv({ interactive: process.stdin.isTTY === true });
  const jobs = loadJobs();
  console.log(`${jobs.length} Jobs in data/jobs.json, Modell: ${env.geminiModel}, Limit: ${limit}`);

  const changesRaw = process.env.AENDERUNGEN?.trim();
  if (changesRaw) {
    applyChanges(changesRaw, new Set(jobs.map((job) => job.id)));
  }

  const { profile, error } = requireProfile();
  if (!profile) {
    // Ohne Profil trotzdem Änderungen übernehmen + Pages-Daten schreiben
    console.error(`⚠ Keine Triage möglich: ${error}`);
    publishDocs(jobs);
    console.log("✔ docs/ (GitHub-Pages-Daten) aktualisiert.");
    process.exitCode = changesRaw ? 0 : 1;
    return;
  }

  const board = loadBoard();
  const queue = jobs
    .filter((job) => {
      const entry = getEntry(board, job.id);
      return (!entry || entry.status === "todo") && !hasChat(job.id);
    })
    .slice(0, limit);
  console.log(`${queue.length} unbearbeitete Jobs werden triagiert …`);

  let done = 0;
  let failed = 0;
  for (const job of queue) {
    try {
      await triageJob(env, profile, job);
      done++;
      const entry = getEntry(loadBoard(), job.id);
      console.log(
        `  [${done + failed}/${queue.length}] ${entry?.status === "interessant" ? "⭐" : "🗄"} ` +
          `${entry?.punkte ?? "?"}/10  ${job.titel}`,
      );
    } catch (err) {
      failed++;
      console.error(`  ⚠ ${job.titel}: ${err instanceof Error ? err.message : err}`);
      // Dauerhafte Fehler (ungültiger Key, Tageskontingent aufgebraucht, …):
      // abbrechen — der nächste Lauf macht dort weiter, wo dieser aufhörte
      if (err instanceof GeminiError && err.status && err.status < 500 && err.status !== 429) {
        console.error("  ✂ Lauf abgebrochen (dauerhafter API-Fehler).");
        break;
      }
    }
    if (done + failed < queue.length) {
      await new Promise((resolve) => setTimeout(resolve, env.agentDelayMs));
    }
  }

  publishDocs(jobs);
  console.log(`\n✔ Triage: ${done} bearbeitet, ${failed} fehlgeschlagen.`);
  console.log("✔ docs/ (GitHub-Pages-Daten) aktualisiert.");
  if (queue.length > 0 && done === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
