# Upgrade Lineage Recommendation Satisfaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent already-satisfied lower-tier upgrade components from reappearing as BUY, targeted WAIT, replacement, NEXT, or PLANNED recommendations after an upgrade descendant is owned or projected.

**Architecture:** Make `RecommendationItemGraph` the single source of truth for transitive upgrade lineage and build-target satisfaction. Keep transaction legality (`feasible`) separate from recommendation policy eligibility, then make candidate generation and the structured stateful planner consume the same satisfaction invariant at current and projected inventory states.

**Tech Stack:** TypeScript 5.9, Yarn 1 workspaces, Jest/ts-jest, NestJS, `@deadlock-live-probe/build-domain`, Statlocker Adaptive Planner V1.

**Spec:** `docs/superpowers/specs/2026-09-04-upgrade-lineage-recommendation-satisfaction-design.md`

## Global Constraints

- Exact inventory must remain exact; consumed components must not be reinserted into inventory snapshots.
- `RecommendationCandidate.feasible` remains deterministic transaction/game legality.
- Recommendation suppression must be represented separately through `recommendationEligible` and `recommendationSuppressionReasons`.
- `RecommendationDatasetCandidateV1` and `toRecommendationDatasetCandidateV1()` remain unchanged by this fix.
- A target is satisfied when it is exactly owned or is a transitive component ancestor of any owned item.
- No item-name, hero-specific, or Warden-specific production logic is allowed.
- A normal replacement must not downgrade an owned descendant into an ancestor component.
- Projected planner inventory must recompute the same satisfaction semantics after every legal transition.
- Model weights, Behavioral/Value training, FUTURE_TEST, randomized traffic, and production rollout are out of scope.
- All code comments added by this work must be in English.

---

## File Structure

### Build domain

- `packages/deadlock-build-domain/src/recommendation-item-graph.ts`
  - Owns direct and transitive recipe lineage, target satisfaction, and satisfying-owner lookup.
- `packages/deadlock-build-domain/src/recommendation-action-domain.ts`
  - Owns the recommendation suppression reason type and candidate-level eligibility fields. Historical dataset V1 stays untouched.
- `packages/deadlock-build-domain/src/recommendation-candidate-generator.ts`
  - Evaluates transaction feasibility as before, then marks redundant lineage actions recommendation-ineligible and omits invalid targeted waits.
- `packages/deadlock-build-domain/test/recommendation-item-graph.spec.ts`
  - New focused lineage/satisfaction contract tests.
- `packages/deadlock-build-domain/test/recommendation-candidate-generator.spec.ts`
  - Candidate-level regressions for BUY, WAIT, REPLACE, transitive lineage, and unaffected unrelated actions.

### Adaptive planner

- `apps/api/src/statlocker-adaptive/adaptive-choice-resolver-v1.service.ts`
  - Reuses shared graph closure instead of maintaining an independent transitive definition.
- `apps/api/src/statlocker-adaptive/adaptive-phase-eligibility-v1.service.ts`
  - Makes group completion use shared target satisfaction and requires the graph where lineage semantics are needed.
- `apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts`
  - Uses satisfaction-aware completion/counting/target construction, filters recommendation-ineligible candidates, and excludes satisfied targets at every projected node.
- `apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts`
  - Change only if a failing projected-state test proves the current transition does not preserve the expected resulting inventory. Do not refactor it preemptively.
- `apps/api/test/adaptive-build-planner-v1.spec.ts`
  - Planner regression tests for current and projected descendant satisfaction.
- `apps/api/test/adaptive-policy-v1.integration.spec.ts`
  - End-to-end serving contract for lower-component suppression.
- `apps/api/test/adaptive-replay-v1.spec.ts`
  - Replay invariant that no satisfied ancestor is emitted as actionable NEXT/WAIT.

---

### Task 1: Shared transitive lineage and target-satisfaction API

**Files:**
- Create: `packages/deadlock-build-domain/test/recommendation-item-graph.spec.ts`
- Modify: `packages/deadlock-build-domain/src/recommendation-item-graph.ts`

**Interfaces:**
- Consumes: existing `RecommendationItemDefinition.upgradeRecipes[].consumedItemIds`.
- Produces:

