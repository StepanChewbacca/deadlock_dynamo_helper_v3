import {
  createLiveBuildExposurePayload,
  LiveBuildExposureAcknowledger,
} from './live-build-exposure-ack';
import { LiveBuildRecommendationSnapshot } from './live-build-recommendation-poller';

function readySnapshot(): LiveBuildRecommendationSnapshot {
  return {
    state: 'READY',
    matchId: 'match-1',
    steamId: '76561198000000001',
    heroId: 35,
    itemIds: [100],
    alliedHeroIds: [],
    enemyHeroIds: [],
    previousActionKeys: [],
    decisionId: 'decision-1',
    isStale: false,
    recommendation: {
      mode: 'EXACT',
      action: action('BUY:200', 200),
      alternatives: [
        action('BUY:201', 201),
        action('BUY:202', 202),
        action('BUY:203', 203),
        action('BUY:204', 204),
        action('BUY:205', 205),
      ],
    },
    refreshCount: 1,
    cacheHitCount: 0,
    discardedResultCount: 0,
    lastObservedAt: new Date(0).toISOString(),
  };
}

function action(actionKey: string, itemId: number) {
  return {
    type: 'BUY' as const,
    itemId,
    actionKey,
    label: actionKey,
    confidencePercent: 50,
    historicalProbabilityPercent: 50,
    typicalGameTimeLabel: '07:00',
    explanation: {
      code: 'FIXTURE',
      evidenceLevel: 'OBSERVED' as const,
      text: 'fixture',
    },
  };
}

describe('live build exposure acknowledgement', () => {
  it('serializes only actions that the in-game HUD actually renders', () => {
    expect(createLiveBuildExposurePayload(readySnapshot(), 1234)).toEqual({
      decisionId: 'decision-1',
      matchId: 'match-1',
      steamId: '76561198000000001',
      exposedActionKeys: ['BUY:200', 'BUY:201', 'BUY:202', 'BUY:203', 'BUY:204'],
      acknowledgedAtMs: 1234,
      surface: 'IN_GAME',
    });
  });

  it('does not acknowledge snapshots that were not renderable recommendations', () => {
    const waiting = readySnapshot();
    waiting.state = 'REFRESHING';
    expect(createLiveBuildExposurePayload(waiting, 1234)).toBeUndefined();

    const missingDecision = readySnapshot();
    delete missingDecision.decisionId;
    expect(createLiveBuildExposurePayload(missingDecision, 1234)).toBeUndefined();
  });

  it('posts once per rendered decision and deduplicates repeated renders', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const acknowledger = new LiveBuildExposureAcknowledger({
      apiBaseUrl: 'https://api.example.test/',
      fetchImpl,
      nowMs: () => 5000,
    });

    expect(await acknowledger.acknowledgeRendered(readySnapshot())).toBe(true);
    expect(await acknowledger.acknowledgeRendered(readySnapshot())).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requests[0].url).toBe(
      'https://api.example.test/deadlock/analysis/recommendation-telemetry/exposure',
    );
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({
      decisionId: 'decision-1',
      acknowledgedAtMs: 5000,
      surface: 'IN_GAME',
    });
  });

  it('retries after a failed acknowledgement instead of marking it exposed', async () => {
    let attempts = 0;
    const fetchImpl = jest.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response('', { status: 503 });
      }
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const acknowledger = new LiveBuildExposureAcknowledger({
      fetchImpl,
      nowMs: () => 5000,
    });

    await expect(acknowledger.acknowledgeRendered(readySnapshot())).rejects.toThrow(
      'HTTP 503',
    );
    expect(await acknowledger.acknowledgeRendered(readySnapshot())).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
