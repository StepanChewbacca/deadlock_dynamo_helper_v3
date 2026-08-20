import { hasRenderedLiveBuildRecommendation } from './live-build-exposure-entry';
import { LiveBuildRecommendationSnapshot } from './live-build-recommendation-poller';

function readySnapshot(): LiveBuildRecommendationSnapshot {
  return {
    state: 'READY',
    matchId: 'match-1',
    steamId: '76561198000000001',
    heroId: 35,
    itemIds: [],
    alliedHeroIds: [],
    enemyHeroIds: [],
    previousActionKeys: [],
    decisionId: 'decision-1',
    isStale: false,
    recommendation: {
      mode: 'EXACT',
      action: {
        type: 'BUY',
        itemId: 100,
        actionKey: 'BUY:100',
        label: 'Buy fixture',
        confidencePercent: 50,
        historicalProbabilityPercent: 50,
        typicalGameTimeLabel: '05:00',
        explanation: {
          code: 'FIXTURE',
          evidenceLevel: 'OBSERVED',
          text: 'fixture',
        },
      },
      alternatives: [],
    },
    refreshCount: 1,
    cacheHitCount: 0,
    discardedResultCount: 0,
    lastObservedAt: new Date(0).toISOString(),
  };
}

describe('hasRenderedLiveBuildRecommendation', () => {
  it('requires a visible recommendation panel with a rendered primary card', () => {
    const panel = {
      style: { display: 'flex' },
      querySelector: jest.fn((selector: string) =>
        selector === '.live-build-primary' ? {} : null,
      ),
    };
    const renderDocument = {
      getElementById: jest.fn(() => panel),
    };

    expect(
      hasRenderedLiveBuildRecommendation(readySnapshot(), renderDocument),
    ).toBe(true);
  });

  it('rejects hidden, missing, or incomplete DOM renders', () => {
    const snapshot = readySnapshot();

    expect(
      hasRenderedLiveBuildRecommendation(snapshot, {
        getElementById: () => null,
      }),
    ).toBe(false);
    expect(
      hasRenderedLiveBuildRecommendation(snapshot, {
        getElementById: () => ({
          style: { display: 'none' },
          querySelector: () => ({}),
        }),
      }),
    ).toBe(false);
    expect(
      hasRenderedLiveBuildRecommendation(snapshot, {
        getElementById: () => ({
          style: { display: 'flex' },
          querySelector: () => null,
        }),
      }),
    ).toBe(false);
  });

  it('rejects non-ready or identity-incomplete recommendation snapshots', () => {
    const panelDocument = {
      getElementById: () => ({
        style: { display: 'flex' },
        querySelector: () => ({}),
      }),
    };
    const refreshing = readySnapshot();
    refreshing.state = 'REFRESHING';
    expect(hasRenderedLiveBuildRecommendation(refreshing, panelDocument)).toBe(false);

    const missingDecision = readySnapshot();
    delete missingDecision.decisionId;
    expect(hasRenderedLiveBuildRecommendation(missingDecision, panelDocument)).toBe(false);
  });
});
