import { toAdaptiveBuildContractViewV1 } from '../src/statlocker-adaptive/adaptive-strategy-state-view-v1';

describe('adaptive strategy state views', () => {
  it('serializes sets and maps instead of losing them through JSON persistence', () => {
    const view = toAdaptiveBuildContractViewV1({
      strategyId: 'strategy-a',
      status: 'IN_PROGRESS',
      currentGoalId: 'core',
      completedGoalIds: new Set(['early']),
      remainingGoalIds: ['core'],
      committedChoiceItemIdsByGroup: new Map([['branch', [2, 1]]]),
      temporaryItemIds: new Set([99]),
      slotReservations: [{ goalId: 'core', targetItemId: 2, state: 'READY', reasonCodes: [] }],
      situationalWindowStates: [{ windowId: 'catch', state: 'OPEN', targetItemIds: [3], reasonCodes: [] }],
      replanReasonCodes: [],
    });

    expect(view.completedGoalIds).toEqual(['early']);
    expect(view.committedChoices).toEqual([{ groupId: 'branch', itemIds: [1, 2] }]);
    expect(view.temporaryItemIds).toEqual([99]);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
