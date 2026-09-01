import { Injectable } from '@nestjs/common';
import {
  RecommendationCandidate,
  generateRecommendationCandidates,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptiveActionV1,
  AdaptiveBuildPlanChangeV1,
  AdaptivePlannedItemV1,
  AdaptiveRecommendationResultV1,
  AdaptiveScoredActionV1,
  AdaptiveScoreComponentV1,
} from '@deadlock-live-probe/shared';
import { ADAPTIVE_POLICY_V1_CONFIG } from './statlocker-adaptive.config';
import {
  AdaptiveEvidenceScorerV1Service,
  AdaptiveItemScoreV1,
} from './adaptive-evidence-scorer-v1.service';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';
import { StatlockerEvidenceBundleV1 } from './statlocker-evidence.service';
import {
  classifyAdaptiveGameStateV1,
  computeAdaptiveGameStateBlendV1,
  computeSoulDeltaV1,
  AdaptiveGameStateV1,
} from './adaptive-game-state';
import {
  ConsensusSkeletonV1,
  StatlockerT4ChainsV1,
  StatlockerVsHeroWpaV1,
  StatlockerWpaPatchDataV1,
} from './statlocker-adaptive.types';

export interface AdaptiveBuildPlannerInputV1 {
  decision: AdaptiveDecisionStateV1;
  evidence: StatlockerEvidenceBundleV1;
  previousResult?: Pick<
    AdaptiveRecommendationResultV1,
    'recommendedBuild' | 'totalScore' | 'nextAction' | 'confidence'
  >;
  recentPurchasedItemIds?: readonly number[];
  recentSoldItemIds?: readonly number[];
}

export interface AdaptiveBuildPlannerResultV1 {
  gameState: AdaptiveGameStateV1;
  nextAction: AdaptiveActionV1;
  recommendedBuild: readonly AdaptivePlannedItemV1[];
  changes: readonly AdaptiveBuildPlanChangeV1[];
  rankedImmediateCandidates: readonly AdaptiveScoredActionV1[];
  totalScore: number;
  confidence: number;
  plannerVersion: 'adaptive-build-planner-v1';
}

interface ScoredImmediateCandidateV1 {
  candidate: RecommendationCandidate;
  adaptive: AdaptiveScoredActionV1;
  score: number;
  confidence: number;
}

interface BeamNodeV1 {
  itemIds: readonly number[];
  score: number;
  confidenceSum: number;
}

@Injectable()
export class AdaptiveBuildPlannerV1Service {
  readonly version = 'adaptive-build-planner-v1' as const;

  constructor(private readonly scorer: AdaptiveEvidenceScorerV1Service) {}

  plan(input: AdaptiveBuildPlannerInputV1): AdaptiveBuildPlannerResultV1 {
    const config = ADAPTIVE_POLICY_V1_CONFIG;
    const soulDelta = computeSoulDeltaV1(input.decision.ourTeamSouls, input.decision.enemyTeamSouls);
    const gameState = classifyAdaptiveGameStateV1(
      input.decision.ourTeamSouls,
      input.decision.enemyTeamSouls,
      config.gameStateThreshold,
    );
    const gameStateBlend = soulDelta === undefined
      ? { ahead: 0, even: 0, behind: 0 }
      : computeAdaptiveGameStateBlendV1(soulDelta, config.gameStateThreshold, config.gameStateBlendWidth);
    const recentPurchased = new Set(input.recentPurchasedItemIds ?? []);
    const recentSold = new Set(input.recentSoldItemIds ?? []);
    const ownedItemIds = [...input.decision.state.inventory.heldByItemId.keys()].sort((a, b) => a - b);
    const scorerContext = {
      heroId: input.decision.state.heroId,
      enemyHeroIds: input.decision.enemyHeroIds,
      gameTimeSec: input.decision.state.gameTimeSec,
      gameStateBlend,
      ownedItemIds,
      plannedPrefixItemIds: [] as number[],
      evidence: input.evidence,
    };

    const allCandidates = generateRecommendationCandidates({
      state: input.decision.state,
      itemGraph: input.decision.itemGraph,
    });
    const feasibleCandidates = allCandidates.filter((candidate) =>
      candidate.feasible && !isProtectedSell(candidate, recentPurchased),
    );
    const scoredImmediate = feasibleCandidates
      .map((candidate) => this.scoreImmediateCandidate(candidate, scorerContext, recentSold))
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.candidate.actionId.localeCompare(b.candidate.actionId));

