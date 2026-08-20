import { RecommendationDatasetCandidateV1 } from './recommendation-action-domain';

export const RECOMMENDATION_DATASET_V8_CONTRACT = 'RECOMMENDATION_DATASET_V8' as const;

export type RecommendationDatasetSplitV8 = 'TRAIN' | 'TUNING' | 'FUTURE_TEST';

export interface RecommendationObservedActionV8 {
  actionKey: string;
  occurredAtMs: number;
  source: string;
}

export interface BuildRecommendationDatasetDecisionV8Input {
  decisionId: string;
  matchId: string;
  playerKey: string;
  heroId: number;
  decisionAtMs: number;
  gameTimeSec: number;
  latestStateSourceAtMs: number;
  rulesetId: string;
  catalogSha256: string;
  candidateGeneratorVersion: string;
  split: RecommendationDatasetSplitV8;
  candidates: readonly RecommendationDatasetCandidateV1[];
  observedAction?: RecommendationObservedActionV8;
  cohortKeys?: readonly string[];
}

export interface RecommendationDatasetDecisionV8 {
  schemaVersion: 8;
  contract: typeof RECOMMENDATION_DATASET_V8_CONTRACT;
  decisionId: string;
  matchId: string;
  playerKey: string;
  heroId: number;
  decisionAtMs: number;
  gameTimeSec: number;
  latestStateSourceAtMs: number;
  rulesetId: string;
  catalogSha256: string;
  candidateGeneratorVersion: string;
  split: RecommendationDatasetSplitV8;
  candidates: readonly RecommendationDatasetCandidateV1[];
  coverageUniverseActionKeys: readonly string[];
  behavioralChoiceSetActionKeys: readonly string[];
  observedAction?: RecommendationObservedActionV8;
  observedActionInCoverageUniverse?: boolean;
  observedActionInBehavioralChoiceSet?: boolean;
  observedActionInjected: false;
  cohortKeys: readonly string[];
}

export interface RecommendationDatasetAuditOptionsV8 {
  candidateCoverageFloor?: number;
  majorCohortCoverageFloor?: number;
  majorCohortMinDecisions?: number;
  evaluateFutureTest?: boolean;
}

export interface RecommendationDatasetCohortAuditV8 {
  cohortKey: string;
  labeledDecisionCount: number;
  coveredDecisionCount: number;
  coverage: number;
  major: boolean;
  passed: boolean;
}

export interface RecommendationDatasetAuditV8 {
  passed: boolean;
  decisionCount: number;
  labeledDecisionCount: number;
  coveredDecisionCount: number;
  candidateCoverage: number;
  futureTestDecisionCount: number;
  futureTestEvaluated: boolean;
  splitMatchCounts: Record<RecommendationDatasetSplitV8, number>;
  cohortAudits: readonly RecommendationDatasetCohortAuditV8[];
  errors: readonly string[];
}

export function buildRecommendationDatasetDecisionV8(
  input: BuildRecommendationDatasetDecisionV8Input,
): RecommendationDatasetDecisionV8 {
  validateDecisionInput(input);
  const candidates = [...input.candidates].sort((a, b) => a.actionId.localeCompare(b.actionId));
  const coverageUniverseActionKeys = candidates.map((candidate) => candidate.actionId);
  const behavioralChoiceSetActionKeys = candidates
    .filter((candidate) => candidate.feasible)
    .map((candidate) => candidate.actionId);
  const observedActionKey = input.observedAction?.actionKey;

  return {
    schemaVersion: 8,
    contract: RECOMMENDATION_DATASET_V8_CONTRACT,
    decisionId: input.decisionId,
    matchId: input.matchId,
    playerKey: input.playerKey,
    heroId: input.heroId,
    decisionAtMs: input.decisionAtMs,
    gameTimeSec: input.gameTimeSec,
    latestStateSourceAtMs: input.latestStateSourceAtMs,
    rulesetId: input.rulesetId,
    catalogSha256: input.catalogSha256,
    candidateGeneratorVersion: input.candidateGeneratorVersion,
    split: input.split,
    candidates,
    coverageUniverseActionKeys,
    behavioralChoiceSetActionKeys,
    observedAction: input.observedAction,
    observedActionInCoverageUniverse: observedActionKey === undefined
      ? undefined
      : coverageUniverseActionKeys.includes(observedActionKey),
    observedActionInBehavioralChoiceSet: observedActionKey === undefined
      ? undefined
      : behavioralChoiceSetActionKeys.includes(observedActionKey),
    observedActionInjected: false,
    cohortKeys: [...new Set(input.cohortKeys ?? [])].sort(),
  };
}

