import { buildAdaptiveRecommendationPresentation } from './adaptive-recommendation-presentation';

function base(overrides: Record<string, unknown> = {}): any {
  return {
    ready: true, blockers: [], decisionId: 'd', stateRevision: 'r', gameState: 'EVEN',
    nextAction: { actionKey: 'BUY_ITEM:3862866912', type: 'BUY', buyItemId: 3862866912, targetItemId: 3862866912, reasonCodes: [] },
    planActions: [{ planActionId: 'p1', sequence: 1, status: 'READY', action: { actionKey: 'BUY_ITEM:3862866912', type: 'BUY', buyItemId: 3862866912, targetItemId: 3862866912, reasonCodes: [] }, targetItemId: 3862866912, sourceItemIds: [], requirements: [], reasonCodes: [] }],
    recommendedBuild: [], changes: [], rankedImmediateCandidates: [], totalScore: 0, confidence: .8,
    scorerVersion: 's', plannerVersion: 'p', configVersion: 'c', plannerMethod: 'STRATEGY_FIRST',
    evidence: { rulesetVersion: 'r', catalogSha256: 'a'.repeat(64), snapshotIds: [], families: [], degradedReasons: [] },
    ...overrides,
  };
}

describe('adaptive transaction plan presentation', () => {
  it('renders canonical semantic plan actions', () => {
    const view = buildAdaptiveRecommendationPresentation(base());
    expect(view.plan.items).toHaveLength(1);
    expect(view.plan.items[0].statusLabel).toBe('Ready');
  });

  it('does not infer a plan from recommendedBuild when semantic actions are absent', () => {
    const view = buildAdaptiveRecommendationPresentation(base({ planActions: undefined, recommendedBuild: [{ itemId: 3862866912, position: 1, status: 'NEXT', score: 0, confidence: 0, skeletonStrength: 0, contextualSupport: 0, reasonCodes: [] }] }));
    expect(view.plan.items).toEqual([]);
  });
});