    const futurePool = this.buildFuturePool(input, ownedItemIds, scorerContext, recentSold);
    const bestBeam = this.searchFutureTargets(futurePool, scorerContext, recentSold);
    const proposedBuild = this.buildRecommendedBuild(input, ownedItemIds, bestBeam.itemIds, scorerContext, recentSold);
    const proposedScore = bestBeam.score;
    const proposedConfidence = bestBeam.itemIds.length > 0
      ? clamp01(bestBeam.confidenceSum / bestBeam.itemIds.length)
      : aggregateImmediateConfidence(scoredImmediate);

    const previous = input.previousResult;
    const improvement = previous ? proposedScore - previous.totalScore : Number.POSITIVE_INFINITY;
    const preservePrevious = Boolean(
      previous &&
      improvement < config.minPlanSwitchImprovement,
    );

    if (preservePrevious && previous) {
      const wait = bestWaitCandidate(scoredImmediate);
      return {
        gameState,
        nextAction: semanticNoTransactionAction('HOLD', wait?.candidate, firstPlannedItem(previous.recommendedBuild)),
        recommendedBuild: previous.recommendedBuild,
        changes: buildPlanChanges(previous.recommendedBuild, previous.recommendedBuild),
        rankedImmediateCandidates: scoredImmediate.map((entry) => entry.adaptive),
        totalScore: previous.totalScore,
        confidence: Math.min(previous.confidence, proposedConfidence || previous.confidence),
        plannerVersion: this.version,
      };
    }

