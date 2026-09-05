import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameRuleset } from './entities/game-ruleset.entity';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import {
  RawMatchMetadata,
  RulesetResolutionMethod,
} from './entities/raw-match-metadata.entity';

const DEFAULT_BOUNDARY_MARGIN_MINUTES = 360;
const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 1000;

export class ResolvePendingRulesetsDto {
  limit?: number;
}

export class MissingRawMatchMetadataError extends Error {
  constructor(readonly matchId: number) {
    super(`No raw metadata found for match ${matchId}`);
    this.name = 'MissingRawMatchMetadataError';
  }
}

export interface RulesetResolutionResult {
  matchId: number;
  rawMetadataId: number;
  method: RulesetResolutionMethod;
  confidence: number;
  clientVersion?: number;
  rulesetId?: number;
  catalogVersionId?: number;
  rulesetKey?: string;
  matchStartTime?: Date;
  details: Record<string, unknown>;
}

export interface RulesetWindowCandidate {
  id: number;
  rulesetKey: string;
  clientVersion: number;
  validFrom?: Date;
  validTo?: Date;
  status: string;
}

export interface TimeWindowResolution {
  candidate?: RulesetWindowCandidate;
  boundaryExcluded: boolean;
  ambiguityCount: number;
}

export interface VersionCandidate {
  clientVersion: number;
  path: string;
}

@Injectable()
export class RulesetResolverService {
  private readonly logger = new Logger(RulesetResolverService.name);

  constructor(
    @InjectRepository(RawMatchMetadata)
    private readonly rawMetadataRepository: Repository<RawMatchMetadata>,
    @InjectRepository(GameRuleset)
    private readonly rulesetRepository: Repository<GameRuleset>,
    @InjectRepository(ItemCatalogVersion)
    private readonly catalogVersionRepository: Repository<ItemCatalogVersion>,
  ) {}

  async resolveLatestForMatch(matchId: number): Promise<RulesetResolutionResult> {
    const rawMetadata = await this.rawMetadataRepository.findOne({
      where: { matchId },
      order: { fetchedAt: 'DESC', id: 'DESC' },
    });
    if (!rawMetadata) {
      throw new MissingRawMatchMetadataError(matchId);
    }

    return this.resolveAndPersist(rawMetadata);
  }

  async getLatestForMatch(matchId: number): Promise<RulesetResolutionResult> {
    const rawMetadata = await this.rawMetadataRepository.findOne({
      where: { matchId },
      order: { fetchedAt: 'DESC', id: 'DESC' },
    });
    if (!rawMetadata) {
      throw new MissingRawMatchMetadataError(matchId);
    }

    if (
      rawMetadata.resolvedAt &&
      rawMetadata.rulesetResolutionMethod !== 'UNKNOWN'
    ) {
      return this.toStoredResolution(rawMetadata);
    }

    return this.resolveAndPersist(rawMetadata);
  }

  async resolvePending(dto: ResolvePendingRulesetsDto = {}) {
    const limit = normalizeBatchLimit(dto.limit);
    const rows = await this.rawMetadataRepository.find({
      where: { rulesetResolutionMethod: 'UNKNOWN' },
      order: { fetchedAt: 'ASC', id: 'ASC' },
      take: limit,
    });

    const results: RulesetResolutionResult[] = [];
    for (const row of rows) {
      results.push(await this.resolveAndPersist(row));
    }

    return {
      requestedLimit: limit,
      processed: results.length,
      resolved: results.filter((result) => result.method !== 'UNKNOWN').length,
      unknown: results.filter((result) => result.method === 'UNKNOWN').length,
      results,
    };
  }

