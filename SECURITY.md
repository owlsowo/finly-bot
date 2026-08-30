# Security policy

Finly is paper-only. Please do not report a supposed “live mode” by adding one;
live execution is intentionally outside the project boundary.

## Credentials

- Never commit Alpaca keys, raw local Llama logs, internal broker identifiers, or
  private receipts.
- Use `.env` or an MCP client's local environment block. `.env*` is ignored
  except for the credential-free `.env.example`.
- Rotate a key immediately if it appears in Git history, a screenshot, a video,
  a browser bundle, or a receipt.

Public artifacts omit every account identifier, including the dedicated paper
account number. Runtime checks may compare that number in memory against the
ignored local environment, but generated public evidence records only that the
identifier was verified and redacted.

## Publishable broker artifacts

- Broker acknowledgments and reconciled order readbacks pass through a strict
  positive allowlist before they can enter a publishable receipt.
- Public artifacts omit account numbers, internal account UUIDs, broker-order IDs,
  client-order IDs, broker-internal asset IDs, API-key identifiers, and
  credentials. Public OCC symbols are not account identifiers. Unknown broker
  fields and raw MCP response bodies are dropped rather than recursively copied
  and redacted.
- The private permit ledger may retain a broker order identifier for local
  reconciliation. Treat `data/private/` as operational state: never publish it,
  attach it to an issue, or include it in a demo capture.

## Reporting

Send security reports to bwen412@brandeis.edu. Include the affected file,
reproduction steps, and whether the issue can escape the exact paper-host
allowlist. Do not place real credentials in a report.
