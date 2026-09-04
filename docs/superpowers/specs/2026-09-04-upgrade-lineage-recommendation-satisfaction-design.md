# Upgrade Lineage Recommendation Satisfaction Design

## Status

Approved design for implementation.

## Problem

The recommender currently distinguishes exact inventory ownership from non-ownership by item ID, but it does not consistently model build-target satisfaction across upgrade lineage.

For an upgrade chain such as:

```text
High-Velocity Rounds
    -> component of
Opening Rounds
```

when the current inventory contains `Opening Rounds`, the exact inventory correctly no longer contains `High-Velocity Rounds` because the component was consumed. However, a direct `BUY_ITEM` candidate for `High-Velocity Rounds` can still be generated because candidate generation only checks exact ownership. This allows a completed lower-tier milestone to re-enter immediate recommendation ranking.

The same semantic gap can affect targeted waits, replacement candidates, planner target construction, phase/group completion, near-future target staging, and final build presentation.

## Root Cause

There are currently two distinct concepts but only one is consistently represented:

```text
EXACT_OWNERSHIP
BUILD_TARGET_SATISFACTION
```

Exact ownership answers whether the exact item ID is in the current inventory. Build-target satisfaction answers whether the current or projected inventory has already progressed through that target by owning the target itself or any transitive upgrade descendant that consumed it.

The item graph already has direct component and upgrade edges and validates the graph as acyclic. The adaptive choice resolver also contains a local transitive `componentClosureV1` helper, and phase eligibility can optionally treat a candidate as complete when an owned descendant contains it in its component closure. The semantics are therefore partially implemented but duplicated, optional, and not available as a shared domain invariant.

Candidate generation still uses exact ownership only for direct BUY/REPLACE eligibility, so an upgraded descendant does not suppress a redundant lower-tier recommendation.

## Goals

1. A lower-tier component already satisfied by an owned upgrade descendant must never be recommended as the next build target.
2. The same lower-tier component must not appear as a targeted WAIT recommendation.
3. A normal replacement must not downgrade an owned descendant into one of its ancestors.
4. Planner completion, active targets, future targets, and final build output must use one shared transitive lineage definition.
5. Current and projected planner states must recompute satisfaction after every legal action transition.
6. Exact inventory remains exact. We do not fake ownership of consumed components.
7. Game legality and recommendation eligibility remain separate concepts.
8. The fix must be generic for arbitrary acyclic multi-level and multi-component recipe graphs. No item-name special cases.

## Non-Goals

- Do not change item scoring weights to hide the problem.
- Do not teach the ML model upgrade rules.
- Do not alter real inventory snapshots to include consumed components.
- Do not claim that Deadlock itself forbids rebuying a lower component unless the authoritative ruleset explicitly says so.
- Do not add hero-specific or item-specific hacks.

## Core Domain Semantics

### Exact ownership

```text
exactlyOwned(target, inventory)
=
inventory contains target.itemId
```

### Component ancestry

`A` is an ancestor component of `B` when `A` appears anywhere in the transitive component closure of `B`.

### Build-target satisfaction

```text
satisfied(target, inventory)
=
exactlyOwned(target, inventory)
OR
exists ownedItem where target is a transitive component ancestor of ownedItem
```

Example:

```text
A -> B -> C
inventory = [C]

A satisfied = true
B satisfied = true
C satisfied = true
```

### Lineage relation

For diagnostics and future rules, classify two item IDs as:

```text
EXACT
ANCESTOR
DESCENDANT
UNRELATED
```

From the perspective of `(target, owned)`:

- `EXACT`: same item.
- `ANCESTOR`: target is a transitive component of owned item. Target is already satisfied.
- `DESCENDANT`: target is an upgrade descendant of owned item. Target may be a valid future upgrade.
- `UNRELATED`: no lineage relation.

## Architecture

### 1. RecommendationItemGraph becomes the single lineage source of truth

Extend `RecommendationItemGraph` with transitive APIs. Suggested contract:

```ts
getTransitiveComponentIds(itemId: number): readonly number[];
getTransitiveUpgradeIds(itemId: number): readonly number[];
isComponentAncestor(componentItemId: number, upgradedItemId: number): boolean;
isTargetSatisfied(targetItemId: number, ownedItemIds: Iterable<number>): boolean;
getSatisfyingOwnedItemIds(targetItemId: number, ownedItemIds: Iterable<number>): readonly number[];
```

Implementation requirements:

- deterministic sorted output;
- memoized closures per immutable graph instance;
- no recursion-cycle ambiguity because graph construction already rejects cycles;
- support multiple recipes and multiple components;
- shared semantics used by domain and adaptive planner code.

