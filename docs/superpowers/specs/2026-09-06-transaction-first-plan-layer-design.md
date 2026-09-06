# Transaction-First Plan Layer Design

## Context

The strategy-first planner is already on `main` and models strategy identity, build status, goals, branch commitment, slot planning, investment objectives, and a short receding-horizon search. The remaining failure is at the next boundary: the planner still emits `recommendedBuild: AdaptivePlannedItemV1[]` as the user-facing Build Path. That representation stores only `itemId + OWNED/NEXT/PLANNED`, so upgrade consumption, replacement, future flex requirements, and explicit slot-release obligations are flattened away.

The current shared contract already exposes `strategy.slotPlan.futureTransitions`, including `requirement`, `sourceItemId`, and `requiredUnlockedFlexSlots`. `StrategyFirstBuildPlannerV1Service.buildRecommendedBuild()` then converts unresolved strategy goals back into flat item rows. A coherent strategy can therefore become an incoherent user-visible path.

This design replaces the flat Build Path as source of truth with a persistent transaction plan.

## Goal

Every future build target shown to the user must belong to an explicit, replayable plan step whose slot, inventory, recipe, affordability, and prerequisite semantics are known.

For every displayed target the system must be able to answer:

1. What exact action obtains this target?
2. If current inventory has no capacity, what exact prior transition creates capacity?
3. If the target is blocked, what exact condition must become true first?
4. If an existing item must be sold, which item and why?
5. Which strategic goal is this step advancing?

A future item without those answers is not allowed in the Build Path.

## Chosen architecture

Keep the merged strategy-first architecture and insert a transaction-first layer between `BuildContractV1` and API/UI projection.

```text
BuildStrategySpec
      -> StrategySession
      -> BuildContract
      -> Transaction Plan Compiler
      -> Transaction Plan Validator
      -> Plan Reconciler
      -> PlanSession
          -> steps[]              source of truth
          -> nextAction           derived
          -> recommendedBuild[]   compatibility projection only
      -> API / Overwolf
```

Do not replace the deterministic candidate generator, item graph, slot rules, economy rules, strategy selector, BuildContract, or contextual scorer. They remain authoritative for their current responsibilities.

## Core semantic separation

### Build goal

Describes what the selected strategy wants to achieve: a core spike, branch, investment objective, situational reservation, or terminal obligation.

### Plan step

Describes the concrete transaction or blocking condition required to advance a goal.

### Next action

The first transaction step that is executable now.

A barrier may be the first incomplete plan step, but a barrier is never `NEXT`. If an unsatisfied barrier is first, the runtime action is `HOLD` with a structured waiting reason.

## Domain contracts

### `AdaptivePlanSessionV1`

```ts
export type AdaptivePlanSessionStateV1 =
  | 'ACTIVE'
  | 'WAITING'
  | 'REPLAN_REQUIRED'
  | 'COMPLETE';

export interface AdaptivePlanSessionV1 {
  planSessionId: string;
  strategyId: string;
  revision: number;
  createdAtGameTimeSec: number;
  updatedAtGameTimeSec: number;
  state: AdaptivePlanSessionStateV1;
  steps: readonly AdaptivePlanStepV1[];
  nextStepId?: string;
  reasonCodes: readonly string[];
}
```

`PlanSession` persists across recommendation ticks through the existing previous-result continuity path. No new database/Redis dependency is required for the first implementation. If previous result state is absent after process recovery, the planner starts a new session deterministically from the current exact state.

`revision` increments whenever the serialized session meaningfully changes: step structure, step status, next step, session state, or reasons. Stable `stepId` values, not a frozen revision, provide continuity across revisions.

`nextStepId` is present only when a transaction step is actually `NEXT`. If the plan is waiting behind a barrier, `nextStepId` is absent and `nextAction` is `HOLD`.

### `AdaptivePlanStepV1`

