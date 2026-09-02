import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCloudStatePayload,
  checkpointCloudState,
  decryptCloudState,
  encryptCloudState,
  restoreCloudState,
} from "../scripts/cloud_state.mjs";
import {
  assertOpeningControlPlaneReadiness,
  buildCompetitionLiveSnapshot,
  isDedicatedActivePaperAccount,
} from "../scripts/build_competition_live_snapshot.mjs";
import { G4_MUTATION_ACK } from "../lib/g4_official_equity.mjs";
import { evaluateCloudRunGate } from "../scripts/cloud_run_gate.mjs";
import {
  buildFeatherlessReadinessDocument,
  runFeatherlessReadinessCheck,
} from "../scripts/featherless_readiness_check.mjs";

const WINDOW = Object.freeze({
  FINLY_COMPETITION_START_AT: "2026-08-31T13:30:00.000Z",
  FINLY_COMPETITION_END_AT: "2026-09-04T13:30:00.000Z",
});
const STATE_SECRET = "cloud-state-unit-test-secret-at-least-32-bytes";

test("cloud run gate admits only initialization, readiness, live, and final windows", () => {
  assert.deepEqual(evaluateCloudRunGate({
    environment: WINDOW,
    eventName: "workflow_dispatch",
    initializeRequested: true,
    now: "2026-08-30T12:00:00.000Z",
  }), {
    should_run: true,
    mode: "initialize",
    mutation_enabled: false,
    window_status: "WAITING_FOR_COMPETITION_WINDOW",
  });
  assert.equal(evaluateCloudRunGate({ environment: WINDOW, now: "2026-08-31T12:00:00.000Z" }).should_run, false);
  assert.equal(evaluateCloudRunGate({ environment: WINDOW, now: "2026-08-31T13:00:00.000Z" }).mode, "readiness");
  assert.equal(evaluateCloudRunGate({ environment: WINDOW, now: "2026-08-31T13:30:00.000Z" }).mode, "live");
  assert.equal(evaluateCloudRunGate({ environment: WINDOW, now: "2026-09-04T13:30:00.000Z" }).mode, "final");
  assert.equal(evaluateCloudRunGate({ environment: WINDOW, now: "2026-09-04T15:30:00.001Z" }).should_run, false);
  assert.throws(() => evaluateCloudRunGate({
    environment: WINDOW,
    eventName: "workflow_dispatch",
    initializeRequested: true,
    now: "2026-08-31T13:30:00.000Z",
  }), /locked after the competition begins/);
});

test("cloud state round-trips only allowlisted files and rejects a wrong key or tampering", async (t) => {
  const source = await mkdtemp(join(tmpdir(), "finly-cloud-state-source-"));
  const restored = await mkdtemp(join(tmpdir(), "finly-cloud-state-restored-"));
  t.after(() => Promise.all([
    rm(source, { recursive: true, force: true }),
    rm(restored, { recursive: true, force: true }),
  ]));
  await mkdir(join(source, "data/ledger"), { recursive: true });
  await mkdir(join(source, "data/private/g4-official-equity"), { recursive: true });
  await mkdir(join(source, "data/private/paper-sessions"), { recursive: true });
  await mkdir(join(source, "outputs"), { recursive: true });
  await writeFile(join(source, "data/ledger/permit.json"), '{"status":"reserved"}\n');
  await writeFile(join(source, "data/private/g4-official-equity/state.json"), '{"status":"MUTATION_PENDING"}\n');
  await writeFile(join(source, "data/private/paper-sessions/paper-sessions.json"), '{"revision":2}\n');
  await writeFile(join(source, "outputs/autonomous_decisions.jsonl"), '{"decision":"NO_TRADE"}\n');
  await writeFile(join(source, "outputs/g4_official_equity.jsonl"), '{"status":"READY"}\n');
  const payload = await buildCloudStatePayload({ root: source, createdAt: "2026-08-30T12:00:00.000Z" });
  assert.deepEqual(payload.files.map((file) => file.path), [
    "data/ledger/permit.json",
    "data/private/g4-official-equity/state.json",
    "data/private/paper-sessions/paper-sessions.json",
    "outputs/autonomous_decisions.jsonl",
    "outputs/g4_official_equity.jsonl",
  ]);
  const envelope = encryptCloudState(payload, STATE_SECRET, {
    salt: Buffer.alloc(16, 1),
    iv: Buffer.alloc(12, 2),
  });
  assert.equal(JSON.stringify(envelope).includes("reserved"), false);
  assert.deepEqual(decryptCloudState(envelope, STATE_SECRET), payload);
  await restoreCloudState({ root: restored, envelope, secret: STATE_SECRET });
  assert.equal(await readFile(join(restored, "data/ledger/permit.json"), "utf8"), '{"status":"reserved"}\n');
  assert.throws(() => decryptCloudState(envelope, `${STATE_SECRET}-wrong`), /authentication failed/);
  const tampered = { ...envelope, ciphertext_b64: `${envelope.ciphertext_b64.slice(0, -4)}AAAA` };
  assert.throws(() => decryptCloudState(tampered, STATE_SECRET), /authentication failed/);
});

