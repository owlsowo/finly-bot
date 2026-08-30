import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256, stableStringify } from "../lib/canonical.mjs";
import {
  loadProspectiveAttempt115Protocol,
  validateProspectiveAttempt115Protocol,
} from "./prospective_attempt115/protocol.mjs";
import {
  loadProspectiveAttempt116Protocol,
  validateProspectiveAttempt116Protocol,
} from "./prospective_attempt116/protocol.mjs";
import { validateAttempt115GitHubPublicationReceipt } from "../scripts/verify_attempt115_github_publication.mjs";
import { validateAttempt116GitHubPublicationReceipt } from "../scripts/verify_attempt116_github_publication.mjs";

const modulePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(modulePath), "..");

export const QUANTITATIVE_RELEASE_GATE_SCHEMA = "finly_quantitative_release_gate.v1";

export const SOURCE_REGISTRY = Object.freeze([
  Object.freeze({
    id: "submission_quantitative_evidence_surface",
    path: "research/output/submission_quantitative_evidence_surface.json",
    schema_version: "finly_submission_quantitative_evidence_surface.v2",
    raw_bytes_sha256: "sha256:e69236a8b313bb42a9add625c0a90ce0ed678c8a81da259ef0399b8afb2da4db",
  }),
  Object.freeze({
    id: "equity_execution_realism",
    path: "research/output/equity_execution_realism.json",
    schema_version: "finly_equity_execution_realism_evidence.v1",
    raw_bytes_sha256: "sha256:8d4eb5922acf46c539790c398364ffcd41aa6c189c38494bf31f871bb6dfeb6d",
  }),
  Object.freeze({
    id: "attempt115_protocol",
    path: "research/downside_semivolatility_challenger_protocol.json",
    schema_version: "finly_downside_semivolatility_challenger_protocol.v1",
    raw_bytes_sha256: "sha256:34d30a46e70c07b27fad637b1948262f953662b43e30cbbaf86b84927dbe0e53",
    self_hash_field: "protocol_sha256",
    self_hash_sha256: "sha256:340ba21e8e3404bd42adcd8e4e30ea5f0f327ee2d891988564ca3f0654657619",
  }),
  Object.freeze({
    id: "attempt115_publication_receipt",
    path: "research/prospective_attempt115/publication_receipts/4dd7720d25198702013ab10e582b37004515bed5e4466a56eca89192559d2cd9.json",
    schema_version: "finly_attempt115_github_publication_receipt.v1",
    raw_bytes_sha256: "sha256:16d6af10a21b6654b862cf48a1489fca51aa7015b3f33b152832a2637704f436",
    self_hash_field: "receipt_sha256",
    self_hash_sha256: "sha256:4dd7720d25198702013ab10e582b37004515bed5e4466a56eca89192559d2cd9",
  }),
  Object.freeze({
    id: "attempt116_protocol",
    path: "research/prospective_attempt116/protocol.json",
    schema_version: "finly_attempt116_vrp_shadow_protocol.v1",
    raw_bytes_sha256: "sha256:3baa380e02f982d1c0c892357cded0e24ad311c2e73c1c1cc38d1d1b5d1501a2",
    self_hash_field: "protocol_sha256",
    self_hash_sha256: "sha256:8703b78afabe6cfe39d981ed1399878ba219b8f92100982c43e2c88e24c5a677",
  }),
  Object.freeze({
    id: "attempt116_publication_receipt",
    path: "research/prospective_attempt116/publication_receipts/934e52a583893e2720a0962195efd56b5f4b2a0554a1b8f8dfa9ab5951191362.json",
    schema_version: "finly_attempt116_github_public_registration_receipt.v1",
    raw_bytes_sha256: "sha256:1f959fd4245b7abd0c8eeeef2c4034623f93f68a691a9f80e0570c97ceab16ec",
    self_hash_field: "receipt_sha256",
    self_hash_sha256: "sha256:934e52a583893e2720a0962195efd56b5f4b2a0554a1b8f8dfa9ab5951191362",
  }),
  Object.freeze({
    id: "field_evidence_availability_generation7",
    path: "research/field_evidence_availability_generation7.json",
    schema_version: "finly_anonymous_field_evidence_availability.v1",
    raw_bytes_sha256: "sha256:da43337c634c50dd85d7c1c194d43d3f0d0b2747b82822c62f4f59db2a2c708d",
  }),
]);

