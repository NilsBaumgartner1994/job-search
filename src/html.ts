import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { matchGrades, type GradeMatch } from "./salary/match.js";
import { SALARY_FILE, type SalaryData } from "./salary/types.js";
import type { JobOffer } from "./types.js";

export const HTML_FILE = join(process.cwd(), "jobs.html");

/** Job + vorberechnete Tabellen-Treffer für die Brutto-Spalte. */
type JobWithMatches = JobOffer & { gehaltMatches: GradeMatch[] };

export function writeHtml(jobs: JobOffer[]): void {
  let salaryData: SalaryData | undefined;
  if (existsSync(SALARY_FILE)) {
    salaryData = JSON.parse(readFileSync(SALARY_FILE, "utf8")) as SalaryData;
  } else {
    console.warn("⚠ data/gehaltstabellen.json fehlt — Brutto-Spalte bleibt leer. Einmal `yarn salaries` ausführen.");
  }

  // raw (HTML-/PDF-Cache) nicht in die Seite einbetten — das wären mehrere MB.
  const enriched: JobWithMatches[] = jobs.map(({ raw, ...job }) => ({
    ...job,
    gehaltMatches:
      salaryData && (job.gehaltsstufe || job.gehalt)
        ? matchGrades(`${job.gehaltsstufe ?? ""} ${job.titel}`, salaryData)
        : [],
  }));

  const payload = {
    stand: new Date().toISOString(),
    jobs: enriched,
    tabellen: Object.fromEntries((salaryData?.tabellen ?? []).map((table) => [table.id, table])),
  };

  writeFileSync(HTML_FILE, renderPage(payload), "utf8");
}

function renderPage(payload: unknown): string {
  // "</script" im JSON darf den Script-Block nicht beenden
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stellenangebote</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f6f7f9; --panel: #ffffff; --text: #1a2027; --muted: #667085;
  --border: #e1e5ea; --accent: #2457d6; --accent-soft: #e8eefc;
  --chip: #eef1f5; --ok: #1a7f37; --warn: #b54708; --danger: #c62828;
  --row-hover: #f0f4fb; --star: #d4a017;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171c; --panel: #1d2229; --text: #e6e9ee; --muted: #98a2b3;
    --border: #313843; --accent: #7ba3f7; --accent-soft: #24304a;
    --chip: #2a313b; --ok: #4ade80; --warn: #fbbf24; --danger: #f87171;
    --row-hover: #232b38; --star: #f2c94c;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg); color: var(--text);
  display: flex; flex-direction: column;
}
header { padding: 14px 18px 10px; }
header h1 { margin: 0 0 2px; font-size: 19px; }
header .sub { color: var(--muted); font-size: 12.5px; }
.controls {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;
  padding: 10px 18px 12px;
  background: var(--panel); border-block: 1px solid var(--border);
  position: relative;
}
.control { display: flex; flex-direction: column; gap: 3px; }
.control label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.control input, .control select {
  font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--border); border-radius: 7px; padding: 5px 8px; min-width: 90px;
}
.control input[type="number"] { width: 90px; }
.control input[type="search"] { width: 240px; }
.chip-input {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  border: 1px solid var(--border); border-radius: 7px; padding: 4px 6px;
  background: var(--bg); min-width: 260px;
}
.chip-input input {
  border: none; background: transparent; flex: 1; min-width: 100px; padding: 2px;
  font: inherit; color: var(--text); outline: none;
}
.search-chip { display: inline-flex; align-items: center; gap: 4px; }
.search-chip.positive { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
.search-chip.negative { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
.chip-remove {
  border: none; background: transparent; cursor: pointer; margin-left: 2px;
  font-size: 13px; color: inherit; padding: 0; line-height: 1;
}
.years-box {
  display: flex; align-items: flex-end; gap: 10px; padding: 6px 10px;
  background: var(--accent-soft); border-radius: 9px;
}
.years-box .stufen { font-size: 12px; color: var(--muted); padding-bottom: 6px; }
.years-box .stufen b { color: var(--text); }
#count { margin-left: auto; align-self: center; color: var(--muted); font-size: 12.5px; white-space: nowrap; }
#toggleArchivedBtn {
  font: inherit; border: 1px solid var(--border); background: var(--bg); color: var(--text);
  border-radius: 7px; padding: 6px 10px; cursor: pointer; white-space: nowrap;
}
#toggleArchivedBtn.active { border-color: var(--danger); color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--bg)); }
main { flex: 1; overflow: auto; padding: 0 18px 18px; }
table { border-collapse: separate; border-spacing: 0; background: var(--panel); border-radius: 10px; table-layout: fixed; }
thead th {
  position: relative; position: sticky; top: 0; z-index: 2;
  background: var(--panel); border-bottom: 2px solid var(--border);
  text-align: left; padding: 6px 8px; font-size: 12px; white-space: nowrap; overflow: hidden;
  color: var(--muted);
}
thead th[draggable="true"] { cursor: grab; }
thead th.dragging { opacity: .35; }
thead th.drag-over { background: var(--accent-soft); }
thead th .th-inner { display: flex; align-items: center; gap: 4px; }
.th-label {
  cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 4px; border-radius: 5px; overflow: hidden; text-overflow: ellipsis;
}
.th-label:hover { background: var(--row-hover); color: var(--text); }
.th-sort {
  font: inherit; border: none; background: transparent; color: var(--muted); cursor: pointer;
  padding: 3px 5px; border-radius: 5px; line-height: 1; font-size: 11px; flex: none;
}
.th-sort:hover { background: var(--row-hover); color: var(--text); }
.th-sort.active { color: var(--accent); font-weight: 700; }
.filter-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 15px; height: 15px; padding: 0 3px; border-radius: 999px;
  background: var(--danger); color: #fff; font-size: 10px; font-weight: 700; line-height: 1; flex: none;
}
.th-resize {
  position: absolute; top: 0; right: -3px; width: 7px; height: 100%; cursor: col-resize; z-index: 3;
}
.th-resize:hover, .th-resize.active { background: color-mix(in srgb, var(--accent) 40%, transparent); }
.th-add { width: 40px; text-align: center; }
.th-add button {
  font: inherit; border: 1px solid var(--border); background: var(--bg); color: var(--text);
  border-radius: 6px; width: 24px; height: 24px; cursor: pointer; line-height: 1;
}
.th-add button:hover { background: var(--row-hover); }
.sel-badge { font-size: 12px; color: var(--accent); font-weight: 700; white-space: nowrap; }
#assignStatusBtn, #clearSelectionBtn {
  font: inherit; border: 1px solid var(--accent); background: var(--accent-soft); color: var(--accent);
  border-radius: 6px; padding: 3px 9px; cursor: pointer; font-size: 11.5px; flex: none;
}
#clearSelectionBtn { border-color: var(--border); background: var(--bg); color: var(--muted); padding: 3px 7px; }
tbody td { padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; overflow: hidden; text-overflow: ellipsis; }
tbody tr { cursor: pointer; }
tbody tr:hover td { background: var(--row-hover); }
tbody tr.starred-row td { background: color-mix(in srgb, var(--star) 10%, var(--panel)); }
tbody tr.starred-row:hover td { background: color-mix(in srgb, var(--star) 18%, var(--panel)); }
tbody tr.beworben-row td { background: color-mix(in srgb, var(--ok) 8%, var(--panel)); }
tbody tr.beworben-row:hover td { background: color-mix(in srgb, var(--ok) 14%, var(--panel)); }
tbody tr.archived-row td { opacity: .45; }
td.titel { font-weight: 550; white-space: normal; }
td.num, td.frist { white-space: nowrap; font-variant-numeric: tabular-nums; }
td.status-cell { white-space: nowrap; }
.row-select { margin-right: 6px; accent-color: var(--accent); vertical-align: middle; cursor: pointer; }
.marker-btn {
  font-size: 14px; border: none; background: transparent; cursor: pointer; padding: 3px 5px;
  border-radius: 5px; color: var(--muted); line-height: 1;
}
.marker-btn:hover { background: var(--row-hover); }
.marker-btn.star.active { background: color-mix(in srgb, var(--star) 28%, transparent); color: var(--star); }
.marker-btn.beworben.active { background: color-mix(in srgb, var(--ok) 22%, transparent); color: var(--ok); }
.marker-btn.archiv.active { background: color-mix(in srgb, var(--danger) 22%, transparent); color: var(--danger); }
.note-input {
  width: 100%; font: inherit; border: 1px solid transparent; background: transparent; color: var(--text);
  padding: 4px 6px; border-radius: 6px; cursor: text;
}
.note-input:hover { border-color: var(--border); }
.note-input:focus { border-color: var(--accent); background: var(--bg); outline: none; }
.chip {
  display: inline-block; padding: 1px 8px; margin: 1px 3px 1px 0;
  background: var(--chip); border-radius: 999px; font-size: 11.5px; white-space: nowrap;
}
.chip.unbefristet { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
.chip.befristet { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
.chip.grade { background: var(--accent-soft); color: var(--accent); }
.chip[data-chip-filter] { cursor: pointer; }
.chip[data-chip-filter]:hover { outline: 1px solid var(--accent); }
.bool-yes { color: var(--ok); font-weight: 600; }
.bool-no { color: var(--muted); }
.frist-soon { color: var(--danger); font-weight: 600; }
.frist-rel { color: var(--muted); font-size: 11.5px; }
.muted { color: var(--muted); }
.match-bar { display: inline-flex; align-items: center; gap: 6px; }
.match-bar .track { width: 46px; height: 6px; border-radius: 3px; background: var(--chip); overflow: hidden; }
.match-bar .fill { height: 100%; background: var(--accent); }
dialog {
  width: min(820px, calc(100vw - 40px)); max-height: calc(100vh - 60px);
  border: 1px solid var(--border); border-radius: 14px; padding: 0;
  background: var(--panel); color: var(--text);
}
dialog::backdrop { background: rgba(10,14,20,.55); }
#filterModal { width: min(360px, calc(100vw - 40px)); }
.modal-head {
  position: sticky; top: 0; background: var(--panel); z-index: 1;
  padding: 16px 20px 12px; border-bottom: 1px solid var(--border);
  display: flex; gap: 12px; align-items: flex-start;
}
.modal-head h2 { margin: 0; font-size: 17px; flex: 1; }
.modal-head .close {
  font: inherit; border: 1px solid var(--border); background: var(--bg); color: var(--text);
  border-radius: 8px; padding: 4px 10px; cursor: pointer;
}
.modal-body { padding: 14px 20px 20px; }
.meta-grid { display: grid; grid-template-columns: 170px 1fr; gap: 6px 12px; margin-bottom: 14px; }
.meta-grid dt { color: var(--muted); font-size: 12.5px; }
.meta-grid dd { margin: 0; }
.modal-body h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 18px 0 8px; }
.beschreibung { white-space: pre-wrap; }
.link-btn {
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  background: var(--accent-soft); color: var(--accent); text-decoration: none;
  padding: 4px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
  margin: 2px 4px 2px 0; vertical-align: middle;
}
.link-btn:hover { background: var(--accent); color: #fff; }
.req { list-style: none; margin: 0; padding: 0; }
.req li { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; }
.req-state {
  flex: none; margin-top: 1px; border: none; background: transparent; cursor: pointer;
  font-size: 15px; width: 24px; text-align: center; line-height: 1.3; padding: 1px; border-radius: 5px;
}
.req-state:hover { background: var(--row-hover); }
.req-state.empty { color: var(--muted); opacity: .45; }
.req-state.check { color: var(--ok); font-weight: 700; }
.req-state.false { color: var(--danger); font-weight: 700; }
.req-state.ref-check { color: var(--ok); opacity: .55; font-size: 12px; }
.req-state.ref-false { color: var(--danger); opacity: .55; font-size: 12px; }
.apply-btn {
  display: inline-block; background: var(--accent); color: #fff; text-decoration: none;
  padding: 7px 14px; border-radius: 8px; font-weight: 600;
}
.brutto-detail { font-size: 12.5px; color: var(--muted); }
.note-area {
  width: 100%; min-height: 70px; font: inherit; border: 1px solid var(--border);
  background: var(--bg); color: var(--text); border-radius: 8px; padding: 8px; resize: vertical;
}
.filter-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.filter-field label { font-size: 12px; color: var(--muted); }
.filter-field input {
  font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--border); border-radius: 7px; padding: 6px 8px;
}
.filter-checks { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; max-height: 260px; overflow-y: auto; }
.filter-checks label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; }
.filter-checks input { accent-color: var(--accent); flex: none; }
#filterModalBody h4 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 14px 0 6px; }
.filter-actions { margin-top: 4px; display: flex; gap: 8px; flex-wrap: wrap; }
.filter-actions button {
  font: inherit; border: 1px solid var(--border); background: var(--bg); color: var(--text);
  border-radius: 7px; padding: 6px 12px; cursor: pointer;
}
.filter-actions button.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.hidden-col-list { display: flex; flex-direction: column; gap: 6px; }
.hidden-col-btn {
  font: inherit; text-align: left; border: 1px solid var(--border); background: var(--bg); color: var(--text);
  border-radius: 7px; padding: 7px 10px; cursor: pointer;
}
.hidden-col-btn:hover { background: var(--row-hover); }
</style>
</head>
<body>
<header>
  <h1>Stellenangebote</h1>
  <div class="sub" id="stand"></div>
