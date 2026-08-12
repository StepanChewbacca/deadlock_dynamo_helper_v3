import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import {
  createRecommendationCandidateGeneratorSnapshotArtifact,
  prepareRecommendationSerializedHeroBuildPolicy,
  type RecommendationSerializedHeroBuildPolicy,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';
import {
  generateRecommendationBehavioralV6ChoiceSetProvenance,
  RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_VERSION,
} from '../src/deadlock-live/recommendation-behavioral-v6-choice-set';
import type { RecommendationHistoricalCatalogItem } from '../src/deadlock-live/recommendation-historical-pro-replay';

function decision(
  overrides: Partial<HeroBuildDecisionDatasetV3Row> = {},
): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId: 'decision-1',
    matchId: 100,
    matchStartTime: '2026-07-10T12:00:00.000Z',
    playerId: 200,
    heroId: 1,
    team: 0,
    gameTimeS: 300,
    phase: 'EARLY',
    inventoryBeforeStateKey: '1001x1',
    inventoryAfterStateKey: '1001x1|1002x1',
    previousActionKeys: ['BUY:1001'],
    buildPrefixKey: 'BUY:1001',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'BUY',
    actualItemId: 1002,
    actualActionKey: 'BUY:1002',
    outcomeLabel: { playerWon: true },
    ...overrides,
  };
}

function catalogItem(itemId: number): RecommendationHistoricalCatalogItem {
  return {
    itemId,
    name: `Item ${itemId}`,
    cost: 1_250,
    tier: 2,
    slotType: 'WEAPON',
    itemType: 'UPGRADE',
    isActiveItem: false,
    activationType: 'PASSIVE',
    tags: ['DAMAGE'],
    componentItemIds: [],
  };
}

function policy(): RecommendationSerializedHeroBuildPolicy {
  return {
    heroId: 1,
    playerCount: 100,
    stateCount: 2,
    transitionCount: 40,
    states: [
      {
        stateKey: '1001x1',
        observationCount: 20,
        nextActionCount: 2,
        nextActions: [
          {
            actionType: 'BUY',
            itemId: 1002,
            actionKey: 'BUY:1002',
            count: 12,
            probability: 0.6,
            averageGameTimeS: 320,
            afterStates: [
              {
                afterStateKey: '1001x1|1002x1',
                count: 12,
                probability: 1,
              },
            ],
          },
          {
            actionType: 'BUY',
            itemId: 1003,
            actionKey: 'BUY:1003',
            count: 8,
            probability: 0.4,
            averageGameTimeS: 340,
            afterStates: [
              {
                afterStateKey: '1001x1|1003x1',
                count: 8,
                probability: 1,
              },
            ],
          },
        ],
      },
      {
        stateKey: '2001x1',
        observationCount: 20,
        nextActionCount: 1,
        nextActions: [
          {
            actionType: 'BUY',
            itemId: 1004,
            actionKey: 'BUY:1004',
            count: 20,
            probability: 1,
            averageGameTimeS: 900,
            afterStates: [
              {
                afterStateKey: '1004x1|2001x1',
                count: 20,
                probability: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}

function artifact() {
  return createRecommendationCandidateGeneratorSnapshotArtifact({
    snapshot: {
      snapshotId: 'snapshot-v6',
      generatorVersion: 'HERO_BUILD_CANDIDATE_GENERATOR_V1',
      policyVersion: 'policy-v6',
      catalogVersion: 'catalog-v6',
      trainingWindowStart: '2026-06-01T00:00:00.000Z',
      trainingWindowEnd: '2026-07-01T00:00:00.000Z',
    },
    generatorOptions: {
      minExactObservations: 3,
      maxBackoffDistance: 4,
      maxBackoffStates: 64,
      limit: 100,
    },
    policies: [policy()],
    catalog: {
      version: 'catalog-v6',
      items: [
        catalogItem(1001),
        catalogItem(1002),
        catalogItem(1003),
        catalogItem(1004),
        catalogItem(2001),
      ],
    },
  });
}

describe('Recommendation Behavioral V6 choice-set provenance', () => {
  it('separates primary-state candidates from support-union-only candidates', () => {
    const snapshot = artifact();
    const prepared = prepareRecommendationSerializedHeroBuildPolicy(
      snapshot.policies[0],
    );

    const result = generateRecommendationBehavioralV6ChoiceSetProvenance({
      decision: decision(),
      snapshot: snapshot.snapshot,
      generatorOptions: snapshot.generatorOptions,
      catalog: snapshot.catalog,
      policy: prepared,
    });

    expect(result.version).toBe(RECOMMENDATION_BEHAVIORAL_V6_CHOICE_SET_VERSION);
    expect(result.primaryCandidates.map((candidate) => candidate.actionKey)).toEqual([
      'BUY:1002',
      'BUY:1003',
    ]);
    expect(result.supportCandidates.map((candidate) => candidate.actionKey)).toContain(
      'BUY:1004',
    );

    const primary = result.mergedCandidates.find(
      (candidate) => candidate.candidate.actionKey === 'BUY:1002',
    );
    expect(primary).toMatchObject({
      sources: ['PRIMARY_STATE', 'HERO_SUPPORT_UNION'],
      primaryRank: 1,
      supportUnionOnly: false,
    });

    const supportOnly = result.mergedCandidates.find(
      (candidate) => candidate.candidate.actionKey === 'BUY:1004',
    );
    expect(supportOnly).toMatchObject({
      sources: ['HERO_SUPPORT_UNION'],
      supportUnionOnly: true,
    });
  });

  it('does not inject the observed action into either source', () => {
    const snapshot = artifact();
    const prepared = prepareRecommendationSerializedHeroBuildPolicy(
      snapshot.policies[0],
    );
    const result = generateRecommendationBehavioralV6ChoiceSetProvenance({
      decision: decision({ actualItemId: 9999, actualActionKey: 'BUY:9999' }),
      snapshot: snapshot.snapshot,
      generatorOptions: snapshot.generatorOptions,
      catalog: snapshot.catalog,
      policy: prepared,
    });

    expect(
      result.mergedCandidates.map((candidate) => candidate.candidate.actionKey),
    ).not.toContain('BUY:9999');
  });

  it('rejects a leaking snapshot', () => {
    const snapshot = artifact();
    const prepared = prepareRecommendationSerializedHeroBuildPolicy(
      snapshot.policies[0],
    );

    expect(() =>
      generateRecommendationBehavioralV6ChoiceSetProvenance({
        decision: decision(),
        snapshot: {
          ...snapshot.snapshot,
          trainingWindowEnd: '2026-07-10T12:00:00.000Z',
        },
        generatorOptions: snapshot.generatorOptions,
        catalog: snapshot.catalog,
        policy: prepared,
      }),
    ).toThrow('must end before');
  });
});
