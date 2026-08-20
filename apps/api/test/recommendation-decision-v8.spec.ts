import {
  RecommendationDecisionState,
  RecommendationItemDefinition,
  buildInventoryInstancesForRecommendation,
  createRecommendationItemGraph,
  observedFact,
} from '@deadlock-live-probe/build-domain';
import {
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  assignRecommendationExperimentByMatchV1,
  createRecommendationBehavioralV8LinearModel,
  validateRecommendationDecisionEventV8,
} from '@deadlock-live-probe/shared';
import { RecommendationDecisionV8Service } from '../src/deadlock-live/recommendation-decision-v8.service';
import { RecommendationEngineV8Service } from '../src/deadlock-live/recommendation-engine-v8.service';

function fixture() {
  const definitions: RecommendationItemDefinition[] = [{
    itemId: 1,
    name: 'Item 1',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
    maxCopies: 1,
  }];
  const graph = createRecommendationItemGraph(definitions);
  const state: RecommendationDecisionState = {
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
      spendableSouls: observedFact(1_000, 'verified-wallet'),
      shopOpportunity: observedFact('AVAILABLE', 'shop-signal'),
    },
  };
  const featureState = {
    contractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
    decisionId: 'd1',
    matchId: 'm1',
    playerKey: 'player-key',
    decisionAtMs: 10_000,
    stateSourceAtMs: 9_900,
    gameTimeSec: 100,
    heroId: 1,
    verifiedSpendableSouls: 1_000,
    spendableSoulsVerificationContract: 'souls-affordability-v1:PASS',
    shopOpportunity: 'AVAILABLE' as const,
    inventorySnapshotSha256: 'a'.repeat(64),
    inventory: [],
    history: [],
    rulesetVersion: 'r1',
    catalogSha256: 'b'.repeat(64),
  };
  return { graph, state, featureState };
}

function requestBase() {
  const data = fixture();
  return {
    ...data,
    eventId: 'evt-d1',
    playerKey: 'player-key',
    source: 'RECOMMENDATION_ENGINE',
    sourceOccurredAtMs: 10_000,
    receivedAtMs: 10_010,
    stateRevision: 'state-r1',
    candidateGeneratorVersion: 'candidate-v1',
    modelVersion: 'behavioral-linear-v1',
    versions: {
      client: 'client-1',
      gep: 'gep-1',
      normalizer: 'gep-canonical-v2',
      ruleset: 'r1',
      catalogSha256: 'b'.repeat(64),
    },
    quality: {
      directlyObserved: true,
      reconstructed: false,
      stale: false,
      alignmentAgeMs: 100,
    },
    behavioralModel: createRecommendationBehavioralV8LinearModel(
      'behavioral-linear-v1',
      RECOMMENDATION_FEATURE_CONTRACT_VERSION,
      1024,
    ),
    runtimeMode: 'SHADOW' as const,
    observabilityGatePassed: true,
    modelRuntimeCompatible: true,
    shadowGatePassed: false,
    selectionMode: 'DETERMINISTIC' as const,
  };
}

describe('RecommendationDecisionV8Service', () => {
  const service = new RecommendationDecisionV8Service(new RecommendationEngineV8Service());

  it('creates a valid shadow decision with deterministic action logging propensity', () => {
    const request = requestBase();
    const experiment = assignRecommendationExperimentByMatchV1('control', 'm1', [
      { arm: 'CONTROL', probability: 1 },
    ]);
    const result = service.createDecision({ ...request, experiment });

    expect(result.userVisibleActionKey).toBeUndefined();
    expect(result.event.payload.actionLoggingPropensity).toBe(1);
    expect(result.event.payload.experiment.armAssignmentPropensity).toBe(1);
    expect(result.event.payload.observedActionInjected).toBe(false);
    expect(validateRecommendationDecisionEventV8(result.event)).toEqual({ valid: true, errors: [] });
  });

  it('records exact safe-exploration action propensity separately from arm propensity', () => {
    const request = requestBase();
    const experiment = assignRecommendationExperimentByMatchV1('exp-1', 'm1', [
      { arm: 'EXPLORE', probability: 0.5 },
      { arm: 'CONTROL', probability: 0.5 },
    ]);
    const result = service.createDecision({
      ...request,
      experiment,
      selectionMode: 'SAFE_EXPLORATION',
      explorationProbabilityByActionKey: {
        'BUY_ITEM:1': 0.5,
        WAIT_SAVE: 0.5,
      },
    });

    expect(result.event.payload.actionLoggingPropensity).toBe(0.5);
    expect(result.event.payload.experiment.armAssignmentPropensity).toBe(0.5);
    expect(validateRecommendationDecisionEventV8(result.event).valid).toBe(true);
  });

  it('fails closed to WAIT_SAVE when observability is not ready', () => {
    const request = requestBase();
    const experiment = assignRecommendationExperimentByMatchV1('control', 'm1', [
      { arm: 'CONTROL', probability: 1 },
    ]);
    const result = service.createDecision({
      ...request,
      experiment,
      runtimeMode: 'LIVE',
      observabilityGatePassed: false,
      shadowGatePassed: true,
    });

    expect(result.event.payload.selectedActionKey).toBe('WAIT_SAVE');
    expect(result.userVisibleActionKey).toBe('WAIT_SAVE');
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReasons).toContain('OBSERVABILITY_GATE_NOT_PASS');
  });
});
