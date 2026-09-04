# Structured Adaptive Planner V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `AdaptiveBuildPlannerV1` so it plans a legal, phase-correct, slot-aware, investment-aware build trajectory from structured Statlocker pro-build evidence instead of ranking a flat union of item IDs.

**Architecture:** Keep the existing Statlocker browser collector, snapshot store, refresh flow, public planner version, and contextual evidence scorer. Replace the flat consensus payload with structured REQUIRED/CHOICE/OPTIONAL groups, gate groups by phase before scoring, resolve CHOICE branches contextually, reconstruct branch commitment from inventory, and search future legal BUY/UPGRADE/SELL/REPLACE/WAIT transitions using the canonical candidate generator. `recommendedBuild` becomes a projection of legal plan steps and never appends unselected skeleton items.

**Tech Stack:** TypeScript 5.9, NestJS 11, Jest 30, Yarn workspaces, `@deadlock-live-probe/build-domain`, existing Statlocker normalized snapshots, existing replay/integration harness.

**Spec:** `docs/superpowers/specs/2026-09-03-structured-adaptive-planner-v1-design.md`

## Global Constraints

- Rewrite planner V1 in place; keep `plannerVersion: 'adaptive-build-planner-v1'`.
- Do not introduce a parallel V2 or shadow planner.
- Do not change `statlocker-browser-collector.service.ts` in this implementation.
- Preserve existing Statlocker snapshot storage and refresh cadence.
- `MID`/`LATE` eligibility is a hard gate; contextual WPA cannot bypass it without explicit rush evidence.
- Explicit Statlocker choice semantics win when present; statistical inference is only a fallback.
- A low-confidence inferred alternative degrades to OPTIONAL, never a false CHOICE.
- `VS_HERO_WPA` chooses among already valid alternatives; it does not define global chronology.
- A CHOICE branch may switch before investment, but after branch-specific investment it is committed and can change only through explicit SELL/REPLACE planning.
- Never assume all four flex slots are unlocked. Unknown capacity must be conservative, while current observed inventory establishes a lower bound on already-used flex capacity.
- Investment rules must be tied to `rulesetId`/`catalogSha256`; unknown rules disable investment utility instead of silently using stale values.
- The canonical candidate generator remains authoritative for affordability, recipes, slots, active-item limits, BUY/UPGRADE/SELL/REPLACE/WAIT legality, and projected transaction results.
- Remove `remainingSkeleton` behavior completely.
- Preferred invariant: `recommendedBuild` item with `status === 'NEXT'` has the same target item as `nextAction.targetItemId` whenever the action has a target.
- Whole-plan hysteresis may preserve only a structurally valid and still-legal previous plan.
- Merge/deploy is blocked until domain unit tests, API unit tests, integration tests, and replay regression gates pass.
- No code comments in Russian.

## File Map

**Create**
- `apps/api/src/statlocker-adaptive/structured-build-v1.ts` - structured build/group helpers and deterministic group IDs.
- `apps/api/src/statlocker-adaptive/adaptive-economy-v1.ts` - slot-capacity lower-bound calculation, ruleset economy lookup, investment state and action deltas.
- `apps/api/src/statlocker-adaptive/adaptive-phase-eligibility-v1.service.ts` - hard group eligibility.
- `apps/api/src/statlocker-adaptive/adaptive-choice-resolver-v1.service.ts` - branch resolution and commitment reconstruction.
- `apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts` - projection of canonical candidate results into planner nodes.
- `apps/api/test/structured-build-v1.spec.ts`
- `apps/api/test/adaptive-economy-v1.spec.ts`
- `apps/api/test/adaptive-phase-eligibility-v1.spec.ts`
- `apps/api/test/adaptive-choice-resolver-v1.spec.ts`

**Modify**
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts`
- `apps/api/src/statlocker-adaptive/statlocker-normalizer.service.ts`
- `apps/api/src/statlocker-adaptive/build-skeleton.service.ts`
- `apps/api/src/statlocker-adaptive/adaptive-decision-state-v1.service.ts`
- `apps/api/src/statlocker-adaptive/adaptive-evidence-scorer-v1.service.ts`
- `apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts`
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`
- `packages/deadlock-build-domain/src/recommendation-action-domain.ts`
- `packages/deadlock-build-domain/src/recommendation-candidate-generator.ts`
- `packages/deadlock-build-domain/test/recommendation-candidate-generator.spec.ts`
- `apps/api/test/adaptive-build-planner-v1.spec.ts`
- `apps/api/test/adaptive-evidence-scorer-v1.spec.ts`
- `apps/api/test/adaptive-policy-v1.integration.spec.ts`
- `apps/api/test/adaptive-replay-v1.spec.ts`

---

### Task 1: Introduce the structured build contract and policy knobs

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts`
- Create: `apps/api/src/statlocker-adaptive/structured-build-v1.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`
- Create: `apps/api/test/structured-build-v1.spec.ts`

**Interfaces:**
- Produces `ConsensusBuildPhaseV1`, `ConsensusBuildGroupTypeV1`, `ConsensusBuildCandidateV1`, `ConsensusBuildGroupV1`, and structured `ConsensusSkeletonV1.groups`.
- Produces `stableConsensusGroupIdV1(heroId, phase, type, itemIds): string`.
- Produces policy thresholds used by later tasks: phase floors, choice hysteresis, optional activation, and deterministic choice-inference thresholds.

- [ ] **Step 1: Write failing structured-build tests**

```ts
import { stableConsensusGroupIdV1 } from '../src/statlocker-adaptive/structured-build-v1';

