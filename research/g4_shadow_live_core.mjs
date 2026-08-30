import { sha256 } from "../lib/canonical.mjs";
import {
  CORE_SYMBOLS,
  buildMultiAssetShadowExecution,
  canonicalMultiAssetShadowExecutionJson,
} from "../lib/multi_asset_shadow_execution.mjs";
import { validateForwardTrialLiveAcquisition } from "./forward_trial_live_core.mjs";
import {
  G4_SHADOW_LIVE_FIRST_SIGNAL_SESSION,
  G4_SHADOW_LIVE_ID,
  G4_SHADOW_LIVE_PROTOCOL_SHA256,
  validateG4ShadowLiveProtocol,
} from "./g4_shadow_live_protocol.mjs";
import {
  G4_SHADOW_STRATEGY_ID,
  buildG4ShadowSignal,
  validateG4ShadowSignal,
} from "./g4_shadow_signal.mjs";

export const G4_SHADOW_LIVE_PRIVATE_RECORD_SCHEMA = "finly_g4_shadow_live_private_record.v1";
export const G4_SHADOW_LIVE_PUBLIC_RECORD_SCHEMA = "finly_g4_shadow_live_public_record.v1";
export const G4_SHADOW_LIVE_PUBLICATION_RECEIPT_SCHEMA =
  "finly_g4_shadow_live_github_publication_receipt.v1";
export const G4_SHADOW_LIVE_GENESIS_SHA256 = G4_SHADOW_LIVE_PROTOCOL_SHA256;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH = /^\d{4}-\d{2}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const PUBLIC_FORBIDDEN = [
  "acquisition", "adjusted_close_rows", "raw_close_rows", "bar_timestamp",
  "reference_price", "commitment_sha256", "response_content_sha256",
  "request_parameters_sha256", "transport_receipts", "credentials",
];

function fail(message) {
  throw new TypeError(message);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function same(left, right) {
  return sha256(left) === sha256(right);
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function canonicalDate(value, label) {
  if (typeof value !== "string" || !DATE.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    fail(`${label} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function finiteNonnegative(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be finite and non-negative`);
  }
  return value;
}

function round(value, decimals = 9) {
  if (!Number.isFinite(value)) fail("calculation produced a non-finite value");
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function symbolMap(buildValue) {
  return Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, buildValue(symbol)]));
}

function exactSymbols(value, label) {
  exactKeys(value, CORE_SYMBOLS, label);
  return value;
}

function zeroHoldings() {
  return symbolMap(() => "0.000000000");
}

function eligibleAssets() {
  return symbolMap(() => ({ tradable: true, fractionable: true }));
}

function spyWeights() {
  return symbolMap((symbol) => symbol === "SPY" ? 1 : 0);
}

function currentRawPrices(acquisition) {
  return symbolMap((symbol) => {
    const row = acquisition.raw_close_rows[symbol].at(-1);
    if (row.session_date !== acquisition.session.session_date) {
      fail(`raw ${symbol} close does not end on the execution session`);
    }
    return row.close;
  });
}

function valuedAccount(account, prices) {
  const positionValue = CORE_SYMBOLS.reduce(
    (total, symbol) => total + Number(account.holdings[symbol]) * prices[symbol],
    0,
  );
  return {
    holdings: structuredClone(account.holdings),
    cash: round(account.cash),
    equity: round(account.cash + positionValue),
  };
}

function totalReturnCarriedAccount(account, previousAcquisition, acquisition) {
  const priorSession = previousAcquisition.session.session_date;
  const currentSession = acquisition.session.session_date;
  const currentPrices = currentRawPrices(acquisition);
  const holdings = symbolMap((symbol) => {
    const [adjustedStart, adjustedEnd] = acquisition.adjusted_close_rows[symbol].slice(-2);
    const priorRaw = previousAcquisition.raw_close_rows[symbol].at(-1);
    if (adjustedStart.session_date !== priorSession
      || adjustedEnd.session_date !== currentSession
      || priorRaw.session_date !== priorSession) {
      fail(`same-vintage adjusted total-return interval is misaligned for ${symbol}`);
    }
    const priorValue = Number(account.holdings[symbol]) * priorRaw.close;
    const currentTotalReturnValue = priorValue * (adjustedEnd.close / adjustedStart.close);
    return (currentTotalReturnValue / currentPrices[symbol]).toFixed(9);
  });
  return valuedAccount({ holdings, cash: account.cash }, currentPrices);
}

function previewCost(preview) {
  const fields = [
    "modeled_sell_slippage", "modeled_sell_transaction_cost",
    "modeled_regulatory_sell_fee", "modeled_buy_slippage",
    "modeled_buy_transaction_cost",
  ];
  return round(fields.reduce((sum, field) => sum + preview.funding[field], 0));
}

function accountFromPreview(preview) {
  if (!preview.funding.self_financing
    || preview.broker_mutation_authorized !== false
    || preview.preview_only !== true
    || preview.status.startsWith("blocked_")) {
    fail("shadow execution preview did not remain non-authorizing and self-financing");
  }
  return {
    holdings: structuredClone(preview.portfolio.holdings_after_preview),
    cash: preview.portfolio.cash_after_preview,
    equity: preview.portfolio.equity_after_preview,
  };
}

function nextMonth(month) {
  if (typeof month !== "string" || !MONTH.test(month)) fail("next contribution month is invalid");
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return next.toISOString().slice(0, 7);
}

export function buildInitialG4ShadowLiveState(protocol) {
  validateG4ShadowLiveProtocol(protocol);
  const cash = protocol.shadow_account.initial_cash_usd;
  return deepFreeze({
    session_date: null,
    accounting_method: protocol.shadow_account.valuation_method,
    finly: { holdings: zeroHoldings(), cash, equity: cash },
    spy: { holdings: zeroHoldings(), cash, equity: cash },
    contributions_to_date: cash,
    modeled_costs_to_date: { finly: 0, spy: 0 },
    next_contribution_month: protocol.shadow_account.first_additional_contribution_month,
  });
}

