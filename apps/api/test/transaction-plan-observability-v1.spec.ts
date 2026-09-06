import { AdaptiveRecommendationObservabilityV1Service } from '../src/statlocker-adaptive/adaptive-recommendation-observability-v1.service';
import { TransactionPlanInvariantCheckV1 } from '../src/statlocker-adaptive/transaction-plan-invariants-v1';

function check(code?: TransactionPlanInvariantCheckV1['violations'][number]['code']): TransactionPlanInvariantCheckV1 {
  return code
    ? { valid: false, violations: [{ code, reasonCodes: [`TEST:${code}`] }] }
    : { valid: true, violations: [] };
}

describe('transaction plan observability v1', () => {
  it('tracks transaction zero-tolerance rates by evaluated decision', () => {
    const service = new AdaptiveRecommendationObservabilityV1Service();
    service.recordTransactionPlanInvariantCheck(check());
    service.recordTransactionPlanInvariantCheck(check('NEXT_STEP_MISMATCH'));
    const status = service.getStatus();
    expect(status.transactionPlanRelease.evaluatedDecisions).toBe(2);
    expect(status.transactionPlanRelease.nextStepMismatchRate).toBe(0.5);
    expect(status.transactionPlanRelease.futureTargetWithoutStepRate).toBe(0);
  });

  it('records transaction invariant reason codes', () => {
    const service = new AdaptiveRecommendationObservabilityV1Service();
    service.recordTransactionPlanInvariantCheck(check('UNKNOWN_SLOT_PATH'));
    const status = service.getStatus();
    expect(status.reasonCodeCounts['TRANSACTION_PLAN_INVARIANT:UNKNOWN_SLOT_PATH']).toBe(1);
  });
});