describe('structured build v1', () => {
  it('creates a deterministic group id independent of candidate order', () => {
    expect(stableConsensusGroupIdV1(10, 'MID', 'CHOICE', [9, 4]))
      .toBe('hero:10:MID:CHOICE:4,9');
  });
});
```

Add a type-level fixture using a structured skeleton with one REQUIRED, one CHOICE, and one OPTIONAL group so compilation fails while `ConsensusSkeletonV1` still requires `items`.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
yarn workspace @deadlock-live-probe/api test structured-build-v1.spec.ts
```

Expected: FAIL because `structured-build-v1` and the new group types do not exist.

- [ ] **Step 3: Replace the flat consensus type with structured types**

Add to `statlocker-adaptive.types.ts`:

```ts
export type ConsensusBuildPhaseV1 = 'EARLY' | 'MID' | 'LATE';
export type ConsensusBuildGroupTypeV1 = 'REQUIRED' | 'CHOICE' | 'OPTIONAL';

export interface ConsensusBuildCandidateV1 {
  itemId: number;
  strength: number;
  coverage: number;
  purchaseRate: number;
  medianBuyTimeS: number;
  timingSpreadS: number;
  sourceProfileCount: number;
  frequencyTier: StatlockerFrequencyTierV1;
  rushEvidence: boolean;
}

export interface ConsensusBuildGroupV1 {
  groupId: string;
  phase: ConsensusBuildPhaseV1;
  type: ConsensusBuildGroupTypeV1;
  minSelect: number;
  maxSelect: number;
  candidates: readonly ConsensusBuildCandidateV1[];
  confidence: number;
  inferred: boolean;
}

export interface ConsensusSkeletonV1 {
  heroId: number;
  profileCount: number;
  groups: readonly ConsensusBuildGroupV1[];
}
```

Keep `ConsensusSkeletonComponentV1` only while the scorer migration still compiles; remove it once no call sites use it.

- [ ] **Step 4: Implement deterministic group helpers**

In `structured-build-v1.ts`:

```ts
export function stableConsensusGroupIdV1(
  heroId: number,
  phase: ConsensusBuildPhaseV1,
  type: ConsensusBuildGroupTypeV1,
  itemIds: readonly number[],
): string {
  const sorted = [...new Set(itemIds)].sort((a, b) => a - b);
  return `hero:${heroId}:${phase}:${type}:${sorted.join(',')}`;
}
```

Also add `candidateItemIdsV1(group)` and `findConsensusCandidateV1(skeleton, itemId)` helpers so later services do not duplicate nested loops.

- [ ] **Step 5: Add versioned structural thresholds to config**

Extend `AdaptivePolicyV1Config` with:

```ts
phase: {
  midMinTimeSec: number;
  lateMinTimeSec: number;
  aheadProgressAccelerationSec: number;
};
choice: {
  switchMinImprovement: number;
  committedReplaceMinImprovement: number;
  inferenceMinCoverage: number;
  inferenceMaxCooccurrence: number;
  inferenceMaxMedianTimeDeltaSec: number;
  inferenceMinConfidence: number;
};
optionalActivationMinScore: number;
investment: {
  crossingBonus: number;
  nearBreakpointBonus: number;
  achievedBreakpointDropPenalty: number;
  nearBreakpointMaxSouls: number;
};
```

Use initial deterministic defaults:

```ts
phase: { midMinTimeSec: 600, lateMinTimeSec: 1500, aheadProgressAccelerationSec: 120 },
choice: {
  switchMinImprovement: 0.08,
  committedReplaceMinImprovement: 0.25,
  inferenceMinCoverage: 0.30,
  inferenceMaxCooccurrence: 0.25,
  inferenceMaxMedianTimeDeltaSec: 300,
  inferenceMinConfidence: 0.60,
},
optionalActivationMinScore: 0.15,
investment: {
  crossingBonus: 0.18,
  nearBreakpointBonus: 0.08,
  achievedBreakpointDropPenalty: 0.20,
  nearBreakpointMaxSouls: 800,
},
```

These are policy defaults, not game-rule constants. Game-rule constants remain in the ruleset economy resolver introduced later.

- [ ] **Step 6: Run tests and build**

```bash
yarn workspace @deadlock-live-probe/api test structured-build-v1.spec.ts
yarn workspace @deadlock-live-probe/api build
```

Expected: PASS after all old flat-skeleton call sites receive temporary compile adapters or are migrated in the same commit.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts \
  apps/api/src/statlocker-adaptive/structured-build-v1.ts \
  apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts \
  apps/api/test/structured-build-v1.spec.ts
git commit -m "feat(recommendation): add structured consensus build contract"
```

---

### Task 2: Preserve pro-build phase and explicit choice metadata during normalization

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-normalizer.service.ts`
- Test: existing Statlocker normalizer tests under `apps/api/test/`

**Interfaces:**
- Extends `StatlockerProBuildItemV1` with normalized phase and optional explicit grouping metadata.
- Produces only `'EARLY' | 'MID' | 'LATE'` phases downstream.

- [ ] **Step 1: Add failing normalizer fixtures**

Add two fixtures/tests:

