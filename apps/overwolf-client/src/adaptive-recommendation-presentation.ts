import type {
  AdaptiveActionTypeV1,
  AdaptiveActionV1,
  AdaptivePlanActionStatusV1,
  AdaptivePlanActionV1,
  AdaptivePlanRequirementV1,
  AdaptiveRecommendationResultV1,
  AdaptiveSituationalContextV1,
} from '@deadlock-live-probe/shared';
import {
  ADAPTIVE_ITEM_CATALOG,
  AdaptiveItemCatalogEntry,
  AdaptiveItemSlot,
} from './generated/adaptive-item-catalog';
import { getAdaptiveHeroDisplayName } from './generated/adaptive-hero-catalog';

export interface AdaptivePresentedItem {
  readonly id: number;
  readonly name: string;
  readonly slot: AdaptiveItemSlot;
  readonly costLabel?: string;
  readonly tierLabel?: string;
  readonly diagnosticLabel?: string;
  readonly known: boolean;
}

export interface AdaptivePresentedPlanItem {
  readonly planActionId: string;
  readonly item: AdaptivePresentedItem;
  readonly position: number;
  readonly status: AdaptivePlanActionStatusV1;
  readonly statusLabel: string;
  readonly actionLabel: string;
  readonly requirements: readonly string[];
  readonly sourceItems: readonly AdaptivePresentedItem[];
  readonly replacedItem?: AdaptivePresentedItem;
  readonly situationalPurposeLabel?: string;
  readonly againstLabel?: string;
}

export interface AdaptivePresentedAlternative {
  readonly actionLabel: string;
  readonly headline: string;
  readonly item?: AdaptivePresentedItem;
  readonly replacedItem?: AdaptivePresentedItem;
  readonly scoreLabel: string;
}

export interface AdaptiveRecommendationPresentation {
  readonly sourceLabel: string;
  readonly stateLabel: string;
  readonly stateTone: 'ahead' | 'even' | 'behind' | 'unknown';
  readonly healthLabel: string;
  readonly healthTone: 'live' | 'degraded' | 'waiting';
  readonly actionLabel: string;
  readonly headline: string;
  readonly primaryItem?: AdaptivePresentedItem;
  readonly replacedItem?: AdaptivePresentedItem;
  readonly confidence: { readonly label: string; readonly value: number };
  readonly reasons: readonly string[];
  readonly primaryRequirements: readonly string[];
  readonly situationalPurposeLabel?: string;
  readonly againstLabel?: string;
  readonly plan: {
    readonly items: readonly AdaptivePresentedPlanItem[];
    readonly remainingCount: number;
  };
  readonly alternatives: readonly AdaptivePresentedAlternative[];
  readonly evidenceLabel: string;
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  PLAN_HYSTERESIS: 'Current plan is still the safest choice',
  CORE_TARGET_PENDING: 'Keep saving for the next core item',
  NO_USABLE_STATLOCKER_EVIDENCE: 'Waiting for reliable Statlocker data',
  STATLOCKER_UNAVAILABLE_PRESERVE_PLAN: 'Statlocker is updating; keeping the last safe plan',
  FRESH_LEGALITY_FALLBACK: 'Adjusted to a legal purchase',
  NO_FRESH_LEGAL_TRANSACTION: 'No safe purchase is available right now',
  PLAN_REQUIREMENTS_BLOCKED: 'Waiting for the requirements of the next purchase',
  SEMANTIC_TRANSACTION_PATH: 'Following the legal upgrade path',
  MULTI_STEP_UPGRADE_PATH: 'Complete the next upgrade step first',
};

const GAME_STATE_LABELS = {
  AHEAD: 'Playing ahead',
  EVEN: 'Even game',
  BEHIND: 'Playing from behind',
  UNKNOWN: 'Game state updating',
} as const;

const PLAN_ACTION_STATUS_LABELS: Readonly<Record<AdaptivePlanActionStatusV1, string>> = {
  OWNED: 'Owned',
  READY: 'Ready',
  BLOCKED: 'Blocked',
  PLANNED: 'Planned',
  COMPLETED: 'Completed',
};