```ts
export type AdaptivePlanStepStateV1 =
  | 'LOCKED'
  | 'BLOCKED'
  | 'READY'
  | 'NEXT'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'INVALIDATED'
  | 'SKIPPED';

export type AdaptivePlanStepKindV1 = 'TRANSACTION' | 'BARRIER';

export type AdaptivePlanStepBlockReasonV1 =
  | 'INSUFFICIENT_GOLD'
  | 'INSUFFICIENT_FLEX'
  | 'SHOP_UNAVAILABLE'
  | 'PREREQUISITE_NOT_MET';

export interface AdaptivePlanStepV1 {
  stepId: string;
  goalId: string;
  kind: AdaptivePlanStepKindV1;
  state: AdaptivePlanStepStateV1;
  action?: AdaptivePlannedTransactionV1;
  barrier?: AdaptivePlanBarrierV1;
  prerequisiteStepIds: readonly string[];
  blockingReasons: readonly AdaptivePlanStepBlockReasonV1[];
  projectedBefore: AdaptivePlanProjectionV1;
  projectedAfter?: AdaptivePlanProjectionV1;
  reasonCodes: readonly string[];
}
```

Exactly one of `action` or `barrier` is present according to `kind`.

### Transaction actions

```ts
export type AdaptivePlannedTransactionV1 =
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

A standalone `SELL` is not part of the normal user-facing plan. If capacity must be freed for a target, the strategic intent is `SELL_AND_BUY`. The deterministic domain may continue exposing `SELL_ITEM` for internal candidate generation and diagnostics.

### Barrier steps

```ts
export type AdaptivePlanBarrierV1 =
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

For a future `SELL_AND_BUY`, `WAIT_FOR_GOLD.requiredSouls` means the minimum wallet balance required before starting the composite transaction. With known buy cost and sell refund:

```text
requiredSouls = max(0, buyCost - sellRefund)
```

The user is not told to sell early while waiting for that threshold.

### Projection

```ts
export interface AdaptivePlanProjectionV1 {
  inventoryItemIds: readonly number[];
  spendableSouls?: number;
  usedByType: Readonly<Record<'weapon' | 'vitality' | 'spirit', number>>;
  flexUsed: number;
  unlockedFlexSlots?: number;
  activeItemsUsed: number;
}
```

Projection stores the minimal deterministic resource state needed to audit the path. The validator must be able to reproduce each `projectedAfter` from `projectedBefore` using the same deterministic transition semantics used by candidate generation.

## `SELL_AND_BUY` semantics

For planner and UI, `SELL_AND_BUY` is one atomic strategic step.

For validation it is the deterministic sequence:

```text
S0
 -> SELL sellItemId
 -> S1
 -> BUY buyItemId
 -> S2
```

The existing `REPLACE_ITEM` candidate already represents this composite legality. The transaction plan should use that candidate as its primary legality proof and revalidate the projected state before serving.

A composite step exists only if all of these hold:

- sold item is projected-owned;
- exact sell semantics/refund are known;
- post-sale state is legal;
- target is ruleset-available;
- post-sale wallet can afford the target;
- final inventory is slot-legal;
- active-item limits remain legal;
- completed hard goals are preserved unless replacement is explicitly authorized;
- committed branch invariants are preserved;
- no accidental lineage downgrade occurs.

If any condition fails, no `SELL_AND_BUY` step is emitted.

## How the planner chooses what to sell

Sale choice is strategic, never merely the cheapest item or first slot occupant.

Hard filtering order:

1. Item is legally sellable and sell semantics are known.
2. Item is not required by a satisfied hard goal unless that goal explicitly permits replacement.
3. Item is not evidence of a committed branch still required by the contract.
4. Item is not a near-term required upgrade component unless the replacement supersedes that goal.
5. Sale does not silently invalidate a satisfied hard investment obligation.
6. Final replacement transaction is legal.

Remaining pairs are scored as one transition:

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

If every legal replacement has negative strategic utility, the planner may wait instead of selling something just to keep buying.

## Full-inventory invariant

For every future inventory-increasing transaction, the projected state after all preceding steps must be legal.

If capacity is unavailable, the plan must contain one of these before the purchase:

- component-consuming `UPGRADE`;
- `SELL_AND_BUY` replacement;
- another prior transaction that compresses inventory;
- `WAIT_FOR_FLEX` with an exact required unlocked-flex threshold.

If no path exists, the strategic goal may remain visible in strategy metadata, but the transaction plan is `REPLAN_REQUIRED`. The target must not appear as a normal user-visible `PLANNED` purchase.

