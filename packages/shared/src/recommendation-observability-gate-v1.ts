export const RECOMMENDATION_OBSERVABILITY_GATE_VERSION = 'recommendation-observability-gate-v1' as const;

export interface RecommendationObservabilityMetricsV1 {
  decisionCount: number;
  exactSpendableSoulsCoverage: number;
  shopOpportunityCoverage: number;
  inventorySnapshotCoverage: number;
  rulesetCatalogCoverage: number;
  transactionMechanicsCoverage: number;
  playerIdentityCoverage: number;
  nonFutureStateTimestampRate: number;
  directlyObservedStateRate: number;
  staleStateRate: number;
}

export interface RecommendationObservabilityCohortMetricsV1
  extends RecommendationObservabilityMetricsV1 {
  cohortKey: string;
}

export interface RecommendationObservabilityGateConfigV1 {
  minDecisions: number;
  minExactSpendableSoulsCoverage: number;
  minShopOpportunityCoverage: number;
  minInventorySnapshotCoverage: number;
  minRulesetCatalogCoverage: number;
  minTransactionMechanicsCoverage: number;
  minPlayerIdentityCoverage: number;
  minNonFutureStateTimestampRate: number;
  minDirectlyObservedStateRate: number;
  maxStaleStateRate: number;
  majorCohortMinDecisions: number;
  majorCohortCoverageFloor: number;
}

export interface RecommendationObservabilityGateCheckV1 {
  name: string;
  passed: boolean;
  value: number;
  threshold: string;
}

export interface RecommendationObservabilityCohortGateV1 {
  cohortKey: string;
  decisionCount: number;
  major: boolean;
  minimumCriticalCoverage: number;
  passed: boolean;
}

export interface RecommendationObservabilityGateReportV1 {
  gateVersion: typeof RECOMMENDATION_OBSERVABILITY_GATE_VERSION;
  passed: boolean;
  evidenceSufficient: boolean;
  checks: readonly RecommendationObservabilityGateCheckV1[];
  cohortChecks: readonly RecommendationObservabilityCohortGateV1[];
  blockers: readonly string[];
}

export const DEFAULT_RECOMMENDATION_OBSERVABILITY_GATE_CONFIG_V1: RecommendationObservabilityGateConfigV1 = {
  minDecisions: 10_000,
  minExactSpendableSoulsCoverage: 0.99,
  minShopOpportunityCoverage: 0.99,
  minInventorySnapshotCoverage: 0.999,
  minRulesetCatalogCoverage: 0.99,
  minTransactionMechanicsCoverage: 0.99,
  minPlayerIdentityCoverage: 0.99,
  minNonFutureStateTimestampRate: 1,
  minDirectlyObservedStateRate: 0.99,
  maxStaleStateRate: 0.01,
  majorCohortMinDecisions: 100,
  majorCohortCoverageFloor: 0.95,
};

