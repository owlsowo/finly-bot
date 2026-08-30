import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { sha256 } from "../lib/canonical.mjs";
import { CORE_SYMBOLS } from "../lib/multi_asset_shadow_execution.mjs";
import {
  buildForwardTrialLiveCommitment,
  hashForwardTrialLiveValue,
} from "../research/forward_trial_live_core.mjs";
import { buildLiveAcquisitionFromMarketData } from "../research/run_forward_trial_live.mjs";
import {
  buildG4ShadowLivePublicationReceipt,
  buildG4ShadowLivePrivateRecord,
  buildG4ShadowLivePublicRecord,
  canonicalG4ShadowLiveExecutionJson,
  validateG4ShadowLivePrivateRecord,
  validateG4ShadowLivePublicRecord,
  validateG4ShadowLiveRecordChains,
} from "../research/g4_shadow_live_core.mjs";
import { loadG4ShadowLiveProtocol } from "../research/g4_shadow_live_protocol.mjs";
import {
  G4_SHADOW_LIVE_PRIVATE_RECORD_DIRECTORY,
  G4_SHADOW_LIVE_PUBLIC_RECORD_DIRECTORY,
  appendG4ShadowFromForwardLive,
  loadG4ShadowLivePrivateRecords,
  loadG4ShadowLivePublicationReceipts,
  loadG4ShadowLivePublicRecords,
  publishG4ShadowLivePublicationReceiptWriteOnce,
  publishG4ShadowLiveRecordWriteOnce,
} from "../research/run_g4_shadow_live.mjs";

const ACTIVATION = JSON.parse(await readFile(
  new URL("../research/forward_trial_live/activation.json", import.meta.url),
  "utf8",
));
const PROTOCOL = await loadG4ShadowLiveProtocol();

