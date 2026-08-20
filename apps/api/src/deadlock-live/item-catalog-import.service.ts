import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { ObjectLiteral, Repository } from 'typeorm';
import { getDeadlockApiRequestConfig } from './deadlock-api-request';
import { GameRuleset } from './entities/game-ruleset.entity';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import { sha256StableJson } from './stable-json';

const API_BASE = 'https://api.deadlock-api.com';
const CLIENT_VERSIONS_PATH = '/v1/assets/client-versions';
const ITEMS_PATH = '/v1/assets/items';
const DEFAULT_IMPORT_LIMIT = 1;
const MAX_IMPORT_LIMIT = 100;
const SAVE_CHUNK_SIZE = 250;

export class ImportItemCatalogsDto {
  clientVersions?: number[];
  importAll?: boolean;
  maxVersions?: number;
  language?: string;
  force?: boolean;
}

export class ConfigureRulesetWindowDto {
  validFrom?: string;
  validTo?: string;
  clearValidFrom?: boolean;
  clearValidTo?: boolean;
  status?: string;
}

export interface CatalogImportVersionResult {
  clientVersion: number;
  catalogVersionId: number;
  rulesetId: number;
  itemCount: number;
  recipeCount: number;
  payloadHash: string;
  isCurrent: boolean;
  skipped: boolean;
}

export interface CatalogImportResult {
  availableVersionCount: number;
  latestAvailableClientVersion: number;
  requestedClientVersions: number[];
  imported: CatalogImportVersionResult[];
}

export interface NormalizedCatalogItem {
  itemId: number;
  name: string;
  className: string;
  itemType: string;
  slotType: string;
  cost: number;
  tier: number;
  shopable: boolean;
  disabled: boolean;
  active: boolean;
  isActiveItem: boolean;
  activationType?: string;
  componentReferences: Array<number | string>;
  rawPayload: Record<string, unknown>;
}

@Injectable()
export class ItemCatalogImportService {
  private readonly logger = new Logger(ItemCatalogImportService.name);

  constructor(
    @InjectRepository(ItemCatalogVersion)
    private readonly catalogVersionRepository: Repository<ItemCatalogVersion>,
    @InjectRepository(ItemCatalogItem)
    private readonly catalogItemRepository: Repository<ItemCatalogItem>,
    @InjectRepository(ItemCatalogRecipe)
    private readonly catalogRecipeRepository: Repository<ItemCatalogRecipe>,
    @InjectRepository(GameRuleset)
    private readonly rulesetRepository: Repository<GameRuleset>,
  ) {}

  async getAvailableClientVersions(): Promise<number[]> {
    const response = await axios.get(
      `${API_BASE}${CLIENT_VERSIONS_PATH}`,
      getDeadlockApiRequestConfig(),
    );
    if (!Array.isArray(response.data)) {
      throw new Error('Deadlock API returned an invalid client version list');
    }

    return normalizeClientVersions(response.data);
  }

  async importCatalogs(dto: ImportItemCatalogsDto = {}): Promise<CatalogImportResult> {
    const availableVersions = await this.getAvailableClientVersions();
    if (availableVersions.length === 0) {
      throw new Error('Deadlock API returned no available client versions');
    }

    const requestedClientVersions = selectClientVersions(availableVersions, dto);
    const latestAvailableClientVersion = availableVersions[availableVersions.length - 1];
    const language = normalizeLanguage(dto.language);
    const imported: CatalogImportVersionResult[] = [];

    for (const clientVersion of requestedClientVersions) {
      imported.push(
        await this.importClientVersion(
          clientVersion,
          latestAvailableClientVersion,
          language,
          dto.force === true,
        ),
      );
    }

    return {
      availableVersionCount: availableVersions.length,
      latestAvailableClientVersion,
      requestedClientVersions,
      imported,
    };
  }

