import {
  canonicalRulesetCatalogJsonV1,
  canonicalizeRulesetCatalogV1,
  requireAuthoritativeRulesetCatalogV1,
  RulesetCatalogInputV1,
  RulesetCatalogValidationError,
} from '../src';

const baseInput = (): RulesetCatalogInputV1 => ({
  rulesetKey: 'deadlock-standard-2026-08-20',
  clientVersion: '6101',
  source: 'fixture',
  authority: 'FIXTURE',
  sourceArtifactSha256: 'a'.repeat(64),
  inventoryRuleset: {
    duplicateItemsAllowed: false,
    baseSlotsByType: {
      weapon: 4,
      vitality: 4,
      spirit: 4,
    },
    maxFlexSlots: 4,
  },
  items: [
    {
      itemId: 300,
      slotType: 'spirit',
      cost: 3000,
      tier: 3,
      shopable: true,
      disabled: false,
      active: true,
      sellValue: 1500,
    },
    {
      itemId: 100,
      slotType: 'weapon',
      cost: 500,
      tier: 1,
      shopable: true,
      disabled: false,
      active: true,
    },
    {
      itemId: 200,
      slotType: 'spirit',
      cost: 1250,
      tier: 2,
      shopable: true,
      disabled: false,
      active: true,
    },
  ],
  recipes: [
    { parentItemId: 300, componentItemIds: [200, 100] },
    { parentItemId: 200, componentItemIds: [100] },
  ],
});

describe('ruleset catalog v1', () => {
  it('canonicalizes item, recipe, and component ordering deterministically', () => {
    const first = baseInput();
    const second = baseInput();
    second.items.reverse();
    second.recipes.reverse();
    second.recipes[0].componentItemIds.reverse();

    expect(canonicalRulesetCatalogJsonV1(first)).toBe(canonicalRulesetCatalogJsonV1(second));
    expect(canonicalizeRulesetCatalogV1(first)).toMatchObject({
      schemaVersion: 1,
      rulesetKey: 'deadlock-standard-2026-08-20',
      clientVersion: '6101',
      authority: 'FIXTURE',
      sourceArtifactSha256: 'a'.repeat(64),
      items: [{ itemId: 100 }, { itemId: 200 }, { itemId: 300 }],
      recipes: [
        { parentItemId: 200, componentItemIds: [100] },
        { parentItemId: 300, componentItemIds: [100, 200] },
      ],
    });
  });

  it('preserves repeated component ids instead of silently changing recipe multiplicity', () => {
    const input = baseInput();
    input.recipes = [{ parentItemId: 300, componentItemIds: [100, 100, 200] }];

    expect(canonicalizeRulesetCatalogV1(input).recipes[0].componentItemIds).toEqual([100, 100, 200]);
  });

  it('requires a cryptographic source artifact digest', () => {
    const input = baseInput();
    input.sourceArtifactSha256 = 'not-a-sha';

    expectValidationCode(
      () => canonicalizeRulesetCatalogV1(input),
      'INVALID_SOURCE_ARTIFACT_SHA256',
    );
  });

  it('rejects secondary and fixture sources for exact production legality', () => {
    const secondary = baseInput();
    secondary.authority = 'SECONDARY_API';
    secondary.source = 'deadlock-api-assets';
    expectValidationCode(
      () => requireAuthoritativeRulesetCatalogV1(secondary),
      'NON_AUTHORITATIVE_SOURCE',
    );

    const fixture = baseInput();
    expectValidationCode(
      () => requireAuthoritativeRulesetCatalogV1(fixture),
      'NON_AUTHORITATIVE_SOURCE',
    );
  });

  it('accepts an explicitly authoritative installed-game artifact', () => {
    const input = baseInput();
    input.authority = 'AUTHORITATIVE_INSTALLED_GAME';
    input.source = 'installed-game-vpk-extract';
    input.sourceArtifactSha256 = 'b'.repeat(64);

    expect(requireAuthoritativeRulesetCatalogV1(input)).toMatchObject({
      authority: 'AUTHORITATIVE_INSTALLED_GAME',
      source: 'installed-game-vpk-extract',
      sourceArtifactSha256: 'b'.repeat(64),
    });
  });

  it('rejects invalid slot types from untyped JSON input', () => {
    const input = baseInput();
    (input.items[0] as { slotType: string }).slotType = 'unknown';

    expectValidationCode(() => canonicalizeRulesetCatalogV1(input), 'INVALID_SLOT_TYPE');
  });

  it('rejects duplicate item ids', () => {
    const input = baseInput();
    input.items.push({ ...input.items[0] });

    expectValidationCode(() => canonicalizeRulesetCatalogV1(input), 'DUPLICATE_ITEM_ID');
  });

  it('rejects missing recipe components', () => {
    const input = baseInput();
    input.recipes = [{ parentItemId: 300, componentItemIds: [999] }];

    expectValidationCode(
      () => canonicalizeRulesetCatalogV1(input),
      'RECIPE_COMPONENT_NOT_IN_CATALOG',
    );
  });

  it('rejects direct and transitive recipe cycles', () => {
    const selfCycle = baseInput();
    selfCycle.recipes = [{ parentItemId: 300, componentItemIds: [300] }];
    expectValidationCode(() => canonicalizeRulesetCatalogV1(selfCycle), 'RECIPE_SELF_CYCLE');

    const transitiveCycle = baseInput();
    transitiveCycle.recipes = [
      { parentItemId: 100, componentItemIds: [300] },
      { parentItemId: 200, componentItemIds: [100] },
      { parentItemId: 300, componentItemIds: [200] },
    ];
    expectValidationCode(() => canonicalizeRulesetCatalogV1(transitiveCycle), 'RECIPE_GRAPH_CYCLE');
  });
});

function expectValidationCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`Expected ${code} validation error.`);
  } catch (error) {
    expect(error).toBeInstanceOf(RulesetCatalogValidationError);
    expect(error).toMatchObject({ code });
  }
}
