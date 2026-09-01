import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { RecommendationFeatureStoreV8Service } from '../deadlock-live/recommendation-feature-store-v8.service';
import { RecommendationOpeReportService } from '../deadlock-live/recommendation-ope-report.service';
import { RecommendationRoadmapEvidenceService } from '../deadlock-live/recommendation-roadmap-evidence.service';
import {
  RecommendationValueTrainingDatasetExportV1Options,
  RecommendationValueTrainingDatasetV8Service,
} from '../deadlock-live/recommendation-value-training-dataset-v8.service';
import { RecommendationValueTrainingLaunchV8Service } from '../deadlock-live/recommendation-value-training-launch-v8.service';
import { RecommendationRoadmapEvidenceEntityV1 } from '../deadlock-live/entities/recommendation-roadmap-evidence.entity';

async function main(): Promise<void> {
  const [command, configPath] = process.argv.slice(2);
  if ((command !== 'preflight' && command !== 'export') || !configPath) {
    throw new Error('Usage: export-recommendation-value-training-dataset-v8 <preflight|export> <config.json>');
  }
  const options = loadOptions(configPath);
  const dataSource = createDataSource();
  await dataSource.initialize();
  try {
    const featureStore = new RecommendationFeatureStoreV8Service(dataSource);
    const roadmap = new RecommendationRoadmapEvidenceService(
      dataSource.getRepository(RecommendationRoadmapEvidenceEntityV1),
    );
    const ope = new RecommendationOpeReportService(dataSource);
    const launch = new RecommendationValueTrainingLaunchV8Service(roadmap, ope);
    const service = new RecommendationValueTrainingDatasetV8Service(dataSource, featureStore, launch);
    const result = command === 'preflight'
      ? await service.preflight(options)
      : await service.export(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (command === 'preflight' && 'ready' in result && !result.ready) process.exitCode = 2;
  } finally {
    await dataSource.destroy();
  }
}

function loadOptions(path: string): RecommendationValueTrainingDatasetExportV1Options {
  const absolute = resolve(path);
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as RecommendationValueTrainingDatasetExportV1Options;
  if (!parsed || typeof parsed !== 'object') throw new Error('Value dataset export config must be a JSON object');
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
    entities: [RecommendationRoadmapEvidenceEntityV1],
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
