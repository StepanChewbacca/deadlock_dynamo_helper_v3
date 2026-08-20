import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RecommendationDecisionTelemetryContext,
  RecommendationDecisionTelemetryService,
} from '../src/deadlock-live/recommendation-decision-telemetry.service';
import {
  HeroBuildRecommendationAction,
  HeroBuildRecommendationResponse,
} from '../src/deadlock-live/hero-build-recommendation.service';

describe('RecommendationDecisionTelemetryService exposure acknowledgement', () => {
  let outputDirectory = '';
  let previousOutputDirectory: string | undefined;

  beforeEach(async () => {
    previousOutputDirectory =
      process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR;
    outputDirectory = await mkdtemp(
      join(tmpdir(), 'deadlock-recommendation-exposure-'),
    );
    process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR = outputDirectory;
  });

  afterEach(async () => {
    if (previousOutputDirectory === undefined) {
      delete process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR;
    } else {
      process.env.DEADLOCK_RECOMMENDATION_TELEMETRY_DIR =
        previousOutputDirectory;
    }
    await rm(outputDirectory, { recursive: true, force: true });
  });

  it('records one exposure per decision surface and persists it', async () => {
    const service = new RecommendationDecisionTelemetryService();
    await service.onModuleInit();
    const decisionId = service.recordDecision({
      context: decisionContext(),
      recommendation: recommendation(),
      elapsedMs: 10,
    });

    expect(
      service.recordDecisionExposure({
        decisionId,
        matchId: 'match-1',
        steamId: '76561198000000001',
        exposedActionKeys: ['BUY:100', 'BUY:101'],
        acknowledgedAtMs: 5000,
        surface: 'IN_GAME',
      }),
    ).toBe(true);
    expect(
      service.recordDecisionExposure({
        decisionId,
        matchId: 'match-1',
        steamId: '76561198000000001',
        exposedActionKeys: ['BUY:100'],
        acknowledgedAtMs: 5001,
        surface: 'IN_GAME',
      }),
    ).toBe(false);

    await service.waitForIdle();
    expect(service.getStatus()).toMatchObject({
      decisionCount: 1,
      exposedDecisionCount: 1,
      writeErrorCount: 0,
    });

    const replayed = new RecommendationDecisionTelemetryService();
    await replayed.onModuleInit();
    expect(replayed.getStatus()).toMatchObject({
      decisionCount: 1,
      exposedDecisionCount: 1,
      writeErrorCount: 0,
    });
  });

  it('rejects exposure actions outside the served candidate set', async () => {
    const service = new RecommendationDecisionTelemetryService();
    await service.onModuleInit();
    const decisionId = service.recordDecision({
      context: decisionContext(),
      recommendation: recommendation(),
      elapsedMs: 10,
    });

    expect(() =>
      service.recordDecisionExposure({
        decisionId,
        matchId: 'match-1',
        steamId: '76561198000000001',
        exposedActionKeys: ['BUY:999'],
        acknowledgedAtMs: 5000,
        surface: 'IN_GAME',
      }),
    ).toThrow('was not in the served candidate set');
  });

  it('rejects exposure identity mismatches', async () => {
    const service = new RecommendationDecisionTelemetryService();
    await service.onModuleInit();
    const decisionId = service.recordDecision({
      context: decisionContext(),
      recommendation: recommendation(),
      elapsedMs: 10,
    });

    expect(() =>
      service.recordDecisionExposure({
        decisionId,
        matchId: 'another-match',
        steamId: '76561198000000001',
        exposedActionKeys: ['BUY:100'],
        acknowledgedAtMs: 5000,
        surface: 'IN_GAME',
      }),
    ).toThrow('identity does not match');
  });
});

function decisionContext(): RecommendationDecisionTelemetryContext {
  return {
    matchId: 'match-1',
    steamId: '76561198000000001',
    heroId: 35,
    teamId: 2,
    itemIds: [],
    alliedHeroIds: [],
    enemyHeroIds: [],
    previousActionKeys: [],
    inventoryStateKey: 'empty',
    gameTimeS: 420,
    timeBucket: 3,
    traversalKey: 'fixture-traversal',
  };
}

function recommendation(): HeroBuildRecommendationResponse {
  return {
    mode: 'EXACT',
    heroId: 35,
    requestedStateKey: 'empty',
    gameTimeS: 420,
    matchedStateKey: 'empty',
    observationCount: 10,
    candidateStateCount: 1,
    action: action('BUY:100', 100),
    alternatives: [action('BUY:101', 101)],
  };
}

function action(
  actionKey: string,
  itemId: number,
): HeroBuildRecommendationAction {
  return {
    type: 'BUY',
    itemId,
    actionKey,
    historicalCount: 10,
    historicalProbability: 0.5,
    averageGameTimeS: 420,
    matchedStateKey: 'empty',
    matchedStateObservationCount: 10,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: false,
    predictedStateKey: `${itemId}:1`,
    score: 1,
    confidence: 0.5,
  };
}
