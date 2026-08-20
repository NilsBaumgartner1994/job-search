# job-search

Durchsucht Job-Portale, speichert alle Angebote normalisiert in `data/jobs.json`
und generiert daraus eine interaktive Übersicht in `jobs.html`.

[https://nilsbaumgartner1994.github.io/job-search/](https://nilsbaumgartner1994.github.io/job-search/)

## Nutzung

```bash
yarn install
yarn salaries                    # einmalig/jährlich: Besoldungs- & Entgelttabellen laden (Netz)
yarn crawl                       # Trefferlisten laden, Details nur für NEUE Jobs (Netz)
yarn crawl --adapter=bka,bwi     # nur bestimmte Portale
yarn crawl:full                  # Details auch für bekannte Jobs neu laden (Netz)
yarn html                        # jobs.html neu aus data/jobs.json erzeugen (offline)
yarn server                      # KI-Agent + Kanban-Board starten (siehe unten)
yarn typecheck                   # TypeScript prüfen
```

Benötigt Node ≥ 18 (siehe `.nvmrc`, `nvm use`).

## Crawl-Cache (raw & PDFs)

Jeder Job speichert seine Rohdaten in `data/jobs.json` unter `raw`:

- `raw.short` — der Eintrag aus der Trefferliste (OData-JSON / Teaser)
- `raw.detail` — das Roh-Detail (HTML der Detailseite bzw. extrahierter PDF-Text)
- `raw.pdfPath` — Pfad zur lokal gespeicherten PDF (nur ITZBund), z.B.
  `data/pdfs/itzbund/<id>.pdf`

`yarn crawl` lädt immer nur die (billigen) Trefferlisten neu und gleicht die
Job-IDs ab: bekannte Jobs werden aus `raw.detail` **neu geparst** statt neu
heruntergeladen — verbesserte Extraktoren greifen also auch ohne Netz-Abruf.
Nur neue Jobs verursachen Detail-Abrufe (erster Lauf ~2 min, danach ~10 s).
`yarn crawl:full` erzwingt das Neuladen aller Details. PDFs abgelaufener Jobs
werden beim Löschen mit entfernt; `data/pdfs/` ist nicht im Git.

## jobs.html

Eine einzelne, offline nutzbare HTML-Datei (einfach im Browser öffnen):

- **Globale Suche als Keyword-Chips**: Begriff eingeben und Enter drücken
  fügt ihn als Chip hinzu — normal eingegebene Begriffe müssen im Job
  vorkommen (blauer Chip), mit "-" vorangestellte Begriffe (z.B. "-Student")
  schließen Jobs mit diesem Wort aus (roter Chip). Mehrere Chips kombinieren
  sich per UND-Logik. Jeder Chip hat ein "×" zum Entfernen; Backspace bei
  leerem Suchfeld entfernt den letzten Chip. Der Rest im Suchfeld (noch nicht
  mit Enter bestätigt) filtert weiterhin sofort beim Tippen wie bisher.
- Die Angebots-Anzahl oben rechts ("X von Y") zählt **ausgeblendete
  (archivierte) Jobs nicht im Nenner mit** — wie ein Filter: solange
  Archivierte versteckt sind, tauchen sie auch nicht im "Y" auf; werden sie
  über den Archiv-Button wieder eingeblendet, zählen sie wieder mit.
- **Voraussetzungen im Detail-Modal** sind klickbare Zustands-Icons statt
  Checkboxen, mit Klick-Zyklus **unbekannt (✕, blass) → erfüllt (✔, grün) →
  nicht erfüllt (✕, rot) → unbekannt**. Ohne eigene Markierung wird — falls
  vorhanden — der Zustand der **ähnlichsten bereits markierten Anforderung
  eines anderen Jobs** blass mit Klammern angezeigt (z.B. "(✔)" grün oder
  "(✕)" rosa), berechnet über eine Bigram-Ähnlichkeitsfunktion auf den
  Anforderungstexten. So merkt man sich z.B. "Abitur" einmal und sieht bei
  eng verwandten Formulierungen in anderen Jobs sofort eine Referenz, ohne
  sie erneut einzeln markieren zu müssen.
- **Jede Spaltenüberschrift** hat zwei Klickzonen: der **Name** öffnet ein
  Filter-Modal für genau diese Spalte, das separate **↕/▲/▼-Icon** sortiert
  danach. Ist ein Filter aktiv, zeigt der Spaltenname eine rote Zähler-Blase
  mit der Anzahl aktiver Einschränkungen.
- **Filter pro Spalte**: Titel/Arbeitgeber/Dienstort als Text-enthält, Frist
  als "bis"-Datum, Brutto als Mindestbetrag,
  Befristung/Arbeitszeit/Remote/Verbeamtung/Laufbahn/Status/**Webseite** als
  Mehrfachauswahl-Checkboxen (alle angehakt = Filter wirkungslos). Der
  Arbeitgeber-Filter enthält zusätzlich die Quelle (Adapter) als Checkboxen.
  Der **Entgelt-Filter** hat zusätzlich zum Text-Feld Checkboxen für jeden
  in den Daten vorkommenden Wert — einzelne Werte lassen sich so gezielt
  abwählen. **Klick auf den Entgelt-Chip direkt in der Tabellenzeile** öffnet
  statt dessen ein kompaktes Modal mit den zwei Optionen "Nur diesen Wert
  anzeigen" bzw. "Diesen Wert ausblenden" — schneller Weg, um exakt diesen
  Gehaltsstufen-Wert ein- oder auszublenden, ohne das große Filter-Modal über
  den Spaltenkopf zu öffnen; wirkt auf dieselben Checkboxen wie der
  Entgelt-Filter. Der **Brutto-Filter** hat zusätzlich zum Mindestbetrag eine
  Checkbox "Jobs ohne Gehaltsangabe trotzdem anzeigen" — standardmäßig aus,
  d.h. ein gesetzter Mindestbetrag blendet Jobs ohne ermittelbares Brutto mit
  aus; angehakt bleiben sie trotz fehlendem Wert sichtbar. Jedes Filter-Modal
  hat einen "Zurücksetzen"-Button.
- **Keyword-Match-Filter**: Begriffe werden wie bei der globalen Suche als
  Chips eingegeben (Text tippen, Enter oder Komma bestätigt den Chip; "×" zum
  Entfernen, Backspace bei leerem Feld entfernt den letzten Chip). Die
  eigentliche (für jeden Job über Titel/Beschreibung/Ort/... laufende und
  entsprechend teure) Match-Berechnung läuft **erst beim Schließen des
  Filter-Modals**, nicht bei jedem Tastendruck — dadurch bleibt die Tabelle
  auch bei vielen Keywords bzw. vielen Angeboten beim Tippen flüssig.
- **Webseite-Spalte**: zeigt die Domain, von der das Angebot tatsächlich stammt
  (aus `link` abgeleitet, z.B. `bwi.de` oder bei Accenture die Workday-Domain
  `accenture.wd103.myworkdayjobs.com`) — unabhängig vom Arbeitgeber-Namen, der
  bei Sammelportalen (ITZBund, Interamt) je Job variiert, während die Webseite
  pro Adapter stabil bleibt.
- **Status** (erste Spalte) ist einer von: kein Status, ★ Stern, 📨 Beworben,
  🗄 Archiviert — pro Zeile per Icon-Klick setzbar (nochmaliger Klick hebt ihn
  wieder auf). ★ und 📨 rutschen unabhängig von der gewählten Sortierung immer
  an den Anfang der Liste; 🗄 Archivierte werden **standardmäßig ausgeblendet**
  (Toggle-Button "🗄 Archivierte anzeigen/ausblenden" oben im Toolbar; beim
  Anzeigen sind sie ausgegraut). Das aktive Status-Icon einer Zeile ist
  deutlich als gefüllter, farbiger Chip erkennbar. **★ Stern und 📨 Beworben
  ignorieren zusätzlich alle anderen Filter** (Spalten-Filter, globale Suche,
  Keyword-Match, ...) und bleiben immer sichtbar — einzig über den
  Status-Filter selbst (Spaltenkopf "Status" → Häkchen bei "★ Stern" bzw.
  "📨 Beworben" entfernen) lassen sie sich doch ausblenden. Alles wird im
  Browser gespeichert (localStorage), nicht in `data/jobs.json`.
- **Mehrfachauswahl mit Shift-Klick**: Checkbox in der Status-Spalte anklicken,
  dann mit gedrückter Umschalttaste eine weitere anklicken, um alle Zeilen
  dazwischen mit auszuwählen. Bei aktiver Auswahl erscheint im Status-Spaltenkopf
  "N ausgewählt" mit einem Button **"Status zuweisen"**, der ein Modal mit den
  vier Optionen (★ Stern / 📨 Beworben / 🗄 Archiv / ✕ Neutral/Aufheben) öffnet
  und sie auf alle ausgewählten Jobs anwendet.
- **Notizen**-Spalte: freier Text pro Job, direkt in der Tabellenzelle oder im
  Detail-Modal editierbar. Wird im Browser gespeichert (localStorage) — ein
  Zurückschreiben in `data/jobs.json` ist aus einer statischen HTML-Datei
  heraus nicht möglich (kein Dateisystemzugriff aus dem Browser), übersteht
  aber ein erneutes `yarn crawl` genauso wie Status und abgehakte
  Voraussetzungen, da der Browser-Speicher unabhängig von der HTML-Datei ist.
- **Spalten per Drag & Drop verschieben**: Kopfzelle anfassen und auf eine
  andere Spalte ziehen (oder auf den "+"-Button ganz rechts, um sie ans Ende
  zu setzen) — Reihenfolge wird im Browser gespeichert.
- **Spaltenbreite per Drag anpassen**: dünner Ziehgriff am rechten Rand jeder
  Kopfzelle (Cursor wird zu ↔), Breite wird gespeichert.
- **Spalte ausblenden**: unten in jedem Filter-Modal gibt es den Button
  "Spalte ausblenden". **Wieder einblenden** über den **"+"-Button** ganz
  rechts in der Kopfzeile — öffnet ein Modal mit allen ausgeblendeten
  Spalten zum Anklicken.
- **Globale Suche** (Titel/Arbeitgeber/Beschreibung/Ort) bleibt oben im
  Toolbar, unabhängig von den Spalten-Filtern
- **Klick auf eine Zeile** öffnet ein Modal mit allen Details, Beschreibung
  und Bewerbungs-Link. **Links in der Beschreibung** (z.B. der PDF-Volltext
  beim ITZBund) werden automatisch zu gut lesbaren Buttons ("📄 PDF öffnen ↗")
  statt als abgeschnittener Rohtext dargestellt.
- **Chips** für Befristung, Arbeitszeit (Vollzeit/Teilzeit) und Laufbahn
- **Voraussetzungen (zwingend / wünschenswert)** als abhakbare Listen — der
  Haken wird im Browser (localStorage) gespeichert und gilt für alle Jobs mit
  identischem Wortlaut
- **Brutto-Spalte**: oben die Jahre im öffentlichen Dienst eingeben, daraus
  werden TVöD-Stufe (§16) und Besoldungs-Erfahrungsstufe (§27 BBesG) bestimmt
  und das passende Monatsbrutto aus den Tabellen gezeigt. Die Zuordnung
  Anzeige → Tabellengruppe läuft über eine Ähnlichkeitsfunktion
  (`src/salary/match.ts`), weil Anzeigen selten exakt die Tabellenschreibweise
  benutzen ("EG 13 TV EntgO Bund" → "E 13", "A9g/A11" → "A 9", "A 11");
  unsichere Treffer werden mit "≈" markiert. Enthält die Gehaltsstufe mehrere
  Gruppen — auch ohne führendes "E", z.B. "TVöD-4 - TVöD-5" — werden beide
  Seiten als eigene Kandidaten erkannt und im Brutto-Betrag als Von-Bis-Spanne
  angezeigt (z.B. "2.900 € – 3.100 €") statt als leerer Wert. Erkannt werden
  neben "E"/"A"/"B" auch "W" (Professoren-Besoldung, z.B. "W2"), "R"
  (Richter:innen/Staatsanwält:innen, z.B. "R 2"), "S" (TVöD-SuE, z.B. "S 8a")
  sowie "TV-BA" mit römischer Tätigkeitsebene (z.B. "TV-BA III").

## KI-Agent & Kanban-Board (`yarn server`)

Zusätzlich zur statischen `jobs.html` (die unverändert offline mit
localStorage funktioniert) gibt es einen kleinen lokalen Node-Server mit
**Kanban-Board** und angeschlossenem **KI-Agenten** (Google Gemini — im
Gratis-Kontingent eines privaten Google-Kontos nutzbar, keine Kreditkarte
nötig):

```bash
yarn server        # danach http://localhost:8322/ im Browser öffnen
```

### Erststart: API-Schlüssel

Beim Start prüft der Server, ob alle nötigen Informationen in der `.env`
vorhanden sind (v.a. `GEMINI_API_KEY`). Fehlt der Schlüssel, wirst du direkt
in der Konsole danach gefragt — inklusive Schritt-für-Schritt-Anleitung:

1. https://aistudio.google.com/apikey im Browser öffnen
2. Mit dem (privaten) Google-Konto anmelden
3. "API-Schlüssel erstellen" / "Create API key" klicken
4. Schlüssel kopieren (beginnt mit `AIza…`), in die Konsole einfügen, Enter

Der Schlüssel wird in `.env` gespeichert (steht im `.gitignore`) und beim
nächsten Start automatisch geladen. Optionale `.env`-Einträge:

| Variable         | Default            | Bedeutung                                        |
| ---------------- | ------------------ | ------------------------------------------------ |
| `GEMINI_API_KEY` | — (wird abgefragt) | API-Schlüssel aus Google AI Studio — **mehrere Keys** (z.B. privat + Business) durch Komma, Semikolon oder Zeilenumbruch getrennt |
| `GEMINI_MODEL`   | `gemini-flash-latest` | verwendetes Modell (Alias = aktuelles Flash)  |
| `PORT`           | `8322`             | Port des Kanban-Servers                          |
| `AGENT_DELAY_MS` | `7000`             | Pause zwischen zwei Triage-Anfragen (Rate-Limit) |
| `AGENT_BATCH_SIZE` | `1`              | Angebote je Anfrage (**Sammel-Triage**) — `1` = einzeln, `2`…`20` = feste Bündel, `-1` bzw. `dynamisch` = so viele, wie in eine Anfrage passen |

### Sammel-Triage: mehrere Angebote in einer Anfrage

Das Gratis-Kontingent begrenzt die Zahl der **Anfragen** pro Tag — nicht die
Zahl der bewerteten Angebote. Der Agent kann deshalb mehrere Angebote in
**eine** Anfrage packen und sie in einer Antwort (JSON-Array, ein Objekt je
Angebot) bewerten lassen. Gesteuert wird das über `AGENT_BATCH_SIZE` bzw.
beim GitHub-Workflow über die Auswahl **„buendel“**:

| Wert            | Verhalten                                     | Angebote pro Tag (bei 20 Anfragen) |
| --------------- | --------------------------------------------- | ---------------------------------- |
| `1`             | **Default** — ein Angebot je Anfrage          | 20                                 |
| `2` … `20`      | feste Bündelgröße                             | 40 … 400                           |
| `-1`/`dynamisch`| füllt jede Anfrage, bis das Budget voll ist   | so viele wie möglich               |

**Dynamisch (`-1`)** ist der effizienteste Modus: Ausschreibungstexte sind
unterschiedlich lang, also nimmt der Agent so lange das nächste Angebot dazu,
bis das Zeichenbudget einer Anfrage (**160.000 Zeichen**) oder die Obergrenze
von **20 Angeboten je Anfrage** erreicht ist. Kurze Ausschreibungen landen so
zu vielen in einer Anfrage, sehr lange notfalls allein — statt starr immer
gleich viele zu bündeln.

Details:

- Jedes Angebot wird im Prompt **einzeln und unabhängig** bewertet (gleiche
  Kriterien und Punkte wie bei der Einzelanfrage), die Antwort ist ein Array
  mit einem Objekt je Angebot (Feld `nr` zur Zuordnung).
- Bei **fester** Bündelgröße teilen sich die Angebote das Zeichenbudget
  (mindestens 20.000 Zeichen je Angebot) — lange Ausschreibungen werden bei
  großen Bündeln also gekürzt. Im **dynamischen** Modus bekommt jedes Angebot
  seinen vollen Text (bis 80.000 Zeichen), dafür ist die Zahl je Anfrage
  variabel.
- Fehlt in der Antwort die Bewertung eines Angebots (oder ist sie unlesbar),
  wird **genau dieses Angebot einzeln nachgefragt** — durch das Bündeln geht
  also nichts verloren.
- Im Chat-Verlauf steht pro Angebot weiterhin nur dessen eigene Anfrage und
  dessen eigene Bewertung (mit dem Hinweis, dass es Teil einer Sammel-Anfrage
  war). Folgefragen funktionieren unverändert.
- Je mehr Angebote in einer Anfrage stecken, desto knapper fallen die
  Begründungen tendenziell aus. Bei knappem Kontingent lohnt `dynamisch`, für
  maximale Bewertungsqualität `1`.

### Rate-Limits & API-Nutzung

- Läuft ein Key in ein **429 (Kontingent erschöpft)**, wertet der Agent die
  Antwort aus (Minuten- oder **Tageslimit**, Höhe des Limits, betroffenes
  Modell, empfohlene Wartezeit) und wechselt automatisch auf den **nächsten
  konfigurierten Key**. Erst wenn alle Keys gesperrt sind, wird kurz gewartet
  bzw. der Lauf mit einer klaren Meldung beendet, **wann** sich neue Anfragen
  wieder lohnen (Tageslimits resetten ca. 09:00 deutscher Zeit).
- Die **Nutzung pro Key** (erfolgreiche Anfragen, Fehler, erreichte Limits,
  Sperre bis wann und warum) zeigt das Board oben in der Leiste (📊, Details
  im Tooltip); `yarn agent` druckt sie am Ende des Laufs. Eine echte
  Usage-Abfrage bietet die Gemini-API nicht — den offiziellen Stand zeigt
  https://ai.dev/rate-limit.

### So arbeitet der Agent

1. Im Board oben unter **"👤 Profil"** einmalig einen kurzen Text hinterlegen:
   wer du bist (Studium, Erfahrung) und was du dir wünschst (Orte, Gehalt,
   No-Gos). Beim ersten Öffnen geht das Profil-Fenster automatisch auf.
2. **"🤖 KI-Agent starten"** klicken. Der Agent bekommt nun ein Angebot nach
   dem nächsten vorgelegt — jeweils mit deinem Profil und dem **kompletten
   Seitentext** der Ausschreibung (`raw.detail`, HTML → Text) — und
   entscheidet: lohnt ein genauer Blick (**⭐ Interessant**) oder kann es weg
   (**🗄 Archiviert**)? Dazu vergibt er **strukturierte Punkte** (je 0–10) für
   Entfernung, Homeoffice/Remote, Gehalt, Vollzeit/Teilzeit, Verbeamtung und
   eine Gesamtpunktzahl, plus eine kurze Begründung. Der Fortschritt ist oben
   in der Leiste sichtbar; der Lauf lässt sich jederzeit stoppen und später
   fortsetzen (bereits bearbeitete Jobs werden nicht erneut angefragt).
   Abgearbeitet wird **sortiert**: öffentliche Arbeitgeber vor privaten
   (z.B. Accenture), innerhalb eines Arbeitgebers die früheste
   Bewerbungsfrist zuerst; Jobs ohne jede Gehaltsangabe kommen ganz nach
   hinten.
3. Wegen des Rate-Limits im Gratis-Kontingent (~10 Anfragen/Minute) pausiert
   der Agent zwischen zwei Anfragen — bei vielen hundert Angeboten läuft ein
   kompletter Erstlauf also eine ganze Weile; einfach laufen lassen. Standard
   ist **ein Angebot je Anfrage**; mit `AGENT_BATCH_SIZE` lassen sich mehrere
   bündeln (siehe
   [Sammel-Triage](#sammel-triage-mehrere-angebote-in-einer-anfrage)).

### Das Board

- **Spalten** (horizontal scrollbar): 📥 Noch abzuarbeiten → ⭐ Interessant →
  📨 Beworben → ❌ Bewerbung abgelehnt → 🗄 Archiviert.
- Karten lassen sich per **Drag & Drop** zwischen den Spalten verschieben —
  das zählt als menschliche Entscheidung. Jede Karte zeigt, ob sie zuletzt
  von der **🤖 KI** oder vom **👤 Menschen** eingruppiert wurde, dazu die
  KI-Punkte (Tooltip zeigt die Einzelbewertungen), Frist und Entgeltgruppe.
- **Sortierung**: Standard ist ⭐ KI-Punkte (absteigend). Über das Dropdown
  im Kopf jeder Spalte lässt sich jede Spalte einzeln nach 💶 Gehalt
  (Entgelt-/Besoldungsgruppe, dann Euro-Beträge, ohne Angabe zuletzt) oder
  ⏳ Bewerbungsfrist sortieren; das Dropdown oben in der Leiste setzt die
  Sortierung für **alle Spalten** auf einmal.
- **Klick auf eine Karte** öffnet das Detail-Modal mit Beschreibung,
  Voraussetzungen, KI-Begründung und dem **kompletten Chat-Verlauf mit dem
  KI-Agenten** (die große Triage-Anfrage ist einklappbar). Dort lassen sich
  auch **Folgefragen** stellen ("Erfülle ich die Voraussetzungen?") — die
  Antwort landet im selben Verlauf.

### Speicherung (Dateisystem statt localStorage)

Alles liegt als einfache Dateien unter `data/agent/` — **im Git**, damit
auch der GitHub-Workflow (siehe unten) damit arbeiten und die Ergebnisse
zurück ins Repo committen kann:

```
data/agent/board.json           Übersicht: Job-ID, Status, vonKi-Boolean, Punkte
data/agent/profil.md            dein Profil-Text
data/agent/jobs/<job-id>/job.json    Schnappschuss der Job-Informationen
data/agent/jobs/<job-id>/chat.json   Chat-Verlauf mit dem KI-Agenten
```

`board.json` ist die allgemeine Übersichtsdatei: pro Job die ID, der
Kanban-Status (`todo`/`interessant`/`beworben`/`abgelehnt`/`archiviert`)
und der Boolean `vonKi` (true = von der KI eingruppiert, false = vom
Menschen), dazu optional Gesamt-Punkte, die Einzelbewertungen
(`punkteDetails`: Entfernung, Homeoffice, Gehalt, Arbeitszeit, Verbeamtung,
Gesamt) und Begründung. Da Job-IDs Zeichen wie `:`
enthalten, werden sie für Ordnernamen zu `_` normalisiert
(`bka:T-2026-54` → `bka_T-2026-54`).

Board-Status und die Status/Notizen der statischen `jobs.html`
(localStorage im Browser) sind bewusst **zwei getrennte Welten** — die
statische Variante funktioniert weiterhin ohne Server.

## KI-Agent in GitHub Actions + Kanban auf GitHub Pages

Statt (oder zusätzlich zu) `yarn server` kann der KI-Agent komplett auf
GitHub laufen — ohne eigenen Rechner:

```
GitHub-Pages-Seite (docs/index.html, mobil optimiert)
  ↑ liest docs/data.json + docs/jobs/<id>.json
GitHub-Workflow "KI-Agent" (workflow_dispatch)
  1. übernimmt deine Browser-Änderungen (Input "aenderungen")
  2. triagiert neue Jobs mit Gemini (Secret GEMINI_API_KEY)
  3. committet data/agent/ + docs/ zurück ins Repo
```

### Einmalige Einrichtung

1. **Secret anlegen**: Repo → Settings → Secrets and variables → Actions →
   "New repository secret" → Name `GEMINI_API_KEY`, Wert von
   https://aistudio.google.com/apikey (gleicher Schlüssel wie lokal).
2. **Profil einchecken**: `data/agent/profil.md` ausfüllen (die Datei
   enthält eine Vorlage mit Beispiel) und committen — das ist der Input,
   den der Agent im Workflow bekommt. Solange noch die Vorlage drinsteht,
   bricht der Workflow mit einem Hinweis ab.
3. **GitHub Pages aktivieren**: Repo → Settings → Pages → Source
   "Deploy from a branch" → Branch `main`, Ordner `/docs`. Die Seite liegt
   dann unter `https://<user>.github.io/job-search/`.

### Einen Lauf starten

Actions → **KI-Agent** → "Run workflow". Vier optionale Eingaben:

- **aenderungen** — das JSON von der Pages-Seite (siehe unten); leer
  lassen, wenn es keine gibt.
- **limit** (Default 200, 0 = unbeschränkt) — wie viele neue Jobs dieser
  Lauf maximal triagiert. Das Gratis-Kontingent hat neben dem Minuten-
  auch ein **Tageslimit** (Größenordnung ein paar hundert Anfragen für
  die Flash-Modelle) — bei ~1000 offenen Jobs braucht der erste
  Komplettdurchlauf also mehrere Läufe an mehreren Tagen. Jeder Lauf macht
  dort weiter, wo der letzte aufgehört hat; bei aufgebrauchtem Kontingent
  bricht er ab und committet das bis dahin Geschaffte.
- **zeitlimit** (Default 30 Minuten, 0 = keins) — harte Obergrenze für die
  Laufzeit: nach Ablauf hört die Triage **sauber** auf (kein Abschuss
  mitten im Job), Ergebnisse und Pages-Daten werden ganz normal
  committet. Es gilt, was zuerst greift: limit oder zeitlimit. Als
  Notbremse bricht der Runner selbst zusätzlich 20 Minuten nach dem
  Zeitlimit ab (bzw. bei zeitlimit=0 nach 6 Stunden, dem Maximum von
  GitHub-gehosteten Runnern).
- **buendel** (Auswahlfeld, Default `standard`) — wie viele Angebote in
  **eine** Anfrage gepackt werden. Das Tageslimit zählt Anfragen, nicht
  Angebote: mit `2` werden aus 20 Anfragen 40 abgearbeitete Angebote, mit
  `dynamisch` füllt der Agent jede Anfrage so weit auf, wie es das Budget
  zulässt. `standard` nimmt die Repo-Variable `AGENT_BATCH_SIZE` bzw. den
  Default `1`. Details unter
  [Sammel-Triage](#sammel-triage-mehrere-angebote-in-einer-anfrage).

Lokal geht derselbe Headless-Lauf mit `yarn agent --limit=50 --minuten=10`
(Bündelgröße dort über `AGENT_BATCH_SIZE` in der `.env`).

### Bezahltes Gemini-Kontingent (z.B. Firmen-Account)

Der Workflow braucht als **Secret** nur `GEMINI_API_KEY` (auch hier sind
mehrere Keys erlaubt — durch Komma oder Zeilenumbruch getrennt, das Secret
darf mehrzeilig sein). Drei optionale
**Repo-Variablen** (Settings → Secrets and variables → Actions → Tab
"Variables" — nicht Secrets, da unkritisch) passen ihn an ein bezahltes
Kontingent an:

| Variable         | Beispiel (bezahlt)  | Wirkung                                     |
| ---------------- | ------------------- | ------------------------------------------- |
| `GEMINI_MODEL`   | `gemini-2.5-pro`    | anderes Modell für Triage & Chat            |
| `AGENT_DELAY_MS` | `500`               | kürzere Pause zwischen Anfragen (Default 7000) |
| `AGENT_BATCH_SIZE` | `1`               | Angebote je Anfrage — mit bezahltem Kontingent lohnt Bündeln nicht mehr, `1` (Default) gibt jedem Angebot den vollen Text |

Mit bezahltem Key entfallen Minuten-/Tageslimit praktisch — dann z.B.
limit=0, zeitlimit=60 und `AGENT_DELAY_MS=500` setzen, und ~1100 Jobs
laufen in einem einzigen Lauf durch. Wichtig: Es muss ein API-Schlüssel
der **Gemini Developer API** sein (AI Studio, beginnt mit `AIza…`) —
Vertex-AI-Zugänge (Google-Cloud-Projekt mit Service-Account) benutzen
eine andere Authentifizierung und funktionieren hier nicht.

### Änderungen von der Pages-Seite zurück ins Repo

Die Pages-Seite ist statisch und kann nicht ins Repo schreiben. Status-
Änderungen (Karte verschieben bzw. Status-Button im Detail) werden deshalb
**nur im Browser gemerkt** (localStorage) und als "⏳ lokal" markiert:

1. Oben erscheint der Button **"⏳ Änderungen (N)"** → antippen
2. **"Änderungen kopieren"** → JSON liegt in der Zwischenablage
3. Link "KI-Agent-Workflow öffnen" → "Run workflow" → JSON in das Feld
   **aenderungen** einfügen → starten
4. Der Workflow übernimmt sie als menschliche Entscheidungen
   (`vonKi: false`) und committet; beim nächsten Laden der Seite sind die
   Änderungen im Repo-Stand enthalten und werden lokal automatisch
   aufgeräumt (auch pro Änderung: was schon übernommen ist, fliegt aus dem
   localStorage)

Der Chat-Verlauf jedes Jobs ist auch auf der Pages-Seite einsehbar
(read-only); **Folgefragen** an den Agenten gehen nur in der lokalen
Server-Variante (`yarn server`).

## Gehaltstabellen (`yarn salaries`)

`src/salary/fetchSalaryTables.ts` lädt die Besoldungstabellen (Beamte) und
Entgelttabellen (öffentlicher Dienst) von academics.de und speichert sie als
`data/gehaltstabellen.json`:

- A-/B-/R-/W-Besoldung Bund
- TVöD Bund, TVöD VKA, TV-L, TV-H

Ergänzend dazu zwei Tabellen von oeffentlicher-dienst.info, die academics.de
nicht führt: **TV-BA** (Bundesagentur für Arbeit; Tätigkeitsebenen I–VIII,
intern als "T 1"–"T 8" abgelegt — die "AT"-Ebenen/außertariflich sind bewusst
nicht abgebildet) und **TVöD-SuE** (Sozial- und Erziehungsdienst; "S"-Gruppen
S2–S18). Beide werden über die jeweilige Übersichtsseite dynamisch auf die
aktuellste Jahres-ID aufgelöst (kein hartkodiertes Jahr im Code) und liefern
ISO-8859-15-kodiertes HTML, das vor dem Parsen entsprechend dekodiert wird.

## Unterstützte Portale

| Adapter   | Portal                                                    | Technik                                  |
| --------- | --------------------------------------------------------- | ---------------------------------------- |
| `itzbund` | ITZBund E-Recruiting (SAP, hostet u.a. ITZBund und Zoll)   | offener OData-Service + PDF-Volltext (`pdf-parse`) |
| `bka`     | BKA Karriereportal                                        | HTML-Liste + schema.org-JSON-LD          |
| `bwi`     | BWI GmbH                                                  | TYPO3-AJAX-Endpoint mit POST-Pagination  |
| `bnd`     | BND Karriereportal                                        | HTML-Liste (eine Seite, keine Pagination) + schema.org-JSON-LD + HTML-Facts |
| `interamt`| Interamt (Sammelportal, tausende Arbeitgeber)             | Playwright (JS-SPA, keine statische API) — feste Filter, siehe unten |
| `accenture`| Accenture Karriere                                       | öffentlicher Workday-CXS-Service, Trefferliste per Länder-Facet (Germany) gefiltert |

## Gespeicherte Felder

Pro Angebot (siehe `src/types.ts`): Titel, Link, Referenzcode, Arbeitgeber,
Beschreibung, Gehalt, Gehaltsstufe (Entgelt-/Besoldungsgruppe), Befristung
(Chips-Liste), Arbeitszeit (Chips: Vollzeit/Teilzeit), Verbeamtung (boolean),
Laufbahn (Chips: Einfacher/Mittlerer/Gehobener/Höherer Dienst), Dienstorte,
Homeoffice-/Mobiles-Arbeiten-Hinweis, Bewerbungsfrist, Voraussetzungen
zwingend/wünschenswert (Listen) sowie `firstSeen`/`lastSeen`.

Nicht jedes Portal nennt jedes Feld — z.B. veröffentlicht die BWI keine
Bewerbungsfristen. Beim ITZBund stehen Gehaltsstufe, Aufgaben und
Voraussetzungen nur im PDF der Ausschreibung (nicht im OData-Service); der
Adapter lädt daher zusätzlich jedes PDF und extrahiert den Volltext per
`pdf-parse` (siehe `extractPdfSections` in `src/extract.ts`). Die
Abschnittserkennung ("Ihre Aufgaben:", "Das erwarten wir von Ihnen:", "Das
wünschen wir uns:", "Was sollten Sie mitbringen?", ...) ist heuristisch, da
jede Behörde ihre eigene Vorlage nutzt — dieselbe Erkennung läuft auch beim
BND (HTML) und bei Interamt (Freitext von tausenden Arbeitgebern, entsprechend
lückenhafter). Nicht jeder Abschnitt wird in jedem Text gefunden.

### Interamt: feste Sucheinstellungen

`interamt` ist eine stark verschleierte JS-Single-Page-App ohne erreichbare
API — der Adapter startet dafür einen echten (unsichtbaren) Chromium-Browser
über Playwright und stellt auf der Suchmaske automatisch folgende Filter ein:

- **Dienstverhältnis**: Beamte, Tarifbeschäftigte
- **Bereich**: IT und Telekommunikation, Naturwissenschaften
- **Beschäftigungsdauer**: unbefristet

Diese Einstellungen stehen fest in `InteramtAdapter.ts` (`filterCheckboxes`,
`filterRadio`) und lassen sich dort bei Bedarf anpassen. Die Trefferliste
selbst liefert schon ID, Behörde, Titel, Besoldung/Entgelt, Ort, Dienstort-Art
(Homeoffice/Hybrid/Vor Ort) und Frist — nur für Beschreibung und
Voraussetzungen öffnet der Adapter (einmalig pro Job, dank Crawl-Cache) die
Detailseite. Bei ~500 Treffern dauert **der erste Lauf entsprechend lange**
(Playwright-Navigation pro neuem Job, grob 20–40 Minuten); Folgeläufe sind
schnell, da nur neu hinzugekommene Jobs einen Detail-Klick brauchen.
Playwright ist dafür eine echte Abhängigkeit (`yarn add playwright && yarn
playwright install chromium`, ca. 300 MB) — anders als bei den übrigen
Adaptern, die alle ohne Browser auskommen. Der gespeicherte `link` ist
Interamts "crypt."-Permalink (Wicket-eigener, für genau diese Verschlüsselung
gedachter Dauerlink) — sitzungsgebunden und daher nicht immer dauerhaft
stabil; läuft er ins Leere ("Sitzung abgelaufen"), hilft der **Referenzcode**
weiter: der Adapter sucht im Freitext der Detailseite nach einer vom
Arbeitgeber selbst vergebenen Kennziffer/Chiffre ("Kennziffer:",
"Referenznummer", "Chiffre:", "Stellen-ID", "Ausschreibungsnummer", ...) und
speichert die als `referenzcode` — nicht Interamts eigene, portalinterne
Angebots-ID. Damit lässt sich die Stelle notfalls auch über die
Original-Karriereseite des Arbeitgebers (z.B. karriere.bund.de) oder eine
Websuche wiederfinden. Nennt eine Anzeige keine eigene Kennziffer, bleibt
Interamts numerische Angebots-ID als Fallback erhalten, damit `referenzcode`
nie leer ist.

## Lebenszyklus der Daten

- Die Job-ID kommt aus der **Trefferliste** (nicht aus der Detailseite), damit
  der Abgleich ohne Detail-Abrufe funktioniert: ITZBund → Referenzcode/JobID
  aus OData, BKA → Dateiname der Detail-URL (z.B. "T-2026-54"), BWI →
  numerische ID im URL-Slug, BND → Kennziffer (z.B. "AS-2026-078") aus der
  Detail-URL, Interamt → numerische Angebots-ID aus der Tabellenzeile. Sie
  bleibt über Läufe stabil.
- Bekannte Jobs behalten ihr `firstSeen`; `lastSeen` zeigt, wann ein Job
  zuletzt auf dem Portal gesehen wurde.
- **Jobs mit abgelaufener Bewerbungsfrist werden bei jedem Lauf aus
  `data/jobs.json` gelöscht** (und im Terminal aufgelistet).
- Jobs ohne Frist bleiben liegen, auch wenn sie vom Portal verschwinden —
  erkennbar an einem alten `lastSeen`.

## Neues Portal anbinden

1. Neue Klasse in `src/adapters/` anlegen, die `JobPortalAdapter` erweitert
   (`name`, `label`, `baseUrl`, `fetchJobs()`), siehe bestehende Adapter als
   Vorlage.
2. In `src/adapters/index.ts` registrieren — fertig.

Für Seiten, die sich nicht per fetch scrapen lassen (Login, Cloudflare,
reines Client-Rendering wie Interamt), gibt es `PlaywrightAdapter` als
Basisklasse — `this.withPage(async (page) => { ... })` in der Unterklasse
verwenden; mit `this.headless = false` lässt sich z.B. ein Login von Hand
erledigen. Playwright ist seit dem `interamt`-Adapter eine echte Abhängigkeit
(`yarn install` reicht; falls Chromium fehlt: `yarn playwright install
chromium`).
