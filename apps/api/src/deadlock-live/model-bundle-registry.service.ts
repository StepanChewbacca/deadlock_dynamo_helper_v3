import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ModelBundleManifestV1,
  ModelBundleRuntimeCompatibilityV1,
  validateModelBundleManifestV1,
  validateModelBundleRuntimeCompatibilityV1,
} from '@deadlock-live-probe/shared';
import { ModelBundleRegistryV1 } from './entities/model-bundle-registry.entity';

export interface RegisterModelBundleV1Input {
  manifest: ModelBundleManifestV1;
  artifactBaseUri: string;
}

export interface RegisterModelBundleV1Result {
  created: boolean;
  id: string;
  modelId: string;
  modelVersion: string;
  manifestSha256: string;
  status: string;
}

export interface ActivateModelBundleV1Input {
  modelId: string;
  modelVersion: string;
  runtime: ModelBundleRuntimeCompatibilityV1;
}

@Injectable()
export class ModelBundleRegistryService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ModelBundleRegistryV1)
    private readonly registryRepo: Repository<ModelBundleRegistryV1>,
  ) {}

  async register(input: RegisterModelBundleV1Input): Promise<RegisterModelBundleV1Result> {
    const validation = validateModelBundleManifestV1(input.manifest);
    if (!validation.valid) {
      throw new Error(`Invalid model bundle manifest: ${validation.errors.join(',')}`);
    }
    const artifactBaseUri = validateArtifactBaseUri(input.artifactBaseUri);
    const manifestSha256 = modelManifestSha256V1(input.manifest);
    const existing = await this.registryRepo.findOne({
      where: { modelId: input.manifest.modelId, modelVersion: input.manifest.modelVersion },
    });
    if (existing) {
      if (existing.manifestSha256 !== manifestSha256 || existing.artifactBaseUri !== artifactBaseUri) {
        throw new Error(
          `Immutable model identity conflict for ${input.manifest.modelId}@${input.manifest.modelVersion}`,
        );
      }
      return toRegisterResult(existing, false);
    }

    try {
      const created = await this.registryRepo.save(this.registryRepo.create({
        modelId: input.manifest.modelId,
        modelVersion: input.manifest.modelVersion,
        manifestSha256,
        manifest: canonicalizeManifest(input.manifest),
        artifactBaseUri,
        status: 'REGISTERED',
      }));
      return toRegisterResult(created, true);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.registryRepo.findOne({
        where: { modelId: input.manifest.modelId, modelVersion: input.manifest.modelVersion },
      });
      if (!raced || raced.manifestSha256 !== manifestSha256 || raced.artifactBaseUri !== artifactBaseUri) {
        throw new Error(
          `Immutable model identity conflict for ${input.manifest.modelId}@${input.manifest.modelVersion}`,
        );
      }
      return toRegisterResult(raced, false);
    }
  }

  async activate(input: ActivateModelBundleV1Input): Promise<ModelBundleRegistryV1> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ModelBundleRegistryV1);
      const target = await repo.findOne({
        where: { modelId: input.modelId, modelVersion: input.modelVersion },
      });
      if (!target) throw new Error(`Model bundle not found: ${input.modelId}@${input.modelVersion}`);
      const compatibility = validateModelBundleRuntimeCompatibilityV1(target.manifest, input.runtime);
      if (!compatibility.valid) {
        throw new Error(`Model bundle is not runtime-compatible: ${compatibility.errors.join(',')}`);
      }

      const active = await repo.find({ where: { modelId: input.modelId, status: 'ACTIVE' } });
      const now = new Date();
      for (const previous of active) {
        if (previous.id === target.id) continue;
        previous.status = 'RETIRED';
        previous.retiredAt = now;
        await repo.save(previous);
      }
      target.status = 'ACTIVE';
      target.activatedAt = target.activatedAt ?? now;
      target.retiredAt = undefined;
      return repo.save(target);
    });
  }

  async getActive(
    modelId: string,
    runtime: ModelBundleRuntimeCompatibilityV1,
  ): Promise<ModelBundleRegistryV1 | undefined> {
    const active = await this.registryRepo.findOne({ where: { modelId, status: 'ACTIVE' } });
    if (!active) return undefined;
    const compatibility = validateModelBundleRuntimeCompatibilityV1(active.manifest, runtime);
    return compatibility.valid ? active : undefined;
  }
}

export function modelManifestSha256V1(manifest: ModelBundleManifestV1): string {
  return createHash('sha256').update(JSON.stringify(canonicalizeManifest(manifest))).digest('hex');
}

function canonicalizeManifest(manifest: ModelBundleManifestV1): ModelBundleManifestV1 {
  return {
    ...manifest,
    supportedRulesetVersions: [...manifest.supportedRulesetVersions].sort(),
    supportedCatalogSha256: [...manifest.supportedCatalogSha256].sort(),
    files: [...manifest.files].map((file) => ({ ...file })).sort((a, b) => a.path.localeCompare(b.path)),
    gates: [...manifest.gates].map((gate) => ({ ...gate })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function validateArtifactBaseUri(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('artifactBaseUri is required');
  if (trimmed.includes('..')) throw new Error('artifactBaseUri must not contain parent traversal');
  if (!/^(s3|gs|https|file):\/\//.test(trimmed)) {
    throw new Error('artifactBaseUri must use s3://, gs://, https:// or file://');
  }
  return trimmed.replace(/\/+$/, '');
}

function toRegisterResult(entity: ModelBundleRegistryV1, created: boolean): RegisterModelBundleV1Result {
  return {
    created,
    id: entity.id,
    modelId: entity.modelId,
    modelVersion: entity.modelVersion,
    manifestSha256: entity.manifestSha256,
    status: entity.status,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
