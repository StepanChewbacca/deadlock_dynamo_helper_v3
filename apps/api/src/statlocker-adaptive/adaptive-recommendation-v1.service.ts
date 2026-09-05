import { Injectable } from '@nestjs/common';
import {
  DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
  RecommendationCandidate,
  generateRecommendationCandidates,
} from '@deadlock-live-probe/build-domain';
import {
  AdaptiveActionV1,
  AdaptiveRecommendationRequestV1,
  AdaptiveRecommendationResultV1,
  AdaptiveRecommendationStrategyV1,
  AdaptiveScoredActionV1,
} from '@deadlock-live-probe/shared';
import { AdaptiveBuildPlannerV1Service } from './adaptive-build-planner-v1.service';
import {
  AdaptiveDecisionStateV1,
  AdaptiveDecisionStateV1Service,
} from './adaptive-decision-state-v1.service';
import { AdaptiveRecommendationObservabilityV1Service } from './adaptive-recommendation-observability-v1.service';
import { AdaptiveReplayV1Service } from './adaptive-replay-v1.service';
import {
  AdaptiveScoringDatasetV1,
  StatlockerEvidenceBundleV1,
  StatlockerEvidenceService,
} from './statlocker-evidence.service';
import { ADAPTIVE_POLICY_V1_CONFIG } from './statlocker-adaptive.config';
import { StatlockerEvidenceFamilyV1 } from './statlocker-adaptive.types';

const SCORER_VERSION = 'adaptive-evidence-scorer-v1';

type AdaptivePlannerRuntimeResultV1 = ReturnType<AdaptiveBuildPlannerV1Service['plan']> & {
  strategy?: AdaptiveRecommendationStrategyV1;
};

@Injectable()
export class AdaptiveRecommendationV1Service {
  constructor(
    private readonly decisionState: AdaptiveDecisionStateV1Service,
    private readonly evidence: StatlockerEvidenceService,
    private readonly planner: AdaptiveBuildPlannerV1Service,
    private readonly replay: AdaptiveReplayV1Service,
    private readonly observability: AdaptiveRecommendationObservabilityV1Service = new AdaptiveRecommendationObservabilityV1Service(),
  ) {}

