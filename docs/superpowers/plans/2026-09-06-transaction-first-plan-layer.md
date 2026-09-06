# Transaction-First Plan Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AdaptivePlanSessionV1.steps[]` the source of truth for the adaptive Build Path so every displayed future target is backed by an explicit legal transaction or blocking condition, including exact `SELL_AND_BUY` replacement semantics under slot pressure.

**Architecture:** Keep the merged strategy-first planner, BuildContract, slot planner, investment logic, item graph, and deterministic candidate generator. Insert a transaction-plan compiler/validator/reconciler after strategy resolution: strategy goals compile to transaction/barrier steps, the path is replay-validated, reconciled with the previous persistent plan session, and only then projected to `nextAction` and the legacy `recommendedBuild[]` compatibility shape.

**Tech Stack:** TypeScript 5.9, NestJS 11, Yarn 1 workspaces, Jest/ts-jest, `@deadlock-live-probe/build-domain`, `@deadlock-live-probe/shared`, current strategy-first adaptive planner, current Overwolf client.

**Spec:** `docs/superpowers/specs/2026-09-06-transaction-first-plan-layer-design.md`

## Global Constraints

- `AdaptivePlanSessionV1.steps[]` is the new source of truth. `recommendedBuild[]` is compatibility projection only.
- `SELL_AND_BUY` is one user-facing strategic step but validates as deterministic replacement semantics equivalent to `SELL -> BUY`.
- No standalone user-facing strategic SELL may be emitted merely to make room for a later purchase.
- Future blocked targets remain visible only through explicit barrier steps.
- A barrier never becomes `NEXT`; an unsatisfied leading barrier derives runtime `HOLD`.
- `NEXT` must always be executable under the current exact decision state.
- No future target may exist in the transaction plan without a legal projected slot path.
- Unknown flex capacity, unknown sell semantics, and unknown affordability never become guessed plan steps.
- Stable step identity and partial suffix replanning are mandatory.
- Existing `RecommendationItemGraph`, candidate generator legality, BuildContract, branch commitment, slot planner, investment policy, and strategy selection remain authoritative.
- No hero-name or item-name production special cases.
- All production code comments are English.
- No implementation directly on `main`.

---

## File map

### New shared contract

- `packages/shared/src/adaptive-transaction-plan-v1.ts`
- `packages/shared/src/adaptive-recommendation-v1.ts`
- `packages/shared/src/index.ts`
- `packages/shared/test/adaptive-transaction-plan-v1.test.js`
- `packages/shared/package.json`

### New API units

- `apps/api/src/statlocker-adaptive/transaction-plan-step-v1.ts`
- `apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts`
- `apps/api/src/statlocker-adaptive/transaction-plan-validator-v1.service.ts`
- `apps/api/src/statlocker-adaptive/transaction-plan-reconciler-v1.service.ts`
- `apps/api/src/statlocker-adaptive/transaction-plan-projection-v1.ts`
- `apps/api/src/statlocker-adaptive/transaction-plan-diff-v1.ts`
- `apps/api/src/statlocker-adaptive/transaction-plan-invariants-v1.ts`

### Existing API units to modify

- `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`
- `apps/api/src/statlocker-adaptive/strategy-first-legacy-planner-adapter-v1.service.ts`
- `apps/api/src/statlocker-adaptive/adaptive-planner-serving-router-v1.service.ts`
- `apps/api/src/statlocker-adaptive/adaptive-recommendation-observability-v1.service.ts`
- `apps/api/src/statlocker-adaptive/strategy-first-promotion-gate-v1.service.ts`
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`

### Overwolf units to modify

- `apps/overwolf-client/src/adaptive-recommendation-presentation.ts`
- `apps/overwolf-client/src/adaptive-recommendation-presentation.spec.ts`
- `apps/overwolf-client/src/ui.ts`

### New/focused API tests

- `apps/api/test/transaction-plan-step-v1.spec.ts`
- `apps/api/test/transaction-plan-compiler-v1.spec.ts`
- `apps/api/test/transaction-plan-validator-v1.spec.ts`
- `apps/api/test/transaction-plan-reconciler-v1.spec.ts`
- `apps/api/test/transaction-plan-projection-v1.spec.ts`
- `apps/api/test/transaction-plan-diff-v1.spec.ts`
- `apps/api/test/transaction-plan-invariants-v1.spec.ts`
- `apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts`
- `apps/api/test/transaction-plan-full-slot-regression.spec.ts`

---

### Task 1: Lock the current full-slot failure as a RED regression

**Files:**
- Create: `apps/api/test/transaction-plan-full-slot-regression.spec.ts`

**Interfaces:**
- Consumes: current `StrategyFirstAdaptivePlannerFacadeV1Service.plan()`.
- Produces: a failing test demonstrating that a flat future target can be shown without a source-of-truth replacement/flex transaction.

- [ ] **Step 1: Write the full-slot replacement regression**

Build a strategy fixture with:

```text
12/12 base slots occupied
known flex state with no extra current capacity
one sellable temporary item 101
a hard remaining target 202
known legal REPLACE_ITEM(101 -> 202)
```

Assert that the desired contract is:

```text
planSession.steps contains SELL_AND_BUY(101, 202)
```

and never merely:

```text
recommendedBuild contains 202 PLANNED
with no structured transaction
```

- [ ] **Step 2: Write the no-exit-path regression**

Build a full inventory where target 202 has:

```text
no upgrade compression
no legal replacement
no currently/provably unlockable required flex path
```

Desired result:

```text
planSession.state = REPLAN_REQUIRED
nextAction.type = HOLD
202 is not emitted as a normal transaction target
```

- [ ] **Step 3: Run the focused test and record RED**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-full-slot-regression.spec.ts
```

