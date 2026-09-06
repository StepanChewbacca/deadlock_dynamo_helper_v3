# Transaction-First Plan Layer Design

## Context

The strategy-first planner is already on `main` and correctly models strategy identity, build status, goals, branch commitment, slot planning, investment objectives, and short receding-horizon search. The current failure is at the next boundary: the planner still emits `recommendedBuild: AdaptivePlannedItemV1[]` as the user-facing build path. That representation stores only `itemId + OWNED/NEXT/PLANNED`, so transaction semantics such as upgrade consumption, replacement, future flex requirements, and explicit slot-release obligations are flattened away.

The current shared contract already exposes `strategy.slotPlan.futureTransitions`, including `requirement`, `sourceItemId`, and `requiredUnlockedFlexSlots`, while `StrategyFirstBuildPlannerV1Service.buildRecommendedBuild()` turns unresolved goals back into flat item rows. This permits a logically coherent strategy layer to become an incoherent UI path.

This design replaces the flat build path as source of truth with a persistent transaction plan.

## Goal

Every future build target shown to the user must belong to an explicit, replayable plan step whose slot, inventory, recipe, affordability, and prerequisite semantics are known.

The system must be able to answer, for every displayed target:

1. What exact action will eventually obtain this target?
2. If inventory capacity is insufficient, what exact prior transition creates capacity?
3. If the target is blocked, what condition must become true first?
4. If an existing item must be sold, which item and why?
5. Which strategic goal is this step advancing?

A future item without such an answer is not allowed in the build path.

## Chosen architecture

Use the existing strategy-first architecture and insert a transaction-first planning layer between `BuildContractV1` and the API/UI projection.

```text
BuildStrategySpec
      -> StrategySession
      -> BuildContract
      -> Transaction Plan Compiler / Replanner
      -> PlanSession
          -> planSteps[]          source of truth
          -> nextAction           derived from first executable step
          -> recommendedBuild[]   compatibility projection only
      -> API / Overwolf
```

Do not replace the existing deterministic candidate generator, item graph, slot rules, economy rules, strategy selector, BuildContract, or contextual scorer. They remain authoritative for their current responsibilities.

## Core semantic separation

### Build goal

Describes what the selected strategy wants to achieve.

Examples:

- complete a core power spike;
- choose one branch;
- satisfy a hard investment objective;
- reserve a situational response window.

### Plan step

Describes the concrete transaction or blocking condition required to advance a goal.

Examples:

- `BUY`;
- `UPGRADE`;
- `SELL_AND_BUY`;
- wait until enough souls are available;
- wait until enough flex slots are unlocked.

### Next action

The first transaction that is executable now.

A barrier may be the first incomplete plan step, but a barrier is never `NEXT`. If a barrier is first, the runtime action is `HOLD` with a structured waiting reason.

## Domain contracts

### `PlanSessionV1`

`PlanSessionV1` is the source of truth for the current match/player transaction plan.

```ts
export type PlanSessionStateV1 =
  | 'ACTIVE'
  | 'WAITING'
  | 'REPLAN_REQUIRED'
  | 'COMPLETE';

export interface PlanSessionV1 {
  planSessionId: string;
  strategyId: string;
  revision: number;
  createdAtGameTimeSec: number;
  updatedAtGameTimeSec: number;
  state: PlanSessionStateV1;
  steps: readonly PlanStepV1[];
  nextStepId?: string;
  reasonCodes: readonly string[];
}
```

The session is persistent across recommendation ticks. A new tick reconciles the current plan against the current exact state and replans only the affected suffix.

`revision` changes when plan structure changes. Merely marking an existing step complete does not require a new semantic plan identity.

### `PlanStepV1`

```ts
export type PlanStepStateV1 =
  | 'LOCKED'
  | 'BLOCKED'
  | 'READY'
  | 'NEXT'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'INVALIDATED'
  | 'SKIPPED';

export type PlanStepKindV1 = 'TRANSACTION' | 'BARRIER';

export interface PlanStepV1 {
  stepId: string;
  goalId: string;
  kind: PlanStepKindV1;
  state: PlanStepStateV1;
  action?: PlannedTransactionV1;
  barrier?: PlanBarrierV1;
  prerequisiteStepIds: readonly string[];
  blockingReasons: readonly PlanStepBlockReasonV1[];
  projectedBefore: PlanProjectionV1;
  projectedAfter?: PlanProjectionV1;
  reasonCodes: readonly string[];
}
```

Exactly one of `action` or `barrier` is present according to `kind`.

### Transaction actions

