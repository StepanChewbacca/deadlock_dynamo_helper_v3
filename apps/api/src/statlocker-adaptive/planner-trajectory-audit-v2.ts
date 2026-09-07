import { PlannerTrajectoryV2 } from './planner-trajectory-v2';

export type PlannerTrajectoryRejectionReasonV2 =
  | 'UNKNOWN_TRANSACTION'
  | 'TRANSACTION_NOT_EXECUTABLE'
  | 'INVENTORY_DRIFT'
  | 'UNKNOWN_PATCH_IDENTITY'
  | 'RULESET_SCOPE_MISMATCH'
  | 'OTHER';

export interface PlannerTrajectoryRejectionV2 {
  reason: PlannerTrajectoryRejectionReasonV2;
  rulesetId?: string;
  catalogSha256?: string;
}

export interface PlannerTrajectoryRulesetCoverageV2 {
  rulesetId: string;
  catalogSha256: string;
  acceptedCount: number;
}

export interface PlannerTrajectoryAuditV2 {
  trajectoryCount: number;
  acceptedTrajectoryCount: number;
  rejectedTrajectoryCount: number;
  replayCoverage: number;
  unknownTransactionRate: number;
  inventoryDriftCount: number;
  unknownPatchIdentityCount: number;
  rulesetCoverage: readonly PlannerTrajectoryRulesetCoverageV2[];
  releaseEligible: boolean;
}

export function auditPlannerTrajectoriesV2(
  accepted: readonly PlannerTrajectoryV2[],
  rejected: readonly PlannerTrajectoryRejectionV2[] = [],
): PlannerTrajectoryAuditV2 {
  const trajectoryCount = accepted.length + rejected.length;
  const unknownTransactionCount = rejected.filter((entry) =>
    entry.reason === 'UNKNOWN_TRANSACTION' || entry.reason === 'TRANSACTION_NOT_EXECUTABLE',
  ).length;

  let inventoryDriftCount = 0;
  let unknownPatchIdentityCount = 0;
  const coverage = new Map<string, PlannerTrajectoryRulesetCoverageV2>();

  for (const trajectory of accepted) {
    if (!hasExactPatchIdentity(trajectory)) unknownPatchIdentityCount += 1;
    inventoryDriftCount += countTrajectoryInventoryDrift(trajectory);

    if (hasExactPatchIdentity(trajectory)) {
      const key = `${trajectory.rulesetId}|${trajectory.catalogSha256.toLowerCase()}`;
      const current = coverage.get(key);
      coverage.set(key, {
        rulesetId: trajectory.rulesetId,
        catalogSha256: trajectory.catalogSha256.toLowerCase(),
        acceptedCount: (current?.acceptedCount ?? 0) + 1,
      });
    }
  }

  const rulesetCoverage = [...coverage.values()].sort((left, right) =>
    left.rulesetId.localeCompare(right.rulesetId) ||
    left.catalogSha256.localeCompare(right.catalogSha256),
  );

  return {
    trajectoryCount,
    acceptedTrajectoryCount: accepted.length,
    rejectedTrajectoryCount: rejected.length,
    replayCoverage: trajectoryCount === 0 ? 0 : accepted.length / trajectoryCount,
    unknownTransactionRate: trajectoryCount === 0 ? 0 : unknownTransactionCount / trajectoryCount,
    inventoryDriftCount,
    unknownPatchIdentityCount,
    rulesetCoverage,
    releaseEligible: inventoryDriftCount === 0 && unknownPatchIdentityCount === 0,
  };
}

function hasExactPatchIdentity(trajectory: PlannerTrajectoryV2): boolean {
  return Boolean(
    trajectory.rulesetId.trim() &&
    /^[a-f0-9]{64}$/i.test(trajectory.catalogSha256) &&
    trajectory.steps.every((step) =>
      step.rulesetId === trajectory.rulesetId &&
      step.catalogSha256.toLowerCase() === trajectory.catalogSha256.toLowerCase(),
    ),
  );
}

function countTrajectoryInventoryDrift(trajectory: PlannerTrajectoryV2): number {
  let drift = 0;
  let expectedOwnedItemIds = normalizeItemIds(trajectory.initialOwnedItemIds);

  for (const step of [...trajectory.steps].sort((left, right) => left.index - right.index)) {
    if (!sameItemIds(step.beforeOwnedItemIds, expectedOwnedItemIds)) drift += 1;
    if (!step.beforeInventoryFingerprint || !step.afterInventoryFingerprint) drift += 1;
    if (!step.beforeStateFingerprint || !step.afterStateFingerprint) drift += 1;
    expectedOwnedItemIds = normalizeItemIds(step.afterOwnedItemIds);
  }

  if (!sameItemIds(trajectory.terminalOwnedItemIds, expectedOwnedItemIds)) drift += 1;
  return drift;
}

function sameItemIds(left: readonly number[], right: readonly number[]): boolean {
  const a = normalizeItemIds(left);
  const b = normalizeItemIds(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeItemIds(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
