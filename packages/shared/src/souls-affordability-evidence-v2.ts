import {
  SOULS_AFFORDABILITY_CONTRACT_VERSION,
  SoulsAffordabilityActionType,
  SoulsAffordabilityObservation,
  SoulsAffordabilityReport,
  evaluateSoulsAffordability,
} from './souls-affordability-contract';

export const SOULS_AFFORDABILITY_EVIDENCE_V2 = 'souls-affordability-evidence-v2' as const;

export interface SoulsAffordabilityControlledObservationV2 {
  evidenceVersion: typeof SOULS_AFFORDABILITY_EVIDENCE_V2;
  observationId: string;
  sessionId: string;
  matchId?: string;
  actionType: SoulsAffordabilityActionType;
  itemId: number;
  clientVersion: string;
  gepVersion: string;
  normalizerVersion: string;
  rulesetVersion: string;
  catalogSha256: string;
  sourceOccurredAtMs: number;
  capturedAtMs: number;
  shopOpportunityObserved: 'AVAILABLE' | 'UNAVAILABLE';
  soulsRawBefore: number;
  soulsRawAfter: number;
  effectiveCost: number;
  actionSucceeded: boolean;
  hudSoulsBefore?: number;
  hudSoulsAfter?: number;
  inventoryConfirmedBefore: boolean;
  inventoryConfirmedAfter: boolean;
  notes?: string;
}

export interface SoulsAffordabilityEvidenceV2Report {
  evidenceVersion: typeof SOULS_AFFORDABILITY_EVIDENCE_V2;
  contractVersion: typeof SOULS_AFFORDABILITY_CONTRACT_VERSION;
  sessionCount: number;
  rulesetCount: number;
  catalogCount: number;
  invalidObservationIds: readonly string[];
  affordability: SoulsAffordabilityReport;
  canMarkSpendableSoulsVerified: boolean;
}

export function evaluateSoulsAffordabilityEvidenceV2(
  observations: readonly SoulsAffordabilityControlledObservationV2[],
): SoulsAffordabilityEvidenceV2Report {
  const invalidObservationIds = observations
    .filter((observation) => validateControlledSoulsObservationV2(observation).length > 0)
    .map((observation) => observation.observationId)
    .sort();
  const validObservations = observations.filter((observation) => !invalidObservationIds.includes(observation.observationId));
  const affordability = evaluateSoulsAffordability(validObservations.map(toV1Observation));
  return {
    evidenceVersion: SOULS_AFFORDABILITY_EVIDENCE_V2,
    contractVersion: SOULS_AFFORDABILITY_CONTRACT_VERSION,
    sessionCount: new Set(validObservations.map((observation) => observation.sessionId)).size,
    rulesetCount: new Set(validObservations.map((observation) => observation.rulesetVersion)).size,
    catalogCount: new Set(validObservations.map((observation) => observation.catalogSha256)).size,
    invalidObservationIds,
    affordability,
    canMarkSpendableSoulsVerified: invalidObservationIds.length === 0 && affordability.verdict === 'PASS',
  };
}

export function validateControlledSoulsObservationV2(
  observation: SoulsAffordabilityControlledObservationV2,
): string[] {
  const errors: string[] = [];
  if (observation.evidenceVersion !== SOULS_AFFORDABILITY_EVIDENCE_V2) errors.push('EVIDENCE_VERSION_MISMATCH');
  if (!observation.observationId) errors.push('OBSERVATION_ID_REQUIRED');
  if (!observation.sessionId) errors.push('SESSION_ID_REQUIRED');
  if (!Number.isInteger(observation.itemId) || observation.itemId <= 0) errors.push('ITEM_ID_INVALID');
  if (!observation.clientVersion) errors.push('CLIENT_VERSION_REQUIRED');
  if (!observation.gepVersion) errors.push('GEP_VERSION_REQUIRED');
  if (!observation.normalizerVersion) errors.push('NORMALIZER_VERSION_REQUIRED');
  if (!observation.rulesetVersion) errors.push('RULESET_VERSION_REQUIRED');
  if (!isSha256(observation.catalogSha256)) errors.push('CATALOG_SHA_INVALID');
  if (!Number.isFinite(observation.sourceOccurredAtMs)) errors.push('SOURCE_TIMESTAMP_INVALID');
  if (!Number.isFinite(observation.capturedAtMs)) errors.push('CAPTURE_TIMESTAMP_INVALID');
  if (observation.sourceOccurredAtMs > observation.capturedAtMs + 5_000) errors.push('SOURCE_TIMESTAMP_AFTER_CAPTURE_WINDOW');
  for (const [name, value] of [
    ['soulsRawBefore', observation.soulsRawBefore],
    ['soulsRawAfter', observation.soulsRawAfter],
    ['effectiveCost', observation.effectiveCost],
  ]) {
    if (!Number.isFinite(value) || value < 0) errors.push(`${name}_INVALID`);
  }
  if (observation.hudSoulsBefore !== undefined && (!Number.isFinite(observation.hudSoulsBefore) || observation.hudSoulsBefore < 0)) {
    errors.push('HUD_SOULS_BEFORE_INVALID');
  }
  if (observation.hudSoulsAfter !== undefined && (!Number.isFinite(observation.hudSoulsAfter) || observation.hudSoulsAfter < 0)) {
    errors.push('HUD_SOULS_AFTER_INVALID');
  }
  if (observation.actionSucceeded && observation.shopOpportunityObserved !== 'AVAILABLE') {
    errors.push('SUCCESS_WITHOUT_SHOP_OPPORTUNITY');
  }
  if (observation.actionSucceeded && (!observation.inventoryConfirmedBefore || !observation.inventoryConfirmedAfter)) {
    errors.push('SUCCESS_WITHOUT_INVENTORY_CONFIRMATION');
  }
  return [...new Set(errors)].sort();
}

function toV1Observation(observation: SoulsAffordabilityControlledObservationV2): SoulsAffordabilityObservation {
  return {
    actionType: observation.actionType,
    soulsRawBefore: observation.soulsRawBefore,
    soulsRawAfter: observation.soulsRawAfter,
    itemCost: observation.effectiveCost,
    expectedSoulsSpent: observation.effectiveCost,
    operationSucceeded: observation.actionSucceeded,
    hudSoulsBefore: observation.hudSoulsBefore,
    hudSoulsAfter: observation.hudSoulsAfter,
  };
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
