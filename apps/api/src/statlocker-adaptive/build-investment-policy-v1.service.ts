import { Injectable } from '@nestjs/common';
import { AdaptiveInvestmentStateV1 } from './adaptive-economy-v1';
import {
  BuildContractV1,
  BuildInvestmentPlanObjectiveStateV1,
  BuildInvestmentPlanV1,
  BuildStrategySpecV1,
} from './build-strategy-v1';

export interface BuildInvestmentPolicyV1Input {
  strategy: BuildStrategySpecV1;
  contract: BuildContractV1;
  investment: AdaptiveInvestmentStateV1;
}

@Injectable()
export class BuildInvestmentPolicyV1Service {
  resolve(input: BuildInvestmentPolicyV1Input): BuildInvestmentPlanV1 {
    const objectives: BuildInvestmentPlanObjectiveStateV1[] = input.strategy.investmentPolicy.objectives.map((objective) => {
      const track = input.investment.tracks[objective.type];
      const targetValue = objective.targetBreakpoint ?? objective.minimumValue;
      const activationSatisfied = objective.activateAfterGoalIds.every((goalId) =>
        isGoalResolved(input.contract.goalStates[goalId]),
      );
      const deactivated = objective.deactivateAfterGoalIds.some((goalId) =>
        isGoalResolved(input.contract.goalStates[goalId]),
      );
      let state: BuildInvestmentPlanObjectiveStateV1['state'];
      if (deactivated && targetValue !== undefined && track.currentValue < targetValue) state = objective.hard ? 'ACTIVE' : 'WAIVED';
      else if (!activationSatisfied) state = 'LOCKED';
      else if (targetValue === undefined || track.currentValue >= targetValue) state = 'SATISFIED';
      else state = 'ACTIVE';
      return {
        objectiveId: objective.objectiveId,
        type: objective.type,
        state,
        currentValue: track.currentValue,
        targetValue,
        distance: targetValue === undefined ? undefined : Math.max(0, targetValue - track.currentValue),
        reasonCodes: [
          ...objective.reasonCodes,
          state === 'ACTIVE' ? 'STRATEGIC_INVESTMENT_OBJECTIVE_ACTIVE' :
            state === 'SATISFIED' ? 'STRATEGIC_INVESTMENT_OBJECTIVE_SATISFIED' :
              state === 'LOCKED' ? 'STRATEGIC_INVESTMENT_OBJECTIVE_LOCKED' : 'STRATEGIC_INVESTMENT_OBJECTIVE_WAIVED',
        ],
      };
    });
    return {
      objectives,
      activeObjectiveIds: objectives.filter((objective) => objective.state === 'ACTIVE').map((objective) => objective.objectiveId),
    };
  }

  alignmentUtility(
    before: BuildInvestmentPlanV1,
    after: BuildInvestmentPlanV1,
    strategy: BuildStrategySpecV1,
  ): number {
    const objectiveById = new Map(strategy.investmentPolicy.objectives.map((objective) => [objective.objectiveId, objective]));
    let utility = 0;
    for (const previous of before.objectives) {
      const next = after.objectives.find((entry) => entry.objectiveId === previous.objectiveId);
      if (!next) continue;
      const definition = objectiveById.get(previous.objectiveId);
      const weight = definition?.hard ? 1 : 0.45;
      const previousDistance = previous.distance ?? 0;
      const nextDistance = next.distance ?? 0;
      if (previous.state === 'ACTIVE' && next.state === 'SATISFIED') utility += 1 * weight;
      else if (previous.state === 'ACTIVE' && previousDistance > 0) {
        utility += Math.max(-1, Math.min(1, (previousDistance - nextDistance) / previousDistance)) * 0.5 * weight;
      }
    }
    return Math.max(-1, Math.min(1, utility));
  }
}

function isGoalResolved(state: string | undefined): boolean {
  return state === 'SATISFIED' || state === 'SKIPPED' || state === 'WAIVED';
}
