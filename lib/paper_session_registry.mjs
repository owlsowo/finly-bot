import { createHmac, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256, stableStringify } from "./canonical.mjs";

const REGISTRY_SCHEMA = "finly_paper_session_registry.v1";
const SESSION_SCHEMA = "finly_paper_session.v1";
const FILE_NAME = "paper-sessions.json";
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SESSIONS = 256;

const HASH = /^sha256:[a-f0-9]{64}$/;
const HMAC = /^hmac-sha256:[a-f0-9]{64}$/;
const SESSION_ID = /^sha256:[a-f0-9]{64}$/;
const CLIENT_ORDER_ID = /^finly-[a-f0-9]{20}$/;
const SAFE_REASON = /^[a-z][a-z0-9_.:-]{2,80}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const PAPER_SESSION_STATUSES = Object.freeze({
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  FROZEN: "FROZEN",
  CLOSED: "CLOSED",
  ABSENT: "ABSENT",
});

export const NONTERMINAL_PAPER_SESSION_STATUSES = Object.freeze([
  PAPER_SESSION_STATUSES.PENDING,
  PAPER_SESSION_STATUSES.ACTIVE,
  PAPER_SESSION_STATUSES.FROZEN,
]);

export const TERMINAL_PAPER_SESSION_STATUSES = Object.freeze([
  PAPER_SESSION_STATUSES.CLOSED,
  PAPER_SESSION_STATUSES.ABSENT,
]);

const NONTERMINAL = new Set(NONTERMINAL_PAPER_SESSION_STATUSES);
const TERMINAL = new Set(TERMINAL_PAPER_SESSION_STATUSES);
const ALL_STATUSES = new Set([...NONTERMINAL, ...TERMINAL]);

const REGISTRY_KEYS = ["schema_version", "revision", "updated_at", "sessions", "signature"];
const REGISTRY_BODY_KEYS = ["schema_version", "revision", "updated_at", "sessions"];
const SESSION_KEYS = [
  "schema_version",
  "session_id",
  "revision",
  "status",
  "ever_active",
  "created_at",
  "updated_at",
  "terminal_at",
  "status_reason",
  "status_evidence_sha256",
  "certificate",
  "entry_projection",
  "history",
];
const HISTORY_KEYS = ["revision", "at", "from", "to", "reason", "evidence_sha256"];
const ENTRY_KEYS = ["client_order_id", "order_class", "qty", "type", "time_in_force", "limit_price", "legs"];
const ENTRY_LEG_KEYS = ["symbol", "ratio_qty", "side", "position_intent"];
const CERTIFICATE_KEYS = [
  "schema_version",
  "run_id",
  "created_at",
  "expires_at",
  "mode",
  "data_mode",
  "authorization_scope",
  "signer_key_id",
  "decision",
  "proposed_decision",
  "intent_sha256",
  "candidate_id",
  "candidate_snapshot_sha256",
  "desired_order_projection_sha256",
  "policy_sha256",
  "code_version",
  "evidence_root",
  "horizon_sessions",
  "account_snapshot_sha256",
  "market_snapshot_sha256",
  "market_spot",
  "market_observed_at",
  "option_feed",
  "quantity",
  "max_loss_per_contract",
  "reserved_max_loss",
  "max_entry_debit",
  "account_equity",
  "account_open_defined_risk",
  "conservative_ev",
  "probability_profit",
  "expected_shortfall_95",
  "source_removal_summary",
  "perturbation_summary",
  "checks",
  "certified",
  "rejection_codes",
  "nonce",
  "certificate_id",
  "signature",
];
const CHECK_KEYS = [
  "paper_endpoint_locked",
  "account_fresh",
  "account_not_blocked",
  "option_feed_identified",
  "quote_fresh",
  "source_removal_stable",
  "perturbations_stable",
  "conservative_ev_positive",
  "probability_gate",
  "quantity_positive",
  "aggregate_risk_cap",
  "execution_transport_mcp",
];
const SOURCE_SUMMARY_KEYS = ["base_direction", "variants", "passed"];
const SOURCE_VARIANT_KEYS = [
  "removed_family",
  "direction",
  "direction_score",
  "coverage",
  "agreement",
  "stable_direction",
  "trade_gate",
  "compiled_action",
  "compiled_candidate_id",
  "compiled_candidate_ev",
  "action_stable",
  "fixed_candidate_ev",
  "fixed_candidate_passes",
];
const PERTURBATION_KEYS = [
  "count",
  "direction_flips",
  "rejected_variants",
  "fifth_percentile_conservative_ev",
  "nonzero_direction_rate",
  "trade_rate",
  "same_structure_rate",
];
const SOURCE_FAMILIES = new Set(["market", "options", "events", "prediction_market"]);
const ENTRY_ACTIONS = new Set(["BULL_CALL_DEBIT_SPREAD", "BEAR_PUT_DEBIT_SPREAD"]);

