# Structured Adaptive Planner V1 Design

## Status

Approved direction for replacing the current flat Statlocker item ranking flow with a constrained, stateful build planner while keeping the existing Statlocker browser collector and snapshot refresh infrastructure.

Target branch: `feature/structured-adaptive-planner-v1`.

## Problem

The current planner treats the build problem primarily as item ranking. It builds a future pool from consensus skeleton items, hero WPA items, exact enemy WPA items, and T4 chains, scores those items, runs a beam search over item IDs, then appends any remaining consensus skeleton items to the result.

That architecture has several correctness failures:

- A mid-game item can become the first recommended purchase because phase and timing are only soft scoring inputs.
- All items seen in pro builds can become a single linear queue even when they are alternatives, optional purchases, or situational counters.
- Choice semantics such as `A OR B` are lost during consensus derivation.
- The future planner reasons over item IDs instead of real BUY, UPGRADE, SELL, REPLACE, and WAIT transitions.
- Slot constraints are checked by the immediate candidate generator, but future planning does not carry a projected inventory state through search.
- The candidate rules expose all configured flex capacity rather than the flex slots actually unlocked in the current match.
- Investment breakpoints are not modeled as stateful planning objectives.
- A choice can oscillate after the player has already invested into one branch because branch commitment is not represented.
- `recommendedBuild` can contain items that are not reachable by a legal sequence of transactions.

The implementation must fix these as structural correctness problems before tuning scorer weights.

## Goals

1. Preserve the existing Statlocker collection, snapshot storage, refresh cadence, and evidence freshness model.
2. Replace the flat consensus skeleton with a structured build representation that preserves phase, required items, choices, optional items, timing evidence, and source confidence.
3. Make phase a hard eligibility gate for normal planning rather than a soft score penalty.
4. Resolve `OR` choices contextually, with `VS_HERO_WPA` as a major discriminator among already valid alternatives.
5. Commit a choice branch after the player invests into an item or a branch-unique component.
6. Model live slot capacity using the current match's unlocked flex slots.
7. Model Weapon, Vitality, and Spirit investment progress and value meaningful breakpoint completion without making it an absolute rule.
8. Make future search operate on legal action transitions and projected state, not raw item IDs.
9. Ensure `NEXT` is the first executable action step in the selected plan.
10. Remove the `remainingSkeleton` behavior entirely.
11. Keep the public planner version identifier `adaptive-build-planner-v1` and rewrite V1 in place.
12. Block merge until unit, integration, and replay correctness gates pass.

## Non-goals

- Replacing the Statlocker browser collector.
- Introducing a separate production V2 planner or shadow traffic path.
- Training an end-to-end sequence model.
- Treating unknown Statlocker relationship semantics as proven `OR` semantics.
- Tuning final scoring weights before structural correctness is established.
- Refactoring unrelated live-state, catalog, or API code.

## Chosen Product Semantics

### Choice display

When a build contains `A OR B`, the planner chooses one branch and the UI receives only the selected item in the linear Build Path. The unresolved alternatives remain internal planner metadata.

Before commitment, the selected branch may change when the match context changes materially.

### Choice commitment

A choice becomes committed when the player acquires either:

- the selected target item itself, or
- an upgrade component that is unique to the selected branch.

A component shared by multiple alternatives does not commit the branch.

After commitment, a different branch can only be selected through an explicit economically justified SELL or REPLACE path. Normal rescoring cannot silently switch the branch.

### Phase eligibility

Early, Mid, and Late are eligibility constraints. A normal Mid or Late item is not a candidate before the planner determines that phase is eligible.

A future-phase item may become eligible early only when explicit or statistically strong rush evidence exists. High WPA alone is not rush evidence.

Phase determination uses a combination of:

- game time,
- observed economy where available,
- inventory progression,
- completed required groups,
- investment progress,
- pro timing distributions.

### Investment

Investment breakpoints are strong planning objectives, not hard ordering rules.

A candidate that efficiently closes a meaningful Weapon, Vitality, or Spirit investment breakpoint receives additional path utility. A critical counter or core completion may override that preference when its contextual utility is materially higher.

Investment rules are versioned by ruleset/catalog identity and are not hardcoded inside the planner service.

### Deployment

Planner V1 is rewritten in place. There is no parallel V2 and no shadow serving path.

