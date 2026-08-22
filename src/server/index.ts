import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadJobs } from "../storage.js";
import type { JobOffer } from "../types.js";
import { askAboutJob, getAgentStatus, startAgent, stopAgent } from "./agent.js";
import { ensureEnv, type ServerEnv } from "./env.js";
import { getGeminiUsage } from "./gemini.js";
import { lightJob } from "./publish.js";
import {
  getEntry,
  loadBoard,
  loadChat,
  loadProfile,
  saveProfile,
  setNote,
  setStatus,
} from "./store.js";
import { BOARD_STATUSES, type BoardStatus } from "./types.js";

const KANBAN_FILE = join(process.cwd(), "src", "server", "kanban.html");

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function findJob(jobs: JobOffer[], encodedId: string): JobOffer | undefined {
  const id = decodeURIComponent(encodedId);
  return jobs.find((job) => job.id === id);
}

async function handle(
  env: ServerEnv,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && (path === "/" || path === "/kanban" || path === "/kanban.html")) {
    // bei jedem Request frisch lesen → UI-Änderungen ohne Server-Neustart
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(KANBAN_FILE, "utf8"));
    return;
  }

  if (method === "GET" && path === "/api/state") {
    const jobs = loadJobs();
    json(res, 200, {
      jobs: jobs.map(lightJob),
      board: loadBoard(),
      profile: loadProfile(),
      agent: getAgentStatus(),
      model: env.geminiModel,
      usage: getGeminiUsage(env),
      statuses: BOARD_STATUSES,
    });
    return;
  }

  if (method === "PUT" && path === "/api/profile") {
    const body = (await readBody(req)) as { text?: string };
    saveProfile(String(body.text ?? ""));
    json(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/api/agent/start") {
    const result = startAgent(env, loadJobs());
    json(res, result.started ? 200 : 409, { ...result, agent: getAgentStatus() });
    return;
  }

  if (method === "POST" && path === "/api/agent/stop") {
    stopAgent();
    json(res, 200, { ok: true, agent: getAgentStatus() });
    return;
  }

  if (method === "GET" && path === "/api/agent/status") {
    json(res, 200, getAgentStatus());
    return;
  }

  const jobMatch = path.match(/^\/api\/jobs\/([^/]+)(\/(status|chat|notiz))?$/);
  if (jobMatch) {
    const jobs = loadJobs();
    const job = findJob(jobs, jobMatch[1]);
    if (!job) {
      json(res, 404, { error: "Job nicht gefunden (evtl. abgelaufen und entfernt)." });
      return;
    }
    const sub = jobMatch[3];

    if (method === "GET" && !sub) {
      const { raw: _raw, ...detail } = job;
      json(res, 200, {
        job: detail,
        entry: getEntry(loadBoard(), job.id) ?? null,
        chat: loadChat(job.id),
      });
      return;
    }

    if (method === "POST" && sub === "status") {
      const body = (await readBody(req)) as { status?: string; notiz?: string };
      const status = body.status as BoardStatus;
      if (!BOARD_STATUSES.includes(status)) {
        json(res, 400, { error: `Ungültiger Status: ${body.status}` });
        return;
      }
      // Klick/Drag im UI = menschliche Entscheidung → vonKi false.
      // Eine mitgeschickte Notiz wird gleich mitgespeichert (z.B. beim
      // Archivieren: „warum weg?“) — ohne Notiz bleibt die alte stehen.
      const entry = setStatus(job.id, status, false, {
        notiz: body.notiz === undefined ? undefined : String(body.notiz),
      });
      json(res, 200, { ok: true, entry });
      return;
    }

    if (method === "PUT" && sub === "notiz") {
      const body = (await readBody(req)) as { notiz?: string };
      const entry = setNote(job.id, String(body.notiz ?? ""));
      json(res, 200, { ok: true, entry });
      return;
    }

    if (method === "POST" && sub === "chat") {
      const body = (await readBody(req)) as { frage?: string };
      const frage = String(body.frage ?? "").trim();
      if (!frage) {
        json(res, 400, { error: "Leere Frage." });
        return;
      }
      try {
        const chat = await askAboutJob(env, job, frage);
        json(res, 200, { ok: true, chat });
      } catch (error) {
        json(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
  }

  json(res, 404, { error: "Nicht gefunden" });
}

async function main(): Promise<void> {
  const env = await ensureEnv();
  const server = createServer((req, res) => {
    handle(env, req, res).catch((error) => {
      console.error("Serverfehler:", error);
      if (!res.headersSent) json(res, 500, { error: String(error) });
    });
  });
  server.listen(env.port, () => {
    console.log(`✔ Alle nötigen Informationen vorhanden (Modell: ${env.geminiModel}).`);
    console.log(`\n  Kanban-Board:  http://localhost:${env.port}/\n`);
    console.log(`Zum Beenden Strg+C drücken.`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