function clone(value) {
  return structuredClone(value);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || !actual.every((key, index) => key === wanted[index])) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function assertHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} must be a SHA-256 hash`);
}

function assertIso(value, label) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
}

function assertFinite(value, label, { minimum = -Infinity, maximum = Infinity } = {}) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} is outside its allowed range`);
}

function assertSigningSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    throw new Error("paper-session registry signing secret must be at least 32 bytes");
  }
}

function signatureFor(body, secret) {
  return `hmac-sha256:${createHmac("sha256", secret).update(stableStringify(body)).digest("hex")}`;
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertReason(reason) {
  if (typeof reason !== "string" || !SAFE_REASON.test(reason)) {
    throw new Error("paper-session status reason must be a short machine-safe code");
  }
}

function assertNoCredentialFields(value, path = "record") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const allowedSecurityMetadata = new Set(["authorization_scope"]);
    if (!allowedSecurityMetadata.has(key)
      && /(api[_-]?key|secret|token|password|credential|cookie|authorization|account[_-]?(id|number)|broker[_-]?account)/i.test(key)) {
      throw new Error(`${path} contains a forbidden credential or account field`);
    }
    assertNoCredentialFields(item, `${path}.${key}`);
  }
}

function parseOccSymbol(symbol) {
  const match = /^(SPY)(\d{6})([CP])(\d{8})$/.exec(String(symbol));
  if (!match) throw new Error("entry projection contains an invalid or non-allowlisted option symbol");
  const date = match[2];
  const year = 2000 + Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const day = Number(date.slice(4, 6));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new Error("entry projection option symbol contains an invalid expiry");
  }
  return { underlying: match[1], expiry: date, right: match[3], strike: Number(match[4]) / 1000 };
}

function validateSourceRemovalSummary(summary, certificate) {
  exactKeys(summary, SOURCE_SUMMARY_KEYS, "certificate source-removal summary");
  if (!new Set(["bullish", "bearish"]).has(summary.base_direction) || summary.passed !== true) {
    throw new Error("certificate source-removal summary is not a passed directional result");
  }
  if (!Array.isArray(summary.variants) || summary.variants.length < 1 || summary.variants.length > SOURCE_FAMILIES.size) {
    throw new Error("certificate source-removal variants are invalid");
  }
  const seen = new Set();
  for (const variant of summary.variants) {
    exactKeys(variant, SOURCE_VARIANT_KEYS, "certificate source-removal variant");
    if (!SOURCE_FAMILIES.has(variant.removed_family) || seen.has(variant.removed_family)) {
      throw new Error("certificate source-removal families are invalid");
    }
    seen.add(variant.removed_family);
    if (!new Set(["bullish", "bearish"]).has(variant.direction)) throw new Error("certificate source-removal direction is invalid");
    assertFinite(variant.direction_score, "certificate source-removal direction score", { minimum: -1, maximum: 1 });
    assertFinite(variant.coverage, "certificate source-removal coverage", { minimum: 0, maximum: 1 });
    assertFinite(variant.agreement, "certificate source-removal agreement", { minimum: 0, maximum: 1 });
    exactKeys(variant.trade_gate, ["ok"], "certificate source-removal trade gate");
    if (variant.stable_direction !== true || variant.trade_gate.ok !== true || variant.compiled_action !== certificate.decision
      || variant.action_stable !== true || variant.fixed_candidate_passes !== true) {
      throw new Error("certificate source-removal variant is not a passed result");
    }
    assertHash(variant.compiled_candidate_id, "certificate source-removal candidate ID");
    assertFinite(variant.compiled_candidate_ev, "certificate source-removal compiled EV");
    assertFinite(variant.fixed_candidate_ev, "certificate source-removal fixed-candidate EV");
  }
}

