import { RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1 } from '@deadlock-live-probe/shared';
import { loadRecommendationDirectShopValidationBindingV8 } from '../src/deadlock-live/recommendation-direct-shop-validation-binding-v8';
import {
  TEST_DIRECT_SHOP_SUBJECT_SHA256,
  createDirectShopValidationSnapshotV8,
} from './fixtures/recommendation-direct-shop-validation-v8';

function roadmap(subjectSha256 = TEST_DIRECT_SHOP_SUBJECT_SHA256) {
  return {
    evidence: { directShopSourceValidation: 'PASS' },
    latestEvidenceByGate: {
      directShopSourceValidation: {
        subjectSha256,
        evaluator: RECOMMENDATION_DIRECT_SHOP_SOURCE_VALIDATION_EVALUATOR_V1,
      },
    },
  };
}

describe('direct shop validation binding', () => {
  it('accepts only the exact content-addressed immutable PASS snapshot', async () => {
    const snapshot = createDirectShopValidationSnapshotV8();
    const report = await loadRecommendationDirectShopValidationBindingV8(
      roadmap() as never,
      { getSnapshot: jest.fn(async () => snapshot) } as never,
    );

    expect(report.valid).toBe(true);
    expect(report.subjectSha256).toBe(TEST_DIRECT_SHOP_SUBJECT_SHA256);
    expect(report.blockers).toEqual([]);
  });

  it('rejects a snapshot whose report bytes no longer match the evidence subject SHA', async () => {
    const snapshot = createDirectShopValidationSnapshotV8();
    const tampered = {
      ...snapshot,
      report: { ...snapshot.report, approvalKey: `${snapshot.report.approvalKey}_tampered` },
    };
    const report = await loadRecommendationDirectShopValidationBindingV8(
      roadmap() as never,
      { getSnapshot: jest.fn(async () => tampered) } as never,
    );

    expect(report.valid).toBe(false);
    expect(report.blockers).toContain('DIRECT_SHOP_SOURCE_VALIDATION_SNAPSHOT_CONTENT_SHA_MISMATCH');
  });

  it('rejects a snapshot timestamp that is not bound to the generated report', async () => {
    const snapshot = createDirectShopValidationSnapshotV8();
    const report = await loadRecommendationDirectShopValidationBindingV8(
      roadmap() as never,
      {
        getSnapshot: jest.fn(async () => ({
          ...snapshot,
          evaluatedAt: new Date('2026-08-22T01:00:00.000Z'),
        })),
      } as never,
    );

    expect(report.valid).toBe(false);
    expect(report.blockers).toContain('DIRECT_SHOP_SOURCE_VALIDATION_SNAPSHOT_TIMESTAMP_MISMATCH');
  });

  it('rejects candidate analysis tampering even when the outer report shape still looks valid', async () => {
    const snapshot = createDirectShopValidationSnapshotV8();
    const reportPayload = snapshot.report;
    const tampered = {
      ...snapshot,
      report: {
        ...reportPayload,
        attestation: {
          ...reportPayload.attestation,
          candidateAnalysis: {
            ...reportPayload.attestation.candidateAnalysis,
            markerCount: 999,
          },
        },
      },
    };
    const report = await loadRecommendationDirectShopValidationBindingV8(
      roadmap() as never,
      { getSnapshot: jest.fn(async () => tampered) } as never,
    );

    expect(report.valid).toBe(false);
    expect(report.blockers).toContain('DIRECT_SHOP_SOURCE_VALIDATION_CANDIDATE_ANALYSIS_SHA_MISMATCH');
  });
});
