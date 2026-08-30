import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stableStringify, sha256 } from "./canonical.mjs";

function filenameFor(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

const RESERVATION_STATUSES = new Set(["reserved", "ambiguous", "accepted", "rejected", "closed"]);

function allowedReservationTransition(from, to) {
  if (!RESERVATION_STATUSES.has(from) || !RESERVATION_STATUSES.has(to)) return false;
  if (from === "closed" || from === "rejected") return to === from;
  if (to === "closed") return true;
  if (from === "reserved") return new Set(["reserved", "ambiguous", "accepted"]).has(to);
  if (from === "ambiguous") return new Set(["ambiguous", "accepted"]).has(to);
  return from === "accepted" && to === "accepted";
}

function assertTerminalDetail(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) throw new Error("terminal reservation evidence is required");
  const expected = [
    "closed_at",
    "lifecycle_id",
    "lifecycle_revision",
    "session_id",
    "terminal_evidence_sha256",
    "terminal_session_status",
  ];
  const actual = Object.keys(detail).sort();
  if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) {
    throw new Error("terminal reservation evidence contains missing or unknown fields");
  }
  for (const key of ["lifecycle_id", "session_id", "terminal_evidence_sha256"]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(detail[key])) throw new Error("terminal reservation evidence contains an invalid hash");
  }
  if (!Number.isInteger(detail.lifecycle_revision) || detail.lifecycle_revision < 0) {
    throw new Error("terminal reservation lifecycle revision is invalid");
  }
  if (!new Set(["CLOSED", "ABSENT"]).has(detail.terminal_session_status)) {
    throw new Error("terminal reservation session status is invalid");
  }
  const closedAt = new Date(detail.closed_at);
  if (Number.isNaN(closedAt.getTime()) || closedAt.toISOString() !== detail.closed_at) {
    throw new Error("terminal reservation timestamp is invalid");
  }
}

function assertSameTerminalDetail(record, detail) {
  for (const key of Object.keys(detail)) {
    if (record[key] !== detail[key]) throw new Error("closed reservation evidence conflicts with the terminal proof");
  }
}

export class MemoryPermitLedger {
  #issued = new Map();
  #reservations = new Map();

  async issue(certificate) {
    this.#issued.set(certificate.certificate_id, stableStringify(certificate));
  }

  async assertIssued(certificate) {
    if (this.#issued.get(certificate.certificate_id) !== stableStringify(certificate)) {
      throw new Error("certificate is not an exact trusted-ledger member");
    }
  }

