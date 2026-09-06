# Transaction-First Plan Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PlanSession.planSteps[]` the source of truth for the adaptive Build Path so every displayed future target is backed by an explicit legal transaction or blocking condition, including exact `SELL_AND_BUY` replacement semantics under slot pressure.

**Architecture:** Keep the merged strategy-first planner, BuildContract, slot planner, investment logic, item graph, and deterministic candidate generator. Insert a transaction-plan compiler/reconciler after strategy resolution: strategy goals compile to transaction/barrier steps, the path is replay-validated, reconciled with the previous persistent plan session, and only then projected to `nextAction` and the legacy `recommendedBuild[]` compatibility shape.

**Tech Stack:** TypeScript 5.9, NestJS 11, Yarn 1 workspaces, Jest/ts-jest, `@deadlock-live-probe/build-domain`, `@deadlock-live-probe/shared`, existing strategy-first adaptive planner and Overwolf client.

**Spec:** `docs/superpowers/specs/2026-09-06-transaction-first-plan-layer-design.md`

## Global Constraints

- `planSteps[]` is the new source of truth. `recommendedBuild[]` is compatibility projection only.
- `SELL_AND_BUY` is one user-facing strategic step but must validate as deterministic `SELL -> BUY`.
- No standalone user-facing strategic SELL is allowed merely to make room for a later purchase.
- Future blocked targets may remain visible only through explicit barrier steps.
- A barrier never becomes `NEXT`; unsatisfied leading barriers derive runtime `HOLD`.
- `NEXT` must always be executable under the current exact decision state.
- No future target may exist without a legal projected slot path.
- Unknown flex capacity, unknown sell semantics, or unknown affordability never become guessed plan steps.
- Stable step identity and partial suffix replanning are mandatory.
- Existing `RecommendationItemGraph`, candidate generator legality, BuildContract, branch commitment, and strategy selection remain authoritative.
- No hero-name or item-name production special cases.
- All production code comments are English.
- No direct implementation on `main`.

---

## File map

### New shared contract

- `packages/shared/src/adaptive-transaction-plan-v1.ts`
  - public `AdaptivePlanSessionV1`, `AdaptivePlanStepV1`, transaction/barrier/projection types.
- `packages/shared/src/index.ts`
  - exports transaction-plan contract.
- `packages/shared/src/adaptive-recommendation-v1.ts`
  - adds optional `planSession` to `AdaptiveRecommendationResultV1` during compatibility migration.
- `packages/shared/test/adaptive-transaction-plan-v1.test.js`
  - contract serialization/shape tests.

### New API units

- `apps/api/src/statlocker-adaptive/transaction-plan-step-v1.ts`
  - stable semantic step IDs, projection helpers, step completion predicates.
- `apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts`
  - compiles strategy goals + slot obligations + candidate generator evidence into transaction/barrier steps.
- `apps/api/src/statlocker-adaptive/transaction-plan-validator-v1.service.ts`
  - deterministic path replay and hard invariant validation.
- `apps/api/src/statlocker-adaptive/transaction-plan-reconciler-v1.service.ts`
  - persistent plan-session reconciliation and suffix replanning.
- `apps/api/src/statlocker-adaptive/transaction-plan-projection-v1.ts`
  - derives `nextAction`, legacy `recommendedBuild[]`, and legacy diff inputs from `PlanSession`.
- `apps/api/src/statlocker-adaptive/transaction-plan-invariants-v1.ts`
  - cross-contract serving invariants and metrics payload.

### Existing API units to modify

