import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiveMatchStateService } from './live-match-state.service';
import { InventoryShadowReplayService } from './inventory-shadow-replay.service';
import { RawEventLogService } from './raw-event-log.service';
import { RecentLiveEventsService } from './recent-live-events.service';
import { LiveIngestController } from './live-ingest.controller';
import { DebugPageController } from './debug-page.controller';
import { HeroAnalysisService } from './hero-analysis.service';
import { HeroAnalysisController } from './hero-analysis.controller';
import { IngestStatusController } from './ingest-status.controller';
import { IngestStatusService } from './ingest-status.service';
import { AllHeroesAnalysisService } from './all-heroes-analysis.service';
import { AllHeroesAnalysisController } from './all-heroes-analysis.controller';
import { SituationalRecommendationService } from './situational-recommendation.service';
import { CatalogContentService } from './catalog-content.service';
import { ModelBundleRegistryService } from './model-bundle-registry.service';
import { RecommendationEngineV8Service } from './recommendation-engine-v8.service';
import { RecommendationDecisionV8Service } from './recommendation-decision-v8.service';
import { RecommendationRealtimeStateV8Service } from './recommendation-realtime-state-v8.service';
import { RecommendationRealtimeCoordinatorV8Service } from './recommendation-realtime-coordinator-v8.service';
import { RecommendationRuntimeHealthV8Service } from './recommendation-runtime-health-v8.service';
import { RecommendationReadinessV8Controller } from './recommendation-readiness-v8.controller';
import { RecommendationReadinessV8Service } from './recommendation-readiness-v8.service';
import { RecommendationObservabilityController } from './recommendation-observability.controller';
import { RecommendationObservabilityReportService } from './recommendation-observability-report.service';
import { RecommendationTelemetryController } from './recommendation-telemetry.controller';
import { RecommendationTelemetryStoreService } from './recommendation-telemetry-store.service';
import { RecommendationTelemetryIngestV8Service } from './recommendation-telemetry-ingest-v8.service';
import { RecommendationFeatureStoreV8Controller } from './recommendation-feature-store-v8.controller';
import { RecommendationFeatureStoreV8Service } from './recommendation-feature-store-v8.service';
import { RecommendationDatasetV8Controller } from './recommendation-dataset-v8.controller';
import { RecommendationDatasetV8ReportService } from './recommendation-dataset-v8-report.service';
import { RecommendationDatasetRegistryController } from './recommendation-dataset-registry.controller';
import { RecommendationDatasetRegistryService } from './recommendation-dataset-registry.service';
import { RecommendationShadowController } from './recommendation-shadow.controller';
import { RecommendationShadowReportService } from './recommendation-shadow-report.service';
import { RecommendationOpeController } from './recommendation-ope.controller';
import { RecommendationOpeReportService } from './recommendation-ope-report.service';
import { RecommendationAbController } from './recommendation-ab.controller';
import { RecommendationAbReportService } from './recommendation-ab-report.service';
import { SoulsAffordabilityEvidenceV2Controller } from './souls-affordability-evidence-v2.controller';
import { SoulsAffordabilityEvidenceV2Service } from './souls-affordability-evidence-v2.service';
import { CrawlerRun } from './entities/crawler-run.entity';
import { CrawlerState } from './entities/crawler-state.entity';
import { Hero } from './entities/hero.entity';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import { ItemComponent } from './entities/item-component.entity';
import { Item } from './entities/item.entity';
import { Match } from './entities/match.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { ModelBundleRegistryV1 } from './entities/model-bundle-registry.entity';
import { RecommendationDatasetRegistryV1 } from './entities/recommendation-dataset-registry.entity';
import { RecommendationDecisionCandidateV8 } from './entities/recommendation-decision-candidate.entity';
import { RecommendationDecisionV8 } from './entities/recommendation-decision.entity';
import { RecommendationExposureAckV8 } from './entities/recommendation-exposure-ack.entity';
import { RecommendationTelemetryEvent } from './entities/recommendation-telemetry-event.entity';
import { RecommendationTelemetryRejectionV8 } from './entities/recommendation-telemetry-rejection.entity';
import { SoulsAffordabilityEvidenceV2Entity } from './entities/souls-affordability-evidence-v2.entity';
import { ReferenceDataImportService } from './reference-data-import.service';
import { ShadowModeDecision } from './entities/shadow-mode-decision.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
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
      RecommendationExposureAckV8,
      SoulsAffordabilityEvidenceV2Entity,
      ModelBundleRegistryV1,
      RecommendationDatasetRegistryV1,
      CrawlerRun,
      CrawlerState,
      ShadowModeDecision,
    ]),
  ],
  controllers: [
    LiveIngestController,
    DebugPageController,
    HeroAnalysisController,
    AllHeroesAnalysisController,
    IngestStatusController,
    RecommendationTelemetryController,
    RecommendationObservabilityController,
    RecommendationReadinessV8Controller,
    RecommendationFeatureStoreV8Controller,
    RecommendationDatasetV8Controller,
    RecommendationDatasetRegistryController,
    RecommendationShadowController,
    RecommendationOpeController,
    RecommendationAbController,
    SoulsAffordabilityEvidenceV2Controller,
  ],
  providers: [
    LiveMatchStateService,
    InventoryShadowReplayService,
    RawEventLogService,
    RecentLiveEventsService,
    HeroAnalysisService,
    AllHeroesAnalysisService,
    SituationalRecommendationService,
    CatalogContentService,
    ModelBundleRegistryService,
    RecommendationEngineV8Service,
    RecommendationDecisionV8Service,
    RecommendationRealtimeStateV8Service,
    RecommendationRealtimeCoordinatorV8Service,
    RecommendationRuntimeHealthV8Service,
    RecommendationReadinessV8Service,
    RecommendationTelemetryStoreService,
    RecommendationTelemetryIngestV8Service,
    RecommendationObservabilityReportService,
    RecommendationFeatureStoreV8Service,
    RecommendationDatasetV8ReportService,
    RecommendationDatasetRegistryService,
    RecommendationShadowReportService,
    RecommendationOpeReportService,
    RecommendationAbReportService,
    SoulsAffordabilityEvidenceV2Service,
    ReferenceDataImportService,
    IngestStatusService,
  ],
  exports: [
    LiveMatchStateService,
    InventoryShadowReplayService,
    RawEventLogService,
    RecentLiveEventsService,
    HeroAnalysisService,
    AllHeroesAnalysisService,
    SituationalRecommendationService,
    CatalogContentService,
    ModelBundleRegistryService,
    RecommendationEngineV8Service,
    RecommendationDecisionV8Service,
    RecommendationRealtimeStateV8Service,
    RecommendationRealtimeCoordinatorV8Service,
    RecommendationRuntimeHealthV8Service,
    RecommendationReadinessV8Service,
    RecommendationTelemetryStoreService,
    RecommendationTelemetryIngestV8Service,
    RecommendationObservabilityReportService,
    RecommendationFeatureStoreV8Service,
    RecommendationDatasetV8ReportService,
    RecommendationDatasetRegistryService,
    RecommendationShadowReportService,
    RecommendationOpeReportService,
    RecommendationAbReportService,
    SoulsAffordabilityEvidenceV2Service,
    ReferenceDataImportService,
    IngestStatusService,
  ],
})
export class DeadlockLiveModule {}
