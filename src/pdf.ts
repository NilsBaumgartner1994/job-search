import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** Ablageordner für heruntergeladene Stellen-PDFs (Cache, nicht im Git). */
export const PDF_DIR = join(process.cwd(), "data", "pdfs");

/** Liefert den Ablagepfad einer Job-PDF, z.B. data/pdfs/itzbund/P_2130_2026_211_42.pdf */
export function pdfPathFor(adapter: string, portalId: string): string {
  const safe = portalId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return join(PDF_DIR, adapter, `${safe}.pdf`);
}

/** Projekt-relativer Pfad für die Ablage in jobs.json. */
export function toRelativePath(absolute: string): string {
  return relative(process.cwd(), absolute);
}

export function savePdf(path: string, buffer: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

export function readPdfIfExists(path: string): Buffer | undefined {
  return existsSync(path) ? readFileSync(path) : undefined;
}

export function deletePdfIfExists(relativePath: string): void {
  const absolute = join(process.cwd(), relativePath);
  if (existsSync(absolute)) unlinkSync(absolute);
}

/** Extrahiert den rohen Text einer PDF (unnormalisiert — Normalisierung macht der Parser). */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const data = await parser.getText();
    return data.text;
  } finally {
    await parser.destroy();
  }
}
