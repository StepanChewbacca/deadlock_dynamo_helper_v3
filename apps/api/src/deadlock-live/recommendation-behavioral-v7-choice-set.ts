import type { RecommendationProDecisionDatasetV7Row } from './recommendation-pro-decision-dataset-v7';

export const RECOMMENDATION_BEHAVIORAL_V7_CHOICE_SET_VERSION =
  'V7_OBSERVED_AVAILABILITY_TOP96_1' as const;
export const RECOMMENDATION_BEHAVIORAL_V7_MAX_CANDIDATES = 96;

export interface RecommendationBehavioralV7ChoiceSetResult {
  definition: typeof RECOMMENDATION_BEHAVIORAL_V7_CHOICE_SET_VERSION;
  actionKeys: string[];
  coverageUniverseCount: number;
  selectedCount: number;
  availabilityEvaluatedCount: number;
  unavailableCount: number;
  unknownCount: number;
  observedAvailabilityUsed: boolean;
  observedActionInjected: false;
  selectedAfterObservedAction: false;
}

export function buildRecommendationBehavioralV7ChoiceSet(
  row: Pick<RecommendationProDecisionDatasetV7Row, 'candidates'>,
): RecommendationBehavioralV7ChoiceSetResult {
  const ordered = [...row.candidates].sort(
    (left, right) =>
      left.rank - right.rank ||
      right.generatorScore - left.generatorScore ||
      left.actionKey.localeCompare(right.actionKey),
  );
  const availabilityEvaluatedCount = ordered.filter(
    (candidate) => candidate.feasibility.evaluated,
  ).length;
  const unavailableCount = ordered.filter(
    (candidate) =>
      candidate.feasibility.evaluated &&
      candidate.feasibility.feasible === false,
  ).length;
  const unknownCount = ordered.length - availabilityEvaluatedCount;
  const selected = ordered
    .filter(
      (candidate) =>
        !candidate.feasibility.evaluated ||
        candidate.feasibility.feasible === true,
    )
    .slice(0, RECOMMENDATION_BEHAVIORAL_V7_MAX_CANDIDATES);

  return {
    definition: RECOMMENDATION_BEHAVIORAL_V7_CHOICE_SET_VERSION,
    actionKeys: selected.map((candidate) => candidate.actionKey),
    coverageUniverseCount: ordered.length,
    selectedCount: selected.length,
    availabilityEvaluatedCount,
    unavailableCount,
    unknownCount,
    observedAvailabilityUsed: availabilityEvaluatedCount > 0,
    observedActionInjected: false,
    selectedAfterObservedAction: false,
  };
}
