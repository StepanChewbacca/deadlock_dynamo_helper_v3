import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  RecommendationEconomyRulesV1,
  slotRulesFromEconomyRulesV1,
} from './adaptive-economy-v1';
import { BuildArchetypeMinerV1Service } from './build-archetype-miner-v1.service';
import { BuildStrategyCompilerV1Service } from './build-strategy-compiler-v1.service';
import { BuildStrategyFeasibilityV1Service } from './build-strategy-feasibility-v1.service';
import { BuildStrategySnapshotStoreV1Service } from './build-strategy-snapshot-store-v1.service';
import { HistoricalBuildTrajectorySourceV2Service } from './historical-build-trajectory-source-v2.service';

export interface BuildStrategyMiningPipelineV1Input {
  heroId: number;
  patchId: string;
  rulesetId: string;
  catalogSha256: string;
  itemGraph: RecommendationItemGraph;
  economyRules: RecommendationEconomyRulesV1;
  limit?: number;
  minClusterSize?: number;
  distanceThreshold?: number;
  publishedAt?: Date;
}

export interface BuildStrategyMiningPipelineV1Result {
  published: boolean;
  snapshotId?: string;
  sourceTraceCount: number;
  rejectedTraceCount: number;
  noiseTraceCount: number;
  archetypeCount: number;
  strategyCount: number;
  reasonCodes: readonly string[];
}

@Injectable()
export class BuildStrategyMiningPipelineV1Service {
  constructor(
    private readonly source: HistoricalBuildTrajectorySourceV2Service,
    private readonly miner: BuildArchetypeMinerV1Service,
    private readonly compiler: BuildStrategyCompilerV1Service,
    private readonly feasibility: BuildStrategyFeasibilityV1Service,
    private readonly store: BuildStrategySnapshotStoreV1Service,
  ) {}

  async run(input: BuildStrategyMiningPipelineV1Input): Promise<BuildStrategyMiningPipelineV1Result> {
    validateInput(input);
    const historical = await this.source.load({
      heroId: input.heroId,
      patchId: input.patchId,
      rulesetId: input.rulesetId,
      catalogSha256: input.catalogSha256,
      itemGraph: input.itemGraph,
      economyRules: input.economyRules,
      limit: input.limit,
    });
    if (historical.trajectories.length === 0) {
      return result(false, historical, 0, 0, ['NO_ACCEPTED_HISTORICAL_TRAJECTORIES']);
    }

    const mining = this.miner.mine(historical.trajectories, input.itemGraph, {
      minClusterSize: input.minClusterSize,
      distanceThreshold: input.distanceThreshold,
    });
    if (mining.archetypes.length === 0) {
      return result(false, historical, mining.noiseTraceIds.length, 0, ['NO_STABLE_BUILD_ARCHETYPES']);
    }

    const specs = mining.archetypes.map((archetype) => this.compiler.compile({
      archetype,
      trajectories: historical.trajectories,
      itemGraph: input.itemGraph,
    }));
    const feasibilityFailures = specs
      .map((strategy) => ({
        strategy,
        validation: this.feasibility.validate({
          strategy,
          itemGraph: input.itemGraph,
          slotRules: slotRulesFromEconomyRulesV1(input.economyRules),
        }),
      }))
      .filter((entry) => !entry.validation.feasible);
    if (feasibilityFailures.length > 0) {
      return {
        ...result(false, historical, mining.noiseTraceIds.length, specs.length, [
          'COMPILED_STRATEGY_UNREACHABLE',
          ...feasibilityFailures.flatMap((entry) => [
            `STRATEGY:${entry.strategy.strategyId}`,
            ...(entry.validation.failedGoalId ? [`GOAL:${entry.validation.failedGoalId}`] : []),
          ]),
        ]),
        archetypeCount: mining.archetypes.length,
      };
    }

    const sourceSha256 = trajectorySourceHash(historical.trajectories.map((trace) => trace.traceSha256));
    const snapshotId = `strategy:${input.heroId}:${input.patchId}:${sourceSha256.slice(0, 20)}`;
    await this.store.publish({
      snapshotId,
      rulesetId: input.rulesetId,
      patchId: input.patchId,
      catalogSha256: input.catalogSha256,
      sourceSha256,
      specs,
      itemGraph: input.itemGraph,
      publishedAt: input.publishedAt,
    });

    return {
      published: true,
      snapshotId,
      sourceTraceCount: historical.trajectories.length,
      rejectedTraceCount: historical.rejected.length,
      noiseTraceCount: mining.noiseTraceIds.length,
      archetypeCount: mining.archetypes.length,
      strategyCount: specs.length,
      reasonCodes: ['STRATEGY_SNAPSHOT_PUBLISHED'],
    };
  }
}

function result(
  published: boolean,
  historical: Awaited<ReturnType<HistoricalBuildTrajectorySourceV2Service['load']>>,
  noiseTraceCount: number,
  strategyCount: number,
  reasonCodes: readonly string[],
): BuildStrategyMiningPipelineV1Result {
  return {
    published,
    sourceTraceCount: historical.trajectories.length,
    rejectedTraceCount: historical.rejected.length,
    noiseTraceCount,
    archetypeCount: strategyCount,
    strategyCount,
    reasonCodes: [...new Set(reasonCodes)].sort(),
  };
}

function trajectorySourceHash(traceHashes: readonly string[]): string {
  return createHash('sha256').update([...traceHashes].sort().join('\n')).digest('hex');
}

function validateInput(input: BuildStrategyMiningPipelineV1Input): void {
  if (!Number.isInteger(input.heroId) || input.heroId <= 0 || !input.patchId || !input.rulesetId) {
    throw new Error('Build strategy mining scope is invalid');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.catalogSha256)) {
    throw new Error('Build strategy mining catalog SHA256 is invalid');
  }
  if (input.economyRules.rulesetId !== input.rulesetId ||
    input.economyRules.catalogSha256.toLowerCase() !== input.catalogSha256.toLowerCase()) {
    throw new Error('Build strategy mining economy scope mismatch');
  }
}