The new implementation must pass deterministic unit tests, integration tests, and replay regression gates before merge.

## Existing Components To Reuse

The current codebase already has useful foundations:

- `recommendation-item-graph.ts` models item definitions, direct components, direct upgrades, and upgrade recipes.
- `recommendation-candidate-generator.ts` models BUY, UPGRADE, SELL, REPLACE, WAIT, affordability, inventory mutations, slot legality, and active item limits.
- `adaptive-evidence-scorer-v1.service.ts` already exposes decomposed contextual score components.
- `adaptive-replay-v1.service.ts` and existing replay tests provide a deterministic regression harness.
- Statlocker `PRO_BUILD_ANALYSIS` normalization already retains `purchaseRate`, `medianBuyTimeS`, `frequencyTier`, `phase`, and `relationships`.
- `VS_HERO_WPA` normalization already retains hero, enemy hero, item, delta WPA, and sample count.

The rewrite should extend these boundaries rather than duplicate them.

## High-level Pipeline

```text
Statlocker pro profiles
        |
        v
Structured consensus build
  - phases
  - REQUIRED groups
  - CHOICE groups
  - OPTIONAL groups
  - timing and confidence evidence
        |
        v
Live decision state
  - inventory
  - spendable souls
  - enemies
  - game state
  - unlocked flex slots
  - investment progress
        |
        v
Eligibility
  - phase
  - group completion
  - branch commitment
  - ruleset availability
        |
        v
Contextual choice resolution
  - base WPA
  - VS_HERO_WPA
  - game state
  - timing
  - investment impact
  - slot impact
        |
        v
Legal action generation
  - BUY
  - UPGRADE
  - SELL
  - REPLACE
  - WAIT
        |
        v
Stateful action search
        |
        v
Plan steps
        |
        v
NEXT + recommendedBuild
```

## Data Model

### Structured consensus build

Replace the flat internal skeleton payload with a structured representation. The dataset remains `CONSENSUS_SKELETON` for compatibility with snapshot storage, but its schema version is bumped and the payload becomes structured.

Proposed types:

```ts
export type ConsensusBuildPhaseV1 = 'EARLY' | 'MID' | 'LATE';

export type ConsensusBuildGroupTypeV1 =
  | 'REQUIRED'
  | 'CHOICE'
  | 'OPTIONAL';

export interface ConsensusBuildCandidateV1 {
  itemId: number;
  strength: number;
  coverage: number;
  purchaseRate: number;
  medianBuyTimeS: number;
  timingSpreadS: number;
  sourceProfileCount: number;
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

The existing name `ConsensusSkeletonV1` may be retained temporarily to minimize call-site churn, but the payload semantics become structured. If keeping the V1 type name becomes misleading during implementation, introduce a new internal `ConsensusBuildStructureV1` and adapt only the snapshot payload boundary.

### Choice state

The planner needs explicit branch resolution state:

```ts
export interface AdaptiveChoiceStateV1 {
  groupId: string;
  selectedItemId?: number;
  committedItemId?: number;
  committed: boolean;
  confidence: number;
}
```

This is reconstructed from the current inventory and previous plan, not stored as authoritative user state.

### Slot state

```ts
export interface AdaptiveSlotStateV1 {
  baseByType: Readonly<Record<InventorySlotType, number>>;
  unlockedFlexSlots?: number;
  usedFlexSlots: number;
  freeBaseByType: Readonly<Record<InventorySlotType, number>>;
  freeFlexSlots?: number;
  evidence: FactEvidence;
}
```

Unknown flex capacity must remain unknown. It must not silently become `maxFlexSlots`.

When capacity is unknown, purchase legality must be conservative for transitions that require flex capacity beyond known base slots. Existing legal inventory remains accepted even if telemetry cannot explain how its flex slots were unlocked.

### Investment state

```ts
export type AdaptiveInvestmentTypeV1 = 'weapon' | 'vitality' | 'spirit';

export interface AdaptiveInvestmentTrackStateV1 {
  type: AdaptiveInvestmentTypeV1;
  currentValue: number;
  achievedBreakpoint?: number;
  nextBreakpoint?: number;
  soulsToNextBreakpoint?: number;
}