test("public competition feed exposes useful totals without account, order, credential, or contract identifiers", () => {
  const forbidden = {
    accountNumber: "PA0123456789",
    orderId: "broker-order-0123456789",
    optionSymbol: "SPY260904C00600000",
    secret: "APCA_SECRET_DO_NOT_PUBLISH",
  };
  const snapshot = buildCompetitionLiveSnapshot({
    account: {
      account_number: forbidden.accountNumber,
      equity: "100125.50",
      cash: "99500.25",
      options_buying_power: "99400.25",
      secret_key: forbidden.secret,
    },
    positions: [{
      asset_class: "us_option",
      symbol: forbidden.optionSymbol,
      market_value: "625.25",
      unrealized_pl: "125.50",
    }],
    openOrders: [{
      id: forbidden.orderId,
      asset_class: "",
      order_class: "mleg",
      client_order_id: "finly-0123456789abcdefabcd",
      legs: [
        { asset_class: "us_option", symbol: "SPY260904C00600000" },
        { asset_class: "us_option", symbol: "SPY260904C00610000" },
      ],
    }],
    clock: {
      is_open: true,
      next_open: "2026-09-01T13:30:00.000Z",
      next_close: "2026-08-31T20:00:00.000Z",
    },
    latestDecision: {
      event: "DECISION_COMPLETED",
      decision: "BULL_CALL_DEBIT_SPREAD",
      execution: { status: "SUBMITTED_BY_INJECTED_EXECUTOR", submitted: true, broker_result: { id: forbidden.orderId } },
      receipt: {
        intent: { direction: "bullish" },
        certificate: { reserved_max_loss: 480 },
        raw_secret: forbidden.secret,
      },
    },
    observedAt: "2026-08-31T14:00:00.000Z",
    accountVerified: true,
  });
  assert.equal(snapshot.schema_version, "finly_competition_dashboard.v2");
  assert.equal(snapshot.account.equity, 100125.5);
  assert.equal(snapshot.competition.baseline_equity, 100000);
  assert.equal(snapshot.exposure.open_positions, 1);
  assert.equal(snapshot.exposure.g4_equity_market_value_dollars, 0);
  assert.equal(snapshot.exposure.options_defined_risk_dollars, 480);
  assert.equal(snapshot.decision.status, "HOLDING");
  assert.equal(snapshot.integrity.account_verified, true);
  const serialized = JSON.stringify(snapshot);
  for (const value of Object.values(forbidden)) assert.equal(serialized.includes(value), false);
});

test("public competition feed separates Finly Core from the options maximum loss", () => {
  const snapshot = buildCompetitionLiveSnapshot({
    account: { equity: 100500, cash: 2500, options_buying_power: 2000 },
    positions: [
      { asset_class: "us_equity", symbol: "QQQ", market_value: "50000.00" },
      { asset_class: "us_equity", symbol: "XLV", market_value: "47000.00" },
      { asset_class: "us_option", symbol: "SPY260904P00600000", market_value: "-125.00" },
      { asset_class: "us_option", symbol: "SPY260904P00590000", market_value: "70.00" },
    ],
    openOrders: [],
    clock: {
      is_open: true,
      next_open: "2026-09-01T13:30:00.000Z",
      next_close: "2026-08-31T20:00:00.000Z",
    },
    latestDecision: { event: "POSITION_MANAGED", management: { status: "HOLDING" } },
    certifiedOptionsRisk: 500,
    observedAt: "2026-08-31T14:00:00.000Z",
    accountVerified: true,
  });
  assert.equal(snapshot.exposure.open_positions, 4);
  assert.equal(snapshot.exposure.g4_equity_positions, 2);
  assert.equal(snapshot.exposure.g4_equity_market_value_dollars, 97000);
  assert.equal(snapshot.exposure.option_positions, 2);
  assert.equal(snapshot.exposure.options_defined_risk_dollars, 500);
  assert.equal(snapshot.decision.status, "HOLDING");
  assert.match(snapshot.exposure.position_summary, /four-fund allocation sleeve.*capped-loss options/i);
});

