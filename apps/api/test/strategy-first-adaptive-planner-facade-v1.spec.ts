import { createRecommendationItemGraph, buildInventoryInstancesForRecommendation, observedFact } from '@deadlock-live-probe/build-domain';
import { StrategyFirstAdaptivePlannerFacadeV1Service } from '../src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service';
import { BuildStrategyRegistryV1Service } from '../src/statlocker-adaptive/build-strategy-registry-v1.service';
import { ConsensusStrategyFallbackV1Service } from '../src/statlocker-adaptive/consensus-strategy-fallback-v1.service';
import { StrategyFirstBuildPlannerV1Service } from '../src/statlocker-adaptive/strategy-first-build-planner-v1.service';
import { deriveAdaptiveSlotStateV1, unknownAdaptiveInvestmentStateV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';

const graph = createRecommendationItemGraph([
  { itemId: 1, name: 'A', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [], sellTransition: { soulsRefund: 400, returnedItemIds: [] } },
]);
const fakeScorer = { scoreItem(itemId: number) { return { itemId, score: 0.5, confidence: 0.8, completeness: 1, components: [], version: 'adaptive-evidence-scorer-v1' as const }; } } as any;
const held = buildInventoryInstancesForRecommendation([], graph);
const decision: any = {
  state: { decisionId: 'd', matchId: 'm', playerSlot: 0, gameTimeSec: 100, rulesetId: 'r1', heroId: 1, inventory: { initializedFromSnapshot: true, heldByItemId: held, lifecycleCountByItemId: new Map(), nextInstanceSequence: 1 }, economy: { spendableSouls: observedFact(1000, 't'), shopOpportunity: observedFact('AVAILABLE', 't') } },
  itemGraph: graph, catalogVersionId: 'c', catalogSha256: 'a'.repeat(64), rulesetId: 'r1', localSteamId: 'p', allyHeroIds: [], enemyHeroIds: [], allyItemIds: [], enemyItemIds: [],
  slots: deriveAdaptiveSlotStateV1([], graph, { baseSlots: 12, baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 }, maxFlexSlots: 4, maxActiveItems: 4 }, { unlockedFlexSlots: 0, evidence: 'OBSERVED' }),
  investment: unknownAdaptiveInvestmentStateV1(), economyRulesEvidence: 'UNKNOWN', stateRevision: 'revision',
};
const skeleton: any = { heroId: 1, profileCount: 10, groups: [{ groupId: 'g', phase: 'EARLY', type: 'REQUIRED', minSelect: 1, maxSelect: 1, confidence: 0.8, inferred: false, candidates: [{ itemId: 1, strength: 0.8, coverage: 0.8, purchaseRate: 0.8, medianBuyTimeS: 100, timingSpreadS: 10, sourceProfileCount: 8, frequencyTier: 'CORE', rushEvidence: false }] }] };
const evidence: any = { heroId: 1, rulesetVersion: 'r1', catalogSha256: 'a'.repeat(64), statlockerPatchId: 'p1', usable: true, snapshotIds: [], degradedReasons: [], families: [], byDataset: { CONSENSUS_SKELETON: { dataset: 'CONSENSUS_SKELETON', scopeKey: 'hero:1', freshness: 'FRESH', confidence: 0.8, payload: skeleton }, WPA_PATCH_DATA: { dataset: 'WPA_PATCH_DATA', scopeKey: 'g', freshness: 'UNAVAILABLE', confidence: 0 }, VS_HERO_WPA: { dataset: 'VS_HERO_WPA', scopeKey: 'g', freshness: 'UNAVAILABLE', confidence: 0 }, T4_CHAINS: { dataset: 'T4_CHAINS', scopeKey: 'g', freshness: 'UNAVAILABLE', confidence: 0 }, WPA_FILTERED_ITEMS: { dataset: 'WPA_FILTERED_ITEMS', scopeKey: 'h', freshness: 'UNAVAILABLE', confidence: 0 } } };

describe('strategy-first adaptive planner facade v1', () => {
  it('uses a structured consensus fallback when no mined strategy snapshot exists yet', () => {
    const facade = new StrategyFirstAdaptivePlannerFacadeV1Service(
      new StrategyFirstBuildPlannerV1Service(fakeScorer), new BuildStrategyRegistryV1Service(), new ConsensusStrategyFallbackV1Service(),
    );
    const result = facade.plan({ decision, evidence });
    expect(result.strategy.strategyId).toContain('consensus-fallback');
    expect(result.nextAction.type).toBe('BUY');
  });
});
