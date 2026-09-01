import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisOperationsController } from './analysis-operations.controller';
import { CanonicalBuildSequenceService } from './canonical-build-sequence.service';
import { CatalogContentService } from './catalog-content.service';
import { ContextualHeroBuildRecommendationV2Service } from './contextual-hero-build-recommendation-v2.service';
import { ContextualHeroBuildRecommendationService } from './contextual-hero-build-recommendation.service';
import { DebugPageController } from './debug-page.controller';
import { ModelBundleRegistryController } from './model-bundle-registry.controller';
import { ModelBundleRegistryService } from './model-bundle-registry.service';
import { RecommendationModelPromotionV1Service } from './recommendation-model-promotion-v1.service';
import { RecommendationAdvancedEvidenceV8Controller } from './recommendation-advanced-evidence-v8.controller';
import { RecommendationAdvancedEvidenceV8Service } from './recommendation-advanced-evidence-v8.service';
import { RecommendationBehavioralServingV1Service } from './recommendation-behavioral-serving-v1.service';
import { RecommendationEngineV8Service } from './recommendation-engine-v8.service';
import { RecommendationDecisionV8Service } from './recommendation-decision-v8.service';
import { RecommendationRealtimeStateV8Service } from './recommendation-realtime-state-v8.service';
import { RecommendationRealtimeCoordinatorV8Service } from './recommendation-realtime-coordinator-v8.service';
import { RecommendationRuntimeTrustV8Service } from './recommendation-runtime-trust-v8.service';
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
import { RecommendationTrainingDatasetV8Service } from './recommendation-training-dataset-v8.service';
import { RecommendationTrainingLaunchV8Controller } from './recommendation-training-launch-v8.controller';
import { RecommendationTrainingLaunchV8Service } from './recommendation-training-launch-v8.service';
import { RecommendationPretrainingFinalReadinessV8Service } from './recommendation-pretraining-final-readiness-v8.service';
import { RecommendationValueDatasetRegistryController } from './recommendation-value-dataset-registry.controller';
import { RecommendationValueDatasetRegistryService } from './recommendation-value-dataset-registry.service';
import { RecommendationValueModelTrainingLaunchV8Controller } from './recommendation-value-model-training-launch-v8.controller';
import { RecommendationValueModelTrainingLaunchV8Service } from './recommendation-value-model-training-launch-v8.service';
import { RecommendationValueTrainingDatasetV8Service } from './recommendation-value-training-dataset-v8.service';
import { RecommendationValueTrainingLaunchV8Controller } from './recommendation-value-training-launch-v8.controller';
import { RecommendationValueTrainingLaunchV8Service } from './recommendation-value-training-launch-v8.service';
import { RecommendationPolicyBuildV1Controller } from './recommendation-policy-build-v1.controller';
import { RecommendationPolicyBuildV1Service } from './recommendation-policy-build-v1.service';
import { RecommendationEvidenceMaterializerV8Service } from './recommendation-evidence-materializer-v8.service';
import { RecommendationRoadmapEvidenceController } from './recommendation-roadmap-evidence.controller';
import { RecommendationRoadmapEvidenceService } from './recommendation-roadmap-evidence.service';
import { RecommendationFutureTestEvaluationV1Controller } from './recommendation-future-test-evaluation-v1.controller';
import { RecommendationFutureTestEvaluationV1Service } from './recommendation-future-test-evaluation-v1.service';
import { RecommendationSequentialRlEvidenceV1Controller } from './recommendation-sequential-rl-evidence-v1.controller';
import { RecommendationSequentialRlEvidenceV1Service } from './recommendation-sequential-rl-evidence-v1.service';
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
import { GameRuleset } from './entities/game-ruleset.entity';
import { Hero } from './entities/hero.entity';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import { ItemComponent } from './entities/item-component.entity';
import { Item } from './entities/item.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { Match } from './entities/match.entity';
import { RawMatchMetadata } from './entities/raw-match-metadata.entity';
import { HeroBuildContextualV3CandidateEvaluationController } from './hero-build-contextual-v3-candidate-evaluation.controller';
import { HeroBuildContextualV3CandidateEvaluationService } from './hero-build-contextual-v3-candidate-evaluation.service';
import { HeroBuildContextualV3FinalTestController } from './hero-build-contextual-v3-final-test.controller';
import { HeroBuildContextualV3FinalTestService } from './hero-build-contextual-v3-final-test.service';
import { HeroBuildContextualV3LiveService } from './hero-build-contextual-v3-live.service';
import { HeroBuildContextualV3TrainingController } from './hero-build-contextual-v3-training.controller';
import { HeroBuildContextualV3TrainingCoordinatorService } from './hero-build-contextual-v3-training-coordinator.service';
import { HeroBuildContextualV3TrainingService } from './hero-build-contextual-v3-training.service';
import { HeroBuildDecisionDatasetV3CoordinatorService } from './hero-build-decision-dataset-v3-coordinator.service';
import { HeroBuildDecisionDatasetV3Controller } from './hero-build-decision-dataset-v3.controller';
import { HeroBuildDecisionDatasetV3Service } from './hero-build-decision-dataset-v3.service';
import { HeroBuildMatchupStatisticsService } from './hero-build-matchup-statistics.service';
import { HeroBuildNextActionContextStatisticsService } from './hero-build-next-action-context-statistics.service';
import { HeroBuildOfflineEvaluationDataLoaderService } from './hero-build-offline-evaluation-data-loader.service';
import { HeroBuildOfflineEvaluationV2Controller } from './hero-build-offline-evaluation-v2.controller';
import { HeroBuildOfflineEvaluationV2ResilientService } from './hero-build-offline-evaluation-v2-resilient.service';
import { HeroBuildOfflineEvaluationController } from './hero-build-offline-evaluation.controller';
import { HeroBuildOfflineEvaluationResilientService } from './hero-build-offline-evaluation-resilient.service';
import { HeroBuildOfflineEvaluationService } from './hero-build-offline-evaluation.service';
import { HeroBuildRecommendationOwnershipFilterService } from './hero-build-recommendation-ownership-filter.service';
import { HeroBuildRecommendationPresentationService } from './hero-build-recommendation-presentation.service';
import { HeroBuildRecommendationService } from './hero-build-recommendation.service';
import { HeroBuildTransitionAggregationController } from './hero-build-transition-aggregation.controller';
import { HeroBuildTransitionAggregationService } from './hero-build-transition-aggregation.service';
import { HistoricalCatalogBackfillService } from './historical-catalog-backfill.service';
import { HistoricalMatchReplayService } from './historical-match-replay.service';
import { IngestStatusController } from './ingest-status.controller';
import { IngestStatusService } from './ingest-status.service';
import { InventoryShadowReplayService } from './inventory-shadow-replay.service';
import { InventoryTimelineReplayService } from './inventory-timeline-replay.service';
import { ItemCatalogImportService } from './item-catalog-import.service';
import { LazyBuildTransitionAggregationService } from './lazy-build-transition-aggregation.service';
import { LazyRecentMatchesWindowService } from './lazy-recent-matches-window.service';
import { LiveBuildRecommendationTraversalService } from './live-build-recommendation-traversal.service';
import { LiveHeroBuildPolicyService } from './live-hero-build-policy.service';
import { LiveHeroBuildRecommendationPresentationService } from './live-hero-build-recommendation-presentation.service';
import { LiveHeroMatchupSourceService } from './live-hero-matchup-source.service';
import { LiveIngestController } from './live-ingest.controller';
import { LiveInventoryEventNormalizerService } from './live-inventory-event-normalizer.service';
import { LiveMatchStateService } from './live-match-state.service';
import { MatchTimelineNormalizationController } from './match-timeline-normalization.controller';
import { MatchTimelineNormalizationService } from './match-timeline-normalization.service';
import { ProductionHeroBuildRecommendationService } from './production-hero-build-recommendation.service';
import { ProductionSafeHeroBuildRecommendationService } from './production-safe-hero-build-recommendation.service';
import { RawEventLogService } from './raw-event-log.service';
import { RawMatchMetadataNormalizerService } from './raw-match-metadata-normalizer.service';
import { RawMatchMetadataService } from './raw-match-metadata.service';
import { RecentLiveEventsService } from './recent-live-events.service';
import { RecentMatchCrawlerService } from './recent-match-crawler.service';
import { RecentMatchRosterRepairService } from './recent-match-roster-repair.service';
import { RecentMatchesWindowController } from './recent-matches-window.controller';
import { RecentMatchesWindowService } from './recent-matches-window.service';
import { RecommendationBehavioralV4TrainingController } from './recommendation-behavioral-v4-training.controller';
import { RecommendationBehavioralV4TrainingService } from './recommendation-behavioral-v4-training.service';
import { RecommendationDecisionDatasetV4HistoricalBootstrapController } from './recommendation-decision-dataset-v4-historical-bootstrap.controller';
import { RecommendationDecisionDatasetV4HistoricalBootstrapService } from './recommendation-decision-dataset-v4-historical-bootstrap.service';
import { RecommendationDecisionDatasetV4Controller } from './recommendation-decision-dataset-v4.controller';
import { RecommendationDecisionDatasetV4Service } from './recommendation-decision-dataset-v4.service';
import { RecommendationDecisionTelemetryController } from './recommendation-decision-telemetry.controller';
import { RecommendationDecisionTelemetryService } from './recommendation-decision-telemetry.service';
import { RecommendationOutcomeLinkerService } from './recommendation-outcome-linker.service';
import { RecommendationPolicyV4EvaluationController } from './recommendation-policy-v4-evaluation.controller';
import { RecommendationPolicyV4EvaluationService } from './recommendation-policy-v4-evaluation.service';
import { RecommendationValueV4TrainingController } from './recommendation-value-v4-training.controller';
import { RecommendationValueV4TrainingService } from './recommendation-value-v4-training.service';
import { RecommendationValueV6TelemetryService } from './recommendation-value-v6-telemetry.service';
import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';
import { ReferenceDataController } from './reference-data.controller';
import { ModelBundleRegistryV1 } from './entities/model-bundle-registry.entity';
import { RecommendationDatasetRegistryV1 } from './entities/recommendation-dataset-registry.entity';
import { RecommendationDecisionCandidateV8 } from './entities/recommendation-decision-candidate.entity';
import { RecommendationDecisionV8 } from './entities/recommendation-decision.entity';
import { RecommendationEvidenceSnapshotV8 } from './entities/recommendation-evidence-snapshot-v8.entity';
import { RecommendationExposureAckV8 } from './entities/recommendation-exposure-ack.entity';
import { RecommendationRoadmapEvidenceEntityV1 } from './entities/recommendation-roadmap-evidence.entity';
import { RecommendationTelemetryEvent } from './entities/recommendation-telemetry-event.entity';
import { RecommendationTelemetryRejectionV8 } from './entities/recommendation-telemetry-rejection.entity';
import { RecommendationValueDatasetRegistryV1 } from './entities/recommendation-value-dataset-registry.entity';
import { SoulsAffordabilityEvidenceV2Entity } from './entities/souls-affordability-evidence-v2.entity';
import { RecommendationItemCatalogVersionV1 } from './entities/recommendation-item-catalog-version-v1.entity';
import { RecommendationItemCatalogItemV1 } from './entities/recommendation-item-catalog-item-v1.entity';
import { RecommendationItemCatalogRecipeV1 } from './entities/recommendation-item-catalog-recipe-v1.entity';
import { RecommendationCatalogContentV1Service } from './recommendation-catalog-content-v1.service';
import { ReferenceDataImportService } from './reference-data-import.service';
import { RulesetResolutionRefreshService } from './ruleset-resolution-refresh.service';
import { RulesetResolverService } from './ruleset-resolver.service';
import { RulesetWindowManifestService } from './ruleset-window-manifest.service';
import { SituationalRecommendationDiagnosticsService } from './situational-recommendation-diagnostics.service';
import { SkillBuildAnalysisService } from './skill-build-analysis.service';
import { StoredMatchReprocessingService } from './stored-match-reprocessing.service';
import { VersionedRecipeGraphService } from './versioned-recipe-graph.service';

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
      RecommendationItemCatalogVersionV1,
      RecommendationItemCatalogItemV1,
      RecommendationItemCatalogRecipeV1,
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
      CrawlerRun,
      CrawlerState,
      RawMatchMetadata,
      GameRuleset,
    ]),
  ],
  controllers: [
    LiveIngestController,
    DebugPageController,
    AnalysisOperationsController,
    RecentMatchesWindowController,
    MatchTimelineNormalizationController,
    HeroBuildTransitionAggregationController,
    HeroBuildOfflineEvaluationController,
    HeroBuildOfflineEvaluationV2Controller,
    HeroBuildDecisionDatasetV3Controller,
    HeroBuildContextualV3TrainingController,
    HeroBuildContextualV3CandidateEvaluationController,
    HeroBuildContextualV3FinalTestController,
    RecommendationBehavioralV4TrainingController,
    RecommendationPolicyV4EvaluationController,
    RecommendationValueV4TrainingController,
    RecommendationDecisionDatasetV4HistoricalBootstrapController,
    RecommendationDecisionDatasetV4Controller,
    RecommendationDecisionTelemetryController,
    ReferenceDataController,
    IngestStatusController,
    RecommendationTelemetryController,
    RecommendationObservabilityController,
    RecommendationReadinessV8Controller,
    RecommendationFeatureStoreV8Controller,
    RecommendationDatasetV8Controller,
    RecommendationDatasetRegistryController,
    RecommendationValueDatasetRegistryController,
    RecommendationTrainingLaunchV8Controller,
    RecommendationValueTrainingLaunchV8Controller,
    RecommendationValueModelTrainingLaunchV8Controller,
    RecommendationPolicyBuildV1Controller,
    ModelBundleRegistryController,
    RecommendationRoadmapEvidenceController,
    RecommendationAdvancedEvidenceV8Controller,
    RecommendationFutureTestEvaluationV1Controller,
    RecommendationSequentialRlEvidenceV1Controller,
    RecommendationShadowController,
    RecommendationOpeController,
    RecommendationAbController,
    SoulsAffordabilityEvidenceV2Controller,
  ],
  providers: [
    LiveMatchStateService,
    LiveInventoryEventNormalizerService,
    LiveBuildRecommendationTraversalService,
    InventoryShadowReplayService,
    InventoryTimelineReplayService,
    CanonicalBuildSequenceService,
    LiveHeroBuildPolicyService,
    LiveHeroMatchupSourceService,
    LazyBuildTransitionAggregationService,
    {
      provide: HeroBuildTransitionAggregationService,
      useExisting: LiveHeroBuildPolicyService,
    },
    HeroBuildMatchupStatisticsService,
    HeroBuildNextActionContextStatisticsService,
    HeroBuildOfflineEvaluationDataLoaderService,
    HeroBuildOfflineEvaluationV2ResilientService,
    HeroBuildOfflineEvaluationResilientService,
    HeroBuildDecisionDatasetV3Service,
    HeroBuildDecisionDatasetV3CoordinatorService,
    HeroBuildContextualV3TrainingService,
    HeroBuildContextualV3TrainingCoordinatorService,
    HeroBuildContextualV3CandidateEvaluationService,
    HeroBuildContextualV3FinalTestService,
    HeroBuildContextualV3LiveService,
    {
      provide: RecommendationDecisionTelemetryService,
      useExisting: RecommendationValueV6TelemetryService,
    },
    RecommendationDecisionDatasetV4Service,
    RecommendationDecisionDatasetV4HistoricalBootstrapService,
    RecommendationBehavioralV4TrainingService,
    RecommendationValueV4TrainingService,
    RecommendationPolicyV4EvaluationService,
    RecommendationOutcomeLinkerService,
    {
      provide: HeroBuildOfflineEvaluationService,
      useExisting: HeroBuildOfflineEvaluationResilientService,
    },
    ContextualHeroBuildRecommendationService,
    ContextualHeroBuildRecommendationV2Service,
    ProductionSafeHeroBuildRecommendationService,
    {
      provide: ProductionHeroBuildRecommendationService,
      useExisting: ProductionSafeHeroBuildRecommendationService,
    },
    {
      provide: HeroBuildRecommendationService,
      useExisting: ProductionSafeHeroBuildRecommendationService,
    },
    HeroBuildRecommendationOwnershipFilterService,
    LiveHeroBuildRecommendationPresentationService,
    {
      provide: HeroBuildRecommendationPresentationService,
      useExisting: LiveHeroBuildRecommendationPresentationService,
    },
    SituationalRecommendationDiagnosticsService,
    SkillBuildAnalysisService,
    RawEventLogService,
    RecentLiveEventsService,
    LazyRecentMatchesWindowService,
    {
      provide: RecentMatchesWindowService,
      useExisting: LazyRecentMatchesWindowService,
    },
    RecentMatchCrawlerService,
    RecentMatchRosterRepairService,
    RecipeAwareTimelineReconciliationService,
    MatchTimelineNormalizationService,
    RulesetResolverService,
    RulesetResolutionRefreshService,
    RawMatchMetadataService,
    RawMatchMetadataNormalizerService,
    HistoricalMatchReplayService,
    StoredMatchReprocessingService,
    ItemCatalogImportService,
    CatalogContentService,
    HistoricalCatalogBackfillService,
    RulesetWindowManifestService,
    VersionedRecipeGraphService,
    RecommendationCatalogContentV1Service,
    ModelBundleRegistryService,
    RecommendationModelPromotionV1Service,
    RecommendationBehavioralServingV1Service,
    RecommendationEngineV8Service,
    RecommendationDecisionV8Service,
    RecommendationRealtimeStateV8Service,
    RecommendationRealtimeCoordinatorV8Service,
    RecommendationRuntimeTrustV8Service,
    RecommendationRuntimeHealthV8Service,
    RecommendationReadinessV8Service,
    RecommendationTelemetryStoreService,
    RecommendationTelemetryIngestV8Service,
    RecommendationObservabilityReportService,
    RecommendationFeatureStoreV8Service,
    RecommendationDatasetV8ReportService,
    RecommendationDatasetRegistryService,
    RecommendationValueDatasetRegistryService,
    RecommendationTrainingDatasetV8Service,
    RecommendationTrainingLaunchV8Service,
    RecommendationPretrainingFinalReadinessV8Service,
    RecommendationValueTrainingDatasetV8Service,
    RecommendationValueTrainingLaunchV8Service,
    RecommendationValueModelTrainingLaunchV8Service,
    RecommendationPolicyBuildV1Service,
    RecommendationEvidenceMaterializerV8Service,
    RecommendationAdvancedEvidenceV8Service,
    RecommendationRoadmapEvidenceService,
    RecommendationFutureTestEvaluationV1Service,
    RecommendationSequentialRlEvidenceV1Service,
    RecommendationShadowReportService,
    RecommendationOpeReportService,
    RecommendationAbReportService,
    SoulsAffordabilityEvidenceV2Service,
    ReferenceDataImportService,
    IngestStatusService,
  ],
  exports: [
    LiveMatchStateService,
    LiveBuildRecommendationTraversalService,
    InventoryShadowReplayService,
    InventoryTimelineReplayService,
    CanonicalBuildSequenceService,
    LiveHeroBuildPolicyService,
    LiveHeroMatchupSourceService,
    HeroBuildTransitionAggregationService,
    HeroBuildMatchupStatisticsService,
    HeroBuildNextActionContextStatisticsService,
    HeroBuildOfflineEvaluationV2ResilientService,
    HeroBuildOfflineEvaluationService,
    HeroBuildDecisionDatasetV3CoordinatorService,
    HeroBuildContextualV3TrainingService,
    HeroBuildContextualV3TrainingCoordinatorService,
    HeroBuildContextualV3CandidateEvaluationService,
    HeroBuildContextualV3FinalTestService,
    HeroBuildContextualV3LiveService,
    RecommendationDecisionTelemetryService,
    RecommendationDecisionDatasetV4Service,
    RecommendationDecisionDatasetV4HistoricalBootstrapService,
    RecommendationBehavioralV4TrainingService,
    RecommendationValueV4TrainingService,
    RecommendationPolicyV4EvaluationService,
    HeroBuildRecommendationService,
    HeroBuildRecommendationPresentationService,
    SituationalRecommendationDiagnosticsService,
    SkillBuildAnalysisService,
    RawEventLogService,
    RecentLiveEventsService,
    RecentMatchesWindowService,
    RecentMatchCrawlerService,
    RecentMatchRosterRepairService,
    RecipeAwareTimelineReconciliationService,
    MatchTimelineNormalizationService,
    RulesetResolverService,
    RulesetResolutionRefreshService,
    RawMatchMetadataService,
    RawMatchMetadataNormalizerService,
    HistoricalMatchReplayService,
    StoredMatchReprocessingService,
    ItemCatalogImportService,
    CatalogContentService,
    HistoricalCatalogBackfillService,
    RulesetWindowManifestService,
    VersionedRecipeGraphService,
    RecommendationCatalogContentV1Service,
    ModelBundleRegistryService,
    RecommendationModelPromotionV1Service,
    RecommendationBehavioralServingV1Service,
    RecommendationEngineV8Service,
    RecommendationDecisionV8Service,
    RecommendationRealtimeStateV8Service,
    RecommendationRealtimeCoordinatorV8Service,
    RecommendationRuntimeTrustV8Service,
    RecommendationRuntimeHealthV8Service,
    RecommendationReadinessV8Service,
    RecommendationTelemetryStoreService,
    RecommendationTelemetryIngestV8Service,
    RecommendationObservabilityReportService,
    RecommendationFeatureStoreV8Service,
    RecommendationDatasetV8ReportService,
    RecommendationDatasetRegistryService,
    RecommendationValueDatasetRegistryService,
    RecommendationTrainingDatasetV8Service,
    RecommendationTrainingLaunchV8Service,
    RecommendationPretrainingFinalReadinessV8Service,
    RecommendationValueTrainingDatasetV8Service,
    RecommendationValueTrainingLaunchV8Service,
    RecommendationValueModelTrainingLaunchV8Service,
    RecommendationPolicyBuildV1Service,
    RecommendationEvidenceMaterializerV8Service,
    RecommendationAdvancedEvidenceV8Service,
    RecommendationRoadmapEvidenceService,
    RecommendationFutureTestEvaluationV1Service,
    RecommendationSequentialRlEvidenceV1Service,
    RecommendationShadowReportService,
    RecommendationOpeReportService,
    RecommendationAbReportService,
    SoulsAffordabilityEvidenceV2Service,
    ReferenceDataImportService,
    IngestStatusService,
  ],
})
export class DeadlockLiveModule {}
