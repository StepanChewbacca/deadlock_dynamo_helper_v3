import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import { MatchPlayer } from '../deadlock-live/entities/match-player.entity';
import { RecommendationEconomyRulesV1 } from './adaptive-economy-v1';
import {
  HistoricalPlannerTrajectoryExtractorV2Service,
} from './historical-planner-trajectory-extractor-v2.service';
import { PlannerTrajectoryV2 } from './planner-trajectory-v2';

export interface HistoricalBuildTrajectorySourceV2Input {
  heroId: number;
  patchId: string;
  rulesetId: string;
  catalogSha256: string;
  itemGraph: RecommendationItemGraph;
  economyRules: RecommendationEconomyRulesV1;
  limit?: number;
}

export interface HistoricalBuildTrajectoryRejectionV2 {
  matchId: string;
  playerKey: string;
  diagnostics: readonly string[];
}

export interface HistoricalBuildTrajectorySourceV2Result {
  trajectories: readonly PlannerTrajectoryV2[];
  rejected: readonly HistoricalBuildTrajectoryRejectionV2[];
}

@Injectable()
export class HistoricalBuildTrajectorySourceV2Service {
  constructor(
    @InjectRepository(MatchPlayer)
    private readonly players: Repository<MatchPlayer>,
    private readonly extractor: HistoricalPlannerTrajectoryExtractorV2Service,
  ) {}

  async load(input: HistoricalBuildTrajectorySourceV2Input): Promise<HistoricalBuildTrajectorySourceV2Result> {
    const targets = await this.players.find({
      where: { heroId: input.heroId },
      relations: { match: true, itemPurchases: true },
      order: { matchId: 'DESC', id: 'ASC' },
      take: Math.max(1, Math.min(100_000, Math.floor(input.limit ?? 10_000))),
    });
    const peerCache = new Map<number, readonly MatchPlayer[]>();
    const trajectories: PlannerTrajectoryV2[] = [];
    const rejected: HistoricalBuildTrajectoryRejectionV2[] = [];

    for (const player of targets) {
      let peers = peerCache.get(Number(player.matchId));
      if (!peers) {
        peers = await this.players.find({
          where: { matchId: player.matchId },
          order: { id: 'ASC' },
        });
        peerCache.set(Number(player.matchId), peers);
      }
      const playerKey = `${player.matchId}:player:${player.id}`;
      const result = this.extractor.extract({
        matchId: String(player.matchId),
        playerKey,
        heroId: player.heroId,
        patchId: input.patchId,
        rulesetId: input.rulesetId,
        catalogSha256: input.catalogSha256,
        rankCohort: rankCohort(player.match?.averageBadge),
        allyHeroIds: peers
          .filter((candidate) => candidate.id !== player.id && candidate.team === player.team)
          .map((candidate) => candidate.heroId)
          .sort((a, b) => a - b),
        enemyHeroIds: peers
          .filter((candidate) => candidate.team !== player.team)
          .map((candidate) => candidate.heroId)
          .sort((a, b) => a - b),
        finalOutcome: player.won ? 1 : 0,
        itemGraph: input.itemGraph,
        economyRules: input.economyRules,
        itemRows: (player.itemPurchases ?? [])
          .map((row) => ({
            itemId: Number(row.itemId),
            purchaseTimeS: finiteOptional(row.purchaseTimeS),
            soldTimeS: finiteOptional(row.soldTimeS),
            upgradeId: finiteOptionalNumber(row.upgradeId),
          }))
          .sort((a, b) =>
            (a.purchaseTimeS ?? a.soldTimeS ?? Number.MAX_SAFE_INTEGER) -
            (b.purchaseTimeS ?? b.soldTimeS ?? Number.MAX_SAFE_INTEGER) ||
            a.itemId - b.itemId,
          ),
      });
      if (result.accepted && result.trajectory) trajectories.push(result.trajectory);
      else rejected.push({ matchId: String(player.matchId), playerKey, diagnostics: result.diagnostics });
    }

    return {
      trajectories: trajectories.sort((a, b) => a.traceId.localeCompare(b.traceId)),
      rejected: rejected.sort((a, b) => a.matchId.localeCompare(b.matchId) || a.playerKey.localeCompare(b.playerKey)),
    };
  }
}

function rankCohort(averageBadge: number | null | undefined): string {
  if (!Number.isFinite(averageBadge)) return 'badge:unknown';
  const value = Math.max(0, Math.floor(averageBadge as number));
  const lower = Math.floor(value / 10) * 10;
  return `badge:${lower}-${lower + 9}`;
}

function finiteOptional(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finiteOptionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