export const OUTPUT_PATHS = Object.freeze({
  json: "research/output/quantitative_release_gate.json",
  markdown: "research/output/quantitative_release_gate_report.md",
  public_json: "public/data/quantitative_release_gate.json",
});

export const EXACT_ALLOWED_CLAIMS = Object.freeze([
  "In the consumed, post-selected 2013-01-02–2026-08-27 retrospective replay with modeled 5 bp one-way costs, G4 returned +967.11% versus SPY +580.82%; promotion was rejected because the Deflated Sharpe probability was 3.75% and the worst familywise-adjusted p-value was 37.18%.",
  "Production v1 is the frozen unlevered SPY/BIL policy targeting 10% annualized volatility: in the consumed 2025-01-02–2026-08-28 modeled next-open study it returned +15.39% at 5 bp per traded leg and +10.56% at 25 bp, versus SPY +33.52%; at 5 bp its modeled annualized volatility was 8.12% and maximum drawdown was -5.45%, so it was risk-controlled but not market-beating on total return.",
  "Attempts 115 and 116 are publicly registered future-only tests. As of 2026-08-30T08:10:52.000Z, each had zero observed outcomes, and neither supports a performance claim.",
  "At the Generation 7 capture, 20 projects were visible and zero supplied an exact same-panel submitted-options comparator; missing P&L is unknown, never zero, and supports neither a return matchup nor a competitor rank.",
]);

export const EXACT_FORBIDDEN_CLAIMS = Object.freeze([
  "Finly will be profitable in the future.",
  "Finly will beat SPY next month.",
  "Finly has verified options P&L.",
  "Finly ranks first, or above any named competitor, on returns or profitability.",
  "Attempt 115 or Attempt 116 has a performance outcome.",
  "G4 is validated, promoted, or evidence of future market superiority.",
  "Missing competitor P&L equals zero or proves a Finly win.",
  "Any Finly-versus-competitor return or P&L matchup.",
]);

const EXACT_LIMITATIONS = Object.freeze([
  "All G4 and production-v1 market intervals are consumed retrospective evidence.",
  "The production-v1 next-open study is a modeled adjusted-OHLC ledger, not broker fills or options P&L.",
  "The public-registration receipts are GitHub platform records, not independent cryptographic timestamps or outcome evidence.",
  "Absent competitor P&L is unknown and cannot be imputed, compared, or ranked.",
]);

const EXACT_DOWNSTREAM_SURFACES = Object.freeze({
  site: "USE_EXACT_ALLOWED_CLAIMS_ONLY",
  paper: "USE_EXACT_ALLOWED_CLAIMS_ONLY",
  deck: "USE_EXACT_ALLOWED_CLAIMS_ONLY",
  video: "USE_EXACT_ALLOWED_CLAIMS_ONLY",
});

const RELEASE_RATIONALE = "Release only the source-bound historical, execution-realism, prospective-registration, and evidence-availability statements below. Do not publish a return matchup or financial rank against another project.";