Unknown flex capacity only blocks paths that require additional flex. It does not forbid already-provable upgrades or replacements that do not increase flex demand.

## Stable step identity

`stepId` identifies semantic intent, not a recommendation tick.

Fingerprint inputs:

```text
strategyId
+ goalId
+ action/barrier type
+ target item
+ sold/consumed item identity where relevant
+ branch identity where relevant
```

This distinguishes same-step status updates from a changed transaction or changed goal.

## Reconciliation and partial replanning

Each tick performs:

```text
previous PlanSession
+ current exact decision state
+ current StrategySession
+ current BuildContract
 -> reconcile completed/invalidated steps
 -> locate first affected step
 -> preserve valid semantic prefix
 -> rebuild affected suffix
 -> replay-validate complete resulting path
```

Completion comes only from exact state and item-graph semantics.

- `BUY X`: completed when X/valid satisfying descendant is owned according to goal semantics.
- `UPGRADE A -> B`: completed when B or a satisfying descendant is owned and consumed components are absent as expected.
- `SELL_AND_BUY A -> B`: completed when B is satisfied and A is no longer held, subject to item-graph equivalence rules.
- `WAIT_FOR_FLEX`: completed when exact/reconstructed unlocked flex reaches the threshold.
- `WAIT_FOR_GOLD`: completed when verified wallet reaches the threshold.

A manual player deviation replans the affected suffix unless StrategySession itself changes to `DIVERGED/OOD`.

## Planning algorithm

The existing strategy-first beam remains, but the externally meaningful output becomes a transaction path.

### 1. Resolve semantic goal

Use existing BuildContract, investment, branch, and situational logic.

### 2. Compile acquisition obligations

Map active and near-future hard goals to target item/family obligations and valid acquisition modes.

### 3. Generate legal transactions

Use `generateRecommendationCandidates()` as authoritative transaction source at each projected node. Do not reimplement BUY/UPGRADE/REPLACE legality in the compiler.

### 4. Add barriers only for known deferable blockers

Allowed deferable blockers:

- known insufficient wallet -> `WAIT_FOR_GOLD`;
- known insufficient currently unlocked flex, while the target would fit within known maximum topology -> `WAIT_FOR_FLEX`;
- known shop unavailable -> `WAIT_FOR_SHOP`.

Unknown wallet, unknown flex capacity, unknown sell transition, unavailable ruleset item, or otherwise ambiguous feasibility are not optimistic barriers. They cause the path to remain unprovable and therefore `REPLAN_REQUIRED`/safe hold.

### 5. Search 2-5 transactions ahead

Beam node carries exact projected inventory, wallet, slots, investment, contract state, transaction steps, necessary barriers, and cumulative utility.

### 6. Compile and reconcile `PlanSession`

Convert the coherent path to stable semantic steps, reconcile with previous session, then validate the entire result.

## Relationship to existing slot planner

`BuildSlotPlannerV1Service` remains the strategic slot-obligation source. Its `futureTransitions` become constraints consumed by transaction compilation, not UI rows.

```text
UPGRADE
 -> path contains legal upgrade/compression before target

REPLACE
 -> path contains SELL_AND_BUY(sourceItemId, targetItemId)

SELL_TEMPORARY
 -> path resolves as SELL_AND_BUY; never naked strategic SELL

FLEX_UNLOCK
 -> path contains WAIT_FOR_FLEX before acquisition

BLOCKED
 -> no acquisition transaction; try another coherent path or REPLAN_REQUIRED
```

## Next action derivation

Rules:

- only transaction steps can be `NEXT`;
- a barrier is never `NEXT`;
- if the first incomplete step is an unsatisfied barrier, runtime returns `HOLD` with barrier target/reasons;
- a transaction that is no longer legal under current exact state is invalidated/replanned before serving;
- if `planSession.nextStepId` is present, it references the exact step whose structured transaction maps to `nextAction`.

## API migration

Add:

```ts
planSession?: AdaptivePlanSessionV1;
```

to `AdaptiveRecommendationResultV1` during migration.

Keep:

```ts
recommendedBuild: readonly AdaptivePlannedItemV1[];
nextAction: AdaptiveActionV1;
```

but derive both from `planSession` for transaction-first strategy serving.

After promotion, transaction-first strategy results require `planSession`; the field remains optional only because persisted older/legacy fallback results still exist.