</header>

<div class="controls">
  <div class="years-box">
    <div class="control">
      <label for="years">Jahre im öffentl. Dienst</label>
      <input type="number" id="years" min="0" max="40" step="1" value="0">
    </div>
    <div class="stufen" id="stufenInfo"></div>
  </div>
  <div class="control">
    <label for="q">Suche (global)</label>
    <div class="chip-input">
      <span id="qChips"></span>
      <input type="text" id="q" placeholder="Begriff + Enter, -Begriff für Ausschluss">
    </div>
  </div>
  <div class="control"><label style="visibility:hidden">Archiv</label><button type="button" id="toggleArchivedBtn"></button></div>
  <div id="count"></div>
</div>

<main>
  <table id="jobTable">
    <colgroup id="colgroup"></colgroup>
    <thead><tr id="headRow"></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</main>

<dialog id="modal">
  <div class="modal-head">
    <h2 id="mTitle"></h2>
    <button class="close" onclick="document.getElementById('modal').close()">Schließen ✕</button>
  </div>
  <div class="modal-body" id="mBody"></div>
</dialog>

<dialog id="filterModal">
  <div class="modal-head">
    <h2 id="filterModalTitle"></h2>
    <button class="close" onclick="document.getElementById('filterModal').close()">Schließen ✕</button>
  </div>
  <div class="modal-body" id="filterModalBody"></div>
</dialog>

<script id="data" type="application/json">${json}</script>
<script>
"use strict";
var DATA = JSON.parse(document.getElementById("data").textContent);
var JOBS = DATA.jobs;
var TABLES = DATA.tabellen;

/* ---------- Stufe & Brutto ---------- */
// §27 BBesG (Bund): Stufenaufstieg nach 2, dann 3×3, dann 3×4 Jahren
var BESOLDUNG_STUFEN = [[23,"8"],[19,"7"],[15,"6"],[11,"5"],[8,"4"],[5,"3"],[2,"2"],[0,"1"]];
// TVöD: Stufe 2 ab 1 Jahr, 3 ab 3, 4 ab 6, 5 ab 10, 6 ab 15 Jahren
var ENTGELT_STUFEN = [[15,"6"],[10,"5"],[6,"4"],[3,"3"],[1,"2"],[0,"1"]];

function stufeFor(system, years) {
  var rules = system === "besoldung" ? BESOLDUNG_STUFEN : ENTGELT_STUFEN;
  for (var i = 0; i < rules.length; i++) if (years >= rules[i][0]) return rules[i][1];
  return "1";
}

// nimmt die gewünschte Stufe oder die nächstliegende, die es in der Tabelle gibt
function lookupValue(table, gruppe, wunschStufe) {
  var werte = table.gruppen[gruppe];
  if (!werte) return null;
  var stufen = table.stufen.filter(function (s) { return werte[s] != null; });
  if (stufen.length === 0) return null;
  var best = stufen[0], bestDist = 1e9;
  for (var i = 0; i < stufen.length; i++) {
    var dist = Math.abs(parseFloat(stufen[i]) - parseFloat(wunschStufe));
    if (dist < bestDist) { bestDist = dist; best = stufen[i]; }
  }
  return { stufe: best, wert: werte[best] };
}

function bruttoFor(job, years) {
  var hits = [];
  var approx = false;
  for (var i = 0; i < job.gehaltMatches.length; i++) {
    var m = job.gehaltMatches[i];
    var table = TABLES[m.tabelleId];
    if (!table) continue;
    var hit = lookupValue(table, m.gruppe, stufeFor(table.system, years));
    if (hit) {
      hits.push({ wert: hit.wert, stufe: hit.stufe, gruppe: m.gruppe, tabelle: table.titel });
      if (m.score < 0.95) approx = true;
    }
  }
  if (hits.length === 0) return null;
  var min = Infinity, max = -Infinity;
  for (var j = 0; j < hits.length; j++) { min = Math.min(min, hits[j].wert); max = Math.max(max, hits[j].wert); }
  return { min: min, max: max, approx: approx, hits: hits };
}

function euro(value) {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €";
}

