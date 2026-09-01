export const RECOMMENDATION_MODEL_GATES_VERSION = 'recommendation-model-gates-v1' as const;

export interface BehavioralModelMetricsV1 {
  decisionCount: number;
  candidateCoverage: number;
  support: number;
  majorCohortSupportMin: number;
  rawLogLoss: number;
  baselineRawLogLoss: number;
  floorSensitivity: number;
  probabilityFloorApplied: boolean;
  illegalCandidateRate: number;
}

export interface BehavioralModelGateConfigV1 {
  minDecisions: number;
  minCandidateCoverage: number;
  minSupport: number;
  minMajorCohortSupport: number;
  maxFloorSensitivity: number;
  requireRawLogLossImprovement: boolean;
}

export interface GateCheckV1 {
  name: string;
  passed: boolean;
  value: number | boolean;
  threshold: number | boolean | string;
}

export interface BehavioralModelGateReportV1 {
  gateVersion: typeof RECOMMENDATION_MODEL_GATES_VERSION;
  passed: boolean;
  checks: readonly GateCheckV1[];
}

export const DEFAULT_BEHAVIORAL_MODEL_GATE_CONFIG_V1: BehavioralModelGateConfigV1 = {
  minDecisions: 10_000,
  minCandidateCoverage: 0.99,
  minSupport: 0.90,
  minMajorCohortSupport: 0.75,
  maxFloorSensitivity: 0.02,
  requireRawLogLossImprovement: true,
};

