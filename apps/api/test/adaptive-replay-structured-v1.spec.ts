import { AdaptiveBuildPlannerV1Service } from '../src/statlocker-adaptive/adaptive-build-planner-v1.service';
import { AdaptiveEvidenceScorerV1Service } from '../src/statlocker-adaptive/adaptive-evidence-scorer-v1.service';
import {
  AdaptiveReplayInputV1,
  AdaptiveReplayV1Service,
} from '../src/statlocker-adaptive/adaptive-replay-v1.service';
import { ADAPTIVE_POLICY_V1_CONFIG } from '../src/statlocker-adaptive/statlocker-adaptive.config';

const catalogSha256 = 'a'.repeat(64);

function family(dataset: string, scopeKey: string, payload: unknown) {
  return {
    dataset,
    scopeKey,
    snapshotId: `${dataset}-snapshot`,
    contentSha256: 'b'.repeat(64),
    fetchedAt: '2026-09-01T12:00:00.000Z',
    freshness: 'FRESH',
    confidence: 1,
    payload,
  } as any;
}

function candidate(itemId: number, medianBuyTimeS: number, strength: number) {
  return {
    itemId,
    strength,
    coverage: 0.9,
    purchaseRate: 0.9,
    medianBuyTimeS,
    timingSpreadS: 30,
    sourceProfileCount: 10,
    frequencyTier: 'CORE' as const,
    rushEvidence: false,
  };
}

function replayInput(): AdaptiveReplayInputV1 {
  const byDataset = {
    WPA_PATCH_DATA: family('WPA_PATCH_DATA', 'patch:15-1', {
      patchId: '15-1',
      items: [
        {
          heroId: 10,
          itemId: 1,
          meanWpa: 0.02,
          sampleSize: 1000,
          wpaConfidence: 1,
          gameState: { even: 0.02 },
          purchaseTiming: { medianPurchaseSec: 180 },
        },
        {
          heroId: 10,
          itemId: 2,
          meanWpa: 0.95,
          sampleSize: 5000,
          wpaConfidence: 1,
          gameState: { even: 0.95 },
          purchaseTiming: { medianPurchaseSec: 120 },
        },
      ],
    }),
    VS_HERO_WPA: family('VS_HERO_WPA', 'global', {
      slices: [{
        heroId: 10,
        enemyHeroId: 20,
        items: [
          { itemId: 1, deltaWpa: 0, count: 1000 },
          { itemId: 2, deltaWpa: 0.95, count: 5000 },
        ],
      }],
    }),
    T4_CHAINS: family('T4_CHAINS', 'global', { chains: [] }),
    CONSENSUS_SKELETON: family('CONSENSUS_SKELETON', 'hero:10:consensus', {
      heroId: 10,
      profileCount: 10,
      groups: [
        {
          groupId: 'hero:10:EARLY:REQUIRED:1',
          phase: 'EARLY',
          type: 'REQUIRED',
          minSelect: 1,
          maxSelect: 1,
          candidates: [candidate(1, 180, 0.8)],
          confidence: 0.8,
          inferred: true,
        },
        {
          groupId: 'hero:10:MID:REQUIRED:2',
          phase: 'MID',
          type: 'REQUIRED',
          minSelect: 1,
          maxSelect: 1,
          candidates: [candidate(2, 720, 0.99)],
          confidence: 0.99,
          inferred: true,
        },
      ],
    }),
    WPA_FILTERED_ITEMS: {
      dataset: 'WPA_FILTERED_ITEMS',
      scopeKey: 'hero:10',
      freshness: 'UNAVAILABLE',
      confidence: 0,
    },
  } as any;
  const snapshotIds = Object.values(byDataset)
    .map((entry: any) => entry.snapshotId)
    .filter((value): value is string => typeof value === 'string')
    .sort();
  const evidence = {
    heroId: 10,
    rulesetVersion: 'ruleset-a',
    catalogSha256,
    statlockerPatchId: '15-1',
    usable: true,
    snapshotIds,
    degradedReasons: [],
    families: Object.values(byDataset),
    byDataset,
  } as any;

  return {
    decision: {
      state: {
        decisionId: 'adaptive-replay-structured',
        matchId: 'match-structured',
        playerSlot: 0,
        gameTimeSec: 120,
        rulesetId: 'ruleset-a',
        heroId: 10,
        ownedItemIds: [],
        spendableSouls: { value: 1000, evidence: 'OBSERVED', source: 'test' },
        shopOpportunity: { value: 'AVAILABLE', evidence: 'OBSERVED', source: 'test' },
      },
      itemDefinitions: [1, 2].map((itemId) => ({
        itemId,
        name: `Item ${itemId}`,
        slotType: 'weapon' as const,
        active: false,
        availableRulesetIds: ['ruleset-a'],
        directPurchaseCost: 500,
        upgradeRecipes: [],
        sellTransition: { soulsRefund: 250, returnedItemIds: [] },
        maxCopies: 1,
      })),
      catalogVersionId: 'catalog-a',
      catalogSha256,
      rulesetId: 'ruleset-a',
      localSteamId: 'steam-a',
      enemyHeroIds: [20],
      ourTeamSouls: 100000,
      enemyTeamSouls: 100000,
      stateRevision: 'revision-structured',
    },
    evidence,
    recentPurchasedItemIds: [],
    recentSoldItemIds: [],
    configVersion: ADAPTIVE_POLICY_V1_CONFIG.version,
    scorerVersion: 'adaptive-evidence-scorer-v1',
    plannerVersion: 'adaptive-build-planner-v1',
    snapshotIds,
  };
}

function replayService(): AdaptiveReplayV1Service {
  const planner = new AdaptiveBuildPlannerV1Service(new AdaptiveEvidenceScorerV1Service());
  return new AdaptiveReplayV1Service({} as any, planner);
}

describe('AdaptiveReplayV1Service structured replay invariants', () => {
  it('keeps a high-WPA MID item behind an unresolved EARLY required target', () => {
    const replay = replayService();
    const result = replay.run(replayInput());
    const next = result.recommendedBuild.find((item) => item.status === 'NEXT');

    expect(next?.itemId).toBe(1);
    expect(result.nextAction.targetItemId).toBe(1);
    expect(result.recommendedBuild.some((item) => item.itemId === 2 && item.status === 'NEXT')).toBe(false);
  });

  it('replays identical structured input deterministically', () => {
    const replay = replayService();
    const input = replayInput();
    const first = replay.run(input);
    const second = replay.run(input);

    expect(second.nextAction).toEqual(first.nextAction);
    expect(second.recommendedBuild).toEqual(first.recommendedBuild);
    expect(second.changes).toEqual(first.changes);
    expect(second.totalScore).toBe(first.totalScore);
    expect(second.confidence).toBe(first.confidence);
  });
});