The local `componentClosureV1` logic in adaptive code should become a thin compatibility wrapper or be replaced by the graph API. There must not be multiple independent definitions of transitive component closure.

### 2. Separate game feasibility from recommendation eligibility

`RecommendationCandidate.feasible` should continue to mean the deterministic transaction can legally execute under known rules/economy/slots.

A new recommendation-level suppression concept should prevent strategically redundant lineage actions without falsely claiming the game itself forbids them.

Preferred shape:

```ts
recommendationEligible: boolean;
recommendationSuppressionReasons: readonly RecommendationSuppressionReason[];
```

with at least:

```text
TARGET_SATISFIED_BY_OWNED_UPGRADE
LINEAGE_DOWNGRADE
```

If changing the shared candidate contract creates excessive migration risk, an equivalent planner eligibility filter is acceptable for the first implementation, but the shared domain graph must still expose satisfaction and tests must prove that every serving path applies it. The preferred end state is explicit candidate eligibility because it improves telemetry and prevents downstream consumers from forgetting the invariant.

### 3. Candidate generation rules

For `BUY_ITEM(target)`:

- exact owned behavior stays unchanged;
- if target is not exactly owned but is satisfied by an owned descendant, transaction feasibility is evaluated normally;
- recommendation eligibility becomes false with `TARGET_SATISFIED_BY_OWNED_UPGRADE`.

For `WAIT_SAVE(target)`:

- never emit a targeted wait for a target already satisfied by current inventory;
- the unconditional generic `WAIT_SAVE` remains allowed.

For `REPLACE_ITEM(sold -> bought)`:

- if `bought` is an ancestor component of `sold`, suppress as `LINEAGE_DOWNGRADE`;
- if another retained owned item already satisfies `bought`, suppress as `TARGET_SATISFIED_BY_OWNED_UPGRADE`;
- future explicit respec/downgrade behavior, if ever needed, requires a separately named policy path and cannot silently use normal replacement.

For `UPGRADE_ITEM(target)`:

- normal descendant progression remains valid when required components are present;
- exact target ownership/max-copy behavior remains unchanged.

### 4. Planner semantic completion must use shared satisfaction

Every place that asks whether a structured build candidate/group is completed must use `itemGraph.isTargetSatisfied(...)`, not exact set membership.

Specifically:

- initial `completedGroupIds` construction;
- `groupCompletedV1`;
- REQUIRED candidate counting;
- CHOICE state reconstruction;
- OPTIONAL completion;
- future REQUIRED/CHOICE staging;
- target/support closure construction;
- previous-plan validity checks.

The item graph must always be supplied when completion semantics depend on lineage. Optional graph parameters that silently degrade to exact ownership should be removed where practical or must not be used in serving code.

### 5. Active and future target construction

When building `targetItemIds`, `activeTargetItemIds`, and future target owners:

- never add an item already satisfied by the node inventory;
- when traversing a final target's component closure, skip every component already satisfied by the node inventory, not only exact-owned components;
- after a projected upgrade, recompute against projected inventory so consumed ancestors do not return in a later beam step.

This is essential for multi-level chains:

```text
A -> B -> C
```

After projecting `B`, `A` is satisfied even though `A` disappeared from exact inventory.

### 6. Stateful search invariant

The current structured planner already projects legal actions into `AdaptivePlannerNodeV1`. This design keeps that architecture and adds the invariant:

```text
For every node, no generated recommendation target may already be satisfied by node.decisionState.inventory.
```

Candidate generation and semantic-target filtering must both enforce the invariant so a later refactor cannot reintroduce the bug through a different path.

### 7. Final build presentation

`recommendedBuild` must not present a consumed ancestor as `NEXT` or `PLANNED` after an owned/projected descendant has satisfied it.

Preferred presentation behavior:

- exact current items stay `OWNED`;
- consumed ancestors are omitted from actionable build rows;
- if internal diagnostics need them, represent them as completed/satisfied metadata outside the actionable user build path, not as purchasable steps.

`nextAction.targetItemId` and the first actionable build item must remain aligned.

## Data Flow

```text
Catalog recipes
    -> RecommendationItemGraph
       -> transitive lineage closures

Live exact inventory
    -> exact ownership
    -> target satisfaction derived from graph

Candidate generator
    -> legal transaction feasibility
    -> recommendation eligibility/suppression

Structured planner
    -> group completion by satisfaction
    -> semantic targets excluding satisfied ancestors
    -> legal stateful transitions
    -> projected inventory
    -> recomputed satisfaction

Policy output
    -> first executable unsatisfied target only
```

## Error Handling and Fail-Closed Behavior