    const selected = this.selectImmediate(scoredImmediate, input, proposedBuild);
    return {
      gameState,
      nextAction: selected.action,
      recommendedBuild: proposedBuild,
      changes: buildPlanChanges(previous?.recommendedBuild ?? [], proposedBuild),
      rankedImmediateCandidates: scoredImmediate.map((entry) => entry.adaptive),
      totalScore: proposedScore,
      confidence: clamp01(Math.max(selected.confidence, proposedConfidence) * evidenceConfidenceFactor(input.evidence)),
      plannerVersion: this.version,
    };
  }

  private scoreImmediateCandidate(
    candidate: RecommendationCandidate,
    context: Omit<Parameters<AdaptiveEvidenceScorerV1Service['scoreItem']>[1], 'transactionPenalty' | 'churnPenalty'>,
    recentSold: ReadonlySet<number>,
  ): ScoredImmediateCandidateV1 {
    const action = candidate.action;
    let score = 0;
    let confidence = 0;
    let components: readonly AdaptiveScoreComponentV1[] = [];

    if (action.type === 'BUY_ITEM' || action.type === 'UPGRADE_ITEM') {
      const itemScore = this.scorer.scoreItem(action.itemId, {
        ...context,
        transactionPenalty: action.type === 'UPGRADE_ITEM' ? 0.04 : 0.08,
        churnPenalty: recentSold.has(action.itemId) ? 1 : 0,
      });
      score = itemScore.score;
      confidence = itemScore.confidence;
      components = itemScore.components;
    } else if (action.type === 'REPLACE_ITEM') {
      const bought = this.scorer.scoreItem(action.buyItemId, {
        ...context,
        transactionPenalty: 0.18,
        churnPenalty: recentSold.has(action.buyItemId) ? 1 : 0,
      });
      const sold = this.scorer.scoreItem(action.sellItemId, {
        ...context,
        transactionPenalty: 0,
        churnPenalty: 0,
      });
      score = bought.score - Math.max(-1, sold.score) - 0.1;
      confidence = Math.min(bought.confidence, sold.confidence || bought.confidence);
      components = bought.components;
    } else if (action.type === 'SELL_ITEM') {
      const sold = this.scorer.scoreItem(action.itemId, {
        ...context,
        transactionPenalty: 0,
        churnPenalty: 0,
      });
      score = -sold.score - 0.35;
      confidence = sold.confidence;
      components = sold.components.map((component) => ({
        ...component,
        normalized: -component.normalized,
        weighted: -component.weighted,
      }));
    } else if (action.targetItemId !== undefined) {
      const target = this.scorer.scoreItem(action.targetItemId, {
        ...context,
        transactionPenalty: 0,
        churnPenalty: recentSold.has(action.targetItemId) ? 0.75 : 0,
      });
      score = target.score * 0.2;
      confidence = target.confidence;
      components = target.components;
    }

    const adaptiveAction = mapCandidateAction(candidate);
    return {
      candidate,
      score,
      confidence,
      adaptive: {
        action: adaptiveAction,
        score,
        confidence,
        components,
        reasonCodes: immediateReasonCodes(candidate, components),
      },
    };
  }

  private buildFuturePool(
    input: AdaptiveBuildPlannerInputV1,
    ownedItemIds: readonly number[],
    context: Omit<Parameters<AdaptiveEvidenceScorerV1Service['scoreItem']>[1], 'transactionPenalty' | 'churnPenalty'>,
    recentSold: ReadonlySet<number>,
  ): readonly number[] {
    const pool = new Set<number>(ownedItemIds);
    const skeleton = asSkeleton(input.evidence.byDataset.CONSENSUS_SKELETON.payload, input.decision.state.heroId);
    for (const item of skeleton?.items ?? []) pool.add(item.itemId);
    const wpa = asWpa(input.evidence.byDataset.WPA_PATCH_DATA.payload);
    for (const item of wpa?.items ?? []) if (item.heroId === input.decision.state.heroId) pool.add(item.itemId);
    const exact = asExact(input.evidence.byDataset.VS_HERO_WPA.payload);
    const enemies = new Set(input.decision.enemyHeroIds);
    for (const slice of exact?.slices ?? []) {
      if (slice.heroId !== input.decision.state.heroId || !enemies.has(slice.enemyHeroId)) continue;
      for (const item of slice.items) pool.add(item.itemId);
    }
    const chains = asChains(input.evidence.byDataset.T4_CHAINS.payload);
    for (const chain of chains?.chains ?? []) {
      if (chain.heroId === input.decision.state.heroId) for (const itemId of chain.itemIds) pool.add(itemId);
    }

    const valid = [...pool]
      .filter((itemId) => {
        const item = input.decision.itemGraph.getItem(itemId);
        return Boolean(item && item.availableRulesetIds.includes(input.decision.rulesetId));
      })
      .map((itemId) => {
        const score = this.scorer.scoreItem(itemId, {
          ...context,
          transactionPenalty: 0,
          churnPenalty: recentSold.has(itemId) ? 0.75 : 0,
        });
        return { itemId, score: score.score };
      })
      .sort((a, b) => b.score - a.score || a.itemId - b.itemId);

    const top = valid.slice(0, 24).map((entry) => entry.itemId);
    for (const itemId of ownedItemIds) if (!top.includes(itemId)) top.push(itemId);
    return top;
  }

  private searchFutureTargets(
    pool: readonly number[],
    context: Omit<Parameters<AdaptiveEvidenceScorerV1Service['scoreItem']>[1], 'transactionPenalty' | 'churnPenalty'>,
    recentSold: ReadonlySet<number>,
  ): BeamNodeV1 {
    const config = ADAPTIVE_POLICY_V1_CONFIG;
    const owned = new Set(context.ownedItemIds);
    let beam: BeamNodeV1[] = [{ itemIds: [], score: 0, confidenceSum: 0 }];
    let best = beam[0];

    for (let depth = 0; depth < config.planningDepth; depth += 1) {
      const candidates: BeamNodeV1[] = [...beam];
      for (const node of beam) {
        for (const itemId of pool) {
          if (owned.has(itemId) || node.itemIds.includes(itemId)) continue;
          const itemScore = this.scorer.scoreItem(itemId, {
            ...context,
            plannedPrefixItemIds: node.itemIds,
            transactionPenalty: 0,
            churnPenalty: recentSold.has(itemId) ? 0.75 : 0,
          });
          const discounted = itemScore.score * Math.pow(config.futureDiscount, node.itemIds.length);
          candidates.push({
            itemIds: [...node.itemIds, itemId],
            score: node.score + discounted,
            confidenceSum: node.confidenceSum + itemScore.confidence,
          });
        }
      }
      beam = candidates
        .sort((a, b) => b.score - a.score || compareSequences(a.itemIds, b.itemIds))
        .slice(0, config.beamWidth);
      if (beam[0] && (beam[0].score > best.score || (beam[0].score === best.score && compareSequences(beam[0].itemIds, best.itemIds) < 0))) {
        best = beam[0];
      }
    }
    return best;
  }

  private buildRecommendedBuild(
    input: AdaptiveBuildPlannerInputV1,
    ownedItemIds: readonly number[],
    beamItemIds: readonly number[],
    context: Omit<Parameters<AdaptiveEvidenceScorerV1Service['scoreItem']>[1], 'transactionPenalty' | 'churnPenalty'>,
    recentSold: ReadonlySet<number>,
  ): readonly AdaptivePlannedItemV1[] {
    const skeleton = asSkeleton(input.evidence.byDataset.CONSENSUS_SKELETON.payload, input.decision.state.heroId);
    const skeletonOrder = new Map((skeleton?.items ?? []).map((item, index) => [item.itemId, index]));
    const owned = [...ownedItemIds].sort((a, b) =>
      (skeletonOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (skeletonOrder.get(b) ?? Number.MAX_SAFE_INTEGER) || a - b,
    );
    const remainingSkeleton = (skeleton?.items ?? [])
      .map((item) => item.itemId)
      .filter((itemId) => !owned.includes(itemId) && !beamItemIds.includes(itemId));
    const ordered = [...owned, ...beamItemIds, ...remainingSkeleton];
    const firstPlannedIndex = owned.length;

    return ordered.map((itemId, index) => {
      const score = this.scorer.scoreItem(itemId, {
        ...context,
        plannedPrefixItemIds: ordered.slice(firstPlannedIndex, index),
        transactionPenalty: 0,
        churnPenalty: recentSold.has(itemId) ? 0.75 : 0,
      });
      const skeletonItem = skeleton?.items.find((item) => item.itemId === itemId);
      const skeletonWeighted = score.components.find((component) => component.key === 'skeletonPrior')?.weighted ?? 0;
      const contextualSupport = score.score - skeletonWeighted;
      const status = index < owned.length ? 'OWNED' : index === owned.length ? 'NEXT' : 'PLANNED';
      return {
        itemId,
        position: index + 1,
        status,
        score: score.score,
        confidence: score.confidence,
        skeletonStrength: skeletonItem?.strength ?? 0,
        contextualSupport,
        reasonCodes: plannedReasonCodes(score, skeletonItem?.tier),
      } satisfies AdaptivePlannedItemV1;
    });
  }

  private selectImmediate(
    scored: readonly ScoredImmediateCandidateV1[],
    input: AdaptiveBuildPlannerInputV1,
    build: readonly AdaptivePlannedItemV1[],
  ): { action: AdaptiveActionV1; confidence: number } {
    const config = ADAPTIVE_POLICY_V1_CONFIG;
    const wait = bestWaitCandidate(scored);
    const waitScore = wait?.score ?? 0;
    const nextTarget = firstPlannedItem(build);
    const skeleton = asSkeleton(input.evidence.byDataset.CONSENSUS_SKELETON.payload, input.decision.state.heroId);
    const nextSkeleton = skeleton?.items.find((item) => item.itemId === nextTarget);

    for (const entry of scored) {
      const action = entry.candidate.action;
      if (action.type === 'SELL_ITEM') {
        if (entry.score - waitScore < config.sellMinImprovement) continue;
      }
      if (action.type === 'REPLACE_ITEM') {
        const soldIsCore = skeleton?.items.find((item) => item.itemId === action.sellItemId)?.tier === 'CORE';
        const threshold = soldIsCore ? config.coreReplaceMinImprovement : config.sellMinImprovement;
        if (entry.score - waitScore < threshold) continue;
      }
      if (action.type === 'WAIT_SAVE') {
        return {
          action: semanticNoTransactionAction(
            nextSkeleton?.tier === 'CORE' ? 'CONTINUE_CORE' : 'WAIT',
            entry.candidate,
            nextTarget,
          ),
          confidence: entry.confidence,
        };
      }
      return { action: entry.adaptive.action, confidence: entry.confidence };
    }

    return {
      action: semanticNoTransactionAction(
        nextSkeleton?.tier === 'CORE' ? 'CONTINUE_CORE' : 'WAIT',
        wait?.candidate,
        nextTarget,
      ),
      confidence: wait?.confidence ?? 0,
    };
  }
}

