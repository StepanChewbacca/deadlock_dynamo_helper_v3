import {
  AdaptiveRecommendationResultV1,
  AdaptiveSituationalContextV1,
} from '@deadlock-live-probe/shared';
import { AdaptiveBuildPlannerResultV1 } from './adaptive-build-planner-v1.service';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';
import {
  AdaptiveEvidenceScorerV1Service,
  AdaptiveItemScoreContextV1,
} from './adaptive-evidence-scorer-v1.service';
import {
  AdaptiveSituationalContextV1Service,
} from './adaptive-situational-context-v1.service';
import {
  AdaptiveSituationalWindowRegistryEntryV1,
} from './adaptive-situational-window-registry-v1';
import {
  AdaptiveGameStateBlendV1,
  computeAdaptiveGameStateBlendV1,
  computeSoulDeltaV1,
} from './adaptive-game-state';
import { StatlockerEvidenceBundleV1 } from './statlocker-evidence.service';
import { ADAPTIVE_POLICY_V1_CONFIG } from './statlocker-adaptive.config';
import { BuildSituationalWindowStateV1 } from './build-contract-v1';
import { resolveUpgradeExecutionPathV1 } from '@deadlock-live-probe/build-domain';

export interface ResolveSituationalPlanInputV1 {
  decision: AdaptiveDecisionStateV1;
  evidence: StatlockerEvidenceBundleV1;
  corePlan: Pick<AdaptiveBuildPlannerResultV1, 'nextAction' | 'recommendedBuild'> & { nextTargetItemId?: number };
  scorer: AdaptiveEvidenceScorerV1Service;
  evaluator: AdaptiveSituationalContextV1Service;
  windows: readonly AdaptiveSituationalWindowRegistryEntryV1[];
  optionalTargetItemIds: ReadonlySet<number>;
  previousResult?: Pick<AdaptiveRecommendationResultV1, 'planActions'>;
}

export interface ResolveSituationalPlanResultV1 {
  windowStates: readonly BuildSituationalWindowStateV1[];
  contextByTargetItemId: ReadonlyMap<number, AdaptiveSituationalContextV1>;
}

interface AcceptedSituationalV1 {
  window: AdaptiveSituationalWindowRegistryEntryV1;
  targetItemId: number;
  score: number;
  context: AdaptiveSituationalContextV1;
}

export function resolveSituationalPlanV1(
  input: ResolveSituationalPlanInputV1,
): ResolveSituationalPlanResultV1 {
  if (input.windows.length === 0 || input.optionalTargetItemIds.size === 0) return emptyResult();

  const baseContext = scorerContext(input);
  const coreTargetItemId = coreTarget(input.corePlan);
  const coreScore = coreTargetItemId === undefined
    ? { score: 0, confidence: 0 }
    : input.scorer.scoreItem(coreTargetItemId, baseContext);
  const accepted: AcceptedSituationalV1[] = [];

  for (const window of input.windows) {
    for (const targetItemId of window.targetItemIds) {
      if (!input.optionalTargetItemIds.has(targetItemId)) continue;
      if (input.decision.itemGraph.isTargetSatisfied(
        targetItemId,
        input.decision.state.inventory.heldByItemId.keys(),
      )) continue;

      const acquisitionCost = executableAcquisitionCost(input.decision, targetItemId);
      if (acquisitionCost === undefined) continue;
      const candidate = input.scorer.scoreItem(targetItemId, baseContext);
      const previousTargetEnemyHeroIds = input.previousResult?.planActions
        ?.find((action) => action.targetItemId === targetItemId && action.situational)
        ?.situational?.targetEnemies.map((target) => target.enemyHeroId) ?? [];
      const evaluated = input.evaluator.evaluate({
        heroId: input.decision.state.heroId,
        itemId: targetItemId,
        enemyHeroIds: input.decision.enemyHeroIds,
        evidence: input.evidence,
        purpose: window.purpose,
        window: {
          windowId: window.windowId,
          open: true,
          maxItems: window.maxItems,
          maxSoulsDelay: window.maxSoulsDelay,
          reservedSlots: window.reservedSlots,
          allowedPurposes: [window.purpose],
        },
        candidateScore: candidate.score,
        candidateConfidence: candidate.confidence,
        coreScore: coreScore.score,
        coreConfidence: coreScore.confidence,
        nextCoreTargetItemId: coreTargetItemId,
        estimatedCoreDelaySouls: acquisitionCost,
        previousTargetEnemyHeroIds,
      });
      if (!evaluated.accepted || !evaluated.context) continue;
      accepted.push({
        window,
        targetItemId,
        score: candidate.score - coreScore.score,
        context: enrichEnemyHeroNames(evaluated.context, input.decision),
      });
    }
  }

  const best = accepted.sort((left, right) =>
    right.score - left.score ||
    right.context.recommendationConfidence - left.context.recommendationConfidence ||
    left.window.windowId.localeCompare(right.window.windowId) ||
    left.targetItemId - right.targetItemId,
  )[0];
  if (!best) return emptyResult();

  return {
    windowStates: [{
      windowId: best.window.windowId,
      state: 'OPEN',
      targetItemIds: [best.targetItemId],
      reasonCodes: ['SITUATIONAL_ACCEPTED'],
    }],
    contextByTargetItemId: new Map([[best.targetItemId, best.context]]),
  };
}

