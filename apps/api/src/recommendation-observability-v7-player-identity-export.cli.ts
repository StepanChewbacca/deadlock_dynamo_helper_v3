import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database/data-source';
import { MatchPlayer } from './deadlock-live/entities/match-player.entity';
import { RecommendationObservabilityV7PlayerIdentityExportService } from './deadlock-live/recommendation-observability-v7-player-identity-export.service';

const DEFAULT_OBSERVABILITY_ROOT =
  '/app/apps/api/storage/recommendation-observability-v7';

async function main(): Promise<void> {
  const dataSource = new DataSource(databaseOptions);
  await dataSource.initialize();

  try {
    const service = new RecommendationObservabilityV7PlayerIdentityExportService(
      dataSource.getRepository(MatchPlayer),
    );
    await service.refresh();

    const outputDirectory =
      process.env.DEADLOCK_RECOMMENDATION_OBSERVABILITY_V7_DIR?.trim() ||
      DEFAULT_OBSERVABILITY_ROOT;
    const manifestPath = join(
      outputDirectory,
      'player-identities.manifest.json',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      rowCount?: number;
      identityVersion?: string;
      historicalIdentityInferencePerformed?: boolean;
      heroIdentityInferencePerformed?: boolean;
      teamIdentityInferencePerformed?: boolean;
      playerPawnIdentityInferencePerformed?: boolean;
    };

    const report = {
      schemaVersion: 1,
      operation: 'RECOMMENDATION_OBSERVABILITY_V7_PLAYER_IDENTITY_EXPORT_CLI',
      rowCount: Number(manifest.rowCount ?? 0),
      identityVersion: manifest.identityVersion,
      historicalIdentityInferencePerformed:
        manifest.historicalIdentityInferencePerformed === true,
      heroIdentityInferencePerformed:
        manifest.heroIdentityInferencePerformed === true,
      teamIdentityInferencePerformed:
        manifest.teamIdentityInferencePerformed === true,
      playerPawnIdentityInferencePerformed:
        manifest.playerPawnIdentityInferencePerformed === true,
      outputDirectory,
      nextStep:
        Number(manifest.rowCount ?? 0) > 0
          ? 'REAUDIT_STAGE_J_AND_REEXPORT_DATASET_V7'
          : 'RECOVER_DIRECT_MATCH_PLAYER_ACCOUNT_IDENTITY_FIRST',
    };
    console.log(JSON.stringify(report, null, 2));
    if (
      report.historicalIdentityInferencePerformed ||
      report.heroIdentityInferencePerformed ||
      report.teamIdentityInferencePerformed ||
      report.playerPawnIdentityInferencePerformed
    ) {
      process.exitCode = 1;
    }
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
