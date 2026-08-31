import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as puppeteer from 'puppeteer-core';
import { DeadlockLiveModule } from '../deadlock-live/deadlock-live.module';
import { AdaptiveRecommendationDecisionV1Entity } from '../deadlock-live/entities/adaptive-recommendation-decision-v1.entity';
import { ItemCatalogItem } from '../deadlock-live/entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from '../deadlock-live/entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from '../deadlock-live/entities/item-catalog-version.entity';
import { StatlockerEvidenceSnapshotV1Entity } from '../deadlock-live/entities/statlocker-evidence-snapshot-v1.entity';
import { AdaptiveBuildPlannerV1Service } from './adaptive-build-planner-v1.service';
import { AdaptiveDecisionStateV1Service } from './adaptive-decision-state-v1.service';
import { AdaptiveEvidenceScorerV1Service } from './adaptive-evidence-scorer-v1.service';
import { AdaptiveRecommendationV1Controller } from './adaptive-recommendation-v1.controller';
import { AdaptiveRecommendationV1Service } from './adaptive-recommendation-v1.service';
import { AdaptiveReplayV1Service } from './adaptive-replay-v1.service';
import { BuildSkeletonService } from './build-skeleton.service';
import {
  STATLOCKER_BROWSER_LAUNCHER_V1,
  StatlockerBrowserCollectorService,
} from './statlocker-browser-collector.service';
import { StatlockerEvidenceService } from './statlocker-evidence.service';
import { StatlockerNormalizerService } from './statlocker-normalizer.service';
import { StatlockerRefreshService } from './statlocker-refresh.service';
import { StatlockerSnapshotStoreService } from './statlocker-snapshot-store.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DeadlockLiveModule,
    TypeOrmModule.forFeature([
      ItemCatalogVersion,
      ItemCatalogItem,
      ItemCatalogRecipe,
      StatlockerEvidenceSnapshotV1Entity,
      AdaptiveRecommendationDecisionV1Entity,
    ]),
  ],
  controllers: [AdaptiveRecommendationV1Controller],
  providers: [
    {
      provide: STATLOCKER_BROWSER_LAUNCHER_V1,
      useValue: puppeteer,
    },
    StatlockerBrowserCollectorService,
    StatlockerNormalizerService,
    StatlockerSnapshotStoreService,
    StatlockerRefreshService,
    StatlockerEvidenceService,
    BuildSkeletonService,
    AdaptiveDecisionStateV1Service,
    AdaptiveEvidenceScorerV1Service,
    AdaptiveBuildPlannerV1Service,
    AdaptiveReplayV1Service,
    AdaptiveRecommendationV1Service,
  ],
  exports: [AdaptiveRecommendationV1Service, StatlockerRefreshService, StatlockerEvidenceService],
})
export class StatlockerAdaptiveModule {}
