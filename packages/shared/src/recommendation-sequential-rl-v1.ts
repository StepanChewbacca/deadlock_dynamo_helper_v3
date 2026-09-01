import { RecommendationActionFeatureV8, RecommendationFeatureStateV8, validateRecommendationFeatureStateV8 } from './recommendation-feature-store-v8';
import { EXACT_ACTION_PROPENSITY_SOURCE } from './off-policy-evaluation-v1';

export const RECOMMENDATION_SEQUENTIAL_RL_V1_CONTRACT = 'recommendation-sequential-rl-v1' as const;

export interface RecommendationSequentialTransitionV1 {
  transitionId: string;
  matchId: string;
  playerKey: string;
  decisionId: string;
  state: RecommendationFeatureStateV8;
  action: RecommendationActionFeatureV8;
  reward: number;
  actionLoggingPropensity: number;
  loggingPropensitySource: typeof EXACT_ACTION_PROPENSITY_SOURCE;
  nextState?: RecommendationFeatureStateV8;
  terminal: boolean;
  rulesetVersion: string;
  catalogSha256: string;
}

export interface RecommendationSequentialDatasetReportV1 {
  transitionCount: number;
  matchCount: number;
  terminalTransitionCount: number;
  invalidTransitionIds: readonly string[];
  futureLeakageTransitionIds: readonly string[];
  rulesetMismatchTransitionIds: readonly string[];
  reconstructedPropensityTransitionIds: readonly string[];
  canRunSequentialRlResearch: boolean;
}

export function evaluateRecommendationSequentialDatasetV1(
  transitions: readonly RecommendationSequentialTransitionV1[],
): RecommendationSequentialDatasetReportV1 {
  const invalidTransitionIds: string[] = [];
  const futureLeakageTransitionIds: string[] = [];
  const rulesetMismatchTransitionIds: string[] = [];
  const reconstructedPropensityTransitionIds: string[] = [];

  for (const transition of transitions) {
    const errors = validateTransition(transition);
    if (errors.length > 0) invalidTransitionIds.push(transition.transitionId);
    if (transition.nextState && transition.nextState.decisionAtMs <= transition.state.decisionAtMs) {
      futureLeakageTransitionIds.push(transition.transitionId);
    }
    if (
      transition.state.rulesetVersion !== transition.rulesetVersion
      || transition.state.catalogSha256 !== transition.catalogSha256
      || (
        transition.nextState
        && (
          transition.nextState.rulesetVersion !== transition.rulesetVersion
          || transition.nextState.catalogSha256 !== transition.catalogSha256
        )
      )
    ) {
      rulesetMismatchTransitionIds.push(transition.transitionId);
    }
    if (transition.loggingPropensitySource !== EXACT_ACTION_PROPENSITY_SOURCE) {
      reconstructedPropensityTransitionIds.push(transition.transitionId);
    }
  }

  const uniqueInvalid = [...new Set(invalidTransitionIds)].sort();
  const uniqueFuture = [...new Set(futureLeakageTransitionIds)].sort();
  const uniqueRuleset = [...new Set(rulesetMismatchTransitionIds)].sort();
  const uniqueReconstructed = [...new Set(reconstructedPropensityTransitionIds)].sort();
  const matchCount = new Set(transitions.map((transition) => transition.matchId)).size;
  const terminalTransitionCount = transitions.filter((transition) => transition.terminal).length;
  return {
    transitionCount: transitions.length,
    matchCount,
    terminalTransitionCount,
    invalidTransitionIds: uniqueInvalid,
    futureLeakageTransitionIds: uniqueFuture,
    rulesetMismatchTransitionIds: uniqueRuleset,
    reconstructedPropensityTransitionIds: uniqueReconstructed,
    canRunSequentialRlResearch:
      transitions.length > 0
      && uniqueInvalid.length === 0
      && uniqueFuture.length === 0
      && uniqueRuleset.length === 0
      && uniqueReconstructed.length === 0,
  };
}

export function validateRecommendationSequentialTransitionV1(
  transition: RecommendationSequentialTransitionV1,
): readonly string[] {
  return validateTransition(transition);
}

function validateTransition(transition: RecommendationSequentialTransitionV1): string[] {
  const errors: string[] = [];
  if (!transition.transitionId) errors.push('TRANSITION_ID_REQUIRED');
  if (!transition.matchId) errors.push('MATCH_ID_REQUIRED');
  if (!transition.playerKey) errors.push('PLAYER_KEY_REQUIRED');
  if (!transition.decisionId) errors.push('DECISION_ID_REQUIRED');
  if (!transition.action?.actionKey) errors.push('ACTION_KEY_REQUIRED');
  if (!Number.isFinite(transition.reward)) errors.push('REWARD_INVALID');
  if (!Number.isFinite(transition.actionLoggingPropensity)
    || transition.actionLoggingPropensity <= 0
    || transition.actionLoggingPropensity > 1) {
    errors.push('ACTION_LOGGING_PROPENSITY_INVALID');
  }
  if (transition.loggingPropensitySource !== EXACT_ACTION_PROPENSITY_SOURCE) {
    errors.push('RECONSTRUCTED_PROPENSITY_FORBIDDEN');
  }
  if (!transition.rulesetVersion) errors.push('RULESET_VERSION_REQUIRED');
  if (!isSha256(transition.catalogSha256)) errors.push('CATALOG_SHA_INVALID');

  const stateValidation = validateRecommendationFeatureStateV8(transition.state);
  for (const error of stateValidation.errors) errors.push(`STATE:${error}`);
  if (transition.nextState) {
    const nextValidation = validateRecommendationFeatureStateV8(transition.nextState);
    for (const error of nextValidation.errors) errors.push(`NEXT_STATE:${error}`);
  }
  if (transition.terminal && transition.nextState) errors.push('TERMINAL_TRANSITION_HAS_NEXT_STATE');
  if (!transition.terminal && !transition.nextState) errors.push('NON_TERMINAL_TRANSITION_MISSING_NEXT_STATE');
  if (transition.state.matchId !== transition.matchId) errors.push('STATE_MATCH_ID_MISMATCH');
  if (transition.state.playerKey !== transition.playerKey) errors.push('STATE_PLAYER_KEY_MISMATCH');
  if (transition.state.decisionId !== transition.decisionId) errors.push('STATE_DECISION_ID_MISMATCH');
  if (transition.nextState && transition.nextState.matchId !== transition.matchId) errors.push('NEXT_STATE_MATCH_ID_MISMATCH');
  if (transition.nextState && transition.nextState.playerKey !== transition.playerKey) errors.push('NEXT_STATE_PLAYER_KEY_MISMATCH');
  return [...new Set(errors)].sort();
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
