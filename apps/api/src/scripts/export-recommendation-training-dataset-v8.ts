import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { RecommendationDatasetV8ReportService } from '../deadlock-live/recommendation-dataset-v8-report.service';
import { RecommendationEvidenceMaterializerV8Service } from '../deadlock-live/recommendation-evidence-materializer-v8.service';
import { RecommendationFeatureStoreV8Service } from '../deadlock-live/recommendation-feature-store-v8.service';
import { RecommendationObservabilityReportService } from '../deadlock-live/recommendation-observability-report.service';
import { RecommendationRoadmapEvidenceService } from '../deadlock-live/recommendation-roadmap-evidence.service';
import {
  RecommendationTrainingDatasetExportV1Options,
  RecommendationTrainingDatasetV8Service,
} from '../deadlock-live/recommendation-training-dataset-v8.service';
import { SoulsAffordabilityEvidenceV2Service } from '../deadlock-live/souls-affordability-evidence-v2.service';
import { RecommendationEvidenceSnapshotV8 } from '../deadlock-live/entities/recommendation-evidence-snapshot-v8.entity';
import { RecommendationRoadmapEvidenceEntityV1 } from '../deadlock-live/entities/recommendation-roadmap-evidence.entity';
import { SoulsAffordabilityEvidenceV2Entity } from '../deadlock-live/entities/souls-affordability-evidence-v2.entity';

async function main(): Promise<void> {
  const [command, configPath] = process.argv.slice(2);
  if ((command !== 'preflight' && command !== 'export') || !configPath) {
    throw new Error('Usage: export-recommendation-training-dataset-v8 <preflight|export> <config.json>');
  }
  const options = loadOptions(configPath);
  const dataSource = createDataSource();
  await dataSource.initialize();
  try {
    const featureStore = new RecommendationFeatureStoreV8Service(dataSource);
    const datasetReport = new RecommendationDatasetV8ReportService(dataSource);
    const observability = new RecommendationObservabilityReportService(dataSource);
    const souls = new SoulsAffordabilityEvidenceV2Service(
      dataSource.getRepository(SoulsAffordabilityEvidenceV2Entity),
    );
    const roadmap = new RecommendationRoadmapEvidenceService(
      dataSource.getRepository(RecommendationRoadmapEvidenceEntityV1),
    );
    const evidenceMaterializer = new RecommendationEvidenceMaterializerV8Service(
      dataSource.getRepository(RecommendationEvidenceSnapshotV8),
      souls,
      observability,
      datasetReport,
      roadmap,
    );
    const service = new RecommendationTrainingDatasetV8Service(
      dataSource,
      featureStore,
      datasetReport,
      observability,
      souls,
      roadmap,
      evidenceMaterializer,
    );
    const result = command === 'preflight'
      ? await service.preflight(options)
      : await service.export(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (command === 'preflight' && 'ready' in result && !result.ready) process.exitCode = 2;
  } finally {
    await dataSource.destroy();
  }
}

function loadOptions(path: string): RecommendationTrainingDatasetExportV1Options {
  const absolute = resolve(path);
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as RecommendationTrainingDatasetExportV1Options;
  if (!parsed || typeof parsed !== 'object') throw new Error('Dataset export config must be a JSON object');
  return parsed;
}

function createDataSource(): DataSource {
  const sslEnabled = process.env.DB_SSL === 'true';
  return new DataSource({
    type: 'postgres',
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    username: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
    ssl: sslEnabled
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false,
    synchronize: false,
    logging: false,
    entities: [
      SoulsAffordabilityEvidenceV2Entity,
      RecommendationRoadmapEvidenceEntityV1,
      RecommendationEvidenceSnapshotV8,
    ],
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
