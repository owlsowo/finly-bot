const SYMBOLS = Object.freeze(["SPY", "BIL"]);
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
  "theoretical_adjusted_total_return",
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

function assertExactSymbols(value, label) {
  assertPlainObject(value, label);
  const keys = Object.keys(value).sort();
  if (keys.length !== SYMBOLS.length || keys.some((key, index) => key !== [...SYMBOLS].sort()[index])) {
    throw new TypeError(`${label} must contain exactly SPY and BIL`);
  }
}

function decimalPlaces(value) {
  const text = typeof value === "string" ? value : String(value);
  if (/[eE]/u.test(text)) return null;
  const point = text.indexOf(".");
  return point === -1 ? 0 : text.length - point - 1;
}

function finiteDecimal(value, label, { maximum = MAX_INPUT_VALUE, minimum = 0, maxDecimals = 12 } = {}) {
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
  } else if (typeof value !== "number") {
    throw new TypeError(`${label} must be a number or canonical decimal string`);
  } else {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    const rounded = Number(value.toFixed(maxDecimals));
    const floatingPointTolerance = Math.max(
      Number.EPSILON * Math.max(1, Math.abs(value)) * 4,
      10 ** -(maxDecimals + 6),
    );
    if (Math.abs(value - rounded) > floatingPointTolerance) {
      throw new RangeError(`${label} supports at most ${maxDecimals} decimal places`);
    }
    parsed = rounded;
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
  if (!Number.isFinite(value) || value < 0) throw new RangeError("quantity calculation must be finite and non-negative");
  return Math.floor((value + Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE;
}

function quantityString(value) {
  return floorQuantity(value).toFixed(QUANTITY_DECIMALS);
}

function normalizeTheory(value, label = "theoretical_adjusted_total_return", depth = 0) {
  if (depth > 8) throw new RangeError(`${label} exceeds the maximum nesting depth`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalizeTheory(item, `${label}[${index}]`, depth + 1));
  if (!isPlainObject(value)) throw new TypeError(`${label} must contain only JSON-safe values`);

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw new TypeError(`${label} contains an unsafe field`);
    }
    normalized[key] = normalizeTheory(value[key], `${label}.${key}`, depth + 1);
  }
  return normalized;
}

function normalizeEligibility(value) {
  if (value !== undefined) {
    assertPlainObject(value, "asset_eligibility");
    assertKnownKeys(value, new Set(SYMBOLS), "asset_eligibility");
  }

  return Object.fromEntries(SYMBOLS.map((symbol) => {
    const supplied = value?.[symbol];
    if (supplied !== undefined) {
      assertPlainObject(supplied, `asset_eligibility.${symbol}`);
      assertKnownKeys(supplied, new Set(["tradable", "fractionable"]), `asset_eligibility.${symbol}`);
      for (const field of ["tradable", "fractionable"]) {
        if (supplied[field] !== undefined && typeof supplied[field] !== "boolean") {
          throw new TypeError(`asset_eligibility.${symbol}.${field} must be boolean when supplied`);
        }
      }
    }
    const tradable = supplied?.tradable === true;
    const fractionable = supplied?.fractionable === true;
    return [symbol, {
      tradable,
      fractionable,
      flags_present: supplied?.tradable !== undefined && supplied?.fractionable !== undefined,
      eligible_for_fractional_order: tradable && fractionable,
    }];
  }));
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
  const slippageBps = finiteDecimal(value.slippage_bps ?? 0, "cost_model.slippage_bps", { maximum: 9_999.999999999 });
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
  return {
    slippage_bps: slippageBps,
    transaction_cost_bps: transactionCostBps,
    regulatory_sell_fee_bps: regulatorySellFeeBps,
  };
}

