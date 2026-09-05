import { Injectable } from '@nestjs/common';
import { BuildStrategyCommitmentV1, BuildStrategySelectionV1 } from './build-strategy-v1';

export interface BuildStrategySessionV1 {
  strategyId?: string;
  commitment: BuildStrategyCommitmentV1;
  posterior: number;
  selectedAtGameTimeSec: number;
  replanReasons: readonly string[];
}

export interface ReconcileBuildStrategySessionV1Input {
  previous?: BuildStrategySessionV1;
  selection: BuildStrategySelectionV1;
  gameTimeSec: number;
  committedSwitchMinImprovement?: number;
}

@Injectable()
export class BuildStrategySessionV1Service {
  reconcile(input: ReconcileBuildStrategySessionV1Input): BuildStrategySessionV1 {
    const proposedId = input.selection.selectedStrategyId;
    const proposedPosterior = proposedId
      ? input.selection.posteriors.find((entry) => entry.strategyId === proposedId)?.probability ?? 0
      : 0;
    const previous = input.previous;

    if (!previous?.strategyId) {
      return {
        strategyId: proposedId,
        commitment: input.selection.commitment,
        posterior: proposedPosterior,
        selectedAtGameTimeSec: input.gameTimeSec,
        replanReasons: [...input.selection.reasonCodes],
      };
    }

    if (input.selection.commitment === 'OOD') {
      if (proposedId) {
        const rebased = proposedId !== previous.strategyId;
        return {
          strategyId: proposedId,
          commitment: 'OOD',
          posterior: proposedPosterior,
          selectedAtGameTimeSec: rebased ? input.gameTimeSec : previous.selectedAtGameTimeSec,
          replanReasons: [...new Set([
            ...input.selection.reasonCodes,
            'CURRENT_STATE_OUT_OF_DISTRIBUTION',
            ...(rebased ? ['OOD_NEAREST_STRATEGY_REBASE'] : []),
          ])],
        };
      }
      return {
        ...previous,
        commitment: previous.commitment === 'COMMITTED' ? 'DIVERGED' : 'OOD',
        replanReasons: [...new Set([...previous.replanReasons, 'CURRENT_STATE_OUT_OF_DISTRIBUTION'])],
      };
    }

    if (!proposedId) {
      return {
        ...previous,
        commitment: previous.commitment === 'COMMITTED' ? 'DIVERGED' : 'OOD',
        replanReasons: [...new Set([...previous.replanReasons, 'CURRENT_STATE_OUT_OF_DISTRIBUTION'])],
      };
    }

    const previousPosteriorNow = input.selection.posteriors.find((entry) => entry.strategyId === previous.strategyId)?.probability ?? 0;
    if (proposedId === previous.strategyId) {
      return {
        ...previous,
        posterior: previousPosteriorNow || proposedPosterior,
        commitment: previous.commitment === 'COMMITTED' ? 'COMMITTED' : input.selection.commitment,
        replanReasons: [...new Set([...previous.replanReasons, ...input.selection.reasonCodes])],
      };
    }

    if (previous.commitment === 'COMMITTED') {
      const threshold = input.committedSwitchMinImprovement ?? 0.28;
      const improvement = proposedPosterior - previousPosteriorNow;
      if (improvement < threshold) {
        return {
          ...previous,
          posterior: previousPosteriorNow,
          replanReasons: [...new Set([...previous.replanReasons, 'SWITCH_IMPROVEMENT_BELOW_COMMITTED_THRESHOLD'])],
        };
      }
      return {
        strategyId: proposedId,
        commitment: 'COMMITTED',
        posterior: proposedPosterior,
        selectedAtGameTimeSec: input.gameTimeSec,
        replanReasons: ['COMMITTED_STRATEGY_SWITCH', ...input.selection.reasonCodes],
      };
    }

    return {
      strategyId: proposedId,
      commitment: input.selection.commitment,
      posterior: proposedPosterior,
      selectedAtGameTimeSec: input.gameTimeSec,
      replanReasons: ['PROVISIONAL_STRATEGY_SWITCH', ...input.selection.reasonCodes],
    };
  }
}
