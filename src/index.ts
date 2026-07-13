import { createAdapters } from "./adapters/index.js";
import { writeHtml, HTML_FILE } from "./html.js";
import { deletePdfIfExists } from "./pdf.js";
import { DATA_FILE, loadJobs, mergeJobs, pruneExpired, saveJobs } from "./storage.js";
import type { CrawlContext, JobOffer } from "./types.js";

interface CliOptions {
  adapters?: string[];
  htmlOnly: boolean;
  refresh: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { htmlOnly: false, refresh: false };
  for (const arg of argv) {
    if (arg === "--html-only") {
      options.htmlOnly = true;
    } else if (arg === "--refresh") {
      options.refresh = true;
    } else if (arg.startsWith("--adapter=")) {
      options.adapters = arg
        .slice("--adapter=".length)
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);
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
  --refresh           Details auch für bekannte Jobs neu laden
  --html-only         Kein Scraping; nur jobs.html erzeugen
  -h, --help          Diese Hilfe`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let jobs = loadJobs();

  if (!options.htmlOnly) {
    const adapters = createAdapters().filter(
      (adapter) => !options.adapters || options.adapters.includes(adapter.name),
    );
    if (adapters.length === 0) {
      console.error("Kein passender Adapter gefunden.");
      process.exit(1);
    }

    const context: CrawlContext = {
      known: new Map(jobs.map((job) => [job.id, job])),
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
