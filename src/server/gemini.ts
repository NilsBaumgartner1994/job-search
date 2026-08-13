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

/**
 * Details aus einer 429-Antwort (QuotaFailure/RetryInfo): welches Kontingent
 * erschöpft ist, warum, und wann ein neuer Versuch sinnvoll ist. Damit weiß
 * der Nutzer, wann er wieder anfragen kann und welches Limit gegriffen hat.
 */
export interface QuotaInfo {
  /** Menschlich lesbare Einordnung: "Minutenlimit", "Tageslimit" oder "Rate-Limit" */
  art: "Minutenlimit" | "Tageslimit" | "Rate-Limit";
  /** Wert des Limits, z.B. "20" */
  limit?: string;
  /** Betroffenes Modell, z.B. "gemini-3.6-flash" */
  model?: string;
  /** Metrik, z.B. "generativelanguage.googleapis.com/generate_content_free_tier_requests" */
  metric?: string;
  /** Quota-ID, z.B. "GenerateRequestsPerDayPerProjectPerModel-FreeTier" */
  quotaId?: string;
  /** Von Google empfohlene Wartezeit in Sekunden (RetryInfo) */
  retrySeconds?: number;
}

/** Fehler mit HTTP-Status (+ Quota-Details bei 429), damit der Aufrufer unterscheiden kann. */
export class GeminiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public quota?: QuotaInfo,
  ) {
    super(message);
  }
}

/** Lokale Nutzungs-Statistik pro API-Key (seit Prozess-/Lauf-Start). */
export interface KeyUsage {
  /** "Key 1 (…a1b2)" — Nummer + letzte 4 Zeichen; der volle Key bleibt geheim */
  label: string;
  /** erfolgreiche Anfragen */
  ok: number;
  /** fehlgeschlagene Anfragen (ohne 429) */
  fehler: number;
  /** wie oft dieser Key in ein Rate-Limit gelaufen ist */
  rateLimited: number;
  /** bis wann der Key wegen 429 pausiert ist (ISO), falls gerade gesperrt */
  gesperrtBis?: string;
  /** Details des zuletzt erreichten Limits */
  letztesLimit?: QuotaInfo & { um: string };
}

const MAX_TRIES_PER_KEY = 5;
/** Länger als so viele ms wird nicht gewartet — dann lieber mit klarer Meldung abbrechen. */
const MAX_WAIT_MS = 90_000;
/** Sperrzeit für einen Key, dessen Tageslimit erreicht ist (Reset erst um 09:00 dt. Zeit). */
const DAY_LIMIT_BLOCK_MS = 30 * 60_000;

interface KeyState {
  key: string;
  usage: KeyUsage;
  /** Zeitstempel (ms), bis zu dem der Key wegen 429 nicht benutzt wird */
  blockedUntil: number;
}

// Nutzungs-Statistik lebt pro Prozess — genug, um Lauf-Fortschritt und
// Limits zu erklären (eine echte "Usage-Abfrage" bietet die Gemini-API nicht;
// den offiziellen Stand zeigt https://ai.dev/rate-limit).
const keyStates = new Map<string, KeyState>();
let activeKeyIndex = 0;

function stateFor(keys: string[], index: number): KeyState {
  const key = keys[index];
  let state = keyStates.get(key);
  if (!state) {
    state = {
      key,
      usage: {
        label: `Key ${index + 1} (…${key.slice(-4)})`,
        ok: 0,
        fehler: 0,
        rateLimited: 0,
      },
      blockedUntil: 0,
    };
    keyStates.set(key, state);
  }
  return state;
}

/** Aktuelle Nutzungs-Statistik aller konfigurierten Keys (für UI/CLI). */
export function getGeminiUsage(env: ServerEnv): KeyUsage[] {
  const now = Date.now();
  return env.geminiApiKeys.map((_, index) => {
    const state = stateFor(env.geminiApiKeys, index);
    state.usage.gesperrtBis =
      state.blockedUntil > now ? new Date(state.blockedUntil).toISOString() : undefined;
    return { ...state.usage };
  });
}

