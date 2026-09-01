import {
  approvedDirectShopOpportunityV8,
  directShopSourceApprovalKey,
  parseDirectShopSourceAllowlist,
  sanitizePlayerStateDirectShopV8,
} from '../src/deadlock-live/recommendation-direct-shop-source-v8';
import { PlayerStatePayloadV8 } from '@deadlock-live-probe/shared';

function payload(
  shopOpportunity: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN',
  sourceField = 'onInfoUpdates2|match_info|match_info|shop_state',
): PlayerStatePayloadV8 {
  return {
    heroId: 1,
    shopOpportunity,
    shopOpportunityProvenance: shopOpportunity === 'UNKNOWN'
      ? undefined
      : {
          type: 'DIRECT_SOURCE_SIGNAL',
          sourceField,
        },
  } as PlayerStatePayloadV8;
}

describe('recommendation direct shop source trust', () => {
  const source = 'OVERWOLF_GEP';
  const sourceField = 'onInfoUpdates2|match_info|match_info|shop_state';
  const key = `${source}:${sourceField}`;

  it('keeps direct shop UNKNOWN when no source is approved', () => {
    expect(approvedDirectShopOpportunityV8(payload('AVAILABLE'), source, new Set())).toBe('UNKNOWN');
    expect(sanitizePlayerStateDirectShopV8(payload('AVAILABLE'), source, new Set())).toMatchObject({
      shopOpportunity: 'UNKNOWN',
      shopOpportunityProvenance: undefined,
    });
  });

  it('requires an exact telemetry source and exact source field', () => {
    const approved = new Set([key]);

    expect(approvedDirectShopOpportunityV8(payload('AVAILABLE'), 'OTHER_SOURCE', approved)).toBe('UNKNOWN');
    expect(approvedDirectShopOpportunityV8(payload('AVAILABLE', `${sourceField}_other`), source, approved)).toBe('UNKNOWN');
  });

  it('preserves AVAILABLE and UNAVAILABLE only for the exact approved direct source', () => {
    const approved = new Set([key]);

    expect(approvedDirectShopOpportunityV8(payload('AVAILABLE'), source, approved)).toBe('AVAILABLE');
    expect(approvedDirectShopOpportunityV8(payload('UNAVAILABLE'), source, approved)).toBe('UNAVAILABLE');
    expect(sanitizePlayerStateDirectShopV8(payload('AVAILABLE'), source, approved).shopOpportunityProvenance)
      .toEqual({ type: 'DIRECT_SOURCE_SIGNAL', sourceField });
  });

  it('never upgrades UNKNOWN into an observed shop state', () => {
    const approved = new Set([key]);

    expect(approvedDirectShopOpportunityV8(payload('UNKNOWN'), source, approved)).toBe('UNKNOWN');
  });

  it('normalizes approval keys and parses the allowlist conservatively', () => {
    expect(directShopSourceApprovalKey(' OVERWOLF_GEP ', ` ${sourceField} `)).toBe(key);
    expect([...parseDirectShopSourceAllowlist(` ${key},,${key} `)]).toEqual([key]);
  });
});