  async resolveAndPersist(rawMetadata: RawMatchMetadata): Promise<RulesetResolutionResult> {
    const result = await this.resolve(rawMetadata);

    if (
      result.method === 'UNKNOWN' &&
      rawMetadata.rulesetResolutionMethod !== 'UNKNOWN' &&
      rawMetadata.resolvedAt
    ) {
      return this.toStoredResolution(rawMetadata);
    }

    const update = {
      rulesetResolutionMethod: result.method,
      rulesetResolutionConfidence: result.confidence,
      rulesetResolutionDetails: result.details,
      resolvedRulesetId: result.rulesetId ?? null,
      resolvedCatalogVersionId: result.catalogVersionId ?? null,
      resolvedAt: new Date(),
      ...(result.clientVersion !== undefined
        ? { clientVersion: result.clientVersion }
        : {}),
    } as unknown as Partial<RawMatchMetadata>;

    await this.rawMetadataRepository.update(rawMetadata.id, update as any);
    Object.assign(rawMetadata, update);

    this.logger.debug(
      `Resolved match ${rawMetadata.matchId}: ${result.method} ` +
        `(clientVersion=${result.clientVersion ?? 'unknown'}, confidence=${result.confidence})`,
    );

    return result;
  }

  async resolve(rawMetadata: RawMatchMetadata): Promise<RulesetResolutionResult> {
    const payload = rawMetadata.payload;
    const matchStartTime = extractMatchStartTime(payload);
    const observedCandidate = extractObservedClientVersion(payload);

    if (observedCandidate) {
      return this.resolveVersionCandidate(
        rawMetadata,
        observedCandidate,
        'OBSERVED',
        1,
        matchStartTime,
      );
    }

    const demoCandidates = extractDemoMetadataClientVersions(payload);
    for (const demoCandidate of demoCandidates) {
      if (await this.isKnownClientVersion(demoCandidate.clientVersion)) {
        return this.resolveVersionCandidate(
          rawMetadata,
          demoCandidate,
          'DEMO_METADATA',
          0.95,
          matchStartTime,
        );
      }
    }

    if (!matchStartTime) {
      return unknownResolution(rawMetadata, {
        reason: 'MATCH_START_TIME_MISSING',
        unmatchedDemoCandidates: demoCandidates,
      });
    }

    const rulesets = await this.rulesetRepository.find({
      where: { status: 'active' },
      order: { clientVersion: 'ASC' },
    });
    const candidates = rulesets
      .map(toRulesetWindowCandidate)
      .filter(
        (candidate) =>
          Number.isSafeInteger(candidate.clientVersion) && candidate.clientVersion > 0,
      );
    const boundaryMarginMinutes = getBoundaryMarginMinutes();
    const windowResolution = resolveRulesetByTimeWindow(
      matchStartTime,
      candidates,
      boundaryMarginMinutes * 60 * 1000,
    );

    if (!windowResolution.candidate) {
      return unknownResolution(rawMetadata, {
        reason: windowResolution.boundaryExcluded
          ? 'PATCH_BOUNDARY_EXCLUDED'
          : windowResolution.ambiguityCount > 1
            ? 'OVERLAPPING_RULESET_WINDOWS'
            : 'NO_RULESET_WINDOW',
        matchStartTime: matchStartTime.toISOString(),
        boundaryMarginMinutes,
        ambiguityCount: windowResolution.ambiguityCount,
        unmatchedDemoCandidates: demoCandidates,
      });
    }

    return this.resolveVersionCandidate(
      rawMetadata,
      {
        clientVersion: windowResolution.candidate.clientVersion,
        path: `game_rulesets.${windowResolution.candidate.rulesetKey}`,
      },
      'TIME_WINDOW',
      0.75,
      matchStartTime,
      windowResolution.candidate,
    );
  }

