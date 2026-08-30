import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");

export const SOURCE_REGISTRY = Object.freeze([
  Object.freeze({
    id: "generation4",
    path: "research/output/quant_champion_generation4.json",
    sha256: "af935615b289b009af83fe67dd78a890ce4de3c2416bbf039b0da2f24de78788",
    schemaVersion: "finly_quant_champion_generation4.v1",
  }),
  Object.freeze({
    id: "generation4_robustness",
    path: "research/output/quant_champion_generation4_robustness.json",
    sha256: "6b8136da0c4d6b366763383a93d2e119cec2f5516761b6cb2d2c206eeefd3299",
    schemaVersion: "finly_quant_champion_generation4_robustness.v1",
  }),
  Object.freeze({
    id: "generation6",
    path: "research/output/quant_champion_generation6.json",
    sha256: "028e0fdc69a8cb591a4d4fd6b6e4a20869d7a6296eb0650e643e3df23a4a3b9e",
    schemaVersion: "finly_quant_champion_generation6.v1",
  }),
  Object.freeze({
    id: "generation6_robustness",
    path: "research/output/quant_champion_generation6_robustness.json",
    sha256: "938eeed6f1dde418713c621231951e9509eb32da70b74e6c2e29be550da310fe",
    schemaVersion: "finly_quant_champion_generation6_robustness.v1",
  }),
  Object.freeze({
    id: "recurring_contribution",
    path: "research/output/recurring_contribution_analysis.json",
    sha256: "a6f49a99dabe6d59e6b5acccf07678b8d7f09ca9c4d59af469eeeb5e6b0ee1f5",
    schemaVersion: "finly_recurring_contribution_analysis.v3",
  }),
  Object.freeze({
    id: "aegis_q_auxiliary",
    path: "research/output/aegis_q_legacy_reproduction.json",
    sha256: "153c63138e6c9bcec6b8cee8443b00668d6abf31c91220c39445105464bd42a7",
    schemaVersion: "finly_aegis_q_legacy_reproduction_result.v1",
  }),
]);

export const OUTPUT_PATHS = Object.freeze({
  json: "research/output/submission_quantitative_evidence_surface.json",
  markdown: "research/output/submission_quantitative_evidence_surface_report.md",
});

const FORBIDDEN_PUBLIC_LANGUAGE = Object.freeze([
  /consistently\s+beats/i,
  /proven\s+profitable/i,
  /best\s+submission/i,
]);

const RESEARCH_ATTEMPT_COMPOSITION = Object.freeze([
  Object.freeze({ category: "prior_attempts", count: 53, detail: "53 prior research attempts" }),
  Object.freeze({ category: "invalidated_generation1", count: 12, detail: "12 invalidated G1 attempts" }),
  Object.freeze({ category: "aborted_attempt", count: 1, detail: "1 aborted attempt" }),
  Object.freeze({ category: "invalidated_generation2", count: 9, detail: "9 invalidated G2 attempts" }),
  Object.freeze({ category: "competitor_suggestions", count: 3, detail: "3 competitor suggestions" }),
  Object.freeze({ category: "literature_suggestions", count: 5, detail: "5 literature suggestions" }),
  Object.freeze({ category: "generation3_formulas", count: 8, detail: "8 G3 formulas" }),
  Object.freeze({ category: "correction_rerun", count: 1, detail: "1 correction rerun" }),
  Object.freeze({ category: "generation4", count: 8, detail: "8 G4 attempts: 7 eligible formulas and 1 control" }),
  Object.freeze({ category: "generation5", count: 5, detail: "5 G5 attempts: 4 eligible formulas and 1 control" }),
  Object.freeze({ category: "generation6", count: 8, detail: "8 G6 attempts: 7 eligible formulas and 1 control" }),
]);