```ts
getTransitiveComponentIds(itemId: number): readonly number[];
getTransitiveUpgradeIds(itemId: number): readonly number[];
isComponentAncestor(componentItemId: number, upgradedItemId: number): boolean;
isTargetSatisfied(targetItemId: number, ownedItemIds: Iterable<number>): boolean;
getSatisfyingOwnedItemIds(targetItemId: number, ownedItemIds: Iterable<number>): readonly number[];
```

- [ ] **Step 1: Add RED item-graph tests for direct, transitive, and multi-component lineage**

Create `packages/deadlock-build-domain/test/recommendation-item-graph.spec.ts` with a minimal graph factory and tests equivalent to:

```ts
import {
  createRecommendationItemGraph,
  RecommendationItemDefinition,
} from '../src';

function item(
  itemId: number,
  components: readonly number[] = [],
): RecommendationItemDefinition {
  return {
    itemId,
    name: `Item ${itemId}`,
    slotType: 'weapon',
    active: false,
    availableRulesetIds: ['r1'],
    directPurchaseCost: components.length === 0 ? 800 : undefined,
    upgradeRecipes: components.length === 0
      ? []
      : [{ recipeId: `upgrade-${itemId}`, consumedItemIds: components, soulsCost: 800 }],
    maxCopies: 1,
  };
}

describe('RecommendationItemGraph upgrade lineage', () => {
  it('resolves deterministic transitive component and upgrade closures', () => {
    const graph = createRecommendationItemGraph([
      item(1),
      item(2, [1]),
      item(3, [2]),
      item(4, [1]),
    ]);

    expect(graph.getTransitiveComponentIds(3)).toEqual([1, 2]);
    expect(graph.getTransitiveUpgradeIds(1)).toEqual([2, 3, 4]);
    expect(graph.isComponentAncestor(1, 3)).toBe(true);
    expect(graph.isComponentAncestor(3, 1)).toBe(false);
  });

  it('supports multi-component recipes and target satisfaction by descendants', () => {
    const graph = createRecommendationItemGraph([
      item(1),
      item(2),
      item(3, [1, 2]),
      item(4, [3]),
    ]);

    expect(graph.getTransitiveComponentIds(4)).toEqual([1, 2, 3]);
    expect(graph.isTargetSatisfied(1, [4])).toBe(true);
    expect(graph.isTargetSatisfied(3, [4])).toBe(true);
    expect(graph.isTargetSatisfied(4, [4])).toBe(true);
    expect(graph.isTargetSatisfied(2, [])).toBe(false);
    expect(graph.getSatisfyingOwnedItemIds(1, [4, 2])).toEqual([4]);
  });
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
yarn workspace @deadlock-live-probe/build-domain test --runTestsByPath test/recommendation-item-graph.spec.ts
```

Expected: TypeScript/Jest FAIL because the transitive/satisfaction methods do not exist on `RecommendationItemGraph`.

- [ ] **Step 3: Implement memoized transitive closures in `recommendation-item-graph.ts`**

Add the five methods to `RecommendationItemGraph`. Inside `createRecommendationItemGraph`, build closures from the already-validated acyclic graph. Use per-graph memo maps so repeated planner calls do not recursively traverse the graph.

The implementation shape should be:

```ts
const transitiveComponents = new Map<number, readonly number[]>();
const transitiveUpgrades = new Map<number, readonly number[]>();

const resolveComponents = (itemId: number): readonly number[] => {
  const cached = transitiveComponents.get(itemId);
  if (cached) return cached;

  const result = new Set<number>();
  const item = byId.get(itemId);
  for (const recipe of item?.upgradeRecipes ?? []) {
    for (const componentId of recipe.consumedItemIds) {
      result.add(componentId);
      for (const ancestorId of resolveComponents(componentId)) result.add(ancestorId);
    }
  }
  const sorted = [...result].sort((a, b) => a - b);
  transitiveComponents.set(itemId, sorted);
  return sorted;
};

const resolveUpgrades = (itemId: number): readonly number[] => {
  const cached = transitiveUpgrades.get(itemId);
  if (cached) return cached;

  const result = new Set<number>();
  for (const upgradeId of directUpgrades.get(itemId) ?? []) {
    result.add(upgradeId);
    for (const descendantId of resolveUpgrades(upgradeId)) result.add(descendantId);
  }
  const sorted = [...result].sort((a, b) => a - b);
  transitiveUpgrades.set(itemId, sorted);
  return sorted;
};
```