function validateAccount(value, label) {
  exactKeys(value, ["holdings", "cash", "equity"], label);
  exactSymbols(value.holdings, `${label}.holdings`);
  for (const symbol of CORE_SYMBOLS) {
    if (typeof value.holdings[symbol] !== "string"
      || !/^(?:0|[1-9]\d*)\.\d{9}$/u.test(value.holdings[symbol])
      || Number(value.holdings[symbol]) < 0) {
      fail(`${label}.holdings.${symbol} must be a non-negative nine-decimal quantity`);
    }
  }
  finiteNonnegative(value.cash, `${label}.cash`);
  finiteNonnegative(value.equity, `${label}.equity`);
}

function validateState(value, label) {
  exactKeys(value, [
    "session_date", "accounting_method", "finly", "spy", "contributions_to_date",
    "modeled_costs_to_date", "next_contribution_month",
  ], label);
  if (value.session_date !== null) canonicalDate(value.session_date, `${label}.session_date`);
  if (value.accounting_method !== "SAME_VINTAGE_ADJUSTED_TOTAL_RETURN_EQUIVALENT_UNITS") {
    fail(`${label}.accounting_method is invalid`);
  }
  validateAccount(value.finly, `${label}.finly`);
  validateAccount(value.spy, `${label}.spy`);
  finiteNonnegative(value.contributions_to_date, `${label}.contributions_to_date`);
  exactKeys(value.modeled_costs_to_date, ["finly", "spy"], `${label}.modeled_costs_to_date`);
  finiteNonnegative(value.modeled_costs_to_date.finly, `${label}.modeled_costs_to_date.finly`);
  finiteNonnegative(value.modeled_costs_to_date.spy, `${label}.modeled_costs_to_date.spy`);
  if (typeof value.next_contribution_month !== "string" || !MONTH.test(value.next_contribution_month)) {
    fail(`${label}.next_contribution_month must be YYYY-MM`);
  }
  return value;
}

function resolveInput({ acquisition, forwardCommitment, commitment, upstream }) {
  const suppliedCommitment = forwardCommitment ?? commitment ?? null;
  if (forwardCommitment !== undefined && commitment !== undefined) {
    fail("supply only one of forwardCommitment or commitment");
  }
  if (suppliedCommitment !== null) {
    plainObject(suppliedCommitment, "validated forward-live commitment");
    const embedded = suppliedCommitment.payload?.acquisition;
    validateForwardTrialLiveAcquisition(embedded);
    if (acquisition !== undefined && !same(acquisition, embedded)) {
      fail("supplied acquisition differs from the forward-live commitment");
    }
    if (!Number.isSafeInteger(suppliedCommitment.sequence) || suppliedCommitment.sequence < 1) {
      fail("forward-live commitment sequence is invalid");
    }
    digest(suppliedCommitment.commitment_sha256, "forward-live commitment hash");
    return {
      acquisition: embedded,
      upstream: {
        source: "FORWARD_TRIAL_LIVE_COMMITMENT",
        commitment_sequence: suppliedCommitment.sequence,
        commitment_sha256: suppliedCommitment.commitment_sha256,
        acquisition_sha256: embedded.acquisition_sha256,
      },
    };
  }
  validateForwardTrialLiveAcquisition(acquisition);
  const binding = upstream ?? {
    source: "SUPPLIED_VALIDATED_ACQUISITION",
    commitment_sequence: null,
    commitment_sha256: null,
    acquisition_sha256: acquisition.acquisition_sha256,
  };
  validateUpstream(binding, acquisition);
  return { acquisition, upstream: binding };
}

function validateUpstream(value, acquisition) {
  exactKeys(value, [
    "source", "commitment_sequence", "commitment_sha256", "acquisition_sha256",
  ], "G4 shadow upstream binding");
  if (!new Set(["FORWARD_TRIAL_LIVE_COMMITMENT", "SUPPLIED_VALIDATED_ACQUISITION"]).has(value.source)) {
    fail("G4 shadow upstream source is invalid");
  }
  if (value.source === "FORWARD_TRIAL_LIVE_COMMITMENT") {
    if (!Number.isSafeInteger(value.commitment_sequence) || value.commitment_sequence < 1) {
      fail("G4 shadow upstream commitment sequence is invalid");
    }
    digest(value.commitment_sha256, "G4 shadow upstream commitment hash");
  } else if (value.commitment_sequence !== null || value.commitment_sha256 !== null) {
    fail("a directly supplied acquisition must not invent a commitment binding");
  }
  if (value.acquisition_sha256 !== acquisition.acquisition_sha256) {
    fail("G4 shadow upstream acquisition hash differs from the retained acquisition");
  }
  return value;
}

function validateChronology(acquisition, previousRecord) {
  const sessionDate = acquisition.session.session_date;
  if (previousRecord === null) {
    if (sessionDate !== G4_SHADOW_LIVE_FIRST_SIGNAL_SESSION) {
      fail("G4 shadow live first record cannot backfill or move the frozen first session");
    }
  } else {
    const expected = previousRecord.acquisition.session.next_session_date;
    if (sessionDate !== expected) {
      fail("G4 shadow live record skips, duplicates, or backfills the session chain");
    }
    if (acquisition.retrieved_at <= previousRecord.captured_at) {
      fail("G4 shadow live capture time does not advance");
    }
  }
  if (acquisition.retrieved_at >= acquisition.session.next_market_close_at) {
    fail("G4 shadow target was not captured before the next completed-session close");
  }
}

