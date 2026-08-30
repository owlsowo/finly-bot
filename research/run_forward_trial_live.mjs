import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ForwardMarketDataClient,
} from "../lib/forward_market_data.mjs";
import {
  FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION,
  buildForwardTrialLiveActivation,
  hashForwardTrialLiveValue,
  validateForwardTrialLiveActivation,
} from "./forward_trial_live_core.mjs";

export const FORWARD_TRIAL_LIVE_ACTIVATION_PATH = "research/forward_trial_live/activation.json";
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MARKET_TIME_ZONE = "America/New_York";
const CALENDAR_QUERY_END = "2026-09-04";

function fail(message) {
  throw new Error(message);
}

function canonicalBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
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

export function calendarResultToActivationSession(calendarResult) {
  if (!calendarResult || typeof calendarResult !== "object"
    || !Array.isArray(calendarResult.sessions)
    || calendarResult.sessions.length < 2
    || typeof calendarResult.content_hash !== "string"
    || !calendarResult.provenance || typeof calendarResult.provenance !== "object") {
    fail("official calendar result is incomplete");
  }
  const index = calendarResult.sessions.findIndex(({ date }) => date === FORWARD_TRIAL_LIVE_PINNED_FIRST_SESSION);
  if (index < 0 || index + 1 >= calendarResult.sessions.length) {
    fail("official calendar does not contain the pinned session and its successor");
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
    const metadata = await stat(path, { bigint: false });
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${label} must be a regular non-symlink file`);
    return true;
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function publishActivationWriteOnce(path, activation, { projectRoot = PROJECT_ROOT } = {}) {
  validateForwardTrialLiveActivation(activation);
  const exists = await assertLocalRegularPath(path, "activation", { allowMissing: true, trustedRoot: projectRoot });
  const bytes = canonicalBytes(activation);
  if (exists) {
    const prior = await readFile(path, "utf8");
    if (prior !== bytes) fail("activation already exists with different bytes");
    return "verified";
  }
  let handle;
  try {
    handle = await open(path, "wx", 0o644);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") fail("activation was concurrently created; rerun verification");
    throw error;
  } finally {
    await handle?.close();
  }
  return "created";
}

export async function verifyExistingLiveActivation({ projectRoot = PROJECT_ROOT } = {}) {
  const path = resolve(projectRoot, FORWARD_TRIAL_LIVE_ACTIVATION_PATH);
  await assertLocalRegularPath(path, "activation", { trustedRoot: projectRoot });
  const activation = JSON.parse(await readFile(path, "utf8"));
  validateForwardTrialLiveActivation(activation);
  return {
    status: "VERIFIED",
    activation_sha256: activation.activation_sha256,
    activation_session: activation.payload.activation_session.session_date,
    frozen_at: activation.payload.frozen_at,
    broker_mutation_authorized: activation.payload.authority.broker_mutation_authorized,
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

async function main(argv) {
  if (argv.length === 1 && argv[0] === "--activate") return activate();
  if (argv.length === 1 && argv[0] === "--verify-existing") return verifyExistingLiveActivation();
  fail("usage: node research/run_forward_trial_live.mjs [--activate | --verify-existing]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