/* ---------- Keyword-Match ---------- */
function parseKeywords(raw) {
  return (raw || "")
    .toLowerCase()
    .split(/[,;\\n]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 1; });
}
/** Wie parseKeywords, aber ohne Kleinschreibung — für die Chip-Anzeige im Filter-Modal. */
function splitKeywordsRaw(raw) {
  return (raw || "")
    .split(/[,;\\n]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 1; });
}
function searchableText(job) {
  return [
    job.titel, job.employer || "", job.beschreibung || "", job.gehaltsstufe || "",
    job.dienstorte.join(" "), job.laufbahn.join(" "),
    (job.voraussetzungenZwingend || []).join(" "), (job.voraussetzungenWuenschenswert || []).join(" "),
  ].join(" \\n ").toLowerCase();
}
function matchScore(job, keywords) {
  if (!keywords.length) return null;
  var text = searchableText(job);
  var hit = 0;
  for (var i = 0; i < keywords.length; i++) if (text.indexOf(keywords[i]) !== -1) hit++;
  return Math.round((hit / keywords.length) * 100);
}

/* ---------- Hilfen ---------- */
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Wandelt http(s)-Links im (bereits escapten) Text in gut lesbare Buttons um. */
function linkify(escapedText) {
  return escapedText.replace(/(https?:\\/\\/[^\\s<]+)/g, function (url) {
    var isPdf = /\\.pdf(\\?|$)/i.test(url);
    var label = isPdf ? "📄 PDF öffnen" : "🔗 Link öffnen";
    return '<a class="link-btn" href="' + url + '" target="_blank" rel="noopener">' + label + " ↗</a>";
  });
}
/** Domain, von der ein Angebot stammt — aus dem Link abgeleitet (nicht aus dem Adapter-Namen). */
function jobDomain(job) {
  try {
    return new URL(job.link).hostname.replace(/^www\\./, "");
  } catch (e) {
    return "";
  }
}
function hashText(text) { // djb2 — Schlüssel für abgehakte Voraussetzungen
  var h = 5381, s = text.toLowerCase().replace(/\\s+/g, " ").trim();
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
/** Dice-Koeffizient über Bigramme — generische String-Ähnlichkeit (0..1). */
function textSimilarity(a, b) {
  function bigrams(value) {
    var map = {}, s = value.toLowerCase().replace(/\\s+/g, "");
    for (var i = 0; i < s.length - 1; i++) { var g = s.substr(i, 2); map[g] = (map[g] || 0) + 1; }
    return map;
  }
  var ma = bigrams(a), mb = bigrams(b), overlap = 0, total = 0;
  for (var k in ma) { overlap += Math.min(ma[k], mb[k] || 0); total += ma[k]; }
  for (var k2 in mb) total += mb[k2];
  return total === 0 ? 0 : (2 * overlap) / total;
}
function fmtDate(iso) {
  if (!iso) return "";
  var p = iso.split("-");
  return p[2] + "." + p[1] + "." + p[0];
}
function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
}
function befristungKurz(text) {
  return /^unbefristet/i.test(text) ? "Unbefristet" : /befristet/i.test(text) ? "Befristet" : text;
}
function loadJson(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

/* ---------- Status (Stern / Beworben / Archiv / neutral) ---------- */
var STATUS_LABELS = { star: "★ Stern", beworben: "📨 Beworben", archiv: "🗄 Archiviert", neutral: "Kein Status" };
var STATUS_FILTER_OPTIONS = ["★ Stern", "📨 Beworben", "🗄 Archiviert", "Kein Status"];
var statusMap = loadJson("jobsearch.status", {});
function getStatus(id) { return statusMap[id] || "neutral"; }
function statusLabel(id) { return STATUS_LABELS[getStatus(id)]; }
function setStatus(id, status) {
  if (status === "neutral") delete statusMap[id]; else statusMap[id] = status;
}
function persistStatus() { saveJson("jobsearch.status", statusMap); }
function toggleStatus(code, id) {
  setStatus(id, getStatus(id) === code ? "neutral" : code);
  persistStatus();
  render();
}
// Migration von der alten getrennten Stern/Archiv-Speicherung (vor Status-Umbau)
(function migrateLegacyMarkers() {
  var legacyStarred = loadJson("jobsearch.starred", null);
  var legacyArchived = loadJson("jobsearch.archived", null);
  if (!legacyStarred && !legacyArchived) return;
  (legacyStarred || []).forEach(function (id) { if (!statusMap[id]) statusMap[id] = "star"; });
  (legacyArchived || []).forEach(function (id) { statusMap[id] = "archiv"; });
  persistStatus();
  localStorage.removeItem("jobsearch.starred");
  localStorage.removeItem("jobsearch.archived");
})();

/* ---------- Notizen ---------- */
function getNote(id) { return localStorage.getItem("jobsearch.note." + id) || ""; }
function setNote(id, text) {
  if (text) localStorage.setItem("jobsearch.note." + id, text);
  else localStorage.removeItem("jobsearch.note." + id);
}

/* ---------- Zustand ---------- */
var LAUFBAHN_OPTIONS = ["Einfacher Dienst", "Mittlerer Dienst", "Gehobener Dienst", "Höherer Dienst", "Ohne Angabe"];
var DEFAULT_COLUMN_ORDER = ["status", "titel", "employer", "domain", "orte", "frist", "befristung", "arbeitszeit", "laufbahn", "remote", "beamte", "entgelt", "brutto", "match", "notizen"];
var DEFAULT_WIDTHS = {
  status: 140, titel: 320, employer: 150, domain: 150, orte: 150, frist: 140, befristung: 130,
  arbeitszeit: 110, laufbahn: 150, remote: 80, beamte: 100, entgelt: 170, brutto: 120, match: 130, notizen: 220,
};

var quelleNamen = Array.from(new Set(JOBS.map(function (j) { return j.adapter; }))).sort();
var domainNamen = Array.from(new Set(JOBS.map(jobDomain).filter(Boolean))).sort();
var entgeltNamen = Array.from(new Set(JOBS.map(function (j) { return j.gehaltsstufe || j.gehalt || ""; }).filter(Boolean))).sort();

/* ---------- Voraussetzungen: Zustand pro Text-Hash (check/false/unbekannt) ---------- */
// Alle unterschiedlichen Anforderungstexte über alle Jobs, für die Ähnlichkeitssuche.
var ALL_REQUIREMENTS = (function () {
  var seen = {}, list = [];
  JOBS.forEach(function (job) {
    (job.voraussetzungenZwingend || []).concat(job.voraussetzungenWuenschenswert || []).forEach(function (text) {
      var hash = hashText(text);
      if (!seen[hash]) { seen[hash] = true; list.push({ text: text, hash: hash }); }
    });
  });
  return list;
})();
function getReqState(hash) {
  var raw = localStorage.getItem("jobsearch.skill." + hash);
  if (raw === "1") return "check"; // Migration von der alten reinen Boolean-Speicherung
  return raw || undefined;
}
function setReqState(hash, state) {
  var key = "jobsearch.skill." + hash;
  if (state) localStorage.setItem(key, state); else localStorage.removeItem(key);
}
/** Sucht unter allen ANDEREN bereits markierten Anforderungstexten den ähnlichsten. */
function findReferenceState(text, ownHash) {
  var best = null, bestScore = 0.5; // Schwelle: unter 0.5 zu unähnlich
  for (var i = 0; i < ALL_REQUIREMENTS.length; i++) {
    var item = ALL_REQUIREMENTS[i];
    if (item.hash === ownHash) continue;
    var state = getReqState(item.hash);
    if (!state) continue;
    var score = textSimilarity(text, item.text);
    if (score > bestScore) { bestScore = score; best = state; }
  }
  return best;
}

function fromList(list, value) {
  var obj = {};
  list.forEach(function (name) { obj[name] = value; });
  return obj;
}
function defaultFilters() {
  return {
    titel: "", employer: "", orte: "", entgelt: "",
    frist: "", brutto: "", bruttoIncludeUnknown: false, keywords: "",
    befristung: { "Unbefristet": true, "Befristet": true, "Ohne Angabe": true },
    arbeitszeit: { "Vollzeit": true, "Teilzeit": true, "Ohne Angabe": true },
    laufbahn: fromList(LAUFBAHN_OPTIONS, true),
    remote: { "Ja": true, "Nein": true },
    beamte: { "Ja": true, "Nein": true },
    quelle: fromList(quelleNamen, true),
    domain: fromList(domainNamen, true),
    entgeltWerte: fromList(entgeltNamen, true),
    status: { "★ Stern": true, "📨 Beworben": true, "🗄 Archiviert": false, "Kein Status": true },
  };
}

var state = {
  years: parseInt(localStorage.getItem("jobsearch.years") || "0", 10) || 0,
  sortCol: "frist",
  sortDir: 1,
  columnOrder: loadJson("jobsearch.columnOrder", DEFAULT_COLUMN_ORDER.slice()),
  hiddenColumns: loadJson("jobsearch.hiddenColumns", []),
  columnWidths: loadJson("jobsearch.columnWidths", {}),
  filters: loadJson("jobsearch.filters", defaultFilters()),
  q: "",
  searchChips: loadJson("jobsearch.searchChips", []),
  selected: new Set(),
};
function persistSearchChips() { saveJson("jobsearch.searchChips", state.searchChips); }
// Migration: alte Spalten-ID "aktionen" → "status" (an gleicher Position)
(function migrateColumnId() {
  var idx = state.columnOrder.indexOf("aktionen");
  if (idx !== -1) state.columnOrder[idx] = "status";
})();
// neue Spalten (z.B. nach einem Update) hinten anhängen, falls im gespeicherten Zustand nicht vorhanden
DEFAULT_COLUMN_ORDER.forEach(function (id) {
  if (state.columnOrder.indexOf(id) === -1) state.columnOrder.push(id);
});
// Fehlende Filter-Felder ergänzen (z.B. weil jobsearch.filters noch aus einer
// älteren Version stammt, die "status"/"entgeltWerte"/... noch nicht kannte).
(function fillMissingFilterDefaults() {
  var fresh = defaultFilters();
  for (var key in fresh) {
    if (state.filters[key] == null) state.filters[key] = fresh[key];
  }
})();
// neue Quellen/Entgelt-Werte (z.B. nach neuem Crawl) nachtragen, Default: sichtbar
quelleNamen.forEach(function (name) { if (!(name in state.filters.quelle)) state.filters.quelle[name] = true; });
domainNamen.forEach(function (name) { if (!(name in state.filters.domain)) state.filters.domain[name] = true; });
entgeltNamen.forEach(function (name) { if (!(name in state.filters.entgeltWerte)) state.filters.entgeltWerte[name] = true; });
STATUS_FILTER_OPTIONS.forEach(function (label) { if (!(label in state.filters.status)) state.filters.status[label] = label !== "🗄 Archiviert"; });

function persistFilters() { saveJson("jobsearch.filters", state.filters); }
function persistColumns() {
  saveJson("jobsearch.columnOrder", state.columnOrder);
  saveJson("jobsearch.hiddenColumns", state.hiddenColumns);
}
function persistWidths() { saveJson("jobsearch.columnWidths", state.columnWidths); }

/* ---------- Spalten-Definitionen ---------- */
function statusIconsHtml(job) {
  var s = getStatus(job.id);
  function btn(code, icon, title) {
    return '<button type="button" class="marker-btn ' + code + (s === code ? " active" : "") + '" data-status-btn="' + code + '" data-job-id="' + esc(job.id) + '" title="' + title + '">' + icon + "</button>";
  }
  return btn("star", "★", "Als Stern markieren / Markierung aufheben") +
    btn("beworben", "📨", "Als Beworben markieren / Markierung aufheben") +
    btn("archiv", "🗄", "Archivieren / aus Archiv zurückholen");
}

var COLUMN_DEFS = {
  status: {
    label: "Status", cellClass: "status-cell", filterType: "multi", filterOptions: STATUS_FILTER_OPTIONS,
    sort: function (j) { var s = getStatus(j.id); return (s === "star" || s === "beworben") ? 0 : (s === "archiv" ? 2 : 1); },
    html: function (j) {
      var checked = state.selected.has(j.id);
      return '<input type="checkbox" class="row-select" data-select="' + esc(j.id) + '"' + (checked ? " checked" : "") + ">" + statusIconsHtml(j);
    },
  },
  titel: {
    label: "Titel", cellClass: "titel", filterType: "text", filterLabel: "Titel enthält",
    sort: function (j) { return j.titel.toLowerCase(); },
    html: function (j) { return esc(j.titel); },
  },
  employer: {
    label: "Arbeitgeber", filterType: "text", filterLabel: "Arbeitgeber enthält",
    sort: function (j) { return (j.employer || "").toLowerCase(); },
    html: function (j) { return esc(j.employer || ""); },
  },
  domain: {
    label: "Webseite", filterType: "multi", filterOptions: domainNamen,
    sort: function (j) { return jobDomain(j); },
    html: function (j) { var d = jobDomain(j); return d ? esc(d) : '<span class="muted">—</span>'; },
  },
  orte: {
    label: "Dienstort", filterType: "text", filterLabel: "Ort enthält",
    sort: function (j) { return j.dienstorte.join(", ").toLowerCase(); },
    html: function (j) { return esc(j.dienstorte.join(", ")); },
  },
  frist: {
    label: "Frist", cellClass: "frist", filterType: "date-before", filterLabel: "Frist bis",
    sort: function (j) { return j.bewerbungsfrist || "9999-12-31"; },
    html: function (j) {
      if (!j.bewerbungsfrist) return '<span class="muted">—</span>';
      var days = daysUntil(j.bewerbungsfrist);
      return fmtDate(j.bewerbungsfrist) +
        ' <span class="frist-rel' + (days <= 7 ? " frist-soon" : "") + '">(' + (days < 0 ? "abgelaufen" : days + " T") + ")</span>";
    },
  },
  befristung: {
    label: "Befristung", filterType: "multi", filterOptions: ["Unbefristet", "Befristet", "Ohne Angabe"],
    sort: function (j) { return j.befristung.join(",") || "zz"; },
    html: function (j) { return j.befristung.length ? chips(j.befristung) : '<span class="muted">—</span>'; },
  },
  arbeitszeit: {
    label: "Arbeitszeit", filterType: "multi", filterOptions: ["Vollzeit", "Teilzeit", "Ohne Angabe"],
    sort: function (j) { return j.arbeitszeit.join(",") || "zz"; },
    html: function (j) { return j.arbeitszeit.length ? chips(j.arbeitszeit) : '<span class="muted">—</span>'; },
  },
  laufbahn: {
    label: "Laufbahn", filterType: "multi", filterOptions: LAUFBAHN_OPTIONS,
    sort: function (j) { return j.laufbahn.join(",") || "zz"; },
    html: function (j) { return j.laufbahn.length ? chips(j.laufbahn, "laufbahn") : '<span class="muted">—</span>'; },
  },
  remote: {
    label: "Remote", filterType: "multi", filterOptions: ["Ja", "Nein"],
    sort: function (j) { return j.homeoffice ? 0 : 1; },
    html: function (j) { return j.homeoffice ? '<span class="bool-yes" title="' + esc(j.homeoffice) + '">✓</span>' : '<span class="bool-no">—</span>'; },
  },
  beamte: {
    label: "Verbeamtung", filterType: "multi", filterOptions: ["Ja", "Nein"],
    sort: function (j) { return j.verbeamtung ? 0 : 1; },
    html: function (j) { return j.verbeamtung ? '<span class="bool-yes">✓</span>' : '<span class="bool-no">—</span>'; },
  },
  entgelt: {
    label: "Entgelt", filterType: "text", filterLabel: "Entgelt enthält",
    sort: function (j) { return j.gehaltsstufe || j.gehalt || "zz"; },
    html: function (j) {
      if (j.gehaltsstufe) {
        return '<span class="chip grade" data-chip-filter="entgeltWerte" data-chip-value="' + esc(j.gehaltsstufe) +
          '" title="' + esc(j.gehaltsstufe) + ' — klicken zum Filtern">' + esc(j.gehaltsstufe) + "</span>";
      }
      return j.gehalt ? esc(j.gehalt) : '<span class="muted">—</span>';
    },
  },
  brutto: {
    label: "Brutto/Monat", cellClass: "num", filterType: "number-min", filterLabel: "Brutto min. €",
    sort: function (j) { var b = bruttoFor(j, state.years); return b ? -b.max : 1; },
    html: function (j) {
      var b = bruttoFor(j, state.years);
      if (!b) return '<span class="muted">—</span>';
      return (b.approx ? "≈ " : "") + (b.min === b.max ? euro(b.min) : euro(b.min) + " – " + euro(b.max));
    },
  },
  match: {
    label: "Keyword-Match", cellClass: "num", filterType: "keywords",
    sort: function (j) { var s = matchScore(j, parseKeywords(state.filters.keywords)); return -(s == null ? -1 : s); },
    html: function (j) {
      var s = matchScore(j, parseKeywords(state.filters.keywords));
      if (s == null) return '<span class="muted">—</span>';
      return '<span class="match-bar"><span class="track"><span class="fill" style="width:' + s + '%"></span></span>' + s + "%</span>";
    },
  },
  notizen: {
    label: "Notizen", filterType: "none",
    sort: function (j) { return getNote(j.id) ? 0 : 1; },
    html: function (j) { return '<input type="text" class="note-input" data-note="' + esc(j.id) + '" value="' + esc(getNote(j.id)) + '" placeholder="Notiz…">'; },
  },
};

/* ---------- Rendern ---------- */
function chips(list, className) {
  var html = "";
  for (var i = 0; i < list.length; i++) {
    var extra = className ? className : (/^unbefristet/i.test(list[i]) ? "unbefristet" : /befristet/i.test(list[i]) ? "befristet" : "");
    html += '<span class="chip ' + extra + '" title="' + esc(list[i]) + '">' + esc(befristungKurz(list[i])) + "</span>";
  }
  return html;
}

function visibleColumns() {
  return state.columnOrder.filter(function (id) { return state.hiddenColumns.indexOf(id) === -1 && COLUMN_DEFS[id]; });
}

function rowHtml(job, index) {
  var cols = visibleColumns();
  var tds = "";
  for (var i = 0; i < cols.length; i++) {
    var def = COLUMN_DEFS[cols[i]];
    tds += '<td class="' + (def.cellClass || "") + '">' + def.html(job) + "</td>";
  }
  var s = getStatus(job.id);
  var rowClass = s === "star" ? " starred-row" : s === "beworben" ? " beworben-row" : s === "archiv" ? " archived-row" : "";
  return "<tr data-index='" + index + "' class='" + rowClass.trim() + "'>" + tds + "</tr>";
}

/* Chip-Spalten (Befristung/Arbeitszeit/Laufbahn): Job passt, wenn mindestens
   einer seiner Werte (oder "Ohne Angabe", falls leer) angehakt ist. */
function passesChipFilter(values, mapping, mapLabel) {
  var labels = values.length ? values.map(mapLabel || function (v) { return v; }) : ["Ohne Angabe"];
  for (var i = 0; i < labels.length; i++) if (mapping[labels[i]] !== false) return true;
  return false;
}
function passesBoolFilter(value, mapping) {
  return mapping[value ? "Ja" : "Nein"] !== false;
}
function passesText(haystack, needle) {
  if (!needle) return true;
  return haystack.toLowerCase().indexOf(needle.toLowerCase()) !== -1;
}

// Bewusst OHNE Voraussetzungen: die enthalten fast immer "Studium" o.ä. als
// Standard-Anforderung, wodurch negative Keywords sonst fast alles ausschließen würden.
function searchHaystack(job) {
  return (job.titel + " " + (job.employer || "") + " " + (job.beschreibung || "") + " " +
    (job.referenzcode || "") + " " + job.dienstorte.join(" ")
  ).toLowerCase();
}

function applyFilters() {
  var f = state.filters;
  // "-Begriff" wirkt schon beim Tippen als Ausschluss, noch bevor er per Enter zum Chip wird.
  var rawQuery = state.q || "";
  var liveNegative = rawQuery.charAt(0) === "-";
  var liveQuery = (liveNegative ? rawQuery.slice(1) : rawQuery).trim().toLowerCase();

  return JOBS.filter(function (job) {
    if (f.status[statusLabel(job.id)] === false) return false;
    // ★ Stern und 📨 Beworben bleiben unabhängig von allen anderen Filtern sichtbar —
    // einzig der Status-Filter selbst (oben) kann sie noch gezielt ausblenden.
    var status = getStatus(job.id);
    if (status === "star" || status === "beworben") return true;
    if (f.quelle[job.adapter] === false) return false;
    if (f.domain[jobDomain(job)] === false) return false;
    if (f.entgeltWerte[(job.gehaltsstufe || job.gehalt || "")] === false) return false;
    if (!passesText(job.titel, f.titel)) return false;
    if (!passesText(job.employer || "", f.employer)) return false;
    if (!passesText(job.dienstorte.join(", "), f.orte)) return false;
    if (!passesText((job.gehaltsstufe || job.gehalt || ""), f.entgelt)) return false;
    if (!passesChipFilter(job.befristung, f.befristung, befristungKurz)) return false;
    if (!passesChipFilter(job.arbeitszeit, f.arbeitszeit)) return false;
    if (!passesChipFilter(job.laufbahn, f.laufbahn)) return false;
    if (!passesBoolFilter(!!job.homeoffice, f.remote)) return false;
    if (!passesBoolFilter(job.verbeamtung, f.beamte)) return false;
    if (f.frist && (!job.bewerbungsfrist || job.bewerbungsfrist > f.frist)) return false;
    if (f.brutto) {
      var minBrutto = parseFloat(f.brutto);
      if (!isNaN(minBrutto)) {
        var b = bruttoFor(job, state.years);
        if (!b) {
          if (!f.bruttoIncludeUnknown) return false;
        } else if (b.max < minBrutto) {
          return false;
        }
      }
    }
    var haystack = searchHaystack(job);
    for (var i = 0; i < state.searchChips.length; i++) {
      var chip = state.searchChips[i];
      var contains = haystack.indexOf(chip.text.toLowerCase()) !== -1;
      if (chip.negative && contains) return false;
      if (!chip.negative && !contains) return false;
    }
    if (liveQuery) {
      var liveContains = haystack.indexOf(liveQuery) !== -1;
      if (liveNegative && liveContains) return false;
      if (!liveNegative && !liveContains) return false;
    }
    return true;
  });
}

var currentList = [];
// Arbeitsstand der Keyword-Chips, während das Filter-Modal offen ist (null = Modal zeigt
// gerade keinen Keyword-Filter). Erst beim Schließen des Modals in state.filters übernommen.
var pendingKeywords = null;
function render() {
  var list = applyFilters();
  var def = COLUMN_DEFS[state.sortCol];
  list.sort(function (a, b) {
    // Stern & Beworben rutschen immer nach oben, unabhängig von der gewählten Sortierung
    function prio(j) { var s = getStatus(j.id); return (s === "star" || s === "beworben") ? 0 : 1; }
    var pa = prio(a), pb = prio(b);
    if (pa !== pb) return pa - pb;
    if (!def) return 0;
    var va = def.sort(a), vb = def.sort(b);
    return (va < vb ? -1 : va > vb ? 1 : 0) * state.sortDir;
  });
  currentList = list;

  var html = "";
  for (var i = 0; i < list.length; i++) html += rowHtml(list[i], i);
  document.getElementById("rows").innerHTML = html;
  // Ausgeblendete (z.B. archivierte) Jobs zählen auch im Nenner nicht mit — wie ein Filter.
  var totalConsidered = JOBS.filter(function (job) { return state.filters.status[statusLabel(job.id)] !== false; }).length;
  document.getElementById("count").textContent = list.length + " von " + totalConsidered + " Angeboten";

  renderTableStructure();
  updateArchivedToggleBtn();

  var bes = stufeFor("besoldung", state.years), ent = stufeFor("entgelt", state.years);
  document.getElementById("stufenInfo").innerHTML =
    "TVöD <b>Stufe " + ent + "</b> · Besoldung <b>Stufe " + bes + "</b>";
}

/* ---------- Archiv-Sichtbarkeit: schneller Umschalt-Button ---------- */
function updateArchivedToggleBtn() {
  var shown = state.filters.status["🗄 Archiviert"] !== false;
  var btn = document.getElementById("toggleArchivedBtn");
  btn.textContent = shown ? "🗄 Archivierte ausblenden" : "🗄 Archivierte anzeigen";
  btn.classList.toggle("active", shown);
}
document.getElementById("toggleArchivedBtn").addEventListener("click", function () {
  state.filters.status["🗄 Archiviert"] = !(state.filters.status["🗄 Archiviert"] !== false);
  persistFilters();
  render();
});

/* ---------- Kopfzeile: Label (öffnet Filter-Modal) + Sortier-Icon + Resize-Griff ---------- */
function countDiff(current, base) {
  var n = 0;
  for (var key in base) if (current[key] !== base[key]) n++;
  return n;
}
function activeFilterCount(colId) {
  var def = COLUMN_DEFS[colId];
  var f = state.filters;
  var fresh = defaultFilters();
  var n = 0;
  if (def.filterType === "text" || def.filterType === "date-before" || def.filterType === "number-min") {
    if (f[colId]) n++;
  } else if (def.filterType === "keywords") {
    if (f.keywords) n++;
  } else if (def.filterType === "multi") {
    n += countDiff(f[colId], fresh[colId]);
  }
  if (colId === "employer") n += countDiff(f.quelle, fresh.quelle);
  if (colId === "entgelt") n += countDiff(f.entgeltWerte, fresh.entgeltWerte);
  if (colId === "brutto" && f.bruttoIncludeUnknown !== fresh.bruttoIncludeUnknown) n++;
  return n;
}

function renderTableStructure() {
  var cols = visibleColumns();

  var colHtml = "";
  for (var g = 0; g < cols.length; g++) {
    var w = state.columnWidths[cols[g]] || DEFAULT_WIDTHS[cols[g]] || 120;
    colHtml += '<col data-col="' + cols[g] + '" style="width:' + w + 'px">';
  }
  colHtml += '<col style="width:40px">'; // "+"-Spalte
  document.getElementById("colgroup").innerHTML = colHtml;

  var head = "";
  for (var c = 0; c < cols.length; c++) {
    var id = cols[c];
    var def = COLUMN_DEFS[id];

    if (id === "status" && state.selected.size > 0) {
      head += '<th data-col="status"><span class="th-inner">' +
        '<span class="sel-badge">' + state.selected.size + " ausgewählt</span>" +
        '<button type="button" id="assignStatusBtn">Status zuweisen</button>' +
        '<button type="button" id="clearSelectionBtn" title="Auswahl aufheben">✕</button>' +
        "</span>" +
        '<span class="th-resize" data-resize="status" draggable="false"></span></th>';
      continue;
    }

    var isActiveSort = id === state.sortCol;
    var badge = def.filterType === "none" ? 0 : activeFilterCount(id);
    var sortIcon = isActiveSort ? (state.sortDir === 1 ? "▲" : "▼") : "↕";
    head += '<th data-col="' + id + '" draggable="true"><span class="th-inner">' +
      '<span class="th-label" data-th-action="filter" data-col="' + id + '">' + esc(def.label) +
        (badge > 0 ? '<span class="filter-badge">' + badge + "</span>" : "") +
      "</span>" +
      '<button type="button" class="th-sort' + (isActiveSort ? " active" : "") + '" data-th-action="sort" data-col="' + id + '" title="sortieren">' + sortIcon + "</button>" +
      "</span>" +
      '<span class="th-resize" data-resize="' + id + '" draggable="false"></span>' +
      "</th>";
  }
  head += '<th class="th-add"><button type="button" id="addColumnBtn" title="Spalte einblenden">+</button></th>';
  document.getElementById("headRow").innerHTML = head;
}

/* ---------- Drag & Drop: Spalten umsortieren ---------- */
var dragColId = null;
var headRowEl = document.getElementById("headRow");
headRowEl.addEventListener("dragstart", function (event) {
  if (event.target.closest("[data-resize]")) { event.preventDefault(); return; }
  var th = event.target.closest("th[data-col]");
  if (!th) { event.preventDefault(); return; }
  dragColId = th.dataset.col;
  th.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", dragColId);
});
headRowEl.addEventListener("dragover", function (event) {
  if (!dragColId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  var th = event.target.closest("th");
  document.querySelectorAll("#headRow th.drag-over").forEach(function (el) { el.classList.remove("drag-over"); });
  if (th && th.dataset.col !== dragColId) th.classList.add("drag-over");
});
headRowEl.addEventListener("dragleave", function (event) {
  var th = event.target.closest("th");
  if (th) th.classList.remove("drag-over");
});
headRowEl.addEventListener("drop", function (event) {
  event.preventDefault();
  document.querySelectorAll("#headRow th.drag-over").forEach(function (el) { el.classList.remove("drag-over"); });
  if (!dragColId) return;
  var order = state.columnOrder;
  var fromIdx = order.indexOf(dragColId);
  var addTh = event.target.closest(".th-add");
  if (addTh) {
    order.splice(fromIdx, 1);
    order.push(dragColId);
  } else {
    var targetTh = event.target.closest("th[data-col]");
    if (!targetTh || targetTh.dataset.col === dragColId) { dragColId = null; return; }
    var toIdx = order.indexOf(targetTh.dataset.col);
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, dragColId);
  }
  persistColumns();
  dragColId = null;
  render();
});
headRowEl.addEventListener("dragend", function () {
  document.querySelectorAll("#headRow th.dragging, #headRow th.drag-over").forEach(function (el) {
    el.classList.remove("dragging");
    el.classList.remove("drag-over");
  });
  dragColId = null;
});

/* ---------- Spaltenbreite per Drag ---------- */
var resizing = null;
headRowEl.addEventListener("mousedown", function (event) {
  var handle = event.target.closest("[data-resize]");
  if (!handle) return;
  event.preventDefault();
  event.stopPropagation();
  var colId = handle.dataset.resize;
  var col = document.querySelector('#colgroup col[data-col="' + colId + '"]');
  // col.getBoundingClientRect() liefert bei <col>-Elementen in Chrome Unsinn
  // (nicht die tatsächliche Spaltenbreite) — daher die inline gesetzte Breite lesen.
  var startWidth = col && col.style.width ? parseFloat(col.style.width) : (DEFAULT_WIDTHS[colId] || 120);
  resizing = { colId: colId, startX: event.clientX, startWidth: startWidth };
  handle.classList.add("active");
  document.body.style.cursor = "col-resize";
});
document.addEventListener("mousemove", function (event) {
  if (!resizing) return;
  var newWidth = Math.max(50, resizing.startWidth + (event.clientX - resizing.startX));
  var col = document.querySelector('#colgroup col[data-col="' + resizing.colId + '"]');
  if (col) col.style.width = newWidth + "px";
});
document.addEventListener("mouseup", function () {
  if (!resizing) return;
  var col = document.querySelector('#colgroup col[data-col="' + resizing.colId + '"]');
  if (col) state.columnWidths[resizing.colId] = Math.round(parseFloat(col.style.width));
  persistWidths();
  document.querySelectorAll(".th-resize.active").forEach(function (el) { el.classList.remove("active"); });
  resizing = null;
  document.body.style.cursor = "";
});

/* ---------- Spalten ein-/ausblenden ---------- */
function openHiddenColumnsModal() {
  document.getElementById("filterModalTitle").textContent = "Spalte einblenden";
  var hidden = state.columnOrder.filter(function (id) { return state.hiddenColumns.indexOf(id) !== -1 && COLUMN_DEFS[id]; });
  var html;
  if (!hidden.length) {
    html = '<p class="muted">Keine ausgeblendeten Spalten.</p>';
  } else {
    html = '<div class="hidden-col-list">';
    hidden.forEach(function (id) {
      html += '<button type="button" class="hidden-col-btn" data-show-col="' + id + '">+ ' + esc(COLUMN_DEFS[id].label) + "</button>";
    });
    html += "</div>";
  }
  document.getElementById("filterModalBody").innerHTML = html;
  document.getElementById("filterModal").showModal();
}

/* ---------- Status per Mehrfachauswahl zuweisen ---------- */
function openAssignStatusModal() {
  document.getElementById("filterModalTitle").textContent = "Status zuweisen (" + state.selected.size + " Jobs)";
  var html = '<div class="hidden-col-list">' +
    '<button type="button" class="hidden-col-btn" data-assign="star">★ Stern</button>' +
    '<button type="button" class="hidden-col-btn" data-assign="beworben">📨 Beworben</button>' +
    '<button type="button" class="hidden-col-btn" data-assign="archiv">🗄 Archiv</button>' +
    '<button type="button" class="hidden-col-btn" data-assign="neutral">✕ Neutral/Aufheben</button>' +
    "</div>";
  document.getElementById("filterModalBody").innerHTML = html;
  document.getElementById("filterModal").showModal();
}

/* ---------- Chip-Klick: einzelnen Wert direkt aus der Tabelle heraus filtern ---------- */
function openChipFilterModal(mapKey, value) {
  document.getElementById("filterModalTitle").textContent = value;
  var html = '<p class="muted" style="margin-top:0">Wie soll dieser Wert gefiltert werden?</p>' +
    '<div class="hidden-col-list">' +
    '<button type="button" class="hidden-col-btn" data-chip-action="only" data-chip-map="' + esc(mapKey) + '" data-chip-value="' + esc(value) + '">Nur diesen Wert anzeigen</button>' +
    '<button type="button" class="hidden-col-btn" data-chip-action="exclude" data-chip-map="' + esc(mapKey) + '" data-chip-value="' + esc(value) + '">Diesen Wert ausblenden</button>' +
    "</div>";
  document.getElementById("filterModalBody").innerHTML = html;
  document.getElementById("filterModal").showModal();
}

/* ---------- Spalten-Filter-Modal ---------- */
function filterFieldHtml(colId, label, value, type) {
  return '<div class="filter-field"><label for="ff-' + colId + '">' + esc(label) + '</label>' +
    '<input id="ff-' + colId + '" type="' + type + '" data-filter-' + type + '="' + colId + '" value="' + esc(value) + '"></div>';
}
function multiFilterHtml(colId, options, mapping, heading) {
  var html = heading !== false ? "<h4>" + esc(heading || COLUMN_DEFS[colId].label) + "</h4>" : "";
  html += '<div class="filter-checks">';
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var checked = mapping[opt] !== false;
    var display = opt.length > 70 ? opt.slice(0, 70) + "…" : opt;
    html += '<label title="' + esc(opt) + '"><input type="checkbox" data-filter-multi="' + colId + '" data-value="' + esc(opt) + '"' + (checked ? " checked" : "") + ">" + esc(display) + "</label>";
  }
  return html + "</div>";
}

