import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RecommendationItemGraph,
  buildRecommendationRulesetCatalogV1,
  compileStrictRecommendationCatalogV1,
} from '@deadlock-live-probe/build-domain';
import { RecommendationItemCatalogItemV1 } from '../deadlock-live/entities/recommendation-item-catalog-item-v1.entity';
import { RecommendationItemCatalogRecipeV1 } from '../deadlock-live/entities/recommendation-item-catalog-recipe-v1.entity';
import { RecommendationItemCatalogVersionV1 } from '../deadlock-live/entities/recommendation-item-catalog-version-v1.entity';
import { resolveRecommendationCatalogAssetSemantics } from '../deadlock-live/recommendation-catalog-asset-semantics';
import { RecommendationEconomyRulesV1 } from './adaptive-economy-v1';
import {
  BuildStrategyMiningPipelineV1Result,
  BuildStrategyMiningPipelineV1Service,
} from './build-strategy-mining-pipeline-v1.service';
import {
  PublishRecommendationEconomyRulesV1Input,
  RecommendationEconomyRulesStoreV1Service,
} from './recommendation-economy-rules-store-v1.service';
import { StatlockerEvidenceService } from './statlocker-evidence.service';
import { StatlockerRefreshService } from './statlocker-refresh.service';

export interface MineStrategyForIdentityV1Input {
  heroId: number;
  patchId: string;
  rulesetId: string;
  catalogSha256: string;
  limit?: number;
  minClusterSize?: number;
  distanceThreshold?: number;
  publishedAt?: Date;
}

export interface MineStrategyForIdentityV1Result {
  attempted: boolean;
  published: boolean;
  snapshotId?: string;
  reasonCodes: readonly string[];
  pipeline?: BuildStrategyMiningPipelineV1Result;
}

export interface StrategyFirstOperationsStatusV1 {
  inFlightKeys: readonly string[];
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  bootstrapEconomyRulesCount: number;
  lastMineByHero: Readonly<Record<string, MineStrategyForIdentityV1Result>>;
}

interface EconomyRulesBootstrapEntryV1 {
  snapshotId: string;
  source: string;
  verifiedAt?: string;
  rules: RecommendationEconomyRulesV1;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DEFAULT_MINING_TTL_MS = 6 * HOUR;

@Injectable()
export class StrategyFirstOperationsV1Service implements OnModuleInit {
  private readonly logger = new Logger(StrategyFirstOperationsV1Service.name);
  private readonly inFlight = new Map<string, Promise<MineStrategyForIdentityV1Result>>();
  private readonly lastMineByHero = new Map<string, MineStrategyForIdentityV1Result>();
  private readonly lastSuccessByKey = new Map<string, number>();
  private readonly miningTtlMs = readBoundedMs(
    process.env.ADAPTIVE_STRATEGY_MINING_TTL_MS,
    DEFAULT_MINING_TTL_MS,
    15 * MINUTE,
    7 * 24 * HOUR,
  );
  private lastAttemptAt?: string;
  private lastSuccessAt?: string;
  private lastError?: string;
  private bootstrapEconomyRulesCount = 0;

  constructor(
    @InjectRepository(RecommendationItemCatalogVersionV1)
    private readonly versionRepo: Repository<RecommendationItemCatalogVersionV1>,
    @InjectRepository(RecommendationItemCatalogItemV1)
    private readonly itemRepo: Repository<RecommendationItemCatalogItemV1>,
    @InjectRepository(RecommendationItemCatalogRecipeV1)
    private readonly recipeRepo: Repository<RecommendationItemCatalogRecipeV1>,
    private readonly economyRulesStore: RecommendationEconomyRulesStoreV1Service,
    private readonly miningPipeline: BuildStrategyMiningPipelineV1Service,
    @Optional() private readonly refresh?: StatlockerRefreshService,
    @Optional() private readonly evidence?: StatlockerEvidenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    const entries = parseEconomyBootstrap(process.env.ADAPTIVE_ECONOMY_RULES_JSON);
    for (const entry of entries) {
      await this.publishEconomyRules({
        snapshotId: entry.snapshotId,
        source: entry.source,
        verifiedAt: entry.verifiedAt ? parseDate(entry.verifiedAt) : undefined,
        rules: entry.rules,
      });
      this.bootstrapEconomyRulesCount += 1;
    }
  }

