# Strategy-First Build Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace item-soup recommendation planning with a coherent strategy-first planner that selects one build archetype, tracks explicit strategic goals, guarantees slot/investment/upgrade feasibility, resolves situational deviations for explicit reasons, and derives `NEXT` only as the first legal transaction of a coherent plan.

**Architecture:** Offline match-level purchase trajectories are normalized and clustered into coherent build archetypes. Each archetype compiles into a versioned `BuildStrategySpec`; live serving chooses and commits to one strategy, instantiates a `BuildContract`, resolves the current strategic goal, filters to exact legal transactions, scores only goal-relevant actions, and performs a short receding-horizon search. Exact inventory, item lineage, slot rules, investment rules, and action legality remain deterministic and outside ML/statistical scoring.

**Tech Stack:** TypeScript 5.9, NestJS, Yarn workspaces, Jest/ts-jest, PostgreSQL/TypeORM, `@deadlock-live-probe/build-domain`, existing Statlocker adaptive evidence/replay infrastructure.

**Source of truth:** This file supersedes `ConsensusSkeleton`-first planning as the target architecture. Existing lineage/candidate-generator fixes merged in PR #75 remain mandatory invariants.

## Current failure model

The current planner can produce locally plausible actions without understanding a globally coherent build. The root problem is not a single score weight:

- multiple pro-player/profile builds are aggregated into one `ConsensusSkeleton`;
- `REQUIRED/CHOICE/OPTIONAL` groups do not encode one global archetype, item lifecycle, slot reservation, terminal build state, or strategic rationale;
- `HOLD` can occur while the global build is still incomplete without a first-class representation of that fact;
- full inventory can still leave future targets in a plan without an explicit upgrade/sell/replace/flex transition;
- investment exists mostly as a local score adjustment rather than a strategy objective;
- situational items are not first-class windows with an explicit threat/purpose and core-interruption budget;
- the scorer can influence global direction too early instead of choosing between legal ways to advance an already-selected strategy.

## Non-negotiable invariants

- Exact inventory remains exact. Consumed components are never reinserted into inventory.
- `RecommendationItemGraph` remains the single source of transitive component/upgrade satisfaction.
- `RecommendationCandidate.feasible` means deterministic transaction/game legality.
- `recommendationEligible` means deterministic recommendation policy eligibility and must not silently redefine legality.
- The strategy layer may filter/rank legal actions but may never synthesize a transaction that the candidate generator cannot produce.
- A strategy is selected before an item; a goal is selected before a transaction; legality is resolved before scoring.
- `HOLD` and `WAIT` do not imply `BuildStatus.COMPLETE`.
- A build is complete only when all hard obligations are satisfied/waived and no mandatory reachable goal remains.
- A full inventory may contain a future new-item goal only if the plan contains an explicit legal exit/slot path before that purchase.
- Situational recommendations require an explicit situational window and a concrete purpose/evidence record.
- No hero-name or item-name production special cases.
- Outcome/win is not used as a clustering feature for defining archetypes; it may evaluate archetypes after discovery.
- Current `ConsensusSkeleton` may remain as fallback/evidence during migration but ceases to be global plan source of truth.
- Dataset/training/BuildLM work does not get permission to implement slot, recipe, branch, or completion semantics.

---

# Target runtime contracts

## `BuildStrategySpecV1`

Immutable, versioned, offline-produced strategy definition.