  private async resolveVersionCandidate(
    rawMetadata: RawMatchMetadata,
    candidate: VersionCandidate,
    method: RulesetResolutionMethod,
    confidence: number,
    matchStartTime?: Date,
    knownRuleset?: RulesetWindowCandidate,
  ): Promise<RulesetResolutionResult> {
    const [catalog, ruleset] = await Promise.all([
      this.catalogVersionRepository.findOne({
        where: { clientVersion: candidate.clientVersion },
      }),
      knownRuleset
        ? Promise.resolve(
            this.rulesetRepository.create({
              id: knownRuleset.id,
              rulesetKey: knownRuleset.rulesetKey,
              clientVersion: knownRuleset.clientVersion,
              status: knownRuleset.status,
              validFrom: knownRuleset.validFrom,
              validTo: knownRuleset.validTo,
            }),
          )
        : this.findRulesetByClientVersion(candidate.clientVersion),
    ]);

    return {
      matchId: Number(rawMetadata.matchId),
      rawMetadataId: rawMetadata.id,
      method,
      confidence,
      clientVersion: candidate.clientVersion,
      rulesetId: ruleset?.id,
      catalogVersionId: catalog?.id,
      rulesetKey: ruleset?.rulesetKey,
      matchStartTime,
      details: {
        sourcePath: candidate.path,
        catalogAvailable: catalog != null,
        rulesetAvailable: ruleset != null,
        catalogPayloadHash: catalog?.payloadHash,
        isCurrentCatalog: catalog?.isCurrent,
      },
    };
  }

  private async isKnownClientVersion(clientVersion: number): Promise<boolean> {
    const [catalog, ruleset] = await Promise.all([
      this.catalogVersionRepository.findOne({ where: { clientVersion } }),
      this.findRulesetByClientVersion(clientVersion),
    ]);
    return catalog != null || ruleset !== undefined;
  }

  private async findRulesetByClientVersion(
    clientVersion: number,
  ): Promise<GameRuleset | undefined> {
    const canonical = await this.rulesetRepository.findOne({
      where: { rulesetKey: `client-${clientVersion}` },
    });
    if (canonical) {
      return canonical;
    }
    return (
      (await this.rulesetRepository.findOne({ where: { clientVersion } })) ?? undefined
    );
  }

  private async toStoredResolution(
    rawMetadata: RawMatchMetadata,
  ): Promise<RulesetResolutionResult> {
    const [ruleset, catalog] = await Promise.all([
      rawMetadata.resolvedRulesetId
        ? this.rulesetRepository.findOne({ where: { id: rawMetadata.resolvedRulesetId } })
        : Promise.resolve(undefined),
      rawMetadata.resolvedCatalogVersionId
        ? this.catalogVersionRepository.findOne({
            where: { id: rawMetadata.resolvedCatalogVersionId },
          })
        : Promise.resolve(undefined),
    ]);

    return {
      matchId: Number(rawMetadata.matchId),
      rawMetadataId: rawMetadata.id,
      method: rawMetadata.rulesetResolutionMethod,
      confidence: rawMetadata.rulesetResolutionConfidence,
      clientVersion: rawMetadata.clientVersion
        ? Number(rawMetadata.clientVersion)
        : undefined,
      rulesetId: ruleset?.id,
      catalogVersionId: catalog?.id,
      rulesetKey: ruleset?.rulesetKey,
      matchStartTime: extractMatchStartTime(rawMetadata.payload),
      details: rawMetadata.rulesetResolutionDetails ?? {},
    };
  }
}

export function extractObservedClientVersion(
  payload: Record<string, unknown>,
): VersionCandidate | undefined {
  return readVersionAtPaths(payload, [
    ['client_version'],
    ['match_info', 'client_version'],
  ]);
}

export function extractDemoMetadataClientVersion(
  payload: Record<string, unknown>,
): VersionCandidate | undefined {
  return extractDemoMetadataClientVersions(payload)[0];
}

export function extractDemoMetadataClientVersions(
  payload: Record<string, unknown>,
): VersionCandidate[] {
  return readVersionsAtPaths(payload, [
    ['demo_metadata', 'client_version'],
    ['demo_metadata', 'build_version'],
    ['demo_metadata', 'build_id'],
    ['metadata', 'client_version'],
    ['metadata', 'build_version'],
    ['metadata', 'build_id'],
    ['match_info', 'build_version'],
    ['match_info', 'game_version'],
    ['match_info', 'build_id'],
    ['build_version'],
    ['game_version'],
    ['build_id'],
  ]);
}