```ts
export type PlannedTransactionV1 =
  | {
      type: 'BUY';
      buyItemId: number;
    }
  | {
      type: 'UPGRADE';
      buyItemId: number;
      consumedItemIds: readonly number[];
      recipeId?: string;
    }
  | {
      type: 'SELL_AND_BUY';
      sellItemId: number;
      buyItemId: number;
    };
```

A standalone `SELL` is not part of the normal user-facing transaction plan. If the planner needs to free capacity for a future purchase, the strategic intent is represented as `SELL_AND_BUY`. This prevents the plan from telling the user to sell an item without proving the replacement transaction.

The deterministic domain may continue to expose atomic `SELL_ITEM` candidates for internal search and diagnostics.

### Barrier steps

```ts
export type PlanBarrierV1 =
  | {
      type: 'WAIT_FOR_GOLD';
      targetItemId: number;
      requiredSouls: number;
    }
  | {
      type: 'WAIT_FOR_FLEX';
      targetItemId: number;
      requiredUnlockedFlexSlots: number;
    }
  | {
      type: 'WAIT_FOR_SHOP';
      targetItemId: number;
    }
  | {
      type: 'WAIT_FOR_PREREQUISITE';
      prerequisiteGoalId: string;
    };
```

A barrier does not mutate inventory. Completion is derived from exact current state.

### Projection

`PlanProjectionV1` captures enough deterministic projected state to prove reachability without duplicating the entire live decision payload.

```ts
export interface PlanProjectionV1 {
  inventoryItemIds: readonly number[];
  spendableSouls?: number;
  usedByType: Readonly<Record<'weapon' | 'vitality' | 'spirit', number>>;
  flexUsed: number;
  unlockedFlexSlots?: number;
  activeItemsUsed: number;
}
```

The plan compiler must be able to replay each step from `projectedBefore` to `projectedAfter` using the same deterministic transition functions used by live candidate generation.

## `SELL_AND_BUY` semantics

For planner and UI, `SELL_AND_BUY` is one atomic strategic step.

For validation, it is two deterministic transitions:

```text
S0
 -> SELL sellItemId
 -> S1
 -> BUY buyItemId
 -> S2
```

The composite step exists only if both transitions are valid in sequence.

Validation must prove:

- sold item is currently projected-owned;
- sell semantics and refund are known;
- post-sale inventory is legal;
- the new item is ruleset-available;
- the post-sale wallet can afford the buy;
- the final inventory is slot-legal;
- active-item limits are legal;
- completed hard goals are not broken unless the BuildContract explicitly authorizes replacement;
- committed branch invariants are preserved;
- replacement does not downgrade a satisfied upgrade lineage accidentally.

If any condition fails, no `SELL_AND_BUY` step may be emitted.

## How the planner chooses what to sell

Sale choice must be strategic, not merely the cheapest item or first removable slot occupant.

Candidate sale targets are filtered in this order:

1. The item is legally sellable and exact sell semantics are known.
2. The item is not required by a currently satisfied hard goal unless that goal explicitly permits replacement.
3. The item is not evidence of a committed branch that the plan still depends on.
4. The item is not a required component for a planned near-term upgrade unless the replacement supersedes that goal.
5. Selling it does not make an already completed hard investment requirement invalid without an explicit replan.
6. The replacement transaction is legal after the sale.

The remaining sale candidates are scored by strategic replacement cost:

```text
replacementUtility =
  targetGoalProgress
  + contextualTargetValue
  + investmentAlignment
  + futureSlotHeadroom
  - lostGoalValue
  - lostInvestmentValue
  - branchDeviationPenalty
  - churnPenalty
  - recentPurchasePenalty
```

The planner may choose `HOLD/WAIT` instead of replacing an item if every legal replacement has negative net strategic utility.

## Full-inventory invariant

For every future inventory-increasing transaction, the projected state after all preceding steps must be legal.

If capacity is unavailable, exactly one of the following must exist before the purchase:

- a component-consuming `UPGRADE`;
- a `SELL_AND_BUY` replacement;
- a prior transaction that compresses inventory;
- a `WAIT_FOR_FLEX` barrier that explicitly names the required flex capacity.

If no such path exists, the goal remains visible only at the strategy/goal level and the plan state becomes `REPLAN_REQUIRED`. It must not appear as a normal `PLANNED` item.

## Stable step identity

`stepId` identifies semantic intent rather than a recommendation tick.

Use a deterministic fingerprint derived from:

```text
strategyId
+ goalId
+ action/barrier type
+ target item
+ sold/consumed item identity where relevant
+ branch identity where relevant
```

This allows the reconciler to distinguish:

- same step, changed status;
- same goal, changed transaction;
- removed goal;
- newly inserted barrier;
- newly inserted replacement.

## Reconciliation and partial replanning

