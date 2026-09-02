import { POLICY } from "./policy.mjs";
import { parseOccOptionSymbol } from "./schema.mjs";

const DIRECTIONS = new Set(["bullish", "bearish", "neutral"]);
export const FORCE_FLAT_EXIT_ATTEMPTS = 2;

function fixed(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteNonnegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be finite and nonnegative`);
  return number;
}

function marketDateParts(value, label) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`${label} is not a valid timestamp`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const selected = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${selected.year}-${selected.month}-${selected.day}`;
}

function dateNumber(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("market date is invalid");
  return parsed;
}

function weekdaySessionsElapsed(anchorAt, observedAt) {
  const start = dateNumber(marketDateParts(anchorAt, "holding-period anchor"));
  const end = dateNumber(marketDateParts(observedAt, "exit observation time"));
  if (end < start) throw new Error("exit observation predates the holding-period anchor");
  let count = 0;
  for (let cursor = new Date(start.getTime() + 86_400_000); cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function quoteFor(quotes, symbol, observedAt, feed) {
  const quote = quotes?.[symbol];
  if (!quote || typeof quote !== "object") throw new Error(`exit quote is missing for ${symbol}`);
  const bid = finiteNonnegative(quote.bp ?? quote.bid, `${symbol} exit bid`);
  const ask = finiteNonnegative(quote.ap ?? quote.ask, `${symbol} exit ask`);
  if (ask < bid) throw new Error(`exit quote is crossed for ${symbol}`);
  const quoteTime = new Date(quote.t ?? quote.observed_at);
  const now = new Date(observedAt);
  if (Number.isNaN(quoteTime.getTime()) || Number.isNaN(now.getTime())) throw new Error(`exit quote timestamp is invalid for ${symbol}`);
  const age = (now.getTime() - quoteTime.getTime()) / 1000;
  const maximumAge = POLICY.quoteMaxAgeSeconds[feed];
  if (!Number.isFinite(maximumAge) || age < 0 || age > maximumAge) throw new Error(`exit quote is stale or from the future for ${symbol}`);
  return { bid, ask, observed_at: quoteTime.toISOString(), age_seconds: age };
}

function validateEntryProjection(entryProjection) {
  if (!entryProjection || entryProjection.order_class !== "mleg" || entryProjection.type !== "limit"
    || entryProjection.time_in_force !== "day" || !Array.isArray(entryProjection.legs) || entryProjection.legs.length !== 2) {
    throw new Error("exit policy requires an exact two-leg entry projection");
  }
  const quantity = Number(entryProjection.qty);
  const entryDebit = Number(entryProjection.limit_price);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > POLICY.maxContracts || !Number.isFinite(entryDebit) || entryDebit <= 0) {
    throw new Error("exit policy entry quantity or debit is invalid");
  }
  const longLeg = entryProjection.legs.find((leg) => leg.side === "buy" && leg.position_intent === "buy_to_open");
  const shortLeg = entryProjection.legs.find((leg) => leg.side === "sell" && leg.position_intent === "sell_to_open");
  if (!longLeg || !shortLeg) throw new Error("exit policy entry legs are not an exact debit spread");
  const longOcc = parseOccOptionSymbol(longLeg.symbol);
  const shortOcc = parseOccOptionSymbol(shortLeg.symbol);
  if (longOcc.underlying !== shortOcc.underlying || longOcc.expiry !== shortOcc.expiry || longOcc.type !== shortOcc.type) {
    throw new Error("exit policy entry legs do not share one option series");
  }
  const width = Math.abs(longOcc.strike - shortOcc.strike);
  if (width <= entryDebit) throw new Error("exit policy spread has no bounded positive maximum gain");
  const direction = longOcc.type === "call" ? "bullish" : "bearish";
  return { quantity, entryDebit, longLeg, shortLeg, longOcc, width, direction };
}

export function evaluateDebitSpreadExit({
  certificate,
  entryProjection,
  quotes,
  observedAt = new Date().toISOString(),
  strategyDirection = null,
  entryFilledAt = null,
  forceExitAt = null,
  exitAttempt = 1,
} = {}) {
  if (!certificate || certificate.certified !== true || certificate.authorization_scope !== "paper_submit") {
    throw new Error("exit policy requires the certified paper-entry permit");
  }
  if (!Number.isInteger(certificate.horizon_sessions) || certificate.horizon_sessions < 1 || certificate.horizon_sessions > 20) {
    throw new Error("exit policy certificate horizon is invalid");
  }
  if (strategyDirection !== null && !DIRECTIONS.has(strategyDirection)) throw new Error("exit policy strategy direction is invalid");
  if (!Number.isInteger(exitAttempt) || exitAttempt < 1 || exitAttempt > FORCE_FLAT_EXIT_ATTEMPTS) {
    throw new Error("exit attempt is outside the bounded force-flat policy");
  }
  const entry = validateEntryProjection(entryProjection);
  const longQuote = quoteFor(quotes, entry.longLeg.symbol, observedAt, certificate.option_feed);
  const shortQuote = quoteFor(quotes, entry.shortLeg.symbol, observedAt, certificate.option_feed);
  const rawCredit = entry.longLeg.side === "buy"
    ? longQuote.bid - shortQuote.ask - POLICY.exitSlippagePerLegDollars * 2
    : 0;
  const estimatedCredit = fixed(Math.max(0, rawCredit));
  const naturalCredit = Math.max(0.01, Math.floor(Math.max(0, rawCredit) * 100) / 100);
  const maxGainPerShare = entry.width - entry.entryDebit;
  const profitTarget = fixed(entry.entryDebit + POLICY.profitTargetMaxGainFraction * maxGainPerShare);
  const stopThreshold = fixed(entry.entryDebit * POLICY.stopLossRemainingDebitFraction);
  const holdingPeriodAnchor = entryFilledAt ?? certificate.created_at;
  const anchorInstant = new Date(holdingPeriodAnchor);
  const certificateInstant = new Date(certificate.created_at);
  const observationInstant = new Date(observedAt);
  if (Number.isNaN(anchorInstant.getTime()) || Number.isNaN(certificateInstant.getTime()) || Number.isNaN(observationInstant.getTime())) {
    throw new Error("exit policy holding-period timestamps are invalid");
  }
  if (entryFilledAt !== null && anchorInstant < certificateInstant) {
    throw new Error("broker entry fill predates the certificate");
  }
  if (anchorInstant > observationInstant) throw new Error("broker entry fill is after the exit observation");
  let forceExitInstant = null;
  if (forceExitAt !== null) {
    forceExitInstant = new Date(forceExitAt);
    if (Number.isNaN(forceExitInstant.getTime()) || forceExitInstant.toISOString() !== forceExitAt) {
      throw new Error("forced-flat timestamp must be a canonical ISO timestamp");
    }
  }
  const sessionsElapsed = weekdaySessionsElapsed(holdingPeriodAnchor, observedAt);
  const expiry = dateNumber(entry.longOcc.expiry);
  const marketDate = dateNumber(marketDateParts(observedAt, "exit observation time"));
  const dte = Math.ceil((expiry.getTime() - marketDate.getTime()) / 86_400_000);
  if (dte < 0) throw new Error("exit policy spread has expired");
  const forceFlatActive = forceExitInstant !== null && observationInstant >= forceExitInstant;

  let trigger = null;
  if (dte <= POLICY.expiryGuardDte) trigger = "expiry_guard";
  else if (forceFlatActive) trigger = "competition_end_guard";
  else if (estimatedCredit <= stopThreshold) trigger = "risk_limit";
  else if (estimatedCredit >= profitTarget) trigger = "profit_target";
  else if (sessionsElapsed >= certificate.horizon_sessions) trigger = "time_stop";
  else if (strategyDirection !== null && strategyDirection !== entry.direction) trigger = "strategy_invalidation";

  // A forced close becomes progressively more executable, but never crosses
  // through zero into an unbounded debit. The final attempt rests at the
  // minimum supported net credit rather than turning a defined-risk spread
  // into an uncapped market-order outcome.
  let executableCredit = naturalCredit;
  if (forceFlatActive && exitAttempt > 1) {
    executableCredit = 0.01;
  }
  const executableCreditText = executableCredit.toFixed(2);

  return {
    schema_version: "finly_exit_assessment.v1",
    decision: trigger ? "EXIT" : "HOLD",
    trigger,
    observed_at: new Date(observedAt).toISOString(),
    option_feed: certificate.option_feed,
    quantity: entry.quantity,
    estimated_credit: estimatedCredit,
    executable_credit_limit: executableCreditText,
    credit_limit: trigger ? executableCreditText : null,
    exit_attempt: exitAttempt,
    maximum_exit_attempts: FORCE_FLAT_EXIT_ATTEMPTS,
    estimated_unrealized_pnl: fixed((estimatedCredit - entry.entryDebit) * 100 * entry.quantity),
    sessions_elapsed: sessionsElapsed,
    holding_period_anchor_at: anchorInstant.toISOString(),
    holding_period_anchor_source: entryFilledAt === null ? "certificate_created_at_fallback" : "broker_entry_filled_at",
    dte,
    entry_direction: entry.direction,
    strategy_direction: strategyDirection,
    thresholds: {
      profit_target_credit: profitTarget,
      stop_remaining_credit: stopThreshold,
      expiry_guard_dte: POLICY.expiryGuardDte,
      horizon_sessions: certificate.horizon_sessions,
      force_flat_at: forceExitInstant?.toISOString() ?? null,
    },
    quote_ages_seconds: {
      long: longQuote.age_seconds,
      short: shortQuote.age_seconds,
    },
  };
}
