import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafePublicLanguage } from "./build_submission_quantitative_evidence_surface.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");

export const SOURCE_REGISTRY = Object.freeze([
  Object.freeze({ id: "quantitative_evidence", path: "research/output/submission_quantitative_evidence_surface.json", sha256: "e69236a8b313bb42a9add625c0a90ce0ed678c8a81da259ef0399b8afb2da4db" }),
  Object.freeze({ id: "wealth_drawdown_data", path: "public/data/g4_wealth_drawdown.json", sha256: "cbd5d1a3d794148623326aa62f65feb460345a1b182e0170e7025f791fed5b8e" }),
  Object.freeze({ id: "wealth_drawdown_figure", path: "public/figures/g4_wealth_drawdown.png", sha256: "2e9a788c25a08b1b51d2958c7c603eedf0b2881b8030c3d34b4d898dd37adbca", binary: true }),
  Object.freeze({ id: "forward_engine", path: "research/forward_trial1.mjs", sha256: "acd6b07f61a37624534c98472c315f732bf51bc4bdf50764cfacb4c0d8224528", binary: true }),
  Object.freeze({ id: "forward_runner", path: "research/run_forward_trial1.mjs", sha256: "26ab2123234e8172c421cd085a3ab3d050354344d4bbcb0af93c9402d0f16749", binary: true }),
  Object.freeze({ id: "forward_protocol", path: "research/forward_trial1_protocol.json", sha256: "502436b0fdb850d24cd3503dd808a512aca1774b119ca7185b6a06f7288f17b9" }),
  Object.freeze({ id: "forward_genesis", path: "research/forward_trial1_genesis.json", sha256: "42f10290b3ce301a2cee8d72f181a522e694aa38cf394e9f896a24bade26990c" }),
  Object.freeze({ id: "forward_bridge", path: "research/forward_trial1_bridge_2026-08-28.json", sha256: "ed63b5c4b27289d3b73e87c1377cec01e76c58506559d174ebd43420e66cbc31" }),
  Object.freeze({ id: "forward_documentation", path: "research/FORWARD_TRIAL1.md", sha256: "72056b07f19d3eb3f8360f0e7d558b1338d8f6337c24dc86dc4eafb92e360648", binary: true }),
  Object.freeze({ id: "forward_tests", path: "tests/forward_trial1.test.mjs", sha256: "553fc7d4989db3a437b0436a332cd0de8e2032abce4cff1b1b20f0c6be05c531", binary: true }),
  Object.freeze({ id: "production_economic_research", path: "public/data/economic_research.json", sha256: "8e4411ec5475da81c24ef5b3f3e73f46a42b66284e2a0dff368f8b70f9fa982b" }),
  Object.freeze({ id: "current_economic_decision", path: "public/data/current_economic_decision.json", sha256: "cd5f617639c00a217c9536b7b970a7b81d410a4e8ee0c47f984d9314234ab9f2" }),
  Object.freeze({ id: "equity_execution_realism", path: "research/output/equity_execution_realism.json", sha256: "8d4eb5922acf46c539790c398364ffcd41aa6c189c38494bf31f871bb6dfeb6d" }),
  Object.freeze({ id: "prospective_attempt114_protocol", path: "research/prospective_attempt114/protocol.json", sha256: "794bb93d578b4b4766daac1c27d7fa0a68f730fbeda853b208aa98ad501572ff" }),
  Object.freeze({ id: "prospective_attempt114_runtime_manifest", path: "research/prospective_attempt114/runtime_manifest.json", sha256: "c3fbcb985385ef9dcbc118824a6e318b1e39f45b290e180a6a1f1f0865ea9966" }),
  Object.freeze({ id: "prospective_attempt114_publication_receipt", path: "research/prospective_attempt114/publication_receipts/a10099fa3931c9ef6d40446486744dde72f1efb5538515d03c015cd7c1a87fbb.json", sha256: "de45561738de7be69d4b6bfa5da8848919756fc29682c42aa60dddb26d029360" }),
]);