Legacy projection rules:

- exact owned inventory -> `OWNED`;
- current transaction target -> `NEXT`;
- future transaction targets -> `PLANNED`;
- blocked future targets may be included in the compatibility list only while the new client also receives `planSession`; old clients must not be given misleading annotations inferred locally.

Planner never reads the flat projection to reconstruct transaction semantics.

## UI semantics

Rows render transactions/barriers, not bare target items.

```text
NEXT
Upgrade Debuff Reducer -> Dispel Magic

PLANNED
Buy Mystic Expansion
Sell Extra Regen before purchase

BLOCKED
Spirit Resilience
Waiting for flex 1/2
```

For `SELL_AND_BUY`, both item identities come from server structured data. Client-side sell choice is forbidden.

## Observability

On each changed session revision log:

- `planSessionId`;
- `revision`;
- preserved prefix length;
- inserted/invalidated/completed step IDs;
- first barrier reason;
- next step/action;
- every replacement pair;
- projected slot state before/after future transactions;
- replay validation result;
- replan reason;
- transaction-first vs legacy fallback source.

Counters:

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

- Unknown flex on a path that requires additional flex -> no speculative future buy.
- Unknown sell transition -> no replacement using that item.
- Projected slot violation -> discard path.
- Stored projection differs from deterministic replay -> reject revision.
- Current state invalidates preserved suffix -> replan suffix.
- No coherent reachable path -> strategy/goal metadata remains, plan state becomes `REPLAN_REQUIRED`, runtime action becomes safe `HOLD`.

The system must never hide a transaction-plan failure by falling back to an internally generated flat strategy item list. An explicit legacy planner fallback is allowed only through the serving router and is marked as legacy.

## Legacy planner boundary

Serving router can retain emergency legacy fallback during migration. Transaction-first promotion has its own gate. A legacy result has no `planSession` and is explicitly diagnosed as `LEGACY_FLAT_PLAN_FALLBACK`.

Once transaction-first replay/shadow gates pass, user-facing strategy-first serving requires a valid transaction plan.

## Hard invariants

1. Zero future target items without a plan step.
2. Zero BUY into projected illegal slot state.
3. Zero SELL_AND_BUY without validated replacement semantics.
4. Zero client-side inference of the sold item.
5. Zero hidden flex assumptions.
6. Zero naked strategic SELL created only to make room.
7. Zero complete-plan regeneration on normal unchanged semantics.
8. Zero NEXT transactions that are not executable now.
9. Zero step completion inferred from display order or names.
10. Zero future planned target with unknown slot-release path.
11. Zero mismatch between `nextAction` and the transaction referenced by `planSession.nextStepId`.
12. Zero influence from compatibility `recommendedBuild[]` back into transaction search/replacement semantics.

## Testing strategy

### Unit

- stable step ID;
- barriers;
- replacement validation;
- protected-goal sale filtering;
- chained slot projection;
- partial prefix preservation;
- upgrade-lineage completion.

### Integration

- strategy goal -> transaction plan -> next action;
- full inventory -> explicit replacement;
- full inventory -> upgrade compression;
- full inventory -> wait for flex;
- no slot path -> replan required;
- player deviation -> suffix replan;
- strategy switch -> new plan session;
- flat projection derived from plan session.

### Golden replay gates

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

1. Shared domain contract and RED production regression.
2. Compiler/barriers/validator.
3. Persistent reconciler.
4. Strategy-first integration behind transaction shadow gate.
5. Compare old flat projection against transaction path.
6. Make `recommendedBuild[]` a derived projection.
7. Update Overwolf presentation.
8. Promote transaction-first source of truth after replay/shadow gates.
9. Keep emergency legacy fallback explicitly marked.
10. Retire direct flat strategy-plan generation after a stable production evidence window.

## Non-goals

Do not redesign archetype mining, BuildStrategySpec, Behavioral/Value ML, Statlocker evidence, or BuildLM. This change fixes the semantic boundary between strategy planning and executable/user-visible build progression.

## Success criterion

For any recommendation, a reviewer can start from the exact current inventory and replay every future displayed transaction/barrier in order without encountering an unexplained item, impossible slot state, hidden sale, or undefined prerequisite.