function researchAttemptAccounting() {
  const total = RESEARCH_ATTEMPT_COMPOSITION.reduce((sum, item) => sum + item.count, 0);
  invariant(total === 113, "research-attempt composition must sum to 113");
  return Object.freeze({
    conservatively_counted_effective_research_attempts: total,
    composition: RESEARCH_ATTEMPT_COMPOSITION,
    included_attempt_types: Object.freeze([
      "controls",
      "unexecuted or rejected suggestions",
      "invalidated runs",
      "an aborted attempt",
      "reruns",
    ]),
    independent_viable_strategy_count: false,
    statement: "113 conservatively counted effective research attempts include controls, unexecuted or rejected suggestions, invalidated runs, an aborted attempt, and reruns; they are not 113 independent viable strategies.",
  });
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function round(value, places = 10) {
  const scale = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function resolveWithin(rootDir, relativePath) {
  const root = resolve(rootDir);
  const absolutePath = resolve(root, relativePath);
  const fromRoot = relative(root, absolutePath);
  invariant(fromRoot !== "" && !fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !fromRoot.startsWith(sep),
    `artifact path escapes the project root: ${relativePath}`);
  return absolutePath;
}

export function assertSafePublicLanguage(value, label = "public evidence surface") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const pattern of FORBIDDEN_PUBLIC_LANGUAGE) {
    invariant(!pattern.test(text), `${label} contains forbidden unsupported language: ${pattern.source}`);
  }
  return true;
}

export async function loadFrozenArtifacts({
  rootDir = projectRoot,
  registry = SOURCE_REGISTRY,
} = {}) {
  invariant(Array.isArray(registry) && registry.length === 6, "exactly six frozen evidence artifacts are required");
  const artifacts = {};
  const integrity = [];
  const seenIds = new Set();
  const seenPaths = new Set();

  for (const descriptor of registry) {
    invariant(typeof descriptor?.id === "string" && descriptor.id.length > 0, "source id is required");
    invariant(!seenIds.has(descriptor.id), `duplicate source id: ${descriptor.id}`);
    invariant(typeof descriptor?.path === "string" && descriptor.path.length > 0, `source path is required for ${descriptor.id}`);
    invariant(!seenPaths.has(descriptor.path), `duplicate source path: ${descriptor.path}`);
    invariant(/^[a-f0-9]{64}$/.test(descriptor.sha256), `invalid frozen SHA-256 for ${descriptor.id}`);
    seenIds.add(descriptor.id);
    seenPaths.add(descriptor.path);

    const absolutePath = resolveWithin(rootDir, descriptor.path);
    let bytes;
    try {
      bytes = await readFile(absolutePath);
    } catch (error) {
      throw new Error(`required frozen artifact is missing or unreadable: ${descriptor.path}`, { cause: error });
    }
    const observedHash = sha256(bytes);
    invariant(observedHash === descriptor.sha256,
      `frozen artifact hash mismatch for ${descriptor.path}: expected ${descriptor.sha256}, observed ${observedHash}`);

    let parsed;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`frozen artifact is not valid JSON: ${descriptor.path}`, { cause: error });
    }
    invariant(parsed?.schema_version === descriptor.schemaVersion,
      `schema mismatch for ${descriptor.path}: expected ${descriptor.schemaVersion}`);
    artifacts[descriptor.id] = parsed;
    integrity.push(Object.freeze({
      id: descriptor.id,
      path: descriptor.path,
      sha256: observedHash,
      schema_version: parsed.schema_version,
    }));
  }

  return Object.freeze({ artifacts: Object.freeze(artifacts), integrity: Object.freeze(integrity) });
}

