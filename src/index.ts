import { createAdapters } from "./adapters/index.js";
import { repairInteramtLinks } from "./adapters/InteramtAdapter.js";
import { writeHtml, HTML_FILE } from "./html.js";
import { deletePdfIfExists } from "./pdf.js";
import { DATA_FILE, loadJobs, mergeJobs, pruneExpired, saveJobs } from "./storage.js";
import type { CrawlContext, JobOffer } from "./types.js";

interface CliOptions {
  adapters?: string[];
  htmlOnly: boolean;
  refresh: boolean;
  /** true → gespeicherte Angebote der laufenden Adapter vor dem Crawl verwerfen */
  forget: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { htmlOnly: false, refresh: false, forget: false };
  for (const arg of argv) {
    if (arg === "--html-only") {
      options.htmlOnly = true;
    } else if (arg === "--refresh") {
      options.refresh = true;
    } else if (arg.startsWith("--adapter=")) {
      options.adapters = splitList(arg.slice("--adapter=".length));
    } else if (arg === "--forget") {
      options.forget = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unbekanntes Argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }
  return options;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function printHelp(): void {
  const names = createAdapters()
    .map((adapter) => adapter.name)
    .join(", ");
  console.log(`Nutzung:
  yarn crawl [Optionen]   Trefferlisten aus dem Netz laden; Details nur für neue Jobs
  yarn crawl:full         wie crawl, lädt aber auch bekannte Details neu (--refresh)
  yarn html               kein Netz; jobs.html neu aus data/jobs.json erzeugen

Optionen:
  --adapter=a,b       Nur bestimmte Adapter ausführen (verfügbar: ${names})
  --forget            Gespeicherte Angebote der laufenden Adapter vorher
                      wegwerfen und komplett neu einlesen (Details landen
                      damit zwangsläufig frisch aus dem Netz im Bestand)
  --refresh           Details auch für bekannte Jobs neu laden
  --html-only         Kein Scraping; nur jobs.html erzeugen
  -h, --help          Diese Hilfe`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let jobs = loadJobs();

  // Altlast: frühere Läufe haben bei Interamt die sitzungsgebundene
  // "crypt."-URL gespeichert ("Sitzung abgelaufen" beim Anklicken). Der Link
  // lässt sich ohne Netz aus der Job-ID neu bauen — auch für Angebote, die
  // gar nicht mehr in der Trefferliste stehen.
  const repairedLinks = repairInteramtLinks(jobs);
  if (repairedLinks > 0) {
    console.log(`🔗 ${repairedLinks} veraltete Interamt-Links auf den stabilen Permalink umgeschrieben.`);
  }

  if (options.forget && options.htmlOnly) {
    console.error("--forget ohne Crawl wäre reiner Datenverlust — mit --html-only nicht erlaubt.");
    process.exit(1);
  }

  if (!options.htmlOnly) {
    const adapters = createAdapters().filter(
      (adapter) => !options.adapters || options.adapters.includes(adapter.name),
    );
    if (adapters.length === 0) {
      console.error("Kein passender Adapter gefunden.");
      process.exit(1);
    }

    // Bei --forget zählt der Bestand der laufenden Adapter nicht mehr als
    // bekannt: keine Detail-Treffer aus dem Cache, alles kommt frisch.
    const forgotten = new Set(options.forget ? adapters.map((adapter) => adapter.name) : []);
    const context: CrawlContext = {
      known: new Map(jobs.filter((job) => !forgotten.has(job.adapter)).map((job) => [job.id, job])),
      refresh: options.refresh,
    };

    for (const adapter of adapters) {
      process.stdout.write(`→ ${adapter.label} (${adapter.name}) ... `);
      try {
        const result = await adapter.fetchJobs(context);
        console.log(
          `${result.jobs.length} Angebote (${result.stats.fetched} neu geladen, ${result.stats.cached} aus Cache)`,
        );
        for (const warning of result.warnings) {
          console.warn(`  ⚠ ${warning}`);
        }
        // Erst nach einem erfolgreichen Lauf wegwerfen — schlägt der Adapter
        // fehl (Netz, Portal-Umbau), bleibt der alte Bestand unangetastet.
        if (forgotten.has(adapter.name)) {
          const before = jobs.length;
          jobs = jobs.filter((job) => job.adapter !== adapter.name);
          console.log(`  🗑 ${before - jobs.length} gespeicherte ${adapter.label}-Angebote verworfen (--forget).`);
        }
        jobs = mergeJobs(jobs, result.jobs);
      } catch (error) {
        console.error(`FEHLER: ${error}`);
      }
    }
  }

  const { kept, removed } = pruneExpired(jobs);
  if (removed.length > 0) {
    console.log(`✂ ${removed.length} abgelaufene Angebote entfernt:`);
    for (const job of removed) {
      console.log(`  - ${job.titel} (Frist: ${job.bewerbungsfrist})`);
      if (job.raw?.pdfPath) deletePdfIfExists(job.raw.pdfPath);
    }
  }

  saveJobs(kept);
  writeHtml(kept);
  console.log(`\n${kept.length} Angebote gespeichert → ${relative(DATA_FILE)}`);
  console.log(`HTML generiert → ${relative(HTML_FILE)}`);
}

function relative(path: string): string {
  return path.replace(process.cwd() + "/", "");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Nur für Tests/Debugging exportiert
export type { JobOffer };
