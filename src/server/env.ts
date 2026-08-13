import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

export const ENV_FILE = join(process.cwd(), ".env");

export interface ServerEnv {
  geminiApiKey: string;
  /** z.B. "gemini-2.5-flash" — im kostenlosen Kontingent enthalten */
  geminiModel: string;
  port: number;
  /** Pause zwischen zwei Triage-Anfragen (Rate-Limit des Gratis-Kontingents) */
  agentDelayMs: number;
}

/** Sehr kleiner .env-Parser (KEY=VALUE pro Zeile, # = Kommentar). */
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const KEY_ANLEITUNG = `
╭──────────────────────────────────────────────────────────────────────╮
│  Es fehlt der Gemini-API-Schlüssel (GEMINI_API_KEY in der .env).     │
╰──────────────────────────────────────────────────────────────────────╯

So bekommst du kostenlos einen Schlüssel (privates Google-Konto reicht,
keine Kreditkarte nötig — das Gratis-Kontingent genügt für die Triage):

  1. Öffne  https://aistudio.google.com/apikey  im Browser
  2. Melde dich mit deinem (privaten) Google-Konto an
  3. Klicke auf "API-Schlüssel erstellen" / "Create API key"
     (falls gefragt: neues Projekt anlegen oder ein bestehendes wählen)
  4. Kopiere den erzeugten Schlüssel (beginnt mit "AIza…")
  5. Füge ihn hier unten ein und drücke Enter

Der Schlüssel wird in der Datei .env gespeichert (steht im .gitignore,
landet also nicht im Git) und beim nächsten Start automatisch geladen.
`;

/**
 * Lädt die .env, prüft ob alle nötigen Informationen (v.a. der Gemini-Key)
 * vorhanden sind und fragt fehlende Werte interaktiv in der Konsole ab —
 * inklusive Schritt-für-Schritt-Anleitung, woher man den Key bekommt.
 * Ohne Terminal (CI / GitHub Actions) wird stattdessen mit einer klaren
 * Fehlermeldung abgebrochen, die auf das Repo-Secret hinweist.
 */
export async function ensureEnv(options?: { interactive?: boolean }): Promise<ServerEnv> {
  const interactive = options?.interactive ?? true;
  const fromFile = parseEnvFile(ENV_FILE);
  // Bereits gesetzte Umgebungsvariablen haben Vorrang vor der .env
  const get = (key: string): string | undefined => process.env[key] ?? fromFile[key];

  let apiKey = get("GEMINI_API_KEY")?.trim();
  if (!apiKey && !interactive) {
    throw new Error(
      "GEMINI_API_KEY fehlt. In GitHub Actions: Repo → Settings → Secrets and " +
        "variables → Actions → 'New repository secret' → Name GEMINI_API_KEY, " +
        "Wert von https://aistudio.google.com/apikey. Lokal: .env-Datei anlegen " +
        "oder einfach `yarn server` starten (fragt interaktiv).",
    );
  }
  if (!apiKey) {
    console.log(KEY_ANLEITUNG);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    while (!apiKey) {
      const answer = (await rl.question("GEMINI_API_KEY: ")).trim();
      if (answer) {
        apiKey = answer;
      } else {
        console.log("Bitte einen Schlüssel eingeben (oder Strg+C zum Abbrechen).");
      }
    }
    rl.close();
    const prefix = existsSync(ENV_FILE) && !readFileSync(ENV_FILE, "utf8").endsWith("\n") ? "\n" : "";
    appendFileSync(ENV_FILE, `${prefix}GEMINI_API_KEY=${apiKey}\n`, "utf8");
    console.log(`✔ Schlüssel in ${ENV_FILE} gespeichert.\n`);
  }

  // 0 ist erlaubt (bezahltes Kontingent → keine Pause nötig), daher nicht "|| 7000"
  const delayRaw = get("AGENT_DELAY_MS")?.trim();
  const delay = Number(delayRaw);
  return {
    geminiApiKey: apiKey,
    geminiModel: get("GEMINI_MODEL")?.trim() || "gemini-2.5-flash",
    port: Number(get("PORT")) || 8322,
    // Gratis-Kontingent von gemini-2.5-flash: ~10 Anfragen/Minute → 7s Pause
    agentDelayMs: delayRaw && Number.isFinite(delay) && delay >= 0 ? delay : 7000,
  };
}