```ts
expect(result.payload.items[0]).toEqual(expect.objectContaining({
  phase: 'EARLY',
  explicitGroup: { type: 'CHOICE', groupKey: 'defense', minSelect: 1, maxSelect: 1 },
}));
```

and a malformed phase case that must throw `StatlockerDatasetValidationError` instead of passing arbitrary strings.

- [ ] **Step 2: Run the focused normalizer tests**

```bash
yarn workspace @deadlock-live-probe/api test statlocker-normalizer
```

Expected: FAIL on the new assertions.

- [ ] **Step 3: Add normalized explicit grouping types**

```ts
export interface StatlockerProBuildExplicitGroupV1 {
  type: 'CHOICE' | 'OPTIONAL' | 'REQUIRED';
  groupKey: string;
  minSelect: number;
  maxSelect: number;
}

export interface StatlockerProBuildItemV1 {
  itemId: number;
  purchaseRate: number;
  medianBuyTimeS: number;
  frequencyTier: StatlockerFrequencyTierV1;
  phase: ConsensusBuildPhaseV1;
  relationships: readonly StatlockerProItemRelationshipV1[];
  explicitGroup?: StatlockerProBuildExplicitGroupV1;
}
```

- [ ] **Step 4: Normalize phase strictly**

Implement `normalizeBuildPhaseV1(value)` with accepted aliases only:

```ts
function normalizeBuildPhaseV1(value: unknown): ConsensusBuildPhaseV1 {
  const text = String(value ?? '').trim().toUpperCase();
  if (text === 'EARLY' || text === 'EARLY_GAME') return 'EARLY';
  if (text === 'MID' || text === 'MID_GAME') return 'MID';
  if (text === 'LATE' || text === 'LATE_GAME') return 'LATE';
  throw new StatlockerDatasetValidationError('PRO_BUILD_ANALYSIS', `unknown phase ${String(value)}`);
}
```

- [ ] **Step 5: Preserve explicit fields only when actually present**

In `parseProBuildItem`, inspect existing raw keys without inventing semantics. Support explicit group metadata only from keys present in the response such as `group`, `category`, `pick`, `min_select`, and `max_select`; if no structurally valid explicit group exists, leave `explicitGroup` undefined. Do not infer from `relationships` here.

- [ ] **Step 6: Run normalizer and full API tests**

```bash
yarn workspace @deadlock-live-probe/api test statlocker-normalizer
yarn workspace @deadlock-live-probe/api test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts \
  apps/api/src/statlocker-adaptive/statlocker-normalizer.service.ts \
  apps/api/test
git commit -m "feat(recommendation): preserve pro build phase and choice metadata"
```

---

### Task 3: Derive REQUIRED, CHOICE, and OPTIONAL groups instead of a flat union

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/build-skeleton.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts`
- Modify: `apps/api/src/statlocker-adaptive/structured-build-v1.ts`
- Test: `apps/api/test/build-skeleton.spec.ts` or existing consensus-skeleton test file

**Interfaces:**
- `deriveSkeleton(heroId, profiles)` continues to exist but now returns `ConsensusSkeletonV1.groups`.
- Explicit groups are authoritative.
- Fallback inference uses same-phase, timing, coverage, co-occurrence, and upgrade/component exclusions.

- [ ] **Step 1: Write three failing consensus tests**

Create profiles proving:

1. A and B appear in the same phase, each with high coverage, but almost never together -> one `CHOICE` group.
2. A and B repeatedly appear together -> two non-choice groups.
3. Rare D -> OPTIONAL and not REQUIRED.

Expected assertion example:

```ts
expect(result.groups).toEqual(expect.arrayContaining([
  expect.objectContaining({ type: 'CHOICE', minSelect: 1, maxSelect: 1 }),
]));
```

- [ ] **Step 2: Run the test and confirm flat-union behavior fails**

```bash
yarn workspace @deadlock-live-probe/api test build-skeleton
```

- [ ] **Step 3: Replace per-item derivation with per-profile observation matrix**

Build:

```ts
interface ItemObservationV1 {
  profileIndex: number;
  item: StatlockerProBuildItemV1;
}
```

Calculate coverage, purchase-rate mean, median buy time, median absolute timing deviation, and co-occurrence counts from actual profile membership.

- [ ] **Step 4: Apply explicit groups first**

Group items sharing the same valid `explicitGroup.groupKey` and compatible phase/type. Emit deterministic `groupId` through `stableConsensusGroupIdV1` and set `inferred: false`.

- [ ] **Step 5: Infer CHOICE pairs/groups only after hard exclusions**

A candidate pair qualifies only when:

```ts
samePhase &&
coverageA >= config.choice.inferenceMinCoverage &&
coverageB >= config.choice.inferenceMinCoverage &&
cooccurrenceRate <= config.choice.inferenceMaxCooccurrence &&
Math.abs(medianA - medianB) <= config.choice.inferenceMaxMedianTimeDeltaSec &&
!isUpgradeRelated(a, b)
```

For this task, `isUpgradeRelated` must be conservative from pro-build relationships only if the relationship is explicitly typed; otherwise do not use relationship strength as an exclusion. The definitive graph exclusion is added at planner resolution time when the item graph is available.

Compute deterministic inference confidence from normalized coverage, exclusivity, and timing overlap; require `>= inferenceMinConfidence`.

- [ ] **Step 6: Emit REQUIRED and OPTIONAL single-item groups**

Use existing core strength logic as prior. A non-choice item classified `CORE` or `FREQUENT` becomes REQUIRED. `SOMETIMES`/`FLEX` becomes OPTIONAL. Preserve `rushEvidence` only when a meaningful fraction of observations fall materially earlier than the phase floor; do not derive rush from WPA.

- [ ] **Step 7: Bump consensus snapshot versions**

Change:

```ts
const SKELETON_SCHEMA_VERSION = 'statlocker-consensus-skeleton-v2';
const SKELETON_NORMALIZER_VERSION = 'consensus-builder-v2';
```

This prevents old flat payloads from being mistaken for the new contract.

- [ ] **Step 8: Run consensus, evidence, and API suites**

```bash
yarn workspace @deadlock-live-probe/api test build-skeleton
yarn workspace @deadlock-live-probe/api test statlocker-evidence
yarn workspace @deadlock-live-probe/api test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/statlocker-adaptive/build-skeleton.service.ts \
  apps/api/src/statlocker-adaptive/structured-build-v1.ts \
  apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts \
  apps/api/test
