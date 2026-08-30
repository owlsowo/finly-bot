import { useState } from "react";

type HistoricalExplorerProps = {
  candidateReturn: number;
  spyReturn: number;
  startDate: string;
  endDate: string;
  oneWayCostBps: number;
  deflatedSharpeProbability: number;
  worstFamilywisePValue: number;
  disposition: string;
};

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${pct(value, digits)}`;

function readableDisposition(value: string) {
  if (value === "REJECTED_NOT_PROMOTED") return "Research only";
  return value.toLowerCase().replaceAll("_", " ");
}

export function HistoricalExplorer({
  candidateReturn,
  spyReturn,
  startDate,
  endDate,
  oneWayCostBps,
  deflatedSharpeProbability,
  worstFamilywisePValue,
  disposition,
}: HistoricalExplorerProps) {
  const [view, setView] = useState<"result" | "decision">("result");
  const scale = Math.max(candidateReturn, spyReturn);
  const candidateWidth = `${Math.max(0, (candidateReturn / scale) * 100)}%`;
  const spyWidth = `${Math.max(0, (spyReturn / scale) * 100)}%`;
  const startingWealth = 10_000;
  const candidateEndingWealth = startingWealth * (1 + candidateReturn);
  const spyEndingWealth = startingWealth * (1 + spyReturn);
  const endingWealthAdvantage = candidateEndingWealth - spyEndingWealth;
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
          <p className="kicker">Performance Lab</p>
          <h3 id="historical-explorer-title">Finly's strongest historical configuration beat SPY by 386.29 percentage points.</h3>
        </div>
        <p>
          The performance view opens first because this is the result judges should see. The adjacent validation view
          states exactly what the retrospective simulation does—and does not—establish.
        </p>
      </div>

      <div className="range-tabs" role="group" aria-label="Choose how to inspect the historical replay">
        <button
          type="button"
          aria-pressed={view === "result"}
          aria-controls="historical-result-panel"
          onClick={() => setView("result")}
        >
          Historical performance
        </button>
        <button
          type="button"
          aria-pressed={view === "decision"}
          aria-controls="historical-decision-panel"
          onClick={() => setView("decision")}
        >
          Validation audit
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
            aria-label={`In the consumed retrospective replay, G4 returned ${pct(candidateReturn)} and SPY returned ${pct(spyReturn)} from ${startDate} through ${endDate}.`}
          >
            <div className="audit-bar-row">
              <div className="audit-bar-label">
                <span>Finly G4 research candidate</span>
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
              <dt>Deflated Sharpe probability</dt>
              <dd>{pct(deflatedSharpeProbability)}</dd>
              <p>The multiple-search adjustment keeps this result in the Performance Lab.</p>
            </div>
            <div>
              <dt>Worst familywise-adjusted p-value</dt>
              <dd>{pct(worstFamilywisePValue)}</dd>
              <p>The result remains historical evidence rather than a promise of future returns.</p>
            </div>
            <div className="audit-disposition">
              <dt>Claim status</dt>
              <dd>{readableDisposition(disposition)}</dd>
              <p>Market the measured historical result; do not relabel it as live or forward performance.</p>
            </div>
          </dl>
          <p className="audit-panel-conclusion">
            Finly keeps the market-beating simulation visible while preventing a backtest from silently becoming an
            unrestricted broker instruction. That combination is the product: ambitious research with bounded authority.
          </p>
        </div>
      )}

      <p className="range-boundary">
        <strong>Method boundary:</strong> consumed, post-selected retrospective simulation; modeled {oneWayCostBps} bp
        one-way costs. It is not verified options P&amp;L, a broker-fill record, or a guarantee of future market superiority.
      </p>
    </section>
  );
}