  async listCatalogs() {
    const catalogs = await this.catalogVersionRepository.find({
      order: { clientVersion: 'DESC' },
    });

    return Promise.all(
      catalogs.map(async (catalog) => {
        const [itemCount, recipeCount, ruleset] = await Promise.all([
          this.catalogItemRepository.count({ where: { catalogVersionId: catalog.id } }),
          this.catalogRecipeRepository.count({ where: { catalogVersionId: catalog.id } }),
          catalog.rulesetId
            ? this.rulesetRepository.findOne({ where: { id: catalog.rulesetId } })
            : Promise.resolve(undefined),
        ]);

        return {
          id: catalog.id,
          clientVersion: Number(catalog.clientVersion),
          source: catalog.source,
          payloadHash: catalog.payloadHash,
          isCurrent: catalog.isCurrent,
          importedAt: catalog.importedAt,
          itemCount,
          recipeCount,
          ruleset: ruleset
            ? {
                id: ruleset.id,
                rulesetKey: ruleset.rulesetKey,
                status: ruleset.status,
                validFrom: ruleset.validFrom,
                validTo: ruleset.validTo,
              }
            : undefined,
        };
      }),
    );
  }

  async listRulesets() {
    const rulesets = await this.rulesetRepository.find({
      order: { clientVersion: 'DESC' },
    });

    return rulesets.map((ruleset) => ({
      id: ruleset.id,
      rulesetKey: ruleset.rulesetKey,
      clientVersion: ruleset.clientVersion ? Number(ruleset.clientVersion) : undefined,
      status: ruleset.status,
      source: ruleset.source,
      validFrom: ruleset.validFrom,
      validTo: ruleset.validTo,
      rawMetadata: ruleset.rawMetadata,
      createdAt: ruleset.createdAt,
      updatedAt: ruleset.updatedAt,
    }));
  }

  async configureRulesetWindow(clientVersion: number, dto: ConfigureRulesetWindowDto) {
    const ruleset =
      (await this.rulesetRepository.findOne({
        where: { rulesetKey: `client-${clientVersion}` },
      })) ??
      (await this.rulesetRepository.findOne({
        where: { clientVersion },
      }));
    if (!ruleset) {
      throw new Error(`No ruleset exists for client version ${clientVersion}`);
    }

    if (dto.clearValidFrom === true) {
      ruleset.validFrom = null as unknown as Date;
    } else if (dto.validFrom !== undefined) {
      ruleset.validFrom = parseDate(dto.validFrom, 'validFrom');
    }
    if (dto.clearValidTo === true) {
      ruleset.validTo = null as unknown as Date;
    } else if (dto.validTo !== undefined) {
      ruleset.validTo = parseDate(dto.validTo, 'validTo');
    }
    if (dto.status !== undefined) {
      const status = dto.status.trim().toLowerCase();
      if (!['active', 'inactive', 'deprecated'].includes(status)) {
        throw new Error('status must be active, inactive, or deprecated');
      }
      ruleset.status = status;
    }

    if (ruleset.validFrom && ruleset.validTo && ruleset.validFrom >= ruleset.validTo) {
      throw new Error('validFrom must be earlier than validTo');
    }

    const saved = await this.rulesetRepository.save(ruleset);
    return {
      id: saved.id,
      rulesetKey: saved.rulesetKey,
      clientVersion: Number(saved.clientVersion),
      status: saved.status,
      validFrom: saved.validFrom,
      validTo: saved.validTo,
    };
  }