```ts
export type BuildGoalTypeV1 =
  | 'CORE'
  | 'POWER_SPIKE'
  | 'UPGRADE'
  | 'BRANCH'
  | 'INVESTMENT'
  | 'SITUATIONAL_RESERVATION'
  | 'TERMINAL';

export type BuildItemLifecycleV1 =
  | 'PERMANENT_CORE'
  | 'UPGRADE_COMPONENT'
  | 'TEMPORARY_EARLY'
  | 'SITUATIONAL'
  | 'REPLACEMENT_TARGET';

export interface BuildStrategyGoalV1 {
  goalId: string;
  type: BuildGoalTypeV1;
  phase: 'EARLY' | 'MID' | 'LATE';
  targetItemIds: readonly number[];
  minSelect: number;
  maxSelect: number;
  prerequisiteGoalIds: readonly string[];
  hard: boolean;
  lifecycleByItemId: Readonly<Record<number, BuildItemLifecycleV1>>;
  rationaleCodes: readonly string[];
}

export interface BuildStrategySpecV1 {
  schemaVersion: 1;
  strategyId: string;
  heroId: number;
  rulesetId: string;
  sourcePatchId: string;
  support: number;
  stability: number;
  representativeTraceId: string;
  goals: readonly BuildStrategyGoalV1[];
  branchGroups: readonly BuildStrategyBranchGroupV1[];
  situationalWindows: readonly BuildSituationalWindowV1[];
  investmentPolicy: BuildInvestmentPolicyV1;
  slotPolicy: BuildSlotPolicyV1;
  terminalPolicy: BuildTerminalPolicyV1;
}
```

## `BuildContractV1`

Live mutable semantic state derived from one `BuildStrategySpecV1` and the current exact decision state.

```ts
export type BuildGoalStateV1 =
  | 'LOCKED'
  | 'READY'
  | 'ACTIVE'
  | 'SATISFIED'
  | 'SKIPPED'
  | 'WAIVED'
  | 'BLOCKED';

export type BuildStatusV1 =
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'COMPLETE'
  | 'REPLAN_REQUIRED'
  | 'OUT_OF_DISTRIBUTION';

export interface BuildContractV1 {
  strategyId: string;
  status: BuildStatusV1;
  commitment: 'PROVISIONAL' | 'COMMITTED' | 'DIVERGED' | 'OOD';
  currentGoalId?: string;
  goalStates: Readonly<Record<string, BuildGoalStateV1>>;
  selectedBranches: Readonly<Record<string, string>>;
  committedBranches: Readonly<Record<string, string>>;
  temporaryItemIds: readonly number[];
  reservedSituationalWindowIds: readonly string[];
  activeSituationalDecision?: BuildSituationalDecisionV1;
  remainingHardGoalIds: readonly string[];
  completionReasonCodes: readonly string[];
}
```

## Planner output

The output contract must expose strategy state instead of forcing the UI to infer it from candidate rankings.

```ts
export interface AdaptiveStrategyPlanV1 {
  strategyId: string;
  buildStatus: BuildStatusV1;
  progress: {
    satisfiedHardGoals: number;
    totalHardGoals: number;
  };
  currentGoal?: {
    goalId: string;
    type: BuildGoalTypeV1;
    reasonCodes: readonly string[];
  };
  remainingGoalIds: readonly string[];
  slotPlan: BuildSlotPlanV1;
  investmentPlan: BuildInvestmentPlanV1;
  situationalDecision?: BuildSituationalDecisionV1;
}
```

---

# Phase 0 - Exact ruleset economy and resource state

**Purpose:** The strategic planner cannot reason correctly if slot/flex/investment mechanics are approximated.

### Task 0.1 - Versioned slot rules

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-economy-v1.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-decision-state-v1.service.ts`
- Test: `apps/api/test/adaptive-economy-v1.spec.ts`

- [ ] Replace universal slot assumptions with a versioned ruleset slot registry keyed by `rulesetId + catalogSha256`.
- [ ] Represent base capacity per category, maximum flex, active-item capacity, and evidence.
- [ ] Dynamic current `unlockedFlex` must be part of decision state; unknown remains explicit and conservative.
- [ ] Tests prove identical inventory has different legal capacity under different unlocked-flex states.

### Task 0.2 - Versioned investment rules

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-economy-v1.ts`
- Test: `apps/api/test/adaptive-economy-v1.spec.ts`
- Test: `apps/api/test/adaptive-planner-transition-v1.spec.ts`

- [ ] Register verified breakpoint rules by ruleset/catalog SHA.
- [ ] Compute BUY/UPGRADE/SELL/REPLACE investment transitions from exact projected inventory.
- [ ] Never infer authoritative investment mechanics when the ruleset contract is unknown.
- [ ] Tests cover breakpoint crossing, upgrade component consumption, sale, and replacement.