function openFilterModal(colId) {
  var def = COLUMN_DEFS[colId];
  if (!def) return;
  document.getElementById("filterModalTitle").textContent = def.label;
  var html = "";
  if (def.filterType === "text") {
    html += filterFieldHtml(colId, def.filterLabel, state.filters[colId], "text");
    if (colId === "employer") html += multiFilterHtml("quelle", quelleNamen, state.filters.quelle, "Quelle");
    if (colId === "entgelt") html += multiFilterHtml("entgeltWerte", entgeltNamen, state.filters.entgeltWerte, "Vorhandene Werte");
  } else if (def.filterType === "date-before") {
    html += filterFieldHtml(colId, def.filterLabel, state.filters[colId], "date");
  } else if (def.filterType === "number-min") {
    html += filterFieldHtml(colId, def.filterLabel, state.filters[colId], "number");
    if (colId === "brutto") {
      html += '<div class="filter-checks"><label><input type="checkbox" data-filter-checkbox="bruttoIncludeUnknown"' +
        (state.filters.bruttoIncludeUnknown ? " checked" : "") + "> Jobs ohne Gehaltsangabe trotzdem anzeigen</label></div>";
    }
  } else if (def.filterType === "keywords") {
    pendingKeywords = splitKeywordsRaw(state.filters.keywords);
    html += '<div class="filter-field"><label for="ff-keywords">Keywords</label>' +
      '<div class="chip-input"><span id="keywordChips"></span>' +
      '<input id="ff-keywords" type="text" placeholder="Begriff + Enter oder Komma"></div></div>' +
      '<p class="muted" style="font-size:12px;margin-top:-6px">Wird erst beim Schließen dieses Fensters berechnet.</p>';
  } else if (def.filterType === "multi") {
    html += multiFilterHtml(colId, def.filterOptions, state.filters[colId], false);
  }
  html += '<div class="filter-actions">';
  if (def.filterType !== "none") html += '<button type="button" id="filterResetBtn" data-col="' + colId + '">Filter zurücksetzen</button>';
  html += '<button type="button" id="hideColumnBtn" class="danger" data-col="' + colId + '">Spalte ausblenden</button>';
  html += "</div>";
  document.getElementById("filterModalBody").innerHTML = html;
  if (def.filterType === "keywords") renderKeywordChips();
  document.getElementById("filterModal").showModal();
}

