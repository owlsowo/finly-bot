import { sha256 } from "./canonical.mjs";
import { validateEvidenceAssessment } from "./evidence_extractor.mjs";
import { POLICY } from "./policy.mjs";
import { validateEvidenceRecord, validateOptionQuote, validateSourceSignal } from "./schema.mjs";

const DATA_ORIGIN = "https://data.alpaca.markets";
const MAX_NEWS_AGE_HOURS = 72;
const EVENT_SCORE_SHRINKAGE = 0.65;

function clip(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function isoTimestamp(value, label) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${label} must be a valid timestamp`);
  return parsed.toISOString();
}

function standardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("returns must contain at least two finite observations");
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function sumTail(values, count) {
  return values.slice(-count).reduce((sum, value) => sum + value, 0);
}

function sourceSignal({
  family,
  underlying,
  directionScore,
  volatilityScore,
  quality,
  freshness,
  calibration,
  independence,
  evidence,
  explanation,
  asOf,
}) {
  const signal = {
    schema_version: "source_signal.v1",
    family,
    underlying,
    direction_score: round(clip(directionScore, -1, 1)),
    volatility_score: round(clip(volatilityScore, -1, 1)),
    quality: round(clip(quality, 0, 1)),
    freshness: round(clip(freshness, 0, 1)),
    calibration: round(clip(calibration, 0, 1)),
    independence: round(clip(independence, 0, 1)),
    evidence_ids: evidence.map((record) => record.evidence_id),
    evidence,
    explanation,
  };
  return validateSourceSignal(signal, { asOf });
}

export function createCanonicalEvidenceRecord({
  family,
  underlying,
  sourceKind,
  sourceUri,
  originId,
  publishedAt,
  receivedAt,
  availableAt = receivedAt,
  content,
  duplicateContent = content,
}) {
  const body = {
    schema_version: "evidence_record.v1",
    family,
    underlying,
    source_kind: sourceKind,
    source_uri: sourceUri,
    origin_id: originId,
    published_at: isoTimestamp(publishedAt, "evidence published_at"),
    received_at: isoTimestamp(receivedAt, "evidence received_at"),
    available_at: isoTimestamp(availableAt, "evidence available_at"),
    content_sha256: sha256(content),
    duplicate_group: sha256({ family, content: duplicateContent }),
  };
  const record = { ...body, evidence_id: sha256(body) };
  return validateEvidenceRecord(record, { family, underlying, asOf: availableAt });
}

/**
 * Deterministic price signal. Five- and twenty-session log momentum are scaled
 * by realized volatility, blended 65/35, then bounded with tanh. No model or
 * text source can alter the score after these inputs are supplied.
 */
export function buildMarketSignal(market, { asOf = new Date().toISOString() } = {}) {
  const decisionTime = isoTimestamp(asOf, "market signal asOf");
  if (!market || !POLICY.underlyings.includes(market.underlying)) throw new TypeError("market underlying is outside policy");
  if (!Array.isArray(market.historical_log_returns) || market.historical_log_returns.length < 20) {
    throw new TypeError("market signal requires at least twenty historical returns");
  }
  const returns = market.historical_log_returns.map((value) => requireFinite(value, "historical return"));
  const recent = returns.slice(-20);
  const sigma = Math.max(standardDeviation(recent), 0.001);
  const momentum5 = sumTail(returns, 5);
  const momentum20 = sumTail(returns, 20);
  const z5 = momentum5 / (sigma * Math.sqrt(5));
  const z20 = momentum20 / (sigma * Math.sqrt(20));
  const blendedZ = 0.65 * z5 + 0.35 * z20;
  const annualizedVolatility = sigma * Math.sqrt(252);
  const quoteAge = requireFinite(market.quote_age_seconds, "market quote age");
  const feedMaximum = POLICY.quoteMaxAgeSeconds[market.option_feed];
  if (!Number.isFinite(feedMaximum) || quoteAge < 0 || quoteAge > feedMaximum) throw new TypeError("market quote is stale or has an unknown feed");
  const observedAt = isoTimestamp(market.observed_at, "market observed_at");
  const spot = requireFinite(market.spot, "market spot");
  if (spot <= 0) throw new TypeError("market spot must be positive");
  const content = {
    underlying: market.underlying,
    spot,
    observed_at: observedAt,
    quote_age_seconds: quoteAge,
    option_feed: market.option_feed,
    history_mode: market.history_mode,
    return_count: returns.length,
    returns_sha256: sha256(returns),
  };
  const evidence = [createCanonicalEvidenceRecord({
    family: "market",
    underlying: market.underlying,
    sourceKind: "alpaca_market",
    sourceUri: `${DATA_ORIGIN}/v2/stocks/${market.underlying}/snapshot`,
    originId: `alpaca.market.${market.underlying}.v1`,
    publishedAt: observedAt,
    receivedAt: decisionTime,
    content,
  })];
  const directionScore = Math.tanh(blendedZ / 2);
  const volatilityScore = (annualizedVolatility - 0.20) / 0.20;
  return sourceSignal({
    family: "market",
    underlying: market.underlying,
    directionScore,
    volatilityScore,
    quality: 0.85 + Math.min(returns.length, 252) / 252 * 0.14,
    freshness: 1 - quoteAge / feedMaximum,
    calibration: 0.85,
    independence: 0.95,
    evidence,
    explanation: `Deterministic 5/20-session log momentum is ${(momentum5 * 100).toFixed(2)}%/${(momentum20 * 100).toFixed(2)}%; 20-session realized volatility is ${(annualizedVolatility * 100).toFixed(1)}%.`,
    asOf: decisionTime,
  });
}

function closestToSpot(quotes, spot) {
  return [...quotes].sort((left, right) => Math.abs(left.strike - spot) - Math.abs(right.strike - spot)
    || left.symbol.localeCompare(right.symbol))[0];
}

/**
 * Deterministic options signal. It compares the nearest-to-spot put and call
 * IV at the earliest expiry containing both rights. Positive put skew maps to
 * a negative directional score; relative IV versus realized volatility maps
 * to the volatility score.
 */
export function buildOptionsSignal(market, optionChain, { asOf = new Date().toISOString() } = {}) {
  const decisionTime = isoTimestamp(asOf, "options signal asOf");
  if (!Array.isArray(optionChain) || optionChain.length === 0) return null;
  if (market.spot <= 0) throw new TypeError("market spot must be positive");
  const validChain = optionChain.filter((quote) => {
    try {
      validateOptionQuote(quote);
      return quote.underlying === market.underlying && quote.feed === market.option_feed;
    } catch {
      return false;
    }
  });
  if (validChain.length === 0) return null;
  const expiries = [...new Set(validChain.map((quote) => quote.expiry))].sort();
  let call;
  let put;
  let expiry;
  for (const candidateExpiry of expiries) {
    const calls = validChain.filter((quote) => quote.expiry === candidateExpiry && quote.type === "call");
    const puts = validChain.filter((quote) => quote.expiry === candidateExpiry && quote.type === "put");
    if (calls.length > 0 && puts.length > 0) {
      call = closestToSpot(calls, market.spot);
      put = closestToSpot(puts, market.spot);
      expiry = candidateExpiry;
      break;
    }
  }
  if (!call || !put) return null;
  const maximumAge = Math.max(...validChain.map((quote) => requireFinite(quote.quote_age_seconds, "option quote age")));
  const feedMaximum = POLICY.quoteMaxAgeSeconds[market.option_feed];
  if (!Number.isFinite(feedMaximum) || maximumAge < 0 || maximumAge > feedMaximum) throw new TypeError("options surface is stale or has an unknown feed");
  const publishedAt = new Date(new Date(decisionTime).getTime() - maximumAge * 1000).toISOString();
  const recentReturns = market.historical_log_returns.slice(-20);
  const realizedVolatility = Math.max(standardDeviation(recentReturns) * Math.sqrt(252), 0.05);
  const putCallSkew = put.iv - call.iv;
  const atTheMoneyIv = (put.iv + call.iv) / 2;
  const content = {
    underlying: market.underlying,
    expiry,
    feed: market.option_feed,
    selected_call: call,
    selected_put: put,
    option_chain_sha256: sha256(validChain),
    option_count: validChain.length,
    rejected_option_count: optionChain.length - validChain.length,
  };
  const evidence = [createCanonicalEvidenceRecord({
    family: "options",
    underlying: market.underlying,
    sourceKind: "alpaca_options",
    sourceUri: `${DATA_ORIGIN}/v1beta1/options/snapshots/${market.underlying}`,
    originId: `alpaca.options.${market.underlying}.v1`,
    publishedAt,
    receivedAt: decisionTime,
    content,
  })];
  const averageOpenInterest = validChain.reduce((sum, quote) => sum + requireFinite(quote.open_interest, "open interest"), 0) / validChain.length;
  return sourceSignal({
    family: "options",
    underlying: market.underlying,
    directionScore: -Math.tanh(putCallSkew / 0.035),
    volatilityScore: (atTheMoneyIv - realizedVolatility) / Math.max(realizedVolatility, 0.10),
    quality: 0.82 + Math.min(validChain.length, 20) / 20 * 0.12 + Math.min(averageOpenInterest, 5_000) / 5_000 * 0.04,
    freshness: 1 - maximumAge / feedMaximum,
    calibration: 0.82,
    independence: 0.94,
    evidence,
    explanation: `Deterministic ${expiry} near-spot put-minus-call IV skew is ${(putCallSkew * 100).toFixed(2)} points; mean near-spot IV is ${(atTheMoneyIv * 100).toFixed(1)}% versus ${(realizedVolatility * 100).toFixed(1)}% realized.`,
    asOf: decisionTime,
  });
}

function safeNewsUri(articleId, candidate) {
  if (typeof candidate === "string") {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:") return parsed.toString();
    } catch {
      // The canonical Alpaca endpoint below remains the source-of-record URI.
    }
  }
  return `${DATA_ORIGIN}/v1beta1/news#article-${encodeURIComponent(articleId)}`;
}

