export const RECOMMENDATION_POLICY_GATES_VERSION = 'recommendation-policy-gates-v1' as const;

export interface PolicyAbMetricsV1 {
  matchCount: number;
  decisionCount: number;
  assignmentAtMatchLevelRate: number;
  exactLoggedPropensityRate: number;
  illegalRecommendationRate: number;
  exposureAckCoverage: number;
  telemetrySchemaErrorRate: number;
  primaryOutcomeDelta: number;
  primaryOutcomeCiLow: number;
  primaryOutcomeCiHigh: number;
  crashRateDelta: number;
  abandonmentRateDelta: number;
}

export interface PolicyAbGateConfigV1 {
  minMatches: number;
  minDecisions: number;
  minAssignmentAtMatchLevelRate: number;
  minExactLoggedPropensityRate: number;
  minExposureAckCoverage: number;
  maxTelemetrySchemaErrorRate: number;
  primaryOutcomeNonInferiorityMargin: number;
  maxCrashRateDelta: number;
  maxAbandonmentRateDelta: number;
}

export const DEFAULT_POLICY_AB_GATE_CONFIG_V1: PolicyAbGateConfigV1 = {
  minMatches: 1_000,
  minDecisions: 100_000,
  minAssignmentAtMatchLevelRate: 1,
  minExactLoggedPropensityRate: 1,
  minExposureAckCoverage: 0.99,
  maxTelemetrySchemaErrorRate: 0.001,
  primaryOutcomeNonInferiorityMargin: 0,
  maxCrashRateDelta: 0,
  maxAbandonmentRateDelta: 0,
};

export interface PolicyGateCheckV1 {
  name: string;
  passed: boolean;
  value: number;
  threshold: string;
}

export interface PolicyAbGateReportV1 {
  version: typeof RECOMMENDATION_POLICY_GATES_VERSION;
  passed: boolean;
  checks: readonly PolicyGateCheckV1[];
}

export function evaluatePolicyAbGateV1(
  metrics: PolicyAbMetricsV1,
  config: PolicyAbGateConfigV1 = DEFAULT_POLICY_AB_GATE_CONFIG_V1,
): PolicyAbGateReportV1 {
  validateMetrics(metrics);
  const checks: PolicyGateCheckV1[] = [
    minimum('MATCH_COUNT', metrics.matchCount, config.minMatches),
    minimum('DECISION_COUNT', metrics.decisionCount, config.minDecisions),
    minimum('MATCH_LEVEL_ASSIGNMENT_RATE', metrics.assignmentAtMatchLevelRate, config.minAssignmentAtMatchLevelRate),
    minimum('EXACT_LOGGED_PROPENSITY_RATE', metrics.exactLoggedPropensityRate, config.minExactLoggedPropensityRate),
    maximum('ILLEGAL_RECOMMENDATION_RATE', metrics.illegalRecommendationRate, 0),
    minimum('EXPOSURE_ACK_COVERAGE', metrics.exposureAckCoverage, config.minExposureAckCoverage),
    maximum('TELEMETRY_SCHEMA_ERROR_RATE', metrics.telemetrySchemaErrorRate, config.maxTelemetrySchemaErrorRate),
    minimum(
      'PRIMARY_OUTCOME_CI_LOW',
      metrics.primaryOutcomeCiLow,
      -Math.abs(config.primaryOutcomeNonInferiorityMargin),
    ),
    maximum('CRASH_RATE_DELTA', metrics.crashRateDelta, config.maxCrashRateDelta),
    maximum('ABANDONMENT_RATE_DELTA', metrics.abandonmentRateDelta, config.maxAbandonmentRateDelta),
  ];
  return { version: RECOMMENDATION_POLICY_GATES_VERSION, passed: checks.every((check) => check.passed), checks };
}

export interface ValuePolicyReleaseMetricsV1 {
  valueActionSensitivityPassed: boolean;
  offPolicySupportPassed: boolean;
  doublyRobustEstimate: number;
  doublyRobustCiLow: number;
  doublyRobustCiHigh: number;
  effectiveSampleSize: number;
  actionResidualVariance: number;
  illegalCandidateRate: number;
}

export interface ValuePolicyReleaseConfigV1 {
  minEffectiveSampleSize: number;
  minActionResidualVariance: number;
  minimumDoublyRobustCiLow: number;
}