  async reserve(certificate, context) {
    if (this.#reservations.has(certificate.nonce)) throw new Error("certificate nonce is already reserved or consumed");
    const activeRisk = [...this.#reservations.values()]
      .filter((entry) => !new Set(["rejected", "closed"]).has(entry.status))
      .reduce((sum, entry) => sum + entry.reserved_max_loss, 0);
    if (context.openDefinedRisk + activeRisk + certificate.reserved_max_loss > context.equity * context.aggregateRiskFraction) {
      throw new Error("durable aggregate risk reservation would exceed policy");
    }
    const record = { ...context, certificate_id: certificate.certificate_id, nonce: certificate.nonce, reserved_max_loss: certificate.reserved_max_loss, status: "reserved" };
    this.#reservations.set(certificate.nonce, record);
    return record;
  }

  async mark(nonce, status, detail = {}) {
    const record = this.#reservations.get(nonce);
    if (!record) throw new Error("reservation does not exist");
    if (!allowedReservationTransition(record.status, status)) throw new Error("reservation status transition is unsafe");
    if (record.status === "closed") return structuredClone(record);
    const updated = { ...record, ...detail, status };
    this.#reservations.set(nonce, updated);
    return structuredClone(updated);
  }

  async close(nonce, detail) {
    assertTerminalDetail(detail);
    const record = this.#reservations.get(nonce);
    if (!record) throw new Error("reservation does not exist");
    if (record.status === "closed") {
      assertSameTerminalDetail(record, detail);
      return structuredClone(record);
    }
    return this.mark(nonce, "closed", detail);
  }

  async loadReservation(nonce) {
    const record = this.#reservations.get(nonce);
    return record ? structuredClone(record) : null;
  }
}

export class FilePermitLedger {
  constructor(directory) {
    if (typeof directory !== "string" || directory.length < 2) throw new Error("permit ledger directory is required");
    this.directory = directory;
    this.issuedDirectory = join(directory, "issued");
    this.reservationDirectory = join(directory, "reservations");
    this.lockDirectory = join(directory, ".portfolio.lock");
  }

  async initialize() {
    await mkdir(this.issuedDirectory, { recursive: true, mode: 0o700 });
    await mkdir(this.reservationDirectory, { recursive: true, mode: 0o700 });
  }

  async issue(certificate) {
    await this.initialize();
    const path = join(this.issuedDirectory, `${filenameFor(certificate.certificate_id)}.json`);
    const body = `${stableStringify(certificate)}\n`;
    try {
      await writeFile(path, body, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await readFile(path, "utf8") !== body) throw new Error("certificate ID collision in issuer ledger");
    }
  }

  async assertIssued(certificate) {
    await this.initialize();
    const path = join(this.issuedDirectory, `${filenameFor(certificate.certificate_id)}.json`);
    let body;
    try {
      body = await readFile(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("certificate is not in the trusted issuer ledger");
      throw error;
    }
    if (body !== `${stableStringify(certificate)}\n`) throw new Error("certificate differs from trusted issuer-ledger record");
  }

  async reserve(certificate, context) {
    await this.initialize();
    await this.#acquireLock();
    try {
      const reservationPath = join(this.reservationDirectory, `${filenameFor(certificate.nonce)}.json`);
      try {
        await open(reservationPath, "wx", 0o600).then((handle) => handle.close());
      } catch (error) {
        if (error.code === "EEXIST") throw new Error("certificate nonce is already reserved or consumed");
        throw error;
      }
      const activeRisk = await this.#activeReservedRisk(reservationPath);
      if (context.openDefinedRisk + activeRisk + certificate.reserved_max_loss > context.equity * context.aggregateRiskFraction) {
        await this.#writeRecord(reservationPath, { status: "rejected", reason: "aggregate_risk", nonce: certificate.nonce });
        throw new Error("durable aggregate risk reservation would exceed policy");
      }
      const record = { ...context, certificate_id: certificate.certificate_id, nonce: certificate.nonce, reserved_max_loss: certificate.reserved_max_loss, status: "reserved" };
      await this.#writeRecord(reservationPath, record);
      return record;
    } finally {
      await this.#releaseLock();
    }
  }

  async mark(nonce, status, detail = {}) {
    await this.initialize();
    await this.#acquireLock();
    try {
      const path = join(this.reservationDirectory, `${filenameFor(nonce)}.json`);
      const current = JSON.parse(await readFile(path, "utf8"));
      if (!allowedReservationTransition(current.status, status)) throw new Error("reservation status transition is unsafe");
      if (current.status === "closed") return current;
      const updated = { ...current, ...detail, status };
      await this.#writeRecord(path, updated);
      return updated;
    } finally {
      await this.#releaseLock();
    }
  }

  async close(nonce, detail) {
    assertTerminalDetail(detail);
    await this.initialize();
    await this.#acquireLock();
    try {
      const path = join(this.reservationDirectory, `${filenameFor(nonce)}.json`);
      const current = JSON.parse(await readFile(path, "utf8"));
      if (current.status === "closed") {
        assertSameTerminalDetail(current, detail);
        return current;
      }
      if (!allowedReservationTransition(current.status, "closed")) throw new Error("reservation status transition is unsafe");
      const updated = { ...current, ...detail, status: "closed" };
      await this.#writeRecord(path, updated);
      return updated;
    } finally {
      await this.#releaseLock();
    }
  }

  async loadReservation(nonce) {
    await this.initialize();
    try {
      return JSON.parse(await readFile(join(this.reservationDirectory, `${filenameFor(nonce)}.json`), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async #activeReservedRisk(excludePath) {
    let total = 0;
    for (const name of await readdir(this.reservationDirectory)) {
      const path = join(this.reservationDirectory, name);
      if (path === excludePath || !name.endsWith(".json")) continue;
      const record = JSON.parse(await readFile(path, "utf8"));
      if (!new Set(["rejected", "closed"]).has(record.status)) total += Number(record.reserved_max_loss ?? 0);
    }
    return total;
  }

  async #writeRecord(path, record) {
    const temporary = `${path}.${process.pid}.${sha256(record).slice(-10)}.tmp`;
    await writeFile(temporary, `${stableStringify(record)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }

  async #acquireLock() {
    try {
      await mkdir(this.lockDirectory, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("portfolio reservation lock is busy; fail closed");
      throw error;
    }
  }

  async #releaseLock() {
    const handle = await open(this.lockDirectory, "r");
    await handle.close();
    const { rmdir } = await import("node:fs/promises");
    await rmdir(this.lockDirectory);
  }
}