- `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`
- `apps/api/src/statlocker-adaptive/strategy-first-legacy-planner-adapter-v1.service.ts`
- `apps/api/src/statlocker-adaptive/adaptive-planner-serving-router-v1.service.ts`
- `apps/api/src/statlocker-adaptive/adaptive-recommendation-observability-v1.service.ts`
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`

### Overwolf units to modify

- `apps/overwolf-client/src/adaptive-recommendation-presentation.ts`
- `apps/overwolf-client/src/adaptive-recommendation-presentation.spec.ts`
- relevant desktop/in-game renderers already consuming that presentation model.

### New/focused API tests

- `apps/api/test/transaction-plan-step-v1.spec.ts`
- `apps/api/test/transaction-plan-compiler-v1.spec.ts`
- `apps/api/test/transaction-plan-validator-v1.spec.ts`
- `apps/api/test/transaction-plan-reconciler-v1.spec.ts`
- `apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts`
- `apps/api/test/transaction-plan-full-slot-regression.spec.ts`

---

### Task 1: Lock the current production failure as a RED regression

**Files:**
- Create: `apps/api/test/transaction-plan-full-slot-regression.spec.ts`
- Reuse fixtures/helpers from existing strategy-first planner tests.

**Interfaces:**
- Consumes: current `StrategyFirstAdaptivePlannerFacadeV1Service.plan()`.
- Produces: failing regression that proves flat future targets can exist without explicit replacement/flex semantics.

- [ ] **Step 1: Add a full-slot regression fixture**

Construct a strategy with an unfinished hard goal whose target requires one more slot than the exact current inventory permits. Include one legally sellable temporary item and one valid replacement target.

Assert current behavior is insufficient: the future target appears as `PLANNED` while the result has no source-of-truth transaction step naming the sold item.

- [ ] **Step 2: Add a second fixture with no valid exit path**

Use full capacity, no legal sell transition, no upgrade compression, and insufficient unlocked flex. Assert a normal future `PLANNED` target must eventually be forbidden.

- [ ] **Step 3: Run the focused test and record RED**

Run:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-full-slot-regression.spec.ts
```

Expected: FAIL because the current public result has no transaction-plan source of truth and/or still emits the flattened target.

- [ ] **Step 4: Commit only the regression fixture**

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
  - `AdaptivePlanStepV1`
  - `AdaptivePlannedTransactionV1`
  - `AdaptivePlanBarrierV1`
  - `AdaptivePlanProjectionV1`
  - `AdaptivePlanStepStateV1`

- [ ] **Step 1: Write contract tests first**

Test these shapes:

```ts
const replacement: AdaptivePlanStepV1 = {
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
  projectedBefore: projectionBefore,
  projectedAfter: projectionAfter,
  reasonCodes: ['SLOT_REPLACEMENT'],
};
```

and barrier:

```ts
const wait: AdaptivePlanStepV1 = {
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
  projectedBefore: projectionBefore,
  reasonCodes: ['WAIT_FOR_FLEX'],
};
```

- [ ] **Step 2: Implement the contract exactly as the spec**

`AdaptiveRecommendationResultV1` gains:

```ts
planSession?: AdaptivePlanSessionV1;
```

Keep `recommendedBuild` mandatory for compatibility during migration.

- [ ] **Step 3: Export the types from shared index**

- [ ] **Step 4: Run shared build/tests**

```bash
yarn workspace @deadlock-live-probe/shared test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add adaptive transaction plan contract"
```

---

### Task 3: Implement stable step identity and deterministic projection helpers

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-step-v1.ts`
- Create: `apps/api/test/transaction-plan-step-v1.spec.ts`

**Interfaces:**
- Produces:

```ts
export function transactionPlanStepIdV1(input: TransactionPlanStepIdentityV1): string;
export function planProjectionFromDecisionStateV1(...): AdaptivePlanProjectionV1;
export function isPlanBarrierSatisfiedV1(...): boolean;
export function isTransactionStepSatisfiedV1(...): boolean;
```

- [ ] **Step 1: Add RED tests for stable IDs**

Same semantic replacement under different recommendation ticks must produce the same `stepId`; changing `sellItemId` must change it.

- [ ] **Step 2: Add RED tests for completion semantics**

Cover:

- BUY target owned;
- UPGRADE target/descendant owned and consumed components removed;
- SELL_AND_BUY target owned and sold item absent;
- WAIT_FOR_FLEX satisfied only at required threshold;
- WAIT_FOR_GOLD satisfied only with observed sufficient wallet.

- [ ] **Step 3: Implement deterministic helpers**

Use item-graph target satisfaction for upgrade lineage. Do not use item names.

- [ ] **Step 4: Run focused test**

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

### Task 4: Compile exact transaction steps from legal candidate actions

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts`
- Create: `apps/api/test/transaction-plan-compiler-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`