Expose satisfaction without mutating inventory:

```ts
isTargetSatisfied: (targetItemId, ownedItemIds) => {
  for (const ownedItemId of ownedItemIds) {
    if (ownedItemId === targetItemId) return true;
    if (resolveComponents(ownedItemId).includes(targetItemId)) return true;
  }
  return false;
},
getSatisfyingOwnedItemIds: (targetItemId, ownedItemIds) => [...new Set([...ownedItemIds])]
  .filter((ownedItemId) =>
    ownedItemId === targetItemId || resolveComponents(ownedItemId).includes(targetItemId),
  )
  .sort((a, b) => a - b),
```

Do not add a second graph representation or name-based mapping.

- [ ] **Step 4: Run focused domain tests and verify GREEN**

Run:

```bash
yarn workspace @deadlock-live-probe/build-domain test --runTestsByPath test/recommendation-item-graph.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run the entire build-domain suite**

Run:

```bash
yarn workspace @deadlock-live-probe/build-domain test
```

Expected: PASS with existing cycle, recipe, reducer, candidate, and snapshot contracts unchanged.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/deadlock-build-domain/src/recommendation-item-graph.ts \
  packages/deadlock-build-domain/test/recommendation-item-graph.spec.ts
git commit -m "feat(recommendation): add transitive upgrade lineage"
```

---

### Task 2: Separate recommendation eligibility from transaction feasibility

**Files:**
- Modify: `packages/deadlock-build-domain/src/recommendation-action-domain.ts`
- Modify: `packages/deadlock-build-domain/src/recommendation-candidate-generator.ts`
- Modify: `packages/deadlock-build-domain/test/recommendation-candidate-generator.spec.ts`

**Interfaces:**
- Consumes: Task 1 `RecommendationItemGraph.isTargetSatisfied()` and `isComponentAncestor()`.
- Produces:

```ts
export type RecommendationSuppressionReason =
  | 'TARGET_SATISFIED_BY_OWNED_UPGRADE'
  | 'LINEAGE_DOWNGRADE';

export interface RecommendationCandidate {
  // existing fields remain unchanged
  recommendationEligible: boolean;
  recommendationSuppressionReasons: readonly RecommendationSuppressionReason[];
}
```

`RecommendationDatasetCandidateV1` remains byte-for-byte semantically unchanged: do not add these fields to the dataset row and do not alter `toRecommendationDatasetCandidateV1()` output.

- [ ] **Step 1: Add RED candidate tests for the exact bug class**

Extend `recommendation-candidate-generator.spec.ts` with a small upgrade chain where item 1 is the lower component and item 2 consumes it:

```ts
it('suppresses a lower component when an owned upgrade already satisfies it', () => {
  const input = decision([
    item(1),
    item(2, {
      directPurchaseCost: 1_600,
      upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }],
    }),
  ], [2], 5_000);

  expect(candidate(input, 'BUY_ITEM:1')).toMatchObject({
    feasible: true,
    recommendationEligible: false,
    recommendationSuppressionReasons: ['TARGET_SATISFIED_BY_OWNED_UPGRADE'],
  });
});

it('does not emit targeted wait for a target already satisfied by an owned upgrade', () => {
  const input = decision([
    item(1, { directPurchaseCost: 6_400 }),
    item(2, {
      directPurchaseCost: 1_600,
      upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }],
    }),
  ], [2], 1_000);

  const candidates = generateRecommendationCandidates({ state: input.state, itemGraph: input.graph });
  expect(candidates.some((entry) => entry.actionId === 'WAIT_SAVE:1')).toBe(false);
});

it('suppresses a normal replacement that downgrades a descendant into its ancestor', () => {
  const input = decision([
    item(1),
    item(2, {
      directPurchaseCost: 1_600,
      upgradeRecipes: [{ recipeId: 'u2', consumedItemIds: [1], soulsCost: 800 }],
    }),
  ], [2], 5_000);

  expect(candidate(input, 'REPLACE_ITEM:2->1')).toMatchObject({
    recommendationEligible: false,
    recommendationSuppressionReasons: ['LINEAGE_DOWNGRADE'],
  });
});

it('keeps unrelated legal purchases recommendation-eligible', () => {
  const input = decision([item(1), item(2)], [2], 5_000);
  expect(candidate(input, 'BUY_ITEM:1')).toMatchObject({
    feasible: true,
    recommendationEligible: true,
    recommendationSuppressionReasons: [],
  });
});
```

