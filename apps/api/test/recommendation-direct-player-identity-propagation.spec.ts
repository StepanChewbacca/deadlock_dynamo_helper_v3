import type { CanonicalPlayerBuildSequence } from '../src/deadlock-live/canonical-build-sequence.service';
import {
  createHeroBuildDecisionRows,
  type HeroBuildDecisionDatasetV3Row,
} from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type { HeroBuildOfflineLoadedHeroSample } from '../src/deadlock-live/hero-build-offline-evaluation-data-loader.service';
import {
  createRecommendationHistoricalProReplayRow,
  type RecommendationHistoricalCatalogItem,
  type RecommendationHistoricalProReplayRow,
} from '../src/deadlock-live/recommendation-historical-pro-replay';
import { createRecommendationProDecisionDatasetV6Row } from '../src/deadlock-live/recommendation-pro-decision-dataset-v6';

const MAX_U32 = 4294967295;

describe('Direct player identity propagation', () => {
  it('persists direct account identity in immutable V3 rows without making it a feature', () => {
    const sample = createSample();
    const withIdentity = createHeroBuildDecisionRows(
      sample,
      [2, 3, 4, 5, 6],
      false,
      MAX_U32,
    ).rows[0];
    const withoutIdentity = createHeroBuildDecisionRows(
      sample,
      [2, 3, 4, 5, 6],
      false,
    ).rows[0];

    expect(withIdentity).toMatchObject({
      accountId: String(MAX_U32),
      playerIdentitySource: 'MATCH_PLAYER_ACCOUNT_ID_DIRECT',
    });
    expect(withIdentity).not.toHaveProperty('state.accountId');
    expect(withoutIdentity.accountId).toBeUndefined();
    expect(withoutIdentity.playerIdentitySource).toBeUndefined();
  });

  it('preserves direct account identity through historical replay and Dataset V6', () => {
    const decision = createHeroBuildDecisionRows(
      createSample(),
      [2, 3, 4, 5, 6],
      false,
      MAX_U32,
    ).rows[0];
    const replay = createReplay(decision);
    const datasetRow = createRecommendationProDecisionDatasetV6Row({
      replayRow: replay,
      split: 'TRAIN',
      catalogItemsById: catalog(),
    });

    expect(replay).toMatchObject({
      accountId: String(MAX_U32),
      playerIdentitySource: 'MATCH_PLAYER_ACCOUNT_ID_DIRECT',
    });
    expect(datasetRow).toMatchObject({
      accountId: String(MAX_U32),
      playerIdentitySource: 'MATCH_PLAYER_ACCOUNT_ID_DIRECT',
    });
    expect(datasetRow.state).not.toHaveProperty('accountId');
    expect(datasetRow.candidates[0]).not.toHaveProperty('accountId');
  });

  it('rejects malformed direct identity instead of silently propagating it', () => {
    const decision: HeroBuildDecisionDatasetV3Row = {
      ...createHeroBuildDecisionRows(
        createSample(),
        [2, 3, 4, 5, 6],
        false,
      ).rows[0],
      accountId: '4294967296',
      playerIdentitySource: 'MATCH_PLAYER_ACCOUNT_ID_DIRECT',
    };

    expect(() => createReplay(decision)).toThrow('u32 domain');
  });
});

function createReplay(
  decision: HeroBuildDecisionDatasetV3Row,
): RecommendationHistoricalProReplayRow {
  return createRecommendationHistoricalProReplayRow({
    decision,
    candidateActions: [
      {
        actionKey: decision.actualActionKey,
        actionType: 'BUY',
        itemId: decision.actualItemId,
        rank: 1,
        score: 0.8,
        historicalCount: 80,
        historicalProbability: 0.8,
        confidence: 0.9,
        predictedStateKey: decision.inventoryAfterStateKey,
      },
      {
        actionKey: 'BUY:200',
        actionType: 'BUY',
        itemId: 200,
        rank: 2,
        score: 0.2,
        historicalCount: 20,
        historicalProbability: 0.2,
        confidence: 0.7,
        predictedStateKey: '200x1',
      },
    ],
    catalogItemsById: catalog(),
    shortHorizonOutcomes: [
      { horizon: '3m', complete: true, utility: 0.1, snapshotGameTimeS: 480 },
      { horizon: '5m', complete: true, utility: 0.2, snapshotGameTimeS: 600 },
      { horizon: '10m', complete: false },
    ],
    generatorSnapshot: {
      snapshotId: 'snapshot-1',
      generatorVersion: 'HERO_BUILD_CANDIDATE_GENERATOR_V1',
      policyVersion: 'policy-1',
      policySha256: 'a'.repeat(64),
      catalogVersion: 'catalog-1',
      catalogSha256: 'b'.repeat(64),
      trainingWindowStart: '2026-06-01T00:00:00.000Z',
      trainingWindowEnd: '2026-06-30T23:59:59.000Z',
    },
  });
}

function createSample(): HeroBuildOfflineLoadedHeroSample {
  return {
    descriptor: {
      matchId: 1001,
      startTime: new Date('2026-07-20T12:00:00.000Z'),
    },
    player: {
      id: 77,
      matchId: 1001,
      heroId: 66,
      team: 0,
      won: true,
      kills: 1,
      deaths: 2,
      assists: 3,
      netWorth: 5000,
      itemPurchases: [],
      skillUpgrades: [],
    },
    sequence: createSequence(),
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
  };
}

function createSequence(): CanonicalPlayerBuildSequence {
  return {
    matchId: 1001,
    playerId: 77,
    heroId: 66,
    sourceActionCount: 1,
    canonicalStepCount: 1,
    ignoredActionCount: 0,
    replayDiagnosticCount: 0,
    initialStateKey: 'EMPTY',
    finalStateKey: '100x1',
    actionSequenceKey: 'BUY:100',
    sequenceKey: 'EMPTY>BUY:100>100x1',
    steps: [
      {
        sequence: 1,
        sourceSequence: 1,
        gameTimeS: 300,
        actionType: 'BUY',
        itemId: 100,
        actionKey: 'BUY:100',
        beforeStateKey: 'EMPTY',
        afterStateKey: '100x1',
        transitionKey: 'EMPTY>BUY:100>100x1',
      },
    ],
  };
}

function catalog(): ReadonlyMap<number, RecommendationHistoricalCatalogItem> {
  return new Map([
    [
      100,
      {
        itemId: 100,
        name: 'Item 100',
        cost: 500,
        tier: 1,
        slotType: 'WEAPON',
        itemType: 'UPGRADE',
        isActiveItem: false,
        tags: ['WEAPON'],
        componentItemIds: [],
      },
    ],
    [
      200,
      {
        itemId: 200,
        name: 'Item 200',
        cost: 1250,
        tier: 2,
        slotType: 'VITALITY',
        itemType: 'UPGRADE',
        isActiveItem: false,
        tags: ['VITALITY'],
        componentItemIds: [],
      },
    ],
  ]);
}
