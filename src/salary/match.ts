import { normalizeGradeKey } from "./fetchSalaryTables.js";
import type { SalaryData, SalaryTable } from "./types.js";

/**
 * Ähnlichkeits-Matching zwischen den Gehaltsangaben aus Stellenanzeigen
 * (z.B. "EG 13 TV EntgO Bund", "BesGrn. A7/A9m+Z sowie A9g/A11") und den
 * Gruppen der Gehaltstabellen ("E 13", "A 9", ...).
 *
 * Die Angaben in Anzeigen passen selten 1:1 auf die Tabellen — deshalb wird
 * pro gefundenem Kandidaten die wahrscheinlichste Tabellengruppe über eine
 * Score-Funktion bestimmt (Systemtreffer, Nummern-Nähe, Suffix, String-
 * Ähnlichkeit, Bevorzugung der Bund-Tabellen).
 */

export interface GradeMatch {
  /** Kandidat aus der Anzeige, normalisiert (z.B. "E 13") */
  kandidat: string;
  /** Getroffene Gruppe in der Tabelle (z.B. "E 13") */
  gruppe: string;
  tabelleId: string;
  /** 0..1 — wie sicher der Treffer ist */
  score: number;
}

interface GradeCandidate {
  system: "A" | "B" | "E" | "W" | "R" | "S" | "T";
  nummer: number;
  suffix: string;
}

/** Tätigkeitsebenen des TV-BA als römische Zahl — die "AT"-Ebenen (außertariflich) sind bewusst nicht abgebildet. */
const TV_BA_TAETIGKEITSEBENEN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8,
};

/** Zieht alle Besoldungs-/Entgeltgruppen-Kandidaten aus einem Freitext. */
export function parseGradeCandidates(text: string): GradeCandidate[] {
  const candidates: GradeCandidate[] = [];
  const seen = new Set<string>();
  const push = (system: GradeCandidate["system"], nummer: number, suffix = "") => {
    const key = `${system}${nummer}${suffix}`;
    if (!seen.has(key) && nummer >= 1 && nummer <= 16) {
      seen.add(key);
      candidates.push({ system, nummer, suffix });
    }
  };

  // "EG 13", "E 9a", "Entgeltgruppe 11"
  for (const match of text.matchAll(/(?:\bEG?|\bEntgeltgruppe)\s?(\d{1,2})\s?([a-cü]?)\b/gi)) {
    push("E", Number(match[1]), match[2].toLowerCase());
  }
  // "A 13", "A9g", "A9m+Z", "A13h" — g/m/h u.ä. sind Laufbahn-/Fallgruppen-Kürzel,
  // kein Tabellen-Suffix; [a-zA-Z]* statt eines festen [gm]?, damit auch andere,
  // seltenere Kürzel direkt nach der Nummer (ohne Wortgrenze) nicht die ganze
  // Erkennung verhindern (vorher scheiterte z.B. "A13h" komplett an der \b-Prüfung).
  for (const match of text.matchAll(/\bA\s?(\d{1,2})[a-zA-Z]*(?:\+Z)?\b/g)) {
    push("A", Number(match[1]));
  }
  for (const match of text.matchAll(/\bB\s?(\d{1,2})\b/g)) {
    push("B", Number(match[1]));
  }
  // "W 2", "W2" — Professoren-Besoldung
  for (const match of text.matchAll(/\bW\s?(\d{1,2})\b/g)) {
    push("W", Number(match[1]));
  }
  // "R 2", "R2" — Besoldung für Richter:innen/Staatsanwält:innen
  for (const match of text.matchAll(/\bR\s?(\d{1,2})\b/g)) {
    push("R", Number(match[1]));
  }
  // "S 8a", "S 11b" — TVöD Sozial- und Erziehungsdienst (SuE)
  for (const match of text.matchAll(/\bS\s?(\d{1,2})([ab]?)\b/gi)) {
    push("S", Number(match[1]), match[2].toLowerCase());
  }
  // "TV-BA III" — Tätigkeitsebene als römische Zahl
  const tvBaMatch = text.match(/\bTV-BA\b[\s:.-]{0,4}(VIII|VII|VI|IV|V|III|II|I)\b/i);
  if (tvBaMatch) {
    push("T", TV_BA_TAETIGKEITSEBENEN[tvBaMatch[1].toUpperCase()]);
  }
  // Tarifschemata ohne eigenes "E" vor der Nummer, z.B. "TVöD-4", "TVÖD-10",
  // "TV-V 8" — auch als Von-Bis-Spanne ("TVöD-4 - TVöD-5"), dann liefert
  // jede Seite der Spanne einen eigenen Kandidaten. Lazy-Quantor stoppt vor
  // der ersten Ziffer, damit z.B. "TV-L E 13" (schon über die E-Regel oben
  // erkannt) hier keinen zusätzlichen falschen Treffer erzeugt.
  for (const match of text.matchAll(/\bTV[\wäöüÄÖÜß-]*?[-\s](\d{1,2})([a-c]?)\b/gi)) {
    push("E", Number(match[1]), match[2].toLowerCase());
  }
  return candidates;
}

