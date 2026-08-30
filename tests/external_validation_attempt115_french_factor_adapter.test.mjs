import assert from "node:assert/strict";
import test from "node:test";

import {
  KENNETH_FRENCH_ATTEMPT115_TARGET_ALIASES,
  KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA,
  KENNETH_FRENCH_DAILY_PROXY_LABELS,
  KENNETH_FRENCH_RAW_MEMBER_MAX_FOOTER_LINES,
  KENNETH_FRENCH_RAW_MEMBER_MAX_PREAMBLE_LINES,
  adaptKennethFrenchDailyFactorsToAttempt115,
  canonicalizeKennethFrenchDailyFactorZipMember,
  evaluateAttempt115TargetsOnKennethFrenchDailyFactors,
  parseKennethFrenchDailyFactorCsv,
} from "../research/external_validation_attempt115/kenneth_french_daily_factor_adapter.mjs";
import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
  attempt115DownsideSemivolatilityTarget,
  attempt115IncumbentTarget,
} from "../research/prospective_attempt115/policy.mjs";

function csv(...rows) {
  return [KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA, ...rows].join("\n");
}

function compactDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function inventedFactorCsv(count = 253) {
  const start = new Date("2024-01-02T00:00:00.000Z");
  const rows = Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const marketExcess = index % 7 === 0 ? "-0.04" : index % 2 === 0 ? "0.12" : "0.08";
    const smb = index % 3 === 0 ? "0.03" : "-0.02";
    const hml = index % 5 === 0 ? "-0.01" : "0.02";
    return `${compactDate(date)},${marketExcess},${smb},${hml},0.01`;
  });
  return csv(...rows);
}

test("strict parser constructs decimal market and risk-free proxies from supplied text", () => {
  const parsed = parseKennethFrenchDailyFactorCsv(csv(
    "20240102,1.00,0.20,-0.30,0.04",
    "20240103,-0.50,-0.10,0.40,0.05",
  ));

  assert.equal(parsed.rows[0].date, "2024-01-02");
  assert.equal(parsed.rows[0]["Mkt-RF"], 1);
  assert.equal(parsed.rows[0].SMB, 0.2);
  assert.equal(parsed.rows[0].HML, -0.3);
  assert.equal(parsed.rows[0].RF, 0.04);
  assert.equal(parsed.rows[0].MARKET_PROXY, 0.0104);
  assert.equal(parsed.rows[0].RF_PROXY, 0.0004);
  assert.equal(parsed.rows[1].MARKET_PROXY, -0.0045000000000000005);
  assert.equal(parsed.rows[1].RF_PROXY, 0.0005);
  assert.deepEqual(parsed.proxy_labels, KENNETH_FRENCH_DAILY_PROXY_LABELS);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.rows));
  assert.ok(Object.isFrozen(parsed.rows[0]));
});

test("parser accepts supplied UTF-8 bytes and CRLF without changing the result", () => {
  const text = `${csv(
    "20240228,0.10,0.01,-0.02,0.03",
    "20240229,0.20,0.02,-0.01,0.03",
  ).replaceAll("\n", "\r\n")}\r\n`;
  const bytes = new TextEncoder().encode(text);
  const parsedBytes = parseKennethFrenchDailyFactorCsv(bytes);
  const parsedText = parseKennethFrenchDailyFactorCsv(text);

  assert.deepEqual(parsedBytes, parsedText);
  assert.equal(parsedBytes.rows.at(-1).date, "2024-02-29");
});

test("raw ZIP-member canonicalizer accepts one spaced blank-cell header and bounded text", () => {
  const rawMember = [
    "Synthetic daily-factor member for parser testing only.",
    "Generated fixture; no observed returns are present.",
    "",
    "   , Mkt-RF , SMB , HML , RF   ",
    " 20240102 , 1.00 , 0.20 , -0.30 , 0.04 ",
    " 20240103 , -0.50 , -0.10 , 0.40 , 0.05 ",
    "",
    "Synthetic footer: invented values only.",
    "Copyright fixture author.",
  ].join("\n");
  const canonical = canonicalizeKennethFrenchDailyFactorZipMember(rawMember);

  assert.equal(canonical, csv(
    "20240102,1.00,0.20,-0.30,0.04",
    "20240103,-0.50,-0.10,0.40,0.05",
  ));
  const parsed = parseKennethFrenchDailyFactorCsv(canonical);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].MARKET_PROXY, 0.0104);
  assert.equal(parsed.rows[1].RF_PROXY, 0.0005);
});

test("raw canonicalizer accepts supplied CRLF bytes and a data-only EOF", () => {
  const rawMember = [
    "Synthetic preamble.",
    " , Mkt-RF, SMB, HML, RF",
    "20240228,0.10,0.01,-0.02,0.03",
    "20240229,0.20,0.02,-0.01,0.03",
  ].join("\r\n");
  const bytes = new TextEncoder().encode(`${rawMember}\r\n`);

  assert.equal(
    canonicalizeKennethFrenchDailyFactorZipMember(bytes),
    csv(
      "20240228,0.10,0.01,-0.02,0.03",
      "20240229,0.20,0.02,-0.01,0.03",
    ),
  );
});

