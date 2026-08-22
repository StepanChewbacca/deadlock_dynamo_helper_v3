import { createHash } from 'crypto';
import {
  RECOMMENDATION_DIRECT_SHOP_CANDIDATE_ANALYSIS_VERSION_V1,
  RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1,
  RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1,
} from '@deadlock-live-probe/shared';
import { RecommendationEvidenceMaterializerV8Service } from '../src/deadlock-live/recommendation-evidence-materializer-v8.service';

describe('RecommendationEvidenceMaterializerV8Service', () => {
  const generatedAt = '2026-08-22T00:00:00.000Z';
  const directShopSourceField = 'onInfoUpdates2|match_info|match_info|shop_state';

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

  function directShopCandidateAnalysis(overrides: Record<string, unknown> = {}) {
    return {
      version: RECOMMENDATION_DIRECT_SHOP_CANDIDATE_ANALYSIS_VERSION_V1,
      candidateOnly: true,
      canPromoteToDirectSource: false,
      markerCount: 8,
      availableMarkerCount: 4,
      unavailableMarkerCount: 4,
      blockers: [],
      candidates: [{
        provenanceSourceField: directShopSourceField,
        markerHitCount: 8,
        availableMarkerHitCount: 4,
        unavailableMarkerHitCount: 4,
        lowCardinality: true,
        observedPayloadsSeparatedByMarkerState: true,
      }],
      ...overrides,
    };
  }

  function directShopAttestation(overrides: Record<string, unknown> = {}) {
    const candidateAnalysis = directShopCandidateAnalysis();
    return {
      contractVersion: RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_V1,
      telemetrySource: 'OVERWOLF_GEP',
      provenanceSourceField: directShopSourceField,
      candidateAnalysisSha256: sha256Canonical(candidateAnalysis),
      candidateAnalysis,
      independentlyValidatedAvailableTransitions: 2,
      independentlyValidatedUnavailableTransitions: 2,
      independentTransitionMismatchCount: 0,
      independentValidationEvidenceSha256: 'b'.repeat(64),
      validator: 'independent-live-transition-review-v1',
      validatedAt: '2026-08-21T23:55:00.000Z',
      evidenceRef: 'immutable://deadlock/direct-shop-validation/evidence-1',
      ...overrides,
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
      candidateGeneratorVersion: ' candidate-v8.4 ',
    });

    expect(report.gates.every((gate) => gate.status === 'PASS')).toBe(true);
    expect(report.from).toBe('2026-08-01T00:00:00.000Z');
    expect(report.to).toBe('2026-08-22T00:00:00.000Z');
    expect(report.candidateGeneratorVersion).toBe('candidate-v8.4');
    expect(harness.observabilityService.buildReport).toHaveBeenCalledWith({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-22T00:00:00.000Z'),
      maximumAlignmentAgeMs: 5_000,
      candidateGeneratorVersion: 'candidate-v8.4',
    });
    expect(harness.datasetService.buildReport).toHaveBeenCalledWith({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-22T00:00:00.000Z'),
      candidateGeneratorVersion: 'candidate-v8.4',
    });
    const firstRecord = [...harness.evidenceRecords.values()][0];
    expect(firstRecord.subjectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(firstRecord.evidenceRef).toContain(firstRecord.subjectSha256);
    expect(firstRecord.evaluator).toBe('recommendation-evidence-materializer-v8');
  });

  it('materializes direct shop PASS only from a complete independent-validation attestation', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(generatedAt));
    const harness = createHarness({
      souls: souls('PASS'),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    const report = await harness.service.materializeDirectShopSource(directShopAttestation() as never);

    expect(report.validation.status).toBe('PASS');
    expect(report.validation.canActivateDirectShopSource).toBe(true);
    expect(report.gate.gateName).toBe('directShopSourceValidation');
    expect(report.gate.status).toBe('PASS');
    const record = [...harness.evidenceRecords.values()].find((value) => value.gateName === 'directShopSourceValidation');
    expect(record.evaluator).toBe(RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1);
    expect(record.subjectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(harness.snapshots.get(record.subjectSha256)?.report?.approvalKey)
      .toBe(`OVERWOLF_GEP:${directShopSourceField}`);
  });

  it('cannot promote candidate-only direct shop evidence without independent state transitions', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(generatedAt));
    const harness = createHarness({
      souls: souls('PASS'),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    const report = await harness.service.materializeDirectShopSource(directShopAttestation({
      independentlyValidatedAvailableTransitions: 0,
      independentlyValidatedUnavailableTransitions: 0,
    }) as never);

    expect(report.validation.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(report.validation.canActivateDirectShopSource).toBe(false);
    expect(report.gate.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('materializes direct shop FAIL when an independent transition mismatch is observed', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(generatedAt));
    const harness = createHarness({
      souls: souls('PASS'),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    const report = await harness.service.materializeDirectShopSource(directShopAttestation({
      independentTransitionMismatchCount: 1,
    }) as never);

    expect(report.validation.status).toBe('FAIL');
    expect(report.validation.blockers).toContain('INDEPENDENT_TRANSITION_MISMATCH_OBSERVED');
    expect(report.gate.status).toBe('FAIL');
  });

  it('rejects a direct shop attestation whose candidate analysis hash does not match the embedded report', async () => {
    const harness = createHarness({
      souls: souls('PASS'),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    await expect(harness.service.materializeDirectShopSource(directShopAttestation({
      candidateAnalysisSha256: 'f'.repeat(64),
    }) as never)).rejects.toThrow('DIRECT_SHOP_CANDIDATE_ANALYSIS_SHA256_MISMATCH');
    expect(harness.snapshotRepo.save).not.toHaveBeenCalled();
    expect(harness.roadmapEvidence.append).not.toHaveBeenCalled();
  });

  it('materializes direct shop FAIL if the independent validation evidence hash is missing', async () => {
    const harness = createHarness({
      souls: souls('PASS'),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    const report = await harness.service.materializeDirectShopSource(directShopAttestation({
      independentValidationEvidenceSha256: '',
    }) as never);

    expect(report.validation.status).toBe('FAIL');
    expect(report.validation.blockers).toContain('INDEPENDENT_VALIDATION_EVIDENCE_SHA256_INVALID');
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

  it('rejects an empty candidate generator scope', async () => {
    const harness = createHarness({
      souls: souls('PASS'),
      observability: observability(true, true),
      dataset: dataset(10_000, 10_000, true, true),
    });

    await expect(harness.service.materializeFoundational({ candidateGeneratorVersion: '   ' }))
      .rejects.toThrow('candidateGeneratorVersion must be non-empty when provided');
    expect(harness.observabilityService.buildReport).not.toHaveBeenCalled();
    expect(harness.datasetService.buildReport).not.toHaveBeenCalled();
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

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