function contributionForSession(protocol, previousState, sessionDate) {
  const month = sessionDate.slice(0, 7);
  const due = previousState.next_contribution_month;
  if (month > due) fail("G4 shadow contribution schedule was skipped; backfill is forbidden");
  if (month !== due) {
    return { amount_usd: 0, contribution_month: null, applied_before_execution: false };
  }
  return {
    amount_usd: protocol.shadow_account.monthly_contribution_usd,
    contribution_month: due,
    applied_before_execution: true,
  };
}

function buildPreview({ account, contribution, prices, targetWeights, protocol }) {
  return buildMultiAssetShadowExecution({
    holdings: account.holdings,
    cash: round(account.cash + contribution),
    prices,
    target_weights: targetWeights,
    asset_eligibility: eligibleAssets(),
    cost_model: {
      slippage_bps: protocol.shadow_account.slippage_bps,
      transaction_cost_bps: protocol.shadow_account.one_way_transaction_cost_bps,
      regulatory_sell_fee_bps: 0,
    },
  });
}

function sanitizedOrders(execution) {
  const result = [];
  for (const [portfolio, preview] of [["FINLY", execution.finly_preview], ["SPY", execution.spy_preview]]) {
    if (preview === null) continue;
    for (const order of preview.order_plan.orders) {
      result.push({
        portfolio,
        sequence: order.sequence,
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        modeled_execution_notional: order.modeled_execution_notional,
        modeled_cost: round(
          order.modeled_slippage
          + order.modeled_transaction_cost
          + order.modeled_regulatory_sell_fee,
        ),
      });
    }
  }
  return result;
}

function publicBody(value) {
  const body = { ...value };
  delete body.record_sha256;
  return body;
}

function buildPublicRecord({
  protocol,
  sequence,
  signal,
  acquisition,
  capturedAt,
  execution,
  stateAfter,
  previousRecord,
}) {
  const body = {
    schema_version: G4_SHADOW_LIVE_PUBLIC_RECORD_SCHEMA,
    trial_id: G4_SHADOW_LIVE_ID,
    record_kind: "SANITIZED_PROSPECTIVE_SHADOW_RECORD",
    sequence,
    signal_session_date: signal.signal_session_date,
    next_signal_session_date: acquisition.session.next_session_date,
    captured_at: capturedAt,
    strategy_id: signal.strategy_id,
    action: signal.action,
    signal_sha256: signal.signal_sha256,
    signal: structuredClone(signal),
    target_weights: structuredClone(signal.target_weights),
    selected_sectors: structuredClone(signal.selected_sectors),
    execution_session_date: execution.execution_session_date,
    execution_status: execution.status,
    executed_prior_signal_sha256: execution.executed_prior_signal_sha256,
    modeled_orders: sanitizedOrders(execution),
    shadow_equity: stateAfter.finly.equity,
    spy_shadow_equity: stateAfter.spy.equity,
    contributions_to_date: stateAfter.contributions_to_date,
    modeled_costs_to_date: structuredClone(stateAfter.modeled_costs_to_date),
    source_panel_sha256: signal.source_panel_sha256,
    publication_deadline: acquisition.session.next_market_close_at,
    previous_record_sha256: previousRecord?.public_record.record_sha256
      ?? protocol.protocol_sha256,
  };
  return { ...body, record_sha256: sha256(body) };
}

function privateBody(value) {
  const body = { ...value };
  delete body.private_record_sha256;
  return body;
}

function validateExecutionShape(value, { acquisition, signal, previousRecord, protocol }) {
  exactKeys(value, [
    "valuation_method", "source_acquisition_sha256", "current_signal_sha256",
    "raw_reference_prices_sha256", "finly_target_weights_sha256", "spy_target_weights_sha256",
    "status", "execution_session_date", "price_book", "executed_prior_signal_sha256",
    "finly_preview", "spy_preview",
  ], "G4 shadow execution");
  if (value.valuation_method !== protocol.shadow_account.valuation_method
    || value.source_acquisition_sha256 !== acquisition.acquisition_sha256
    || value.current_signal_sha256 !== signal.signal_sha256) {
    fail("G4 shadow execution changes its canonical protocol, acquisition, or signal binding");
  }
  digest(value.source_acquisition_sha256, "G4 shadow execution acquisition hash");
  digest(value.current_signal_sha256, "G4 shadow execution current signal hash");
  const prices = currentRawPrices(acquisition);
  if (value.raw_reference_prices_sha256
    !== sha256(CORE_SYMBOLS.map((symbol) => [symbol, prices[symbol]]))) {
    fail("G4 shadow execution raw reference-price binding is invalid");
  }
  if (previousRecord !== undefined) {
    const expectedFinlyTarget = previousRecord === null
      ? null
      : sha256(previousRecord.signal.target_weights);
    const expectedSpyTarget = previousRecord === null ? null : sha256(spyWeights());
    if (value.finly_target_weights_sha256 !== expectedFinlyTarget
      || value.spy_target_weights_sha256 !== expectedSpyTarget) {
      fail("G4 shadow execution target-weight binding is invalid");
    }
  }
  for (const [label, preview] of [["Finly", value.finly_preview], ["SPY", value.spy_preview]]) {
    if (preview !== null) {
      try {
        canonicalMultiAssetShadowExecutionJson(preview);
      } catch (error) {
        fail(`${label} shadow execution preview is invalid: ${error.message}`);
      }
      if (preview.preview_only !== true
        || preview.broker_mutation_authorized !== false
        || preview.funding.self_financing !== true
        || preview.status.startsWith("blocked_")) {
        fail(`${label} shadow execution preview violates its non-authorizing invariants`);
      }
    }
  }
  return value;
}