  private async importClientVersion(
    clientVersion: number,
    latestAvailableClientVersion: number,
    language: string,
    force: boolean,
  ): Promise<CatalogImportVersionResult> {
    const response = await axios.get(`${API_BASE}${ITEMS_PATH}`, {
      ...getDeadlockApiRequestConfig(),
      params: {
        client_version: clientVersion,
        language,
      },
    });

    if (!Array.isArray(response.data) || response.data.length === 0) {
      throw new Error(`Deadlock API returned no items for client version ${clientVersion}`);
    }

    const rawItems = response.data.filter(isRecord);
    const normalizedItems = deduplicateCatalogItems(
      rawItems
        .map((item) => normalizeCatalogItem(item))
        .filter((item): item is NormalizedCatalogItem => item !== undefined),
    );

    if (normalizedItems.length === 0) {
      throw new Error(`No valid item rows were found for client version ${clientVersion}`);
    }

    const payloadHash = sha256StableJson(rawItems);
    const isCurrent = clientVersion === latestAvailableClientVersion;

    const result = await this.catalogVersionRepository.manager.transaction(async (manager) => {
      const rulesetRepository = manager.getRepository(GameRuleset);
      const versionRepository = manager.getRepository(ItemCatalogVersion);
      const itemRepository = manager.getRepository(ItemCatalogItem);
      const recipeRepository = manager.getRepository(ItemCatalogRecipe);

      const rulesetKey = `client-${clientVersion}`;
      let ruleset = await rulesetRepository.findOne({ where: { rulesetKey } });
      if (!ruleset) {
        ruleset = rulesetRepository.create({
          rulesetKey,
          clientVersion,
          status: 'active',
          source: 'deadlock-api-assets',
          rawMetadata: {
            clientVersion,
            sourcePath: CLIENT_VERSIONS_PATH,
          },
        });
      } else {
        ruleset.clientVersion = clientVersion;
        ruleset.source = 'deadlock-api-assets';
        ruleset.rawMetadata = {
          ...(ruleset.rawMetadata ?? {}),
          clientVersion,
          sourcePath: CLIENT_VERSIONS_PATH,
        };
      }
      ruleset = await rulesetRepository.save(ruleset);

      let catalog = await versionRepository.findOne({ where: { clientVersion } });
      const unchanged = catalog?.payloadHash === payloadHash;

      if (!catalog) {
        catalog = versionRepository.create({
          clientVersion,
          rulesetId: ruleset.id,
          source: 'deadlock-api-assets',
          payloadHash,
          rawPayload: {
            clientVersion,
            language,
            itemCount: rawItems.length,
            sourcePath: ITEMS_PATH,
          },
          isCurrent,
        });
      } else {
        catalog.rulesetId = ruleset.id;
        catalog.source = 'deadlock-api-assets';
        catalog.payloadHash = payloadHash;
        catalog.rawPayload = {
          clientVersion,
          language,
          itemCount: rawItems.length,
          sourcePath: ITEMS_PATH,
        };
        catalog.isCurrent = isCurrent;
      }

      if (isCurrent) {
        await versionRepository
          .createQueryBuilder()
          .update(ItemCatalogVersion)
          .set({ isCurrent: false })
          .where('"isCurrent" = true')
          .execute();
        catalog.isCurrent = true;
      }

      catalog = await versionRepository.save(catalog);

      if (unchanged && !force) {
        const [itemCount, recipeCount] = await Promise.all([
          itemRepository.count({ where: { catalogVersionId: catalog.id } }),
          recipeRepository.count({ where: { catalogVersionId: catalog.id } }),
        ]);
        return {
          clientVersion,
          catalogVersionId: catalog.id,
          rulesetId: ruleset.id,
          itemCount,
          recipeCount,
          payloadHash,
          isCurrent: catalog.isCurrent,
          skipped: true,
        };
      }

      await recipeRepository.delete({ catalogVersionId: catalog.id });
      await itemRepository.delete({ catalogVersionId: catalog.id });

      const itemEntities = normalizedItems.map((item) =>
        itemRepository.create({
          catalogVersionId: catalog.id,
          itemId: item.itemId,
          name: item.name,
          className: item.className,
          itemType: item.itemType,
          slotType: item.slotType,
          cost: item.cost,
          tier: item.tier,
          shopable: item.shopable,
          disabled: item.disabled,
          active: item.active,
          isActiveItem: item.isActiveItem,
          activationType: item.activationType,
          rawPayload: item.rawPayload,
        }),
      );

      await saveInChunks(itemRepository, itemEntities);

      const itemIdByClassName = new Map(
        normalizedItems.map((item) => [item.className, item.itemId]),
      );
      const knownItemIds = new Set(normalizedItems.map((item) => item.itemId));
      const recipeEntities: ItemCatalogRecipe[] = [];

      for (const item of normalizedItems) {
        item.componentReferences.forEach((reference, componentOrder) => {
          const componentItemId = resolveComponentItemId(reference, itemIdByClassName);
          if (
            !componentItemId ||
            componentItemId === item.itemId ||
            !knownItemIds.has(componentItemId)
          ) {
            return;
          }

          recipeEntities.push(
            recipeRepository.create({
              catalogVersionId: catalog.id,
              parentItemId: item.itemId,
              componentItemId,
              componentOrder,
            }),
          );
        });
      }

      const uniqueRecipeEntities = deduplicateRecipes(recipeEntities);
      await saveInChunks(recipeRepository, uniqueRecipeEntities);

      return {
        clientVersion,
        catalogVersionId: catalog.id,
        rulesetId: ruleset.id,
        itemCount: itemEntities.length,
        recipeCount: uniqueRecipeEntities.length,
        payloadHash,
        isCurrent: catalog.isCurrent,
        skipped: false,
      };
    });

    this.logger.log(
      `${result.skipped ? 'Verified' : 'Imported'} item catalog ${clientVersion}: ` +
        `${result.itemCount} items, ${result.recipeCount} recipes`,
    );

    return result;
  }
}

