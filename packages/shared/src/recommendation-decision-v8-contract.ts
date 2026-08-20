export const RECOMMENDATION_DECISION_V8_SCHEMA_VERSION = 8 as const;

export type RecommendationDecisionV8ActionType =
  | 'WAIT'
  | 'BUY'
  | 'UPGRADE'
  | 'SELL'
  | 'REPLACE';

export type RecommendationDecisionV8EconomyEvidence =
  | 'VALIDATED'
  | 'UNAVAILABLE';

export type RecommendationDecisionV8ExposureStatus =
  | 'NOT_SHOWN'
  | 'SHOWN_UNACKED'
  | 'SHOWN_ACKED';

export type RecommendationDecisionV8ObservedActionConfidence =
  | 'EXACT_SINGLE_ACTION'
  | 'MULTI_ACTION_INTERVAL'
  | 'AMBIGUOUS_MULTI_ACTION'
  | 'UNRESOLVED';

export interface RecommendationDecisionV8LegalAction {
  actionId: string;
  type: RecommendationDecisionV8ActionType;
  itemId?: number;
  sellItemId?: number;
  buyItemId?: number;
  consumedComponentIds?: number[];
  effectiveCost: number;
  soulsDelta: number;
  spendableSoulsAfter: number;
}

export interface RecommendationDecisionV8Economy {
  evidence: RecommendationDecisionV8EconomyEvidence;
  spendableSouls?: number;
}

export interface RecommendationDecisionV8Exposure {
  status: RecommendationDecisionV8ExposureStatus;
  exposedActionIds: string[];
  acknowledgedAtMs?: number;
}

export interface RecommendationDecisionV8ObservedAction {
  actionIds: string[];
  confidence: RecommendationDecisionV8ObservedActionConfidence;
  observedAtGameTimeSec: number;
}

export interface RecommendationDecisionV8 {
  schemaVersion: typeof RECOMMENDATION_DECISION_V8_SCHEMA_VERSION;
  decisionId: string;
  matchId: string;
  steamId: string;
  heroId: number;
  teamId?: number;
  gameTimeSec: number;
  observedAtMs: number;
  rulesetVersion: string;
  rulesetSha256: string;
  catalogVersion: string;
  catalogSha256: string;
  inventoryItemIds: number[];
  economy: RecommendationDecisionV8Economy;
  legalActions: RecommendationDecisionV8LegalAction[];
  servedActionId?: string;
  exposure: RecommendationDecisionV8Exposure;
  observedAction?: RecommendationDecisionV8ObservedAction;
}

export type RecommendationDecisionV8ValidationCode =
  | 'INVALID_SCHEMA_VERSION'
  | 'INVALID_IDENTITY'
  | 'INVALID_HERO_ID'
  | 'INVALID_GAME_TIME'
  | 'INVALID_OBSERVED_AT'
  | 'INVALID_RULESET_VERSION'
  | 'INVALID_RULESET_SHA256'
  | 'INVALID_CATALOG_VERSION'
  | 'INVALID_CATALOG_SHA256'
  | 'INVALID_INVENTORY_ITEM_ID'
  | 'INVALID_ECONOMY'
  | 'UNVALIDATED_ECONOMY_HAS_SPEND_ACTION'
  | 'EMPTY_LEGAL_ACTION_SET'
  | 'DUPLICATE_LEGAL_ACTION_ID'
  | 'WAIT_ACTION_MISSING'
  | 'INVALID_LEGAL_ACTION'
  | 'INCONSISTENT_ACTION_ECONOMY'
  | 'SERVED_ACTION_NOT_LEGAL'
  | 'EXPOSED_ACTION_NOT_LEGAL'
  | 'INVALID_EXPOSURE_ACK'
  | 'OBSERVED_ACTION_NOT_LEGAL'
  | 'INVALID_OBSERVED_ACTION';

export interface RecommendationDecisionV8ValidationIssue {
  code: RecommendationDecisionV8ValidationCode;
  message: string;
}

export interface RecommendationDecisionV8ValidationResult {
  ok: boolean;
  issues: RecommendationDecisionV8ValidationIssue[];
}

