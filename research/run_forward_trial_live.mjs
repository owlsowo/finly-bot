import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ForwardMarketDataClient,
} from "../lib/forward_market_data.mjs";
import {
  FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA,
  FORWARD_TRIAL_LIVE_ID,
  FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING,
  FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION,
  FORWARD_TRIAL_LIVE_SYMBOLS,
  buildForwardTrialLiveAcquisition,
  buildForwardTrialLiveActivation,
  buildForwardTrialLiveAnchorManifest,
  buildForwardTrialLiveCommitment,
  forwardTrialLiveCommitmentFilename,
  hashForwardTrialLiveValue,
  validateForwardTrialLiveAnchorManifest,
  validateForwardTrialLiveActivation,
  validateForwardTrialLiveCommitment,
  validateForwardTrialLiveImplementationBinding,
} from "./forward_trial_live_core.mjs";

export const FORWARD_TRIAL_LIVE_ACTIVATION_PATH = "research/forward_trial_live/activation.json";
export const FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING_PATH =
  "research/forward_trial_live/runtime_manifest.json";
export const FORWARD_TRIAL_LIVE_PUBLIC_ANCHOR_DIRECTORY = "research/forward_trial_live/anchors";
export const FORWARD_TRIAL_LIVE_PRIVATE_COMMITMENT_DIRECTORY = "data/private/forward_trial_live/commitments";
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MARKET_TIME_ZONE = "America/New_York";
const CALENDAR_QUERY_END = "2026-09-04";
const APPEND_ACK = "APPEND_SIGNAL_COMMITMENT_WRITE_ONCE";
const APPEND_LOCK_PATH = "data/private/forward_trial_live/.append.lock";
const FORBIDDEN_PUBLIC_FIELDS = Object.freeze([
  "adjusted_close_rows",
  "raw_close_rows",
  "corporate_action_digests",
  "response_content_sha256",
  "request_parameters_sha256",
  "transport_receipts_sha256",
  "bar_timestamp",
  "acquisition_sha256",
]);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PUBLIC_ANCHORS = 10_000;

function fail(message) {
  throw new Error(message);
}

function canonicalBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function loadFrozenImplementationBinding({
  projectRoot = PROJECT_ROOT,
  activation = null,
} = {}) {
  const path = resolve(projectRoot, FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING_PATH);
  const binding = await readRegularJson(path, "runtime implementation manifest", projectRoot);
  validateForwardTrialLiveImplementationBinding(binding, { activation });
  if (!sameCanonical(binding, FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING)) {
    fail("runtime implementation manifest differs from the manifest imported by the capture code");
  }
  return binding;
}

export async function verifyFrozenImplementationSources({
  sourceRoot = PROJECT_ROOT,
  activation = null,
  implementationBinding = null,
} = {}) {
  const binding = implementationBinding
    ?? await loadFrozenImplementationBinding({ projectRoot: sourceRoot, activation });
  validateForwardTrialLiveImplementationBinding(binding, { activation });
  const observed = {};
  for (const [path, expected] of Object.entries(binding.runtime_source_files)) {
    const bytes = await readFile(resolve(sourceRoot, path));
    const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (actual !== expected) fail(`frozen implementation source drifted: ${path}`);
    observed[path] = actual;
  }
  if (hashForwardTrialLiveValue(observed) !== binding.runtime_source_files_sha256) {
    fail("frozen implementation source binding is invalid");
  }
  return {
    ...structuredClone(binding),
    implementation_binding_sha256: binding.manifest_sha256,
  };
}

export function verifyFrozenRuntimeEnvironment({
  implementationBinding = FORWARD_TRIAL_LIVE_IMPLEMENTATION_BINDING,
  purpose = "capture",
  platform = process.platform,
  arch = process.arch,
  execArgv = process.execArgv,
  environment = process.env,
  versions = process.versions,
  fetchFunction = globalThis.fetch,
} = {}) {
  validateForwardTrialLiveImplementationBinding(implementationBinding);
  const expected = implementationBinding.runtime_environment;
  if (purpose !== "capture" && purpose !== "verification") {
    fail("runtime purpose must be capture or verification");
  }
  if (typeof platform !== "string" || typeof arch !== "string") {
    fail("runtime platform and architecture must be strings");
  }
  const matchingProfiles = expected.profiles.filter((profile) => (
    profile.platform === platform && profile.arch === arch
  ));
  if (matchingProfiles.length !== 1) {
    fail("runtime platform and architecture do not match a frozen profile");
  }
  const profile = matchingProfiles[0];
  if ((purpose === "capture" && profile.profile_id !== expected.capture_profile_id)
    || (purpose === "verification"
      && !expected.verification_profile_ids.includes(profile.profile_id))) {
    fail(`runtime profile is not authorized for ${purpose}`);
  }
  if (!Array.isArray(execArgv)
    || !expected.permitted_exec_argv.some((permitted) => (
      hashForwardTrialLiveValue(execArgv) === hashForwardTrialLiveValue(permitted)
    ))) {
    fail("runtime launch arguments differ from the frozen clean launch contract");
  }
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    fail("runtime environment must be an object");
  }
  for (const name of expected.forbidden_environment_variables) {
    if (typeof environment[name] === "string" && environment[name].length > 0) {
      fail(`runtime environment variable is forbidden for capture: ${name}`);
    }
  }
  for (const key of ["node", "v8", "icu", "tz", "unicode", "openssl"]) {
    if (versions?.[key] !== profile[key]) {
      fail(`runtime engine version differs from the frozen manifest: ${key}`);
    }
  }
  if (typeof fetchFunction !== "function") fail("runtime global fetch is unavailable");
  const fetchSourceSha256 = `sha256:${createHash("sha256")
    .update(Function.prototype.toString.call(fetchFunction), "utf8")
    .digest("hex")}`;
  if (fetchSourceSha256 !== profile.global_fetch_source_sha256) {
    fail("runtime global fetch differs from the frozen Node implementation");
  }
  return {
    schema_version: "finly_forward_trial_live_runtime_environment_verification.v2",
    runtime_manifest_sha256: implementationBinding.manifest_sha256,
    purpose,
    profile_id: profile.profile_id,
    platform,
    arch,
    node: versions.node,
    v8: versions.v8,
    icu: versions.icu,
    tz: versions.tz,
    unicode: versions.unicode,
    openssl: versions.openssl,
    exec_argv_sha256: hashForwardTrialLiveValue(execArgv),
    forbidden_environment_variables_checked: expected.forbidden_environment_variables.length,
    global_fetch_source_sha256: fetchSourceSha256,
    visible_runtime_configuration_matches_manifest: true,
    hostile_preexecution_environment_excluded: false,
  };
}

