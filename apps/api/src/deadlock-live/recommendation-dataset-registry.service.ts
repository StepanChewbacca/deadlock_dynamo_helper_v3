import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RecommendationDatasetManifestV1,
  assertRecommendationDatasetManifestV1,
} from '@deadlock-live-probe/shared';
import { RecommendationDatasetRegistryV1 } from './entities/recommendation-dataset-registry.entity';

export interface RegisterRecommendationDatasetV1Input {
  manifest: RecommendationDatasetManifestV1;
  objectBaseUri: string;
}

export interface RegisterRecommendationDatasetV1Result {
  status: 'REGISTERED' | 'DUPLICATE';
  datasetId: string;
  datasetSha256: string;
  manifestSha256: string;
}

@Injectable()
export class RecommendationDatasetRegistryService {
  constructor(
    @InjectRepository(RecommendationDatasetRegistryV1)
    private readonly datasetRepo: Repository<RecommendationDatasetRegistryV1>,
  ) {}

  async register(input: RegisterRecommendationDatasetV1Input): Promise<RegisterRecommendationDatasetV1Result> {
    assertRecommendationDatasetManifestV1(input.manifest);
    assertRemoteImmutableUri(input.objectBaseUri);
    const manifestSha256 = hashCanonicalJson(input.manifest);
    const existing = await this.datasetRepo.findOne({ where: { datasetId: input.manifest.datasetId } });
    if (existing) {
      if (
        existing.datasetSha256 !== input.manifest.datasetSha256
        || existing.manifestSha256 !== manifestSha256
        || existing.objectBaseUri !== input.objectBaseUri
      ) {
        throw new Error(`Immutable dataset registry conflict: ${input.manifest.datasetId}`);
      }
      return result('DUPLICATE', existing);
    }

    try {
      const saved = await this.datasetRepo.save(this.datasetRepo.create({
        datasetId: input.manifest.datasetId,
        datasetSha256: input.manifest.datasetSha256,
        manifestSha256,
        objectBaseUri: input.objectBaseUri,
        manifest: input.manifest,
      }));
      return result('REGISTERED', saved);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.datasetRepo.findOne({ where: { datasetId: input.manifest.datasetId } });
      if (
        !raced
        || raced.datasetSha256 !== input.manifest.datasetSha256
        || raced.manifestSha256 !== manifestSha256
        || raced.objectBaseUri !== input.objectBaseUri
      ) {
        throw new Error(`Immutable dataset registry conflict: ${input.manifest.datasetId}`);
      }
      return result('DUPLICATE', raced);
    }
  }

  async get(datasetId: string): Promise<RecommendationDatasetRegistryV1> {
    if (!datasetId) throw new Error('datasetId is required');
    const row = await this.datasetRepo.findOne({ where: { datasetId } });
    if (!row) throw new Error(`Dataset is not registered: ${datasetId}`);
    return row;
  }
}

function result(
  status: RegisterRecommendationDatasetV1Result['status'],
  row: RecommendationDatasetRegistryV1,
): RegisterRecommendationDatasetV1Result {
  return {
    status,
    datasetId: row.datasetId,
    datasetSha256: row.datasetSha256,
    manifestSha256: row.manifestSha256,
  };
}

function assertRemoteImmutableUri(value: string): void {
  if (!value) throw new Error('objectBaseUri is required');
  if (/^(s3|gs|az|https):\/\//i.test(value)) return;
  if (process.env.NODE_ENV !== 'production' && process.env.RECOMMENDATION_ALLOW_LOCAL_ARTIFACTS === 'true' && value.startsWith('file://')) return;
  throw new Error('objectBaseUri must reference an approved remote immutable artifact store');
}

function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
