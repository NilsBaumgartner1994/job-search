import type { JobOffer } from "../types.js";
import type { ServerEnv } from "./env.js";
import { GeminiError, generateContent, type GeminiMessage } from "./gemini.js";
import {
  appendChat,
  hasChat,
  loadBoard,
  loadChat,
  loadProfile,
  getEntry,
  saveJobSnapshot,
  setStatus,
} from "./store.js";
import { jobToRawText } from "./text.js";
import type { AgentStatus, ChatMessage, TriageResult, TriageScores } from "./types.js";

const status: AgentStatus = { running: false, processed: 0, total: 0 };
let stopRequested = false;

export function getAgentStatus(): AgentStatus {
  return { ...status };
}

export function stopAgent(): void {
  stopRequested = true;
}

function systemPrompt(profile: string): string {
  return [
    "Du bist ein persönlicher Job-Assistent. Du hilfst dem Nutzer, Stellenangebote",
    "vorzusortieren: Lohnt es sich für ihn, das Angebot genauer anzuschauen, oder",
    "kann es archiviert werden? Sei streng, aber verwerfe nichts vorschnell, das",
    "gut zum Profil passen könnte. Antworte auf Deutsch.",
    "",
    "=== Profil und Wünsche des Nutzers ===",
    profile.trim(),
  ].join("\n");
}

/** Form des "punkte"-Objekts — in Einzel- und Sammel-Prompt identisch. */
const PUNKTE_FORM = [
  '"punkte": {',
  '  "entfernung": 0-10,',
  '  "homeoffice": 0-10,',
  '  "gehalt": 0-10,',
  '  "arbeitszeit": 0-10,',
  '  "verbeamtung": 0-10,',
  '  "gesamt": 0-10',
  "},",
];

/** Erklärung der Entscheidung und der einzelnen Punkte-Kriterien. */
const KRITERIEN = [
  '- "interessant": passt zum Profil, der Nutzer sollte es sich anschauen',
  '- "archivieren": passt nicht (z.B. falsche Fachrichtung, falscher Ort, Anforderungen unerfüllbar)',
  '- "entfernung": Nähe des Dienstorts zum Wohn-/Wunschort des Nutzers (10 = vor Ort oder dank Remote egal, 0 = unerreichbar weit weg)',
  '- "homeoffice": Homeoffice-/Remote-Möglichkeiten (10 = voll remote möglich, 0 = keine/unbekannt)',
  '- "gehalt": Gehalt im Verhältnis zu den Wünschen des Nutzers (0 = keine Angabe im Angebot oder viel zu niedrig)',
  '- "arbeitszeit": Passung Vollzeit/Teilzeit zu den Wünschen des Nutzers',
  '- "verbeamtung": Möglichkeit der Verbeamtung (10 = ja, 0 = nein/unbekannt)',
  '- "gesamt": Gesamtbewertung, wie gut das Angebot insgesamt passt (0 = gar nicht, 10 = perfekt) — gewichte die Kriterien nach den Wünschen aus dem Profil',
];

function indent(lines: string[], prefix: string): string[] {
  return lines.map((line) => prefix + line);
}

function triagePrompt(job: JobOffer): string {
  return [
    "Hier ist ein Stellenangebot (kompletter Seitentext). Entscheide, ob sich ein",
    "genauerer Blick für den Nutzer lohnt, und bewerte es strukturiert mit Punkten.",
    "",
    "Antworte NUR mit einem JSON-Objekt in genau dieser Form:",
    "{",
    '  "entscheidung": "interessant" | "archivieren",',
    ...indent(PUNKTE_FORM, "  "),
    '  "begruendung": "1-3 Sätze"',
    "}",
    "",
    ...KRITERIEN,
    "",
    jobToRawText(job),
  ].join("\n");
}

/**
 * Prompt für eine Sammel-Anfrage: mehrere Angebote in EINER Anfrage, Antwort
 * als JSON-Array. Das Gratis-Kontingent begrenzt die Zahl der *Anfragen* pro
 * Tag — mit zwei Angeboten je Anfrage verdoppelt sich also die Zahl der
 * Angebote, die pro Tag abgearbeitet werden können.
 */
