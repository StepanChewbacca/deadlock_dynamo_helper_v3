import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { StrategyFirstOperationsV1Service } from '../src/statlocker-adaptive/strategy-first-operations-v1.service';

const catalogSha256 = 'a'.repeat(64);
const economyRules = {
  rulesetId: 'r1',
  catalogSha256,
  baseSlots: 12,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: 4,
  maxActiveItems: 4,
  investmentBreakpoints: {
    weapon: [1600, 3200],
    vitality: [1600, 3200],
    spirit: [1600, 3200],
  },
};
const graph = createRecommendationItemGraph([{
  itemId: 1,
  name: 'Core',
  slotType: 'weapon',
  active: false,
  availableRulesetIds: ['r1'],
  directPurchaseCost: 800,
  upgradeRecipes: [],
}]);

function service(resolveExact: jest.Mock, run: jest.Mock) {
  const result = new StrategyFirstOperationsV1Service(
    { find: jest.fn() } as any,
    { find: jest.fn() } as any,
    { find: jest.fn() } as any,
    { resolveExact, publish: jest.fn() } as any,
    { run } as any,
  );
  (result as any).loadExactGraph = jest.fn(async () => graph);
  return result;
}

describe('strategy-first operations v1', () => {
  it('fails closed before mining when exact economy rules are unavailable', async () => {
    const run = jest.fn();
    const operations = service(jest.fn(async () => undefined), run);

    await expect(operations.mineHeroForIdentity({
      heroId: 1,
      patchId: 'p1',
      rulesetId: 'r1',
      catalogSha256,
    })).resolves.toEqual({
      attempted: false,
      published: false,
      reasonCodes: ['EXACT_ECONOMY_RULES_UNAVAILABLE'],
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the mining pipeline only with the exact ruleset, catalog graph and economy contract', async () => {
    const run = jest.fn(async (input: any) => ({
      published: true,
      snapshotId: 'strategy:1:p1:abc',
      sourceTraceCount: 10,
      rejectedTraceCount: 0,
      noiseTraceCount: 1,
      archetypeCount: 2,
      strategyCount: 2,
      reasonCodes: ['STRATEGY_SNAPSHOT_PUBLISHED'],
      input,
    }));
    const operations = service(jest.fn(async () => economyRules), run);

    const result = await operations.mineHeroForIdentity({
      heroId: 1,
      patchId: 'p1',
      rulesetId: 'r1',
      catalogSha256,
      minClusterSize: 3,
    });

    expect(result).toMatchObject({ attempted: true, published: true, snapshotId: 'strategy:1:p1:abc' });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      heroId: 1,
      patchId: 'p1',
      rulesetId: 'r1',
      catalogSha256,
      itemGraph: graph,
      economyRules,
      minClusterSize: 3,
    }));
    expect(operations.getStatus().lastMineByHero[`1:r1:${catalogSha256}`]).toMatchObject({ published: true });
  });
});
