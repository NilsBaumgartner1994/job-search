import { loadJobs } from "../storage.js";
import { publishDocs } from "./publish.js";

/**
 * yarn pages — schreibt die GitHub-Pages-Daten (docs/) neu aus
 * data/jobs.json und data/agent/. Kein Netz, kein Gemini-Schlüssel nötig.
 *
 * Gedacht für den Crawl-Workflow: nach einem Crawl-Lauf zeigt die Kanban-
 * Seite sonst erst dann die neuen Angebote (und die aktuellen Links), wenn
 * das nächste Mal der KI-Agent läuft.
 */
const jobs = loadJobs();
publishDocs(jobs);
console.log(`✔ docs/ (GitHub-Pages-Daten) aus ${jobs.length} Angeboten neu erzeugt.`);
