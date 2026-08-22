import type { JobOffer } from "../types.js";
import { detailGehoertZuJob, vertrauenswuerdigerText } from "./detail.js";
import { getEntry, loadBoard, saveBoard } from "./store.js";
import type { BoardStatus } from "./types.js";

/**
 * Entfernungsregel aus dem Profil: Der Nutzer wohnt im Raum
 * Osnabrück/Vechta/Cloppenburg und nimmt weite Wege nur noch in Kauf, wenn die
 * Stelle sie praktisch überflüssig macht.
 *
 *   Dienstort ab etwa 2,5 h (Bonn, Wiesbaden und weiter)
 *       → nur bei nahezu vollständigem Homeoffice
 *   Dienstort dazwischen (Münster, Hannover, Ruhrgebiet …)
 *       → nur, wenn überhaupt Homeoffice möglich ist
 *   Dienstort in Reichweite (bis ~45 min)
 *       → Entfernung spielt keine Rolle
 *
 * Was die Regel nicht erfüllt, wandert ohne KI-Anfrage ins Archiv — wie
 * abgelaufene Fristen (expiry.ts) und zu niedrige Gehälter (lowpay.ts).
 */

/** Ab dieser geschätzten Fahrzeit gilt ein Dienstort als "weit" (Bonn/Wiesbaden-Niveau). */
const WEIT_AB_MINUTEN = 150;
/** Bis hierhin ist die Entfernung unkritisch. */
const NAH_BIS_MINUTEN = 45;

/**
 * Geschätzte Autofahrzeit ab Osnabrück je PLZ-Leitregion (zweistellig, in
 * Minuten). Bewusst grob: es geht nur darum, "in Reichweite", "mittel" und
 * "so weit wie Bonn oder weiter" auseinanderzuhalten.
 */
const FAHRZEIT_PLZ: Record<string, number> = {
  "49": 40, "48": 60, "26": 70, "32": 70, "33": 75, "27": 80, "31": 85,
  "28": 90, "30": 90, "59": 90, "44": 105, "29": 110, "58": 110,
  "45": 120, "46": 120, "47": 125, "42": 130, "40": 135, "38": 140,
  "34": 150, "41": 145, "50": 150, "51": 150, "57": 150, "52": 165,
  "53": 165, "20": 165, "21": 165, "22": 165, "37": 170, "39": 180,
  "35": 190, "36": 190, "19": 190, "23": 190, "24": 200, "25": 200,
  "54": 200, "55": 200, "56": 200, "60": 210, "61": 210, "63": 210,
  "64": 210, "65": 210, "68": 240, "69": 240, "66": 240, "67": 240,
  "10": 240, "12": 240, "13": 240, "14": 240, "15": 240, "16": 240,
  "17": 240, "18": 240, "01": 260, "02": 260, "03": 250, "04": 240,
  "06": 230, "07": 240, "08": 270, "09": 270, "98": 250, "99": 240,
  "70": 300, "71": 300, "72": 320, "73": 310, "74": 290, "75": 300,
  "76": 300, "77": 330, "78": 350, "79": 360, "88": 350, "89": 330,
  "80": 330, "81": 330, "82": 340, "83": 350, "84": 340, "85": 330,
  "86": 320, "87": 350, "90": 300, "91": 300, "92": 300, "93": 320,
  "94": 340, "95": 300, "96": 290, "97": 270,
};

/** Städte ohne PLZ im Datensatz (BWI, Accenture, ITZBund, BKA). */
const FAHRZEIT_ORT: [RegExp, number][] = [
  [/osnabr|vechta|cloppenburg|melle|bramsche|quakenbr|damme|lohne|diepholz/i, 40],
  [/münster|muenster|rheine|ibbenb|steinfurt|lingen|nordhorn/i, 60],
  [/oldenburg|friesoythe|meppen|papenburg/i, 70],
  [/bielefeld|minden|herford|gütersloh|guetersloh/i, 75],
  [/bremen|delmenhorst|osterholz|wilhelmshaven|schortens/i, 90],
  [/hannover|nienburg|hameln|lohheide|loheide|munster/i, 90],
  [/dortmund|hamm|soest|paderborn/i, 105],
  [/essen|bochum|gelsenkirchen|duisburg|wesel|bocholt|celle/i, 120],
  [/d(ü|ue|u)sseldorf|wuppertal|krefeld|kleve|hilden|braunschweig|wolfsburg/i, 135],
  [/köln|koeln|leverkusen|kassel|siegen|mönchengladbach/i, 150],
  [/bonn|meckenheim|rheinbach|aachen|hamburg|göttingen|goettingen/i, 165],
  [/magdeburg|marburg|fulda|schwerin|lübeck|luebeck|potsdam|geltow|strausberg/i, 185],
  [/kiel|koblenz|trier|mainz|neubrandenburg|hoppegarten/i, 200],
  [/frankfurt|wiesbaden|offenbach|darmstadt|pfungstadt|kronberg|eschborn|bad homburg|sulzbach|berlin|storkow|rostock|leipzig|erfurt|jena/i, 215],
  [/speyer|saarbrücken|saarbruecken|kaiserslautern|mannheim|heidelberg|neukieritzsch|dresden/i, 245],
  [/stuttgart|karlsruhe|freiburg|ulm|bayreuth|würzburg|wuerzburg|veitshöchheim|veitshoechheim|nürnberg|nuernberg/i, 300],
  [/m(ü|ue|u)nchen|munich|augsburg|landshut|m(ü|ue|u)hldorf|pullach|bad aibling|regensburg|ingolstadt|erding|f(ü|ue|u)rstenfeldbruck|kaufbeuren|landsberg|feldkirchen|hof\b/i, 330],
];

