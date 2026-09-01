import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const evidenceUrl = new URL("evidence/competition_forward_profit_2026_08_31.json", projectRoot);
const publicUrl = new URL("public/data/competition_forward_profit_2026_08_31.json", projectRoot);
const sourceUrl = new URL("src/data/competition_forward_profit_2026_08_31.json", projectRoot);

test("first-close public evidence is byte-identical across archive, site, and compiled source", async () => {
  const [evidence, publicCopy, sourceCopy] = await Promise.all([
    readFile(evidenceUrl, "utf8"),
    readFile(publicUrl, "utf8"),
    readFile(sourceUrl, "utf8"),
  ]);
  assert.equal(publicCopy, evidence);
  assert.equal(sourceCopy, evidence);
});

test("first-close claim uses one exact timestamp and a publishable read-only broker measurement", async () => {
  const measurement = JSON.parse(await readFile(evidenceUrl, "utf8"));
  assert.equal(measurement.schema_version, "finly_forward_profit_measurement.v1");
  assert.equal(measurement.status, "MEASURED");
  assert.equal(measurement.common_valued_at, "2026-08-31T20:00:00.000Z");
  assert.equal(measurement.integrity.exact_common_valued_at, true);
  assert.equal(measurement.integrity.claim_publishable, true);
  assert.equal(measurement.integrity.external_cashflows_zero, true);
  assert.equal(measurement.authority.paper_only, true);
  assert.equal(measurement.authority.read_only, true);
  assert.equal(measurement.authority.sanitized, true);
  assert.equal(measurement.authority.broker_mutation_authorized, false);

  assert.equal(measurement.primary_kpi.aligned_broker_equity_dollars, 100_095.32);
  assert.equal(measurement.primary_kpi.net_pnl_dollars, 95.32);
  assert.equal(measurement.benchmark.ending_value_on_same_baseline_dollars, 99_942.01);
  assert.equal(measurement.secondary_kpi.excess_pnl_dollars, 153.31);
  assert.equal(measurement.secondary_kpi.outperformed_spy, true);
  assert.equal(measurement.drivers.fill_event_count, 15);
  assert.equal(measurement.drivers.external_cashflow_event_count, 0);
});

test("dashboard labels the first-close comparison without replacing the moving live mark", async () => {
  const dashboard = await readFile(new URL("src/CompetitionDashboard.tsx", projectRoot), "utf8");
  const exactUnsignedFormatter = dashboard.match(/const moneyExact = new Intl\.NumberFormat\("en-US", \{([\s\S]*?)\n\}\);/u);
  assert.ok(exactUnsignedFormatter, "dashboard must keep a dedicated exact-dollar formatter");
  assert.match(exactUnsignedFormatter[1], /maximumFractionDigits: 2/u);
  assert.match(exactUnsignedFormatter[1], /minimumFractionDigits: 2/u);
  assert.doesNotMatch(exactUnsignedFormatter[1], /signDisplay/u);
  assert.match(dashboard, /competition_forward_profit_2026_08_31\.json/);
  assert.match(dashboard, /Official day-one score · locked at 4:00 p\.m\./);
  assert.match(dashboard, /same closing-bell price/);
  assert.match(dashboard, /Finly finished its first paper-trading session \{moneyExact\.format\(firstCloseMeasurement\.secondary_kpi\.excess_pnl_dollars\)\} ahead/);
  assert.doesNotMatch(dashboard, /Finly ended day one \{money\.format\(/);
  assert.match(dashboard, /15 broker fill events · no deposits or withdrawals/);
  assert.match(dashboard, /No options position was open at that close/);
  assert.match(dashboard, /locked day-one score, not the changing account mark below/);
  assert.match(dashboard, /Latest account mark · changes with market prices/);
  assert.match(dashboard, /REMOTE_SNAPSHOT_URL/);
});