function credentialsFromEnvironment(environment = process.env) {
  const keyId = environment.APCA_API_KEY_ID ?? environment.ALPACA_API_KEY;
  const secretKey = environment.APCA_API_SECRET_KEY ?? environment.ALPACA_SECRET_KEY;
  if (typeof keyId !== "string" || keyId.length === 0
    || typeof secretKey !== "string" || secretKey.length === 0) {
    fail("Alpaca paper credentials are required in the local environment");
  }
  return { keyId, secretKey };
}

function localParts(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return Object.fromEntries(
    formatter.formatToParts(instant)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
}

export function newYorkMarketInstant(sessionDate, marketTime) {
  if (typeof sessionDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)
    || typeof marketTime !== "string" || !/^\d{2}:\d{2}:\d{2}$/.test(marketTime)) {
    fail("market session date and time must be canonical");
  }
  const [year, month, day] = sessionDate.split("-").map(Number);
  const [hour, minute, second] = marketTime.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = new Date(targetAsUtc);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = localParts(candidate, MARKET_TIME_ZONE);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = targetAsUtc - observedAsUtc;
    if (correction === 0) break;
    candidate = new Date(candidate.getTime() + correction);
  }
  const observed = localParts(candidate, MARKET_TIME_ZONE);
  if (observed.year !== year || observed.month !== month || observed.day !== day
    || observed.hour !== hour || observed.minute !== minute || observed.second !== second) {
    fail("market session time is ambiguous or invalid in America/New_York");
  }
  return candidate.toISOString();
}

export function calendarResultToSession(calendarResult, sessionDate) {
  if (!calendarResult || typeof calendarResult !== "object"
    || !Array.isArray(calendarResult.sessions)
    || calendarResult.sessions.length < 2
    || typeof calendarResult.content_hash !== "string"
    || !calendarResult.provenance || typeof calendarResult.provenance !== "object") {
    fail("official calendar result is incomplete");
  }
  const index = calendarResult.sessions.findIndex(({ date }) => date === sessionDate);
  if (index < 0 || index + 1 >= calendarResult.sessions.length) {
    fail("official calendar does not contain the requested session and its successor");
  }
  const current = calendarResult.sessions[index];
  const next = calendarResult.sessions[index + 1];
  const marketOpenAt = newYorkMarketInstant(current.date, current.open);
  const marketCloseAt = newYorkMarketInstant(current.date, current.close);
  const nextMarketOpenAt = newYorkMarketInstant(next.date, next.open);
  const nextMarketCloseAt = newYorkMarketInstant(next.date, next.close);
  return {
    calendar_provider: "Alpaca Trading API",
    calendar_endpoint: "/v2/calendar",
    calendar_request_sha256: hashForwardTrialLiveValue(calendarResult.provenance.request),
    calendar_response_sha256: calendarResult.content_hash,
    provider_signature_verified: false,
    session_date: current.date,
    market_open_at: marketOpenAt,
    market_close_at: marketCloseAt,
    bar_eligible_at: new Date(Date.parse(marketCloseAt) + 15 * 60_000).toISOString(),
    next_session_date: next.date,
    next_market_open_at: nextMarketOpenAt,
    next_market_close_at: nextMarketCloseAt,
  };
}

export function calendarResultToActivationSession(calendarResult) {
  return calendarResultToSession(calendarResult, FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION);
}

export async function buildLiveActivationFromCalendar({ client, credentials, frozenAt }) {
  if (!client || typeof client.getMarketCalendar !== "function") fail("read-only calendar client is required");
  if (typeof frozenAt !== "string") fail("activation frozenAt is required");
  const calendar = await client.getMarketCalendar({
    start: FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION,
    end: CALENDAR_QUERY_END,
    credentials,
  });
  return buildForwardTrialLiveActivation({
    frozen_at: frozenAt,
    activation_mode: "PINNED_FIRST_ELIGIBLE",
    session: calendarResultToActivationSession(calendar),
  });
}

function addUtcDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isInteger(days) || !Number.isFinite(value.getTime())) fail("calendar date arithmetic is invalid");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function exactDates(rows, expectedDates, label) {
  if (!Array.isArray(rows) || rows.length !== expectedDates.length) {
    fail(`${label} does not contain every official session`);
  }
  rows.forEach((row, index) => {
    if (row?.session_date !== expectedDates[index]) fail(`${label} differs from the official session calendar`);
  });
}

function panelDigest(results, adjustment, field) {
  return hashForwardTrialLiveValue(Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => {
    const book = results[symbol][adjustment];
    if (field === "request") return [symbol, book.provenance.request];
    if (field === "response") {
      return [symbol, {
        content_hash: book.content_hash,
        response_received_at: book.retrieved_at,
        transport_receipts_sha256: book.provenance.transport_receipts_sha256,
      }];
    }
    fail("unsupported panel digest field");
  })));
}

