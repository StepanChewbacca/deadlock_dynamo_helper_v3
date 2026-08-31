import {
  createRecommendationItemGraph,
  observedFact,
  unknownFact,
} from '@deadlock-live-probe/build-domain';
import { AdaptiveBuildPlannerV1Service } from '../src/statlocker-adaptive/adaptive-build-planner-v1.service';
import { AdaptiveEvidenceScorerV1Service } from '../src/statlocker-adaptive/adaptive-evidence-scorer-v1.service';

function graph() {
  return createRecommendationItemGraph(Array.from({ length: 9 }, (_, index) => {
    const itemId = index + 1;
    return {
      itemId,
      name: `Item ${itemId}`,
      slotType: 'weapon' as const,
      active: false,
      availableRulesetIds: ['ruleset-a'],
      directPurchaseCost: itemId === 9 ? 3000 : 500,
      upgradeRecipes: [],
      sellTransition: { soulsRefund: 250, returnedItemIds: [] },
      maxCopies: 1,
    };
  }));
}

function inventory(ids: number[]) {
  return {
    initializedFromSnapshot: true,
    heldByItemId: new Map(ids.map((itemId, index) => [itemId, {
      itemId,
      instanceId: `item-${itemId}`,
      lifecycle: 1,
      acquiredBy: 'RECONCILE' as const,
      acquiredAtMs: index,
    }])),
    lifecycleCountByItemId: new Map(ids.map((itemId) => [itemId, 1])),
    nextInstanceSequence: ids.length + 1,
  };
}

function decision(owned: number[], wallet: number | undefined, shop: 'AVAILABLE' | 'UNKNOWN' = 'AVAILABLE') {
  const itemGraph = graph();
  return {
    state: {
      decisionId: 'decision-a',
      matchId: 'match-a',
      playerSlot: 0,
      gameTimeSec: 700,
      rulesetId: 'ruleset-a',
      heroId: 10,
      inventory: inventory(owned),
      economy: {
        spendableSouls: wallet === undefined ? unknownFact<number>('test') : observedFact(wallet, 'test'),
        shopOpportunity: shop === 'UNKNOWN' ? unknownFact('test') : observedFact(shop, 'test'),
      },
    },
    itemGraph,
    catalogVersionId: 'catalog-a',
    catalogSha256: 'a'.repeat(64),
    rulesetId: 'ruleset-a',
    localSteamId: 'steam-a',
    enemyHeroIds: [20],
    ourTeamSouls: 100000,
    enemyTeamSouls: 100000,
    stateRevision: 'revision-a',
  } as any;
}

function family(dataset: string, payload: any) {
  return { dataset, scopeKey: 'global', freshness: 'FRESH', confidence: 1, payload } as any;
}

function evidence(options: { skeletonTarget?: boolean; exactCount?: number } = {}) {
  const skeletonItems = options.skeletonTarget === false ? [] : [{
    itemId: 9,
    medianBuyTimeS: 900,
    strength: 0.98,
    tier: 'CORE',
    components: { coverage: 1, purchaseRate: 1, frequencyTier: 1, orderConsistency: 1, relationship: 0.8 },
  }];
  return {
    heroId: 10,
    rulesetVersion: 'ruleset-a',
    catalogSha256: 'a'.repeat(64),
    statlockerPatchId: '15-1',
    usable: true,
    snapshotIds: ['s1'],
    degradedReasons: [],
    families: [],
    byDataset: {
      WPA_PATCH_DATA: family('WPA_PATCH_DATA', {
        patchId: '15-1',
        items: [{
          heroId: 10,
          itemId: 9,
          meanWpa: 0.2,
          sampleSize: 1000,
          wpaConfidence: 1,
          gameState: { even: 0.2 },
          purchaseTiming: { medianPurchaseSec: 900 },
        }],
      }),
      VS_HERO_WPA: family('VS_HERO_WPA', {
        slices: [{ heroId: 10, enemyHeroId: 20, items: [{ itemId: 9, deltaWpa: 0.5, count: options.exactCount ?? 1000 }] }],
      }),
      T4_CHAINS: family('T4_CHAINS', { chains: [] }),
      CONSENSUS_SKELETON: family('CONSENSUS_SKELETON', { heroId: 10, profileCount: 10, items: skeletonItems }),
      WPA_FILTERED_ITEMS: family('WPA_FILTERED_ITEMS', { heroId: 10, items: [] }),
    },
  } as any;
}

describe('AdaptiveBuildPlannerV1Service', () => {
  const planner = new AdaptiveBuildPlannerV1Service(new AdaptiveEvidenceScorerV1Service());

  it('keeps a strong future core target while immediate action waits when unaffordable', () => {
    const result = planner.plan({ decision: decision([], 100), evidence: evidence() });
    expect(result.recommendedBuild.some((item) => item.itemId === 9)).toBe(true);
    expect(['WAIT', 'CONTINUE_CORE']).toContain(result.nextAction.type);
    expect(result.rankedImmediateCandidates.every((candidate) => candidate.action.type !== 'BUY')).toBe(true);
  });

  it('never selects BUY when shop opportunity is unknown but still returns the target plan', () => {
    const result = planner.plan({ decision: decision([], 5000, 'UNKNOWN'), evidence: evidence() });
    expect(result.recommendedBuild.some((item) => item.itemId === 9)).toBe(true);
    expect(result.nextAction.type).not.toBe('BUY');
  });

  it('uses legal REPLACE for full inventory when target evidence is strong', () => {
    const result = planner.plan({ decision: decision([1, 2, 3, 4, 5, 6, 7, 8], 5000), evidence: evidence() });
    expect(result.nextAction.type).toBe('REPLACE');
    expect(result.nextAction.buyItemId).toBe(9);
  });

  it('does not replace from tiny exact-enemy evidence without core support', () => {
    const result = planner.plan({
      decision: decision([1, 2, 3, 4, 5, 6, 7, 8], 5000),
      evidence: evidence({ skeletonTarget: false, exactCount: 11 }),
    });
    expect(result.nextAction.type).not.toBe('REPLACE');
  });

  it('preserves previous plan under hysteresis and returns HOLD', () => {
    const previous = planner.plan({ decision: decision([], 100), evidence: evidence() });
    const result = planner.plan({
      decision: decision([], 100),
      evidence: evidence(),
      previousResult: { ...previous, totalScore: previous.totalScore + 0.01 },
    });
    expect(result.nextAction.type).toBe('HOLD');
    expect(result.recommendedBuild.map((item) => item.itemId)).toEqual(previous.recommendedBuild.map((item) => item.itemId));
  });

  it('protects recently purchased inventory from immediate sell or replacement', () => {
    const result = planner.plan({
      decision: decision([1, 2, 3, 4, 5, 6, 7, 8], 5000),
      evidence: evidence(),
      recentPurchasedItemIds: [1, 2, 3, 4, 5, 6, 7, 8],
    });
    expect(['SELL', 'REPLACE']).not.toContain(result.nextAction.type);
  });
});