function validatePerturbationSummary(summary) {
  exactKeys(summary, PERTURBATION_KEYS, "certificate perturbation summary");
  if (!Number.isInteger(summary.count) || summary.count < 1
    || !Number.isInteger(summary.direction_flips) || summary.direction_flips < 0
    || !Number.isInteger(summary.rejected_variants) || summary.rejected_variants < 0) {
    throw new Error("certificate perturbation counts are invalid");
  }
  assertFinite(summary.fifth_percentile_conservative_ev, "certificate perturbation fifth-percentile EV");
  for (const key of ["nonzero_direction_rate", "trade_rate", "same_structure_rate"]) {
    assertFinite(summary[key], `certificate perturbation ${key}`, { minimum: 0, maximum: 1 });
  }
}

function validateCertificate(certificate, certificateSigningSecret) {
  exactKeys(certificate, CERTIFICATE_KEYS, "paper-session certificate");
  assertNoCredentialFields(certificate, "paper-session certificate");
  if (certificate.schema_version !== "risk_certificate.v2"
    || certificate.mode !== "paper"
    || certificate.data_mode !== "alpaca_paper_live"
    || certificate.authorization_scope !== "paper_submit"
    || certificate.certified !== true
    || !ENTRY_ACTIONS.has(certificate.decision)
    || certificate.proposed_decision !== certificate.decision) {
    throw new Error("paper-session certificate is not an authorized paper-submit certificate");
  }
  if (typeof certificate.run_id !== "string" || !/^[A-Za-z0-9._:-]{4,200}$/.test(certificate.run_id)) {
    throw new Error("paper-session certificate run ID is invalid");
  }
  if (typeof certificate.code_version !== "string" || !/^[A-Za-z0-9._@:+/-]{1,200}$/.test(certificate.code_version)) {
    throw new Error("paper-session certificate code version is invalid");
  }
  assertIso(certificate.created_at, "certificate created_at");
  assertIso(certificate.expires_at, "certificate expires_at");
  assertIso(certificate.market_observed_at, "certificate market_observed_at");
  if (new Date(certificate.expires_at) <= new Date(certificate.created_at)) throw new Error("certificate validity interval is invalid");
  for (const key of [
    "signer_key_id",
    "intent_sha256",
    "candidate_id",
    "candidate_snapshot_sha256",
    "desired_order_projection_sha256",
    "policy_sha256",
    "evidence_root",
    "account_snapshot_sha256",
    "market_snapshot_sha256",
  ]) assertHash(certificate[key], `certificate ${key}`);
  if (!Number.isInteger(certificate.quantity) || certificate.quantity < 1 || certificate.quantity > 4) {
    throw new Error("certificate quantity is outside the paper policy");
  }
  if (!Number.isInteger(certificate.horizon_sessions) || certificate.horizon_sessions < 1 || certificate.horizon_sessions > 20) {
    throw new Error("certificate horizon is outside the paper policy");
  }
  for (const [key, minimum] of [
    ["market_spot", Number.EPSILON],
    ["max_loss_per_contract", Number.EPSILON],
    ["reserved_max_loss", Number.EPSILON],
    ["max_entry_debit", Number.EPSILON],
    ["account_equity", Number.EPSILON],
    ["account_open_defined_risk", 0],
  ]) assertFinite(certificate[key], `certificate ${key}`, { minimum });
  for (const key of ["conservative_ev", "expected_shortfall_95"]) assertFinite(certificate[key], `certificate ${key}`);
  assertFinite(certificate.probability_profit, "certificate probability_profit", { minimum: 0, maximum: 1 });
  if (!new Set(["indicative", "opra"]).has(certificate.option_feed)) throw new Error("certificate option feed is invalid");
  exactKeys(certificate.checks, CHECK_KEYS, "certificate checks");
  if (!CHECK_KEYS.every((key) => certificate.checks[key] === true)) throw new Error("certificate contains a failed execution check");
  if (!Array.isArray(certificate.rejection_codes) || certificate.rejection_codes.length !== 0) {
    throw new Error("certified paper-session certificate contains rejection codes");
  }
  if (!/^permit:[a-f0-9]{64}$/.test(certificate.nonce)) throw new Error("certificate nonce is invalid");
  if (typeof certificate.signature !== "string" || !HMAC.test(certificate.signature)) throw new Error("certificate is not signed");
  validateSourceRemovalSummary(certificate.source_removal_summary, certificate);
  validatePerturbationSummary(certificate.perturbation_summary);
  const body = { ...certificate };
  const suppliedId = body.certificate_id;
  delete body.certificate_id;
  delete body.signature;
  assertHash(suppliedId, "certificate ID");
  if (sha256(body) !== suppliedId) throw new Error("certificate ID does not match its exact signed body");
  if (!constantTimeEqual(certificate.signature, signatureFor(body, certificateSigningSecret))) {
    throw new Error("paper-session certificate HMAC authentication failed");
  }
  return true;
}