**Interfaces:**
- Consumes:
  - `BuildStrategySpecV1`
  - `BuildContractV1`
  - `BuildSlotPlanV1`
  - current/projected `RecommendationDecisionState`
  - `RecommendationItemGraph`
  - scored/search-selected `RecommendationCandidate[]`
- Produces:

```ts
export interface CompileTransactionPlanV1Input { ... }
export interface CompileTransactionPlanV1Result {
  steps: readonly AdaptivePlanStepV1[];
  reachable: boolean;
  reasonCodes: readonly string[];
}
```

- [ ] **Step 1: RED tests for candidate mapping**

Required mappings:

```text
BUY_ITEM      -> BUY
UPGRADE_ITEM  -> UPGRADE
REPLACE_ITEM  -> SELL_AND_BUY
```

`SELL_ITEM` is never emitted as a normal user-facing strategic step.

- [ ] **Step 2: RED test that a replacement preserves the pair**

Given `REPLACE_ITEM(sell=101,buy=202)`, assert the step contains both IDs and never flattens to only `202`.

- [ ] **Step 3: Implement candidate-to-step conversion**

Use the candidate as the legality proof. Populate `projectedBefore/After` with deterministic projection snapshots.

- [ ] **Step 4: Run tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-compiler-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts apps/api/test/transaction-plan-compiler-v1.spec.ts
git commit -m "feat(adaptive): compile legal candidates into plan steps"
```

---

### Task 5: Add explicit deferred barriers instead of speculative future items

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts`
- Modify: `apps/api/test/transaction-plan-compiler-v1.spec.ts`

**Interfaces:**
- Adds deferability classification for currently infeasible target actions.

- [ ] **Step 1: RED tests for deferable blockers**

Only these conditions may compile into barriers when all other semantics are known:

```text
UNAFFORDABLE       -> WAIT_FOR_GOLD
SHOP_UNAVAILABLE   -> WAIT_FOR_SHOP
known locked flex  -> WAIT_FOR_FLEX
```

- [ ] **Step 2: RED tests for non-deferable unknowns**

These must not become optimistic barriers:

```text
SPENDABLE_SOULS_UNKNOWN
FLEX_SLOT_CAPACITY_UNKNOWN
SELL_TRANSITION_UNKNOWN
ITEM_UNAVAILABLE_IN_RULESET
MISSING_UPGRADE_COMPONENT without a compiled prerequisite path
```

Expected result: `reachable=false` or the goal remains unresolved with `REPLAN_REQUIRED` evidence.

- [ ] **Step 3: Implement deferability classifier**

For flex, derive the required flex usage from projected slot usage and require known `unlockedFlexSlots`/ruleset evidence. Never infer future flex from `maxFlexSlots` alone.

- [ ] **Step 4: Run focused tests**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/transaction-plan-compiler-v1.service.ts apps/api/test/transaction-plan-compiler-v1.spec.ts
git commit -m "feat(adaptive): compile explicit plan barriers"
```

---

### Task 6: Make replacement choice strategic and forbid naked slot-release SELL

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- Modify: `apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts`

**Interfaces:**
- Existing candidate generator still supplies `SELL_ITEM` and `REPLACE_ITEM`.
- Planner search must prefer/require `REPLACE_ITEM` for a user-facing slot replacement.

- [ ] **Step 1: RED test: full inventory + valid replacement**

Assert the planner path chooses a `REPLACE_ITEM` candidate and the final plan emits one `SELL_AND_BUY` step.

- [ ] **Step 2: RED test: naked `SELL_ITEM` cannot become `NEXT` merely to make room**

Even when `BuildSlotPlanV1.futureTransitions` says `SELL_TEMPORARY`, the user-facing first transaction must not be standalone SELL.

- [ ] **Step 3: Implement replacement filtering**

For slot-release obligations:

```text
SELL_TEMPORARY / REPLACE
 -> search legal REPLACE_ITEM pairs
 -> score pair as one strategic transition
