import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ItemCatalogItem } from '../deadlock-live/entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from '../deadlock-live/entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from '../deadlock-live/entities/item-catalog-version.entity';
import { ModelBundleRegistryV1 } from '../deadlock-live/entities/model-bundle-registry.entity';
import { RecommendationDatasetRegistryV1 } from '../deadlock-live/entities/recommendation-dataset-registry.entity';
import { RecommendationDecisionCandidateV8 } from '../deadlock-live/entities/recommendation-decision-candidate.entity';
import { RecommendationDecisionV8 } from '../deadlock-live/entities/recommendation-decision.entity';
import { RecommendationEvidenceSnapshotV8 } from '../deadlock-live/entities/recommendation-evidence-snapshot-v8.entity';
import { RecommendationExposureAckV8 } from '../deadlock-live/entities/recommendation-exposure-ack.entity';
import { RecommendationRoadmapEvidenceEntityV1 } from '../deadlock-live/entities/recommendation-roadmap-evidence.entity';
import { RecommendationTelemetryEvent } from '../deadlock-live/entities/recommendation-telemetry-event.entity';
import { RecommendationTelemetryRejectionV8 } from '../deadlock-live/entities/recommendation-telemetry-rejection.entity';
import { RecommendationValueDatasetRegistryV1 } from '../deadlock-live/entities/recommendation-value-dataset-registry.entity';
import { SoulsAffordabilityEvidenceV2Entity } from '../deadlock-live/entities/souls-affordability-evidence-v2.entity';

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'deadlock_builds',
    entities: [
      ItemCatalogVersion,
      ItemCatalogItem,
      ItemCatalogRecipe,
      RecommendationTelemetryEvent,
      RecommendationTelemetryRejectionV8,
      RecommendationDecisionV8,
      RecommendationDecisionCandidateV8,
      RecommendationEvidenceSnapshotV8,
      RecommendationExposureAckV8,
      SoulsAffordabilityEvidenceV2Entity,
      ModelBundleRegistryV1,
      RecommendationDatasetRegistryV1,
      RecommendationValueDatasetRegistryV1,
      RecommendationRoadmapEvidenceEntityV1,
    ],
    synchronize: false,
  });

  await dataSource.initialize();
  try {
    await dataSource.synchronize(false);
    const tables = await dataSource.query(
      `SELECT table_name AS "tableName"
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND (
           table_name LIKE 'recommendation_%'
           OR table_name = 'model_bundle_registry_v1'
           OR table_name = 'souls_affordability_evidence_v2'
         )
       ORDER BY table_name`,
    ) as Array<{ tableName: string }>;
    console.log(JSON.stringify({ ok: true, tables: tables.map((row) => row.tableName) }, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
