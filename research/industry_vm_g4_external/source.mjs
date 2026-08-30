export const KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION =
  "Average Value Weighted Returns -- Daily";
export const KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION =
  "Average Equal Weighted Returns -- Daily";
export const KENNETH_FRENCH_10_INDUSTRY_CSV_SCHEMA =
  "date,NoDur,Durbl,Manuf,Enrgy,HiTec,Telcm,Shops,Hlth,Utils,Other";
export const KENNETH_FRENCH_10_INDUSTRY_PARSE_SCHEMA =
  "finly_kenneth_french_10_industry_daily_parse.v1";
export const KENNETH_FRENCH_10_INDUSTRY_FACTOR_ADAPTER_SCHEMA =
  "finly_kenneth_french_10_industry_factor_adapter.v1";

export const KENNETH_FRENCH_10_INDUSTRY_SYMBOLS = Object.freeze([
  "NoDur",
  "Durbl",
  "Manuf",
  "Enrgy",
  "HiTec",
  "Telcm",
  "Shops",
  "Hlth",
  "Utils",
  "Other",
]);
export const KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS = Object.freeze([
  ...KENNETH_FRENCH_10_INDUSTRY_SYMBOLS,
  "MARKET",
  "RF",
]);

export const KENNETH_FRENCH_10_INDUSTRY_MAX_MEMBER_BYTES = 16 * 1024 * 1024;
export const KENNETH_FRENCH_10_INDUSTRY_MAX_PREAMBLE_LINES = 64;
export const KENNETH_FRENCH_10_INDUSTRY_MAX_SECTION_ROWS = 40_000;
export const KENNETH_FRENCH_10_INDUSTRY_MAX_FOOTER_LINES = 40_000;

const RAW_HEADER_FIELDS = Object.freeze(["", ...KENNETH_FRENCH_10_INDUSTRY_SYMBOLS]);
const CANONICAL_FIELDS = Object.freeze(["date", ...KENNETH_FRENCH_10_INDUSTRY_SYMBOLS]);
const FACTOR_FIELDS = Object.freeze(["date", "Mkt-RF", "SMB", "HML", "RF"]);
const FACTOR_RETURN_FIELDS = Object.freeze(FACTOR_FIELDS.slice(1));
const SOURCE_SENTINELS = Object.freeze([-99.99, -999, -999.99]);
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const INITIAL_INDEX_LEVEL = 100;

function fail(message) {
  throw new TypeError(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function stripAsciiHorizontalSpace(value) {
  return value.replace(/^[ \t]*|[ \t]*$/gu, "");
}

function decodeMember(input) {
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > KENNETH_FRENCH_10_INDUSTRY_MAX_MEMBER_BYTES) {
      fail("Kenneth French 10 Industry member exceeds the byte bound");
    }
    return input;
  }
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    if (input.byteLength > KENNETH_FRENCH_10_INDUSTRY_MAX_MEMBER_BYTES) {
      fail("Kenneth French 10 Industry member exceeds the byte bound");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      fail("Kenneth French 10 Industry member bytes must be valid UTF-8");
    }
  }
  fail("Kenneth French 10 Industry member must be supplied as a string or bytes");
}