git commit -m "feat(recommendation): derive structured pro build groups"
```

---

### Task 4: Make slot legality dynamic and expose canonical projected transitions

**Files:**
- Modify: `packages/deadlock-build-domain/src/recommendation-action-domain.ts`
- Modify: `packages/deadlock-build-domain/src/recommendation-candidate-generator.ts`
- Modify: `packages/deadlock-build-domain/test/recommendation-candidate-generator.spec.ts`

**Interfaces:**
- Extends generator rules with `unlockedFlexSlots?: number` and `flexCapacityEvidence: FactEvidence`.
- Adds feasibility reason `FLEX_SLOT_CAPACITY_UNKNOWN`.
- Exports `projectRecommendationCandidateState(state, candidate, itemGraph): RecommendationDecisionState` so future search uses exactly the candidate generator result.

- [ ] **Step 1: Write failing slot-capacity tests**

Test the same inventory/candidate under:

```ts
{ unlockedFlexSlots: 0, flexCapacityEvidence: 'OBSERVED' }
{ unlockedFlexSlots: 1, flexCapacityEvidence: 'OBSERVED' }
```

The first must reject an overflow purchase; the second must allow it.

Add an UNKNOWN case where current inventory already proves one flex is in use: one additional flex must still be rejected with `FLEX_SLOT_CAPACITY_UNKNOWN`, while transactions that do not increase flex use remain legal.

- [ ] **Step 2: Run domain tests and verify failure**

```bash
yarn workspace @deadlock-live-probe/build-domain test recommendation-candidate-generator.spec.ts
```

- [ ] **Step 3: Extend dynamic slot rules**

```ts
export interface RecommendationCandidateGeneratorRules {
  baseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
  unlockedFlexSlots?: number;
  flexCapacityEvidence: FactEvidence;
  maxActiveItems: number;
  allowSellOnlyActions: boolean;
  generateTargetedWaitActions: boolean;
}
```

Keep `maxFlexSlots` as ruleset maximum; do not use it as live unlocked capacity.

- [ ] **Step 4: Calculate current lower bound and candidate capacity**

Add:

```ts
function flexUsedFor(itemIds: readonly number[], graph: RecommendationItemGraph, rules: RecommendationCandidateGeneratorRules): number;
```

For UNKNOWN capacity:

```ts
const currentUsed = flexUsedFor(heldIds(state), graph, rules);
const permitted = rules.unlockedFlexSlots ?? currentUsed;
```

If a projected inventory needs more than `permitted` and evidence is UNKNOWN, add `FLEX_SLOT_CAPACITY_UNKNOWN`; if evidence is known and exceeds capacity, use `SLOT_LIMIT_EXCEEDED`.

- [ ] **Step 5: Export canonical projection helper**

```ts
export function projectRecommendationCandidateState(
  state: RecommendationDecisionState,
  candidate: RecommendationCandidate,
  graph: RecommendationItemGraph,
): RecommendationDecisionState {
  return {
    ...state,
    inventory: inventoryFromProjectedIds(state.inventory, candidate.resultingItemIds, graph),
    economy: {
      ...state.economy,
      spendableSouls: candidate.spendableSoulsAfter === undefined
        ? state.economy.spendableSouls
        : reconstructedFact(candidate.spendableSoulsAfter, `candidate:${candidate.actionId}`),
    },
  };
}
```

The helper must preserve lifecycle data for unchanged item IDs and create deterministic projected instances only for newly introduced IDs.

- [ ] **Step 6: Run the domain suite**

```bash
yarn workspace @deadlock-live-probe/build-domain test
yarn workspace @deadlock-live-probe/build-domain build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/deadlock-build-domain/src/recommendation-action-domain.ts \
  packages/deadlock-build-domain/src/recommendation-candidate-generator.ts \
  packages/deadlock-build-domain/test/recommendation-candidate-generator.spec.ts
git commit -m "feat(recommendation): make flex legality state aware"
```

---

### Task 5: Add ruleset-aware slot and investment state

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-economy-v1.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-decision-state-v1.service.ts`
- Create: `apps/api/test/adaptive-economy-v1.spec.ts`
- Modify: `apps/api/test/adaptive-decision-state-v1.spec.ts`

**Interfaces:**
- Produces `AdaptiveSlotStateV1`, `AdaptiveInvestmentStateV1`, `RecommendationEconomyRulesV1`.
- `AdaptiveDecisionStateV1` gains `slots` and `investment`.
- Unknown exact rules produce `investment.evidence === 'UNKNOWN'` and zero investment score downstream, never guessed breakpoints.

