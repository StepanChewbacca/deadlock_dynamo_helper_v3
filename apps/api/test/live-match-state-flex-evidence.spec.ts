import { LiveMatchStateService } from '../src/deadlock-live/live-match-state.service';

describe('LiveMatchStateService flex capacity evidence', () => {
  it('captures an explicit unlocked flex slot event', () => {
    const service = new LiveMatchStateService();

    const state = service.applyBatch({
      clientId: 'client-1',
      sentAt: new Date(0).toISOString(),
      events: [
        { key: 'match_id', payload: 'match-1' },
        { key: 'unlocked_flex_slots', payload: 2 },
      ],
    });

    expect(state?.unlockedFlexSlots).toBe(2);
    expect(state?.flexSlotsSource).toBe('overwolf:unlocked_flex_slots');
    expect(service.getSnapshots('match-1').at(-1)).toMatchObject({
      unlockedFlexSlots: 2,
      flexSlotsSource: 'overwolf:unlocked_flex_slots',
    });
  });

  it('captures an explicit flex field nested in a payload', () => {
    const service = new LiveMatchStateService();

    const state = service.applyBatch({
      clientId: 'client-1',
      sentAt: new Date(0).toISOString(),
      events: [
        { key: 'match_id', payload: 'match-1' },
        { key: 'match_info', payload: { unlocked_flex_slots: '3' } },
      ],
    });

    expect(state?.unlockedFlexSlots).toBe(3);
  });

  it('does not infer flex capacity from unrelated inventory or objective payloads', () => {
    const service = new LiveMatchStateService();

    const state = service.applyBatch({
      clientId: 'client-1',
      sentAt: new Date(0).toISOString(),
      events: [
        { key: 'match_id', payload: 'match-1' },
        { key: 'objective_state', payload: { objectives_completed: 4 } },
        { key: 'items_local', payload: { steam_id: '1', items: [] } },
      ],
    });

    expect(state?.unlockedFlexSlots).toBeUndefined();
    expect(state?.flexSlotsSource).toBeUndefined();
  });

  it('ignores invalid negative or fractional flex values', () => {
    const service = new LiveMatchStateService();

    const state = service.applyBatch({
      clientId: 'client-1',
      sentAt: new Date(0).toISOString(),
      events: [
        { key: 'match_id', payload: 'match-1' },
        { key: 'unlocked_flex_slots', payload: -1 },
        { key: 'flex_slots', payload: 1.5 },
      ],
    });

    expect(state?.unlockedFlexSlots).toBeUndefined();
  });
});