**Exit:** exact/current or explicitly UNKNOWN slot and investment state; no hidden universal assumptions.

---

# Phase 1 - Planner trajectory dataset

**Purpose:** Global build discovery must operate on match-level ordered trajectories, not aggregate-of-aggregate profile item statistics.

### Task 1.1 - Trajectory contracts

**Files:**
- Create: `apps/api/src/statlocker-adaptive/planner-trajectory-v2.ts`
- Modify: `apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts`
- Test: `apps/api/test/planner-trajectory-v2.spec.ts`

`PlannerTrajectoryV2` stores one player-match trace with ordered canonical BUY/UPGRADE/SELL/REPLACE transactions, exact inventory before/after, slot state, investment vector, game time, patch/ruleset/catalog, draft context, and stable trace identity.

- [ ] Define deterministic schema/version and stable hash.
- [ ] Normalize upgrade-family identity through `RecommendationItemGraph` without losing exact transaction IDs.
- [ ] Do not store final outcome as a clustering feature.

### Task 1.2 - Historical trajectory builder

**Files:**
- Create: `apps/api/src/statlocker-adaptive/planner-trajectory-builder-v2.service.ts`
- Modify: appropriate module/provider registration under `apps/api/src/statlocker-adaptive/`
- Test: `apps/api/test/planner-trajectory-builder-v2.spec.ts`

- [ ] Build ordered player-match transactions from existing historical purchase/timeline data.
- [ ] Replay every step through deterministic inventory/action transition code.
- [ ] Fail closed when exact transaction semantics cannot be reconstructed; record an explicit diagnostic instead of inventing state.

**Exit:** every accepted trajectory replays transaction-by-transaction to the recorded exact final inventory.

---

# Phase 2 - Archetype mining

**Purpose:** Discover coherent build strategies before mining local groups.

### Task 2.1 - Deterministic trajectory representation

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-archetype-features-v1.ts`
- Test: `apps/api/test/build-archetype-features-v1.spec.ts`

Feature families:
- weighted early/core upgrade-family presence;
- ordered sequence/subsequence representation;
- purchase timing distribution;
- investment trajectory;
- final slot/category shape;
- upgrade/branch compatibility.

Late luxury/situational events receive lower clustering weight than early/core commitments.

### Task 2.2 - Archetype clustering lab

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-archetype-miner-v1.service.ts`
- Create: `apps/api/src/statlocker-adaptive/build-archetype.types.ts`
- Test: `apps/api/test/build-archetype-miner-v1.spec.ts`

- [ ] Implement a deterministic in-repo clustering baseline suitable for CI (distance matrix + agglomerative/medoid clustering).
- [ ] Keep the interface open for an offline HDBSCAN research implementation without making Python/HDBSCAN a runtime dependency.
- [ ] Produce cluster support, medoid/representative trace, within-cluster coherence, between-cluster separation, outlier/noise share, and bootstrap-like stability diagnostics.
- [ ] Reject clusters that are explained only by late luxury/outcome state rather than coherent build progression.

**Exit:** test heroes can produce multiple coherent archetypes; noise is explicit rather than merged into a synthetic average build.

---

# Phase 3 - Compile `BuildStrategySpecV1`

**Purpose:** Convert one archetype into a replayable strategy graph.

### Task 3.1 - Strategy domain types and validator

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-strategy-v1.ts`
- Create: `apps/api/src/statlocker-adaptive/build-strategy-validator-v1.service.ts`
- Test: `apps/api/test/build-strategy-validator-v1.spec.ts`

- [ ] Define goals, branch groups, lifecycle roles, situational windows, investment policy, slot policy, terminal policy.
- [ ] Validate unique IDs, acyclic goal prerequisites, branch bounds, item references, and strategy/ruleset compatibility.

### Task 3.2 - Strategy compiler

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-strategy-compiler-v1.service.ts`
- Test: `apps/api/test/build-strategy-compiler-v1.spec.ts`

Infer within a single archetype only:
- ordered core goals;
- XOR/choice branches;
- optional/soft goals;
- upgrade lifecycle;
- temporary early items;
- candidate situational insertion windows.

