import { sha256, stableStringify } from "./canonical.mjs";

const CONTRACT_SCHEMA = "finly_forward_profit_kpi_contract.v1";
const CONTRACT_ID = "official-paper-forward-profit-2026-08-31";
const EXPECTED_CONTRACT_HASH = "sha256:46fa39ef0ce2887f42d6def1d282c287a3b1c3dd790cca46b3719381c89470b6";
const MEASUREMENT_SCHEMA = "finly_forward_profit_measurement.v1";
const WINDOW_START = "2026-08-31T13:30:00.000Z";
const WINDOW_END = "2026-09-04T13:30:00.000Z";
const BASELINE_EQUITY = 100_000;
const WINDOW_DURATION_MS = 60_000;
const ACTIVITY_KINDS = new Set(["ENDOGENOUS", "EXTERNAL_CASHFLOW", "FEE", "FILL", "UNKNOWN"]);
const ACTIVITY_TIME_BASES = new Set(["EXECUTION", "PUBLICATION"]);
const ACTIVITY_COMPLETENESS_KEYS = [
  "all_rows_classified", "bounded_snapshot_stable", "economic_activity_final", "pagination_exhausted",
];

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
    "activity_baseline", "authority", "benchmark", "competition_window", "contract_hash", "contract_id",
    "drivers", "frozen_at", "guardrails", "primary_kpi", "production_protocol", "schema_version",
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
  validateExactValues(contract.activity_baseline, {
    path: "config/competition-forward-profit-activity-baseline.json",
    baseline_id: "official-paper-activity-baseline-2026-08-31",
    baseline_hash: "sha256:dce15186c496175504b3a68e019c03e829a44132236c0c289917138306be1876",
  }, "Forward-profit activity-baseline binding");
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
    session_scope: "official_regular_market_hours_only",
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
    activity_completeness_basis: "pagination_exhausted_and_stable_bounded_snapshot_not_final_economic_settlement",
    external_activity_must_be_absent: true,
    external_cashflow_activity_types: [
      "ACATC", "ACATS", "CSD", "CSW", "FOPT", "JNL", "JNLC", "JNLS", "OCT", "TRANS",
    ],
    endogenous_activity_types: [
      "CFEE", "CGD", "DIV", "DIVCGL", "DIVCGS", "DIVFEE", "DIVFT", "DIVNRA", "DIVROC",
      "DIVTW", "DIVTXEX", "FEE", "FILL", "INT", "INTNRA", "INTTW", "MA", "NC", "OPASN",
      "OPCA", "OPCSH", "OPEXC", "OPEXP", "OPXRC", "OPTRD", "PTC", "PTR", "REO", "REORG",
      "SC", "SPIN", "SPLIT", "SSO", "SSP",
    ],
    unknown_activity_rule: "withhold",
    pre_window_activity_rule: "reject_any_nonbaseline_activity",
    pre_window_order_guard: "latest_all_order_before_window_must_precede_baseline_capture",
    fill_order_provenance_rule: "deterministic_g4_or_finly_options_namespace_and_shape_get_by_id_no_replacements",
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
    exactKeys(activity, ["effective_date", "event_at", "kind", "net_amount", "time_basis"], `Activity ${index + 1}`);
    const eventAt = exactInstant(activity.event_at, `Activity ${index + 1} time`);
    const eventAtMs = Date.parse(eventAt);
    if (eventAtMs > observedAtMs) throw new Error(`Activity ${index + 1} is in the future`);
    if (eventAtMs > coverageThroughMs) throw new Error(`Activity ${index + 1} exceeds declared activity coverage`);
    if (!ACTIVITY_KINDS.has(activity.kind)) throw new Error(`Activity ${index + 1} kind is invalid`);
    if (!ACTIVITY_TIME_BASES.has(activity.time_basis)) throw new Error(`Activity ${index + 1} time basis is invalid`);
    if (activity.time_basis === "EXECUTION") {
      if (activity.kind !== "FILL" || activity.effective_date !== null
        || eventAtMs < Date.parse(WINDOW_START) || eventAtMs >= Date.parse(WINDOW_END)) {
        throw new Error(`Activity ${index + 1} execution semantics are invalid`);
      }
    } else {
      if (activity.kind === "FILL" || typeof activity.effective_date !== "string"
        || !/^\d{4}-\d{2}-\d{2}$/u.test(activity.effective_date)) {
        throw new Error(`Activity ${index + 1} publication semantics are invalid`);
      }
      const effectiveAt = new Date(`${activity.effective_date}T00:00:00.000Z`);
      if (!Number.isFinite(effectiveAt.getTime()) || effectiveAt.toISOString().slice(0, 10) !== activity.effective_date
        || (activity.kind === "ENDOGENOUS"
          && (activity.effective_date < WINDOW_START.slice(0, 10)
            || activity.effective_date > WINDOW_END.slice(0, 10)))) {
        throw new Error(`Activity ${index + 1} effective date is outside the competition dates`);
      }
    }
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