export function evaluateRecommendationObservabilityGateV1(
  metrics: RecommendationObservabilityMetricsV1,
  cohorts: readonly RecommendationObservabilityCohortMetricsV1[] = [],
  config: RecommendationObservabilityGateConfigV1 = DEFAULT_RECOMMENDATION_OBSERVABILITY_GATE_CONFIG_V1,
): RecommendationObservabilityGateReportV1 {
  validateMetrics(metrics, 'overall');
  for (const cohort of cohorts) validateMetrics(cohort, cohort.cohortKey);

  const checks: RecommendationObservabilityGateCheckV1[] = [
    minimumCheck('DECISION_COUNT', metrics.decisionCount, config.minDecisions),
    minimumCheck('EXACT_SPENDABLE_SOULS_COVERAGE', metrics.exactSpendableSoulsCoverage, config.minExactSpendableSoulsCoverage),
    minimumCheck('SHOP_OPPORTUNITY_COVERAGE', metrics.shopOpportunityCoverage, config.minShopOpportunityCoverage),
    minimumCheck('INVENTORY_SNAPSHOT_COVERAGE', metrics.inventorySnapshotCoverage, config.minInventorySnapshotCoverage),
    minimumCheck('RULESET_CATALOG_COVERAGE', metrics.rulesetCatalogCoverage, config.minRulesetCatalogCoverage),
    minimumCheck('TRANSACTION_MECHANICS_COVERAGE', metrics.transactionMechanicsCoverage, config.minTransactionMechanicsCoverage),
    minimumCheck('PLAYER_IDENTITY_COVERAGE', metrics.playerIdentityCoverage, config.minPlayerIdentityCoverage),
    minimumCheck('NON_FUTURE_STATE_TIMESTAMP_RATE', metrics.nonFutureStateTimestampRate, config.minNonFutureStateTimestampRate),
    minimumCheck('DIRECTLY_OBSERVED_STATE_RATE', metrics.directlyObservedStateRate, config.minDirectlyObservedStateRate),
    maximumCheck('STALE_STATE_RATE', metrics.staleStateRate, config.maxStaleStateRate),
  ];

  const cohortChecks = cohorts
    .map((cohort) => {
      const major = cohort.decisionCount >= config.majorCohortMinDecisions;
      const minimumCriticalCoverage = Math.min(
        cohort.exactSpendableSoulsCoverage,
        cohort.shopOpportunityCoverage,
        cohort.inventorySnapshotCoverage,
        cohort.rulesetCatalogCoverage,
        cohort.transactionMechanicsCoverage,
        cohort.playerIdentityCoverage,
        cohort.nonFutureStateTimestampRate,
      );
      return {
        cohortKey: cohort.cohortKey,
        decisionCount: cohort.decisionCount,
        major,
        minimumCriticalCoverage,
        passed: !major || minimumCriticalCoverage >= config.majorCohortCoverageFloor,
      };
    })
    .sort((a, b) => a.cohortKey.localeCompare(b.cohortKey));

  const blockers = [
    ...checks.filter((check) => !check.passed).map((check) => check.name),
    ...cohortChecks.filter((cohort) => !cohort.passed).map((cohort) => `MAJOR_COHORT:${cohort.cohortKey}`),
  ].sort();
  const evidenceSufficient = metrics.decisionCount >= config.minDecisions;

  return {
    gateVersion: RECOMMENDATION_OBSERVABILITY_GATE_VERSION,
    passed: evidenceSufficient && blockers.length === 0,
    evidenceSufficient,
    checks,
    cohortChecks,
    blockers,
  };
}

export function assertRecommendationObservabilityReadyV1(
  report: RecommendationObservabilityGateReportV1,
): void {
  if (!report.passed) {
    throw new Error(`Recommendation observability gate is blocked: ${report.blockers.join(',') || 'INSUFFICIENT_EVIDENCE'}`);
  }
}

function validateMetrics(metrics: RecommendationObservabilityMetricsV1, label: string): void {
  if (!Number.isInteger(metrics.decisionCount) || metrics.decisionCount < 0) {
    throw new Error(`Invalid decisionCount for ${label}`);
  }
  const rateEntries: [string, number][] = [
    ['exactSpendableSoulsCoverage', metrics.exactSpendableSoulsCoverage],
    ['shopOpportunityCoverage', metrics.shopOpportunityCoverage],
    ['inventorySnapshotCoverage', metrics.inventorySnapshotCoverage],
    ['rulesetCatalogCoverage', metrics.rulesetCatalogCoverage],
    ['transactionMechanicsCoverage', metrics.transactionMechanicsCoverage],
    ['playerIdentityCoverage', metrics.playerIdentityCoverage],
    ['nonFutureStateTimestampRate', metrics.nonFutureStateTimestampRate],
    ['directlyObservedStateRate', metrics.directlyObservedStateRate],
    ['staleStateRate', metrics.staleStateRate],
  ];
  for (const [name, value] of rateEntries) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid ${name} for ${label}`);
  }
}

function minimumCheck(name: string, value: number, threshold: number): RecommendationObservabilityGateCheckV1 {
  return { name, passed: value >= threshold, value, threshold: `>=${threshold}` };
}

function maximumCheck(name: string, value: number, threshold: number): RecommendationObservabilityGateCheckV1 {
  return { name, passed: value <= threshold, value, threshold: `<=${threshold}` };
}
