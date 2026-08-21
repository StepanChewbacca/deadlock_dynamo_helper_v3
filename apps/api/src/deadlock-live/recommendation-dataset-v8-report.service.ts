import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface RecommendationDatasetV8ReportOptions {
  from?: Date;
  to?: Date;
}

export interface RecommendationDatasetV8Report {
  generatedAt: string;
  from?: string;
  to?: string;
  decisionCount: number;
  labeledDecisionCount: number;
  observedActionCandidateCoverage: number;
  observedActionFeasibleCoverage: number;
  observedActionInjectionRate: number;
  transactionMechanicsCoverage: number;
  rulesetEvidenceCoverage: number;
  inventoryEvidenceCoverage: number;
  averageCandidateCount: number;
  p95CandidateCount: number;
  passedStructuralGate: boolean;
  passedEmpiricalGate: boolean;
  blockers: readonly string[];
}

interface DatasetAggregateRow {
  decisionCount: string | number;
  labeledDecisionCount: string | number;
  observedActionCandidateCount: string | number;
  observedActionFeasibleCount: string | number;
  observedActionInjectedCount: string | number;
  feasibleTransactionalCandidateCount: string | number;
  transactionMechanicsKnownCount: string | number;
  rulesetEvidenceKnownCount: string | number;
  inventoryEvidenceKnownCount: string | number;
  averageCandidateCount?: string | number;
  p95CandidateCount?: string | number;
}

@Injectable()
export class RecommendationDatasetV8ReportService {
  constructor(private readonly dataSource: DataSource) {}

  async buildReport(
    options: RecommendationDatasetV8ReportOptions = {},
  ): Promise<RecommendationDatasetV8Report> {
    validateRange(options.from, options.to);
    const rows = await this.dataSource.query(
      datasetReportSql(),
      [options.from?.toISOString() ?? null, options.to?.toISOString() ?? null],
    ) as DatasetAggregateRow[];
    const row = rows[0] ?? emptyRow();
    const decisionCount = number(row.decisionCount);
    const labeledDecisionCount = number(row.labeledDecisionCount);
    const feasibleTransactionalCandidateCount = number(row.feasibleTransactionalCandidateCount);
    const observedActionCandidateCoverage = ratio(number(row.observedActionCandidateCount), labeledDecisionCount);
    const observedActionFeasibleCoverage = ratio(number(row.observedActionFeasibleCount), labeledDecisionCount);
    const observedActionInjectionRate = ratio(number(row.observedActionInjectedCount), decisionCount);
    const transactionMechanicsCoverage = ratio(number(row.transactionMechanicsKnownCount), feasibleTransactionalCandidateCount);
    const rulesetEvidenceCoverage = ratio(number(row.rulesetEvidenceKnownCount), feasibleTransactionalCandidateCount);
    const inventoryEvidenceCoverage = ratio(number(row.inventoryEvidenceKnownCount), feasibleTransactionalCandidateCount);

    const structuralBlockers: string[] = [];
    if (observedActionInjectionRate !== 0) structuralBlockers.push('OBSERVED_ACTION_INJECTION_DETECTED');
    if (decisionCount > 0 && number(row.p95CandidateCount ?? 0) <= 0) structuralBlockers.push('CANDIDATE_SET_EMPTY');
    const empiricalBlockers: string[] = [];
    if (decisionCount < 10_000) empiricalBlockers.push('DECISION_COUNT_BELOW_10000');
    if (labeledDecisionCount === 0) empiricalBlockers.push('NO_OBSERVED_ACTION_LABELS');
    if (observedActionFeasibleCoverage < 0.99) empiricalBlockers.push('OBSERVED_ACTION_FEASIBLE_COVERAGE_BELOW_0_99');
    if (transactionMechanicsCoverage < 0.99) empiricalBlockers.push('TRANSACTION_MECHANICS_COVERAGE_BELOW_0_99');
    if (rulesetEvidenceCoverage < 0.99) empiricalBlockers.push('RULESET_EVIDENCE_COVERAGE_BELOW_0_99');
    if (inventoryEvidenceCoverage < 0.999) empiricalBlockers.push('INVENTORY_EVIDENCE_COVERAGE_BELOW_0_999');

    const blockers = [...new Set([...structuralBlockers, ...empiricalBlockers])].sort();
    return {
      generatedAt: new Date().toISOString(),
      from: options.from?.toISOString(),
      to: options.to?.toISOString(),
      decisionCount,
      labeledDecisionCount,
      observedActionCandidateCoverage,
      observedActionFeasibleCoverage,
      observedActionInjectionRate,
      transactionMechanicsCoverage,
      rulesetEvidenceCoverage,
      inventoryEvidenceCoverage,
      averageCandidateCount: number(row.averageCandidateCount ?? 0),
      p95CandidateCount: number(row.p95CandidateCount ?? 0),
      passedStructuralGate: structuralBlockers.length === 0,
      passedEmpiricalGate: structuralBlockers.length === 0 && empiricalBlockers.length === 0,
      blockers,
    };
  }
}

