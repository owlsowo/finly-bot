import { AlpacaPaperRestClient, alpacaCredentialsFromEnv } from "../lib/alpaca_rest.mjs";
import { stableStringify } from "../lib/canonical.mjs";
import { POLICY } from "../lib/policy.mjs";

function check(value) {
  return value ? "READY" : "BLOCKED";
}

let result;
try {
  const expectedAccountId = process.env.FINLY_COMPETITION_ACCOUNT_ID;
  if (typeof expectedAccountId !== "string" || !/^PA[A-Z0-9]{10}$/.test(expectedAccountId)) {
    throw new Error("competition account configuration is invalid");
  }
  const client = new AlpacaPaperRestClient(alpacaCredentialsFromEnv());
  const [account, configuration, clock] = await Promise.all([
    client.getAccount(),
    client.getAccountConfiguration(),
    client.getClock(),
  ]);
  const accountLevel = Number(account.options_trading_level);
  const approvedLevel = Number(account.options_approved_level);
  const effectiveOptionsLevel = Math.min(accountLevel, approvedLevel);
  const checks = {
    account_active: check(account.status === "ACTIVE"),
    trading_unblocked: check(account.trading_blocked === false),
    account_unblocked: check(account.account_blocked !== true),
    competition_account_match: check(account.account_number === expectedAccountId),
    trading_not_suspended: check(configuration.suspend_trade !== true && account.trade_suspended_by_user !== true),
    options_level_sufficient: check(Number.isFinite(effectiveOptionsLevel) && effectiveOptionsLevel >= POLICY.minimumOptionsLevel),
    market_open: check(clock.is_open === true),
  };
  const blockers = Object.entries(checks)
    .filter(([, status]) => status === "BLOCKED")
    .map(([name]) => name);
  result = {
    check_type: "READ_ONLY_HEALTH",
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    mode: "paper",
    paper_origin: client.tradingBase,
    data_origin: client.dataBase,
    broker_read_connectivity: "SUCCEEDED",
    mutation_authorized: false,
    execution_status: "PROHIBITED_PENDING_CONTROLLED_PAPER_ROUNDTRIP_AND_LIFECYCLE_TESTS",
    account: {
      status: account.status,
      trading_blocked: account.trading_blocked,
      account_blocked: account.account_blocked,
      trade_suspended_by_user: account.trade_suspended_by_user,
      configuration_suspend_trade: configuration.suspend_trade,
      options_approved_level: account.options_approved_level,
      options_trading_level: account.options_trading_level,
      effective_options_trading_level: effectiveOptionsLevel,
      competition_account_match: account.account_number === expectedAccountId,
    },
    market: {
      is_open: clock.is_open,
      timestamp: clock.timestamp,
      next_open: clock.next_open,
      next_close: clock.next_close,
    },
    checks,
    blockers,
    checked_at: new Date().toISOString(),
    note: "READY covers read-side prerequisites only and never authorizes mutation.",
  };
  if (blockers.length > 0) process.exitCode = 2;
} catch {
  result = {
    check_type: "READ_ONLY_HEALTH",
    status: "BLOCKED",
    mode: "paper",
    paper_origin: POLICY.paperHost,
    data_origin: "https://data.alpaca.markets",
    broker_read_connectivity: "FAILED_OR_NOT_ATTEMPTED",
    mutation_authorized: false,
    execution_status: "PROHIBITED_PENDING_CONTROLLED_PAPER_ROUNDTRIP_AND_LIFECYCLE_TESTS",
    checks: { credentials_and_read_connectivity: "BLOCKED" },
    blockers: ["credentials_and_read_connectivity"],
    checked_at: new Date().toISOString(),
    error: "read-only health check failed; inspect local diagnostics without publishing credentials",
  };
  process.exitCode = 2;
}

process.stdout.write(`${stableStringify(result)}\n`);
