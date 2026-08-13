import { loadJobs } from "../storage.js";
import { requireProfile, sortTriageQueue, triageJob } from "./agent.js";
import { ensureEnv } from "./env.js";
import { GeminiError, usageSummaryText } from "./gemini.js";
import { publishDocs } from "./publish.js";
import { getEntry, hasChat, loadBoard, setStatus } from "./store.js";
import { BOARD_STATUSES, type BoardStatus } from "./types.js";

/**
 * Headless-Variante des KI-Agenten für GitHub Actions (oder lokal ohne UI):
 *
 *   yarn agent [--limit=200] [--minuten=30]
 *
 * 1. Wendet Änderungen aus dem Browser an (Umgebungsvariable AENDERUNGEN —
 *    das JSON, das die GitHub-Pages-Seite über "Änderungen kopieren" liefert):
 *    [{"jobId":"bka:T-2026-54","status":"beworben"}, …] → vonKi=false
 * 2. Triagiert unbearbeitete Jobs mit Gemini, bis --limit Jobs bearbeitet
 *    sind ODER --minuten Zeit vergangen ist — je nachdem, was zuerst greift
 *    (0 = jeweils unbeschränkt). Bereits Geschaffte bleibt bei Abbruch
 *    erhalten; der nächste Lauf macht dort weiter.
 * 3. Schreibt die JSON-Daten für die GitHub-Pages-Seite nach docs/.
 *
 * Der Workflow committet danach data/agent/ und docs/ zurück ins Repo.
 */

function parseNumberArg(argv: string[], name: string, fallback: number): number {
  for (const arg of argv) {
    if (arg.startsWith(`--${name}=`)) {
      const value = Number(arg.slice(name.length + 3));
      if (Number.isFinite(value) && value >= 0) return Math.floor(value);
    }
  }
  return fallback;
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
  const argv = process.argv.slice(2);
  const limit = parseNumberArg(argv, "limit", 200);
  const minuten = parseNumberArg(argv, "minuten", 30);
  const deadline = minuten > 0 ? Date.now() + minuten * 60_000 : Infinity;
  const env = await ensureEnv({ interactive: process.stdin.isTTY === true });
  const jobs = loadJobs();
  console.log(
    `${jobs.length} Jobs in data/jobs.json, Modell: ${env.geminiModel}, ` +
      `${env.geminiApiKeys.length} API-Key(s), ` +
      `Limit: ${limit || "∞"} Jobs / ${minuten || "∞"} Minuten`,
  );

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
  // Sortiert abarbeiten: öffentliche Arbeitgeber zuerst, innerhalb nach Frist,
  // Jobs ohne Gehaltsangabe ganz hinten (siehe sortTriageQueue)
  const open = sortTriageQueue(
    jobs.filter((job) => {
      const entry = getEntry(board, job.id);
      return (!entry || entry.status === "todo") && !hasChat(job.id);
    }),
  );
  const queue = limit > 0 ? open.slice(0, limit) : open;
  console.log(`${queue.length} von ${open.length} unbearbeiteten Jobs werden triagiert …`);

  let done = 0;
  let failed = 0;
  for (const job of queue) {
    if (Date.now() >= deadline) {
      console.log(`  ⏱ Zeitlimit von ${minuten} Minuten erreicht — Lauf endet sauber.`);
      break;
    }
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
      // Dauerhafte Fehler (ungültiger Key, Kontingent aller Keys erschöpft —
      // 429 wird erst geworfen, nachdem Key-Wechsel und Warten nichts gebracht
      // haben): abbrechen — der nächste Lauf macht dort weiter
      if (err instanceof GeminiError && err.status && err.status < 500) {
        console.error("  ✂ Lauf abgebrochen (dauerhafter API-Fehler bzw. Kontingent erschöpft).");
        break;
      }
    }
    if (done + failed < queue.length) {
      await new Promise((resolve) => setTimeout(resolve, env.agentDelayMs));
    }
  }

  publishDocs(jobs);
  console.log(`\n✔ Triage: ${done} bearbeitet, ${failed} fehlgeschlagen.`);
  console.log(usageSummaryText(env));
  console.log("✔ docs/ (GitHub-Pages-Daten) aktualisiert.");
  if (queue.length > 0 && done === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