function validateEvidenceContract(artifacts) {
  const g4 = artifacts.generation4;
  const g4Robustness = artifacts.generation4_robustness;
  const g6 = artifacts.generation6;
  const g6Robustness = artifacts.generation6_robustness;
  const recurring = artifacts.recurring_contribution;
  const aegis = artifacts.aegis_q_auxiliary;

  invariant(g4.trial_count === 100, "Generation 4 trial count must remain 100");
  invariant(g4.raw_return_track?.selected_id_before_recent_and_robustness === "qqq_core_sector_12_6",
    "Generation 4 descriptive candidate changed");
  invariant(g4.balanced_track?.selected_id_before_recent_and_robustness === null,
    "Generation 4 balanced track unexpectedly selected a candidate");
  invariant(g4Robustness.fixed_candidate_id === "qqq_core_sector_12_6", "Generation 4 robustness candidate mismatch");
  invariant(g4Robustness.gates?.promotion_eligible === false, "Generation 4 must not be promotion eligible");
  invariant(g4Robustness.gates?.local_robustness_passes === false, "Generation 4 robustness must remain failed");

  const candidate = g4.metrics?.post_2013_full_history?.qqq_core_sector_12_6;
  const spy = g4.metrics?.post_2013_full_history?.spy_buy_hold;
  invariant(candidate?.start_date === "2013-01-02" && candidate?.end_date === "2026-08-27",
    "Generation 4 candidate window changed");
  invariant(spy?.start_date === candidate.start_date && spy?.end_date === candidate.end_date,
    "Generation 4 candidate and SPY windows are not aligned");
  invariant(candidate?.observations === spy?.observations && candidate.observations === 3434,
    "Generation 4 candidate and SPY observations are not aligned");
  invariant(g4.execution?.primary?.oneWayCostBps === 5, "Generation 4 primary cost assumption changed");
  invariant(g4.execution?.primary?.maximumRiskyGross === 1, "Generation 4 primary gross-risk cap changed");

  invariant(g6.disposition === "KEEP_G4_DESCRIPTIVE_BASELINE", "Generation 6 disposition changed");
  invariant(g6.track_statuses?.primary_spy === "NO_SPY_CHALLENGER", "Generation 6 SPY track unexpectedly changed");
  invariant(g6.track_statuses?.growth_control_challenge === "NO_GROWTH_CONTROL_CHALLENGER",
    "Generation 6 growth-control track unexpectedly changed");
  invariant(g6.selection?.primary_spy_track?.selected_id_before_post_selection_robustness === null,
    "Generation 6 unexpectedly selected a primary SPY candidate");
  invariant(g6.selection?.growth_control_challenge_track?.selected_id_before_post_selection_robustness === null,
    "Generation 6 unexpectedly selected a growth-control candidate");
  invariant(Object.keys(g6.assessments ?? {}).length === 7, "Generation 6 must contain seven assessed candidates");
  invariant(g6Robustness.frozen_blueprint?.cumulative_effective_trials === 113,
    "cumulative effective trial count changed");
  invariant(g6Robustness.selection?.deduplicated_candidate_count === 0,
    "Generation 6 robustness unexpectedly contains a selected candidate");
  invariant(g6Robustness.track_results?.primary_spy?.passes === false
    && g6Robustness.track_results?.growth_control_challenge?.passes === false,
  "Generation 6 robustness tracks must remain failed");

  invariant(recurring.candidate_id === "qqq_core_sector_12_6" && recurring.benchmark_id === "spy_buy_hold",
    "recurring-contribution comparison changed");
  invariant(recurring.input_integrity?.generation_4_output_sha256 === SOURCE_REGISTRY[0].sha256,
    "recurring-contribution artifact does not bind to the frozen Generation 4 result");
  invariant(recurring.analysis?.monthly_contribution === 300, "recurring monthly contribution changed");
  invariant(recurring.analysis?.one_way_cost_bps === 5, "recurring contribution cost changed");
  invariant(JSON.stringify(Object.keys(recurring.analysis?.horizons ?? {}).sort()) === JSON.stringify(["1", "12", "3", "6"]),
    "recurring contribution horizons changed");

  invariant(aegis.comparison_role === "AUXILIARY_LEGACY_EQUITY_COMPARISON_ONLY",
    "AEGIS comparison role changed");
  invariant(aegis.claim_boundary?.auxiliary_only === true
    && aegis.claim_boundary?.apples_to_apples_with_finly === false
    && aegis.claim_boundary?.eligible_as_finly_champion === false
    && aegis.claim_boundary?.submitted_options_pnl === false,
  "AEGIS claim boundary is unsafe");
  invariant(aegis.published_bundle_verification?.verified === false,
    "AEGIS published bundle status changed; regenerate this surface under a new freeze if verified later");

  return Object.freeze({ g4, g4Robustness, g6, g6Robustness, recurring, aegis, candidate, spy });
}

function metricSubset(metric) {
  return Object.freeze({
    observations: metric.observations,
    start_date: metric.start_date,
    end_date: metric.end_date,
    total_return: metric.total_return,
    annualized_return: metric.annualized_return,
    annualized_volatility: metric.annualized_volatility,
    cash_excess_sharpe: metric.cash_excess_sharpe,
    maximum_drawdown: metric.maximum_drawdown,
    calmar_ratio: metric.calmar_ratio,
    annualized_turnover_notional: metric.annualized_turnover_notional,
    positive_calendar_year_fraction: metric.positive_calendar_year_fraction,
  });
}

