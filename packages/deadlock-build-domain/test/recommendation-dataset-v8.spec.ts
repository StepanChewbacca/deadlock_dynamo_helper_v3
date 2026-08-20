import {
  buildRecommendationDatasetDecisionV8,
  auditRecommendationDatasetV8,
  createRecommendationItemGraph,
  generateRecommendationCandidates,
  observedFact,
  RecommendationDecisionState,
  RecommendationItemDefinition,
  toRecommendationDatasetCandidateV1,
} from '../src';

function sourceDecision(decisionId: string, matchId: string, itemId: number) {
  const definitions: RecommendationItemDefinition[] = [{
    itemId,
    name: `Item ${itemId}`,
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
    decisionId,
    matchId,
    playerSlot: 1,
    gameTimeSec: 100,
    rulesetId: 'r1',
    heroId: 1,
    inventory: {
      initializedFromSnapshot: true,
      heldByItemId: new Map(),
      lifecycleCountByItemId: new Map(),
      nextInstanceSequence: 1,
    },
    economy: {
      spendableSouls: observedFact(1_000, 'test'),
      shopOpportunity: observedFact('AVAILABLE', 'test'),
    },
  };
  const candidates = generateRecommendationCandidates({ state, itemGraph: graph })
    .map((candidate) => toRecommendationDatasetCandidateV1(state, candidate));
  return { state, candidates };
}

describe('recommendation Dataset V8', () => {
  it('constructs the behavioral choice set before matching the observed label', () => {
    const source = sourceDecision('d1', 'm1', 1);
    const row = buildRecommendationDatasetDecisionV8({
      decisionId: source.state.decisionId,
      matchId: source.state.matchId,
      playerKey: 'player-1',
      heroId: 1,
      decisionAtMs: 10_000,
      gameTimeSec: 100,
      latestStateSourceAtMs: 9_900,
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      candidateGeneratorVersion: 'candidate-v1',
      split: 'TRAIN',
      candidates: source.candidates,
      observedAction: { actionKey: 'BUY_ITEM:1', occurredAtMs: 10_100, source: 'inventory-diff' },
      cohortKeys: ['hero:1', 'phase:early'],
    });

    expect(row.behavioralChoiceSetActionKeys).toContain('BUY_ITEM:1');
    expect(row.observedActionInjected).toBe(false);
    expect(row.observedActionInBehavioralChoiceSet).toBe(true);
  });

  it('fails audit when the observed action is outside the true feasible set', () => {
    const source = sourceDecision('d1', 'm1', 1);
    const row = buildRecommendationDatasetDecisionV8({
      decisionId: 'd1',
      matchId: 'm1',
      playerKey: 'player-1',
      heroId: 1,
      decisionAtMs: 10_000,
      gameTimeSec: 100,
      latestStateSourceAtMs: 9_900,
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      candidateGeneratorVersion: 'candidate-v1',
      split: 'TRAIN',
      candidates: source.candidates,
      observedAction: { actionKey: 'BUY_ITEM:999', occurredAtMs: 10_100, source: 'inventory-diff' },
    });

    const audit = auditRecommendationDatasetV8([row]);
    expect(audit.passed).toBe(false);
    expect(audit.candidateCoverage).toBe(0);
    expect(audit.errors.some((error) => error.startsWith('CANDIDATE_COVERAGE_BELOW_FLOOR'))).toBe(true);
  });

  it('detects match-level split leakage', () => {
    const sourceA = sourceDecision('d1', 'm1', 1);
    const sourceB = sourceDecision('d2', 'm1', 2);
    const common = {
      playerKey: 'player-1',
      heroId: 1,
      decisionAtMs: 10_000,
      gameTimeSec: 100,
      latestStateSourceAtMs: 9_900,
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      candidateGeneratorVersion: 'candidate-v1',
    } as const;
    const train = buildRecommendationDatasetDecisionV8({
      ...common,
      decisionId: 'd1',
      matchId: 'm1',
      split: 'TRAIN',
      candidates: sourceA.candidates,
    });
    const future = buildRecommendationDatasetDecisionV8({
      ...common,
      decisionId: 'd2',
      matchId: 'm1',
      split: 'FUTURE_TEST',
      candidates: sourceB.candidates,
    });

    expect(auditRecommendationDatasetV8([train, future]).errors).toContain('MATCH_SPLIT_LEAKAGE:m1');
  });

  it('keeps FUTURE_TEST untouched by default audit metrics', () => {
    const source = sourceDecision('d1', 'm2', 1);
    const future = buildRecommendationDatasetDecisionV8({
      decisionId: 'd1',
      matchId: 'm2',
      playerKey: 'player-1',
      heroId: 1,
      decisionAtMs: 10_000,
      gameTimeSec: 100,
      latestStateSourceAtMs: 9_900,
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      candidateGeneratorVersion: 'candidate-v1',
      split: 'FUTURE_TEST',
      candidates: source.candidates,
      observedAction: { actionKey: 'BUY_ITEM:999', occurredAtMs: 10_100, source: 'inventory-diff' },
    });

    const audit = auditRecommendationDatasetV8([future]);
    expect(audit.futureTestEvaluated).toBe(false);
    expect(audit.labeledDecisionCount).toBe(0);
    expect(audit.futureTestDecisionCount).toBe(1);
  });
});