function mapCandidateAction(candidate: RecommendationCandidate): AdaptiveActionV1 {
  const action = candidate.action;
  if (action.type === 'BUY_ITEM') {
    return { actionKey: candidate.actionId, type: 'BUY', itemId: action.itemId, targetItemId: action.itemId, reasonCodes: [...candidate.reasons] };
  }
  if (action.type === 'UPGRADE_ITEM') {
    return { actionKey: candidate.actionId, type: 'UPGRADE', itemId: action.itemId, targetItemId: action.itemId, reasonCodes: [...candidate.reasons] };
  }
  if (action.type === 'SELL_ITEM') {
    return { actionKey: candidate.actionId, type: 'SELL', itemId: action.itemId, sellItemId: action.itemId, reasonCodes: [...candidate.reasons] };
  }
  if (action.type === 'REPLACE_ITEM') {
    return {
      actionKey: candidate.actionId,
      type: 'REPLACE',
      sellItemId: action.sellItemId,
      buyItemId: action.buyItemId,
      targetItemId: action.buyItemId,
      reasonCodes: [...candidate.reasons],
    };
  }
  return {
    actionKey: candidate.actionId,
    type: 'WAIT',
    targetItemId: action.targetItemId,
    reasonCodes: [...candidate.reasons],
  };
}