function latestInstant(values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== "string" || !Number.isFinite(Date.parse(value)))) {
    fail(`${label} contains an invalid retrieval timestamp`);
  }
  return values.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest));
}

function requireCanonicalInstant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function validateEligibleBookRead(book, session, label) {
  if (!book || typeof book !== "object" || !book.provenance || typeof book.provenance !== "object") {
    fail(`${label} is missing durable transport provenance`);
  }
  const provenance = book.provenance;
  requireCanonicalInstant(book.retrieved_at, `${label}.retrieved_at`);
  requireCanonicalInstant(provenance.request_started_at, `${label}.request_started_at`);
  requireCanonicalInstant(provenance.response_received_at, `${label}.response_received_at`);
  if (!Array.isArray(provenance.transport_receipts)
    || provenance.transport_receipts.length !== provenance.page_count
    || provenance.transport_receipts.length < 1) {
    fail(`${label} does not persist every page transport receipt`);
  }
  for (const [index, receipt] of provenance.transport_receipts.entries()) {
    requireCanonicalInstant(receipt?.request_started_at, `${label}.transport_receipts[${index}].request_started_at`);
    requireCanonicalInstant(receipt?.response_received_at, `${label}.transport_receipts[${index}].response_received_at`);
    requireCanonicalInstant(receipt?.origin_http_date, `${label}.transport_receipts[${index}].origin_http_date`);
    if (receipt.request_started_at < session.bar_eligible_at || receipt.origin_http_date < session.bar_eligible_at) {
      fail(`${label} began before the close-plus-15-minute boundary`);
    }
    if (receipt.response_received_at < receipt.request_started_at
      || receipt.response_received_at >= session.next_market_close_at) {
      fail(`${label} has a response outside the eligible capture interval`);
    }
  }
  if (provenance.request_started_at !== provenance.transport_receipts[0].request_started_at
    || provenance.response_received_at !== provenance.transport_receipts.at(-1).response_received_at
    || book.retrieved_at !== provenance.response_received_at) {
    fail(`${label} transport summary differs from its persisted page receipts`);
  }
}

function persistedBook(book) {
  return {
    bars: structuredClone(book.bars),
    content_hash: book.content_hash,
    retrieved_at: book.retrieved_at,
    provenance: structuredClone(book.provenance),
  };
}

export async function buildLiveAcquisitionFromMarketData({
  client,
  credentials,
  activation,
  previousCommitment = null,
  priorPreviousCommitment = null,
}) {
  if (!client || typeof client.getMarketCalendar !== "function" || typeof client.getDailyBars !== "function") {
    fail("read-only calendar and daily-bar client is required");
  }
  validateForwardTrialLiveActivation(activation);
  if (previousCommitment !== null) {
    validateForwardTrialLiveCommitment(previousCommitment, {
      activation,
      previousCommitment: priorPreviousCommitment,
    });
  } else if (priorPreviousCommitment !== null) {
    fail("priorPreviousCommitment cannot exist without previousCommitment");
  }
  const sessionDate = previousCommitment === null
    ? activation.payload.activation_session.session_date
    : previousCommitment.payload.acquisition.session.next_session_date;
  const calendar = await client.getMarketCalendar({
    start: addUtcDays(sessionDate, -430),
    end: addUtcDays(sessionDate, 14),
    credentials,
  });
  const session = calendarResultToSession(calendar, sessionDate);
  const officialCompletedDates = calendar.sessions
    .map(({ date }) => date)
    .filter((date) => date <= sessionDate);
  if (officialCompletedDates.length < 253 || officialCompletedDates.at(-1) !== sessionDate) {
    fail("official calendar does not contain 253 completed sessions through the signal date");
  }
  const selectedDates = officialCompletedDates.slice(-253);
  const start = selectedDates[0];
  const results = {};
  for (const symbol of FORWARD_TRIAL_LIVE_SYMBOLS) {
    results[symbol] = await client.getDailyBars(symbol, {
      start,
      end: sessionDate,
      credentials,
    });
    for (const adjustment of ["raw", "all"]) {
      validateEligibleBookRead(results[symbol][adjustment], session, `${symbol} adjustment=${adjustment}`);
    }
    exactDates(results[symbol].all.bars, selectedDates, `${symbol} adjustment=all bars`);
    exactDates(results[symbol].raw.bars, selectedDates, `${symbol} adjustment=raw bars`);
  }

  const adjustedCloseRows = Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => [
    symbol,
    results[symbol].all.bars.map((bar) => ({
      session_date: bar.session_date,
      bar_timestamp: bar.timestamp,
      close: bar.close,
    })),
  ]));
  const rawCloseRows = Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => [
    symbol,
    results[symbol].raw.bars.slice(-2).map((bar) => ({
      session_date: bar.session_date,
      bar_timestamp: bar.timestamp,
      close: bar.close,
    })),
  ]));
  const retrievedAt = latestInstant([
    ...FORWARD_TRIAL_LIVE_SYMBOLS.flatMap((symbol) => [
      results[symbol].raw.retrieved_at,
      results[symbol].all.retrieved_at,
    ]),
  ], "live acquisition");
  return buildForwardTrialLiveAcquisition({
    retrieved_at: retrievedAt,
    session,
    source: {
      provider: "Alpaca Market Data API",
      feed: "iex",
      timeframe: "1Day",
      currency: "USD",
      asof: sessionDate,
      calendar: {
        start: calendar.start,
        end: calendar.end,
        sessions: structuredClone(calendar.sessions),
        content_hash: calendar.content_hash,
        retrieved_at: calendar.retrieved_at,
        provenance: structuredClone(calendar.provenance),
      },
      adjusted: {
        adjustment: "all",
        request_start_session_date: selectedDates[0],
        request_end_session_date: selectedDates.at(-1),
        retained_close_start_session_date: selectedDates[0],
        retained_close_end_session_date: selectedDates.at(-1),
        request_parameters_sha256: panelDigest(results, "all", "request"),
        response_content_sha256: panelDigest(results, "all", "response"),
        provenance_by_symbol: Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => [
          symbol,
          persistedBook(results[symbol].all),
        ])),
      },
      raw: {
        adjustment: "raw",
        request_start_session_date: selectedDates[0],
        request_end_session_date: selectedDates.at(-1),
        retained_close_start_session_date: selectedDates.at(-2),
        retained_close_end_session_date: selectedDates.at(-1),
        request_parameters_sha256: panelDigest(results, "raw", "request"),
        response_content_sha256: panelDigest(results, "raw", "response"),
        provenance_by_symbol: Object.fromEntries(FORWARD_TRIAL_LIVE_SYMBOLS.map((symbol) => [
          symbol,
          persistedBook(results[symbol].raw),
        ])),
      },
      provider_signature_verified: false,
      credentials_persisted: false,
      raw_response_body_persisted: false,
    },
    adjusted_close_rows: adjustedCloseRows,
    raw_close_rows: rawCloseRows,
  });
}

