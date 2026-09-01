import axios from 'axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecommendationCatalogContentV1Service } from './recommendation-catalog-content-v1.service';
import { Hero } from './entities/hero.entity';
import { ItemComponent } from './entities/item-component.entity';
import { Item } from './entities/item.entity';
import { getDeadlockApiRequestConfig } from './deadlock-api-request';
import { HERO_REFERENCE_SEED, ITEM_REFERENCE_SEED } from './reference-data.seed';

@Injectable()
export class ReferenceDataImportService implements OnModuleInit {
  private readonly logger = new Logger(ReferenceDataImportService.name);

  constructor(
    @InjectRepository(Hero)
    private readonly heroRepo: Repository<Hero>,
    @InjectRepository(Item)
    private readonly itemRepo: Repository<Item>,
    @InjectRepository(ItemComponent)
    private readonly itemComponentRepo: Repository<ItemComponent>,
    private readonly recommendationCatalogContentService: RecommendationCatalogContentV1Service,
  ) {}

  async onModuleInit() {
    await this.importIfNeeded();
  }

  async importIfNeeded() {
    await this.importHeroesIfNeeded();
    await this.importItemsIfNeeded();
    await this.syncItemsFromAssets();
  }

  private async importHeroesIfNeeded() {
    if (await this.heroRepo.count()) {
      return;
    }

    const heroes = HERO_REFERENCE_SEED.map((hero) =>
      this.heroRepo.create({
        heroId: hero.hero_id,
        name: hero.name,
      }),
    );

    await this.heroRepo.save(heroes);
    this.logger.log(`Imported ${heroes.length} heroes into PostgreSQL`);
  }

  private async importItemsIfNeeded() {
    if (await this.itemRepo.count()) {
      return;
    }

    const items = ITEM_REFERENCE_SEED.map((item) =>
      this.itemRepo.create({
        itemId: item.itemId,
        name: item.name,
        className: item.class_name,
        itemSlotType: item.item_slot_type,
        cost: item.cost,
        itemTier: item.item_tier,
      }),
    );

    await this.itemRepo.save(items);
    this.logger.log(`Imported ${items.length} items into PostgreSQL`);
  }

  private async syncItemsFromAssets() {
    const apiKey = process.env.DEADLOCK_API_KEY?.trim();
    if (!apiKey) {
      return;
    }

    try {
      const res = await axios.get('https://api.deadlock-api.com/v1/assets/items', getDeadlockApiRequestConfig());
      const assets = Array.isArray(res.data) ? res.data : [];
      if (assets.length === 0) {
        return;
      }

      const catalog = await this.recommendationCatalogContentService.importAssetsSnapshot({
        assets,
        clientVersion: process.env.DEADLOCK_CLIENT_VERSION,
        contentCatalogVersionId: process.env.DEADLOCK_CONTENT_CATALOG_VERSION,
        rulesetKey: process.env.DEADLOCK_RULESET_KEY,
      });
      this.logger.log(
        `${catalog.created ? 'Created' : 'Reused'} immutable item catalog ${catalog.catalogVersionId} `
        + `with ${catalog.itemCount} items and ${catalog.recipeCount} recipe links`,
      );

      const shopItems = assets
        .filter(
          (item) =>
            item &&
            item.shopable === true &&
            typeof item.id === 'number' &&
            typeof item.name === 'string' &&
            typeof item.class_name === 'string' &&
            typeof item.item_slot_type === 'string',
        )
        .map((item) => ({
          itemId: item.id,
          name: item.name,
          className: item.class_name,
          itemSlotType: item.item_slot_type,
          cost: typeof item.cost === 'number' ? item.cost : 0,
          itemTier: typeof item.item_tier === 'number' ? item.item_tier : 0,
          componentClassNames: Array.isArray(item.component_items)
            ? item.component_items.filter((component: unknown): component is string => typeof component === 'string')
            : [],
        }));

      if (shopItems.length === 0) {
        return;
      }

      const existingItems = await this.itemRepo.find();
      const existingByItemId = new Map(existingItems.map((item) => [String(item.itemId), item]));

      const syncedItems = await this.itemRepo.save(
        shopItems.map((item) =>
          this.itemRepo.create({
            id: existingByItemId.get(String(item.itemId))?.id,
            itemId: item.itemId,
            name: item.name,
            className: item.className,
            itemSlotType: item.itemSlotType,
            cost: item.cost,
            itemTier: item.itemTier,
          }),
        ),
      );

      const itemIdByClassName = new Map(syncedItems.map((item) => [item.className, Number(item.itemId)]));
      const componentRows: ItemComponent[] = [];

      for (const item of shopItems) {
        const parentItemId = item.itemId;
        item.componentClassNames.forEach((componentClassName: string, index: number) => {
          const componentItemId = itemIdByClassName.get(componentClassName);
          if (!componentItemId) {
            return;
          }

          componentRows.push(
            this.itemComponentRepo.create({
              parentItemId,
              componentItemId,
              componentOrder: index,
            }),
          );
        });
      }

      await this.itemComponentRepo.createQueryBuilder().delete().from(ItemComponent).execute();
      if (componentRows.length > 0) {
        await this.itemComponentRepo.save(componentRows);
      }

      this.logger.log(`Synchronized ${syncedItems.length} items and ${componentRows.length} item-component links from assets API`);
    } catch (error) {
      this.logger.warn(`Failed to synchronize item recipes from assets API: ${(error as Error).message}`);
    }
  }
}
