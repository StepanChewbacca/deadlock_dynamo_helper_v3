import {
  deduplicateRecipes,
  normalizeCatalogItem,
  normalizeClientVersions,
  selectClientVersions,
} from '../src/deadlock-live/item-catalog-import.service';
import { ItemCatalogRecipe } from '../src/deadlock-live/entities/item-catalog-recipe.entity';

describe('ItemCatalogImportService helpers', () => {
  it('normalizes and sorts client versions', () => {
    expect(normalizeClientVersions([7000, '6518', 7000, -1, 'bad'])).toEqual([
      6518,
      7000,
    ]);
  });

  it('selects the latest version by default and supports explicit backfills', () => {
    const available = [6000, 6100, 6200, 6300];

    expect(selectClientVersions(available, {})).toEqual([6300]);
    expect(selectClientVersions(available, { maxVersions: 2 })).toEqual([6200, 6300]);
    expect(selectClientVersions(available, { importAll: true })).toEqual(available);
    expect(selectClientVersions(available, { clientVersions: [6100, 6300] })).toEqual([
      6100,
      6300,
    ]);
  });

  it('preserves raw item payload and recipe component references', () => {
    const raw = {
      id: 2064029594,
      name: 'Opening Rounds',
      class_name: 'upgrade_pristine_emblem',
      item_slot_type: 'weapon',
      cost: 4250,
      item_tier: 3,
      type: 'upgrade',
      shopable: true,
      disabled: false,
      is_active_item: false,
      component_items: ['upgrade_high_velocity_mag'],
    };

    expect(normalizeCatalogItem(raw)).toEqual({
      itemId: 2064029594,
      name: 'Opening Rounds',
      className: 'upgrade_pristine_emblem',
      itemType: 'upgrade',
      slotType: 'weapon',
      cost: 4250,
      tier: 3,
      shopable: true,
      disabled: false,
      active: true,
      isActiveItem: false,
      activationType: undefined,
      componentReferences: ['upgrade_high_velocity_mag'],
      rawPayload: raw,
    });
  });

  it('preserves repeated component ids at different recipe positions', () => {
    const recipes = [
      recipe(1, 300, 100, 0),
      recipe(1, 300, 100, 1),
      recipe(1, 300, 200, 2),
      recipe(1, 300, 999, 2),
    ];

    expect(
      deduplicateRecipes(recipes).map((entry) => ({
        componentItemId: entry.componentItemId,
        componentOrder: entry.componentOrder,
      })),
    ).toEqual([
      { componentItemId: 100, componentOrder: 0 },
      { componentItemId: 100, componentOrder: 1 },
      { componentItemId: 200, componentOrder: 2 },
    ]);
  });
});

function recipe(
  catalogVersionId: number,
  parentItemId: number,
  componentItemId: number,
  componentOrder: number,
): ItemCatalogRecipe {
  return {
    catalogVersionId,
    parentItemId,
    componentItemId,
    componentOrder,
  } as ItemCatalogRecipe;
}