export function canonicalizeRecommendationDecisionV8(
  input: RecommendationDecisionV8,
): RecommendationDecisionV8 {
  return {
    ...input,
    inventoryItemIds: [...input.inventoryItemIds].sort((left, right) => left - right),
    economy: { ...input.economy },
    legalActions: [...input.legalActions]
      .map((action) => ({
        ...action,
        ...(action.consumedComponentIds
          ? { consumedComponentIds: [...action.consumedComponentIds].sort((left, right) => left - right) }
          : {}),
      }))
      .sort((left, right) => left.actionId.localeCompare(right.actionId)),
    exposure: {
      ...input.exposure,
      exposedActionIds: [...input.exposure.exposedActionIds].sort(),
    },
    ...(input.observedAction
      ? {
          observedAction: {
            ...input.observedAction,
            actionIds: [...input.observedAction.actionIds].sort(),
          },
        }
      : {}),
  };
}

export function validateRecommendationDecisionV8(
  input: RecommendationDecisionV8,
): RecommendationDecisionV8ValidationResult {
  const issues: RecommendationDecisionV8ValidationIssue[] = [];

  if (input.schemaVersion !== RECOMMENDATION_DECISION_V8_SCHEMA_VERSION) {
    issues.push({
      code: 'INVALID_SCHEMA_VERSION',
      message: `schemaVersion must be ${RECOMMENDATION_DECISION_V8_SCHEMA_VERSION}.`,
    });
  }
  if (!isNonEmptyString(input.decisionId) || !isNonEmptyString(input.matchId) || !isNonEmptyString(input.steamId)) {
    issues.push({ code: 'INVALID_IDENTITY', message: 'decisionId, matchId, and steamId are required.' });
  }
  if (!isPositiveInteger(input.heroId)) {
    issues.push({ code: 'INVALID_HERO_ID', message: 'heroId must be a positive safe integer.' });
  }
  if (!isNonNegativeFinite(input.gameTimeSec)) {
    issues.push({ code: 'INVALID_GAME_TIME', message: 'gameTimeSec must be non-negative and finite.' });
  }
  if (!Number.isSafeInteger(input.observedAtMs) || input.observedAtMs < 0) {
    issues.push({ code: 'INVALID_OBSERVED_AT', message: 'observedAtMs must be a non-negative safe integer.' });
  }
  if (!isNonEmptyString(input.rulesetVersion)) {
    issues.push({ code: 'INVALID_RULESET_VERSION', message: 'rulesetVersion is required.' });
  }
  if (!isSha256(input.rulesetSha256)) {
    issues.push({ code: 'INVALID_RULESET_SHA256', message: 'rulesetSha256 must be a 64-character lowercase hex digest.' });
  }
  if (!isNonEmptyString(input.catalogVersion)) {
    issues.push({ code: 'INVALID_CATALOG_VERSION', message: 'catalogVersion is required.' });
  }
  if (!isSha256(input.catalogSha256)) {
    issues.push({ code: 'INVALID_CATALOG_SHA256', message: 'catalogSha256 must be a 64-character lowercase hex digest.' });
  }
  if (input.inventoryItemIds.some((itemId) => !isPositiveInteger(itemId))) {
    issues.push({ code: 'INVALID_INVENTORY_ITEM_ID', message: 'inventoryItemIds must contain only positive safe integers.' });
  }

  const validatedSpendableSouls =
    input.economy.evidence === 'VALIDATED' && isNonNegativeSafeInteger(input.economy.spendableSouls)
      ? input.economy.spendableSouls
      : undefined;
  if (
    (input.economy.evidence === 'VALIDATED' && validatedSpendableSouls === undefined) ||
    (input.economy.evidence === 'UNAVAILABLE' && input.economy.spendableSouls !== undefined)
  ) {
    issues.push({
      code: 'INVALID_ECONOMY',
      message: 'VALIDATED economy requires spendableSouls; UNAVAILABLE economy must not carry a spendable balance.',
    });
  }

  if (input.legalActions.length === 0) {
    issues.push({ code: 'EMPTY_LEGAL_ACTION_SET', message: 'legalActions must contain at least WAIT.' });
  }

  const legalActionIds = new Set<string>();
  let waitCount = 0;
  let nonWaitCount = 0;
  for (const action of input.legalActions) {
    if (legalActionIds.has(action.actionId)) {
      issues.push({
        code: 'DUPLICATE_LEGAL_ACTION_ID',
        message: `Duplicate legal action id ${action.actionId}.`,
      });
    }
    legalActionIds.add(action.actionId);
    if (action.type === 'WAIT') {
      waitCount += 1;
    } else {
      nonWaitCount += 1;
    }
    if (!isValidLegalAction(action)) {
      issues.push({
        code: 'INVALID_LEGAL_ACTION',
        message: `Legal action ${action.actionId || '<missing>'} has an invalid or non-canonical shape.`,
      });
    }
    if (
      validatedSpendableSouls !== undefined &&
      validatedSpendableSouls + action.soulsDelta !== action.spendableSoulsAfter
    ) {
      issues.push({
        code: 'INCONSISTENT_ACTION_ECONOMY',
        message: `Legal action ${action.actionId} has inconsistent spendableSoulsAfter.`,
      });
    }
  }
  if (waitCount !== 1) {
    issues.push({ code: 'WAIT_ACTION_MISSING', message: 'legalActions must contain exactly one WAIT action.' });
  }
  if (input.economy.evidence === 'UNAVAILABLE' && nonWaitCount > 0) {
    issues.push({
      code: 'UNVALIDATED_ECONOMY_HAS_SPEND_ACTION',
      message: 'Only WAIT may be emitted while decision-time spendable currency is unavailable.',
    });
  }

  if (input.servedActionId !== undefined && !legalActionIds.has(input.servedActionId)) {
    issues.push({ code: 'SERVED_ACTION_NOT_LEGAL', message: 'servedActionId must be present in legalActions.' });
  }
  for (const actionId of input.exposure.exposedActionIds) {
    if (!legalActionIds.has(actionId)) {
      issues.push({ code: 'EXPOSED_ACTION_NOT_LEGAL', message: `Exposed action ${actionId} is not legal.` });
    }
  }

  const exposureHasAck = input.exposure.acknowledgedAtMs !== undefined;
  if (
    (input.exposure.status === 'SHOWN_ACKED' &&
      (!isNonNegativeSafeInteger(input.exposure.acknowledgedAtMs) ||
        input.exposure.acknowledgedAtMs < input.observedAtMs)) ||
    (input.exposure.status !== 'SHOWN_ACKED' && exposureHasAck) ||
    (input.exposure.status === 'NOT_SHOWN' && input.exposure.exposedActionIds.length > 0) ||
    (input.exposure.status !== 'NOT_SHOWN' && input.exposure.exposedActionIds.length === 0)
  ) {
    issues.push({
      code: 'INVALID_EXPOSURE_ACK',
      message: 'Exposure status, exposedActionIds, and acknowledgedAtMs are inconsistent.',
    });
  }

  if (input.observedAction) {
    if (
      !isNonNegativeFinite(input.observedAction.observedAtGameTimeSec) ||
      input.observedAction.observedAtGameTimeSec < input.gameTimeSec ||
      input.observedAction.actionIds.length === 0
    ) {
      issues.push({
        code: 'INVALID_OBSERVED_ACTION',
        message: 'Observed action requires at least one action id at or after the decision game time.',
      });
    }
    for (const actionId of input.observedAction.actionIds) {
      if (!legalActionIds.has(actionId)) {
        issues.push({
          code: 'OBSERVED_ACTION_NOT_LEGAL',
          message: `Observed action ${actionId} was not in the decision-time legal action set.`,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function isValidLegalAction(action: RecommendationDecisionV8LegalAction): boolean {
  if (
    !isNonEmptyString(action.actionId) ||
    !isNonNegativeSafeInteger(action.effectiveCost) ||
    !Number.isSafeInteger(action.soulsDelta) ||
    !isNonNegativeSafeInteger(action.spendableSoulsAfter)
  ) {
    return false;
  }

  switch (action.type) {
    case 'WAIT':
      return action.actionId === 'WAIT' && action.effectiveCost === 0 && action.soulsDelta === 0;
    case 'BUY':
      return isPositiveInteger(action.itemId) && action.actionId === `BUY:${action.itemId}`;
    case 'SELL':
      return isPositiveInteger(action.itemId) && action.actionId === `SELL:${action.itemId}`;
    case 'UPGRADE': {
      if (
        !isPositiveInteger(action.itemId) ||
        !Array.isArray(action.consumedComponentIds) ||
        action.consumedComponentIds.length === 0 ||
        !action.consumedComponentIds.every(isPositiveInteger)
      ) {
        return false;
      }
      const componentKey = [...action.consumedComponentIds].sort((left, right) => left - right).join(',');
      return action.actionId === `UPGRADE:${action.itemId}:${componentKey}`;
    }
    case 'REPLACE':
      return (
        isPositiveInteger(action.sellItemId) &&
        isPositiveInteger(action.buyItemId) &&
        action.sellItemId !== action.buyItemId &&
        action.actionId === `REPLACE:${action.sellItemId}->${action.buyItemId}`
      );
  }
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
