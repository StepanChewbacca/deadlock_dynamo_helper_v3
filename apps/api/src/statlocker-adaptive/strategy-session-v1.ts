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
  priorWeight?: number;
  draftLikelihood?: number;
  purchasePrefixLikelihood?: number;
  timingLikelihood?: number;
}

export interface AdaptiveStrategySessionV1 {
  state: AdaptiveStrategySessionStateV1;
  strategyId?: string;
  strategyPosterior?: number;
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

interface PosteriorCandidateV1 {
  candidate: AdaptiveStrategyCandidateV1;
  posterior: number;
}

export const ADAPTIVE_STRATEGY_SESSION_POLICY_V1 = Object.freeze({
  minCommitSupport: 8,
  minCommitConfidence: 0.7,
  provisionalSwitchMinPosteriorImprovement: 0.08,
  committedSwitchMinPosteriorImprovement: 0.20,
  irreversibleSwitchMinPosteriorImprovement: 0.30,
  divergedReselectMinPosteriorImprovement: 0.25,
  purchasePrefixLikelihoodExponent: 2,
});

export function resolveAdaptiveStrategySessionV1(
  input: ResolveAdaptiveStrategySessionInputV1,
): AdaptiveStrategySessionV1 {
  validateScope(input);
  const scopedCandidates = input.candidates
    .filter((candidate) => candidate.feasible)
    .filter((candidate) => candidate.heroId === input.heroId)
    .filter((candidate) => candidate.rulesetId === input.rulesetId)
    .filter((candidate) => candidate.catalogSha256.toLowerCase() === input.catalogSha256.toLowerCase());
  for (const candidate of scopedCandidates) validateCandidate(candidate);

  const previous = sameScope(input.previous, input)
    ? input.previous
    : undefined;
  const livePosterior = previous !== undefined;
  const candidates = posteriorCandidates(scopedCandidates, livePosterior);
  const stageReason = livePosterior ? 'LIVE_PREFIX_POSTERIOR' : 'INITIAL_DRAFT_POSTERIOR';

  if (candidates.length === 0) {
    return {
      state: 'OUT_OF_DISTRIBUTION',
      heroId: input.heroId,
      rulesetId: input.rulesetId,
      catalogSha256: input.catalogSha256.toLowerCase(),
      divergenceCount: previous?.divergenceCount ?? 0,
      lastTransitionReasonCodes: ['NO_FEASIBLE_STRATEGY', stageReason],
    };
  }

  const previousCandidate = previous?.strategyId
    ? candidates.find((entry) => entry.candidate.strategyId === previous.strategyId)
    : undefined;
  const best = candidates[0];

  if (input.meaningfulUserDivergence && previous?.strategyId) {
    return {
      ...previous,
      state: 'DIVERGED',
      ...(previousCandidate === undefined ? {} : { strategyPosterior: previousCandidate.posterior }),
      divergenceCount: previous.divergenceCount + 1,
      lastTransitionReasonCodes: [
        'USER_DIVERGENCE',
        'STRATEGY_PRESERVED_PENDING_REBASE',
        stageReason,
      ],
    };
  }

  if (previous?.state === 'COMMITTED' && previousCandidate) {
    const improvement = best.posterior - previousCandidate.posterior;
    const threshold = input.irreversibleBranchInvestment
      ? ADAPTIVE_STRATEGY_SESSION_POLICY_V1.irreversibleSwitchMinPosteriorImprovement
      : ADAPTIVE_STRATEGY_SESSION_POLICY_V1.committedSwitchMinPosteriorImprovement;
    if (best.candidate.strategyId === previous.strategyId || improvement < threshold) {
      return {
        ...previous,
        strategyPosterior: previousCandidate.posterior,
        lastTransitionReasonCodes: best.candidate.strategyId === previous.strategyId
          ? ['STRATEGY_STILL_BEST', 'POSTERIOR_STABLE', stageReason]
          : ['STRATEGY_HYSTERESIS', 'POSTERIOR_SWITCH_THRESHOLD_NOT_MET', stageReason],
      };
    }
    return commitOrProvisional(
      input,
      best,
      previous.divergenceCount,
      ['STRATEGY_SWITCH_THRESHOLD_MET', 'POSTERIOR_SWITCH_THRESHOLD_MET', stageReason],
    );
  }

  if (previous?.state === 'DIVERGED' && previousCandidate) {
    const improvement = best.posterior - previousCandidate.posterior;
    if (
      best.candidate.strategyId === previous.strategyId ||
      improvement < ADAPTIVE_STRATEGY_SESSION_POLICY_V1.divergedReselectMinPosteriorImprovement
    ) {
      return {
        ...previous,
        strategyPosterior: previousCandidate.posterior,
        lastTransitionReasonCodes: [
          'DIVERGED_STRATEGY_REBASE_PENDING',
          'POSTERIOR_SWITCH_THRESHOLD_NOT_MET',
          stageReason,
        ],
      };
    }
    return commitOrProvisional(
      input,
      best,
      previous.divergenceCount,
      ['DIVERGED_STRATEGY_RESELECTED', 'POSTERIOR_SWITCH_THRESHOLD_MET', stageReason],
    );
  }

  if (previous?.state === 'PROVISIONAL' && previousCandidate) {
    const improvement = best.posterior - previousCandidate.posterior;
    const selected = best.candidate.strategyId === previous.strategyId ||
      improvement >= ADAPTIVE_STRATEGY_SESSION_POLICY_V1.provisionalSwitchMinPosteriorImprovement
      ? best
      : previousCandidate;
    return commitOrProvisional(input, selected, previous.divergenceCount, [
      selected.candidate.strategyId === previous.strategyId
        ? 'PROVISIONAL_STRATEGY_STABLE'
        : 'PROVISIONAL_STRATEGY_SWITCHED',
      stageReason,
    ]);
  }

  if (previous?.strategyId && !previousCandidate) {
    return commitOrProvisional(
      input,
      best,
      previous.divergenceCount,
      [
        'PREVIOUS_STRATEGY_NO_LONGER_FEASIBLE',
        'WHOLE_STRATEGY_RESELECTED',
        stageReason,
      ],
    );
  }

  return commitOrProvisional(
    input,
    best,
    previous?.divergenceCount ?? 0,
    ['STRATEGY_SELECTED', stageReason],
  );
}

function posteriorCandidates(
  candidates: readonly AdaptiveStrategyCandidateV1[],
  includeLiveSignals: boolean,
): readonly PosteriorCandidateV1[] {
  if (candidates.length === 0) return [];
  const totalSupport = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.support), 0);
  const weights = candidates.map((candidate) => {
    const supportPrior = totalSupport > 0
      ? candidate.support / totalSupport
      : 1 / candidates.length;
    const prior = candidate.priorWeight ?? supportPrior;
    const draft = candidate.draftLikelihood ?? 1;
    const purchase = includeLiveSignals ? candidate.purchasePrefixLikelihood ?? 1 : 1;
    const timing = includeLiveSignals ? candidate.timingLikelihood ?? 1 : 1;
    const quality = Math.max(0.000001, clamp01(candidate.confidence) * sigmoid(candidate.score));
    const weight = positiveProbability(prior) *
      quality *
      positiveProbability(draft) *
      Math.pow(
        positiveProbability(purchase),
        ADAPTIVE_STRATEGY_SESSION_POLICY_V1.purchasePrefixLikelihoodExponent,
      ) *
      positiveProbability(timing);
    return { candidate, weight };
  });
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  return weights
    .map((entry) => ({
      candidate: entry.candidate,
      posterior: totalWeight > 0 ? entry.weight / totalWeight : 1 / weights.length,
    }))
    .sort((left, right) =>
      right.posterior - left.posterior || compareCandidates(left.candidate, right.candidate),
    );
}