export function evaluateBehavioralModelGateV1(
  metrics: BehavioralModelMetricsV1,
  config: BehavioralModelGateConfigV1 = DEFAULT_BEHAVIORAL_MODEL_GATE_CONFIG_V1,
): BehavioralModelGateReportV1 {
  validateUnitInterval('candidateCoverage', metrics.candidateCoverage);
  validateUnitInterval('support', metrics.support);
  validateUnitInterval('majorCohortSupportMin', metrics.majorCohortSupportMin);
  validateUnitInterval('illegalCandidateRate', metrics.illegalCandidateRate);
  if (!Number.isFinite(metrics.rawLogLoss) || metrics.rawLogLoss < 0) throw new Error('rawLogLoss is invalid');
  if (!Number.isFinite(metrics.baselineRawLogLoss) || metrics.baselineRawLogLoss < 0) throw new Error('baselineRawLogLoss is invalid');
  if (!Number.isFinite(metrics.floorSensitivity) || metrics.floorSensitivity < 0) throw new Error('floorSensitivity is invalid');

  const checks: GateCheckV1[] = [
    {
      name: 'DECISION_COUNT',
      passed: metrics.decisionCount >= config.minDecisions,
      value: metrics.decisionCount,
      threshold: `>=${config.minDecisions}`,
    },
    {
      name: 'CANDIDATE_COVERAGE',
      passed: metrics.candidateCoverage >= config.minCandidateCoverage,
      value: metrics.candidateCoverage,
      threshold: `>=${config.minCandidateCoverage}`,
    },
    {
      name: 'SUPPORT',
      passed: metrics.support >= config.minSupport,
      value: metrics.support,
      threshold: `>=${config.minSupport}`,
    },
    {
      name: 'MAJOR_COHORT_SUPPORT',
      passed: metrics.majorCohortSupportMin >= config.minMajorCohortSupport,
      value: metrics.majorCohortSupportMin,
      threshold: `>=${config.minMajorCohortSupport}`,
    },
    {
      name: 'FLOOR_SENSITIVITY',
      passed: metrics.floorSensitivity <= config.maxFloorSensitivity,
      value: metrics.floorSensitivity,
      threshold: `<=${config.maxFloorSensitivity}`,
    },
    {
      name: 'NO_PROBABILITY_FLOOR',
      passed: metrics.probabilityFloorApplied === false,
      value: metrics.probabilityFloorApplied,
      threshold: false,
    },
    {
      name: 'ILLEGAL_CANDIDATE_RATE',
      passed: metrics.illegalCandidateRate === 0,
      value: metrics.illegalCandidateRate,
      threshold: 0,
    },
    {
      name: 'RAW_LOG_LOSS',
      passed: !config.requireRawLogLossImprovement || metrics.rawLogLoss < metrics.baselineRawLogLoss,
      value: metrics.rawLogLoss,
      threshold: config.requireRawLogLossImprovement ? `<${metrics.baselineRawLogLoss}` : 'finite',
    },
  ];

  return {
    gateVersion: RECOMMENDATION_MODEL_GATES_VERSION,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export interface ShadowMetricsV1 {
  matchCount: number;
  decisionCount: number;
  illegalRecommendationRate: number;
  staleStateRate: number;
  fallbackRate: number;
  p99LatencyMs: number;
  crashCount: number;
  schemaErrorRate: number;
}

export interface ShadowGateConfigV1 {
  minMatches: number;
  minDecisions: number;
  maxStaleStateRate: number;
  maxFallbackRate: number;
  maxP99LatencyMs: number;
  maxSchemaErrorRate: number;
}

export const DEFAULT_SHADOW_GATE_CONFIG_V1: ShadowGateConfigV1 = {
  minMatches: 1_000,
  minDecisions: 100_000,
  maxStaleStateRate: 0.01,
  maxFallbackRate: 0.05,
  maxP99LatencyMs: 200,
  maxSchemaErrorRate: 0.001,
};

export interface ShadowGateReportV1 {
  gateVersion: typeof RECOMMENDATION_MODEL_GATES_VERSION;
  passed: boolean;
  checks: readonly GateCheckV1[];
}

export function evaluateShadowGateV1(
  metrics: ShadowMetricsV1,
  config: ShadowGateConfigV1 = DEFAULT_SHADOW_GATE_CONFIG_V1,
): ShadowGateReportV1 {
  validateUnitInterval('illegalRecommendationRate', metrics.illegalRecommendationRate);
  validateUnitInterval('staleStateRate', metrics.staleStateRate);
  validateUnitInterval('fallbackRate', metrics.fallbackRate);
  validateUnitInterval('schemaErrorRate', metrics.schemaErrorRate);
  if (!Number.isFinite(metrics.p99LatencyMs) || metrics.p99LatencyMs < 0) throw new Error('p99LatencyMs is invalid');

  const checks: GateCheckV1[] = [
    { name: 'SHADOW_MATCH_COUNT', passed: metrics.matchCount >= config.minMatches, value: metrics.matchCount, threshold: `>=${config.minMatches}` },
    { name: 'SHADOW_DECISION_COUNT', passed: metrics.decisionCount >= config.minDecisions, value: metrics.decisionCount, threshold: `>=${config.minDecisions}` },
    { name: 'ILLEGAL_RECOMMENDATION_RATE', passed: metrics.illegalRecommendationRate === 0, value: metrics.illegalRecommendationRate, threshold: 0 },
    { name: 'STALE_STATE_RATE', passed: metrics.staleStateRate <= config.maxStaleStateRate, value: metrics.staleStateRate, threshold: `<=${config.maxStaleStateRate}` },
    { name: 'FALLBACK_RATE', passed: metrics.fallbackRate <= config.maxFallbackRate, value: metrics.fallbackRate, threshold: `<=${config.maxFallbackRate}` },
    { name: 'P99_LATENCY_MS', passed: metrics.p99LatencyMs <= config.maxP99LatencyMs, value: metrics.p99LatencyMs, threshold: `<=${config.maxP99LatencyMs}` },
    { name: 'CRASH_COUNT', passed: metrics.crashCount === 0, value: metrics.crashCount, threshold: 0 },
    { name: 'SCHEMA_ERROR_RATE', passed: metrics.schemaErrorRate <= config.maxSchemaErrorRate, value: metrics.schemaErrorRate, threshold: `<=${config.maxSchemaErrorRate}` },
  ];
  return { gateVersion: RECOMMENDATION_MODEL_GATES_VERSION, passed: checks.every((check) => check.passed), checks };
}

function validateUnitInterval(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`);
}
