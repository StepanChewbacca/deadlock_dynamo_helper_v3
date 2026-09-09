import { StatlockerRefreshService } from '../src/statlocker-adaptive/statlocker-refresh.service';

describe('Statlocker VS_HERO_WPA RAW ingest V1', () => {
  it('persists the exact collected RAW payload before normalization and keeps it when normalization fails', async () => {
    const rawPayload = {
      metadata: { source: 'statlocker' },
      by_patch: { patch_test: { rank_8: { hero_1: {} } } },
    };
    const events: string[] = [];
    let persistedRawPayload: unknown;

    const collector = {
      collectBatch: jest.fn(async () => ({
        statlockerPatchId: 'test',
        fetchedAt: '2026-09-09T10:00:00.000Z',
        datasets: [
          {
            dataset: 'VS_HERO_WPA' as const,
            scopeKey: 'global',
            path: '/api/info/vs-hero-wpa-data',
            status: 200,
            fetchedAt: '2026-09-09T10:00:00.000Z',
            statlockerPatchId: 'test',
            data: rawPayload,
          },
        ],
      })),
    };
    const normalizer = {
      normalizeVsHeroWpa: jest.fn(() => {
        events.push('normalize');
        throw new Error('normalization failed');
      }),
    };
    const normalizedStore = {
      publish: jest.fn(),
      listActive: jest.fn(() => []),
    };
    const rawStore = {
      persistCollected: jest.fn(async (input: { rawPayload: unknown }) => {
        events.push('raw');
        persistedRawPayload = input.rawPayload;
      }),
    };

    const service = new StatlockerRefreshService(
      collector as never,
      normalizer as never,
      normalizedStore as never,
      undefined,
      undefined,
      rawStore as never,
    );
    service.observeGameIdentity({
      rulesetVersion: 'ruleset-test',
      catalogSha256: 'a'.repeat(64),
    });

    await expect(service.refreshGlobalNow(true)).rejects.toThrow('normalization failed');

    expect(events).toEqual(['raw', 'normalize']);
    expect(rawStore.persistCollected).toHaveBeenCalledWith(expect.objectContaining({
      fetchedAt: new Date('2026-09-09T10:00:00.000Z'),
      sourcePath: '/api/info/vs-hero-wpa-data',
      sourceStatus: 200,
      statlockerPatchId: 'test',
      rulesetVersion: 'ruleset-test',
      catalogSha256: 'a'.repeat(64),
      rawPayload,
    }));
    expect(persistedRawPayload).toBe(rawPayload);
    expect(normalizedStore.publish).not.toHaveBeenCalled();
  });
});