- [ ] **Step 1: Write failing investment-state tests**

Use a test economy rules fixture:

```ts
const rules = {
  rulesetId: 'ruleset-a',
  catalogSha256: 'a'.repeat(64),
  baseSlotsByType: { weapon: 4, vitality: 4, spirit: 4 },
  maxFlexSlots: 4,
  investmentBreakpoints: {
    weapon: [1600, 3200, 6400],
    vitality: [1600, 3200, 6400],
    spirit: [1600, 3200, 6400],
  },
};
```

With owned weapon items worth 800 + 800, assert `currentValue=1600`, `achievedBreakpoint=1600`, `nextBreakpoint=3200`, `soulsToNextBreakpoint=1600`.

Also assert unknown rules returns UNKNOWN evidence rather than fallback breakpoints.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-economy-v1.spec.ts
```

- [ ] **Step 3: Implement pure economy derivation**

Define:

```ts
export interface RecommendationEconomyRulesV1 {
  rulesetId: string;
  catalogSha256: string;
  baseSlotsByType: Readonly<Record<InventorySlotType, number>>;
  maxFlexSlots: number;
  investmentBreakpoints: Readonly<Record<AdaptiveInvestmentTypeV1, readonly number[]>>;
}
```

`deriveAdaptiveInvestmentStateV1` sums the catalog cost of currently held items by slot type. For upgrades, only currently held final items count, so component consumption naturally changes the projected total after canonical transition.

- [ ] **Step 4: Implement slot lower-bound derivation**

`deriveAdaptiveSlotStateV1` calculates base usage and actual current overflow. With no direct objective/flex telemetry, set:

```ts
unlockedFlexSlots: undefined,
evidence: 'UNKNOWN',
provedFlexLowerBound: currentFlexUsed,
```

If a direct/reconstructed source is later found in `MinimalMatchState`, feed it into this pure function without changing planner semantics.

- [ ] **Step 5: Resolve rules by exact identity**

Create `resolveRecommendationEconomyRulesV1(rulesetId, catalogSha256)` that accepts only an exact registered `(rulesetId, catalogSha256)` entry. The implementation may register current verified production rules once their values are extracted from imported game/reference data; until an exact entry exists, return `undefined` and disable investment utility. Tests must prove no wildcard/default rule is used.

- [ ] **Step 6: Extend `AdaptiveDecisionStateV1Service`**

After compiling catalog and inventory, compute slot state from the actual inventory. Compute investment state only when `resolveRecommendationEconomyRulesV1` succeeds; otherwise return an UNKNOWN investment state.

- [ ] **Step 7: Run decision-state and economy tests**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-economy-v1.spec.ts
yarn workspace @deadlock-live-probe/api test adaptive-decision-state-v1.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-economy-v1.ts \
  apps/api/src/statlocker-adaptive/adaptive-decision-state-v1.service.ts \
  apps/api/test/adaptive-economy-v1.spec.ts \
  apps/api/test/adaptive-decision-state-v1.spec.ts
git commit -m "feat(recommendation): model live slot and investment state"
```

---

### Task 6: Gate build groups by phase before scoring

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-phase-eligibility-v1.service.ts`
- Create: `apps/api/test/adaptive-phase-eligibility-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`

**Interfaces:**
- Produces `AdaptiveGroupEligibilityV1` and `evaluateGroup(group, context)`.
- Consumes structured skeleton, owned items, completion state, game time, team game state, and investment state.

- [ ] **Step 1: Write failing phase tests**

Cover:

```ts
EARLY at 120s -> ELIGIBLE
MID at 120s without rush -> NOT_YET_ELIGIBLE
MID at 120s with rushEvidence -> ELIGIBLE
MID after floor but required EARLY incomplete -> NOT_YET_ELIGIBLE
MID after floor and required EARLY complete -> ELIGIBLE
LATE before floor -> NOT_YET_ELIGIBLE
```

- [ ] **Step 2: Run and verify failure**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-phase-eligibility-v1.spec.ts
```

- [ ] **Step 3: Implement deterministic eligibility**

Use this ordering:

```ts
if (groupCompleted) return 'COMPLETED';
if (committedOtherBranch) return 'COMMITTED_OTHER_BRANCH';
if (group.phase === 'EARLY') return 'ELIGIBLE';
if (groupHasRushEvidence(group)) return 'ELIGIBLE';
if (!requiredPriorGroupsComplete) return 'NOT_YET_ELIGIBLE';
if (group.phase === 'MID' && effectiveTimeSec >= config.phase.midMinTimeSec) return 'ELIGIBLE';
if (group.phase === 'LATE' && effectiveTimeSec >= config.phase.lateMinTimeSec) return 'ELIGIBLE';
return 'NOT_YET_ELIGIBLE';
```

`effectiveTimeSec` may accelerate only by configured `aheadProgressAccelerationSec` when game state is confidently AHEAD; do not let arbitrary WPA or item score modify eligibility.

- [ ] **Step 4: Register the service and run tests**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-phase-eligibility-v1.spec.ts
yarn workspace @deadlock-live-probe/api build
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-phase-eligibility-v1.service.ts \
  apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts \
  apps/api/test/adaptive-phase-eligibility-v1.spec.ts