function deriveRecord({ protocol, acquisition, upstream, previousRecord }) {
  validateG4ShadowLiveProtocol(protocol);
  validateForwardTrialLiveAcquisition(acquisition);
  validateUpstream(upstream, acquisition);
  validateChronology(acquisition, previousRecord);
  const sequence = (previousRecord?.sequence ?? 0) + 1;
  if (upstream.source === "FORWARD_TRIAL_LIVE_COMMITMENT"
    && upstream.commitment_sequence !== sequence) {
    fail("G4 shadow and forward-live commitment sequences differ");
  }
  const previousState = previousRecord?.state_after ?? buildInitialG4ShadowLiveState(protocol);
  validateState(previousState, "G4 shadow previous state");
  const signal = buildG4ShadowSignal({
    adjustedCloseRows: acquisition.adjusted_close_rows,
    sessionNumber: sequence - 1,
    previousTargetWeights: previousRecord?.signal.target_weights ?? null,
  });
  const prices = currentRawPrices(acquisition);
  const carriedFinly = previousRecord === null
    ? previousState.finly
    : totalReturnCarriedAccount(previousState.finly, previousRecord.acquisition, acquisition);
  const carriedSpy = previousRecord === null
    ? previousState.spy
    : totalReturnCarriedAccount(previousState.spy, previousRecord.acquisition, acquisition);
  const contribution = previousRecord === null
    ? { amount_usd: 0, contribution_month: null, applied_before_execution: false }
    : contributionForSession(protocol, previousState, acquisition.session.session_date);

  let finlyPreview = null;
  let spyPreview = null;
  let finly;
  let spy;
  let status;
  let executedPriorSignalSha256 = null;
  if (previousRecord === null) {
    finly = valuedAccount(carriedFinly, prices);
    spy = valuedAccount(carriedSpy, prices);
    status = "TARGET_PUBLISHED_BEFORE_OUTCOME_NO_EXECUTION";
  } else {
    const executeFinly = previousRecord.signal.action === "REBALANCE";
    const executeSpy = previousRecord.sequence === 1 || contribution.amount_usd > 0;
    if (executeFinly) {
      finlyPreview = buildPreview({
        account: carriedFinly,
        contribution: contribution.amount_usd,
        prices,
        targetWeights: previousRecord.signal.target_weights,
        protocol,
      });
      finly = accountFromPreview(finlyPreview);
      executedPriorSignalSha256 = previousRecord.signal.signal_sha256;
    } else {
      finly = valuedAccount({
        holdings: carriedFinly.holdings,
        cash: carriedFinly.cash + contribution.amount_usd,
      }, prices);
    }
    if (executeSpy) {
      spyPreview = buildPreview({
        account: carriedSpy,
        contribution: contribution.amount_usd,
        prices,
        targetWeights: spyWeights(),
        protocol,
      });
      spy = accountFromPreview(spyPreview);
    } else {
      spy = valuedAccount({
        holdings: carriedSpy.holdings,
        cash: carriedSpy.cash + contribution.amount_usd,
      }, prices);
    }
    status = executedPriorSignalSha256 === null
      ? "HOLD_MARKED_TO_CURRENT_RAW_CLOSE"
      : contribution.amount_usd > 0
        ? "PRIOR_TARGET_EXECUTED_WITH_EQUAL_CONTRIBUTION"
        : "PRIOR_TARGET_EXECUTED_AT_NEXT_COMPLETED_RAW_CLOSE";
  }

  const execution = {
    valuation_method: protocol.shadow_account.valuation_method,
    source_acquisition_sha256: acquisition.acquisition_sha256,
    current_signal_sha256: signal.signal_sha256,
    raw_reference_prices_sha256: sha256(CORE_SYMBOLS.map((symbol) => [symbol, prices[symbol]])),
    finly_target_weights_sha256: previousRecord === null
      ? null
      : sha256(previousRecord.signal.target_weights),
    spy_target_weights_sha256: previousRecord === null ? null : sha256(spyWeights()),
    status,
    execution_session_date: executedPriorSignalSha256 === null
      ? null
      : acquisition.session.session_date,
    price_book: finlyPreview === null && spyPreview === null ? null : "raw",
    executed_prior_signal_sha256: executedPriorSignalSha256,
    finly_preview: finlyPreview,
    spy_preview: spyPreview,
  };
  const stateAfter = {
    session_date: acquisition.session.session_date,
    accounting_method: protocol.shadow_account.valuation_method,
    finly,
    spy,
    contributions_to_date: round(previousState.contributions_to_date + contribution.amount_usd),
    modeled_costs_to_date: {
      finly: round(previousState.modeled_costs_to_date.finly + (finlyPreview ? previewCost(finlyPreview) : 0)),
      spy: round(previousState.modeled_costs_to_date.spy + (spyPreview ? previewCost(spyPreview) : 0)),
    },
    next_contribution_month: contribution.amount_usd > 0
      ? nextMonth(previousState.next_contribution_month)
      : previousState.next_contribution_month,
  };
  const publicRecord = buildPublicRecord({
    protocol,
    sequence,
    signal,
    acquisition,
    capturedAt: acquisition.retrieved_at,
    execution,
    stateAfter,
    previousRecord,
  });
  const body = {
    schema_version: G4_SHADOW_LIVE_PRIVATE_RECORD_SCHEMA,
    trial_id: G4_SHADOW_LIVE_ID,
    record_kind: "PRIVATE_PROSPECTIVE_SHADOW_STATE",
    sequence,
    protocol_sha256: protocol.protocol_sha256,
    captured_at: acquisition.retrieved_at,
    upstream: structuredClone(upstream),
    acquisition: structuredClone(acquisition),
    signal: structuredClone(signal),
    execution,
    state_before: structuredClone(previousState),
    contribution,
    state_after: stateAfter,
    previous_private_record_sha256: previousRecord?.private_record_sha256
      ?? protocol.protocol_sha256,
    public_record: publicRecord,
    authority: {
      shadow_only: true,
      broker_mutation_authorized: false,
      order_submission_permitted: false,
      real_money_permitted: false,
    },
  };
  return { ...body, private_record_sha256: sha256(body) };
}