1. Missing recipe component references remain graph-construction errors.
2. Cycles remain graph-construction errors.
3. Unknown item IDs in current inventory do not imply lineage satisfaction for known targets.
4. Missing lineage data must never invent an upgrade relationship.
5. If a target has no known graph definition, existing fail-closed serving behavior applies.
6. Recommendation suppression is deterministic and must not depend on model confidence.

## Telemetry

Add counters/reason codes where the current observability layer supports them:

```text
TARGET_SATISFIED_BY_OWNED_UPGRADE
LINEAGE_DOWNGRADE
TARGET_SATISFIED_BY_PROJECTED_UPGRADE
```

Recommended aggregate metrics:

```text
redundantAncestorRecommendationRate
lineageDowngradeRecommendationRate
satisfiedTargetAsNextRate
satisfiedTargetAsWaitRate
```

All release-gate values above must be zero.

## Testing Strategy

Implementation must follow TDD with failing regressions before production code changes.

### Domain item-graph tests

1. direct ancestry: `A -> B`;
2. transitive ancestry: `A -> B -> C`;
3. multi-component recipe: `A + B -> C`;
4. shared component branches: `A -> B`, `A -> C`;
5. deterministic sorted closure output;
6. target satisfaction for exact and descendant ownership.

### Candidate generator tests

1. inventory `[A]` -> upgrade `B` remains eligible;
2. inventory `[B]` -> `BUY A` is not recommendation-eligible;
3. inventory `[B]` -> no `WAIT_SAVE:A`;
4. inventory `[B]` -> `REPLACE B -> A` is suppressed as lineage downgrade;
5. inventory `[C]` for `A -> B -> C` -> both `A` and `B` are satisfied;
6. unrelated direct purchases remain unaffected;
7. legal direct duplicate semantics remain governed by maxCopies/ruleset, not by lineage suppression.

### Planner tests

1. structured group containing `A`, inventory `[B]` where `A -> B` -> group completed;
2. lower ancestor absent from semantic active targets;
3. projected `UPGRADE B` prevents `A` from appearing in the next beam step;
4. near-future staging does not count satisfied ancestors as steps;
5. previous plan containing lower ancestor is rebased/invalidated rather than preserved as `NEXT`;
6. final build never contains a satisfied ancestor as `NEXT` or `PLANNED`.

### Golden regression

Create a named regression fixture for the observed production class:

```text
hero: Warden
inventory: Opening Rounds
lower component target: High-Velocity Rounds
approx game time: 5:27

assert:
High-Velocity Rounds != displayed NEXT
High-Velocity Rounds != selected BUY
High-Velocity Rounds != targeted WAIT
```

The fixture should use stable item IDs from the current catalog rather than item-name matching in production logic.

### Integration/replay gates

Existing structured planner domain, API, integration, and replay suites remain mandatory.

Additional replay invariants:

```text
redundantAncestorRecommendationRate = 0
lineageDowngradeRecommendationRate = 0
satisfiedTargetAsNextRate = 0
satisfiedTargetAsWaitRate = 0
nextActionBuildMismatchRate = 0
illegalActionRate = 0
```

## Implementation Boundaries

Primary files expected to change:

```text
packages/deadlock-build-domain/src/recommendation-item-graph.ts
packages/deadlock-build-domain/src/recommendation-action-domain.ts
packages/deadlock-build-domain/src/recommendation-candidate-generator.ts
packages/deadlock-build-domain/test/recommendation-candidate-generator.spec.ts

apps/api/src/statlocker-adaptive/adaptive-choice-resolver-v1.service.ts
apps/api/src/statlocker-adaptive/adaptive-phase-eligibility-v1.service.ts
apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts
apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts
apps/api/test/adaptive-build-planner-v1.spec.ts
apps/api/test/adaptive-policy-v1.integration.spec.ts
apps/api/test/adaptive-replay-v1.spec.ts
```

Exact file set may shrink if the shared graph API removes the need for local changes.

## Rollout

This is a deterministic correctness fix, not a model experiment.

Merge/deploy gate:

1. new RED regressions reproduced on pre-fix code;
2. domain tests green;
3. API/adaptive unit tests green;
4. integration tests green;
5. replay regression gates green;
6. full existing Recommendation CI/security checks green on the exact head;
7. no change to training, FUTURE_TEST, randomized traffic, or Value/Behavioral models.

## Acceptance Criteria

The design is complete when all of the following are true:

```text
owned descendant => lower component target is satisfied
satisfied target => cannot be actionable NEXT
satisfied target => cannot be targeted WAIT
normal replacement => cannot downgrade descendant to ancestor
projected upgrade => recomputes target satisfaction
all planner completion checks use shared graph semantics
no item-specific hardcoded exceptions
all regression and replay gates pass
```