```

Continue using `preservesResolvedHardGoalsAfterCandidate()` and branch protection as hard filters.

- [ ] **Step 4: Add strategic replacement cost checks**

Protect:

- satisfied hard goals;
- committed-branch evidence;
- near-term required upgrade components;
- hard investment objectives;
- recently purchased items unless improvement exceeds the existing churn threshold.

- [ ] **Step 5: Run planner/integration tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/strategy-first-transaction-plan-v1.integration.spec.ts
```

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
- Produces:

```ts
export interface TransactionPlanValidationV1 {
  valid: boolean;
  violations: readonly {
    stepId?: string;
    code: string;
    reasonCodes: readonly string[];
  }[];
}
```

- [ ] **Step 1: RED tests for path-level slot legality**

Cover chained:

```text
full -> upgrade compression -> buy
full -> SELL_AND_BUY
full -> WAIT_FOR_FLEX -> buy
```

and invalid:

```text
full -> BUY
```

- [ ] **Step 2: RED test for composite replacement**

Replay `SELL_AND_BUY` as atomic candidate semantics / exact `SELL -> BUY`; final projection must equal stored `projectedAfter`.

- [ ] **Step 3: RED tests for prerequisite ordering and duplicate terminal targets**

- [ ] **Step 4: Implement validator**

Use deterministic candidate/projected-state helpers only. If the stored projection cannot be reproduced, reject the revision.

- [ ] **Step 5: Run focused tests and commit**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-validator-v1.spec.ts
git add apps/api/src/statlocker-adaptive/transaction-plan-validator-v1.service.ts apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts apps/api/test/transaction-plan-validator-v1.spec.ts
git commit -m "feat(adaptive): validate transaction plan reachability"
```

---

### Task 8: Add persistent `PlanSession` reconciliation and stable suffix replanning

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-reconciler-v1.service.ts`
- Create: `apps/api/test/transaction-plan-reconciler-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`

**Interfaces:**
- Produces:

```ts
export interface ReconcileTransactionPlanV1Input {
  previous?: AdaptivePlanSessionV1;
  strategyId: string;
  gameTimeSec: number;
  proposedSteps: readonly AdaptivePlanStepV1[];
  currentDecision: RecommendationDecisionState;
  itemGraph: RecommendationItemGraph;
}

export function reconcile(...): AdaptivePlanSessionV1;
```

- [ ] **Step 1: RED test: stable steps survive a normal tick**

Unchanged semantic steps keep the same `stepId`; completed step changes state rather than disappearing.

- [ ] **Step 2: RED test: purchase completes one step and preserves suffix**

- [ ] **Step 3: RED test: one changed goal invalidates/rebuilds only affected suffix**

- [ ] **Step 4: RED test: strategy switch creates a new `planSessionId`**

- [ ] **Step 5: Implement prefix preservation and revision rules**

Rules:

```text
same strategy + same semantic prefix -> preserve
completed existing step -> status update
first incompatible semantic step -> invalidate suffix and replace
strategy identity change -> new session
```

- [ ] **Step 6: Run tests and commit**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-reconciler-v1.spec.ts
git add apps/api/src/statlocker-adaptive/transaction-plan-reconciler-v1.service.ts apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts apps/api/test/transaction-plan-reconciler-v1.spec.ts
git commit -m "feat(adaptive): persist and reconcile transaction plan sessions"
```

---

### Task 9: Derive `nextAction` and legacy build projection from `PlanSession`

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-projection-v1.ts`
- Create: `apps/api/test/transaction-plan-projection-v1.spec.ts`