git commit -m "feat(recommendation): hard gate build phases"
```

---

### Task 7: Resolve CHOICE groups and reconstruct branch commitment

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-choice-resolver-v1.service.ts`
- Create: `apps/api/test/adaptive-choice-resolver-v1.spec.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`

**Interfaces:**
- Produces `AdaptiveChoiceStateV1`.
- `reconstructChoiceState(group, ownedItemIds, itemGraph, previousSelectedItemId?)` identifies target ownership and branch-unique component ownership.
- `resolveChoice(group, context)` ranks only candidates in that group and applies local hysteresis.

- [ ] **Step 1: Write failing commitment tests**

Use an item graph where alternatives A and B share component X but have unique components UA and UB.

Assertions:

```ts
owned [X] -> committed=false
owned [UA] -> committed=true, committedItemId=A
owned [A] -> committed=true, committedItemId=A
```

- [ ] **Step 2: Write failing contextual resolution test**

Build a `CHOICE [A,B]` where base priors are close but `VS_HERO_WPA` strongly favors B against enemy 20. Assert B is selected. Then pass previous selection A with score difference below `choice.switchMinImprovement` and assert A is retained.

- [ ] **Step 3: Run and verify failure**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-choice-resolver-v1.spec.ts
```

- [ ] **Step 4: Implement transitive component closure**

Use only `RecommendationItemGraph.getDirectComponentIds()` recursively with a visited set. Shared components are intersection members across alternative closures; unique components are closure(candidate) minus union(shared).

- [ ] **Step 5: Implement commitment precedence**

1. Owned final alternative target commits immediately.
2. Owned unique component commits its branch.
3. Shared component does not commit.
4. Multiple conflicting unique branches preserve a still-valid previous committed branch; otherwise return `externallyDiverged: true` and do not silently choose a new committed branch.

- [ ] **Step 6: Implement contextual resolution**

Call `AdaptiveEvidenceScorerV1Service.scoreItem` for candidates in this group only. If uncommitted, select best candidate unless previous selection is within `switchMinImprovement`. If committed, return the committed branch without normal switching.

- [ ] **Step 7: Run tests and build**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-choice-resolver-v1.spec.ts
yarn workspace @deadlock-live-probe/api build
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-choice-resolver-v1.service.ts \
  apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts \
  apps/api/test/adaptive-choice-resolver-v1.spec.ts
git commit -m "feat(recommendation): resolve and commit build choices"
```

---

### Task 8: Add path-aware investment and slot utility to scoring

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-evidence-scorer-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`
- Modify: `apps/api/test/adaptive-evidence-scorer-v1.spec.ts`

**Interfaces:**
- Extends scorer context with optional `investmentDelta` and `slotDelta` precomputed by projected transition logic.
- Adds score component keys `investmentUtility` and `slotEfficiency`.

- [ ] **Step 1: Write failing scorer tests**

Test that identical contextual evidence yields a higher score when an action crosses a verified investment breakpoint, and lower score when a replacement drops an achieved breakpoint. Test that UNKNOWN investment evidence contributes exactly zero.

- [ ] **Step 2: Run scorer tests**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-evidence-scorer-v1.spec.ts
```

- [ ] **Step 3: Add normalized transition inputs**

```ts
export interface AdaptiveInvestmentDeltaV1 {
  evidence: FactEvidence;
  breakpointsCrossed: number;
  distanceReducedSouls: number;
  achievedBreakpointsLost: number;
}

export interface AdaptiveSlotDeltaV1 {
  flexUsedBefore: number;
  flexUsedAfter: number;
  slotsFreed: number;
}
```

- [ ] **Step 4: Add bounded components**

Investment component:

```ts
const investmentUtility = delta.evidence === 'UNKNOWN'
  ? 0
  : clamp(
      delta.breakpointsCrossed * config.investment.crossingBonus +
      nearBreakpointReduction(delta, config) * config.investment.nearBreakpointBonus -
      delta.achievedBreakpointsLost * config.investment.achievedBreakpointDropPenalty,
      -1,
      1,
    );
```

Slot efficiency rewards upgrades/replacements that reduce flex pressure and never overrides feasibility.

- [ ] **Step 5: Run scorer and config suites**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-evidence-scorer-v1.spec.ts
yarn workspace @deadlock-live-probe/api test adaptive-config-v1.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-evidence-scorer-v1.service.ts \
  apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts \
  apps/api/test/adaptive-evidence-scorer-v1.spec.ts
git commit -m "feat(recommendation): score investment and slot transitions"
```

---

### Task 9: Build canonical planner transitions from generated candidates

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts`
- Create or extend: `apps/api/test/adaptive-economy-v1.spec.ts`

**Interfaces:**
- Produces `AdaptivePlannerNodeV1` and `projectPlannerCandidateV1(node, candidate, graph, economyRules)`.
- Uses `projectRecommendationCandidateState`; no duplicated transaction logic.

- [ ] **Step 1: Write failing projection tests**

Cover:

- BUY adds target and subtracts wallet.
- UPGRADE consumes component and adds target.
- SELL removes item and applies refund/returns through candidate projection.
- REPLACE performs projected inventory/wallet exactly as candidate result.
- investment and slot state are recomputed from projected inventory.

