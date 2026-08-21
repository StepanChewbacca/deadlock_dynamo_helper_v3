export const RECOMMENDATION_ROADMAP_STATE_VERSION = 'recommendation-roadmap-state-v1' as const;

export type RecommendationRoadmapPhaseV1 =
  | 'DATA_CONTRACT'
  | 'LEGALITY_ENGINE'
  | 'PROSPECTIVE_DATA'
  | 'BEHAVIORAL_BUILDLM'
  | 'SHADOW'
  | 'MATCH_LEVEL_AB'
  | 'SAFE_EXPLORATION'
  | 'CAUSAL_VALUE'
  | 'POLICY_V1'
  | 'SEQUENTIAL_RL_RESEARCH';

export type RecommendationRoadmapGateStateV1 = 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE' | 'NOT_EVALUATED';

export interface RecommendationRoadmapEvidenceV1 {
  canonicalGepV2: RecommendationRoadmapGateStateV1;
  controlledSoulsValidation: RecommendationRoadmapGateStateV1;
  versionedRulesetCatalog: RecommendationRoadmapGateStateV1;
  deterministicLegality: RecommendationRoadmapGateStateV1;
  recommendationTelemetryV8: RecommendationRoadmapGateStateV1;
  observabilityCoverage: RecommendationRoadmapGateStateV1;
  datasetV8Structural: RecommendationRoadmapGateStateV1;
  datasetV8Empirical: RecommendationRoadmapGateStateV1;
  behavioralOffline: RecommendationRoadmapGateStateV1;
  shadowSafety: RecommendationRoadmapGateStateV1;
  matchLevelAbSafety: RecommendationRoadmapGateStateV1;
  exactActionPropensity: RecommendationRoadmapGateStateV1;
  safeExplorationSafety: RecommendationRoadmapGateStateV1;
  valueActionSensitivity: RecommendationRoadmapGateStateV1;
  offPolicySupport: RecommendationRoadmapGateStateV1;
  causalValueRelease: RecommendationRoadmapGateStateV1;
  policyAbRelease: RecommendationRoadmapGateStateV1;
  sequentialRlResearchGate: RecommendationRoadmapGateStateV1;
  futureTestEvaluation?: RecommendationRoadmapGateStateV1;
  futureTestUntouched: boolean;
}

export interface RecommendationRoadmapPhaseStateV1 {
  phase: RecommendationRoadmapPhaseV1;
  unlocked: boolean;
  blockers: readonly string[];
}

export interface RecommendationRoadmapStateReportV1 {
  version: typeof RECOMMENDATION_ROADMAP_STATE_VERSION;
  highestUnlockedPhase?: RecommendationRoadmapPhaseV1;
  phases: readonly RecommendationRoadmapPhaseStateV1[];
  hardBlockers: readonly string[];
}

const PHASE_REQUIREMENTS: ReadonlyArray<{
  phase: RecommendationRoadmapPhaseV1;
  gates: readonly (keyof RecommendationRoadmapEvidenceV1)[];
}> = [
  {
    phase: 'DATA_CONTRACT',
    gates: ['canonicalGepV2', 'controlledSoulsValidation', 'versionedRulesetCatalog'],
  },
  {
    phase: 'LEGALITY_ENGINE',
    gates: ['deterministicLegality', 'recommendationTelemetryV8'],
  },
  {
    phase: 'PROSPECTIVE_DATA',
    gates: ['observabilityCoverage', 'datasetV8Structural', 'datasetV8Empirical'],
  },
  {
    phase: 'BEHAVIORAL_BUILDLM',
    gates: ['behavioralOffline'],
  },
  {
    phase: 'SHADOW',
    gates: ['shadowSafety'],
  },
  {
    phase: 'MATCH_LEVEL_AB',
    gates: ['matchLevelAbSafety'],
  },
  {
    phase: 'SAFE_EXPLORATION',
    gates: ['exactActionPropensity', 'safeExplorationSafety'],
  },
  {
    phase: 'CAUSAL_VALUE',
    gates: ['valueActionSensitivity', 'offPolicySupport', 'causalValueRelease'],
  },
  {
    phase: 'POLICY_V1',
    gates: ['policyAbRelease'],
  },
  {
    phase: 'SEQUENTIAL_RL_RESEARCH',
    gates: ['futureTestEvaluation', 'sequentialRlResearchGate'],
  },
];

export function evaluateRecommendationRoadmapStateV1(
  evidence: RecommendationRoadmapEvidenceV1,
): RecommendationRoadmapStateReportV1 {
  const phases: RecommendationRoadmapPhaseStateV1[] = [];
  const futureTestEvaluation = evidence.futureTestEvaluation ?? 'NOT_EVALUATED';
  let previousUnlocked = true;

  for (const requirement of PHASE_REQUIREMENTS) {
    const blockers: string[] = [];
    if (!previousUnlocked) blockers.push('PREREQUISITE_PHASE_NOT_UNLOCKED');
    for (const gateName of requirement.gates) {
      const value = gateName === 'futureTestEvaluation'
        ? futureTestEvaluation
        : evidence[gateName];
      if (value !== 'PASS') blockers.push(`${String(gateName)}:${String(value ?? 'NOT_EVALUATED')}`);
    }

    if (
      requirement.phase !== 'SEQUENTIAL_RL_RESEARCH'
      && !evidence.futureTestUntouched
      && futureTestEvaluation !== 'PASS'
    ) {
      blockers.push('FUTURE_TEST_TOUCHED_BEFORE_AUTHORIZED_FINAL_EVALUATION');
    }

    const unlocked = blockers.length === 0;
    phases.push({ phase: requirement.phase, unlocked, blockers: blockers.sort() });
    previousUnlocked = unlocked;
  }

  const highestUnlockedPhase = [...phases].reverse().find((phase) => phase.unlocked)?.phase;
  const hardBlockers = [...new Set(phases.flatMap((phase) => phase.blockers))].sort();
  return {
    version: RECOMMENDATION_ROADMAP_STATE_VERSION,
    highestUnlockedPhase,
    phases,
    hardBlockers,
  };
}

export function assertRecommendationRoadmapPhaseUnlockedV1(
  report: RecommendationRoadmapStateReportV1,
  phase: RecommendationRoadmapPhaseV1,
): void {
  const state = report.phases.find((entry) => entry.phase === phase);
  if (!state?.unlocked) {
    throw new Error(`Recommendation roadmap phase ${phase} is blocked: ${state?.blockers.join(',') ?? 'UNKNOWN_PHASE'}`);
  }
}