test("public competition feed refuses to guess options risk or accept an unknown asset class", () => {
  const common = {
    account: { equity: 100000, cash: 100000, options_buying_power: 100000 },
    openOrders: [],
    clock: {
      is_open: true,
      next_open: "2026-09-01T13:30:00.000Z",
      next_close: "2026-08-31T20:00:00.000Z",
    },
    observedAt: "2026-08-31T14:00:00.000Z",
    accountVerified: true,
  };
  assert.throws(() => buildCompetitionLiveSnapshot({
    ...common,
    positions: [{ asset_class: "us_option", symbol: "SPY260904C00600000", market_value: 10 }],
  }), /certified options max loss is unavailable/);
  assert.throws(() => buildCompetitionLiveSnapshot({
    ...common,
    positions: [{ asset_class: "crypto", market_value: 10 }],
  }), /non-allowlisted asset class/);
  assert.throws(() => buildCompetitionLiveSnapshot({
    ...common,
    positions: [{ asset_class: "us_option", symbol: "QQQ260904C00600000", market_value: 10 }],
    certifiedOptionsRisk: 500,
  }), /outside the SPY overlay/);
});

test("dashboard account verification requires every pinned active-paper flag exactly", () => {
  const expected = "PA0123456789";
  const account = {
    account_number: expected,
    status: "ACTIVE",
    trading_blocked: false,
    account_blocked: false,
    trade_suspended_by_user: false,
  };
  assert.equal(isDedicatedActivePaperAccount(account, expected), true);
  for (const patch of [
    { account_number: "PA9876543210" },
    { status: "INACTIVE" },
    { trading_blocked: true },
    { account_blocked: true },
    { account_blocked: undefined },
    { trade_suspended_by_user: true },
    { trade_suspended_by_user: undefined },
  ]) {
    assert.equal(isDedicatedActivePaperAccount({ ...account, ...patch }, expected), false);
  }
});

function openingControlFixture() {
  const expectedAccountId = "PA0123456789";
  return {
    account: {
      account_number: expectedAccountId,
      status: "ACTIVE",
      trading_blocked: false,
      account_blocked: false,
      trade_suspended_by_user: false,
      equity: "100000.00",
      cash: "100000.00",
      options_trading_level: 3,
      options_approved_level: 3,
    },
    configuration: { suspend_trade: false },
    clock: {
      timestamp: "2026-08-31T08:30:00.123456789-04:00",
      is_open: false,
      next_open: "2026-08-31T09:30:00-04:00",
      next_close: "2026-08-31T16:00:00-04:00",
    },
    positions: [],
    openOrders: [],
    assets: ["QQQ", "XLB", "XLE", "XLV"].map((symbol) => ({
      symbol,
      class: "us_equity",
      status: "active",
      tradable: true,
      fractionable: true,
    })),
    expectedAccountId,
    environment: {
      ALPACA_PAPER_TRADE: "true",
      FINLY_G4_PRODUCTION_ENABLED: "true",
      FINLY_EXECUTION_TRANSPORT: "mcp",
      FINLY_EXECUTION_ENABLED: "false",
      FINLY_PAPER_MUTATION_ACK: G4_MUTATION_ACK,
    },
    observedAt: "2026-08-31T12:30:00.000Z",
  };
}

test("opening control plane authenticates the exact pre-open broker and asset state", () => {
  assert.equal(assertOpeningControlPlaneReadiness(openingControlFixture()), true);
  const attacks = [
    (value) => { value.environment = { ...value.environment, FINLY_PAPER_MUTATION_ACK: "wrong" }; },
    (value) => { value.environment = { ...value.environment, FINLY_EXECUTION_ENABLED: "true" }; },
    (value) => { value.configuration = { suspend_trade: true }; },
    (value) => { value.account = { ...value.account, options_approved_level: 2 }; },
    (value) => { value.account = { ...value.account, options_trading_level: 3.5 }; },
    (value) => { value.account = { ...value.account, cash: "99999.99" }; },
    (value) => { value.account = { ...value.account, equity: "99999.999" }; },
    (value) => { value.clock = { ...value.clock, timestamp: "2026-08-31T08:20:00-04:00" }; },
    (value) => { value.clock = { ...value.clock, next_open: "2026-08-31T09:31:00-04:00" }; },
    (value) => { value.positions = [{ asset_class: "us_equity", symbol: "QQQ" }]; },
    (value) => { value.openOrders = [{ asset_class: "us_equity", symbol: "QQQ" }]; },
    (value) => { value.assets[0] = { ...value.assets[0], symbol: "SPY" }; },
    (value) => { value.assets[1] = { ...value.assets[1], class: "crypto" }; },
    (value) => { value.assets[2] = { ...value.assets[2], status: "inactive" }; },
    (value) => { value.assets[3] = { ...value.assets[3], tradable: false }; },
    (value) => { value.assets[1] = { ...value.assets[1], fractionable: false }; },
  ];
  for (const attack of attacks) {
    const value = openingControlFixture();
    attack(value);
    assert.throws(() => assertOpeningControlPlaneReadiness(value));
  }
});