export function auditRecommendationDatasetV8(
  rows: readonly RecommendationDatasetDecisionV8[],
  options: RecommendationDatasetAuditOptionsV8 = {},
): RecommendationDatasetAuditV8 {
  const candidateCoverageFloor = options.candidateCoverageFloor ?? 0.99;
  const majorCohortCoverageFloor = options.majorCohortCoverageFloor ?? 0.95;
  const majorCohortMinDecisions = options.majorCohortMinDecisions ?? 100;
  const evaluateFutureTest = options.evaluateFutureTest ?? false;
  const errors: string[] = [];
  const decisionIds = new Set<string>();
  const splitByMatch = new Map<string, RecommendationDatasetSplitV8>();
  const matchesBySplit: Record<RecommendationDatasetSplitV8, Set<string>> = {
    TRAIN: new Set(),
    TUNING: new Set(),
    FUTURE_TEST: new Set(),
  };

  const evaluatedRows: RecommendationDatasetDecisionV8[] = [];
  for (const row of rows) {
    if (row.schemaVersion !== 8 || row.contract !== RECOMMENDATION_DATASET_V8_CONTRACT) {
      errors.push(`CONTRACT_MISMATCH:${row.decisionId}`);
    }
    if (decisionIds.has(row.decisionId)) errors.push(`DUPLICATE_DECISION_ID:${row.decisionId}`);
    decisionIds.add(row.decisionId);
    if (row.observedActionInjected !== false) errors.push(`OBSERVED_ACTION_INJECTION:${row.decisionId}`);
    if (row.latestStateSourceAtMs > row.decisionAtMs) errors.push(`FUTURE_STATE_TIMESTAMP:${row.decisionId}`);
    if (!isSha256(row.catalogSha256)) errors.push(`CATALOG_SHA_INVALID:${row.decisionId}`);
    if (!row.rulesetId) errors.push(`RULESET_ID_REQUIRED:${row.decisionId}`);
    if (!row.candidateGeneratorVersion) errors.push(`CANDIDATE_GENERATOR_VERSION_REQUIRED:${row.decisionId}`);

    const existingSplit = splitByMatch.get(row.matchId);
    if (existingSplit && existingSplit !== row.split) errors.push(`MATCH_SPLIT_LEAKAGE:${row.matchId}`);
    else splitByMatch.set(row.matchId, row.split);
    matchesBySplit[row.split].add(row.matchId);

    const candidateKeys = row.candidates.map((candidate) => candidate.actionId);
    if (new Set(candidateKeys).size !== candidateKeys.length) errors.push(`DUPLICATE_CANDIDATE:${row.decisionId}`);
    const feasibleKeys = row.candidates.filter((candidate) => candidate.feasible).map((candidate) => candidate.actionId);
    if (!sameStringSet(row.coverageUniverseActionKeys, candidateKeys)) errors.push(`COVERAGE_UNIVERSE_MISMATCH:${row.decisionId}`);
    if (!sameStringSet(row.behavioralChoiceSetActionKeys, feasibleKeys)) errors.push(`BEHAVIORAL_CHOICE_SET_MISMATCH:${row.decisionId}`);
    if (row.candidates.some((candidate) => candidate.observedActionInjected !== false)) {
      errors.push(`CANDIDATE_OBSERVED_ACTION_INJECTION:${row.decisionId}`);
    }

    if (row.observedAction) {
      if (row.observedAction.occurredAtMs < row.decisionAtMs) errors.push(`OBSERVED_ACTION_BEFORE_DECISION:${row.decisionId}`);
      const inCoverage = candidateKeys.includes(row.observedAction.actionKey);
      const inBehavioral = feasibleKeys.includes(row.observedAction.actionKey);
      if (row.observedActionInCoverageUniverse !== inCoverage) errors.push(`OBSERVED_COVERAGE_FLAG_MISMATCH:${row.decisionId}`);
      if (row.observedActionInBehavioralChoiceSet !== inBehavioral) errors.push(`OBSERVED_BEHAVIOR_FLAG_MISMATCH:${row.decisionId}`);
    }

    if (evaluateFutureTest || row.split !== 'FUTURE_TEST') evaluatedRows.push(row);
  }

  const labeled = evaluatedRows.filter((row) => row.observedAction !== undefined);
  const covered = labeled.filter((row) => row.observedActionInBehavioralChoiceSet === true);
  const candidateCoverage = ratio(covered.length, labeled.length);
  if (labeled.length > 0 && candidateCoverage < candidateCoverageFloor) {
    errors.push(`CANDIDATE_COVERAGE_BELOW_FLOOR:${candidateCoverage.toFixed(6)}<${candidateCoverageFloor}`);
  }

  const cohortMap = new Map<string, RecommendationDatasetDecisionV8[]>();
  for (const row of labeled) {
    for (const cohortKey of row.cohortKeys) {
      const cohortRows = cohortMap.get(cohortKey) ?? [];
      cohortRows.push(row);
      cohortMap.set(cohortKey, cohortRows);
    }
  }
  const cohortAudits = [...cohortMap.entries()]
    .map(([cohortKey, cohortRows]) => {
      const coveredCount = cohortRows.filter((row) => row.observedActionInBehavioralChoiceSet === true).length;
      const coverage = ratio(coveredCount, cohortRows.length);
      const major = cohortRows.length >= majorCohortMinDecisions;
      const passed = !major || coverage >= majorCohortCoverageFloor;
      if (!passed) errors.push(`MAJOR_COHORT_COVERAGE_BELOW_FLOOR:${cohortKey}:${coverage.toFixed(6)}`);
      return {
        cohortKey,
        labeledDecisionCount: cohortRows.length,
        coveredDecisionCount: coveredCount,
        coverage,
        major,
        passed,
      };
    })
    .sort((a, b) => a.cohortKey.localeCompare(b.cohortKey));

  return {
    passed: errors.length === 0,
    decisionCount: rows.length,
    labeledDecisionCount: labeled.length,
    coveredDecisionCount: covered.length,
    candidateCoverage,
    futureTestDecisionCount: rows.filter((row) => row.split === 'FUTURE_TEST').length,
    futureTestEvaluated: evaluateFutureTest,
    splitMatchCounts: {
      TRAIN: matchesBySplit.TRAIN.size,
      TUNING: matchesBySplit.TUNING.size,
      FUTURE_TEST: matchesBySplit.FUTURE_TEST.size,
    },
    cohortAudits,
    errors: [...new Set(errors)].sort(),
  };
}

