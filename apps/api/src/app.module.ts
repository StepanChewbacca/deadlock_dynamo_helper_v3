import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/data-source';
import { DeadlockLiveModule } from './deadlock-live/deadlock-live.module';
import { RecommendationBehavioralV5Module } from './deadlock-live/recommendation-behavioral-v5.module';
import { RecommendationDatasetV5Module } from './deadlock-live/recommendation-dataset-v5.module';
import { RecommendationHistoricalProReplayModule } from './deadlock-live/recommendation-historical-pro-replay.module';
import { RecommendationObservabilityV7Module } from './deadlock-live/recommendation-observability-v7.module';
import { RecommendationPolicyV6EvaluationModule } from './deadlock-live/recommendation-policy-v6-evaluation.module';
import { RecommendationValueV5Module } from './deadlock-live/recommendation-value-v5.module';
import { RecommendationValueV6Module } from './deadlock-live/recommendation-value-v6.module';
import { RecommendationValueV8DiagnosticModule } from './deadlock-live/recommendation-value-v8-diagnostic.module';
import { RecommendationValueV8FullEvaluationModule } from './deadlock-live/recommendation-value-v8-full-evaluation.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      ...databaseOptions,
      migrationsRun: process.env.DB_RUN_MIGRATIONS === 'true',
    }),
    DeadlockLiveModule,
    RecommendationObservabilityV7Module,
    RecommendationValueV5Module,
    RecommendationValueV6Module,
    RecommendationDatasetV5Module,
    RecommendationPolicyV6EvaluationModule,
    RecommendationHistoricalProReplayModule,
    RecommendationBehavioralV5Module,
    RecommendationValueV8DiagnosticModule,
    RecommendationValueV8FullEvaluationModule,
  ],
})
export class AppModule {}