Expected: FAIL because current `AdaptiveRecommendationResultV1` has no transaction-plan source of truth.

- [ ] **Step 4: Commit the RED regression**

```bash
git add apps/api/test/transaction-plan-full-slot-regression.spec.ts
git commit -m "test(adaptive): reproduce flat full-slot build path"
```

---

### Task 2: Add the shared transaction-plan contract

**Files:**
- Create: `packages/shared/src/adaptive-transaction-plan-v1.ts`
- Modify: `packages/shared/src/adaptive-recommendation-v1.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/test/adaptive-transaction-plan-v1.test.js`
- Modify: `packages/shared/package.json`

**Interfaces:**
- Produces:
  - `AdaptivePlanSessionV1`
  - `AdaptivePlanSessionStateV1`
  - `AdaptivePlanStepV1`
  - `AdaptivePlanStepStateV1`
  - `AdaptivePlanStepKindV1`
  - `AdaptivePlanStepBlockReasonV1`
  - `AdaptivePlannedTransactionV1`
  - `AdaptivePlanBarrierV1`
  - `AdaptivePlanProjectionV1`

- [ ] **Step 1: Write the shared contract test**

The test must construct and JSON-roundtrip both shapes:

```ts
const replacement = {
  stepId: 'step:replace',
  goalId: 'goal:late-core',
  kind: 'TRANSACTION',
  state: 'NEXT',
  action: {
    type: 'SELL_AND_BUY',
    sellItemId: 101,
    buyItemId: 202,
  },
  prerequisiteStepIds: [],
  blockingReasons: [],
  projectedBefore: {
    inventoryItemIds: [101],
    spendableSouls: 1000,
    usedByType: { weapon: 0, vitality: 1, spirit: 0 },
    flexUsed: 0,
    unlockedFlexSlots: 0,
    activeItemsUsed: 0,
  },
  projectedAfter: {
    inventoryItemIds: [202],
    spendableSouls: 200,
    usedByType: { weapon: 0, vitality: 1, spirit: 0 },
    flexUsed: 0,
    unlockedFlexSlots: 0,
    activeItemsUsed: 0,
  },
  reasonCodes: ['SLOT_REPLACEMENT'],
};
```

and:

```ts
const waitForFlex = {
  stepId: 'step:flex',
  goalId: 'goal:late-core',
  kind: 'BARRIER',
  state: 'BLOCKED',
  barrier: {
    type: 'WAIT_FOR_FLEX',
    targetItemId: 202,
    requiredUnlockedFlexSlots: 2,
  },
  prerequisiteStepIds: [],
  blockingReasons: ['INSUFFICIENT_FLEX'],
  projectedBefore: replacement.projectedBefore,
  reasonCodes: ['WAIT_FOR_FLEX'],
};
```

- [ ] **Step 2: Implement the types exactly as the design spec**

Add to `AdaptiveRecommendationResultV1`:

```ts
planSession?: AdaptivePlanSessionV1;
```

Keep `recommendedBuild` mandatory during migration.

- [ ] **Step 3: Export the new contract**

Add to `packages/shared/src/index.ts`:

```ts
export * from './adaptive-transaction-plan-v1';
```

- [ ] **Step 4: Add the test to the shared test script**

Append this command to the existing `test` script:

```text
&& node test/adaptive-transaction-plan-v1.test.js
```

- [ ] **Step 5: Run shared tests**

```bash
yarn workspace @deadlock-live-probe/shared test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add adaptive transaction plan contract"
```

---

### Task 3: Implement stable step identity and exact projection helpers

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-step-v1.ts`
- Create: `apps/api/test/transaction-plan-step-v1.spec.ts`

**Interfaces:**

```ts
export interface TransactionPlanStepIdentityV1 {
  strategyId: string;
  goalId: string;
  kind: 'TRANSACTION' | 'BARRIER';
  type: string;
  targetItemId?: number;
  sellItemId?: number;
  consumedItemIds?: readonly number[];
  branchId?: string;
}

