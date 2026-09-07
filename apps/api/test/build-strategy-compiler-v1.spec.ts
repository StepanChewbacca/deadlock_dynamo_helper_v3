import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { compileBuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-compiler-v1';

function item(itemId: number, upgradeFrom?: number) {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon' as const,
    active: false,
    availableRulesetIds: ['ruleset-a'],
    ...(upgradeFrom === undefined ? { directPurchaseCost: 500 } : {}),
    upgradeRecipes: upgradeFrom === undefined
      ? []
      : [{ recipeId: `upgrade:${itemId}`, consumedItemIds: [upgradeFrom], soulsCost: 500 }],
    sellTransition: { soulsRefund: 250, returnedItemIds: [] as number[] },
    maxCopies: 1,
  };
}

const knownSlotRules = {
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: 3,
  maxActiveItems: 4,
  evidence: 'RECONSTRUCTED' as const,
};

const archetype = {
  archetypeId: 'archetype-a',
  heroId: 10,
  rulesetId: 'ruleset-a',
  catalogSha256: 'a'.repeat(64),
  supportCount: 8,
  scopeProfileCount: 10,
  confidence: 0.8,
  stability: 0.95,
  meanDistance: 0.05,
  representativeDecisionId: 'decision-a',
  representativeActionIds: ['BUY_ITEM:1', 'UPGRADE_ITEM:2:upgrade:2'],
  representativeInitialOwnedItemIds: [],
  representativeSlotRules: knownSlotRules,
  orderedGoalIds: ['early-core', 'mid-upgrade'],
  orderedTargetItemIds: [1, 2],
  terminalItemIds: [2],
  committedChoices: [],
  situationalWindowIds: ['catch-window'],
};

describe('compileBuildStrategySpecV1', () => {
  it('publishes a deeply immutable strategy only after a 100% canonical mechanics replay', () => {
    const graph = createRecommendationItemGraph([item(1), item(2, 1), item(3)]);
    const spec = compileBuildStrategySpecV1({
      archetype,
      itemGraph: graph,
      slotRules: knownSlotRules,
      situationalWindows: [{
        windowId: 'catch-window',
        targetItemIds: [3],
        purpose: 'CATCH',
        maxItems: 1,
        maxSoulsDelay: 1500,
        reservedSlots: 1,
      }],
    });

    expect(spec.catalogSha256).toBe('a'.repeat(64));
    expect(spec.terminalItemIds).toEqual([2]);
    expect(spec.situationalWindows[0].purpose).toBe('CATCH');
    expect(spec.feasibility.releaseEligible).toBe(true);
    expect(spec.feasibility.actionCoverage).toBe(1);
    expect(spec.feasibility.mandatoryGoalCoverage).toBe(1);
    expect(spec.feasibility.terminalSatisfied).toBe(true);
    expect(spec.feasibility.validatedActionIds).toEqual(archetype.representativeActionIds);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.goals)).toBe(true);
    expect(Object.isFrozen(spec.goals[0])).toBe(true);
  });

  it('fails closed instead of inventing a purpose for an observed situational window', () => {
    const graph = createRecommendationItemGraph([item(1), item(2, 1), item(3)]);
    expect(() => compileBuildStrategySpecV1({
      archetype,
      itemGraph: graph,
      slotRules: knownSlotRules,
    })).toThrow('SITUATIONAL_WINDOW_METADATA_MISSING:catch-window');
  });

  it('rejects publication when representative transactions cannot replay canonically', () => {
    const graph = createRecommendationItemGraph([item(1), item(2, 1), item(3)]);
    expect(() => compileBuildStrategySpecV1({
      archetype: {
        ...archetype,
        representativeActionIds: ['BUY_ITEM:2'],
        situationalWindowIds: [],
      },
      itemGraph: graph,
      slotRules: knownSlotRules,
    })).toThrow('STRATEGY_FEASIBILITY_ACTION_NOT_EXECUTABLE:BUY_ITEM:2');
  });

  it('rejects publication when exact slot and active mechanics are unknown', () => {
    const graph = createRecommendationItemGraph([item(1), item(2, 1), item(3)]);
    expect(() => compileBuildStrategySpecV1({
      archetype: {
        ...archetype,
        situationalWindowIds: [],
        representativeSlotRules: {
          baseSlotsByType: { weapon: 0, vitality: 0, spirit: 0 },
          maxFlexSlots: 0,
          maxActiveItems: 0,
          evidence: 'UNKNOWN',
        },
      },
      itemGraph: graph,
      slotRules: {
        baseSlotsByType: { weapon: 0, vitality: 0, spirit: 0 },
        maxFlexSlots: 0,
        maxActiveItems: 0,
        evidence: 'UNKNOWN',
      },
    })).toThrow('STRATEGY_MECHANICS_UNKNOWN');
  });
});