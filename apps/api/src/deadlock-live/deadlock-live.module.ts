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
import { RecommendationTelemetryController } from './recommendation-telemetry.controller';
import { RecommendationTelemetryStoreService } from './recommendation-telemetry-store.service';
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
import { RecommendationDecisionCandidateV8 } from './entities/recommendation-decision-candidate.entity';
import { RecommendationDecisionV8 } from './entities/recommendation-decision.entity';
import { RecommendationExposureAckV8 } from './entities/recommendation-exposure-ack.entity';
import { RecommendationTelemetryEvent } from './entities/recommendation-telemetry-event.entity';
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
      RecommendationDecisionV8,
      RecommendationDecisionCandidateV8,
      RecommendationExposureAckV8,
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
    RecommendationTelemetryStoreService,
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
    RecommendationTelemetryStoreService,
    ReferenceDataImportService,
    IngestStatusService,
  ],
})
export class DeadlockLiveModule {}
