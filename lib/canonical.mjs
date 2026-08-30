import { createHash, randomUUID } from "node:crypto";

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function sha256(value) {
  const body = typeof value === "string" ? value : stableStringify(value);
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

export function id(prefix = "run") {
  return `${prefix}_${randomUUID()}`;
}

export function redactSecrets(value) {
  const secretName = /(secret|token|password|authorization|api[_-]?key)/i;
  const publicSecurityMetadata = new Set(["authorization_scope", "signer_key_id"]);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, secretName.test(key) && !publicSecurityMetadata.has(key) ? "[REDACTED]" : redactSecrets(item)]),
    );
  }
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .replace(/APCA-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
  }
  return value;
}