export function normalizeAlpacaNews(newsResponse, { underlying = "SPY", asOf = new Date().toISOString(), limit = 12 } = {}) {
  const decisionTime = isoTimestamp(asOf, "news asOf");
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new TypeError("news limit must be from one to twelve");
  if (!newsResponse || !Array.isArray(newsResponse.news)) return [];
  const byDuplicateGroup = new Map();
  for (const article of newsResponse.news.slice(0, limit)) {
    if (!article || typeof article !== "object") continue;
    const articleId = String(article.id ?? "").trim();
    const headline = typeof article.headline === "string" ? article.headline.trim() : "";
    const summary = typeof article.summary === "string" ? article.summary.trim() : "";
    const publishedAt = new Date(article.created_at);
    const decision = new Date(decisionTime);
    const ageHours = (decision.getTime() - publishedAt.getTime()) / 3_600_000;
    if (!articleId || headline.length < 8 || Number.isNaN(publishedAt.getTime()) || ageHours < 0 || ageHours > MAX_NEWS_AGE_HOURS) continue;
    if (Array.isArray(article.symbols) && article.symbols.length > 0 && !article.symbols.includes(underlying)) continue;
    const text = `${headline}. ${summary}`.trim();
    if (text.length < 12 || text.length > 4_000) continue;
    const updatedAt = article.updated_at ? new Date(article.updated_at) : publishedAt;
    if (Number.isNaN(updatedAt.getTime()) || updatedAt < publishedAt || updatedAt > decision) continue;
    const duplicateContent = {
      underlying,
      headline: headline.toLowerCase().replace(/\s+/g, " "),
      summary: summary.toLowerCase().replace(/\s+/g, " "),
    };
    const record = createCanonicalEvidenceRecord({
      family: "events",
      underlying,
      sourceKind: "news",
      sourceUri: safeNewsUri(articleId, article.url),
      originId: `alpaca.news.${articleId}`,
      publishedAt: publishedAt.toISOString(),
      receivedAt: decisionTime,
      content: text,
      duplicateContent,
    });
    if (!byDuplicateGroup.has(record.duplicate_group)) byDuplicateGroup.set(record.duplicate_group, { record, text, ageHours });
  }
  return [...byDuplicateGroup.values()].sort((left, right) => left.record.published_at.localeCompare(right.record.published_at)
    || left.record.evidence_id.localeCompare(right.record.evidence_id));
}