function recurringSummary(recurring) {
  const horizons = {};
  for (const months of ["1", "3", "6", "12"]) {
    const source = recurring.analysis.horizons[months];
    const latest = source.latest_window;
    horizons[months] = Object.freeze({
      horizon_months: source.horizon_months,
      windows: source.summary.windows,
      first_start_month: source.summary.first_start_month,
      last_start_month: source.summary.last_start_month,
      candidate_beat_spy_fraction: source.summary.candidate_beat_benchmark_fraction,
      candidate_profitable_fraction: source.summary.candidate_profitable_fraction,
      spy_profitable_fraction: source.summary.benchmark_profitable_fraction,
      mean_ending_value_advantage_usd: source.summary.mean_ending_value_advantage,
      median_ending_value_advantage_usd: source.summary.median_ending_value_advantage,
      p05_ending_value_advantage_usd: source.summary.p05_ending_value_advantage,
      p95_ending_value_advantage_usd: source.summary.p95_ending_value_advantage,
      worst_ending_value_advantage_usd: source.summary.worst_ending_value_advantage,
      best_ending_value_advantage_usd: source.summary.best_ending_value_advantage,
      mean_candidate_gain_usd: source.summary.mean_candidate_dollar_gain,
      mean_spy_gain_usd: source.summary.mean_benchmark_dollar_gain,
      latest_window: Object.freeze({
        start_month: latest.start_month,
        end_month: latest.end_month,
        total_contributions_usd: latest.total_contributions,
        candidate_ending_value_usd: latest.candidate.ending_value,
        spy_ending_value_usd: latest.benchmark.ending_value,
        ending_value_advantage_usd: latest.ending_value_advantage,
        candidate_exceeded_spy: latest.candidate_beat_benchmark,
      }),
    });
  }
  return Object.freeze(horizons);
}

function maximumFamilywisePValue(g4Robustness) {
  const evidence = g4Robustness.statistical_evidence?.validation?.paired_block_bootstrap?.evidence;
  const values = [];
  for (const method of ["circular", "moving"]) {
    for (const blockLength of ["5", "20", "60"]) {
      values.push(evidence?.[method]?.[blockLength]?.fixed_candidate_familywise_adjusted_p_value);
    }
  }
  invariant(values.every(Number.isFinite), "Generation 4 familywise p-values are incomplete");
  return Math.max(...values);
}

function buildSafeClaims({ candidate, spy, g4Robustness, recurring }) {
  const horizons = recurring.analysis.horizons;
  const claims = Object.freeze([
    "Across the ledger's 113 conservatively counted effective research attempts, zero new challenger was promoted to replace frozen v1; this count includes controls, unexecuted or rejected suggestions, invalidated runs, an aborted attempt, and reruns, not 113 independent viable strategies.",
    `In the consumed ${candidate.start_date} through ${candidate.end_date} retrospective replay, the G4 candidate recorded ${(100 * candidate.annualized_return).toFixed(2)}% annualized return versus ${(100 * spy.annualized_return).toFixed(2)}% for SPY after the declared 5 bp one-way costs.`,
    `In that same consumed replay, the G4 candidate's maximum drawdown was ${(100 * candidate.maximum_drawdown).toFixed(2)}% versus ${(100 * spy.maximum_drawdown).toFixed(2)}% for SPY.`,
    `With $300 contributed monthly, the G4 candidate exceeded SPY's ending balance in ${["1", "3", "6", "12"].map((months) => `${(100 * horizons[months].summary.candidate_beat_benchmark_fraction).toFixed(1)}% of ${months}-month windows`).join(", ")}; the one-month calendar windows do not overlap, longer horizons overlap heavily, and all summaries share one consumed path, so they are descriptive rather than independent trials.`,
    `The G4 robustness review rejected promotion: its deflated-Sharpe probability was ${(100 * g4Robustness.statistical_evidence.validation.deflated_sharpe.deflated_sharpe.probability_observed_sharpe_exceeds_deflated_benchmark).toFixed(2)}%, and its worst adjusted familywise p-value was ${(100 * maximumFamilywisePValue(g4Robustness)).toFixed(2)}%.`,
    "G6 evaluated seven frozen challengers and selected none on either the primary SPY track or the separate growth-control track.",
    "The core G4 formula, date partitions, and costs were committed before its run; the excess-Sharpe selection rule and later inference corrections changed afterward, so the current analysis is not described as fully preregistered.",
    "The pinned AEGIS-Q replay is an auxiliary legacy-equity reproduction attempt only; it did not reproduce the published bundle exactly and does not represent the submitted options strategy.",
    "All reported market intervals were already consumed; these artifacts do not establish future profitability or authorize live-capital use.",
  ]);
  assertSafePublicLanguage(claims, "safe claims");
  return claims;
}

