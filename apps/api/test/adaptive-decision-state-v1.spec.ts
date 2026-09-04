import { MinimalMatchState } from '@deadlock-live-probe/shared';
import { AdaptiveDecisionStateV1Service } from '../src/statlocker-adaptive/adaptive-decision-state-v1.service';

const matchState: MinimalMatchState = {
  matchId: 'match-1',
  gameTimeSec: 600,
  lastUpdatedAt: '2026-08-31T12:00:00.000Z',
  playersBySteamId: {
    local: {
      steamId: 'local',
      playerName: 'Local',
      isLocal: true,
      heroId: 10,
      teamId: 1,
      souls: 2000,
      items: [{ id: 1, name: 'Owned', className: 'owned', enhanced: false }],
    },
    ally: {
      steamId: 'ally',
      playerName: 'Ally',
      heroId: 11,
      teamId: 1,
      souls: 3000,
      items: [],
    },
    enemyB: {
      steamId: 'enemy-b',
      playerName: 'Enemy B',
      heroId: 30,
      teamId: 2,
      souls: 5000,
      items: [],
    },
    enemyA: {
      steamId: 'enemy-a',
      playerName: 'Enemy A',
      heroId: 20,
      teamId: 2,
      souls: 4000,
      items: [],
    },
  },
};

const version = {
  catalogVersionId: 'catalog-1',
  rulesetKey: 'ruleset-a',
  source: 'TEST',
  payloadSha256: 'a'.repeat(64),
  importedAt: new Date('2026-08-31T11:00:00.000Z'),
};

const items = [
  {
    catalogVersionId: 'catalog-1',
    itemId: 1,
    name: 'Owned',
    className: 'owned',
    slotType: 'weapon',
    cost: 500,
    rawPayload: {
      type: 'upgrade',
      shopable: true,
      disabled: false,
      is_active_item: false,
      activation: 'passive',
    },
  },
  {
    catalogVersionId: 'catalog-1',
    itemId: 2,
    name: 'Target',
    className: 'target',
    slotType: 'vitality',
    cost: 1250,
    rawPayload: {
      type: 'upgrade',
      shopable: true,
      disabled: false,
      is_active_item: false,
      activation: 'passive',
    },
  },
];

function createService(scopeVerified: boolean, state: MinimalMatchState = matchState) {
  const liveState = { getState: jest.fn().mockReturnValue(state) } as any;
  const soulsEvidence = { canVerifyScope: jest.fn().mockResolvedValue(scopeVerified) } as any;
  const versionRepo = { find: jest.fn().mockResolvedValue([version]) } as any;
  const itemRepo = { find: jest.fn().mockResolvedValue(items) } as any;
  const recipeRepo = { find: jest.fn().mockResolvedValue([]) } as any;
  return {
    service: new AdaptiveDecisionStateV1Service(liveState, soulsEvidence, versionRepo, itemRepo, recipeRepo),
    versionRepo,
  };
}

describe('AdaptiveDecisionStateV1Service', () => {
  it('builds an ML-neutral deterministic decision state from live state and catalog rows', async () => {
    const { service, versionRepo } = createService(true);
    const first = await service.build('match-1');
    const second = await service.build('match-1');

    expect(versionRepo.find).toHaveBeenCalledWith({
      order: { importedAt: 'DESC', catalogVersionId: 'DESC' },
      take: 1,
    });
    expect(first.localSteamId).toBe('local');
    expect(first.state.heroId).toBe(10);
    expect([...first.state.inventory.heldByItemId.keys()]).toEqual([1]);
    expect(first.itemGraph.getItem(2)?.itemId).toBe(2);
    expect(first.rulesetId).toBe('ruleset-a');
    expect(first.catalogSha256).toBe('a'.repeat(64));
    expect(first.state.gameTimeSec).toBe(600);
    expect(first.enemyHeroIds).toEqual([20, 30]);
    expect(first.ourTeamSouls).toBe(5000);
    expect(first.enemyTeamSouls).toBe(9000);
    expect(first.slots.usedFlexSlots).toBe(0);
    expect(first.slots.unlockedFlexSlots).toBeUndefined();
    expect(first.slots.evidence).toBe('UNKNOWN');
    expect(first.economyRules).toBeUndefined();
    expect(first.economyRulesEvidence).toBe('UNKNOWN');
    expect(first.investment.evidence).toBe('UNKNOWN');
    expect(first.stateRevision).toBe(second.stateRevision);
  });

  it('promotes roster souls to spendable only for an exact verified scope', async () => {
    const verified = await createService(true).service.build('match-1');
    expect(verified.state.economy.spendableSouls.value).toBe(2000);
    expect(verified.state.economy.spendableSouls.evidence).toBe('OBSERVED');

    const unverified = await createService(false).service.build('match-1');
    expect(unverified.state.economy.spendableSouls.value).toBeUndefined();
    expect(unverified.state.economy.spendableSouls.evidence).toBe('UNKNOWN');
  });

  it('keeps shop opportunity and flex capacity unknown and refuses partial team soul totals', async () => {
    const state = structuredClone(matchState);
    delete state.playersBySteamId.ally.souls;
    const result = await createService(true, state).service.build('match-1');

    expect(result.state.economy.shopOpportunity.value).toBeUndefined();
    expect(result.state.economy.shopOpportunity.evidence).toBe('UNKNOWN');
    expect(result.slots.evidence).toBe('UNKNOWN');
    expect(result.ourTeamSouls).toBeUndefined();
    expect(result.enemyTeamSouls).toBe(9000);
  });
});
