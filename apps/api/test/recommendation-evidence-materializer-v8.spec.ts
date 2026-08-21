import { RecommendationEvidenceMaterializerV8Service } from '../src/deadlock-live/recommendation-evidence-materializer-v8.service';

describe('RecommendationEvidenceMaterializerV8Service', () => {
  const generatedAt = '2026-08-22T00:00:00.000Z';

  function createHarness(input: {
    souls: unknown;
    observability: unknown;
    dataset: unknown;
  }) {
    const snapshots = new Map<string, any>();
    const evidenceRecords = new Map<string, any>();
    const snapshotRepo = {
      findOne: jest.fn(async ({ where }: any) => snapshots.get(where.subjectSha256)),
      create: jest.fn((value: any) => value),
      save: jest.fn(async (value: any) => {
        snapshots.set(value.subjectSha256, value);
        return value;
      }),
    };
    const soulsEvidence = { report: jest.fn(async () => input.souls) };
    const observabilityService = { buildReport: jest.fn(async () => input.observability) };
    const datasetService = { buildReport: jest.fn(async () => input.dataset) };
    const roadmapEvidence = {
      append: jest.fn(async (record: any) => {
        const existing = evidenceRecords.get(record.evidenceId);
        if (existing) {
          expect(existing).toEqual(record);
          return { status: 'DUPLICATE' as const, evidenceId: record.evidenceId };
        }
        evidenceRecords.set(record.evidenceId, record);
        return { status: 'APPENDED' as const, evidenceId: record.evidenceId };
      }),
    };
    const service = new RecommendationEvidenceMaterializerV8Service(
      snapshotRepo as never,
      soulsEvidence as never,
      observabilityService as never,
      datasetService as never,
      roadmapEvidence as never,
    );
    return {
      service,
      snapshotRepo,
      soulsEvidence,
      observabilityService,
      datasetService,
      roadmapEvidence,
      snapshots,
      evidenceRecords,
    };
  }

  function souls(verdict: 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE', invalidObservationIds: string[] = []) {
    return {
      invalidObservationIds,
      affordability: {
        verdict,
        gateFailures: verdict === 'PASS' ? [] : ['MIN_OBSERVATION_COUNT_NOT_MET'],
      },
    };
  }

  function observability(evidenceSufficient: boolean, passed: boolean) {
    return {
      generatedAt,
      gate: {
        evidenceSufficient,
        passed,
        blockers: passed ? [] : ['DECISION_COUNT'],
      },
    };
  }

  function dataset(decisionCount: number, labeledDecisionCount: number, passedStructuralGate: boolean, passedEmpiricalGate: boolean) {
    return {
      generatedAt,
      decisionCount,
      labeledDecisionCount,
      passedStructuralGate,
      passedEmpiricalGate,
      blockers: passedEmpiricalGate ? [] : ['DECISION_COUNT_BELOW_10000'],
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records insufficient evidence instead of fabricating PASS when prospective data is absent', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(generatedAt));
    const harness = createHarness({
      souls: souls('INSUFFICIENT_EVIDENCE'),
      observability: observability(false, false),
      dataset: dataset(0, 0, true, false),
    });

    const report = await harness.service.materializeFoundational();

    expect(report.gates.map((gate) => [gate.gateName, gate.status])).toEqual([
      ['controlledSoulsValidation', 'INSUFFICIENT_EVIDENCE'],
      ['observabilityCoverage', 'INSUFFICIENT_EVIDENCE'],
      ['datasetV8Structural', 'INSUFFICIENT_EVIDENCE'],
      ['datasetV8Empirical', 'INSUFFICIENT_EVIDENCE'],
    ]);
    expect(harness.snapshotRepo.save).toHaveBeenCalledTimes(4);
    expect(harness.roadmapEvidence.append).toHaveBeenCalledTimes(4);
  });

  it('materializes PASS only when the underlying reports pass their real gates', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(generatedAt));
    const harness = createHarness({
      souls: souls('PASS'),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    const report = await harness.service.materializeFoundational({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-22T00:00:00.000Z'),
      maximumAlignmentAgeMs: 5_000,
    });

    expect(report.gates.every((gate) => gate.status === 'PASS')).toBe(true);
    expect(report.from).toBe('2026-08-01T00:00:00.000Z');
    expect(report.to).toBe('2026-08-22T00:00:00.000Z');
    expect(harness.observabilityService.buildReport).toHaveBeenCalledWith({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-22T00:00:00.000Z'),
      maximumAlignmentAgeMs: 5_000,
    });
    const firstRecord = [...harness.evidenceRecords.values()][0];
    expect(firstRecord.subjectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(firstRecord.evidenceRef).toContain(firstRecord.subjectSha256);
    expect(firstRecord.evaluator).toBe('recommendation-evidence-materializer-v8');
  });

  it('treats invalid controlled souls observations as a failed gate', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(generatedAt));
    const harness = createHarness({
      souls: souls('PASS', ['bad-observation']),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    const report = await harness.service.materializeFoundational();

    expect(report.gates.find((gate) => gate.gateName === 'controlledSoulsValidation')?.status).toBe('FAIL');
  });

  it('is idempotent for an identical immutable report snapshot and exposes the stored snapshot', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(generatedAt));
    const harness = createHarness({
      souls: souls('PASS'),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    const first = await harness.service.materializeFoundational();
    const second = await harness.service.materializeFoundational();

    expect(second.gates.every((gate) => gate.snapshotStatus === 'DUPLICATE')).toBe(true);
    expect(second.gates.every((gate) => gate.evidenceStatus === 'DUPLICATE')).toBe(true);
    const subjectSha256 = first.gates[0].subjectSha256;
    const snapshot = await harness.service.getSnapshot(subjectSha256);
    expect(snapshot.subjectSha256).toBe(subjectSha256);
    expect(snapshot.gateName).toBe('controlledSoulsValidation');
  });

  it('rejects invalid snapshot hashes', async () => {
    const harness = createHarness({
      souls: souls('PASS'),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    await expect(harness.service.getSnapshot('not-a-sha')).rejects.toThrow('subjectSha256 is invalid');
  });
});