export function transactionPlanStepIdV1(input: TransactionPlanStepIdentityV1): string;

export function planProjectionFromDecisionStateV1(
  state: RecommendationDecisionState,
  graph: RecommendationItemGraph,
  rules: RecommendationCandidateGeneratorRules,
): AdaptivePlanProjectionV1;

export function isPlanBarrierSatisfiedV1(
  barrier: AdaptivePlanBarrierV1,
  decision: RecommendationDecisionState,
  unlockedFlexSlots?: number,
): boolean;

export function isTransactionStepSatisfiedV1(
  step: AdaptivePlanStepV1,
  decision: RecommendationDecisionState,
  graph: RecommendationItemGraph,
): boolean;
```

- [ ] **Step 1: Write RED tests for stable IDs**

Same strategy/goal/action pair across two ticks must produce the same `stepId`. Changing `sellItemId` from 101 to 102 must produce a different ID.

- [ ] **Step 2: Write RED completion tests**

Cover:

```text
BUY target owned
UPGRADE target/descendant owned and consumed component gone
SELL_AND_BUY buy target satisfied and sold item absent
WAIT_FOR_FLEX exact threshold
WAIT_FOR_GOLD verified threshold
WAIT_FOR_SHOP exact available state
```

- [ ] **Step 3: Implement deterministic helpers**

Use `RecommendationItemGraph.isTargetSatisfied()` for target/upgrade lineage. Sort `consumedItemIds` before fingerprinting.

- [ ] **Step 4: Run the test**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-step-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-step-v1.ts apps/api/test/transaction-plan-step-v1.spec.ts
git commit -m "feat(adaptive): add transaction plan step semantics"
```

---

### Task 4: Compile exact plan steps from candidate actions

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts`
- Create: `apps/api/test/transaction-plan-compiler-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`

**Interfaces:**

```ts
export interface CompileTransactionPlanV1Input {
  strategy: BuildStrategySpecV1;
  contract: BuildContractV1;
  slotPlan: BuildSlotPlanV1;
  decision: AdaptiveDecisionStateV1;
  selectedCandidates: readonly RecommendationCandidate[];
}

export interface CompileTransactionPlanV1Result {
  steps: readonly AdaptivePlanStepV1[];
  reachable: boolean;
  reasonCodes: readonly string[];
}

export class TransactionPlanCompilerV1Service {
  compile(input: CompileTransactionPlanV1Input): CompileTransactionPlanV1Result;
}
```

- [ ] **Step 1: Write RED mapping tests**

Required mappings:

```text
BUY_ITEM      -> BUY
UPGRADE_ITEM  -> UPGRADE
REPLACE_ITEM  -> SELL_AND_BUY
```

`SELL_ITEM` must not map to a normal user-facing transaction step.

- [ ] **Step 2: Write RED replacement-pair test**

For `REPLACE_ITEM(sellItemId=101,buyItemId=202)`, assert both IDs survive in one `SELL_AND_BUY` step.

- [ ] **Step 3: Implement candidate-to-step conversion**

For each selected transaction candidate:

1. capture `projectedBefore`;
2. project the candidate with existing deterministic build-domain logic;
3. capture `projectedAfter`;
4. generate stable `stepId`;
5. attach goal and slot-transition reason codes.

- [ ] **Step 4: Register the service in `StatlockerAdaptiveModule`**

- [ ] **Step 5: Run the focused test**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-compiler-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts apps/api/test/transaction-plan-compiler-v1.spec.ts
git commit -m "feat(adaptive): compile legal candidates into plan steps"
```

---

### Task 5: Compile explicit barriers for known deferable blockers

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts`
- Modify: `apps/api/test/transaction-plan-compiler-v1.spec.ts`

**Interfaces:**

Add a private/pure classifier with this behavior:

```ts
function deferredBarrierForCandidateV1(
  candidate: RecommendationCandidate,
  targetItemId: number,
  decision: AdaptiveDecisionStateV1,
): AdaptivePlanBarrierV1 | undefined;
```

- [ ] **Step 1: Write RED deferable-blocker tests**

Expected mappings when all other semantics are known:

```text
UNAFFORDABLE     -> WAIT_FOR_GOLD
SHOP_UNAVAILABLE -> WAIT_FOR_SHOP
known flex shortage with known required threshold -> WAIT_FOR_FLEX
```

For `WAIT_FOR_GOLD` before a replacement use:

```text
requiredSouls = max(0, buyCost - sellRefund)
```

not full buy price.

- [ ] **Step 2: Write RED tests for non-deferable unknowns**

These must never become optimistic barriers:

```text
SPENDABLE_SOULS_UNKNOWN
FLEX_SLOT_CAPACITY_UNKNOWN
SELL_TRANSITION_UNKNOWN
ITEM_UNAVAILABLE_IN_RULESET
```

Expected compiler result: no speculative transaction; `reachable=false` if no alternate coherent path exists.

- [ ] **Step 3: Implement `WAIT_FOR_FLEX` threshold calculation**

Use projected slot usage and known `unlockedFlexSlots`; never derive current capacity from `maxFlexSlots` alone.

- [ ] **Step 4: Run compiler tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-compiler-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts apps/api/test/transaction-plan-compiler-v1.spec.ts
git commit -m "feat(adaptive): compile explicit transaction barriers"
```