Also add a transitive chain `1 -> 2 -> 3` assertion proving inventory `[3]` suppresses `BUY_ITEM:1` and `BUY_ITEM:2`.

- [ ] **Step 2: Run the focused candidate tests and verify RED**

Run:

```bash
yarn workspace @deadlock-live-probe/build-domain test --runTestsByPath test/recommendation-candidate-generator.spec.ts
```

Expected: FAIL because `RecommendationCandidate` has no recommendation eligibility fields and targeted WAIT still exists.

- [ ] **Step 3: Add explicit suppression types and candidate fields**

In `recommendation-action-domain.ts`, add the suppression type and the two fields to `RecommendationCandidate` only.

Do not modify this existing historical contract:

```ts
export interface RecommendationDatasetCandidateV1 { /* unchanged */ }
```

Do not add suppression fields inside `toRecommendationDatasetCandidateV1()`.

- [ ] **Step 4: Implement candidate suppression in the generator**

Add a helper that derives recommendation policy from the current inventory:

```ts
function recommendationSuppressionForTarget(
  state: RecommendationDecisionState,
  graph: RecommendationItemGraph,
  targetItemId: number,
): RecommendationSuppressionReason[] {
  const satisfying = graph.getSatisfyingOwnedItemIds(
    targetItemId,
    state.inventory.heldByItemId.keys(),
  );
  const satisfiedByUpgrade = satisfying.some((ownedItemId) => ownedItemId !== targetItemId);
  return satisfiedByUpgrade ? ['TARGET_SATISFIED_BY_OWNED_UPGRADE'] : [];
}
```

For direct `BUY_ITEM`, preserve all existing feasibility reasons and resulting inventory, then add recommendation suppression independently.

For `REPLACE_ITEM`, calculate policy against the post-sell retained inventory and use this precedence:

```ts
if (graph.isComponentAncestor(bought.itemId, sold.itemId)) {
  suppression.push('LINEAGE_DOWNGRADE');
} else if (graph.isTargetSatisfied(bought.itemId, afterSell)) {
  suppression.push('TARGET_SATISFIED_BY_OWNED_UPGRADE');
}
```

Set `recommendationEligible = suppression.length === 0` in `buildCandidate` through explicit parameters or a small helper. Existing generic `WAIT_SAVE` remains eligible.

When adding a target to `waitTargets`, require that the target is not already satisfied by current inventory:

```ts
if (!graph.isTargetSatisfied(item.itemId, state.inventory.heldByItemId.keys())) {
  waitTargets.add(item.itemId);
}
```

This prevents `WAIT_SAVE:<ancestor>` without pretending the unaffordable BUY transaction itself is illegal.

- [ ] **Step 5: Run focused candidate tests and verify GREEN**

Run:

```bash
yarn workspace @deadlock-live-probe/build-domain test --runTestsByPath test/recommendation-candidate-generator.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Verify historical Dataset V1 output is unchanged**

Keep the existing `preserves the no observed-action injection invariant in dataset rows` test and add an explicit assertion that the converted row does not expose recommendation policy fields:

```ts
const row = toRecommendationDatasetCandidateV1(input.state, candidate(input, 'BUY_ITEM:1'));
expect('recommendationEligible' in row).toBe(false);
expect('recommendationSuppressionReasons' in row).toBe(false);
```

Run the same focused suite and expect PASS.

- [ ] **Step 7: Run the full build-domain suite**

```bash
yarn workspace @deadlock-live-probe/build-domain test
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add packages/deadlock-build-domain/src/recommendation-action-domain.ts \
  packages/deadlock-build-domain/src/recommendation-candidate-generator.ts \
  packages/deadlock-build-domain/test/recommendation-candidate-generator.spec.ts
git commit -m "fix(recommendation): suppress satisfied upgrade ancestors"
```

---

### Task 3: Centralize adaptive completion and choice lineage on the shared graph

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-choice-resolver-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-phase-eligibility-v1.service.ts`
- Modify: `apps/api/test/adaptive-build-planner-v1.spec.ts`

**Interfaces:**
- Consumes: Task 1 graph transitive APIs.
- Produces: one shared definition of component closure and group completion for the adaptive planner.

