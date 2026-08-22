export const RECOMMENDATION_PRETRAINING_FINAL_READINESS_V1 = 'recommendation-pretraining-final-readiness-v1' as const;

export interface RecommendationPretrainingFinalReadinessInputV1 {
  canonicalGepFixtureCoverage: number;
  controlledSoulsValidation: 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE' | 'NOT_EVALUATED';
  directShopSourceValidation: 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE' | 'NOT_EVALUATED';
  rulesetCatalogCoverage: number;
  deterministicIllegalRecommendationCount: number;
  recommendationTelemetryContractPassed: boolean;
  observabilityGatePassed: boolean;
  datasetStructuralPassed: boolean;
  datasetEmpiricalPassed: boolean;
  explicitFeasibilityCoverage: number;
  observedActionFeasibleCoverage: number;
  criticalCohortObservedActionFeasibleCoverage: number;
  shadowHoldoutDecisionCount: number;
  datasetRegistryVerified: boolean;
  datasetRegistryVerificationFresh: boolean;
  splitIsolationPassed: boolean;
  futureTestUntouched: boolean;
  futureTestEvaluated: boolean;
  rnnApiPreflightReady: boolean;
  transformerApiPreflightReady: boolean;
  immutableDatasetBytesVerified: boolean;
  offlineWheelhouseReady: boolean;
  trainingDeviceReady: boolean;
}

export interface RecommendationPretrainingFinalReadinessReportV1 {
  contractVersion: typeof RECOMMENDATION_PRETRAINING_FINAL_READINESS_V1;
  readyToStartBehavioralTraining: boolean;
  blockers: readonly string[];
}

export const RECOMMENDATION_PRETRAINING_FINAL_THRESHOLDS_V1 = {
  canonicalGepFixtureCoverage: 1,
  rulesetCatalogCoverage: 0.999,
  explicitFeasibilityCoverage: 0.995,
  observedActionFeasibleCoverage: 0.99,
  criticalCohortObservedActionFeasibleCoverage: 0.98,
  shadowHoldoutDecisionCount: 10_000,
} as const;

export function evaluateRecommendationPretrainingFinalReadinessV1(
  input: RecommendationPretrainingFinalReadinessInputV1,
): RecommendationPretrainingFinalReadinessReportV1 {
  validateRate('canonicalGepFixtureCoverage', input.canonicalGepFixtureCoverage);
  validateRate('rulesetCatalogCoverage', input.rulesetCatalogCoverage);
  validateRate('explicitFeasibilityCoverage', input.explicitFeasibilityCoverage);
  validateRate('observedActionFeasibleCoverage', input.observedActionFeasibleCoverage);
  validateRate('criticalCohortObservedActionFeasibleCoverage', input.criticalCohortObservedActionFeasibleCoverage);
  if (!Number.isInteger(input.deterministicIllegalRecommendationCount) || input.deterministicIllegalRecommendationCount < 0) {
    throw new Error('deterministicIllegalRecommendationCount must be a non-negative integer');
  }
  if (!Number.isInteger(input.shadowHoldoutDecisionCount) || input.shadowHoldoutDecisionCount < 0) {
    throw new Error('shadowHoldoutDecisionCount must be a non-negative integer');
  }

  const blockers: string[] = [];
  const thresholds = RECOMMENDATION_PRETRAINING_FINAL_THRESHOLDS_V1;
  if (input.canonicalGepFixtureCoverage < thresholds.canonicalGepFixtureCoverage) blockers.push('CANONICAL_GEP_FIXTURE_COVERAGE_BELOW_1');
  if (input.controlledSoulsValidation !== 'PASS') blockers.push(`CONTROLLED_SOULS_${input.controlledSoulsValidation}`);
  if (input.directShopSourceValidation !== 'PASS') blockers.push(`DIRECT_SHOP_SOURCE_${input.directShopSourceValidation}`);
  if (input.rulesetCatalogCoverage < thresholds.rulesetCatalogCoverage) blockers.push('RULESET_CATALOG_COVERAGE_BELOW_0_999');
  if (input.deterministicIllegalRecommendationCount !== 0) blockers.push('DETERMINISTIC_ILLEGAL_RECOMMENDATIONS_PRESENT');
  if (!input.recommendationTelemetryContractPassed) blockers.push('RECOMMENDATION_TELEMETRY_CONTRACT_NOT_PASS');
  if (!input.observabilityGatePassed) blockers.push('OBSERVABILITY_GATE_NOT_PASS');
  if (!input.datasetStructuralPassed) blockers.push('DATASET_STRUCTURAL_GATE_NOT_PASS');
  if (!input.datasetEmpiricalPassed) blockers.push('DATASET_EMPIRICAL_GATE_NOT_PASS');
  if (input.explicitFeasibilityCoverage < thresholds.explicitFeasibilityCoverage) blockers.push('EXPLICIT_FEASIBILITY_COVERAGE_BELOW_0_995');
  if (input.observedActionFeasibleCoverage < thresholds.observedActionFeasibleCoverage) blockers.push('OBSERVED_ACTION_FEASIBLE_COVERAGE_BELOW_0_99');
  if (
    input.criticalCohortObservedActionFeasibleCoverage
    < thresholds.criticalCohortObservedActionFeasibleCoverage
  ) blockers.push('CRITICAL_COHORT_OBSERVED_ACTION_FEASIBLE_COVERAGE_BELOW_0_98');
  if (input.shadowHoldoutDecisionCount < thresholds.shadowHoldoutDecisionCount) blockers.push('SHADOW_HOLDOUT_DECISION_COUNT_BELOW_10000');
  if (!input.datasetRegistryVerified) blockers.push('DATASET_REGISTRY_NOT_VERIFIED');
  if (!input.datasetRegistryVerificationFresh) blockers.push('DATASET_REGISTRY_VERIFICATION_STALE');
  if (!input.splitIsolationPassed) blockers.push('DEVELOPMENT_SPLIT_ISOLATION_NOT_PASS');
  if (!input.futureTestUntouched) blockers.push('FUTURE_TEST_INTEGRITY_VIOLATION');
  if (input.futureTestEvaluated) blockers.push('FUTURE_TEST_ALREADY_EVALUATED');
  if (!input.rnnApiPreflightReady) blockers.push('RNN_API_PREFLIGHT_NOT_READY');
  if (!input.transformerApiPreflightReady) blockers.push('TRANSFORMER_API_PREFLIGHT_NOT_READY');
  if (!input.immutableDatasetBytesVerified) blockers.push('IMMUTABLE_DATASET_BYTES_NOT_VERIFIED');
  if (!input.offlineWheelhouseReady) blockers.push('OFFLINE_WHEELHOUSE_NOT_READY');
  if (!input.trainingDeviceReady) blockers.push('TRAINING_DEVICE_NOT_READY');

  return {
    contractVersion: RECOMMENDATION_PRETRAINING_FINAL_READINESS_V1,
    readyToStartBehavioralTraining: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
  };
}

export function assertRecommendationPretrainingFinalReadyV1(
  input: RecommendationPretrainingFinalReadinessInputV1,
): void {
  const report = evaluateRecommendationPretrainingFinalReadinessV1(input);
  if (!report.readyToStartBehavioralTraining) {
    throw new Error(`Behavioral training final readiness is blocked: ${report.blockers.join(',')}`);
  }
}

function validateRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`);
}
