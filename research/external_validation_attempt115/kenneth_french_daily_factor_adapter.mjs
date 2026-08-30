import {
  ATTEMPT115_CHALLENGER_POLICY_ID,
  ATTEMPT115_INCUMBENT_POLICY_ID,
  attempt115DownsideSemivolatilityTarget,
  attempt115IncumbentTarget,
} from "../prospective_attempt115/policy.mjs";

export const KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA =
  "date,Mkt-RF,SMB,HML,RF";
export const KENNETH_FRENCH_DAILY_FACTOR_PARSE_SCHEMA =
  "finly_kenneth_french_daily_factor_parse.v1";
export const KENNETH_FRENCH_ATTEMPT115_ADAPTER_SCHEMA =
  "finly_kenneth_french_attempt115_proxy_adapter.v1";
export const KENNETH_FRENCH_RAW_MEMBER_MAX_PREAMBLE_LINES = 32;
export const KENNETH_FRENCH_RAW_MEMBER_MAX_FOOTER_LINES = 32;

export const KENNETH_FRENCH_DAILY_PROXY_LABELS = Object.freeze({
  MARKET_PROXY: "Kenneth French Mkt-RF plus RF daily return proxy",
  RF_PROXY: "Kenneth French RF daily return proxy",
});

export const KENNETH_FRENCH_ATTEMPT115_TARGET_ALIASES = Object.freeze({
  SPY: "MARKET_PROXY",
  BIL: "RF_PROXY",
});

const SOURCE_FIELDS = Object.freeze(["date", "Mkt-RF", "SMB", "HML", "RF"]);
const RETURN_FIELDS = Object.freeze(["Mkt-RF", "SMB", "HML", "RF"]);
const SOURCE_SENTINELS = Object.freeze([-99.99, -999, -999.99]);
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const RAW_HEADER_FIELDS = Object.freeze(["", "Mkt-RF", "SMB", "HML", "RF"]);
const RAW_FACTOR_HEADER_TOKENS = Object.freeze(["mkt-rf", "smb", "hml", "rf"]);
const PARSED_TOP_LEVEL_FIELDS = Object.freeze([
  "schema_version",
  "csv_schema",
  "source_return_units",
  "proxy_return_units",
  "proxy_labels",
  "rows",
]);
const PARSED_ROW_FIELDS = Object.freeze([
  "date",
  "Mkt-RF",
  "SMB",
  "HML",
  "RF",
  "MARKET_PROXY",
  "RF_PROXY",
]);
const MINIMUM_FACTOR_RETURN_ROWS = 253;
const INITIAL_PROXY_LEVEL = 100;

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

function decodeCsv(input) {
  if (typeof input === "string") return input;
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      fail("Kenneth French daily factor CSV bytes must be valid UTF-8");
    }
  }
  fail("Kenneth French daily factor CSV must be supplied as a string or bytes");
}