/** Mehrzeilige, menschenlesbare Zusammenfassung der Nutzung (für CLI und Fehlermeldungen). */
export function usageSummaryText(env: ServerEnv): string {
  const lines = getGeminiUsage(env).map((usage) => {
    const parts = [`${usage.ok} ok`];
    if (usage.fehler) parts.push(`${usage.fehler} Fehler`);
    if (usage.rateLimited) parts.push(`${usage.rateLimited}× Limit`);
    if (usage.gesperrtBis) {
      parts.push(`gesperrt bis ${usage.gesperrtBis.slice(11, 19)} UTC`);
    }
    if (usage.letztesLimit) parts.push(quotaText(usage.letztesLimit));
    return `  ${usage.label}: ${parts.join(" · ")}`;
  });
  return ["Gemini-Nutzung in diesem Lauf (offizieller Stand: https://ai.dev/rate-limit):", ...lines].join(
    "\n",
  );
}

/** Kurzbeschreibung eines erreichten Limits: Art, Höhe, Modell, Wartezeit. */
export function quotaText(quota: QuotaInfo): string {
  const parts: string[] = [quota.art];
  if (quota.limit) parts.push(`${quota.limit} Anfragen`);
  if (quota.model) parts.push(quota.model);
  // Bei Tageslimits ist Googles retryDelay irreführend kurz — der Reset kommt
  // erst um Mitternacht kalifornischer Zeit (ca. 09:00 in Deutschland)
  if (quota.art === "Tageslimit") parts.push("Reset ca. 09:00 deutscher Zeit");
  else if (quota.retrySeconds) parts.push(`erneut in ~${Math.ceil(quota.retrySeconds)}s`);
  return parts.join(", ");
}

/**
 * Zieht die Quota-Details aus dem JSON-Body einer 429-Antwort
 * (google.rpc.QuotaFailure + RetryInfo; zur Sicherheit auch per Regex aus
 * dem Fehlertext, falls Google das Format ändert).
 */
function parseQuota(errorText: string): QuotaInfo {
  const quota: QuotaInfo = { art: "Rate-Limit" };
  try {
    const parsed = JSON.parse(errorText) as {
      error?: {
        message?: string;
        details?: {
          "@type"?: string;
          retryDelay?: string;
          violations?: {
            quotaMetric?: string;
            quotaId?: string;
            quotaValue?: string;
            quotaDimensions?: { model?: string };
          }[];
        }[];
      };
    };
    const message = parsed.error?.message ?? "";
    for (const detail of parsed.error?.details ?? []) {
      if (detail["@type"]?.endsWith("QuotaFailure") && detail.violations?.length) {
        const violation = detail.violations[0];
        quota.metric = violation.quotaMetric;
        quota.quotaId = violation.quotaId;
        quota.limit = violation.quotaValue;
        quota.model = violation.quotaDimensions?.model;
      }
      if (detail["@type"]?.endsWith("RetryInfo") && detail.retryDelay) {
        const seconds = Number(detail.retryDelay.replace(/s$/i, ""));
        if (Number.isFinite(seconds)) quota.retrySeconds = seconds;
      }
    }
    // Fallbacks aus dem Fehlertext ("limit: 20, model: gemini-3.6-flash", "retry in 58.9s")
    quota.limit ??= message.match(/limit:\s*([\d.]+)/)?.[1];
    quota.model ??= message.match(/model:\s*([\w.-]+)/)?.[1];
    if (quota.retrySeconds === undefined) {
      const seconds = Number(message.match(/retry in\s*([\d.]+)s/i)?.[1]);
      if (Number.isFinite(seconds)) quota.retrySeconds = seconds;
    }
    quota.metric ??= message.match(/metric:\s*([\w./]+)/)?.[1];
  } catch {
    // kein JSON — Einordnung unten trotzdem versuchen
  }
  const id = `${quota.quotaId ?? ""} ${quota.metric ?? ""}`;
  if (/perday|per_day|daily/i.test(id)) quota.art = "Tageslimit";
  else if (/perminute|per_minute/i.test(id)) quota.art = "Minutenlimit";
  return quota;
}

