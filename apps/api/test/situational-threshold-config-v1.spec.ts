import { readFileSync } from 'fs';
import { join } from 'path';
import { ADAPTIVE_POLICY_V1_CONFIG } from '../src/statlocker-adaptive/statlocker-adaptive.config';

const resolverSource = readFileSync(
  join(__dirname, '../src/statlocker-adaptive/build-situational-resolver-v1.service.ts'),
  'utf8',
);
const overlaySource = readFileSync(
  join(__dirname, '../src/statlocker-adaptive/strategy-first-situational-overlay-v1.service.ts'),
  'utf8',
);

describe('situational threshold configuration V1', () => {
  it('defines one authoritative situational improvement threshold', () => {
    expect(ADAPTIVE_POLICY_V1_CONFIG.situational.minImprovementOverCore).toBe(0.08);
  });

  it('requires the resolver to receive the configured threshold and removes the hidden fallback', () => {
    expect(resolverSource).toContain('minOverrideImprovement: number;');
    expect(resolverSource).not.toContain('minOverrideImprovement ??');
    expect(overlaySource).toContain(
      'minOverrideImprovement: ADAPTIVE_POLICY_V1_CONFIG.situational.minImprovementOverCore',
    );
  });
});
