import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const evidenceUrl = new URL("evidence/competition_forward_profit_2026_09_02.json", projectRoot);
const publicUrl = new URL("public/data/competition_forward_profit_2026_09_02.json", projectRoot);
const sourceUrl = new URL("src/data/competition_forward_profit_2026_09_02.json", projectRoot);
const optionsEvidenceUrl = new URL("evidence/options_live_decision_funnel_2026_09_02.json", projectRoot);
const optionsPublicUrl = new URL("public/data/options_live_decision_funnel_2026_09_02.json", projectRoot);
const optionsSourceUrl = new URL("src/data/options_live_decision_funnel_2026_09_02.json", projectRoot);

test("latest-close public evidence is byte-identical across archive, site, and compiled source", async () => {
  const [evidence, publicCopy, sourceCopy] = await Promise.all([
    readFile(evidenceUrl, "utf8"),
    readFile(publicUrl, "utf8"),
    readFile(sourceUrl, "utf8"),
  ]);
  assert.equal(publicCopy, evidence);
  assert.equal(sourceCopy, evidence);
});

test("latest-close claim uses one exact timestamp and a publishable read-only broker measurement", async () => {
  const measurement = JSON.parse(await readFile(evidenceUrl, "utf8"));
  assert.equal(measurement.schema_version, "finly_forward_profit_measurement.v1");
  assert.equal(measurement.status, "MEASURED");
  assert.equal(measurement.common_valued_at, "2026-09-02T20:00:00.000Z");
  assert.equal(measurement.integrity.exact_common_valued_at, true);
  assert.equal(measurement.integrity.claim_publishable, true);
  assert.equal(measurement.integrity.external_cashflows_zero, true);
  assert.equal(measurement.authority.paper_only, true);
  assert.equal(measurement.authority.read_only, true);
  assert.equal(measurement.authority.sanitized, true);
  assert.equal(measurement.authority.broker_mutation_authorized, false);

  assert.equal(measurement.primary_kpi.aligned_broker_equity_dollars, 100_141.24);
  assert.equal(measurement.primary_kpi.net_pnl_dollars, 141.24);
  assert.equal(measurement.benchmark.ending_value_on_same_baseline_dollars, 99_715.24);
  assert.equal(measurement.secondary_kpi.excess_pnl_dollars, 426);
  assert.equal(measurement.secondary_kpi.outperformed_spy, true);
  assert.equal(measurement.drivers.fill_event_count, 15);
  assert.equal(measurement.drivers.external_cashflow_event_count, 0);
});

test("dashboard labels the latest-close comparison without replacing the moving live mark", async () => {
  const dashboard = await readFile(new URL("src/CompetitionDashboard.tsx", projectRoot), "utf8");
  const exactUnsignedFormatter = dashboard.match(/const moneyExact = new Intl\.NumberFormat\("en-US", \{([\s\S]*?)\n\}\);/u);
  assert.ok(exactUnsignedFormatter, "dashboard must keep a dedicated exact-dollar formatter");
  assert.match(exactUnsignedFormatter[1], /maximumFractionDigits: 2/u);
  assert.match(exactUnsignedFormatter[1], /minimumFractionDigits: 2/u);
  assert.doesNotMatch(exactUnsignedFormatter[1], /signDisplay/u);
  assert.match(dashboard, /competition_forward_profit_2026_09_02\.json/);
  assert.match(dashboard, /Official score through September 2 · locked at 4:00 p\.m\./);
  assert.match(dashboard, /same closing-bell price/);
  assert.match(dashboard, /Finly finished \{moneyExact\.format\(latestCloseMeasurement\.secondary_kpi\.excess_pnl_dollars\)\} ahead/);
  assert.doesNotMatch(dashboard, /Finly ended day one \{money\.format\(/);
  assert.match(dashboard, /15 ETF fill events · no deposits or withdrawals/);
  assert.match(dashboard, /No options position was open at that close/);
  assert.match(dashboard, /same-clock score, not the changing account mark below/);
  assert.match(dashboard, /Latest account mark · changes with market prices/);
  assert.match(dashboard, /REMOTE_SNAPSHOT_URL/);
});

test("live options decision funnel is byte-identical and accounts for every cycle", async () => {
  const [archive, publicCopy, sourceCopy] = await Promise.all([
    readFile(optionsEvidenceUrl, "utf8"),
    readFile(optionsPublicUrl, "utf8"),
    readFile(optionsSourceUrl, "utf8"),
  ]);
  assert.equal(publicCopy, archive);
  assert.equal(sourceCopy, archive);
  const evidence = JSON.parse(archive);
  assert.equal(evidence.schema_version, "finly_live_options_decision_funnel.v1");
  assert.equal(evidence.totals.evaluation_cycles, 24);
  assert.equal(evidence.totals.no_trade_decisions, 24);
  assert.equal(evidence.totals.option_orders_submitted, 0);
  assert.equal(evidence.totals.option_fills, 0);
  assert.equal(evidence.totals.new_options_risk_dollars, 0);
  assert.equal(evidence.outcomes.reduce((sum, outcome) => sum + outcome.count, 0), 24);
  assert.deepEqual(evidence.outcomes.map(({ code, count }) => [code, count]), [
    ["NO_CERTIFIED_TRADE", 14],
    ["MODEL_EVIDENCE_NO_TRADE", 6],
    ["OPTIONS_ENTRY_CUTOFF_NO_TRADE", 4],
  ]);
});
