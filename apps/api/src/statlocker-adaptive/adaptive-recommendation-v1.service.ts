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
  AdaptiveScoredActionV1,
} from '@deadlock-live-probe/shared';
import { AdaptiveBuildPlannerV1Service } from './adaptive-build-planner-v1.service';
import {
  AdaptiveDecisionStateV1,
  AdaptiveDecisionStateV1Service,
} from './adaptive-decision-state-v1.service';
import { AdaptiveReplayV1Service } from './adaptive-replay-v1.service';
import {
  AdaptiveScoringDatasetV1,
  StatlockerEvidenceBundleV1,
  StatlockerEvidenceService,
} from './statlocker-evidence.service';
import { ADAPTIVE_POLICY_V1_CONFIG } from './statlocker-adaptive.config';
import { StatlockerEvidenceFamilyV1 } from './statlocker-adaptive.types';

const SCORER_VERSION = 'adaptive-evidence-scorer-v1';

@Injectable()
export class AdaptiveRecommendationV1Service {
  constructor(
    private readonly decisionState: AdaptiveDecisionStateV1Service,
    private readonly evidence: StatlockerEvidenceService,
    private readonly planner: AdaptiveBuildPlannerV1Service,
    private readonly replay: AdaptiveReplayV1Service,
  ) {}

  async recommend(request: AdaptiveRecommendationRequestV1): Promise<AdaptiveRecommendationResultV1> {
    validateRequest(request);
    const initial = await this.decisionState.build(request.matchId, request.localSteamId);
    const previous = await this.replay.getPreviousPlan(initial.state.matchId, initial.localSteamId);
    const patchId = this.evidence.resolveLocalPatchId(initial.rulesetId, initial.catalogSha256) ?? 'UNKNOWN';
    const localEvidence = this.evidence.getLocalEvidence({
      heroId: initial.state.heroId,
      rulesetVersion: initial.rulesetId,
      catalogSha256: initial.catalogSha256,
      statlockerPatchId: patchId,
    });

    const planned = localEvidence.usable
      ? this.planner.plan({
          decision: initial,
          evidence: localEvidence,
          previousResult: previous,
          recentPurchasedItemIds: [],
          recentSoldItemIds: [],
        })
      : undefined;

    const fresh = await this.decisionState.build(request.matchId, request.localSteamId);
    const freshCandidates = generateRecommendationCandidates({
      state: fresh.state,
      itemGraph: fresh.itemGraph,
      rules: {
        ...DEFAULT_RECOMMENDATION_CANDIDATE_RULES,
        baseSlots: fresh.slots.baseSlots,
        maxFlexSlots: fresh.slots.maxFlexSlots,
        unlockedFlexSlots: fresh.slots.unlockedFlexSlots,
        flexCapacityEvidence: fresh.slots.evidence,
      },
    });
    const feasibleByActionKey = new Map(
      freshCandidates
        .filter((candidate) => candidate.feasible)
        .map((candidate) => [candidate.actionId, candidate]),
    );

    const blockers = new Set<string>(localEvidence.degradedReasons);
    let result: AdaptiveRecommendationResultV1;

    if (!localEvidence.usable) {
      blockers.add('STATLOCKER_EVIDENCE_UNAVAILABLE');
      result = previous
        ? previousEvidenceFallback(previous, fresh, localEvidence, blockers)
        : emptyEvidenceFallback(fresh, localEvidence, blockers, feasibleByActionKey);
    } else if (planned) {
      const freshOwnedItemIds = new Set(fresh.state.inventory.heldByItemId.keys());
      const freshBuild = rebasePlanAgainstOwnedInventory(
        planned.recommendedBuild,
        [...freshOwnedItemIds],
      );
      const freshRanked = planned.rankedImmediateCandidates.filter(({ action }) =>
        feasibleByActionKey.has(action.actionKey)
        && !targetsOwnedItem(action, freshOwnedItemIds),
      );
      const legality = selectFreshLegalAction(planned.nextAction, freshRanked, feasibleByActionKey, freshBuild);
      if (legality.changed || fresh.stateRevision !== initial.stateRevision) {
        blockers.add('STATE_CHANGED_LEGALITY_RECHECK');
      }
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
        evidence: toProvenance(localEvidence),
      };
    } else {
      throw new Error('Adaptive planner did not produce a result');
    }

    const replayInput = this.replay.toReplayInput(initial, localEvidence, {
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

function selectFreshLegalAction(
  selected: AdaptiveActionV1,
  ranked: readonly AdaptiveScoredActionV1[],
  feasibleByActionKey: ReadonlyMap<string, RecommendationCandidate>,
  build: AdaptiveRecommendationResultV1['recommendedBuild'],
): { action: AdaptiveActionV1; changed: boolean } {
  if (!isTransactionAction(selected)) {
    if (selected.actionKey === 'WAIT' || selected.actionKey === 'HOLD' || selected.actionKey === 'CONTINUE_CORE' || selected.actionKey === 'ABSTAIN') {
      return { action: rebasePlanTarget(selected, build, feasibleByActionKey), changed: false };
    }
    if (feasibleByActionKey.has(selected.actionKey)) return { action: rebasePlanTarget(selected, build, feasibleByActionKey), changed: false };
  } else if (feasibleByActionKey.has(selected.actionKey)) {
    return { action: selected, changed: false };
  }

  const targetItemId = firstNextTarget(build);
  for (const scored of ranked) {
    if (!feasibleByActionKey.has(scored.action.actionKey)) continue;
    if (transactionTargetsNextItem(scored.action) && scored.action.targetItemId !== targetItemId) continue;
    return {
      action: scored.action.type === 'WAIT'
        ? withFreshLegalityFallback(rebasePlanTarget(scored.action, build, feasibleByActionKey))
        : {
            ...scored.action,
            reasonCodes: unique([...scored.action.reasonCodes, 'FRESH_LEGALITY_FALLBACK']),
          },
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

function previousEvidenceFallback(
  previous: AdaptiveRecommendationResultV1,
  fresh: AdaptiveDecisionStateV1,
  evidence: StatlockerEvidenceBundleV1,
  blockers: ReadonlySet<string>,
): AdaptiveRecommendationResultV1 {
  const ownedItemIds = [...fresh.state.inventory.heldByItemId.keys()];
  const preservedBuild = rebasePlanAgainstOwnedInventory(previous.recommendedBuild, ownedItemIds);
  const owned = new Set(ownedItemIds);
  const previousTarget = previous.nextTargetItemId;
  const targetItemId = firstNextTarget(preservedBuild)
    ?? (previousTarget !== undefined && !owned.has(previousTarget) ? previousTarget : undefined);
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

function targetsOwnedItem(action: AdaptiveActionV1, ownedItemIds: ReadonlySet<number>): boolean {
  return action.targetItemId !== undefined && ownedItemIds.has(action.targetItemId);
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

function rebasePlanAgainstOwnedInventory(
  build: AdaptiveRecommendationResultV1['recommendedBuild'],
  ownedItemIds: readonly number[],
): AdaptiveRecommendationResultV1['recommendedBuild'] {
  const owned = new Set(ownedItemIds);
  let nextAssigned = false;
  return build.map((item, index) => {
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