export async function buildEvidenceSurface(options = {}) {
  const loaded = await loadFrozenArtifacts(options);
  const evidence = validateEvidenceContract(loaded.artifacts);
  const recurringHorizons = recurringSummary(evidence.recurring);
  const safeClaims = buildSafeClaims(evidence);
  const candidateMetrics = metricSubset(evidence.candidate);
  const spyMetrics = metricSubset(evidence.spy);
  const dsr = evidence.g4Robustness.statistical_evidence.validation.deflated_sharpe.deflated_sharpe;
  const attemptAccounting = researchAttemptAccounting();
  invariant(attemptAccounting.conservatively_counted_effective_research_attempts
    === evidence.g6Robustness.frozen_blueprint.cumulative_effective_trials,
  "public research-attempt accounting does not match the frozen robustness count");

  const publicArtifact = Object.freeze({
    schema_version: "finly_submission_quantitative_evidence_surface.v2",
    evidence_as_of: evidence.candidate.end_date,
    assessment: "RETROSPECTIVE_EVIDENCE_ONLY_NO_PROMOTED_REPLACEMENT_CHALLENGER",
    safe_claims: safeClaims,
    selection_audit: Object.freeze({
      research_attempt_accounting: attemptAccounting,
      promoted_replacement_challenger_count: 0,
      generation4: Object.freeze({
        candidate_id: "qqq_core_sector_12_6",
        role: "DESCRIPTIVE_BASELINE_ONLY",
        selection_disposition: evidence.g4.disposition,
        robustness_disposition: evidence.g4Robustness.disposition,
        promotion_eligible: false,
      }),
      generation6: Object.freeze({
        assessed_candidate_count: Object.keys(evidence.g6.assessments).length,
        primary_spy_selected_id: evidence.g6.selection.primary_spy_track.selected_id_before_post_selection_robustness,
        growth_control_selected_id: evidence.g6.selection.growth_control_challenge_track.selected_id_before_post_selection_robustness,
        primary_spy_status: evidence.g6.track_statuses.primary_spy,
        growth_control_status: evidence.g6.track_statuses.growth_control_challenge,
        disposition: evidence.g6.disposition,
        robustness_disposition: evidence.g6Robustness.disposition,
      }),
    }),
    g4_consumed_2013_2026_replay: Object.freeze({
      candidate_id: "qqq_core_sector_12_6",
      benchmark_id: "spy_buy_hold",
      evidence_class: "CONSUMED_RETROSPECTIVE_REPLAY",
      execution: Object.freeze({
        signal_lookback_sessions: evidence.g4.execution.primary.lookbackSessions,
        rebalance_interval_sessions: evidence.g4.execution.primary.rebalanceIntervalSessions,
        one_way_cost_bps: evidence.g4.execution.primary.oneWayCostBps,
        annual_borrow_spread: evidence.g4.execution.primary.annualBorrowSpread,
        maximum_risky_gross: evidence.g4.execution.primary.maximumRiskyGross,
        terminal_liquidation: evidence.g4.execution.primary.terminalLiquidation,
      }),
      candidate: candidateMetrics,
      spy: spyMetrics,
      candidate_minus_spy: Object.freeze({
        total_return: round(evidence.candidate.total_return - evidence.spy.total_return),
        annualized_return: round(evidence.candidate.annualized_return - evidence.spy.annualized_return),
        cash_excess_sharpe: round(evidence.candidate.cash_excess_sharpe - evidence.spy.cash_excess_sharpe),
        maximum_drawdown: round(evidence.candidate.maximum_drawdown - evidence.spy.maximum_drawdown),
        annualized_turnover_notional: round(evidence.candidate.annualized_turnover_notional - evidence.spy.annualized_turnover_notional),
      }),
    }),
    recurring_contribution_replay: Object.freeze({
      evidence_class: "OVERLAPPING_DESCRIPTIVE_WINDOWS",
      candidate_id: evidence.recurring.candidate_id,
      benchmark_id: evidence.recurring.benchmark_id,
      monthly_contribution_usd: evidence.recurring.analysis.monthly_contribution,
      one_way_cost_bps: evidence.recurring.analysis.one_way_cost_bps,
      minimum_start_date: evidence.recurring.analysis.minimum_start_date,
      terminal_observation_date: evidence.recurring.analysis.terminal_observation_date,
      terminal_month_excluded: evidence.recurring.analysis.terminal_month_excluded,
      horizons: recurringHorizons,
      inference_boundary: "Only observably complete calendar months are included. Overlapping windows are descriptive and autocorrelated; their fractions are not independent probability estimates or forecasts.",
    }),
    g4_falsification: Object.freeze({
      cost_sign_stable_at_5_10_25_bps: evidence.g4Robustness.gates.raw_spy_edge_keeps_sign_at_5_10_25bp,
      positive_spy_edges_at_all_21_rebalance_offsets: evidence.g4Robustness.gates.all_21_offsets_keep_development_and_validation_spy_edges_positive,
      deflated_sharpe_probability: dsr.probability_observed_sharpe_exceeds_deflated_benchmark,
      required_deflated_sharpe_probability: 0.95,
      worst_familywise_adjusted_p_value: maximumFamilywisePValue(evidence.g4Robustness),
      maximum_permitted_familywise_p_value: 0.05,
      static_growth_control_independence_supported: evidence.g4Robustness.gates.alpha_independence_from_static_growth_tilt_supported,
      authenticated_source_overlap_passed: evidence.g4Robustness.gates.authenticated_source_overlap_for_every_used_symbol,
      promotion_eligible: evidence.g4Robustness.gates.promotion_eligible,
      interpretation: "Implementation and local sensitivity checks passed, but multiple-testing, static-growth-control independence, and authenticated source-overlap gates blocked promotion.",
    }),
    aegis_q_auxiliary: Object.freeze({
      comparison_role: evidence.aegis.comparison_role,
      status: evidence.aegis.status,
      apples_to_apples_with_finly: false,
      submitted_options_pnl_reproduced: false,
      eligible_for_finly_selection_or_rank: false,
      published_bundle_verified: evidence.aegis.published_bundle_verification.verified,
      native_window: evidence.aegis.native_comparison,
      replay_metrics: Object.freeze({
        legacy_agent: Object.freeze({
          cagr: evidence.aegis.metrics.agent.cagr,
          annual_volatility: evidence.aegis.metrics.agent.annual_volatility,
          sharpe_0pct_cash: evidence.aegis.metrics.agent.sharpe_0pct_cash,
          maximum_drawdown: evidence.aegis.metrics.agent.max_drawdown,
        }),
        qqq: Object.freeze({
          cagr: evidence.aegis.metrics.QQQ.cagr,
          annual_volatility: evidence.aegis.metrics.QQQ.annual_volatility,
          sharpe_0pct_cash: evidence.aegis.metrics.QQQ.sharpe_0pct_cash,
          maximum_drawdown: evidence.aegis.metrics.QQQ.max_drawdown,
        }),
        tqqq: Object.freeze({
          cagr: evidence.aegis.metrics.TQQQ.cagr,
          annual_volatility: evidence.aegis.metrics.TQQQ.annual_volatility,
          sharpe_0pct_cash: evidence.aegis.metrics.TQQQ.sharpe_0pct_cash,
          maximum_drawdown: evidence.aegis.metrics.TQQQ.max_drawdown,
        }),
      }),
      inference_boundary: "This is a pinned legacy-equity reproduction attempt, not the submitted AEGIS-Q options strategy and not evidence for cross-project financial rank.",
    }),
    public_claim_policy: Object.freeze({
      status: "BOUNDED_RETROSPECTIVE_LANGUAGE_ONLY",
      required_context: Object.freeze([
        "state the exact historical window and cost assumptions",
        "identify every interval as consumed retrospective evidence",
        "state that zero new challenger was promoted to replace frozen v1 after robustness review",
        "describe 113 conservatively counted effective research attempts with the complete composition and non-independence boundary",
        "disclose that the core formula, partitions, and costs predated the run while the excess-Sharpe gate and later inference corrections did not",
        "keep the AEGIS-Q reproduction outside direct rank comparisons",
      ]),
      disallowed_inferences: Object.freeze([
        "stable benchmark superiority across future regimes",
        "established future profit",
        "categorical financial rank against unreproducible submissions",
      ]),
    }),
    source_integrity: Object.freeze({
      all_six_hashes_verified: true,
      artifact_count: loaded.integrity.length,
      artifacts: loaded.integrity,
    }),
  });
  assertSafePublicLanguage(publicArtifact);
  const markdown = renderMarkdown(publicArtifact);
  assertSafePublicLanguage(markdown, "public evidence report");
  return Object.freeze({ publicArtifact, markdown });
}