export const DEFAULT_VALUE_POLICY_RELEASE_CONFIG_V1: ValuePolicyReleaseConfigV1 = {
  minEffectiveSampleSize: 1_000,
  minActionResidualVariance: 1e-6,
  minimumDoublyRobustCiLow: 0,
};

export interface ValuePolicyReleaseReportV1 {
  version: typeof RECOMMENDATION_POLICY_GATES_VERSION;
  passed: boolean;
  blockers: readonly string[];
}

export function evaluateValuePolicyReleaseGateV1(
  metrics: ValuePolicyReleaseMetricsV1,
  config: ValuePolicyReleaseConfigV1 = DEFAULT_VALUE_POLICY_RELEASE_CONFIG_V1,
): ValuePolicyReleaseReportV1 {
  if (!Number.isFinite(metrics.doublyRobustEstimate)) throw new Error('doublyRobustEstimate is invalid');
  if (!Number.isFinite(metrics.doublyRobustCiLow) || !Number.isFinite(metrics.doublyRobustCiHigh)) throw new Error('doublyRobust confidence interval is invalid');
  if (metrics.doublyRobustCiLow > metrics.doublyRobustCiHigh) throw new Error('doublyRobust confidence interval is inverted');
  if (!Number.isFinite(metrics.effectiveSampleSize) || metrics.effectiveSampleSize < 0) throw new Error('effectiveSampleSize is invalid');
  if (!Number.isFinite(metrics.actionResidualVariance) || metrics.actionResidualVariance < 0) throw new Error('actionResidualVariance is invalid');
  validateRate('illegalCandidateRate', metrics.illegalCandidateRate);
  const blockers: string[] = [];
  if (!metrics.valueActionSensitivityPassed) blockers.push('VALUE_ACTION_SENSITIVITY_NOT_PASS');
  if (!metrics.offPolicySupportPassed) blockers.push('OFF_POLICY_SUPPORT_NOT_PASS');
  if (metrics.effectiveSampleSize < config.minEffectiveSampleSize) blockers.push('OPE_EFFECTIVE_SAMPLE_SIZE_TOO_LOW');
  if (metrics.actionResidualVariance < config.minActionResidualVariance) blockers.push('ACTION_RESIDUAL_COLLAPSE');
  if (metrics.doublyRobustCiLow < config.minimumDoublyRobustCiLow) blockers.push('DOUBLY_ROBUST_CI_BELOW_RELEASE_FLOOR');
  if (metrics.illegalCandidateRate !== 0) blockers.push('ILLEGAL_CANDIDATES_PRESENT');
  return {
    version: RECOMMENDATION_POLICY_GATES_VERSION,
    passed: blockers.length === 0,
    blockers: blockers.sort(),
  };
}

function validateMetrics(metrics: PolicyAbMetricsV1): void {
  if (!Number.isInteger(metrics.matchCount) || metrics.matchCount < 0) throw new Error('matchCount is invalid');
  if (!Number.isInteger(metrics.decisionCount) || metrics.decisionCount < 0) throw new Error('decisionCount is invalid');
  validateRate('assignmentAtMatchLevelRate', metrics.assignmentAtMatchLevelRate);
  validateRate('exactLoggedPropensityRate', metrics.exactLoggedPropensityRate);
  validateRate('illegalRecommendationRate', metrics.illegalRecommendationRate);
  validateRate('exposureAckCoverage', metrics.exposureAckCoverage);
  validateRate('telemetrySchemaErrorRate', metrics.telemetrySchemaErrorRate);
  validateFinite('primaryOutcomeDelta', metrics.primaryOutcomeDelta);
  validateFinite('primaryOutcomeCiLow', metrics.primaryOutcomeCiLow);
  validateFinite('primaryOutcomeCiHigh', metrics.primaryOutcomeCiHigh);
  validateFinite('crashRateDelta', metrics.crashRateDelta);
  validateFinite('abandonmentRateDelta', metrics.abandonmentRateDelta);
  if (metrics.primaryOutcomeCiLow > metrics.primaryOutcomeCiHigh) throw new Error('primary outcome confidence interval is inverted');
}

function validateRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`);
}

function validateFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function minimum(name: string, value: number, threshold: number): PolicyGateCheckV1 {
  return { name, passed: value >= threshold, value, threshold: `>=${threshold}` };
}

function maximum(name: string, value: number, threshold: number): PolicyGateCheckV1 {
  return { name, passed: value <= threshold, value, threshold: `<=${threshold}` };
}