const SITUATIONAL_PURPOSE_LABELS: Readonly<Record<string, string>> = {
  CATCH: 'Catch',
  ANTI_CC: 'Anti-CC',
  CLEANSE: 'Cleanse',
  ANTI_BULLET: 'Anti-bullet',
  ANTI_SPIRIT: 'Anti-spirit',
  ANTI_BURST: 'Anti-burst',
  ANTI_HEAL: 'Anti-heal',
  MOBILITY: 'Mobility',
  TEAM_UTILITY: 'Team utility',
  SURVIVAL: 'Survival',
};

const ALTERNATIVE_DISPLAY_LIMIT = 3;

export function buildAdaptiveRecommendationPresentation(
  recommendation: AdaptiveRecommendationResultV1,
): AdaptiveRecommendationPresentation {
  const primaryItemId = resolveActionItemId(
    recommendation.nextAction,
    recommendation.nextTargetItemId,
  );
  const primaryItem = primaryItemId === undefined
    ? undefined
    : presentItem(primaryItemId);
  const replacedItem = recommendation.nextAction.type === 'REPLACE'
    ? presentActionSellItem(recommendation.nextAction)
    : undefined;
  const confidenceValue = toPercent(recommendation.confidence);
  const freshEvidenceCount = recommendation.evidence.families.filter(
    (family) => family.freshness === 'FRESH',
  ).length;
  const hasDegradedEvidence = recommendation.evidence.families.some(
    (family) => family.freshness !== 'FRESH',
  ) || recommendation.evidence.degradedReasons.length > 0;
  const semanticPlan = buildPresentedSemanticPlan(recommendation);
  const primaryPlanAction = recommendation.planActions?.[0];
  const primarySituational = primaryPlanAction?.situational;

  return {
    sourceLabel: 'Statlocker Adaptive',
    stateLabel: GAME_STATE_LABELS[recommendation.gameState] ?? GAME_STATE_LABELS.UNKNOWN,
    stateTone: recommendation.gameState.toLowerCase() as AdaptiveRecommendationPresentation['stateTone'],
    healthLabel: recommendation.ready
      ? hasDegradedEvidence ? 'Degraded' : 'Live'
      : 'Waiting',
    healthTone: recommendation.ready
      ? hasDegradedEvidence ? 'degraded' : 'live'
      : 'waiting',
    actionLabel: humanizeActionType(recommendation.nextAction.type),
    headline: buildHeadline(recommendation.nextAction, primaryItem, replacedItem),
    primaryItem,
    replacedItem,
    confidence: {
      label: confidenceLabel(recommendation.nextAction.type, confidenceValue),
      value: confidenceValue,
    },
    reasons: recommendation.nextAction.reasonCodes
      .slice(0, 3)
      .map(humanizeReasonCode),
    primaryRequirements: primaryPlanAction?.requirements.map(presentRequirement) ?? [],
    situationalPurposeLabel: presentSituationalPurpose(primarySituational),
    againstLabel: presentAgainst(primarySituational),
    plan: {
      items: semanticPlan,
      remainingCount: 0,
    },
    alternatives: buildAlternatives(recommendation, primaryItemId),
    evidenceLabel: freshEvidenceCount > 0
      ? `${freshEvidenceCount} fresh Statlocker signal${freshEvidenceCount === 1 ? '' : 's'}`
      : 'Statlocker evidence is updating',
  };
}

function buildPresentedSemanticPlan(
  recommendation: AdaptiveRecommendationResultV1,
): readonly AdaptivePresentedPlanItem[] {
  const semantic = recommendation.planActions;
  if (semantic && semantic.length > 0) {
    const seen = new Set<string>();
    return [...semantic]
      .sort((left, right) => left.sequence - right.sequence || left.planActionId.localeCompare(right.planActionId))
      .filter((action) => {
        if (seen.has(action.planActionId)) return false;
        seen.add(action.planActionId);
        return true;
      })
      .map(presentPlanAction)
      .filter((entry): entry is AdaptivePresentedPlanItem => entry !== undefined);
  }

  return [...recommendation.recommendedBuild]
    .sort((left, right) => left.position - right.position)
    .map((planned) => ({
      planActionId: `legacy:${planned.position}:${planned.itemId}`,
      item: presentItem(planned.itemId),
      position: planned.position,
      status: planned.status === 'OWNED' ? 'OWNED' : planned.status === 'NEXT' ? 'READY' : 'PLANNED',
      statusLabel: planned.status === 'OWNED' ? 'Owned' : planned.status === 'NEXT' ? 'Ready' : 'Planned',
      actionLabel: planned.status === 'OWNED' ? 'Owned' : 'Build',
      requirements: [],
      sourceItems: [],
    }));
}

