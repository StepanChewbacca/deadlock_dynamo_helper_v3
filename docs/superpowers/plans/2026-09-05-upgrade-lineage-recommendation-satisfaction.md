# Upgrade Lineage Recommendation Satisfaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent already-satisfied lower-tier upgrade components from reappearing as BUY, targeted WAIT, replacement, NEXT, or PLANNED recommendations after an upgrade descendant is owned or projected.

**Architecture:** Make `RecommendationItemGraph` the single source of truth for transitive upgrade lineage and build-target satisfaction. Keep transaction legality (`feasible`) separate from recommendation policy eligibility, then make candidate generation and the structured stateful planner consume the same satisfaction invariant at current and projected inventory states. Runtime catalog compilation must preserve recipe topology even when exact upgrade transaction cost is unknown; topology is used for lineage/satisfaction only and must not fabricate an executable `UPGRADE_ITEM` action.

**Tech Stack:** TypeScript 5.9, Yarn 1 workspaces, Jest/ts-jest, NestJS, `@deadlock-live-probe/build-domain`, Statlocker Adaptive Planner V1.

**Spec:** `docs/superpowers/specs/2026-09-04-upgrade-lineage-recommendation-satisfaction-design.md`

## Execution Status - 2026-09-05

Implementation and regression coverage have been written on `agent/fix-upgrade-lineage-recommendations` and are tracked by draft PR #75. GitHub Actions currently fails before any workflow step executes, so none of the test/build commands below have fresh executable verification evidence yet. Do not mark RED/GREEN, full-suite, build, or CI steps complete until a working runner executes them.

Non-Actions work completed in the branch:

- Shared transitive lineage and satisfaction API.
- Separate `recommendationEligible` policy without changing Dataset V1 output.
- BUY/WAIT/REPLACE suppression for satisfied ancestors and lineage downgrades.
- Satisfaction-aware phase completion, choice reconstruction, target construction, projected state, and final build filtering.
- Runtime catalog topology preservation when upgrade transaction cost is unknown.
- Replay serialization/reconstruction of topology-only lineage.
- Focused domain, planner, replay, and real serving-boundary regression tests.
- Static scope review of the changed implementation.

The remaining executable verification commands and release gates are intentionally left unchecked in the task sections below.

## Global Constraints

- Exact inventory must remain exact; consumed components must not be reinserted into inventory snapshots.
- `RecommendationCandidate.feasible` remains deterministic transaction/game legality.
- Recommendation suppression must be represented separately through `recommendationEligible` and `recommendationSuppressionReasons`.
- `RecommendationDatasetCandidateV1` and `toRecommendationDatasetCandidateV1()` remain unchanged by this fix.
- A target is satisfied when it is exactly owned or is a transitive component ancestor of any owned item.
- Recipe topology may be known while upgrade transaction cost is unknown; this topology must remain available for lineage satisfaction but must not create an executable upgrade transaction.
- No item-name, hero-specific, or Warden-specific production logic is allowed.
- A normal replacement must not downgrade an owned descendant into an ancestor component.
- Projected planner inventory must recompute the same satisfaction semantics after every legal transition.
- Model weights, Behavioral/Value training, FUTURE_TEST, randomized traffic, and production rollout are out of scope.
- All code comments added by this work must be in English.

---

## Implemented File Structure

### Build domain

- `packages/deadlock-build-domain/src/recommendation-item-graph.ts`
  - Owns direct and transitive recipe lineage, target satisfaction, satisfying-owner lookup, and topology-only lineage edges.
- `packages/deadlock-build-domain/src/recommendation-ruleset-catalog.ts`
  - Keeps catalog recipe topology separate from executable upgrade transaction mechanics.
- `packages/deadlock-build-domain/src/recommendation-action-domain.ts`
  - Owns recommendation suppression reason types and candidate-level eligibility fields. Historical Dataset V1 stays untouched.
- `packages/deadlock-build-domain/src/recommendation-candidate-generator.ts`
  - Evaluates transaction feasibility as before, then marks redundant lineage actions recommendation-ineligible and omits invalid targeted waits.
- `packages/deadlock-build-domain/test/recommendation-item-graph.spec.ts`
  - Lineage/satisfaction contract tests.
- `packages/deadlock-build-domain/test/recommendation-ruleset-catalog.spec.ts`
  - Topology-only catalog compilation tests.
- `packages/deadlock-build-domain/test/recommendation-candidate-generator.spec.ts`
  - Candidate-level regressions for BUY, WAIT, REPLACE, transitive lineage, and unaffected unrelated actions.

### Adaptive planner and replay