---

### Task 6: Make slot replacement atomic and strategic

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- Create: `apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts`

**Interfaces:**
- Existing candidate generator continues producing `SELL_ITEM` and `REPLACE_ITEM`.
- User-facing slot replacement must use `REPLACE_ITEM`, later projected to `SELL_AND_BUY`.

- [ ] **Step 1: Write RED full-inventory replacement test**

Given a full inventory and `BuildSlotPlanV1.futureTransitions` requiring replacement, assert the selected search action is `REPLACE_ITEM`, not `SELL_ITEM` followed by a future hope to buy.

- [ ] **Step 2: Write RED naked-sell prohibition test**

When a slot plan says `SELL_TEMPORARY`, standalone `SELL_ITEM` may remain an internal candidate but must not become the served first action for the slot-release goal.

- [ ] **Step 3: Change candidate relevance for slot-release goals**

Use:

```text
REPLACE / SELL_TEMPORARY
 -> legal REPLACE_ITEM pairs only for the user-facing acquisition path
```

Keep existing `preservesResolvedHardGoalsAfterCandidate()` as a hard filter.

- [ ] **Step 4: Add replacement-protection tests**

A replacement must not sell:

```text
an item satisfying a hard completed goal
a committed branch evidence item
a required near-term upgrade component
a protected recently purchased item without sufficient improvement
```

- [ ] **Step 5: Run the integration test**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/strategy-first-transaction-plan-v1.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts
git commit -m "fix(adaptive): make slot replacement an atomic plan transition"
```

---

### Task 7: Add deterministic full-path replay validation

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-validator-v1.service.ts`
- Create: `apps/api/test/transaction-plan-validator-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`

**Interfaces:**

```ts
export interface TransactionPlanViolationV1 {
  stepId?: string;
  code: string;
  reasonCodes: readonly string[];
}

export interface TransactionPlanValidationV1 {
  valid: boolean;
  violations: readonly TransactionPlanViolationV1[];
}

export class TransactionPlanValidatorV1Service {
  validate(input: {
    session: AdaptivePlanSessionV1;
    decision: AdaptiveDecisionStateV1;
  }): TransactionPlanValidationV1;
}
```

- [ ] **Step 1: Write RED valid-path tests**

Cover:

```text
full -> upgrade compression -> BUY
full -> SELL_AND_BUY
full -> WAIT_FOR_FLEX -> BUY
```

- [ ] **Step 2: Write RED invalid-path tests**

Cover:

```text
full -> BUY with no exit
projectedAfter mismatch
SELL_AND_BUY with invalid final slot state
transaction before unsatisfied prerequisite
```

- [ ] **Step 3: Implement deterministic replay**

For every transaction step, regenerate equivalent candidate/action semantics against the projected state and require the reproduced projection to equal stored `projectedAfter`. Barrier steps do not mutate inventory.

- [ ] **Step 4: Register the validator**

- [ ] **Step 5: Run the test**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-validator-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-validator-v1.service.ts apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts apps/api/test/transaction-plan-validator-v1.spec.ts
git commit -m "feat(adaptive): validate transaction plan reachability"
```

---

### Task 8: Add persistent `PlanSession` reconciliation and suffix replanning

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-reconciler-v1.service.ts`
- Create: `apps/api/test/transaction-plan-reconciler-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`

**Interfaces:**

```ts
export interface ReconcileTransactionPlanV1Input {
  previous?: AdaptivePlanSessionV1;
  strategyId: string;
  gameTimeSec: number;
  proposedSteps: readonly AdaptivePlanStepV1[];
  decision: AdaptiveDecisionStateV1;
}

export class TransactionPlanReconcilerV1Service {
  reconcile(input: ReconcileTransactionPlanV1Input): AdaptivePlanSessionV1;
}
```

- [ ] **Step 1: Write RED stable-prefix test**

Two identical semantic proposals on consecutive ticks must preserve every unchanged `stepId`.

- [ ] **Step 2: Write RED completion test**

After the player performs the current transaction, the same step becomes `COMPLETED`; later unchanged steps preserve identity/order.

- [ ] **Step 3: Write RED suffix-only replan test**

If the third semantic step changes while steps 1-2 remain valid, preserve steps 1-2 and replace only the suffix beginning at step 3.

