import { StatlockerEvidenceService } from '../src/statlocker-adaptive/statlocker-evidence.service';

const catalogSha256 = 'a'.repeat(64);
const now = Date.parse('2026-08-31T12:00:00.000Z');

function row(dataset: string, scopeKey: string, ageMs: number, overrides: Record<string, unknown> = {}) {
  return {
    snapshotId: `${dataset}-${scopeKey}-${ageMs}`,
    dataset,
    rulesetVersion: 'ruleset-a',
    catalogSha256,
    statlockerPatchId: '15-1',
    scopeKey,
    fetchedAt: new Date(now - ageMs),
    contentSha256: 'b'.repeat(64),
    payload: { dataset, scopeKey },
    ...overrides,
  };
}

function service(rows: any[]) {
  const store = { listActive: jest.fn(() => rows) };
  const refresh = {
    observeGameIdentity: jest.fn(),
    enqueueHeroRefresh: jest.fn(),
    refreshGlobalNow: jest.fn().mockResolvedValue(undefined),
  };
  return { service: new StatlockerEvidenceService(store as any, refresh as any), refresh };
}

describe('StatlockerEvidenceService', () => {
  it('classifies fresh, stale usable and unavailable evidence by age', () => {
    const h = service([
      row('WPA_PATCH_DATA', 'patch:15-1', 5 * 60_000),
      row('VS_HERO_WPA', 'global', 45 * 60_000),
      row('T4_CHAINS', 'global', 10 * 60 * 60_000),
      row('CONSENSUS_SKELETON', 'hero:10:consensus', 10 * 60_000),
    ]);

    const bundle = h.service.getEvidence({
      heroId: 10,
      rulesetVersion: 'ruleset-a',
      catalogSha256,
      statlockerPatchId: '15-1',
      nowMs: now,
    });

    expect(bundle.byDataset.WPA_PATCH_DATA.freshness).toBe('FRESH');
    expect(bundle.byDataset.VS_HERO_WPA.freshness).toBe('STALE_USABLE');
    expect(bundle.byDataset.T4_CHAINS.freshness).toBe('UNAVAILABLE');
    expect(bundle.byDataset.VS_HERO_WPA.confidence).toBeLessThan(bundle.byDataset.WPA_PATCH_DATA.confidence);
    expect(bundle.snapshotIds).toEqual([...bundle.snapshotIds].sort());
  });

  it('marks incompatible ruleset or catalog evidence as PATCH_MISMATCH and excludes payload', () => {
    const h = service([
      row('WPA_PATCH_DATA', 'patch:15-1', 5 * 60_000, { rulesetVersion: 'ruleset-old' }),
      row('VS_HERO_WPA', 'global', 5 * 60_000, { catalogSha256: 'c'.repeat(64) }),
    ]);

    const bundle = h.service.getEvidence({
      heroId: 10,
      rulesetVersion: 'ruleset-a',
      catalogSha256,
      statlockerPatchId: '15-1',
      nowMs: now,
    });

    expect(bundle.byDataset.WPA_PATCH_DATA.freshness).toBe('PATCH_MISMATCH');
    expect(bundle.byDataset.WPA_PATCH_DATA.payload).toBeUndefined();
    expect(bundle.byDataset.VS_HERO_WPA.freshness).toBe('PATCH_MISMATCH');
    expect(bundle.byDataset.VS_HERO_WPA.payload).toBeUndefined();
  });

  it('keeps partial evidence usable when one family is unavailable', () => {
    const h = service([
      row('WPA_PATCH_DATA', 'patch:15-1', 5 * 60_000),
      row('VS_HERO_WPA', 'global', 5 * 60_000),
      row('CONSENSUS_SKELETON', 'hero:10:consensus', 5 * 60_000),
    ]);

    const bundle = h.service.getEvidence({
      heroId: 10,
      rulesetVersion: 'ruleset-a',
      catalogSha256,
      statlockerPatchId: '15-1',
      nowMs: now,
    });

    expect(bundle.usable).toBe(true);
    expect(bundle.byDataset.T4_CHAINS.freshness).toBe('UNAVAILABLE');
    expect(bundle.byDataset.WPA_PATCH_DATA.payload).toBeDefined();
    expect(bundle.byDataset.VS_HERO_WPA.payload).toBeDefined();
    expect(bundle.byDataset.CONSENSUS_SKELETON.payload).toBeDefined();
  });

  it('enqueues hero refresh without awaiting when hero-scoped evidence is missing', () => {
    const h = service([
      row('WPA_PATCH_DATA', 'patch:15-1', 5 * 60_000),
      row('VS_HERO_WPA', 'global', 5 * 60_000),
      row('T4_CHAINS', 'global', 5 * 60_000),
    ]);

    h.service.getEvidence({
      heroId: 10,
      rulesetVersion: 'ruleset-a',
      catalogSha256,
      statlockerPatchId: '15-1',
      nowMs: now,
    });

    expect(h.refresh.enqueueHeroRefresh).toHaveBeenCalledWith(10, now);
  });
});