/**
 * Ruft die Gemini-REST-API (generateContent) auf. Bei mehreren API-Keys wird
 * bei 429 automatisch auf den nächsten nicht gesperrten Key gewechselt; sind
 * alle Keys gesperrt, wird kurz gewartet bzw. mit einer Meldung abgebrochen,
 * die Limit-Grund, Nutzung und den nächsten sinnvollen Zeitpunkt nennt.
 * Serverfehler (5xx) werden mit exponentiellem Backoff neu versucht.
 */
export async function generateContent(env: ServerEnv, options: GenerateOptions): Promise<string> {
  const keys = env.geminiApiKeys;
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

  const maxTries = MAX_TRIES_PER_KEY * keys.length;
  let lastError: GeminiError | undefined;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    // Nächsten benutzbaren Key wählen: beim aktiven bleiben, solange er
    // funktioniert; gesperrte überspringen. Sind alle gesperrt: kurz warten
    // oder (bei langer Sperre, z.B. Tageslimit) mit klarer Meldung abbrechen.
    const now = Date.now();
    let state: KeyState | undefined;
    for (let offset = 0; offset < keys.length; offset++) {
      const index = (activeKeyIndex + offset) % keys.length;
      const candidate = stateFor(keys, index);
      if (candidate.blockedUntil <= now) {
        state = candidate;
        activeKeyIndex = index;
        break;
      }
    }
    if (!state) {
      const soonest = Math.min(
        ...keys.map((_, index) => stateFor(keys, index).blockedUntil),
      );
      const waitMs = soonest - now;
      if (waitMs > MAX_WAIT_MS) {
        throw new GeminiError(
          `Alle ${keys.length} Gemini-Key(s) haben ihr Kontingent erschöpft — ` +
            `nächster Versuch sinnvoll ab ${new Date(soonest).toISOString().slice(11, 19)} UTC.\n` +
            usageSummaryText(env),
          429,
          lastError?.quota,
        );
      }
      await sleep(Math.max(waitMs, 1000));
      continue;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": state.key,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      state.usage.fehler++;
      lastError = new GeminiError(`Netzwerkfehler: ${error}`);
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) {
      state.usage.ok++;
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

    const errorText = (await response.text()).slice(0, 1500);

    if (response.status === 429) {
      // Kontingent dieses Keys erschöpft: Grund merken, Key sperren und
      // sofort mit dem nächsten Key weitermachen
      const quota = parseQuota(errorText);
      state.usage.rateLimited++;
      state.usage.letztesLimit = { ...quota, um: new Date().toISOString() };
      const blockMs =
        quota.art === "Tageslimit"
          ? DAY_LIMIT_BLOCK_MS
          : (quota.retrySeconds ?? 30) * 1000 + 1000;
      state.blockedUntil = Date.now() + blockMs;
      lastError = new GeminiError(
        `Gemini-Kontingent erschöpft (${state.usage.label}): ${quotaText(quota)}`,
        429,
        quota,
      );
      console.error(`  ⏳ ${lastError.message}` + (keys.length > 1 ? " — wechsle Key" : ""));
      continue;
    }

    const hint =
      response.status === 404
        ? `\n→ Das Modell "${env.geminiModel}" ist nicht (mehr) verfügbar. Anderes ` +
          `Modell über GEMINI_MODEL wählen (.env bzw. Repo-Variable in GitHub), ` +
          `z.B. "gemini-flash-latest" — der Alias zeigt immer auf das aktuelle Flash-Modell.`
        : "";
    lastError = new GeminiError(
      `Gemini-API ${response.status}: ${errorText.slice(0, 500)}${hint}`,
      response.status,
    );
    // 5xx sind transient → warten und neu versuchen
    if (response.status >= 500) {
      state.usage.fehler++;
      await sleep(backoffMs(attempt, response.headers.get("retry-after")));
      continue;
    }
    // 400/401/403 etc. sind dauerhaft (falscher Key, falsches Modell, …)
    state.usage.fehler++;
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