/** Rendert die Keyword-Chips im Filter-Modal aus dem Arbeitsstand pendingKeywords
    (noch nicht in state.filters übernommen — das passiert erst beim Schließen). */
function renderKeywordChips() {
  var container = document.getElementById("keywordChips");
  if (!container) return;
  var html = "";
  pendingKeywords.forEach(function (text, idx) {
    html += '<span class="chip search-chip positive">' + esc(text) +
      '<button type="button" class="chip-remove" data-remove-keyword="' + idx + '" title="Entfernen">×</button></span>';
  });
  container.innerHTML = html;
}

function resetColumnFilter(colId) {
  var def = COLUMN_DEFS[colId];
  var fresh = defaultFilters();
  if (def.filterType === "multi") {
    state.filters[colId] = fresh[colId];
  } else if (def.filterType === "keywords") {
    state.filters.keywords = "";
  } else if (colId === "employer") {
    state.filters.employer = "";
    state.filters.quelle = fresh.quelle;
  } else if (colId === "entgelt") {
    state.filters.entgelt = "";
    state.filters.entgeltWerte = fresh.entgeltWerte;
  } else if (colId === "brutto") {
    state.filters.brutto = "";
    state.filters.bruttoIncludeUnknown = fresh.bruttoIncludeUnknown;
  } else {
    state.filters[colId] = "";
  }
}