function normalizeInput(input) {
  assertPlainObject(input, "input");
  assertKnownKeys(input, TOP_LEVEL_KEYS, "input");
  assertExactSymbols(input.holdings, "holdings");
  assertExactSymbols(input.prices, "prices");
  assertExactSymbols(input.target_weights, "target_weights");

  const holdings = Object.fromEntries(SYMBOLS.map((symbol) => [
    symbol,
    finiteDecimal(input.holdings[symbol], `holdings.${symbol}`, { maxDecimals: QUANTITY_DECIMALS }),
  ]));
  const prices = Object.fromEntries(SYMBOLS.map((symbol) => [
    symbol,
    positiveDecimal(input.prices[symbol], `prices.${symbol}`, { maxDecimals: 9 }),
  ]));
  const weights = Object.fromEntries(SYMBOLS.map((symbol) => [
    symbol,
    finiteDecimal(input.target_weights[symbol], `target_weights.${symbol}`, { maximum: 1, maxDecimals: 12 }),
  ]));
  const weightTotal = weights.SPY + weights.BIL;
  if (Math.abs(weightTotal - 1) > 1e-12) throw new RangeError("target_weights must sum to exactly 1 within 1e-12");

  const cash = finiteDecimal(input.cash, "cash", { maxDecimals: 9 });
  const reportedEquity = input.reported_equity === undefined
    ? null
    : finiteDecimal(input.reported_equity, "reported_equity", { maxDecimals: 9 });
  const theory = input.theoretical_adjusted_total_return === undefined
    ? null
    : normalizeTheory(input.theoretical_adjusted_total_return);

  return {
    holdings,
    cash,
    prices,
    weights,
    eligibility: normalizeEligibility(input.asset_eligibility),
    costs: normalizeCostModel(input.cost_model),
    reportedEquity,
    theory,
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
    meets_one_dollar_minimum: Math.min(referenceNotional, executionNotional) + NUMERIC_EPSILON >= MINIMUM_ORDER_NOTIONAL,
  };
}

function eligibleMinimumOrder(symbol, side, desiredNotional, price, costs) {
  const quantity = floorQuantity(desiredNotional / price);
  if (quantity <= 0) return null;
  const order = modeledOrder(symbol, side, quantity, price, costs);
  return order.meets_one_dollar_minimum ? { quantity, order } : null;
}

