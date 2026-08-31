import { assertCandidateIntegrity } from "./candidate.mjs";
import {
  sanitizeBrokerMutationAcknowledgment,
  sanitizeBrokerOrderArtifact,
  sanitizeMcpTransportMetadata,
} from "./broker_artifact.mjs";
import { sha256, stableStringify } from "./canonical.mjs";
import { buildDesiredOrderProjection } from "./order_projection.mjs";
import { POLICY } from "./policy.mjs";
import { verifyCertificate } from "./risk.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";

export function assertPaperHost(baseUrl) {
  const parsed = new URL(baseUrl);
  const expected = new URL(POLICY.paperHost);
  if (parsed.protocol !== expected.protocol || parsed.hostname !== expected.hostname || parsed.port !== expected.port || parsed.pathname !== "/") {
    throw new Error(`refusing non-paper Alpaca host: ${parsed.origin}`);
  }
  return expected.origin;
}

export function buildMlegPayload(candidate, certificate, verification) {
  verifyCertificate(certificate, verification);
  assertCandidateIntegrity(candidate);
  if (certificate.candidate_id !== candidate.candidate_id) throw new Error("candidate ID does not match certificate");
  if (certificate.candidate_snapshot_sha256 !== sha256(candidate)) throw new Error("candidate snapshot does not match certificate");
  if (!Number.isInteger(certificate.quantity) || certificate.quantity <= 0 || certificate.quantity > POLICY.maxContracts) {
    throw new Error("invalid certified quantity");
  }
  const payload = buildDesiredOrderProjection(candidate, certificate.quantity, certificate.run_id);
  if (certificate.desired_order_projection_sha256 !== sha256(payload)) throw new Error("desired order projection does not match certificate");
  return { ...payload, payload_sha256: sha256(payload) };
}

function ageSeconds(now, observedAt, label) {
  const nowTime = new Date(now).getTime();
  const observedTime = new Date(observedAt).getTime();
  if (!Number.isFinite(observedTime)) throw new Error(`${label} timestamp is invalid`);
  const age = (nowTime - observedTime) / 1000;
  if (age < 0 || age > POLICY.preflightMaxAgeSeconds) throw new Error(`${label} snapshot is stale or from the future`);
  return age;
}

function finiteNonnegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be finite and nonnegative`);
  return number;
}

function assertContract(contract, leg, candidate) {
  if (!contract || contract.symbol !== leg.symbol) throw new Error(`fresh contract metadata missing for ${leg.symbol}`);
  const occ = parseOccOptionSymbol(contract.symbol);
  if (occ.underlying !== candidate.underlying || occ.expiry !== candidate.expiry || occ.type !== leg.type || Math.abs(occ.strike - leg.strike) > 0.0001) {
    throw new Error(`fresh contract identity mismatch for ${leg.symbol}`);
  }
  if (contract.status !== "active" || contract.tradable !== true) throw new Error(`contract ${leg.symbol} is not active and tradable`);
  if (Number(contract.multiplier) !== 100) throw new Error(`contract ${leg.symbol} does not have standard multiplier 100`);
  if (contract.adjusted === true || (contract.deliverable && contract.deliverable !== "standard")) {
    throw new Error(`contract ${leg.symbol} has an adjusted or ambiguous deliverable`);
  }
}

function assertFreshQuote(quote, leg, candidate, now) {
  if (!quote || quote.symbol !== leg.symbol) throw new Error(`fresh quote missing for ${leg.symbol}`);
  if (quote.feed !== leg.feed) throw new Error(`fresh quote feed differs for ${leg.symbol}`);
  ageSeconds(now, quote.observed_at, `quote ${leg.symbol}`);
  const bid = finiteNonnegative(quote.bid, `${leg.symbol} bid`);
  const ask = finiteNonnegative(quote.ask, `${leg.symbol} ask`);
  if (ask <= bid) throw new Error(`fresh quote is crossed or invalid for ${leg.symbol}`);
  const midpoint = (bid + ask) / 2;
  if ((ask - bid) / midpoint > POLICY.maxRelativeLegSpread) throw new Error(`fresh quote is too wide for ${leg.symbol}`);
  const occ = parseOccOptionSymbol(quote.symbol);
  if (occ.underlying !== candidate.underlying || occ.expiry !== candidate.expiry || occ.type !== leg.type || Math.abs(occ.strike - leg.strike) > 0.0001) {
    throw new Error(`fresh quote identity mismatch for ${leg.symbol}`);
  }
  return { bid, ask };
}

export function validatePaperPreflight(preflight, candidate, certificate, now = new Date()) {
  if (!preflight || typeof preflight !== "object") throw new Error("fresh paper preflight is required");
  assertPaperHost(preflight.trading_base_url);
  const dataUrl = new URL(preflight.data_base_url);
  if (dataUrl.origin !== "https://data.alpaca.markets" || dataUrl.pathname !== "/") throw new Error("preflight data origin is not allowlisted");
  ageSeconds(now, preflight.observed_at, "preflight");
  if (preflight.account?.status !== "ACTIVE" || preflight.account.trading_blocked !== false || preflight.account.account_blocked !== false) {
    throw new Error("paper account is not active and unblocked");
  }
  if (preflight.account.competition_account_match !== true) {
    throw new Error("paper credentials do not belong to the dedicated competition account");
  }
  const equity = finiteNonnegative(preflight.account.equity, "account equity");
  const optionsBuyingPower = finiteNonnegative(preflight.account.options_buying_power, "options buying power");
  const optionsLevel = Number(preflight.account.options_trading_level);
  if (!Number.isInteger(optionsLevel) || optionsLevel < POLICY.minimumOptionsLevel || optionsLevel > 3) {
    throw new Error("options trading level is below policy or invalid");
  }
  if (optionsBuyingPower < certificate.reserved_max_loss) throw new Error("options buying power is insufficient");
  const freshTradeRiskBudget = Math.min(equity * POLICY.riskPerTradeFraction, POLICY.riskPerTradeDollarCap);
  if (certificate.reserved_max_loss > freshTradeRiskBudget) throw new Error("fresh per-trade risk exceeds policy");
  if (optionsBuyingPower - certificate.reserved_max_loss < equity * POLICY.minimumPostTradeBuyingPowerFraction) {
    throw new Error("post-trade buying power is below policy floor");
  }
  if (preflight.clock?.is_open !== true) throw new Error("broker clock reports a closed market");
  ageSeconds(now, preflight.clock.timestamp, "broker clock");
  const underlyingQuote = preflight.underlying_quote;
  if (!underlyingQuote || underlyingQuote.symbol !== candidate.underlying) throw new Error("fresh underlying quote is missing");
  if (!new Set(["iex", "sip"]).has(underlyingQuote.feed)) throw new Error("underlying quote feed is not allowlisted");
  ageSeconds(now, underlyingQuote.observed_at, "underlying quote");
  const underlyingBid = finiteNonnegative(underlyingQuote.bid, "underlying bid");
  const underlyingAsk = finiteNonnegative(underlyingQuote.ask, "underlying ask");
  if (underlyingAsk <= underlyingBid) throw new Error("fresh underlying quote is crossed or invalid");
  const freshSpot = (underlyingBid + underlyingAsk) / 2;
  if ((underlyingAsk - underlyingBid) / freshSpot > POLICY.maxUnderlyingDriftFraction) throw new Error("fresh underlying quote is too wide");
  if (Math.abs(freshSpot / certificate.market_spot - 1) > POLICY.maxUnderlyingDriftFraction) throw new Error("fresh underlying price moved beyond the certified collar");
  if (!Array.isArray(preflight.positions) || !Array.isArray(preflight.open_orders)) throw new Error("positions and open orders must be complete arrays");
  if (preflight.positions.length !== 0 || preflight.open_orders.length !== 0) {
    throw new Error("flat-account entry policy rejects existing positions or open orders");
  }
  if (!Array.isArray(preflight.contracts) || !Array.isArray(preflight.quotes)) throw new Error("fresh contracts and quotes are required");
  const contractBySymbol = new Map(preflight.contracts.map((item) => [item.symbol, item]));
  const quoteBySymbol = new Map(preflight.quotes.map((item) => [item.symbol, item]));
  assertContract(contractBySymbol.get(candidate.long_leg.symbol), candidate.long_leg, candidate);
  assertContract(contractBySymbol.get(candidate.short_leg.symbol), candidate.short_leg, candidate);
  const longQuote = assertFreshQuote(quoteBySymbol.get(candidate.long_leg.symbol), candidate.long_leg, candidate, now);
  const shortQuote = assertFreshQuote(quoteBySymbol.get(candidate.short_leg.symbol), candidate.short_leg, candidate, now);
  const naturalDebit = Math.round((longQuote.ask - shortQuote.bid) * 100) / 100;
  if (naturalDebit <= 0 || naturalDebit > certificate.max_entry_debit) throw new Error("fresh natural debit exceeds the certified price collar");
  const openDefinedRisk = finiteNonnegative(preflight.open_defined_risk, "open defined risk");
  if (openDefinedRisk + certificate.reserved_max_loss > equity * POLICY.aggregateRiskFraction) throw new Error("fresh aggregate risk exceeds policy");
  return { equity, openDefinedRisk, naturalDebit };
}

function brokerProjection(order) {
  return {
    client_order_id: order?.client_order_id,
    order_class: order?.order_class,
    qty: String(order?.qty),
    type: order?.type,
    time_in_force: order?.time_in_force,
    limit_price: Number(order?.limit_price).toFixed(2),
    legs: Array.isArray(order?.legs) ? order.legs.map((leg) => ({
      symbol: leg.symbol,
      ratio_qty: String(leg.ratio_qty ?? leg.qty),
      side: leg.side,
      position_intent: leg.position_intent,
    })) : [],
  };
}

export function assertAcceptedOrderMatches(payload, acceptedOrder) {
  const expected = { ...payload };
  delete expected.payload_sha256;
  const observed = brokerProjection(acceptedOrder);
  if (stableStringify(observed) !== stableStringify(expected)) throw new Error("accepted broker order differs from certified projection");
  const acceptedStatuses = new Set([
    "accepted",
    "pending_new",
    "accepted_for_bidding",
    "new",
    "partially_filled",
    "filled",
    "stopped",
    "held",
  ]);
  if (!acceptedStatuses.has(acceptedOrder?.status)) throw new Error("broker order is not in an accepted working or filled status");
  return true;
}

export function assertPinnedMcpArguments(arguments_) {
  const expectedKeys = ["client_order_id", "legs", "limit_price", "order_class", "qty", "time_in_force", "type"];
  const actualKeys = Object.keys(arguments_).sort();
  if (stableStringify(actualKeys) !== stableStringify(expectedKeys)) throw new Error("MCP arguments differ from Finly's strict pinned projection");
  if (arguments_.order_class !== "mleg" || arguments_.type !== "limit" || arguments_.time_in_force !== "day") throw new Error("MCP parent order fields violate policy");
  if (!/^\d+$/.test(arguments_.qty) || Number(arguments_.qty) < 1 || Number(arguments_.qty) > POLICY.maxContracts) throw new Error("MCP quantity is invalid");
  if (!/^\d+\.\d{2}$/.test(arguments_.limit_price) || Number(arguments_.limit_price) <= 0) throw new Error("MCP debit limit is invalid");
  if (!/^finly-[a-f0-9]{20}$/.test(arguments_.client_order_id)) throw new Error("MCP client order ID is invalid");
  if (!Array.isArray(arguments_.legs) || arguments_.legs.length !== 2) throw new Error("MCP spread must have exactly two legs");
  const legKeys = ["position_intent", "ratio_qty", "side", "symbol"];
  for (const leg of arguments_.legs) {
    if (stableStringify(Object.keys(leg).sort()) !== stableStringify(legKeys)) throw new Error("MCP leg contains missing or unknown fields");
    if (leg.ratio_qty !== "1") throw new Error("MCP leg ratio must be one");
    if ((leg.side !== "buy" || leg.position_intent !== "buy_to_open")
      && (leg.side !== "sell" || leg.position_intent !== "sell_to_open")) throw new Error("MCP leg side or intent is invalid");
    parseOccOptionSymbol(leg.symbol);
  }
  if (new Set(arguments_.legs.map((leg) => leg.position_intent)).size !== 2) throw new Error("MCP spread must open one long and one short leg");
  return true;
}

export function assertPinnedMcpExitArguments(arguments_) {
  const expectedKeys = ["client_order_id", "legs", "limit_price", "order_class", "qty", "time_in_force", "type"];
  const actualKeys = Object.keys(arguments_).sort();
  if (stableStringify(actualKeys) !== stableStringify(expectedKeys)) throw new Error("MCP exit arguments differ from Finly's strict pinned projection");
  if (arguments_.order_class !== "mleg" || arguments_.type !== "limit" || arguments_.time_in_force !== "day") throw new Error("MCP exit parent order fields violate policy");
  if (!/^\d+$/.test(arguments_.qty) || Number(arguments_.qty) < 1 || Number(arguments_.qty) > POLICY.maxContracts) throw new Error("MCP exit quantity is invalid");
  if (!/^-\d+\.\d{2}$/.test(arguments_.limit_price) || Number(arguments_.limit_price) >= 0) throw new Error("MCP exit credit limit is invalid");
  if (!/^finly-exit-[a-f0-9]{20}$/.test(arguments_.client_order_id)) throw new Error("MCP exit client order ID is invalid");
  if (!Array.isArray(arguments_.legs) || arguments_.legs.length !== 2) throw new Error("MCP exit spread must have exactly two legs");
  const legKeys = ["position_intent", "ratio_qty", "side", "symbol"];
  for (const leg of arguments_.legs) {
    if (stableStringify(Object.keys(leg).sort()) !== stableStringify(legKeys)) throw new Error("MCP exit leg contains missing or unknown fields");
    if (leg.ratio_qty !== "1") throw new Error("MCP exit leg ratio must be one");
    if ((leg.side !== "sell" || leg.position_intent !== "sell_to_close")
      && (leg.side !== "buy" || leg.position_intent !== "buy_to_close")) throw new Error("MCP exit leg side or intent is invalid");
    parseOccOptionSymbol(leg.symbol);
  }
  if (new Set(arguments_.legs.map((leg) => leg.position_intent)).size !== 2) throw new Error("MCP exit spread must close one long and one short leg");
  return true;
}

export class GuardedPaperExecutor {
  constructor({
    baseUrl = POLICY.paperHost,
    transport = "mcp",
    enabled = false,
    signingSecret,
    permitLedger,
    preflight,
    beforeMutation,
    placeOptionOrder,
    getOrderByClientOrderId,
    now = () => new Date(),
    mcpMetadata,
  }) {
    this.baseUrl = assertPaperHost(baseUrl);
    if (transport !== "mcp") throw new Error("judged execution transport must be Alpaca MCP");
    this.transport = transport;
    this.enabled = enabled;
    this.signingSecret = signingSecret;
    this.permitLedger = permitLedger;
    this.preflight = preflight;
    if (beforeMutation !== undefined && typeof beforeMutation !== "function") {
      throw new Error("paper pre-mutation checkpoint must be callable");
    }
    this.beforeMutation = beforeMutation;
    this.placeOptionOrder = placeOptionOrder;
    this.getOrderByClientOrderId = getOrderByClientOrderId;
    this.now = now;
    this.mcpMetadata = mcpMetadata;
  }

  async submit(candidate, certificate) {
    const authorizationNow = this.now();
    verifyCertificate(certificate, { signingSecret: this.signingSecret, requiredScope: "paper_submit", now: authorizationNow });
    if (!this.enabled) throw new Error("execution is disabled; paper mutation requires an explicit local enable flag");
    if (!this.permitLedger || typeof this.permitLedger.assertIssued !== "function" || typeof this.permitLedger.reserve !== "function") {
      throw new Error("durable trusted permit ledger is unavailable");
    }
    if (!this.mcpMetadata
      || this.mcpMetadata.server !== "alpaca-mcp-server"
      || this.mcpMetadata.version !== POLICY.alpacaMcpVersion
      || this.mcpMetadata.tool !== "place_option_order"
      || this.mcpMetadata.schema_sha256 !== POLICY.placeOptionOrderSchemaSha256) {
      throw new Error("pinned Alpaca MCP tool metadata is unavailable");
    }
    if (typeof this.preflight !== "function") throw new Error("fresh broker preflight is unavailable");
    if (typeof this.placeOptionOrder !== "function" || typeof this.getOrderByClientOrderId !== "function") {
      throw new Error("Alpaca MCP mutation and REST reconciliation tools are required");
    }
    await this.permitLedger.assertIssued(certificate);
    const payload = buildMlegPayload(candidate, certificate, {
      signingSecret: this.signingSecret,
      requiredScope: "paper_submit",
      now: authorizationNow,
    });
    const preflight = await this.preflight({ candidate, certificate, now: authorizationNow });
    const preflightNow = this.now();
    verifyCertificate(certificate, { signingSecret: this.signingSecret, requiredScope: "paper_submit", now: preflightNow });
    const fresh = validatePaperPreflight(preflight, candidate, certificate, preflightNow);
    await this.permitLedger.reserve(certificate, {
      client_order_id: payload.client_order_id,
      equity: fresh.equity,
      openDefinedRisk: fresh.openDefinedRisk,
      aggregateRiskFraction: POLICY.aggregateRiskFraction,
      reserved_at: new Date(preflightNow).toISOString(),
    });
    if (this.beforeMutation) await this.beforeMutation({ kind: "entry", clientOrderId: payload.client_order_id });
    const { payload_sha256: payloadHash, ...toolArguments } = payload;
    assertPinnedMcpArguments(toolArguments);
    const submissionNow = this.now();
    verifyCertificate(certificate, { signingSecret: this.signingSecret, requiredScope: "paper_submit", now: submissionNow });
    validatePaperPreflight(preflight, candidate, certificate, submissionNow);
    let mutationResponse;
    try {
      mutationResponse = await this.placeOptionOrder(toolArguments);
    } catch (error) {
      await this.permitLedger.mark(certificate.nonce, "ambiguous", { error: String(error?.message ?? error) });
    }
    let acceptedOrder;
    try {
      acceptedOrder = await this.getOrderByClientOrderId(payload.client_order_id);
      assertAcceptedOrderMatches(payload, acceptedOrder);
    } catch (error) {
      await this.permitLedger.mark(certificate.nonce, "ambiguous", { reconciliation_error: String(error?.message ?? error) });
      throw new Error(`paper submission is frozen pending reconciliation: ${error.message}`);
    }
    await this.permitLedger.mark(certificate.nonce, "accepted", { broker_order_id: acceptedOrder.id ?? null });
    return {
      schema_version: "order_receipt.v3",
      certificate_id: certificate.certificate_id,
      payload_sha256: payloadHash,
      transport: this.transport,
      mcp: sanitizeMcpTransportMetadata(this.mcpMetadata),
      submitted_at: new Date(submissionNow).toISOString(),
      mutation_ack: sanitizeBrokerMutationAcknowledgment(mutationResponse),
      accepted_order: sanitizeBrokerOrderArtifact(acceptedOrder),
    };
  }
}