  async recommend(request: AdaptiveRecommendationRequestV1): Promise<AdaptiveRecommendationResultV1> {
    validateRequest(request);
    const initial = await this.decisionState.build(request.matchId, request.localSteamId);
    this.observability.recordDecisionState(initial);
    const previous = await this.replay.getPreviousPlan(initial.state.matchId, initial.localSteamId);
    const patchId = this.evidence.resolveLocalPatchId(initial.rulesetId, initial.catalogSha256) ?? 'UNKNOWN';
    const evidenceRequest = {
      heroId: initial.state.heroId,
      rulesetVersion: initial.rulesetId,
      catalogSha256: initial.catalogSha256,
      statlockerPatchId: patchId,
    };
    const getEvidence = (this.evidence as any).getEvidence;
    const localEvidence = typeof getEvidence === 'function'
      ? getEvidence.call(this.evidence, evidenceRequest)
      : this.evidence.getLocalEvidence(evidenceRequest);
    this.observability.recordEvidence(localEvidence);

    let planned: AdaptivePlannerRuntimeResultV1 | undefined = localEvidence.usable
      ? (() => {
          const plannerStartedAt = Date.now();
          const result = this.planner.plan({
            decision: initial,
            evidence: localEvidence,
            previousResult: previous,
            recentPurchasedItemIds: [],
            recentSoldItemIds: [],
          }) as AdaptivePlannerRuntimeResultV1;
          this.observability.recordPlannerLatency(Date.now() - plannerStartedAt);
          return result;
        })()
      : undefined;

    const fresh = await this.decisionState.build(request.matchId, request.localSteamId);
    if (localEvidence.usable && planned && fresh.stateRevision !== initial.stateRevision) {
      const plannerStartedAt = Date.now();
      planned = this.planner.plan({
        decision: fresh,
        evidence: localEvidence,
        previousResult: previous,
        recentPurchasedItemIds: [],
        recentSoldItemIds: [],
        suppressObservability: true,
      }) as AdaptivePlannerRuntimeResultV1;
      this.observability.recordPlannerLatency(Date.now() - plannerStartedAt);
    }
    const freshCandidates = generateRecommendationCandidates({
      state: fresh.state,
      itemGraph: fresh.itemGraph,
      rules: finalLegalityRules(fresh),
    });
    const feasibleByActionKey = new Map(
      freshCandidates
        .filter((candidate) => candidate.feasible && candidate.recommendationEligible)
        .map((candidate) => [candidate.actionId, candidate]),
    );

    const blockers = new Set<string>(localEvidence.degradedReasons);
    let result: AdaptiveRecommendationResultV1;
    let legalityFallback = false;
    let legalityFallbackReasonCodes: readonly string[] = [];

    if (!localEvidence.usable) {
      blockers.add('STATLOCKER_EVIDENCE_UNAVAILABLE');
      result = previous
        ? previousEvidenceFallback(previous, fresh, localEvidence, blockers)
        : emptyEvidenceFallback(fresh, localEvidence, blockers, feasibleByActionKey);
    } else if (planned) {
      const freshBuild = rebasePlanAgainstDecisionV1(planned.recommendedBuild, fresh);
      const freshRanked = planned.rankedImmediateCandidates.filter(({ action }) =>
        feasibleByActionKey.has(action.actionKey),
      );
      const legality = selectFreshLegalAction(planned.nextAction, freshRanked, feasibleByActionKey, freshBuild);
      if (legality.changed || fresh.stateRevision !== initial.stateRevision) {
        blockers.add('STATE_CHANGED_LEGALITY_RECHECK');
      }
      legalityFallback = legality.changed;
      legalityFallbackReasonCodes = legality.action.reasonCodes ?? [];
      result = {
        ready: true,
        blockers: [...blockers].sort(),
        decisionId: fresh.state.decisionId,
        stateRevision: fresh.stateRevision,
        gameState: planned.gameState,
        nextAction: legality.action,
        nextTargetItemId: firstNextTarget(freshBuild) ?? legality.action.targetItemId,
        recommendedBuild: freshBuild,
        changes: planned.changes,
        rankedImmediateCandidates: freshRanked,
        totalScore: planned.totalScore,
        confidence: clamp01(planned.confidence * (legality.changed ? 0.85 : 1)),
        scorerVersion: SCORER_VERSION,
        plannerVersion: planned.plannerVersion,
        configVersion: ADAPTIVE_POLICY_V1_CONFIG.version,
        strategy: planned.strategy,
        evidence: toProvenance(localEvidence),
      };
    } else {
      throw new Error('Adaptive planner did not produce a result');
    }

    this.observability.recordRecommendationOutcome({
      evidence: localEvidence,
      decision: fresh,
      previousResult: previous,
      result,
      legalityFallback,
      legalityFallbackReasonCodes,
    });

    const replayInput = this.replay.toReplayInput(fresh, localEvidence, {
      previousResult: previous,
      recentPurchasedItemIds: [],
      recentSoldItemIds: [],
    });
    await this.replay.persist({
      decisionId: result.decisionId,
      matchId: resultMatchId(fresh),
      playerKey: fresh.localSteamId,
      stateRevision: result.stateRevision,
      replayInput,
      result,
    });
    return result;
  }
}

export function finalLegalityRules(decision: AdaptiveDecisionStateV1) {
  const slots = decision.slots;
  if (!slots) return DEFAULT_RECOMMENDATION_CANDIDATE_RULES;
  return {
    ...DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
    baseSlots: slots.baseSlots,
    baseSlotsByType: { ...slots.baseSlotsByType },
    maxFlexSlots: slots.maxFlexSlots,
    unlockedFlexSlots: slots.unlockedFlexSlots,
    flexCapacityEvidence: slots.evidence,
    maxActiveItems: slots.maxActiveItems,
  };
}

