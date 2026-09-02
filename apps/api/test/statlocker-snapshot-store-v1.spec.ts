import { StatlockerSnapshotStoreService } from '../src/statlocker-adaptive/statlocker-snapshot-store.service';

const base = {
  dataset: 'WPA_PATCH_DATA' as const,
  rulesetVersion: 'ruleset-a',
  catalogSha256: 'a'.repeat(64),
  statlockerPatchId: '15-1',
  scopeKey: 'patch:15-1',
  fetchedAt: new Date('2026-08-31T12:00:00.000Z'),
  schemaVersion: 'statlocker-evidence-v1',
  collectorVersion: 'collector-v1',
  normalizerVersion: 'normalizer-v1',
  contentSha256: 'b'.repeat(64),
  payload: { patchId: '15-1', items: [{ itemId: 1 }] },
  metadata: { source: 'test' },
};

function repo() {
  return {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('StatlockerSnapshotStoreService', () => {
  it('persists before publishing and deduplicates identical active content', async () => {
    const repository = repo();
    const store = new StatlockerSnapshotStoreService(repository);

    const first = await store.publish(base);
    const second = await store.publish(base);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(store.getActive(base)?.payload).toEqual(base.payload);
  });

  it('advances fetchedAt when identical content is successfully observed again', async () => {
    const repository = repo();
    const store = new StatlockerSnapshotStoreService(repository);
    const first = await store.publish(base);
    const newerFetchedAt = new Date('2026-09-01T12:00:00.000Z');

    const second = await store.publish({ ...base, fetchedAt: newerFetchedAt });

    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.fetchedAt).toEqual(newerFetchedAt);
    expect(store.getActive(base)?.fetchedAt).toEqual(newerFetchedAt);
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('leaves last known good active snapshot unchanged if persistence fails', async () => {
    const repository = repo();
    const store = new StatlockerSnapshotStoreService(repository);
    const first = await store.publish(base);
    repository.save.mockRejectedValueOnce(new Error('db down'));

    await expect(store.publish({ ...base, contentSha256: 'c'.repeat(64), payload: { version: 2 } }))
      .rejects.toThrow('db down');
    expect(store.getActive(base)?.snapshotId).toBe(first.snapshotId);
  });

  it('recovers newest valid snapshot per lookup key on bootstrap', async () => {
    const repository = repo();
    repository.find.mockResolvedValue([
      { ...base, snapshotId: 'new', fetchedAt: new Date('2026-08-31T13:00:00.000Z'), payload: { version: 2 } },
      { ...base, snapshotId: 'old', fetchedAt: new Date('2026-08-31T12:00:00.000Z'), payload: { version: 1 } },
    ]);
    const store = new StatlockerSnapshotStoreService(repository);

    await store.onModuleInit();

    expect(store.getActive(base)?.snapshotId).toBe('new');
    expect(store.getActive(base)?.payload).toEqual({ version: 2 });
  });

  it('ignores persisted snapshots with an unknown dataset during bootstrap', async () => {
    const repository = repo();
    repository.find.mockResolvedValue([
      { ...base, dataset: 'UNKNOWN_DATASET', snapshotId: 'invalid' },
    ]);
    const store = new StatlockerSnapshotStoreService(repository);

    await store.onModuleInit();

    expect(store.listActive()).toEqual([]);
  });
});