- [ ] **Step 2: Run tests**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-economy-v1.spec.ts
```

- [ ] **Step 3: Implement planner node**

```ts
export interface AdaptivePlannerNodeV1 {
  decisionState: RecommendationDecisionState;
  slots: AdaptiveSlotStateV1;
  investment: AdaptiveInvestmentStateV1;
  selectedChoices: ReadonlyMap<string, number>;
  committedChoices: ReadonlyMap<string, number>;
  completedGroupIds: ReadonlySet<string>;
  actions: readonly RecommendationCandidate[];
  utility: number;
  confidenceSum: number;
}
```

- [ ] **Step 4: Implement projection using canonical result**

Call `projectRecommendationCandidateState`, then recompute slots/investment and group completion from the resulting inventory. Never hand-code BUY/UPGRADE/SELL/REPLACE mutation in this file.

- [ ] **Step 5: Run focused tests and API build**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-economy-v1.spec.ts
yarn workspace @deadlock-live-probe/api build
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts \
  apps/api/test/adaptive-economy-v1.spec.ts
git commit -m "feat(recommendation): project canonical planner transitions"
```

---

### Task 10: Rewrite `AdaptiveBuildPlannerV1` around structured targets and legal action beam search

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts`
- Modify: `apps/api/test/adaptive-build-planner-v1.spec.ts`

**Interfaces:**
- Removes `BeamNodeV1.itemIds`, `buildFuturePool`, `searchFutureTargets`, and `remainingSkeleton` append behavior.
- Produces internal `planSteps: RecommendationCandidate[]` and derives public `recommendedBuild` from those steps.
- Consumes phase eligibility, choice resolver, canonical candidate generation, and transition projection.

- [ ] **Step 1: Add the critical regression tests before changing planner code**

Add all of these to `adaptive-build-planner-v1.spec.ts`:

```text
high-WPA MID item at 120s is never NEXT
CHOICE A/B emits only the selected alternative
choice may switch before commitment
choice cannot switch after unique-component commitment
OPTIONAL item below activation threshold is absent
unknown flex capacity never assumes four free flex slots
verified investment breakpoint can change NEXT
critical exact-enemy counter can override investment preference
upgrade consumes component and remains legal
full inventory prefers legal upgrade/replacement rather than illegal buy
recommended build has no remaining-skeleton tail
NEXT target equals nextAction.targetItemId
```

- [ ] **Step 2: Run planner tests and record expected failures**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-build-planner-v1.spec.ts
```

- [ ] **Step 3: Build semantic target set**

Replace global pool construction with:

```ts
const eligibleGroups = phaseService.evaluateAll(...);
const resolvedGroups = resolveChoicesAndOptionalActivation(...);
const targetItemIds = resolvedGroups.flatMap(selectedTargetsForGroup);
```

Include a near-future required group only if all preceding required groups can be completed within the configured planning depth. Do not add raw WPA-only items outside structured groups.

- [ ] **Step 4: Generate legal edges from canonical candidate generator**

At each node:

```ts
const rules = generatorRulesForNode(node, input.decision.slots, economyRules);
const candidates = generateRecommendationCandidates({
  state: node.decisionState,
  itemGraph: input.decision.itemGraph,
  rules,
}).filter((candidate) => candidate.feasible && actionTouchesSemanticTarget(candidate, targetItemIds));
```

Always retain relevant WAIT actions. Preserve recent-purchase sell protection and recent-sell churn penalties.

- [ ] **Step 5: Score edges with path-aware deltas**

For BUY/UPGRADE/REPLACE target item, call the existing scorer with transition penalties plus `investmentDelta` and `slotDelta`. SELL receives negative item-value/transaction utility and investment-drop penalty. WAIT receives saving/target continuation value but cannot complete a group.

- [ ] **Step 6: Beam-search projected states**

Use configured `planningDepth` and `beamWidth`. Node tie-breaker must compare deterministic action ID sequences. Deduplicate equivalent nodes by stable key:

```text
sorted inventory IDs | wallet if known | selected choices | committed choices | completed groups
```

Keep the best utility node for each key.

- [ ] **Step 7: Derive public plan from legal plan steps**

`recommendedBuild` order:

1. owned relevant items,
2. transaction targets in selected plan-step order,
3. selected future REQUIRED/CHOICE targets reachable in horizon.

Never append every skeleton candidate. OPTIONAL targets appear only when activated.

Set the first unowned transaction target to `NEXT`; subsequent selected targets are `PLANNED`.

- [ ] **Step 8: Make immediate action and NEXT consistent**

`nextAction` must come from the first legal selected plan step when executable. If the best path begins with WAIT, use the WAIT semantic action with its target. A BUY/UPGRADE/REPLACE action target must equal the `NEXT` item.

- [ ] **Step 9: Revalidate whole-plan hysteresis**

Before preserving previous plan, validate it against current structured groups, current phase, commitment, and canonical current candidates. If invalid, ignore hysteresis regardless of score delta.

- [ ] **Step 10: Run planner tests**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-build-planner-v1.spec.ts
```

Expected: all new structural regressions PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts \
  apps/api/test/adaptive-build-planner-v1.spec.ts
git commit -m "feat(recommendation): rewrite adaptive planner as legal state search"
```

---

