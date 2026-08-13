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

function triagePrompt(job: JobOffer): string {
  return [
    "Hier ist ein Stellenangebot (kompletter Seitentext). Entscheide, ob sich ein",
    "genauerer Blick für den Nutzer lohnt, und bewerte es strukturiert mit Punkten.",
    "",
    "Antworte NUR mit einem JSON-Objekt in genau dieser Form:",
    "{",
    '  "entscheidung": "interessant" | "archivieren",',
    '  "punkte": {',
    '    "entfernung": 0-10,',
    '    "homeoffice": 0-10,',
    '    "gehalt": 0-10,',
    '    "arbeitszeit": 0-10,',
    '    "verbeamtung": 0-10,',
    '    "gesamt": 0-10',
    "  },",
    '  "begruendung": "1-3 Sätze"',
    "}",
    "",
    '- "interessant": passt zum Profil, der Nutzer sollte es sich anschauen',
    '- "archivieren": passt nicht (z.B. falsche Fachrichtung, falscher Ort, Anforderungen unerfüllbar)',
    '- "entfernung": Nähe des Dienstorts zum Wohn-/Wunschort des Nutzers (10 = vor Ort oder dank Remote egal, 0 = unerreichbar weit weg)',
    '- "homeoffice": Homeoffice-/Remote-Möglichkeiten (10 = voll remote möglich, 0 = keine/unbekannt)',
    '- "gehalt": Gehalt im Verhältnis zu den Wünschen des Nutzers (0 = keine Angabe im Angebot oder viel zu niedrig)',
    '- "arbeitszeit": Passung Vollzeit/Teilzeit zu den Wünschen des Nutzers',
    '- "verbeamtung": Möglichkeit der Verbeamtung (10 = ja, 0 = nein/unbekannt)',
    '- "gesamt": Gesamtbewertung, wie gut das Angebot insgesamt passt (0 = gar nicht, 10 = perfekt) — gewichte die Kriterien nach den Wünschen aus dem Profil',
    "",
    jobToRawText(job),
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
    const parsed = JSON.parse(match[0]) as { entscheidung?: string; punkte?: unknown; begruendung?: unknown };
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

/** Triagiert EIN Angebot: Prompt senden, Antwort parsen, Board + Chat speichern. */
export async function triageJob(env: ServerEnv, profile: string, job: JobOffer): Promise<void> {
  saveJobSnapshot(job);
  const prompt = triagePrompt(job);
  const answer = await generateContent(env, {
    system: systemPrompt(profile),
    messages: [{ role: "user", text: prompt }],
    json: true,
  });

  const chat: ChatMessage[] = [
    { role: "user", content: prompt, at: now(), kind: "triage" },
    { role: "model", content: answer, at: now(), kind: "triage" },
  ];
  appendChat(job.id, chat);

  const result = parseTriage(answer);
  if (!result) {
    throw new Error(`Antwort der KI nicht als Triage-JSON lesbar: ${answer.slice(0, 200)}`);
  }
  setStatus(job.id, result.entscheidung === "interessant" ? "interessant" : "archiviert", true, {
    punkte: result.punkte,
    punkteDetails: result.punkteDetails,
    begruendung: result.begruendung,
  });
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
  status.lastError = undefined;
  status.finishedAt = undefined;
  stopRequested = false;

  void (async () => {
    for (const job of queue) {
      if (stopRequested) break;
      status.currentJobId = job.id;
      status.currentTitel = job.titel;
      try {
        await triageJob(env, profile, job);
      } catch (error) {
        status.lastError = `${job.titel}: ${error instanceof Error ? error.message : error}`;
        console.error(`⚠ Triage fehlgeschlagen für ${job.id}: ${status.lastError}`);
        // Dauerhafte Fehler (ungültiger Key, falsches Modell) und erschöpftes
        // Kontingent aller Keys (429 wird erst geworfen, nachdem Key-Wechsel
        // und Warten nichts gebracht haben): Lauf abbrechen statt jeden
        // weiteren Job in denselben Fehler laufen zu lassen
        if (error instanceof GeminiError && error.status && error.status < 500) {
          break;
        }
      }
      status.processed++;
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