export interface AdaptiveInvestmentStateV1 {
  tracks: Readonly<Record<AdaptiveInvestmentTypeV1, AdaptiveInvestmentTrackStateV1>>;
  evidence: FactEvidence;
}
```

The exact current-value calculation and breakpoint table are ruleset-aware domain behavior.

### Planner node

Replace `BeamNodeV1 { itemIds, score, confidenceSum }` with projected state:

```ts
export interface AdaptivePlannerNodeV1 {
  state: RecommendationDecisionState;
  slots: AdaptiveSlotStateV1;
  investment: AdaptiveInvestmentStateV1;
  choices: ReadonlyMap<string, AdaptiveChoiceStateV1>;
  completedGroupIds: ReadonlySet<string>;
  actions: readonly RecommendationAction[];
  utility: number;
  confidenceSum: number;
}
```

Implementation may use immutable plain structures optimized for deterministic cloning rather than constructing a full Nest service state object at each edge.

## Structured Consensus Derivation

### Preserve phase

`BuildSkeletonService` must stop dropping `StatlockerProBuildItemV1.phase`.

Normalize source phases into `EARLY`, `MID`, and `LATE`. Unexpected phase values must be rejected or explicitly mapped in the normalizer, not silently treated as arbitrary strings.

### Explicit choice semantics first

Before implementing inference, inspect actual raw `PRO_BUILD_ANALYSIS` payloads and preserve any explicit group/category/choice fields the endpoint already exposes.

If explicit semantics are present, they are authoritative unless structurally invalid.

Collector behavior is unchanged. Only the normalizer and structured consensus derivation change.

### Statistical choice inference fallback

When explicit choice semantics are absent, infer alternatives from the selected pro profiles.

Two items are candidates for the same CHOICE group only when all hard exclusions pass:

- same normalized phase,
- not the same item,
- neither is an upgrade ancestor or descendant of the other,
- neither is a required component of the other,
- neither is consistently purchased together with the other.

Inference features include:

- purchase coverage of A,
- purchase coverage of B,
- co-occurrence rate,
- mutual exclusivity rate,
- timing overlap,
- relative order similarity,
- optional relationship evidence when its semantics are known well enough to use as a weak feature.

The first implementation uses deterministic thresholds in config. It does not introduce clustering libraries.

Low-confidence ambiguous alternatives remain separate OPTIONAL candidates instead of being forced into a CHOICE group.

### Required groups

High-coverage, high-strength items that are not members of a choice group become REQUIRED single-item groups.

A REQUIRED group uses `minSelect=1`, `maxSelect=1`.

### Optional groups

Situational or low-coverage items not confidently classified as alternatives become OPTIONAL groups.

An OPTIONAL single-item group uses `minSelect=0`, `maxSelect=1`.

Optional groups are not appended automatically to the final build. They enter planning only when contextual value clears a configured activation threshold.

### Stable group IDs

Group IDs must be deterministic from hero, phase, type, and sorted candidate IDs so the previous plan can be rebased across repeated calls.

Example:

```text
MID:CHOICE:123,456
```

## Phase Eligibility

Introduce a focused `AdaptivePhaseEligibilityV1Service` or pure domain module.

Inputs:

- build structure,
- current game time,
- inventory,
- economy evidence,
- investment state,
- group completion state.

Outputs for each group:

```ts
export type AdaptiveGroupEligibilityV1 =
  | 'ELIGIBLE'
  | 'NOT_YET_ELIGIBLE'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'COMMITTED_OTHER_BRANCH';
