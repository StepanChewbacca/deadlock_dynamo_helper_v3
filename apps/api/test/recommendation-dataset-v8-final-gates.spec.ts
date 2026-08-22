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

  it('scopes the report to one candidate generator and excludes outcomes arriving after the cutoff', async () => {
    const calls: Array<[string, unknown[]]> = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      return [];
    });
    const service = new RecommendationDatasetV8ReportService({ query } as never);
    const to = new Date('2026-08-20T12:00:00.000Z');

    const report = await service.buildReport({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to,
      candidateGeneratorVersion: '  candidate-v8.4  ',
    });

    expect(report.candidateGeneratorVersion).toBe('candidate-v8.4');
    const [sql, params] = calls[0]!;
    expect(params[1]).toBe(to.toISOString());
    expect(params[2]).toBe('candidate-v8.4');
    expect(sql).toContain('d.\"candidateGeneratorVersion\" = $3::text');
    expect(sql).toContain('e.\"sourceOccurredAt\" < $2::timestamptz');
    expect(sql).toContain('e.\"receivedAt\" < $2::timestamptz');
  });

  it('rejects an empty candidate generator scope instead of silently mixing versions', async () => {
    const service = new RecommendationDatasetV8ReportService({ query: jest.fn() } as never);

    await expect(service.buildReport({ candidateGeneratorVersion: '   ' }))
      .rejects.toThrow('candidateGeneratorVersion must be non-empty when provided');
  });
});
