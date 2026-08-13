import type {
  RecommendationDatasetV6CandidateFeatures,
  RecommendationDatasetV6Split,
  RecommendationProDecisionDatasetV6Row,
} from './recommendation-pro-decision-dataset-v6';

export const RECOMMENDATION_PRO_DECISION_DATASET_V7_SCHEMA_VERSION = 1;
export const RECOMMENDATION_PRO_DECISION_DATASET_V7_VERSION =
  'RECOMMENDATION_PRO_DECISION_DATASET_V7_OBSERVABILITY_1' as const;
export const RECOMMENDATION_OBSERVABILITY_VERSION_V7 =
  'RECOMMENDATION_OBSERVABILITY_V7_STRICT_PREDECISION_1' as const;

export type RecommendationDatasetV7ObservedValue =
  | string
  | number
  | boolean
  | string[]
  | number[];

export type RecommendationDatasetV7ObservabilityFamily =
  | 'SPENDABLE_CURRENCY'
  | 'SHOP_OPPORTUNITY'
  | 'INVENTORY_LEGALITY'
  | 'RULESET_AVAILABILITY'
  | 'POSITION_OPPORTUNITY'
  | 'ALIVE_COMBAT_CONTEXT'
  | 'PURCHASE_TIMING_CONTEXT';

export interface RecommendationDatasetV7FieldObservation {
  fieldName: string;
  family: RecommendationDatasetV7ObservabilityFamily;
  value?: RecommendationDatasetV7ObservedValue;
  missing: boolean;
  sourceSystem: string;
  sourceEntity: string;
  sourceField: string;
  sourceGameTimeS?: number;
  alignmentAgeS?: number;
  directlyObserved: boolean;
  reconstructed: boolean;
  reconstructionContract?: string;
  provenanceVersion: string;
}

export type RecommendationDatasetV7FeasibilityReason =
  | 'AFFORDABLE'
  | 'INSUFFICIENT_CURRENCY'
  | 'SLOT_LEGAL'
  | 'SLOT_BLOCKED'
  | 'RECIPE_LEGAL'
  | 'RECIPE_BLOCKED'
  | 'RULESET_AVAILABLE'
  | 'RULESET_UNAVAILABLE'
  | 'SHOP_AVAILABLE'
  | 'SHOP_UNAVAILABLE'
  | 'UNKNOWN';

export interface RecommendationDatasetV7CandidateFeasibility {
  evaluated: boolean;
  feasible?: boolean;
  reasonCodes: RecommendationDatasetV7FeasibilityReason[];
  sourceFields: string[];
  observedOnly: boolean;
}

export interface RecommendationDatasetV7CandidateFeatures
  extends RecommendationDatasetV6CandidateFeatures {
  feasibility: RecommendationDatasetV7CandidateFeasibility;
}

export interface RecommendationDatasetV7ChoiceSetContract {
  coverageUniverseActionKeys: string[];
  behavioralChoiceSetActionKeys: string[];
  behavioralChoiceSetDefinition: string;
  observedActionInjected: false;
  selectedAfterObservedAction: false;
  feasibilityAware: boolean;
}

export interface RecommendationProDecisionDatasetV7Row
  extends Omit<
    RecommendationProDecisionDatasetV6Row,
    'schemaVersion' | 'datasetVersion' | 'candidates'
  > {
  schemaVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V7_SCHEMA_VERSION;
  datasetVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V7_VERSION;
  observabilityVersion: typeof RECOMMENDATION_OBSERVABILITY_VERSION_V7;
  sourceDatasetVersion: RecommendationProDecisionDatasetV6Row['datasetVersion'];
  sourceDecisionId: string;
  observability: RecommendationDatasetV7FieldObservation[];
  candidates: RecommendationDatasetV7CandidateFeatures[];
  choiceSet: RecommendationDatasetV7ChoiceSetContract;
}

export interface CreateRecommendationProDecisionDatasetV7RowInput {
  baseRow: RecommendationProDecisionDatasetV6Row;
  observations: readonly RecommendationDatasetV7FieldObservation[];
  candidateFeasibilityByActionKey?: ReadonlyMap<
    string,
    RecommendationDatasetV7CandidateFeasibility
  >;
  behavioralChoiceSetActionKeys?: readonly string[];
  behavioralChoiceSetDefinition?: string;
}

export interface RecommendationDatasetV7Audit {
  schemaVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V7_SCHEMA_VERSION;
  datasetVersion: typeof RECOMMENDATION_PRO_DECISION_DATASET_V7_VERSION;
  generatedAt: string;
  passed: boolean;
  decisionCount: number;
  matchCount: number;
  futureTestDecisionCount: number;
  observableDecisionCount: number;
  observableDecisionCoverage: number;
  feasibilityEvaluatedCandidateCount: number;
  candidateCount: number;
  feasibilityEvaluationCoverage: number;
  behavioralObservedActionCoverage: number;
  futureTimestampViolationCount: number;
  observedActionInjectionViolationCount: number;
  reasons: string[];
}

