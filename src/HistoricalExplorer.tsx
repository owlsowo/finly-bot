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
  if (value === "REJECTED_NOT_PROMOTED") return "Rejected—not promoted";
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

  return (
    <section className="range-explorer" aria-labelledby="historical-explorer-title">
      <div className="range-explorer-heading">
        <div>
          <p className="kicker">Read the result two ways</p>
          <h3 id="historical-explorer-title">First as a return. Then as a research decision.</h3>
        </div>
        <p>
          The values do not change when the view changes. What changes is the question: whether the replay was large, or
          whether a post-selected replay earned promotion.
        </p>
      </div>

      <div className="range-tabs" role="group" aria-label="Choose how to inspect the historical replay">
        <button
          type="button"
          aria-pressed={view === "result"}
          aria-controls="historical-result-panel"
          onClick={() => setView("result")}
        >
          Read the return
        </button>
        <button
          type="button"
          aria-pressed={view === "decision"}
          aria-controls="historical-decision-panel"
          onClick={() => setView("decision")}
        >
          Read the decision
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
                <span>Post-selected G4 shadow</span>
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
            From {startDate} through {endDate}, after modeled {oneWayCostBps}-basis-point one-way costs, the G4 replay
            produced the larger historical total return. That observation is descriptive; it does not decide whether the
            strategy was discovered honestly enough to deploy.
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
              <p>The selection-adjusted evidence did not support promotion.</p>
            </div>
            <div>
              <dt>Worst familywise-adjusted p-value</dt>
              <dd>{pct(worstFamilywisePValue)}</dd>
              <p>The multiple-testing result did not support promotion.</p>
            </div>
            <div className="audit-disposition">
              <dt>Recorded disposition</dt>
              <dd>{readableDisposition(disposition)}</dd>
              <p>The result remained a shadow; it did not become the production policy.</p>
            </div>
          </dl>
          <p className="audit-panel-conclusion">
            The return and the rejection are not contradictory. One describes what happened in a consumed replay; the
            other states how much confidence that retrospective search earned.
          </p>
        </div>
      )}

      <p className="range-boundary">
        <strong>Boundary:</strong> this is consumed, post-selected retrospective evidence. It is not a forecast, verified
        options P&amp;L, a broker-fill record or evidence of future market superiority.
      </p>
    </section>
  );
}