function datasetReportSql(): string {
  return `
WITH decisions AS (
  SELECT d.*
  FROM recommendation_decisions_v8 d
  WHERE ($1::timestamptz IS NULL OR d."decidedAt" >= $1::timestamptz)
    AND ($2::timestamptz IS NULL OR d."decidedAt" < $2::timestamptz)
), outcomes AS (
  SELECT DISTINCT ON (e."payload"->>'decisionId')
    e."payload"->>'decisionId' AS decision_id,
    NULLIF(e."payload"->>'observedActionKey', '') AS observed_action_key
  FROM recommendation_telemetry_events e
  WHERE e."eventType" = 'RECOMMENDATION_OUTCOME'
    AND COALESCE(e."payload"->>'decisionId', '') <> ''
  ORDER BY e."payload"->>'decisionId', e."sourceOccurredAt" DESC, e."receivedAt" DESC
), candidate_counts AS (
  SELECT c."decisionId", COUNT(*) AS candidate_count
  FROM recommendation_decision_candidates_v8 c
  GROUP BY c."decisionId"
), candidate_quality AS (
  SELECT
    COUNT(*) FILTER (WHERE c."feasible" IS TRUE AND c."actionType" <> 'WAIT_SAVE') AS feasible_transactional_candidate_count,
    COUNT(*) FILTER (
      WHERE c."feasible" IS TRUE
        AND c."actionType" <> 'WAIT_SAVE'
        AND c."transactionMechanicsKnown" IS TRUE
        AND COALESCE(c."evidence"->>'transaction', 'UNKNOWN') <> 'UNKNOWN'
    ) AS transaction_mechanics_known_count,
    COUNT(*) FILTER (
      WHERE c."feasible" IS TRUE
        AND c."actionType" <> 'WAIT_SAVE'
        AND COALESCE(c."evidence"->>'ruleset', 'UNKNOWN') <> 'UNKNOWN'
    ) AS ruleset_evidence_known_count,
    COUNT(*) FILTER (
      WHERE c."feasible" IS TRUE
        AND c."actionType" <> 'WAIT_SAVE'
        AND COALESCE(c."evidence"->>'inventory', 'UNKNOWN') <> 'UNKNOWN'
    ) AS inventory_evidence_known_count
  FROM recommendation_decision_candidates_v8 c
  JOIN decisions d ON d."decisionId" = c."decisionId"
)
SELECT
  COUNT(*) AS "decisionCount",
  COUNT(*) FILTER (WHERE o.observed_action_key IS NOT NULL) AS "labeledDecisionCount",
  COUNT(*) FILTER (
    WHERE o.observed_action_key IS NOT NULL
      AND observed_candidate.id IS NOT NULL
  ) AS "observedActionCandidateCount",
  COUNT(*) FILTER (
    WHERE o.observed_action_key IS NOT NULL
      AND observed_candidate."feasible" IS TRUE
  ) AS "observedActionFeasibleCount",
  COUNT(*) FILTER (WHERE d."observedActionInjected" IS TRUE) AS "observedActionInjectedCount",
  COALESCE((SELECT feasible_transactional_candidate_count FROM candidate_quality), 0) AS "feasibleTransactionalCandidateCount",
  COALESCE((SELECT transaction_mechanics_known_count FROM candidate_quality), 0) AS "transactionMechanicsKnownCount",
  COALESCE((SELECT ruleset_evidence_known_count FROM candidate_quality), 0) AS "rulesetEvidenceKnownCount",
  COALESCE((SELECT inventory_evidence_known_count FROM candidate_quality), 0) AS "inventoryEvidenceKnownCount",
  COALESCE(AVG(cc.candidate_count), 0) AS "averageCandidateCount",
  COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY cc.candidate_count), 0) AS "p95CandidateCount"
FROM decisions d
LEFT JOIN outcomes o ON o.decision_id = d."decisionId"
LEFT JOIN recommendation_decision_candidates_v8 observed_candidate
  ON observed_candidate."decisionId" = d."decisionId"
 AND observed_candidate."actionKey" = o.observed_action_key
LEFT JOIN candidate_counts cc ON cc."decisionId" = d."decisionId";
`;
}

function validateRange(from: Date | undefined, to: Date | undefined): void {
  if (from && !Number.isFinite(from.getTime())) throw new Error('from is invalid');
  if (to && !Number.isFinite(to.getTime())) throw new Error('to is invalid');
  if (from && to && from >= to) throw new Error('from must be before to');
}

function emptyRow(): DatasetAggregateRow {
  return {
    decisionCount: 0,
    labeledDecisionCount: 0,
    observedActionCandidateCount: 0,
    observedActionFeasibleCount: 0,
    observedActionInjectedCount: 0,
    feasibleTransactionalCandidateCount: 0,
    transactionMechanicsKnownCount: 0,
    rulesetEvidenceKnownCount: 0,
    inventoryEvidenceKnownCount: 0,
    averageCandidateCount: 0,
    p95CandidateCount: 0,
  };
}

function number(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
