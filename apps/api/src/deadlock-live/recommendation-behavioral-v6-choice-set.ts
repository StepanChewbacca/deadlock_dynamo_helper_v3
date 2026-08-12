import type { HeroBuildDecisionDatasetV3Row } from './hero-build-decision-dataset-v3.service';
import {
  parseInventoryStateKey,
  recommendFromPolicy,
  type HeroBuildRecommendationOptions,
} from './hero-build-recommendation.service';
import {
  candidateActionsFromRecommendationResponse,
  type RecommendationFrozenCandidateGeneratorSnapshot,
  type RecommendationHistoricalCandidateInput,
} from './recommendation-historical-pro-replay';
import type {
  RecommendationCandidateGeneratorSnapshotArtifact,
  RecommendationPreparedHeroBuildPolicy,
} from './recommendation-candidate-generator-snapshot';

export const RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_VERSION =
  'RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_PROVENANCE_1' as const;

export type RecommendationBehavioralV6CandidateSource =
  | 'PRIMARY_STATE'
  | 'HERO_SUPPORT_UNION';

export interface RecommendationBehavioralV6CandidateProvenance {
  candidate: RecommendationHistoricalCandidateInput;
  sources: RecommendationBehavioralV6CandidateSource[];
  primaryRank?: number;
  supportRank?: number;
  supportUnionOnly: boolean;
}

export interface RecommendationBehavioralV6ChoiceSetProvenance {
  version: typeof RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_VERSION;
  primaryCandidates: RecommendationHistoricalCandidateInput[];
  supportCandidates: RecommendationHistoricalCandidateInput[];
  mergedCandidates: RecommendationBehavioralV6CandidateProvenance[];
}

export function generateRecommendationBehavioralV6ChoiceSetProvenance(input: {
  decision: HeroBuildDecisionDatasetV3Row;
  snapshot: RecommendationFrozenCandidateGeneratorSnapshot;
  generatorOptions: HeroBuildRecommendationOptions;
  catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];
  policy?: RecommendationPreparedHeroBuildPolicy;
  componentsByParent?: ReadonlyMap<number, number[]>;
  historicalCandidateLimit?: number;
}): RecommendationBehavioralV6ChoiceSetProvenance {
  const matchTime = requiredTimestamp(
    input.decision.matchStartTime,
    'decision.matchStartTime',
  );
  const trainingEnd = requiredTimestamp(
    input.snapshot.trainingWindowEnd,
    'trainingWindowEnd',
  );
  if (trainingEnd >= matchTime) {
    throw new Error(
      'Candidate generator snapshot training window must end before the replay match.',
    );
  }
  if (!input.policy) {
    return {
      version: RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_VERSION,
      primaryCandidates: [],
      supportCandidates: [],
      mergedCandidates: [],
    };
  }
  if (input.policy.heroId !== input.decision.heroId) {
    throw new Error('Prepared candidate policy hero does not match the replay decision.');
  }

  const inventory = parseInventoryStateKey(
    input.decision.inventoryBeforeStateKey,
  );
  if (!inventory) {
    throw new Error(
      `Invalid replay inventory state ${input.decision.inventoryBeforeStateKey}.`,
    );
  }
  const itemIds = [...inventory.entries()].flatMap(([itemId, count]) =>
    Array.from({ length: count }, () => itemId),
  );
  const componentsByParent =
    input.componentsByParent ??
    new Map<number, number[]>(
      input.catalog.items.map((item) => [
        item.itemId,
        [...item.componentItemIds],
      ]),
    );
  const historicalCandidateLimit = normalizeHistoricalCandidateLimit(
    input.historicalCandidateLimit ?? Math.max(input.generatorOptions.limit, 256),
  );
  const request = {
    heroId: input.decision.heroId,
    itemIds,
    gameTimeS: input.decision.gameTimeS,
    limit: historicalCandidateLimit,
  };
  const recipeResolver = (parentItemId: number): readonly number[] =>
    componentsByParent.get(parentItemId) ?? [];

  const primaryResponse = recommendFromPolicy(
    request,
    input.decision.inventoryBeforeStateKey,
    input.policy.policy,
    input.policy.parsedStates,
    recipeResolver,
    normalizeGeneratorOptions(input.generatorOptions),
  );
  const supportResponse = recommendFromPolicy(
    request,
    input.decision.inventoryBeforeStateKey,
    input.policy.supportPolicy,
    input.policy.supportParsedStates,
    recipeResolver,
    {
      minExactObservations: 1,
      maxBackoffDistance: 64,
      maxBackoffStates: 1,
      limit: historicalCandidateLimit,
    },
  );

  const primaryCandidates = candidateActionsFromRecommendationResponse(
    primaryResponse,
  ).slice(0, historicalCandidateLimit);
  const supportCandidates = candidateActionsFromRecommendationResponse(
    supportResponse,
  ).slice(0, historicalCandidateLimit);

  return {
    version: RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_VERSION,
    primaryCandidates,
    supportCandidates,
    mergedCandidates: mergeWithProvenance(
      primaryCandidates,
      supportCandidates,
      historicalCandidateLimit,
    ),
  };
}

function mergeWithProvenance(
  primary: readonly RecommendationHistoricalCandidateInput[],
  support: readonly RecommendationHistoricalCandidateInput[],
  limit: number,
): RecommendationBehavioralV6CandidateProvenance[] {
  const unique = new Map<string, RecommendationBehavioralV6CandidateProvenance>();

  for (const [index, candidate] of primary.entries()) {
    if (unique.size >= limit) {
      break;
    }
    unique.set(candidate.actionKey, {
      candidate: { ...candidate, rank: unique.size + 1 },
      sources: ['PRIMARY_STATE'],
      primaryRank: index + 1,
      supportUnionOnly: false,
    });
  }

  for (const [index, candidate] of support.entries()) {
    const existing = unique.get(candidate.actionKey);
    if (existing) {
      existing.sources = [...existing.sources, 'HERO_SUPPORT_UNION'];
      existing.supportRank = index + 1;
      continue;
    }
    if (unique.size >= limit) {
      break;
    }
    unique.set(candidate.actionKey, {
      candidate: { ...candidate, rank: unique.size + 1 },
      sources: ['HERO_SUPPORT_UNION'],
      supportRank: index + 1,
      supportUnionOnly: true,
    });
  }

  return [...unique.values()];
}

function normalizeGeneratorOptions(
  value: HeroBuildRecommendationOptions,
): HeroBuildRecommendationOptions {
  return {
    minExactObservations: value.minExactObservations,
    maxBackoffDistance: value.maxBackoffDistance,
    maxBackoffStates: value.maxBackoffStates,
    limit: value.limit,
  };
}

function normalizeHistoricalCandidateLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 2 || value > 512) {
    throw new Error(
      'historicalCandidateLimit must be a safe integer between 2 and 512.',
    );
  }
  return value;
}

function requiredTimestamp(value: string, name: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new Error(`${name} must be an ISO timestamp.`);
  }
  return result;
}
