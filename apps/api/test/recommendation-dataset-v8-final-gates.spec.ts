import { RecommendationDatasetV8ReportService } from '../src/deadlock-live/recommendation-dataset-v8-report.service';

describe('RecommendationDatasetV8ReportService final pretraining gates', () => {
  it('passes source-backed feasibility, ruleset, and major action-phase coverage thresholds', async () => {
    let capturedSql = '';
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        capturedSql = sql;
        return [{
          decisionCount: 12_000,
          labeledDecisionCount: 12_000,
          observedActionCandidateCount: 12_000,
          observedActionFeasibleCount: 11_900,
          observedActionInjectedCount: 0,
          candidateCount: 60_000,
          explicitFeasibilityKnownCount: 59_800,
          feasibleTransactionalCandidateCount: 40_000,
          transactionMechanicsKnownCount: 39_900,
          rulesetEvidenceKnownCount: 39_970,
          inventoryEvidenceKnownCount: 39_970,
          majorActionPhaseCohortCount: 4,
          minimumMajorActionPhaseCohortObservedActionFeasibleCoverage: 0.985,
          averageCandidateCount: 5,
          p95CandidateCount: 8,
        }];
      }),
    };
    const service = new RecommendationDatasetV8ReportService(dataSource as never);

    const report = await service.buildReport();

    expect(report.passedStructuralGate).toBe(true);
    expect(report.passedEmpiricalGate).toBe(true);
    expect(report.explicitFeasibilityCoverage).toBeGreaterThanOrEqual(0.995);
    expect(report.minimumMajorActionPhaseCohortObservedActionFeasibleCoverage).toBeGreaterThanOrEqual(0.98);
    expect(report.rulesetEvidenceCoverage).toBeGreaterThanOrEqual(0.999);
    expect(capturedSql).toContain('explicit_feasibility_known_count');
    expect(capturedSql).toContain('major_action_phase_cohorts');
    expect(capturedSql).toContain("c.\"actionType\" = 'WAIT_SAVE'");
  });

  it('fails when a source-backed final pretraining threshold is below gate', async () => {
    const dataSource = {
      query: jest.fn(async () => [{
        decisionCount: 12_000,
        labeledDecisionCount: 12_000,
        observedActionCandidateCount: 12_000,
        observedActionFeasibleCount: 11_900,
        observedActionInjectedCount: 0,
        candidateCount: 60_000,
        explicitFeasibilityKnownCount: 59_600,
        feasibleTransactionalCandidateCount: 40_000,
        transactionMechanicsKnownCount: 39_900,
        rulesetEvidenceKnownCount: 39_950,
        inventoryEvidenceKnownCount: 39_970,
        majorActionPhaseCohortCount: 3,
        minimumMajorActionPhaseCohortObservedActionFeasibleCoverage: 0.979,
        averageCandidateCount: 5,
        p95CandidateCount: 8,
      }]),
    };
    const service = new RecommendationDatasetV8ReportService(dataSource as never);

    const report = await service.buildReport();

    expect(report.passedEmpiricalGate).toBe(false);
    expect(report.blockers).toContain('EXPLICIT_FEASIBILITY_COVERAGE_BELOW_0_995');
    expect(report.blockers).toContain('MAJOR_ACTION_PHASE_COHORT_FEASIBLE_COVERAGE_BELOW_0_98');
    expect(report.blockers).toContain('RULESET_EVIDENCE_COVERAGE_BELOW_0_999');
  });
});
