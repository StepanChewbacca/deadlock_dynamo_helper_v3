import {
  RecommendationDecisionState,
  RecommendationItemDefinition,
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  observedFact,
  unknownFact,
} from '@deadlock-live-probe/build-domain';
import { RecommendationEngineV8Service } from '../src/deadlock-live/recommendation-engine-v8.service';

function item(itemId: number, overrides: Partial<RecommendationItemDefinition> = {}): RecommendationItemDefinition {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
    ...overrides,
  };
}

function decisionState(walletKnown = true): {
  state: RecommendationDecisionState;
  graph: ReturnType<typeof createRecommendationItemGraph>;
} {
  const graph = createRecommendationItemGraph([item(1)]);
  return {
    graph,
    state: {
      decisionId: 'd1',
      matchId: 'm1',
      playerSlot: 1,
      gameTimeSec: 100,
      rulesetId: 'r1',
      heroId: 1,
      inventory: {
        initializedFromSnapshot: true,
        heldByItemId: buildInventoryInstancesForRecommendation([], graph),
        lifecycleCountByItemId: new Map(),
        nextInstanceSequence: 1,
      },
      economy: {
        spendableSouls: walletKnown ? observedFact(1_000, 'fixture') : unknownFact('fixture'),
        shopOpportunity: observedFact('AVAILABLE', 'fixture'),
      },
    },
  };
}

describe('RecommendationEngineV8Service', () => {
  const service = new RecommendationEngineV8Service();

  it('maps deterministic domain candidates to replayable V8 telemetry candidates', () => {
    const input = decisionState(true);
    const result = service.evaluate({ state: input.state, itemGraph: input.graph });
    const buy = result.telemetryCandidates.find((candidate) => candidate.actionKey === 'BUY_ITEM:1');

    expect(buy).toMatchObject({
      actionType: 'BUY_ITEM',
      targetItemId: 1,
      effectiveCostSouls: 800,
      spendableSoulsAfter: 200,
      feasible: true,
      affordable: true,
      slotLegal: true,
      recipeLegal: true,
      shopLegal: true,
      rulesetLegal: true,
      transactionMechanicsKnown: true,
      evidence: {
        spendableSouls: 'OBSERVED',
        shopOpportunity: 'OBSERVED',
        inventory: 'OBSERVED',
      },
    });
  });

  it('never turns unknown wallet state into an affordable purchase', () => {
    const input = decisionState(false);
    const result = service.evaluate({ state: input.state, itemGraph: input.graph });
    const buy = result.telemetryCandidates.find((candidate) => candidate.actionKey === 'BUY_ITEM:1');

    expect(buy?.feasible).toBe(false);
    expect(buy?.affordable).toBe('UNKNOWN');
    expect(buy?.feasibilityReasons).toContain('SPENDABLE_SOULS_UNKNOWN');
    expect(buy?.evidence.spendableSouls).toBe('UNKNOWN');
  });
});