function validatePrivateShape(value) {
  exactKeys(value, [
    "schema_version", "trial_id", "record_kind", "sequence", "protocol_sha256",
    "captured_at", "upstream", "acquisition", "signal", "execution", "state_before",
    "contribution", "state_after", "previous_private_record_sha256", "public_record",
    "authority", "private_record_sha256",
  ], "G4 shadow private record");
  if (value.schema_version !== G4_SHADOW_LIVE_PRIVATE_RECORD_SCHEMA
    || value.trial_id !== G4_SHADOW_LIVE_ID
    || value.record_kind !== "PRIVATE_PROSPECTIVE_SHADOW_STATE"
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 1) {
    fail("G4 shadow private record envelope is invalid");
  }
  digest(value.protocol_sha256, "G4 shadow protocol hash");
  digest(value.previous_private_record_sha256, "previous G4 shadow private record hash");
  digest(value.private_record_sha256, "G4 shadow private record hash");
  if (value.private_record_sha256 !== sha256(privateBody(value))) {
    fail("G4 shadow private record hash is invalid");
  }
  validateForwardTrialLiveAcquisition(value.acquisition);
  validateUpstream(value.upstream, value.acquisition);
  validateG4ShadowSignal(value.signal);
  validateExecutionShape(value.execution, {
    acquisition: value.acquisition,
    signal: value.signal,
    previousRecord: undefined,
    protocol: { shadow_account: { valuation_method: value.execution.valuation_method } },
  });
  validateState(value.state_before, "G4 shadow state_before");
  validateState(value.state_after, "G4 shadow state_after");
  exactKeys(value.authority, [
    "shadow_only", "broker_mutation_authorized", "order_submission_permitted", "real_money_permitted",
  ], "G4 shadow authority");
  if (value.authority.shadow_only !== true
    || value.authority.broker_mutation_authorized !== false
    || value.authority.order_submission_permitted !== false
    || value.authority.real_money_permitted !== false) {
    fail("G4 shadow private record crosses its non-authorizing boundary");
  }
  return value;
}

