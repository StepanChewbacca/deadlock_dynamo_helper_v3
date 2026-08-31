import { BuildSkeletonService } from '../src/statlocker-adaptive/build-skeleton.service';

function profile(accountId: string, index: number) {
  const items: any[] = [
    {
      itemId: 100,
      purchaseRate: 0.92,
      medianBuyTimeS: 300 + (index % 3) * 10,
      frequencyTier: 'CORE',
      phase: 'early',
      relationships: [{ itemId: 101, strength: 0.8 }],
    },
  ];
  if (index < 6) {
    items.push({
      itemId: 101,
      purchaseRate: 0.72,
      medianBuyTimeS: 620 + index * 5,
      frequencyTier: 'FREQUENT',
      phase: 'mid',
      relationships: [{ itemId: 100, strength: 0.6 }],
    });
  }
  if (index < 2) {
    items.push({
      itemId: 102,
      purchaseRate: 0.35,
      medianBuyTimeS: 900 + index * 20,
      frequencyTier: 'SOMETIMES',
      phase: 'late',
      relationships: [],
    });
  }
  return { accountId, heroId: 10, items };
}

function createStore(profileCount = 10) {
  const snapshots = new Map<string, any>();
  const catalogSha256 = 'a'.repeat(64);
  const key = (dataset: string, scopeKey: string) => [dataset, 'ruleset-a', catalogSha256, '15-1', scopeKey].join('|');
  snapshots.set(key('HERO_LEADERBOARD', 'hero:10'), {
    snapshotId: 'leaderboard',
    fetchedAt: new Date('2026-08-31T12:00:00.000Z'),
    payload: {
      heroId: 10,
      profiles: Array.from({ length: profileCount }, (_, index) => ({
        accountId: String(100 + index),
        heroId: 10,
        rank: index + 1,
      })),
    },
  });
  for (let index = 0; index < profileCount; index += 1) {
    const accountId = String(100 + index);
    snapshots.set(key('PRO_BUILD_ANALYSIS', `hero:10:account:${accountId}`), {
      snapshotId: `profile-${accountId}`,
      fetchedAt: new Date(`2026-08-31T12:${String(index).padStart(2, '0')}:00.000Z`),
      payload: profile(accountId, index),
    });
  }
  const store = {
    getActive: jest.fn((lookup: any) => snapshots.get([
      lookup.dataset,
      lookup.rulesetVersion,
      lookup.catalogSha256,
      lookup.statlockerPatchId,
      lookup.scopeKey,
    ].join('|'))),
    publish: jest.fn(async (input: any) => ({ ...input, snapshotId: 'consensus-new' })),
  };
  return { store, catalogSha256 };
}

describe('BuildSkeletonService', () => {
  it('derives core, frequent and flex support from up to ten profiles in deterministic order', async () => {
    const h = createStore(10);
    const service = new BuildSkeletonService(h.store as any);

    const result = await service.rebuild({
      heroId: 10,
      rulesetVersion: 'ruleset-a',
      catalogSha256: h.catalogSha256,
      statlockerPatchId: '15-1',
    });

    expect(result?.profileCount).toBe(10);
    expect(result?.items.map((item) => item.itemId)).toEqual([100, 101, 102]);
    expect(result?.items[0].tier).toBe('CORE');
    expect(result?.items[1].tier).toBe('FREQUENT');
    expect(result?.items[2].tier).toBe('FLEX');
    expect(result?.items[0].strength).toBeGreaterThan(result?.items[1].strength ?? 0);
    expect(result?.items[1].strength).toBeGreaterThan(result?.items[2].strength ?? 0);
    expect(result?.items[0].medianBuyTimeS).toBeLessThan(result?.items[1].medianBuyTimeS ?? 0);
    expect(h.store.publish).toHaveBeenCalledTimes(1);
  });

  it('does not publish a weak replacement when fewer than six valid profiles exist', async () => {
    const h = createStore(5);
    const service = new BuildSkeletonService(h.store as any);

    const result = await service.rebuild({
      heroId: 10,
      rulesetVersion: 'ruleset-a',
      catalogSha256: h.catalogSha256,
      statlockerPatchId: '15-1',
    });

    expect(result).toBeUndefined();
    expect(h.store.publish).not.toHaveBeenCalled();
  });
});
