import {
  ADAPTIVE_POLICY_V1_CONFIG,
  loadAdaptivePolicyV1Config,
} from '../src/statlocker-adaptive/statlocker-adaptive.config';

describe('adaptive policy v1 config', () => {
  it('keeps the approved deterministic defaults', () => {
    expect(ADAPTIVE_POLICY_V1_CONFIG.gameStateThreshold).toBe(0.08);
    expect(ADAPTIVE_POLICY_V1_CONFIG.exactEnemyMaxMatchups).toBe(3);
    expect(ADAPTIVE_POLICY_V1_CONFIG.planningDepth).toBe(3);
    expect(ADAPTIVE_POLICY_V1_CONFIG.beamWidth).toBe(8);
    expect(ADAPTIVE_POLICY_V1_CONFIG.sellMinImprovement).toBeGreaterThan(
      ADAPTIVE_POLICY_V1_CONFIG.minPlanSwitchImprovement,
    );
    expect(ADAPTIVE_POLICY_V1_CONFIG.coreReplaceMinImprovement).toBeGreaterThan(
      ADAPTIVE_POLICY_V1_CONFIG.sellMinImprovement,
    );
  });

  it('accepts bounded overrides and reports invalid values while falling back', () => {
    const loaded = loadAdaptivePolicyV1Config({
      ADAPTIVE_GAME_STATE_THRESHOLD: '0.10',
      ADAPTIVE_PLANNING_DEPTH: '99',
      ADAPTIVE_BEAM_WIDTH: 'not-a-number',
    });

    expect(loaded.config.gameStateThreshold).toBe(0.10);
    expect(loaded.config.planningDepth).toBe(3);
    expect(loaded.config.beamWidth).toBe(8);
    expect(loaded.diagnostics.map((entry) => entry.key).sort()).toEqual([
      'ADAPTIVE_BEAM_WIDTH',
      'ADAPTIVE_PLANNING_DEPTH',
    ]);
  });
});