test("raw canonicalizer requires one unambiguous header within its preamble bound", () => {
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      "Synthetic preamble.",
      "20240102,0,0,0,0",
    ].join("\n")),
    /one unique factor header/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
      " ,Mkt-RF,SMB,HML,RF",
    ].join("\n")),
    /one unique factor header/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      " ,Mkt-RF,HML,SMB,RF",
      "20240102,0,0,0,0",
    ].join("\n")),
    /ambiguous factor header/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      ...Array(KENNETH_FRENCH_RAW_MEMBER_MAX_PREAMBLE_LINES + 1).fill("Synthetic text."),
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
    ].join("\n")),
    /preamble exceeds/iu,
  );
});

test("raw canonicalizer rejects malformed rows and injected blank or textual data gaps", () => {
  for (const source of [
    [
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
      "",
      "20240103,0,0,0,0",
    ],
    [
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
      "Injected text gap.",
      "20240103,0,0,0,0",
    ],
  ]) {
    assert.throws(
      () => canonicalizeKennethFrenchDailyFactorZipMember(source.join("\n")),
      /gap|after its footer/iu,
    );
  }
  for (const row of [
    "2024-01-02,0,0,0,0",
    "20240102,0,not-a-number,0,0",
    "20240102,0,0,0",
    "20240102,0,0,0,0,0",
  ]) {
    assert.throws(
      () => canonicalizeKennethFrenchDailyFactorZipMember([
        " ,Mkt-RF,SMB,HML,RF",
        row,
      ].join("\n")),
      /malformed numeric data row|unknown structure/iu,
    );
  }
});

test("raw canonicalizer rejects multiple separators and blank-only tails", () => {
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
      "",
      "",
      "Synthetic footer text.",
    ].join("\n")),
    /multiple blank footer separators/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
      "",
      "",
    ].join("\n")),
    /blank-only tail/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
      "Synthetic footer text.",
      "",
      "More synthetic footer text.",
    ].join("\n")),
    /ambiguous blank within its footer/iu,
  );
});

test("raw canonicalizer rejects data after a textual footer and an oversized footer", () => {
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
      "Synthetic footer begins.",
      "20240103,0,0,0,0",
    ].join("\n")),
    /data-like row after its footer/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
      ...Array(KENNETH_FRENCH_RAW_MEMBER_MAX_FOOTER_LINES + 1)
        .fill("Synthetic footer text."),
    ].join("\n")),
    /footer exceeds/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrenchDailyFactorZipMember([
      " ,Mkt-RF,SMB,HML,RF",
      "20240102,0,0,0,0",
      "---",
    ].join("\n")),
    /unknown structure/iu,
  );
});

test("parser rejects any header or row schema drift", () => {
  for (const source of [
    "date,SMB,Mkt-RF,HML,RF\n20240102,0,0,0,0",
    "Date,Mkt-RF,SMB,HML,RF\n20240102,0,0,0,0",
    "date,Mkt-RF,SMB,HML\n20240102,0,0,0",
    "date,Mkt-RF,SMB,HML,RF,EXTRA\n20240102,0,0,0,0,0",
  ]) {
    assert.throws(
      () => parseKennethFrenchDailyFactorCsv(source),
      /schema drift/iu,
    );
  }
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(csv("20240102,0,0,0,0,EXTRA")),
    /exact schema/iu,
  );
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(`${csv("20240102,0,0,0,0")}\n\n`),
    /blank/iu,
  );
});

test("parser rejects duplicate, descending, and invalid source dates", () => {
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(csv(
      "20240102,0,0,0,0",
      "20240102,0,0,0,0",
    )),
    /duplicates date/iu,
  );
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(csv(
      "20240103,0,0,0,0",
      "20240102,0,0,0,0",
    )),
    /strictly increasing/iu,
  );
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(csv("20240230,0,0,0,0")),
    /invalid date/iu,
  );
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(csv("2024-01-02,0,0,0,0")),
    /YYYYMMDD/iu,
  );
});

test("parser rejects missing, sentinel, nonnumeric, and nonfinite fields", () => {
  for (const [value, expected] of [
    ["", /is missing/iu],
    ["-99.99", /sentinel/iu],
    ["-999", /sentinel/iu],
    ["NaN", /must be numeric/iu],
    ["Infinity", /must be numeric/iu],
    ["1e309", /must be finite/iu],
  ]) {
    assert.throws(
      () => parseKennethFrenchDailyFactorCsv(csv(`20240102,0,${value},0,0`)),
      expected,
    );
  }
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(new Uint8Array([0xff, 0xfe])),
    /valid UTF-8/iu,
  );
});