- [ ] **Step 1: Add RED planner coverage for descendant-satisfied REQUIRED and CHOICE groups**

Use the existing test graph where item 11 upgrades item 1. Add tests equivalent to:

```ts
it('treats a required lower component as completed when its upgrade descendant is owned', () => {
  const result = planner.plan({
    decision: decision({ owned: [11], gameTimeSec: 700 }),
    evidence: evidence({
      groups: [
        group('lower-core', 'EARLY', 'REQUIRED', [1]),
        group('next-core', 'EARLY', 'REQUIRED', [4]),
      ],
    }),
  });

  expect(result.recommendedBuild.find((entry) => entry.status === 'NEXT')?.itemId).toBe(4);
  expect(result.recommendedBuild.some((entry) => entry.itemId === 1 && entry.status !== 'OWNED')).toBe(false);
});

it('recognizes an owned descendant as commitment to a lower CHOICE target', () => {
  const result = planner.plan({
    decision: decision({ owned: [11] }),
    evidence: evidence({
      groups: [group('choice', 'EARLY', 'CHOICE', [1, 2])],
      exactWpa: { 1: 0, 2: 1 },
    }),
  });

  expect(result.recommendedBuild.some((entry) => entry.itemId === 2 && entry.status === 'NEXT')).toBe(false);
});
```

The second assertion protects existing choice-commitment behavior while moving closure logic into the domain graph.

- [ ] **Step 2: Run the two focused tests and verify RED or semantic mismatch**

Run:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-build-planner-v1.spec.ts
```

Expected before the fix: at least the REQUIRED completion case fails because `resolveSemanticPlan()` currently initializes `completedGroupIds` via `groupCompletedV1(group, owned)` without the item graph and later counts exact ownership in REQUIRED groups.

- [ ] **Step 3: Replace local closure recursion with the shared graph API**

In `adaptive-choice-resolver-v1.service.ts`, keep `componentClosureV1` only as a compatibility wrapper for existing callers:

```ts
export function componentClosureV1(
  itemId: number,
  itemGraph: RecommendationItemGraph,
): ReadonlySet<number> {
  return new Set(itemGraph.getTransitiveComponentIds(itemId));
}
```

Do not leave an independent recursive closure implementation in adaptive code.

- [ ] **Step 4: Make group completion satisfaction-aware and graph-required**

Change `groupCompletedV1` to require `RecommendationItemGraph` and count satisfied candidates through the shared method:

```ts
export function groupCompletedV1(
  group: ConsensusBuildGroupV1,
  ownedItemIds: ReadonlySet<number>,
  itemGraph: RecommendationItemGraph,
): boolean {
  const satisfiedCount = group.candidates.reduce(
    (count, candidate) => count + (
      itemGraph.isTargetSatisfied(candidate.itemId, ownedItemIds) ? 1 : 0
    ),
    0,
  );
  if (group.type === 'OPTIONAL') return satisfiedCount > 0;
  return satisfiedCount >= Math.max(1, group.minSelect);
}
```

Update every caller in `AdaptivePhaseEligibilityV1Service` to pass `context.itemGraph`. Make `itemGraph` non-optional in `AdaptivePhaseEligibilityContextV1` so serving code cannot silently fall back to exact ownership.

- [ ] **Step 5: Update planner call sites to pass the graph**

In `resolveSemanticPlan()` initialize completion with:

```ts
if (groupCompletedV1(group, owned, input.decision.itemGraph)) {
  completedGroupIds.add(group.groupId);
}
```

Any other `groupCompletedV1` call must pass the same graph.

- [ ] **Step 6: Run planner tests and verify GREEN**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-build-planner-v1.spec.ts
```

Expected: PASS for new tests plus all existing phase/choice tests.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-choice-resolver-v1.service.ts \
  apps/api/src/statlocker-adaptive/adaptive-phase-eligibility-v1.service.ts \
  apps/api/test/adaptive-build-planner-v1.spec.ts
git commit -m "refactor(adaptive): share upgrade satisfaction semantics"
```

---

### Task 4: Make semantic target construction and stateful search satisfaction-aware

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts`
- Test: `apps/api/test/adaptive-build-planner-v1.spec.ts`
- Modify only if proven necessary: `apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts`

**Interfaces:**
- Consumes: Task 1 `isTargetSatisfied`, Task 2 `recommendationEligible`.
- Produces: planner invariant that no current or projected node can action an already-satisfied target.