export function normalizeClientVersions(value: unknown[]): number[] {
  return [
    ...new Set(
      value.map(toPositiveInteger).filter((entry): entry is number => entry !== undefined),
    ),
  ].sort((left, right) => left - right);
}

export function selectClientVersions(
  availableVersions: number[],
  dto: ImportItemCatalogsDto,
): number[] {
  const available = normalizeClientVersions(availableVersions);
  if (available.length === 0) {
    return [];
  }

  const explicit = normalizeClientVersions(dto.clientVersions ?? []);
  if (explicit.length > 0) {
    const availableSet = new Set(available);
    const unavailable = explicit.filter((version) => !availableSet.has(version));
    if (unavailable.length > 0) {
      throw new Error(`Unavailable client versions: ${unavailable.join(', ')}`);
    }
    return explicit;
  }

  if (dto.importAll === true) {
    return available;
  }

  const requestedLimit = toPositiveInteger(dto.maxVersions) ?? DEFAULT_IMPORT_LIMIT;
  const limit = Math.min(requestedLimit, MAX_IMPORT_LIMIT);
  return available.slice(-limit);
}

export function normalizeCatalogItem(value: unknown): NormalizedCatalogItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const itemId = toPositiveInteger(value.id);
  const className = toNonEmptyString(value.class_name);
  if (!itemId || !className) {
    return undefined;
  }

  const disabled = toBoolean(value.disabled) ?? false;
  const explicitActive = toBoolean(value.active);

  return {
    itemId,
    name: toNonEmptyString(value.name) ?? className,
    className,
    itemType: toNonEmptyString(value.type) ?? 'unknown',
    slotType: toNonEmptyString(value.item_slot_type) ?? 'unknown',
    cost: toInteger(value.cost) ?? 0,
    tier: toInteger(value.item_tier) ?? 0,
    shopable: toBoolean(value.shopable) ?? false,
    disabled,
    active: explicitActive ?? !disabled,
    isActiveItem: toBoolean(value.is_active_item) ?? false,
    activationType:
      toNonEmptyString(value.activation_type) ??
      toNonEmptyString(value.activation) ??
      toNonEmptyString(value.ability_activation),
    componentReferences: Array.isArray(value.component_items)
      ? value.component_items.filter(
          (entry): entry is number | string =>
            typeof entry === 'number' || typeof entry === 'string',
        )
      : [],
    rawPayload: value,
  };
}

function deduplicateCatalogItems(items: NormalizedCatalogItem[]): NormalizedCatalogItem[] {
  const seenItemIds = new Set<number>();
  return items.filter((item) => {
    if (seenItemIds.has(item.itemId)) {
      return false;
    }
    seenItemIds.add(item.itemId);
    return true;
  });
}

function resolveComponentItemId(
  reference: number | string,
  itemIdByClassName: ReadonlyMap<string, number>,
): number | undefined {
  if (typeof reference === 'number') {
    return toPositiveInteger(reference);
  }

  const numeric = toPositiveInteger(reference);
  if (numeric) {
    return numeric;
  }

  return itemIdByClassName.get(reference);
}

export function deduplicateRecipes(recipes: ItemCatalogRecipe[]): ItemCatalogRecipe[] {
  const seen = new Set<string>();
  return recipes.filter((recipe) => {
    const key = `${recipe.catalogVersionId}:${recipe.parentItemId}:${recipe.componentOrder}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function saveInChunks<T extends ObjectLiteral>(
  repository: Repository<T>,
  entities: T[],
): Promise<void> {
  for (let index = 0; index < entities.length; index += SAVE_CHUNK_SIZE) {
    await repository.save(entities.slice(index, index + SAVE_CHUNK_SIZE));
  }
}

function normalizeLanguage(value: string | undefined): string {
  const language = value?.trim().toLowerCase() || 'english';
  if (!/^[a-z]+$/.test(language)) {
    throw new Error('language must contain lowercase alphabetic characters only');
  }
  return language;
}

function parseDate(value: string, fieldName: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO date`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toPositiveInteger(value: unknown): number | undefined {
  const parsed = toInteger(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function toInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 1 || value === '1' || value === 'true') {
    return true;
  }
  if (value === 0 || value === '0' || value === 'false') {
    return false;
  }
  return undefined;
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