test("opening control plane permits legitimate holdings after the window begins", () => {
  const value = openingControlFixture();
  value.observedAt = "2026-08-31T14:00:00.000Z";
  value.environment = { ...value.environment, FINLY_EXECUTION_ENABLED: "true" };
  value.clock = {
    timestamp: "2026-08-31T10:00:00.123456789-04:00",
    is_open: true,
    next_open: "2026-09-01T09:30:00-04:00",
    next_close: "2026-08-31T16:00:00-04:00",
  };
  value.account = { ...value.account, equity: "100125.00", cash: "3000.02" };
  value.positions = [{ asset_class: "us_equity", symbol: "QQQ" }];
  assert.equal(assertOpeningControlPlaneReadiness(value), true);
});

test("public competition feed accepts only the pinned Alpaca mleg parent shape for open options orders", () => {
  const common = {
    account: { equity: 100000, cash: 99500, options_buying_power: 99500 },
    positions: [],
    clock: {
      is_open: true,
      next_open: "2026-09-01T13:30:00.000Z",
      next_close: "2026-08-31T20:00:00.000Z",
    },
    latestDecision: {
      event: "DECISION_COMPLETED",
      decision: "BULL_CALL_DEBIT_SPREAD",
      execution: { status: "SUBMITTED_BY_INJECTED_EXECUTOR", submitted: true },
      receipt: { certificate: { reserved_max_loss: 500 } },
    },
    observedAt: "2026-08-31T14:00:00.000Z",
    accountVerified: true,
  };
  const officialMleg = {
    asset_class: "",
    order_class: "mleg",
    client_order_id: "finly-0123456789abcdefabcd",
    legs: [
      { asset_class: "us_option", symbol: "SPY260904C00600000" },
      { asset_class: "us_option", symbol: "SPY260904C00610000" },
    ],
  };
  const accepted = buildCompetitionLiveSnapshot({ ...common, openOrders: [officialMleg] });
  assert.equal(accepted.exposure.option_open_orders, 1);
  assert.equal(accepted.exposure.options_defined_risk_dollars, 500);
  assert.throws(() => buildCompetitionLiveSnapshot({
    ...common,
    openOrders: [{ ...officialMleg, asset_class: "us_option" }],
  }), /unsupported order shape/);
  assert.throws(() => buildCompetitionLiveSnapshot({
    ...common,
    openOrders: [{
      ...officialMleg,
      legs: [officialMleg.legs[0], { asset_class: "us_option", symbol: "QQQ260904C00610000" }],
    }],
  }), /unsupported order shape/);
});

test("cloud checkpoint publishes only encrypted state and the sanitized dashboard contract", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "finly-cloud-publication-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, "root");
  const publication = join(temporary, "publication");
  const remote = join(temporary, "remote.git");
  await mkdir(join(root, "data/ledger"), { recursive: true });
  await mkdir(publication, { recursive: true });
  await writeFile(join(root, "data/ledger/permit.json"), '{"status":"reserved"}\n');
  execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
  execFileSync("git", ["-C", publication, "init"], { stdio: "ignore" });
  execFileSync("git", ["-C", publication, "switch", "--orphan", "finly-cloud-state"], { stdio: "ignore" });
  execFileSync("git", ["-C", publication, "config", "user.name", "finly-test"], { stdio: "ignore" });
  execFileSync("git", ["-C", publication, "config", "user.email", "finly-test@example.invalid"], { stdio: "ignore" });
  execFileSync("git", ["-C", publication, "remote", "add", "origin", remote], { stdio: "ignore" });
  const snapshot = buildCompetitionLiveSnapshot({
    account: { equity: 100000, cash: 100000, options_buying_power: 100000 },
    positions: [],
    openOrders: [],
    clock: {
      is_open: false,
      next_open: "2026-08-31T13:30:00.000Z",
      next_close: "2026-08-31T20:00:00.000Z",
    },
    observedAt: "2026-08-30T15:00:00.000Z",
    accountVerified: true,
  });
  const snapshotPath = join(temporary, "snapshot.json");
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const result = await checkpointCloudState({
    root,
    publicationDirectory: publication,
    secret: STATE_SECRET,
    snapshotPath,
  });
  assert.equal(result.published, true);
  const publicBytes = execFileSync("git", ["--git-dir", remote, "show", "finly-cloud-state:competition_live.json"], { encoding: "utf8" });
  const privateBytes = execFileSync("git", ["--git-dir", remote, "show", "finly-cloud-state:private-state.enc.json"], { encoding: "utf8" });
  assert.equal(JSON.parse(publicBytes).schema_version, "finly_competition_dashboard.v2");
  assert.equal(privateBytes.includes("reserved"), false);
});

