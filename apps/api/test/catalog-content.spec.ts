import {
  computeRecommendationCatalogPayloadSha256,
  RecommendationCatalogContentV1Service,
} from '../src/deadlock-live/recommendation-catalog-content-v1.service';
import { RecommendationItemCatalogItemV1 } from '../src/deadlock-live/entities/recommendation-item-catalog-item-v1.entity';
import { RecommendationItemCatalogRecipeV1 } from '../src/deadlock-live/entities/recommendation-item-catalog-recipe-v1.entity';

describe('catalog content hashing', () => {
  it('is deterministic across top-level item order and object key order', () => {
    const a = [
      { id: 2, name: 'B', nested: { z: 1, a: 2 } },
      { id: 1, name: 'A', component_items: ['x', 'y'] },
    ];
    const b = [
      { component_items: ['x', 'y'], name: 'A', id: 1 },
      { nested: { a: 2, z: 1 }, name: 'B', id: 2 },
    ];

    expect(computeRecommendationCatalogPayloadSha256(a)).toBe(computeRecommendationCatalogPayloadSha256(b));
  });

  it('changes when catalog semantics change', () => {
    const before = [{ id: 1, name: 'A', cost: 800, shopable: true }];
    const after = [{ id: 1, name: 'A', cost: 1600, shopable: true }];

    expect(computeRecommendationCatalogPayloadSha256(before)).not.toBe(computeRecommendationCatalogPayloadSha256(after));
  });
});

describe('catalog content import', () => {
  it('fills missing exact identity when an existing content snapshot is reimported by client version', async () => {
    const payloadSha256 = computeRecommendationCatalogPayloadSha256([{ id: 1, name: 'Item' }]);
    const existing = {
      catalogVersionId: `deadlock-assets:${payloadSha256}`,
      rulesetKey: `catalog-sha256:${payloadSha256}`,
      payloadSha256,
    };
    const save = jest.fn(async () => undefined);
    const versionRepo = { findOne: jest.fn(async () => existing), save };
    const dataSource = {
      getRepository: () => ({ count: async () => 1 }),
    };
    const service = new RecommendationCatalogContentV1Service(dataSource as any, versionRepo as any);

    await service.importAssetsSnapshot({
      assets: [{ id: 1, name: 'Item' }],
      clientVersion: '6686',
      rulesetKey: 'client-6686',
    });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      clientVersion: '6686',
      rulesetKey: 'client-6686',
    }));
  });

  it('resolves current asset semantics before saving a new catalog row', async () => {
    const saved: Record<string, unknown>[] = [];
    const itemRepo = {
      create: (value: Record<string, unknown>) => value,
      save: async (rows: Record<string, unknown>[]) => saved.push(...rows),
    };
    const recipeRepo = {
      create: (value: Record<string, unknown>) => value,
      save: async () => undefined,
    };
    const versionRepo = {
      findOne: async () => undefined,
      create: (value: Record<string, unknown>) => value,
      save: async () => undefined,
    };
    const dataSource = {
      getRepository: () => ({ count: async () => 0 }),
      transaction: async (callback: (manager: { getRepository: (entity: unknown) => unknown }) => Promise<unknown>) =>
        callback({
          getRepository: (entity) => entity === RecommendationItemCatalogItemV1
            ? itemRepo
            : entity === RecommendationItemCatalogRecipeV1
              ? recipeRepo
              : versionRepo,
        }),
    };
    const service = new RecommendationCatalogContentV1Service(dataSource as any, versionRepo as any);

    await service.importAssetsSnapshot({
      assets: [{
        id: 1,
        name: 'Current Asset',
        class_name: 'current_asset',
        item_slot_type: 'weapon',
        type: 'upgrade',
        shopable: true,
        disabled: false,
        is_active_item: false,
        activation: 'passive',
      }],
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ itemType: 'upgrade', activationType: 'passive', disabled: false, active: true });
  });
});
