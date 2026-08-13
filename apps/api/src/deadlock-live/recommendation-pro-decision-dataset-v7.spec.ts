import {
  buildRecommendationProDecisionDatasetV7Audit,
  createRecommendationProDecisionDatasetV7Row,
} from './recommendation-pro-decision-dataset-v7';
import type { RecommendationProDecisionDatasetV6Row } from './recommendation-pro-decision-dataset-v6';

const baseRow = (): RecommendationProDecisionDatasetV6Row => ({
  schemaVersion: 1,
  datasetVersion: 'RECOMMENDATION_PRO_DECISION_DATASET_V6_2',
  dataSource: 'PRO_HISTORICAL',
  decisionSource: 'HISTORICAL_REPLAY',
  decisionId: 'd1',
  matchId: 'm1',
  matchStartTime: '2026-01-01T00:00:00.000Z',
  playerId: 'p1',
  split: 'TRAIN',
  state: {
    heroId: 1,
    team: 0,
    phase: 'MID',
    gameTimeS: 600,
    inventoryStateKey: '100:1',
    inventoryItemCounts: [{ itemId: 100, count: 1 }],
    previousActionKeys: [],
    alliedHeroIds: [],
    enemyHeroIds: [],
    inventoryTagCounts: {},
    timelineJoined: true,
  },
  candidates: [candidate('BUY:101', 101, 1), candidate('BUY:102', 102, 2)],
  observedActionKey: 'BUY:101',
  observedActionInCandidateSet: true,
  shortHorizonOutcomes: {},
  finalOutcome: 1,
  versions: {
    catalog: 'c1',
    catalogSha256: 'a'.repeat(64),
    candidateGenerator: 'g1',
    candidateGeneratorPolicy: 'p1',
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
});

function candidate(actionKey: string, itemId: number, rank: number) {
  return {
    actionKey,
    actionType: 'BUY' as const,
    itemId,
    rank,
    generatorScore: 1,
    historicalCount: 1,
    historicalProbability: 0.5,
    confidence: 1,
    predictedStateKey: actionKey,
    catalogMetadataAvailable: true,
    tags: [],
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
  };
}

function shopObservation(sourceGameTimeS = 598) {
  return {
    fieldName: 'shopAvailable',
    family: 'SHOP_OPPORTUNITY' as const,
    value: true,
    missing: false,
    sourceSystem: 'TELEMETRY_V7',
    sourceEntity: 'decision_observability',
    sourceField: 'shopAvailable',
    sourceGameTimeS,
    directlyObserved: true,
    reconstructed: false,
    provenanceVersion: 'OBSERVABILITY_V7_1',
  };
}

describe('Recommendation Dataset V7', () => {
  it('records strict pre-decision observability and separate choice sets', () => {
    const row = createRecommendationProDecisionDatasetV7Row({
      baseRow: baseRow(),
      observations: [shopObservation()],
      behavioralChoiceSetActionKeys: ['BUY:101'],
      behavioralChoiceSetDefinition: 'V7_FEASIBLE_ONLY',
    });
    expect(row.observability[0].alignmentAgeS).toBe(2);
    expect(row.choiceSet.coverageUniverseActionKeys).toHaveLength(2);
    expect(row.choiceSet.behavioralChoiceSetActionKeys).toEqual(['BUY:101']);
    expect(row.choiceSet.observedActionInjected).toBe(false);
  });

  it('rejects future source timestamps', () => {
    expect(() =>
      createRecommendationProDecisionDatasetV7Row({
        baseRow: baseRow(),
        observations: [shopObservation(601)],
      }),
    ).toThrow('future source timestamp');
  });

  it('rejects behavioral actions outside the coverage universe', () => {
    expect(() =>
      createRecommendationProDecisionDatasetV7Row({
        baseRow: baseRow(),
        observations: [],
        behavioralChoiceSetActionKeys: ['BUY:999'],
      }),
    ).toThrow('outside coverage universe');
  });

  it('audits the resulting dataset without FUTURE_TEST selection', () => {
    const row = createRecommendationProDecisionDatasetV7Row({
      baseRow: baseRow(),
      observations: [shopObservation()],
    });
    const audit = buildRecommendationProDecisionDatasetV7Audit([row]);
    expect(audit.passed).toBe(true);
    expect(audit.futureTestDecisionCount).toBe(0);
    expect(audit.observableDecisionCoverage).toBe(1);
  });
});
