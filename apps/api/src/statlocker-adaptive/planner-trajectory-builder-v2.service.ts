import { Injectable } from '@nestjs/common';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  PlannerTrajectoryTransactionInputV2,
  PlannerTrajectoryV2,
  PlannerTrajectoryValidationErrorV2,
  createPlannerTrajectoryV2,
  validatePlannerTrajectoryV2,
} from './planner-trajectory-v2';

export interface PlannerTrajectoryBuilderV2Input {
  matchId: string;
  playerKey: string;
  heroId: number;
  patchId: string;
  rulesetId: string;
  catalogSha256: string;
  rankCohort: string;
  allyHeroIds: readonly number[];
  enemyHeroIds: readonly number[];
  finalOutcome?: number;
  itemGraph: RecommendationItemGraph;
  events: readonly PlannerTrajectoryTransactionInputV2[];
}

export interface PlannerTrajectoryBuilderV2Result {
  accepted: boolean;
  trajectory?: PlannerTrajectoryV2;
  diagnostics: readonly PlannerTrajectoryValidationErrorV2[];
}

@Injectable()
export class PlannerTrajectoryBuilderV2Service {
  build(input: PlannerTrajectoryBuilderV2Input): PlannerTrajectoryBuilderV2Result {
    const trajectory = createPlannerTrajectoryV2({
      matchId: input.matchId,
      playerKey: input.playerKey,
      heroId: input.heroId,
      patchId: input.patchId,
      rulesetId: input.rulesetId,
      catalogSha256: input.catalogSha256,
      rankCohort: input.rankCohort,
      allyHeroIds: input.allyHeroIds,
      enemyHeroIds: input.enemyHeroIds,
      finalOutcome: input.finalOutcome,
      transactions: [...input.events].sort((a, b) => a.gameTimeSec - b.gameTimeSec),
    }, input.itemGraph);
    const diagnostics = validatePlannerTrajectoryV2(trajectory, input.itemGraph);
    if (diagnostics.length > 0) return { accepted: false, diagnostics };
    return { accepted: true, trajectory, diagnostics: [] };
  }
}