### Task 11: Integrate structured planning into recommendation serving and replay

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-recommendation-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`
- Modify: `apps/api/test/adaptive-policy-v1.integration.spec.ts`
- Modify: `apps/api/test/adaptive-replay-v1.spec.ts`
- Modify: `apps/api/test/adaptive-recommendation-v1.spec.ts`

**Interfaces:**
- Serving API shape remains backward-compatible.
- Replay output remains deterministic and includes the same planner version string.

- [ ] **Step 1: Add integration assertions for invariants**

For representative decisions assert:

```ts
expect(result.recommendedBuild.filter((x) => x.status === 'NEXT')).toHaveLength(1);
expect(result.recommendedBuild.find((x) => x.status === 'NEXT')?.itemId)
  .toBe(result.nextAction.targetItemId);
```

Add a replay fixture whose old behavior would choose a MID item first and assert the new first target is EARLY.

- [ ] **Step 2: Run integration/replay tests before wiring**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-policy-v1.integration.spec.ts
yarn workspace @deadlock-live-probe/api test adaptive-replay-v1.spec.ts
```

Expected: FAIL until the new dependencies are wired.

- [ ] **Step 3: Wire new services in the Nest module and planner constructor**

Register `AdaptivePhaseEligibilityV1Service` and `AdaptiveChoiceResolverV1Service`. Ensure no circular dependency; both services depend only on scorer/config/domain helpers, not on the planner.

- [ ] **Step 4: Preserve final legality recheck**

Do not weaken the existing recommendation-service final legality pass. It remains a second defense after stateful planner search.

- [ ] **Step 5: Run serving and replay suites**

```bash
yarn workspace @deadlock-live-probe/api test adaptive-recommendation-v1.spec.ts
yarn workspace @deadlock-live-probe/api test adaptive-policy-v1.integration.spec.ts
yarn workspace @deadlock-live-probe/api test adaptive-replay-v1.spec.ts
```

Expected: PASS and deterministic repeat replay output.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/statlocker-adaptive/adaptive-recommendation-v1.service.ts \
  apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts \
  apps/api/test/adaptive-policy-v1.integration.spec.ts \
  apps/api/test/adaptive-replay-v1.spec.ts \
  apps/api/test/adaptive-recommendation-v1.spec.ts
git commit -m "test(recommendation): integrate structured planner regressions"
```

---

### Task 12: Run the merge gate and record deterministic replay evidence

**Files:**
- Modify only if a regression requires a correctness fix in files already owned by Tasks 1-11.
- Update: `docs/superpowers/specs/2026-09-03-structured-adaptive-planner-v1-design.md` only if implementation discovered a factual contract difference; do not silently diverge.

**Interfaces:**
- No new runtime interface. This task is the release correctness gate.

- [ ] **Step 1: Run build-domain tests**

```bash
yarn workspace @deadlock-live-probe/build-domain test
yarn workspace @deadlock-live-probe/build-domain build
```

Expected: PASS.

- [ ] **Step 2: Run the full API test suite**

```bash
yarn workspace @deadlock-live-probe/api test
```

Expected: PASS.

- [ ] **Step 3: Run the full workspace build**

```bash
yarn build
```

Expected: PASS.

- [ ] **Step 4: Run replay twice and compare deterministic output**

Use the existing replay harness/test fixture twice with identical input. Assert serialized `nextAction`, `recommendedBuild`, `changes`, `totalScore`, and `confidence` are identical.

- [ ] **Step 5: Verify structural metrics on replay corpus**

The replay gate must report:

```text
illegalActionRate = 0
slotViolationRate = 0
hardPhaseViolationRate = 0
doubleChoiceRate = 0
unreachablePlanRate = 0
nextActionBuildMismatchRate = 0
postCommitBranchChurnRate = 0
```

Any non-zero value blocks merge.

- [ ] **Step 6: Benchmark planner runtime**

Record p50/p95 planning time across replay fixtures with current `planningDepth=3`, `beamWidth=8`. If p95 is materially worse than the current API recommendation budget, reduce search branching by semantic target pruning before changing correctness constraints. Do not solve latency by removing legality checks.

- [ ] **Step 7: Inspect the diff for forbidden legacy behavior**

Confirm there is no code equivalent to:

```ts
const ordered = [...owned, ...beamItemIds, ...remainingSkeleton];
```

and no future search node whose only projected state is an `itemIds[]` sequence.

- [ ] **Step 8: Commit final verification-only fixes if needed**

```bash
git status --short
git add <only-files-changed-for-verified-fixes>
git commit -m "fix(recommendation): close structured planner regression gate"
```

Skip this commit when the working tree is already clean.

## Self-Review Result

- **Spec coverage:** Structured consensus, phase eligibility, explicit/fallback CHOICE, commitment, dynamic flex capacity, ruleset-aware investment, canonical action transitions, stateful beam search, NEXT consistency, hysteresis validity, `remainingSkeleton` removal, replay metrics, and merge gates are each assigned to a concrete task.
- **Placeholder scan:** No `TBD`, `TODO`, or unspecified implementation step remains. Unknown production investment rules are intentionally fail-closed by exact `(rulesetId, catalogSha256)` lookup rather than filled with guessed game constants.
- **Type consistency:** `ConsensusSkeletonV1.groups`, `AdaptiveSlotStateV1`, `AdaptiveInvestmentStateV1`, `AdaptiveChoiceStateV1`, and `AdaptivePlannerNodeV1` are introduced before their planner usage. Candidate transitions always flow through `RecommendationCandidate` and `projectRecommendationCandidateState`.
- **Scope:** The Statlocker collector, snapshot refresh infrastructure, public API shape, and unrelated ML/BuildLM roadmap remain out of scope.
