import { createServer } from "node:http";
import { DeterministicReplayPlanner, LocalLlamaPlanner } from "../lib/agent.mjs";
import { redactSecrets } from "../lib/canonical.mjs";
import { LocalLlamaEvidenceExtractor } from "../lib/evidence_extractor.mjs";

const port = Number(process.env.FINLY_LLAMA_API_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid FINLY_LLAMA_API_PORT");
const allowFallback = process.env.FINLY_ALLOW_DETERMINISTIC_FALLBACK === "true";
const llama = new LocalLlamaPlanner();
const evidenceExtractor = new LocalLlamaEvidenceExtractor();

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("request body exceeds 1 MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(redactSecrets(payload))}\n`);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return send(response, 200, {
        status: "ok",
        scope: "loopback-only",
        model: llama.model,
        fallback_enabled: allowFallback,
        capabilities: ["typed_intent_formatting", "bounded_evidence_assessment"],
        broker_authority: "none",
      });
    }
    if (request.method === "POST" && request.url === "/v1/evidence") {
      const body = await readJson(request);
      const assessment = await evidenceExtractor.assessDocuments(body.documents, body.options ?? {});
      return send(response, 200, { planner_mode: "local_llama_bounded_extractor", assessment });
    }
    if (request.method !== "POST" || request.url !== "/v1/intents") {
      return send(response, 404, { error: "not_found" });
    }
    const body = await readJson(request);
    let planner = llama;
    let plannerMode = "local_llama";
    try {
      const intent = await planner.proposeIntent(body.signals, body.options ?? {});
      return send(response, 200, { planner_mode: plannerMode, intent });
    } catch (error) {
      if (!allowFallback) throw error;
      planner = new DeterministicReplayPlanner();
      plannerMode = "deterministic_replay_fallback";
      const intent = await planner.proposeIntent(body.signals, body.options ?? {});
      return send(response, 200, { planner_mode: plannerMode, warning: "No local Llama response; deterministic replay fallback used.", intent });
    }
  } catch (error) {
    return send(response, 400, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Finly local intent API listening on http://127.0.0.1:${port}\n`);
});