function percent(value, places = 2) {
  return `${(100 * Number(value)).toFixed(places)}%`;
}

function dollars(value) {
  const number = Number(value);
  const sign = number < 0 ? "−" : "";
  return `${sign}$${Math.abs(number).toFixed(2)}`;
}

function renderMarkdownBase(surface) {
  const g4 = surface.g4_consumed_2013_2026_replay;
  const falsification = surface.g4_falsification;
  const horizons = surface.recurring_contribution_replay.horizons;
  const horizonRows = ["1", "3", "6", "12"].map((months) => {
    const item = horizons[months];
    return `| ${months} | ${item.windows} | ${percent(item.candidate_beat_spy_fraction, 1)} | ${percent(item.candidate_profitable_fraction, 1)} | ${percent(item.spy_profitable_fraction, 1)} | ${dollars(item.median_ending_value_advantage_usd)} | ${dollars(item.worst_ending_value_advantage_usd)} |`;
  }).join("\n");
  const sourceRows = surface.source_integrity.artifacts
    .map((item) => `| ${item.id} | \`${item.path}\` | \`${item.sha256}\` |`)
    .join("\n");
  const claims = surface.safe_claims.map((claim) => `- ${claim}`).join("\n");
  const accounting = surface.selection_audit.research_attempt_accounting;
  const accountingRows = accounting.composition
    .map((item) => `| ${item.detail} | ${item.count} |`)
    .join("\n");

  return `# Finly quantitative evidence surface\n\n## Answer first\n\nAcross the ledger's **113 conservatively counted effective research attempts, zero new challenger was promoted to replace frozen v1**. This accounting includes controls, unexecuted or rejected suggestions, invalidated runs, an aborted attempt, and reruns; it is not a count of 113 independent viable strategies. The strongest surviving object is a descriptive G4 retrospective baseline, not a validated champion. G6 selected no challenger.\n\n## Research-attempt accounting\n\n| Counted component | Attempts |\n|---|---:|\n${accountingRows}\n| **Total: conservatively counted effective research attempts** | **${accounting.conservatively_counted_effective_research_attempts}** |\n\nThe total is a conservative multiple-testing denominator. It includes controls, suggestions that were unexecuted or rejected, invalidated runs, an aborted attempt, and reruns. It must not be interpreted as 113 independent viable strategies. The core G4 formula, date partitions, and costs were committed before its run; the excess-Sharpe selection rule and later inference corrections changed afterward. Accordingly, the current analysis is not described as fully preregistered, and all historical intervals are now consumed.\n\n## Consumed 2013–2026 G4 replay\n\n| Metric | G4 candidate | SPY |\n|---|---:|---:|\n| Cumulative return | ${percent(g4.candidate.total_return)} | ${percent(g4.spy.total_return)} |\n| Annualized return | ${percent(g4.candidate.annualized_return)} | ${percent(g4.spy.annualized_return)} |\n| Annualized volatility | ${percent(g4.candidate.annualized_volatility)} | ${percent(g4.spy.annualized_volatility)} |\n| Cash-excess Sharpe | ${g4.candidate.cash_excess_sharpe.toFixed(2)} | ${g4.spy.cash_excess_sharpe.toFixed(2)} |\n| Maximum drawdown | ${percent(g4.candidate.maximum_drawdown)} | ${percent(g4.spy.maximum_drawdown)} |\n| Annualized turnover | ${g4.candidate.annualized_turnover_notional.toFixed(2)}× | ${g4.spy.annualized_turnover_notional.toFixed(2)}× |\n\nWindow: **${g4.candidate.start_date} to ${g4.candidate.end_date}** (${g4.candidate.observations.toLocaleString("en-US")} aligned sessions). The replay uses a 5 bp one-way cost, a 1.0× risky-gross cap, causal signals, and terminal liquidation. Every date in this interval was already consumed during research.\n\n## Why the G4 result was not promoted\n\n- Cost sign at 5/10/25 bp: **passed**.\n- Development and validation SPY edge at all 21 rebalance offsets: **passed**.\n- Deflated-Sharpe probability: **${percent(falsification.deflated_sharpe_probability)}**, below the 95% gate.\n- Worst adjusted familywise p-value: **${percent(falsification.worst_familywise_adjusted_p_value)}**, above the 5% gate.\n- Independence from the static SPY/QQQ growth control: **not supported**.\n- Authenticated source overlap for every used symbol: **not passed**.\n\nThose failures are outcome-determinative: G4 remains descriptive evidence only.\n\n## $300 monthly-contribution replay\n\n| Horizon | Windows | Candidate exceeded SPY | Candidate profitable | SPY profitable | Median ending advantage | Worst ending advantage |\n|---:|---:|---:|---:|---:|---:|---:|\n${horizonRows}\n\nThese rolling windows start from January 2013, overlap heavily, and are autocorrelated. They describe the frozen paths under equal contribution schedules; they are not independent win probabilities. The negative worst-window values are retained to make downside cases visible.\n\n## G6 challenger result\n\nSeven frozen G6 candidates were assessed. None cleared the primary SPY track, and none cleared the separate growth-control track. Post-selection robustness therefore recorded no selected candidate and kept G4 only as a descriptive baseline.\n\n## AEGIS-Q auxiliary boundary\n\nThe pinned legacy-equity replay status is **${surface.aegis_q_auxiliary.status}**. Its published bundle did not verify exactly. It is neither the submitted options strategy nor an apples-to-apples basis for financial rank, so its return metrics remain auxiliary context only.\n\n## Exact safe claims\n\n${claims}\n\n## Source integrity\n\n| Artifact | Frozen path | SHA-256 |\n|---|---|---|\n${sourceRows}\n\nAll six source hashes are verified before this surface is built. Missing, modified, or schema-incompatible inputs fail closed.\n`;
}