async function assertNoSymlinkBelowRoot(path, trustedRoot, label) {
  const root = resolve(trustedRoot);
  const target = resolve(path);
  const suffix = relative(root, target);
  if (suffix === ".." || suffix.startsWith(`..${sep}`) || suffix.startsWith(sep)) {
    fail(`${label} escapes its trusted root`);
  }
  let cursor = root;
  for (const component of suffix.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, component);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) fail(`${label} must not traverse a symlink`);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
}

async function assertLocalRegularPath(path, label, { allowMissing = false, trustedRoot = PROJECT_ROOT } = {}) {
  const parent = dirname(path);
  await assertNoSymlinkBelowRoot(parent, trustedRoot, `${label} parent`);
  await mkdir(parent, { recursive: true, mode: 0o755 });
  await assertNoSymlinkBelowRoot(parent, trustedRoot, `${label} parent`);
  const canonicalRoot = await realpath(trustedRoot);
  const canonicalParent = await realpath(parent);
  const canonicalSuffix = relative(canonicalRoot, canonicalParent);
  if (canonicalSuffix === ".." || canonicalSuffix.startsWith(`..${sep}`) || canonicalSuffix.startsWith(sep)) {
    fail(`${label} parent escapes its trusted root`);
  }
  try {
    const metadata = await lstat(path, { bigint: false });
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
    return true;
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function publishActivationWriteOnce(path, activation, { projectRoot = PROJECT_ROOT } = {}) {
  validateForwardTrialLiveActivation(activation);
  return publishCanonicalWriteOnce(path, activation, {
    projectRoot,
    label: "activation",
    mode: 0o644,
  });
}

async function publishCanonicalWriteOnce(path, value, {
  projectRoot,
  label,
  mode,
}) {
  const exists = await assertLocalRegularPath(path, label, { allowMissing: true, trustedRoot: projectRoot });
  const bytes = canonicalBytes(value);
  if (exists) {
    const prior = await readFile(path, "utf8");
    if (prior !== bytes) fail(`${label} already exists with different bytes`);
    return "verified";
  }
  const parent = dirname(path);
  const stagePath = resolve(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  try {
    await assertNoSymlinkBelowRoot(stagePath, projectRoot, `${label} staging path`);
    handle = await open(stagePath, "wx", mode);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await link(stagePath, path);
    const directoryHandle = await open(parent, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    if (error?.code === "EEXIST") {
      const prior = await readFile(path, "utf8").catch(() => null);
      if (prior === bytes) return "verified";
      fail(`${label} was concurrently created with different bytes`);
    }
    throw error;
  } finally {
    await handle?.close();
    await unlink(stagePath).catch(() => {});
  }
  const reopened = await readFile(path, "utf8");
  if (reopened !== bytes) fail(`${label} durable write differs from the canonical bytes`);
  return "created";
}

async function readRegularJson(path, label, projectRoot) {
  await assertLocalRegularPath(path, label, { trustedRoot: projectRoot });
  const bytes = await readFile(path, "utf8");
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  if (bytes !== canonicalBytes(value)) fail(`${label} is not canonical JSON`);
  return value;
}

async function loadActivation(projectRoot) {
  const path = resolve(projectRoot, FORWARD_TRIAL_LIVE_ACTIVATION_PATH);
  const activation = await readRegularJson(path, "activation", projectRoot);
  validateForwardTrialLiveActivation(activation);
  return activation;
}

async function existingJsonFiles(directory, label, projectRoot) {
  await assertNoSymlinkBelowRoot(directory, projectRoot, label);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^\d{8}_[0-9a-f]{64}\.json$/.test(entry.name)) {
        fail(`${label} contains an unexpected entry`);
      }
    }
    if (entries.length > MAX_PUBLIC_ANCHORS) fail(`${label} exceeds the bounded chain length`);
    return entries.map(({ name }) => resolve(directory, name)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadPrivateCommitmentChain({ projectRoot = PROJECT_ROOT, activation }) {
  validateForwardTrialLiveActivation(activation);
  const directory = resolve(projectRoot, FORWARD_TRIAL_LIVE_PRIVATE_COMMITMENT_DIRECTORY);
  const files = await existingJsonFiles(directory, "private commitment directory", projectRoot);
  const commitments = [];
  for (const [index, path] of files.entries()) {
    const value = await readRegularJson(path, `private commitment ${index + 1}`, projectRoot);
    validateForwardTrialLiveCommitment(value, {
      activation,
      previousCommitment: commitments.at(-1) ?? null,
    });
    if (path !== resolve(directory, forwardTrialLiveCommitmentFilename(value))) {
      fail("private commitment filename is not content addressed");
    }
    commitments.push(value);
  }
  return commitments;
}

function publicAnchorFilename(anchor) {
  return `${String(anchor.commitment_sequence).padStart(8, "0")}_${anchor.manifest_sha256.slice(7)}.json`;
}

function scanPublicAnchor(anchor) {
  const serialized = JSON.stringify(anchor);
  for (const forbidden of FORBIDDEN_PUBLIC_FIELDS) {
    if (serialized.includes(forbidden)) fail(`public anchor leaks private field ${forbidden}`);
  }
  return anchor;
}

function publicAnchorBody(anchor) {
  const body = { ...anchor };
  delete body.manifest_sha256;
  return body;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} has non-canonical fields`);
  }
}

function strictDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} is not a canonical SHA-256 digest`);
}

function strictDate(value, label) {
  if (typeof value !== "string" || !ISO_DATE.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    fail(`${label} is not a canonical calendar date`);
  }
}

function strictWeights(value, label) {
  exactKeys(value, ["SPY", "BIL"], label);
  if (![value.SPY, value.BIL].every((weight) => typeof weight === "number" && Number.isFinite(weight) && weight >= 0 && weight <= 1)
    || Math.abs(value.SPY + value.BIL - 1) > 1e-10) {
    fail(`${label} must be bounded and sum to one`);
  }
}

function isPermittedUsEquityClose(sessionDate, instant) {
  return instant === newYorkMarketInstant(sessionDate, "16:00:00")
    || instant === newYorkMarketInstant(sessionDate, "13:00:00");
}

function isWeekday(sessionDate) {
  const day = new Date(`${sessionDate}T12:00:00.000Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function sameCanonical(left, right) {
  return hashForwardTrialLiveValue(left) === hashForwardTrialLiveValue(right);
}

function validatePublicAnchorSelf(anchor, {
  activation,
  implementationBinding,
  previousAnchor = null,
}) {
  validateForwardTrialLiveActivation(activation);
  validateForwardTrialLiveImplementationBinding(implementationBinding, { activation });
  exactKeys(anchor, [
    "schema_version", "trial_id", "manifest_kind", "commitment_sequence", "signal_session_date",
    "timing", "formula", "action", "target_weights", "private_bundle_sha256",
    "previous_private_bundle_sha256", "authority", "evaluation_gates", "manifest_sha256",
  ], "public anchor");
  if (anchor.schema_version !== FORWARD_TRIAL_LIVE_ANCHOR_SCHEMA
    || anchor.trial_id !== FORWARD_TRIAL_LIVE_ID
    || anchor.manifest_kind !== "PUBLIC_HASH_ONLY_SIGNAL_ANCHOR"
    || !Number.isInteger(anchor.commitment_sequence)
    || anchor.commitment_sequence < 1) {
    fail("public anchor envelope is invalid");
  }
  strictDate(anchor.signal_session_date, "public anchor signal_session_date");
  strictDigest(anchor.private_bundle_sha256, "public anchor private bundle hash");
  strictDigest(anchor.previous_private_bundle_sha256, "public anchor previous bundle hash");
  strictDigest(anchor.manifest_sha256, "public anchor manifest hash");
  if (anchor.manifest_sha256 !== hashForwardTrialLiveValue(publicAnchorBody(anchor))) {
    fail("public anchor self-hash is invalid");
  }

  exactKeys(anchor.timing, [
    "captured_at", "market_close_at", "bar_eligible_at", "next_session_date",
    "next_market_close_at", "anchor_deadline",
  ], "public anchor timing");
  for (const key of ["captured_at", "market_close_at", "bar_eligible_at", "next_market_close_at", "anchor_deadline"]) {
    requireCanonicalInstant(anchor.timing[key], `public anchor timing.${key}`);
  }
  strictDate(anchor.timing.next_session_date, "public anchor timing.next_session_date");
  const successorGapDays = (Date.parse(`${anchor.timing.next_session_date}T00:00:00.000Z`)
    - Date.parse(`${anchor.signal_session_date}T00:00:00.000Z`)) / 86_400_000;
  if (anchor.timing.bar_eligible_at !== new Date(Date.parse(anchor.timing.market_close_at) + 15 * 60_000).toISOString()
    || anchor.timing.market_close_at.slice(0, 10) !== anchor.signal_session_date
    || anchor.timing.next_market_close_at.slice(0, 10) !== anchor.timing.next_session_date
    || !isPermittedUsEquityClose(anchor.signal_session_date, anchor.timing.market_close_at)
    || !isPermittedUsEquityClose(anchor.timing.next_session_date, anchor.timing.next_market_close_at)
    || !isWeekday(anchor.signal_session_date)
    || !isWeekday(anchor.timing.next_session_date)
    || anchor.timing.captured_at < anchor.timing.bar_eligible_at
    || anchor.timing.captured_at >= anchor.timing.next_market_close_at
    || anchor.timing.anchor_deadline !== anchor.timing.next_market_close_at
    || anchor.timing.next_session_date <= anchor.signal_session_date
    || successorGapDays < 1
    || successorGapDays > 14
    || anchor.timing.next_market_close_at <= anchor.timing.market_close_at) {
    fail("public anchor timing chain is invalid");
  }

  const expectedPriorHash = previousAnchor?.private_bundle_sha256 ?? activation.activation_sha256;
  if (anchor.previous_private_bundle_sha256 !== expectedPriorHash) fail("public anchor private-bundle hash chain is broken");
  if (previousAnchor === null) {
    const session = activation.payload.activation_session;
    if (anchor.signal_session_date !== session.session_date
      || anchor.timing.market_close_at !== session.market_close_at
      || anchor.timing.bar_eligible_at !== session.bar_eligible_at
      || anchor.timing.next_session_date !== session.next_session_date
      || anchor.timing.next_market_close_at !== session.next_market_close_at) {
      fail("first public anchor differs from the frozen activation session");
    }
  } else if (anchor.signal_session_date !== previousAnchor.timing.next_session_date
    || anchor.timing.market_close_at !== previousAnchor.timing.next_market_close_at
    || anchor.timing.captured_at <= previousAnchor.timing.captured_at) {
    fail("public anchor skips, backfills, or rewinds the exposed session chain");
  }

  exactKeys(anchor.formula, [
    "implementation", "policy_id", "protocol_sha256", "implementation_binding_sha256",
    "decision_receipt_sha256",
  ], "public anchor formula");
  strictDigest(anchor.formula.protocol_sha256, "public anchor protocol hash");
  strictDigest(anchor.formula.implementation_binding_sha256, "public anchor implementation binding hash");
  strictDigest(anchor.formula.decision_receipt_sha256, "public anchor decision receipt hash");
  const activationFormula = activation.payload.formula_binding;
  if (anchor.formula.implementation !== activationFormula.implementation
    || anchor.formula.policy_id !== activationFormula.policy_id
    || anchor.formula.protocol_sha256 !== activationFormula.protocol_sha256
    || anchor.formula.implementation_binding_sha256 !== implementationBinding.manifest_sha256) {
    fail("public anchor substitutes the frozen formula or source binding");
  }
  if (anchor.action !== "HOLD" && anchor.action !== "REBALANCE") fail("public anchor action is invalid");
  const rebalanceDue = (anchor.commitment_sequence - 1) % 5 === 0;
  if ((rebalanceDue && anchor.action !== "REBALANCE") || (!rebalanceDue && anchor.action !== "HOLD")) {
    fail("public anchor action violates the frozen five-session rebalance cadence");
  }
  strictWeights(anchor.target_weights, "public anchor target weights");
  const priorWeights = previousAnchor?.target_weights ?? activation.payload.initial_state.current_allocation;
  if (anchor.action === "HOLD" && !sameCanonical(anchor.target_weights, priorWeights)) {
    fail("public HOLD anchor changes the prior target weights");
  }
  if (!sameCanonical(anchor.authority, activation.payload.authority)
    || !sameCanonical(anchor.evaluation_gates, activation.payload.evaluation_gates)) {
    fail("public anchor weakens its research-only boundary");
  }
  return scanPublicAnchor(anchor);
}

export function validateForwardTrialLivePublicAnchorChain({
  activation,
  implementationBinding,
  anchors,
}) {
  validateForwardTrialLiveActivation(activation);
  validateForwardTrialLiveImplementationBinding(implementationBinding, { activation });
  if (!Array.isArray(anchors) || anchors.length > MAX_PUBLIC_ANCHORS) {
    fail("public anchor chain must be a bounded array");
  }
  const verified = [];
  for (const [index, candidate] of anchors.entries()) {
    const anchor = validatePublicAnchorSelf(candidate, {
      activation,
      implementationBinding,
      previousAnchor: verified.at(-1) ?? null,
    });
    if (anchor.commitment_sequence !== index + 1) fail("public anchor sequence is not canonical");
    if (verified.some((prior) => prior.private_bundle_sha256 === anchor.private_bundle_sha256
      || prior.manifest_sha256 === anchor.manifest_sha256)) {
      fail("public anchor chain repeats a content hash");
    }
    verified.push(anchor);
  }
  return verified;
}

export async function loadPublicAnchors({ projectRoot = PROJECT_ROOT, activation: suppliedActivation } = {}) {
  const activation = suppliedActivation ?? await loadActivation(projectRoot);
  validateForwardTrialLiveActivation(activation);
  const implementationBinding = await loadFrozenImplementationBinding({ projectRoot, activation });
  const directory = resolve(projectRoot, FORWARD_TRIAL_LIVE_PUBLIC_ANCHOR_DIRECTORY);
  const files = await existingJsonFiles(directory, "public anchor directory", projectRoot);
  const candidates = [];
  for (const [index, path] of files.entries()) {
    candidates.push(await readRegularJson(path, `public anchor ${index + 1}`, projectRoot));
  }
  const anchors = validateForwardTrialLivePublicAnchorChain({ activation, implementationBinding, anchors: candidates });
  anchors.forEach((anchor, index) => {
    if (files[index] !== resolve(directory, publicAnchorFilename(anchor))) {
      fail("public anchor filename is not canonical");
    }
  });
  return anchors;
}

async function withAppendLock(projectRoot, callback) {
  const lockPath = resolve(projectRoot, APPEND_LOCK_PATH);
  await assertNoSymlinkBelowRoot(dirname(lockPath), projectRoot, "append lock parent");
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  await assertNoSymlinkBelowRoot(dirname(lockPath), projectRoot, "append lock parent");
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("forward-live append lock already exists; inspect manually");
    throw error;
  }
  const ownerPath = resolve(lockPath, "owner.json");
  try {
    await publishCanonicalWriteOnce(ownerPath, {
      schema_version: "finly_forward_trial_live_append_lock.v1",
      pid: process.pid,
    }, {
      projectRoot,
      label: "append lock owner",
      mode: 0o600,
    });
    return await callback();
  } finally {
    await unlink(ownerPath).catch(() => {});
    await rmdir(lockPath).catch(() => {});
  }
}

async function loadConsistentLocalState({ projectRoot, activation }) {
  const diskActivation = await loadActivation(projectRoot);
  if (!sameCanonical(diskActivation, activation)) fail("candidate activation differs from the write-once disk activation");
  const commitments = await loadPrivateCommitmentChain({ projectRoot, activation: diskActivation });
  const anchors = await loadPublicAnchors({ projectRoot, activation: diskActivation });
  if (anchors.length > commitments.length || commitments.length - anchors.length > 1) {
    fail("private commitment and public anchor sequences are inconsistent");
  }
  anchors.forEach((anchor, index) => {
    validateForwardTrialLiveAnchorManifest(anchor, commitments[index], {
      activation: diskActivation,
      previousCommitment: commitments[index - 1] ?? null,
    });
  });
  return { activation: diskActivation, commitments, anchors };
}

async function publishSignalBundleUnderHeldLock({
  projectRoot = PROJECT_ROOT,
  sourceRoot = PROJECT_ROOT,
  activation,
  commitment,
  anchor,
  previousCommitment = null,
}) {
  const implementationBinding = await loadFrozenImplementationBinding({
    projectRoot: sourceRoot,
    activation,
  });
  await verifyFrozenImplementationSources({ sourceRoot, activation, implementationBinding });
  const state = await loadConsistentLocalState({ projectRoot, activation });
  const existingCommitment = state.commitments[commitment.sequence - 1] ?? null;
  const authoritativePrevious = state.commitments[commitment.sequence - 2] ?? null;
  if (existingCommitment !== null) {
    if (commitment.sequence !== state.commitments.length
      || existingCommitment.commitment_sha256 !== commitment.commitment_sha256) {
      fail("candidate reuses an existing commitment sequence with different or stale content");
    }
  } else if (commitment.sequence !== state.commitments.length + 1
    || state.commitments.length !== state.anchors.length) {
    fail("candidate does not extend the authoritative disk head");
  }
  const expectedPrevious = existingCommitment === null ? state.commitments.at(-1) ?? null : authoritativePrevious;
  if ((previousCommitment?.commitment_sha256 ?? null) !== (expectedPrevious?.commitment_sha256 ?? null)) {
    fail("candidate predecessor differs from the authoritative disk head");
  }
  validateForwardTrialLiveCommitment(commitment, { activation: state.activation, previousCommitment: expectedPrevious });
  validateForwardTrialLiveAnchorManifest(anchor, commitment, { activation: state.activation, previousCommitment: expectedPrevious });
  validatePublicAnchorSelf(anchor, {
    activation: state.activation,
    implementationBinding,
    previousAnchor: state.anchors[commitment.sequence - 2] ?? null,
  });
  await verifyFrozenImplementationSources({ sourceRoot, activation: state.activation, implementationBinding });
    const privatePath = resolve(
      projectRoot,
      FORWARD_TRIAL_LIVE_PRIVATE_COMMITMENT_DIRECTORY,
      forwardTrialLiveCommitmentFilename(commitment),
    );
    const publicPath = resolve(
      projectRoot,
      FORWARD_TRIAL_LIVE_PUBLIC_ANCHOR_DIRECTORY,
      publicAnchorFilename(anchor),
    );
    const privateStatus = await publishCanonicalWriteOnce(privatePath, commitment, {
      projectRoot,
      label: "private commitment",
      mode: 0o600,
    });
    const publicStatus = await publishCanonicalWriteOnce(publicPath, anchor, {
      projectRoot,
      label: "public anchor",
      mode: 0o644,
    });
    const reopenedCommitment = await readRegularJson(privatePath, "private commitment", projectRoot);
    const reopenedAnchor = await readRegularJson(publicPath, "public anchor", projectRoot);
    validateForwardTrialLiveCommitment(reopenedCommitment, { activation: state.activation, previousCommitment: expectedPrevious });
    validateForwardTrialLiveAnchorManifest(reopenedAnchor, reopenedCommitment, { activation: state.activation, previousCommitment: expectedPrevious });
    scanPublicAnchor(reopenedAnchor);
    const verified = await loadConsistentLocalState({ projectRoot, activation: state.activation });
    if (verified.commitments.length !== verified.anchors.length
      || verified.commitments.at(-1)?.commitment_sha256 !== commitment.commitment_sha256
      || verified.anchors.at(-1)?.manifest_sha256 !== anchor.manifest_sha256) {
      fail("post-write chain verification did not reach the candidate head");
    }
    return {
      private_status: privateStatus,
      public_status: publicStatus,
      private_path: relative(projectRoot, privatePath),
      public_path: relative(projectRoot, publicPath),
    };
}

export async function publishSignalBundleWriteOnce(options) {
  const projectRoot = options?.projectRoot ?? PROJECT_ROOT;
  return withAppendLock(projectRoot, () => publishSignalBundleUnderHeldLock(options));
}

export async function verifyExistingLiveActivation({
  projectRoot = PROJECT_ROOT,
  runtimeEnvironmentInputs = null,
} = {}) {
  const activation = await loadActivation(projectRoot);
  const implementationBinding = await loadFrozenImplementationBinding({ projectRoot, activation });
  if (runtimeEnvironmentInputs !== null && resolve(projectRoot) === resolve(PROJECT_ROOT)) {
    fail("runtime environment inputs cannot be overridden for the production project root");
  }
  const runtimeEnvironment = verifyFrozenRuntimeEnvironment({
    implementationBinding,
    purpose: "verification",
    ...(runtimeEnvironmentInputs ?? {}),
  });
  await verifyFrozenImplementationSources({
    sourceRoot: projectRoot,
    activation,
    implementationBinding,
  });
  const publicAnchors = await loadPublicAnchors({ projectRoot, activation });
  const privateCommitments = await loadPrivateCommitmentChain({ projectRoot, activation });
  if (privateCommitments.length > 0) {
    if (privateCommitments.length !== publicAnchors.length) fail("local private commitments and public anchors are not one-to-one");
    privateCommitments.forEach((commitment, index) => {
      validateForwardTrialLiveAnchorManifest(publicAnchors[index], commitment, {
        activation,
        previousCommitment: privateCommitments[index - 1] ?? null,
      });
    });
  }
  const fullPrivateChainAvailable = publicAnchors.length > 0 && privateCommitments.length === publicAnchors.length;
  return {
    status: publicAnchors.length === 0
      ? "ACTIVATION_VERIFIED_AWAITING_FIRST_SIGNAL"
      : "STRUCTURE_VERIFIED_EXTERNAL_TIMESTAMP_PENDING",
    activation_sha256: activation.activation_sha256,
    runtime_manifest_sha256: implementationBinding.manifest_sha256,
    visible_runtime_configuration_verified: true,
    visible_runtime_configuration_receipt_sha256: hashForwardTrialLiveValue(runtimeEnvironment),
    hostile_preexecution_environment_excluded: false,
    activation_session: activation.payload.activation_session.session_date,
    frozen_at: activation.payload.frozen_at,
    broker_mutation_authorized: activation.payload.authority.broker_mutation_authorized,
    public_signal_anchors: publicAnchors.length,
    private_signal_commitments_available: privateCommitments.length,
    clean_clone_private_bundle_required: false,
    structural_public_chain_verified: true,
    public_chain_sha256: hashForwardTrialLiveValue({
      activation_sha256: activation.activation_sha256,
      ordered_manifest_sha256: publicAnchors.map(({ manifest_sha256 }) => manifest_sha256),
    }),
    private_bundle_existence_verified: fullPrivateChainAvailable,
    formula_reexecution_verified: fullPrivateChainAvailable,
    provider_origin_verified: false,
    external_anchor_verified: false,
    prospectivity_verified: false,
    performance_inference_permitted: false,
  };
}

async function activate() {
  const path = resolve(PROJECT_ROOT, FORWARD_TRIAL_LIVE_ACTIVATION_PATH);
  const exists = await assertLocalRegularPath(path, "activation", { allowMissing: true, trustedRoot: PROJECT_ROOT });
  if (exists) return verifyExistingLiveActivation();
  const activation = await buildLiveActivationFromCalendar({
    client: new ForwardMarketDataClient(),
    credentials: credentialsFromEnvironment(),
    frozenAt: new Date().toISOString(),
  });
  const writeStatus = await publishActivationWriteOnce(path, activation);
  return {
    status: writeStatus === "created" ? "ACTIVATED_WRITE_ONCE" : "VERIFIED",
    activation_sha256: activation.activation_sha256,
    activation_session: activation.payload.activation_session.session_date,
    frozen_at: activation.payload.frozen_at,
    broker_mutation_authorized: activation.payload.authority.broker_mutation_authorized,
  };
}

async function appendSignalCommitment() {
  if (process.env.FINLY_FORWARD_LIVE_WRITE_ACK !== APPEND_ACK) {
    fail(`FINLY_FORWARD_LIVE_WRITE_ACK must equal ${APPEND_ACK}`);
  }
  return withAppendLock(PROJECT_ROOT, async () => {
    const activation = await loadActivation(PROJECT_ROOT);
    const implementationBinding = await loadFrozenImplementationBinding({
      projectRoot: PROJECT_ROOT,
      activation,
    });
    verifyFrozenRuntimeEnvironment({ implementationBinding, purpose: "capture" });
    await verifyFrozenImplementationSources({ activation, implementationBinding });
    const state = await loadConsistentLocalState({ projectRoot: PROJECT_ROOT, activation });
    const { commitments, anchors } = state;
    if (commitments.length === anchors.length + 1) {
      const commitment = commitments.at(-1);
      const previousCommitment = commitments.at(-2) ?? null;
      const anchor = buildForwardTrialLiveAnchorManifest(commitment, { activation, previousCommitment });
      const persistence = await publishSignalBundleUnderHeldLock({
        activation,
        commitment,
        anchor,
        previousCommitment,
      });
      return {
        status: "RECOVERED_PUBLIC_ANCHOR_WRITE_ONCE",
        sequence: commitment.sequence,
        signal_session_date: anchor.signal_session_date,
        action: anchor.action,
        target_weights: anchor.target_weights,
        commitment_sha256: commitment.commitment_sha256,
        manifest_sha256: anchor.manifest_sha256,
        anchor_deadline: anchor.timing.anchor_deadline,
        external_anchor_verified: false,
        broker_mutation_authorized: false,
        persistence,
      };
    }
    const previousCommitment = commitments.at(-1) ?? null;
    const acquisition = await buildLiveAcquisitionFromMarketData({
      client: new ForwardMarketDataClient(),
      credentials: credentialsFromEnvironment(),
      activation,
      previousCommitment,
      priorPreviousCommitment: commitments.at(-2) ?? null,
    });
    await verifyFrozenImplementationSources({ activation, implementationBinding });
    const commitment = buildForwardTrialLiveCommitment({ activation, acquisition, previousCommitment });
    const anchor = buildForwardTrialLiveAnchorManifest(commitment, { activation, previousCommitment });
    const persistence = await publishSignalBundleUnderHeldLock({
      activation,
      commitment,
      anchor,
      previousCommitment,
    });
    return {
      status: "SIGNAL_COMMITMENT_AND_PUBLIC_ANCHOR_WRITTEN_ONCE",
      sequence: commitment.sequence,
      signal_session_date: anchor.signal_session_date,
      action: anchor.action,
      target_weights: anchor.target_weights,
      commitment_sha256: commitment.commitment_sha256,
      manifest_sha256: anchor.manifest_sha256,
      anchor_deadline: anchor.timing.anchor_deadline,
      external_anchor_verified: false,
      broker_mutation_authorized: false,
      persistence,
    };
  });
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === "--activate") return activate();
  if (argv.length === 1 && argv[0] === "--append-signal-commitment") return appendSignalCommitment();
  if (argv.length === 1 && argv[0] === "--verify-existing") return verifyExistingLiveActivation();
  fail("usage: node research/run_forward_trial_live.mjs [--activate | --append-signal-commitment | --verify-existing]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
