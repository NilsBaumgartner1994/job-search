# AGENTS.md — Anleitung für KI-Agenten in diesem Repo

Diese Datei beschreibt, wie ein KI-Agent (Claude Code o.ä.) in diesem Repository
arbeiten soll. Sie ergänzt die README, die das Projekt selbst erklärt.

## Was dieses Repo tut

1. `yarn crawl` durchsucht Job-Portale (Interamt, ITZBund, BWI, BKA, BND, Accenture …)
   und schreibt die Angebote nach `data/jobs.json`.
2. `yarn agent` (`src/server/cli.ts`) lässt **Gemini** die Angebote triagieren:
   „interessant“ oder „archivieren“, mit Punkten und Begründung.
3. Ergebnisse liegen in `data/agent/board.json` (Kanban-Status je Job) und
   `data/agent/jobs/<id>/chat.json` (Verlauf je Job).
4. `publishDocs()` schreibt daraus die Daten für die GitHub-Pages-Seite nach `docs/`.

## Manuelle Triage durch den Agenten (statt Gemini)

Wenn der Nutzer bittet, die Bewertung **selbst** durchzuführen statt den
Workflow `.github/workflows/ki-agent.yml` laufen zu lassen: kein `GEMINI_API_KEY`
nötig, aber die Ergebnisse müssen **exakt im selben Format** landen, damit
Board und Pages-Seite weiterfunktionieren.

### Ablauf, der sich bewährt hat

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 yarn install --frozen-lockfile
```

Hilfsskripte gehören nach `src/_tmp*.ts` — dieses Muster ist in `.gitignore`
und landet damit nicht im Repo.

1. **Profil lesen**: `data/agent/profil.md`. Das ist die einzige Quelle für die
   Bewertungskriterien. Nicht aus dem Bauch heraus abweichen.
2. **Ohne Bewertung wegräumen** (kostet keine Anfrage):
   - `archiviereAbgelaufene(loadJobs())` aus `src/server/expiry.ts` — abgelaufene Fristen
   - `archiviereZuNiedrigBezahlte(loadJobs())` aus `src/server/lowpay.ts` — alles
     eindeutig unter E13/A13. Beide laufen auch automatisch in `yarn agent` und
     `startAgent()`. Vor einer Änderung an der Regel immer erst einen Trockenlauf
     über `istGehaltZuNiedrig()` machen und die getroffenen Angaben ansehen.
3. **Warteschlange bilden** wie in `cli.ts`: Jobs ohne Board-Eintrag oder mit
   Status `todo`, ohne `chat.json`, Frist nicht abgelaufen und nicht unter
   Zielniveau — sortiert mit `sortTriageQueue()` (öffentliche Arbeitgeber zuerst,
   Jobs ohne Gehaltsangabe nach hinten). **Dann nach Priorität umsortieren:**
   1. Verbeamtung **und** (Homeoffice-Hinweis **oder** Dienstort in Nähe)
   2. Verbeamtung
   3. Dienstort in Nähe
   4. Rest

   Als „nah" gelten PLZ 49xxx/48xxx/26xxx/27xxx/28xxx/30xxx/31xxx/32xxx/33xxx
   sowie Osnabrück, Vechta, Cloppenburg, Oldenburg, Münster, Bremen, Lingen,
   Bielefeld, Hannover, Rheine, Nordhorn, Meppen, Wilhelmshaven u.ä.
4. **Kompakt dumpen** statt Volltexte zu lesen: Titel, Arbeitgeber, Dienstorte,
   Entgelt/Besoldung, Verbeamtung, Befristung, Arbeitszeit, Homeoffice, Frist.
   Das reicht für die große Mehrheit der Entscheidungen.
5. **Volltext nur bei Grenzfällen** lesen (`jobToRawText()` aus
   `src/server/text.ts`) — vor allem, um geforderte Fachrichtung und den
   tatsächlichen Homeoffice-Anteil zu prüfen.
6. **Bewertungen speichern** im Format des Agenten: pro Job
   `saveJobSnapshot()`, `appendChat()` mit einem `triage`-Nachrichtenpaar und
   `setStatus(jobId, "interessant" | "archiviert", true, {punkte, punkteDetails, begruendung})`.
   Im Chat-Verlauf bitte kennzeichnen, dass manuell bewertet wurde (kein Gemini-Aufruf).
7. **Pages-Daten schreiben**: `publishDocs(loadJobs())` bzw. `yarn pages`.
8. **Hilfsskripte löschen**, dann `data/agent/` und `docs/` committen und pushen.

### ⚠ Bekannter Datenfehler: Interamt-Detailtexte sind oft vertauscht

Bei **rund der Hälfte der Interamt-Angebote** gehört der in `raw.detail`
gespeicherte Seitentext zu einem **anderen** Angebot. Nachweis: der Detailtext
enthält das Feld „INTERAMT Angebots-ID“ — bei ~289 von 593 Interamt-Jobs stimmt
diese nicht mit der Job-ID überein.

Ursache liegt in `src/adapters/InteramtAdapter.ts`: `openDetail()` klickt eine
Trefferzeile über `tr:nth-child(n)` an und liest nach `networkidle` den
`body`-Text. Interamt ist eine Wicket-AJAX-Anwendung — nach `page.goBack()` ist
die Liste nicht zwingend fertig neu gerendert, sodass entweder die falsche Zeile
getroffen oder noch der vorherige Detailinhalt gelesen wird.

**Folgen für die Bewertung:**

- Verlässlich sind nur die Felder aus der **Trefferliste**: `titel`, `employer`,
  `gehaltsstufe`, `verbeamtung`, `dienstorte`, `bewerbungsfrist`, `befristung`, `link`.
- **Unzuverlässig** bei Nicht-Übereinstimmung: `beschreibung`, `arbeitszeit`,
  `voraussetzungen*`, `raw.detail` und `homeoffice` (außer wenn es mit
  `Dienstort:` beginnt — das kommt aus der Liste).

**Prüfung vor jeder Bewertung:**

```ts
const ids = [...detail.matchAll(/INTERAMT\s*Angebots-?ID\s*<?[^0-9]{0,40}(\d{6,8})/gi)]
  .map((m) => m[1]);