function validateActivityCompleteness(value) {
  exactKeys(value, ACTIVITY_COMPLETENESS_KEYS, "Activity completeness");
  for (const key of ACTIVITY_COMPLETENESS_KEYS) {
    if (typeof value[key] !== "boolean") throw new Error(`Activity completeness ${key} is invalid`);
  }
  if (value.bounded_snapshot_stable && !value.pagination_exhausted) {
    throw new Error("Stable activity snapshot requires exhausted pagination");
  }
  return structuredClone(value);
}

function emptyDrivers(activityCoverageThrough, economicActivityFinal) {
  return {
    fill_event_count: null,
    broker_reported_fee_paid_dollars: null,
    broker_reported_fee_rebate_dollars: null,
    broker_reported_fee_net_effect_dollars: null,
    external_cashflow_event_count: null,
    external_cashflow_gross_absolute_dollars: null,
    external_cashflow_net_dollars: null,
    activity_coverage_through: activityCoverageThrough,
    fee_settlement_status: economicActivityFinal
      ? "final_as_of_post_window_activity_audit"
      : "provisional_as_of_activity_publication_coverage",
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

function activityDiagnostics(activities, activityCompleteness, activityCoverageThrough) {
  const activitiesComplete = activityCompleteness.pagination_exhausted
    && activityCompleteness.bounded_snapshot_stable
    && activityCompleteness.all_rows_classified;
  if (!activitiesComplete) {
    return {
      drivers: emptyDrivers(activityCoverageThrough, activityCompleteness.economic_activity_final),
      externalCashflowsZero: null,
      withheldReason: null,
    };
  }
  const fills = activities.filter(({ kind }) => kind === "FILL");
  const fees = activities.filter(({ kind }) => kind === "FEE");
  const external = activities.filter(({ kind }) => kind === "EXTERNAL_CASHFLOW");
  const hasUnknown = activities.some(({ kind }) => kind === "UNKNOWN");
  const unknownExternalAmount = external.some(({ net_amount: netAmount }) => netAmount === null);
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
      fee_settlement_status: activityCompleteness.economic_activity_final
        ? "final_as_of_post_window_activity_audit"
        : "provisional_as_of_activity_publication_coverage",
    },
    externalCashflowsZero: !hasUnknown && external.length === 0,
    withheldReason: hasUnknown
      ? "UNKNOWN_ACTIVITY_CLASSIFICATION"
      : external.length > 0 ? "EXTERNAL_ACTIVITY_PRESENT" : null,
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
  activityCompleteness,
}) {
  assertCompetitionForwardProfitContract(contract);
  const normalizedObservedAt = exactInstant(observedAt, "Forward-profit observation time");
  const observedAtMs = Date.parse(normalizedObservedAt);
  const normalizedCoverageThrough = exactInstant(activityCoverageThrough, "Activity coverage time");
  const coverageThroughMs = Date.parse(normalizedCoverageThrough);
  if (coverageThroughMs > observedAtMs) throw new Error("Activity coverage time is in the future");
  const normalizedCompleteness = validateActivityCompleteness(activityCompleteness);
  if (normalizedCompleteness.economic_activity_final
    && (observedAtMs < Date.parse(WINDOW_END) || coverageThroughMs < Date.parse(WINDOW_END)
      || !normalizedCompleteness.pagination_exhausted
      || !normalizedCompleteness.bounded_snapshot_stable
      || !normalizedCompleteness.all_rows_classified)) {
    throw new Error("Final economic activity status requires a complete post-window audit");
  }
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

  const activitiesComplete = normalizedCompleteness.pagination_exhausted
    && normalizedCompleteness.bounded_snapshot_stable
    && normalizedCompleteness.all_rows_classified;
  const diagnostics = activityDiagnostics(normalizedActivities, normalizedCompleteness, normalizedCoverageThrough);
  const baseIntegrity = {
    activities_complete: activitiesComplete,
    activities_pagination_exhausted: normalizedCompleteness.pagination_exhausted,
    activities_bounded_snapshot_stable: normalizedCompleteness.bounded_snapshot_stable,
    activities_all_rows_classified: normalizedCompleteness.all_rows_classified,
    economic_activity_final: normalizedCompleteness.economic_activity_final,
    activity_coverage_reaches_valuation: false,
    external_cashflows_zero: diagnostics.externalCashflowsZero,
    exact_common_valued_at: false,
    fee_included_in_equity_not_subtracted: true,
    claim_publishable: false,
  };
  if (!activitiesComplete) {
    return baseMeasurement(contract, normalizedObservedAt, normalizedCoverageThrough,
      "WITHHELD_ACTIVITIES_INCOMPLETE",
      normalizedCompleteness.all_rows_classified
        ? "ACCOUNT_ACTIVITIES_NOT_COMPLETE"
        : "ACCOUNT_ACTIVITY_CLASSIFICATION_INCOMPLETE",
      diagnostics.drivers,
      baseIntegrity);
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
