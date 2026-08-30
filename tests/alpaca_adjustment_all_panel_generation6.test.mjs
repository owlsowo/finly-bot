import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import { round, sha256 } from "../research/champion_engine.mjs";
import { CORE_SYMBOLS } from "../research/champion_strategies.mjs";
import {
  AlpacaGeneration6PanelClient,
  buildGeneration6AlpacaAdjustmentAllPanel,
  createGeneration6AlpacaPanelAcquisition,
  GENERATION6_ALPACA_PANEL_FREEZE_RECEIPT_PATH,
  GENERATION6_ALPACA_PANEL_OUTPUT_CONTRACT,
  GENERATION6_ALPACA_PANEL_PROTOCOL_PATH,
  GENERATION6_ALPACA_PANEL_REQUEST,
  GENERATION6_ALPACA_PANEL_REQUIRED_FREEZE_FILES,
  GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH,
  GENERATION6_ALPACA_PANEL_SECURITY,
  GENERATION6_ALPACA_PANEL_UNIVERSE_BOUNDARY,
  validateGeneration6AlpacaPanelProtocol,
  validateStoredGeneration6AlpacaPanel,
} from "../research/persist_alpaca_adjustment_all_panel_generation6.mjs";

const FROZEN_AT = "2026-08-29T12:00:00.000Z";
const CLAIMED_AT = "2026-08-29T12:01:00.000Z";
const COMPLETED_AT = "2026-08-29T12:02:00.000Z";
const KEY_ID = "generation-six-key";
const SECRET_KEY = "generation-six-secret-value";

