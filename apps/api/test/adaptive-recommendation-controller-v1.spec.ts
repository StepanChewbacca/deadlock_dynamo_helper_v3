import { BadRequestException } from '@nestjs/common';
import { AdaptiveRecommendationV1Controller } from '../src/statlocker-adaptive/adaptive-recommendation-v1.controller';
import { AdaptiveLiveStateNotReadyError } from '../src/statlocker-adaptive/adaptive-decision-state-v1.service';
import { AdaptiveRecommendationObservabilityV1Service } from '../src/statlocker-adaptive/adaptive-recommendation-observability-v1.service';

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
  const observability = new AdaptiveRecommendationObservabilityV1Service();
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
  const strategyPromotion = {
    status: jest.fn(() => ({ allowed: false })),
    transactionStatus: jest.fn(() => ({ allowed: false })),
  };
  const strategyOperations = {
    getStatus: jest.fn(() => ({
      inFlightKeys: [],
      bootstrapEconomyRulesCount: 0,
      lastMineByHero: {
        [`10:ruleset-a:${'a'.repeat(64)}`]: {
          attempted: true,
          published: false,
          reasonCodes: ['NO_ACCEPTED_HISTORICAL_TRAJECTORIES'],
          pipeline: {
            published: false,
            sourceTraceCount: 0,
            rejectedTraceCount: 3,
            noiseTraceCount: 0,
            archetypeCount: 0,
            strategyCount: 0,
            rejectionReasonCounts: {
              HISTORICAL_PROVENANCE_MISSING: 1,
              UNKNOWN_ITEM: 2,
            },
            reasonCodes: ['NO_ACCEPTED_HISTORICAL_TRAJECTORIES'],
          },
        },
      },
    })),
  };
  return {
    controller: new AdaptiveRecommendationV1Controller(
      service as any,
      refresh as any,
      evidence as any,
      observability,
      strategyPromotion as any,
      strategyOperations as any,
    ),
    service,
    refresh,
    evidence,
    observability,
    strategyPromotion,
    strategyOperations,
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

  it('returns a retryable waiting result while the live player state is still arriving', async () => {
    const h = harness();
    h.service.recommend.mockRejectedValueOnce(
      new AdaptiveLiveStateNotReadyError('match-a', 'LOCAL_PLAYER_UNRESOLVED'),
    );

    await expect(h.controller.recommend({ matchId: 'match-a' })).resolves.toEqual(expect.objectContaining({
      ready: false,
      blockers: ['LIVE_STATE_NOT_READY', 'LOCAL_PLAYER_UNRESOLVED'],
      decisionId: 'pending:match-a',
      gameState: 'UNKNOWN',
      nextAction: expect.objectContaining({ actionKey: 'HOLD', type: 'HOLD' }),
    }));
  });

  it('returns local refresh and evidence status without browser/session material', () => {
    const h = harness();
    const status = h.controller.status();
    expect(status.refresh.activeHeroIds).toEqual([10]);
    expect(status.observability.counters.evidenceFallbackCount).toBe(0);
    expect(status.rulesetVersion).toBe('ruleset-a');
    expect(status.catalogSha256).toBe('a'.repeat(64));
    expect(status.statlockerPatchId).toBe('15-1');
    expect(status.activeSnapshotIds).toEqual(['snapshot-a']);
    expect(status.families[0].freshness).toBe('FRESH');
    expect(status.strategyOperations.lastMineByHero[`10:ruleset-a:${'a'.repeat(64)}`].pipeline)
      .toMatchObject({
        rejectedTraceCount: 3,
        rejectionReasonCounts: {
          HISTORICAL_PROVENANCE_MISSING: 1,
          UNKNOWN_ITEM: 2,
        },
      });
    expect(JSON.stringify(status)).not.toMatch(/cookie|localStorage|authorization|apiKey|headers/i);
    expect(JSON.stringify(status)).not.toMatch(/match-|player:|900|901/);
  });
});