function batchTriagePrompt(jobs: JobOffer[], maxCharsPerJob: number): string {
  const count = jobs.length;
  return [
    `Hier sind ${count} Stellenangebote (jeweils kompletter Seitentext).`,
    "Bewerte JEDES Angebot einzeln und unabhängig von den anderen — vergleiche",
    "sie nicht miteinander, sondern jeweils nur mit dem Profil des Nutzers.",
    "Entscheide je Angebot, ob sich ein genauerer Blick lohnt, und bewerte es",
    "strukturiert mit Punkten.",
    "",
    `Antworte NUR mit einem JSON-Array mit genau ${count} Objekten — eines je`,
    "Angebot, in derselben Reihenfolge wie unten, jeweils in dieser Form:",
    "[",
    "  {",
    '    "nr": 1,',
    '    "entscheidung": "interessant" | "archivieren",',
    ...indent(PUNKTE_FORM, "    "),
    '    "begruendung": "1-3 Sätze"',
    "  }",
    "]",
    "",
    `- "nr": Nummer des Angebots (1 bis ${count}), genau wie in der Überschrift`,
    "  des jeweiligen Angebots — damit die Bewertungen zugeordnet werden können",
    ...KRITERIEN,
    "",
    ...jobs.flatMap((job, index) => [
      `=== ANGEBOT ${index + 1} von ${count} ===`,
      jobToRawText(job, maxCharsPerJob),
      "",
    ]),
  ].join("\n");
}

function clampScore(value: unknown): number {
  return Math.max(0, Math.min(10, Number(value) || 0));
}

function parseTriage(text: string): TriageResult | undefined {
  try {
    // zur Sicherheit auch ```json-Zäune und umgebenden Text tolerieren
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    return triageFromObject(JSON.parse(match[0]));
  } catch {
    return undefined;
  }
}

/** Wandelt ein einzelnes Antwort-Objekt der KI in ein TriageResult. */
function triageFromObject(value: unknown): TriageResult | undefined {
  try {
    if (!value || typeof value !== "object") return undefined;
    const parsed = value as { entscheidung?: string; punkte?: unknown; begruendung?: unknown };
    if (parsed.entscheidung !== "interessant" && parsed.entscheidung !== "archivieren") {
      return undefined;
    }
    // "punkte" ist entweder das neue Objekt mit Einzelbewertungen oder (altes Format) eine Zahl
    let punkte: number;
    let punkteDetails: TriageScores | undefined;
    if (parsed.punkte && typeof parsed.punkte === "object") {
      const p = parsed.punkte as Record<string, unknown>;
      punkteDetails = {
        entfernung: clampScore(p.entfernung),
        homeoffice: clampScore(p.homeoffice),
        gehalt: clampScore(p.gehalt),
        arbeitszeit: clampScore(p.arbeitszeit),
        verbeamtung: clampScore(p.verbeamtung),
        gesamt: clampScore(p.gesamt),
      };
      punkte = punkteDetails.gesamt;
    } else {
      punkte = clampScore(parsed.punkte);
    }
    return {
      entscheidung: parsed.entscheidung,
      punkte,
      punkteDetails,
      begruendung: String(parsed.begruendung ?? "").trim(),
    };
  } catch {
    return undefined;
  }
}

/**
 * Zerlegt die Antwort einer Sammel-Anfrage in `count` Ergebnisse. Zugeordnet
 * wird über das Feld "nr" (1-basiert), sonst über die Position im Array.
 * Fehlende oder unbrauchbare Einträge bleiben `undefined` — die betroffenen
 * Angebote werden anschließend einzeln nachgefragt.
 */
