import { useState } from "react";

type HistoricalExplorerProps = {
  candidateReturn: number;
  spyReturn: number;
  startDate: string;
  endDate: string;
  oneWayCostBps: number;
};

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${pct(value, digits)}`;

export function HistoricalExplorer({
  candidateReturn,
  spyReturn,
  startDate,
  endDate,
  oneWayCostBps,
}: HistoricalExplorerProps) {
  const [view, setView] = useState<"result" | "decision">("result");
  const scale = Math.max(candidateReturn, spyReturn);
  const candidateWidth = `${Math.max(0, (candidateReturn / scale) * 100)}%`;
  const spyWidth = `${Math.max(0, (spyReturn / scale) * 100)}%`;
  const startingWealth = 10_000;
  const candidateEndingWealth = startingWealth * (1 + candidateReturn);
  const spyEndingWealth = startingWealth * (1 + spyReturn);
  const endingWealthAdvantage = candidateEndingWealth - spyEndingWealth;
  const returnAdvantage = candidateReturn - spyReturn;
  const relativeEndingWealthAdvantage = endingWealthAdvantage / spyEndingWealth;
  const dollars = (value: number) => value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    style: "currency",
    currency: "USD",
  });

  return (
    <section className="range-explorer" aria-labelledby="historical-explorer-title">
      <div className="range-explorer-heading">
        <div>
          <p className="kicker">Historical value creation</p>
          <h3 id="historical-explorer-title">$106,711 in modeled ending wealth—$38,629 ahead of SPY.</h3>
        </div>
        <p>
          Across the same 2013–2026 window, Finly returned +967.11% versus +580.82% for SPY. The comparison starts with
          $10,000 and includes modeled 5 bp one-way costs.
        </p>
      </div>

      <div className="range-tabs" role="group" aria-label="Choose a view of the historical comparison">
        <button
          type="button"
          aria-pressed={view === "result"}
          aria-controls="historical-result-panel"
          onClick={() => setView("result")}
        >
          Return advantage
        </button>
        <button
          type="button"
          aria-pressed={view === "decision"}
          aria-controls="historical-decision-panel"
          onClick={() => setView("decision")}
        >
          Investment case
        </button>
      </div>

      {view === "result" ? (
        <div
          className="audit-panel"
          id="historical-result-panel"
          aria-live="polite"
        >
          <div
            className="audit-comparison"
            role="img"
            aria-label={`In the historical replay, Finly returned ${pct(candidateReturn)} and SPY returned ${pct(spyReturn)} from ${startDate} through ${endDate}.`}
          >
            <div className="audit-bar-row">
              <div className="audit-bar-label">
                <span>Finly historical strategy</span>
                <strong>{signedPct(candidateReturn)}</strong>
              </div>
              <div className="audit-bar-track" aria-hidden="true">
                <i className="audit-bar-g4" style={{ width: candidateWidth }} />
              </div>
            </div>
            <div className="audit-bar-row">
              <div className="audit-bar-label">
                <span>SPY</span>
                <strong>{signedPct(spyReturn)}</strong>
              </div>
              <div className="audit-bar-track" aria-hidden="true">
                <i className="audit-bar-spy" style={{ width: spyWidth }} />
              </div>
            </div>
          </div>
          <p className="audit-panel-conclusion">
            A simulated {dollars(startingWealth)} became approximately <strong>{dollars(candidateEndingWealth)}</strong>
            {" "}with Finly versus <strong>{dollars(spyEndingWealth)}</strong> with SPY—an ending-wealth advantage of
            {" "}<strong>{dollars(endingWealthAdvantage)}</strong>. The replay covers {startDate} through {endDate} and
            includes modeled {oneWayCostBps}-basis-point one-way costs.
          </p>
        </div>
      ) : (
        <div
          className="audit-panel audit-panel-decision"
          id="historical-decision-panel"
          aria-live="polite"
        >
          <dl className="audit-decision-ledger">
            <div>
              <dt>Incremental ending wealth</dt>
              <dd>{dollars(endingWealthAdvantage)}</dd>
              <p>{pct(relativeEndingWealthAdvantage)} more wealth than SPY from the same simulated $10,000.</p>
            </div>
            <div>
              <dt>Total-return advantage</dt>
              <dd>{signedPct(returnAdvantage)}</dd>
              <p>A 386.29-percentage-point lead across the identical comparison window.</p>
            </div>
            <div className="audit-disposition">
              <dt>Cost discipline</dt>
              <dd>{oneWayCostBps} bp</dd>
              <p>Modeled one-way transaction costs are included in the reported Finly result.</p>
            </div>
          </dl>
          <p className="audit-panel-conclusion">
            Finly pairs a historically outperforming research configuration with deterministic risk controls—turning
            research output into an inspectable, capital-bounded decision workflow.
          </p>
        </div>
      )}

      <p className="range-boundary">
        <strong>Comparison basis:</strong> historical simulation from {startDate} to {endDate}; identical $10,000 starting
        capital and comparison window; modeled {oneWayCostBps} bp one-way costs.
      </p>
    </section>
  );
}