/** Dice-Koeffizient über Bigramme — generische String-Ähnlichkeit. */
export function stringSimilarity(a: string, b: string): number {
  const bigrams = (value: string): Map<string, number> => {
    const map = new Map<string, number>();
    const normalized = value.toLowerCase().replace(/\s+/g, "");
    for (let i = 0; i < normalized.length - 1; i++) {
      const gram = normalized.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };
  const mapA = bigrams(a);
  const mapB = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [gram, count] of mapA) {
    overlap += Math.min(count, mapB.get(gram) ?? 0);
  }
  for (const count of mapA.values()) total += count;
  for (const count of mapB.values()) total += count;
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** true, wenn die Tabelle die Bundes-Tabelle ihres Systems ist (die Jobs hier sind Bund). */
function isBundTable(table: SalaryTable): boolean {
  return /bund/i.test(table.titel);
}

function scoreAgainstGroup(candidate: GradeCandidate, gruppe: string, table: SalaryTable): number {
  const parsed = gruppe.match(/^([ABRWEST])\s?(\d{1,2})([a-cü]?)$/i);
  if (!parsed) return 0;
  const system = parsed[1].toUpperCase();
  const nummer = Number(parsed[2]);
  const suffix = parsed[3].toLowerCase();

  if (system !== candidate.system) return 0;

  let score = 0.55; // Systemtreffer
  score += 0.35 * Math.max(0, 1 - Math.abs(nummer - candidate.nummer) / 4); // Nummern-Nähe
  if (nummer === candidate.nummer && suffix === candidate.suffix) score = 1;
  else if (nummer === candidate.nummer) score = 0.9; // z.B. "E 9" vs. "E 9a"
  // String-Ähnlichkeit als Feinjustierung (löst z.B. Suffix-Wahl "9a" vs "9b")
  score += 0.05 * stringSimilarity(`${candidate.system} ${candidate.nummer}${candidate.suffix}`, gruppe);
  if (!isBundTable(table)) score -= 0.15; // Bund-Tabellen bevorzugen
  return Math.min(1, Math.max(0, score));
}

/** Findet für einen Anzeigen-Text die wahrscheinlichsten Tabellengruppen. */
export function matchGrades(gehaltsstufe: string, data: SalaryData): GradeMatch[] {
  const matches: GradeMatch[] = [];
  for (const candidate of parseGradeCandidates(gehaltsstufe)) {
    let best: GradeMatch | undefined;
    for (const table of data.tabellen) {
      for (const gruppe of Object.keys(table.gruppen)) {
        const score = scoreAgainstGroup(candidate, normalizeGradeKey(gruppe), table);
        if (score > 0.5 && (!best || score > best.score)) {
          best = {
            kandidat: `${candidate.system} ${candidate.nummer}${candidate.suffix}`,
            gruppe,
            tabelleId: table.id,
            score: Math.round(score * 100) / 100,
          };
        }
      }
    }
    if (best) matches.push(best);
  }
  return matches;
}