```

### Phase progression

The first implementation uses deterministic rules configured per planner policy:

- EARLY groups are eligible immediately unless already completed.
- MID groups require either the configured soft time floor plus sufficient early progression, or strong rush evidence for that group.
- LATE groups require the configured late floor plus sufficient prior progression, or strong rush evidence.

`Sufficient progression` means required earlier groups are completed or explicitly skipped by a legal transition, not merely that time has passed.

Observed economy and investment state may advance a phase when the player is materially ahead of normal timing, but they never allow an arbitrary future item to bypass all structural prerequisites.

### Rush evidence

Rush evidence must derive from pro timing distributions or explicit Statlocker semantics.

A high contextual score is not rush evidence.

## Choice Resolution

Introduce a `AdaptiveChoiceResolverV1Service` or pure helper that ranks only the candidates inside one eligible CHOICE group.

For each alternative, calculate contextual utility from the existing scorer plus path-aware modifiers:

- structure prior,
- base WPA,
- exact enemy WPA,
- game-state WPA,
- timing fit,
- chain fit,
- investment utility,
- slot utility,
- transaction/churn effects.

`VS_HERO_WPA` is especially important here because the candidate set already represents valid alternatives for the same build role.

### Exact enemy aggregation

Reuse existing confidence shrinkage behavior. Aggregate over the actual enemy hero IDs, cap the number of dominant exact-match contributions using the existing config behavior, and preserve sample-size confidence.

### Switching before commitment

An uncommitted selected branch changes only when the new branch exceeds the old branch by `choiceSwitchMinImprovement`.

This provides local hysteresis independent from whole-plan hysteresis.

### Switching after commitment

Normal choice resolution cannot change a committed branch.

A different branch can only appear through SELL or REPLACE planning and must clear `committedChoiceReplaceMinImprovement`, which is stricter than normal switching.

## Choice Commitment Reconstruction

At every plan call, reconstruct commitment from current inventory and item graph.

For a CHOICE group:

1. If a candidate target item is owned, that candidate is committed.
2. Otherwise compute the component closure for each candidate.
3. Identify branch-unique components by subtracting components shared by two or more alternatives.
4. If a unique component of one branch is owned, that branch is committed.
5. If owned state ambiguously indicates multiple branches, preserve the previous committed branch when valid; otherwise mark the group as externally diverged and require explicit replace/sell reasoning rather than silently choosing.

This makes restart/replay behavior deterministic without storing mutable planner session state.

## Ruleset Economy Model

Introduce a ruleset-aware domain service or data object, for example `RecommendationEconomyRulesV1`.

It owns:

- base slots by category,
- maximum flex slots,
- current investment breakpoints,
- item contribution rules,
- upgrade contribution rules,
- sell contribution rules.

The source is tied to `rulesetId` and `catalogSha256`.

Prefer extracting exact values from imported catalog/reference data when represented there. If unavailable, keep a versioned ruleset config adjacent to catalog semantics and fail closed for an unknown ruleset rather than silently using stale constants.

## Dynamic Flex Slots

`AdaptiveDecisionStateV1Service` must expose the number of flex slots actually unlocked in the current match when that state is observable.

Implementation sequence:

1. Inspect existing `MinimalMatchState` and live telemetry fields for objective/flex information.
2. If a direct flex count exists, use it as OBSERVED.
3. If flex can be reconstructed deterministically from objective state, expose it as RECONSTRUCTED.
4. If neither is available, expose UNKNOWN.

Do not infer four unlocked flex slots from the ruleset maximum.

Candidate legality changes from fixed `maxFlexSlots` to state-aware capacity.

For UNKNOWN capacity:

- actions fitting base slots remain legal,
- actions requiring additional flex are blocked with a new explicit reason such as `FLEX_SLOT_CAPACITY_UNKNOWN`, unless the current observed inventory proves at least that much flex capacity is already in use.

## Investment Evaluation

Introduce pure functions that derive investment state from projected inventory under a specific ruleset.

Each legal transition recalculates investment state after inventory mutation.

For each action, calculate:

```text
before current value
before next breakpoint
before distance

after current value
after next breakpoint
after distance

