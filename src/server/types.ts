/** Spalten des Kanban-Boards. "todo" = noch abzuarbeiten (Default für Jobs ohne Eintrag). */
export type BoardStatus = "todo" | "interessant" | "beworben" | "abgelehnt" | "archiviert";

export const BOARD_STATUSES: BoardStatus[] = [
  "todo",
  "interessant",
  "beworben",
  "abgelehnt",
  "archiviert",
];

/** Einzelbewertungen (je 0–10) aus der KI-Triage. */
export interface TriageScores {
  /** Nähe des Dienstorts zum Wohn-/Wunschort (10 = vor Ort bzw. dank Remote egal) */
  entfernung: number;
  /** Homeoffice-/Remote-Möglichkeiten (10 = voll remote möglich) */
  homeoffice: number;
  /** Gehalt im Verhältnis zu den Wünschen (0 = keine Angabe oder viel zu niedrig) */
  gehalt: number;
  /** Passung Vollzeit/Teilzeit zu den Wünschen */
  arbeitszeit: number;
  /** Möglichkeit der Verbeamtung (10 = ja, 0 = nein/unbekannt) */
  verbeamtung: number;
  /** Gesamtbewertung (nicht zwingend der Durchschnitt — die KI gewichtet selbst) */
  gesamt: number;
}

/** Eintrag in der Übersichtsdatei data/agent/board.json. */
export interface BoardEntry {
  jobId: string;
  status: BoardStatus;
  /** true = zuletzt von der KI eingruppiert, false = vom Menschen */
  vonKi: boolean;
  /** Gesamt-Punkte 0–10 aus der KI-Triage (falls vorhanden) */
  punkte?: number;
  /** Aufschlüsselung der Punkte nach Kriterien (bei neueren Triagen vorhanden) */
  punkteDetails?: TriageScores;
  /** Kurzbegründung der KI-Entscheidung (falls vorhanden) */
  begruendung?: string;
  updatedAt: string;
}

export interface BoardFile {
  updatedAt: string;
  entries: BoardEntry[];
}

/** Eine Nachricht im pro Job gespeicherten Chat-Verlauf mit dem KI-Agenten. */
export interface ChatMessage {
  role: "user" | "model";
  content: string;
  at: string;
  /** Kennzeichnet die automatische Triage-Anfrage (großer Prompt, im UI einklappbar) */
  kind?: "triage" | "chat";
}

/** Ergebnis, das die KI bei der Triage als JSON liefern soll. */
export interface TriageResult {
  entscheidung: "interessant" | "archivieren";
  /** Gesamt-Punkte 0–10 (aus punkteDetails.gesamt bzw. altes Zahlenformat) */
  punkte: number;
  /** Aufschlüsselung nach Kriterien (fehlt nur bei Antworten im alten Format) */
  punkteDetails?: TriageScores;
  begruendung: string;
}

/** Laufzeit-Status des KI-Agenten (für die Fortschrittsanzeige im UI). */
export interface AgentStatus {
  running: boolean;
  /** Anzahl in diesem Lauf bereits bearbeiteter Jobs */
  processed: number;
  /** Anzahl der Jobs, die dieser Lauf bearbeiten will */
  total: number;
  /** Wie viele Angebote je Gemini-Anfrage bewertet werden (Sammel-Triage) */
  batchSize?: number;
  currentJobId?: string;
  currentTitel?: string;
  lastError?: string;
  finishedAt?: string;
}