function sha256Bytes(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function weekdayDatesBackward(count, end = GENERATION6_ALPACA_PANEL_REQUEST.end) {
  const dates = [];
  let timestamp = Date.parse(`${end}T00:00:00.000Z`);
  while (dates.length < count) {
    const value = new Date(timestamp);
    if (value.getUTCDay() !== 0 && value.getUTCDay() !== 6) {
      dates.push(value.toISOString().slice(0, 10));
    }
    timestamp -= 86_400_000;
  }
  return dates.reverse();
}

function syntheticSeries({ count = 1_251, missing = {} } = {}) {
  const dates = weekdayDatesBackward(count);
  return Object.fromEntries(CORE_SYMBOLS.map((symbol, symbolIndex) => {
    const omitted = new Set(missing[symbol] ?? []);
    return [symbol, dates.filter((date) => !omitted.has(date)).map((date, index) => ({
      date,
      close: 50 + symbolIndex + index * 0.01,
    }))];
  }));
}

function provenance(overrides = {}) {
  return {
    provider: "Alpaca Market Data API",
    origin: "https://data.alpaca.markets",
    path: "/v2/stocks/bars",
    request: structuredClone(GENERATION6_ALPACA_PANEL_REQUEST),
    page_count: 3,
    response_content_sha256: "a".repeat(64),
    adjustment_semantics: "forward/reverse splits, cash dividends, and spin-offs",
    security: { ...GENERATION6_ALPACA_PANEL_SECURITY },
    ...overrides,
  };
}

function protocol() {
  return {
    schema_version: "finly_generation6_alpaca_adjustment_all_panel_protocol.v2",
    status: "FROZEN_BEFORE_AUTHENTICATED_PANEL_READ",
    frozen_at: FROZEN_AT,
    execution_status_at_freeze: {
      authenticated_read_started: false,
      run_claim_absent: true,
      result_receipt_absent: true,
      panel_artifacts_absent: true,
    },
    request: structuredClone(GENERATION6_ALPACA_PANEL_REQUEST),
    security: { ...GENERATION6_ALPACA_PANEL_SECURITY },
    universe_boundary: { ...GENERATION6_ALPACA_PANEL_UNIVERSE_BOUNDARY },
    output_contract: { ...GENERATION6_ALPACA_PANEL_OUTPUT_CONTRACT },
  };
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

function barsFromSeries(seriesBySymbol, symbols = CORE_SYMBOLS) {
  return Object.fromEntries(symbols.map((symbol) => [
    symbol,
    seriesBySymbol[symbol].map((point) => ({
      t: `${point.date}T04:00:00.000Z`,
      c: point.close,
    })),
  ]));
}

async function writeArtifact(root, relativePath, payload) {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, payload, { mode: 0o600 });
  return path;
}

async function prepareFrozenRoot(root) {
  const protocolRaw = Buffer.from(`${JSON.stringify(protocol(), null, 2)}\n`);
  const payloads = {};
  for (const relativePath of GENERATION6_ALPACA_PANEL_REQUIRED_FREEZE_FILES) {
    payloads[relativePath] = relativePath === GENERATION6_ALPACA_PANEL_PROTOCOL_PATH
      ? protocolRaw
      : Buffer.from(`synthetic frozen bytes for ${relativePath}\n`);
    await writeArtifact(root, relativePath, payloads[relativePath]);
  }
  const freezeReceipt = {
    schema_version: "finly_generation6_alpaca_adjustment_all_panel_freeze_receipt.v2",
    frozen_at: FROZEN_AT,
    frozen_before_authenticated_read: true,
    authenticated_read_started_at_freeze: false,
    run_claim_absent_at_freeze: true,
    result_receipt_absent_at_freeze: true,
    panel_artifacts_absent_at_freeze: true,
    files: Object.fromEntries(GENERATION6_ALPACA_PANEL_REQUIRED_FREEZE_FILES.map((relativePath) => [
      relativePath,
      sha256Bytes(payloads[relativePath]),
    ])),
  };
  await writeArtifact(
    root,
    GENERATION6_ALPACA_PANEL_FREEZE_RECEIPT_PATH,
    Buffer.from(`${JSON.stringify(freezeReceipt, null, 2)}\n`),
  );
}

test("v2 preserves original symbol series, exact hashes, missingness, and a separate intersection", () => {
  const allDates = weekdayDatesBackward(1_251);
  const missingDate = allDates[400];
  const series = syntheticSeries({ missing: { XLK: [missingDate] } });
  const panel = buildGeneration6AlpacaAdjustmentAllPanel(series, provenance(), {
    generatedAt: COMPLETED_AT,
  });
  assert.equal(panel.schema_version, "finly_generation6_alpaca_adjustment_all_panel.v2");
  assert.deepEqual(panel.symbols, CORE_SYMBOLS);
  assert.deepEqual(Object.keys(panel.series_by_symbol), CORE_SYMBOLS);
  assert.deepEqual(panel.series_by_symbol.XLK, series.XLK);
  assert.equal(panel.series_by_symbol.SPY.length, 1_251);
  assert.equal(panel.series_by_symbol.XLK.length, 1_250);
  assert.deepEqual(panel.series_integrity_by_symbol.SPY, {
    observations: series.SPY.length,
    start_date: series.SPY[0].date,
    end_date: series.SPY.at(-1).date,
    date_sha256: sha256(series.SPY.map((point) => point.date)),
    series_sha256: sha256(series.SPY.map((point) => [point.date, round(point.close, 10)])),
  });
  assert.deepEqual(panel.series_integrity_by_symbol.XLK, {
    observations: series.XLK.length,
    start_date: series.XLK[0].date,
    end_date: series.XLK.at(-1).date,
    date_sha256: sha256(series.XLK.map((point) => point.date)),
    series_sha256: sha256(series.XLK.map((point) => [point.date, round(point.close, 10)])),
  });
  assert.equal(panel.missing_date_diagnostics.by_symbol.XLK.missing_from_union_count, 1);
  assert.deepEqual(
    panel.missing_date_diagnostics.by_symbol.XLK.missing_from_union_dates,
    [missingDate],
  );
  assert.equal(panel.missing_date_diagnostics.by_symbol.SPY.missing_from_union_count, 0);
  assert.equal(panel.missing_date_diagnostics.dates_excluded_from_strategy_intersection_count, 1);
  assert.equal(panel.strategy_intersection.observations, 1_250);
  assert.equal(panel.strategy_intersection.points.some((point) => point.date === missingDate), false);
  assert.equal(
    panel.strategy_intersection.normalized_panel_sha256,
    sha256(panel.strategy_intersection.points.map((point) => [
      point.date,
      ...CORE_SYMBOLS.map((symbol) => round(point[symbol], 10)),
    ])),
  );
  assert.equal(panel.universe_boundary.survivorship_bias_present, true);
  assert.match(panel.claim_boundary, /current-survivor ETF menu/);
  assert.deepEqual(validateStoredGeneration6AlpacaPanel(panel), panel);
});

test("builder rejects bounds, stale intersection, provenance, response-hash, and page drift", () => {
  const series = syntheticSeries({ count: 1_250 });
  const outside = structuredClone(series);
  outside.SPY.at(-1).date = "2026-08-28";
  assert.throws(
    () => buildGeneration6AlpacaAdjustmentAllPanel(outside, provenance(), {
      generatedAt: COMPLETED_AT,
    }),
    /outside the frozen request/,
  );
  assert.throws(
    () => buildGeneration6AlpacaAdjustmentAllPanel(series, provenance({ page_count: 0 }), {
      generatedAt: COMPLETED_AT,
    }),
    /page_count is invalid/,
  );
  assert.throws(
    () => buildGeneration6AlpacaAdjustmentAllPanel(
      series,
      provenance({ response_content_sha256: "not-a-hash" }),
      { generatedAt: COMPLETED_AT },
    ),
    /response_content_sha256 is invalid/,
  );
  const wrongRequest = structuredClone(GENERATION6_ALPACA_PANEL_REQUEST);
  wrongRequest.asof = "2026-08-26";
  assert.throws(
    () => buildGeneration6AlpacaAdjustmentAllPanel(
      series,
      provenance({ request: wrongRequest }),
      { generatedAt: COMPLETED_AT },
    ),
    /differs from the frozen/,
  );
  const stale = syntheticSeries({ count: 1_251 });
  stale.XLK.pop();
  assert.throws(
    () => buildGeneration6AlpacaAdjustmentAllPanel(stale, provenance(), {
      generatedAt: COMPLETED_AT,
    }),
    /does not reach the frozen request end date/,
  );
  const reversed = Object.fromEntries(Object.entries(series).reverse());
  assert.throws(
    () => buildGeneration6AlpacaAdjustmentAllPanel(reversed, provenance(), {
      generatedAt: COMPLETED_AT,
    }),
    /keys must exactly follow CORE_SYMBOLS/,
  );
});

test("strict protocol pins asof/currency and rejects all expanded or credential-like fields", () => {
  assert.deepEqual(validateGeneration6AlpacaPanelProtocol(protocol()), {
    passes: true,
    reasons: [],
  });
  const injected = protocol();
  injected.request.api_key = "DUMMY_NOT_A_REAL_KEY";
  const injectedResult = validateGeneration6AlpacaPanelProtocol(injected);
  assert.equal(injectedResult.passes, false);
  assert.ok(injectedResult.reasons.some((reason) => reason.includes("credential-like")));
  assert.ok(injectedResult.reasons.includes("protocol request differs"));
  const expanded = protocol();
  expanded.extra = true;
  assert.ok(validateGeneration6AlpacaPanelProtocol(expanded).reasons
    .includes("protocol fields are incomplete or expanded"));
  const changed = protocol();
  changed.request.currency = "EUR";
  assert.ok(validateGeneration6AlpacaPanelProtocol(changed).reasons
    .includes("protocol request differs"));
  assert.equal(GENERATION6_ALPACA_PANEL_REQUEST.asof, "2026-08-27");
  assert.equal(GENERATION6_ALPACA_PANEL_REQUEST.currency, "USD");
  assert.equal(GENERATION6_ALPACA_PANEL_REQUIRED_FREEZE_FILES.length, 5);
  assert.equal(
    GENERATION6_ALPACA_PANEL_REQUIRED_FREEZE_FILES.some((path) => (
      path.includes("run_quant_champion_generation6")
    )),
    false,
  );
});

test("dedicated client sends exact GET parameters, paginates, and returns no credentials or tokens", async () => {
  const calls = [];
  const oneDateSeries = syntheticSeries({ count: 1 });
  const firstSymbols = CORE_SYMBOLS.slice(0, 10);
  const secondSymbols = CORE_SYMBOLS.slice(10);
  const client = new AlpacaGeneration6PanelClient({
    keyId: KEY_ID,
    secretKey: SECRET_KEY,
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      calls.push({ url: parsed, options });
      return parsed.searchParams.has("page_token")
        ? response({ bars: barsFromSeries(oneDateSeries, secondSymbols), next_page_token: null })
        : response({ bars: barsFromSeries(oneDateSeries, firstSymbols), next_page_token: "opaque-page" });
    },
  });
  const result = await client.getDailyBars();
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url.origin, "https://data.alpaca.markets");
    assert.equal(call.url.pathname, "/v2/stocks/bars");
    assert.equal(call.url.searchParams.get("asof"), "2026-08-27");
    assert.equal(call.url.searchParams.get("currency"), "USD");
    assert.equal(call.url.searchParams.get("adjustment"), "all");
    assert.equal(call.url.searchParams.get("feed"), "iex");
    assert.equal(call.url.searchParams.get("sort"), "asc");
    assert.equal(call.url.searchParams.get("limit"), "10000");
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.headers["APCA-API-SECRET-KEY"], SECRET_KEY);
  }
  assert.equal(result.provenance.page_count, 2);
  assert.match(result.provenance.response_content_sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes(SECRET_KEY), false);
  assert.equal(JSON.stringify(result).includes(KEY_ID), false);
  assert.equal(JSON.stringify(result).includes("opaque-page"), false);
  const expandedRequest = structuredClone(GENERATION6_ALPACA_PANEL_REQUEST);
  expandedRequest.authorization = "DUMMY";
  await assert.rejects(() => client.getDailyBars(expandedRequest), /unsupported fields/);

  const bodyFailureClient = new AlpacaGeneration6PanelClient({
    keyId: KEY_ID,
    secretKey: SECRET_KEY,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() { throw new Error(`must sanitize ${SECRET_KEY}`); },
    }),
  });
  await assert.rejects(
    () => bodyFailureClient.getDailyBars(),
    (error) => error.message === "Alpaca Generation 6 panel response-body read failed"
      && !error.message.includes(SECRET_KEY),
  );
});

