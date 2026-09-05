import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategyMiningPipelineV1Service } from '../src/statlocker-adaptive/build-strategy-mining-pipeline-v1.service';
import { RecommendationEconomyRulesV1 } from '../src/statlocker-adaptive/adaptive-economy-v1';

const graph = createRecommendationItemGraph([
  { itemId: 1, name: 'Core', slotType: 'weapon', active: false, availableRulesetIds: ['r1'], directPurchaseCost: 800, upgradeRecipes: [], sellTransition: { soulsRefund: 400, returnedItemIds: [] } },
]);
const economyRules: RecommendationEconomyRulesV1 = {
  rulesetId: 'r1', catalogSha256: 'a'.repeat(64), baseSlots: 12,
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 }, maxFlexSlots: 4, maxActiveItems: 4,
  investmentBreakpoints: { weapon: [1600], vitality: [1600], spirit: [1600] },
};
const trajectory = (id: string) => ({ traceId: id, traceSha256: id.padEnd(64, 'a').slice(0, 64) }) as any;
const archetype = { archetypeId: 'a', memberTraceIds: ['t1', 't2', 't3'] } as any;
const spec = { strategyId: 's1', heroId: 1, rulesetId: 'r1', sourcePatchId: 'p1' } as any;

describe('build strategy mining pipeline v1', () => {
  it('publishes only after trajectory mining, compilation and feasibility gates pass', async () => {
    const source = { load: jest.fn(async () => ({ trajectories: [trajectory('t1'), trajectory('t2'), trajectory('t3')], rejected: [] })) } as any;
    const miner = { mine: jest.fn(() => ({ archetypes: [archetype], noiseTraceIds: [], traceCount: 3, pairwiseDistances: {} })) } as any;
    const compiler = { compile: jest.fn(() => spec) } as any;
    const feasibility = { validate: jest.fn(() => ({ feasible: true, actionIds: ['BUY_ITEM:1'], finalItemIds: [1], reasonCodes: ['ALL_MANDATORY_GOALS_REACHABLE'] })) } as any;
    const store = { publish: jest.fn(async () => undefined) } as any;
    const pipeline = new BuildStrategyMiningPipelineV1Service(source, miner, compiler, feasibility, store);

    const result = await pipeline.run({
      heroId: 1,
      patchId: 'p1',
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      catalogClientVersion: 123,
      itemGraph: graph,
      economyRules,
      minClusterSize: 3,
    });

    expect(result.published).toBe(true);
    expect(result.strategyCount).toBe(1);
    expect(store.publish).toHaveBeenCalledTimes(1);
    expect(store.publish.mock.calls[0][0]).toMatchObject({
      rulesetId: 'r1',
      patchId: 'p1',
      catalogSha256: 'a'.repeat(64),
      specs: [spec],
    });
    expect(store.publish.mock.calls[0][0].sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed and does not publish when any compiled archetype is unreachable', async () => {
    const source = { load: jest.fn(async () => ({ trajectories: [trajectory('t1'), trajectory('t2'), trajectory('t3')], rejected: [] })) } as any;
    const miner = { mine: jest.fn(() => ({ archetypes: [archetype], noiseTraceIds: [], traceCount: 3, pairwiseDistances: {} })) } as any;
    const compiler = { compile: jest.fn(() => spec) } as any;
    const feasibility = { validate: jest.fn(() => ({ feasible: false, failedGoalId: 'g1', actionIds: [], finalItemIds: [], reasonCodes: ['MANDATORY_GOAL_UNREACHABLE'] })) } as any;
    const store = { publish: jest.fn(async () => undefined) } as any;
    const pipeline = new BuildStrategyMiningPipelineV1Service(source, miner, compiler, feasibility, store);

    const result = await pipeline.run({
      heroId: 1,
      patchId: 'p1',
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      catalogClientVersion: 123,
      itemGraph: graph,
      economyRules,
    });

    expect(result.published).toBe(false);
    expect(result.reasonCodes).toContain('COMPILED_STRATEGY_UNREACHABLE');
    expect(store.publish).not.toHaveBeenCalled();
  });

  it('forwards the exact catalog client version to historical trajectory provenance checks', async () => {
    const source = { load: jest.fn(async () => ({ trajectories: [], rejected: [] })) } as any;
    const pipeline = new BuildStrategyMiningPipelineV1Service(
      source,
      { mine: jest.fn() } as any,
      { compile: jest.fn() } as any,
      { validate: jest.fn() } as any,
      { publish: jest.fn() } as any,
    );

    await pipeline.run({
      heroId: 1,
      patchId: 'p1',
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      catalogClientVersion: 123,
      itemGraph: graph,
      economyRules,
    });

    expect(source.load).toHaveBeenCalledWith(expect.objectContaining({
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      catalogClientVersion: 123,
    }));
  });
});