function presentPlanAction(action: AdaptivePlanActionV1): AdaptivePresentedPlanItem | undefined {
  const itemId = action.targetItemId ?? resolveActionItemId(action.action) ?? action.sourceItemIds[0];
  if (!Number.isSafeInteger(itemId) || Number(itemId) <= 0) return undefined;
  const replacedItem = action.action.type === 'REPLACE'
    ? presentActionSellItem(action.action)
    : undefined;

  return {
    planActionId: action.planActionId,
    item: presentItem(Number(itemId)),
    position: action.sequence,
    status: action.status,
    statusLabel: PLAN_ACTION_STATUS_LABELS[action.status],
    actionLabel: humanizeActionType(action.action.type),
    requirements: action.requirements.map(presentRequirement),
    sourceItems: action.sourceItemIds.map(presentItem),
    replacedItem,
    situationalPurposeLabel: presentSituationalPurpose(action.situational),
    againstLabel: presentAgainst(action.situational),
  };
}

function presentRequirement(requirement: AdaptivePlanRequirementV1): string {
  switch (requirement.type) {
    case 'SOULS':
      return requirement.evidence === 'UNKNOWN'
        ? `Need ${formatSouls(requirement.requiredSouls)} souls - current souls unknown`
        : `Save until ${formatSouls(requirement.requiredSouls)} souls`;
    case 'FLEX_SLOT':
      return requirement.evidence === 'UNKNOWN'
        ? 'Requires flex slot - unlock state unknown'
        : `Requires ${requirement.requiredFlexSlots} flex slot${requirement.requiredFlexSlots === 1 ? '' : 's'}`;
    case 'SELL_ITEM':
      return `Sell ${describeItem(presentItem(requirement.itemId), `item #${requirement.itemId}`)} before purchase`;
    case 'UPGRADE_COMPONENT': {
      const names = requirement.itemIds.map((itemId) => describeItem(presentItem(itemId), `item #${itemId}`));
      return `Upgrade ${names.join(' + ')}`;
    }
    case 'SHOP_OPPORTUNITY':
      return requirement.evidence === 'UNKNOWN'
        ? 'Wait for a confirmed shop opportunity'
        : requirement.available === false
          ? 'Reach the shop before purchase'
          : 'Shop available';
  }
}

function presentSituationalPurpose(context: AdaptiveSituationalContextV1 | undefined): string | undefined {
  if (!context) return undefined;
  return SITUATIONAL_PURPOSE_LABELS[context.purpose] ?? humanizeReasonCode(context.purpose);
}

function presentAgainst(context: AdaptiveSituationalContextV1 | undefined): string | undefined {
  if (!context) return undefined;
  const names = context.targetEnemies
    .map((target) => target.enemyHeroName?.trim() || getAdaptiveHeroDisplayName(target.enemyHeroId))
    .filter((name): name is string => Boolean(name));
  const unique = [...new Set(names)];
  return unique.length > 0 ? `Against: ${unique.join(', ')}` : undefined;
}