**Interfaces:**
- Produces:

```ts
export function nextActionFromPlanSessionV1(...): AdaptiveActionV1;
export function recommendedBuildFromPlanSessionV1(...): readonly AdaptivePlannedItemV1[];
```

- [ ] **Step 1: RED test: transaction `NEXT` maps exactly**

Mappings:

```text
BUY          -> BUY
UPGRADE      -> UPGRADE
SELL_AND_BUY -> REPLACE
```

The existing public action type may remain `REPLACE` for V1 compatibility while the plan step is named `SELL_AND_BUY`.

- [ ] **Step 2: RED test: leading barrier returns HOLD**

Example:

```text
WAIT_FOR_FLEX BLOCKED
BUY X LOCKED
```

Expected:

```ts
nextAction.type === 'HOLD'
nextAction.targetItemId === X
reasonCodes includes WAIT_FOR_FLEX
```

- [ ] **Step 3: RED test: legacy flat rows are a one-way projection**

The replacement target may appear as `NEXT/PLANNED`, but the sold item is never inferred back from `recommendedBuild`.

- [ ] **Step 4: Implement projection helpers and commit**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-projection-v1.spec.ts
git add apps/api/src/statlocker-adaptive/transaction-plan-projection-v1.ts apps/api/test/transaction-plan-projection-v1.spec.ts
git commit -m "feat(adaptive): derive adaptive output from plan session"
```

---

### Task 10: Integrate transaction planning into `StrategyFirstBuildPlannerV1Service`

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- Modify: `apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts`

**Interfaces:**
- `StrategyFirstBuildPlannerV1Input` gains:

```ts
previousPlanSession?: AdaptivePlanSessionV1;
```

- `StrategyFirstBuildPlannerV1Result` gains:

```ts
planSession: AdaptivePlanSessionV1;
```

- [ ] **Step 1: RED integration test for end-to-end compile**

`BuildContract -> search -> compiler -> validator -> reconciler -> nextAction/recommendedBuild` must return a valid session.

- [ ] **Step 2: Replace direct `buildRecommendedBuild()` authority**

Keep the old method temporarily only as fallback comparison. Normal strategy-first output must be generated from `planSession` projection.

- [ ] **Step 3: Add fail-closed behavior**

If validation fails:

```text
BuildContract.status = REPLAN_REQUIRED
planSession.state = REPLAN_REQUIRED
nextAction = HOLD
recommendedBuild = owned-only compatibility projection
```

Never return the speculative old flat path after transaction validation failure.

- [ ] **Step 4: Run integration + existing planner tests**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/strategy-first-transaction-plan-v1.integration.spec.ts \
  test/adaptive-build-planner-v1.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts apps/api/test/strategy-first-transaction-plan-v1.integration.spec.ts
git commit -m "feat(adaptive): make transaction plan the strategy output source"
```

---

### Task 11: Thread previous plan session through the facade and adapter

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-legacy-planner-adapter-v1.service.ts`
- Modify: API tests that construct `AdaptiveRecommendationResultV1`.

**Interfaces:**
- `StrategyFirstPreviousResultV1` includes `planSession`.
- Facade passes `previousPlanSession` into the planner.
- Adapter returns `planSession` to the outer adaptive result.

- [ ] **Step 1: RED test that two consecutive facade calls preserve `planSessionId`**

- [ ] **Step 2: RED test that a strategy identity switch creates a new session**

- [ ] **Step 3: Implement continuity threading**

No new Redis/DB persistence in this phase. Existing previous-result continuity is the persistence boundary. If previous state is absent after process recovery, the planner deterministically starts a new session from exact current state.

- [ ] **Step 4: Run focused tests and commit**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/strategy-first-transaction-plan-v1.integration.spec.ts
git add apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts apps/api/src/statlocker-adaptive/strategy-first-legacy-planner-adapter-v1.service.ts apps/api/test
git commit -m "feat(adaptive): persist plan session across recommendation ticks"
```

