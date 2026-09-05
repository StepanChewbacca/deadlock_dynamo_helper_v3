import { Injectable } from '@nestjs/common';
import { RecommendationItemGraph } from '@deadlock-live-probe/build-domain';
import {
  RecommendationEconomyRulesV1,
  deriveAdaptiveInvestmentStateV1,
  deriveAdaptiveSlotStateV1,
  slotRulesFromEconomyRulesV1,
} from './adaptive-economy-v1';
import {
  PlannerTrajectoryTransactionInputV2,
  PlannerTrajectoryV2,
  createPlannerTrajectoryV2,
  validatePlannerTrajectoryV2,
} from './planner-trajectory-v2';

export interface HistoricalPlannerItemRowV2 {
  itemId: number;
  purchaseTimeS?: number;
  soldTimeS?: number;
  upgradeId?: number;
}

export interface HistoricalPlannerTrajectoryExtractorV2Input {
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
  economyRules: RecommendationEconomyRulesV1;
  itemRows: readonly HistoricalPlannerItemRowV2[];
}

export interface HistoricalPlannerTrajectoryExtractorV2Result {
  accepted: boolean;
  trajectory?: PlannerTrajectoryV2;
  diagnostics: readonly string[];
}

interface TimelineEvent {
  type: 'PURCHASE' | 'SELL';
  itemId: number;
  timeS: number;
  source: HistoricalPlannerItemRowV2;
}

@Injectable()
export class HistoricalPlannerTrajectoryExtractorV2Service {
  extract(input: HistoricalPlannerTrajectoryExtractorV2Input): HistoricalPlannerTrajectoryExtractorV2Result {
    const identityErrors = validateIdentity(input);
    if (identityErrors.length > 0) return { accepted: false, diagnostics: identityErrors };

    const timeline = buildTimeline(input.itemRows);
    const inventory = new Set<number>();
    const transactions: PlannerTrajectoryTransactionInputV2[] = [];
    const diagnostics: string[] = [];

    for (const event of timeline) {
      const item = input.itemGraph.getItem(event.itemId);
      if (!item) {
        diagnostics.push(`UNKNOWN_ITEM:${event.itemId}`);
        continue;
      }
      const before = stableIds(inventory);
      const investmentBefore = investmentVector(before, input);
      const slotUsedBefore = slotUsage(before, input);

      if (event.type === 'PURCHASE') {
        if (inventory.has(event.itemId)) {
          diagnostics.push(`DUPLICATE_ITEM_PURCHASE:${event.itemId}`);
          continue;
        }
        const matchingRecipes = item.upgradeRecipes.filter((recipe) =>
          recipe.consumedItemIds.length > 0 && recipe.consumedItemIds.every((componentId) => inventory.has(componentId)),
        );
        if (matchingRecipes.length > 1) {
          diagnostics.push(`AMBIGUOUS_UPGRADE_RECIPE:${event.itemId}`);
          continue;
        }

        if (matchingRecipes.length === 1) {
          const recipe = matchingRecipes[0];
          const explicitComponents = input.itemRows
            .filter((row) => row.upgradeId === event.itemId && row.soldTimeS === event.timeS)
            .map((row) => row.itemId)
            .sort((a, b) => a - b);
          const expectedComponents = [...recipe.consumedItemIds].sort((a, b) => a - b);
          if (explicitComponents.length > 0 && !sameIds(explicitComponents, expectedComponents)) {
            diagnostics.push(`UPGRADE_COMPONENT_MISMATCH:${event.itemId}`);
            continue;
          }
          for (const componentId of recipe.consumedItemIds) inventory.delete(componentId);
          inventory.add(event.itemId);
          const after = stableIds(inventory);
          transactions.push({
            actionType: 'UPGRADE',
            gameTimeSec: event.timeS,
            targetItemId: event.itemId,
            consumedItemIds: [...recipe.consumedItemIds],
            inventoryBefore: before,
            inventoryAfter: after,
            slotUsedBefore,
            slotUsedAfter: slotUsage(after, input),
            investmentBefore,
            investmentAfter: investmentVector(after, input),
          });
          continue;
        }

        if (item.directPurchaseCost === undefined) {
          diagnostics.push(`PURCHASE_WITHOUT_LEGAL_PATH:${event.itemId}`);
          continue;
        }
        inventory.add(event.itemId);
        const after = stableIds(inventory);
        transactions.push({
          actionType: 'BUY',
          gameTimeSec: event.timeS,
          targetItemId: event.itemId,
          consumedItemIds: [],
          inventoryBefore: before,
          inventoryAfter: after,
          slotUsedBefore,
          slotUsedAfter: slotUsage(after, input),
          investmentBefore,
          investmentAfter: investmentVector(after, input),
        });
        continue;
      }

      if (!inventory.has(event.itemId)) {
        diagnostics.push(`SELL_ITEM_NOT_HELD:${event.itemId}`);
        continue;
      }
      if (!item.sellTransition) {
        diagnostics.push(`SELL_TRANSITION_UNKNOWN:${event.itemId}`);
        continue;
      }
      inventory.delete(event.itemId);
      for (const returnedItemId of item.sellTransition.returnedItemIds) {
        if (!input.itemGraph.getItem(returnedItemId)) {
          diagnostics.push(`SELL_RETURN_ITEM_UNKNOWN:${returnedItemId}`);
          continue;
        }
        inventory.add(returnedItemId);
      }
      const after = stableIds(inventory);
      transactions.push({
        actionType: 'SELL',
        gameTimeSec: event.timeS,
        sellItemId: event.itemId,
        consumedItemIds: [],
        inventoryBefore: before,
        inventoryAfter: after,
        slotUsedBefore,
        slotUsedAfter: slotUsage(after, input),
        investmentBefore,
        investmentAfter: investmentVector(after, input),
      });
    }

    if (diagnostics.length > 0) {
      return { accepted: false, diagnostics: [...new Set(diagnostics)].sort() };
    }

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
      transactions,
    }, input.itemGraph);
    const validationErrors = validatePlannerTrajectoryV2(trajectory, input.itemGraph);
    if (validationErrors.length > 0) {
      return {
        accepted: false,
        diagnostics: validationErrors.map((error) => `${error.code}:${error.transactionIndex ?? -1}`).sort(),
      };
    }
    return { accepted: true, trajectory, diagnostics: [] };
  }
}