export function createRecommendationProDecisionDatasetV7Row(
  input: CreateRecommendationProDecisionDatasetV7RowInput,
): RecommendationProDecisionDatasetV7Row {
  validateBaseRow(input.baseRow);
  const observability = input.observations.map((observation) =>
    normalizeObservation(input.baseRow.state.gameTimeS, observation),
  );
  assertUniqueObservationNames(observability);

  const coverageUniverseActionKeys = input.baseRow.candidates.map(
    (candidate) => candidate.actionKey,
  );
  const allowedActionKeys = new Set(coverageUniverseActionKeys);
  const requestedBehavioral = input.behavioralChoiceSetActionKeys
    ? [...input.behavioralChoiceSetActionKeys]
    : [...coverageUniverseActionKeys];
  const behavioralChoiceSetActionKeys = deduplicate(requestedBehavioral);
  for (const actionKey of behavioralChoiceSetActionKeys) {
    if (!allowedActionKeys.has(actionKey)) {
      throw new Error(
        `Behavioral V7 choice set contains action outside coverage universe: ${actionKey}.`,
      );
    }
  }

  const candidates = input.baseRow.candidates.map((candidate) => ({
    ...clone(candidate),
    feasibility: normalizeFeasibility(
      input.candidateFeasibilityByActionKey?.get(candidate.actionKey),
    ),
  }));
  const feasibilityAware = candidates.some(
    (candidate) => candidate.feasibility.evaluated,
  );
  const base = clone(input.baseRow);

  return {
    ...base,
    schemaVersion: RECOMMENDATION_PRO_DECISION_DATASET_V7_SCHEMA_VERSION,
    datasetVersion: RECOMMENDATION_PRO_DECISION_DATASET_V7_VERSION,
    observabilityVersion: RECOMMENDATION_OBSERVABILITY_VERSION_V7,
    sourceDatasetVersion: input.baseRow.datasetVersion,
    sourceDecisionId: input.baseRow.decisionId,
    observability,
    candidates,
    choiceSet: {
      coverageUniverseActionKeys,
      behavioralChoiceSetActionKeys,
      behavioralChoiceSetDefinition:
        input.behavioralChoiceSetDefinition?.trim() ||
        'COVERAGE_UNIVERSE_UNFILTERED_PENDING_V7_STAGE_D',
      observedActionInjected: false,
      selectedAfterObservedAction: false,
      feasibilityAware,
    },
  };
}

export function buildRecommendationProDecisionDatasetV7Audit(
  rows: readonly RecommendationProDecisionDatasetV7Row[],
  generatedAt = new Date().toISOString(),
): RecommendationDatasetV7Audit {
  let futureTestDecisionCount = 0;
  let observableDecisionCount = 0;
  let candidateCount = 0;
  let feasibilityEvaluatedCandidateCount = 0;
  let behavioralObservedActionCount = 0;
  let futureTimestampViolationCount = 0;
  let observedActionInjectionViolationCount = 0;
  const matches = new Set<string>();

  for (const row of rows) {
    validateV7Row(row);
    matches.add(row.matchId);
    futureTestDecisionCount += row.split === 'FUTURE_TEST' ? 1 : 0;
    observableDecisionCount += row.observability.some(
      (observation) => !observation.missing,
    )
      ? 1
      : 0;
    candidateCount += row.candidates.length;
    feasibilityEvaluatedCandidateCount += row.candidates.filter(
      (candidate) => candidate.feasibility.evaluated,
    ).length;
    behavioralObservedActionCount += row.choiceSet.behavioralChoiceSetActionKeys.includes(
      row.observedActionKey,
    )
      ? 1
      : 0;
    futureTimestampViolationCount += row.observability.filter(
      (observation) =>
        observation.sourceGameTimeS !== undefined &&
        observation.sourceGameTimeS > row.state.gameTimeS,
    ).length;
    observedActionInjectionViolationCount +=
      row.choiceSet.observedActionInjected || row.choiceSet.selectedAfterObservedAction
        ? 1
        : 0;
  }

  const observableDecisionCoverage = ratio(observableDecisionCount, rows.length);
  const feasibilityEvaluationCoverage = ratio(
    feasibilityEvaluatedCandidateCount,
    candidateCount,
  );
  const behavioralObservedActionCoverage = ratio(
    behavioralObservedActionCount,
    rows.length,
  );
  const reasons: string[] = [];
  if (rows.length === 0) reasons.push('Dataset V7 contains no decisions.');
  if (futureTimestampViolationCount > 0) {
    reasons.push(
      'Dataset V7 contains observation timestamps after decision time.',
    );
  }
  if (observedActionInjectionViolationCount > 0) {
    reasons.push(
      'Dataset V7 contains observed-action-dependent choice-set construction.',
    );
  }

  return {
    schemaVersion: RECOMMENDATION_PRO_DECISION_DATASET_V7_SCHEMA_VERSION,
    datasetVersion: RECOMMENDATION_PRO_DECISION_DATASET_V7_VERSION,
    generatedAt,
    passed: reasons.length === 0,
    decisionCount: rows.length,
    matchCount: matches.size,
    futureTestDecisionCount,
    observableDecisionCount,
    observableDecisionCoverage,
    feasibilityEvaluatedCandidateCount,
    candidateCount,
    feasibilityEvaluationCoverage,
    behavioralObservedActionCoverage,
    futureTimestampViolationCount,
    observedActionInjectionViolationCount,
    reasons,
  };
}