export async function buildEventSignal(newsResponse, {
  extractor,
  underlying = "SPY",
  asOf = new Date().toISOString(),
} = {}) {
  if (!extractor || typeof extractor.assessDocuments !== "function") return null;
  const decisionTime = isoTimestamp(asOf, "event signal asOf");
  const documents = normalizeAlpacaNews(newsResponse, { underlying, asOf: decisionTime });
  if (documents.length === 0) return null;
  const requestedIds = documents.map(({ record }) => record.evidence_id);
  const assessment = validateEvidenceAssessment(await extractor.assessDocuments(
    documents.map(({ record, text }) => ({ record, text })),
    { underlying, asOf: decisionTime },
  ), requestedIds);
  const byId = new Map(assessment.assessments.map((row) => [row.evidence_id, row]));
  const weighted = documents.map((document) => {
    const row = byId.get(document.record.evidence_id);
    if (!row) throw new TypeError("event assessment omitted canonical evidence");
    return { document, row, weight: Math.exp(-document.ageHours / 24) };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const directionScore = weighted.reduce((sum, item) => sum + item.weight * item.row.direction_score, 0) / totalWeight * EVENT_SCORE_SHRINKAGE;
  const volatilityScore = weighted.reduce((sum, item) => sum + item.weight * item.row.volatility_score, 0) / totalWeight * EVENT_SCORE_SHRINKAGE;
  const freshness = weighted.reduce((sum, item) => sum + item.weight, 0) / weighted.length;
  return sourceSignal({
    family: "events",
    underlying,
    directionScore,
    volatilityScore,
    quality: 0.75 + Math.min(weighted.length, 5) * 0.03,
    freshness,
    calibration: 0.70,
    independence: 0.88 + Math.min(weighted.length, 3) * 0.02,
    evidence: weighted.map((item) => item.document.record),
    explanation: `Local extraction assessed ${weighted.length} canonical Alpaca news item(s); deterministic age weighting and ${EVENT_SCORE_SHRINKAGE.toFixed(2)} shrinkage produced the bounded event score.`,
    asOf: decisionTime,
  });
}

export async function buildLiveSignals({
  market,
  optionChain,
  newsResponse,
  extractor,
  asOf = new Date().toISOString(),
} = {}) {
  const decisionTime = isoTimestamp(asOf, "live signal asOf");
  const signals = [buildMarketSignal(market, { asOf: decisionTime })];
  const omissions = [];
  const options = buildOptionsSignal(market, optionChain, { asOf: decisionTime });
  if (options) signals.push(options);
  else omissions.push({ family: "options", reason: "NO_COMPARABLE_CALL_PUT_SURFACE" });
  if (!newsResponse || !Array.isArray(newsResponse.news)) {
    // An explicitly empty Alpaca `news` array is a valid observation. A
    // missing/malformed envelope is an unavailable evidence source and must
    // not be silently reclassified as "no relevant news" for a judged entry.
    omissions.push({ family: "events", reason: "NEWS_FEED_UNAVAILABLE" });
  } else if (!extractor) {
    omissions.push({ family: "events", reason: "LOCAL_EVENT_EXTRACTOR_UNAVAILABLE" });
  } else {
    try {
      const events = await buildEventSignal(newsResponse, { extractor, underlying: market.underlying, asOf: decisionTime });
      if (events) signals.push(events);
      else omissions.push({ family: "events", reason: "NO_USABLE_TIMESTAMPED_NEWS" });
    } catch (error) {
      omissions.push({ family: "events", reason: "EVENT_EXTRACTION_FAILED", detail_sha256: sha256(String(error?.message ?? error)) });
    }
  }
  return { signals, omissions };
}

export function buildAlpacaPaperLiveFixture({
  snapshot,
  signals,
  account,
  positions = [],
  openOrders = [],
  clock,
  decisionTime = new Date().toISOString(),
  runId,
  codeVersion = "working-tree",
  horizonSessions = 5,
}) {
  const asOf = isoTimestamp(decisionTime, "live fixture decision time");
  if (!snapshot?.market || !Array.isArray(snapshot.option_chain)) throw new TypeError("live fixture requires a normalized Alpaca snapshot");
  if (snapshot.market.history_mode === "synthetic_fixture" || !String(snapshot.market.history_mode).startsWith("alpaca_")) {
    throw new TypeError("alpaca_paper_live fixture refuses synthetic or unidentified market history");
  }
  if (!Array.isArray(signals) || signals.length === 0) throw new TypeError("live fixture requires at least one canonical signal");
  signals.forEach((signal) => validateSourceSignal(signal, { asOf }));
  if (!Array.isArray(positions) || !Array.isArray(openOrders)) throw new TypeError("positions and open orders must be complete arrays");
  const equity = Number(account?.equity);
  if (!Number.isFinite(equity) || equity <= 0) throw new TypeError("paper account equity is invalid");
  const accountBlocked = account?.trading_blocked === true
    || account?.account_blocked === true
    || account?.trade_suspended_by_user === true
    || account?.status !== "ACTIVE"
    || positions.length > 0
    || openOrders.length > 0
    || clock?.is_open !== true;
  return {
    schema_version: "finly_fixture.v1",
    run_id: runId,
    decision_time: asOf,
    data_mode: "alpaca_paper_live",
    code_version: codeVersion,
    horizon_sessions: horizonSessions,
    account: {
      mode: "paper",
      base_url: POLICY.paperHost,
      execution_transport: "mcp",
      equity,
      open_defined_risk: 0,
      age_seconds: 0,
      trading_blocked: accountBlocked,
    },
    market: snapshot.market,
    signals,
    option_chain: snapshot.option_chain,
  };
}
