import type {
  AdaptiveActionTypeV1,
  AdaptiveActionV1,
  AdaptiveRecommendationResultV1,
  AdaptiveRecommendationStrategyV1,
} from '@deadlock-live-probe/shared';
import {
  ADAPTIVE_ITEM_CATALOG,
  AdaptiveItemCatalogEntry,
  AdaptiveItemSlot,
} from './generated/adaptive-item-catalog';

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
  readonly item: AdaptivePresentedItem;
  readonly position: number;
  readonly status: 'OWNED' | 'NEXT' | 'PLANNED';
  readonly statusLabel: string;
}

export interface AdaptivePresentedAlternative {
  readonly actionLabel: string;
  readonly headline: string;
  readonly item?: AdaptivePresentedItem;
  readonly replacedItem?: AdaptivePresentedItem;
  readonly scoreLabel: string;
}

export interface AdaptivePresentedStrategy {
  readonly idLabel: string;
  readonly commitmentLabel: string;
  readonly buildStatusLabel: string;
  readonly progressLabel: string;
  readonly progressValue: number;
  readonly currentGoalLabel?: string;
  readonly branchLabel?: string;
  readonly slotLabel: string;
  readonly investmentLabel?: string;
  readonly situationalLabel?: string;
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
  readonly strategy?: AdaptivePresentedStrategy;
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
};

const GAME_STATE_LABELS = {
  AHEAD: 'Playing ahead',
  EVEN: 'Even game',
  BEHIND: 'Playing from behind',
  UNKNOWN: 'Game state updating',
} as const;

const PLAN_STATUS_LABELS = {
  OWNED: 'Owned',
  NEXT: 'Next',
  PLANNED: 'Planned',
} as const;

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
  const orderedPlan = [...recommendation.recommendedBuild]
    .sort((left, right) => left.position - right.position);

  return {
    sourceLabel: recommendation.strategy ? 'Strategy-first Adaptive' : 'Statlocker Adaptive',
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
    strategy: recommendation.strategy
      ? presentStrategy(recommendation.strategy)
      : undefined,
    plan: {
      items: orderedPlan.map((planned) => ({
        item: presentItem(planned.itemId),
        position: planned.position,
        status: planned.status,
        statusLabel: PLAN_STATUS_LABELS[planned.status],
      })),
      remainingCount: 0,
    },
    // rankedImmediateCandidates intentionally stay diagnostic until a curated alternative contract exists.
    alternatives: [],
    evidenceLabel: freshEvidenceCount > 0
      ? `${freshEvidenceCount} fresh Statlocker signal${freshEvidenceCount === 1 ? '' : 's'}`
      : 'Statlocker evidence is updating',
  };
}

function presentStrategy(strategy: AdaptiveRecommendationStrategyV1): AdaptivePresentedStrategy {
  const total = Math.max(0, strategy.progress.totalHardGoals);
  const satisfied = Math.max(0, Math.min(total, strategy.progress.satisfiedHardGoals));
  const currentGoalLabel = strategy.currentGoal
    ? `${titleCase(strategy.currentGoal.type)} · ${humanizeToken(strategy.currentGoal.goalId)}`
    : undefined;
  const committedBranches = strategy.committedBranches ?? {};
  const selectedBranches = strategy.selectedBranches ?? {};
  const branches = Object.entries(committedBranches).length > 0
    ? committedBranches
    : selectedBranches;
  const branchLabel = Object.keys(branches).length > 0
    ? Object.entries(branches)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, goal]) => `${humanizeToken(group)}: ${humanizeToken(goal)}`)
      .join(' · ')
    : undefined;
  const slot = strategy.slotPlan;
  const flex = slot.unlockedFlexSlots === undefined
    ? `${slot.currentFlexUsed}/? flex`
    : `${slot.currentFlexUsed}/${slot.unlockedFlexSlots} flex`;
  const investmentObjectives = strategy.investmentObjectives ?? [];
  const activeInvestment = investmentObjectives.find((objective) => objective.state === 'ACTIVE')
    ?? investmentObjectives.find((objective) => objective.state === 'SATISFIED');

  return {
    idLabel: strategyLabel(strategy.strategyId),
    commitmentLabel: titleCase(strategy.commitment),
    buildStatusLabel: humanizeSentence(strategy.buildStatus),
    progressLabel: `${satisfied} / ${total} core goals`,
    progressValue: total === 0 ? 100 : Math.round((satisfied / total) * 100),
    currentGoalLabel,
    branchLabel,
    slotLabel: `${slot.currentUsedSlots} slots · ${flex} · ${slot.reservedSituationalSlots} reserved`,
    investmentLabel: activeInvestment ? investmentLabel(activeInvestment) : undefined,
    situationalLabel: strategy.situationalDecision
      ? situationalLabel(strategy.situationalDecision)
      : undefined,
  };
}

function investmentLabel(
  objective: AdaptiveRecommendationStrategyV1['investmentObjectives'][number],
): string {
  const current = formatNumber(objective.currentValue);
  if (objective.targetValue === undefined) {
    return `${titleCase(objective.type)} ${current} · ${titleCase(objective.state)}`;
  }
  const distance = objective.distance ?? Math.max(0, objective.targetValue - objective.currentValue);
  return `${titleCase(objective.type)} ${current} / ${formatNumber(objective.targetValue)} · ${formatNumber(distance)} to objective`;
}

function situationalLabel(
  decision: NonNullable<AdaptiveRecommendationStrategyV1['situationalDecision']>,
): string {
  const item = presentItem(decision.targetItemId);
  return `${formatPurpose(decision.purpose)} window · ${item.known ? item.name : item.diagnosticLabel} · ${toPercent(decision.confidence)}%`;
}

function strategyLabel(strategyId: string): string {
  const parts = strategyId.split(':').filter(Boolean);
  const meaningful = parts.filter((part) => !['strategy', 'hero', 'archetype'].includes(part.toLowerCase()) && !/^\d+$/.test(part));
  return humanizeToken(meaningful[meaningful.length - 1] ?? strategyId);
}

function humanizeToken(value: string): string {
  return value.trim().replace(/[_:-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function titleCase(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, ' ').toLowerCase();
  return normalized.replace(/(^|\s)\S/g, (char) => char.toUpperCase());
}

function formatNumber(value: number): string {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0)).toLocaleString('en-US');
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
      return 'Wait before buying';
    case 'CONTINUE_CORE':
      return itemName ? `Continue toward ${itemName}` : 'Continue the core build';
    case 'ABSTAIN':
      return 'No safe purchase yet';
  }
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
  if (!item) {
    return fallback;
  }
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
  if (REASON_LABELS[code]) {
    return REASON_LABELS[code];
  }
  const normalized = code.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : 'Recommendation updated';
}

function toPercent(value: number): number {
  const finite = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(Math.max(0, Math.min(1, finite)) * 100);
}

function humanizeSentence(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, ' ').toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '';
}

function formatPurpose(purpose: string): string {
  const acronyms: Record<string, string> = { cc: 'CC', dps: 'DPS', aoe: 'AoE', hp: 'HP' };
  return purpose
    .trim()
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => acronyms[word] ?? (word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}
