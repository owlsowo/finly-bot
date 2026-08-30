export const CORE_SYMBOLS = Object.freeze([
  "SPY", "BIL", "QQQ", "IWM", "EFA", "EEM", "IEF", "TLT", "GLD", "DBC", "VNQ",
  "XLK", "XLF", "XLE", "XLY", "XLP", "XLI", "XLB", "XLV", "XLU",
]);

const SORTED_CORE_SYMBOLS = Object.freeze([...CORE_SYMBOLS].sort());
const CORE_SYMBOL_SET = new Set(CORE_SYMBOLS);
const QUANTITY_DECIMALS = 9;
const QUANTITY_SCALE = 10 ** QUANTITY_DECIMALS;
const MINIMUM_ORDER_NOTIONAL = 1;
const EQUITY_RECONCILIATION_TOLERANCE = 0.01;
const NUMERIC_EPSILON = 1e-9;
const MAX_INPUT_VALUE = 1e12;

const TOP_LEVEL_KEYS = new Set([
  "holdings",
  "cash",
  "prices",
  "target_weights",
  "asset_eligibility",
  "cost_model",
  "reported_equity",
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
}

function assertKnownKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new TypeError(`${label} contains unsupported field ${key}`);
  }
}

function assertExactCoreSymbols(value, label) {
  assertPlainObject(value, label);
  const keys = Object.keys(value).sort();
  if (
    keys.length !== SORTED_CORE_SYMBOLS.length
    || keys.some((key, index) => key !== SORTED_CORE_SYMBOLS[index])
  ) {
    throw new TypeError(`${label} must contain exactly the 20 allowlisted CORE_SYMBOLS`);
  }
}

function decimalPlaces(value) {
  const text = typeof value === "string" ? value : String(value);
  if (/[eE]/u.test(text)) return null;
  const point = text.indexOf(".");
  return point === -1 ? 0 : text.length - point - 1;
}

