import type { ServerEnv } from "./env.js";

export interface GeminiMessage {
  role: "user" | "model";
  text: string;
}

interface GenerateOptions {
  /** Systemanweisung (Profil, Rolle des Agenten) */
  system?: string;
  messages: GeminiMessage[];
  /** true → Antwort als JSON erzwingen (responseMimeType application/json) */
  json?: boolean;
}

/** Fehler mit HTTP-Status, damit der Aufrufer 429 etc. unterscheiden kann. */
export class GeminiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

const MAX_TRIES = 5;

/**
 * Ruft die Gemini-REST-API (generateContent) auf. Bei Rate-Limit (429) und
 * Serverfehlern (5xx) wird mit exponentiellem Backoff neu versucht — das
 * Gratis-Kontingent drosselt auf wenige Anfragen pro Minute.
 */
export async function generateContent(env: ServerEnv, options: GenerateOptions): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(env.geminiModel)}:generateContent`;

  const body: Record<string, unknown> = {
    contents: options.messages.map((message) => ({
      role: message.role,
      parts: [{ text: message.text }],
    })),
  };
  if (options.system) {
    body.systemInstruction = { parts: [{ text: options.system }] };
  }
  if (options.json) {
    body.generationConfig = { responseMimeType: "application/json" };
  }

  let lastError: GeminiError | undefined;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.geminiApiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = new GeminiError(`Netzwerkfehler: ${error}`);
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) {
      const data = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        promptFeedback?: { blockReason?: string };
      };
      const text = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!text) {
        const reason = data.promptFeedback?.blockReason ?? "leere Antwort";
        throw new GeminiError(`Gemini lieferte keinen Text (${reason})`);
      }
      return text;
    }

    const errorText = (await response.text()).slice(0, 500);
    const hint =
      response.status === 404
        ? `\n→ Das Modell "${env.geminiModel}" ist nicht (mehr) verfügbar. Anderes ` +
          `Modell über GEMINI_MODEL wählen (.env bzw. Repo-Variable in GitHub), ` +
          `z.B. "gemini-flash-latest" — der Alias zeigt immer auf das aktuelle Flash-Modell.`
        : "";
    lastError = new GeminiError(
      `Gemini-API ${response.status}: ${errorText}${hint}`,
      response.status,
    );
    // 429 (Rate-Limit) und 5xx sind transient → warten und neu versuchen
    if (response.status === 429 || response.status >= 500) {
      await sleep(backoffMs(attempt, response.headers.get("retry-after")));
      continue;
    }
    // 400/401/403 etc. sind dauerhaft (falscher Key, falsches Modell, …)
    throw lastError;
  }
  throw lastError ?? new GeminiError("Gemini-Aufruf fehlgeschlagen");
}

function backoffMs(attempt: number, retryAfterHeader?: string | null): number {
  const retryAfter = Number(retryAfterHeader);
  if (retryAfterHeader && Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return Math.min(60_000, 5_000 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
