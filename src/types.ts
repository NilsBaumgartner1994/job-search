/** Ein normalisiertes Stellenangebot, wie es in data/jobs.json gespeichert wird. */
export interface JobOffer {
  /** Eindeutige ID: "<adapter>:<referenzcode-oder-portal-id>" */
  id: string;
  /** Name des Adapters, der das Angebot gefunden hat (z.B. "bka") */
  adapter: string;
  /** Arbeitgeber / Behörde (Portale wie ITZBund hosten mehrere Arbeitgeber) */
  employer?: string;
  titel: string;
  /** Link zum Angebot */
  link: string;
  /** Referenzcode / Kennziffer des Angebots */
  referenzcode?: string;
  beschreibung?: string;
  /** Gehalt als Freitext, z.B. "57.700 € brutto p.a." */
  gehalt?: string;
  /** Gehalts-/Entgelt-/Besoldungsstufe, z.B. "EG 13 TV EntgO Bund" oder "A 9g/A 11" */
  gehaltsstufe?: string;
  /** Chips: "Unbefristet", "Befristet für ..." */
  befristung: string[];
  /** Chips: "Vollzeit", "Teilzeit" */
  arbeitszeit: string[];
  /** true, wenn die Stelle eine Verbeamtung bietet bzw. ein Beamtenposten ist */
  verbeamtung: boolean;
  /** Laufbahngruppe(n): "Einfacher Dienst", "Mittlerer Dienst", "Gehobener Dienst", "Höherer Dienst" */
  laufbahn: string[];
  /** Dienstorte */
  dienstorte: string[];
  /** Hinweis zu Homeoffice / mobilem Arbeiten, falls im Angebot erwähnt */
  homeoffice?: string;
  /** Bewerbungsfrist als ISO-Datum (YYYY-MM-DD) */
  bewerbungsfrist?: string;
  /** Zwingend erforderliche Voraussetzungen (abhakbar in jobs.html) */
  voraussetzungenZwingend: string[];
  /** Wünschenswerte Voraussetzungen (abhakbar in jobs.html) */
  voraussetzungenWuenschenswert: string[];
  /** Wann das Angebot zum ersten Mal gesehen wurde (ISO) */
  firstSeen: string;
  /** Wann das Angebot zuletzt beim Scrapen gesehen wurde (ISO) */
  lastSeen: string;
  /**
   * Rohdaten des Scrapes — damit spätere Läufe (und verbesserte Parser) die
   * Felder neu extrahieren können, ohne die Seite erneut abzurufen.
   */
  raw?: RawJobData;
}

export interface RawJobData {
  /** Roh-Eintrag aus der Trefferliste (OData-JSON / Teaser-HTML) */
  short?: string;
  /** Roh-Detail: HTML der Detailseite bzw. extrahierter PDF-Text (unnormalisiert) */
  detail?: string;
  /** Pfad zur lokal gespeicherten PDF, relativ zum Projektordner */
  pdfPath?: string;
}

/** Kontext für einen Crawl-Lauf. */
export interface CrawlContext {
  /** Bekannte Jobs aus data/jobs.json, nach ID — Quelle für den Detail-Cache */
  known: Map<string, JobOffer>;
  /** true → Details auch für bekannte Jobs neu aus dem Netz laden */
  refresh: boolean;
}

/** Ergebnis eines Adapter-Laufs. */
export interface AdapterResult {
  adapter: string;
  jobs: JobOffer[];
  /** Fehler, die beim Verarbeiten einzelner Angebote auftraten (Lauf geht weiter) */
  warnings: string[];
  /** Wie viele Details aus dem Netz geladen bzw. aus dem Cache bedient wurden */
  stats: { fetched: number; cached: number };
}