---

### Task 12: Replace old build diff semantics with transaction-plan diff semantics

**Files:**
- Create: `apps/api/src/statlocker-adaptive/transaction-plan-diff-v1.ts`
- Create: `apps/api/test/transaction-plan-diff-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`

**Interfaces:**
- Produces plan changes:

```text
KEEP_STEP
COMPLETE_STEP
INSERT_STEP
INVALIDATE_STEP
REPLACE_STEP
BLOCK_STEP
UNBLOCK_STEP
```

Legacy `AdaptiveBuildPlanChangeV1[]` remains derived for older clients.

- [ ] **Step 1: RED tests for stable step diff**

A status-only change must not look like build churn.

- [ ] **Step 2: RED test for one replacement suffix change**

Only the affected step/suffix changes.

- [ ] **Step 3: Implement plan diff and legacy projection**

- [ ] **Step 4: Run tests and commit**

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
- Hard checks:

```text
FUTURE_TARGET_WITHOUT_STEP
PROJECTED_SLOT_VIOLATION
REPLACE_WITHOUT_VALIDATED_BUY
NEXT_STEP_MISMATCH
NEXT_NOT_EXECUTABLE
UNKNOWN_SLOT_PATH
COMPATIBILITY_PROJECTION_DIVERGENCE
```

- [ ] **Step 1: Add RED invariant tests**

- [ ] **Step 2: Implement fail-closed check**

A transaction-first serving result that fails an invariant may not be promoted; serving router uses explicitly marked safe fallback.

- [ ] **Step 3: Add observability counters/log payloads**

Record:

```text
planSessionId
revision
preservedPrefixLength
step churn
replacement pairs
blocked reasons
projected slots before/after
validation status
```

- [ ] **Step 4: Run tests and commit**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/transaction-plan-invariants-v1.spec.ts
git add apps/api/src/statlocker-adaptive apps/api/test/transaction-plan-invariants-v1.spec.ts
git commit -m "feat(adaptive): enforce transaction plan serving invariants"
```

---

### Task 14: Make the Overwolf presentation transaction-first

**Files:**
- Modify: `apps/overwolf-client/src/adaptive-recommendation-presentation.ts`
- Modify: `apps/overwolf-client/src/adaptive-recommendation-presentation.spec.ts`
- Modify: actual desktop/overlay rendering files that consume the presentation rows, discovered from imports of `adaptive-recommendation-presentation.ts`.

**Interfaces:**
- Presentation row must include:

```ts
{
  stepId: string;
  state: string;
  primaryItemId?: number;
  actionType?: 'BUY' | 'UPGRADE' | 'SELL_AND_BUY';
  sellItemId?: number;
  consumedItemIds?: readonly number[];
  barrierType?: 'WAIT_FOR_GOLD' | 'WAIT_FOR_FLEX' | 'WAIT_FOR_SHOP' | 'WAIT_FOR_PREREQUISITE';
  reasonCodes: readonly string[];
}
```

- [ ] **Step 1: RED presentation test for `SELL_AND_BUY`**

The rendered model must contain both sell and buy item identities.

Expected user semantics:

```text
Buy Mystic Expansion
Sell Extra Regen before purchase
```

- [ ] **Step 2: RED presentation test for `UPGRADE`**

Do not make an upgrade look like a new independent slot purchase.

- [ ] **Step 3: RED presentation test for `WAIT_FOR_FLEX`**

Blocked future step remains visible with its requirement.

- [ ] **Step 4: Implement transaction-first presentation**

The client never decides what to sell. It only renders structured server output.

- [ ] **Step 5: Keep legacy fallback path explicit**

If `planSession` is absent, old presentation may still render `recommendedBuild`, but mark it internally as legacy/fallback and do not synthesize replacement annotations.

- [ ] **Step 6: Run Overwolf tests/build and commit**

```bash
yarn workspace @deadlock-live-probe/overwolf-client test
yarn workspace @deadlock-live-probe/overwolf-client build
git add apps/overwolf-client
git commit -m "feat(overwolf): render transaction-first build path"
```

---

### Task 15: Close the original full-slot regression and add golden replay cases

**Files:**
- Modify: `apps/api/test/transaction-plan-full-slot-regression.spec.ts`
- Modify/create: relevant adaptive replay fixture/spec files under `apps/api/test/`.

**Interfaces:**
- Golden cases:

```text
1.  full slots -> SELL_AND_BUY
2.  full slots -> upgrade compression -> later BUY
3.  full slots -> WAIT_FOR_FLEX -> BUY
4.  full slots -> no legal exit -> REPLAN_REQUIRED
5.  replacement candidate unaffordable until refund+wallet threshold -> WAIT_FOR_GOLD then SELL_AND_BUY
6.  unknown sell transition -> never replace
7.  committed branch item cannot be sold for unrelated target
8.  satisfied hard goal item cannot be silently sacrificed
9.  recently purchased item resists churn
10. player manually buys planned item -> step completes, suffix preserved
11. player manually buys alternate valid branch -> affected suffix replans
12. upgrade descendant satisfies lower target without duplicate BUY
13. leading barrier -> HOLD while build remains IN_PROGRESS/WAITING
14. no semantic change -> same session and stable step IDs
15. strategy switch -> new session
```

- [ ] **Step 1: Convert Task 1 regressions from RED to GREEN assertions**

- [ ] **Step 2: Add all golden cases**

- [ ] **Step 3: Add aggregate replay assertions**

```text
futureTargetWithoutStepRate = 0
projectedSlotViolationRate = 0
unreachablePlanRate = 0
replaceWithoutValidatedBuyRate = 0
nextStepMismatchRate = 0
clientInferredReplacementRate = 0
```

- [ ] **Step 4: Run focused replay suite**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/transaction-plan-full-slot-regression.spec.ts \
  test/strategy-first-transaction-plan-v1.integration.spec.ts \
  test/transaction-plan-validator-v1.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/test
git commit -m "test(adaptive): gate transaction-first slot planning"
```