/**
 * Standorte im Ausland — als Dienstort praktisch ausgeschlossen; sie werden
 * nur relevant, wenn dieselbe Ausschreibung auch einen deutschen Standort nennt
 * (dann gewinnt der ohnehin, weil die kürzeste Fahrzeit zählt).
 */
const AUSLAND =
  /\b(london|paris|madrid|barcelona|amsterdam|wien|z(ü|ue|u)rich|genf|warschau|warsaw|prag|prague|dublin|mailand|milan|lissabon|lisbon|bukarest|bucharest|sofia|stockholm|kopenhagen|oslo|helsinki|br(ü|ue|u)ssel|brussels|luxemburg|new york|singapur|singapore|bangalore|mumbai|tokyo|tokio)\b/i;
const AUSLAND_MINUTEN = 600;

/**
 * BWI und ähnliche Arbeitgeber schreiben "bundesweit" aus — gemeint ist einer
 * ihrer Standorte. Keiner liegt im Raum Osnabrück; der nächste ist Hannover.
 */
const BUNDESWEIT_MINUTEN = 90;

/** Geschätzte Fahrzeit zum nächstgelegenen Dienstort (undefined = unbekannt). */
export function fahrzeitMinuten(job: JobOffer): number | undefined {
  const orte = job.dienstorte.filter((ort) => ort.trim());
  if (!orte.length) return undefined;

  const zeiten: number[] = [];
  for (const ort of orte) {
    if (/bundesweit|deutschlandweit/i.test(ort)) {
      zeiten.push(BUNDESWEIT_MINUTEN);
      continue;
    }
    // Ein Feld kann mehrere Orte enthalten ("81541 München90489 Nürnberg")
    for (const plz of ort.matchAll(/\b(\d{5})\b/g)) {
      const treffer = FAHRZEIT_PLZ[plz[1].slice(0, 2)];
      if (treffer !== undefined) zeiten.push(treffer);
    }
    for (const [muster, minuten] of FAHRZEIT_ORT) {
      if (muster.test(ort)) zeiten.push(minuten);
    }
    if (AUSLAND.test(ort)) zeiten.push(AUSLAND_MINUTEN);
  }
  return zeiten.length ? Math.min(...zeiten) : undefined;
}

/** Wie ortsunabhängig die Stelle laut Ausschreibung ist. */
export type RemoteGrad = "voll" | "teilweise" | "keiner";

/** Belege für "praktisch ortsunabhängig" — das Profil verlangt genau das für weite Wege. */
const VOLL_REMOTE = [
  /\b100\s*%\s*(remote|home\s?office|mobil)/i,
  /voll(ständig|ständige|zeit)?\s*(remote|ortsunabhängig)/i,
  /remote[-\s]?(first|only)/i,
  // ab 60 % gilt als "ganz überwiegend"
  /\b(6\d|7\d|8\d|9\d|100)\s*%\s*(der\s*)?(arbeitszeit\s*)?(im\s*)?(home\s?office|mobile[sn]?\s*arbeiten|telearbeit)/i,
  /(home\s?office|mobile[sn]?\s*arbeiten|telearbeit)[^.]{0,40}\b(6\d|7\d|8\d|9\d|100)\s*%/i,
  /(ein|1|zwei|2)\s*(bis\s*(zwei|2)\s*)?(präsenz)?tage?\s*(pro|im)\s*monat/i,
  /home\s?office[^.]{0,40}innerhalb\s*von\s*deutschland/i,
  /ortsunabhängig(es)?\s*arbeiten/i,
  /überwiegend\s*(im\s*)?(home\s?office|remote|mobil)/i,
];

