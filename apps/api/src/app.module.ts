import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeadlockLiveModule } from './deadlock-live/deadlock-live.module';
import { CrawlerRun } from './deadlock-live/entities/crawler-run.entity';
import { CrawlerState } from './deadlock-live/entities/crawler-state.entity';
import { Hero } from './deadlock-live/entities/hero.entity';
import { ItemCatalogItem } from './deadlock-live/entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './deadlock-live/entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './deadlock-live/entities/item-catalog-version.entity';
import { ItemComponent } from './deadlock-live/entities/item-component.entity';
import { Item } from './deadlock-live/entities/item.entity';
import { Match } from './deadlock-live/entities/match.entity';
import { MatchPlayerItem } from './deadlock-live/entities/match-player-item.entity';
import { MatchPlayer } from './deadlock-live/entities/match-player.entity';
import { MatchPlayerSkillUpgrade } from './deadlock-live/entities/match-player-skill-upgrade.entity';
import { ModelBundleRegistryV1 } from './deadlock-live/entities/model-bundle-registry.entity';
import { RecommendationDatasetRegistryV1 } from './deadlock-live/entities/recommendation-dataset-registry.entity';
import { RecommendationDecisionCandidateV8 } from './deadlock-live/entities/recommendation-decision-candidate.entity';
import { RecommendationDecisionV8 } from './deadlock-live/entities/recommendation-decision.entity';
import { RecommendationEvidenceSnapshotV8 } from './deadlock-live/entities/recommendation-evidence-snapshot-v8.entity';
import { RecommendationExposureAckV8 } from './deadlock-live/entities/recommendation-exposure-ack.entity';
import { RecommendationRoadmapEvidenceEntityV1 } from './deadlock-live/entities/recommendation-roadmap-evidence.entity';
import { RecommendationTelemetryEvent } from './deadlock-live/entities/recommendation-telemetry-event.entity';
import { RecommendationTelemetryRejectionV8 } from './deadlock-live/entities/recommendation-telemetry-rejection.entity';
import { RecommendationValueDatasetRegistryV1 } from './deadlock-live/entities/recommendation-value-dataset-registry.entity';
import { ShadowModeDecision } from './deadlock-live/entities/shadow-mode-decision.entity';
import { SoulsAffordabilityEvidenceV2Entity } from './deadlock-live/entities/souls-affordability-evidence-v2.entity';
import { StatlockerEvidenceSnapshotV1Entity } from './deadlock-live/entities/statlocker-evidence-snapshot-v1.entity';
import { StatlockerProbeModule } from './statlocker-probe/statlocker-probe.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'deadlock_builds',
      entities: [
        Match,
        MatchPlayer,
        MatchPlayerItem,
        MatchPlayerSkillUpgrade,
        Hero,
        Item,
        ItemComponent,
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
        StatlockerEvidenceSnapshotV1Entity,
        ModelBundleRegistryV1,
        RecommendationDatasetRegistryV1,
        RecommendationValueDatasetRegistryV1,
        RecommendationRoadmapEvidenceEntityV1,
        CrawlerRun,
        CrawlerState,
        ShadowModeDecision,
      ],
      synchronize: true,
    }),
    DeadlockLiveModule,
    StatlockerProbeModule,
  ],
})
export class AppModule {}
