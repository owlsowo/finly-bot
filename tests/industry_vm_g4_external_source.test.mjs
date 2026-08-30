import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptKennethFrench10IndustryWithFactors,
  canonicalizeKennethFrench10IndustryDailyMember,
  KENNETH_FRENCH_10_INDUSTRY_CSV_SCHEMA,
  KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION,
  KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION,
  KENNETH_FRENCH_10_INDUSTRY_MAX_PREAMBLE_LINES,
  KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS,
  KENNETH_FRENCH_10_INDUSTRY_SYMBOLS,
  parseKennethFrench10IndustryDailyCsv,
} from "../research/industry_vm_g4_external/source.mjs";

const RAW_HEADER = `,${KENNETH_FRENCH_10_INDUSTRY_SYMBOLS.join(",")}`;

function row(date, values = {}) {
  return [date, ...KENNETH_FRENCH_10_INDUSTRY_SYMBOLS.map((symbol) => (
    values[symbol] ?? "0.10"
  ))].join(",");
}

function canonical(...rows) {
  return [KENNETH_FRENCH_10_INDUSTRY_CSV_SCHEMA, ...rows].join("\n");
}

function factor(date, values = {}) {
  return {
    date,
    "Mkt-RF": values["Mkt-RF"] ?? 0.50,
    SMB: values.SMB ?? 0.10,
    HML: values.HML ?? -0.10,
    RF: values.RF ?? 0.02,
  };
}

test("raw member canonicalizer extracts one exact value-weighted section and ignores a bounded equal-weighted footer", () => {
  const raw = [
    "Synthetic parser fixture; these are invented values.",
    "No observed archive is embedded in this test.",
    "",
    `  ${KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION}  `,
    `  ${RAW_HEADER.split(",").join(" , ")}  `,
    `  ${row("20240102").split(",").join(" , ")}  `,
    row("20240103", { HiTec: "-0.20", Other: "0.30" }),
    "",
    KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION,
    RAW_HEADER,
    row("20240102", { NoDur: "9.99" }),
    row("20240103", { NoDur: "8.88" }),
  ].join("\n");

  const result = canonicalizeKennethFrench10IndustryDailyMember(raw);
  assert.equal(result, canonical(
    row("20240102"),
    row("20240103", { HiTec: "-0.20", Other: "0.30" }),
  ));
  const parsed = parseKennethFrench10IndustryDailyCsv(result);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1].HiTec, -0.2);
  assert.equal(parsed.rows[1].Other, 0.3);
  assert.deepEqual(parsed.columns, KENNETH_FRENCH_10_INDUSTRY_SYMBOLS);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.rows[0]));
});

test("raw member canonicalizer accepts UTF-8 bytes, CRLF, and harmless ASCII cell spaces", () => {
  const raw = [
    "Synthetic fixture.",
    KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION,
    RAW_HEADER,
    row("20240228"),
    row("20240229", { Durbl: "-1.25" }),
    "",
    KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION,
    RAW_HEADER,
    row("20240228", { NoDur: "0.30" }),
    row("20240229", { NoDur: "0.40" }),
  ].map((line) => `  ${line}  `).join("\r\n");
  const bytes = new TextEncoder().encode(`${raw}\r\n`);
  const result = canonicalizeKennethFrench10IndustryDailyMember(bytes);

  assert.equal(result, canonical(
    row("20240228"),
    row("20240229", { Durbl: "-1.25" }),
  ));
});

test("raw member canonicalizer rejects duplicate, ambiguous, and schema-drifted sections", () => {
  assert.throws(
    () => canonicalizeKennethFrench10IndustryDailyMember([
      KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
      KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION,
      KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
    ].join("\n")),
    /one unique/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrench10IndustryDailyMember([
      "Average value weighted returns - daily",
      RAW_HEADER,
      row("20240102"),
    ].join("\n")),
    /ambiguous/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrench10IndustryDailyMember([
      KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION,
      ",Durbl,NoDur,Manuf,Enrgy,HiTec,Telcm,Shops,Hlth,Utils,Other",
      row("20240102"),
      KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
    ].join("\n")),
    /schema drifted/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrench10IndustryDailyMember([
      ...Array(KENNETH_FRENCH_10_INDUSTRY_MAX_PREAMBLE_LINES + 1).fill("Synthetic text."),
      KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
      KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
    ].join("\n")),
    /preamble exceeds/iu,
  );
});

