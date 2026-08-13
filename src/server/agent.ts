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
import type { AgentStatus, ChatMessage, TriageResult } from "./types.js";

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
    "genauerer Blick für den Nutzer lohnt.",
    "",
    "Antworte NUR mit einem JSON-Objekt in genau dieser Form:",
    '{ "entscheidung": "interessant" | "archivieren", "punkte": 0-10, "begruendung": "1-3 Sätze" }',
    "",
    '- "interessant": passt zum Profil, der Nutzer sollte es sich anschauen',
    '- "archivieren": passt nicht (z.B. falsche Fachrichtung, falscher Ort, Anforderungen unerfüllbar)',
    '- "punkte": wie gut es passt (0 = gar nicht, 10 = perfekt)',
    "",
    jobToRawText(job),
  ].join("\n");
}

function parseTriage(text: string): TriageResult | undefined {
  try {
    // zur Sicherheit auch ```json-Zäune und umgebenden Text tolerieren
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return undefined;
    const parsed = JSON.parse(match[0]) as Partial<TriageResult>;
    if (parsed.entscheidung !== "interessant" && parsed.entscheidung !== "archivieren") {
      return undefined;
    }
    return {
      entscheidung: parsed.entscheidung,
      punkte: Math.max(0, Math.min(10, Number(parsed.punkte) || 0)),
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
    begruendung: result.begruendung,
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
  const queue = jobs.filter((job) => {
    const entry = getEntry(board, job.id);
    const isTodo = !entry || entry.status === "todo";
    return isTodo && !hasChat(job.id);
  });
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
        // Dauerhafte Fehler (ungültiger Key, falsches Modell, kein Kontingent):
        // Lauf abbrechen statt jeden weiteren Job in denselben Fehler laufen zu lassen
        if (error instanceof GeminiError && error.status && error.status < 500 && error.status !== 429) {
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
