import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RecommendationItemCatalogItemV1 } from './entities/recommendation-item-catalog-item-v1.entity';
import { RecommendationItemCatalogRecipeV1 } from './entities/recommendation-item-catalog-recipe-v1.entity';
import { RecommendationItemCatalogVersionV1 } from './entities/recommendation-item-catalog-version-v1.entity';
import { resolveRecommendationCatalogAssetSemantics } from './recommendation-catalog-asset-semantics';

export const RECOMMENDATION_ITEM_CATALOG_SOURCE = 'DEADLOCK_API_ASSETS_V1' as const;

export interface ImportRecommendationCatalogSnapshotV1Input {
  assets: readonly unknown[];
  clientVersion?: string;
  contentCatalogVersionId?: string;
  rulesetKey?: string;
}

export interface ImportRecommendationCatalogSnapshotV1Result {
  created: boolean;
  catalogVersionId: string;
  rulesetKey: string;
  payloadSha256: string;
  itemCount: number;
  recipeCount: number;
}

interface ParsedCatalogAsset {
  itemId: number;
  name: string;
  className?: string;
  itemType?: string;
  slotType?: string;
  cost?: number;
  tier?: number;
  shopable?: boolean;
  disabled?: boolean;
  active?: boolean;
  isActiveItem?: boolean;
  activationType?: string;
  componentClassNames: string[];
  rawPayload: Record<string, unknown>;
}

@Injectable()
export class RecommendationCatalogContentV1Service {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RecommendationItemCatalogVersionV1)
    private readonly versionRepo: Repository<RecommendationItemCatalogVersionV1>,
  ) {}

  async importAssetsSnapshot(
    input: ImportRecommendationCatalogSnapshotV1Input,
  ): Promise<ImportRecommendationCatalogSnapshotV1Result> {
    const payloadSha256 = computeRecommendationCatalogPayloadSha256(input.assets);
    const existing = await this.versionRepo.findOne({ where: { payloadSha256 } });
    if (existing) {
      const [itemCount, recipeCount] = await Promise.all([
        this.dataSource.getRepository(RecommendationItemCatalogItemV1).count({ where: { catalogVersionId: existing.catalogVersionId } }),
        this.dataSource.getRepository(RecommendationItemCatalogRecipeV1).count({ where: { catalogVersionId: existing.catalogVersionId } }),
      ]);
      return {
        created: false,
        catalogVersionId: existing.catalogVersionId,
        rulesetKey: existing.rulesetKey,
        payloadSha256,
        itemCount,
        recipeCount,
      };
    }

    const parsed = input.assets.map(parseCatalogAsset).filter(isParsedCatalogAsset);
    const catalogVersionId = `deadlock-assets:${payloadSha256}`;
    const rulesetKey = input.rulesetKey?.trim()
      || input.clientVersion?.trim()
      || `catalog-sha256:${payloadSha256}`;

    return this.dataSource.transaction(async (manager) => {
      const versionRepo = manager.getRepository(RecommendationItemCatalogVersionV1);
      const itemRepo = manager.getRepository(RecommendationItemCatalogItemV1);
      const recipeRepo = manager.getRepository(RecommendationItemCatalogRecipeV1);

      await versionRepo.save(versionRepo.create({
        catalogVersionId,
        contentCatalogVersionId: cleanString(input.contentCatalogVersionId),
        clientVersion: cleanString(input.clientVersion),
        rulesetKey,
        source: RECOMMENDATION_ITEM_CATALOG_SOURCE,
        payloadSha256,
      }));

      const itemRows = parsed.map((asset) => {
        const semantics = resolveRecommendationCatalogAssetSemantics(asset);
        return itemRepo.create({
          catalogVersionId,
          itemId: asset.itemId,
          name: asset.name,
          className: asset.className,
          itemType: semantics.itemType,
          slotType: asset.slotType,
          cost: asset.cost,
          tier: asset.tier,
          shopable: semantics.shopable,
          disabled: semantics.disabled,
          active: semantics.active,
          isActiveItem: semantics.isActiveItem,
          activationType: semantics.activationType,
          rawPayload: asset.rawPayload,
        });
      });
      if (itemRows.length > 0) await itemRepo.save(itemRows, { chunk: 250 });

      const itemIdByClassName = new Map<string, number>();
      for (const asset of parsed) if (asset.className) itemIdByClassName.set(asset.className, asset.itemId);
      const recipeRows: RecommendationItemCatalogRecipeV1[] = [];
      for (const asset of parsed) {
        asset.componentClassNames.forEach((componentClassName, componentOrder) => {
          const componentItemId = itemIdByClassName.get(componentClassName);
          if (componentItemId === undefined) return;
          recipeRows.push(recipeRepo.create({
            catalogVersionId,
            parentItemId: asset.itemId,
            componentItemId,
            componentOrder,
          }));
        });
      }
      if (recipeRows.length > 0) await recipeRepo.save(recipeRows, { chunk: 250 });

      return {
        created: true,
        catalogVersionId,
        rulesetKey,
        payloadSha256,
        itemCount: itemRows.length,
        recipeCount: recipeRows.length,
      };
    });
  }
}

export function computeRecommendationCatalogPayloadSha256(assets: readonly unknown[]): string {
  const stableAssets = [...assets]
    .map((asset) => normalizeJson(asset))
    .sort((a, b) => catalogSortKey(a).localeCompare(catalogSortKey(b)));
  return createHash('sha256').update(JSON.stringify(stableAssets)).digest('hex');
}

function parseCatalogAsset(value: unknown): ParsedCatalogAsset | undefined {
  if (!isRecord(value)) return undefined;
  const itemId = finiteNumber(value.id);
  const name = cleanString(value.name);
  if (itemId === undefined || !Number.isInteger(itemId) || itemId <= 0 || !name) return undefined;

  return {
    itemId,
    name,
    className: cleanString(value.class_name),
    itemType: cleanString(value.item_type),
    slotType: cleanString(value.item_slot_type),
    cost: nonNegativeNumber(value.cost),
    tier: nonNegativeNumber(value.item_tier),
    shopable: booleanValue(value.shopable),
    disabled: booleanValue(value.disabled),
    active: booleanValue(value.active),
    isActiveItem: booleanValue(value.is_active_item),
    activationType: cleanString(value.activation_type),
    componentClassNames: Array.isArray(value.component_items)
      ? value.component_items.map(cleanString).filter((entry): entry is string => entry !== undefined)
      : [],
    rawPayload: normalizeJson(value) as Record<string, unknown>,
  };
}

function isParsedCatalogAsset(value: ParsedCatalogAsset | undefined): value is ParsedCatalogAsset {
  return value !== undefined;
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) normalized[key] = normalizeJson(value[key]);
  return normalized;
}

function catalogSortKey(value: unknown): string {
  if (isRecord(value) && typeof value.id === 'number') return `0:${String(value.id).padStart(20, '0')}`;
  return `1:${JSON.stringify(value)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