export function validateG4ShadowLivePublicRecord(value, {
  protocol,
  previousRecord = null,
  privateRecord = null,
} = {}) {
  validateG4ShadowLiveProtocol(protocol);
  exactKeys(value, [
    "schema_version", "trial_id", "record_kind", "sequence", "signal_session_date",
    "next_signal_session_date", "captured_at", "strategy_id", "action", "signal_sha256", "signal",
    "target_weights", "selected_sectors",
    "execution_session_date", "execution_status", "executed_prior_signal_sha256", "modeled_orders",
    "shadow_equity", "spy_shadow_equity", "contributions_to_date", "modeled_costs_to_date",
    "source_panel_sha256", "publication_deadline", "previous_record_sha256", "record_sha256",
  ], "G4 shadow public record");
  if (value.schema_version !== G4_SHADOW_LIVE_PUBLIC_RECORD_SCHEMA
    || value.trial_id !== G4_SHADOW_LIVE_ID
    || value.record_kind !== "SANITIZED_PROSPECTIVE_SHADOW_RECORD"
    || value.strategy_id !== G4_SHADOW_STRATEGY_ID
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 1) {
    fail("G4 shadow public record envelope is invalid");
  }
  canonicalDate(value.signal_session_date, "G4 shadow public signal date");
  canonicalDate(value.next_signal_session_date, "G4 shadow public next signal date");
  const capturedAt = new Date(value.captured_at);
  if (typeof value.captured_at !== "string" || !Number.isFinite(capturedAt.getTime())
    || capturedAt.toISOString() !== value.captured_at) {
    fail("G4 shadow public captured_at must be a canonical UTC timestamp");
  }
  if (!new Set(["REBALANCE", "HOLD"]).has(value.action)) {
    fail("G4 shadow public action is invalid");
  }
  const expectedAction = (value.sequence - 1) % 21 === 0 ? "REBALANCE" : "HOLD";
  if (value.action !== expectedAction) fail("G4 shadow public action violates the frozen cadence");
  digest(value.signal_sha256, "G4 shadow public signal hash");
  validateG4ShadowSignal(value.signal);
  if (value.signal.chronology.session_number !== value.sequence - 1
    || value.signal.signal_session_date !== value.signal_session_date
    || value.signal.strategy_id !== value.strategy_id
    || value.signal.action !== value.action
    || value.signal.signal_sha256 !== value.signal_sha256
    || value.signal.source_panel_sha256 !== value.source_panel_sha256
    || !same(value.signal.target_weights, value.target_weights)
    || !same(value.signal.selected_sectors, value.selected_sectors)) {
    fail("G4 shadow public fields differ from the complete validated signal envelope");
  }
  const deadline = new Date(value.publication_deadline);
  if (typeof value.publication_deadline !== "string" || !Number.isFinite(deadline.getTime())
    || deadline.toISOString() !== value.publication_deadline
    || value.publication_deadline.slice(0, 10) !== value.next_signal_session_date
    || value.captured_at >= value.publication_deadline) {
    fail("G4 shadow public publication deadline is invalid");
  }
  if (value.execution_session_date !== null) {
    canonicalDate(value.execution_session_date, "G4 shadow public execution date");
  }
  if (!new Set([
    "TARGET_PUBLISHED_BEFORE_OUTCOME_NO_EXECUTION",
    "PRIOR_TARGET_EXECUTED_AT_NEXT_COMPLETED_RAW_CLOSE",
    "PRIOR_TARGET_EXECUTED_WITH_EQUAL_CONTRIBUTION",
    "HOLD_MARKED_TO_CURRENT_RAW_CLOSE",
  ]).has(value.execution_status)) {
    fail("G4 shadow public execution status is invalid");
  }
  if (value.executed_prior_signal_sha256 !== null) {
    digest(value.executed_prior_signal_sha256, "G4 shadow public executed signal hash");
  }
  digest(value.source_panel_sha256, "G4 shadow public source panel hash");
  digest(value.previous_record_sha256, "previous G4 shadow public record hash");
  digest(value.record_sha256, "G4 shadow public record hash");
  if (value.record_sha256 !== sha256(publicBody(value))) fail("G4 shadow public record hash is invalid");
  const expectedPrevious = previousRecord?.record_sha256 ?? protocol.protocol_sha256;
  if (value.sequence !== (previousRecord?.sequence ?? 0) + 1
    || value.previous_record_sha256 !== expectedPrevious) {
    fail("G4 shadow public record hash chain is broken");
  }
  exactSymbols(value.target_weights, "G4 shadow public target weights");
  const weightTotal = Object.values(value.target_weights).reduce((sum, weight) => {
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
      fail("G4 shadow public target weight is invalid");
    }
    return sum + weight;
  }, 0);
  if (Math.abs(weightTotal - 1) > 1e-10) fail("G4 shadow public target weights do not sum to one");
  if (!Array.isArray(value.selected_sectors) || value.selected_sectors.length !== 3
    || new Set(value.selected_sectors).size !== 3
    || value.selected_sectors.some((symbol) => ![
      "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU",
    ].includes(symbol))
    || !Array.isArray(value.modeled_orders)) {
    fail("G4 shadow public sectors or modeled orders are invalid");
  }
  if (!same([...value.selected_sectors].sort(), value.selected_sectors)) {
    fail("G4 shadow public selected sectors must be sorted");
  }
  for (const symbol of CORE_SYMBOLS) {
    const expectedWeight = symbol === "QQQ"
      ? 0.5
      : value.selected_sectors.includes(symbol) ? 1 / 6 : 0;
    if (Math.abs(value.target_weights[symbol] - expectedWeight) > 1e-12) {
      fail("G4 shadow public allocation differs from the exact frozen QQQ/sector policy");
    }
  }
  for (const order of value.modeled_orders) {
    exactKeys(order, [
      "portfolio", "sequence", "symbol", "side", "qty",
      "modeled_execution_notional", "modeled_cost",
    ], "sanitized modeled order");
    if (!new Set(["FINLY", "SPY"]).has(order.portfolio)
      || !CORE_SYMBOLS.includes(order.symbol)
      || !new Set(["buy", "sell"]).has(order.side)
      || !Number.isSafeInteger(order.sequence)
      || order.sequence < 1
      || typeof order.qty !== "string"
      || !/^(?:0|[1-9]\d*)\.\d{9}$/u.test(order.qty)) {
      fail("sanitized modeled order is invalid");
    }
    finiteNonnegative(order.modeled_execution_notional, "sanitized modeled order notional");
    finiteNonnegative(order.modeled_cost, "sanitized modeled order cost");
  }
  finiteNonnegative(value.shadow_equity, "G4 shadow public equity");
  finiteNonnegative(value.spy_shadow_equity, "G4 SPY public equity");
  finiteNonnegative(value.contributions_to_date, "G4 public contributions");
  exactKeys(value.modeled_costs_to_date, ["finly", "spy"], "G4 public modeled costs");
  finiteNonnegative(value.modeled_costs_to_date.finly, "G4 public Finly costs");
  finiteNonnegative(value.modeled_costs_to_date.spy, "G4 public SPY costs");
  const serialized = JSON.stringify(value);
  for (const forbidden of PUBLIC_FORBIDDEN) {
    if (serialized.includes(forbidden)) fail(`G4 shadow public record leaks private field ${forbidden}`);
  }
  if (privateRecord !== null && !same(value, privateRecord.public_record)) {
    fail("G4 shadow public record differs from its private source record");
  }
  if (previousRecord === null) {
    if (value.sequence !== 1
      || value.signal_session_date !== G4_SHADOW_LIVE_FIRST_SIGNAL_SESSION
      || value.next_signal_session_date !== "2026-09-01"
      || value.execution_session_date !== null
      || value.execution_status !== "TARGET_PUBLISHED_BEFORE_OUTCOME_NO_EXECUTION"
      || value.executed_prior_signal_sha256 !== null
      || value.modeled_orders.length !== 0) {
      fail("G4 shadow first public record changes its no-execution genesis");
    }
  } else {
    if (value.signal_session_date !== previousRecord.next_signal_session_date
      || value.captured_at <= previousRecord.captured_at) {
      fail("G4 shadow public chronology differs from the previously declared official next session");
    }
    if (previousRecord.action === "REBALANCE") {
      if (value.execution_session_date !== value.signal_session_date
        || value.executed_prior_signal_sha256 !== previousRecord.signal_sha256
        || !new Set([
          "PRIOR_TARGET_EXECUTED_AT_NEXT_COMPLETED_RAW_CLOSE",
          "PRIOR_TARGET_EXECUTED_WITH_EQUAL_CONTRIBUTION",
        ]).has(value.execution_status)) {
        fail("G4 shadow public record does not settle the prior REBALANCE distinctly");
      }
    } else if (value.execution_session_date !== null
      || value.executed_prior_signal_sha256 !== null
      || value.execution_status !== "HOLD_MARKED_TO_CURRENT_RAW_CLOSE"
      || value.modeled_orders.some(({ portfolio }) => portfolio === "FINLY")) {
      fail("G4 shadow public HOLD creates a Finly execution");
    }
  }
  return value;
}

export function buildG4ShadowLivePrivateRecord(options = {}) {
  const protocol = options.protocol;
  const previousRecord = options.previousRecord ?? null;
  validateG4ShadowLiveProtocol(protocol);
  if (previousRecord !== null) validatePrivateShape(previousRecord);
  const resolved = resolveInput(options);
  const value = deriveRecord({
    protocol,
    acquisition: resolved.acquisition,
    upstream: resolved.upstream,
    previousRecord,
  });
  return validateG4ShadowLivePrivateRecord(deepFreeze(value), { protocol, previousRecord });
}