Explicit source semantics, when present, win over statistical inference. Upgrade parent/component is never interpreted as XOR.

**Exit:** compiler can represent `A -> B -> choose one of C/D -> E`, temporary exits, and situational reservations without flattening to `[A,B,C,D,E]`.

---

# Phase 4 - Offline strategy feasibility

**Purpose:** Never publish a strategy whose mandatory path is transactionally impossible.

### Task 4.1 - Strategy feasibility search

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-strategy-feasibility-v1.service.ts`
- Reuse: `packages/deadlock-build-domain/src/recommendation-candidate-generator.ts`
- Test: `apps/api/test/build-strategy-feasibility-v1.spec.ts`

- [ ] Bounded state search over BUY/UPGRADE/SELL/REPLACE/WAIT transitions.
- [ ] Verify branch consistency, slot capacity, active-item limit, upgrade lineage, and hard investment objectives.
- [ ] Produce counterexample diagnostics for infeasible specs.

**Exit:** `strategyFeasibilityRate = 100%` for published strategies.

---

# Phase 5 - Live strategy selection and commitment

### Task 5.1 - Strategy selector

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-strategy-selector-v1.service.ts`
- Test: `apps/api/test/build-strategy-selector-v1.spec.ts`

Input:
- hero/ruleset;
- ally/enemy draft context when available;
- current purchase prefix and timing;
- current investment direction.

Output:
- posterior/confidence for each strategy;
- selected strategy;
- `PROVISIONAL | COMMITTED | DIVERGED | OOD`.

A purchase prefix characteristic of one archetype may commit the strategy. Small score fluctuations may not.

### Task 5.2 - Persistent strategy session

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-strategy-session-v1.service.ts`
- Test: `apps/api/test/build-strategy-session-v1.spec.ts`

- [ ] Reconstruct session from current inventory + previous recommendation result.
- [ ] Add switch hysteresis and explicit replan reasons.
- [ ] If no strategy has acceptable conformance, mark OOD and rebase to the nearest feasible strategy without merging multiple archetypes.

**Exit:** accidental purchases do not oscillate strategy; strong branch evidence commits predictably.

---

# Phase 6 - `BuildContractV1` and explicit completion

### Task 6.1 - Build contract resolver

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-contract-v1.service.ts`
- Test: `apps/api/test/build-contract-v1.spec.ts`

- [ ] Derive goal states from exact inventory and shared item-lineage satisfaction.
- [ ] Resolve prerequisites, selected/committed branches, temporary item lifecycle, situational reservations, and hard remaining obligations.
- [ ] Select a current goal independently from the eventual transaction.

### Task 6.2 - Formal completion/status

A contract is `COMPLETE` only if:
- all hard core goals are satisfied;
- all committed branch obligations are satisfied;
- all hard upgrade goals are satisfied;
- hard investment objectives are satisfied or explicitly waived;
- active situational obligations are resolved;
- required slot transitions are resolved;
- no mandatory reachable goal remains.

`HOLD` with remaining goals yields `WAITING` or `IN_PROGRESS`, never `COMPLETE`.

**Exit:** regression for "build incomplete + HOLD" passes.

---

# Phase 7 - Slot-aware global path

### Task 7.1 - Future slot plan

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-slot-planner-v1.service.ts`
- Test: `apps/api/test/build-slot-planner-v1.spec.ts`

- [ ] Compute per-category capacity, unlocked flex, current minimum flex requirement, active-item capacity, reservations, and future pressure.
- [ ] Future goals may be `LOCKED_BY_FLEX_REQUIREMENT`.
- [ ] When full, a future new-item goal must name one preceding transition: upgrade compression, sell temporary item, replacement, or flex prerequisite.
- [ ] No explicit path means `REPLAN_REQUIRED`, not speculative BUY.

**Exit:** `plannedOverCapacityRate = 0` over golden replays.

---

# Phase 8 - Strategic investment policy

### Task 8.1 - Investment goal resolver

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-investment-policy-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-evidence-scorer-v1.service.ts`
- Test: `apps/api/test/build-investment-policy-v1.spec.ts`