- [ ] **Step 4: Write RED strategy-switch test**

A different `strategyId` creates a new `planSessionId`.

- [ ] **Step 5: Implement session state and revision rules**

Increment `revision` when serialized step/status/next/session state changes. Set `nextStepId` only for a transaction step marked `NEXT`.

- [ ] **Step 6: Register the reconciler and run tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-reconciler-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-reconciler-v1.service.ts apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts apps/api/test/transaction-plan-reconciler-v1.spec.ts
git commit -m "feat(adaptive): persist and reconcile transaction plan sessions"
```

---

### Task 9: Derive `nextAction` and legacy build rows from `PlanSession`

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-projection-v1.ts`
- Create: `apps/api/test/transaction-plan-projection-v1.spec.ts`

**Interfaces:**

```ts
export function nextActionFromPlanSessionV1(
  session: AdaptivePlanSessionV1,
): AdaptiveActionV1;

export function recommendedBuildFromPlanSessionV1(input: {
  session: AdaptivePlanSessionV1;
  ownedItemIds: readonly number[];
}): readonly AdaptivePlannedItemV1[];
```

- [ ] **Step 1: Write RED action-mapping tests**

Mappings:

```text
BUY          -> AdaptiveActionV1.type BUY
UPGRADE      -> AdaptiveActionV1.type UPGRADE
SELL_AND_BUY -> AdaptiveActionV1.type REPLACE with sellItemId + buyItemId
```

- [ ] **Step 2: Write RED barrier-to-HOLD test**

For:

```text
WAIT_FOR_FLEX BLOCKED
BUY X LOCKED
```

assert:

```text
nextAction.type = HOLD
nextAction.targetItemId = X
reasonCodes contain WAIT_FOR_FLEX
session.nextStepId is undefined
```

- [ ] **Step 3: Write RED one-way projection test**

`recommendedBuild[]` may contain the buy target, but no planner code may use the flat row to infer `sellItemId` or barrier semantics.

- [ ] **Step 4: Implement projection helpers**

- [ ] **Step 5: Run tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-projection-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-projection-v1.ts apps/api/test/transaction-plan-projection-v1.spec.ts
git commit -m "feat(adaptive): derive adaptive output from plan session"
```

---

### Task 10: Integrate transaction planning into the strategy-first planner

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- Modify: `apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts`

**Interfaces:**

Add to planner input:

```ts
previousPlanSession?: AdaptivePlanSessionV1;
```

Add to planner result:

```ts
planSession: AdaptivePlanSessionV1;
```

- [ ] **Step 1: Write RED end-to-end integration assertion**

Require the order:

```text
BuildContract
 -> selected search candidates
 -> TransactionPlanCompiler
 -> TransactionPlanReconciler
 -> TransactionPlanValidator
 -> nextAction/recommendedBuild projection
```

- [ ] **Step 2: Inject compiler/reconciler/validator or construct them consistently with current service style**

Do not let `buildRecommendedBuild()` remain authoritative.

- [ ] **Step 3: Add fail-closed transaction-plan behavior**

If validation fails:

```text
contract.status = REPLAN_REQUIRED
planSession.state = REPLAN_REQUIRED
nextAction = HOLD
recommendedBuild = owned-only compatibility projection
rankedImmediateCandidates = []
```

- [ ] **Step 4: Run integration and existing planner tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/strategy-first-transaction-plan-v1.integration.spec.ts \
  test/adaptive-build-planner-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts
git commit -m "feat(adaptive): make transaction plan the strategy output source"
```

---

### Task 11: Thread previous `PlanSession` through facade and adapter continuity

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-legacy-planner-adapter-v1.service.ts`
- Modify: `apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts`

**Interfaces:**

Extend `StrategyFirstPreviousResultV1` to include:

```ts
'planSession'
```

Facade passes:

```ts
previousPlanSession: input.previousResult?.planSession
```

Adapter returns:

```ts
planSession: result.planSession
```

- [ ] **Step 1: Write RED consecutive-call test**

Two facade calls in the same strategy must preserve `planSessionId`.

- [ ] **Step 2: Write RED recovery-without-previous test**

When `previousResult` is absent, current exact state creates a valid new session without reading legacy `recommendedBuild` transaction semantics.

- [ ] **Step 3: Implement continuity threading**

Do not add a new database/Redis store in this phase.

- [ ] **Step 4: Run the integration test**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/strategy-first-transaction-plan-v1.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts apps/api/src/statlocker-adaptive/strategy-first-legacy-planner-adapter-v1.service.ts apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts
git commit -m "feat(adaptive): preserve transaction plan across recommendation ticks"
```

---