const INTERNAL_MATCHUP_LEAK_PATTERNS = Object.freeze([
  /aegis/iu,
  /legacy[_ -]reproduction/iu,
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function rawBytesSha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function resolveWithin(rootDir, relativePath) {
  invariant(typeof relativePath === "string" && relativePath.length > 0,
    "artifact path is required");
  const root = resolve(rootDir);
  const absolutePath = resolve(root, relativePath);
  const fromRoot = relative(root, absolutePath);
  invariant(fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`)
    && !fromRoot.startsWith(sep), `artifact path escapes the project root: ${relativePath}`);
  return absolutePath;
}

export function assertNoInternalMatchupLeakage(value, label = "quantitative release gate") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const pattern of INTERNAL_MATCHUP_LEAK_PATTERNS) {
    invariant(!pattern.test(text), `${label} contains prohibited internal matchup material`);
  }
  return true;
}

export async function loadFrozenQuantitativeReleaseGateSources({
  rootDir = projectRoot,
  registry = SOURCE_REGISTRY,
} = {}) {
  invariant(Array.isArray(registry) && registry.length === 7,
    "exactly seven quantitative release-gate sources are required");
  const seenIds = new Set();
  const seenPaths = new Set();

  const loaded = await Promise.all(registry.map(async (descriptor) => {
    invariant(typeof descriptor?.id === "string" && descriptor.id.length > 0,
      "source id is required");
    invariant(!seenIds.has(descriptor.id), `duplicate source id: ${descriptor.id}`);
    invariant(typeof descriptor?.path === "string" && descriptor.path.length > 0,
      `source path is required for ${descriptor.id}`);
    invariant(!seenPaths.has(descriptor.path), `duplicate source path: ${descriptor.path}`);
    invariant(/^sha256:[a-f0-9]{64}$/u.test(descriptor.raw_bytes_sha256),
      `invalid raw SHA-256 for ${descriptor.id}`);
    seenIds.add(descriptor.id);
    seenPaths.add(descriptor.path);

    const absolutePath = resolveWithin(rootDir, descriptor.path);
    let bytes;
    try {
      bytes = await readFile(absolutePath);
    } catch (error) {
      throw new Error(`required release-gate source is missing or unreadable: ${descriptor.path}`,
        { cause: error });
    }
    const observedHash = rawBytesSha256(bytes);
    invariant(observedHash === descriptor.raw_bytes_sha256,
      `release-gate source hash mismatch for ${descriptor.path}: expected ${descriptor.raw_bytes_sha256}, observed ${observedHash}`);

    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`release-gate source is not valid JSON: ${descriptor.path}`, { cause: error });
    }
    invariant(value?.schema_version === descriptor.schema_version,
      `release-gate source schema mismatch for ${descriptor.path}`);
    if (descriptor.self_hash_field) {
      invariant(value[descriptor.self_hash_field] === descriptor.self_hash_sha256,
        `release-gate source self-hash mismatch for ${descriptor.path}`);
    }
    return Object.freeze({
      descriptor,
      value,
      integrity: Object.freeze({
        id: descriptor.id,
        path: descriptor.path,
        schema_version: descriptor.schema_version,
        raw_bytes_sha256: observedHash,
        ...(descriptor.self_hash_field ? {
          self_hash_field: descriptor.self_hash_field,
          self_hash_sha256: descriptor.self_hash_sha256,
        } : {}),
      }),
    });
  }));

  const sources = Object.fromEntries(loaded.map(({ descriptor, value }) => [descriptor.id, value]));
  const integrity = loaded.map(({ integrity: item }) => item);
  return Object.freeze({ sources: Object.freeze(sources), integrity: Object.freeze(integrity) });
}

async function validateSourceContracts(sources, rootDir) {
  const surface = sources.submission_quantitative_evidence_surface;
  const execution = sources.equity_execution_realism;
  const attempt115Protocol = sources.attempt115_protocol;
  const attempt115Receipt = sources.attempt115_publication_receipt;
  const attempt116Protocol = sources.attempt116_protocol;
  const attempt116Receipt = sources.attempt116_publication_receipt;
  const fieldEvidence = sources.field_evidence_availability_generation7;

  const canonical115 = await loadProspectiveAttempt115Protocol({ projectRoot: rootDir });
  const canonical116 = await loadProspectiveAttempt116Protocol({ projectRoot: rootDir });
  validateProspectiveAttempt115Protocol(attempt115Protocol);
  validateProspectiveAttempt116Protocol(attempt116Protocol);
  invariant(stableStringify(canonical115) === stableStringify(attempt115Protocol),
    "Attempt 115 canonical protocol loader disagrees with the frozen source");
  invariant(stableStringify(canonical116) === stableStringify(attempt116Protocol),
    "Attempt 116 canonical protocol loader disagrees with the frozen source");
  validateAttempt115GitHubPublicationReceipt(attempt115Receipt);
  validateAttempt116GitHubPublicationReceipt(attempt116Receipt);

  const g4 = surface.g4_consumed_2013_2026_replay;
  const g4Falsification = surface.g4_falsification;
  invariant(g4?.evidence_class === "CONSUMED_RETROSPECTIVE_REPLAY",
    "G4 is not bound as consumed retrospective evidence");
  invariant(surface.selection_audit?.generation4?.promotion_eligible === false
    && surface.selection_audit?.generation4?.robustness_disposition
      === "KEEP_V1_POST_SELECTION_ROBUSTNESS_FAILED",
  "G4 post-selection rejection changed");
  invariant(g4.candidate?.total_return === 9.6710597833
    && g4.spy?.total_return === 5.8081746189,
  "G4 or SPY consumed total return changed");
  invariant(g4Falsification.deflated_sharpe_probability === 0.037478432287
    && g4Falsification.worst_familywise_adjusted_p_value === 0.371814092954
    && g4Falsification.promotion_eligible === false,
  "G4 falsification result changed");

  const costCells = execution.next_open_execution_realism
    ?.adjusted_theoretical_total_return?.cost_stress_bps_per_leg;
  invariant(execution.protocol?.selected_policy_id === "tsmom_ensemble_vol",
    "production v1 policy binding changed");
  invariant(costCells?.["5"]?.total_return === 0.1538759778
    && costCells?.["25"]?.total_return === 0.1055891073
    && costCells?.["5"]?.spy_total_return === 0.3352366407
    && costCells?.["25"]?.spy_total_return === 0.3352366407,
  "production v1 execution-realism returns changed");
  invariant(costCells["5"].annualized_volatility === 0.0812194739
    && costCells["5"].maximum_drawdown === -0.0544710489,
  "production v1 modeled risk result changed");
  invariant(execution.alpha_proven === false && execution.future_profitability_proven === false
    && execution.publication_boundary?.profitability_claim_publication_permitted === false,
  "execution-realism claim boundary changed");

  invariant(attempt115Protocol.attempt_number === 115
    && attempt115Protocol.hindsight_boundary?.retrospective_runner_permitted === false
    && attempt115Protocol.primary_inference?.status_in_this_scaffold
      === "NOT_COMPUTED_RUNTIME_AND_FINALIZATION_GATES_CLOSED"
    && attempt115Protocol.authority_and_disposition?.primary_inference_permitted_by_this_scaffold
      === false,
  "Attempt 115 is no longer a zero-outcome future-only test");
  invariant(attempt115Receipt.repository?.public === true
    && attempt115Receipt.workflow_run?.conclusion === "success"
    && attempt115Receipt.assurance?.performance_inference_permitted === false,
  "Attempt 115 public-registration boundary changed");

  invariant(attempt116Protocol.attempt_number === 116
    && attempt116Protocol.first_eligible_input?.retrospective_runner_permitted === false
    && attempt116Protocol.evaluation_gates?.outcome_observed === false
    && attempt116Protocol.authority?.performance_inference_authorized === false,
  "Attempt 116 is no longer a zero-outcome future-only test");
  invariant(attempt116Receipt.repository?.public === true
    && attempt116Receipt.workflow_run?.conclusion === "success"
    && attempt116Receipt.assurance?.performance_inference_permitted === false,
  "Attempt 116 public-registration boundary changed");

  invariant(fieldEvidence.capture?.visible_submission_count === 20
    && fieldEvidence.capture?.complete_visible_census === true,
  "Generation 7 aggregate visible-project count changed");
  invariant(fieldEvidence.financial_evidence_availability
    ?.exact_same_panel_submitted_options_comparator_count === 0
    && fieldEvidence.financial_evidence_availability?.status
      === "NO_PUBLIC_SAME_PANEL_SUBMITTED_OPTIONS_COMPARATOR"
    && fieldEvidence.financial_evidence_availability
      ?.finly_vs_project_return_matchup_authorized === false
    && fieldEvidence.financial_evidence_availability
      ?.cross_project_financial_rank_authorized === false,
  "Generation 7 aggregate financial-evidence boundary changed");
  invariant(fieldEvidence.financial_evidence_availability?.missing_pnl_treatment
      === "UNKNOWN_NEVER_ZERO"
    && fieldEvidence.privacy_boundary?.project_level_records_included === false
    && fieldEvidence.privacy_boundary?.project_names_included === false
    && fieldEvidence.privacy_boundary?.project_critiques_included === false
    && fieldEvidence.privacy_boundary?.project_return_figures_included === false,
  "Generation 7 privacy or missing-P&L boundary changed");

  return Object.freeze({
    surface,
    execution,
    attempt115Protocol,
    attempt115Receipt,
    attempt116Protocol,
    attempt116Receipt,
    fieldEvidence,
    g4,
    g4Falsification,
    costCells,
  });
}

function percent(value, places = 2, forceSign = false) {
  const number = 100 * Number(value);
  const sign = forceSign && number > 0 ? "+" : "";
  return `${sign}${number.toFixed(places)}%`;
}

function latestEvidenceInstant(evidence) {
  const values = [
    evidence.execution.evidence_as_of,
    evidence.attempt115Receipt.verification_observed_at,
    evidence.attempt116Receipt.verification_observed_at,
    evidence.fieldEvidence.captured_at,
  ];
  invariant(values.every((value) => Number.isFinite(Date.parse(value))),
    "release-gate evidence timestamps are invalid");
  return new Date(Math.max(...values.map(Date.parse))).toISOString();
}

export function quantitativeReleaseGateBody(value) {
  invariant(value && typeof value === "object" && !Array.isArray(value),
    "quantitative release gate must be an object");
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "artifact_sha256"));
}

export function hashQuantitativeReleaseGate(value) {
  return sha256(quantitativeReleaseGateBody(value));
}

export function canonicalQuantitativeReleaseGateJson(value) {
  validateQuantitativeReleaseGate(value);
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`;
}

export function validateQuantitativeReleaseGate(value) {
  invariant(stableStringify(Object.keys(value ?? {}).sort()) === stableStringify([
    "allowed_claims",
    "artifact_sha256",
    "conclusions",
    "evidence_as_of",
    "forbidden_claims",
    "limitations",
    "release_decision",
    "schema_version",
    "source_integrity",
  ]), "quantitative release-gate top-level fields changed");
  invariant(value?.schema_version === QUANTITATIVE_RELEASE_GATE_SCHEMA,
    "quantitative release-gate schema changed");
  invariant(value.evidence_as_of === "2026-08-30T08:10:52.000Z",
    "quantitative release-gate evidence boundary changed");
  invariant(stableStringify(value.release_decision) === stableStringify({
    status: "GO_BOUNDED_RELEASE_NO_GO_PERFORMANCE_MATCHUP",
    bounded_release: "GO",
    finly_vs_competitor_return_matchup: "NO_GO",
    competitor_rank_claim: "NO_GO",
    downstream_surfaces: EXACT_DOWNSTREAM_SURFACES,
    rationale: RELEASE_RATIONALE,
  }), "quantitative release-gate decision or authorization changed");
  invariant(stableStringify(value.conclusions) === stableStringify({
    g4_rejected_post_selection: {
      evidence_class: "CONSUMED_POST_SELECTED_RETROSPECTIVE_REPLAY",
      start_date: "2013-01-02",
      end_date: "2026-08-27",
      modeled_one_way_cost_bps: 5,
      g4_total_return: 9.6710597833,
      spy_total_return: 5.8081746189,
      deflated_sharpe_probability: 0.037478432287,
      worst_familywise_adjusted_p_value: 0.371814092954,
      disposition: "REJECTED_NOT_PROMOTED",
    },
    production_v1_execution_realism: {
      evidence_class: "CONSUMED_MODELED_NEXT_OPEN_EXECUTION_REALISM",
      policy_id: "tsmom_ensemble_vol",
      start_date: "2025-01-02",
      end_date: "2026-08-28",
      observations: 415,
      total_return_at_5bp_per_leg: 0.1538759778,
      total_return_at_25bp_per_leg: 0.1055891073,
      spy_total_return: 0.3352366407,
      annualized_volatility_at_5bp: 0.0812194739,
      maximum_drawdown_at_5bp: -0.0544710489,
      risk_characterization: "UNLEVERED_SPY_BIL_POLICY_TARGETING_10_PERCENT_ANNUALIZED_VOLATILITY",
      market_beating_on_total_return: false,
      broker_fill_replay: false,
    },
    registered_future_only_tests: [
      {
        attempt_number: 115,
        public_registration: "PUBLIC_GITHUB_RECEIPT_PRESENT_AND_CANONICALLY_VALIDATED",
        first_eligible_signal_session: "2026-08-31",
        observed_outcome_count: 0,
        performance_claim_authorized: false,
      },
      {
        attempt_number: 116,
        public_registration: "PUBLIC_GITHUB_RECEIPT_PRESENT_AND_CANONICALLY_VALIDATED",
        first_eligible_input_session: "2026-08-31",
        observed_outcome_count: 0,
        performance_claim_authorized: false,
      },
    ],
    competitor_evidence_availability: {
      captured_at: "2026-08-30T07:34:56Z",
      visible_project_count: 20,
      exact_same_panel_submitted_options_comparator_count: 0,
      missing_pnl_treatment: "UNKNOWN_NEVER_ZERO",
      finly_vs_competitor_return_matchup_authorized: false,
      competitor_rank_claim_authorized: false,
    },
  }), "quantitative release-gate conclusions changed");
  const expectedSources = SOURCE_REGISTRY.map((source) => ({
    id: source.id,
    path: source.path,
    schema_version: source.schema_version,
    raw_bytes_sha256: source.raw_bytes_sha256,
    ...(source.self_hash_field ? {
      self_hash_field: source.self_hash_field,
      self_hash_sha256: source.self_hash_sha256,
    } : {}),
  }));
  invariant(stableStringify(value.source_integrity) === stableStringify({
    all_hashes_verified: true,
    source_count: 7,
    sources: expectedSources,
  }), "quantitative release-gate source integrity changed");
  invariant(stableStringify(value.allowed_claims) === stableStringify(EXACT_ALLOWED_CLAIMS)
    && stableStringify(value.forbidden_claims) === stableStringify(EXACT_FORBIDDEN_CLAIMS),
  "quantitative release-gate claim registry changed");
  invariant(stableStringify(value.limitations) === stableStringify(EXACT_LIMITATIONS),
    "quantitative release-gate limitations changed");
  invariant(value.artifact_sha256 === hashQuantitativeReleaseGate(value),
    "quantitative release-gate self-hash changed");
  assertNoInternalMatchupLeakage(value);
  return value;
}

export async function buildQuantitativeReleaseGate({
  rootDir = projectRoot,
  registry = SOURCE_REGISTRY,
} = {}) {
  const loaded = await loadFrozenQuantitativeReleaseGateSources({ rootDir, registry });
  const evidence = await validateSourceContracts(loaded.sources, rootDir);
  const evidenceAsOf = latestEvidenceInstant(evidence);
  const five = evidence.costCells["5"];
  const twentyFive = evidence.costCells["25"];
  invariant(evidenceAsOf === "2026-08-30T08:10:52.000Z",
    "current source chronology no longer matches the exact release claims");

  const body = Object.freeze({
    schema_version: QUANTITATIVE_RELEASE_GATE_SCHEMA,
    evidence_as_of: evidenceAsOf,
    release_decision: Object.freeze({
      status: "GO_BOUNDED_RELEASE_NO_GO_PERFORMANCE_MATCHUP",
      bounded_release: "GO",
      finly_vs_competitor_return_matchup: "NO_GO",
      competitor_rank_claim: "NO_GO",
      downstream_surfaces: EXACT_DOWNSTREAM_SURFACES,
      rationale: RELEASE_RATIONALE,
    }),
    conclusions: Object.freeze({
      g4_rejected_post_selection: Object.freeze({
        evidence_class: "CONSUMED_POST_SELECTED_RETROSPECTIVE_REPLAY",
        start_date: evidence.g4.candidate.start_date,
        end_date: evidence.g4.candidate.end_date,
        modeled_one_way_cost_bps: evidence.g4.execution.one_way_cost_bps,
        g4_total_return: evidence.g4.candidate.total_return,
        spy_total_return: evidence.g4.spy.total_return,
        deflated_sharpe_probability: evidence.g4Falsification.deflated_sharpe_probability,
        worst_familywise_adjusted_p_value:
          evidence.g4Falsification.worst_familywise_adjusted_p_value,
        disposition: "REJECTED_NOT_PROMOTED",
      }),
      production_v1_execution_realism: Object.freeze({
        evidence_class: "CONSUMED_MODELED_NEXT_OPEN_EXECUTION_REALISM",
        policy_id: evidence.execution.protocol.selected_policy_id,
        start_date: five.start_date,
        end_date: five.end_date,
        observations: five.observations,
        total_return_at_5bp_per_leg: five.total_return,
        total_return_at_25bp_per_leg: twentyFive.total_return,
        spy_total_return: five.spy_total_return,
        annualized_volatility_at_5bp: five.annualized_volatility,
        maximum_drawdown_at_5bp: five.maximum_drawdown,
        risk_characterization:
          "UNLEVERED_SPY_BIL_POLICY_TARGETING_10_PERCENT_ANNUALIZED_VOLATILITY",
        market_beating_on_total_return: false,
        broker_fill_replay: false,
      }),
      registered_future_only_tests: Object.freeze([
        Object.freeze({
          attempt_number: 115,
          public_registration: "PUBLIC_GITHUB_RECEIPT_PRESENT_AND_CANONICALLY_VALIDATED",
          first_eligible_signal_session:
            evidence.attempt115Protocol.hindsight_boundary.first_eligible_signal_session,
          observed_outcome_count: 0,
          performance_claim_authorized: false,
        }),
        Object.freeze({
          attempt_number: 116,
          public_registration: "PUBLIC_GITHUB_RECEIPT_PRESENT_AND_CANONICALLY_VALIDATED",
          first_eligible_input_session:
            evidence.attempt116Protocol.first_eligible_input.session_date,
          observed_outcome_count: 0,
          performance_claim_authorized: false,
        }),
      ]),
      competitor_evidence_availability: Object.freeze({
        captured_at: evidence.fieldEvidence.captured_at,
        visible_project_count: evidence.fieldEvidence.capture.visible_submission_count,
        exact_same_panel_submitted_options_comparator_count: 0,
        missing_pnl_treatment: "UNKNOWN_NEVER_ZERO",
        finly_vs_competitor_return_matchup_authorized: false,
        competitor_rank_claim_authorized: false,
      }),
    }),
    allowed_claims: EXACT_ALLOWED_CLAIMS,
    forbidden_claims: EXACT_FORBIDDEN_CLAIMS,
    limitations: EXACT_LIMITATIONS,
    source_integrity: Object.freeze({
      all_hashes_verified: true,
      source_count: loaded.integrity.length,
      sources: loaded.integrity,
    }),
  });
  const artifact = Object.freeze({ ...body, artifact_sha256: sha256(body) });
  validateQuantitativeReleaseGate(artifact);
  const markdown = renderQuantitativeReleaseGateMarkdown(artifact);
  assertNoInternalMatchupLeakage(markdown, "quantitative release-gate Markdown");
  return Object.freeze({ artifact, markdown });
}

export function renderQuantitativeReleaseGateMarkdown(artifact) {
  validateQuantitativeReleaseGate(artifact);
  const g4 = artifact.conclusions.g4_rejected_post_selection;
  const v1 = artifact.conclusions.production_v1_execution_realism;
  const sourceRows = artifact.source_integrity.sources
    .map((source) => `| ${source.id} | \`${source.path}\` | \`${source.raw_bytes_sha256}\` |`)
    .join("\n");
  const allowed = artifact.allowed_claims.map((claim, index) => `${index + 1}. ${claim}`).join("\n");
  const forbidden = artifact.forbidden_claims.map((claim) => `- ${claim}`).join("\n");

  return `# Finly quantitative release gate\n\n## Decision\n\n**GO for a bounded quantitative release; NO-GO for any Finly-versus-competitor return or P&L matchup.** The site, paper, deck, and video may use only the four exact allowed claims below. No financial rank is authorized.\n\n## The releaseable evidence is useful but does not establish market superiority\n\n| Evidence | Exact result | Release interpretation |\n|---|---|---|\n| Consumed, post-selected G4 replay | ${g4.start_date}–${g4.end_date}; modeled ${g4.modeled_one_way_cost_bps} bp one-way; ${percent(g4.g4_total_return, 2, true)} vs SPY ${percent(g4.spy_total_return, 2, true)}; DSR ${percent(g4.deflated_sharpe_probability)}; familywise p ${percent(g4.worst_familywise_adjusted_p_value)} | Rejected; not promoted |\n| Production v1, modeled next open | ${v1.start_date}–${v1.end_date}; ${percent(v1.total_return_at_5bp_per_leg, 2, true)} at 5 bp/leg; ${percent(v1.total_return_at_25bp_per_leg, 2, true)} at 25 bp/leg; SPY ${percent(v1.spy_total_return, 2, true)} | Unlevered SPY/BIL policy targeting 10% annualized volatility; not market-beating on total return |\n| Attempts 115 and 116 | Publicly registered, future-only, zero outcomes as of ${artifact.evidence_as_of} | No performance claim |\n| Generation 7 census | 20 visible projects; 0 exact same-panel submitted-options comparators | Missing P&L is unknown; no matchup or rank |\n\nG4's ${percent(g4.g4_total_return, 2, true)} headline over ${g4.start_date}–${g4.end_date} with modeled ${g4.modeled_one_way_cost_bps} bp one-way costs cannot be presented as validation: the path was consumed and the candidate was selected after viewing history. Its ${percent(g4.deflated_sharpe_probability)} Deflated Sharpe probability missed the 95% gate, and its ${percent(g4.worst_familywise_adjusted_p_value)} worst familywise-adjusted p-value exceeded the 5% ceiling.\n\nProduction v1 is the frozen unlevered SPY/BIL policy targeting 10% annualized volatility. In the consumed ${v1.start_date}–${v1.end_date} modeled next-open study, at 5 bp per leg it recorded ${percent(v1.annualized_volatility_at_5bp)} modeled annualized volatility and a ${percent(v1.maximum_drawdown_at_5bp)} maximum drawdown, but its ${percent(v1.total_return_at_5bp_per_leg, 2, true)} total return remained below SPY's ${percent(v1.spy_total_return, 2, true)}. This is a theoretical adjusted-OHLC ledger, not a broker-fill replay or options P&L.\n\n## Exact allowed claims\n\n${allowed}\n\nThese sentences may be copied verbatim into the site, paper, deck, or video. If shortened, preserve the evidence class, historical window, cost basis, rejection or zero-outcome status, and the no-matchup boundary.\n\n## Exact forbidden claims\n\n${forbidden}\n\nDo not imply any of these claims through a chart, caption, title, voice-over, ordering, or omission of the stated qualifiers.\n\n## Registration and evidence-availability boundaries\n\nAttempts 115 and 116 have canonically validated public GitHub publication receipts and first eligible sessions after registration. Both remain future-only with **zero observed outcomes** as of ${artifact.evidence_as_of}. Their receipts establish a public platform record, not an independent cryptographic timestamp, market-data provenance, broker execution, or performance.\n\nThe Generation 7 registry records **20 visible projects** and **zero exact same-panel submitted-options comparators**. Missing P&L remains unknown, never zero; it supports neither a Finly win nor a financial rank. No project-level return figure belongs in this release gate.\n\n## Source integrity\n\n| Source | Frozen repository path | Raw-byte SHA-256 |\n|---|---|---|\n${sourceRows}\n\nAll seven sources are required. Missing files, byte drift, schema drift, protocol self-hash drift, or receipt validation failure stops the build. Artifact self-hash: \`${artifact.artifact_sha256}\`.\n`;
}

async function atomicWrite(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function writeQuantitativeReleaseGate({
  rootDir = projectRoot,
  outputRootDir = rootDir,
  registry = SOURCE_REGISTRY,
  outputPaths = OUTPUT_PATHS,
} = {}) {
  const built = await buildQuantitativeReleaseGate({ rootDir, registry });
  const json = canonicalQuantitativeReleaseGateJson(built.artifact);
  const jsonPath = resolveWithin(outputRootDir, outputPaths.json);
  const markdownPath = resolveWithin(outputRootDir, outputPaths.markdown);
  const publicJsonPath = outputPaths.public_json
    ? resolveWithin(outputRootDir, outputPaths.public_json)
    : null;
  await atomicWrite(jsonPath, json);
  await atomicWrite(markdownPath, built.markdown);
  if (publicJsonPath) await atomicWrite(publicJsonPath, json);
  return Object.freeze({
    json_path: jsonPath,
    markdown_path: markdownPath,
    public_json_path: publicJsonPath,
    json_raw_bytes_sha256: rawBytesSha256(Buffer.from(json, "utf8")),
    markdown_raw_bytes_sha256: rawBytesSha256(Buffer.from(built.markdown, "utf8")),
    artifact_sha256: built.artifact.artifact_sha256,
    release_status: built.artifact.release_decision.status,
  });
}

if (process.argv[1] === modulePath) {
  const result = await writeQuantitativeReleaseGate();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
