import { POLICY } from "./policy.mjs";

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} response is not a complete array`);
  return value;
}

function normalizeContract(contract, underlying) {
  const deliverables = requireArray(contract?.deliverables, `deliverables for ${contract?.symbol ?? "unknown contract"}`);
  const standardDeliverable = deliverables.length === 1
    && deliverables[0].type === "equity"
    && deliverables[0].symbol === underlying
    && Number(deliverables[0].amount) === 100
    && deliverables[0].delayed_settlement === false;
  return {
    symbol: contract.symbol,
    status: contract.status,
    tradable: contract.tradable,
    multiplier: Number(contract.multiplier),
    adjusted: Number(contract.size) !== 100 || !standardDeliverable,
    deliverable: standardDeliverable ? "standard" : "adjusted",
  };
}

function normalizeOptionQuote(symbol, quote, feed) {
  if (!quote) throw new Error(`Alpaca returned no latest quote for ${symbol}`);
  return {
    symbol,
    feed,
    bid: Number(quote.bp),
    ask: Number(quote.ap),
    observed_at: quote.t,
  };
}

function normalizeOptionsLevel(value) {
  const level = Number(value);
  if (!Number.isInteger(level) || level < 0 || level > 3) throw new Error("options trading level is invalid");
  return level;
}

export function createAlpacaPaperPreflight(client, {
  optionFeed = "indicative",
  stockFeed = "iex",
  expectedAccountId,
  brokerViewFilter,
} = {}) {
  if (!client || client.tradingBase !== POLICY.paperHost || client.dataBase !== "https://data.alpaca.markets") {
    throw new Error("preflight client is not locked to Alpaca paper and data origins");
  }
  if (typeof expectedAccountId !== "string" || !/^PA[A-Z0-9]{10}$/.test(expectedAccountId)) {
    throw new Error("preflight expected competition account ID is invalid");
  }
  if (brokerViewFilter !== undefined && typeof brokerViewFilter !== "function") {
    throw new Error("preflight broker-view filter is invalid");
  }
  return async ({ candidate, now = new Date() }) => {
    const observedAt = new Date(now);
    if (Number.isNaN(observedAt.getTime())) throw new Error("preflight observation time is invalid");
    const symbols = [candidate.long_leg.symbol, candidate.short_leg.symbol];
    const [account, configuration, clock, rawPositions, rawOpenOrders, contractPage, latestOptions, latestStock] = await Promise.all([
      client.getAccount(),
      client.getAccountConfiguration(),
      client.getClock(),
      client.getPositions(),
      client.getOpenOrders(),
      client.getOptionContracts(candidate.underlying, {
        expirationDateGte: candidate.expiry,
        expirationDateLte: candidate.expiry,
        limit: 1000,
        showDeliverables: true,
      }),
      client.getLatestOptionQuotes(symbols, { feed: optionFeed }),
      client.getStockLatestQuote(candidate.underlying, { feed: stockFeed }),
    ]);
    const brokerView = brokerViewFilter
      ? brokerViewFilter({
        positions: requireArray(rawPositions, "positions"),
        openOrders: requireArray(rawOpenOrders, "open orders"),
      })
      : { positions: rawPositions, openOrders: rawOpenOrders };
    const positions = requireArray(brokerView?.positions, "filtered positions");
    const openOrders = requireArray(brokerView?.openOrders, "filtered open orders");
    if (contractPage.next_page_token) throw new Error("option contract preflight is incomplete because pagination remains");
    const contracts = requireArray(contractPage.option_contracts, "option contracts");
    const contractBySymbol = new Map(contracts.map((contract) => [contract.symbol, contract]));
    const normalizedContracts = symbols.map((symbol) => {
      const contract = contractBySymbol.get(symbol);
      if (!contract) throw new Error(`Alpaca returned no contract metadata for ${symbol}`);
      return normalizeContract(contract, candidate.underlying);
    });
    const quotes = latestOptions?.quotes;
    if (!quotes || typeof quotes !== "object") throw new Error("latest option quotes response is incomplete");
    const stockQuote = latestStock?.quote;
    if (!stockQuote) throw new Error("latest underlying quote response is incomplete");
    const accountOptionsLevel = normalizeOptionsLevel(account.options_trading_level);
    const approvedOptionsLevel = normalizeOptionsLevel(account.options_approved_level);
    return {
      trading_base_url: client.tradingBase,
      data_base_url: client.dataBase,
      observed_at: observedAt.toISOString(),
      account: {
        status: account.status,
        trading_blocked: account.trading_blocked,
        account_blocked: account.account_blocked === true
          || account.trade_suspended_by_user === true
          || configuration.suspend_trade === true,
        equity: Number(account.equity),
        options_buying_power: Number(account.options_buying_power),
        options_trading_level: Math.min(accountOptionsLevel, approvedOptionsLevel),
        competition_account_match: account.account_number === expectedAccountId,
      },
      clock: { is_open: clock.is_open, timestamp: clock.timestamp },
      underlying_quote: {
        symbol: candidate.underlying,
        feed: stockFeed,
        bid: Number(stockQuote.bp),
        ask: Number(stockQuote.ap),
        observed_at: stockQuote.t,
      },
      positions,
      open_orders: openOrders,
      open_defined_risk: 0,
      contracts: normalizedContracts,
      quotes: symbols.map((symbol) => normalizeOptionQuote(symbol, quotes[symbol], optionFeed)),
    };
  };
}

export async function getNestedOrderByClientId(client, clientOrderId) {
  const parent = await client.getOrderByClientOrderId(clientOrderId);
  if (!parent?.id) throw new Error("Alpaca client-order lookup returned no order ID");
  return client.getOrderById(parent.id, { nested: true });
}

export async function getNestedOrderByClientIdOrNull(client, clientOrderId) {
  const parent = await client.getOrderByClientOrderId(clientOrderId);
  if (parent === null) return null;
  if (!parent?.id) throw new Error("Alpaca client-order lookup returned no order ID");
  return client.getOrderById(parent.id, { nested: true });
}