function normalizedLines(input) {
  const decoded = decodeCsv(input);
  if (/\r(?!\n)/u.test(decoded)) {
    fail("Kenneth French daily factor CSV contains an unsupported bare carriage return");
  }
  const lines = decoded.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function rawHeaderKind(line) {
  const cells = line.split(",").map((value) => value.trim());
  if (cells.length === RAW_HEADER_FIELDS.length
    && cells.every((value, index) => value === RAW_HEADER_FIELDS[index])) {
    return "exact";
  }
  const lowerCells = cells.map((value) => value.toLowerCase());
  return RAW_FACTOR_HEADER_TOKENS.some((token) => lowerCells.includes(token))
    ? "ambiguous"
    : "none";
}

function rawDataLine(line) {
  const cells = line.split(",").map((value) => value.trim());
  const exact = cells.length === SOURCE_FIELDS.length
    && /^\d{8}$/u.test(cells[0])
    && cells.slice(1).every((value) => NUMBER_PATTERN.test(value));
  const numericCells = cells.filter((value) => NUMBER_PATTERN.test(value)).length;
  const dataLike = exact
    || /^\d{8}$/u.test(cells[0] ?? "")
    || /^\s*\d{6,8}\s*,/u.test(line)
    || NUMBER_PATTERN.test(line.trim())
    || (cells.length >= 4 && numericCells >= 2);
  return { cells, exact, dataLike };
}

function textualNonDataLine(line) {
  return /\p{L}/u.test(line) && !rawDataLine(line).dataLike;
}

/**
 * Canonicalize an already-supplied official-style daily-factor ZIP member.
 *
 * No ZIP, filesystem, or network access occurs here. The function recognizes
 * one bounded raw-member structure and emits the exact CSV accepted by
 * parseKennethFrenchDailyFactorCsv; unknown structures fail closed.
 */
export function canonicalizeKennethFrenchDailyFactorZipMember(input) {
  const lines = normalizedLines(input);
  const exactHeaderIndexes = [];
  const ambiguousHeaderIndexes = [];
  lines.forEach((line, index) => {
    const kind = rawHeaderKind(line);
    if (kind === "exact") exactHeaderIndexes.push(index);
    if (kind === "ambiguous") ambiguousHeaderIndexes.push(index);
  });

  if (ambiguousHeaderIndexes.length > 0) {
    fail("Kenneth French raw member contains an ambiguous factor header");
  }
  if (exactHeaderIndexes.length !== 1) {
    fail("Kenneth French raw member must contain one unique factor header");
  }
  const headerIndex = exactHeaderIndexes[0];
  if (headerIndex > KENNETH_FRENCH_RAW_MEMBER_MAX_PREAMBLE_LINES) {
    fail("Kenneth French raw member preamble exceeds the bounded line count");
  }

  lines.slice(0, headerIndex).forEach((line) => {
    if (line.trim() !== "" && !textualNonDataLine(line)) {
      fail("Kenneth French raw member preamble contains data-like or unknown structure");
    }
  });

  const canonicalRows = [];
  let footerStarted = false;
  let footerLineCount = 0;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const classified = rawDataLine(line);

    if (!footerStarted && classified.exact) {
      canonicalRows.push(classified.cells.join(","));
      continue;
    }
    if (!footerStarted && trimmed === "") {
      const separatedFooter = lines.slice(index + 1);
      if (canonicalRows.length === 0 || separatedFooter.length === 0) {
        fail("Kenneth French raw member contains an injected blank data gap or blank-only tail");
      }
      if (separatedFooter.length > KENNETH_FRENCH_RAW_MEMBER_MAX_FOOTER_LINES) {
        fail("Kenneth French raw member footer exceeds the bounded line count");
      }
      separatedFooter.forEach((footerLine) => {
        const footerClassification = rawDataLine(footerLine);
        if (footerClassification.dataLike) {
          fail("Kenneth French raw member contains a numeric or data-like row after its footer");
        }
        if (footerLine.trim() === "") {
          fail("Kenneth French raw member contains multiple blank footer separators");
        }
        if (!textualNonDataLine(footerLine)) {
          fail("Kenneth French raw member footer contains unknown structure");
        }
      });
      footerStarted = true;
      footerLineCount = separatedFooter.length;
      break;
    }
    if (!footerStarted && classified.dataLike) {
      fail("Kenneth French raw member contains a malformed numeric data row");
    }
    if (!footerStarted && !textualNonDataLine(line)) {
      fail("Kenneth French raw member contains unknown structure after its header");
    }

    footerStarted = true;
    footerLineCount += 1;
    if (footerLineCount > KENNETH_FRENCH_RAW_MEMBER_MAX_FOOTER_LINES) {
      fail("Kenneth French raw member footer exceeds the bounded line count");
    }
    if (classified.dataLike) {
      fail("Kenneth French raw member contains a numeric or data-like row after its footer");
    }
    if (trimmed === "") {
      fail("Kenneth French raw member contains an ambiguous blank within its footer");
    }
    if (!textualNonDataLine(line)) {
      fail("Kenneth French raw member footer contains unknown structure");
    }
  }

  if (canonicalRows.length === 0) {
    fail("Kenneth French raw member contains no numeric daily-factor rows");
  }
  return [KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA, ...canonicalRows].join("\n");
}

function isoDateFromSource(value, rowNumber) {
  if (!/^\d{8}$/u.test(value)) {
    fail(`Kenneth French daily factor row ${rowNumber} date must use YYYYMMDD`);
  }
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    fail(`Kenneth French daily factor row ${rowNumber} has an invalid date`);
  }
  return iso;
}