---

### Task 16: Add shadow comparison before source-of-truth cutover

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-planner-serving-router-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-promotion-gate-v1.service.ts`
- Modify: related serving-router/promotion tests.

**Interfaces:**
- Compare:

```text
legacy/flat target path
vs
transaction-first planSession
```

Diagnostics:

```text
next action agreement
future target agreement
replacement requirement disagreement
blocked future step count
plan reachability
step churn
slot projection violations
```

- [ ] **Step 1: Add a `TRANSACTION_SHADOW` serving mode or equivalent promotion gate**

Do not conflate it with strategy-first-vs-legacy shadow; strategy-first is already a separate concern.

- [ ] **Step 2: Ensure shadow generation cannot mutate the shown recommendation**

- [ ] **Step 3: Gate promotion on zero hard invariants**

Required before user-facing cutover:

```text
projectedSlotViolationRate = 0
futureTargetWithoutStepRate = 0
replaceWithoutValidatedBuyRate = 0
nextStepMismatchRate = 0
transactionPlanValidationFailureRate = 0
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/statlocker-adaptive apps/api/test
git commit -m "feat(adaptive): shadow transaction-first plan serving"
```

---

### Task 17: Cut over source of truth and retire direct flat-plan generation

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-planner-serving-router-v1.service.ts`
- Modify: relevant tests.

**Interfaces:**
- `planSession` is mandatory for promoted strategy-first results.
- `recommendedBuild` is always produced by `recommendedBuildFromPlanSessionV1()`.

- [ ] **Step 1: Delete/disable direct `buildRecommendedBuild()` use**

No code path may append strategy goal targets directly to the UI build list.

- [ ] **Step 2: Make compatibility projection one-way**

Planner never reads `recommendedBuild` to infer sell/upgrade/slot semantics. It may only use previous `planSession` for plan continuity.

- [ ] **Step 3: Preserve emergency legacy fallback explicitly**