function semanticNoTransactionAction(
  type: 'WAIT' | 'HOLD' | 'CONTINUE_CORE',
  candidate: RecommendationCandidate | undefined,
  targetItemId: number | undefined,
): AdaptiveActionV1 {
  return {
    actionKey: candidate?.actionId ?? type,
    type,
    targetItemId,
    reasonCodes: type === 'HOLD' ? ['PLAN_HYSTERESIS'] : type === 'CONTINUE_CORE' ? ['CORE_TARGET_PENDING'] : ['NO_LEGAL_TRANSACTION_SELECTED'],
  };
}

function isProtectedSell(candidate: RecommendationCandidate, recentPurchased: ReadonlySet<number>): boolean {
  const action = candidate.action;
  if (action.type === 'SELL_ITEM') return recentPurchased.has(action.itemId);
  if (action.type === 'REPLACE_ITEM') return recentPurchased.has(action.sellItemId);
  return false;
}

function bestWaitCandidate(scored: readonly ScoredImmediateCandidateV1[]): ScoredImmediateCandidateV1 | undefined {
  return scored
    .filter((entry) => entry.candidate.action.type === 'WAIT_SAVE')
    .sort((a, b) => b.score - a.score || a.candidate.actionId.localeCompare(b.candidate.actionId))[0];
}

function firstPlannedItem(build: readonly AdaptivePlannedItemV1[]): number | undefined {
  return build.find((item) => item.status === 'NEXT')?.itemId;
}

function immediateReasonCodes(candidate: RecommendationCandidate, components: readonly AdaptiveScoreComponentV1[]): readonly string[] {
  const positive = components
    .filter((component) => component.weighted > 0.05)
    .sort((a, b) => b.weighted - a.weighted || a.key.localeCompare(b.key))
    .slice(0, 3)
    .map((component) => component.key);
  return [...new Set([...candidate.reasons, ...positive])];
}

