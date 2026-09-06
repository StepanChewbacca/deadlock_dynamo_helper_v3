import {
  AdaptiveActionV1,
  AdaptivePlanSessionV1,
  AdaptivePlanStepV1,
  AdaptivePlannedItemV1,
} from '@deadlock-live-probe/shared';

export function nextActionFromPlanSessionV1(session: AdaptivePlanSessionV1): AdaptiveActionV1 {
  if (session.state === 'REPLAN_REQUIRED') {
    return {
      actionKey: 'HOLD',
      type: 'HOLD',
      targetItemId: firstFutureTargetItemId(session.steps),
      reasonCodes: unique(['REPLAN_REQUIRED', ...session.reasonCodes]),
    };
  }
  if (session.state === 'COMPLETE') {
    return {
      actionKey: 'HOLD',
      type: 'HOLD',
      reasonCodes: unique(['TRANSACTION_PLAN_COMPLETE', ...session.reasonCodes]),
    };
  }

  const next = session.nextStepId
    ? session.steps.find((step) => step.stepId === session.nextStepId)
    : undefined;
  if (next?.kind === 'TRANSACTION' && next.action) {
    const action = next.action;
    if (action.type === 'BUY') {
      return {
        actionKey: `BUY_ITEM:${action.buyItemId}`,
        type: 'BUY',
        itemId: action.buyItemId,
        buyItemId: action.buyItemId,
        targetItemId: action.buyItemId,
        reasonCodes: unique(next.reasonCodes),
      };
    }
    if (action.type === 'UPGRADE') {
      return {
        actionKey: action.recipeId
          ? `UPGRADE_ITEM:${action.buyItemId}:${action.recipeId}`
          : `UPGRADE_ITEM:${action.buyItemId}`,
        type: 'UPGRADE',
        itemId: action.buyItemId,
        buyItemId: action.buyItemId,
        targetItemId: action.buyItemId,
        reasonCodes: unique(next.reasonCodes),
      };
    }
    return {
      actionKey: `REPLACE_ITEM:${action.sellItemId}->${action.buyItemId}`,
      type: 'REPLACE',
      sellItemId: action.sellItemId,
      buyItemId: action.buyItemId,
      targetItemId: action.buyItemId,
      reasonCodes: unique(next.reasonCodes),
    };
  }

  const barrier = session.steps.find((step) => step.kind === 'BARRIER' && step.state === 'BLOCKED');
  return {
    actionKey: 'HOLD',
    type: 'HOLD',
    targetItemId: barrierTargetItemId(barrier) ?? firstFutureTargetItemId(session.steps),
    reasonCodes: unique([
      ...(barrier?.barrier ? [barrier.barrier.type] : []),
      ...(barrier?.reasonCodes ?? []),
      ...(session.state === 'WAITING' ? ['PLAN_WAITING'] : []),
      ...session.reasonCodes,
    ]),
  };
}

export function recommendedBuildFromPlanSessionV1(input: {
  session: AdaptivePlanSessionV1;
  ownedItemIds: readonly number[];
}): readonly AdaptivePlannedItemV1[] {
  const rows: AdaptivePlannedItemV1[] = [...new Set(input.ownedItemIds)]
    .sort((a, b) => a - b)
    .map((itemId, index) => ({
      itemId,
      position: index + 1,
      status: 'OWNED',
      score: 0,
      confidence: 1,
      skeletonStrength: 0,
      contextualSupport: 1,
      reasonCodes: ['OWNED_ITEM'],
    }));
  const seen = new Set(rows.map((row) => row.itemId));
  for (const step of input.session.steps) {
    if (step.state === 'INVALIDATED' || step.state === 'SKIPPED' || step.state === 'COMPLETED') continue;
    const itemId = targetItemId(step);
    if (itemId === undefined || seen.has(itemId)) continue;
    seen.add(itemId);
    rows.push({
      itemId,
      position: rows.length + 1,
      status: step.state === 'NEXT' ? 'NEXT' : 'PLANNED',
      score: 0,
      confidence: 0,
      skeletonStrength: 0,
      contextualSupport: 0,
      reasonCodes: unique([`TRANSACTION_STEP:${step.stepId}`, ...step.reasonCodes]),
    });
  }
  return rows.map((row, index) => ({ ...row, position: index + 1 }));
}

function targetItemId(step: AdaptivePlanStepV1): number | undefined {
  if (step.action) return step.action.buyItemId;
  return barrierTargetItemId(step);
}

function barrierTargetItemId(step: AdaptivePlanStepV1 | undefined): number | undefined {
  if (!step?.barrier || !('targetItemId' in step.barrier)) return undefined;
  return step.barrier.targetItemId;
}

function firstFutureTargetItemId(steps: readonly AdaptivePlanStepV1[]): number | undefined {
  for (const step of steps) {
    if (step.state === 'COMPLETED' || step.state === 'SKIPPED' || step.state === 'INVALIDATED') continue;
    const itemId = targetItemId(step);
    if (itemId !== undefined) return itemId;
  }
  return undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}