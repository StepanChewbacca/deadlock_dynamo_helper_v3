import {
  createRecommendationItemGraph,
  observedFact,
} from '@deadlock-live-probe/build-domain';
import { AdaptiveBuildPlannerV1Service } from '../src/statlocker-adaptive/adaptive-build-planner-v1.service';
import {
  RecommendationEconomyRulesV1,
  deriveAdaptiveInvestmentStateV1,
  deriveAdaptiveSlotStateV1,
} from '../src/statlocker-adaptive/adaptive-economy-v1';
import { AdaptiveEvidenceScorerV1Service } from '../src/statlocker-adaptive/adaptive-evidence-scorer-v1.service';
import { ConsensusBuildGroupV1 } from '../src/statlocker-adaptive/statlocker-adaptive.types';

const catalogSha256 = 'a'.repeat(64);
const economyRules: RecommendationEconomyRulesV1 = {
  rulesetId: 'ruleset-a',
  catalogSha256,
  baseSlots: 9,
  maxFlexSlots: 3,
  investmentBreakpoints: {
    weapon: [1600, 3200, 6400],
    vitality: [1600, 3200, 6400],
    spirit: [1600, 3200, 6400],
  },
};

function graph() {
  return createRecommendationItemGraph([1, 2, 3].map((itemId) => ({
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
  })));
}

function choiceGroup(): ConsensusBuildGroupV1 {
  return {
    groupId: 'pick-two',
    phase: 'EARLY',
    type: 'CHOICE',
    minSelect: 2,
    maxSelect: 2,
    confidence: 1,
    inferred: false,
    candidates: [1, 2, 3].map((itemId) => ({
      itemId,
      strength: 0.8,
      coverage: 0.8,
      purchaseRate: 0.8,
      medianBuyTimeS: 300,
      timingSpreadS: 30,
      sourceProfileCount: 8,
      frequencyTier: 'CORE' as const,
      rushEvidence: false,
    })),
  };
}

function family(dataset: string, payload: unknown) {
  return {
    dataset,
    scopeKey: dataset === 'CONSENSUS_SKELETON' ? 'hero:10:consensus' : 'global',
    snapshotId: `${dataset}-snapshot`,
    contentSha256: 'b'.repeat(64),
    freshness: 'FRESH',
    confidence: 1,
    payload,
  } as any;
}

function evidence() {
  const group = choiceGroup();
  const wpaItems = [1, 2, 3].map((itemId) => ({
    heroId: 10,
    itemId,
    meanWpa: 0,
    sampleSize: 2000,
    wpaConfidence: 1,
    gameState: { even: 0 },
    purchaseTiming: { medianPurchaseSec: 300 },
  }));
  const byDataset = {
    WPA_PATCH_DATA: family('WPA_PATCH_DATA', { patchId: '15-1', items: wpaItems }),
    VS_HERO_WPA: family('VS_HERO_WPA', {
      slices: [{
        heroId: 10,
        enemyHeroId: 20,
        items: [
          { itemId: 1, deltaWpa: 0.01, count: 2000 },
          { itemId: 2, deltaWpa: 0.30, count: 2000 },
          { itemId: 3, deltaWpa: 0.60, count: 2000 },
        ],
      }],
    }),
    T4_CHAINS: family('T4_CHAINS', { chains: [] }),
    CONSENSUS_SKELETON: family('CONSENSUS_SKELETON', {
      heroId: 10,
      profileCount: 10,
      groups: [group],
    }),
    WPA_FILTERED_ITEMS: family('WPA_FILTERED_ITEMS', { heroId: 10, items: wpaItems }),
  };
  return {
    heroId: 10,
    rulesetVersion: 'ruleset-a',
    catalogSha256,
    statlockerPatchId: '15-1',
    usable: true,
    snapshotIds: Object.values(byDataset).map((entry) => entry.snapshotId),
    degradedReasons: [],
    families: Object.values(byDataset),
    byDataset,
  } as any;
}

function decision() {
  const itemGraph = graph();
  const state = {
    decisionId: 'decision',
    matchId: 'match',
    playerSlot: 0,
    gameTimeSec: 300,
    rulesetId: 'ruleset-a',
    heroId: 10,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId: new Map(),
      lifecycleCountByItemId: new Map(),
      nextInstanceSequence: 1,
    },
    economy: {
      spendableSouls: observedFact(5000, 'test'),
      shopOpportunity: observedFact('AVAILABLE', 'test'),
    },
  };
  return {
    state,
    itemGraph,
    catalogVersionId: 'catalog-a',
    catalogSha256,
    rulesetId: 'ruleset-a',
    localSteamId: 'steam-a',
    enemyHeroIds: [20],
    ourTeamSouls: 100000,
    enemyTeamSouls: 100000,
    slots: deriveAdaptiveSlotStateV1([], itemGraph, economyRules, { unlockedFlexSlots: 3, evidence: 'OBSERVED' }),
    investment: deriveAdaptiveInvestmentStateV1([], itemGraph, economyRules),
    economyRules,
    stateRevision: 'revision-a',
  } as any;
}

describe('AdaptiveBuildPlannerV1Service explicit K-of-N choice', () => {
  it('selects exactly two best candidates from a pick-two group', () => {
    const planner = new AdaptiveBuildPlannerV1Service(new AdaptiveEvidenceScorerV1Service());
    const result = planner.plan({ decision: decision(), evidence: evidence() });
    const selected = result.recommendedBuild
      .filter((item) => item.status !== 'OWNED')
      .map((item) => item.itemId)
      .filter((itemId) => [1, 2, 3].includes(itemId));

    expect(selected).toEqual([2, 3]);
    expect(selected).toHaveLength(2);
    expect(result.recommendedBuild.some((item) => item.itemId === 1)).toBe(false);
  });
});