function normalizedLines(input) {
  const decoded = decodeMember(input);
  if (/\r(?!\n)/u.test(decoded)) {
    fail("Kenneth French 10 Industry member contains an unsupported bare carriage return");
  }
  const hasUnsupportedControl = [...decoded].some((character) => {
    const code = character.codePointAt(0);
    return (code >= 0 && code <= 8) || code === 11 || code === 12
      || (code >= 14 && code <= 31) || code === 127;
  });
  if (hasUnsupportedControl) {
    fail("Kenneth French 10 Industry member contains an unsupported control character");
  }
  const lines = decoded.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function cellsWithAsciiSpaceRemoved(line) {
  return line.split(",").map(stripAsciiHorizontalSpace);
}

function isExactRawHeader(line) {
  const cells = cellsWithAsciiSpaceRemoved(line);
  return cells.length === RAW_HEADER_FIELDS.length
    && cells.every((value, index) => value === RAW_HEADER_FIELDS[index]);
}

function looksLikeIndustryHeader(line) {
  const cells = cellsWithAsciiSpaceRemoved(line);
  return KENNETH_FRENCH_10_INDUSTRY_SYMBOLS.some((symbol) => cells.includes(symbol));
}

function classifyRawDataLine(line) {
  const cells = cellsWithAsciiSpaceRemoved(line);
  const exact = cells.length === CANONICAL_FIELDS.length
    && /^\d{8}$/u.test(cells[0])
    && cells.slice(1).every((value) => NUMBER_PATTERN.test(value));
  const numericCells = cells.filter((value) => NUMBER_PATTERN.test(value)).length;
  const dataLike = exact
    || /^\d{6,8}$/u.test(cells[0] ?? "")
    || /^\s*\d{6,8}\s*,/u.test(line)
    || (cells.length >= 8 && numericCells >= 5);
  return { cells, exact, dataLike };
}

function isoDateFromSource(value, rowNumber, sourceName) {
  if (!/^\d{8}$/u.test(value)) {
    fail(`${sourceName} row ${rowNumber} date must use YYYYMMDD`);
  }
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    fail(`${sourceName} row ${rowNumber} has an invalid date`);
  }
  return iso;
}

function assertIsoDate(value, rowNumber, sourceName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail(`${sourceName} row ${rowNumber} date must be an ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${sourceName} row ${rowNumber} date must be an ISO date`);
  }
}