function validateEntryProjection(projection, certificate) {
  exactKeys(projection, ENTRY_KEYS, "paper-session entry projection");
  assertNoCredentialFields(projection, "paper-session entry projection");
  if (!CLIENT_ORDER_ID.test(projection.client_order_id)
    || projection.order_class !== "mleg"
    || projection.type !== "limit"
    || projection.time_in_force !== "day"
    || projection.qty !== String(certificate.quantity)
    || !/^\d+\.\d{2}$/.test(projection.limit_price)
    || Number(projection.limit_price) <= 0
    || Number(projection.limit_price) > certificate.max_entry_debit) {
    throw new Error("paper-session entry projection violates the certified entry policy");
  }
  const expectedClientOrderId = `finly-${sha256({ runId: certificate.run_id, candidate_id: certificate.candidate_id }).slice(-20)}`;
  if (projection.client_order_id !== expectedClientOrderId) throw new Error("paper-session entry client order ID is not certificate-derived");
  if (!Array.isArray(projection.legs) || projection.legs.length !== 2) throw new Error("paper-session entry projection must contain two legs");
  const expectedLegs = [
    { side: "buy", position_intent: "buy_to_open" },
    { side: "sell", position_intent: "sell_to_open" },
  ];
  const parsed = projection.legs.map((leg, index) => {
    exactKeys(leg, ENTRY_LEG_KEYS, "paper-session entry leg");
    if (leg.ratio_qty !== "1" || leg.side !== expectedLegs[index].side || leg.position_intent !== expectedLegs[index].position_intent) {
      throw new Error("paper-session entry leg violates the opening-spread policy");
    }
    return parseOccSymbol(leg.symbol);
  });
  if (parsed[0].underlying !== parsed[1].underlying || parsed[0].expiry !== parsed[1].expiry || parsed[0].right !== parsed[1].right) {
    throw new Error("paper-session entry legs do not form one vertical spread");
  }
  if (certificate.decision === "BULL_CALL_DEBIT_SPREAD" && !(parsed[0].right === "C" && parsed[0].strike < parsed[1].strike)) {
    throw new Error("paper-session entry projection differs from its bullish certificate");
  }
  if (certificate.decision === "BEAR_PUT_DEBIT_SPREAD" && !(parsed[0].right === "P" && parsed[0].strike > parsed[1].strike)) {
    throw new Error("paper-session entry projection differs from its bearish certificate");
  }
  if (sha256(projection) !== certificate.desired_order_projection_sha256) {
    throw new Error("paper-session entry projection differs from the certified exact projection");
  }
  return true;
}

function expectedSessionId(certificate, entryProjection) {
  return sha256({
    certificate_id: certificate.certificate_id,
    entry_projection_sha256: sha256(entryProjection),
  });
}