function finiteDecimal(value, label, {
  maximum = MAX_INPUT_VALUE,
  minimum = 0,
  maxDecimals = 12,
  acceptBinaryFloat = false,
} = {}) {
  let parsed;
  if (typeof value === "string") {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
      throw new TypeError(`${label} must be a canonical non-negative decimal`);
    }
    const places = decimalPlaces(value);
    if (places === null || places > maxDecimals) {
      throw new RangeError(`${label} supports at most ${maxDecimals} decimal places`);
    }
    parsed = Number(value);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    if (acceptBinaryFloat) {
      parsed = value;
    } else {
      const rounded = Number(value.toFixed(maxDecimals));
      const tolerance = Math.max(
        Number.EPSILON * Math.max(1, Math.abs(value)) * 4,
        10 ** -(maxDecimals + 6),
      );
      if (Math.abs(value - rounded) > tolerance) {
        throw new RangeError(`${label} supports at most ${maxDecimals} decimal places`);
      }
      parsed = rounded;
    }
  } else {
    throw new TypeError(`${label} must be a number or canonical decimal string`);
  }

  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be finite`);
  if (parsed < minimum || parsed > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function positiveDecimal(value, label, options = {}) {
  const parsed = finiteDecimal(value, label, options);
  if (parsed <= 0) throw new RangeError(`${label} must be greater than zero`);
  return parsed;
}

function round(value, decimals = 9) {
  if (!Number.isFinite(value)) throw new RangeError("calculation produced a non-finite number");
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function floorQuantity(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("quantity calculation must be finite and non-negative");
  }
  return Math.floor((value + Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE;
}

function quantityString(value) {
  return floorQuantity(value).toFixed(QUANTITY_DECIMALS);
}

function symbolMap(buildValue) {
  return Object.fromEntries(CORE_SYMBOLS.map((symbol) => [symbol, buildValue(symbol)]));
}

function normalizeEligibility(value) {
  if (value !== undefined) {
    assertPlainObject(value, "asset_eligibility");
    assertKnownKeys(value, CORE_SYMBOL_SET, "asset_eligibility");
  }

  return symbolMap((symbol) => {
    const supplied = value?.[symbol];
    if (supplied !== undefined) {
      assertPlainObject(supplied, `asset_eligibility.${symbol}`);
      assertKnownKeys(
        supplied,
        new Set(["tradable", "fractionable"]),
        `asset_eligibility.${symbol}`,
      );
      for (const field of ["tradable", "fractionable"]) {
        if (supplied[field] !== undefined && typeof supplied[field] !== "boolean") {
          throw new TypeError(`asset_eligibility.${symbol}.${field} must be boolean when supplied`);
        }
      }
    }
    const tradable = supplied?.tradable === true;
    const fractionable = supplied?.fractionable === true;
    return {
      tradable,
      fractionable,
      flags_present: supplied?.tradable !== undefined && supplied?.fractionable !== undefined,
      eligible_for_fractional_order: tradable && fractionable,
    };
  });
}

function normalizeCostModel(value) {
  if (value === undefined) {
    return { slippage_bps: 0, transaction_cost_bps: 0, regulatory_sell_fee_bps: 0 };
  }
  assertPlainObject(value, "cost_model");
  assertKnownKeys(
    value,
    new Set(["slippage_bps", "cost_bps", "transaction_cost_bps", "regulatory_sell_fee_bps"]),
    "cost_model",
  );
  if (value.cost_bps !== undefined && value.transaction_cost_bps !== undefined) {
    throw new TypeError("cost_model must not supply both cost_bps and transaction_cost_bps");
  }
  const slippageBps = finiteDecimal(
    value.slippage_bps ?? 0,
    "cost_model.slippage_bps",
    { maximum: 9_999.999999999 },
  );
  const transactionCostBps = finiteDecimal(
    value.transaction_cost_bps ?? value.cost_bps ?? 0,
    "cost_model.transaction_cost_bps",
    { maximum: 10_000 },
  );
  const regulatorySellFeeBps = finiteDecimal(
    value.regulatory_sell_fee_bps ?? 0,
    "cost_model.regulatory_sell_fee_bps",
    { maximum: 10_000 },
  );
  if (transactionCostBps + regulatorySellFeeBps > 10_000) {
    throw new RangeError("combined sell-side cost rates must not exceed 10000 bps");
  }
  return {
    slippage_bps: slippageBps,
    transaction_cost_bps: transactionCostBps,
    regulatory_sell_fee_bps: regulatorySellFeeBps,
  };
}

function normalizeInput(input) {
  assertPlainObject(input, "input");
  assertKnownKeys(input, TOP_LEVEL_KEYS, "input");
  assertExactCoreSymbols(input.holdings, "holdings");
  assertExactCoreSymbols(input.prices, "prices");
  assertExactCoreSymbols(input.target_weights, "target_weights");

  const holdings = symbolMap((symbol) => finiteDecimal(
    input.holdings[symbol],
    `holdings.${symbol}`,
    { maxDecimals: QUANTITY_DECIMALS },
  ));
  const prices = symbolMap((symbol) => positiveDecimal(
    input.prices[symbol],
    `prices.${symbol}`,
    { maxDecimals: 9 },
  ));
  const targetWeights = symbolMap((symbol) => finiteDecimal(
    input.target_weights[symbol],
    `target_weights.${symbol}`,
    { maximum: 1, maxDecimals: 18, acceptBinaryFloat: true },
  ));
  const weightTotal = CORE_SYMBOLS.reduce((total, symbol) => total + targetWeights[symbol], 0);
  if (Math.abs(weightTotal - 1) > 1e-10) {
    throw new RangeError("target_weights must sum to exactly 1 within 1e-10");
  }

  return {
    holdings,
    cash: finiteDecimal(input.cash, "cash", { maxDecimals: 9 }),
    prices,
    targetWeights,
    eligibility: normalizeEligibility(input.asset_eligibility),
    costs: normalizeCostModel(input.cost_model),
    reportedEquity: input.reported_equity === undefined
      ? null
      : finiteDecimal(input.reported_equity, "reported_equity", { maxDecimals: 9 }),
  };
}

function modeledOrder(symbol, side, quantity, referencePrice, costs) {
  const slippageRate = costs.slippage_bps / 10_000;
  const transactionCostRate = costs.transaction_cost_bps / 10_000;
  const regulatorySellFeeRate = costs.regulatory_sell_fee_bps / 10_000;
  const executionPrice = referencePrice * (side === "sell" ? 1 - slippageRate : 1 + slippageRate);
  const referenceNotional = quantity * referencePrice;
  const executionNotional = quantity * executionPrice;
  const transactionCost = executionNotional * transactionCostRate;
  const regulatorySellFee = side === "sell" ? executionNotional * regulatorySellFeeRate : 0;
  const cashEffect = side === "sell"
    ? executionNotional - transactionCost - regulatorySellFee
    : -(executionNotional + transactionCost);

  return {
    symbol,
    side,
    qty: quantityString(quantity),
    reference_price: round(referencePrice),
    reference_notional: round(referenceNotional),
    modeled_execution_price: round(executionPrice),
    modeled_execution_notional: round(executionNotional),
    modeled_slippage: round(Math.abs(executionNotional - referenceNotional)),
    modeled_transaction_cost: round(transactionCost),
    modeled_regulatory_sell_fee: round(regulatorySellFee),
    modeled_cash_effect: round(cashEffect),
    meets_one_dollar_minimum:
      Math.min(referenceNotional, executionNotional) + NUMERIC_EPSILON >= MINIMUM_ORDER_NOTIONAL,
  };
}

function eligibleMinimumOrder(symbol, side, desiredNotional, price, costs) {
  const quantity = floorQuantity(desiredNotional / price);
  if (quantity <= 0) return null;
  const order = modeledOrder(symbol, side, quantity, price, costs);
  return order.meets_one_dollar_minimum ? { quantity, order } : null;
}

function skippedDelta(symbol, side, reason, desired, planned = 0) {
  return {
    symbol,
    side,
    reason,
    desired_delta_notional: round(Math.abs(desired)),
    planned_reference_notional: round(Math.abs(planned)),
    residual_reference_notional: round(Math.max(0, Math.abs(desired) - Math.abs(planned))),
  };
}

function eligibilityReason(eligibility) {
  if (!eligibility.tradable && !eligibility.fractionable) return "asset_not_tradable_or_fractionable";
  if (!eligibility.tradable) return "asset_not_tradable";
  return "asset_not_fractionable";
}

function planOrders(normalized, desiredDeltas, blockReason) {
  const { cash, prices, eligibility, costs } = normalized;
  const requiredSymbols = CORE_SYMBOLS.filter(
    (symbol) => Math.abs(desiredDeltas[symbol]) > NUMERIC_EPSILON,
  );
  const ineligibleSymbols = requiredSymbols.filter(
    (symbol) => !eligibility[symbol].eligible_for_fractional_order,
  );
  const skipped = [];

  if (blockReason || ineligibleSymbols.length > 0) {
    for (const symbol of requiredSymbols) {
      const side = desiredDeltas[symbol] < 0 ? "sell" : "buy";
      let reason = blockReason;
      if (!reason && ineligibleSymbols.includes(symbol)) reason = eligibilityReason(eligibility[symbol]);
      if (!reason) reason = "fail_closed_rebalance_blocked";
      skipped.push(skippedDelta(symbol, side, reason, desiredDeltas[symbol]));
    }
    return {
      orders: [],
      skipped,
      blockStatus: blockReason === "account_equity_reconciliation_mismatch"
        ? "blocked_equity_reconciliation"
        : "blocked_asset_eligibility",
    };
  }

  const orderDrafts = [];
  const plannedReference = symbolMap(() => 0);
  let cashAvailable = cash;

  for (const symbol of CORE_SYMBOLS) {
    const delta = desiredDeltas[symbol];
    if (delta >= -NUMERIC_EPSILON) continue;
    const candidate = eligibleMinimumOrder(symbol, "sell", -delta, prices[symbol], costs);
    if (!candidate) {
      skipped.push(skippedDelta(symbol, "sell", "below_one_dollar_minimum", delta));
      continue;
    }
    orderDrafts.push(candidate.order);
    plannedReference[symbol] = -candidate.order.reference_notional;
    cashAvailable += candidate.order.modeled_cash_effect;
  }

  const buyCandidates = [];
  for (const symbol of CORE_SYMBOLS) {
    const delta = desiredDeltas[symbol];
    if (delta <= NUMERIC_EPSILON) continue;
    const candidate = eligibleMinimumOrder(symbol, "buy", delta, prices[symbol], costs);
    if (!candidate) {
      skipped.push(skippedDelta(symbol, "buy", "below_one_dollar_minimum", delta));
      continue;
    }
    buyCandidates.push({
      symbol,
      desired: delta,
      fullQuantity: candidate.quantity,
      fullOrder: candidate.order,
    });
  }

  let activeBuyCandidates = buyCandidates;
  let buyScale = 1;
  while (activeBuyCandidates.length > 0) {
    const fullDebit = activeBuyCandidates.reduce(
      (total, candidate) => total - candidate.fullOrder.modeled_cash_effect,
      0,
    );
    buyScale = fullDebit > 0 ? Math.min(1, Math.max(0, cashAvailable) / fullDebit) : 0;
    const tooSmall = activeBuyCandidates.filter((candidate) => {
      const quantity = floorQuantity(candidate.fullQuantity * buyScale);
      if (quantity <= 0) return true;
      return !modeledOrder(
        candidate.symbol,
        "buy",
        quantity,
        prices[candidate.symbol],
        costs,
      ).meets_one_dollar_minimum;
    });
    if (tooSmall.length === 0) break;
    for (const candidate of tooSmall) {
      skipped.push(skippedDelta(
        candidate.symbol,
        "buy",
        buyScale < 1
          ? "below_one_dollar_minimum_after_buy_budget_scaling"
          : "below_one_dollar_minimum",
        candidate.desired,
      ));
    }
    const tooSmallSymbols = new Set(tooSmall.map((candidate) => candidate.symbol));
    activeBuyCandidates = activeBuyCandidates.filter(
      (candidate) => !tooSmallSymbols.has(candidate.symbol),
    );
  }

  for (const candidate of activeBuyCandidates) {
    const unitDebit = prices[candidate.symbol]
      * (1 + costs.slippage_bps / 10_000)
      * (1 + costs.transaction_cost_bps / 10_000);
    const scaledQuantity = floorQuantity(candidate.fullQuantity * buyScale);
    const affordableQuantity = floorQuantity(Math.max(0, cashAvailable) / unitDebit);
    let quantity = Math.min(scaledQuantity, affordableQuantity);
    if (quantity <= 0) {
      skipped.push(skippedDelta(
        candidate.symbol,
        "buy",
        "self_financing_buy_budget_limit",
        candidate.desired,
      ));
      continue;
    }
    let order = modeledOrder(candidate.symbol, "buy", quantity, prices[candidate.symbol], costs);
    if (-order.modeled_cash_effect > cashAvailable + NUMERIC_EPSILON) {
      quantity = floorQuantity(quantity - 1 / QUANTITY_SCALE);
      if (quantity > 0) {
        order = modeledOrder(candidate.symbol, "buy", quantity, prices[candidate.symbol], costs);
      }
    }
    if (
      quantity <= 0
      || !order.meets_one_dollar_minimum
      || -order.modeled_cash_effect > cashAvailable + NUMERIC_EPSILON
    ) {
      skipped.push(skippedDelta(
        candidate.symbol,
        "buy",
        "self_financing_buy_budget_limit",
        candidate.desired,
      ));
      continue;
    }
    orderDrafts.push(order);
    plannedReference[candidate.symbol] = order.reference_notional;
    cashAvailable += order.modeled_cash_effect;
  }

  for (const symbol of CORE_SYMBOLS) {
    const desired = desiredDeltas[symbol];
    const planned = plannedReference[symbol];
    if (Math.abs(desired) <= NUMERIC_EPSILON || Math.abs(planned) <= NUMERIC_EPSILON) continue;
    const residual = Math.abs(desired) - Math.abs(planned);
    if (residual <= NUMERIC_EPSILON) continue;
    if (skipped.some((item) => item.symbol === symbol)) continue;
    const side = desired < 0 ? "sell" : "buy";
    skipped.push(skippedDelta(
      symbol,
      side,
      side === "buy" && buyScale < 1
        ? "self_financing_buy_budget_limit"
        : "nine_decimal_quantity_residual",
      desired,
      planned,
    ));
  }

  return {
    orders: orderDrafts.map((order, index) => ({ sequence: index + 1, ...order })),
    skipped,
    blockStatus: null,
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

export function buildMultiAssetShadowExecution(input) {
  const normalized = normalizeInput(input);
  const {
    holdings,
    cash,
    prices,
    targetWeights,
    eligibility,
    costs,
    reportedEquity,
  } = normalized;
  const positionValuesBefore = symbolMap((symbol) => holdings[symbol] * prices[symbol]);
  const calculatedEquityBefore = cash + CORE_SYMBOLS.reduce(
    (total, symbol) => total + positionValuesBefore[symbol],
    0,
  );
  if (
    !Number.isFinite(calculatedEquityBefore)
    || calculatedEquityBefore <= 0
    || calculatedEquityBefore > MAX_INPUT_VALUE
  ) {
    throw new RangeError(`calculated equity must be greater than zero and no more than ${MAX_INPUT_VALUE}`);
  }

  const reconciliationDifference = reportedEquity === null
    ? null
    : reportedEquity - calculatedEquityBefore;
  const reconciliationMatched = reportedEquity === null
    ? null
    : Math.abs(reconciliationDifference) <= EQUITY_RECONCILIATION_TOLERANCE + NUMERIC_EPSILON;
  const reconciliationStatus = reportedEquity === null
    ? "calculated_only"
    : reconciliationMatched ? "matched" : "mismatch";
  const targetValues = symbolMap((symbol) => calculatedEquityBefore * targetWeights[symbol]);
  const desiredDeltas = symbolMap((symbol) => targetValues[symbol] - positionValuesBefore[symbol]);
  const blockReason = reconciliationMatched === false
    ? "account_equity_reconciliation_mismatch"
    : null;
  const planned = planOrders(normalized, desiredDeltas, blockReason);

  const holdingsAfter = { ...holdings };
  let cashAfter = cash;
  for (const order of planned.orders) {
    const quantity = Number(order.qty);
    holdingsAfter[order.symbol] += order.side === "sell" ? -quantity : quantity;
    cashAfter += order.modeled_cash_effect;
  }
  if (CORE_SYMBOLS.some((symbol) => holdingsAfter[symbol] < -NUMERIC_EPSILON)) {
    throw new RangeError("modeled plan would create a short position");
  }
  if (cashAfter < -NUMERIC_EPSILON) throw new RangeError("modeled plan is not self-financing");
  if (cashAfter < 0) cashAfter = 0;

  const positionValuesAfter = symbolMap((symbol) => holdingsAfter[symbol] * prices[symbol]);
  const calculatedEquityAfter = cashAfter + CORE_SYMBOLS.reduce(
    (total, symbol) => total + positionValuesAfter[symbol],
    0,
  );
  const positionWeightsBefore = symbolMap(
    (symbol) => positionValuesBefore[symbol] / calculatedEquityBefore,
  );
  const positionWeightsAfter = symbolMap(
    (symbol) => calculatedEquityAfter > 0 ? positionValuesAfter[symbol] / calculatedEquityAfter : 0,
  );

  const sellOrders = planned.orders.filter((order) => order.side === "sell");
  const buyOrders = planned.orders.filter((order) => order.side === "buy");
  const sum = (orders, field) => orders.reduce((total, order) => total + order[field], 0);
  const netSellProceeds = sellOrders.reduce(
    (total, order) => total + order.modeled_cash_effect,
    0,
  );
  const totalBuyCashRequired = buyOrders.reduce(
    (total, order) => total - order.modeled_cash_effect,
    0,
  );

  let status = planned.blockStatus;
  if (!status && planned.orders.length === 0) {
    status = CORE_SYMBOLS.every(
      (symbol) => Math.abs(desiredDeltas[symbol]) <= NUMERIC_EPSILON,
    ) ? "no_trade" : "no_executable_orders";
  }
  if (!status && planned.skipped.length > 0) status = "ready_with_residual_drift";
  if (!status) status = "ready";

  const result = {
    schema_version: "multi_asset_shadow_execution.v1",
    preview_only: true,
    broker_mutation_authorized: false,
    deterministic: true,
    universe: [...CORE_SYMBOLS],
    constraints: {
      long_only: true,
      sell_before_buy: true,
      self_financing_required: true,
      target_weights_sum_to_one: true,
      target_weight_sum_tolerance: 1e-10,
      minimum_order_notional: MINIMUM_ORDER_NOTIONAL,
      quantity_decimal_places: QUANTITY_DECIMALS,
      fractional_shares: true,
    },
    status,
    asset_eligibility: eligibility,
    cost_model: {
      slippage_bps: round(costs.slippage_bps),
      transaction_cost_bps: round(costs.transaction_cost_bps),
      regulatory_sell_fee_bps: round(costs.regulatory_sell_fee_bps),
    },
    portfolio: {
      valuation_basis: "cash_plus_sum_of_quantity_times_reference_price",
      holdings_before: symbolMap((symbol) => quantityString(holdings[symbol])),
      reference_prices: symbolMap((symbol) => round(prices[symbol])),
      cash_before: round(cash),
      position_market_values_before: symbolMap((symbol) => round(positionValuesBefore[symbol])),
      equity_before: round(calculatedEquityBefore),
      reported_equity: reportedEquity === null ? null : round(reportedEquity),
      reconciliation: {
        tolerance_dollars: EQUITY_RECONCILIATION_TOLERANCE,
        status: reconciliationStatus,
        reported_minus_calculated: reconciliationDifference === null
          ? null
          : round(reconciliationDifference),
      },
      holdings_after_preview: symbolMap((symbol) => quantityString(holdingsAfter[symbol])),
      cash_after_preview: round(cashAfter),
      residual_cash: round(cashAfter),
      position_market_values_after_preview: symbolMap((symbol) => round(positionValuesAfter[symbol])),
      equity_after_preview: round(calculatedEquityAfter),
      modeled_equity_reduction: round(calculatedEquityBefore - calculatedEquityAfter),
    },
    allocation: {
      target_weights: symbolMap((symbol) => round(targetWeights[symbol], 12)),
      target_market_values_before_costs: symbolMap((symbol) => round(targetValues[symbol])),
      position_weights_before: symbolMap((symbol) => round(positionWeightsBefore[symbol], 12)),
      position_weights_after_preview: symbolMap((symbol) => round(positionWeightsAfter[symbol], 12)),
      target_minus_position_notional_before: symbolMap((symbol) => round(desiredDeltas[symbol])),
      target_minus_position_notional_after_preview: symbolMap(
        (symbol) => round(targetValues[symbol] - positionValuesAfter[symbol]),
      ),
    },
    funding: {
      opening_cash: round(cash),
      gross_reference_sell_notional: round(sum(sellOrders, "reference_notional")),
      modeled_sell_execution_notional: round(sum(sellOrders, "modeled_execution_notional")),
      modeled_sell_slippage: round(sum(sellOrders, "modeled_slippage")),
      modeled_sell_transaction_cost: round(sum(sellOrders, "modeled_transaction_cost")),
      modeled_regulatory_sell_fee: round(sum(sellOrders, "modeled_regulatory_sell_fee")),
      net_sell_proceeds: round(netSellProceeds),
      buy_budget_after_sells: round(cash + netSellProceeds),
      gross_reference_buy_notional: round(sum(buyOrders, "reference_notional")),
      modeled_buy_execution_notional: round(sum(buyOrders, "modeled_execution_notional")),
      modeled_buy_slippage: round(sum(buyOrders, "modeled_slippage")),
      modeled_buy_transaction_cost: round(sum(buyOrders, "modeled_transaction_cost")),
      total_buy_cash_required: round(totalBuyCashRequired),
      residual_cash: round(cashAfter),
      self_financing:
        cashAfter >= 0
        && totalBuyCashRequired <= cash + netSellProceeds + NUMERIC_EPSILON,
    },
    order_plan: {
      preview_only: true,
      broker_mutation_authorized: false,
      status,
      orders: planned.orders,
      skipped_deltas: planned.skipped,
    },
  };

  return deepFreeze(result);
}

export function canonicalMultiAssetShadowExecutionJson(preview) {
  assertPlainObject(preview, "preview");
  if (
    preview.schema_version !== "multi_asset_shadow_execution.v1"
    || preview.preview_only !== true
    || preview.broker_mutation_authorized !== false
  ) {
    throw new TypeError("preview must be a non-authorizing multi_asset_shadow_execution.v1 result");
  }
  return stableStringify(preview);
}