const passt = ids.includes(job.id.split(":")[1]);
```

Passt es nicht: nur nach Listenfeldern bewerten **und in die Begründung
schreiben**, dass der Detailtext zu einem anderen Angebot gehört und die
Original-Ausschreibung vor einer Bewerbung geprüft werden muss.

Andere Adapter (ITZBund, BWI, BKA, BND, Accenture) sind davon nicht betroffen.

## Bewertungsmaßstab (abgeleitet aus `data/agent/profil.md`)

Das Profil zählt, nicht diese Zusammenfassung — wenn es geändert wurde, neu lesen.
Stand August 2026 gilt:

**Fahrzeit ab Osnabrück/Vechta/Cloppenburg grob schätzen und in die Begründung
schreiben** (das verlangt das Profil ausdrücklich):

| Ziel | grobe Fahrzeit |
|---|---|
| Osnabrück, Vechta, Cloppenburg, Melle, Bramsche, Diepholz, Damme, Lohne, Quakenbrück | bis 40 min |
| Münster, Osnabrück↔Oldenburg, Bielefeld, Lingen, Nordhorn, Rheine | 45–75 min |
| Hannover, Bremen, Dortmund, Münsterland-Rand | 1,5–2 h |
| Hamburg, Köln, Bonn, Essen/Düsseldorf, Kiel | 2,5–3 h |
| Koblenz, Frankfurt, Wiesbaden, Berlin, Potsdam, Leipzig, Rostock | 3,5–4 h |
| München, Nürnberg, Stuttgart, Hof, Dresden | 5–6,5 h |

**Entscheidungslogik:**

1. Fachlich unpassend → `archivieren`, unabhängig von Ort und Gehalt.
   Dazu zählen: Forst-/Landwirtschaft, Jura, Medizin/Toxikologie, Geowissenschaften,
   allgemeine Verwaltung ohne IT-Kern, Assistenz, Einkauf, HR, Logistik,
   Arbeitsschutz, Kommunikation/PR.
2. **No-Gos aus dem Profil**: reine Vertriebsstellen, reine SAP-Beratung
   (inklusive SAP-Training, SAP-Inhouse-Consulting, SASPF/ERP-Fachrollen).
3. Befristet und keine wissenschaftliche Qualifizierungsstelle → `archivieren`
   (der Nutzer sucht unbefristet). Eine Promotionsstelle ist erledigt — er ist
   seit Mai 2026 promoviert.
4. Unter E13/A13 **und** weiter als ~40 min → `archivieren`. Reiner
   Betrieb/Support (1st/2nd Level, Benutzerbetreuung, Systemadministration,
   Netzwerkbetrieb) liegt unter dem Profil, auch bei E13.
5. Ab E13/A13 und fachlich passend:
   - bis ~40 min → `interessant`
   - bis ~3 h → `interessant`, mit Entfernungshinweis und der Aufforderung, den
     Homeoffice-Anteil vorab zu klären
   - über ~3,5 h → nur `interessant` bei fachlichem Top-Treffer
     (Softwareentwicklung, Architektur, KI/Data Science, Forschung, Führung)
     oder deutlich über E13 (E14/A14+, Führungsposition); sonst `archivieren`.
     Immer dazuschreiben, dass es nur mit Umzug oder überwiegendem Homeoffice
     aufgeht.

**Verbeamtung ist hoch gewichtet** (seit August 2026 im Profil verschärft):
Verbeamtung *plus* belegter hoher Homeoffice-Anteil oder *plus* erreichbare Nähe
schlägt eine vergleichbare Tarifstelle deutlich und rechtfertigt auch eine große
Entfernung — Beispiel: eine A13h-Stelle mit „bis zu 80 % Homeoffice" ist trotz
Dienstort München ein Treffer. Verbeamtung **allein** rechtfertigt dagegen keinen
weiten Weg ohne belegtes Homeoffice. „Dienstort: Hybrid" aus der Interamt-Liste
ist **kein** Beleg für einen hohen Homeoffice-Anteil — der steht nur im Volltext
(z.B. „bis zu 60 %", „Homeoffice innerhalb von Deutschland"). Bei aussichtsreichen
Verbeamtungsstellen deshalb immer den Volltext nach `homeoffice`, `mobiles
Arbeiten`, `Telearbeit`, `%` durchsuchen.

**Standort-Dubletten**: Behörden schreiben dieselbe Stelle oft parallel an vielen
Standorten aus (die SVLFG etwa an 17). Dann nur die ein bis zwei nächstgelegenen
Varianten auf „interessant" setzen und die übrigen mit dem Hinweis archivieren,
dass es dieselbe Stelle ist und welche Karte die relevante ist — sonst ist das
Board mit identischen Angeboten zugestellt. Dasselbe gilt für Angebote, die
gleichzeitig über Interamt und ITZBund laufen.

**Industriegehälter gegen E13 spiegeln** (E13 TVöD Bund ≈ 62.000–88.000 €):
Bänder ab ~87.000 € gelten als „deutlich über E13“, Bänder um 57.800–84.000 €
liegen etwa auf E13-Niveau, alles darunter nicht.

**BWI-Sonderfall**: „bundesweit“ heißt „an einem BWI-Standort“. Es gibt keinen
im Raum Osnabrück/Vechta/Cloppenburg; nächster ist **Hannover (~1,5 h)**. Bei
„bundesweit“ darf `entfernung` daher besser bewertet werden als bei fest an Bonn,
München oder Berlin gebundenen Stellen.

**Punkte** (je 0–10, `gesamt` ist keine Durchschnittsrechnung, sondern die
gewichtete Gesamteinschätzung): `entfernung`, `homeoffice`, `gehalt`,
`arbeitszeit`, `verbeamtung`, `gesamt`. Begründung auf Deutsch, 1–3 Sätze, den
Nutzer direkt ansprechen („du“) und immer die geschätzte Fahrzeit nennen.

## Was beim nächsten Mal zu tun ist

1. **Warteschlange weiterarbeiten.** Stand 21.08.2026: 1.210 Angebote sind
   eingeordnet (55 interessant), **648 sind noch offen**. Prioritätsstufen 0–2
   (Verbeamtung bzw. Nähe) sind vollständig abgearbeitet — offen ist nur noch
   der Rest, überwiegend Accenture (299) und BWI. Bereits bewertete Jobs fallen
   automatisch heraus, weil sie einen Board-Eintrag und eine `chat.json` haben.
2. **Blockweise arbeiten**: ~30 Angebote dumpen, bewerten, speichern, dann der
   nächste Block. Nach jedem Block committen, damit bei Abbruch nichts verloren geht.
3. **Accenture zuerst prüfen, ob sich der Aufwand lohnt.** Die 299 offenen
   Accenture-Angebote haben durchweg keine Gehaltsangabe, greifen daher nicht in
   den Gehaltsfilter und sind überwiegend Beratungs- und Vertriebsrollen — also
   viele No-Gos. Eine Stichprobe ist sinnvoller als eine Einzelbewertung von 299
   Angeboten; ggf. mit dem Nutzer klären, ob Accenture pauschal archiviert werden soll.
4. **Den Interamt-Bug im Blick behalten.** Er ist noch nicht behoben. Wenn der
   Nutzer das möchte, wäre die Reparatur in `InteramtAdapter.openDetail()`:
   nach dem Klick auf die Detailseite warten, bis die dort angezeigte
   „INTERAMT Angebots-ID" zur erwarteten Zeile passt (statt nur `networkidle`),
   und die Zeile über ihre Angebots-ID statt über `tr:nth-child(n)` ansteuern.
   Danach ist ein `yarn crawl --refresh` nötig, damit die falschen Detailtexte
   ersetzt werden — und die bisher auf falschem Text beruhenden Triagen
   (auch die von Gemini) sollten neu bewertet werden.
5. **Zweiter Datenfehler, ebenfalls offen**: die Gehaltsextraktion schneidet
   Bandobergrenzen am Tausenderpunkt ab — aus „71.000 € und 104.000 €" wird
   `gehalt: "71.000 € und 104"`. `src/server/lowpay.ts` rechnet das beim Parsen
   wieder hoch (Zahlen unter 1000 gelten als abgeschnittene Tausender), die
   eigentliche Ursache liegt aber in `src/extract.ts`.
6. **Nicht ungefragt bewerben oder Bewerbungsunterlagen schreiben** — die Triage
   sortiert nur vor, die Entscheidung trifft der Nutzer.

## Konventionen

- Sprache im Repo, in Commits und in allen Begründungen: **Deutsch**.
- Code-Kommentare erklären das *Warum*, nicht das *Was* — so wie im Bestand.
- `data/jobs.json` (20 MB) und `jobs.html` (5 MB) nie von Hand editieren.
- `yarn typecheck` läuft vor dem Commit sauber durch.
- Nie einen Gemini-Key ins Repo schreiben; `.env` ist gitignored.
