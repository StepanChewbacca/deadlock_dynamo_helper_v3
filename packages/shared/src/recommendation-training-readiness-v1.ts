export const RECOMMENDATION_TRAINING_READINESS_VERSION = 'recommendation-training-readiness-v1' as const;

export interface BehavioralTrainingReadinessInputV1 {
  observabilityGatePassed: boolean;
  datasetStructuralPassed: boolean;
  datasetEmpiricalPassed: boolean;
  soulsAffordabilityVerdict: 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE';
  candidateCoverage: number;
  rulesetCatalogCoverage: number;
  transactionMechanicsCoverage: number;
  futureTestEvaluated: boolean;
  observedActionInjectionDetected: boolean;
}

export interface BehavioralTrainingReadinessV1 {
  version: typeof RECOMMENDATION_TRAINING_READINESS_VERSION;
  ready: boolean;
  blockers: readonly string[];
}

export function evaluateBehavioralTrainingReadinessV1(
  input: BehavioralTrainingReadinessInputV1,
): BehavioralTrainingReadinessV1 {
  validateRate('candidateCoverage', input.candidateCoverage);
  validateRate('rulesetCatalogCoverage', input.rulesetCatalogCoverage);
  validateRate('transactionMechanicsCoverage', input.transactionMechanicsCoverage);
  const blockers: string[] = [];
  if (!input.observabilityGatePassed) blockers.push('OBSERVABILITY_GATE_NOT_PASS');
  if (!input.datasetStructuralPassed) blockers.push('DATASET_STRUCTURAL_GATE_NOT_PASS');
  if (!input.datasetEmpiricalPassed) blockers.push('DATASET_EMPIRICAL_GATE_NOT_PASS');
  if (input.soulsAffordabilityVerdict !== 'PASS') {
    blockers.push(`SOULS_AFFORDABILITY_${input.soulsAffordabilityVerdict}`);
  }
  if (input.candidateCoverage < 0.99) blockers.push('CANDIDATE_COVERAGE_BELOW_0_99');
  if (input.rulesetCatalogCoverage < 0.99) blockers.push('RULESET_CATALOG_COVERAGE_BELOW_0_99');
  if (input.transactionMechanicsCoverage < 0.99) blockers.push('TRANSACTION_MECHANICS_COVERAGE_BELOW_0_99');
  if (input.futureTestEvaluated) blockers.push('FUTURE_TEST_ALREADY_EVALUATED');
  if (input.observedActionInjectionDetected) blockers.push('OBSERVED_ACTION_INJECTION_DETECTED');
  return {
    version: RECOMMENDATION_TRAINING_READINESS_VERSION,
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
  };
}

export function assertBehavioralTrainingReadyV1(input: BehavioralTrainingReadinessInputV1): void {
  const readiness = evaluateBehavioralTrainingReadinessV1(input);
  if (!readiness.ready) {
    throw new Error(`Behavioral training is blocked: ${readiness.blockers.join(',')}`);
  }
}

function validateRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`);
}
