import { RecommendationReadinessV8Service } from '../src/deadlock-live/recommendation-readiness-v8.service';

const servingIdentity = {
  contractVersion: 'recommendation-behavioral-serving-ready-v1' as const,
  ready: true as const,
  modelId: 'deadlock-buildlm-behavioral-v8',
  modelVersion: 'behavioral-v8-1',
  manifestSha256: 'a'.repeat(64),
  family: 'SEQUENCE_TRANSFORMER' as const,
  featureContractVersion: 'recommendation-features-v8',
  candidateGeneratorVersion: 'candidate-v1',
  device: 'cuda:0',
  futureTestEvaluated: false as const,
};

function dataSource(activeExactCount = 1) {
  return {
    query: jest.fn(async (sql: string, params: readonly unknown[] = []) => {
      if (sql === 'SELECT 1') return [{ ok: 1 }];
      if (sql.includes('FROM recommendation_item_catalog_versions_v8')) return [{ count: 1 }];
      if (sql.includes('RECOMMENDATION_RUNTIME_HEALTH')) return [{ count: 1 }];
      if (sql.includes('MAX("decidedAt")')) return [{ timestamp: '2026-08-22T00:00:00.000Z' }];
      if (sql.includes('FROM model_bundle_registry_v1')) {
        expect(params).toEqual([
          servingIdentity.modelId,
          servingIdentity.modelVersion,
          servingIdentity.manifestSha256,
        ]);
        expect(sql).toContain("manifest->>'modelKind' = 'BEHAVIORAL'");
        expect(sql).toContain('verification IS NOT NULL');
        return [{ count: activeExactCount }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

describe('RecommendationReadinessV8Service', () => {
  it('reports ready only when the exact verified ACTIVE Behavioral bundle is loaded by serving', async () => {
    const db = dataSource(1);
    const serving = {
      configured: jest.fn(() => true),
      ready: jest.fn(async () => servingIdentity),
    };
    const service = new RecommendationReadinessV8Service(db as never, serving as never);

    const report = await service.recommendationReady();

    expect(report.ready).toBe(true);
    expect(report.verifiedActiveModelAvailable).toBe(true);
    expect(report.behavioralServingReady).toBe(true);
    expect(report.exactActiveBehavioralBundleLoaded).toBe(true);
    expect(report.loadedBehavioralManifestSha256).toBe(servingIdentity.manifestSha256);
    expect(report.blockers).toEqual([]);
  });

  it('fails closed when serving is healthy but loaded bytes do not match the ACTIVE registry manifest', async () => {
    const db = dataSource(0);
    const serving = {
      configured: jest.fn(() => true),
      ready: jest.fn(async () => servingIdentity),
    };
    const service = new RecommendationReadinessV8Service(db as never, serving as never);

    const report = await service.recommendationReady();

    expect(report.ready).toBe(false);
    expect(report.behavioralServingReady).toBe(true);
    expect(report.exactActiveBehavioralBundleLoaded).toBe(false);
    expect(report.verifiedActiveModelAvailable).toBe(false);
    expect(report.blockers).toContain('BEHAVIORAL_SERVING_ACTIVE_BUNDLE_MISMATCH');
  });

  it('keeps deterministic degraded mode available before any trained model is configured', async () => {
    const db = dataSource(0);
    const serving = {
      configured: jest.fn(() => false),
      ready: jest.fn(),
    };
    const service = new RecommendationReadinessV8Service(db as never, serving as never);

    const normal = await service.recommendationReady();
    const degraded = await service.recommendationDegraded();

    expect(normal.ready).toBe(false);
    expect(normal.degradedAvailable).toBe(true);
    expect(normal.blockers).toContain('BEHAVIORAL_SERVING_NOT_CONFIGURED');
    expect(degraded.ready).toBe(true);
    expect(degraded.blockers).toEqual([]);
    expect(serving.ready).not.toHaveBeenCalled();
  });

  it('does not claim degraded availability when the database is unreachable', async () => {
    const db = {
      query: jest.fn(async () => { throw new Error('database offline'); }),
    };
    const serving = { configured: jest.fn(() => false), ready: jest.fn() };
    const service = new RecommendationReadinessV8Service(db as never, serving as never);

    const report = await service.recommendationReady();

    expect(report.ready).toBe(false);
    expect(report.degradedAvailable).toBe(false);
    expect(report.blockers).toEqual(['DATABASE_UNREACHABLE']);
  });
});
