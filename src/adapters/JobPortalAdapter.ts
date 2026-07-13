import type { AdapterResult, CrawlContext, JobOffer } from "../types.js";

/**
 * Basisklasse für alle Job-Portal-Adapter.
 *
 * Ein Adapter kennt genau eine Webseite und liefert deren Angebote als
 * normalisierte JobOffer-Objekte zurück. Neue Portale werden unterstützt,
 * indem eine weitere Unterklasse angelegt und in src/adapters/index.ts
 * registriert wird.
 *
 * Crawl-Strategie: Die (billige) Trefferliste wird immer frisch geladen und
 * liefert die Job-IDs. Details (Detailseite/PDF) werden nur für neue Jobs
 * aus dem Netz geholt — für bekannte Jobs wird das in `raw` gespeicherte
 * Detail wiederverwendet und lediglich neu geparst, sodass verbesserte
 * Extraktoren auch ohne erneuten Abruf greifen.
 */
export abstract class JobPortalAdapter {
  /** Kurzname, wird als ID-Präfix und für --adapter benutzt (z.B. "bka"). */
  abstract readonly name: string;
  /** Menschlicher Anzeigename für die Ausgabe. */
  abstract readonly label: string;
  /** Startseite des Portals. */
  abstract readonly baseUrl: string;

  /** Holt alle aktuellen Angebote des Portals (Details nach Möglichkeit aus dem Cache). */
  abstract fetchJobs(context: CrawlContext): Promise<AdapterResult>;

  /** Cache-Lookup: gespeichertes Roh-Detail eines bekannten Jobs (außer bei --refresh). */
  protected cachedDetail(context: CrawlContext, id: string): string | undefined {
    if (context.refresh) return undefined;
    return context.known.get(id)?.raw?.detail || undefined;
  }

  /** Baut die adapter-weite eindeutige Job-ID. */
  protected buildId(portalId: string): string {
    return `${this.name}:${portalId}`;
  }

  protected createResult(): AdapterResult {
    return { adapter: this.name, jobs: [], warnings: [], stats: { fetched: 0, cached: 0 } };
  }

  protected now(): string {
    return new Date().toISOString();
  }

  /** Füllt firstSeen/lastSeen für ein frisch gescraptes Angebot. */
  protected finalize(job: Omit<JobOffer, "firstSeen" | "lastSeen" | "adapter">): JobOffer {
    const now = this.now();
    return { ...job, adapter: this.name, firstSeen: now, lastSeen: now };
  }
}
