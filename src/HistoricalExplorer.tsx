import { useEffect, useMemo, useState } from "react";

type ReturnInputs = {
  gross_return: number;
  financing_spread_cost: number;
  base_transaction_cost: number;
  entry_notional: number;
  terminal_liquidation_notional: number;
};

type ExplorerRow = {
  date: string;
  g4: ReturnInputs;
  spy: ReturnInputs;
};

type WindowSummary = {
  years: number;
  sessions: number;
  wins: number;
  losses: number;
  ties: number;
  total: number;
  win_rate: number;
};

type ExplorerDataset = {
  schema_version: string;
  evidence_class: string;
  evidence_as_of?: string;
  candidate_id: string;
  benchmark_id: string;
  one_way_cost_bps: number;
  initial_capital: number;
  default_window: {
    start: string;
    end: string;
    ending_values: {
      starting_value_usd: number;
      g4_ending_value_usd: number;
      spy_ending_value_usd: number;
      g4_minus_spy_ending_value_usd: number;
    };
  };
  robustness: {
    windows: WindowSummary[];
    boundary: string;
  };
  claim_boundary: string;
  source_receipts: {
    private_generation4_ledger: {
      gzip_sha256: string;
      redistributed: boolean;
    };
  };
  rows: ExplorerRow[];
};

type PeriodMetrics = {
  start: string;
  end: string;
  observations: number;
  endingWealth: number;
  totalReturn: number;
  annualizedReturn: number;
  maximumDrawdown: number;
  points: Array<{ date: string; wealth: number }>;
};

const TRADING_DAYS = 252;
const EXPECTED_SCHEMA = "finly_public_g4_window_explorer.v1";
const EXPECTED_LEDGER_SHA256 = "6f656b79d7a4e836eda3b85d35bfca34841e80c0da16a2afdef30e862d8a23e1";

const presets = [
  { label: "Full record", start: 2013, end: 2026 },
  { label: "2013–15", start: 2013, end: 2015 },
  { label: "2020–21", start: 2020, end: 2021 },
  { label: "2022 shock", start: 2022, end: 2022 },
  { label: "2016–18", start: 2016, end: 2018 },
] as const;

function round10(value: number) {
  return Math.round((value + Number.EPSILON) * 1e10) / 1e10;
}

function netReturnForStandaloneRow(inputs: ReturnInputs, index: number, length: number, costRate: number) {
  let transactionCost = index === 0
    ? inputs.entry_notional * costRate
    : inputs.base_transaction_cost;
  if (index === length - 1) transactionCost += inputs.terminal_liquidation_notional * costRate;
  transactionCost = round10(transactionCost);
  return round10(inputs.gross_return - inputs.financing_spread_cost - transactionCost);
}

function standaloneMetrics(
  rows: ExplorerRow[],
  key: "g4" | "spy",
  startYear: number,
  endYear: number,
  oneWayCostBps: number,
  initialCapital: number,
): PeriodMetrics | null {
  const selected = rows.filter((row) => {
    const year = Number(row.date.slice(0, 4));
    return year >= startYear && year <= endYear;
  });
  if (selected.length < 2) return null;

  const costRate = oneWayCostBps / 10_000;
  let wealth = initialCapital;
  let peak = initialCapital;
  let maximumDrawdown = 0;
  const points: PeriodMetrics["points"] = [];

  selected.forEach((row, index) => {
    const inputs = row[key];
    const netReturn = netReturnForStandaloneRow(inputs, index, selected.length, costRate);
    if (!(1 + netReturn > 0)) throw new Error(`${row.date} has an invalid ${key} capital path.`);
    wealth *= 1 + netReturn;
    peak = Math.max(peak, wealth);
    maximumDrawdown = Math.min(maximumDrawdown, wealth / peak - 1);
    points.push({ date: row.date, wealth });
  });

  const totalReturn = wealth / initialCapital - 1;
  return {
    start: selected[0].date,
    end: selected.at(-1)?.date ?? selected[0].date,
    observations: selected.length,
    endingWealth: wealth,
    totalReturn,
    annualizedReturn: (1 + totalReturn) ** (TRADING_DAYS / selected.length) - 1,
    maximumDrawdown,
    points,
  };
}