document.getElementById("filterModalBody").addEventListener("input", function (event) {
  var t = event.target;
  if (t.dataset.filterText != null) state.filters[t.dataset.filterText] = t.value;
  else if (t.dataset.filterDate != null) state.filters[t.dataset.filterDate] = t.value;
  else if (t.dataset.filterNumber != null) state.filters[t.dataset.filterNumber] = t.value;
  else return;
  persistFilters();
  render();
});
/* Keyword-Chips: Enter/Komma übernimmt den Text als Chip, Backspace bei leerem Feld
   entfernt den letzten — nur der Arbeitsstand pendingKeywords ändert sich, die
   eigentliche (teure) Keyword-Match-Berechnung läuft erst beim Schließen des Modals. */
document.getElementById("filterModalBody").addEventListener("keydown", function (event) {
  if (event.target.id !== "ff-keywords") return;
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    var text = event.target.value.trim();
    if (text.length > 1) pendingKeywords.push(text);
    event.target.value = "";
    renderKeywordChips();
  } else if (event.key === "Backspace" && !event.target.value && pendingKeywords.length) {
    pendingKeywords.pop();
    renderKeywordChips();
  }
});
document.getElementById("filterModalBody").addEventListener("change", function (event) {
  var t = event.target;
  if (t.dataset.filterMulti != null) {
    state.filters[t.dataset.filterMulti][t.dataset.value] = t.checked;
  } else if (t.dataset.filterCheckbox != null) {
    state.filters[t.dataset.filterCheckbox] = t.checked;
  } else return;
  persistFilters();
  render();
});
document.getElementById("filterModalBody").addEventListener("click", function (event) {
  var resetBtn = event.target.closest("#filterResetBtn");
  if (resetBtn) {
    resetColumnFilter(resetBtn.dataset.col);
    persistFilters();
    openFilterModal(resetBtn.dataset.col);
    render();
    return;
  }
  var hideBtn = event.target.closest("#hideColumnBtn");
  if (hideBtn) {
    if (visibleColumns().length <= 1) return; // mindestens eine Spalte muss sichtbar bleiben
    var colId = hideBtn.dataset.col;
    if (state.hiddenColumns.indexOf(colId) === -1) state.hiddenColumns.push(colId);
    persistColumns();
    document.getElementById("filterModal").close();
    render();
    return;
  }
  var showBtn = event.target.closest("[data-show-col]");
  if (showBtn) {
    var showId = showBtn.dataset.showCol;
    var idx = state.hiddenColumns.indexOf(showId);
    if (idx !== -1) state.hiddenColumns.splice(idx, 1);
    persistColumns();
    render();
    openHiddenColumnsModal();
    return;
  }
  var assignOpt = event.target.closest("[data-assign]");
  if (assignOpt) {
    var newStatus = assignOpt.dataset.assign;
    state.selected.forEach(function (id) { setStatus(id, newStatus); });
    persistStatus();
    state.selected.clear();
    document.getElementById("filterModal").close();
    render();
    return;
  }
  var removeKeywordBtn = event.target.closest("[data-remove-keyword]");
  if (removeKeywordBtn) {
    pendingKeywords.splice(parseInt(removeKeywordBtn.dataset.removeKeyword, 10), 1);
    renderKeywordChips();
    return;
  }
  var chipAction = event.target.closest("[data-chip-action]");
  if (chipAction) {
    var mapKey = chipAction.dataset.chipMap;
    var chipValue = chipAction.dataset.chipValue;
    if (chipAction.dataset.chipAction === "only") {
      Object.keys(state.filters[mapKey]).forEach(function (k) { state.filters[mapKey][k] = k === chipValue; });
    } else {
      state.filters[mapKey][chipValue] = false;
    }
    persistFilters();
    document.getElementById("filterModal").close();
    render();
  }
});
document.getElementById("filterModal").addEventListener("click", function (event) {
  if (event.target === this) this.close();
});
// Egal ob per Close-Button, Backdrop-Klick oder Escape geschlossen — "close" feuert
// in jedem Fall einmalig. Erst hier wird die (teure) Keyword-Match-Berechnung ausgelöst.
document.getElementById("filterModal").addEventListener("close", function () {
  if (pendingKeywords === null) return;
  state.filters.keywords = pendingKeywords.join(", ");
  pendingKeywords = null;
  persistFilters();
  render();
});