- `apps/api/src/statlocker-adaptive/adaptive-choice-resolver-v1.service.ts`
  - Reuses shared graph closure instead of maintaining an independent transitive definition.
- `apps/api/src/statlocker-adaptive/adaptive-phase-eligibility-v1.service.ts`
  - Makes group completion use shared target satisfaction.
- `apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts`
  - Uses satisfaction-aware completion/counting/target construction, filters recommendation-ineligible candidates, and excludes satisfied targets at current and projected nodes.
- `apps/api/src/statlocker-adaptive/adaptive-planner-transition-v1.ts`
  - Recomputes projected completed groups through shared satisfaction semantics.
- `apps/api/src/statlocker-adaptive/adaptive-replay-v1.service.ts`
  - Persists and reconstructs topology-only lineage in replay input while remaining backward-compatible with old inputs.
- `apps/api/test/adaptive-phase-eligibility-v1.spec.ts`
  - Phase completion regression.
- `apps/api/test/adaptive-upgrade-lineage-v1.spec.ts`
  - Planner/current/projected lineage regressions.
- `apps/api/test/adaptive-upgrade-lineage-serving.integration.spec.ts`
  - Real decision-state/catalog-serving boundary regression using DB recipe topology without verified upgrade cost.
- `apps/api/test/adaptive-replay-upgrade-lineage-v1.spec.ts`
  - Replay topology/satisfaction regression.

---

## Verification Roadmap

The implementation is written, but the following commands are still required before the fix can be called verified.

### Task 1: Focused build-domain verification

- [ ] Run lineage graph tests:

```bash
yarn workspace @deadlock-live-probe/build-domain test --runTestsByPath test/recommendation-item-graph.spec.ts
```

- [ ] Run catalog topology tests:

```bash
yarn workspace @deadlock-live-probe/build-domain test --runTestsByPath test/recommendation-ruleset-catalog.spec.ts
```

- [ ] Run candidate suppression tests:

```bash
yarn workspace @deadlock-live-probe/build-domain test --runTestsByPath test/recommendation-candidate-generator.spec.ts
```

- [ ] Confirm `RecommendationDatasetCandidateV1` remains unchanged through the existing dataset suite:

```bash
yarn workspace @deadlock-live-probe/build-domain test --runTestsByPath test/recommendation-dataset-v8.spec.ts
```

### Task 2: Focused adaptive verification

- [ ] Run phase completion regression:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-phase-eligibility-v1.spec.ts
```

- [ ] Run planner lineage regressions:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-upgrade-lineage-v1.spec.ts
```

- [ ] Run real serving-boundary topology regression:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-upgrade-lineage-serving.integration.spec.ts
```

- [ ] Run replay topology regression:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-replay-upgrade-lineage-v1.spec.ts
```

### Task 3: Broad regression verification

- [ ] Run full build-domain suite:

```bash
yarn workspace @deadlock-live-probe/build-domain test
```

- [ ] Run full API suite:

```bash
yarn workspace @deadlock-live-probe/api test
```

- [ ] Run serving-boundary audit:

```bash
node scripts/statlocker-adaptive-serving-audit.mjs
```

- [ ] Run structured replay release gate:

```bash
yarn workspace @deadlock-live-probe/api test adaptive-replay-structured-v1.spec.ts
```

- [ ] Run workspace build:

```bash
yarn build
```

- [ ] Run all workspace tests:

```bash
yarn test
```

### Task 4: Real-data incident verification

- [ ] Query the production/current catalog rows for the exact High-Velocity Rounds and Opening Rounds item IDs.
- [ ] Confirm a recipe edge exists with Opening Rounds as parent and High-Velocity Rounds as component in the catalog version used by the affected match.
- [ ] If that edge is absent, fix the catalog importer/source data separately; planner logic cannot infer a missing deterministic recipe edge.
- [ ] Capture or reconstruct the affected inventory snapshot with Opening Rounds owned and replay it through the fixed branch.
- [ ] Assert High-Velocity Rounds is absent from actionable BUY, targeted WAIT, NEXT, and PLANNED outputs.

### Task 5: CI and release gates

- [ ] Re-run PR #75 once GitHub Actions can execute steps.
- [ ] Require Build project, Build Overwolf client, Run tests, and Validate production runtime to execute normally and pass.
- [ ] Review any failure through systematic debugging: one failing boundary, one hypothesis, one minimal change, focused rerun first.
- [ ] Run repository security/GitGuardian checks that normally apply to the PR.
- [ ] Record the exact verified PR head SHA.
- [ ] Only after fresh executable evidence, invoke the finishing-a-development-branch flow and decide merge/deploy.