function sourceNumber(value, field, rowNumber) {
  if (value.length === 0) {
    fail(`Kenneth French daily factor row ${rowNumber} ${field} is missing`);
  }
  if (!NUMBER_PATTERN.test(value)) {
    fail(`Kenneth French daily factor row ${rowNumber} ${field} must be numeric`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    fail(`Kenneth French daily factor row ${rowNumber} ${field} must be finite`);
  }
  if (SOURCE_SENTINELS.includes(parsed)) {
    fail(`Kenneth French daily factor row ${rowNumber} ${field} is a missing-value sentinel`);
  }
  const decimalReturn = parsed / 100;
  if (decimalReturn <= -1) {
    fail(`Kenneth French daily factor row ${rowNumber} ${field} return must be greater than -1`);
  }
  return parsed;
}

/**
 * Parse already-supplied Kenneth French daily-factor CSV content.
 *
 * This is deliberately source-only: it performs no network, ZIP, or filesystem
 * access. A future acquisition layer can pass the selected ZIP member here.
 */
export function parseKennethFrenchDailyFactorCsv(input) {
  const lines = normalizedLines(input);

  if (lines[0] !== KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA) {
    fail(
      `Kenneth French daily factor CSV schema drift: expected exactly ${KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA}`,
    );
  }
  if (lines.length === 1) fail("Kenneth French daily factor CSV has no data rows");

  let previousDate = null;
  const rows = lines.slice(1).map((line, index) => {
    const rowNumber = index + 2;
    if (line.length === 0) {
      fail(`Kenneth French daily factor row ${rowNumber} is blank`);
    }
    const values = line.split(",");
    if (values.length !== SOURCE_FIELDS.length) {
      fail(`Kenneth French daily factor row ${rowNumber} does not match the exact schema`);
    }
    const cells = values.map((value) => value.trim());
    const date = isoDateFromSource(cells[0], rowNumber);
    if (date === previousDate) {
      fail(`Kenneth French daily factor row ${rowNumber} duplicates date ${date}`);
    }
    if (previousDate !== null && date < previousDate) {
      fail(`Kenneth French daily factor dates must be strictly increasing`);
    }
    previousDate = date;

    const sourceReturnsPercent = Object.fromEntries(
      RETURN_FIELDS.map((field, fieldIndex) => [
        field,
        sourceNumber(cells[fieldIndex + 1], field, rowNumber),
      ]),
    );
    const marketProxy = (sourceReturnsPercent["Mkt-RF"] + sourceReturnsPercent.RF) / 100;
    const rfProxy = sourceReturnsPercent.RF / 100;
    if (!Number.isFinite(marketProxy) || marketProxy <= -1) {
      fail(`Kenneth French daily factor row ${rowNumber} MARKET_PROXY return must be finite and greater than -1`);
    }
    if (!Number.isFinite(rfProxy) || rfProxy <= -1) {
      fail(`Kenneth French daily factor row ${rowNumber} RF_PROXY return must be finite and greater than -1`);
    }

    return {
      date,
      ...sourceReturnsPercent,
      MARKET_PROXY: marketProxy,
      RF_PROXY: rfProxy,
    };
  });

  return deepFreeze({
    schema_version: KENNETH_FRENCH_DAILY_FACTOR_PARSE_SCHEMA,
    csv_schema: KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA,
    source_return_units: "percent",
    proxy_return_units: "decimal",
    proxy_labels: { ...KENNETH_FRENCH_DAILY_PROXY_LABELS },
    rows,
  });
}

function validateParsedSource(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype) {
    fail("a parsed Kenneth French daily factor source is required");
  }
  const topLevelKeys = Object.keys(parsed).sort();
  const expectedTopLevelKeys = [...PARSED_TOP_LEVEL_FIELDS].sort();
  if (topLevelKeys.length !== expectedTopLevelKeys.length
    || topLevelKeys.some((key, index) => key !== expectedTopLevelKeys[index])) {
    fail("parsed Kenneth French daily factor source fields are invalid");
  }
  if (parsed.schema_version !== KENNETH_FRENCH_DAILY_FACTOR_PARSE_SCHEMA
    || parsed.csv_schema !== KENNETH_FRENCH_DAILY_FACTOR_CSV_SCHEMA
    || parsed.source_return_units !== "percent"
    || parsed.proxy_return_units !== "decimal") {
    fail("parsed Kenneth French daily factor source schema is invalid");
  }
  if (parsed.proxy_labels?.MARKET_PROXY !== KENNETH_FRENCH_DAILY_PROXY_LABELS.MARKET_PROXY
    || parsed.proxy_labels?.RF_PROXY !== KENNETH_FRENCH_DAILY_PROXY_LABELS.RF_PROXY) {
    fail("parsed Kenneth French daily factor source proxy labels are invalid");
  }
  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    fail("parsed Kenneth French daily factor source has no rows");
  }
  let previousDate = "";
  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (!row || typeof row !== "object" || Array.isArray(row)
      || Object.getPrototypeOf(row) !== Object.prototype) {
      fail(`parsed Kenneth French row ${rowNumber} must be a plain object`);
    }
    const rowKeys = Object.keys(row).sort();
    const expectedRowKeys = [...PARSED_ROW_FIELDS].sort();
    if (rowKeys.length !== expectedRowKeys.length
      || rowKeys.some((key, keyIndex) => key !== expectedRowKeys[keyIndex])) {
      fail(`parsed Kenneth French row ${rowNumber} fields are invalid`);
    }
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(row.date)) {
      fail(`parsed Kenneth French row ${rowNumber} date must be an ISO date`);
    }
    const parsedDate = new Date(`${row.date}T00:00:00.000Z`);
    if (!Number.isFinite(parsedDate.getTime())
      || parsedDate.toISOString().slice(0, 10) !== row.date) {
      fail(`parsed Kenneth French row ${rowNumber} date must be an ISO date`);
    }
    if (row.date <= previousDate) {
      fail("parsed Kenneth French row dates must be strictly increasing");
    }
    previousDate = row.date;

    for (const field of RETURN_FIELDS) {
      const value = row[field];
      if (typeof value !== "number" || !Number.isFinite(value)
        || SOURCE_SENTINELS.includes(value) || value / 100 <= -1) {
        fail(`parsed Kenneth French row ${rowNumber} ${field} source return is invalid`);
      }
    }
    const expectedMarketProxy = (row["Mkt-RF"] + row.RF) / 100;
    const expectedRfProxy = row.RF / 100;
    if (row.MARKET_PROXY !== expectedMarketProxy
      || row.RF_PROXY !== expectedRfProxy) {
      fail(`parsed Kenneth French row ${rowNumber} proxy transform identity changed`);
    }
  });
}

