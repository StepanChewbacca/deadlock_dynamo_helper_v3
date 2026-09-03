import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  RecommendationEconomyRulesV1,
  deriveAdaptiveInvestmentDeltasV1,
  deriveAdaptiveInvestmentStateV1,
  deriveAdaptiveSlotStateV1,
  resolveRecommendationEconomyRulesV1,
} from '../src/statlocker-adaptive/adaptive-economy-v1';

const catalogSha256 = 'a'.repeat(64);
const rules: RecommendationEconomyRulesV1 = {
  rulesetId: 'ruleset-a',
  catalogSha256,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: 4,
  investmentBreakpoints: {
    weapon: [1600, 3200, 6400],
    vitality: [1600, 3200, 6400],
    spirit: [1600, 3200, 6400],
  },
};

function graph() {
  return createRecommendationItemGraph([
    ...[1, 2, 3, 4, 5, 6].map((itemId) => ({
      itemId,
      name: `Weapon ${itemId}`,
      slotType: 'weapon' as const,
      active: false,
      availableRulesetIds: ['ruleset-a'],
      directPurchaseCost: 800,
      upgradeRecipes: [],
    })),
    {
      itemId: 10,
      name: 'Vitality',
      slotType: 'vitality' as const,
      active: false,
      availableRulesetIds: ['ruleset-a'],
      directPurchaseCost: 1600,
      upgradeRecipes: [],
    },
  ]);
}

describe('adaptive economy v1', () => {
  it('derives current investment and next exact breakpoint by slot type', () => {
    const state = deriveAdaptiveInvestmentStateV1([1, 2], graph(), rules);

    expect(state.evidence).toBe('RECONSTRUCTED');
    expect(state.tracks.weapon).toEqual({
      type: 'weapon',
      currentValue: 1600,
      achievedBreakpoint: 1600,
      nextBreakpoint: 3200,
      soulsToNextBreakpoint: 1600,
    });
    expect(state.tracks.vitality.currentValue).toBe(0);
  });

  it('returns unknown investment evidence when exact rules are unavailable', () => {
    const state = deriveAdaptiveInvestmentStateV1([1, 2], graph(), undefined);

    expect(state.evidence).toBe('UNKNOWN');
    expect(state.tracks.weapon.currentValue).toBe(0);
  });

  it('resolves rules only by exact ruleset and catalog identity', () => {
    expect(resolveRecommendationEconomyRulesV1('ruleset-a', catalogSha256, [rules])).toBe(rules);
    expect(resolveRecommendationEconomyRulesV1('ruleset-b', catalogSha256, [rules])).toBeUndefined();
    expect(resolveRecommendationEconomyRulesV1('ruleset-a', 'b'.repeat(64), [rules])).toBeUndefined();
  });

  it('derives current flex usage as a lower bound without inventing unlocked capacity', () => {
    const state = deriveAdaptiveSlotStateV1([1, 2, 3, 4, 5], graph(), rules, { evidence: 'UNKNOWN' });

    expect(state.usedFlexSlots).toBe(1);
    expect(state.provedFlexLowerBound).toBe(1);
    expect(state.unlockedFlexSlots).toBeUndefined();
    expect(state.freeFlexSlots).toBeUndefined();
    expect(state.evidence).toBe('UNKNOWN');
  });

  it('reports breakpoint crossings from projected inventory states', () => {
    const before = deriveAdaptiveInvestmentStateV1([1], graph(), rules);
    const after = deriveAdaptiveInvestmentStateV1([1, 2], graph(), rules);
    const weapon = deriveAdaptiveInvestmentDeltasV1(before, after).find((entry) => entry.type === 'weapon');

    expect(weapon?.crossedBreakpoints).toEqual([1600]);
  });
});