function allowedTransition(session, target) {
  if (TERMINAL.has(session.status)) return false;
  if (target === session.status) return true;
  if (session.status === "PENDING") return new Set(["ACTIVE", "FROZEN", "ABSENT"]).has(target);
  if (session.status === "ACTIVE") return new Set(["FROZEN", "CLOSED"]).has(target);
  if (session.status === "FROZEN") {
    return target === "FROZEN" || target === "ACTIVE" || (session.ever_active ? target === "CLOSED" : target === "ABSENT");
  }
  return false;
}

function validateHistoryEvent(event, index) {
  exactKeys(event, HISTORY_KEYS, "paper-session history event");
  if (event.revision !== index || !ALL_STATUSES.has(event.to) || (event.from !== null && !ALL_STATUSES.has(event.from))) {
    throw new Error("paper-session history transition metadata is invalid");
  }
  assertIso(event.at, "paper-session history timestamp");
  assertReason(event.reason);
  if (event.evidence_sha256 !== null) assertHash(event.evidence_sha256, "paper-session history evidence");
}

function validateSession(session, certificateSigningSecret) {
  exactKeys(session, SESSION_KEYS, "paper-session record");
  if (session.schema_version !== SESSION_SCHEMA || !SESSION_ID.test(session.session_id) || !ALL_STATUSES.has(session.status)) {
    throw new Error("paper-session metadata is invalid");
  }
  if (!Number.isInteger(session.revision) || session.revision < 0
    || !Array.isArray(session.history) || session.history.length !== session.revision + 1) {
    throw new Error("paper-session revision history is invalid");
  }
  validateCertificate(session.certificate, certificateSigningSecret);
  validateEntryProjection(session.entry_projection, session.certificate);
  if (session.session_id !== expectedSessionId(session.certificate, session.entry_projection)) {
    throw new Error("paper-session ID does not bind its certificate and entry projection");
  }
  assertIso(session.created_at, "paper-session created_at");
  assertIso(session.updated_at, "paper-session updated_at");
  if (new Date(session.updated_at) < new Date(session.created_at)) throw new Error("paper-session timestamps are inverted");
  assertReason(session.status_reason);
  if (session.status_evidence_sha256 !== null) assertHash(session.status_evidence_sha256, "paper-session status evidence");
  session.history.forEach(validateHistoryEvent);
  for (let index = 0; index < session.history.length; index += 1) {
    const event = session.history[index];
    if (index === 0) {
      if (event.from !== null || event.to !== "PENDING") throw new Error("paper-session history does not begin at PENDING");
    } else {
      const priorStatus = session.history[index - 1].to;
      const priorEverActive = session.history.slice(0, index).some((item) => item.to === "ACTIVE");
      if (event.from !== priorStatus || !allowedTransition({ status: priorStatus, ever_active: priorEverActive }, event.to)) {
        throw new Error("paper-session history contains an unsafe transition");
      }
    }
  }
  const finalEvent = session.history.at(-1);
  if (finalEvent.to !== session.status || finalEvent.at !== session.updated_at || finalEvent.reason !== session.status_reason
    || finalEvent.evidence_sha256 !== session.status_evidence_sha256) {
    throw new Error("paper-session current state differs from its history");
  }
  const everActive = session.history.some((event) => event.to === "ACTIVE");
  if (session.ever_active !== everActive) throw new Error("paper-session active history marker is invalid");
  if (TERMINAL.has(session.status)) {
    if (session.terminal_at !== session.updated_at || session.status_evidence_sha256 === null) {
      throw new Error("paper-session terminal state lacks hashed reconciliation evidence");
    }
    if (session.status === "CLOSED" && !session.ever_active) throw new Error("an unsubmitted paper session cannot be marked CLOSED");
    if (session.status === "ABSENT" && session.ever_active) throw new Error("an active paper session cannot be marked ABSENT");
  } else if (session.terminal_at !== null) {
    throw new Error("nonterminal paper session contains a terminal timestamp");
  }
  return true;
}

function emptyRegistry() {
  return {
    schema_version: REGISTRY_SCHEMA,
    revision: 0,
    updated_at: null,
    sessions: [],
  };
}