function selectFreshLegalAction(
  selected: AdaptiveActionV1,
  ranked: readonly AdaptiveScoredActionV1[],
  feasibleByActionKey: ReadonlyMap<string, RecommendationCandidate>,
  build: AdaptiveRecommendationResultV1['recommendedBuild'],
): { action: AdaptiveActionV1; changed: boolean } {
  const targetItemId = firstNextTarget(build);
  if (!isTransactionAction(selected)) {
    if (selected.actionKey === 'WAIT' || selected.actionKey === 'HOLD' || selected.actionKey === 'CONTINUE_CORE' || selected.actionKey === 'ABSTAIN') {
      const action = rebasePlanTarget(selected, build, feasibleByActionKey);
      return { action, changed: actionWasRewritten(selected, action) };
    }
    if (feasibleByActionKey.has(selected.actionKey)) {
      const action = rebasePlanTarget(selected, build, feasibleByActionKey);
      return { action, changed: actionWasRewritten(selected, action) };
    }
  } else {
    const candidate = feasibleByActionKey.get(selected.actionKey);
    if (candidate && selectedActionServesFreshNext(selected, targetItemId)) {
      const action = canonicalFreshAction(selected, candidate, targetItemId);
      return { action, changed: actionWasRewritten(selected, action) };
    }
  }

  for (const scored of ranked) {
    const candidate = feasibleByActionKey.get(scored.action.actionKey);
    if (!candidate || !fallbackActionServesFreshNext(scored.action, targetItemId)) continue;
    return {
      action: withFreshLegalityFallback(canonicalFreshAction(scored.action, candidate, targetItemId)),
      changed: true,
    };
  }

  return {
    action: {
      actionKey: freshWaitActionKey(targetItemId, feasibleByActionKey),
      type: 'WAIT',
      targetItemId,
      reasonCodes: ['NO_FRESH_LEGAL_TRANSACTION'],
    },
    changed: true,
  };
}

function actionWasRewritten(before: AdaptiveActionV1, after: AdaptiveActionV1): boolean {
  return before.actionKey !== after.actionKey ||
    before.type !== after.type ||
    before.targetItemId !== after.targetItemId ||
    before.itemId !== after.itemId ||
    before.sellItemId !== after.sellItemId ||
    before.buyItemId !== after.buyItemId;
}

function previousEvidenceFallback(
  previous: AdaptiveRecommendationResultV1,
  fresh: AdaptiveDecisionStateV1,
  evidence: StatlockerEvidenceBundleV1,
  blockers: ReadonlySet<string>,
): AdaptiveRecommendationResultV1 {
  const ownedItemIds = [...fresh.state.inventory.heldByItemId.keys()];
  const preservedBuild = rebasePlanAgainstDecisionV1(previous.recommendedBuild, fresh);
  const previousTarget = previous.nextTargetItemId;
  const targetItemId = firstNextTarget(preservedBuild)
    ?? (previousTarget !== undefined && !fresh.itemGraph.isTargetSatisfied(previousTarget, ownedItemIds)
      ? previousTarget
      : undefined);
  return {
    ...previous,
    decisionId: fresh.state.decisionId,
    stateRevision: fresh.stateRevision,
    blockers: [...blockers].sort(),
    nextAction: {
      actionKey: 'HOLD',
      type: 'HOLD',
      targetItemId,
      reasonCodes: ['STATLOCKER_UNAVAILABLE_PRESERVE_PLAN'],
    },
    nextTargetItemId: targetItemId,
    recommendedBuild: preservedBuild,
    changes: [],
    rankedImmediateCandidates: [],
    confidence: clamp01(previous.confidence * 0.5),
    scorerVersion: SCORER_VERSION,
    plannerVersion: 'adaptive-build-planner-v1',
    configVersion: ADAPTIVE_POLICY_V1_CONFIG.version,
    evidence: toProvenance(evidence),
  };
}

function emptyEvidenceFallback(
  fresh: AdaptiveDecisionStateV1,
  evidence: StatlockerEvidenceBundleV1,
  blockers: ReadonlySet<string>,
  feasibleByActionKey: ReadonlyMap<string, RecommendationCandidate>,
): AdaptiveRecommendationResultV1 {
  const wait = [...feasibleByActionKey.values()]
    .filter((candidate) => candidate.action.type === 'WAIT_SAVE')
    .sort((a, b) => a.actionId.localeCompare(b.actionId))[0];
  return {
    ready: true,
    blockers: [...blockers].sort(),
    decisionId: fresh.state.decisionId,
    stateRevision: fresh.stateRevision,
    gameState: 'UNKNOWN',
    nextAction: {
      actionKey: wait?.actionId ?? 'ABSTAIN',
      type: wait ? 'WAIT' : 'ABSTAIN',
      reasonCodes: ['NO_USABLE_STATLOCKER_EVIDENCE'],
    },
    recommendedBuild: [],
    changes: [],
    rankedImmediateCandidates: [],
    totalScore: 0,
    confidence: 0,
    scorerVersion: SCORER_VERSION,
    plannerVersion: 'adaptive-build-planner-v1',
    configVersion: ADAPTIVE_POLICY_V1_CONFIG.version,
    evidence: toProvenance(evidence),
  };
}

