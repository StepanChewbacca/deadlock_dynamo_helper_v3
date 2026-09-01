import { getMetadataArgsStorage } from 'typeorm';
import { ItemCatalogItem } from '../src/deadlock-live/entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from '../src/deadlock-live/entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from '../src/deadlock-live/entities/item-catalog-version.entity';
import { RecommendationItemCatalogItemV1 } from '../src/deadlock-live/entities/recommendation-item-catalog-item-v1.entity';
import { RecommendationItemCatalogRecipeV1 } from '../src/deadlock-live/entities/recommendation-item-catalog-recipe-v1.entity';
import { RecommendationItemCatalogVersionV1 } from '../src/deadlock-live/entities/recommendation-item-catalog-version-v1.entity';

describe('recommendation item catalog schema isolation', () => {
  it('uses versioned physical tables instead of legacy production catalog tables', () => {
    const tables = getMetadataArgsStorage().tables;
    const tableNameFor = (target: Function): string | undefined =>
      tables.find((table) => table.target === target)?.name;

    expect(tableNameFor(RecommendationItemCatalogVersionV1)).toBe('recommendation_item_catalog_versions_v1');
    expect(tableNameFor(RecommendationItemCatalogItemV1)).toBe('recommendation_item_catalog_items_v1');
    expect(tableNameFor(RecommendationItemCatalogRecipeV1)).toBe('recommendation_item_catalog_recipes_v1');
    expect(tableNameFor(ItemCatalogVersion)).toBe('item_catalog_versions');
    expect(tableNameFor(ItemCatalogItem)).toBe('item_catalog_items');
    expect(tableNameFor(ItemCatalogRecipe)).toBe('item_catalog_recipes');
  });
});