/* ---------- Modal (Job-Details) ---------- */
/**
 * Rendert Voraussetzungen als klickbare Zustands-Icons (3 eigene Zustände,
 * per Klick durchschaltbar: unbekannt → erfüllt → nicht erfüllt → unbekannt).
 * Ohne eigenen Zustand wird — falls vorhanden — der Zustand der ähnlichsten
 * bereits markierten Anforderung eines anderen Jobs blass als Referenz gezeigt.
 */
function reqList(items) {
  if (!items.length) return '<p class="muted">keine Angaben</p>';
  var html = '<ul class="req">';
  for (var i = 0; i < items.length; i++) {
    var text = items[i];
    var hash = hashText(text);
    var own = getReqState(hash);
    var display = own, isRef = false;
    if (!display) {
      var ref = findReferenceState(text, hash);
      if (ref) { display = ref; isRef = true; }
    }
    var icon, cls, title;
    if (display === "check") {
      icon = isRef ? "(✔)" : "✔";
      cls = isRef ? "ref-check" : "check";
      title = isRef ? "Ähnliche Anforderung anderswo als erfüllt markiert — klicken zum Festlegen" : "Erfüllt — klicken zum Ändern";
    } else if (display === "false") {
      icon = isRef ? "(✕)" : "✕";
      cls = isRef ? "ref-false" : "false";
      title = isRef ? "Ähnliche Anforderung anderswo als nicht erfüllt markiert — klicken zum Festlegen" : "Nicht erfüllt — klicken zum Ändern";
    } else {
      icon = "☐";
      cls = "empty";
      title = "Unbekannt — klicken zum Markieren";
    }
    html += "<li><button type='button' class='req-state " + cls + "' data-hash='" + hash + "' title='" + title + "'>" + icon + "</button>" +
      "<span>" + esc(text) + "</span></li>";
  }
  return html + "</ul>";
}

function metaRow(label, valueHtml) {
  return valueHtml ? "<dt>" + label + "</dt><dd>" + valueHtml + "</dd>" : "";
}