test("pre-open hosted-model smoke check uses one synthetic evidence document and no broker data", async () => {
  const instant = "2026-08-31T13:00:00.000Z";
  const fixture = buildFeatherlessReadinessDocument(instant);
  assert.equal(fixture.asOf, instant);
  const serialized = JSON.stringify(fixture);
  for (const forbidden of ["account_number", "client_order_id", "options_buying_power", "APCA_API_KEY"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  let received;
  const result = await runFeatherlessReadinessCheck({
    now: instant,
    extractor: {
      assessDocuments: async (documents, context) => {
        received = { documents, context };
        return {
          schema_version: "evidence_assessment.v1",
          assessments: [{
            evidence_id: documents[0].record.evidence_id,
            direction_score: 0,
            volatility_score: 0,
            rationale: "The synthetic fixture is directionally neutral by design.",
          }],
        };
      },
    },
  });
  assert.equal(result.status, "HOSTED_EVIDENCE_READY");
  assert.equal(received.documents.length, 1);
  assert.deepEqual(received.context, { underlying: "SPY", asOf: instant });
});

test("cloud workflow is date-gated, serialized, stateful, paper-only, with an optional pinned hosted extractor", async () => {
  const workflow = await readFile(new URL("../.github/workflows/paper-agent-cloud.yml", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("../src/CompetitionDashboard.tsx", import.meta.url), "utf8");
  const introspection = await readFile(new URL("../scripts/introspect_alpaca_mcp.py", import.meta.url), "utf8");
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /FINLY_CODE_VERSION:\s*572b8a60e845fabd910f5d4843c51697abcc82ad/);
  assert.equal(
    [...workflow.matchAll(/^\s*FINLY_CODE_VERSION:/gm)].length,
    1,
    "the audited trading revision must have exactly one source of truth",
  );
  assert.equal(
    [...workflow.matchAll(/ref:\s*\$\{\{ env\.FINLY_CODE_VERSION \}\}/g)].length,
    2,
    "both cloud jobs must check out the independently audited trading revision",
  );
  assert.equal(
    [...workflow.matchAll(/uses:\s*actions\/checkout@v7\.0\.1/g)].length,
    2,
    "every checkout in the trading workflow must be accounted for",
  );
  assert.doesNotMatch(workflow, /FINLY_CODE_VERSION:\s*\$\{\{/);
  assert.equal(
    [...workflow.matchAll(/name:\s*Attest the audited trading revision/g)].length,
    2,
    "both jobs must independently attest their checked-out trading revision",
  );
  assert.equal(
    [...workflow.matchAll(/^\s*set -eu$/gm)].length,
    2,
    "both attestations must abort when either Git command fails",
  );
  assert.equal(
    [...workflow.matchAll(/actual_head="\$\(git rev-parse --verify HEAD\)"/g)].length,
    2,
  );
  assert.equal(
    [...workflow.matchAll(/worktree_status="\$\(git status --porcelain=v1 --untracked-files=all\)"/g)].length,
    2,
  );
  assert.equal([...workflow.matchAll(/test "\$actual_head" = "\$FINLY_CODE_VERSION"/g)].length, 2);
  assert.equal([...workflow.matchAll(/test -z "\$worktree_status"/g)].length, 2);
  assert.equal(
    [...workflow.matchAll(/uses:\s*actions\/checkout@v7\.0\.1[\s\S]*?ref:\s*\$\{\{ env\.FINLY_CODE_VERSION \}\}[\s\S]*?fetch-depth:\s*1\s*\n\s*- name:\s*Attest the audited trading revision/g)].length,
    2,
    "each pinned checkout must be immediately followed by its attestation",
  );
  assert.match(workflow, /cron:\s*"30 12 31 8 \*"/);
  assert.match(workflow, /cron:\s*"32 13 31 8 \*"/);
  assert.match(workflow, /timeout-minutes:\s*140/);
  assert.match(workflow, /FINLY_COMPETITION_START_AT:\s*"2026-08-31T13:30:00\.000Z"/);
  assert.match(workflow, /FINLY_COMPETITION_END_AT:\s*"2026-09-04T13:30:00\.000Z"/);
  assert.match(workflow, /FINLY_OPTIONS_ENTRY_CUTOFF_AT:\s*"2026-09-02T19:00:00\.000Z"/);
  assert.match(workflow, /FINLY_OPTIONS_FORCE_FLAT_AT:\s*"2026-09-03T19:00:00\.000Z"/);
  assert.match(workflow, /FINLY_EXECUTION_TRANSPORT:\s*mcp/);
  assert.match(workflow, /FINLY_G4_PRODUCTION_ENABLED:\s*"true"/);
  assert.match(workflow, /FINLY_G4_CHECKPOINT_PATH:\s*data\/private\/g4-official-equity/);
  assert.match(workflow, /FINLY_G4_LOG_PATH:\s*outputs\/g4_official_equity\.jsonl/);
  assert.match(workflow, /FINLY_AGENT_INTERVAL_SECONDS:\s*"300"/);
  assert.match(workflow, /FINLY_AGENT_MAXIMUM_CYCLES:\s*"24"/);
  assert.match(workflow, /node scripts\/autonomous_paper_agent\.mjs/);
  assert.doesNotMatch(workflow, /for cycle in 1 2 3 4; do/);
  assert.match(workflow, /FINLY_USE_LOCAL_LLAMA_EVENTS:\s*"false"/);
  assert.match(workflow, /FINLY_USE_FEATHERLESS_EVENTS:\s*"true"/);
  assert.match(workflow, /FINLY_FEATHERLESS_MODEL:\s*Qwen\/Qwen3-32B/);
  assert.match(workflow, /FEATHERLESS_API_KEY:\s*\$\{\{ secrets\.FEATHERLESS_API_KEY \}\}/);
  assert.match(workflow, /"FEATHERLESS_API_KEY",/);
  assert.match(workflow, /required\.push\("FINLY_PAPER_MUTATION_ACK"\)/);
  assert.match(workflow, /FINLY_PAPER_MUTATION_ACK !== "I_UNDERSTAND_THIS_MUTATES_ONLY_THE_HACKATHON_PAPER_ACCOUNT"/);
  assert.match(workflow, /Probe the hosted evidence path before the opening bell[\s\S]*continue-on-error:\s*true[\s\S]*featherless_readiness_check\.mjs/);
  assert.match(workflow, /Install the pinned official Alpaca MCP server[\s\S]*if: needs\.gate\.outputs\.mode != 'final'/);
  assert.match(workflow, /Verify both pinned mutation schemas without a broker call/);
  assert.match(workflow, /\.venv-alpaca-mcp\/bin\/python scripts\/introspect_alpaca_mcp\.py/);
  assert.ok(workflow.indexOf("introspect_alpaca_mcp.py") < workflow.indexOf("featherless_readiness_check.mjs"));
  assert.match(workflow, /cloud_state\.mjs restore/);
  assert.match(workflow, /cloud_state\.mjs publish/);
  assert.match(dashboard, /raw\.githubusercontent\.com\/owlsowo\/finly-bot\/finly-cloud-state\/competition_live\.json/);
  assert.doesNotMatch(workflow, /models\.github\.ai|investopedia/i);
  assert.doesNotMatch(workflow, /api[_-]?key\s*[:=]\s*[A-Za-z0-9_-]{12,}/i);
  assert.match(introspection, /"place_option_order": "sha256:652e116dd021d05fceb7f34b0dcf17d6c3a0dfe82dc47f67372dbf872a521a55"/);
  assert.match(introspection, /"place_stock_order": "sha256:3826d0d06bf6c48e77897fa2a833431a42287b34c4bb9a3a303db7b726759288"/);
  assert.match(introspection, /"network_call_made": False/);
  assert.doesNotMatch(introspection, /call_tool|urlopen|requests\./);
});
