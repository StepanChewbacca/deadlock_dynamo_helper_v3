import { Injectable } from '@nestjs/common';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { BuildStrategySpecV1 } from './build-strategy-v1';
import { BuildStrategyValidatorV1Service } from './build-strategy-validator-v1.service';

export interface ReplaceBuildStrategySnapshotV1Input {
  rulesetId: string;
  patchId: string;
  catalogSha256: string;
  sourceSha256: string;
  specs: readonly BuildStrategySpecV1[];
  itemGraph: RecommendationItemGraph;
}

export interface BuildStrategySnapshotMetadataV1 {
  rulesetId: string;
  patchId: string;
  catalogSha256: string;
  sourceSha256: string;
  strategyCount: number;
}

interface StoredStrategySnapshotV1 extends BuildStrategySnapshotMetadataV1 {
  specs: readonly BuildStrategySpecV1[];
}

@Injectable()
export class BuildStrategyRegistryV1Service {
  private readonly validator = new BuildStrategyValidatorV1Service();
  private snapshots = new Map<string, StoredStrategySnapshotV1>();

  replaceSnapshot(input: ReplaceBuildStrategySnapshotV1Input): void {
    if (!/^[a-f0-9]{64}$/i.test(input.catalogSha256) || !/^[a-f0-9]{64}$/i.test(input.sourceSha256)) {
      throw new Error('Build strategy snapshot SHA256 values are invalid');
    }
    const ids = new Set<string>();
    const failures: string[] = [];
    for (const spec of input.specs) {
      if (ids.has(spec.strategyId)) failures.push(`${spec.strategyId}:DUPLICATE_STRATEGY_ID`);
      ids.add(spec.strategyId);
      if (spec.rulesetId !== input.rulesetId || spec.sourcePatchId !== input.patchId) {
        failures.push(`${spec.strategyId}:SNAPSHOT_SCOPE_MISMATCH`);
      }
      const validation = this.validator.validate(spec, input.itemGraph);
      for (const error of validation.errors) failures.push(`${spec.strategyId}:${error.code}`);
    }
    if (failures.length > 0) {
      throw new Error(`Invalid strategy snapshot: ${[...new Set(failures)].sort().join(',')}`);
    }

    const key = snapshotKey(input.rulesetId, input.catalogSha256);
    const specs = clone(input.specs).sort((a, b) => a.heroId - b.heroId || a.strategyId.localeCompare(b.strategyId));
    this.snapshots.set(key, {
      rulesetId: input.rulesetId,
      patchId: input.patchId,
      catalogSha256: input.catalogSha256.toLowerCase(),
      sourceSha256: input.sourceSha256.toLowerCase(),
      strategyCount: specs.length,
      specs,
    });
  }

  getStrategies(heroId: number, rulesetId: string, catalogSha256: string): readonly BuildStrategySpecV1[] {
    const snapshot = this.snapshots.get(snapshotKey(rulesetId, catalogSha256));
    if (!snapshot) return [];
    return clone(snapshot.specs.filter((spec) => spec.heroId === heroId));
  }

  getSnapshotMetadata(rulesetId: string, catalogSha256: string): BuildStrategySnapshotMetadataV1 | undefined {
    const snapshot = this.snapshots.get(snapshotKey(rulesetId, catalogSha256));
    if (!snapshot) return undefined;
    const { specs: _specs, ...metadata } = snapshot;
    return { ...metadata };
  }

  clear(): void {
    this.snapshots = new Map();
  }
}

function snapshotKey(rulesetId: string, catalogSha256: string): string {
  return `${rulesetId}:${catalogSha256.toLowerCase()}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
