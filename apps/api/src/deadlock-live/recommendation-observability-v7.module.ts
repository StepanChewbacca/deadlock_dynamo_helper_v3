import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchTimelineCollectorController } from './match-timeline-collector.controller';
import { MatchTimelineCollectorService } from './match-timeline-collector.service';
import { RecommendationObservabilityV7PlayerIdentityExportService } from './recommendation-observability-v7-player-identity-export.service';
import { RecommendationObservabilityV7TelemetryStore } from './recommendation-observability-v7-telemetry';
import { RecommendationObservabilityV7TimelineTailService } from './recommendation-observability-v7-timeline-tail.service';

@Module({
  imports: [TypeOrmModule.forFeature([MatchPlayer])],
  controllers: [MatchTimelineCollectorController],
  providers: [
    MatchTimelineCollectorService,
    RecommendationObservabilityV7TelemetryStore,
    RecommendationObservabilityV7TimelineTailService,
    RecommendationObservabilityV7PlayerIdentityExportService,
  ],
  exports: [
    MatchTimelineCollectorService,
    RecommendationObservabilityV7TelemetryStore,
  ],
})
export class RecommendationObservabilityV7Module {}