function sourcePercentNumber(value, field, rowNumber, sourceName) {
  if (value.length === 0) fail(`${sourceName} row ${rowNumber} ${field} is missing`);
  if (!NUMBER_PATTERN.test(value)) {
    fail(`${sourceName} row ${rowNumber} ${field} must be numeric`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${sourceName} row ${rowNumber} ${field} must be finite`);
  if (SOURCE_SENTINELS.includes(parsed)) {
    fail(`${sourceName} row ${rowNumber} ${field} is a missing-value sentinel`);
  }
  if (parsed <= -100) {
    fail(`${sourceName} row ${rowNumber} ${field} simple return must be greater than -100 percent`);
  }
  return parsed;
}

function extractRawSection(lines, sectionIndex, endExclusive, sectionName, {
  allowTextFooter = false,
} = {}) {
  let headerIndex = sectionIndex + 1;
  let blankLinesBeforeHeader = 0;
  while (headerIndex < endExclusive && stripAsciiHorizontalSpace(lines[headerIndex]) === "") {
    blankLinesBeforeHeader += 1;
    headerIndex += 1;
  }
  if (blankLinesBeforeHeader > 2 || headerIndex >= endExclusive) {
    fail(`Kenneth French 10 Industry ${sectionName} section omits its bounded header`);
  }
  if (!isExactRawHeader(lines[headerIndex])) {
    if (looksLikeIndustryHeader(lines[headerIndex])) {
      fail(`Kenneth French 10 Industry ${sectionName} section header schema drifted`);
    }
    fail(`Kenneth French 10 Industry ${sectionName} section omits its exact header`);
  }

  const canonicalRows = [];
  let bodyEnded = false;
  let footerStart = endExclusive;
  for (let index = headerIndex + 1; index < endExclusive; index += 1) {
    const line = lines[index];
    const trimmed = stripAsciiHorizontalSpace(line);
    const classified = classifyRawDataLine(line);
    if (!bodyEnded && classified.exact) {
      if (canonicalRows.length >= KENNETH_FRENCH_10_INDUSTRY_MAX_SECTION_ROWS) {
        fail(`Kenneth French 10 Industry ${sectionName} section exceeds the row bound`);
      }
      canonicalRows.push(classified.cells.join(","));
      continue;
    }
    if (classified.dataLike) {
      const location = bodyEnded ? "after its data table" : "in a malformed data row";
      fail(`Kenneth French 10 Industry ${sectionName} section contains data-like content ${location}`);
    }
    if (!bodyEnded) {
      bodyEnded = true;
      footerStart = trimmed === "" ? index + 1 : index;
    }
    if (!allowTextFooter && trimmed !== "") {
      fail(`Kenneth French 10 Industry ${sectionName} section contains text before the next section`);
    }
  }
  if (canonicalRows.length === 0) {
    fail(`Kenneth French 10 Industry ${sectionName} section contains no daily rows`);
  }
  return { canonicalRows, footerStart };
}

/**
 * Extract and canonicalize the value-weighted table from an already-supplied
 * official-style ZIP member. Both official tables are parsed and their dates
 * must match, but equal-weighted returns never enter the returned payload.
 */
export function canonicalizeKennethFrench10IndustryDailyMember(input) {
  const lines = normalizedLines(input);
  const exactValueIndexes = [];
  const exactEqualIndexes = [];
  const ambiguousIndexes = [];
  lines.forEach((line, index) => {
    const trimmed = stripAsciiHorizontalSpace(line);
    if (trimmed === KENNETH_FRENCH_10_INDUSTRY_DAILY_SECTION) {
      exactValueIndexes.push(index);
    } else if (trimmed === KENNETH_FRENCH_10_INDUSTRY_EQUAL_DAILY_SECTION) {
      exactEqualIndexes.push(index);
    } else if ((/value\s+weighted\s+returns/iu.test(trimmed)
      || /equal\s+weighted\s+returns/iu.test(trimmed)) && /daily/iu.test(trimmed)) {
      ambiguousIndexes.push(index);
    }
  });
  if (ambiguousIndexes.length > 0) {
    fail("Kenneth French 10 Industry member contains an ambiguous daily section label");
  }
  if (exactValueIndexes.length !== 1 || exactEqualIndexes.length !== 1) {
    fail("Kenneth French 10 Industry member must contain one unique value-weighted and one unique equal-weighted daily section");
  }
  const valueIndex = exactValueIndexes[0];
  const equalIndex = exactEqualIndexes[0];
  if (valueIndex >= equalIndex) {
    fail("Kenneth French 10 Industry value-weighted section must precede the equal-weighted section");
  }
  if (valueIndex > KENNETH_FRENCH_10_INDUSTRY_MAX_PREAMBLE_LINES) {
    fail("Kenneth French 10 Industry member preamble exceeds the bounded line count");
  }
  lines.slice(0, valueIndex).forEach((line) => {
    if (classifyRawDataLine(line).dataLike) {
      fail("Kenneth French 10 Industry member preamble contains a data-like row");
    }
  });

  const valueTable = extractRawSection(
    lines,
    valueIndex,
    equalIndex,
    "value-weighted",
  );
  const equalTable = extractRawSection(
    lines,
    equalIndex,
    lines.length,
    "equal-weighted",
    { allowTextFooter: true },
  );
  if (lines.length - equalTable.footerStart > KENNETH_FRENCH_10_INDUSTRY_MAX_FOOTER_LINES) {
    fail("Kenneth French 10 Industry member footer exceeds the bounded line count");
  }

  const valueCanonical = [
    KENNETH_FRENCH_10_INDUSTRY_CSV_SCHEMA,
    ...valueTable.canonicalRows,
  ].join("\n");
  const equalCanonical = [
    KENNETH_FRENCH_10_INDUSTRY_CSV_SCHEMA,
    ...equalTable.canonicalRows,
  ].join("\n");
  const valueParsed = parseKennethFrench10IndustryDailyCsv(valueCanonical);
  const equalParsed = parseKennethFrench10IndustryDailyCsv(equalCanonical);
  if (valueParsed.rows.length !== equalParsed.rows.length
    || valueParsed.rows.some((row, index) => row.date !== equalParsed.rows[index].date)) {
    fail("Kenneth French 10 Industry value-weighted and equal-weighted date sequences must match exactly");
  }
  return valueCanonical;
}

/** Parse canonical value-weighted 10 Industry daily percentage returns. */
export function parseKennethFrench10IndustryDailyCsv(input) {
  const lines = normalizedLines(input);
  if (lines[0] !== KENNETH_FRENCH_10_INDUSTRY_CSV_SCHEMA) {
    fail(
      `Kenneth French 10 Industry CSV schema drift: expected exactly ${KENNETH_FRENCH_10_INDUSTRY_CSV_SCHEMA}`,
    );
  }
  if (lines.length === 1) fail("Kenneth French 10 Industry CSV has no data rows");

  let previousDate = "";
  const rows = lines.slice(1).map((line, index) => {
    const rowNumber = index + 2;
    if (line === "") fail(`Kenneth French 10 Industry row ${rowNumber} is blank`);
    const values = cellsWithAsciiSpaceRemoved(line);
    if (values.length !== CANONICAL_FIELDS.length) {
      fail(`Kenneth French 10 Industry row ${rowNumber} does not match the exact schema`);
    }
    const date = isoDateFromSource(
      values[0],
      rowNumber,
      "Kenneth French 10 Industry",
    );
    if (date === previousDate) {
      fail(`Kenneth French 10 Industry row ${rowNumber} duplicates date ${date}`);
    }
    if (date < previousDate) {
      fail("Kenneth French 10 Industry dates must be strictly increasing");
    }
    previousDate = date;
    return {
      date,
      ...Object.fromEntries(KENNETH_FRENCH_10_INDUSTRY_SYMBOLS.map((symbol, symbolIndex) => [
        symbol,
        sourcePercentNumber(
          values[symbolIndex + 1],
          symbol,
          rowNumber,
          "Kenneth French 10 Industry",
        ),
      ])),
    };
  });

  return deepFreeze({
    schema_version: KENNETH_FRENCH_10_INDUSTRY_PARSE_SCHEMA,
    csv_schema: KENNETH_FRENCH_10_INDUSTRY_CSV_SCHEMA,
    source_return_units: "percent simple daily returns",
    columns: [...KENNETH_FRENCH_10_INDUSTRY_SYMBOLS],
    rows,
  });
}

function validateParsedIndustrySource(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype) {
    fail("a parsed Kenneth French 10 Industry source is required");
  }
  if (parsed.schema_version !== KENNETH_FRENCH_10_INDUSTRY_PARSE_SCHEMA
    || parsed.csv_schema !== KENNETH_FRENCH_10_INDUSTRY_CSV_SCHEMA
    || parsed.source_return_units !== "percent simple daily returns"
    || !Array.isArray(parsed.columns)
    || parsed.columns.length !== KENNETH_FRENCH_10_INDUSTRY_SYMBOLS.length
    || parsed.columns.some((symbol, index) => symbol !== KENNETH_FRENCH_10_INDUSTRY_SYMBOLS[index])
    || !Array.isArray(parsed.rows)
    || parsed.rows.length === 0) {
    fail("parsed Kenneth French 10 Industry source schema is invalid");
  }
  let previousDate = "";
  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const expectedKeys = [...CANONICAL_FIELDS].sort();
    const actualKeys = row && typeof row === "object" && !Array.isArray(row)
      ? Object.keys(row).sort()
      : [];
    if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, keyIndex) => key !== expectedKeys[keyIndex])) {
      fail(`parsed Kenneth French 10 Industry row ${rowNumber} fields are invalid`);
    }
    assertIsoDate(row.date, rowNumber, "parsed Kenneth French 10 Industry");
    if (row.date <= previousDate) {
      fail("parsed Kenneth French 10 Industry dates must be strictly increasing");
    }
    previousDate = row.date;
    KENNETH_FRENCH_10_INDUSTRY_SYMBOLS.forEach((symbol) => {
      sourcePercentNumber(String(row[symbol]), symbol, rowNumber, "parsed Kenneth French 10 Industry");
      if (typeof row[symbol] !== "number") {
        fail(`parsed Kenneth French 10 Industry row ${rowNumber} ${symbol} must remain numeric`);
      }
    });
  });
}

function validateCanonicalFactorRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    fail("canonical Kenneth French factor rows are required");
  }
  let previousDate = "";
  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const actualKeys = row && typeof row === "object" && !Array.isArray(row)
      ? Object.keys(row).sort()
      : [];
    const expectedKeys = [...FACTOR_FIELDS].sort();
    if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, keyIndex) => key !== expectedKeys[keyIndex])) {
      fail(`canonical Kenneth French factor row ${rowNumber} fields are invalid`);
    }
    assertIsoDate(row.date, rowNumber, "canonical Kenneth French factor");
    if (row.date <= previousDate) {
      fail("canonical Kenneth French factor dates must be strictly increasing");
    }
    previousDate = row.date;
    FACTOR_RETURN_FIELDS.forEach((field) => {
      if (typeof row[field] !== "number") {
        fail(`canonical Kenneth French factor row ${rowNumber} ${field} must be numeric`);
      }
      sourcePercentNumber(String(row[field]), field, rowNumber, "canonical Kenneth French factor");
    });
    const marketReturnPercent = row["Mkt-RF"] + row.RF;
    if (!Number.isFinite(marketReturnPercent) || marketReturnPercent <= -100) {
      fail(`canonical Kenneth French factor row ${rowNumber} MARKET simple return must be greater than -100 percent`);
    }
  });
}

/**
 * Require exact date alignment and compound the source returns into positive
 * price indices suitable for the causal strategy engine.
 */
export function adaptKennethFrench10IndustryWithFactors(parsedIndustries, factorRows) {
  validateParsedIndustrySource(parsedIndustries);
  validateCanonicalFactorRows(factorRows);
  if (parsedIndustries.rows.length !== factorRows.length) {
    fail("Kenneth French industry and factor sources must contain the same exact dates");
  }

  const levels = Object.fromEntries(KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS.map((symbol) => [
    symbol,
    INITIAL_INDEX_LEVEL,
  ]));
  const points = parsedIndustries.rows.map((industryRow, index) => {
    const factorRow = factorRows[index];
    if (industryRow.date !== factorRow.date) {
      fail(`Kenneth French industry and factor dates differ at ${industryRow.date} / ${factorRow.date}`);
    }
    const decimalReturns = {
      ...Object.fromEntries(KENNETH_FRENCH_10_INDUSTRY_SYMBOLS.map((symbol) => [
        symbol,
        industryRow[symbol] / 100,
      ])),
      MARKET: (factorRow["Mkt-RF"] + factorRow.RF) / 100,
      RF: factorRow.RF / 100,
    };
    KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS.forEach((symbol) => {
      const nextLevel = levels[symbol] * (1 + decimalReturns[symbol]);
      if (!Number.isFinite(nextLevel) || nextLevel <= 0) {
        fail(`Kenneth French joined row ${index + 1} produces an invalid ${symbol} index level`);
      }
      levels[symbol] = nextLevel;
    });
    return { date: industryRow.date, ...levels };
  });

  return deepFreeze({
    schema_version: KENNETH_FRENCH_10_INDUSTRY_FACTOR_ADAPTER_SCHEMA,
    source_return_units: "percent simple daily returns",
    panel_level_units: `compounded indices initialized at ${INITIAL_INDEX_LEVEL} before the first joined return`,
    market_identity: "MARKET = (Mkt-RF + RF) / 100",
    cash_and_financing_symbol: "RF",
    symbols: [...KENNETH_FRENCH_10_INDUSTRY_PANEL_SYMBOLS],
    exact_date_rows: points.length,
    points,
  });
}