/**
 * Build index levels for the frozen Attempt115 target functions.
 *
 * SPY and BIL below are required input aliases only. The returned metadata keeps
 * the source labels explicit; these values are factor proxies, not ETF history.
 */
export function adaptKennethFrenchDailyFactorsToAttempt115(parsed) {
  validateParsedSource(parsed);
  let marketLevel = INITIAL_PROXY_LEVEL;
  let rfLevel = INITIAL_PROXY_LEVEL;
  const proxyPoints = [];

  for (const [index, row] of parsed.rows.entries()) {
    if (typeof row.MARKET_PROXY !== "number" || !Number.isFinite(row.MARKET_PROXY)
      || row.MARKET_PROXY <= -1) {
      fail(`parsed Kenneth French row ${index + 1} MARKET_PROXY return is invalid`);
    }
    if (typeof row.RF_PROXY !== "number" || !Number.isFinite(row.RF_PROXY)
      || row.RF_PROXY <= -1) {
      fail(`parsed Kenneth French row ${index + 1} RF_PROXY return is invalid`);
    }
    marketLevel *= 1 + row.MARKET_PROXY;
    rfLevel *= 1 + row.RF_PROXY;
    if (!Number.isFinite(marketLevel) || !Number.isFinite(rfLevel)
      || marketLevel <= 0 || rfLevel <= 0) {
      fail(`parsed Kenneth French row ${index + 1} produces an invalid proxy level`);
    }
    proxyPoints.push({
      date: row.date,
      MARKET_PROXY: marketLevel,
      RF_PROXY: rfLevel,
    });
  }

  const frozenTargetPoints = proxyPoints.map((point) => ({
    date: point.date,
    SPY: point.MARKET_PROXY,
    BIL: point.RF_PROXY,
  }));

  return deepFreeze({
    schema_version: KENNETH_FRENCH_ATTEMPT115_ADAPTER_SCHEMA,
    source_proxy_labels: { ...KENNETH_FRENCH_DAILY_PROXY_LABELS },
    frozen_target_input_aliases: { ...KENNETH_FRENCH_ATTEMPT115_TARGET_ALIASES },
    claim_boundary: "Factor-return proxy replay only; MARKET_PROXY and RF_PROXY are not SPY or BIL ETF returns.",
    source_return_rows: parsed.rows.length,
    proxy_points: proxyPoints,
    frozen_target_points: frozenTargetPoints,
  });
}

/** Invoke the two frozen Attempt115 target functions at the explicit alias boundary. */
export function evaluateAttempt115TargetsOnKennethFrenchDailyFactors(parsed) {
  const adapted = adaptKennethFrenchDailyFactorsToAttempt115(parsed);
  if (adapted.source_return_rows < MINIMUM_FACTOR_RETURN_ROWS) {
    fail(
      `Kenneth French Attempt115 replay requires at least ${MINIMUM_FACTOR_RETURN_ROWS} factor-return rows`,
    );
  }
  return deepFreeze({
    schema_version: KENNETH_FRENCH_ATTEMPT115_ADAPTER_SCHEMA,
    source_proxy_labels: { ...adapted.source_proxy_labels },
    frozen_target_input_aliases: { ...adapted.frozen_target_input_aliases },
    claim_boundary: adapted.claim_boundary,
    source_return_rows: adapted.source_return_rows,
    policies: {
      [ATTEMPT115_INCUMBENT_POLICY_ID]: attempt115IncumbentTarget(
        adapted.frozen_target_points,
      ),
      [ATTEMPT115_CHALLENGER_POLICY_ID]: attempt115DownsideSemivolatilityTarget(
        adapted.frozen_target_points,
      ),
    },
  });
}