function plannedReasonCodes(score: AdaptiveItemScoreV1, skeletonTier: string | undefined): readonly string[] {
  const reasons: string[] = [];
  if (skeletonTier === 'CORE') reasons.push('SKELETON_CORE');
  else if (skeletonTier === 'FREQUENT') reasons.push('SKELETON_FREQUENT');
  const positive = score.components
    .filter((component) => component.weighted > 0.05)
    .sort((a, b) => b.weighted - a.weighted || a.key.localeCompare(b.key))
    .slice(0, 3)
    .map((component) => component.key);
  return [...new Set([...reasons, ...positive])];
}

function buildPlanChanges(
  previous: readonly AdaptivePlannedItemV1[],
  next: readonly AdaptivePlannedItemV1[],
): readonly AdaptiveBuildPlanChangeV1[] {
  const previousPosition = new Map(previous.map((item) => [item.itemId, item.position]));
  const nextIds = new Set(next.map((item) => item.itemId));
  const changes: AdaptiveBuildPlanChangeV1[] = [];
  for (const item of next) {
    const oldPosition = previousPosition.get(item.itemId);
    if (oldPosition === undefined) {
      changes.push({ type: 'INSERT', itemId: item.itemId, toPosition: item.position, reasonCodes: ['PLAN_TARGET_ADDED'] });
    } else if (oldPosition === item.position) {
      changes.push({ type: 'KEEP', itemId: item.itemId, fromPosition: oldPosition, toPosition: item.position, reasonCodes: ['PLAN_TARGET_STABLE'] });
    } else {
      changes.push({ type: 'MOVE', itemId: item.itemId, fromPosition: oldPosition, toPosition: item.position, reasonCodes: ['PLAN_TARGET_REORDERED'] });
    }
  }
  for (const item of previous) {
    if (!nextIds.has(item.itemId)) {
      changes.push({ type: 'SKIP', itemId: item.itemId, fromPosition: item.position, reasonCodes: ['PLAN_TARGET_REMOVED'] });
    }
  }
  return changes.sort((a, b) =>
    (a.toPosition ?? Number.MAX_SAFE_INTEGER) - (b.toPosition ?? Number.MAX_SAFE_INTEGER) ||
    (a.fromPosition ?? Number.MAX_SAFE_INTEGER) - (b.fromPosition ?? Number.MAX_SAFE_INTEGER) ||
    (a.itemId ?? 0) - (b.itemId ?? 0),
  );
}

function aggregateImmediateConfidence(scored: readonly ScoredImmediateCandidateV1[]): number {
  if (scored.length === 0) return 0;
  return scored.slice(0, 3).reduce((sum, entry) => sum + entry.confidence, 0) / Math.min(3, scored.length);
}

function evidenceConfidenceFactor(evidence: StatlockerEvidenceBundleV1): number {
  const usable = evidence.families.filter((family) => family.payload !== undefined);
  if (usable.length === 0) return 0.25;
  return clamp01(usable.reduce((sum, family) => sum + family.confidence, 0) / usable.length);
}

function compareSequences(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function asSkeleton(value: unknown, heroId: number): ConsensusSkeletonV1 | undefined {
  if (!isRecord(value) || value.heroId !== heroId || !Array.isArray(value.items)) return undefined;
  return value as unknown as ConsensusSkeletonV1;
}

function asWpa(value: unknown): StatlockerWpaPatchDataV1 | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined;
  return value as unknown as StatlockerWpaPatchDataV1;
}

function asExact(value: unknown): StatlockerVsHeroWpaV1 | undefined {
  if (!isRecord(value) || !Array.isArray(value.slices)) return undefined;
  return value as unknown as StatlockerVsHeroWpaV1;
}

function asChains(value: unknown): StatlockerT4ChainsV1 | undefined {
  if (!isRecord(value) || !Array.isArray(value.chains)) return undefined;
  return value as unknown as StatlockerT4ChainsV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
