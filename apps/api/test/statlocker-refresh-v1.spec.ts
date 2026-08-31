import { StatlockerRefreshService } from '../src/statlocker-adaptive/statlocker-refresh.service';
import { statlockerV1Fixtures } from './fixtures/statlocker-v1';

const identity = {
  rulesetVersion: 'ruleset-a',
  catalogSha256: 'a'.repeat(64),
};

function createHarness() {
  let releaseCollector: (() => void) | undefined;
  let publishSequence = 0;
  const block = { enabled: false };
  const collector = {
    collectBatch: jest.fn(async (targets: readonly any[]) => {
      if (block.enabled) {
        await new Promise<void>((resolve) => { releaseCollector = resolve; });
      }
      return {
        statlockerPatchId: '15-1',
        fetchedAt: '2026-08-31T12:00:00.000Z',
        datasets: targets.map((target) => ({
          ...target,
          path: target.dataset,
          status: 200,
          fetchedAt: '2026-08-31T12:00:00.000Z',
          statlockerPatchId: '15-1',
          data:
            target.dataset === 'WPA_PATCH_DATA' ? statlockerV1Fixtures.patchData :
            target.dataset === 'VS_HERO_WPA' ? statlockerV1Fixtures.vsHero :
            target.dataset === 'T4_CHAINS' ? statlockerV1Fixtures.t4Chains :
            target.dataset === 'HERO_LEADERBOARD' ? statlockerV1Fixtures.leaderboard :
            target.dataset === 'PRO_BUILD_ANALYSIS' ? statlockerV1Fixtures.proBuild :
            statlockerV1Fixtures.filteredItems,
        })),
      };
    }),
  };
  const normalizer = {
    normalizeWpaPatchData: jest.fn(() => ({ dataset: 'WPA_PATCH_DATA', scopeKey: 'patch:15-1', statlockerPatchId: '15-1', contentSha256: '1'.repeat(64), payload: { patchId: '15-1', items: [] } })),
    normalizeVsHeroWpa: jest.fn(() => ({ dataset: 'VS_HERO_WPA', scopeKey: 'global', statlockerPatchId: '15-1', contentSha256: '2'.repeat(64), payload: { slices: [] } })),
    normalizeT4Chains: jest.fn(() => ({ dataset: 'T4_CHAINS', scopeKey: 'global', statlockerPatchId: '15-1', contentSha256: '3'.repeat(64), payload: { chains: [] } })),
    normalizeHeroLeaderboard: jest.fn(() => ({
      dataset: 'HERO_LEADERBOARD',
      scopeKey: 'hero:10',
      statlockerPatchId: '15-1',
      contentSha256: '4'.repeat(64),
      payload: { heroId: 10, profiles: [{ accountId: '101', heroId: 10, rank: 1 }] },
    })),
    normalizeProBuildAnalysis: jest.fn(() => ({ dataset: 'PRO_BUILD_ANALYSIS', scopeKey: 'hero:10:account:101', statlockerPatchId: '15-1', contentSha256: '5'.repeat(64), payload: { accountId: '101', heroId: 10, items: [] } })),
  };
  const active = new Map<string, any>();
  const publish = jest.fn(async (input: any): Promise<any> => {
    const key = [input.dataset, input.rulesetVersion, input.catalogSha256, input.statlockerPatchId, input.scopeKey].join('|');
    const current = active.get(key);
    if (current?.contentSha256 === input.contentSha256) return current;
    publishSequence += 1;
    const saved: any = { ...input, snapshotId: `snapshot-${publishSequence}` };
    active.set(key, saved);
    return saved;
  });
  const store: any = {
    publish,
    getActive: jest.fn((lookup: any) => active.get([
      lookup.dataset,
      lookup.rulesetVersion,
      lookup.catalogSha256,
      lookup.statlockerPatchId,
      lookup.scopeKey,
    ].join('|'))),
  };
  const service = new StatlockerRefreshService(collector as any, normalizer as any, store);
  service.observeGameIdentity(identity, 1_000);

  return { service, collector, normalizer, store, active, block, release: () => releaseCollector?.() };
}

describe('StatlockerRefreshService', () => {
  it('gates global refresh by TTL', async () => {
    const h = createHarness();
    await h.service.refreshGlobalNow(false, 1_000);
    await h.service.refreshGlobalNow(false, 1_001);
    expect(h.collector.collectBatch).toHaveBeenCalledTimes(1);
  });

  it('uses single-flight for the same global identity', async () => {
    const h = createHarness();
    h.block.enabled = true;
    const first = h.service.refreshGlobalNow(true, 1_000);
    const second = h.service.refreshGlobalNow(true, 1_000);
    expect(h.collector.collectBatch).toHaveBeenCalledTimes(1);
    h.release();
    await Promise.all([first, second]);
  });

  it('preserves published snapshots when a later refresh fails', async () => {
    const h = createHarness();
    await h.service.refreshGlobalNow(true, 1_000);
    const before = [...h.active.values()].map((entry) => entry.snapshotId);
    h.collector.collectBatch.mockRejectedValueOnce(new Error('collector failed'));

    await expect(h.service.refreshGlobalNow(true, 2_000)).rejects.toThrow('collector failed');
    expect([...h.active.values()].map((entry) => entry.snapshotId)).toEqual(before);
  });

  it('enqueueHeroRefresh is fire-and-forget and records active hero scope', () => {
    const h = createHarness();
    h.block.enabled = true;
    expect(h.service.enqueueHeroRefresh(10, 1_000)).toBeUndefined();
    expect(h.service.getStatus().activeHeroIds).toEqual([10]);
    h.release();
  });

  it('does not publish duplicate normalized content twice', async () => {
    const h = createHarness();
    await h.service.refreshGlobalNow(true, 1_000);
    const publishesAfterFirst = h.store.publish.mock.calls.length;
    await h.service.refreshGlobalNow(true, 2_000);
    expect(h.store.publish.mock.calls.length).toBe(publishesAfterFirst);
  });
});