### Task 12: Replace item-list churn diff with stable transaction-plan diff

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-diff-v1.ts`
- Create: `apps/api/test/transaction-plan-diff-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`

**Interfaces:**

```ts
export type TransactionPlanChangeTypeV1 =
  | 'KEEP_STEP'
  | 'COMPLETE_STEP'
  | 'INSERT_STEP'
  | 'INVALIDATE_STEP'
  | 'REPLACE_STEP'
  | 'BLOCK_STEP'
  | 'UNBLOCK_STEP';

export interface TransactionPlanChangeV1 {
  type: TransactionPlanChangeTypeV1;
  stepId: string;
  replacementStepId?: string;
}

export function diffTransactionPlansV1(
  previous: AdaptivePlanSessionV1 | undefined,
  current: AdaptivePlanSessionV1,
): readonly TransactionPlanChangeV1[];
```

- [ ] **Step 1: Write RED status-only diff test**

A step moving `NEXT -> COMPLETED` must be `COMPLETE_STEP`, not delete/insert churn.

- [ ] **Step 2: Write RED suffix replacement test**

Unchanged prefix emits `KEEP_STEP`; only changed suffix emits replacement/insertion/invalidation.

- [ ] **Step 3: Implement transaction diff**

Keep legacy `AdaptiveBuildPlanChangeV1[]` derived separately from projected `recommendedBuild[]` until old clients are retired.

- [ ] **Step 4: Run tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-diff-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-diff-v1.ts apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts apps/api/test/transaction-plan-diff-v1.spec.ts
git commit -m "feat(adaptive): diff stable transaction plan steps"
```

---

### Task 13: Add transaction-plan serving invariants and observability

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-invariants-v1.ts`
- Create: `apps/api/test/transaction-plan-invariants-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-recommendation-observability-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-planner-serving-router-v1.service.ts`

**Interfaces:**

```ts
export type TransactionPlanInvariantCodeV1 =
  | 'FUTURE_TARGET_WITHOUT_STEP'
  | 'PROJECTED_SLOT_VIOLATION'
  | 'REPLACE_WITHOUT_VALIDATED_BUY'
  | 'NEXT_STEP_MISMATCH'
  | 'NEXT_NOT_EXECUTABLE'
  | 'UNKNOWN_SLOT_PATH'
  | 'COMPATIBILITY_PROJECTION_DIVERGENCE';

export interface TransactionPlanInvariantCheckV1 {
  valid: boolean;
  violations: readonly {
    code: TransactionPlanInvariantCodeV1;
    stepId?: string;
  }[];
}
```

- [ ] **Step 1: Write RED invariant tests**

Create one failing fixture for each invariant code.

- [ ] **Step 2: Implement the invariant checker**

A strategy-first transaction result that fails a hard invariant must not be promoted as transaction-first serving.

- [ ] **Step 3: Add observability fields**

Record:

```text
planSessionId
revision
preservedPrefixLength
inserted/completed/invalidated step counts
replacement pair count
first barrier reason
projected slot usage before/after
validator result
```

- [ ] **Step 4: Run tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-invariants-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-invariants-v1.ts apps/api/src/statlocker-adaptive/adaptive-recommendation-observability-v1.service.ts apps/api/src/statlocker-adaptive/adaptive-planner-serving-router-v1.service.ts apps/api/test/transaction-plan-invariants-v1.spec.ts
git commit -m "feat(adaptive): enforce transaction plan serving invariants"
```

---

### Task 14: Render transaction semantics in Overwolf

**Files:**
- Modify: `apps/overwolf-client/src/adaptive-recommendation-presentation.ts`
- Modify: `apps/overwolf-client/src/adaptive-recommendation-presentation.spec.ts`
- Modify: `apps/overwolf-client/src/ui.ts`

**Interfaces:**

Extend the presentation model with a transaction-row shape containing:

```ts
export interface AdaptivePresentedPlanStep {
  stepId: string;
  state: string;
  actionType?: 'BUY' | 'UPGRADE' | 'SELL_AND_BUY';
  primaryItemId?: number;
  sellItemId?: number;
  consumedItemIds: readonly number[];
  barrierType?: 'WAIT_FOR_GOLD' | 'WAIT_FOR_FLEX' | 'WAIT_FOR_SHOP' | 'WAIT_FOR_PREREQUISITE';
  reasonCodes: readonly string[];
}
```

- [ ] **Step 1: Write RED presentation test for `SELL_AND_BUY`**

Presentation must retain both IDs and produce semantics equivalent to:

```text
Buy Mystic Expansion
Sell Extra Regen before purchase
```

- [ ] **Step 2: Write RED presentation test for `UPGRADE`**

Upgrade must render as component -> target, not as an independent new-slot purchase.

- [ ] **Step 3: Write RED presentation test for `WAIT_FOR_FLEX`**

Blocked target remains visible with required/current flex information.

- [ ] **Step 4: Implement plan-session-first presentation**

`buildAdaptiveRecommendationPresentation()` uses `data.planSession` when present. `ui.ts` renders the structured step. The client never chooses or infers `sellItemId`.