test("raw canonicalizer requires both official tables in order with identical dates", () => {
  assert.throws(
    () => canonicalizeKennethFrench10IndustryDailyMember([
      KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
    ].join("\n")),
    /one unique value-weighted and one unique equal-weighted/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrench10IndustryDailyMember([
      KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
      KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
    ].join("\n")),
    /must precede/iu,
  );
  assert.throws(
    () => canonicalizeKennethFrench10IndustryDailyMember([
      KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
      row("20240103"),
      KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION,
      RAW_HEADER,
      row("20240102"),
      row("20240104"),
    ].join("\n")),
    /date sequences must match exactly/iu,
  );
});

test("strict parser rejects missing, sentinel, nonfinite, insolvent, and invalid-date rows", () => {
  for (const [badValue, expected] of [
    ["", /missing/iu],
    ["-99.99", /sentinel/iu],
    ["-999", /sentinel/iu],
    ["1e999", /finite/iu],
    ["NaN", /numeric/iu],
    ["-100", /greater than -100/iu],
  ]) {
    assert.throws(
      () => parseKennethFrench10IndustryDailyCsv(canonical(row("20240102", { NoDur: badValue }))),
      expected,
    );
  }
  assert.throws(
    () => parseKennethFrench10IndustryDailyCsv(canonical(row("20240230"))),
    /invalid date/iu,
  );
  assert.throws(
    () => parseKennethFrench10IndustryDailyCsv(canonical(
      row("20240103"),
      row("20240102"),
    )),
    /strictly increasing/iu,
  );
  assert.throws(
    () => parseKennethFrench10IndustryDailyCsv(canonical(
      row("20240102"),
      row("20240102"),
    )),
    /duplicates/iu,
  );
});

test("exact-date adapter compounds ten industries, MARKET, and a negative-return RF index", () => {
  const parsed = parseKennethFrench10IndustryDailyCsv(canonical(
    row("20240102", { NoDur: "1.00", HiTec: "2.00" }),
    row("20240103", { NoDur: "-0.50", HiTec: "1.00" }),
  ));
  const adapted = adaptKennethFrench10IndustryWithFactors(parsed, [
    factor("2024-01-02", { "Mkt-RF": 1.00, RF: -0.10 }),
    factor("2024-01-03", { "Mkt-RF": -0.50, RF: -0.10 }),
  ]);

  assert.deepEqual(adapted.symbols, KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS);
  assert.equal(adapted.exact_date_rows, 2);
  assert.equal(adapted.points[0].NoDur, 101);
  assert.equal(adapted.points[0].HiTec, 102);
  assert.ok(Math.abs(adapted.points[0].MARKET - 100.9) < 1e-12);
  assert.ok(Math.abs(adapted.points[0].RF - 99.9) < 1e-12);
  assert.ok(Math.abs(adapted.points[1].NoDur - 100.495) < 1e-12);
  assert.ok(Math.abs(adapted.points[1].HiTec - 103.02) < 1e-12);
  assert.ok(Math.abs(adapted.points[1].MARKET - 100.2946) < 1e-12);
  assert.ok(Math.abs(adapted.points[1].RF - 99.8001) < 1e-12);
  assert.ok(Object.isFrozen(adapted.points));
  assert.ok(Object.isFrozen(adapted.points[0]));
});

test("adapter fails closed unless factor rows have the exact schema and exact same dates", () => {
  const parsed = parseKennethFrench10IndustryDailyCsv(canonical(
    row("20240102"),
    row("20240103"),
  ));
  assert.throws(
    () => adaptKennethFrench10IndustryWithFactors(parsed, [factor("2024-01-02")]),
    /same exact dates/iu,
  );
  assert.throws(
    () => adaptKennethFrench10IndustryWithFactors(parsed, [
      factor("2024-01-02"),
      factor("2024-01-04"),
    ]),
    /dates differ/iu,
  );
  assert.throws(
    () => adaptKennethFrench10IndustryWithFactors(parsed, [
      { ...factor("2024-01-02"), MARKET_PROXY: 0.0052 },
      factor("2024-01-03"),
    ]),
    /fields are invalid/iu,
  );
  assert.throws(
    () => adaptKennethFrench10IndustryWithFactors(parsed, [
      factor("2024-01-02", { "Mkt-RF": -100, RF: -1 }),
      factor("2024-01-03"),
    ]),
    /greater than -100/iu,
  );
});