function unavailableEvidence(decision: AdaptiveDecisionStateV1, patchId: string): StatlockerEvidenceBundleV1 {
  const unavailable = (dataset: AdaptiveScoringDatasetV1, scopeKey: string): StatlockerEvidenceFamilyV1 => ({
    dataset,
    scopeKey,
    freshness: 'UNAVAILABLE',
    confidence: 0,
  });
  const byDataset = {
    WPA_PATCH_DATA: unavailable('WPA_PATCH_DATA', `patch:${patchId}`),
    VS_HERO_WPA: unavailable('VS_HERO_WPA', 'global'),
    T4_CHAINS: unavailable('T4_CHAINS', 'global'),
    CONSENSUS_SKELETON: unavailable('CONSENSUS_SKELETON', `hero:${decision.state.heroId}:consensus`),
    WPA_FILTERED_ITEMS: unavailable('WPA_FILTERED_ITEMS', `hero:${decision.state.heroId}`),
  };
  return {
    heroId: decision.state.heroId,
    rulesetVersion: decision.rulesetId,
    catalogSha256: decision.catalogSha256.toLowerCase(),
    statlockerPatchId: patchId,
    usable: false,
    snapshotIds: [],
    degradedReasons: [
      'CONSENSUS_SKELETON:UNAVAILABLE',
      'T4_CHAINS:UNAVAILABLE',
      'VS_HERO_WPA:UNAVAILABLE',
      'WPA_PATCH_DATA:UNAVAILABLE',
    ],
    families: [
      byDataset.WPA_PATCH_DATA,
      byDataset.VS_HERO_WPA,
      byDataset.T4_CHAINS,
      byDataset.CONSENSUS_SKELETON,
      byDataset.WPA_FILTERED_ITEMS,
    ],
    byDataset,
  };
}

function toProvenance(evidence: StatlockerEvidenceBundleV1): AdaptiveRecommendationResultV1['evidence'] {
  return {
    rulesetVersion: evidence.rulesetVersion,
    catalogSha256: evidence.catalogSha256,
    statlockerPatchId: evidence.statlockerPatchId,
    snapshotIds: [...evidence.snapshotIds].sort(),
    families: evidence.families.map((family) => ({
      dataset: family.dataset,
      freshness: family.freshness,
      snapshotId: family.snapshotId,
      contentSha256: family.contentSha256,
      fetchedAt: family.fetchedAt,
      confidence: family.confidence,
    })),
    degradedReasons: [...evidence.degradedReasons].sort(),
  };
}

function isTransactionAction(action: AdaptiveActionV1): boolean {
  return action.type === 'BUY' || action.type === 'UPGRADE' || action.type === 'SELL' || action.type === 'REPLACE';
}

function transactionTargetsNextItem(action: AdaptiveActionV1): boolean {
  return action.type === 'BUY' || action.type === 'UPGRADE' || action.type === 'REPLACE';
}

function selectedActionServesFreshNext(action: AdaptiveActionV1, targetItemId: number | undefined): boolean {
  if (action.type === 'SELL') return targetItemId !== undefined;
  return !transactionTargetsNextItem(action) || action.targetItemId === targetItemId;
}

function fallbackActionServesFreshNext(action: AdaptiveActionV1, targetItemId: number | undefined): boolean {
  if (action.type === 'SELL') return targetItemId !== undefined && action.targetItemId === targetItemId;
  return !transactionTargetsNextItem(action) || action.targetItemId === targetItemId;
}

