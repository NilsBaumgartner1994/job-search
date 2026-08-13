/** Spalten des Kanban-Boards. "todo" = noch abzuarbeiten (Default für Jobs ohne Eintrag). */
export type BoardStatus = "todo" | "interessant" | "beworben" | "abgelehnt" | "archiviert";

export const BOARD_STATUSES: BoardStatus[] = [
  "todo",
  "interessant",
  "beworben",
  "abgelehnt",
  "archiviert",
];

/** Eintrag in der Übersichtsdatei data/agent/board.json. */
export interface BoardEntry {
  jobId: string;
  status: BoardStatus;
  /** true = zuletzt von der KI eingruppiert, false = vom Menschen */
  vonKi: boolean;
  /** Relevanz-Punkte 0–10 aus der KI-Triage (falls vorhanden) */
  punkte?: number;
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
  punkte: number;
  begruendung: string;
}

/** Laufzeit-Status des KI-Agenten (für die Fortschrittsanzeige im UI). */
export interface AgentStatus {
  running: boolean;
  /** Anzahl in diesem Lauf bereits bearbeiteter Jobs */
  processed: number;
  /** Anzahl der Jobs, die dieser Lauf bearbeiten will */
  total: number;
  currentJobId?: string;
  currentTitel?: string;
  lastError?: string;
  finishedAt?: string;
}