test("parser rejects source and constructed proxy returns at or below total loss", () => {
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(csv("20240102,-100,0,0,0")),
    /Mkt-RF return must be greater than -1/iu,
  );
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(csv("20240102,0,-100,0,0")),
    /SMB return must be greater than -1/iu,
  );
  assert.throws(
    () => parseKennethFrenchDailyFactorCsv(csv("20240102,-99,0,0,-2")),
    /MARKET_PROXY return must be finite and greater than -1/iu,
  );
});

test("adapter preserves proxy names while providing the frozen SPY/BIL input aliases", () => {
  const parsed = parseKennethFrenchDailyFactorCsv(csv(
    "20240102,1.00,0,0,0.04",
    "20240103,-0.50,0,0,0.05",
  ));
  const adapted = adaptKennethFrenchDailyFactorsToAttempt115(parsed);

  assert.deepEqual(adapted.source_proxy_labels, KENNETH_FRENCH_DAILY_PROXY_LABELS);
  assert.deepEqual(
    adapted.frozen_target_input_aliases,
    KENNETH_FRENCH_ATTEMPT115_TARGET_ALIASES,
  );
  assert.match(adapted.claim_boundary, /not SPY or BIL ETF returns/iu);
  assert.equal(adapted.proxy_points.length, 2);
  assert.equal(adapted.proxy_points[0].date, "2024-01-02");
  assert.ok(Math.abs(adapted.proxy_points[0].MARKET_PROXY - 101.04) < 1e-12);
  assert.ok(Math.abs(adapted.proxy_points[0].RF_PROXY - 100.04) < 1e-12);
  assert.deepEqual(
    adapted.frozen_target_points.map(({ date, SPY, BIL }) => ({ date, SPY, BIL })),
    adapted.proxy_points.map(({ date, MARKET_PROXY, RF_PROXY }) => ({
      date,
      SPY: MARKET_PROXY,
      BIL: RF_PROXY,
    })),
  );
});

test("adapter revalidates parsed source fields and exact proxy-transform identity", () => {
  const parsed = parseKennethFrenchDailyFactorCsv(inventedFactorCsv());

  const changedMarketProxy = structuredClone(parsed);
  changedMarketProxy.rows[17].MARKET_PROXY += 0.001;
  assert.throws(
    () => adaptKennethFrenchDailyFactorsToAttempt115(changedMarketProxy),
    /proxy transform identity changed/iu,
  );

  const changedSource = structuredClone(parsed);
  changedSource.rows[17].RF += 0.01;
  assert.throws(
    () => adaptKennethFrenchDailyFactorsToAttempt115(changedSource),
    /proxy transform identity changed/iu,
  );

  const changedUnits = structuredClone(parsed);
  changedUnits.proxy_return_units = "percent";
  assert.throws(
    () => adaptKennethFrenchDailyFactorsToAttempt115(changedUnits),
    /source schema is invalid/iu,
  );

  const extraRowField = structuredClone(parsed);
  extraRowField.rows[17].unregistered = true;
  assert.throws(
    () => adaptKennethFrenchDailyFactorsToAttempt115(extraRowField),
    /row 18 fields are invalid/iu,
  );

  const duplicateDate = structuredClone(parsed);
  duplicateDate.rows[17].date = duplicateDate.rows[16].date;
  assert.throws(
    () => adaptKennethFrenchDailyFactorsToAttempt115(duplicateDate),
    /dates must be strictly increasing/iu,
  );
});

test("target adapter delegates the 253-row synthetic warmup to both frozen functions", () => {
  const parsed = parseKennethFrenchDailyFactorCsv(inventedFactorCsv());
  const adapted = adaptKennethFrenchDailyFactorsToAttempt115(parsed);
  const evaluated = evaluateAttempt115TargetsOnKennethFrenchDailyFactors(parsed);

  assert.equal(adapted.source_return_rows, 253);
  assert.equal(adapted.frozen_target_points.length, 253);
  assert.deepEqual(
    evaluated.policies[ATTEMPT115_INCUMBENT_POLICY_ID],
    attempt115IncumbentTarget(adapted.frozen_target_points),
  );
  assert.deepEqual(
    evaluated.policies[ATTEMPT115_CHALLENGER_POLICY_ID],
    attempt115DownsideSemivolatilityTarget(adapted.frozen_target_points),
  );
  assert.deepEqual(evaluated.source_proxy_labels, KENNETH_FRENCH_DAILY_PROXY_LABELS);
  assert.ok(Object.isFrozen(evaluated));
  assert.ok(Object.isFrozen(evaluated.policies));

  const tooShort = parseKennethFrenchDailyFactorCsv(inventedFactorCsv(252));
  assert.throws(
    () => evaluateAttempt115TargetsOnKennethFrenchDailyFactors(tooShort),
    /at least 253 factor-return rows/iu,
  );
});