export function isRecommendationDatasetV7TrainingSplit(
  split: RecommendationDatasetV6Split,
): boolean {
  return split === 'TRAIN' || split === 'TUNING';
}

function normalizeObservation(
  decisionGameTimeS: number,
  observation: RecommendationDatasetV7FieldObservation,
): RecommendationDatasetV7FieldObservation {
  if (!observation.fieldName.trim()) {
    throw new Error('V7 observation fieldName is required.');
  }
  if (
    !observation.sourceSystem.trim() ||
    !observation.sourceEntity.trim() ||
    !observation.sourceField.trim()
  ) {
    throw new Error(
      `V7 observation ${observation.fieldName} is missing source provenance.`,
    );
  }
  if (!observation.provenanceVersion.trim()) {
    throw new Error(
      `V7 observation ${observation.fieldName} is missing provenance version.`,
    );
  }
  if (observation.sourceGameTimeS !== undefined) {
    if (
      !Number.isFinite(observation.sourceGameTimeS) ||
      observation.sourceGameTimeS > decisionGameTimeS
    ) {
      throw new Error(
        `V7 observation ${observation.fieldName} has a future source timestamp.`,
      );
    }
  }
  if (observation.missing && observation.value !== undefined) {
    throw new Error(
      `V7 observation ${observation.fieldName} cannot be missing and have a value.`,
    );
  }
  if (!observation.missing && observation.value === undefined) {
    throw new Error(
      `V7 observation ${observation.fieldName} must contain a value or be marked missing.`,
    );
  }
  const sourceGameTimeS = observation.sourceGameTimeS;
  return {
    ...clone(observation),
    fieldName: observation.fieldName.trim(),
    sourceSystem: observation.sourceSystem.trim(),
    sourceEntity: observation.sourceEntity.trim(),
    sourceField: observation.sourceField.trim(),
    provenanceVersion: observation.provenanceVersion.trim(),
    ...(sourceGameTimeS === undefined
      ? {}
      : {
          sourceGameTimeS,
          alignmentAgeS: Math.max(0, decisionGameTimeS - sourceGameTimeS),
        }),
  };
}

function normalizeFeasibility(
  value?: RecommendationDatasetV7CandidateFeasibility,
): RecommendationDatasetV7CandidateFeasibility {
  if (!value) {
    return {
      evaluated: false,
      reasonCodes: ['UNKNOWN'],
      sourceFields: [],
      observedOnly: true,
    };
  }
  if (!value.observedOnly) {
    throw new Error(
      'Dataset V7 candidate feasibility must use observed pre-decision data only.',
    );
  }
  if (value.evaluated && value.feasible === undefined) {
    throw new Error(
      'Evaluated Dataset V7 feasibility must include feasible boolean.',
    );
  }
  return {
    evaluated: value.evaluated,
    ...(value.feasible === undefined ? {} : { feasible: value.feasible }),
    reasonCodes: deduplicate(value.reasonCodes),
    sourceFields: deduplicate(value.sourceFields),
    observedOnly: true,
  };
}

function validateBaseRow(row: RecommendationProDecisionDatasetV6Row): void {
  if (row.schemaVersion !== 1 || !row.decisionId.trim()) {
    throw new Error('Unsupported Dataset V6 source row for Dataset V7.');
  }
}

function validateV7Row(row: RecommendationProDecisionDatasetV7Row): void {
  if (
    row.schemaVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V7_SCHEMA_VERSION ||
    row.datasetVersion !== RECOMMENDATION_PRO_DECISION_DATASET_V7_VERSION ||
    row.observabilityVersion !== RECOMMENDATION_OBSERVABILITY_VERSION_V7
  ) {
    throw new Error('Unsupported Dataset V7 row.');
  }
}

function assertUniqueObservationNames(
  observations: readonly RecommendationDatasetV7FieldObservation[],
): void {
  const names = new Set<string>();
  for (const observation of observations) {
    if (names.has(observation.fieldName)) {
      throw new Error(
        `Duplicate Dataset V7 observation ${observation.fieldName}.`,
      );
    }
    names.add(observation.fieldName);
  }
}

function deduplicate<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