function skipRow(symbol, side, reason, desired, planned = 0) {
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
  const requiredSymbols = SYMBOLS.filter((symbol) => Math.abs(desiredDeltas[symbol]) > NUMERIC_EPSILON);
  const ineligibleSymbols = requiredSymbols.filter((symbol) => !eligibility[symbol].eligible_for_fractional_order);
  const skipped = [];

  if (blockReason || ineligibleSymbols.length > 0) {
    for (const symbol of requiredSymbols) {
      const side = desiredDeltas[symbol] < 0 ? "sell" : "buy";
      let reason = blockReason;
      if (!reason && ineligibleSymbols.includes(symbol)) reason = eligibilityReason(eligibility[symbol]);
      if (!reason) reason = "fail_closed_rebalance_blocked";
      skipped.push(skipRow(symbol, side, reason, desiredDeltas[symbol]));
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
  const plannedReference = { SPY: 0, BIL: 0 };
  let cashAvailable = cash;

  for (const symbol of SYMBOLS) {
    const delta = desiredDeltas[symbol];
    if (delta >= -NUMERIC_EPSILON) continue;
    const candidate = eligibleMinimumOrder(symbol, "sell", -delta, prices[symbol], costs);
    if (!candidate) {
      skipped.push(skipRow(symbol, "sell", "below_one_dollar_minimum", delta));
      continue;
    }
    orderDrafts.push(candidate.order);
    plannedReference[symbol] = -candidate.order.reference_notional;
    cashAvailable += candidate.order.modeled_cash_effect;
  }

  const buyCandidates = [];
  for (const symbol of SYMBOLS) {
    const delta = desiredDeltas[symbol];
    if (delta <= NUMERIC_EPSILON) continue;
    const candidate = eligibleMinimumOrder(symbol, "buy", delta, prices[symbol], costs);
    if (!candidate) {
      skipped.push(skipRow(symbol, "buy", "below_one_dollar_minimum", delta));
      continue;
    }
    buyCandidates.push({ symbol, desired: delta, fullQuantity: candidate.quantity, fullOrder: candidate.order });
  }

  let activeBuyCandidates = buyCandidates;
  let buyScale = 1;
  while (activeBuyCandidates.length > 0) {
    const fullDebit = activeBuyCandidates.reduce((total, candidate) => total - candidate.fullOrder.modeled_cash_effect, 0);
    buyScale = fullDebit > 0 ? Math.min(1, Math.max(0, cashAvailable) / fullDebit) : 0;
    const tooSmall = activeBuyCandidates.filter((candidate) => {
      const quantity = floorQuantity(candidate.fullQuantity * buyScale);
      if (quantity <= 0) return true;
      return !modeledOrder(candidate.symbol, "buy", quantity, prices[candidate.symbol], costs).meets_one_dollar_minimum;
    });
    if (tooSmall.length === 0) break;
    for (const candidate of tooSmall) {
      skipped.push(skipRow(
        candidate.symbol,
        "buy",
        buyScale < 1 ? "below_one_dollar_minimum_after_buy_budget_scaling" : "below_one_dollar_minimum",
        candidate.desired,
      ));
    }
    const tooSmallSymbols = new Set(tooSmall.map((candidate) => candidate.symbol));
    activeBuyCandidates = activeBuyCandidates.filter((candidate) => !tooSmallSymbols.has(candidate.symbol));
  }

  for (const candidate of activeBuyCandidates) {
    let quantity = floorQuantity(candidate.fullQuantity * buyScale);
    let order = modeledOrder(candidate.symbol, "buy", quantity, prices[candidate.symbol], costs);
    if (-order.modeled_cash_effect > cashAvailable + NUMERIC_EPSILON) {
      quantity = floorQuantity(quantity - 1 / QUANTITY_SCALE);
      if (quantity <= 0) {
        skipped.push(skipRow(candidate.symbol, "buy", "self_financing_buy_budget_limit", candidate.desired));
        continue;
      }
      order = modeledOrder(candidate.symbol, "buy", quantity, prices[candidate.symbol], costs);
    }
    if (!order.meets_one_dollar_minimum || -order.modeled_cash_effect > cashAvailable + NUMERIC_EPSILON) {
      skipped.push(skipRow(candidate.symbol, "buy", "self_financing_buy_budget_limit", candidate.desired));
      continue;
    }
    orderDrafts.push(order);
    plannedReference[candidate.symbol] = order.reference_notional;
    cashAvailable += order.modeled_cash_effect;
  }

  for (const symbol of SYMBOLS) {
    const desired = desiredDeltas[symbol];
    const planned = plannedReference[symbol];
    if (Math.abs(desired) <= NUMERIC_EPSILON || Math.abs(planned) <= NUMERIC_EPSILON) continue;
    const residual = Math.abs(desired) - Math.abs(planned);
    if (residual <= NUMERIC_EPSILON) continue;
    const alreadySkipped = skipped.some((item) => item.symbol === symbol);
    if (alreadySkipped) continue;
    const side = desired < 0 ? "sell" : "buy";
    const reason = side === "buy" && buyScale < 1
      ? "self_financing_buy_budget_limit"
      : "nine_decimal_quantity_residual";
    skipped.push(skipRow(symbol, side, reason, desired, planned));
  }

  const orders = orderDrafts.map((order, index) => ({ sequence: index + 1, ...order }));
  return { orders, skipped, blockStatus: null };
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

export function buildEquityShadowExecution(input) {
  const normalized = normalizeInput(input);
  const { holdings, cash, prices, weights, eligibility, costs, reportedEquity, theory } = normalized;
  const positionValuesBefore = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, holdings[symbol] * prices[symbol]]));
  const calculatedEquityBefore = cash + positionValuesBefore.SPY + positionValuesBefore.BIL;
  if (!Number.isFinite(calculatedEquityBefore) || calculatedEquityBefore <= 0 || calculatedEquityBefore > MAX_INPUT_VALUE) {
    throw new RangeError(`calculated broker equity must be greater than zero and no more than ${MAX_INPUT_VALUE}`);
  }

  const reconciliationDifference = reportedEquity === null ? null : reportedEquity - calculatedEquityBefore;
  const reconciliationMatched = reportedEquity === null
    ? null
    : Math.abs(reconciliationDifference) <= EQUITY_RECONCILIATION_TOLERANCE + NUMERIC_EPSILON;
  const reconciliationStatus = reportedEquity === null
    ? "calculated_only"
    : reconciliationMatched ? "matched" : "mismatch";
  const targetValues = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, calculatedEquityBefore * weights[symbol]]));
  const desiredDeltas = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, targetValues[symbol] - positionValuesBefore[symbol]]));
  const blockReason = reconciliationMatched === false ? "account_equity_reconciliation_mismatch" : null;
  const planned = planOrders(normalized, desiredDeltas, blockReason);

  const holdingsAfter = { ...holdings };
  let cashAfter = cash;
  for (const order of planned.orders) {
    const quantity = Number(order.qty);
    holdingsAfter[order.symbol] += order.side === "sell" ? -quantity : quantity;
    cashAfter += order.modeled_cash_effect;
  }
  if (cashAfter < -NUMERIC_EPSILON) throw new RangeError("modeled plan is not self-financing");
  if (cashAfter < 0) cashAfter = 0;

  const positionValuesAfter = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, holdingsAfter[symbol] * prices[symbol]]));
  const calculatedEquityAfter = cashAfter + positionValuesAfter.SPY + positionValuesAfter.BIL;
  const currentWeights = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, positionValuesBefore[symbol] / calculatedEquityBefore]));
  const projectedWeights = Object.fromEntries(SYMBOLS.map((symbol) => [
    symbol,
    calculatedEquityAfter > 0 ? positionValuesAfter[symbol] / calculatedEquityAfter : 0,
  ]));

  const sellOrders = planned.orders.filter((order) => order.side === "sell");
  const buyOrders = planned.orders.filter((order) => order.side === "buy");
  const sum = (orders, field) => orders.reduce((total, order) => total + order[field], 0);
  const grossReferenceSellNotional = sum(sellOrders, "reference_notional");
  const sellExecutionNotional = sum(sellOrders, "modeled_execution_notional");
  const sellTransactionCost = sum(sellOrders, "modeled_transaction_cost");
  const regulatorySellFee = sum(sellOrders, "modeled_regulatory_sell_fee");
  const netSellProceeds = sellOrders.reduce((total, order) => total + order.modeled_cash_effect, 0);
  const grossReferenceBuyNotional = sum(buyOrders, "reference_notional");
  const buyExecutionNotional = sum(buyOrders, "modeled_execution_notional");
  const buyTransactionCost = sum(buyOrders, "modeled_transaction_cost");
  const totalBuyCashRequired = buyOrders.reduce((total, order) => total - order.modeled_cash_effect, 0);
  const modeledEquityDrag = calculatedEquityBefore - calculatedEquityAfter;

  let status = planned.blockStatus;
  if (!status && planned.orders.length === 0) {
    status = SYMBOLS.every((symbol) => Math.abs(desiredDeltas[symbol]) <= NUMERIC_EPSILON)
      ? "no_trade"
      : "no_executable_orders";
  }
  if (!status && planned.skipped.length > 0) status = "ready_with_residual_drift";
  if (!status) status = "ready";

  const result = {
    schema_version: "equity_shadow_execution.v1",
    preview_only: true,
    broker_mutation_authorized: false,
    deterministic: true,
    universe: [...SYMBOLS],
    constraints: {
      sell_before_buy: true,
      self_financing_required: true,
      minimum_order_notional: MINIMUM_ORDER_NOTIONAL,
      quantity_decimal_places: QUANTITY_DECIMALS,
      fractional_share_compatible: true,
      fractional_notional_compatible: true,
    },
    status,
    asset_eligibility: eligibility,
    cost_model: {
      slippage_bps: round(costs.slippage_bps),
      transaction_cost_bps: round(costs.transaction_cost_bps),
      regulatory_sell_fee_bps: round(costs.regulatory_sell_fee_bps),
    },
    broker_cash_equity: {
      valuation_basis: "cash_plus_quantity_times_broker_price",
      used_for_order_sizing: true,
      holdings_before: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, quantityString(holdings[symbol])])),
      broker_prices: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(prices[symbol])])),
      cash_before: round(cash),
      position_market_values_before: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(positionValuesBefore[symbol])])),
      calculated_equity_before: round(calculatedEquityBefore),
      reported_equity: reportedEquity === null ? null : round(reportedEquity),
      reconciliation: {
        formula: "cash + SPY_qty*SPY_price + BIL_qty*BIL_price",
        tolerance_dollars: EQUITY_RECONCILIATION_TOLERANCE,
        status: reconciliationStatus,
        reported_minus_calculated: reconciliationDifference === null ? null : round(reconciliationDifference),
      },
      holdings_after_preview: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, quantityString(holdingsAfter[symbol])])),
      cash_after_preview: round(cashAfter),
      position_market_values_after_preview: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(positionValuesAfter[symbol])])),
      calculated_equity_after_preview: round(calculatedEquityAfter),
    },
    non_broker_theory: {
      theoretical_adjusted_total_return: theory,
      used_for_order_sizing: false,
      used_for_broker_cash_equity: false,
    },
    targets: {
      weights: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(weights[symbol], 12)])),
      market_values_at_broker_equity_before_costs: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(targetValues[symbol])])),
    },
    drift: {
      before: {
        position_weights: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(currentWeights[symbol], 12)])),
        target_minus_position_notional: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(desiredDeltas[symbol])])),
      },
      after_preview: {
        position_weights: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(projectedWeights[symbol], 12)])),
        weight_minus_target: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(projectedWeights[symbol] - weights[symbol], 12)])),
        target_minus_position_notional: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, round(targetValues[symbol] - positionValuesAfter[symbol])])),
        modeled_equity_reduction: round(modeledEquityDrag),
      },
    },
    funding: {
      opening_cash: round(cash),
      gross_reference_sell_notional: round(grossReferenceSellNotional),
      modeled_sell_execution_notional: round(sellExecutionNotional),
      modeled_sell_slippage: round(grossReferenceSellNotional - sellExecutionNotional),
      modeled_sell_transaction_cost: round(sellTransactionCost),
      modeled_regulatory_sell_fee: round(regulatorySellFee),
      net_sell_proceeds: round(netSellProceeds),
      buy_budget_after_sells: round(cash + netSellProceeds),
      gross_reference_buy_notional: round(grossReferenceBuyNotional),
      modeled_buy_execution_notional: round(buyExecutionNotional),
      modeled_buy_slippage: round(buyExecutionNotional - grossReferenceBuyNotional),
      modeled_buy_transaction_cost: round(buyTransactionCost),
      total_buy_cash_required: round(totalBuyCashRequired),
      unused_buy_budget: round(cashAfter),
      self_financing: cashAfter >= 0 && totalBuyCashRequired <= cash + netSellProceeds + NUMERIC_EPSILON,
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

export function canonicalEquityShadowExecutionJson(preview) {
  assertPlainObject(preview, "preview");
  if (preview.schema_version !== "equity_shadow_execution.v1") {
    throw new TypeError("preview must be an equity_shadow_execution.v1 result");
  }
  return stableStringify(preview);
}