function buildTimeline(rows: readonly HistoricalPlannerItemRowV2[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const row of rows) {
    if (isTime(row.purchaseTimeS)) {
      events.push({ type: 'PURCHASE', itemId: row.itemId, timeS: row.purchaseTimeS as number, source: row });
    }
    // Rows marked with upgradeId describe component consumption. The corresponding parent
    // purchase is reconstructed as UPGRADE, so emitting an additional SELL would double-apply it.
    if (isTime(row.soldTimeS) && row.upgradeId === undefined) {
      events.push({ type: 'SELL', itemId: row.itemId, timeS: row.soldTimeS as number, source: row });
    }
  }
  return events.sort((a, b) =>
    a.timeS - b.timeS || eventOrder(a.type) - eventOrder(b.type) || a.itemId - b.itemId,
  );
}

function eventOrder(type: TimelineEvent['type']): number {
  return type === 'PURCHASE' ? 0 : 1;
}

function slotUsage(itemIds: readonly number[], input: HistoricalPlannerTrajectoryExtractorV2Input): number {
  return deriveAdaptiveSlotStateV1(
    itemIds,
    input.itemGraph,
    slotRulesFromEconomyRulesV1(input.economyRules),
    { unlockedFlexSlots: input.economyRules.maxFlexSlots, evidence: 'RECONSTRUCTED' },
  ).usedSlots;
}

function investmentVector(itemIds: readonly number[], input: HistoricalPlannerTrajectoryExtractorV2Input) {
  const investment = deriveAdaptiveInvestmentStateV1(itemIds, input.itemGraph, input.economyRules);
  return {
    weapon: investment.tracks.weapon.currentValue,
    vitality: investment.tracks.vitality.currentValue,
    spirit: investment.tracks.spirit.currentValue,
  };
}

function validateIdentity(input: HistoricalPlannerTrajectoryExtractorV2Input): string[] {
  const errors: string[] = [];
  if (!input.matchId || !input.playerKey || !input.patchId || !input.rulesetId) errors.push('TRAJECTORY_IDENTITY_INCOMPLETE');
  if (!Number.isInteger(input.heroId) || input.heroId <= 0) errors.push('INVALID_HERO_ID');
  if (!/^[a-f0-9]{64}$/i.test(input.catalogSha256)) errors.push('INVALID_CATALOG_SHA');
  if (input.economyRules.rulesetId !== input.rulesetId ||
    input.economyRules.catalogSha256.toLowerCase() !== input.catalogSha256.toLowerCase()) {
    errors.push('ECONOMY_RULE_SCOPE_MISMATCH');
  }
  return errors.sort();
}

function stableIds(values: Iterable<number>): number[] {
  return [...new Set([...values])].sort((a, b) => a - b);
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isTime(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
