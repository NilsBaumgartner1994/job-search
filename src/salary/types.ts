import { join } from "node:path";

export const SALARY_FILE = join(process.cwd(), "data", "gehaltstabellen.json");

export interface SalaryTable {
  id: string;
  titel: string;
  quelle: string;
  /** "besoldung" (Beamte, A/B/R/W) oder "entgelt" (Tarif, E/EG) */
  system: "besoldung" | "entgelt";
  /** Spaltenüberschriften der Stufen, z.B. ["2","3",...,"8"] oder ["1",...,"6"] */
  stufen: string[];
  /** Gruppe → Stufe → Brutto/Monat (null, wenn die Stufe nicht existiert) */
  gruppen: Record<string, Record<string, number | null>>;
}

export interface SalaryData {
  abgerufen: string;
  quellen: string[];
  tabellen: SalaryTable[];
}
