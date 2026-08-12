import {
  createRecommendationBehavioralV6Model,
  createRecommendationBehavioralV6OptimizerAudit,
  predictRecommendationBehavioralV6,
  recommendationBehavioralV6FoldId,
  recommendationBehavioralV6OptimizerAuditSummary,
  RECOMMENDATION_BEHAVIORAL_V6_MODEL_VERSION,
  RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT,
  RECOMMENDATION_BEHAVIORAL_V6_PROBABILITY_CONTRACT,
  trainRecommendationBehavioralV6Decision,
  validateRecommendationBehavioralV6Model,
} from '../src/deadlock-live/recommendation-behavioral-v6';
import type { RecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

const BASE_CONFIG = {
  linearHashDimension: 65_536,
  embeddingHashDimension: 4_096,
  latentDimension: 8,
} as const;

describe('Recommendation Behavioral V6 core', () => {
  it('uses the new raw-propensity aggregated-optimizer contract', () => {
    const model = createRecommendationBehavioralV6Model({
      ...BASE_CONFIG,
      architecture: 'LINEAR_PLUS_TOWER',
    });

    validateRecommendationBehavioralV6Model(model);
    expect(model.modelVersion).toBe(RECOMMENDATION_BEHAVIORAL_V6_MODEL_VERSION);
    expect(model.probabilityContract).toBe(
      RECOMMENDATION_BEHAVIORAL_V6_PROBABILITY_CONTRACT,
    );
    expect(model.optimizerContract).toBe(
      RECOMMENDATION_BEHAVIORAL_V6_OPTIMIZER_CONTRACT,
    );
  });

  it.each([2, 50, 96, 139, 200])(
    'keeps raw softmax normalized for %i candidates',
    (candidateCount) => {
      const model = createRecommendationBehavioralV6Model({
        ...BASE_CONFIG,
        architecture: 'LINEAR_ONLY',
      });
      const prediction = predictRecommendationBehavioralV6(
        model,
        rowWithCandidateCount(candidateCount),
      );

      expect(prediction.candidates).toHaveLength(candidateCount);
      expect(
        prediction.candidates.reduce(
          (sum, candidate) => sum + candidate.probability,
          0,
        ),
      ).toBeCloseTo(1, 12);
      expect(prediction.observedActionProbability).toBeCloseTo(
        1 / candidateCount,
        12,
      );
    },
  );

  it('aggregates repeated linear touches before one parameter update', () => {
    const model = createRecommendationBehavioralV6Model({
      architecture: 'LINEAR_ONLY',
      linearHashDimension: 256,
      embeddingHashDimension: 128,
      latentDimension: 2,
    });
    const audit = createRecommendationBehavioralV6OptimizerAudit();

    trainRecommendationBehavioralV6Decision(
      model,
      rowWithCandidateCount(96),
      { learningRate: 0.1, l2: 0.0001 },
      audit,
    );
    const summary = recommendationBehavioralV6OptimizerAuditSummary(audit);

    expect(summary.decisionCount).toBe(1);
    expect(summary.linearRawTouches).toBeGreaterThan(
      summary.linearUniqueParameterUpdates,
    );
    expect(summary.linearRepeatedTouchRate).toBeGreaterThan(0);
    expect(summary.contextRawTouches).toBe(0);
    expect(summary.candidateRawTouches).toBe(0);
    expect(model.updateCount).toBe(1);
  });

  it('keeps linear capacity identical while tower behavior is optional', () => {
    const linear = createRecommendationBehavioralV6Model({
      ...BASE_CONFIG,
      architecture: 'LINEAR_ONLY',
    });
    const tower = createRecommendationBehavioralV6Model({
      ...BASE_CONFIG,
      architecture: 'LINEAR_PLUS_TOWER',
    });
    const value = row();

    expect(linear.linearHashDimension).toBe(65_536);
    expect(tower.linearHashDimension).toBe(65_536);
    expect(linear.linearWeights).toHaveLength(tower.linearWeights.length);

    const linearAudit = createRecommendationBehavioralV6OptimizerAudit();
    const towerAudit = createRecommendationBehavioralV6OptimizerAudit();
    for (let index = 0; index < 100; index += 1) {
      trainRecommendationBehavioralV6Decision(
        linear,
        value,
        { learningRate: 0.15, l2: 0.0001 },
        linearAudit,
      );
      trainRecommendationBehavioralV6Decision(
        tower,
        value,
        { learningRate: 0.15, l2: 0.0001 },
        towerAudit,
      );
    }

    const linearPrediction = predictRecommendationBehavioralV6(linear, value);
    const towerPrediction = predictRecommendationBehavioralV6(tower, value);
    const towerObserved = towerPrediction.candidates.find(
      (candidate) => candidate.actionKey === value.observedActionKey,
    );

    expect(linearPrediction.topActionKey).toBe(value.observedActionKey);
    expect(towerPrediction.topActionKey).toBe(value.observedActionKey);
    expect(
      linearPrediction.candidates.every(
        (candidate) => candidate.interactionScore === 0,
      ),
    ).toBe(true);
    expect(Math.abs(towerObserved?.interactionScore ?? 0)).toBeGreaterThan(1e-8);
    expect(towerAudit.candidateRawTouches).toBeGreaterThan(0);
  });

  it('keeps MATCH-level folds deterministic', () => {
    const value = recommendationBehavioralV6FoldId('match-1', 5);
    expect(value).toBe(recommendationBehavioralV6FoldId('match-1', 5));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(5);
  });
});

function rowWithCandidateCount(
  candidateCount: number,
): RecommendationProDecisionDatasetV6Row {
  const value = row();
  const template = value.candidates[0];
  value.candidates = Array.from({ length: candidateCount }, (_, index) => {
    const itemId = 1002 + index;
    return {
      ...template,
      actionKey: `BUY:${itemId}`,
      itemId,
      rank: index + 1,
      generatorScore: 1 / candidateCount,
      historicalCount: candidateCount,
      historicalProbability: 1 / candidateCount,
      predictedStateKey: `1001x1|${itemId}x1`,
      componentItemIds: [],
      tags: [],
    };
  });
  value.observedActionKey = value.candidates[0].actionKey;
  return value;
}

function row(): RecommendationProDecisionDatasetV6Row {
  return {
    schemaVersion: 1,
    datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
    dataSource: 'PRO_HISTORICAL',
    decisionSource: 'HISTORICAL_REPLAY',
    decisionId: 'decision-1',
    matchId: 'match-1',
    matchStartTime: '2026-07-01T00:00:00.000Z',
    playerId: 'player-1',
    split: 'TRAIN',
    state: {
      heroId: 1,
      team: 0,
      phase: 'EARLY',
      gameTimeS: 600,
      inventoryStateKey: '1001x1',
      inventoryItemCounts: [{ itemId: 1001, count: 1 }],
      previousActionKeys: ['BUY:1001'],
      alliedHeroIds: [1, 2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      inventoryTagCounts: { COMPONENT: 1 },
      timelineJoined: true,
      timelineSnapshotLagS: 5,
      kills: 2,
      deaths: 1,
      assists: 4,
      netWorth: 5_000,
      heroDamage: 3_500,
      health: 900,
      maxHealth: 1_200,
      level: 8,
    },
    candidates: [
      {
        actionKey: 'BUY:1002',
        actionType: 'BUY',
        itemId: 1002,
        rank: 1,
        generatorScore: 0.6,
        historicalCount: 12,
        historicalProbability: 0.6,
        confidence: 0.8,
        predictedStateKey: '1001x1|1002x1',
        catalogMetadataAvailable: true,
        cost: 1_250,
        tier: 2,
        slotType: 'WEAPON',
        itemType: 'UPGRADE',
        isActiveItem: false,
        tags: ['DAMAGE'],
        componentItemIds: [1001],
        requiredComponentCount: 1,
        ownedComponentCount: 1,
        missingComponentCount: 0,
        hasAnyOwnedComponent: true,
        hasCompleteRecipeComponents: true,
        alreadyOwnedCount: 0,
        sameSlotOwnedItemCount: 1,
        inventoryTagOverlapCount: 0,
        previousActionCount: 0,
        currentNetWorth: 5_000,
        costToNetWorthRatio: 0.25,
      },
      {
        actionKey: 'BUY:1003',
        actionType: 'BUY',
        itemId: 1003,
        rank: 2,
        generatorScore: 0.4,
        historicalCount: 8,
        historicalProbability: 0.4,
        confidence: 0.7,
        predictedStateKey: '1001x1|1003x1',
        catalogMetadataAvailable: true,
        cost: 1_250,
        tier: 2,
        slotType: 'VITALITY',
        itemType: 'UPGRADE',
        isActiveItem: true,
        activationType: 'INSTANT',
        tags: ['VITALITY'],
        componentItemIds: [],
        requiredComponentCount: 0,
        ownedComponentCount: 0,
        missingComponentCount: 0,
        hasAnyOwnedComponent: false,
        hasCompleteRecipeComponents: false,
        alreadyOwnedCount: 0,
        sameSlotOwnedItemCount: 0,
        inventoryTagOverlapCount: 0,
        previousActionCount: 0,
        currentNetWorth: 5_000,
        costToNetWorthRatio: 0.25,
      },
    ],
    observedActionKey: 'BUY:1002',
    observedActionInCandidateSet: true,
    shortHorizonOutcomes: {
      threeMinutes: 0.1,
      fiveMinutes: 0.2,
      tenMinutes: 0.3,
    },
    finalOutcome: 1,
    versions: {
      catalog: 'catalog-1',
      catalogSha256: 'a'.repeat(64),
      candidateGenerator: 'generator-1',
      candidateGeneratorPolicy: 'policy-1',
      candidateGeneratorPolicySha256: 'b'.repeat(64),
      stateFeatures: 'RECOMMENDATION_STATE_FEATURES_V6_2_FUTURE_TIMELINE_FALLBACK',
      replay: 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_2',
    },
    eligibility: {
      stateModel: true,
      behavioralModel: true,
      actionModel: true,
      exclusionReasons: [],
    },
  };
}