function commitOrProvisional(
  input: ResolveAdaptiveStrategySessionInputV1,
  entry: PosteriorCandidateV1,
  divergenceCount: number,
  reasons: readonly string[],
): AdaptiveStrategySessionV1 {
  const candidate = entry.candidate;
  const committed = Boolean(input.irreversibleBranchInvestment) || (
    candidate.support >= ADAPTIVE_STRATEGY_SESSION_POLICY_V1.minCommitSupport &&
    candidate.confidence >= ADAPTIVE_STRATEGY_SESSION_POLICY_V1.minCommitConfidence
  );
  return {
    state: committed ? 'COMMITTED' : 'PROVISIONAL',
    strategyId: candidate.strategyId,
    strategyPosterior: entry.posterior,
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

function validateCandidate(candidate: AdaptiveStrategyCandidateV1): void {
  if (!candidate.strategyId.trim()) throw new Error('STRATEGY_CANDIDATE_ID_INVALID');
  if (!Number.isFinite(candidate.score)) throw new Error(`STRATEGY_CANDIDATE_SCORE_INVALID:${candidate.strategyId}`);
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
    throw new Error(`STRATEGY_CANDIDATE_CONFIDENCE_INVALID:${candidate.strategyId}`);
  }
  if (!Number.isSafeInteger(candidate.support) || candidate.support < 0) {
    throw new Error(`STRATEGY_CANDIDATE_SUPPORT_INVALID:${candidate.strategyId}`);
  }
  validateOptionalProbability(candidate.priorWeight, 'PRIOR', candidate.strategyId);
  validateOptionalProbability(candidate.draftLikelihood, 'DRAFT', candidate.strategyId);
  validateOptionalProbability(candidate.purchasePrefixLikelihood, 'PURCHASE_PREFIX', candidate.strategyId);
  validateOptionalProbability(candidate.timingLikelihood, 'TIMING', candidate.strategyId);
}

function validateOptionalProbability(value: number | undefined, key: string, strategyId: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`STRATEGY_CANDIDATE_${key}_LIKELIHOOD_INVALID:${strategyId}`);
  }
}

function positiveProbability(value: number): number {
  return Math.max(0.000001, clamp01(value));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-Math.min(value, 60));
    return 1 / (1 + z);
  }
  const z = Math.exp(Math.max(value, -60));
  return z / (1 + z);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