- [ ] **Step 1: Add RED regression for current descendant ownership**

Using the existing item 1 -> item 11 upgrade relation, add:

```ts
it('never emits a satisfied lower component as NEXT, BUY, or targeted WAIT', () => {
  const result = planner.plan({
    decision: decision({ owned: [11], wallet: 100 }),
    evidence: evidence({
      groups: [
        group('old-milestone', 'EARLY', 'REQUIRED', [1]),
        group('next-milestone', 'EARLY', 'REQUIRED', [4]),
      ],
    }),
  });

  expect(result.recommendedBuild.some((entry) => entry.itemId === 1 && entry.status !== 'OWNED')).toBe(false);
  expect(result.rankedImmediateCandidates.some((entry) => entry.action.targetItemId === 1)).toBe(false);
  expect(result.nextAction.targetItemId).not.toBe(1);
});
```

- [ ] **Step 2: Add RED regression for projected upgrade state**

Construct a path where item 1 is owned, item 11 upgrades item 1, and the planner has another later target. Assert that after projecting `UPGRADE_ITEM:11:upgrade-11`, the consumed item 1 does not return as a later BUY/WAIT step. The easiest public assertion is that the final `recommendedBuild` contains item 11/later targets but never item 1 as NEXT/PLANNED after item 11 is projected.

Use existing test helpers and fixed IDs 1 and 11 rather than item names.

- [ ] **Step 3: Run planner suite and verify RED**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-build-planner-v1.spec.ts
```

Expected: current implementation can still admit lower ancestors because REQUIRED counting, target closure construction, near-future staging, and node candidate filtering use exact ownership in several places.

- [ ] **Step 4: Add local satisfaction helpers in the planner that delegate to the graph**

Do not duplicate traversal. Use helpers such as:

```ts
function targetSatisfiedByInventory(
  targetItemId: number,
  inventoryItemIds: Iterable<number>,
  graph: RecommendationItemGraph,
): boolean {
  return graph.isTargetSatisfied(targetItemId, inventoryItemIds);
}
```

If the graph type is not currently imported in this file, import only the type needed from `@deadlock-live-probe/build-domain`.

- [ ] **Step 5: Replace exact-ownership counting during semantic plan resolution**

For REQUIRED groups, calculate satisfied candidates rather than exact-owned candidates:

```ts
const satisfiedCandidates = group.candidates
  .filter((candidate) => input.decision.itemGraph.isTargetSatisfied(candidate.itemId, owned))
  .map((candidate) => candidate.itemId);

const needed = Math.max(
  0,
  Math.max(1, group.minSelect) - satisfiedCandidates.length,
);
```

When selecting remaining candidates, exclude anything already satisfied:

```ts
.filter((candidate) =>
  !input.decision.itemGraph.isTargetSatisfied(candidate.itemId, owned),
)
```

For completed non-choice groups, only exact-owned items need to be shown as `OWNED`; satisfied consumed ancestors should not be re-added to actionable build rows.

- [ ] **Step 6: Exclude satisfied components while constructing active/support targets**

When traversing each selected final item's component closure, replace exact `owned.has(componentId)` checks with:

```ts
if (input.decision.itemGraph.isTargetSatisfied(componentId, owned)) continue;
```

Apply the same rule to final targets and future target owners. A target already satisfied by current inventory must never enter `targetItemIds` or `activeTargetItemIds`.

- [ ] **Step 7: Make near-future staging satisfaction-aware**

In `selectNearFutureRequiredTargets()`, replace exact `ownedCount`, exact candidate filtering, and component-step counting with satisfaction checks against the current inventory.

For a candidate target:

```ts
const stepIds = uniqueNumbers([
  entry.itemId,
  ...componentClosureV1(entry.itemId, input.decision.itemGraph),
]).filter((itemId) =>
  !input.decision.itemGraph.isTargetSatisfied(itemId, owned),
);
```

This ensures an already-upgraded chain does not consume planning depth for completed lower milestones.

- [ ] **Step 8: Filter recommendation-ineligible candidates before scoring**

In `evaluateNodeCandidates()` change the pipeline from only feasibility:

```ts
.filter((candidate) => candidate.feasible)
```

to:

```ts
.filter((candidate) => candidate.feasible)
.filter((candidate) => candidate.recommendationEligible)
```

Then add a second fail-safe filter against the projected node inventory target satisfaction before semantic scoring. For target-bearing actions, derive `candidateTargetItemId(candidate)` and reject the candidate when the node inventory already satisfies that target, except a genuine `UPGRADE_ITEM` whose target is a descendant and not itself satisfied.

The intended helper shape is:

```ts
function candidateTargetAlreadySatisfied(
  candidate: RecommendationCandidate,
  node: AdaptivePlannerNodeV1,
  graph: RecommendationItemGraph,
): boolean {
  const targetItemId = candidateTargetItemId(candidate);
  if (targetItemId === undefined) return false;
  if (candidate.action.type === 'UPGRADE_ITEM') {
    return graph.isTargetSatisfied(targetItemId, node.decisionState.inventory.heldByItemId.keys());
  }
  return graph.isTargetSatisfied(targetItemId, node.decisionState.inventory.heldByItemId.keys());
}
```

Keep the helper explicit even if both branches currently have the same expression, because the action distinction is part of the invariant review and future upgrade semantics.

- [ ] **Step 9: Verify projected inventory before changing transition code**

Run the projected-state test. If it now passes, leave `adaptive-planner-transition-v1.ts` untouched.

Only if the test proves projected inventory is wrong, inspect `projectPlannerCandidateV1()` and make the minimal change so its next `decisionState.inventory` is rebuilt from `candidate.resultingItemIds`. Do not introduce a separate inventory simulation path; candidate generation remains the transaction source of truth.

- [ ] **Step 10: Run planner suite and verify GREEN**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-build-planner-v1.spec.ts
```