/** Irgendein Homeoffice — reicht für mittlere Entfernungen. */
const ETWAS_REMOTE =
  /home\s?office|homeoffice|mobile[sn]?\s*arbeiten|mobilem\s*arbeiten|telearbeit|remote|hybrid/i;

/**
 * Bewertet den Remote-Grad. Grundlage ist nur Text, dem man trauen darf —
 * bei vertauschtem Interamt-Detailtext also fast nichts, und dann kann ein
 * hoher Homeoffice-Anteil eben nicht belegt werden (siehe detail.ts).
 */
export function remoteGrad(job: JobOffer): RemoteGrad {
  const text = vertrauenswuerdigerText(job);
  if (VOLL_REMOTE.some((muster) => muster.test(text))) return "voll";
  return ETWAS_REMOTE.test(text) ? "teilweise" : "keiner";
}

/** Warum ein Angebot an der Entfernung scheitert — leer, wenn es sie erfüllt. */
export function entfernungsProblem(job: JobOffer): string | undefined {
  const minuten = fahrzeitMinuten(job);
  if (minuten === undefined || minuten <= NAH_BIS_MINUTEN) return undefined;

  const ort = job.dienstorte[0] ?? "unbekannt";
  const stunden = (minuten / 60).toFixed(1).replace(".", ",");
  const grad = remoteGrad(job);

  if (minuten >= WEIT_AB_MINUTEN) {
    if (grad === "voll") return undefined;
    const zusatz =
      detailGehoertZuJob(job) === false
        ? " Der gespeicherte Detailtext gehört zu einem anderen Angebot, ein hoher Homeoffice-Anteil ließ sich daher nicht belegen."
        : "";
    return (
      `Dienstort ${ort} liegt geschätzt rund ${stunden} Stunden Fahrt entfernt — so weit wie Bonn ` +
      `oder weiter. Dafür wäre laut deinem Profil eine praktisch ortsunabhängige Stelle nötig ` +
      `(100 % remote, ganz überwiegend Homeoffice oder ein bis zwei Präsenztage im Monat); ` +
      `die Ausschreibung belegt das nicht.${zusatz}`
    );
  }

  if (grad === "keiner") {
    return (
      `Dienstort ${ort} liegt geschätzt rund ${stunden} Stunden Fahrt entfernt, und die ` +
      `Ausschreibung nennt keinerlei Homeoffice-Möglichkeit. Ohne Homeoffice ist dir selbst ` +
      `diese Entfernung zu weit.`
    );
  }
  return undefined;
}

/** true, wenn das Angebot allein an der Entfernungsregel scheitert. */
export function istZuWeitWeg(job: JobOffer): boolean {
  return entfernungsProblem(job) !== undefined;
}

/** Statuswerte, die die automatische Archivierung überschreiben darf. */
const ARCHIVIERBARE_STATUS: BoardStatus[] = ["todo"];

/**
 * Archiviert alle Angebote, die an der Entfernungsregel scheitern und noch in
 * „Noch abzuarbeiten“ liegen. Gibt die archivierten Jobs zurück (für Logs).
 */
export function archiviereZuWeitEntfernte(jobs: JobOffer[]): JobOffer[] {
  const board = loadBoard();
  const archiviert: JobOffer[] = [];

  for (const job of jobs) {
    const problem = entfernungsProblem(job);
    if (!problem) continue;
    let entry = getEntry(board, job.id);
    if (entry && !ARCHIVIERBARE_STATUS.includes(entry.status)) continue;

    if (!entry) {
      entry = { jobId: job.id, status: "archiviert", vonKi: true, updatedAt: "" };
      board.entries.push(entry);
    }
    entry.status = "archiviert";
    entry.vonKi = true;
    entry.updatedAt = new Date().toISOString();
    entry.punkte = 0;
    entry.begruendung = `${problem} Automatisch archiviert (ohne KI-Anfrage).`;
    archiviert.push(job);
  }

  if (archiviert.length) saveBoard(board);
  return archiviert;
}

/** Kurzer Log-Satz für die Konsole (leer, wenn nichts archiviert wurde). */
export function distanzLogText(archiviert: JobOffer[]): string {
  if (!archiviert.length) return "✔ Keine Angebote wegen Entfernung zu archivieren.";
  return `✔ ${archiviert.length} Angebot(e) wegen zu großer Entfernung ohne ausreichendes Homeoffice archiviert.`;
}
