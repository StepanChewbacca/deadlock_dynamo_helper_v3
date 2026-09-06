export const ADAPTIVE_ACTION_TYPES_V1 = [
  'BUY',
  'UPGRADE',
  'SELL',
  'REPLACE',
  'WAIT',
  'HOLD',
  'CONTINUE_CORE',
  'ABSTAIN',
] as const;

export type AdaptiveActionTypeV1 = (typeof ADAPTIVE_ACTION_TYPES_V1)[number];

export const ADAPTIVE_PLAN_STATUSES_V1 = ['OWNED', 'NEXT', 'PLANNED'] as const;
export type AdaptivePlanStatusV1 = (typeof ADAPTIVE_PLAN_STATUSES_V1)[number];

export const ADAPTIVE_PLAN_ACTION_STATUSES_V1 = [
  'OWNED',
  'READY',
  'BLOCKED',
  'PLANNED',
  'COMPLETED',
] as const;
export type AdaptivePlanActionStatusV1 = (typeof ADAPTIVE_PLAN_ACTION_STATUSES_V1)[number];

export const ADAPTIVE_EVIDENCE_FRESHNESS_V1 = [
  'FRESH',
  'STALE_USABLE',
  'UNAVAILABLE',
  'PATCH_MISMATCH',
] as const;
export type AdaptiveEvidenceFreshnessV1 = (typeof ADAPTIVE_EVIDENCE_FRESHNESS_V1)[number];

export type AdaptiveBuildPlanChangeTypeV1 = 'KEEP' | 'INSERT' | 'SKIP' | 'SELL' | 'REPLACE' | 'MOVE';

export interface AdaptiveRecommendationRequestV1 {
  matchId: string;
  localSteamId?: string;
}

export interface AdaptiveActionV1 {
  actionKey: string;
  type: AdaptiveActionTypeV1;
  itemId?: number;
  sellItemId?: number;
  buyItemId?: number;
  targetItemId?: number;
  reasonCodes: readonly string[];
}

export type AdaptivePlanRequirementV1 =
  | {
      type: 'SOULS';
      requiredSouls: number;
      currentSouls?: number;
      shortfallSouls?: number;
      evidence: 'OBSERVED' | 'RECONSTRUCTED' | 'UNKNOWN';
    }
  | {
      type: 'FLEX_SLOT';
      requiredFlexSlots: number;
      unlockedFlexSlots?: number;
      evidence: 'OBSERVED' | 'RECONSTRUCTED' | 'UNKNOWN';
    }
  | {
      type: 'SELL_ITEM';
      itemId: number;
    }
  | {
      type: 'UPGRADE_COMPONENT';
      itemIds: readonly number[];
    }
  | {
      type: 'SHOP_OPPORTUNITY';
      available?: boolean;
      evidence: 'OBSERVED' | 'RECONSTRUCTED' | 'UNKNOWN';
    };

export type AdaptiveSituationalPurposeV1 =
  | 'CATCH'
  | 'ANTI_CC'
  | 'CLEANSE'
  | 'ANTI_BULLET'
  | 'ANTI_SPIRIT'
  | 'ANTI_BURST'
  | 'ANTI_HEAL'
  | 'MOBILITY'
  | 'TEAM_UTILITY'
  | 'SURVIVAL';

export type AdaptiveSituationalEvidenceKindV1 =
  | 'MATCHUP_STAT'
  | 'MECHANICAL_COUNTER'
  | 'ENEMY_ITEMIZATION'
  | 'LIVE_THREAT';

export interface AdaptiveSituationalEnemyTargetV1 {
  enemyHeroId: number;
  enemyHeroName?: string;
  role: 'PRIMARY' | 'SECONDARY';
  score: number;
  confidence: number;
  evidenceKinds: readonly AdaptiveSituationalEvidenceKindV1[];
  deltaWpa?: number;
  sampleSize?: number;
}

export interface AdaptiveSituationalContextV1 {
  purpose: AdaptiveSituationalPurposeV1;
  targetEnemies: readonly AdaptiveSituationalEnemyTargetV1[];
  primaryTargetEnemyHeroId?: number;
  recommendationConfidence: number;
  coreInterruption: {
    nextCoreTargetItemId?: number;
    estimatedSoulsDelay?: number;
    accepted: boolean;
  };
  reasonCodes: readonly string[];
}

export interface AdaptivePlanActionV1 {
  planActionId: string;
  sequence: number;
  status: AdaptivePlanActionStatusV1;
  action: AdaptiveActionV1;
  targetItemId?: number;
  sourceItemIds: readonly number[];
  requirements: readonly AdaptivePlanRequirementV1[];
  goalId?: string;
  groupId?: string;
  reasonCodes: readonly string[];
  situational?: AdaptiveSituationalContextV1;
}

export interface AdaptiveScoreComponentV1 {
  key: string;
  raw: number;
  normalized: number;
  confidence: number;
  weight: number;
  weighted: number;
}

export interface AdaptiveScoredActionV1 {
  action: AdaptiveActionV1;
  score: number;
  confidence: number;
  components: readonly AdaptiveScoreComponentV1[];
  reasonCodes: readonly string[];
}

export interface AdaptivePlannedItemV1 {
  itemId: number;
  position: number;
  status: AdaptivePlanStatusV1;
  score: number;
  confidence: number;
  skeletonStrength: number;
  contextualSupport: number;
  reasonCodes: readonly string[];
}

export interface AdaptiveBuildPlanChangeV1 {
  type: AdaptiveBuildPlanChangeTypeV1;
  itemId?: number;
  sellItemId?: number;
  buyItemId?: number;
  fromPosition?: number;
  toPosition?: number;
  reasonCodes: readonly string[];
}

export interface AdaptiveEvidenceFamilyProvenanceV1 {
  dataset: string;
  freshness: AdaptiveEvidenceFreshnessV1;
  snapshotId?: string;
  contentSha256?: string;
  fetchedAt?: string;
  confidence: number;
}

export interface AdaptiveEvidenceProvenanceV1 {
  rulesetVersion: string;
  catalogSha256: string;
  statlockerPatchId?: string;
  snapshotIds: readonly string[];
  families: readonly AdaptiveEvidenceFamilyProvenanceV1[];
  degradedReasons: readonly string[];
}

export interface AdaptiveRecommendationResultV1 {
  ready: boolean;
  blockers: readonly string[];
  decisionId: string;
  stateRevision: string;
  gameState: 'AHEAD' | 'EVEN' | 'BEHIND' | 'UNKNOWN';
  nextAction: AdaptiveActionV1;
  nextTargetItemId?: number;
  planActions?: readonly AdaptivePlanActionV1[];
  recommendedBuild: readonly AdaptivePlannedItemV1[];
  changes: readonly AdaptiveBuildPlanChangeV1[];
  rankedImmediateCandidates: readonly AdaptiveScoredActionV1[];
  totalScore: number;
  confidence: number;
  scorerVersion: string;
  plannerVersion: string;
  configVersion: string;
  evidence: AdaptiveEvidenceProvenanceV1;
}