Expected: PASS, including existing chronology, CHOICE, investment, slot, and churn regressions.

- [ ] **Step 11: Commit Task 4**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts \
  apps/api/test/adaptive-build-planner-v1.spec.ts
if git diff --quiet -- apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts; then
  true
else
  git add apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts
fi
git commit -m "fix(adaptive): skip satisfied upgrade targets"
```

---

### Task 5: Add serving and replay regressions for the production bug class

**Files:**
- Modify: `apps/api/test/adaptive-policy-v1.integration.spec.ts`
- Modify: `apps/api/test/adaptive-replay-v1.spec.ts`
- Modify only if an existing shared fixture is the established pattern: the corresponding fixture file already used by those tests.

**Interfaces:**
- Consumes: Tasks 1-4 behavior.
- Produces: end-to-end and replay gates that prevent future regressions outside unit-level planner tests.

- [ ] **Step 1: Add an integration regression using stable synthetic catalog IDs**

Do not use item-name checks in production logic. In the integration test, define explicit fixed IDs representing the observed shape:

```ts
const HIGH_VELOCITY_ROUNDS_TEST_ID = 910001;
const OPENING_ROUNDS_TEST_ID = 910002;
```

Build the test catalog so Opening consumes High-Velocity through an upgrade recipe, put only Opening in current inventory, and make the lower component otherwise score highly enough that the old behavior would surface it.

Assert the public adaptive result:

```ts
expect(result.nextAction.targetItemId).not.toBe(HIGH_VELOCITY_ROUNDS_TEST_ID);
expect(result.recommendedBuild.some((entry) =>
  entry.itemId === HIGH_VELOCITY_ROUNDS_TEST_ID && entry.status !== 'OWNED',
)).toBe(false);
expect(result.rankedImmediateCandidates.some((entry) =>
  entry.action.targetItemId === HIGH_VELOCITY_ROUNDS_TEST_ID,
)).toBe(false);
```

Name the test `does not recommend a consumed lower component after its upgrade is owned` so the production incident class is searchable without relying on real catalog names.

- [ ] **Step 2: Run integration test and verify it passes only after Tasks 1-4**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-policy-v1.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Add replay invariant counters/assertions**

In `adaptive-replay-v1.spec.ts`, for every replay decision with a known graph:

```ts
const ownedItemIds = decision.state.inventory.heldByItemId.keys();
const actionableTargets = [
  result.nextAction.targetItemId,
  ...result.recommendedBuild
    .filter((entry) => entry.status === 'NEXT' || entry.status === 'PLANNED')
    .map((entry) => entry.itemId),
].filter((itemId): itemId is number => itemId !== undefined);