If the serving router falls back to the old planner, `planSession` is absent and diagnostics mark `LEGACY_FLAT_PLAN_FALLBACK`.

- [ ] **Step 4: Run full API/shared/Overwolf verification**

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

### Task 18: Production evidence gate for the exact observed bug class

**Files:**
- Modify: existing recommendation diagnostics/replay workflow if needed.
- No model training.

**Interfaces:**
- Collect read-only production/shadow evidence for full/near-full inventory decisions.

- [ ] **Step 1: Capture decisions where `itemCount >= base slot capacity` or flex is used**

For each, persist:

```text
exact current inventory
exact slot state
planSession revision
future transaction steps
replacement pairs
barrier steps
nextAction
projected slot state per step
```

- [ ] **Step 2: Verify the screenshot-class condition cannot occur**

Forbidden evidence pattern:

```text
future purchase target displayed
AND no free projected slot
AND no preceding UPGRADE/SELL_AND_BUY/WAIT_FOR_FLEX path
```

- [ ] **Step 3: Require a production window with zero hard violations before retiring fallback**

Do not invent a traffic count in code. Record the observed decision count and use the existing release review to approve the cutover only after meaningful slot-pressure coverage exists.

- [ ] **Step 4: Document release evidence in the PR/release ledger**

---

## Release gates

### Correctness gates

```text
futureTargetWithoutStepRate = 0
projectedSlotViolationRate = 0
unreachablePlanRate = 0
replaceWithoutValidatedBuyRate = 0
nextStepMismatchRate = 0
unknownSlotPathServedRate = 0
clientInferredReplacementRate = 0
```

### Continuity gates

```text
unchangedSemanticPlanStepChurnRate = 0
fullRebuildWithoutStrategyOrGoalChangeRate = 0
completedStepIdentityLossRate = 0
```

### Composite replacement gates

```text
nakedSlotReleaseSellRate = 0
replacementBreaksHardGoalRate = 0
replacementBreaksCommittedBranchRate = 0
replacementFinalSlotViolationRate = 0
```

### UI gates

```text
SELL_AND_BUY always names sold + bought item
UPGRADE is rendered as upgrade, not independent new-slot BUY
blocked future targets always show the barrier reason
legacy fallback never invents replacement annotations
```

---

## PR sequence

Recommended implementation sequence to keep reviews small:

```text
PR A - Shared contract + RED production regression
PR B - Step semantics + compiler + barriers
PR C - Validator + reconciler + persistent PlanSession
PR D - Strategy planner integration + replacement correctness
PR E - Projection + facade/adapter + invariants/observability
PR F - Overwolf transaction presentation
PR G - Golden replay + shadow promotion gate
PR H - Source-of-truth cutover + release evidence
```

Each PR is stacked or merged only after its own focused tests are green. Do not combine UI cutover with the first planner-domain changes.

## What not to do

- Do not solve this by adding `sellItemId` annotations to `AdaptivePlannedItemV1` while leaving flat items authoritative.
- Do not let the UI choose a sell target.
- Do not generate `SELL` now and hope the later `BUY` remains stable after replanning.
- Do not assume all four flex slots are unlocked because `maxFlexSlots = 4`.
- Do not hide unreachable future goals by silently dropping slot diagnostics.
- Do not use a larger ML model to infer slot legality.
- Do not rewrite archetype mining or BuildStrategySpec in this change.

## Final target state

```text
Strategy
  -> BuildContract
  -> PlanSession
       step 1 UPGRADE A -> B          COMPLETED
       step 2 SELL_AND_BUY C -> D     NEXT
       step 3 WAIT_FOR_FLEX D2        BLOCKED
       step 4 BUY D2                  LOCKED
  -> nextAction = step 2
  -> recommendedBuild = compatibility projection
  -> UI renders exact transaction semantics
```

The bug class is closed only when a future item can no longer exist in user-visible Build Path without a replayable transaction/barrier path that explains where its slot comes from.
