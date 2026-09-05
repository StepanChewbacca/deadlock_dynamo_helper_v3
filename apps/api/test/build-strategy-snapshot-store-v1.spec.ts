import { createRecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategyRegistryV1Service } from '../src/statlocker-adaptive/build-strategy-registry-v1.service';
import { BuildStrategySnapshotStoreV1Service } from '../src/statlocker-adaptive/build-strategy-snapshot-store-v1.service';
import { BuildStrategySpecV1 } from '../src/statlocker-adaptive/build-strategy-v1';

const graph = createRecommendationItemGraph([
  {
    itemId: 1,
    name: 'Core',
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: 800,
    upgradeRecipes: [],
    sellTransition: { soulsRefund: 400, returnedItemIds: [] },
  },
]);

const spec: BuildStrategySpecV1 = {
  schemaVersion: 1,
  strategyId: 'hero1:archetype:a',
  heroId: 1,
  rulesetId: 'r1',
  sourcePatchId: 'p1',
  support: 0.75,
  stability: 0.9,
  representativeTraceId: 'trace-1',
  goals: [{
    goalId: 'core',
    type: 'CORE',
    phase: 'EARLY',
    targetItemIds: [1],
    minSelect: 1,
    maxSelect: 1,
    prerequisiteGoalIds: [],
    hard: true,
    lifecycleByItemId: { 1: 'PERMANENT_CORE' },
    rationaleCodes: ['ARCHETYPE_CORE'],
  }],
  branchGroups: [],
  situationalWindows: [],
  investmentPolicy: { objectives: [], preferredWeights: { weapon: 1, vitality: 0, spirit: 0 } },
  slotPolicy: { reservedSituationalSlots: 0, maxTemporarySlots: 0 },
  terminalPolicy: { requiredGoalIds: ['core'], allowWaiveSoftGoals: true },
};

function repository() {
  const rows: any[] = [];
  return {
    rows,
    create: jest.fn((value: any) => ({ ...value })),
    save: jest.fn(async (value: any) => {
      const index = rows.findIndex((row) => row.snapshotId === value.snapshotId);
      if (index >= 0) rows[index] = { ...value };
      else rows.push({ ...value });
      return value;
    }),
    update: jest.fn(async (criteria: any, patch: any) => {
      for (const row of rows) {
        if (Object.entries(criteria).every(([key, value]) => row[key] === value)) Object.assign(row, patch);
      }
      return { affected: rows.length };
    }),
    find: jest.fn(async (options: any) => rows
      .filter((row) => options?.where?.active === undefined || row.active === options.where.active)
      .sort((a, b) => String(a.snapshotId).localeCompare(String(b.snapshotId)))),
  } as any;
}

describe('build strategy snapshot store v1', () => {
  it('publishes an immutable exact-scope snapshot and makes it live only after persistence', async () => {
    const repo = repository();
    const registry = new BuildStrategyRegistryV1Service();
    const store = new BuildStrategySnapshotStoreV1Service(repo, registry);

    await store.publish({
      snapshotId: 'strategy-snapshot-1',
      rulesetId: 'r1',
      patchId: 'p1',
      catalogSha256: 'a'.repeat(64),
      sourceSha256: 'b'.repeat(64),
      specs: [spec],
      itemGraph: graph,
      publishedAt: new Date('2026-09-05T00:00:00.000Z'),
    });

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({
      snapshotId: 'strategy-snapshot-1',
      rulesetId: 'r1',
      catalogSha256: 'a'.repeat(64),
      active: true,
    });
    expect(repo.rows[0].contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(registry.getStrategies(1, 'r1', 'a'.repeat(64)).map((entry) => entry.strategyId))
      .toEqual(['hero1:archetype:a']);
  });

  it('rehydrates the in-memory registry from persisted immutable topology', async () => {
    const repo = repository();
    const firstRegistry = new BuildStrategyRegistryV1Service();
    const firstStore = new BuildStrategySnapshotStoreV1Service(repo, firstRegistry);
    await firstStore.publish({
      snapshotId: 'strategy-snapshot-1',
      rulesetId: 'r1',
      patchId: 'p1',
      catalogSha256: 'a'.repeat(64),
      sourceSha256: 'b'.repeat(64),
      specs: [spec],
      itemGraph: graph,
    });

    const restoredRegistry = new BuildStrategyRegistryV1Service();
    const restoredStore = new BuildStrategySnapshotStoreV1Service(repo, restoredRegistry);
    const count = await restoredStore.hydrateActive();

    expect(count).toBe(1);
    expect(restoredRegistry.getStrategies(1, 'r1', 'a'.repeat(64))).toEqual([spec]);
  });

  it('fails closed when a persisted snapshot content hash is tampered', async () => {
    const repo = repository();
    const firstStore = new BuildStrategySnapshotStoreV1Service(repo, new BuildStrategyRegistryV1Service());
    await firstStore.publish({
      snapshotId: 'strategy-snapshot-1',
      rulesetId: 'r1',
      patchId: 'p1',
      catalogSha256: 'a'.repeat(64),
      sourceSha256: 'b'.repeat(64),
      specs: [spec],
      itemGraph: graph,
    });
    repo.rows[0].contentSha256 = '0'.repeat(64);

    const restoredStore = new BuildStrategySnapshotStoreV1Service(repo, new BuildStrategyRegistryV1Service());
    await expect(restoredStore.hydrateActive()).rejects.toThrow('content hash mismatch');
  });
});