test("temp-dir lifecycle writes a durable pre-GET claim, verifies all hashes, and forbids refetch", async () => {
  const root = await mkdtemp(join(tmpdir(), "finly-alpaca-v2-success-"));
  try {
    await prepareFrozenRoot(root);
    const series = syntheticSeries({ count: 1_250 });
    let fetchCalls = 0;
    const timestamps = [CLAIMED_AT, COMPLETED_AT];
    const acquisition = createGeneration6AlpacaPanelAcquisition({
      rootDirectory: root,
      environment: {
        APCA_API_KEY_ID: KEY_ID,
        APCA_API_SECRET_KEY: SECRET_KEY,
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return response({ bars: barsFromSeries(series), next_page_token: null });
      },
      now: () => timestamps.shift(),
    });
    const created = await acquisition.firstRun();
    assert.equal(fetchCalls, 1);
    assert.equal(created.panel.schema_version, "finly_generation6_alpaca_adjustment_all_panel.v2");
    assert.equal(created.result.run_claim_sha256.length, 64);
    assert.equal(created.result.response_content_sha256, created.panel.response_content_sha256);
    const artifactPaths = [
      acquisition.paths.runClaim,
      acquisition.paths.resultReceipt,
      join(root, created.result.panel.path),
    ];
    for (const path of artifactPaths) {
      const raw = await readFile(path, "utf8");
      assert.equal(raw.includes(SECRET_KEY), false);
      assert.equal(raw.includes(KEY_ID), false);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
    const verified = await acquisition.verifyExisting();
    assert.equal(verified.panel.strategy_intersection.normalized_panel_sha256,
      created.panel.strategy_intersection.normalized_panel_sha256);
    await assert.rejects(
      () => acquisition.firstRun(),
      /run claim already exists; refetch is forbidden/,
    );
    assert.equal(fetchCalls, 1);

    const receipt = JSON.parse(await readFile(acquisition.paths.resultReceipt, "utf8"));
    receipt.panel.path = `../${basename(receipt.panel.path)}`;
    await writeFile(acquisition.paths.resultReceipt, `${JSON.stringify(receipt, null, 2)}\n`);
    await assert.rejects(
      () => acquisition.verifyExisting(),
      /not the exact content-addressed private path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed authenticated transport leaves a 0600 claim and permanently blocks automatic retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "finly-alpaca-v2-crash-"));
  try {
    await prepareFrozenRoot(root);
    let fetchCalls = 0;
    const acquisition = createGeneration6AlpacaPanelAcquisition({
      rootDirectory: root,
      environment: {
        APCA_API_KEY_ID: KEY_ID,
        APCA_API_SECRET_KEY: SECRET_KEY,
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error(`transport detail must not leak ${SECRET_KEY}`);
      },
      now: () => CLAIMED_AT,
    });
    await assert.rejects(() => acquisition.firstRun(), /panel transport failed/);
    assert.equal(fetchCalls, 1);
    const claimRaw = await readFile(acquisition.paths.runClaim, "utf8");
    assert.equal(claimRaw.includes(SECRET_KEY), false);
    assert.equal(claimRaw.includes(KEY_ID), false);
    assert.equal((await stat(acquisition.paths.runClaim)).mode & 0o777, 0o600);
    await assert.rejects(
      () => acquisition.firstRun(),
      /run claim already exists; refetch is forbidden/,
    );
    assert.equal(fetchCalls, 1);
    await assert.rejects(() => stat(acquisition.paths.resultReceipt), /ENOENT/);
    assert.equal(basename(acquisition.paths.runClaim), basename(GENERATION6_ALPACA_PANEL_RUN_CLAIM_PATH));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
