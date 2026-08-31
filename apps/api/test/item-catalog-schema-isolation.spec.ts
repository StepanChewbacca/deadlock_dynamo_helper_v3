import { getMetadataArgsStorage } from 'typeorm';
import { ItemCatalogItem } from '../src/deadlock-live/entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from '../src/deadlock-live/entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from '../src/deadlock-live/entities/item-catalog-version.entity';

describe('recommendation item catalog schema isolation', () => {
  it('uses versioned physical tables instead of legacy production catalog tables', () => {
    const tables = getMetadataArgsStorage().tables;
    const tableNameFor = (target: Function): string | undefined =>
      tables.find((table) => table.target === target)?.name;

    expect(tableNameFor(ItemCatalogVersion)).toBe('recommendation_item_catalog_versions_v1');
    expect(tableNameFor(ItemCatalogItem)).toBe('recommendation_item_catalog_items_v1');
    expect(tableNameFor(ItemCatalogRecipe)).toBe('recommendation_item_catalog_recipes_v1');
  });
});