export function extractMatchStartTime(payload: Record<string, unknown>): Date | undefined {
  const matchInfo = toRecord(payload.match_info);
  const rawValue = matchInfo?.start_time ?? payload.start_time;
  const numeric = toFiniteNumber(rawValue);
  if (numeric === undefined || numeric <= 0) {
    return undefined;
  }

  const timestampMs = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(timestampMs);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function resolveRulesetByTimeWindow(
  matchStartTime: Date,
  rulesets: RulesetWindowCandidate[],
  boundaryMarginMs: number,
): TimeWindowResolution {
  const matchTime = matchStartTime.getTime();
  const matching = rulesets.filter((ruleset) => {
    if (ruleset.status !== 'active' || !ruleset.validFrom) {
      return false;
    }

    const from = ruleset.validFrom.getTime();
    const to = ruleset.validTo?.getTime();
    return matchTime >= from && (to === undefined || matchTime < to);
  });

  if (matching.length !== 1) {
    return {
      boundaryExcluded: false,
      ambiguityCount: matching.length,
    };
  }

  const candidate = matching[0];
  const distanceFromStart = Math.abs(matchTime - candidate.validFrom!.getTime());
  const distanceFromEnd = candidate.validTo
    ? Math.abs(candidate.validTo.getTime() - matchTime)
    : Number.POSITIVE_INFINITY;
  const boundaryExcluded =
    distanceFromStart <= boundaryMarginMs || distanceFromEnd <= boundaryMarginMs;

  return {
    candidate: boundaryExcluded ? undefined : candidate,
    boundaryExcluded,
    ambiguityCount: 1,
  };
}

function unknownResolution(
  rawMetadata: RawMatchMetadata,
  details: Record<string, unknown>,
): RulesetResolutionResult {
  return {
    matchId: Number(rawMetadata.matchId),
    rawMetadataId: rawMetadata.id,
    method: 'UNKNOWN',
    confidence: 0,
    matchStartTime: extractMatchStartTime(rawMetadata.payload),
    details,
  };
}

function readVersionsAtPaths(
  payload: Record<string, unknown>,
  paths: string[][],
): VersionCandidate[] {
  const candidates: VersionCandidate[] = [];
  const seen = new Set<number>();
  for (const path of paths) {
    const candidate = readVersionAtPaths(payload, [path]);
    if (candidate && !seen.has(candidate.clientVersion)) {
      seen.add(candidate.clientVersion);
      candidates.push(candidate);
    }
  }
  return candidates;
}

function readVersionAtPaths(
  payload: Record<string, unknown>,
  paths: string[][],
): VersionCandidate | undefined {
  for (const path of paths) {
    let value: unknown = payload;
    for (const segment of path) {
      const record = toRecord(value);
      if (!record) {
        value = undefined;
        break;
      }
      value = record[segment];
    }

    const clientVersion = toPositiveInteger(value);
    if (clientVersion !== undefined) {
      return {
        clientVersion,
        path: path.join('.'),
      };
    }
  }

  return undefined;
}

function toRulesetWindowCandidate(ruleset: GameRuleset): RulesetWindowCandidate {
  return {
    id: ruleset.id,
    rulesetKey: ruleset.rulesetKey,
    clientVersion: Number(ruleset.clientVersion),
    validFrom: ruleset.validFrom,
    validTo: ruleset.validTo,
    status: ruleset.status,
  };
}

function getBoundaryMarginMinutes(): number {
  const parsed = Number.parseInt(
    process.env.RULESET_BOUNDARY_MARGIN_MINUTES ||
      String(DEFAULT_BOUNDARY_MARGIN_MINUTES),
    10,
  );
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_BOUNDARY_MARGIN_MINUTES;
}

function normalizeBatchLimit(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || !value || value <= 0) {
    return DEFAULT_BATCH_LIMIT;
  }
  return Math.min(value, MAX_BATCH_LIMIT);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toPositiveInteger(value: unknown): number | undefined {
  const numeric = toFiniteNumber(value);
  return numeric !== undefined && Number.isSafeInteger(numeric) && numeric > 0
    ? numeric
    : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
