import { BadRequestException } from '@nestjs/common';
import { AdaptiveRecommendationV1Controller } from '../src/statlocker-adaptive/adaptive-recommendation-v1.controller';

const recommendation = {
  ready: true,
  blockers: [],
  decisionId: 'decision-a',
  stateRevision: 'revision-a',
  gameState: 'EVEN',
  nextAction: { actionKey: 'WAIT', type: 'WAIT', reasonCodes: [] },
  recommendedBuild: [],
  changes: [],
  rankedImmediateCandidates: [],
  totalScore: 0,
  confidence: 0.5,
  scorerVersion: 'adaptive-evidence-scorer-v1',
  plannerVersion: 'adaptive-build-planner-v1',
  configVersion: 'statlocker-adaptive-v1.0.0',
  evidence: {
    rulesetVersion: 'ruleset-a',
    catalogSha256: 'a'.repeat(64),
    statlockerPatchId: '15-1',
    snapshotIds: ['snapshot-a'],
    families: [],
    degradedReasons: [],
  },
};

function harness() {
  const service = { recommend: jest.fn().mockResolvedValue(recommendation) };
  const refresh = {
    getStatus: jest.fn(() => ({
      activeHeroIds: [10],
      inFlightKeys: [],
      lastAttemptAt: '2026-08-31T12:00:00.000Z',
      lastSuccessAt: '2026-08-31T12:00:01.000Z',
      identity: { rulesetVersion: 'ruleset-a', catalogSha256: 'a'.repeat(64) },
    })),
  };
  const evidence = {
    getLocalStatus: jest.fn(() => ({
      statlockerPatchId: '15-1',
      activeSnapshotIds: ['snapshot-a'],
      families: [{
        dataset: 'WPA_PATCH_DATA',
        scopeKey: 'patch:15-1',
        snapshotId: 'snapshot-a',
        freshness: 'FRESH',
        fetchedAt: '2026-08-31T12:00:00.000Z',
      }],
    })),
  };
  return {
    controller: new AdaptiveRecommendationV1Controller(service as any, refresh as any, evidence as any),
    service,
    refresh,
    evidence,
  };
}

describe('AdaptiveRecommendationV1Controller', () => {
  it('rejects an invalid recommendation request', async () => {
    const h = harness();
    await expect(h.controller.recommend({ matchId: '' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.service.recommend).not.toHaveBeenCalled();
  });

  it('returns the typed adaptive recommendation response', async () => {
    const h = harness();
    const result = await h.controller.recommend({ matchId: 'match-a', localSteamId: 'steam-a' });
    expect(result).toEqual(recommendation);
    expect(h.service.recommend).toHaveBeenCalledWith({ matchId: 'match-a', localSteamId: 'steam-a' });
  });

  it('returns local refresh and evidence status without browser/session material', () => {
    const h = harness();
    const status = h.controller.status();
    expect(status.refresh.activeHeroIds).toEqual([10]);
    expect(status.rulesetVersion).toBe('ruleset-a');
    expect(status.catalogSha256).toBe('a'.repeat(64));
    expect(status.statlockerPatchId).toBe('15-1');
    expect(status.activeSnapshotIds).toEqual(['snapshot-a']);
    expect(status.families[0].freshness).toBe('FRESH');
    expect(JSON.stringify(status)).not.toMatch(/cookie|localStorage|authorization|apiKey|headers/i);
  });
});
