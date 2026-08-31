import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildGuardedLocalPaperExecutor,
  runAutonomousPaperCycle,
} from "../scripts/autonomous_paper_agent.mjs";

const NOW = "2026-08-31T13:31:00.000Z";
const SIGNING_SECRET = "g4-autonomous-gate-signing-secret-more-than-32-bytes";
const ENVIRONMENT = Object.freeze({
  FINLY_EXECUTION_ENABLED: "true",
  FINLY_G4_PRODUCTION_ENABLED: "true",
  FINLY_EXECUTION_TRANSPORT: "mcp",
  ALPACA_PAPER_TRADE: "true",
  FINLY_PAPER_MUTATION_ACK: "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT",
  FINLY_COMPETITION_ACCOUNT_ID: "PATEST123456",
  FINLY_COMPETITION_START_AT: "2026-08-31T13:30:00.000Z",
  FINLY_COMPETITION_END_AT: "2026-09-04T13:30:00.000Z",
  FINLY_OPTIONS_ENTRY_CUTOFF_AT: "2026-09-02T19:00:00.000Z",
  FINLY_OPTIONS_FORCE_FLAT_AT: "2026-09-03T19:00:00.000Z",
  FINLY_PAPER_SIGNING_SECRET: SIGNING_SECRET,
});

test("every non-READY G4 state returns before economic or options work", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-g4-autonomous-gate-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const status of ["G4_LEG_FILLED", "G4_READINESS_FAILED", "G4_EQUITY_FROZEN", "G4_ORDER_AMBIGUOUS"]) {
    const calls = [];
    const result = await runAutonomousPaperCycle({
      environment: ENVIRONMENT,
      signingSecret: SIGNING_SECRET,
      now: () => new Date(NOW),
      logPath: join(temporary, `${status}.jsonl`),
      lockPath: join(temporary, `${status}.lock`),
      executor: { submit: async () => { calls.push("submit"); } },
      positionManager: {
        inspectOpenSession: async () => { calls.push("inspect-options"); return { active: false }; },
        manageOpenSession: async () => { calls.push("manage-options"); return { active: false }; },
      },
      economicBundleProvider: async () => { calls.push("economic"); throw new Error("must not run"); },
      inputProvider: async () => { calls.push("options-input"); throw new Error("must not run"); },
      equityCoordinator: {
        advance: async () => ({
          status,
          equity_ready: false,
          options_authorized: false,
          readiness_receipt: null,
          mutation_started: status !== "G4_READINESS_FAILED",
        }),
        splitOptionsBrokerView: () => { calls.push("split-options"); throw new Error("must not run"); },
      },
    });
    assert.equal(result.status, status);
    assert.deepEqual(calls, []);
    const log = (await readFile(join(temporary, `${status}.jsonl`), "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(log.map((entry) => entry.event), ["CYCLE_STARTED", "G4_EQUITY_GATE"]);
    assert.ok(log.every((entry) => entry.decision === "NO_TRADE"));
  }
});

test("G4 mode cannot construct the options executor without the strict broker split", () => {
  assert.throws(() => buildGuardedLocalPaperExecutor({
    client: { tradingBase: "https://paper-api.alpaca.markets" },
    environment: ENVIRONMENT,
    signingSecret: SIGNING_SECRET,
  }), /options-only broker-view filter/u);
});