export function renderMarkdown(surface) {
  return renderMarkdownBase(surface).replace(
    "These rolling windows start from January 2013, overlap heavily, and are autocorrelated. They describe the frozen paths under equal contribution schedules; they are not independent win probabilities.",
    "The one-month calendar windows do not overlap; longer horizons overlap heavily, and all summaries share one consumed historical path. They describe frozen paths under equal contribution schedules rather than independent win probabilities.",
  );
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function writeEvidenceSurface({
  rootDir = projectRoot,
  outputRootDir = rootDir,
  registry = SOURCE_REGISTRY,
  outputPaths = OUTPUT_PATHS,
} = {}) {
  const built = await buildEvidenceSurface({ rootDir, registry });
  const jsonPath = resolveWithin(outputRootDir, outputPaths.json);
  const markdownPath = resolveWithin(outputRootDir, outputPaths.markdown);
  const json = `${JSON.stringify(built.publicArtifact, null, 2)}\n`;
  assertSafePublicLanguage(json, "serialized public evidence JSON");
  await atomicWrite(jsonPath, json);
  await atomicWrite(markdownPath, built.markdown);
  return Object.freeze({
    json_path: jsonPath,
    markdown_path: markdownPath,
    json_sha256: sha256(json),
    markdown_sha256: sha256(built.markdown),
    assessment: built.publicArtifact.assessment,
    conservatively_counted_effective_research_attempts:
      built.publicArtifact.selection_audit.research_attempt_accounting.conservatively_counted_effective_research_attempts,
    promoted_replacement_challenger_count:
      built.publicArtifact.selection_audit.promoted_replacement_challenger_count,
  });
}

if (process.argv[1] === modulePath) {
  const result = await writeEvidenceSurface();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