breakpoints crossed
```

Investment utility is positive when a transition:

- crosses a breakpoint,
- substantially reduces distance to a near breakpoint at efficient soul cost,
- preserves a valuable achieved breakpoint during replacement.

Investment utility is negative when SELL/REPLACE unnecessarily drops an achieved breakpoint.

The scorer receives normalized investment components, but the underlying calculation uses actual projected state rather than static item metadata.

## Candidate Generation Changes

`generateRecommendationCandidates` remains the single legality engine for immediate and future transactions.

Required changes:

- accept dynamic slot capacity from state/rules rather than assuming all max flex slots are unlocked,
- expose an explicit result transition helper so the future planner can project the full resulting decision state,
- preserve upgrade component consumption,
- preserve sell refunds and returned items,
- preserve active item limits,
- add feasibility reasons for unknown dynamic capacity where necessary.

Do not duplicate these transition rules inside `AdaptiveBuildPlannerV1Service`.

The existing `RecommendationAction` union remains the canonical action representation.

## Stateful Future Search

### Search target restriction

Do not score the whole shop.

Build a target set from structured groups that are:

- eligible now,
- likely to become eligible within the configured planning horizon,
- committed continuations,
- contextually activated optional groups.

For CHOICE groups, include only the selected alternative after resolution, plus a replacement alternative only when explicit committed-branch replacement is being evaluated.

This should reduce the target universe to a small semantic set before action generation.

### Search edges

Each edge is a legal action generated by the canonical candidate generator.

Projected node state must be updated with:

- inventory,
- spendable souls when known,
- slot state,
- investment state,
- group completion,
- choice selection/commitment,
- action history.

### Search utility

Path utility is the discounted sum of action/target contextual utility plus completion bonuses and penalties.

Components include:

- contextual item score,
- required-group completion utility,
- choice utility,
- optional activation utility,
- investment utility,
- slot efficiency,
- future discount,
- sell/replace costs,
- churn/instability penalties.

A WAIT edge is retained when saving is better than taking a currently affordable but structurally poor transaction.

### Search depth and width

Current `planningDepth=3` and `beamWidth=8` are not assumed correct after the rewrite.

Keep them configurable and benchmark deterministic replay runtime. The initial implementation may start with the current values but the merge gate includes a runtime benchmark and adjusts them if required.

### Determinism

All candidate and node ordering must have deterministic tie-breakers. Replay output for identical state and evidence must be byte-stable where existing API serialization permits.

## Recommended Build and NEXT

The planner's source of truth becomes `planSteps`, a sequence of legal projected actions.

`NEXT` is derived from the first actionable target in `planSteps`, not from the first unowned item in a flat build array.

`recommendedBuild` remains the public linear representation expected by the existing API/UI, but is derived from:

1. currently owned relevant items,
2. selected targets represented by the legal plan steps,
3. future selected groups within the planning horizon.

It never appends every unselected skeleton candidate.

For an upgrade chain, Build Path may show the target item while `nextAction` points at the immediate component/upgrade step as required by the current UI contract. If the UI contract requires `NEXT` item and `nextAction.targetItemId` to be identical, then the build representation must instead expose transaction-step targets. This must be resolved by existing API tests before implementation finalization. The implementation must choose one consistent invariant and encode it in tests.

Preferred invariant for V1: `recommendedBuild.status === NEXT` refers to the immediate transaction target, so `NEXT` and `nextAction.targetItemId` match.

## Whole-plan Hysteresis

Retain whole-plan hysteresis, but apply it after structural validity.

A previous plan can be preserved only if:

- it is still structurally valid,
- its NEXT action remains legal or can validly WAIT for the same target,
- no committed-choice rule is violated,
- no phase rule is violated,
- the new plan improvement is below `minPlanSwitchImprovement`.

Never preserve a previous plan merely because its score is close if the previous plan is now illegal.

## Scorer Changes

Keep `AdaptiveEvidenceScorerV1Service` as the contextual scoring engine.

Structural correctness happens before scoring.

Existing components remain useful:

- skeleton/structure prior,
- base WPA,
- game-state fit,
- exact enemy fit,
- enemy composition,
- own build fit,
- timing fit,
- lane/post-lane fit,
- T4 chain fit,
- transaction penalty,
- churn penalty.

Add explicit components:

- `investmentUtility`,
- `slotEfficiency`,
- `groupCompletion`,
- `choiceSupport`.

Timing remains a continuous ranking component only among structurally eligible candidates.

## Configuration

Add policy configuration for:

- normalized phase aliases,
- early to mid eligibility floor,
- mid to late eligibility floor,
- progression requirements,
- rush evidence threshold,
- choice inference minimum coverage,
- choice inference maximum co-occurrence,
- timing overlap threshold,
- choice minimum confidence,
- uncommitted choice switch improvement,
- committed choice replacement improvement,
- optional group activation threshold,
- investment near-breakpoint window,
- investment breakpoint utility weight,
- investment preservation penalty,
- slot efficiency weight.

Existing score and hysteresis config remains.

All thresholds must be centralized in `statlocker-adaptive.config.ts`, not scattered through services.

## Snapshot Compatibility

`CONSENSUS_SKELETON` payload schema changes, so bump:

- schema version,
- normalizer/builder version.

Existing old snapshots must not be interpreted as the new structured payload.

On startup/refresh, if only an old skeleton exists, planner evidence should treat structured consensus as unavailable until the new skeleton is rebuilt from usable leaderboard and pro-build snapshots.

Do not silently convert the old flat skeleton to structured groups because it lacks enough information to reconstruct alternatives safely.

Other Statlocker dataset schemas remain backward compatible unless explicit group fields are added to `PRO_BUILD_ANALYSIS`. Any such addition is additive.

## Error Handling and Degradation

### Structured consensus unavailable

If no structured build can be derived because there are insufficient fresh pro profiles, planner behavior must degrade conservatively.

It may use immediate contextual recommendation candidates for already owned upgrade continuations and obvious legal actions, but it must not recreate the old global union behavior.

Preferred fallback:

- existing owned upgrade continuations,
- high-confidence hero WPA items constrained to EARLY-equivalent timing where timing is available,
- WAIT when structural confidence is insufficient.

### Dynamic flex unknown

Do not recommend a transaction that requires unproven extra flex capacity.

### Investment rules unknown

Set investment evidence UNKNOWN and omit investment utility. Do not block otherwise legal purchases solely because investment modeling is unavailable.

### Choice ambiguity

If multiple branches appear committed from externally diverged inventory, keep owned items, suppress automatic branch switching, and require explicit replacement economics for future divergence.

## Observability

Extend reason codes and planner diagnostics so every major structural decision is explainable.

Examples:

```text
PHASE_NOT_ELIGIBLE
PHASE_ELIGIBLE
RUSH_EVIDENCE
STRUCTURE_REQUIRED
STRUCTURE_CHOICE_SELECTED
STRUCTURE_OPTIONAL_ACTIVATED
CHOICE_SWITCH_HYSTERESIS
CHOICE_COMMITTED
CHOICE_COMMITTED_COMPONENT
INVESTMENT_BREAKPOINT
INVESTMENT_EFFICIENT
INVESTMENT_PRESERVED
COUNTER_OVERRIDES_INVESTMENT
FLEX_SLOT_CAPACITY_UNKNOWN
SLOT_EFFICIENT_UPGRADE
PLAN_STRUCTURALLY_INVALIDATED
```

Debug output should include the structured groups considered, selected alternatives, eligibility state, projected investment values, and legal action set without logging sensitive or unnecessary player data.

## Test Strategy

### Unit tests - build structure

Add deterministic tests for:

- phase preservation from pro profiles,
- required item classification,
- explicit CHOICE parsing when source fields exist,
- inferred `A OR B` from low co-occurrence with similar timing,
- no false choice for A and its upgrade,
- no false choice for commonly co-purchased A+B,
- ambiguous evidence becomes OPTIONAL,
- stable group IDs,
- no flat union tail.

### Unit tests - phase eligibility

Cases:

- empty inventory, minute 2, EARLY eligible,
- MID high-WPA item not eligible at minute 2,
- MID becomes eligible after progression/time,
- LATE blocked until prerequisites,
- explicit/strong rush evidence permits a specific future-phase group,
- high WPA alone never creates rush eligibility.

### Unit tests - choices

Cases:

- enemy roster makes A beat B,
- different roster makes B beat A,
- small score change does not switch before commitment,
- meaningful change switches before commitment,
- branch item ownership commits,
- unique component ownership commits,
- shared component does not commit,
- committed branch cannot silently switch,
- committed replacement requires explicit threshold.

### Unit tests - slots

Cases:

- base category slot overflow with zero flex is illegal,
- one unlocked flex makes exactly one overflow legal,
- unknown flex blocks purchases that require unknown extra capacity,
- existing overflow inventory is accepted as current state,
- upgrade consuming a component can free capacity,
- replace frees then consumes capacity legally.

### Unit tests - investment

Cases:

- action crosses a breakpoint,
- action moves near a breakpoint efficiently,
- weak item wins because it closes a valuable breakpoint,
- critical counter still overrides breakpoint preference,
- sell drops a breakpoint and receives preservation penalty,
- replacement preserving the breakpoint avoids the penalty.

### Planner unit tests

Cases:

- `remainingSkeleton` no longer exists,
- optional items are absent unless activated,
- only one member of a CHOICE appears in the selected path,
- all future edges are legal candidate actions,
- `NEXT` matches immediate planned transaction target,
- previous illegal plan is not preserved by hysteresis,
- WAIT is selected when saving is better than an inferior affordable action,
- deterministic output for identical input.

### Integration tests

Extend existing adaptive integration tests so the complete service flow validates:

- state -> evidence -> structure -> planner -> API result,
- structured snapshot freshness and schema mismatch behavior,
- rebuild after old skeleton schema,
- live dynamic flex propagation when observable,
- upgrade and replacement transitions.

### Replay regression tests

Required invariants over replay fixtures:

```text
illegalActionRate = 0
slotViolationRate = 0
hardPhaseViolationRate = 0
doubleChoiceRate = 0
unreachablePlanRate = 0
nextActionBuildMismatchRate = 0
postCommitBranchChurnRate = 0
```

Add golden fixtures for known failures, especially any preserved match where a clear mid-game item became the first purchase.

Replay checks must validate structural invariants, not whether the planner exactly copies the observed player's build.

## Performance Gate

The rewrite introduces stateful search, so add a deterministic planner benchmark over representative replay states.

Merge criteria:

- no unbounded candidate explosion,
- target set remains semantically restricted,
- p95 planner runtime remains suitable for the current live recommendation refresh cadence,
- memory remains bounded by configured beam width and planning depth.

Exact numeric runtime threshold should be derived from the existing recommendation refresh budget in the implementation plan, not invented in this design.

## Implementation Order

1. Add correctness regression tests for the existing known failures.
2. Add structured consensus types and schema versioning.
3. Preserve/normalize pro phase and inspect explicit source choice fields.
4. Rewrite consensus derivation into REQUIRED, CHOICE, OPTIONAL groups.
5. Add ruleset economy and dynamic slot state.
6. Add investment state derivation.
7. Add phase eligibility.
8. Add choice resolver and commitment reconstruction.
9. Extend canonical candidate generation for dynamic capacity/projected transitions.
10. Rewrite future search around legal actions and projected state.
11. Derive NEXT/recommendedBuild from plan steps and remove remaining skeleton append.
12. Adapt whole-plan hysteresis to structural validity.
13. Add scorer path components and tune only enough to satisfy structural behavior.
14. Extend integration/replay invariants.
15. Benchmark and tune search width/depth.
16. Run the full test suite and replay gate before merge.

## Main Files Expected To Change

```text
apps/api/src/statlocker-adaptive/
  statlocker-adaptive.types.ts
  statlocker-normalizer.service.ts
  build-skeleton.service.ts
  adaptive-decision-state-v1.service.ts
  adaptive-evidence-scorer-v1.service.ts
  adaptive-build-planner-v1.service.ts
  statlocker-adaptive.config.ts
  statlocker-evidence.service.ts
  statlocker-adaptive.module.ts

