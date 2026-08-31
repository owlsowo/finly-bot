import { sha256, stableStringify } from "./canonical.mjs";

const CONTRACT_SCHEMA = "finly_forward_profit_kpi_contract.v1";
const CONTRACT_ID = "official-paper-forward-profit-2026-08-31";
const EXPECTED_CONTRACT_HASH = "sha256:79144c447ce831adf64fdaa7f34ad3ba7a85569f83a4c31ac74435690e30c950";
const MEASUREMENT_SCHEMA = "finly_forward_profit_measurement.v1";
const WINDOW_START = "2026-08-31T13:30:00.000Z";
const WINDOW_END = "2026-09-04T13:30:00.000Z";
const BASELINE_EQUITY = 100_000;
const WINDOW_DURATION_MS = 60_000;
const ACTIVITY_KINDS = new Set(["ENDOGENOUS", "EXTERNAL_CASHFLOW", "FEE", "FILL", "UNKNOWN"]);

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || stableStringify(Object.keys(value).sort()) !== stableStringify([...keys].sort())) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function exactInstant(value, label) {
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (parsed === null || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function finitePositive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
}

function finiteMoney(value, label, { positive = false } = {}) {
  finiteNumber(value, label);
  if ((positive && value <= 0) || !Number.isSafeInteger(Math.round(value * 100))
    || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw new Error(`${label} must be represented at exact cent precision`);
  }
  return round(value, 2);
}

function signedContract(contract) {
  const body = structuredClone(contract);
  delete body.contract_hash;
  return body;
}

function signedMeasurement(measurement) {
  const body = structuredClone(measurement);
  delete body.measurement_hash;
  return body;
}

function round(value, decimalPlaces) {
  const result = Number(value.toFixed(decimalPlaces));
  return Object.is(result, -0) ? 0 : result;
}

function validateExactValues(actual, expected, label) {
  if (stableStringify(actual) !== stableStringify(expected)) throw new Error(`${label} drifted`);
}

export function assertCompetitionForwardProfitContract(contract) {
  exactKeys(contract, [
    "authority", "benchmark", "competition_window", "contract_hash", "contract_id", "drivers",
    "frozen_at", "guardrails", "primary_kpi", "production_protocol", "schema_version",
    "secondary_kpi", "timestamp_semantics",
  ], "Forward-profit contract");
  if (contract.schema_version !== CONTRACT_SCHEMA
    || contract.contract_id !== CONTRACT_ID
    || contract.contract_hash !== EXPECTED_CONTRACT_HASH
    || contract.contract_hash !== sha256(signedContract(contract))) {
    throw new Error("Forward-profit contract identity or hash is invalid");
  }
  const frozenAt = exactInstant(contract.frozen_at, "Forward-profit contract freeze time");
  if (Date.parse(frozenAt) >= Date.parse(WINDOW_START)) {
    throw new Error("Forward-profit contract was not frozen before the competition window");
  }

  validateExactValues(contract.competition_window, {
    start_at: WINDOW_START,
    end_at: WINDOW_END,
    end_exclusive: true,
    baseline_equity_dollars: "100000.00",
  }, "Forward-profit competition window");
  validateExactValues(contract.production_protocol, {
    path: "config/g4-official-production.json",
    protocol_id: "g4-official-production-2026-08-31",
    protocol_hash: "sha256:3b3914cd0c28afcc263117fd536072ef9a17a56a7ef040cd2e9ceff876d7437e",
  }, "Forward-profit production-protocol binding");
  validateExactValues(contract.primary_kpi, {
    id: "broker_mark_to_market_net_pnl",
    label: "Paper-account net profit",
    formula: "aligned_broker_equity_dollars - baseline_equity_dollars",
    measurement_basis: "broker_mark_to_market_net_of_reflected_charges",
    unit: "USD",
    success_operator: "greater_than",
    success_threshold: "0.00",
  }, "Forward-profit primary KPI");
  validateExactValues(contract.secondary_kpi, {
    id: "excess_vs_spy_iex_price_return",
    label: "Excess versus SPY raw IEX price return",
    formula: "strategy_return_fraction - spy_raw_iex_price_return_fraction_at_exact_common_valued_at",
    unit: "fraction",
    success_operator: "greater_than",
    success_threshold: "0.000000000000",
  }, "Forward-profit secondary KPI");
  validateExactValues(contract.benchmark, {
    provider: "Alpaca Market Data API",
    symbol: "SPY",
    feed: "iex",
    adjustment: "raw",
    timeframe: "1Min",
    anchor_rule: "first_official_09_30_et_bar_open",
    valuation_rule: "latest_exact_common_completed_minute",
    return_basis: "raw_price_return_not_total_return_or_alpha",
  }, "Forward-profit benchmark");
  validateExactValues(contract.timestamp_semantics, {
    source_label: "window_start_at",
    normalized_label: "valued_at",
    window_duration_seconds: 60,
    normalization_rule: "valued_at_equals_window_start_plus_60_seconds",
    alignment_rule: "exact_valued_at_intersection_no_forward_fill",
  }, "Forward-profit timestamp semantics");
  validateExactValues(contract.drivers, [
    "fill_event_count", "broker_reported_fee_paid_dollars", "broker_reported_fee_rebate_dollars",
    "broker_reported_fee_net_effect_dollars", "external_cashflow_event_count",
    "external_cashflow_gross_absolute_dollars", "external_cashflow_net_dollars",
  ], "Forward-profit drivers");
  validateExactValues(contract.guardrails, {
    activities_must_be_complete: true,
    external_cashflow_must_equal_dollars: "0.00",
    external_cashflow_activity_types: [
      "ACATC", "ACATS", "CSD", "CSW", "FOPT", "JNL", "JNLC", "JNLS", "OCT",
    ],
    endogenous_activity_types: [
      "CFEE", "DIV", "FEE", "FILL", "INT", "OPASN", "OPEXC", "OPEXP", "OPXRC", "PTC",
    ],
    unknown_activity_rule: "withhold",
    require_exact_common_timestamp: true,
    reject_future_points: true,
    fee_treatment: "broker_equity_includes_reflected_fees_do_not_subtract_again",
  }, "Forward-profit guardrails");
  validateExactValues(contract.authority, {
    purpose: "official_paper_competition_forward_measurement",
    account_binding_environment_variable: "FINLY_COMPETITION_ACCOUNT_ID",
    paper_only: true,
    broker_access: "get_only",
    trading_authority: false,
    mutation_authority: false,
    mcp_authority: false,
    network_access: "none_in_pure_calculator",
    persistence: "none_in_pure_calculator",
    publishable_output: "sanitized_aggregate_only",
  }, "Forward-profit authority");
  return contract;
}

function validatePointSeries(points, valueKey, label, observedAtMs) {
  if (!Array.isArray(points)) throw new Error(`${label} must be an array`);
  const seenValuations = new Set();
  let previousWindowStart = null;
  return points.map((point, index) => {
    exactKeys(point, ["valued_at", "window_start_at", valueKey], `${label} point ${index + 1}`);
    const windowStartAt = exactInstant(point.window_start_at, `${label} point ${index + 1} window start`);
    const valuedAt = exactInstant(point.valued_at, `${label} point ${index + 1} valuation time`);
    const windowStartMs = Date.parse(windowStartAt);
    const valuedAtMs = Date.parse(valuedAt);
    if (valuedAtMs !== windowStartMs + WINDOW_DURATION_MS) {
      throw new Error(`${label} point ${index + 1} does not normalize its left-labelled minute`);
    }
    if (windowStartMs < Date.parse(WINDOW_START) || valuedAtMs >= Date.parse(WINDOW_END)) {
      throw new Error(`${label} point ${index + 1} is outside the competition window`);
    }
    if (valuedAtMs > observedAtMs) throw new Error(`${label} point ${index + 1} is in the future`);
    if (previousWindowStart !== null && windowStartMs <= previousWindowStart) {
      throw new Error(`${label} must be strictly ordered without duplicates`);
    }
    if (seenValuations.has(valuedAt)) throw new Error(`${label} contains a duplicate valuation timestamp`);
    previousWindowStart = windowStartMs;
    seenValuations.add(valuedAt);
    return {
      window_start_at: windowStartAt,
      valued_at: valuedAt,
      [valueKey]: valueKey === "equity"
        ? finiteMoney(point[valueKey], `${label} point ${index + 1} value`, { positive: true })
        : finitePositive(point[valueKey], `${label} point ${index + 1} value`),
    };
  });
}

function validateActivities(activities, observedAtMs, coverageThroughMs) {
  if (!Array.isArray(activities)) throw new Error("Activities must be an array");
  return activities.map((activity, index) => {
    exactKeys(activity, ["at", "kind", "net_amount"], `Activity ${index + 1}`);
    const at = exactInstant(activity.at, `Activity ${index + 1} time`);
    const atMs = Date.parse(at);
    if (atMs < Date.parse(WINDOW_START) || atMs >= Date.parse(WINDOW_END)) {
      throw new Error(`Activity ${index + 1} is outside the competition window`);
    }
    if (atMs > observedAtMs) throw new Error(`Activity ${index + 1} is in the future`);
    if (atMs > coverageThroughMs) throw new Error(`Activity ${index + 1} exceeds declared activity coverage`);
    if (!ACTIVITY_KINDS.has(activity.kind)) throw new Error(`Activity ${index + 1} kind is invalid`);
    if (activity.net_amount !== null) finiteMoney(activity.net_amount, `Activity ${index + 1} net amount`);
    if (activity.kind === "FEE" && activity.net_amount === null) {
      throw new Error(`Activity ${index + 1} fee amount is missing`);
    }
    if (activity.kind === "FILL" && activity.net_amount !== null) {
      throw new Error(`Activity ${index + 1} fill must not carry a net amount`);
    }
    return structuredClone(activity);
  });
}

function emptyDrivers(activityCoverageThrough) {
  return {
    fill_event_count: null,
    broker_reported_fee_paid_dollars: null,
    broker_reported_fee_rebate_dollars: null,
    broker_reported_fee_net_effect_dollars: null,
    external_cashflow_event_count: null,
    external_cashflow_gross_absolute_dollars: null,
    external_cashflow_net_dollars: null,
    activity_coverage_through: activityCoverageThrough,
    fee_settlement_status: "provisional_as_of_activity_coverage",
  };
}

function baseMeasurement(contract, observedAt, activityCoverageThrough, status, withheldReason, drivers, integrity) {
  const measurement = {
    schema_version: MEASUREMENT_SCHEMA,
    contract_id: contract.contract_id,
    contract_hash: contract.contract_hash,
    production_protocol_hash: contract.production_protocol.protocol_hash,
    status,
    withheld_reason: withheldReason,
    observed_at: observedAt,
    activity_coverage_through: activityCoverageThrough,
    common_valued_at: null,
    measurement_basis: contract.primary_kpi.measurement_basis,
    primary_kpi: null,
    benchmark: null,
    secondary_kpi: null,
    drivers,
    integrity,
    authority: {
      paper_only: true,
      read_only: true,
      sanitized: true,
      broker_mutation_authorized: false,
    },
    measurement_hash: "",
  };
  measurement.measurement_hash = sha256(signedMeasurement(measurement));
  return measurement;
}

function activityDiagnostics(activities, activitiesComplete, activityCoverageThrough) {
  if (!activitiesComplete) {
    return {
      drivers: emptyDrivers(activityCoverageThrough),
      externalCashflowsZero: null,
      withheldReason: null,
    };
  }
  const fills = activities.filter(({ kind }) => kind === "FILL");
  const fees = activities.filter(({ kind }) => kind === "FEE");
  const external = activities.filter(({ kind }) => kind === "EXTERNAL_CASHFLOW");
  const hasUnknown = activities.some(({ kind }) => kind === "UNKNOWN");
  const unknownExternalAmount = external.some(({ net_amount: netAmount }) => netAmount === null);
  const nonzeroExternalAmount = external.some(({ net_amount: netAmount }) => netAmount !== null && netAmount !== 0);
  const externalNet = unknownExternalAmount
    ? null
    : round(external.reduce((sum, { net_amount: netAmount }) => sum + netAmount, 0), 2);
  const externalGross = unknownExternalAmount
    ? null
    : round(external.reduce((sum, { net_amount: netAmount }) => sum + Math.abs(netAmount), 0), 2);
  const feePaid = fees.reduce((sum, { net_amount: netAmount }) => sum + Math.max(0, -netAmount), 0);
  const feeRebate = fees.reduce((sum, { net_amount: netAmount }) => sum + Math.max(0, netAmount), 0);
  return {
    drivers: {
      fill_event_count: fills.length,
      broker_reported_fee_paid_dollars: round(feePaid, 2),
      broker_reported_fee_rebate_dollars: round(feeRebate, 2),
      broker_reported_fee_net_effect_dollars: round(feeRebate - feePaid, 2),
      external_cashflow_event_count: external.length,
      external_cashflow_gross_absolute_dollars: externalGross,
      external_cashflow_net_dollars: externalNet,
      activity_coverage_through: activityCoverageThrough,
      fee_settlement_status: "provisional_as_of_activity_coverage",
    },
    externalCashflowsZero: !hasUnknown && !unknownExternalAmount && !nonzeroExternalAmount,
    withheldReason: hasUnknown
      ? "UNKNOWN_ACTIVITY_CLASSIFICATION"
      : unknownExternalAmount
        ? "EXTERNAL_CASHFLOW_AMOUNT_UNAVAILABLE"
        : nonzeroExternalAmount ? "NONZERO_EXTERNAL_CASHFLOW" : null,
  };
}

export function buildCompetitionForwardProfitMeasurement({
  contract,
  observedAt,
  activityCoverageThrough,
  accountPoints,
  spyAnchor,
  spyPoints,
  activities,
  activitiesComplete,
}) {
  assertCompetitionForwardProfitContract(contract);
  const normalizedObservedAt = exactInstant(observedAt, "Forward-profit observation time");
  const observedAtMs = Date.parse(normalizedObservedAt);
  const normalizedCoverageThrough = exactInstant(activityCoverageThrough, "Activity coverage time");
  const coverageThroughMs = Date.parse(normalizedCoverageThrough);
  if (coverageThroughMs > observedAtMs) throw new Error("Activity coverage time is in the future");
  if (typeof activitiesComplete !== "boolean") throw new Error("Activities-complete flag is invalid");
  const accounts = validatePointSeries(accountPoints, "equity", "Account-equity series", observedAtMs);
  const spy = validatePointSeries(spyPoints, "price", "SPY series", observedAtMs);
  const normalizedActivities = validateActivities(activities, observedAtMs, coverageThroughMs);

  if (spyAnchor === null) {
    if (spy.length > 0) throw new Error("SPY points cannot exist without the official anchor");
  } else {
    exactKeys(spyAnchor, ["open_price", "valued_at", "window_start_at"], "SPY anchor");
    exactInstant(spyAnchor.window_start_at, "SPY anchor window start");
    exactInstant(spyAnchor.valued_at, "SPY anchor valuation time");
    finitePositive(spyAnchor.open_price, "SPY anchor open price");
    if (spyAnchor.window_start_at !== WINDOW_START
      || Date.parse(spyAnchor.valued_at) !== Date.parse(WINDOW_START) + WINDOW_DURATION_MS) {
      throw new Error("SPY anchor does not match the first completed official 09:30 ET bar");
    }
    if (Date.parse(spyAnchor.valued_at) > observedAtMs) throw new Error("SPY anchor is in the future");
    if (spy.some(({ valued_at: valuedAt }) => Date.parse(valuedAt) < Date.parse(spyAnchor.valued_at))) {
      throw new Error("SPY series contains an incomplete anchor-minute valuation");
    }
  }

  const diagnostics = activityDiagnostics(normalizedActivities, activitiesComplete, normalizedCoverageThrough);
  const baseIntegrity = {
    activities_complete: activitiesComplete,
    activity_coverage_reaches_valuation: false,
    external_cashflows_zero: diagnostics.externalCashflowsZero,
    exact_common_valued_at: false,
    fee_included_in_equity_not_subtracted: true,
    claim_publishable: false,
  };
  if (!activitiesComplete) {
    return baseMeasurement(contract, normalizedObservedAt, normalizedCoverageThrough,
      "WITHHELD_ACTIVITIES_INCOMPLETE", "ACCOUNT_ACTIVITIES_NOT_COMPLETE", diagnostics.drivers, baseIntegrity);
  }
  if (!diagnostics.externalCashflowsZero) {
    return baseMeasurement(contract, normalizedObservedAt, normalizedCoverageThrough,
      "WITHHELD_EXTERNAL_CASHFLOW", diagnostics.withheldReason, diagnostics.drivers, baseIntegrity);
  }
  if (spyAnchor === null) {
    return baseMeasurement(contract, normalizedObservedAt, normalizedCoverageThrough,
      "UNOBSERVED", "SPY_ANCHOR_NOT_OBSERVED", diagnostics.drivers, baseIntegrity);
  }

  const accountByValuation = new Map(accounts.map((point) => [point.valued_at, point]));
  const commonValuations = spy.map(({ valued_at: valuedAt }) => valuedAt)
    .filter((valuedAt) => accountByValuation.has(valuedAt))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  if (commonValuations.length === 0) {
    return baseMeasurement(contract, normalizedObservedAt, normalizedCoverageThrough,
      "UNOBSERVED", "NO_EXACT_COMMON_COMPLETED_MINUTE", diagnostics.drivers, baseIntegrity);
  }

  const commonValuedAt = commonValuations[0];
  if (coverageThroughMs < Date.parse(commonValuedAt)) {
    return baseMeasurement(contract, normalizedObservedAt, normalizedCoverageThrough,
      "WITHHELD_ACTIVITIES_INCOMPLETE", "ACTIVITY_COVERAGE_PRECEDES_VALUATION", diagnostics.drivers, baseIntegrity);
  }
  const accountPoint = accountByValuation.get(commonValuedAt);
  const spyPoint = spy.find(({ valued_at: valuedAt }) => valuedAt === commonValuedAt);
  const netPnlRaw = accountPoint.equity - BASELINE_EQUITY;
  const strategyReturnRaw = accountPoint.equity / BASELINE_EQUITY - 1;
  const spyReturnRaw = spyPoint.price / spyAnchor.open_price - 1;
  const spyEndingValueRaw = BASELINE_EQUITY * (1 + spyReturnRaw);
  const excessReturnRaw = strategyReturnRaw - spyReturnRaw;
  const excessPnlRaw = accountPoint.equity - spyEndingValueRaw;

  const measurement = baseMeasurement(contract, normalizedObservedAt, normalizedCoverageThrough,
    "MEASURED", null, diagnostics.drivers, {
      ...baseIntegrity,
      activity_coverage_reaches_valuation: true,
      exact_common_valued_at: true,
      claim_publishable: true,
    });
  measurement.common_valued_at = commonValuedAt;
  measurement.primary_kpi = {
    aligned_broker_equity_dollars: round(accountPoint.equity, 2),
    net_pnl_dollars: round(netPnlRaw, 2),
    return_fraction: round(strategyReturnRaw, 12),
    profitable: round(netPnlRaw, 2) > 0,
  };
  measurement.benchmark = {
    label: contract.secondary_kpi.label,
    symbol: contract.benchmark.symbol,
    feed: contract.benchmark.feed,
    adjustment: contract.benchmark.adjustment,
    return_basis: contract.benchmark.return_basis,
    anchor_open_price: round(spyAnchor.open_price, 8),
    current_price: round(spyPoint.price, 8),
    return_fraction: round(spyReturnRaw, 12),
    ending_value_on_same_baseline_dollars: round(spyEndingValueRaw, 2),
  };
  measurement.secondary_kpi = {
    excess_return_fraction: round(excessReturnRaw, 12),
    excess_pnl_dollars: round(excessPnlRaw, 2),
    outperformed_spy: round(excessReturnRaw, 12) > 0,
  };
  measurement.measurement_hash = sha256(signedMeasurement(measurement));
  return measurement;
}
