import { sha256 } from "./canonical.mjs";

const EXECUTION_FIELDS = Object.freeze([
  "schema_version",
  "action",
  "underlying",
  "expiry",
  "dte",
  "long_leg",
  "short_leg",
  "width",
  "entry_debit",
  "max_loss",
  "max_gain",
  "reward_risk",
]);

export function candidateExecutionSnapshot(candidate) {
  return Object.fromEntries(EXECUTION_FIELDS.map((field) => [field, candidate?.[field]]));
}

export function computeCandidateId(candidate) {
  return sha256(candidateExecutionSnapshot(candidate));
}

export function assertCandidateIntegrity(candidate) {
  if (!candidate || typeof candidate !== "object") throw new TypeError("candidate is required");
  if (computeCandidateId(candidate) !== candidate.candidate_id) {
    throw new Error("candidate integrity mismatch");
  }
  return true;
}
