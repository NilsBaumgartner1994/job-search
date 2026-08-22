import type { JobOffer } from "../types.js";

/**
 * Bei knapp der Hälfte der Interamt-Angebote gehört der in `raw.detail`
 * gespeicherte Seitentext zu einem ANDEREN Angebot: `InteramtAdapter.openDetail()`
 * klickt die Trefferzeile über `tr:nth-child(n)` an und liest den Body, nachdem
 * `networkidle` gemeldet wurde — die Wicket-AJAX-Seite ist nach `page.goBack()`
 * aber nicht zuverlässig fertig gerendert.
 *
 * Interamt nennt die Angebots-ID im Seitentext, damit lässt sich der Versatz
 * erkennen. Bis der Adapter repariert ist, muss jede Auswertung des Detailtexts
 * (Triage, Homeoffice-Erkennung, Anforderungen) vorher hier nachfragen.
 *
 * Verlässlich sind bei betroffenen Angeboten nur die Felder aus der Trefferliste:
 * titel, employer, gehaltsstufe, verbeamtung, dienstorte, bewerbungsfrist, befristung.
 */

const ANGEBOTS_ID = /INTERAMT\s*Angebots-?ID\s*<?[^0-9]{0,40}(\d{6,8})/gi;

/**
 * true  = der Detailtext gehört nachweislich zu diesem Angebot
 * false = er gehört nachweislich zu einem anderen
 * undefined = keine Aussage möglich (kein Text bzw. keine ID darin)
 */
export function detailGehoertZuJob(job: JobOffer): boolean | undefined {
  const detail = job.raw?.detail?.trim();
  if (!detail) return undefined;
  if (job.adapter !== "interamt") return true; // nur Interamt zeigt den Zeilenversatz
  const ids = [...detail.matchAll(ANGEBOTS_ID)].map((treffer) => treffer[1]);
  if (!ids.length) return undefined;
  return ids.includes(job.id.split(":")[1]);
}

/**
 * Der Text, dem man bei diesem Angebot trauen darf. Bei vertauschtem
 * Detailtext bleibt nur, was aus der Trefferliste stammt — insbesondere das
 * Homeoffice-Feld, wenn es aus der Spalte "Dienstort" gebildet wurde.
 */
export function vertrauenswuerdigerText(job: JobOffer): string {
  const teile = [job.titel, job.employer ?? "", job.gehaltsstufe ?? "", job.gehalt ?? ""];
  if (detailGehoertZuJob(job) === false) {
    // "Dienstort: …" kommt aus der Liste, alles andere aus dem falschen Detailtext
    if (job.homeoffice?.startsWith("Dienstort:")) teile.push(job.homeoffice);
    return teile.join("\n");
  }
  teile.push(job.homeoffice ?? "", job.beschreibung ?? "", job.raw?.detail ?? "");
  return teile.join("\n");
}