- [ ] Learn/compile preferred investment distributions by strategy milestone from archetype traces.
- [ ] Represent hard minimum objectives separately from soft concentration preferences.
- [ ] Local score bonus remains a secondary tie-breaker; the strategic goal is first-class.
- [ ] Strategy may intentionally not chase the next breakpoint.

**Exit:** explanation can state `CLOSES_CURRENT_WEAPON_INVESTMENT_OBJECTIVE`; a non-required later breakpoint is not forced.

---

# Phase 9 - Situational windows

### Task 9.1 - Situational resolver

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-situational-resolver-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-decision-state-v1.service.ts`
- Test: `apps/api/test/build-situational-resolver-v1.spec.ts`

Runtime inputs:
- enemy hero IDs/items;
- ally hero IDs/items where available;
- game state;
- local vulnerability/state;
- exact enemy/statistical evidence;
- reserved situational window budget.

Output includes:
- purpose/threat code;
- implicated enemy heroes/items;
- statistical support and confidence;
- strategy compatibility;
- slot impact;
- investment impact;
- core interruption cost.

Candidate must beat `CONTINUE_CORE` by the configured window threshold. Without an explicit trigger the reservation remains unused.

**Exit:** no unexplained situational recommendation.

---

# Phase 10 - Runtime context V2

### Task 10.1 - Context enrichment

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/adaptive-decision-state-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-evidence-scorer-v1.service.ts`
- Test: `apps/api/test/adaptive-decision-state-v1.spec.ts`

Add directly observed/derived-with-evidence:
- ally hero IDs;
- ally/enemy item IDs;
- objective/flex state when available;
- exact category slot state;
- active-item usage;
- strategy session.

Actually populate `ownBuildArchetype` and `enemyCompositionKey` scorer context rather than leaving the components structurally present but inactive.

---

# Phase 11 - Strategy-aware receding-horizon planner

### Task 11.1 - Replace global item search universe

**Files:**
- Modify/split: `apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts`
- Test: `apps/api/test/adaptive-build-planner-v1.spec.ts`
- Test: `apps/api/test/adaptive-upgrade-lineage-v1.spec.ts`

Search only legal actions relevant to active/near-future strategy goals.

Planner node semantic state:
- exact decision state/inventory/wallet;
- exact projected slots;
- investment state;
- strategy ID/stage;
- goal states;
- branch commitments;
- situational state;
- legal actions;
- strategic/contextual utility.

Receding horizon is 2-5 real transactions; only the first is returned as `NEXT`.

Evaluation rewards:
- hard goal progress;
- contextual action value;
- investment alignment;
- slot headroom/future feasibility.

Penalties:
- strategy deviation;
- core interruption;
- churn;
- unresolved hard obligations;
- future infeasibility.

### Task 11.2 - Remove `remainingSkeleton` semantics

- [ ] Final build rows come only from exact owned items plus selected reachable strategy path.
- [ ] Unselected optional items are absent.
- [ ] Losing branch alternatives are absent.
- [ ] Untriggered situational items are absent.
- [ ] Satisfied consumed ancestors remain omitted from actionable rows.

**Exit:** `NEXT` is the first legal transaction of a coherent path and final plan contains no synthetic skeleton tail.

---

# Phase 12 - Migration away from `ConsensusSkeleton`

### Task 12.1 - Compatibility/fallback adapter

**Files:**
- Create: `apps/api/src/statlocker-adaptive/consensus-strategy-fallback-v1.service.ts`
- Modify: evidence-loading/planner integration as required
- Test: `apps/api/test/consensus-strategy-fallback-v1.spec.ts`

During migration only, `ConsensusSkeleton` may compile into one low-confidence fallback strategy. It must not be merged with discovered archetypes or treated as equivalent evidence.

### Task 12.2 - Serving source-of-truth switch

Once strategy replay gates pass:
- primary = `BuildStrategySpecV1`;
- consensus = fallback/evidence prior only;
- legacy synthetic future-pool semantics removed.

