import { Injectable } from '@nestjs/common';
import { AdaptiveDecisionStateV1 } from './adaptive-decision-state-v1.service';
import { BuildStrategyRegistryV1Service } from './build-strategy-registry-v1.service';
import { ConsensusStrategyFallbackV1Service } from './consensus-strategy-fallback-v1.service';
import {
  StrategyFirstBuildPlannerV1Result,
  StrategyFirstBuildPlannerV1Service,
} from './strategy-first-build-planner-v1.service';
import { StatlockerEvidenceBundleV1 } from './statlocker-evidence.service';
import { ConsensusSkeletonV1 } from './statlocker-adaptive.types';

export interface StrategyFirstAdaptivePlannerFacadeV1Input {
  decision: AdaptiveDecisionStateV1;
  evidence: StatlockerEvidenceBundleV1;
}

@Injectable()
export class StrategyFirstAdaptivePlannerFacadeV1Service {
  constructor(
    private readonly planner: StrategyFirstBuildPlannerV1Service,
    private readonly registry: BuildStrategyRegistryV1Service,
    private readonly fallback: ConsensusStrategyFallbackV1Service,
  ) {}

  plan(input: StrategyFirstAdaptivePlannerFacadeV1Input): StrategyFirstBuildPlannerV1Result {
    let strategies = this.registry.getStrategies(
      input.decision.state.heroId,
      input.decision.rulesetId,
      input.decision.catalogSha256,
    );
    if (strategies.length === 0) {
      const skeleton = asSkeleton(input.evidence.byDataset.CONSENSUS_SKELETON.payload, input.decision.state.heroId);
      if (!skeleton) throw new Error('No strategy snapshot or structured consensus fallback is available');
      strategies = [this.fallback.compile(
        skeleton,
        input.decision.itemGraph,
        input.decision.rulesetId,
        input.evidence.statlockerPatchId,
      )];
    }
    return this.planner.plan({
      decision: input.decision,
      evidence: input.evidence,
      strategies,
    });
  }
}

function asSkeleton(value: unknown, heroId: number): ConsensusSkeletonV1 | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const skeleton = value as Partial<ConsensusSkeletonV1>;
  if (skeleton.heroId !== heroId || !Array.isArray(skeleton.groups)) return undefined;
  return skeleton as ConsensusSkeletonV1;
}
