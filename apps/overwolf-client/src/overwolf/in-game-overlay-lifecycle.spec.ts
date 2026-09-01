import { InGameOverlayLifecycle } from './in-game-overlay-lifecycle';

describe('InGameOverlayLifecycle', () => {
  test('restores the in-game overlay when a match becomes active', () => {
    const restore = jest.fn();
    const lifecycle = new InGameOverlayLifecycle(restore);

    lifecycle.sync('103088762');

    expect(restore).toHaveBeenCalledTimes(1);
  });

  test('does not repeatedly restore for every event in the same match', () => {
    const restore = jest.fn();
    const lifecycle = new InGameOverlayLifecycle(restore);

    lifecycle.sync('103088762');
    lifecycle.sync('103088762');
    lifecycle.sync('103088762');

    expect(restore).toHaveBeenCalledTimes(1);
  });

  test('restores again after match end or when a new match starts', () => {
    const restore = jest.fn();
    const lifecycle = new InGameOverlayLifecycle(restore);

    lifecycle.sync('103088762');
    lifecycle.sync('');
    lifecycle.sync('103088999');

    expect(restore).toHaveBeenCalledTimes(2);
  });
});