function recomputeWindowSummary(
  rows: ExplorerRow[],
  sessions: number,
  oneWayCostBps: number,
) {
  const costRate = oneWayCostBps / 10_000;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  const total = rows.length - sessions + 1;
  if (!Number.isSafeInteger(sessions) || sessions < 2 || total < 1) {
    throw new Error("Historical robustness horizon is invalid.");
  }
  for (let start = 0; start < total; start += 1) {
    let g4Growth = 1;
    let spyGrowth = 1;
    for (let offset = 0; offset < sessions; offset += 1) {
      const row = rows[start + offset];
      const g4Return = netReturnForStandaloneRow(row.g4, offset, sessions, costRate);
      const spyReturn = netReturnForStandaloneRow(row.spy, offset, sessions, costRate);
      if (!(1 + g4Return > 0) || !(1 + spyReturn > 0)) {
        throw new Error(`${row.date} has an invalid robustness capital path.`);
      }
      g4Growth *= 1 + g4Return;
      spyGrowth *= 1 + spyReturn;
    }
    const difference = g4Growth - spyGrowth;
    if (difference > 1e-14) wins += 1;
    else if (difference < -1e-14) losses += 1;
    else ties += 1;
  }
  return { sessions, wins, losses, ties, total };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateDataset(value: unknown): ExplorerDataset {
  if (!isRecord(value)) throw new Error("Historical explorer is not a JSON object.");
  if (value.schema_version !== EXPECTED_SCHEMA) throw new Error("Historical explorer schema is not recognized.");
  if (value.evidence_class !== "CONSUMED_RETROSPECTIVE_ETF_REPLAY") throw new Error("Historical evidence class changed.");
  if (value.candidate_id !== "qqq_core_sector_12_6" || value.benchmark_id !== "spy_buy_hold") {
    throw new Error("Historical candidate or benchmark identity changed.");
  }
  if (value.initial_capital !== 100_000 || value.one_way_cost_bps !== 5) {
    throw new Error("Historical capital or cost assumptions changed.");
  }
  if (!isRecord(value.default_window)
    || value.default_window.start !== "2013-01-02"
    || value.default_window.end !== "2026-08-27"
    || !isRecord(value.default_window.ending_values)) {
    throw new Error("Historical default window changed.");
  }
  if (!isRecord(value.source_receipts)
    || !isRecord(value.source_receipts.private_generation4_ledger)
    || value.source_receipts.private_generation4_ledger.gzip_sha256 !== EXPECTED_LEDGER_SHA256
    || value.source_receipts.private_generation4_ledger.redistributed !== false) {
    throw new Error("Historical source receipt is missing or unrecognized.");
  }
  if (!isRecord(value.robustness) || !Array.isArray(value.robustness.windows)
    || typeof value.robustness.boundary !== "string") {
    throw new Error("Historical robustness receipt is incomplete.");
  }
  if (!Array.isArray(value.rows) || value.rows.length !== 3434) {
    throw new Error("Historical rows are incomplete.");
  }

  let priorDate = "";
  for (const rowValue of value.rows) {
    if (!isRecord(rowValue) || typeof rowValue.date !== "string"
      || !/^20\d{2}-\d{2}-\d{2}$/.test(rowValue.date)
      || !Number.isFinite(Date.parse(`${rowValue.date}T00:00:00Z`))
      || rowValue.date <= priorDate
      || !isRecord(rowValue.g4)
      || !isRecord(rowValue.spy)) {
      throw new Error("Historical rows are malformed or out of order.");
    }
    for (const book of [rowValue.g4, rowValue.spy]) {
      for (const field of [
        "gross_return",
        "financing_spread_cost",
        "base_transaction_cost",
        "entry_notional",
        "terminal_liquidation_notional",
      ]) {
        if (!Number.isFinite(book[field])) throw new Error(`Historical row field ${field} is invalid.`);
      }
      if (Number(book.gross_return) <= -1
        || Number(book.financing_spread_cost) < 0
        || Number(book.base_transaction_cost) < 0
        || Number(book.entry_notional) < 0
        || Number(book.terminal_liquidation_notional) < 0) {
        throw new Error("Historical return or cost boundary is invalid.");
      }
    }
    priorDate = rowValue.date;
  }
  if (value.rows[0] && isRecord(value.rows[0]) && value.rows[0].date !== "2013-01-02") {
    throw new Error("Historical first date changed.");
  }
  const finalRow = value.rows.at(-1);
  if (!isRecord(finalRow) || finalRow.date !== "2026-08-27") throw new Error("Historical final date changed.");

  const dataset = value as unknown as ExplorerDataset;
  if (typeof dataset.claim_boundary !== "string"
    || !/consumed/i.test(dataset.claim_boundary)
    || !/not (?:a )?forecast/i.test(dataset.claim_boundary)) {
    throw new Error("Historical claim boundary is missing or weakened.");
  }
  const g4 = standaloneMetrics(dataset.rows, "g4", 2013, 2026, 5, 100_000);
  const spy = standaloneMetrics(dataset.rows, "spy", 2013, 2026, 5, 100_000);
  if (!g4 || !spy
    || Math.abs(g4.endingWealth - dataset.default_window.ending_values.g4_ending_value_usd) > 0.02
    || Math.abs(spy.endingWealth - dataset.default_window.ending_values.spy_ending_value_usd) > 0.02) {
    throw new Error("Historical default result does not reproduce its locked receipt.");
  }
  const storedFiveYear = dataset.robustness.windows.find((item) => item.years === 5);
  const recomputedFiveYear = recomputeWindowSummary(dataset.rows, 5 * TRADING_DAYS, 5);
  if (!storedFiveYear
    || storedFiveYear.sessions !== recomputedFiveYear.sessions
    || storedFiveYear.wins !== recomputedFiveYear.wins
    || storedFiveYear.losses !== recomputedFiveYear.losses
    || storedFiveYear.ties !== recomputedFiveYear.ties
    || storedFiveYear.total !== recomputedFiveYear.total
    || recomputedFiveYear.wins !== 2175
    || recomputedFiveYear.total !== 2175) {
    throw new Error("Historical five-year robustness claim does not reproduce from public rows.");
  }
  return dataset;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function makePath(
  points: Array<{ date: string; wealth: number }>,
  minimum: number,
  maximum: number,
  startTime: number,
  endTime: number,
) {
  const width = 920;
  const height = 294;
  const timeRange = Math.max(1, endTime - startTime);
  const wealthRange = Math.max(1, maximum - minimum);
  return points.map((point, index) => {
    const time = Date.parse(`${point.date}T00:00:00Z`);
    const x = 58 + ((time - startTime) / timeRange) * width;
    const y = 24 + (1 - (point.wealth - minimum) / wealthRange) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function WealthChart({ g4, spy }: { g4: PeriodMetrics; spy: PeriodMetrics }) {
  const allPoints = [...g4.points, ...spy.points];
  const values = allPoints.map((point) => point.wealth);
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const padding = Math.max(1, (rawMaximum - rawMinimum) * 0.08);
  const minimum = Math.max(0, rawMinimum - padding);
  const maximum = rawMaximum + padding;
  const startTime = Date.parse(`${g4.start}T00:00:00Z`);
  const endTime = Date.parse(`${g4.end}T00:00:00Z`);
  const ticks = [maximum, (maximum + minimum) / 2, minimum];

  return (
    <figure className="range-chart">
      <div className="range-chart-legend" aria-hidden="true">
        <span><i className="legend-g4" /> Finly G4 shadow</span>
        <span><i className="legend-spy" /> SPY buy-and-hold</span>
      </div>
      <svg viewBox="0 0 1040 354" role="img" aria-labelledby="range-chart-title range-chart-description">
        <title id="range-chart-title">Modeled wealth for Finly G4 and SPY over the selected historical period</title>
        <desc id="range-chart-description">
          Finly G4 ended at {money.format(g4.endingWealth)} and SPY ended at {money.format(spy.endingWealth)} between {g4.start} and {g4.end}.
        </desc>
        {ticks.map((tick, index) => {
          const y = 24 + index * 147;
          return (
            <g key={tick}>
              <line x1="58" x2="978" y1={y} y2={y} className="chart-gridline" />
              <text x="48" y={y + 4} textAnchor="end" className="chart-axis-label">{compactMoney.format(tick)}</text>
            </g>
          );
        })}
        <path d={makePath(spy.points, minimum, maximum, startTime, endTime)} className="chart-line chart-line-spy" />
        <path d={makePath(g4.points, minimum, maximum, startTime, endTime)} className="chart-line chart-line-g4" />
        <text x="58" y="344" className="chart-axis-label">{g4.start}</text>
        <text x="978" y="344" textAnchor="end" className="chart-axis-label">{g4.end}</text>
      </svg>
    </figure>
  );
}

export function HistoricalExplorer() {
  const [dataset, setDataset] = useState<ExplorerDataset | null>(null);
  const [error, setError] = useState<string>();
  const [startYear, setStartYear] = useState(2013);
  const [endYear, setEndYear] = useState(2026);

  useEffect(() => {
    let active = true;
    fetch("./data/g4_window_explorer.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Historical explorer request failed (${response.status})`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!active) return;
        const verified = validateDataset(payload);
        setDataset(verified);
        setStartYear(Number(verified.default_window.start.slice(0, 4)));
        setEndYear(Number(verified.default_window.end.slice(0, 4)));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Historical explorer could not be loaded.");
      });
    return () => { active = false; };
  }, []);

  const years = useMemo(() => {
    if (!dataset) return [];
    const first = Number(dataset.rows[0]?.date.slice(0, 4));
    const last = Number(dataset.rows.at(-1)?.date.slice(0, 4));
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }, [dataset]);

  const comparison = useMemo(() => {
    if (!dataset) return null;
    const g4 = standaloneMetrics(dataset.rows, "g4", startYear, endYear, dataset.one_way_cost_bps, dataset.initial_capital);
    const spy = standaloneMetrics(dataset.rows, "spy", startYear, endYear, dataset.one_way_cost_bps, dataset.initial_capital);
    return g4 && spy ? { g4, spy } : null;
  }, [dataset, startYear, endYear]);

  if (error) {
    return <section className="range-explorer-error" id="range">The range explorer is unavailable: {error}</section>;
  }
  if (!dataset || !comparison) {
    return <section className="range-explorer-loading" id="range">Recomputing the historical evidence…</section>;
  }

  const { g4, spy } = comparison;
  const dollarGap = g4.endingWealth - spy.endingWealth;
  const finlyLed = dollarGap >= 0;
  const robustness = dataset.robustness.windows.find((item) => item.years === 5);

  function chooseStart(nextStart: number) {
    setStartYear(nextStart);
    if (nextStart > endYear) setEndYear(nextStart);
  }

  function chooseEnd(nextEnd: number) {
    setEndYear(nextEnd);
    if (nextEnd < startYear) setStartYear(nextEnd);
  }

  return (
    <section className="range-explorer" id="range" aria-labelledby="range-title">
      <div className="range-explorer-heading">
        <div>
          <p className="kicker">Explore the historical claim</p>
          <h3 id="range-title">Choose a period. Recompute the historical edge.</h3>
        </div>
        <p>
          This recomputes a standalone ${dataset.initial_capital.toLocaleString("en-US")} replay for the selected calendar years
          under the frozen entry, exit and {dataset.one_way_cost_bps}-basis-point one-way cost convention.
        </p>
      </div>

      <div className="range-controls">
        <div className="range-selects">
          <label>
            <span>From</span>
            <select value={startYear} onChange={(event) => chooseStart(Number(event.target.value))}>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label>
            <span>Through</span>
            <select value={endYear} onChange={(event) => chooseEnd(Number(event.target.value))}>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
        </div>
        <div className="range-presets" role="group" aria-label="Historical period presets">
          {presets.map((preset) => (
            <button
              type="button"
              key={preset.label}
              aria-pressed={startYear === preset.start && endYear === preset.end}
              onClick={() => { setStartYear(preset.start); setEndYear(preset.end); }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`range-verdict ${finlyLed ? "range-verdict-win" : "range-verdict-loss"}`} aria-live="polite">
        <div>
          <p>{g4.start} → {g4.end}</p>
          <h4>{finlyLed ? "Finly G4 led SPY" : "SPY led Finly G4"} by <strong>{money.format(Math.abs(dollarGap))}</strong>.</h4>
        </div>
        <span>{finlyLed ? "Historical lead" : "Historical shortfall"}</span>
      </div>

      <div className="range-results">
        <article aria-labelledby="g4-result-title">
          <h5 id="g4-result-title">Finly G4 shadow</h5>
          <strong>{money.format(g4.endingWealth)}</strong>
          <dl>
            <div><dt>Total return</dt><dd>{signedPercent(g4.totalReturn)}</dd></div>
            <div><dt>Annualized</dt><dd>{signedPercent(g4.annualizedReturn)}</dd></div>
            <div><dt>Maximum drawdown</dt><dd>{signedPercent(g4.maximumDrawdown)}</dd></div>
          </dl>
        </article>
        <article aria-labelledby="spy-result-title">
          <h5 id="spy-result-title">SPY buy-and-hold</h5>
          <strong>{money.format(spy.endingWealth)}</strong>
          <dl>
            <div><dt>Total return</dt><dd>{signedPercent(spy.totalReturn)}</dd></div>
            <div><dt>Annualized</dt><dd>{signedPercent(spy.annualizedReturn)}</dd></div>
            <div><dt>Maximum drawdown</dt><dd>{signedPercent(spy.maximumDrawdown)}</dd></div>
          </dl>
        </article>
      </div>

      <WealthChart g4={g4} spy={spy} />

      <div className="range-proof-strip">
        {robustness ? (
          <p><strong>{robustness.wins.toLocaleString("en-US")}/{robustness.total.toLocaleString("en-US")}</strong> overlapping five-year trading-session windows across the full consumed record beat SPY.</p>
        ) : null}
        <p>{dataset.robustness.boundary}</p>
      </div>
      <p className="range-boundary">
        <strong>Read this before interpreting the chart.</strong> {dataset.claim_boundary} The production Finly policy is a
        different policy that showed lower modeled volatility and drawdown in its consumed holdout; this range tool does not
        turn G4 into a forward forecast or options P&amp;L.
      </p>
    </section>
  );
}
