import { LiveMatchStateService } from '../src/deadlock-live/live-match-state.service';

describe('LiveMatchStateService flex capacity evidence', () => {
  const event = (key: string, payload: unknown) => ({
    receivedAt: 0,
    source: 'onInfoUpdates2' as const,
    key,
    payload,
  });

  it('captures an explicit unlocked flex slot event', () => {
    const service = new LiveMatchStateService();

    const state = service.applyBatch({
      clientId: 'client-1',
      sentAt: new Date(0).toISOString(),
      events: [
        event('match_id', 'match-1'),
        event('unlocked_flex_slots', 2),
      ],
    });

    expect(state?.unlockedFlexSlots).toBe(2);
    expect(state?.flexSlotsSource).toBe('overwolf:unlocked_flex_slots');
    const snapshots = service.getSnapshots('match-1');
    expect(snapshots[snapshots.length - 1]).toMatchObject({
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
        event('match_id', 'match-1'),
        event('match_info', { unlocked_flex_slots: '3' }),
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
        event('match_id', 'match-1'),
        event('objective_state', { objectives_completed: 4 }),
        event('items_local', { steam_id: '1', items: [] }),
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
        event('match_id', 'match-1'),
        event('unlocked_flex_slots', -1),
        event('flex_slots', 1.5),
      ],
    });

    expect(state?.unlockedFlexSlots).toBeUndefined();
  });
});