- [ ] **Step 5: Keep legacy fallback explicit**

If `planSession` is absent, render existing `recommendedBuild` unchanged. Do not synthesize sale/upgrade annotations.

- [ ] **Step 6: Run Overwolf tests**

```bash
yarn workspace @deadlock-live-probe/overwolf-client test --runTestsByPath src/adaptive-recommendation-presentation.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Run Overwolf build**

```bash
yarn workspace @deadlock-live-probe/overwolf-client build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/overwolf-client/src/adaptive-recommendation-presentation.ts apps/overwolf-client/src/adaptive-recommendation-presentation.spec.ts apps/overwolf-client/src/ui.ts
git commit -m "feat(overwolf): render transaction-first build path"
```

---

### Task 15: Close the full-slot regression and add golden transaction replays

**Files:**
- Modify: `apps/api/test/transaction-plan-full-slot-regression.spec.ts`
- Modify: `apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts`
- Modify: `apps/api/test/transaction-plan-validator-v1.spec.ts`

**Interfaces:**
- Golden cases are test data only; no new production interface.

- [ ] **Step 1: Convert Task 1 RED assertions to GREEN**

- [ ] **Step 2: Add these golden cases**

```text
1. full slots -> SELL_AND_BUY
2. full slots -> upgrade compression -> later BUY
3. full slots -> WAIT_FOR_FLEX -> BUY
4. full slots -> no legal exit -> REPLAN_REQUIRED
5. replacement currently unaffordable -> WAIT_FOR_GOLD -> SELL_AND_BUY
6. unknown sell transition -> no replacement
7. committed branch evidence cannot be sold for unrelated target
8. satisfied hard-goal item cannot be silently sacrificed
9. recent purchase resists churn
10. manual purchase completes existing step and preserves suffix
11. manual alternate branch purchase replans affected suffix
12. upgrade descendant satisfies lower target without duplicate BUY
13. leading barrier -> HOLD while build remains WAITING/IN_PROGRESS
14. unchanged semantics -> same session and stable step IDs
15. strategy switch -> new plan session
```

- [ ] **Step 3: Add aggregate zero-tolerance assertions**

```text
futureTargetWithoutStepRate = 0
projectedSlotViolationRate = 0
unreachablePlanRate = 0
replaceWithoutValidatedBuyRate = 0
nextStepMismatchRate = 0
clientInferredReplacementRate = 0
```

- [ ] **Step 4: Run the focused golden suite**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/transaction-plan-full-slot-regression.spec.ts \
  test/strategy-first-transaction-plan-v1.integration.spec.ts \
  test/transaction-plan-validator-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/transaction-plan-full-slot-regression.spec.ts apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts apps/api/test/transaction-plan-validator-v1.spec.ts
git commit -m "test(adaptive): gate transaction-first slot planning"
```

---

### Task 16: Add a transaction-specific shadow promotion gate

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-planner-serving-router-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-promotion-gate-v1.service.ts`
- Create: `apps/api/test/transaction-plan-serving-shadow-v1.spec.ts`

**Interfaces:**

Add a transaction-plan rollout mode with exactly these values:

```ts
export type TransactionPlanServingModeV1 = 'FLAT_COMPAT' | 'TRANSACTION_SHADOW' | 'TRANSACTION_PRIMARY';
```

- [ ] **Step 1: Write RED shadow test**

In `TRANSACTION_SHADOW`, generate/validate/log `planSession` but return the currently configured user-visible path unchanged.

- [ ] **Step 2: Write RED promotion-block test**

Any hard transaction invariant blocks `TRANSACTION_PRIMARY` and increments the promotion-block diagnostic.

- [ ] **Step 3: Implement transaction-specific mode**

Do not reuse strategy-first-vs-legacy mode as a proxy; the two rollouts solve different risks.

- [ ] **Step 4: Add shadow comparison diagnostics**

Record:

```text
next action agreement
future target agreement
replacement requirement disagreement
barrier count
plan validation
step churn
slot projection violations
```

- [ ] **Step 5: Run tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-serving-shadow-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-planner-serving-router-v1.service.ts apps/api/src/statlocker-adaptive/strategy-first-promotion-gate-v1.service.ts apps/api/test/transaction-plan-serving-shadow-v1.spec.ts
git commit -m "feat(adaptive): shadow transaction-first plan serving"
```

---

