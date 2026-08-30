import { sha256 } from "./canonical.mjs";

export function buildDesiredOrderProjection(candidate, quantity, runId) {
  if (!candidate) return null;
  return {
    client_order_id: `finly-${sha256({ runId, candidate_id: candidate.candidate_id }).slice(-20)}`,
    order_class: "mleg",
    qty: String(quantity),
    type: "limit",
    time_in_force: "day",
    limit_price: candidate.entry_debit.toFixed(2),
    legs: [
      {
        symbol: candidate.long_leg.symbol,
        ratio_qty: "1",
        side: "buy",
        position_intent: "buy_to_open",
      },
      {
        symbol: candidate.short_leg.symbol,
        ratio_qty: "1",
        side: "sell",
        position_intent: "sell_to_open",
      },
    ],
  };
}

export function orderProjectionHash(candidate, quantity, runId) {
  const projection = buildDesiredOrderProjection(candidate, quantity, runId);
  return projection ? sha256(projection) : null;
}
