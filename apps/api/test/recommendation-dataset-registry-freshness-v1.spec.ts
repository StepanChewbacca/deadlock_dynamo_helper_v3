import { createHash } from 'crypto';
import {
  RECOMMENDATION_DATASET_MANIFEST_VERSION,
  RECOMMENDATION_FEATURE_CONTRACT_VERSION,
  RecommendationDatasetManifestV1,
} from '@deadlock-live-probe/shared';
import { RecommendationDatasetRegistryService } from '../src/deadlock-live/recommendation-dataset-registry.service';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function manifest(): RecommendationDatasetManifestV1 {
  const files = [
    { path: 'splits/train.jsonl.gz', sha256: '1'.repeat(64), sizeBytes: 100, rowCount: 100 },
    { path: 'splits/validation.jsonl.gz', sha256: '2'.repeat(64), sizeBytes: 50, rowCount: 50 },
    { path: 'splits/shadow_holdout.jsonl.gz', sha256: '3'.repeat(64), sizeBytes: 50, rowCount: 50 },
  ];
  const base = {
    contractVersion: RECOMMENDATION_DATASET_MANIFEST_VERSION,
    datasetId: 'dataset-v8-1',
    createdAt: '2026-08-22T00:00:00.000Z',
    sourceCommitSha: 'a'.repeat(40),
    datasetContractVersion: 'recommendation-dataset-v8',
    featureContractVersion: RECOMMENDATION_FEATURE_CONTRACT_VERSION,
    actionContractVersion: 'recommendation-actions-v1',
    candidateGeneratorVersion: 'candidate-v1',
    pointInTimeCorrect: true,
    observedActionInjected: false,
    futureTestTouched: false,
    supportedRulesetVersions: ['ruleset-1'],
    supportedCatalogSha256: ['b'.repeat(64)],
    splits: [
      {
        split: 'TRAIN' as const,
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-10T00:00:00.000Z',
        matchCount: 10,
        decisionCount: 100,
        matchSetSha256: '4'.repeat(64),
        sealed: false,
      },
      {
        split: 'VALIDATION' as const,
        from: '2026-07-10T00:00:00.000Z',
        to: '2026-07-15T00:00:00.000Z',
        matchCount: 5,
        decisionCount: 50,
        matchSetSha256: '5'.repeat(64),
        sealed: false,
      },
      {
        split: 'SHADOW_HOLDOUT' as const,
        from: '2026-07-15T00:00:00.000Z',
        to: '2026-07-20T00:00:00.000Z',
        matchCount: 5,
        decisionCount: 50,
        matchSetSha256: '6'.repeat(64),
        sealed: false,
      },
      {
        split: 'FUTURE_TEST' as const,
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
        matchCount: 0,
        decisionCount: 0,
        matchSetSha256: '7'.repeat(64),
        sealed: true,
      },
    ],
    files,
  };
  return { ...base, datasetSha256: sha256(base) };
}

function verifiedRow() {
  const value = manifest();
  return {
    id: 'registry-row-1',
    datasetId: value.datasetId,
    datasetSha256: value.datasetSha256,
    manifestSha256: sha256(value),
    objectBaseUri: 's3://immutable/dataset-v8-1',
    manifest: value,
    status: 'VERIFIED' as const,
    verification: {
      verifier: 'independent-verifier',
      verifiedManifestSha256: sha256(value),
      verifiedFiles: value.files.map((file) => ({ ...file })),
      attestationRef: 's3://immutable/attestations/dataset-v8-1.json',
    },
    registeredAt: new Date('2026-08-22T00:00:00.000Z'),
    verifiedAt: new Date('2026-08-22T00:10:00.000Z'),
  };
}

describe('RecommendationDatasetRegistryService verified dataset freshness', () => {
  it('returns a verified dataset only when manifest, content hash, files, and timestamp are still exact', async () => {
    const row = verifiedRow();
    const repo = { findOne: jest.fn(async () => row) };
    const service = new RecommendationDatasetRegistryService(repo as never);

    const result = await service.getVerified(row.datasetId);

    expect(result).toBe(row);
  });

  it('rejects a registry row whose manifest bytes were changed after verification', async () => {
    const row = verifiedRow();
    row.manifest = {
      ...row.manifest,
      files: row.manifest.files.map((file, index) => index === 0 ? { ...file, sizeBytes: file.sizeBytes + 1 } : file),
    };
    const repo = { findOne: jest.fn(async () => row) };
    const service = new RecommendationDatasetRegistryService(repo as never);

    await expect(service.getVerified(row.datasetId)).rejects.toThrow('Dataset registry dataset content SHA is stale');
  });

  it('rejects stale verification files even when the registered manifest is unchanged', async () => {
    const row = verifiedRow();
    row.verification = {
      ...row.verification,
      verifiedFiles: row.verification.verifiedFiles.slice(1),
    };
    const repo = { findOne: jest.fn(async () => row) };
    const service = new RecommendationDatasetRegistryService(repo as never);

    await expect(service.getVerified(row.datasetId)).rejects.toThrow('Dataset registry verification files are missing or stale');
  });

  it('rejects a verified status without a valid verification timestamp', async () => {
    const row = verifiedRow();
    row.verifiedAt = undefined as never;
    const repo = { findOne: jest.fn(async () => row) };
    const service = new RecommendationDatasetRegistryService(repo as never);

    await expect(service.getVerified(row.datasetId)).rejects.toThrow('Dataset registry verification timestamp is missing or invalid');
  });
});