function registryBody(registry) {
  return Object.fromEntries(REGISTRY_BODY_KEYS.map((key) => [key, registry[key]]));
}

function validateRegistry(registry, signingSecret, certificateSigningSecret) {
  exactKeys(registry, REGISTRY_KEYS, "paper-session registry");
  if (registry.schema_version !== REGISTRY_SCHEMA || !Number.isInteger(registry.revision) || registry.revision < 1) {
    throw new Error("paper-session registry metadata is invalid");
  }
  if (!Array.isArray(registry.sessions) || registry.sessions.length < 1 || registry.sessions.length > MAX_SESSIONS) {
    throw new Error("paper-session registry session collection is invalid");
  }
  assertIso(registry.updated_at, "paper-session registry updated_at");
  if (typeof registry.signature !== "string" || !HMAC.test(registry.signature)
    || !constantTimeEqual(registry.signature, signatureFor(registryBody(registry), signingSecret))) {
    throw new Error("paper-session registry HMAC authentication failed");
  }
  const ids = new Set();
  let mutationCount = 0;
  let latestUpdatedAt = null;
  for (const session of registry.sessions) {
    validateSession(session, certificateSigningSecret);
    if (ids.has(session.session_id)) throw new Error("paper-session registry contains a duplicate session");
    ids.add(session.session_id);
    mutationCount += session.revision + 1;
    if (latestUpdatedAt === null || new Date(session.updated_at) > new Date(latestUpdatedAt)) latestUpdatedAt = session.updated_at;
  }
  if (registry.revision !== mutationCount || registry.updated_at !== latestUpdatedAt) {
    throw new Error("paper-session registry revision chain is incomplete");
  }
  if (registry.sessions.filter((session) => NONTERMINAL.has(session.status)).length > 1) {
    throw new Error("paper-session registry contains more than one open session");
  }
  return true;
}

function nextTimestamp(now, current) {
  const value = now();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("paper-session registry clock returned an invalid time");
  const timestamp = date.toISOString();
  if (current !== null && new Date(timestamp) < new Date(current)) throw new Error("paper-session registry clock moved backwards");
  return timestamp;
}

function ownerUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function assertOwned(metadata, label, mode, kind) {
  if ((kind === "directory" && (!metadata.isDirectory() || metadata.isSymbolicLink()))
    || (kind === "file" && (!metadata.isFile() || metadata.isSymbolicLink()))) {
    throw new Error(`${label} is not a private real ${kind}`);
  }
  if ((metadata.mode & 0o777) !== mode) throw new Error(`${label} permissions are not owner-only`);
  const uid = ownerUid();
  if (uid !== null && metadata.uid !== uid) throw new Error(`${label} is not owned by the current user`);
}

/**
 * HMAC-authenticated, atomic registry for restartable Alpaca paper sessions.
 *
 * PENDING is written before entry submission. PENDING, ACTIVE, and FROZEN all
 * retain the one-open-session lock. CLOSED requires evidence after a session
 * has been active; ABSENT requires evidence that a never-active submission did
 * not reach the broker. Evidence is retained only as a SHA-256 digest.
 */