function validateDecisionInput(input: BuildRecommendationDatasetDecisionV8Input): void {
  if (!input.decisionId) throw new Error('decisionId is required');
  if (!input.matchId) throw new Error('matchId is required');
  if (!input.playerKey) throw new Error('playerKey is required');
  if (!Number.isFinite(input.decisionAtMs)) throw new Error('decisionAtMs is invalid');
  if (!Number.isFinite(input.latestStateSourceAtMs)) throw new Error('latestStateSourceAtMs is invalid');
  if (input.latestStateSourceAtMs > input.decisionAtMs) throw new Error('State source timestamp cannot be after decision timestamp');
  if (!isSha256(input.catalogSha256)) throw new Error('catalogSha256 must be a SHA-256 hex string');
  for (const candidate of input.candidates) {
    if (candidate.decisionId !== input.decisionId) throw new Error(`Candidate ${candidate.actionId} decisionId mismatch`);
    if (candidate.matchId !== input.matchId) throw new Error(`Candidate ${candidate.actionId} matchId mismatch`);
    if (candidate.rulesetId !== input.rulesetId) throw new Error(`Candidate ${candidate.actionId} rulesetId mismatch`);
    if (candidate.observedActionInjected !== false) throw new Error(`Candidate ${candidate.actionId} violates observed-action injection invariant`);
  }
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