### Task 17: Cut over source of truth and retire direct flat-plan generation

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-planner-serving-router-v1.service.ts`
- Modify: `apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts`

**Interfaces:**
- Promoted strategy-first results require a valid `planSession`.
- `recommendedBuild` always comes from `recommendedBuildFromPlanSessionV1()`.

- [ ] **Step 1: Remove direct `buildRecommendedBuild()` authority**

Delete the code path that iterates unresolved strategy goals and directly appends bare item rows to `recommendedBuild`.

- [ ] **Step 2: Remove previous flat-build transaction inference**

`previousRecommendedBuild` may remain temporarily for legacy UI diff only. It must not influence sell/upgrade/slot transition reconstruction.

- [ ] **Step 3: Preserve emergency legacy fallback explicitly**

A router-level legacy fallback has no `planSession` and logs `LEGACY_FLAT_PLAN_FALLBACK`.

- [ ] **Step 4: Run full shared/API/Overwolf verification**

```bash
yarn workspace @deadlock-live-probe/shared test
yarn workspace @deadlock-live-probe/api test
yarn workspace @deadlock-live-probe/api build
yarn workspace @deadlock-live-probe/overwolf-client test
yarn workspace @deadlock-live-probe/overwolf-client build
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared apps/api apps/overwolf-client
git commit -m "feat(adaptive): promote transaction-first plan source of truth"
```

---

### Task 18: Verify the exact bug class on production/shadow decisions

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-recommendation-observability-v1.service.ts` only if the required evidence is not already emitted by Task 13.
- Modify: existing recommendation diagnostics workflow only if it cannot currently export the Task 13 fields.

**Interfaces:**
- No new recommendation behavior.
- Evidence record for each slot-pressure decision must include:

```text
exact current inventory
slot capacity and unlocked flex evidence
planSessionId + revision
transaction/barrier steps
SELL_AND_BUY pairs
nextAction
projected slot state per transaction
transaction-plan validation result
```

- [ ] **Step 1: Run transaction shadow on real decisions with slot pressure**

Select decisions where current category overflow/flex usage or full base capacity makes slot reasoning relevant.

- [ ] **Step 2: Check the forbidden production pattern**

There must be zero decisions satisfying:

```text
future purchase target displayed
AND projected capacity unavailable
AND no preceding UPGRADE / SELL_AND_BUY / WAIT_FOR_FLEX path
```

- [ ] **Step 3: Record actual sample counts and zero-tolerance results in release evidence**

Do not hardcode an invented traffic count. Promotion review uses the observed sample and requires meaningful slot-pressure coverage.

- [ ] **Step 4: Promote to `TRANSACTION_PRIMARY` only after all hard gates remain zero**

---

## Release gates

### Correctness

```text
futureTargetWithoutStepRate = 0
projectedSlotViolationRate = 0
unreachablePlanRate = 0
replaceWithoutValidatedBuyRate = 0
nextStepMismatchRate = 0
unknownSlotPathServedRate = 0
clientInferredReplacementRate = 0
```

### Continuity

```text
unchangedSemanticPlanStepChurnRate = 0
fullRebuildWithoutStrategyOrGoalChangeRate = 0
completedStepIdentityLossRate = 0
```

### Composite replacement

```text
nakedSlotReleaseSellRate = 0
replacementBreaksHardGoalRate = 0
replacementBreaksCommittedBranchRate = 0
replacementFinalSlotViolationRate = 0
```

### UI

```text
SELL_AND_BUY always exposes sold + bought item
UPGRADE renders as upgrade, not independent new-slot BUY
blocked future targets render their barrier reason
legacy fallback never invents replacement annotations
```

---

## PR sequence

```text
PR A - RED production regression + shared contract
PR B - Step identity + compiler + barriers
PR C - Atomic replacement + validator
PR D - Reconciler + persistent PlanSession
PR E - Projection + strategy planner/facade integration
PR F - Diff + invariants + observability
PR G - Overwolf transaction presentation
PR H - Golden replay + transaction shadow gate
PR I - Source-of-truth cutover + production evidence
```

Each PR must have its focused tests green before the next PR is merged or stacked for review.

## What not to do

- Do not merely add `sellItemId` annotations to `AdaptivePlannedItemV1` while leaving flat items authoritative.
- Do not let Overwolf choose a sell target.
- Do not emit standalone SELL now and hope the later BUY remains stable after replanning.
- Do not assume all four flex slots are unlocked because `maxFlexSlots = 4`.
- Do not hide unreachable future goals by silently dropping slot diagnostics.
- Do not use ML to infer slot legality.
- Do not rewrite archetype mining, BuildStrategySpec, or Behavioral/Value models in this roadmap.

## Final target state

```text
Strategy
  -> BuildContract
  -> PlanSession
       step 1 UPGRADE A -> B          COMPLETED
       step 2 SELL_AND_BUY C -> D     NEXT
       step 3 WAIT_FOR_FLEX E         BLOCKED
       step 4 BUY E                   LOCKED
  -> nextAction = step 2 transaction
  -> recommendedBuild = one-way compatibility projection
  -> Overwolf renders exact transaction semantics
```

The bug class is closed only when a future item can no longer exist in the user-visible Build Path without a replayable transaction/barrier path explaining exactly where its slot comes from.