function canonicalFreshAction(
  planned: AdaptiveActionV1,
  candidate: RecommendationCandidate,
  semanticNextTargetItemId: number | undefined,
): AdaptiveActionV1 {
  const action = candidate.action;
  if (action.type === 'BUY_ITEM') {
    return {
      ...planned,
      actionKey: candidate.actionId,
      type: 'BUY',
      itemId: action.itemId,
      targetItemId: action.itemId,
    };
  }
  if (action.type === 'UPGRADE_ITEM') {
    return {
      ...planned,
      actionKey: candidate.actionId,
      type: 'UPGRADE',
      itemId: action.itemId,
      targetItemId: action.itemId,
    };
  }
  if (action.type === 'REPLACE_ITEM') {
    return {
      ...planned,
      actionKey: candidate.actionId,
      type: 'REPLACE',
      sellItemId: action.sellItemId,
      buyItemId: action.buyItemId,
      targetItemId: action.buyItemId,
    };
  }
  if (action.type === 'SELL_ITEM') {
    return {
      ...planned,
      actionKey: candidate.actionId,
      type: 'SELL',
      itemId: action.itemId,
      sellItemId: action.itemId,
      targetItemId: semanticNextTargetItemId,
    };
  }
  return {
    ...planned,
    actionKey: candidate.actionId,
    type: 'WAIT',
    targetItemId: semanticNextTargetItemId,
  };
}

function firstNextTarget(build: AdaptiveRecommendationResultV1['recommendedBuild']): number | undefined {
  return build.find((item) => item.status === 'NEXT')?.itemId;
}

function rebasePlanTarget(
  action: AdaptiveActionV1,
  build: AdaptiveRecommendationResultV1['recommendedBuild'],
  feasibleByActionKey: ReadonlyMap<string, RecommendationCandidate>,
): AdaptiveActionV1 {
  if (action.type !== 'WAIT' && action.type !== 'HOLD' && action.type !== 'CONTINUE_CORE') return action;
  const targetItemId = firstNextTarget(build);
  return {
    ...action,
    actionKey: isWaitSaveActionKey(action.actionKey)
      ? freshWaitActionKey(targetItemId, feasibleByActionKey)
      : action.actionKey,
    targetItemId,
  };
}

function withFreshLegalityFallback(action: AdaptiveActionV1): AdaptiveActionV1 {
  return {
    ...action,
    reasonCodes: unique([...action.reasonCodes, 'FRESH_LEGALITY_FALLBACK']),
  };
}

function freshWaitActionKey(
  targetItemId: number | undefined,
  feasibleByActionKey: ReadonlyMap<string, RecommendationCandidate>,
): string {
  const targetedActionKey = targetItemId === undefined ? 'WAIT_SAVE' : `WAIT_SAVE:${targetItemId}`;
  const targetedWait = feasibleByActionKey.get(targetedActionKey);
  if (targetedWait?.action.type === 'WAIT_SAVE') return targetedWait.actionId;
  const genericWait = feasibleByActionKey.get('WAIT_SAVE');
  return genericWait?.action.type === 'WAIT_SAVE' ? genericWait.actionId : 'WAIT';
}

function isWaitSaveActionKey(actionKey: string): boolean {
  return actionKey === 'WAIT_SAVE' || actionKey.startsWith('WAIT_SAVE:');
}

export function rebasePlanAgainstDecisionV1(
  build: AdaptiveRecommendationResultV1['recommendedBuild'],
  decision: Pick<AdaptiveDecisionStateV1, 'state' | 'itemGraph'>,
): AdaptiveRecommendationResultV1['recommendedBuild'] {
  const ownedItemIds = [...decision.state.inventory.heldByItemId.keys()];
  const owned = new Set(ownedItemIds);
  const relevant = build.filter((item) =>
    owned.has(item.itemId) || !decision.itemGraph.isTargetSatisfied(item.itemId, ownedItemIds),
  );
  let nextAssigned = false;
  return relevant.map((item, index) => {
    let status: typeof item.status;
    if (owned.has(item.itemId)) {
      status = 'OWNED';
    } else if (!nextAssigned) {
      status = 'NEXT';
      nextAssigned = true;
    } else {
      status = 'PLANNED';
    }
    return { ...item, position: index + 1, status };
  });
}

function resultMatchId(decision: AdaptiveDecisionStateV1): string {
  return decision.state.matchId;
}

function validateRequest(request: AdaptiveRecommendationRequestV1): void {
  if (!request || typeof request.matchId !== 'string' || request.matchId.trim() === '') {
    throw new Error('Adaptive recommendation matchId is required');
  }
  if (request.localSteamId !== undefined && (typeof request.localSteamId !== 'string' || request.localSteamId.trim() === '')) {
    throw new Error('Adaptive recommendation localSteamId is invalid');
  }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