---

# Phase 13 - Output contract and overlay semantics

### Task 13.1 - Shared output types

**Files:**
- Modify: shared adaptive recommendation types under `packages/shared/src/`
- Modify: API presentation mapping
- Test: API/shared compatibility tests

Return:
- strategy identity;
- build status/progress;
- current goal and why;
- next transaction;
- remaining hard goals;
- slot plan;
- investment plan;
- situational decision/purpose.

`rankedImmediateCandidates` remains diagnostic and must not automatically become user-facing `Also viable`.

### Task 13.2 - Overwolf rendering

**Files:**
- Modify: relevant Overwolf recommendation presentation/components
- Test: Overwolf Jest tests

UI truth model:

```text
BUILD       selected strategy
STATUS      In progress / Waiting / Complete / Replan required
CURRENT     strategic goal
NEXT        first legal transaction
WHY         strategy + context + slot/investment/situational reasons
SLOTS       current/reserved/flex state
REMAINING   semantic obligations, not random candidates
```

---

# Phase 14 - Golden replay and property gates

### Required golden fixtures

1. build incomplete + HOLD;
2. full slots + remaining core;
3. full slots + legal upgrade;
4. full slots + replacement;
5. future item waits for flex;
6. consumed component already satisfied by upgrade descendant;
7. archetype A/B share early items;
8. branch commitment;
9. player diverges from selected strategy;
10. no strategy fits -> OOD;
11. urgent situational counter interrupts core;
12. weak situational signal -> continue core;
13. investment objective beats minor optional item;
14. strategy intentionally ignores later breakpoint;
15. temporary item exits at planned slot pressure.

### Hard release metrics

```text
illegalActionRate = 0
slotViolationRate = 0
unreachablePlanRate = 0
redundantAncestorRate = 0
falseBuildCompleteRate = 0
mandatoryGoalLostRate = 0
branchContradictionRate = 0
archetypeUnexpectedSwitchRate = 0
coreWithoutExitSlotRate = 0
unexplainedSituationalRate = 0
nextActionBuildMismatchRate = 0
```

---

# Phase 15 - Shadow strategy planner and promotion

Before user-facing cutover, run the strategy-first planner in shadow against the existing safe output path and log:
- strategy/posterior stability;
- build status;
- current goal;
- full reachable plan;
- next transaction;
- reason tree;
- slot violations;
- strategy switching;
- core interruption;
- situational frequency;
- HOLD while incomplete;
- completion detection.

Promotion requires the hard release metrics above to remain zero and no serving regression.

---

# BuildLM boundary

BuildLM is deliberately later. It may eventually improve:
- strategy posterior selection;
- trace/context representation;
- local action/value scoring.

It may not decide:
- whether a slot exists;
- whether a recipe is legal;
- whether a lower component is already satisfied by an upgrade;
- whether a branch is committed;
- whether a hard goal is complete;
- whether the build is `COMPLETE`.

Those remain explicit deterministic planner state.

---

# Execution order

1. Phase 0 exact rules/resources.
2. Phase 1 trajectory dataset.
3. Phase 2 archetype miner.
4. Phase 3 strategy compiler.
5. Phase 4 feasibility validator.
6. Phase 5 selector/session.
7. Phase 6 BuildContract/completion.
8. Phase 7 slot plan.
9. Phase 8 investment policy.
10. Phase 9 situational windows.
11. Phase 10 context V2.
12. Phase 11 strategy-aware planner.
13. Phase 12 source-of-truth migration.
14. Phase 13 API/UI contract.
15. Phase 14 replay/property gates.
16. Phase 15 shadow/promotion.

## Implementation policy

- TDD for every behavior change: failing regression first, then minimal implementation, then refactor.
- No implementation directly on `main`.
- Every published strategy/spec is immutable and versioned.
- No tuning of current item score weights is accepted as a substitute for a missing semantic/feasibility contract.
- Every new UNKNOWN evidence state remains explicit; fail closed where correctness depends on it.
- All production code comments are English.
- `ConsensusSkeleton` retirement happens only after replay parity, never by deleting the fallback first.