function parseTriageBatch(text: string, count: number): (TriageResult | undefined)[] {
  const results: (TriageResult | undefined)[] = new Array(count).fill(undefined);
  let items: unknown;
  try {
    // auch hier Zäune/umgebenden Text tolerieren
    const match = text.match(/\[[\s\S]*\]/);
    items = JSON.parse(match ? match[0] : text);
  } catch {
    return results;
  }
  if (!Array.isArray(items)) return results;
  items.forEach((item, index) => {
    const nr = Number((item as { nr?: unknown } | null)?.nr);
    const slot = Number.isInteger(nr) && nr >= 1 && nr <= count ? nr - 1 : index;
    if (slot >= count || results[slot]) return;
    results[slot] = triageFromObject(item);
  });
  return results;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Prüft, ob ein brauchbares Profil hinterlegt ist (nicht leer, nicht mehr
 * die Platzhalter-Vorlage). Liefert den Profil-Text oder eine Fehlermeldung.
 */
export function requireProfile(): { profile?: string; error?: string } {
  const profile = loadProfile().trim();
  if (!profile) {
    return { error: "Kein Profil hinterlegt (data/agent/profil.md ist leer)." };
  }
  if (profile.includes("BITTE AUSFÜLLEN")) {
    return {
      error:
        "data/agent/profil.md enthält noch die Vorlage — bitte durch dein " +
        "eigenes Profil ersetzen (Studium, Wünsche, No-Gos, …).",
    };
  }
  return { profile };
}

/** Speichert Chat-Verlauf und Board-Eintrag eines triagierten Angebots. */
function saveTriage(job: JobOffer, prompt: string, answer: string, result: TriageResult): void {
  const chat: ChatMessage[] = [
    { role: "user", content: prompt, at: now(), kind: "triage" },
    { role: "model", content: answer, at: now(), kind: "triage" },
  ];
  appendChat(job.id, chat);
  setStatus(job.id, result.entscheidung === "interessant" ? "interessant" : "archiviert", true, {
    punkte: result.punkte,
    punkteDetails: result.punkteDetails,
    begruendung: result.begruendung,
  });
}

/** Triagiert EIN Angebot: Prompt senden, Antwort parsen, Board + Chat speichern. */
export async function triageJob(env: ServerEnv, profile: string, job: JobOffer): Promise<void> {
  saveJobSnapshot(job);
  const prompt = triagePrompt(job);
  const answer = await generateContent(env, {
    system: systemPrompt(profile),
    messages: [{ role: "user", text: prompt }],
    json: true,
  });

  const result = parseTriage(answer);
  if (!result) {
    // Antwort trotzdem im Verlauf sichern, damit nachvollziehbar bleibt, was kam
    appendChat(job.id, [
      { role: "user", content: prompt, at: now(), kind: "triage" },
      { role: "model", content: answer, at: now(), kind: "triage" },
    ]);
    throw new Error(`Antwort der KI nicht als Triage-JSON lesbar: ${answer.slice(0, 200)}`);
  }
  saveTriage(job, prompt, answer, result);
}

/** Gesamt-Budget an Zeichen Angebotstext für EINE Sammel-Anfrage. */
const BATCH_CHAR_BUDGET = 160_000;

/** Ergebnis der Triage eines einzelnen Angebots innerhalb eines Stapels. */
export interface TriageOutcome {
  job: JobOffer;
  ok: boolean;
  /** Fehlermeldung, falls dieses Angebot nicht bewertet werden konnte */
  error?: string;
}

/**
 * Triagiert einen Stapel Angebote mit EINER Gemini-Anfrage (Sammel-Triage).
 *
 * Das Gratis-Kontingent begrenzt die Zahl der Anfragen pro Tag, nicht die Zahl
 * der bewerteten Angebote — zwei Angebote je Anfrage verdoppeln also den
 * Tagesdurchsatz. Angebote, für die die Antwort keine brauchbare Bewertung
 * enthält, werden anschließend einzeln nachgefragt, damit durch das Bündeln
 * nichts verloren geht.
 *
 * Im Chat-Verlauf steht pro Angebot weiterhin nur dessen eigene Anfrage und
 * dessen eigene Bewertung (mit Hinweis auf die Sammel-Anfrage) — so bleiben
 * Detail-Ansicht und Folgefragen unverändert übersichtlich.
 */
export async function triageJobs(
  env: ServerEnv,
  profile: string,
  jobs: JobOffer[],
): Promise<TriageOutcome[]> {
  if (jobs.length === 0) return [];
  if (jobs.length === 1) {
    try {
      await triageJob(env, profile, jobs[0]);
      return [{ job: jobs[0], ok: true }];
    } catch (error) {
      if (error instanceof GeminiError) throw error;
      return [{ job: jobs[0], ok: false, error: message(error) }];
    }
  }

  for (const job of jobs) saveJobSnapshot(job);
  const maxCharsPerJob = Math.max(20_000, Math.floor(BATCH_CHAR_BUDGET / jobs.length));
  const answer = await generateContent(env, {
    system: systemPrompt(profile),
    messages: [{ role: "user", text: batchTriagePrompt(jobs, maxCharsPerJob) }],
    json: true,
  });

  const results = parseTriageBatch(answer, jobs.length);
  const outcomes: TriageOutcome[] = [];
  const nachzuholen: JobOffer[] = [];
  jobs.forEach((job, index) => {
    const result = results[index];
    if (!result) {
      nachzuholen.push(job);
      return;
    }
    const hinweis =
      `[Sammel-Anfrage: dieses Angebot wurde zusammen mit ${jobs.length - 1} weiteren ` +
      `in einer Anfrage bewertet.]`;
    // Im Verlauf steht die Bewertung im selben Format wie bei einer Einzelanfrage
    const antwort = JSON.stringify(
      {
        entscheidung: result.entscheidung,
        punkte: result.punkteDetails ?? result.punkte,
        begruendung: result.begruendung,
      },
      null,
      2,
    );
    saveTriage(job, `${hinweis}\n\n${triagePrompt(job)}`, antwort, result);
    outcomes.push({ job, ok: true });
  });

  // Was die Sammel-Antwort nicht abgedeckt hat, einzeln nachfragen
  for (const job of nachzuholen) {
    console.error(`  ↻ Keine Bewertung in der Sammel-Antwort für „${job.titel}“ — frage einzeln nach.`);
    try {
      await triageJob(env, profile, job);
      outcomes.push({ job, ok: true });
    } catch (error) {
      // Kontingent erschöpft / dauerhafter API-Fehler → nach oben durchreichen,
      // damit der Lauf sauber abbricht statt weiterzurennen
      if (error instanceof GeminiError && error.status && error.status < 500) throw error;
      outcomes.push({ job, ok: false, error: message(error) });
    }
  }

  // Reihenfolge des Stapels beibehalten (Nachzügler wurden hinten angehängt)
  const byId = new Map(outcomes.map((outcome) => [outcome.job.id, outcome]));
  return jobs.map((job) => byId.get(job.id) ?? { job, ok: false, error: "unbekannter Fehler" });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Teilt eine Liste in Stapel fester Größe (letzter Stapel ggf. kleiner). */
export function chunk<T>(items: T[], size: number): T[][] {
  const groesse = Math.max(1, Math.floor(size));
  const stapel: T[][] = [];
  for (let index = 0; index < items.length; index += groesse) {
    stapel.push(items.slice(index, index + groesse));
  }
  return stapel;
}

/** Adapter, hinter denen kein öffentlicher Arbeitgeber steht — deren Jobs kommen ans Ende. */
const PRIVATE_ADAPTERS = new Set(["accenture"]);

function hasSalaryInfo(job: JobOffer): boolean {
  return Boolean(job.gehalt?.trim() || job.gehaltsstufe?.trim());
}

/**
 * Reihenfolge, in der die KI die Jobs abarbeitet:
 *
 *   1. Jobs ohne jede Gehaltsangabe ganz nach hinten (damit lässt sich nichts anfangen)
 *   2. Öffentliche Arbeitgeber/Staat vor privaten (z.B. Accenture)
 *   3. Nach Arbeitgeber gruppiert (alphabetisch)
 *   4. Innerhalb eines Arbeitgebers: früheste Bewerbungsfrist zuerst,
 *      Jobs ohne Frist zuletzt
 */
export function sortTriageQueue(jobs: JobOffer[]): JobOffer[] {
  return [...jobs].sort((a, b) => {
    const salaryA = hasSalaryInfo(a) ? 0 : 1;
    const salaryB = hasSalaryInfo(b) ? 0 : 1;
    if (salaryA !== salaryB) return salaryA - salaryB;

    const publicA = PRIVATE_ADAPTERS.has(a.adapter) ? 1 : 0;
    const publicB = PRIVATE_ADAPTERS.has(b.adapter) ? 1 : 0;
    if (publicA !== publicB) return publicA - publicB;

    const employerA = (a.employer || a.adapter).toLowerCase();
    const employerB = (b.employer || b.adapter).toLowerCase();
    if (employerA !== employerB) return employerA.localeCompare(employerB, "de");

    return (a.bewerbungsfrist || "9999-12-31").localeCompare(b.bewerbungsfrist || "9999-12-31");
  });
}

/**
 * Startet den Agenten-Lauf im Hintergrund: alle Jobs in "Noch abzuarbeiten",
 * die noch keinen Chat-Verlauf haben, werden nacheinander der KI vorgelegt.
 * Zwischen den Anfragen wird pausiert (Rate-Limit des Gratis-Kontingents).
 */
export function startAgent(env: ServerEnv, jobs: JobOffer[]): { started: boolean; reason?: string } {
  if (status.running) return { started: false, reason: "Der Agent läuft bereits." };
  const { profile, error } = requireProfile();
  if (!profile) {
    return { started: false, reason: error };
  }

  const board = loadBoard();
  const queue = sortTriageQueue(
    jobs.filter((job) => {
      const entry = getEntry(board, job.id);
      const isTodo = !entry || entry.status === "todo";
      return isTodo && !hasChat(job.id);
    }),
  );
  if (queue.length === 0) {
    return { started: false, reason: "Keine unbearbeiteten Jobs in „Noch abzuarbeiten“." };
  }

  status.running = true;
  status.processed = 0;
  status.total = queue.length;
  status.batchSize = env.agentBatchSize;
  status.lastError = undefined;
  status.finishedAt = undefined;
  stopRequested = false;

  void (async () => {
    for (const stapel of chunk(queue, env.agentBatchSize)) {
      if (stopRequested) break;
      status.currentJobId = stapel[0].id;
      status.currentTitel = stapel.map((job) => job.titel).join(" · ");
      try {
        const outcomes = await triageJobs(env, profile, stapel);
        const gescheitert = outcomes.filter((outcome) => !outcome.ok);
        if (gescheitert.length) {
          status.lastError = gescheitert
            .map((outcome) => `${outcome.job.titel}: ${outcome.error}`)
            .join(" | ");
          console.error(`⚠ Triage fehlgeschlagen: ${status.lastError}`);
        }
      } catch (error) {
        status.lastError = `${status.currentTitel}: ${message(error)}`;
        console.error(`⚠ Triage fehlgeschlagen: ${status.lastError}`);
        // Dauerhafte Fehler (ungültiger Key, falsches Modell) und erschöpftes
        // Kontingent aller Keys (429 wird erst geworfen, nachdem Key-Wechsel
        // und Warten nichts gebracht haben): Lauf abbrechen statt jeden
        // weiteren Job in denselben Fehler laufen zu lassen
        if (error instanceof GeminiError && error.status && error.status < 500) {
          break;
        }
      }
      status.processed += stapel.length;
      if (!stopRequested && status.processed < status.total) {
        await new Promise((resolve) => setTimeout(resolve, env.agentDelayMs));
      }
    }
    status.running = false;
    status.currentJobId = undefined;
    status.currentTitel = undefined;
    status.finishedAt = now();
  })();

  return { started: true };
}

/**
 * Folgefrage zu einem Job im bestehenden Chat-Verlauf. Hat der Job noch keinen
 * Verlauf (z.B. nie triagiert), wird der komplette Seitentext als Kontext
 * vorangestellt, damit die KI weiß, worum es geht.
 */
export async function askAboutJob(
  env: ServerEnv,
  job: JobOffer,
  question: string,
): Promise<ChatMessage[]> {
  const profile = loadProfile().trim();
  const history = loadChat(job.id);

  const messages: GeminiMessage[] = [];
  if (history.length === 0) {
    messages.push({
      role: "user",
      text: `Hier ist ein Stellenangebot, zu dem ich Fragen habe:\n\n${jobToRawText(job)}`,
    });
    messages.push({ role: "model", text: "Verstanden — ich habe das Angebot gelesen. Was möchtest du wissen?" });
  } else {
    for (const message of history) {
      messages.push({ role: message.role, text: message.content });
    }
  }
  messages.push({ role: "user", text: question });

  const answer = await generateContent(env, {
    system: systemPrompt(profile || "(kein Profil hinterlegt)"),
    messages,
  });

  saveJobSnapshot(job);
  const added: ChatMessage[] = [];
  if (history.length === 0) {
    added.push(
      { role: "user", content: messages[0].text, at: now(), kind: "triage" },
      { role: "model", content: messages[1].text, at: now(), kind: "chat" },
    );
  }
  added.push(
    { role: "user", content: question, at: now(), kind: "chat" },
    { role: "model", content: answer, at: now(), kind: "chat" },
  );
  return appendChat(job.id, added);
}
