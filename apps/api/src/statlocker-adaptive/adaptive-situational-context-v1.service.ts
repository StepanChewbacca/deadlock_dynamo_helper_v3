import { Injectable } from '@nestjs/common';
import {
  AdaptiveSituationalContextV1,
  AdaptiveSituationalEnemyTargetV1,
  AdaptiveSituationalPurposeV1,
} from '@deadlock-live-probe/shared';
import {
  ExactEnemyContributionV1,
  aggregateExactEnemyEvidenceV1,
  exactEnemySlicesFromEvidenceV1,
} from './adaptive-evidence-scorer-v1.service';
import { StatlockerEvidenceBundleV1 } from './statlocker-evidence.service';
import { ADAPTIVE_POLICY_V1_CONFIG } from './statlocker-adaptive.config';

export interface AdaptiveSituationalWindowInputV1 {
  windowId: string;
  open: boolean;
  maxItems: number;
  maxSoulsDelay?: number;
  reservedSlots: number;
  allowedPurposes: readonly AdaptiveSituationalPurposeV1[];
}

export interface EvaluateSituationalCandidateInputV1 {
  heroId: number;
  itemId: number;
  enemyHeroIds: readonly number[];
  evidence: StatlockerEvidenceBundleV1;
  purpose: AdaptiveSituationalPurposeV1;
  window: AdaptiveSituationalWindowInputV1;
  candidateScore: number;
  candidateConfidence: number;
  coreScore: number;
  coreConfidence: number;
  nextCoreTargetItemId?: number;
  estimatedCoreDelaySouls?: number;
  previousTargetEnemyHeroIds?: readonly number[];
}

export interface EvaluateSituationalCandidateResultV1 {
  accepted: boolean;
  context?: AdaptiveSituationalContextV1;
  reasonCodes: readonly string[];
}

@Injectable()
export class AdaptiveSituationalContextV1Service {
  evaluate(input: EvaluateSituationalCandidateInputV1): EvaluateSituationalCandidateResultV1 {
    return evaluateSituationalCandidateV1(input);
  }
}

export function evaluateSituationalCandidateV1(
  input: EvaluateSituationalCandidateInputV1,
): EvaluateSituationalCandidateResultV1 {
  const config = ADAPTIVE_POLICY_V1_CONFIG.situational;
  const reasons: string[] = [];

  if (!input.window.open) return rejected('SITUATIONAL_WINDOW_CLOSED');
  if (!input.window.allowedPurposes.includes(input.purpose)) return rejected('SITUATIONAL_PURPOSE_NOT_ALLOWED');
  if (input.window.maxItems <= 0 || input.window.reservedSlots <= 0) return rejected('SITUATIONAL_WINDOW_NO_CAPACITY');

  const exactFamily = input.evidence.byDataset.VS_HERO_WPA;
  if (exactFamily.freshness !== 'FRESH' || !exactFamily.payload) {
    return rejected('SITUATIONAL_MATCHUP_EVIDENCE_NOT_FRESH');
  }

  const aggregate = aggregateExactEnemyEvidenceV1(
    exactEnemySlicesFromEvidenceV1(exactFamily.payload),
    input.heroId,
    input.itemId,
    input.enemyHeroIds,
    Math.max(config.maxDisplayedTargets, ADAPTIVE_POLICY_V1_CONFIG.exactEnemyMaxMatchups),
    ADAPTIVE_POLICY_V1_CONFIG.shrinkK.exactEnemy,
  );
  const eligible = aggregate.contributions.filter((contribution) =>
    contribution.deltaWpa > 0 &&
    contribution.confidence >= config.minTargetConfidence &&
    contribution.priority >= config.minTargetPriority,
  );
  const stabilized = stabilizeTargets(
    eligible,
    input.previousTargetEnemyHeroIds ?? [],
    config.targetSwitchMinImprovement,
  );
  const selected = stabilized.slice(0, Math.max(1, config.maxDisplayedTargets));
  if (selected.length === 0) return rejected('SITUATIONAL_TARGET_EVIDENCE_INSUFFICIENT');

  const maxDelay = Math.min(
    config.maxCoreDelaySouls,
    input.window.maxSoulsDelay ?? Number.POSITIVE_INFINITY,
  );
  const estimatedDelay = Math.max(0, input.estimatedCoreDelaySouls ?? 0);
  if (estimatedDelay > maxDelay) return rejected('SITUATIONAL_CORE_DELAY_EXCEEDED');

  if (!Number.isFinite(input.candidateScore) || !Number.isFinite(input.coreScore)) {
    return rejected('SITUATIONAL_SCORE_UNAVAILABLE');
  }
  const requiredScore = input.coreScore + config.minImprovementOverCore;
  if (input.candidateScore < requiredScore) return rejected('CONTINUE_CORE_STRONGER');
  if (input.candidateConfidence < config.minTargetConfidence) return rejected('SITUATIONAL_CANDIDATE_CONFIDENCE_LOW');

  reasons.push('SITUATIONAL_WINDOW', 'MATCHUP_SUPPORTED', 'BEATS_CONTINUE_CORE');
  const targets: AdaptiveSituationalEnemyTargetV1[] = selected.map((entry, index) => ({
    enemyHeroId: entry.enemyHeroId,
    role: index === 0 ? 'PRIMARY' : 'SECONDARY',
    score: entry.priority,
    confidence: clamp01(entry.confidence * exactFamily.confidence),
    evidenceKinds: ['MATCHUP_STAT'],
    deltaWpa: entry.deltaWpa,
    sampleSize: entry.sampleSize,
  }));
  const recommendationConfidence = clamp01(
    Math.min(
      input.candidateConfidence,
      targets.reduce((sum, target) => sum + target.confidence, 0) / targets.length,
    ),
  );

  return {
    accepted: true,
    context: {
      purpose: input.purpose,
      targetEnemies: targets,
      primaryTargetEnemyHeroId: targets[0]?.enemyHeroId,
      recommendationConfidence,
      coreInterruption: {
        nextCoreTargetItemId: input.nextCoreTargetItemId,
        estimatedSoulsDelay: estimatedDelay,
        accepted: true,
      },
      reasonCodes: reasons,
    },
    reasonCodes: reasons,
  };
}

function stabilizeTargets(
  current: readonly ExactEnemyContributionV1[],
  previousIds: readonly number[],
  switchThreshold: number,
): readonly ExactEnemyContributionV1[] {
  if (current.length === 0 || previousIds.length === 0) return current;
  const byId = new Map(current.map((entry) => [entry.enemyHeroId, entry]));
  const previous = previousIds.map((id) => byId.get(id)).filter((entry): entry is ExactEnemyContributionV1 => Boolean(entry));
  if (previous.length === 0) return current;

  const currentTop = current[0];
  const previousTop = previous[0];
  if (currentTop.enemyHeroId === previousTop.enemyHeroId) return current;
  if (currentTop.priority - previousTop.priority >= switchThreshold) return current;

  const previousSet = new Set(previous.map((entry) => entry.enemyHeroId));
  return [
    ...previous,
    ...current.filter((entry) => !previousSet.has(entry.enemyHeroId)),
  ];
}

function rejected(reason: string): EvaluateSituationalCandidateResultV1 {
  return { accepted: false, reasonCodes: [reason] };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