for (const targetItemId of actionableTargets) {
  const exactOwned = decision.state.inventory.heldByItemId.has(targetItemId);
  const satisfiedByDescendant = !exactOwned &&
    decision.itemGraph.isTargetSatisfied(targetItemId, ownedItemIds);
  expect(satisfiedByDescendant).toBe(false);
}
```

If the replay suite already aggregates rates rather than asserting per decision, add counters named:

```text
redundantAncestorRecommendationRate
satisfiedTargetAsNextRate
satisfiedTargetAsWaitRate
```

and require each to equal zero. Follow the suite's existing reporting style rather than creating a second metrics framework.

- [ ] **Step 4: Run replay test**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-replay-v1.spec.ts
```

Expected: PASS with zero lineage violations.

- [ ] **Step 5: Run the three adaptive regression files together**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/adaptive-build-planner-v1.spec.ts \
  test/adaptive-policy-v1.integration.spec.ts \
  test/adaptive-replay-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/api/test/adaptive-policy-v1.integration.spec.ts \
  apps/api/test/adaptive-replay-v1.spec.ts
git commit -m "test(adaptive): lock upgrade lineage regressions"
```

---

### Task 6: Full verification, diff review, and PR handoff

**Files:**
- Review all files changed by Tasks 1-5.
- No production source changes should be introduced in this task unless a verification failure is traced back through the systematic-debugging process and gets its own RED test first.

**Interfaces:**
- Consumes: all previous task commits.
- Produces: exact-head verification evidence suitable for PR review.

- [ ] **Step 1: Run the full build-domain suite**

```bash
yarn workspace @deadlock-live-probe/build-domain test
```

Expected: PASS.

- [ ] **Step 2: Run the full API test suite**

```bash
yarn workspace @deadlock-live-probe/api test
```

Expected: PASS.

- [ ] **Step 3: Run workspace build**

```bash
yarn build
```

Expected: PASS for all workspaces.

- [ ] **Step 4: Run workspace tests**

```bash
yarn test
```

Expected: PASS for all workspaces.

- [ ] **Step 5: Inspect the final diff for scope violations**

Run:

```bash
git diff main...HEAD -- \
  packages/deadlock-build-domain \
  apps/api/src/statlocker-adaptive \
  apps/api/test \
  docs/superpowers
```

Verify all of the following manually:

```text
no item-name special cases
no hero-specific suppression
no scoring-weight workaround
no mutation of exact inventory snapshots
no RecommendationDatasetCandidateV1 schema change
no Behavioral/Value training changes
no FUTURE_TEST changes
no randomized traffic changes
feasible remains transaction legality
recommendationEligible is checked before adaptive scoring
all transitive lineage traversal delegates to RecommendationItemGraph
```

- [ ] **Step 6: Run exact-head CI/security workflows through the repository PR**

Create a PR from `agent/fix-upgrade-lineage-recommendations` to `main` with a body that records:

```text
Root cause:
exact ownership was used where build-target satisfaction was required.

Correctness contract:
owned/projected upgrade descendants satisfy their transitive lower components.

Safety:
transaction feasibility remains separate from recommendation eligibility;
Dataset V1 is unchanged;
no training/FUTURE_TEST/randomized traffic.
```

Wait for the repository's standard CI, Recommendation CI, Recommendation Security, and GitGuardian checks that apply to the changed paths.

- [ ] **Step 7: Review CI failures scientifically if any**

For each failed check:

```text
read the complete failure
reproduce or identify the failing boundary
form one root-cause hypothesis
add/adjust one failing regression if source behavior is wrong
make one minimal fix
rerun focused test before broad verification
```

Do not stack speculative fixes.

- [ ] **Step 8: Invoke `superpowers:verification-before-completion` before claiming the fix is complete**

Record the exact PR head SHA and fresh test/CI evidence. Completion requires:

```text
redundant ancestor BUY not actionable
satisfied ancestor targeted WAIT absent
lineage downgrade replacement not actionable
satisfied ancestor never NEXT/PLANNED
projected upgrade preserves satisfaction
build-domain tests PASS
API tests PASS
workspace build PASS
workspace tests PASS
required GitHub checks PASS
```

- [ ] **Step 9: Commit any documentation-only verification update if needed**

If the PR/runbook convention requires a verification note, commit only that note. Otherwise do not create a meaningless final commit.