export class FilePaperSessionRegistry {
  constructor(directory, signingSecret, {
    now = () => new Date(),
    certificateSigningSecret = signingSecret,
  } = {}) {
    if (typeof directory !== "string" || directory.length < 2) throw new Error("paper-session registry directory is required");
    assertSigningSecret(signingSecret);
    assertSigningSecret(certificateSigningSecret);
    if (typeof now !== "function") throw new Error("paper-session registry clock must be a function");
    this.directory = resolve(directory);
    this.filePath = join(this.directory, FILE_NAME);
    this.lockPath = join(this.directory, ".paper-sessions.lock");
    this.signingSecret = signingSecret;
    this.certificateSigningSecret = certificateSigningSecret;
    this.now = now;
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.directory);
    assertOwned(metadata, "paper-session registry directory", 0o700, "directory");
  }

  async loadOpen() {
    const state = await this.#read();
    const sessions = state.sessions.filter((session) => NONTERMINAL.has(session.status));
    if (sessions.length > 1) throw new Error("paper-session registry contains more than one open session");
    return sessions.length === 1 ? clone(sessions[0]) : null;
  }

  async load(sessionId) {
    if (!SESSION_ID.test(String(sessionId))) throw new Error("paper-session ID is invalid");
    const state = await this.#read();
    const session = state.sessions.find((item) => item.session_id === sessionId);
    return session ? clone(session) : null;
  }

  async list() {
    const state = await this.#read();
    return clone({
      schema_version: state.schema_version,
      revision: state.revision,
      updated_at: state.updated_at,
      sessions: state.sessions,
    });
  }

  async createPending({ certificate, entryProjection, expectedRegistryRevision } = {}) {
    validateCertificate(certificate, this.certificateSigningSecret);
    validateEntryProjection(entryProjection, certificate);
    const exactCertificate = clone(certificate);
    const exactEntryProjection = clone(entryProjection);
    const sessionId = expectedSessionId(exactCertificate, exactEntryProjection);
    return this.#mutate(async (state) => {
      if (expectedRegistryRevision !== undefined
        && (!Number.isInteger(expectedRegistryRevision) || expectedRegistryRevision !== state.revision)) {
        throw new Error("paper-session registry compare-and-swap conflict");
      }
      const duplicate = state.sessions.find((session) => session.session_id === sessionId);
      if (duplicate) {
        if (stableStringify(duplicate.certificate) !== stableStringify(exactCertificate)
          || stableStringify(duplicate.entry_projection) !== stableStringify(exactEntryProjection)) {
          throw new Error("paper-session ID collision");
        }
        if (NONTERMINAL.has(duplicate.status)) return { changed: false, result: clone(duplicate) };
        throw new Error("a terminal paper session cannot be recreated");
      }
      if (state.sessions.length >= MAX_SESSIONS) throw new Error("paper-session registry capacity is exhausted");
      if (state.sessions.some((session) => NONTERMINAL.has(session.status))) {
        throw new Error("another paper session is already open");
      }
      const at = nextTimestamp(this.now, state.updated_at);
      const evidence = sha256({
        certificate_id: exactCertificate.certificate_id,
        entry_projection_sha256: sha256(exactEntryProjection),
      });
      const reason = "created_before_submission";
      const session = {
        schema_version: SESSION_SCHEMA,
        session_id: sessionId,
        revision: 0,
        status: "PENDING",
        ever_active: false,
        created_at: at,
        updated_at: at,
        terminal_at: null,
        status_reason: reason,
        status_evidence_sha256: evidence,
        certificate: exactCertificate,
        entry_projection: exactEntryProjection,
        history: [{ revision: 0, at, from: null, to: "PENDING", reason, evidence_sha256: evidence }],
      };
      validateSession(session, this.certificateSigningSecret);
      state.sessions.push(session);
      state.revision += 1;
      state.updated_at = at;
      return { changed: true, result: clone(session) };
    });
  }

  async mark(sessionId, status, {
    expectedRevision,
    expectedRegistryRevision,
    reason,
    evidenceSha256 = null,
  } = {}) {
    if (!SESSION_ID.test(String(sessionId))) throw new Error("paper-session ID is invalid");
    if (!ALL_STATUSES.has(status) || status === "PENDING") throw new Error("paper-session target status is invalid");
    const defaultReasons = {
      ACTIVE: "entry_reconciled",
      FROZEN: "runtime_frozen",
      CLOSED: "lifecycle_closed",
      ABSENT: "broker_entry_absent",
    };
    const statusReason = reason ?? defaultReasons[status];
    assertReason(statusReason);
    if (evidenceSha256 !== null) assertHash(evidenceSha256, "paper-session status evidence");
    if (new Set(["ACTIVE", "CLOSED", "ABSENT"]).has(status) && evidenceSha256 === null) {
      throw new Error(`${status} requires hashed reconciliation evidence`);
    }
    return this.#mutate(async (state) => {
      if (expectedRegistryRevision !== undefined
        && (!Number.isInteger(expectedRegistryRevision) || expectedRegistryRevision !== state.revision)) {
        throw new Error("paper-session registry compare-and-swap conflict");
      }
      const session = state.sessions.find((item) => item.session_id === sessionId);
      if (!session) throw new Error("paper session does not exist");
      if (!Number.isInteger(expectedRevision) || expectedRevision !== session.revision) {
        throw new Error("paper-session compare-and-swap conflict");
      }
      if (!allowedTransition(session, status)) throw new Error("paper-session status transition is unsafe");
      if (status === session.status
        && session.status_reason === statusReason
        && session.status_evidence_sha256 === evidenceSha256) {
        return { changed: false, result: clone(session) };
      }
      if (status === session.status && status !== "FROZEN") {
        throw new Error("paper-session status transition is redundant and inconsistent");
      }
      const at = nextTimestamp(this.now, state.updated_at);
      const previousStatus = session.status;
      const revision = session.revision + 1;
      session.revision = revision;
      session.status = status;
      session.ever_active = session.ever_active || status === "ACTIVE";
      session.updated_at = at;
      session.terminal_at = TERMINAL.has(status) ? at : null;
      session.status_reason = statusReason;
      session.status_evidence_sha256 = evidenceSha256;
      session.history.push({
        revision,
        at,
        from: previousStatus,
        to: status,
        reason: statusReason,
        evidence_sha256: evidenceSha256,
      });
      validateSession(session, this.certificateSigningSecret);
      state.revision += 1;
      state.updated_at = at;
      return { changed: true, result: clone(session) };
    });
  }

  markActive(sessionId, options) {
    return this.mark(sessionId, "ACTIVE", options);
  }

  markFrozen(sessionId, options) {
    return this.mark(sessionId, "FROZEN", options);
  }

  markClosed(sessionId, options) {
    return this.mark(sessionId, "CLOSED", options);
  }

  markAbsent(sessionId, options) {
    return this.mark(sessionId, "ABSENT", options);
  }

  async #mutate(operation) {
    await this.initialize();
    try {
      await mkdir(this.lockPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("paper-session registry is locked; fail closed");
      throw new Error("paper-session registry lock could not be acquired");
    }
    let temporary = null;
    try {
      const state = await this.#readInitialized();
      const outcome = await operation(state);
      if (!outcome?.changed) return outcome?.result;
      const body = registryBody(state);
      const envelope = { ...body, signature: signatureFor(body, this.signingSecret) };
      validateRegistry(envelope, this.signingSecret, this.certificateSigningSecret);
      const serialized = `${stableStringify(envelope)}\n`;
      if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw new Error("paper-session registry exceeds its size bound");
      temporary = `${this.filePath}.${process.pid}.${state.revision}.${sha256(serialized).slice(-12)}.tmp`;
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.filePath);
      temporary = null;
      await this.#syncDirectory();
      return outcome.result;
    } finally {
      if (temporary !== null) await unlink(temporary).catch(() => {});
      await rmdir(this.lockPath).catch(() => {});
    }
  }

  async #read() {
    await this.initialize();
    return this.#readInitialized();
  }

  async #readInitialized() {
    let metadata;
    try {
      metadata = await lstat(this.filePath);
    } catch (error) {
      if (error?.code === "ENOENT") return emptyRegistry();
      throw new Error("paper-session registry could not be inspected");
    }
    assertOwned(metadata, "paper-session registry file", 0o600, "file");
    if (metadata.size < 2 || metadata.size > MAX_FILE_BYTES) throw new Error("paper-session registry file exceeds its size bound");
    let serialized;
    try {
      serialized = await readFile(this.filePath, "utf8");
    } catch {
      throw new Error("paper-session registry could not be read");
    }
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error("paper-session registry contains invalid JSON");
    }
    validateRegistry(parsed, this.signingSecret, this.certificateSigningSecret);
    if (serialized !== `${stableStringify(parsed)}\n`) throw new Error("paper-session registry storage is not canonical");
    return registryBody(parsed);
  }

  async #syncDirectory() {
    const handle = await open(this.directory, "r");
    try {
      await handle.sync();
    } catch (error) {
      if (!new Set(["EINVAL", "ENOTSUP", "EISDIR"]).has(error?.code)) throw error;
    } finally {
      await handle.close();
    }
  }
}