export const OUTPUT_PATH = "public/data/submission_claims_lock.json";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function resolveWithin(rootDir, relativePath) {
  const root = resolve(rootDir);
  const absolute = resolve(root, relativePath);
  const fromRoot = relative(root, absolute);
  invariant(fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !fromRoot.startsWith(sep),
    `path escapes project root: ${relativePath}`);
  return absolute;
}

async function loadSources(rootDir = projectRoot) {
  const sources = {};
  const integrity = [];
  for (const item of SOURCE_REGISTRY) {
    const payload = await readFile(resolveWithin(rootDir, item.path));
    const digest = sha256(payload);
    invariant(digest === item.sha256, `${item.id} hash mismatch: ${digest}`);
    integrity.push(Object.freeze({ id: item.id, path: item.path, sha256: digest }));
    if (!item.binary) sources[item.id] = JSON.parse(payload.toString("utf8"));
  }
  return Object.freeze({ sources: Object.freeze(sources), integrity: Object.freeze(integrity) });
}

export async function buildSubmissionClaimsLock({ rootDir = projectRoot } = {}) {
  const loaded = await loadSources(rootDir);
  const quant = loaded.sources.quantitative_evidence;
  const chart = loaded.sources.wealth_drawdown_data;
  const protocol = loaded.sources.forward_protocol;
  const genesis = loaded.sources.forward_genesis;
  const economicResearch = loaded.sources.production_economic_research;
  const currentDecision = loaded.sources.current_economic_decision;
  const executionRealism = loaded.sources.equity_execution_realism;
  const attempt114Protocol = loaded.sources.prospective_attempt114_protocol;
  const attempt114Runtime = loaded.sources.prospective_attempt114_runtime_manifest;
  const attempt114Publication = loaded.sources.prospective_attempt114_publication_receipt;

  invariant(quant.schema_version === "finly_submission_quantitative_evidence_surface.v2", "unexpected quantitative evidence schema");
  invariant(chart.schema_version === "finly_public_g4_wealth_drawdown.v1", "unexpected chart-data schema");
  invariant(protocol.schema_version === "finly_forward_trial1_protocol.v2", "unexpected forward protocol schema");
  invariant(genesis.schema_version === "finly_forward_trial1_genesis.v2", "unexpected forward genesis schema");
  invariant(economicResearch.schema_version === "finly_economic_research.v1", "unexpected economic research schema");
  invariant(currentDecision.schema_version === "finly_current_economic_bundle.v1", "unexpected current decision schema");
  invariant(executionRealism.schema_version === "finly_equity_execution_realism_evidence.v1", "unexpected execution-realism schema");
  invariant(attempt114Protocol.schema_version === "finly_attempt114_prospective_profitability_protocol.v1", "unexpected Attempt 114 protocol schema");
  invariant(attempt114Runtime.schema_version === "finly_attempt114_runtime_manifest.v1", "unexpected Attempt 114 runtime schema");
  invariant(attempt114Publication.schema_version === "finly_attempt114_github_publication_collection_receipt.v1", "unexpected Attempt 114 publication schema");
  invariant(genesis.commitment_sequence === 0 && genesis.settlement_sequence === 0, "forward genesis is not zero-row");
  invariant(protocol.authorization_boundary.broker_mutation_permitted === false, "forward protocol grants broker mutation");
  invariant(protocol.authorization_boundary.signal_commitment_write_enabled === false, "forward commitment gate is open");
  invariant(protocol.authorization_boundary.settlement_write_enabled === false, "forward settlement gate is open");
  invariant(protocol.data_boundary.corporate_action_reconciliation_ready === false, "corporate-action gate unexpectedly claims readiness");
  invariant(protocol.data_boundary.provider_outcome_price_reconciliation_ready === false, "outcome-price gate unexpectedly claims readiness");
  invariant(protocol.external_anchoring.local_verifier_status === "NOT_CONFIGURED_ZERO_ROW_FREEZE", "external anchor unexpectedly claims readiness");
  invariant(economicResearch.final_holdout.selected_candidate_id === "tsmom_ensemble_vol", "production holdout policy mismatch");
  invariant(currentDecision.deterministic_decision.policy_id === "tsmom_ensemble_vol", "current production policy mismatch");
  invariant(currentDecision.mutation_requested === false, "current decision requested broker mutation");

  invariant(executionRealism.evidence_class === "CONSUMED_RETROSPECTIVE_EXECUTION_REALISM", "execution-realism evidence class changed");
  invariant(executionRealism.protocol.selected_policy_id === economicResearch.final_holdout.selected_candidate_id,
    "execution-realism policy differs from production policy");
  invariant(executionRealism.protocol.execution === "fractional market DAY orders at the next session open t+1",
    "execution-realism fill assumption changed");
  invariant(executionRealism.publication_boundary.aggregate_artifact_publication_permitted === true,
    "execution-realism aggregate is not publicable");
  invariant(executionRealism.publication_boundary.raw_ohlc_publication_permitted === false,
    "execution-realism raw OHLC boundary changed");
  invariant(executionRealism.publication_boundary.alpha_claim_publication_permitted === false
    && executionRealism.publication_boundary.future_profit_claim_publication_permitted === false,
    "execution-realism claim boundary changed");
  invariant(executionRealism.mutation_authorized === false && executionRealism.broker_mutation === false,
    "execution-realism artifact authorizes broker mutation");

  const nextOpen = executionRealism.next_open_execution_realism;
  invariant(nextOpen.status === "AVAILABLE_CONSUMED_RETROSPECTIVE_EXECUTION_REALISM",
    "next-open execution-realism result is unavailable");
  const nextOpenStress = nextOpen.adjusted_theoretical_total_return.cost_stress_bps_per_leg;
  const displayedCostBps = Object.freeze([1, 5, 25]);
  for (const bps of displayedCostBps) {
    const metrics = nextOpenStress[String(bps)];
    invariant(metrics?.observations === 415, `next-open ${bps} bp observation count changed`);
    invariant(metrics.start_date === "2025-01-02" && metrics.end_date === "2026-08-28",
      `next-open ${bps} bp window changed`);
    invariant(Number.isFinite(metrics.total_return)
      && Number.isFinite(metrics.annualized_return)
      && Number.isFinite(metrics.annualized_volatility)
      && Number.isFinite(metrics.maximum_drawdown)
      && Number.isFinite(metrics.spy_total_return), `next-open ${bps} bp metrics are not finite`);
    invariant(metrics.total_return > 0 && metrics.total_return < metrics.spy_total_return,
      `next-open ${bps} bp result no longer has the bounded positive-under-SPY interpretation`);
  }
  const rawProxy = nextOpen.raw_no_distribution_proxy;
  const smallAccount = nextOpen.small_account_proxy;
  invariant(rawProxy.metrics_at_1bp?.observations === 415 && Number.isFinite(rawProxy.metrics_at_1bp.total_return),
    "raw/no-distribution execution proxy changed");
  invariant(smallAccount.execution?.initial_equity_usd === 300
    && smallAccount.execution.minimum_order_notional_usd === 1
    && smallAccount.execution.quantity_decimals === 9
    && smallAccount.execution.sell_day_fees_total_usd === 0.7
    && smallAccount.execution.skipped_minimum_orders === 12
    && Number.isFinite(smallAccount.ending_equity_usd), "small-account execution proxy changed");

  const attemptPublication = attempt114Publication.runtime_publication_receipt;
  invariant(attempt114Protocol.attempt_id === attempt114Runtime.attempt_id
    && attempt114Protocol.attempt_id === attempt114Publication.attempt_id,
    "Attempt 114 artifact identities differ");
  invariant(attempt114Protocol.policy_binding.policy_id === economicResearch.final_holdout.selected_candidate_id,
    "Attempt 114 policy differs from production policy");
  invariant(attempt114Protocol.sample.required_signal_commitments === 254
    && attempt114Protocol.sample.required_settlements === 252
    && attempt114Protocol.sample.no_skips === true
    && attempt114Protocol.sample.no_backfill === true
    && attempt114Protocol.sample.replacement_window_permitted === false
    && attempt114Protocol.sample.optional_stopping_permitted === false,
    "Attempt 114 prospective sample boundary changed");
  invariant(attempt114Runtime.publication_deadline_exclusive === true
    && attempt114Runtime.publication_deadline === attemptPublication.exclusive_deadline,
    "Attempt 114 publication deadline differs across artifacts");
  invariant(attempt114Runtime.protocol.raw_bytes_sha256
    === attemptPublication.published_artifacts.protocol.raw_bytes_sha256
    && attempt114Runtime.protocol.protocol_sha256
      === attemptPublication.published_artifacts.protocol.protocol_sha256
    && attempt114Protocol.protocol_sha256
      === attemptPublication.published_artifacts.protocol.protocol_sha256,
    "Attempt 114 protocol publication binding changed");
  const integrityById = Object.freeze(Object.fromEntries(loaded.integrity.map((item) => [
    item.id,
    `sha256:${item.sha256}`,
  ])));
  invariant(attemptPublication.published_artifacts.protocol.raw_bytes_sha256
    === integrityById.prospective_attempt114_protocol
    && attemptPublication.published_artifacts.runtime_manifest.raw_bytes_sha256
      === integrityById.prospective_attempt114_runtime_manifest,
    "Attempt 114 published raw-byte hashes differ from the hash-bound source registry");
  invariant(attempt114Runtime.manifest_sha256
    === attemptPublication.published_artifacts.runtime_manifest.manifest_sha256
    && attempt114Runtime.runtime_source_files_sha256
      === attemptPublication.published_artifacts.runtime_manifest.runtime_source_files_sha256,
    "Attempt 114 runtime publication binding changed");
  const runtimeSourceEntries = Object.entries(attempt114Runtime.runtime_source_files);
  const publishedSourceEntries = Object.entries(attemptPublication.published_artifacts.runtime_source_files);
  invariant(runtimeSourceEntries.length === 17 && publishedSourceEntries.length === 17,
    "Attempt 114 bound runtime-source count changed");
  invariant(runtimeSourceEntries.every(([path, digest]) => (
    attemptPublication.published_artifacts.runtime_source_files[path] === digest
  )), "Attempt 114 public runtime-source hashes differ from the manifest");
  invariant(attempt114Publication.publication_head_sha === attemptPublication.publication_commit.sha
    && attempt114Publication.workflow_run_id === attemptPublication.workflow_run.id
    && attemptPublication.workflow_run.head_sha === attemptPublication.publication_commit.sha
    && attemptPublication.workflow_run.status === "completed"
    && attemptPublication.workflow_run.conclusion === "success",
    "Attempt 114 public commit/workflow linkage changed");
  invariant(Date.parse(attemptPublication.workflow_run.created_at) < Date.parse(attemptPublication.exclusive_deadline)
    && Date.parse(attemptPublication.verification_observed_at) < Date.parse(attemptPublication.exclusive_deadline),
    "Attempt 114 public publication was not observed before the exclusive deadline");
  invariant(attemptPublication.assurance.github_public_api_record_verified === true
    && attemptPublication.assurance.successful_workflow_observed === true
    && attemptPublication.assurance.public_pre_deadline_publication_observed === true
    && attemptPublication.assurance.github_platform_record_only === true
    && attemptPublication.assurance.independent_cryptographic_timestamp_verified === false
    && attemptPublication.assurance.provider_origin_verified === false
    && attemptPublication.assurance.broker_execution_verified === false
    && attemptPublication.assurance.performance_inference_permitted === false,
    "Attempt 114 public assurance boundary changed");
  invariant(attempt114Publication.github_public_get_evidence.request_count === 23
    && attempt114Publication.github_public_get_evidence.responses.length === 23,
    "Attempt 114 public GET evidence count changed");
  invariant(attempt114Runtime.authority.broker_mutation_authorized === false
    && attempt114Runtime.authority.network_requests_permitted === false
    && attempt114Runtime.evaluation_gates.inference_enabled === false,
    "Attempt 114 runtime authority or inference gate changed");

  const g4 = quant.g4_consumed_2013_2026_replay;
  const attempts = quant.selection_audit.research_attempt_accounting;
  const lock = Object.freeze({
    schema_version: "finly_submission_claims_lock.v1",
    status: "LOCKED_FOR_QUALITATIVE_REBUILD",
    evidence_as_of: attemptPublication.verification_observed_at,
    central_distinction: "Finly separates finding a plausible trade from earning authority to risk capital.",
    judge_proposition: "Judge Finly on whether its controlled-delegation architecture can refuse attractive but insufficient evidence, not on an unsupported promise of future profit.",
    retrospective_result: Object.freeze({
      evidence_class: "CONSUMED_RETROSPECTIVE_ETF_REPLAY",
      candidate: "G4 qqq_core_sector_12_6 shadow",
      window: g4.candidate.start_date === chart.date_range.start && g4.candidate.end_date === chart.date_range.end
        ? chart.date_range
        : null,
      one_way_cost_bps: g4.execution.one_way_cost_bps,
      candidate_total_return: g4.candidate.total_return,
      spy_total_return: g4.spy.total_return,
      candidate_annualized_return: g4.candidate.annualized_return,
      spy_annualized_return: g4.spy.annualized_return,
      candidate_annualized_volatility: g4.candidate.annualized_volatility,
      spy_annualized_volatility: g4.spy.annualized_volatility,
      candidate_maximum_drawdown: g4.candidate.maximum_drawdown,
      spy_maximum_drawdown: g4.spy.maximum_drawdown,
      candidate_annualized_turnover: g4.candidate.annualized_turnover_notional,
      spy_annualized_turnover: g4.spy.annualized_turnover_notional,
      promotion_status: "NOT_PROMOTED_DESCRIPTIVE_ONLY",
      boundary: chart.claim_boundary,
    }),
    falsification: Object.freeze({
      deflated_sharpe_probability: quant.g4_falsification.deflated_sharpe_probability,
      required_deflated_sharpe_probability: quant.g4_falsification.required_deflated_sharpe_probability,
      worst_familywise_adjusted_p_value: quant.g4_falsification.worst_familywise_adjusted_p_value,
      maximum_permitted_familywise_p_value: quant.g4_falsification.maximum_permitted_familywise_p_value,
      cost_sign_stable_at_5_10_25_bps: quant.g4_falsification.cost_sign_stable_at_5_10_25_bps,
      all_21_offsets_positive_spy_edges: quant.g4_falsification.positive_spy_edges_at_all_21_rebalance_offsets,
      growth_control_independence_supported: quant.g4_falsification.static_growth_control_independence_supported,
      authenticated_source_overlap_passed: quant.g4_falsification.authenticated_source_overlap_passed,
      replacement_challengers_promoted: quant.selection_audit.promoted_replacement_challenger_count,
      generation6_challengers_assessed: quant.selection_audit.generation6.assessed_candidate_count,
      generation6_primary_selected_id: quant.selection_audit.generation6.primary_spy_selected_id,
      generation6_growth_selected_id: quant.selection_audit.generation6.growth_control_selected_id,
    }),
    research_attempt_accounting: Object.freeze({
      conservatively_counted_effective_attempts: attempts.conservatively_counted_effective_research_attempts,
      composition: attempts.composition,
      includes_nonindependent_or_unexecuted_items: true,
      exact_claim: "Across the ledger's 113 conservatively counted effective attempts, zero new challenger was promoted to replace frozen v1.",
    }),
    hindsight_boundary: Object.freeze({
      core_formula_partitions_and_costs_committed_before_run: true,
      excess_sharpe_gate_and_later_inference_corrections_changed_after_initial_output: true,
      fully_preregistered_claim_permitted: false,
      all_historical_intervals_consumed: true,
    }),
    production_policy: Object.freeze({
      policy_id: economicResearch.final_holdout.selected_candidate_id,
      evidence_class: "FIXED_2025_2026_HISTORICAL_HOLDOUT_NOW_CONSUMED",
      distinct_from_g4_shadow: true,
      definition: protocol.formula_bindings.finly_production_v1.definition,
      window: Object.freeze({
        start: economicResearch.final_holdout.selected_candidate_metrics.start_date,
        end: economicResearch.final_holdout.selected_candidate_metrics.end_date,
        observations: economicResearch.final_holdout.selected_candidate_metrics.observations,
      }),
      candidate: Object.freeze({
        total_return: economicResearch.final_holdout.selected_candidate_metrics.total_return,
        annualized_return: economicResearch.final_holdout.selected_candidate_metrics.annualized_return,
        annualized_volatility: economicResearch.final_holdout.selected_candidate_metrics.annualized_volatility,
        maximum_drawdown: economicResearch.final_holdout.selected_candidate_metrics.maximum_drawdown,
      }),
      spy: Object.freeze({
        total_return: economicResearch.final_holdout.buy_hold_metrics.total_return,
        annualized_return: economicResearch.final_holdout.buy_hold_metrics.annualized_return,
        annualized_volatility: economicResearch.final_holdout.buy_hold_metrics.annualized_volatility,
        maximum_drawdown: economicResearch.final_holdout.buy_hold_metrics.maximum_drawdown,
      }),
      interpretation: "The frozen production policy reduced volatility and drawdown in the fixed holdout but underperformed SPY's raw total and annualized return. It has zero forward observations, so the holdout does not support a claim that it is more likely than not to beat SPY next month.",
      latest_research_proposal: Object.freeze({
        spy_weight: currentDecision.risk_committee_decision.final_allocation.spy_weight,
        bil_weight: currentDecision.risk_committee_decision.final_allocation.bil_weight,
        paper_account_spy_weight_before_proposal: currentDecision.paper_account_boundary.current_spy_weight,
        paper_account_defensive_weight_before_proposal: currentDecision.paper_account_boundary.current_defensive_weight,
        broker_mutation_authorized: currentDecision.risk_committee_decision.authorization.broker_mutation_authorized,
        mutation_requested: currentDecision.mutation_requested,
      }),
    }),
    execution_realism: Object.freeze({
      evidence_class: executionRealism.evidence_class,
      evidence_as_of: executionRealism.evidence_as_of,
      policy_id: executionRealism.protocol.selected_policy_id,
      window: Object.freeze({
        start: nextOpenStress["1"].start_date,
        end: nextOpenStress["1"].end_date,
        observations: nextOpenStress["1"].observations,
      }),
      fill_assumption: executionRealism.protocol.execution,
      cost_unit: "basis points per absolute traded-notional leg",
      next_open_cost_stress: Object.freeze(displayedCostBps.map((bps) => Object.freeze({
        bps_per_leg: bps,
        total_return: nextOpenStress[String(bps)].total_return,
        annualized_return: nextOpenStress[String(bps)].annualized_return,
        annualized_volatility: nextOpenStress[String(bps)].annualized_volatility,
        maximum_drawdown: nextOpenStress[String(bps)].maximum_drawdown,
        spy_total_return: nextOpenStress[String(bps)].spy_total_return,
      }))),
      raw_no_distribution_proxy: Object.freeze({
        bps_per_leg: 1,
        total_return: rawProxy.metrics_at_1bp.total_return,
        annualized_return: rawProxy.metrics_at_1bp.annualized_return,
        annualized_volatility: rawProxy.metrics_at_1bp.annualized_volatility,
        maximum_drawdown: rawProxy.metrics_at_1bp.maximum_drawdown,
        spy_total_return: rawProxy.metrics_at_1bp.spy_total_return,
      }),
      small_account_proxy: Object.freeze({
        bps_per_leg: 1,
        initial_equity_usd: smallAccount.execution.initial_equity_usd,
        ending_equity_usd: smallAccount.ending_equity_usd,
        total_return: smallAccount.metrics_at_1bp.total_return,
        annualized_return: smallAccount.metrics_at_1bp.annualized_return,
        maximum_drawdown: smallAccount.metrics_at_1bp.maximum_drawdown,
        minimum_order_notional_usd: smallAccount.execution.minimum_order_notional_usd,
        quantity_decimals: smallAccount.execution.quantity_decimals,
        sell_day_fees_total_usd: smallAccount.execution.sell_day_fees_total_usd,
        skipped_minimum_orders: smallAccount.execution.skipped_minimum_orders,
      }),
      assurance: Object.freeze({
        consumed_retrospective_only: true,
        raw_ohlc_redistributed: false,
        alpha_proven: executionRealism.alpha_proven,
        future_profitability_proven: executionRealism.future_profitability_proven,
        broker_fill_verified: false,
        broker_mutation_authorized: executionRealism.mutation_authorized,
      }),
      exact_safe_claim: "In a consumed 2025-01-02 through 2026-08-28 next-open adjusted-OHLC audit, the frozen SPY/BIL policy recorded positive modeled returns at 1, 5, and 25 basis points per traded leg but underperformed SPY. This is execution-mechanics sensitivity, not alpha, a broker fill, live or options P&L, a forecast, or proof of future profit.",
    }),
    prospective_attempt114: Object.freeze({
      attempt_id: attempt114Protocol.attempt_id,
      attempt_number: attempt114Protocol.attempt_number,
      evidence_class: "PUBLIC_GITHUB_PRE_SIGNAL_FREEZE_POINTER",
      publication_status: "PUBLIC_PRE_DEADLINE_GITHUB_WORKFLOW_VERIFIED",
      required_signal_commitments: attempt114Protocol.sample.required_signal_commitments,
      required_settlements: attempt114Protocol.sample.required_settlements,
      primary_intervals: attempt114Protocol.primary_inference.intervals,
      exclusive_deadline: attemptPublication.exclusive_deadline,
      publication_commit: Object.freeze({
        sha: attemptPublication.publication_commit.sha,
        url: attemptPublication.publication_commit.html_url,
      }),
      verification_workflow: Object.freeze({
        run_id: attemptPublication.workflow_run.id,
        url: attemptPublication.workflow_run.html_url,
        conclusion: attemptPublication.workflow_run.conclusion,
        created_at: attemptPublication.workflow_run.created_at,
        completed_at: attemptPublication.workflow_run.updated_at,
      }),
      verification_observed_at: attemptPublication.verification_observed_at,
      bound_runtime_source_count: runtimeSourceEntries.length,
      public_get_count: attempt114Publication.github_public_get_evidence.request_count,
      assurance: Object.freeze({
        github_public_api_record_verified: attemptPublication.assurance.github_public_api_record_verified,
        successful_workflow_observed: attemptPublication.assurance.successful_workflow_observed,
        public_pre_deadline_publication_observed: attemptPublication.assurance.public_pre_deadline_publication_observed,
        github_platform_record_only: attemptPublication.assurance.github_platform_record_only,
        independent_cryptographic_timestamp_verified: attemptPublication.assurance.independent_cryptographic_timestamp_verified,
        provider_origin_verified: attemptPublication.assurance.provider_origin_verified,
        broker_execution_verified: attemptPublication.assurance.broker_execution_verified,
        performance_inference_permitted: attemptPublication.assurance.performance_inference_permitted,
        broker_mutation_authorized: attempt114Runtime.authority.broker_mutation_authorized,
      }),
      sample_boundary: Object.freeze({
        consecutive_official_sessions_required: attempt114Protocol.sample.consecutive_official_sessions_required,
        no_skips: attempt114Protocol.sample.no_skips,
        no_backfill: attempt114Protocol.sample.no_backfill,
        replacement_window_permitted: attempt114Protocol.sample.replacement_window_permitted,
        optional_stopping_permitted: attempt114Protocol.sample.optional_stopping_permitted,
        repeat_confirmatory_test_permitted: attempt114Protocol.primary_inference.repeat_confirmatory_test_permitted,
      }),
      exact_safe_claim: "Attempt 114 publicly pinned the protocol, runtime, settlement, decomposition, and inference bytes to a successful GitHub workflow before the exclusive first-signal deadline. This GitHub platform record is not an independent cryptographic timestamp; all 254 timely commitment anchors and 252 reconciled settlements are still required, and performance inference and broker mutation remain disabled.",
    }),
    forward_trial: Object.freeze({
      schema_version: protocol.schema_version,
      phase: protocol.status,
      commitments: genesis.commitment_sequence,
      settlements: genesis.settlement_sequence,
      books: protocol.books,
      first_signal_session: protocol.timing.first_signal_session,
      minimum_settlements_for_primary_calculation: protocol.inference.minimum_settlements,
      production_commitment_enabled: protocol.authorization_boundary.signal_commitment_write_enabled,
      production_settlement_enabled: protocol.authorization_boundary.settlement_write_enabled,
      performance_inference_enabled: false,
      broker_authority: false,
      private_seed_redistributed: protocol.data_boundary.private_seed_redistributed,
      corporate_action_reconciliation_ready: protocol.data_boundary.corporate_action_reconciliation_ready,
      outcome_price_reconciliation_ready: protocol.data_boundary.provider_outcome_price_reconciliation_ready,
      independent_anchor_verifier_configured: false,
      exact_safe_claim: "Forward Trial 1 is a clean-clone-verifiable, locally hash-bound, zero-row, two-phase protocol. It records no signal commitments or settlements, carries no broker authority, and keeps production commitment, settlement, and performance inference disabled. Its synthetic TEST_ONLY path demonstrates the frozen schema and accounting mechanics; it does not prove prospectivity, provider origin, execution, performance, or future profit.",
    }),
    options_and_broker_boundary: Object.freeze({
      historical_g4_is_options_pnl: false,
      historical_g4_is_etf_allocation_replay: true,
      options_contribution: "Deterministic defined-risk order compilation and authorization boundary.",
      authenticated_read_only_paper_account_check: true,
      order_submitted_or_filled_as_evidence: false,
      live_capital_authorized: false,
    }),
    public_claim_policy: Object.freeze({
      safe_lines: Object.freeze([
        "The consumed retrospective G4 replay recorded a higher annualized return and a shallower maximum drawdown than SPY under the declared assumptions, but failed promotion.",
        "Finly refused to promote its strongest historical chart after multiple-testing, growth-control independence, and source-validation gates failed.",
        "Forward Trial 1 begins at zero commitments and zero settlements, with performance inference disabled.",
        "The historical ETF replay is not an options P&L, and no broker order or fill is claimed as performance evidence.",
        "The production policy is distinct from G4: in its now-consumed fixed holdout it underperformed SPY's raw return while reducing volatility and drawdown, and it has zero forward observations.",
      ]),
      forbidden_lines: Object.freeze([
        "Finly consistently outperforms SPY.",
        "Finly is proven profitable.",
        "Forward results are independently validated.",
        "The historical replay proves options profitability.",
        "Finly is fully preregistered.",
        "Finly is the best-performing submission.",
        "Production Finly is more likely than not to beat SPY next month.",
      ]),
    }),
    figure: Object.freeze({
      path: "public/figures/g4_wealth_drawdown.png",
      data_path: "public/data/g4_wealth_drawdown.json",
      observations: chart.observations,
      required_visible_boundary: chart.claim_boundary,
    }),
    source_integrity: Object.freeze({
      all_hashes_verified: true,
      artifacts: loaded.integrity,
    }),
  });

  invariant(lock.retrospective_result.window !== null, "chart and quantitative evidence windows differ");
  assertSafePublicLanguage({
    central_distinction: lock.central_distinction,
    judge_proposition: lock.judge_proposition,
    retrospective_boundary: lock.retrospective_result.boundary,
    attempt_claim: lock.research_attempt_accounting.exact_claim,
    forward_claim: lock.forward_trial.exact_safe_claim,
    execution_realism_claim: lock.execution_realism.exact_safe_claim,
    prospective_attempt114_claim: lock.prospective_attempt114.exact_safe_claim,
    safe_lines: lock.public_claim_policy.safe_lines,
  }, "safe submission claims");
  return lock;
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function writeSubmissionClaimsLock({ rootDir = projectRoot, outputPath = OUTPUT_PATH } = {}) {
  const lock = await buildSubmissionClaimsLock({ rootDir });
  const serialized = `${JSON.stringify(lock, null, 2)}\n`;
  const path = resolveWithin(rootDir, outputPath);
  await atomicWrite(path, serialized);
  return Object.freeze({
    output_path: path,
    sha256: sha256(serialized),
    status: lock.status,
    retrospective_promotion_status: lock.retrospective_result.promotion_status,
    execution_realism_total_return_5bps: lock.execution_realism.next_open_cost_stress[1].total_return,
    prospective_attempt114_publication_status: lock.prospective_attempt114.publication_status,
    forward_commitments: lock.forward_trial.commitments,
    forward_settlements: lock.forward_trial.settlements,
  });
}

if (process.argv[1] === modulePath) {
  const result = await writeSubmissionClaimsLock();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