  async publishEconomyRules(input: PublishRecommendationEconomyRulesV1Input): Promise<void> {
    await this.economyRulesStore.publish(input);
  }

  async mineHeroForIdentity(input: MineStrategyForIdentityV1Input): Promise<MineStrategyForIdentityV1Result> {
    validateMineInput(input);
    const normalized = {
      ...input,
      catalogSha256: input.catalogSha256.toLowerCase(),
    };
    const key = mineKey(normalized);
    const current = this.inFlight.get(key);
    if (current) return current;

    const promise = this.mineSingle(normalized)
      .finally(() => {
        if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  @Cron('*/5 * * * *')
  async scheduledTick(nowMs = Date.now()): Promise<void> {
    const refresh = this.refresh?.getStatus();
    const identity = refresh?.identity;
    if (!identity || !this.evidence) return;
    const local = this.evidence.getLocalStatus(identity);
    const patchId = local.statlockerPatchId;
    if (!patchId) return;

    const heroId = [...(refresh?.activeHeroIds ?? [])]
      .sort((a, b) => a - b)
      .find((candidate) => this.isDue({
        heroId: candidate,
        patchId,
        rulesetId: identity.rulesetVersion,
        catalogSha256: identity.catalogSha256,
      }, nowMs));
    if (heroId === undefined) return;

    await this.mineHeroForIdentity({
      heroId,
      patchId,
      rulesetId: identity.rulesetVersion,
      catalogSha256: identity.catalogSha256,
    });
  }

  getStatus(): StrategyFirstOperationsStatusV1 {
    return {
      inFlightKeys: [...this.inFlight.keys()].sort(),
      lastAttemptAt: this.lastAttemptAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      bootstrapEconomyRulesCount: this.bootstrapEconomyRulesCount,
      lastMineByHero: Object.fromEntries(
        [...this.lastMineByHero.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, clone(value)]),
      ),
    };
  }

  private isDue(input: MineStrategyForIdentityV1Input, nowMs: number): boolean {
    const lastSuccess = this.lastSuccessByKey.get(mineKey(input));
    return lastSuccess === undefined || nowMs - lastSuccess >= this.miningTtlMs;
  }

  private async mineSingle(input: MineStrategyForIdentityV1Input): Promise<MineStrategyForIdentityV1Result> {
    this.lastAttemptAt = new Date().toISOString();
    this.lastError = undefined;
    const key = mineKey(input);
    const statusKey = `${input.heroId}:${input.rulesetId}:${input.catalogSha256}`;
    try {
      const economyRules = await this.economyRulesStore.resolveExact(input.rulesetId, input.catalogSha256);
      if (!economyRules) {
        return this.remember(statusKey, {
          attempted: false,
          published: false,
          reasonCodes: ['EXACT_ECONOMY_RULES_UNAVAILABLE'],
        });
      }

      const graph = await this.loadExactGraph(input.rulesetId, input.catalogSha256);
      if (!graph) {
        return this.remember(statusKey, {
          attempted: false,
          published: false,
          reasonCodes: ['EXACT_ITEM_CATALOG_UNAVAILABLE'],
        });
      }

      const pipeline = await this.miningPipeline.run({
        heroId: input.heroId,
        patchId: input.patchId,
        rulesetId: input.rulesetId,
        catalogSha256: input.catalogSha256,
        itemGraph: graph,
        economyRules,
        limit: input.limit,
        minClusterSize: input.minClusterSize,
        distanceThreshold: input.distanceThreshold,
        publishedAt: input.publishedAt,
      });
      const result: MineStrategyForIdentityV1Result = {
        attempted: true,
        published: pipeline.published,
        snapshotId: pipeline.snapshotId,
        reasonCodes: [...pipeline.reasonCodes],
        pipeline,
      };
      if (pipeline.published) {
        const now = Date.now();
        this.lastSuccessAt = new Date(now).toISOString();
        this.lastSuccessByKey.set(key, now);
      }
      return this.remember(statusKey, result);
    } catch (error) {
      this.lastError = describeError(error);
      this.logger.error(`strategy-first mining failed ${statusKey}: ${this.lastError}`);
      return this.remember(statusKey, {
        attempted: true,
        published: false,
        reasonCodes: ['STRATEGY_MINING_FAILED'],
      });
    }
  }

  private remember(key: string, result: MineStrategyForIdentityV1Result): MineStrategyForIdentityV1Result {
    const stable = clone(result);
    this.lastMineByHero.set(key, stable);
    return stable;
  }

  private async loadExactGraph(rulesetId: string, catalogSha256: string): Promise<RecommendationItemGraph | undefined> {
    const versions = await this.versionRepo.find({
      where: { payloadSha256: catalogSha256 },
      order: { importedAt: 'DESC', catalogVersionId: 'DESC' },
      take: 1,
    });
    const version = versions[0];
    if (!version || version.rulesetKey !== rulesetId || version.payloadSha256.toLowerCase() !== catalogSha256) {
      return undefined;
    }

    const [itemRows, recipeRows] = await Promise.all([
      this.itemRepo.find({
        where: { catalogVersionId: version.catalogVersionId },
        order: { itemId: 'ASC' },
      }),
      this.recipeRepo.find({
        where: { catalogVersionId: version.catalogVersionId },
        order: { parentItemId: 'ASC', componentOrder: 'ASC', componentItemId: 'ASC' },
      }),
    ]);
    const catalog = buildRecommendationRulesetCatalogV1({
      version: {
        catalogVersionId: version.catalogVersionId,
        contentCatalogVersionId: version.contentCatalogVersionId,
        clientVersion: version.clientVersion,
        rulesetKey: version.rulesetKey,
        source: version.source,
        payloadSha256: version.payloadSha256,
        importedAt: version.importedAt.toISOString(),
      },
      items: itemRows.map((row) => {
        const semantics = resolveRecommendationCatalogAssetSemantics(row);
        return {
          itemId: Number(row.itemId),
          name: row.name,
          className: row.className,
          itemType: semantics.itemType,
          slotType: row.slotType,
          cost: row.cost,
          tier: row.tier,
          shopable: semantics.shopable,
          disabled: semantics.disabled,
          active: semantics.active,
          isActiveItem: semantics.isActiveItem,
          activationType: semantics.activationType,
          rawPayload: row.rawPayload,
        };
      }),
      recipeEdges: recipeRows.map((row) => ({
        parentItemId: Number(row.parentItemId),
        componentItemId: Number(row.componentItemId),
        componentOrder: row.componentOrder,
      })),
    });
    const compiled = compileStrictRecommendationCatalogV1(catalog);
    return compiled.rulesetId === rulesetId ? compiled.graph : undefined;
  }
}

function mineKey(input: MineStrategyForIdentityV1Input): string {
  return `${input.heroId}:${input.patchId}:${input.rulesetId}:${input.catalogSha256.toLowerCase()}`;
}

function parseEconomyBootstrap(raw: string | undefined): EconomyRulesBootstrapEntryV1[] {
  if (!raw || raw.trim() === '') return [];
  const parsed = JSON.parse(raw) as unknown;
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.snapshotId !== 'string' || entry.snapshotId.trim() === '' ||
      typeof entry.source !== 'string' || entry.source.trim() === '' || !isRecord(entry.rules)) {
      throw new Error(`ADAPTIVE_ECONOMY_RULES_JSON entry ${index} is invalid`);
    }
    if (entry.verifiedAt !== undefined && typeof entry.verifiedAt !== 'string') {
      throw new Error(`ADAPTIVE_ECONOMY_RULES_JSON entry ${index} verifiedAt is invalid`);
    }
    return {
      snapshotId: entry.snapshotId,
      source: entry.source,
      verifiedAt: entry.verifiedAt,
      rules: entry.rules as unknown as RecommendationEconomyRulesV1,
    };
  });
}

function validateMineInput(input: MineStrategyForIdentityV1Input): void {
  if (!Number.isInteger(input.heroId) || input.heroId <= 0 || !input.patchId || !input.rulesetId ||
    !/^[a-f0-9]{64}$/i.test(input.catalogSha256)) {
    throw new Error('Strategy-first mining identity is invalid');
  }
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid economy verifiedAt: ${value}`);
  return date;
}

function readBoundedMs(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