function openModal(job) {
  document.getElementById("mTitle").textContent = job.titel;
  var brutto = bruttoFor(job, state.years);
  var bruttoHtml = "";
  if (brutto) {
    bruttoHtml = (brutto.approx ? "≈ " : "") + (brutto.min === brutto.max ? euro(brutto.min) : euro(brutto.min) + " – " + euro(brutto.max));
    var details = [];
    for (var i = 0; i < brutto.hits.length; i++) {
      details.push(brutto.hits[i].gruppe + " Stufe " + brutto.hits[i].stufe + " (" + brutto.hits[i].tabelle + ")");
    }
    bruttoHtml += ' <div class="brutto-detail">' + esc(details.join(" · ")) + "</div>";
  }
  var days = daysUntil(job.bewerbungsfrist);
  var score = matchScore(job, parseKeywords(state.filters.keywords));
  var body =
    '<p><a class="apply-btn" href="' + esc(job.link) + '" target="_blank" rel="noopener">Zum Angebot ↗</a></p>' +
    '<dl class="meta-grid">' +
    metaRow("Referenzcode", esc(job.referenzcode || "")) +
    metaRow("Arbeitgeber", esc(job.employer || "")) +
    metaRow("Quelle", esc(job.adapter)) +
    metaRow("Status", esc(statusLabel(job.id))) +
    metaRow("Bewerbungsfrist", job.bewerbungsfrist
      ? fmtDate(job.bewerbungsfrist) + (days != null ? ' <span class="' + (days <= 7 ? "frist-soon" : "muted") + '">(' + (days < 0 ? "abgelaufen" : "noch " + days + " Tage") + ")</span>" : "")
      : "") +
    metaRow("Befristung", job.befristung.length ? chips(job.befristung) : "") +
    metaRow("Arbeitszeit", job.arbeitszeit.length ? chips(job.arbeitszeit) : "") +
    metaRow("Laufbahn", job.laufbahn.length ? chips(job.laufbahn, "laufbahn") : "") +
    metaRow("Verbeamtung", job.verbeamtung ? '<span class="bool-yes">✓ ja</span>' : "nein") +
    metaRow("Homeoffice / mobil", esc(job.homeoffice || "")) +
    metaRow("Dienstorte", esc(job.dienstorte.join(", "))) +
    metaRow("Gehalt", esc(job.gehalt || "")) +
    metaRow("Gehaltsstufe", job.gehaltsstufe ? chips([job.gehaltsstufe], "grade") : "") +
    metaRow("Brutto/Monat (Stufe nach Dienstjahren)", bruttoHtml) +
    metaRow("Keyword-Match", score == null ? "" : score + " %") +
    "</dl>";
  if (job.beschreibung) {
    body += "<h3>Beschreibung</h3><div class='beschreibung'>" + linkify(esc(job.beschreibung)) + "</div>";
  }
  body += "<h3>Voraussetzungen (zwingend)</h3>" + reqList(job.voraussetzungenZwingend || []);
  body += "<h3>Voraussetzungen (wünschenswert)</h3>" + reqList(job.voraussetzungenWuenschenswert || []);
  body += '<p class="muted" style="font-size:12px">✔/✕ = von dir markiert · (✔)/(✕) blass = ähnliche Anforderung anderswo markiert · Klick schaltet durch: unbekannt → erfüllt → nicht erfüllt. Wird lokal gespeichert und gilt für alle Jobs mit identischem bzw. ähnlichem Wortlaut.</p>';
  body += "<h3>Notizen</h3><textarea id='noteArea' class='note-area' placeholder='Eigene Notizen…'>" + esc(getNote(job.id)) + "</textarea>" +
    '<p class="muted" style="font-size:12px">Notizen werden lokal in diesem Browser gespeichert (localStorage), nicht in data/jobs.json — ein Web-Browser kann aus Sicherheitsgründen keine Datei auf der Festplatte beschreiben.</p>';

  var container = document.getElementById("mBody");
  container.innerHTML = body;
  container.querySelectorAll(".req-state").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var current = getReqState(btn.dataset.hash);
      var next = current === "check" ? "false" : current === "false" ? undefined : "check";
      setReqState(btn.dataset.hash, next);
      openModal(job); // Modal neu rendern, damit auch Referenz-Zustände woanders aktuell bleiben
    });
  });
  var noteArea = document.getElementById("noteArea");
  noteArea.addEventListener("input", function () { setNote(job.id, noteArea.value); });
  document.getElementById("modal").showModal();
}

/* ---------- Events ---------- */
var lastSelectIndex = null;
function handleRowSelect(event, checkbox) {
  var idx = parseInt(checkbox.closest("tr").dataset.index, 10);
  var checked = checkbox.checked;
  if (event.shiftKey && lastSelectIndex != null) {
    var from = Math.min(lastSelectIndex, idx), to = Math.max(lastSelectIndex, idx);
    for (var i = from; i <= to; i++) {
      var jobId = currentList[i].id;
      if (checked) state.selected.add(jobId); else state.selected.delete(jobId);
    }
  } else {
    if (checked) state.selected.add(checkbox.dataset.select); else state.selected.delete(checkbox.dataset.select);
  }
  lastSelectIndex = idx;
  render();
}
document.getElementById("rows").addEventListener("click", function (event) {
  if (event.target.closest(".note-input")) return;
  var checkbox = event.target.closest(".row-select");
  if (checkbox) { handleRowSelect(event, checkbox); return; }
  var statusBtn = event.target.closest("[data-status-btn]");
  if (statusBtn) { toggleStatus(statusBtn.dataset.statusBtn, statusBtn.dataset.jobId); return; }
  var chip = event.target.closest("[data-chip-filter]");
  if (chip) { openChipFilterModal(chip.dataset.chipFilter, chip.dataset.chipValue); return; }
  var row = event.target.closest("tr");
  if (row) openModal(currentList[parseInt(row.dataset.index, 10)]);
});
document.getElementById("rows").addEventListener("input", function (event) {
  var noteInput = event.target.closest(".note-input");
  if (noteInput) setNote(noteInput.dataset.note, noteInput.value);
});
headRowEl.addEventListener("click", function (event) {
  if (event.target.closest("#addColumnBtn")) { openHiddenColumnsModal(); return; }
  if (event.target.closest("#assignStatusBtn")) { openAssignStatusModal(); return; }
  if (event.target.closest("#clearSelectionBtn")) { state.selected.clear(); render(); return; }
  var sortBtn = event.target.closest('[data-th-action="sort"]');
  if (sortBtn) {
    var col = sortBtn.dataset.col;
    if (state.sortCol === col) state.sortDir *= -1;
    else { state.sortCol = col; state.sortDir = 1; }
    render();
    return;
  }
  var labelEl = event.target.closest('[data-th-action="filter"]');
  if (labelEl) openFilterModal(labelEl.dataset.col);
});
function renderSearchChips() {
  var html = "";
  state.searchChips.forEach(function (chip, idx) {
    html += '<span class="chip search-chip ' + (chip.negative ? "negative" : "positive") + '">' +
      (chip.negative ? "−" : "") + esc(chip.text) +
      '<button type="button" class="chip-remove" data-remove-chip="' + idx + '" title="Entfernen">×</button></span>';
  });
  document.getElementById("qChips").innerHTML = html;
}
document.getElementById("q").addEventListener("input", function () {
  state.q = this.value;
  render();
});
document.getElementById("q").addEventListener("keydown", function (event) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    var raw = this.value.trim();
    if (!raw) return;
    var negative = raw.charAt(0) === "-";
    var text = (negative ? raw.slice(1) : raw).trim();
    if (text) state.searchChips.push({ text: text, negative: negative });
    this.value = "";
    state.q = "";
    persistSearchChips();
    renderSearchChips();
    render();
  } else if (event.key === "Backspace" && !this.value && state.searchChips.length) {
    state.searchChips.pop();
    persistSearchChips();
    renderSearchChips();
    render();
  }
});
document.getElementById("qChips").addEventListener("click", function (event) {
  var btn = event.target.closest("[data-remove-chip]");
  if (!btn) return;
  state.searchChips.splice(parseInt(btn.dataset.removeChip, 10), 1);
  persistSearchChips();
  renderSearchChips();
  render();
});
var yearsInput = document.getElementById("years");
yearsInput.value = state.years;
yearsInput.addEventListener("input", function () {
  state.years = parseInt(yearsInput.value, 10) || 0;
  localStorage.setItem("jobsearch.years", String(state.years));
  render();
});
document.getElementById("modal").addEventListener("click", function (event) {
  if (event.target === this) this.close(); // Klick auf Backdrop
});

/* ---------- Init ---------- */
(function init() {
  var stand = new Date(DATA.stand);
  document.getElementById("stand").textContent =
    "Stand: " + stand.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) + " · " + JOBS.length + " Angebote";
  renderSearchChips();
  render();
})();
</script>
</body>
</html>
`;
}