export function validateG4ShadowLivePrivateRecord(value, {
  protocol,
  previousRecord = null,
} = {}) {
  validateG4ShadowLiveProtocol(protocol);
  validatePrivateShape(value);
  validateExecutionShape(value.execution, {
    acquisition: value.acquisition,
    signal: value.signal,
    previousRecord,
    protocol,
  });
  if (value.protocol_sha256 !== protocol.protocol_sha256) fail("G4 shadow private record uses another protocol");
  const expectedPrevious = previousRecord?.private_record_sha256 ?? protocol.protocol_sha256;
  if (value.sequence !== (previousRecord?.sequence ?? 0) + 1
    || value.previous_private_record_sha256 !== expectedPrevious) {
    fail("G4 shadow private record hash chain is broken");
  }
  const expected = deriveRecord({
    protocol,
    acquisition: value.acquisition,
    upstream: value.upstream,
    previousRecord,
  });
  if (!same(value, expected)) fail("G4 shadow private record differs from deterministic replay");
  validateG4ShadowLivePublicRecord(value.public_record, {
    protocol,
    previousRecord: previousRecord?.public_record ?? null,
    privateRecord: value,
  });
  return value;
}

export function buildG4ShadowLivePublicRecord(privateRecord, {
  protocol,
  previousRecord = null,
} = {}) {
  validateG4ShadowLivePrivateRecord(privateRecord, { protocol, previousRecord });
  return deepFreeze(structuredClone(privateRecord.public_record));
}

export function validateG4ShadowLiveExecution(value, {
  privateRecord,
  protocol,
  previousRecord = null,
} = {}) {
  if (!privateRecord || !same(value, privateRecord.execution)) {
    fail("G4 shadow execution must be supplied with its complete binding private record");
  }
  validateG4ShadowLivePrivateRecord(privateRecord, { protocol, previousRecord });
  validateExecutionShape(value, {
    acquisition: privateRecord.acquisition,
    signal: privateRecord.signal,
    previousRecord,
    protocol,
  });
  return value;
}

export function canonicalG4ShadowLiveExecutionJson(value, options = {}) {
  validateG4ShadowLiveExecution(value, options);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function publicationReceiptBody(value) {
  const body = { ...value };
  delete body.receipt_sha256;
  return body;
}

function githubInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) {
    fail(`${label} must be a canonical GitHub UTC timestamp`);
  }
  const normalized = new Date(value).toISOString();
  if (value !== normalized && value !== normalized.replace(".000Z", "Z")) {
    fail(`${label} must be a canonical GitHub UTC timestamp`);
  }
  return value;
}

export function validateG4ShadowLivePublicationReceipt(value, {
  protocol,
  publicRecord,
  previousPublicRecord = null,
  previousReceipt = null,
} = {}) {
  validateG4ShadowLiveProtocol(protocol);
  validateG4ShadowLivePublicRecord(publicRecord, { protocol, previousRecord: previousPublicRecord });
  exactKeys(value, [
    "schema_version", "trial_id", "evidence_class", "sequence", "repository",
    "publication_commit", "workflow_run", "published_record", "publication_deadline",
    "verification_observed_at", "previous_receipt_sha256", "assurance", "receipt_sha256",
  ], "G4 shadow GitHub publication receipt");
  if (value.schema_version !== G4_SHADOW_LIVE_PUBLICATION_RECEIPT_SCHEMA
    || value.trial_id !== G4_SHADOW_LIVE_ID
    || value.evidence_class !== "REPRODUCIBLE_PUBLIC_GITHUB_API_POINTER"
    || value.sequence !== publicRecord.sequence) {
    fail("G4 shadow GitHub publication receipt envelope is invalid");
  }
  exactKeys(value.repository, ["id", "full_name", "public", "default_branch"], "G4 publication repository");
  if (value.repository.id !== 1_350_112_497
    || value.repository.full_name !== "owlsowo/finly-bot"
    || value.repository.public !== true
    || value.repository.default_branch !== "main") {
    fail("G4 shadow publication repository identity is invalid");
  }
  exactKeys(value.publication_commit, ["sha", "parent_sha", "html_url"], "G4 publication commit");
  if (!COMMIT_SHA.test(value.publication_commit.sha)
    || !COMMIT_SHA.test(value.publication_commit.parent_sha)
    || value.publication_commit.sha === value.publication_commit.parent_sha
    || value.publication_commit.html_url
      !== `https://github.com/owlsowo/finly-bot/commit/${value.publication_commit.sha}`) {
    fail("G4 shadow publication commit linkage is invalid");
  }
  exactKeys(value.workflow_run, [
    "id", "head_sha", "event", "head_branch", "status", "conclusion",
    "created_at", "updated_at", "html_url",
  ], "G4 publication workflow run");
  if (!Number.isSafeInteger(value.workflow_run.id) || value.workflow_run.id < 1
    || value.workflow_run.head_sha !== value.publication_commit.sha
    || value.workflow_run.event !== "push"
    || value.workflow_run.head_branch !== "main"
    || value.workflow_run.status !== "completed"
    || value.workflow_run.conclusion !== "success"
    || value.workflow_run.html_url
      !== `https://github.com/owlsowo/finly-bot/actions/runs/${value.workflow_run.id}`) {
    fail("G4 shadow publication workflow is not a successful main-branch push");
  }
  githubInstant(value.workflow_run.created_at, "G4 publication workflow created_at");
  githubInstant(value.workflow_run.updated_at, "G4 publication workflow updated_at");
  exactKeys(value.published_record, [
    "path", "record_sha256", "raw_bytes_sha256",
  ], "G4 published record binding");
  const expectedPath = `research/g4_shadow_live/records/${g4ShadowLivePublicFilename(publicRecord)}`;
  if (value.published_record.path !== expectedPath
    || value.published_record.record_sha256 !== publicRecord.record_sha256
    || value.published_record.raw_bytes_sha256
      !== sha256(canonicalG4ShadowLiveRecordJson(publicRecord))) {
    fail("G4 shadow publication receipt does not bind the canonical public record bytes");
  }
  if (value.publication_deadline !== publicRecord.publication_deadline) {
    fail("G4 shadow publication receipt changes the pre-execution deadline");
  }
  const observedAt = githubInstant(value.verification_observed_at, "G4 publication verification_observed_at");
  if (Date.parse(value.workflow_run.updated_at) < Date.parse(value.workflow_run.created_at)
    || Date.parse(observedAt) < Date.parse(value.workflow_run.updated_at)
    || Date.parse(value.workflow_run.created_at) >= Date.parse(value.publication_deadline)
    || Date.parse(value.workflow_run.updated_at) >= Date.parse(value.publication_deadline)
    || Date.parse(observedAt) >= Date.parse(value.publication_deadline)) {
    fail("G4 shadow public GitHub record was not successfully observed before execution close");
  }
  const expectedPrevious = previousReceipt?.receipt_sha256 ?? protocol.protocol_sha256;
  if (value.previous_receipt_sha256 !== expectedPrevious) {
    fail("G4 shadow publication receipt hash chain is broken");
  }
  exactKeys(value.assurance, [
    "github_public_api_responses_verified", "canonical_public_bytes_reverified",
    "provider_signature_verified", "pre_execution_publication_verified",
  ], "G4 publication assurance");
  if (value.assurance.github_public_api_responses_verified !== true
    || value.assurance.canonical_public_bytes_reverified !== true
    || value.assurance.provider_signature_verified !== false
    || value.assurance.pre_execution_publication_verified !== true) {
    fail("G4 shadow publication assurance is invalid");
  }
  digest(value.receipt_sha256, "G4 publication receipt hash");
  if (value.receipt_sha256 !== sha256(publicationReceiptBody(value))) {
    fail("G4 shadow publication receipt self-hash is invalid");
  }
  return value;
}