function weekdaysEnding(endDate, count) {
  const dates = [];
  const cursor = new Date(`${endDate}T12:00:00.000Z`);
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

function sessionClient({
  sessionDate,
  nextSessionDate,
  retrievedBase,
  priceNudge = 0,
  splitSymbol = null,
  splitFactor = 1,
}) {
  const dates = weekdaysEnding(sessionDate, 253);
  const sessions = [
    ...dates.map((date) => ({ date, open: "09:30:00", close: "16:00:00" })),
    { date: nextSessionDate, open: "09:30:00", close: "16:00:00" },
  ];
  const eligibleAt = `${sessionDate}T20:15:00.000Z`;
  const calendarRetrievedAt = new Date(Date.parse(eligibleAt) + 30_000).toISOString();
  const calendarReceipts = [{
    request_started_at: new Date(Date.parse(eligibleAt) + 29_000).toISOString(),
    response_received_at: calendarRetrievedAt,
    origin_http_date: calendarRetrievedAt,
    origin_http_date_source: "HTTPS_RESPONSE_DATE_HEADER",
    maximum_origin_clock_skew_seconds: 300,
    local_clock_verified: false,
    provider_signature_verified: false,
  }];
  const calendarStart = dates[0];
  const calendarEnd = nextSessionDate;
  const calendar = {
    start: calendarStart,
    end: calendarEnd,
    sessions,
    content_hash: hashForwardTrialLiveValue({
      schema: "finly.market-calendar.v1",
      start: calendarStart,
      end: calendarEnd,
      sessions,
    }),
    retrieved_at: calendarRetrievedAt,
    provenance: {
      provider: "Alpaca",
      origin: "https://paper-api.alpaca.markets",
      path: "/v2/calendar",
      method: "GET",
      transport: "HTTPS",
      read_only: true,
      complete: true,
      authentication: "caller-supplied; redacted",
      page_count: 1,
      request: { start: calendarStart, end: calendarEnd, date_type: "TRADING" },
      request_started_at: calendarReceipts[0].request_started_at,
      response_received_at: calendarRetrievedAt,
      transport_receipts: calendarReceipts,
      transport_receipts_sha256: hashForwardTrialLiveValue(calendarReceipts),
    },
  };

  return {
    async getMarketCalendar() {
      return structuredClone(calendar);
    },
    async getDailyBars(symbol, options) {
      const symbolIndex = CORE_SYMBOLS.indexOf(symbol);
      assert.ok(symbolIndex >= 0);
      assert.equal(options.start, dates[0]);
      assert.equal(options.end, sessionDate);
      const bars = dates.map((date, index) => {
        const close = 40 + symbolIndex * 3 + index * (0.035 + symbolIndex * 0.001)
          + priceNudge;
        return {
          timestamp: `${date}T04:00:00.000Z`,
          session_date: date,
          open: close - 0.1,
          high: close + 0.2,
          low: close - 0.2,
          close,
          volume: 1_000 + index,
          trade_count: 20 + index,
          vwap: close - 0.01,
        };
      });
      const book = (adjustment) => {
        const orderIndex = symbolIndex * 2 + (adjustment === "raw" ? 0 : 1);
        const receivedAt = new Date(Date.parse(retrievedBase) + orderIndex * 10).toISOString();
        const requestStartedAt = new Date(Date.parse(receivedAt) - 5).toISOString();
        const request = {
          symbol,
          start: options.start,
          end: options.end,
          timeframe: "1Day",
          feed: "iex",
          adjustment,
          sort: "asc",
          limit: 10_000,
        };
        const receipts = [{
          request_started_at: requestStartedAt,
          response_received_at: receivedAt,
          origin_http_date: receivedAt.replace(/\.\d{3}Z$/u, ".000Z"),
          origin_http_date_source: "HTTPS_RESPONSE_DATE_HEADER",
          maximum_origin_clock_skew_seconds: 300,
          local_clock_verified: false,
          provider_signature_verified: false,
        }];
        const bookBars = bars.map((bar, index) => {
          const factor = symbol === splitSymbol
            ? adjustment === "all" || index === bars.length - 1 ? splitFactor : 1
            : 1;
          return {
            ...bar,
            open: bar.open * factor,
            high: bar.high * factor,
            low: bar.low * factor,
            close: bar.close * factor,
            vwap: bar.vwap * factor,
          };
        });
        return {
          bars: bookBars,
          content_hash: hashForwardTrialLiveValue({
            schema: "finly.forward-daily-bars.v1",
            symbol,
            adjustment,
            start: options.start,
            end: options.end,
            bars: bookBars,
          }),
          retrieved_at: receivedAt,
          provenance: {
            provider: "Alpaca",
            origin: "https://data.alpaca.markets",
            path: `/v2/stocks/${symbol}/bars`,
            method: "GET",
            transport: "HTTPS",
            read_only: true,
            complete: true,
            authentication: "caller-supplied; redacted",
            page_count: 1,
            request,
            request_started_at: requestStartedAt,
            response_received_at: receivedAt,
            transport_receipts: receipts,
            transport_receipts_sha256: hashForwardTrialLiveValue(receipts),
          },
        };
      };
      const raw = book("raw");
      const all = book("all");
      return {
        symbol,
        start: options.start,
        end: options.end,
        retrieved_at: all.retrieved_at,
        raw,
        all,
      };
    },
  };
}

async function acquisition({
  sessionDate,
  nextSessionDate,
  retrievedBase,
  priceNudge,
  splitSymbol = null,
  splitFactor = 1,
  previousCommitment = null,
  priorPreviousCommitment = null,
}) {
  return buildLiveAcquisitionFromMarketData({
    client: sessionClient({
      sessionDate, nextSessionDate, retrievedBase, priceNudge, splitSymbol, splitFactor,
    }),
    credentials: { keyId: "test-paper-key", secretKey: "test-paper-secret" },
    activation: ACTIVATION,
    previousCommitment,
    priorPreviousCommitment,
  });
}

async function threeAcquisitions() {
  const first = await acquisition({
    sessionDate: "2026-08-31",
    nextSessionDate: "2026-09-01",
    retrievedBase: "2026-08-31T20:16:00.000Z",
    priceNudge: 0,
  });
  const commitment1 = buildForwardTrialLiveCommitment({ activation: ACTIVATION, acquisition: first });
  const second = await acquisition({
    sessionDate: "2026-09-01",
    nextSessionDate: "2026-09-02",
    retrievedBase: "2026-09-01T20:16:00.000Z",
    priceNudge: 1,
    previousCommitment: commitment1,
  });
  const commitment2 = buildForwardTrialLiveCommitment({
    activation: ACTIVATION,
    acquisition: second,
    previousCommitment: commitment1,
  });
  const third = await acquisition({
    sessionDate: "2026-09-02",
    nextSessionDate: "2026-09-03",
    retrievedBase: "2026-09-02T20:16:00.000Z",
    priceNudge: 2,
    previousCommitment: commitment2,
    priorPreviousCommitment: commitment1,
  });
  return { first, second, third, commitment1, commitment2 };
}

test("first record publishes the frozen G4 target before its outcome and performs no execution", async () => {
  const { first, commitment1 } = await threeAcquisitions();
  const record = buildG4ShadowLivePrivateRecord({
    protocol: PROTOCOL,
    forwardCommitment: commitment1,
  });
  assert.equal(record.sequence, 1);
  assert.equal(record.signal.chronology.session_number, 0);
  assert.equal(record.signal.signal_session_date, "2026-08-31");
  assert.equal(record.signal.action, "REBALANCE");
  assert.equal(record.execution.status, "TARGET_PUBLISHED_BEFORE_OUTCOME_NO_EXECUTION");
  assert.equal(record.execution.execution_session_date, null);
  assert.equal(record.execution.finly_preview, null);
  assert.equal(record.execution.spy_preview, null);
  assert.deepEqual(record.public_record.modeled_orders, []);
  assert.equal(record.public_record.action, "REBALANCE");
  assert.equal(record.public_record.signal_sha256, record.signal.signal_sha256);
  assert.deepEqual(record.public_record.signal, record.signal);
  assert.equal(record.public_record.next_signal_session_date, "2026-09-01");
  assert.equal(record.public_record.publication_deadline, "2026-09-01T20:00:00.000Z");
  assert.equal(record.public_record.execution_session_date, null);
  assert.equal(record.public_record.executed_prior_signal_sha256, null);
  assert.equal(record.state_after.finly.cash, 300);
  assert.equal(record.state_after.spy.cash, 300);
  assert.equal(record.public_record.shadow_equity, 300);
  assert.equal(record.public_record.spy_shadow_equity, 300);
  assert.ok(record.captured_at < first.session.next_market_close_at);
  assert.equal(record.authority.broker_mutation_authorized, false);
  assert.equal(record.authority.order_submission_permitted, false);
});

test("next record executes only the prior target at the next completed-session raw close", async () => {
  const { first, second, commitment1, commitment2 } = await threeAcquisitions();
  const record1 = buildG4ShadowLivePrivateRecord({ protocol: PROTOCOL, forwardCommitment: commitment1 });
  const record2 = buildG4ShadowLivePrivateRecord({
    protocol: PROTOCOL,
    forwardCommitment: commitment2,
    previousRecord: record1,
  });
  assert.equal(record2.sequence, 2);
  assert.equal(record2.signal.chronology.session_number, 1);
  assert.equal(record2.signal.action, "HOLD");
  assert.equal(record2.execution.status, "PRIOR_TARGET_EXECUTED_AT_NEXT_COMPLETED_RAW_CLOSE");
  assert.equal(record2.execution.execution_session_date, "2026-09-01");
  assert.equal(record2.execution.price_book, "raw");
  assert.equal(record2.execution.executed_prior_signal_sha256, record1.signal.signal_sha256);
  assert.equal(record2.public_record.action, "HOLD");
  assert.equal(record2.public_record.signal_sha256, record2.signal.signal_sha256);
  assert.equal(record2.public_record.execution_session_date, "2026-09-01");
  assert.equal(record2.public_record.executed_prior_signal_sha256, record1.signal.signal_sha256);
  assert.equal(record2.public_record.execution_status, record2.execution.status);
  assert.equal(record2.public_record.signal_session_date, record1.public_record.next_signal_session_date);
  for (const symbol of CORE_SYMBOLS) {
    assert.ok(Math.abs(
      record2.execution.finly_preview.allocation.target_weights[symbol]
      - record1.signal.target_weights[symbol]
    ) < 1e-12);
  }
  assert.equal(
    record2.execution.finly_preview.portfolio.reference_prices.SPY,
    second.raw_close_rows.SPY.at(-1).close,
  );
  assert.match(
    canonicalG4ShadowLiveExecutionJson(record2.execution, {
      privateRecord: record2,
      protocol: PROTOCOL,
      previousRecord: record1,
    }),
    /"broker_mutation_authorized": false/u,
  );
  const fabricatedExecution = structuredClone(record2.execution);
  fabricatedExecution.finly_preview.order_plan.orders[0].qty = "999.000000000";
  assert.throws(
    () => canonicalG4ShadowLiveExecutionJson(fabricatedExecution, {
      privateRecord: record2,
      protocol: PROTOCOL,
      previousRecord: record1,
    }),
    /complete binding private record/u,
  );
  assert.equal(record2.execution.spy_preview.allocation.target_weights.SPY, 1);
  assert.ok(record2.execution.finly_preview.order_plan.orders.length > 0);
  assert.equal(record2.execution.spy_preview.order_plan.orders.length, 1);
  assert.ok(record2.public_record.modeled_orders.some(({ portfolio }) => portfolio === "FINLY"));
  assert.ok(record2.public_record.modeled_orders.some(({ portfolio }) => portfolio === "SPY"));
  assert.equal(record2.public_record.contributions_to_date, 300);
  assert.ok(record2.public_record.shadow_equity < 300);
  assert.ok(record2.public_record.spy_shadow_equity < 300);
  assert.equal(
    JSON.stringify(record2.public_record).includes(String(first.raw_close_rows.SPY.at(-1).close)),
    false,
  );
});

test("a HOLD derives cadence from the official chain, creates zero Finly orders, and carries actual holdings", async () => {
  const { commitment1, commitment2, third } = await threeAcquisitions();
  const record1 = buildG4ShadowLivePrivateRecord({ protocol: PROTOCOL, forwardCommitment: commitment1 });
  const record2 = buildG4ShadowLivePrivateRecord({
    protocol: PROTOCOL,
    forwardCommitment: commitment2,
    previousRecord: record1,
  });
  const record3 = buildG4ShadowLivePrivateRecord({
    protocol: PROTOCOL,
    acquisition: third,
    previousRecord: record2,
  });
  assert.equal(record3.signal.chronology.session_number, 2);
  assert.equal(record2.signal.action, "HOLD");
  assert.equal(record3.execution.status, "HOLD_MARKED_TO_CURRENT_RAW_CLOSE");
  assert.equal(record3.execution.finly_preview, null);
  assert.equal(record3.execution.executed_prior_signal_sha256, null);
  assert.equal(record3.state_after.accounting_method, "SAME_VINTAGE_ADJUSTED_TOTAL_RETURN_EQUIVALENT_UNITS");
  assert.deepEqual(
    CORE_SYMBOLS.filter((symbol) => Number(record3.state_after.finly.holdings[symbol]) > 0),
    CORE_SYMBOLS.filter((symbol) => Number(record2.state_after.finly.holdings[symbol]) > 0),
  );
  assert.deepEqual(
    CORE_SYMBOLS.filter((symbol) => Number(record3.state_after.spy.holdings[symbol]) > 0),
    ["SPY"],
  );
  assert.deepEqual(record3.public_record.modeled_orders, []);
  assert.notEqual(record3.state_after.finly.equity, record2.state_after.finly.equity);

  assert.throws(
    () => buildG4ShadowLivePrivateRecord({
      protocol: PROTOCOL,
      acquisition: third,
      previousRecord: record1,
    }),
    /skips, duplicates, or backfills/u,
  );
});

test("same-vintage adjusted total-return accounting survives a raw-price split without a phantom loss", async () => {
  const { commitment1, commitment2 } = await threeAcquisitions();
  const record1 = buildG4ShadowLivePrivateRecord({ protocol: PROTOCOL, forwardCommitment: commitment1 });
  const record2 = buildG4ShadowLivePrivateRecord({
    protocol: PROTOCOL,
    forwardCommitment: commitment2,
    previousRecord: record1,
  });
  const splitAcquisition = await acquisition({
    sessionDate: "2026-09-02",
    nextSessionDate: "2026-09-03",
    retrievedBase: "2026-09-02T20:16:00.000Z",
    priceNudge: 2,
    splitSymbol: "QQQ",
    splitFactor: 0.5,
    previousCommitment: commitment2,
    priorPreviousCommitment: commitment1,
  });
  const record3 = buildG4ShadowLivePrivateRecord({
    protocol: PROTOCOL,
    acquisition: splitAcquisition,
    previousRecord: record2,
  });
  const priorValue = Number(record2.state_after.finly.holdings.QQQ)
    * record2.acquisition.raw_close_rows.QQQ.at(-1).close;
  const [adjustedStart, adjustedEnd] = splitAcquisition.adjusted_close_rows.QQQ.slice(-2);
  const expectedValue = priorValue * (adjustedEnd.close / adjustedStart.close);
  const observedValue = Number(record3.state_after.finly.holdings.QQQ)
    * splitAcquisition.raw_close_rows.QQQ.at(-1).close;
  assert.ok(Math.abs(observedValue - expectedValue) < 0.0001);
  assert.ok(Number(record3.state_after.finly.holdings.QQQ)
    > Number(record2.state_after.finly.holdings.QQQ) * 1.9);
  assert.equal(record3.execution.finly_preview, null);
});

test("private/public validation rejects tampering, raw-price disclosure, and broken chains", async () => {
  const { commitment1, commitment2 } = await threeAcquisitions();
  const record1 = buildG4ShadowLivePrivateRecord({ protocol: PROTOCOL, forwardCommitment: commitment1 });
  const record2 = buildG4ShadowLivePrivateRecord({
    protocol: PROTOCOL,
    forwardCommitment: commitment2,
    previousRecord: record1,
  });
  const public1 = buildG4ShadowLivePublicRecord(record1, { protocol: PROTOCOL });
  const public2 = buildG4ShadowLivePublicRecord(record2, {
    protocol: PROTOCOL,
    previousRecord: record1,
  });
  assert.equal(
    validateG4ShadowLiveRecordChains({
      protocol: PROTOCOL,
      privateRecords: [record1, record2],
      publicRecords: [public1, public2],
    }).publicRecords.length,
    2,
  );
  assert.equal(
    validateG4ShadowLiveRecordChains({
      protocol: PROTOCOL,
      privateRecords: [],
      publicRecords: [public1, public2],
    }).publicRecords.length,
    2,
  );
  for (const forbidden of [
    "acquisition", "adjusted_close_rows", "raw_close_rows", "bar_timestamp",
    "reference_price", "commitment_sha256", "credentials",
  ]) {
    assert.equal(JSON.stringify(public2).includes(forbidden), false);
  }

  const wrongAllocation = structuredClone(public1);
  wrongAllocation.signal.target_weights = Object.fromEntries(
    CORE_SYMBOLS.map((symbol) => [symbol, symbol === "QQQ" ? 0.7
      : ["XLK", "XLF", "XLE"].includes(symbol) ? 0.1 : 0]),
  );
  wrongAllocation.signal.selected_sectors = ["XLE", "XLF", "XLK"];
  const signalBody = { ...wrongAllocation.signal };
  delete signalBody.signal_sha256;
  wrongAllocation.signal.signal_sha256 = sha256(signalBody);
  wrongAllocation.signal_sha256 = wrongAllocation.signal.signal_sha256;
  wrongAllocation.target_weights = structuredClone(wrongAllocation.signal.target_weights);
  wrongAllocation.selected_sectors = structuredClone(wrongAllocation.signal.selected_sectors);
  const publicBody = { ...wrongAllocation };
  delete publicBody.record_sha256;
  wrongAllocation.record_sha256 = sha256(publicBody);
  assert.throws(
    () => validateG4ShadowLivePublicRecord(wrongAllocation, { protocol: PROTOCOL }),
    /frozen 50% QQQ|exact frozen QQQ\/sector policy/u,
  );

  const changed = structuredClone(record2);
  changed.state_after.finly.cash += 1;
  assert.throws(
    () => validateG4ShadowLivePrivateRecord(changed, { protocol: PROTOCOL, previousRecord: record1 }),
    /hash is invalid/u,
  );
  assert.throws(
    () => validateG4ShadowLiveRecordChains({
      protocol: PROTOCOL,
      privateRecords: [record1, record2],
      publicRecords: [public2],
    }),
    /hash chain is broken|differs from its private/u,
  );
});

test("runner writes private and sanitized public records once and rejects a late backfill", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "finly-g4-shadow-"));
  try {
    const protocolPath = resolve(root, "research/g4_shadow_live/protocol.json");
    await mkdir(resolve(protocolPath, ".."), { recursive: true });
    await copyFile(new URL("../research/g4_shadow_live/protocol.json", import.meta.url), protocolPath);
    const { first } = await threeAcquisitions();
    const result = await appendG4ShadowFromForwardLive({
      projectRoot: root,
      suppliedAcquisition: first,
      now: "2026-08-31T20:20:00.000Z",
    });
    assert.equal(result.status, "G4_SHADOW_RECORD_WRITTEN_ONCE");
    assert.equal(result.execution_status, "TARGET_PUBLISHED_BEFORE_OUTCOME_NO_EXECUTION");
    const privateRecords = await loadG4ShadowLivePrivateRecords({ projectRoot: root });
    const publicRecords = await loadG4ShadowLivePublicRecords({ projectRoot: root });
    assert.equal(privateRecords.length, 1);
    assert.equal(publicRecords.length, 1);
    assert.equal((await stat(resolve(root, result.persistence.private_path))).mode & 0o777, 0o600);
    assert.equal((await stat(resolve(root, result.persistence.public_path))).mode & 0o777, 0o644);
    assert.ok(result.persistence.private_path.startsWith(G4_SHADOW_LIVE_PRIVATE_RECORD_DIRECTORY));
    assert.ok(result.persistence.public_path.startsWith(G4_SHADOW_LIVE_PUBLIC_RECORD_DIRECTORY));
    const publicBytes = await readFile(resolve(root, result.persistence.public_path), "utf8");
    assert.equal(publicBytes.includes("raw_close_rows"), false);
    assert.equal(publicBytes.includes("adjusted_close_rows"), false);

    const headSha = "1".repeat(40);
    const receipt = buildG4ShadowLivePublicationReceipt({
      protocol: PROTOCOL,
      publicRecord: publicRecords[0],
      repository: {
        id: 1_350_112_497,
        full_name: "owlsowo/finly-bot",
        public: true,
        default_branch: "main",
      },
      publicationCommit: {
        sha: headSha,
        parent_sha: "2".repeat(40),
        html_url: `https://github.com/owlsowo/finly-bot/commit/${headSha}`,
      },
      workflowRun: {
        id: 123,
        head_sha: headSha,
        event: "push",
        head_branch: "main",
        status: "completed",
        conclusion: "success",
        created_at: "2026-08-31T20:21:00Z",
        updated_at: "2026-08-31T20:22:00Z",
        html_url: "https://github.com/owlsowo/finly-bot/actions/runs/123",
      },
      verificationObservedAt: "2026-08-31T20:23:00Z",
    });
    const receiptWrite = await publishG4ShadowLivePublicationReceiptWriteOnce(receipt, {
      projectRoot: root,
    });
    assert.equal(receiptWrite.status, "created");
    assert.equal((await loadG4ShadowLivePublicationReceipts({ projectRoot: root })).length, 1);
    assert.throws(
      () => buildG4ShadowLivePublicationReceipt({
        protocol: PROTOCOL,
        publicRecord: publicRecords[0],
        repository: receipt.repository,
        publicationCommit: receipt.publication_commit,
        workflowRun: {
          ...receipt.workflow_run,
          created_at: "2026-09-01T20:00:00Z",
          updated_at: "2026-09-01T20:01:00Z",
        },
        verificationObservedAt: "2026-09-01T20:02:00Z",
      }),
      /not successfully observed before execution close/u,
    );

    const replay = await publishG4ShadowLiveRecordWriteOnce({
      projectRoot: root,
      protocol: PROTOCOL,
      record: privateRecords[0],
      previousRecord: null,
    });
    assert.equal(replay.private_status, "verified");
    assert.equal(replay.public_status, "verified");

    const lateRoot = await mkdtemp(resolve(tmpdir(), "finly-g4-shadow-late-"));
    try {
      const lateProtocolPath = resolve(lateRoot, "research/g4_shadow_live/protocol.json");
      await mkdir(resolve(lateProtocolPath, ".."), { recursive: true });
      await copyFile(new URL("../research/g4_shadow_live/protocol.json", import.meta.url), lateProtocolPath);
      await assert.rejects(
        () => appendG4ShadowFromForwardLive({
          projectRoot: lateRoot,
          suppliedAcquisition: first,
          now: "2026-09-01T20:00:00.000Z",
        }),
        /missed the next-close deadline/u,
      );
    } finally {
      await rm(lateRoot, { recursive: true });
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

test("production append refuses caller-supplied clocks before reading any local state", async () => {
  await assert.rejects(
    () => appendG4ShadowFromForwardLive({ now: "2026-08-31T20:20:00.000Z" }),
    /production G4 shadow append clock cannot be caller supplied/u,
  );
});

test("runner source has no network, credential, broker, or order-submission path", async () => {
  const source = await readFile(new URL("../research/run_g4_shadow_live.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /APCA_API|ALPACA_SECRET|secretKey|credentialsFromEnvironment/u);
  assert.doesNotMatch(source, /submitOrder|placeOrder|cancelOrder|replaceOrder|client_order_id/u);
  assert.match(source, /broker_mutation_authorized:\s*false/u);
  assert.match(source, /order_submission_permitted:\s*false/u);
});