function scorerContext(input: ResolveSituationalPlanInputV1): AdaptiveItemScoreContextV1 {
  return {
    heroId: input.decision.state.heroId,
    enemyHeroIds: input.decision.enemyHeroIds,
    gameTimeSec: input.decision.state.gameTimeSec,
    gameStateBlend: gameStateBlend(input.decision),
    ownedItemIds: [...input.decision.state.inventory.heldByItemId.keys()].sort((left, right) => left - right),
    plannedPrefixItemIds: [],
    evidence: input.evidence,
  };
}

function gameStateBlend(decision: AdaptiveDecisionStateV1): AdaptiveGameStateBlendV1 {
  const delta = computeSoulDeltaV1(decision.ourTeamSouls, decision.enemyTeamSouls);
  return delta === undefined
    ? { ahead: 0, even: 0, behind: 0 }
    : computeAdaptiveGameStateBlendV1(
        delta,
        ADAPTIVE_POLICY_V1_CONFIG.gameStateThreshold,
        ADAPTIVE_POLICY_V1_CONFIG.gameStateBlendWidth,
      );
}

function coreTarget(
  plan: ResolveSituationalPlanInputV1['corePlan'],
): number | undefined {
  return plan.nextTargetItemId ??
    plan.recommendedBuild.find((item) => item.status === 'NEXT')?.itemId ??
    plan.nextAction.targetItemId ??
    plan.nextAction.buyItemId ??
    plan.nextAction.itemId;
}

function executableAcquisitionCost(
  decision: AdaptiveDecisionStateV1,
  targetItemId: number,
): number | undefined {
  const resolution = resolveUpgradeExecutionPathV1(decision.state, targetItemId, decision.itemGraph);
  if (resolution.kind === 'EXACT_OWNED' || resolution.kind === 'NOT_EXECUTABLE') return undefined;
  if (resolution.kind === 'DIRECT_BUY') {
    const cost = decision.itemGraph.getItem(resolution.targetItemId)?.directPurchaseCost;
    return finiteNonNegative(cost);
  }
  if (resolution.kind === 'DIRECT_UPGRADE') {
    const recipe = decision.itemGraph.getItem(resolution.targetItemId)?.upgradeRecipes
      .find((entry) => entry.recipeId === resolution.recipeId);
    return finiteNonNegative(recipe?.soulsCost);
  }
  const recipe = decision.itemGraph.getItem(resolution.nextTargetItemId)?.upgradeRecipes
    .find((entry) => entry.recipeId === resolution.nextRecipeId);
  return finiteNonNegative(recipe?.soulsCost);
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function enrichEnemyHeroNames(
  context: AdaptiveSituationalContextV1,
  decision: AdaptiveDecisionStateV1,
): AdaptiveSituationalContextV1 {
  const names = new Map(
    (decision.enemyHeroes ?? [])
      .filter((hero) => hero.heroName)
      .map((hero) => [hero.heroId, hero.heroName!] as const),
  );
  return {
    ...context,
    targetEnemies: context.targetEnemies.map((target) => {
      const heroName = names.get(target.enemyHeroId);
      return heroName ? { ...target, enemyHeroName: heroName } : target;
    }),
  };
}

function emptyResult(): ResolveSituationalPlanResultV1 {
  return { windowStates: [], contextByTargetItemId: new Map() };
}
