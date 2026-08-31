import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  competitionWindowState,
  optionsCompetitionControls,
  runAutonomousPaperCycle,
} from "../scripts/autonomous_paper_agent.mjs";

const WINDOW = Object.freeze({
  FINLY_COMPETITION_START_AT: "2026-08-31T13:30:00.000Z",
  FINLY_COMPETITION_END_AT: "2026-09-04T13:30:00.000Z",
  FINLY_OPTIONS_ENTRY_CUTOFF_AT: "2026-09-02T19:00:00.000Z",
  FINLY_OPTIONS_FORCE_FLAT_AT: "2026-09-03T19:00:00.000Z",
});

test("competition clock is exact, half-open, and rejects malformed configuration", () => {
  assert.equal(competitionWindowState(WINDOW, "2026-08-31T13:29:59.999Z").status, "WAITING_FOR_COMPETITION_WINDOW");
  assert.equal(competitionWindowState(WINDOW, "2026-08-31T13:30:00.000Z").status, "COMPETITION_WINDOW_OPEN");
  assert.equal(competitionWindowState(WINDOW, "2026-09-04T13:29:59.999Z").status, "COMPETITION_WINDOW_OPEN");
  assert.equal(competitionWindowState(WINDOW, "2026-09-04T13:30:00.000Z").status, "COMPETITION_WINDOW_ENDED");
  assert.throws(
    () => competitionWindowState({ ...WINDOW, FINLY_COMPETITION_START_AT: "August 31" }, new Date()),
    /canonical ISO timestamp/,
  );
  assert.throws(
    () => competitionWindowState({
      FINLY_COMPETITION_START_AT: WINDOW.FINLY_COMPETITION_END_AT,
      FINLY_COMPETITION_END_AT: WINDOW.FINLY_COMPETITION_START_AT,
    }, new Date()),
    /empty or inverted/,
  );
});

test("options entry cutoff and forced-flat boundaries are exact to one millisecond", () => {
  const beforeEntryCutoff = optionsCompetitionControls(WINDOW, "2026-09-02T18:59:59.999Z");
  assert.equal(beforeEntryCutoff.entry_gate_passed, true);
  assert.equal(beforeEntryCutoff.force_flat_required, false);
  const atEntryCutoff = optionsCompetitionControls(WINDOW, "2026-09-02T19:00:00.000Z");
  assert.equal(atEntryCutoff.entry_gate_passed, false);
  assert.equal(atEntryCutoff.force_flat_required, false);
  const afterEntryCutoff = optionsCompetitionControls(WINDOW, "2026-09-02T19:00:00.001Z");
  assert.equal(afterEntryCutoff.entry_gate_passed, false);
  assert.equal(afterEntryCutoff.force_flat_required, false);

  const beforeForceFlat = optionsCompetitionControls(WINDOW, "2026-09-03T18:59:59.999Z");
  assert.equal(beforeForceFlat.entry_gate_passed, false);
  assert.equal(beforeForceFlat.force_flat_required, false);
  const atForceFlat = optionsCompetitionControls(WINDOW, "2026-09-03T19:00:00.000Z");
  assert.equal(atForceFlat.entry_gate_passed, false);
  assert.equal(atForceFlat.force_flat_required, true);
  const afterForceFlat = optionsCompetitionControls(WINDOW, "2026-09-03T19:00:00.001Z");
  assert.equal(afterForceFlat.entry_gate_passed, false);
  assert.equal(afterForceFlat.force_flat_required, true);
  assert.throws(
    () => optionsCompetitionControls({ ...WINDOW, FINLY_OPTIONS_ENTRY_CUTOFF_AT: WINDOW.FINLY_COMPETITION_START_AT }, new Date()),
    /start < entry cutoff < force-flat < competition end/,
  );
});

test("options competition controls preserve their ordering over the full guarded window", () => {
  const start = Date.parse(WINDOW.FINLY_COMPETITION_START_AT) - 3_600_000;
  const end = Date.parse(WINDOW.FINLY_COMPETITION_END_AT) + 3_600_000;
  const cutoff = Date.parse(WINDOW.FINLY_OPTIONS_ENTRY_CUTOFF_AT);
  const forceFlat = Date.parse(WINDOW.FINLY_OPTIONS_FORCE_FLAT_AT);
  let state = 0x5f3759df;
  for (let run = 0; run < 10_000; run += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const observed = start + Math.floor((state / 2 ** 32) * (end - start));
    const controls = optionsCompetitionControls(WINDOW, new Date(observed));
    assert.equal(controls.entry_gate_passed, observed >= Date.parse(WINDOW.FINLY_COMPETITION_START_AT) && observed < cutoff);
    assert.equal(controls.force_flat_required, observed >= forceFlat && observed < Date.parse(WINDOW.FINLY_COMPETITION_END_AT));
    assert.equal(controls.entry_gate_passed && controls.force_flat_required, false);
  }
});

test("an enabled paper cycle makes no market reads or mutations outside the scoring window", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-competition-window-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let calls = 0;
  const executor = {
    submit: async () => { calls += 1; },
    positionManager: {
      inspectOpenSession: async () => { calls += 1; return { active: false }; },
      manageOpenSession: async () => { calls += 1; return { active: false }; },
    },
  };
  const environment = {
    ...WINDOW,
    FINLY_EXECUTION_ENABLED: "true",
    FINLY_PAPER_SIGNING_SECRET: "competition-window-test-secret-at-least-32-bytes",
  };
  for (const [label, instant, expected] of [
    ["before", "2026-08-31T13:29:59.999Z", "WAITING_FOR_COMPETITION_WINDOW"],
    ["after", "2026-09-04T13:30:00.000Z", "COMPETITION_WINDOW_ENDED"],
  ]) {
    const logPath = join(temporary, `${label}.jsonl`);
    const result = await runAutonomousPaperCycle({
      client: {},
      executor,
      economicBundleProvider: async () => { calls += 1; throw new Error("must not read economics outside window"); },
      inputProvider: async () => { calls += 1; throw new Error("must not read markets outside window"); },
      environment,
      now: () => new Date(instant),
      logPath,
      lockPath: join(temporary, `${label}.lock`),
    });
    assert.equal(result.ok, true);
    assert.equal(result.decision, "NO_TRADE");
    assert.equal(result.status, expected);
    const entries = (await readFile(logPath, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].event, "CYCLE_SKIPPED");
    assert.equal(entries[0].status, expected);
  }
  assert.equal(calls, 0);
});