packages/deadlock-build-domain/src/
  recommendation-action-domain.ts
  recommendation-candidate-generator.ts
  recommendation-item-graph.ts
  index.ts

apps/api/test/
  adaptive-build-planner-v1.spec.ts
  adaptive-evidence-scorer-v1.spec.ts
  adaptive-decision-state-v1.spec.ts
  adaptive-policy-v1.integration.spec.ts
  adaptive-replay-v1.spec.ts
  new focused structure/choice/investment tests
```

`statlocker-browser-collector.service.ts` is intentionally not part of the first implementation unless raw payload inspection proves that explicit structure requires preserving fields currently discarded after collection. The endpoint set and browser collection mechanism stay unchanged.

## Merge Gate

The feature is complete only when all of the following are true:

1. No normal future-phase item can become the first purchase solely from WPA score.
2. No plan contains both sides of a one-of choice unless external inventory already diverged and the planner explicitly models replacement.
3. No plan assumes flex capacity that is not observed or reconstructed.
4. Investment breakpoints influence planning through projected state.
5. Every future transaction in the selected search path is legal according to the canonical candidate generator.
6. Optional items are never appended by default.
7. `remainingSkeleton` behavior is removed.
8. Choice commitment is deterministic across restart/replay.
9. Unit tests pass.
10. Integration tests pass.
11. Replay structural invariants pass with zero correctness violations.
12. Planner benchmark satisfies the live runtime budget.
13. Existing public API shape remains compatible unless an explicitly tested additive field is required.

## Rollback

Because V1 is rewritten in place, rollback is git/deployment rollback to the previous main commit. Do not maintain duplicate planner implementations solely for rollback.

The implementation branch must remain a single reviewable change set with tests proving the new correctness contract before merge.