Each recommendation tick performs:

```text
previous PlanSession
+ current exact decision state
+ current StrategySession
+ current BuildContract
 -> reconcile completed/invalidated steps
 -> locate first affected step
 -> preserve valid prefix
 -> rebuild only affected suffix
 -> revalidate entire resulting path
```

A step becomes `COMPLETED` only from exact current state and item-graph semantics, never from display order or target-name matching.

Examples:

- `BUY X` completes when X is owned or a documented exact successor semantics says the goal is already satisfied.
- `UPGRADE A -> B` completes when B or a satisfying descendant is owned and consumed components are absent as expected.
- `SELL_AND_BUY A -> B` completes only when B is owned and A is no longer held, unless the item graph defines a transformed successor relation that proves equivalent semantics.
- `WAIT_FOR_FLEX` completes when observed/reconstructed unlocked flex reaches the required threshold.

If the player manually deviates, only the affected suffix is replanned unless the StrategySession itself changes to `DIVERGED/OOD`.

## Planning algorithm

The current strategy-first beam search remains useful, but its output changes from a list of candidate targets to a path of transaction candidates.

### Step 1 - resolve current semantic goal

Use the existing BuildContract and investment/situational logic.

### Step 2 - compile target obligations

For active and near-future hard goals, compile explicit acquisition obligations:

```text
Goal -> target item/family -> legal acquisition modes
```

### Step 3 - generate legal transactions

Use `generateRecommendationCandidates()` as the authoritative transaction source for the current projected node.

Do not synthesize BUY/UPGRADE/REPLACE legality in the plan compiler.

### Step 4 - add barriers only when the target remains strategically valid but cannot yet be executed

Examples:

- insufficient wallet -> `WAIT_FOR_GOLD`;
- insufficient current flex but future strategy permits flex dependency -> `WAIT_FOR_FLEX`;
- shop unavailable -> `WAIT_FOR_SHOP`.

A barrier must be supported by a known condition. Unknown slot capacity does not become `WAIT_FOR_FLEX`; it becomes `REPLAN_REQUIRED` or degraded/hold because the planner cannot prove the required future state.

### Step 5 - search 2-5 transaction steps ahead

The beam node carries:

- projected exact inventory;
- projected wallet;
- projected slot state;
- projected investment state;
- BuildContract state;
- transaction steps;
- barriers that must occur before a future transaction;
- cumulative utility.

### Step 6 - compile `PlanSession`

The best coherent path is converted to stable steps, then reconciled against the previous session.

## Relationship to existing slot planner

`BuildSlotPlannerV1Service` continues to represent strategic slot obligations and future transition requirements.

Its current `futureTransitions` are no longer directly rendered as build items. Instead they become constraints consumed by the transaction plan compiler.

Mapping examples:

```text
requirement = UPGRADE
 -> emitted path must contain an upgrade/compression step before target acquisition

requirement = REPLACE
 -> emitted path must contain SELL_AND_BUY(sourceItemId, targetItemId)

requirement = SELL_TEMPORARY
 -> compile to SELL_AND_BUY of the temporary item and target; do not emit naked SELL

requirement = FLEX_UNLOCK
 -> emit WAIT_FOR_FLEX before target transaction

requirement = BLOCKED
 -> no target transaction; session REPLAN_REQUIRED unless another legal strategy path exists
```

## Next action derivation

`nextAction` is derived from the first incomplete transaction step that is executable now.

Rules:

- only transaction steps may become `NEXT`;
- a barrier never becomes `NEXT`;
- if the first incomplete step is an unsatisfied barrier, runtime returns `HOLD` with barrier reason codes;
- if the first transaction is not legal under current exact state, the plan must replan before serving; it may not return stale `NEXT`;
- `nextAction.targetItemId` must agree with `planSession.nextStepId`.

## API migration

Introduce a new source-of-truth field on the adaptive recommendation result:

```ts
planSession?: AdaptivePlanSessionV1;
```

During migration, keep existing fields:

```ts
recommendedBuild: readonly AdaptivePlannedItemV1[];
nextAction: AdaptiveActionV1;
```

but derive them from `planSession`.

The compatibility projection must never influence planning decisions.

Recommended V1-compatible mapping:

- owned inventory -> `OWNED` rows;
- transaction target of the current `NEXT` step -> `NEXT`;
- future transaction targets -> `PLANNED`;
- barrier-only target may be projected as `PLANNED` only if the UI also receives and renders its blocking transaction/barrier metadata; otherwise omit it from legacy projection.

The new Overwolf UI must consume `planSession.steps` directly.

## UI semantics

Each path row renders a transaction, not just a target item.

Examples:

```text
NEXT
Upgrade Debuff Reducer -> Dispel Magic

PLANNED
Buy Mystic Expansion
Before purchase: sell Extra Regen

BLOCKED
Spirit Resilience
Waiting for Flex Slot 1/2
```

For `SELL_AND_BUY`, copy should be generated from structured IDs, never inferred by the client.

The UI may visually emphasize the buy target, but the sale is mandatory visible information near the target.

## Observability

Log plan-level diagnostics on every changed revision:

- `planSessionId`;
- `revision`;
- preserved prefix length;
- inserted/removed/invalidated step IDs;
- first blocked reason;
- next step/action;
- every `SELL_AND_BUY` pair;
- projected slot state before/after each future transaction;
- plan reachability result;
- reason for replan;
- whether output used transaction-first or compatibility fallback.

Add counters:

```text
transaction_plan_generated_total
transaction_plan_replanned_total{reason}
transaction_plan_blocked_total{reason}
transaction_plan_replace_total
transaction_plan_unreachable_total
transaction_plan_projection_mismatch_total
transaction_plan_step_churn_total
```

## Failure behavior

Fail closed when correctness cannot be proven.

Examples:

- unknown flex capacity where a future item needs extra capacity -> HOLD/REPLAN_REQUIRED;
- unknown sell transition -> no SELL_AND_BUY using that item;
- projected path violates slot capacity -> discard path;
- projection differs from deterministic replay -> discard plan revision;
- current state no longer matches preserved prefix assumptions -> invalidate suffix and replan;
- no coherent reachable path -> BuildContract remains strategy-aware but plan state is `REPLAN_REQUIRED`.

The planner must never hide a failure by falling back to a flat item list that violates transaction invariants.

## Legacy planner boundary

The serving router may continue to support legacy fallback during migration, but transaction-first promotion must have a separate gate.

A legacy fallback result is explicitly marked and must not pretend to have a transaction plan.

Once transaction-first replay and production gates pass, user-facing strategy-first serving must require `planSession` completeness. Legacy flat-plan serving may remain only as emergency fallback until separately retired.

## Hard invariants

1. Zero future target items without a `PlanStep`.
2. Zero `BUY` into a projected illegal slot state.
3. Zero `SELL_AND_BUY` without deterministic `SELL -> BUY` validation.
4. Zero client-side inference of what item should be sold.
5. Zero hidden flex assumptions.
6. Zero naked strategic SELL generated only to make room.
7. Zero full-plan rebuild on every normal state tick.
8. Zero `NEXT` steps that are not executable now.
9. Zero step completion inferred from UI ordering/name equality.
10. Zero future `PLANNED` target with unknown slot-release path.
11. Zero mismatch between `nextAction` and `planSession.nextStepId`.
12. Zero compatibility projection influence on planner search.

## Testing strategy

### Unit tests

- stable `stepId` generation;
- barrier completion;
- composite replacement validation;
- protected-goal sale filtering;
- slot projection across chained steps;
- partial replan prefix preservation;
- completion reconciliation against upgrade lineage.

### Integration tests

- strategy goal -> transaction plan -> next action;
- full inventory -> explicit replacement;
- full inventory -> upgrade compression;
- full inventory -> wait for flex;
- no slot path -> replan required;
- manual player deviation -> suffix replan only;
- strategy switch -> new plan session;
- legacy projection derived from plan session.

### Golden replay gates

Add fixtures for the observed production class of failure and require:

```text
futureTargetWithoutStepRate = 0
projectedSlotViolationRate = 0
unreachablePlanRate = 0
replaceWithoutValidatedBuyRate = 0
nextStepMismatchRate = 0
fullRebuildWithoutSemanticChangeRate = 0
clientInferredReplacementRate = 0
```

## Rollout

1. Domain contracts and tests only.
2. Transaction plan compiler behind feature flag.
3. Shadow generation beside current strategy-first output.
4. Compare current flat path against transaction path; record mismatches.
5. Make `recommendedBuild[]` a derived compatibility projection.
6. Update desktop UI to transaction rows.
7. Update in-game overlay.
8. Promote transaction-first source of truth after replay and shadow gates.
9. Keep emergency legacy fallback explicitly marked.
10. Retire direct flat-plan generation after one stable production window.

## Non-goals

This change does not redesign archetype mining, BuildStrategySpec semantics, Behavioral/Value ML, Statlocker evidence collection, or BuildLM. It fixes the semantic boundary between strategy planning and executable/user-visible build progression.

## Success criterion

For any recommendation screen, a reviewer can start from the current inventory and replay every future displayed transaction/barrier in order without encountering an unexplained item, impossible slot state, hidden sale, or undefined prerequisite.