function resolveActionItemId(
  action: AdaptiveActionV1,
  fallbackItemId?: number,
): number | undefined {
  const value = action.buyItemId
    ?? action.itemId
    ?? action.targetItemId
    ?? action.sellItemId
    ?? fallbackItemId;
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function presentItem(itemId: number): AdaptivePresentedItem {
  const catalogItem: AdaptiveItemCatalogEntry | undefined = ADAPTIVE_ITEM_CATALOG[itemId];
  if (!catalogItem) {
    return {
      id: itemId,
      name: 'Unknown item',
      slot: 'unknown',
      diagnosticLabel: `#${itemId}`,
      known: false,
    };
  }

  return {
    id: itemId,
    name: catalogItem.name,
    slot: catalogItem.slot,
    costLabel: `${catalogItem.cost.toLocaleString('en-US')} souls`,
    tierLabel: `Tier ${catalogItem.tier}`,
    known: true,
  };
}

function buildHeadline(
  action: AdaptiveActionV1,
  item: AdaptivePresentedItem | undefined,
  replacedItem?: AdaptivePresentedItem,
): string {
  const itemName = item?.known ? item.name : undefined;
  switch (action.type) {
    case 'BUY':
      return itemName ? `Buy ${itemName}` : 'Choose the next item';
    case 'UPGRADE':
      return itemName ? `Upgrade to ${itemName}` : 'Upgrade the current item';
    case 'SELL':
      return itemName ? `Sell ${itemName}` : 'Free a flex slot';
    case 'REPLACE':
      return describeReplacement(replacedItem, item);
    case 'HOLD':
      return itemName ? `Hold for ${itemName}` : 'Hold your souls';
    case 'WAIT':
      return itemName ? `Wait for ${itemName}` : 'Wait before buying';
    case 'CONTINUE_CORE':
      return itemName ? `Continue toward ${itemName}` : 'Continue the core build';
    case 'ABSTAIN':
      return 'No safe purchase yet';
  }
}

function buildAlternatives(
  recommendation: AdaptiveRecommendationResultV1,
  primaryItemId: number | undefined,
): readonly AdaptivePresentedAlternative[] {
  const alternatives: AdaptivePresentedAlternative[] = [];
  const seen = new Set<string>();

  for (const candidate of recommendation.rankedImmediateCandidates) {
    const itemId = resolveActionItemId(candidate.action);
    const key = itemId === undefined
      ? `action:${candidate.action.type}`
      : `item:${itemId}`;
    if (
      candidate.action.actionKey === recommendation.nextAction.actionKey
      || itemId === primaryItemId
      || seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    const item = itemId === undefined ? undefined : presentItem(itemId);
    const replacedItem = candidate.action.type === 'REPLACE'
      ? presentActionSellItem(candidate.action)
      : undefined;
    alternatives.push({
      actionLabel: humanizeActionType(candidate.action.type),
      headline: buildHeadline(candidate.action, item, replacedItem),
      item,
      replacedItem,
      scoreLabel: `${toPercent(candidate.score)}% fit`,
    });
    if (alternatives.length === ALTERNATIVE_DISPLAY_LIMIT) {
      break;
    }
  }

  return alternatives;
}

function presentActionSellItem(action: AdaptiveActionV1): AdaptivePresentedItem | undefined {
  return Number.isSafeInteger(action.sellItemId) && Number(action.sellItemId) > 0
    ? presentItem(Number(action.sellItemId))
    : undefined;
}

function describeReplacement(
  replacedItem: AdaptivePresentedItem | undefined,
  targetItem: AdaptivePresentedItem | undefined,
): string {
  const from = describeItem(replacedItem, 'a weaker item');
  const to = describeItem(targetItem, 'a stronger item');
  return `Replace ${from} with ${to}`;
}

function describeItem(item: AdaptivePresentedItem | undefined, fallback: string): string {
  if (!item) return fallback;
  return item.known ? item.name : `item ${item.diagnosticLabel}`;
}

function humanizeActionType(type: AdaptiveActionTypeV1): string {
  return {
    BUY: 'Buy now',
    UPGRADE: 'Upgrade',
    SELL: 'Sell',
    REPLACE: 'Replace',
    WAIT: 'Wait',
    HOLD: 'Hold',
    CONTINUE_CORE: 'Core path',
    ABSTAIN: 'Stand by',
  }[type];
}

function confidenceLabel(type: AdaptiveActionTypeV1, value: number): string {
  if (value === 0 && (type === 'HOLD' || type === 'WAIT' || type === 'ABSTAIN')) {
    return type === 'HOLD' ? 'Safe hold' : 'Safe fallback';
  }
  return `${value}% confidence`;
}

function humanizeReasonCode(code: string): string {
  if (REASON_LABELS[code]) return REASON_LABELS[code];
  const normalized = code.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : 'Recommendation updated';
}

function formatSouls(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

function toPercent(value: number): number {
  const finite = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(Math.max(0, Math.min(1, finite)) * 100);
}
