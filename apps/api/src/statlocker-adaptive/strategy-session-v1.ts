export type AdaptiveStrategySessionStateV1 =
  | 'PROVISIONAL'
  | 'COMMITTED'
  | 'DIVERGED'
  | 'OUT_OF_DISTRIBUTION';

export interface AdaptiveStrategyCandidateV1 {
  strategyId: string;
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  score: number;
  confidence: number;
  support: number;
  feasible: boolean;
}

export interface AdaptiveStrategySessionV1 {
  state: AdaptiveStrategySessionStateV1;
  strategyId?: string;
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  committedAtDecisionId?: string;
  divergenceCount: number;
  lastTransitionReasonCodes: readonly string[];
}

export interface ResolveAdaptiveStrategySessionInputV1 {
  decisionId: string;
  heroId: number;
  rulesetId: string;
  catalogSha256: string;
  candidates: readonly AdaptiveStrategyCandidateV1[];
  previous?: AdaptiveStrategySessionV1;
  irreversibleBranchInvestment?: boolean;
  meaningfulUserDivergence?: boolean;
}

export const ADAPTIVE_STRATEGY_SESSION_POLICY_V1 = Object.freeze({
  minCommitSupport: 8,
  minCommitConfidence: 0.7,
  switchMinImprovement: 0.15,
  divergedReselectMinImprovement: 0.25,
});

export function resolveAdaptiveStrategySessionV1(
  input: ResolveAdaptiveStrategySessionInputV1,
): AdaptiveStrategySessionV1 {
  validateScope(input);
  const candidates = input.candidates
    .filter((candidate) => candidate.feasible)
    .filter((candidate) => candidate.heroId === input.heroId)
    .filter((candidate) => candidate.rulesetId === input.rulesetId)
    .filter((candidate) => candidate.catalogSha256.toLowerCase() === input.catalogSha256.toLowerCase())
    .sort(compareCandidates);
  const previous = sameScope(input.previous, input)
    ? input.previous
    : undefined;

  if (candidates.length === 0) {
    return {
      state: 'OUT_OF_DISTRIBUTION',
      heroId: input.heroId,
      rulesetId: input.rulesetId,
      catalogSha256: input.catalogSha256.toLowerCase(),
      divergenceCount: previous?.divergenceCount ?? 0,
      lastTransitionReasonCodes: ['NO_FEASIBLE_STRATEGY'],
    };
  }

  const previousCandidate = previous?.strategyId
    ? candidates.find((candidate) => candidate.strategyId === previous.strategyId)
    : undefined;
  const best = candidates[0];

  if (input.meaningfulUserDivergence && previous?.strategyId && previousCandidate) {
    return {
      ...previous,
      state: 'DIVERGED',
      divergenceCount: previous.divergenceCount + 1,
      lastTransitionReasonCodes: ['USER_DIVERGENCE', 'STRATEGY_PRESERVED_PENDING_REBASE'],
    };
  }

  if (previous?.state === 'COMMITTED' && previousCandidate) {
    const improvement = best.score - previousCandidate.score;
    if (best.strategyId === previous.strategyId || improvement < ADAPTIVE_STRATEGY_SESSION_POLICY_V1.switchMinImprovement) {
      return {
        ...previous,
        lastTransitionReasonCodes: best.strategyId === previous.strategyId
          ? ['STRATEGY_STILL_BEST']
          : ['STRATEGY_HYSTERESIS'],
      };
    }
    return commitOrProvisional(input, best, previous.divergenceCount, ['STRATEGY_SWITCH_THRESHOLD_MET']);
  }

  if (previous?.state === 'DIVERGED' && previousCandidate) {
    const improvement = best.score - previousCandidate.score;
    if (best.strategyId === previous.strategyId || improvement < ADAPTIVE_STRATEGY_SESSION_POLICY_V1.divergedReselectMinImprovement) {
      return {
        ...previous,
        lastTransitionReasonCodes: ['DIVERGED_STRATEGY_REBASE_PENDING'],
      };
    }
    return commitOrProvisional(input, best, previous.divergenceCount, ['DIVERGED_STRATEGY_RESELECTED']);
  }

  if (previous?.state === 'PROVISIONAL' && previousCandidate) {
    const improvement = best.score - previousCandidate.score;
    const selected = best.strategyId === previous.strategyId || improvement >= ADAPTIVE_STRATEGY_SESSION_POLICY_V1.switchMinImprovement
      ? best
      : previousCandidate;
    return commitOrProvisional(input, selected, previous.divergenceCount, [
      selected.strategyId === previous.strategyId ? 'PROVISIONAL_STRATEGY_STABLE' : 'PROVISIONAL_STRATEGY_SWITCHED',
    ]);
  }

  return commitOrProvisional(input, best, previous?.divergenceCount ?? 0, ['STRATEGY_SELECTED']);
}

function commitOrProvisional(
  input: ResolveAdaptiveStrategySessionInputV1,
  candidate: AdaptiveStrategyCandidateV1,
  divergenceCount: number,
  reasons: readonly string[],
): AdaptiveStrategySessionV1 {
  const committed = Boolean(input.irreversibleBranchInvestment) || (
    candidate.support >= ADAPTIVE_STRATEGY_SESSION_POLICY_V1.minCommitSupport &&
    candidate.confidence >= ADAPTIVE_STRATEGY_SESSION_POLICY_V1.minCommitConfidence
  );
  return {
    state: committed ? 'COMMITTED' : 'PROVISIONAL',
    strategyId: candidate.strategyId,
    heroId: input.heroId,
    rulesetId: input.rulesetId,
    catalogSha256: input.catalogSha256.toLowerCase(),
    ...(committed ? { committedAtDecisionId: input.decisionId } : {}),
    divergenceCount,
    lastTransitionReasonCodes: [...new Set([
      ...reasons,
      committed ? 'STRATEGY_COMMITTED' : 'STRATEGY_PROVISIONAL',
      ...(input.irreversibleBranchInvestment ? ['IRREVERSIBLE_BRANCH_INVESTMENT'] : []),
    ])],
  };
}

function compareCandidates(left: AdaptiveStrategyCandidateV1, right: AdaptiveStrategyCandidateV1): number {
  return right.score - left.score ||
    right.confidence - left.confidence ||
    right.support - left.support ||
    left.strategyId.localeCompare(right.strategyId);
}

function sameScope(
  session: AdaptiveStrategySessionV1 | undefined,
  input: ResolveAdaptiveStrategySessionInputV1,
): session is AdaptiveStrategySessionV1 {
  return Boolean(
    session &&
    session.heroId === input.heroId &&
    session.rulesetId === input.rulesetId &&
    session.catalogSha256.toLowerCase() === input.catalogSha256.toLowerCase(),
  );
}

function validateScope(input: ResolveAdaptiveStrategySessionInputV1): void {
  if (!input.decisionId.trim()) throw new Error('STRATEGY_SESSION_DECISION_ID_INVALID');
  if (!Number.isSafeInteger(input.heroId) || input.heroId <= 0) throw new Error('STRATEGY_SESSION_HERO_INVALID');
  if (!input.rulesetId.trim()) throw new Error('STRATEGY_SESSION_RULESET_INVALID');
  if (!/^[a-f0-9]{64}$/i.test(input.catalogSha256)) throw new Error('STRATEGY_SESSION_CATALOG_INVALID');
}