export function buildG4ShadowLivePublicationReceipt({
  protocol,
  publicRecord,
  previousPublicRecord = null,
  previousReceipt = null,
  repository,
  publicationCommit,
  workflowRun,
  verificationObservedAt,
}) {
  const body = {
    schema_version: G4_SHADOW_LIVE_PUBLICATION_RECEIPT_SCHEMA,
    trial_id: G4_SHADOW_LIVE_ID,
    evidence_class: "REPRODUCIBLE_PUBLIC_GITHUB_API_POINTER",
    sequence: publicRecord.sequence,
    repository: structuredClone(repository),
    publication_commit: structuredClone(publicationCommit),
    workflow_run: structuredClone(workflowRun),
    published_record: {
      path: `research/g4_shadow_live/records/${g4ShadowLivePublicFilename(publicRecord)}`,
      record_sha256: publicRecord.record_sha256,
      raw_bytes_sha256: sha256(canonicalG4ShadowLiveRecordJson(publicRecord)),
    },
    publication_deadline: publicRecord.publication_deadline,
    verification_observed_at: verificationObservedAt,
    previous_receipt_sha256: previousReceipt?.receipt_sha256 ?? protocol.protocol_sha256,
    assurance: {
      github_public_api_responses_verified: true,
      canonical_public_bytes_reverified: true,
      provider_signature_verified: false,
      pre_execution_publication_verified: true,
    },
  };
  const value = { ...body, receipt_sha256: sha256(body) };
  return deepFreeze(validateG4ShadowLivePublicationReceipt(value, {
    protocol,
    publicRecord,
    previousPublicRecord,
    previousReceipt,
  }));
}

export function g4ShadowLivePublicationReceiptFilename(receipt) {
  digest(receipt?.receipt_sha256, "G4 publication receipt hash");
  if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1) {
    fail("G4 publication receipt sequence is invalid");
  }
  return `${String(receipt.sequence).padStart(8, "0")}_${receipt.receipt_sha256.slice(7)}.json`;
}

export function validateG4ShadowLiveRecordChains({
  protocol,
  privateRecords,
  publicRecords,
}) {
  validateG4ShadowLiveProtocol(protocol);
  if (!Array.isArray(privateRecords) || !Array.isArray(publicRecords)
    || (privateRecords.length > 0 && publicRecords.length > privateRecords.length)
    || (privateRecords.length > 0 && privateRecords.length - publicRecords.length > 1)) {
    fail("G4 shadow private/public chains are inconsistent");
  }
  const verifiedPrivate = [];
  for (const record of privateRecords) {
    validateG4ShadowLivePrivateRecord(record, {
      protocol,
      previousRecord: verifiedPrivate.at(-1) ?? null,
    });
    verifiedPrivate.push(record);
  }
  const verifiedPublic = [];
  for (const [index, record] of publicRecords.entries()) {
    validateG4ShadowLivePublicRecord(record, {
      protocol,
      previousRecord: verifiedPublic.at(-1) ?? null,
      privateRecord: verifiedPrivate[index] ?? null,
    });
    verifiedPublic.push(record);
  }
  return { privateRecords: verifiedPrivate, publicRecords: verifiedPublic };
}

export function g4ShadowLivePrivateFilename(record) {
  validatePrivateShape(record);
  return `${String(record.sequence).padStart(8, "0")}_${record.private_record_sha256.slice(7)}.json`;
}

export function g4ShadowLivePublicFilename(record) {
  digest(record?.record_sha256, "G4 shadow public record hash");
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 1) {
    fail("G4 shadow public record sequence is invalid");
  }
  return `${String(record.sequence).padStart(8, "0")}_${record.record_sha256.slice(7)}.json`;
}

export function canonicalG4ShadowLiveRecordJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
