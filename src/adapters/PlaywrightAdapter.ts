import { JobPortalAdapter } from "./JobPortalAdapter.js";

/**
 * Basisklasse für Portale, die sich nicht per fetch scrapen lassen
 * (Login nötig, Cloudflare, reines Client-Rendering ohne erreichbare API —
 * z.B. Interamt). Playwright ist seit dem `interamt`-Adapter eine echte
 * Abhängigkeit (`yarn install` reicht); der dynamische Import unten sorgt
 * trotzdem für eine klare Fehlermeldung, falls Chromium mal fehlt:
 *
 *   yarn playwright install chromium
 *
 * Unterklassen implementieren fetchJobs() und nutzen darin `withPage()`.
 */
export abstract class PlaywrightAdapter extends JobPortalAdapter {
  /** headless abschalten, wenn man z.B. einen Login von Hand erledigen will */
  protected headless = true;

  /**
   * Öffnet eine Browser-Seite, führt `fn` aus und räumt danach auf.
   * `page` ist eine playwright.Page (untypisiert, da Playwright optional ist).
   */
  protected async withPage<T>(fn: (page: any) => Promise<T>): Promise<T> {
    let playwright: any;
    try {
      // Dynamischer Import, damit das Projekt ohne Playwright läuft.
      playwright = await import("playwright" + "");
    } catch {
      throw new Error(
        `Adapter "${this.name}" benötigt Playwright. Installation: yarn add playwright && yarn playwright install chromium`,
      );
    }
    const browser = await playwright.chromium.launch({ headless: this.headless });
    try {
      const context = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 1400, height: 900 },
      });
      const page = await context.newPage();
      return await fn(page);
    } finally {
      await browser.close();
    }
  }
}
