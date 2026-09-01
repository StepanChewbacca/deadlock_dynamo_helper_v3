# Statlocker Adaptive Policy V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the primary live recommendation serving path with a deterministic Statlocker-driven adaptive build planner that returns a full current build plan plus an immediate legal action, while keeping ML8 source code in the repository but out of the serving flow.

**Architecture:** Add a standalone `statlocker-adaptive` subsystem. It reads current match state directly from the existing live GEP state and catalog/ruleset storage, uses the existing build-domain candidate generator as the only authority for immediate transaction legality, reads versioned Statlocker evidence from local cache/PostgreSQL, builds top-10 consensus skeletons, scores contextual evidence, searches a short future target trajectory, applies hysteresis and strong sell penalties, persists replayable decisions, and serves one adaptive response to the Overwolf client. ML8 runtime services and V8 recommendation telemetry are not dependencies of this serving path. Chromium runs only in background refresh work and is never awaited by a recommendation request.

**Tech Stack:** TypeScript 5.9, NestJS 11, TypeORM/PostgreSQL, `@nestjs/schedule`, Puppeteer Core + system Chromium, Jest/ts-jest, existing `@deadlock-live-probe/build-domain`, Overwolf GEP client, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-31-statlocker-adaptive-policy-v1-design.md`

## Global Constraints

- ML8 Behavioral, Value, Policy, model serving, `RecommendationEngineV8Service`, and `RecommendationRealtimeCoordinatorV8Service` must not be called by the new primary recommendation endpoint.
- Do not delete ML8 source files, training workflows, registries, or offline evaluation code in this implementation.
- The adaptive serving path must not depend on V8 recommendation telemetry rows being present.
- Statlocker is evidence only. It never changes affordability, recipe, slot, shop, ruleset, or transaction legality.
- Chromium is background-only. A recommendation request uses memory/PostgreSQL evidence and never opens or waits for a browser.
- Do not inspect, return, log, or persist browser cookies, request headers, local storage, API keys, tokens, or session material.
- If Statlocker returns 401, 403, a login wall, CAPTCHA, or another access restriction, record collection failure and keep the previous valid snapshot. Do not attempt a bypass.
- Current-match Statlocker endpoints are excluded from live V1.
- Every score component is bounded before weighting. Raw WPA, sample counts, purchase seconds, and probabilities are never directly added together.
- Same live state + same previous plan + same evidence snapshot IDs + same config version must produce the same result.
- Failed collection never replaces the last known good snapshot.
- Patch-mismatched evidence never silently counts as current evidence.
- Roster total souls are used for team-state classification only. They are not automatically treated as verified spendable wallet currency.
- Immediate actions must come from the current deterministic `generateRecommendationCandidates()` result. Future build steps are target items, not claims that those items are currently affordable or immediately legal to buy.
- Use existing project style: strict TypeScript, English code comments, no new `| null` return-type signatures.

---

## File Map

### Shared contracts

- Create `packages/shared/src/adaptive-recommendation-v1.ts` - public request/response, action, plan, score, freshness, and provenance contracts.
- Modify `packages/shared/src/index.ts` - export the V1 contract.
- Create `packages/shared/test/adaptive-recommendation-v1.test.js` - runtime contract checks.
- Modify `packages/shared/package.json` - append the contract test to the explicit shared test chain.

### API adaptive subsystem

Create `apps/api/src/statlocker-adaptive/`:

- `statlocker-adaptive.config.ts`
- `statlocker-adaptive.types.ts`
- `statlocker-normalizer.service.ts`
- `statlocker-browser-collector.service.ts`
- `statlocker-snapshot-store.service.ts`
- `statlocker-refresh.service.ts`
- `statlocker-evidence.service.ts`
- `build-skeleton.service.ts`
- `adaptive-game-state.ts`
- `adaptive-decision-state-v1.service.ts`
- `adaptive-evidence-scorer-v1.service.ts`
- `adaptive-build-planner-v1.service.ts`
- `adaptive-recommendation-v1.service.ts`
- `adaptive-recommendation-v1.controller.ts`
- `adaptive-replay-v1.service.ts`
- `statlocker-adaptive.module.ts`

### Persistence

- Create `apps/api/src/deadlock-live/entities/statlocker-evidence-snapshot-v1.entity.ts`.
- Create `apps/api/src/deadlock-live/entities/adaptive-recommendation-decision-v1.entity.ts`.
- Modify `apps/api/src/app.module.ts`.

### Existing services reused without ML8 serving dependencies

- Reuse `apps/api/src/deadlock-live/live-match-state.service.ts` for hero/team/roster souls/game time/current inventory.
- Reuse `apps/api/src/deadlock-live/catalog-content.service.ts` data tables for the strict current item graph/ruleset.
- Reuse `apps/api/src/deadlock-live/souls-affordability-evidence-v2.service.ts` only as a scoped verification gate for whether raw local-player souls can be promoted to verified spendable currency.
- Reuse `generateRecommendationCandidates()` from `@deadlock-live-probe/build-domain` directly.
- Do not route the adaptive endpoint through `recommendation-realtime-state-v8.service.ts`, `recommendation-engine-v8.service.ts`, or the V8 coordinator.

### Tests

Create under `apps/api/test/`:

- `fixtures/statlocker-v1.ts`
- `adaptive-config-v1.spec.ts`
- `statlocker-normalizer-v1.spec.ts`
- `statlocker-snapshot-store-v1.spec.ts`
- `statlocker-browser-collector-v1.spec.ts`
- `statlocker-refresh-v1.spec.ts`
- `statlocker-evidence-v1.spec.ts`
- `build-skeleton-v1.spec.ts`
- `adaptive-game-state-v1.spec.ts`
- `adaptive-decision-state-v1.spec.ts`
- `adaptive-evidence-scorer-v1.spec.ts`
- `adaptive-build-planner-v1.spec.ts`
- `adaptive-recommendation-v1.spec.ts`
- `adaptive-replay-v1.spec.ts`
- `adaptive-policy-v1.integration.spec.ts`

### Overwolf client

- Create `apps/overwolf-client/src/adaptive-recommendation-client.ts`.
- Create `apps/overwolf-client/src/adaptive-recommendation-client.spec.ts`.
- Modify `apps/overwolf-client/src/index.ts`.
- Modify `apps/overwolf-client/src/ui.ts`.

### Runtime packaging and CI

- Modify `apps/api/package.json` and `yarn.lock` - add `puppeteer-core` as a production dependency.
- Modify `Dockerfile` - build/copy `@deadlock-live-probe/build-domain`, install Chromium, set `CHROMIUM_PATH`.
- Modify `docker-compose.yml` only for optional adaptive config overrides.
- Modify `.github/workflows/recommendation-ci.yml` - include the working branch and preserve all existing mandatory tests.

---

## Task 1: Add the public Adaptive Recommendation V1 contract

**Files:**
- Create: `packages/shared/src/adaptive-recommendation-v1.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/test/adaptive-recommendation-v1.test.js`
- Modify: `packages/shared/package.json`

- [ ] Write the failing contract test first. Cover all public action types:

```ts
export type AdaptiveActionTypeV1 =
  | 'BUY'
  | 'UPGRADE'
  | 'SELL'
  | 'REPLACE'
  | 'WAIT'
  | 'HOLD'
  | 'CONTINUE_CORE'
  | 'ABSTAIN';
```

Also cover plan statuses `OWNED | NEXT | PLANNED` and evidence freshness `FRESH | STALE_USABLE | UNAVAILABLE | PATCH_MISMATCH`.

- [ ] Define a JSON-safe request:

```ts
export interface AdaptiveRecommendationRequestV1 {
  matchId: string;
  localSteamId?: string;
}
```

- [ ] Define a JSON-safe result with at least:

```ts
export interface AdaptiveRecommendationResultV1 {
  ready: boolean;
  blockers: readonly string[];
  decisionId: string;
  stateRevision: string;
  gameState: 'AHEAD' | 'EVEN' | 'BEHIND' | 'UNKNOWN';
  nextAction: AdaptiveActionV1;
  recommendedBuild: readonly AdaptivePlannedItemV1[];
  changes: readonly AdaptiveBuildPlanChangeV1[];
  rankedImmediateCandidates: readonly AdaptiveScoredActionV1[];
  confidence: number;
  scorerVersion: string;
  plannerVersion: string;
  configVersion: string;
  evidence: AdaptiveEvidenceProvenanceV1;
}
```

- [ ] Run `yarn workspace @deadlock-live-probe/shared test`. Expected: fail because the new contract/export is missing.
- [ ] Implement the contract. Do not expose `Map`, `Set`, TypeORM entities, or build-domain class instances.
- [ ] Export the contract from `packages/shared/src/index.ts` and add the JS test to the explicit package test chain.
- [ ] Run `yarn workspace @deadlock-live-probe/shared test`. Expected: pass.
- [ ] Commit: `feat: add adaptive recommendation v1 contract`.

---

## Task 2: Add scoped spendable-souls verification for the adaptive state builder

**Files:**
- Modify: `apps/api/src/deadlock-live/souls-affordability-evidence-v2.service.ts`
- Create: `apps/api/test/souls-affordability-scope-v2.spec.ts`

The existing controlled evidence report can prove whether raw souls mirror spendable wallet values, but adaptive serving must fail closed per current ruleset/catalog scope rather than trusting an unrelated historical PASS.

- [ ] Write a failing test for:

```ts
canVerifyScope(rulesetVersion: string, catalogSha256: string): Promise<boolean>
```

Test one passing scope and one different ruleset/catalog with no qualifying evidence.
- [ ] Add a test that malformed/insufficient controlled observations return `false`.
- [ ] Run:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/souls-affordability-scope-v2.spec.ts
```

Expected: fail because the scoped method does not exist.
- [ ] Implement the method by filtering persisted controlled observations to exact `rulesetVersion` + `catalogSha256`, evaluating only that subset with `evaluateSoulsAffordabilityEvidenceV2`, and requiring `canMarkSpendableSoulsVerified === true`.
- [ ] Keep the existing global `report()` behavior unchanged.
- [ ] Run the new test plus existing souls affordability tests. Expected: pass.
- [ ] Commit: `feat: scope spendable souls verification`.

---

## Task 3: Build an ML-neutral adaptive decision state directly from live state and catalog storage

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-decision-state-v1.service.ts`
- Create: `apps/api/test/adaptive-decision-state-v1.spec.ts`
- Modify only if needed for a narrow accessor: `apps/api/src/deadlock-live/live-match-state.service.ts`

The service creates the build-domain `RecommendationDecisionState` and strict `RecommendationItemGraph` without using V8 recommendation telemetry or V8 serving services.

- [ ] Write a failing test with a `MinimalMatchState` containing a local player, team IDs, hero ID, total souls, items, and game time plus mocked current catalog rows.
- [ ] Assert the result contains:
  - local hero ID;
  - current owned inventory;
  - strict item graph and ruleset ID;
  - catalog SHA;
  - game time;
  - sorted enemy hero IDs;
  - our/enemy team total souls;
  - stable state revision.
- [ ] Add tests for these economy states:
  - scoped affordability evidence PASS -> local roster souls may become `observedFact` spendable souls;
  - scoped evidence missing/failing -> `unknownFact` spendable souls;
  - shop opportunity unavailable/unknown -> never fabricate `AVAILABLE`.
- [ ] Run `yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-decision-state-v1.spec.ts`. Expected: fail.
- [ ] Resolve the latest usable `ItemCatalogVersion` deterministically by `importedAt DESC`, load its `ItemCatalogItem` and `ItemCatalogRecipe` rows, then call existing `buildRecommendationRulesetCatalogV1` + `compileStrictRecommendationCatalogV1`.
- [ ] Use `buildInventoryInstancesForRecommendation()` for the local player's current items.
- [ ] Compute team totals only when all roster players used in each team total have finite souls. Missing totals produce contextual `UNKNOWN`, never a guessed number.
- [ ] Do not treat `MinimalPlayerState.souls` as spendable unless Task 2 verifies the exact current ruleset/catalog scope.
- [ ] If no trustworthy direct shop signal exists in current live state, keep shop opportunity unknown. Immediate candidate legality will therefore favor `WAIT`/`HOLD`, while the full target build can still be planned.
- [ ] Compute a deterministic state revision from match ID, local player, sorted roster/item state, game time, ruleset, and catalog SHA.
- [ ] Run the test. Expected: pass.
- [ ] Commit: `feat: build adaptive decision state from live data`.

---

## Task 4: Define normalized Statlocker evidence and the versioned scoring config

**Files:**
- Create: `apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts`
- Create: `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`
- Create: `apps/api/test/adaptive-config-v1.spec.ts`

- [ ] Write a failing config test asserting these approved V1 invariants:
  - game-state threshold `0.08`;
  - exact-enemy aggregation max `3`;
  - planning depth `3`;
  - beam width `8`;
  - sell/core replacement threshold stronger than ordinary plan-switch hysteresis.
- [ ] Start with versioned defaults:

```ts
export const ADAPTIVE_POLICY_V1_CONFIG = {
  version: 'statlocker-adaptive-v1.0.0',
  gameStateThreshold: 0.08,
  gameStateBlendWidth: 0.03,
  exactEnemyMaxMatchups: 3,
  planningDepth: 3,
  beamWidth: 8,
  futureDiscount: 0.8,
  minPlanSwitchImprovement: 0.08,
  sellMinImprovement: 0.20,
  coreReplaceMinImprovement: 0.25,
  recentPurchaseProtectionMs: 120_000,
  recentSellRebuyPenaltyMs: 180_000,
  shrinkK: {
    baseWpa: 200,
    gameState: 250,
    exactEnemy: 500,
    chain: 200,
    proProfile: 50,
  },
  weights: {
    skeletonPrior: 1.0,
    baseWpa: 0.7,
    gameStateFit: 0.7,
    exactEnemyFit: 0.9,
    enemyCompositionFit: 0.5,
    ownBuildFit: 0.5,
    timingFit: 0.4,
    laneFit: 0.3,
    chainFit: 0.7,
    skeletonDeviation: 1.0,
    transaction: 0.7,
    churn: 1.0,
    instability: 0.8,
  },
} as const;
```

These are initial tunable values, not claims of optimal calibration.
- [ ] Define internal normalized types for `WPA_PATCH_DATA`, `VS_HERO_WPA`, `T4_CHAINS`, `HERO_LEADERBOARD`, `PRO_BUILD_ANALYSIS`, optional `WPA_FILTERED_ITEMS`, and internal `CONSENSUS_SKELETON`.
- [ ] Keep `/api/info/wpa-patches` as collector control metadata used to resolve Statlocker's current minor patch, not as a scoring family.
- [ ] Implement safe environment overrides with explicit numeric ranges; invalid values fall back to defaults and appear in status diagnostics.
- [ ] Run config test and API build. Expected: pass.
- [ ] Commit: `feat: define adaptive policy config and evidence types`.

---

## Task 5: Normalize all required Statlocker datasets from deterministic fixtures

**Files:**
- Create: `apps/api/test/fixtures/statlocker-v1.ts`
- Create: `apps/api/src/statlocker-adaptive/statlocker-normalizer.service.ts`
- Create: `apps/api/test/statlocker-normalizer-v1.spec.ts`

Fixtures cover:

```text
/api/info/wpa-patches
/api/info/wpa-patch-data/{minorPatchId}
/api/info/vs-hero-wpa-data
/api/info/t4-chains-data
/api/leaderboard/get-valve-leaderboard
/api/info/player-build-analysis/{accountId}/{heroId}
/api/info/wpa-filtered-items   optional
```

- [ ] Write failing tests that normalize representative observed fields: `mean_wpa`, `sample_size`, `wpa_confidence`, ahead/even/behind WPA, composition/build breakdowns, purchase timing, lane/post-lane breakdowns, exact-enemy `{delta_wpa,count}`, T4 2/3-item chains, and pro `purchaseRate`, `medianBuyTimeS`, `frequencyTier`, `phase`, relationships.
- [ ] Add rejection tests for structurally incomplete `200` responses, non-finite required numeric values, empty primary exact-enemy data, and incompatible pro-build shape.
- [ ] Run normalizer tests. Expected: fail.
- [ ] Implement deterministic pure parsing behind service methods. Unknown optional fields are ignored; required structural failures throw `StatlockerDatasetValidationError`.
- [ ] Compute content SHA-256 from stable normalized JSON, not raw object key order.
- [ ] Run normalizer tests. Expected: pass.
- [ ] Commit: `feat: normalize Statlocker adaptive evidence`.

---

## Task 6: Add append-only snapshot persistence and hot-cache recovery

**Files:**
- Create: `apps/api/src/deadlock-live/entities/statlocker-evidence-snapshot-v1.entity.ts`
- Create: `apps/api/src/statlocker-adaptive/statlocker-snapshot-store.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/statlocker-snapshot-store-v1.spec.ts`

Use snapshot metadata that records both game-side and Statlocker-side identity:

```ts
interface StatlockerSnapshotIdentityV1 {
  dataset: string;
  rulesetVersion: string;
  catalogSha256: string;
  statlockerPatchId: string;
  scopeKey: string;
  contentSha256: string;
}
```

- [ ] Write failing tests for publish/read, bootstrap recovery, failed persistence leaving the active cache unchanged, and identical content deduplication.
- [ ] Create an append-only TypeORM entity keyed by deterministic `snapshotId`, with dataset, ruleset, catalog SHA, Statlocker patch ID, scope, fetched time, schema/collector/normalizer versions, content SHA, payload, and metadata.
- [ ] Persist first, then atomically replace the in-memory active entry. Never mutate active cache before persistence succeeds.
- [ ] Implement `onModuleInit()` recovery of the newest valid snapshot per lookup key.
- [ ] Register the entity in `AppModule`. The project currently uses TypeORM `synchronize: true`; do not introduce an unrelated migration framework in this task.
- [ ] Run store tests and API build. Expected: pass.
- [ ] Commit: `feat: persist Statlocker evidence snapshots`.

---

## Task 7: Implement the production background Chromium collector

**Files:**
- Create: `apps/api/src/statlocker-adaptive/statlocker-browser-collector.service.ts`
- Create: `apps/api/test/statlocker-browser-collector-v1.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `yarn.lock`

The production collector is separate from `apps/api/src/statlocker-probe/`; reuse safe launch patterns, not the POC model abstraction.

- [ ] Write a failing collector test against an injected fake Puppeteer launcher. Assert one browser launch serves a multi-dataset batch and browser close happens exactly once.
- [ ] Add tests that 401/403 are collection failures and that collector result types contain no cookies, headers, local storage, token, or API-key fields.
- [ ] Add `puppeteer-core` as a production dependency:

```bash
yarn workspace @deadlock-live-probe/api add puppeteer-core@^24.0.0
```

- [ ] Implement one public-page browser session, using normal same-origin page-context requests only for approved aggregate datasets.
- [ ] Fetch `/api/info/wpa-patches`, select the current raw minor patch ID, then fetch `/api/info/wpa-patch-data/{minorPatchId}` without a `patch_` prefix.
- [ ] Explicitly exclude Win Chance, player WPA, and build-context APIs.
- [ ] Use bounded body timeouts and bounded concurrency. Do not inspect or persist request headers/cookies/storage.
- [ ] Run collector test and API build. Expected: pass.
- [ ] Commit: `feat: add Statlocker background browser collector`.

---

## Task 8: Add scheduled refresh, TTL, single-flight, and active-hero collection

**Files:**
- Create: `apps/api/src/statlocker-adaptive/statlocker-refresh.service.ts`
- Create: `apps/api/test/statlocker-refresh-v1.spec.ts`

Refresh defaults:

```text
WPA_PATCH_DATA      30 minutes
VS_HERO_WPA         30 minutes
T4_CHAINS           30 minutes
HERO_LEADERBOARD    60 minutes per active hero
PRO_BUILD_ANALYSIS  60 minutes per active hero/player
CONSENSUS_SKELETON  rebuild after relevant profile inputs change
```

- [ ] Write failing tests for TTL gating, single-flight, failed refresh preserving active snapshot, active-hero enqueue returning immediately, and unchanged normalized SHA avoiding duplicate persistence.
- [ ] Implement a scheduler tick every minute that checks TTLs. The minute tick does not imply a Statlocker fetch every minute.
- [ ] Refresh global datasets on their TTL and leaderboard/profile data only for hero IDs observed in recent recommendation requests.
- [ ] Keep active-hero state bounded by a configurable inactivity TTL so the process does not accumulate every hero forever.
- [ ] `enqueueHeroRefresh(heroId)` must be fire-and-forget from recommendation latency perspective.
- [ ] On a new game ruleset/catalog identity, prioritize collecting a new compatible evidence set but keep the previous set as historical fallback, marked `PATCH_MISMATCH` for current scoring until compatible data exists.
- [ ] Run refresh tests. Expected: pass.
- [ ] Commit: `feat: schedule Statlocker evidence refresh`.

---

## Task 9: Build top-10 consensus skeleton snapshots

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-skeleton.service.ts`
- Create: `apps/api/test/build-skeleton-v1.spec.ts`

- [ ] Write failing tests with ten synthetic pro profiles. Assert high-coverage stable items become high-strength core, medium coverage becomes frequent, low coverage remains flex, and median buy time gives deterministic order.
- [ ] Add a test where fewer than the configurable minimum valid profiles are available. Initial default: 6. Do not publish a weak replacement over an existing valid skeleton.
- [ ] Score skeleton support from bounded components:

```text
coverage          0..1
purchaseRate      0..1
frequencyTier     core=1.0, frequent=0.65, sometimes=0.30
orderConsistency  0..1
relationship      0..1
```

Use a weighted average and retain the component breakdown.
- [ ] Build the consensus from up to the top 10 relevant leaderboard profiles for the hero.
- [ ] Persist the normalized result through the snapshot store as internal dataset `CONSENSUS_SKELETON`, scope `hero:{heroId}:consensus`.
- [ ] Run skeleton tests. Expected: pass.
- [ ] Commit: `feat: derive Statlocker consensus build skeletons`.

---

## Task 10: Assemble evidence bundles and freshness semantics

**Files:**
- Create: `apps/api/src/statlocker-adaptive/statlocker-evidence.service.ts`
- Create: `apps/api/test/statlocker-evidence-v1.spec.ts`

- [ ] Write failing tests for `FRESH`, `STALE_USABLE`, `UNAVAILABLE`, and `PATCH_MISMATCH`.
- [ ] Add partial failure coverage: WPA and exact-enemy available, T4 unavailable, skeleton available -> recommendation evidence remains usable with only chain component disabled.
- [ ] Add a ruleset/catalog mismatch test. Mismatched contextual WPA must be excluded rather than treated as merely old.
- [ ] Implement per-family `refreshAfter` and `maxStaleAge`; aging can only lower confidence.
- [ ] Return deterministic sorted snapshot IDs and metadata including local ruleset/catalog and Statlocker minor patch.
- [ ] Enqueue active-hero refresh when a required hero scope is missing/stale, but do not await it.
- [ ] Run evidence tests. Expected: pass.
- [ ] Commit: `feat: assemble Statlocker evidence bundles`.

---

## Task 11: Implement team-souls state and smooth boundary blending

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-game-state.ts`
- Create: `apps/api/test/adaptive-game-state-v1.spec.ts`

- [ ] Write failing classification tests:

```text
108000 vs 100000 => AHEAD
92000 vs 100000  => BEHIND
104000 vs 100000 => EVEN
missing total    => UNKNOWN
```

- [ ] Add tests around 8% proving evidence weights transition smoothly over `gameStateBlendWidth` rather than jump discontinuously.
- [ ] Implement:

```text
soulDelta = (ourTeamSouls - enemyTeamSouls) / enemyTeamSouls
AHEAD  >= +0.08
BEHIND <= -0.08
EVEN   otherwise
```

- [ ] Treat zero/invalid enemy total as `UNKNOWN` to avoid division artifacts.
- [ ] Run test. Expected: pass.
- [ ] Commit: `feat: classify adaptive team soul state`.

---

## Task 12: Implement bounded evidence scoring and confidence shrinkage

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-evidence-scorer-v1.service.ts`
- Create: `apps/api/test/adaptive-evidence-scorer-v1.spec.ts`

- [ ] Write failing tests for `n / (n + k)` shrinkage, monotonic confidence, and component clamping to `[-1, 1]`.
- [ ] Write exact-enemy tests using six enemy slices. Assert only the top three confidence-adjusted contributions are aggregated, by weighted mean rather than sum.
- [ ] Add a low-sample test proving a large raw enemy delta with tiny `count` cannot independently beat a strong core prior.
- [ ] Add tests for base WPA, ahead/even/behind fit, timing falloff, stale confidence reduction, T4 chain fit, skeleton deviation, transaction penalty, churn penalty, optional composition fit, and optional own-build fit.
- [ ] Implement every score component as an explainable record:

```ts
interface AdaptiveScoreComponentV1 {
  raw: number;
  normalized: number;
  confidence: number;
  weight: number;
  weighted: number;
}
```

- [ ] If enemy composition or own-build archetype cannot be classified reliably from available inputs, return zero contribution and lower evidence completeness instead of guessing.
- [ ] Make disagreement among strong signals reduce overall recommendation confidence.
- [ ] Run scorer tests. Expected: pass.
- [ ] Commit: `feat: score adaptive Statlocker evidence`.

---

## Task 13: Implement full-build planning with future target beam search

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts`
- Create: `apps/api/test/adaptive-build-planner-v1.spec.ts`

The planner has two deliberately different layers:

1. **Immediate action layer:** may select only from current `generateRecommendationCandidates()` output. This is where affordability/shop/slot/recipe/transaction legality applies.
2. **Future target layer:** searches a compact ordered sequence of desired future items. These steps are planning targets and may be currently unaffordable. They are not represented as currently feasible transaction candidates.

- [ ] Write failing scenarios:
  - strong core + weak contextual evidence -> `CONTINUE_CORE`;
  - flex slot + high-confidence exact enemy counter -> insert counter, preserve core;
  - full inventory + weak owned flex + strong replacement -> `REPLACE` only if currently legal;
  - same replacement with exact-enemy sample `11` -> no replacement;
  - strong future core currently unaffordable -> immediate `WAIT`, full plan still targets core;
  - unknown shop opportunity -> no illegal `BUY`; full target plan still returned;
  - tiny score change from previous plan -> `HOLD`/preserve previous plan;
  - recent purchase -> protected against immediate sell;
  - recent sell -> rebuy penalty active.
- [ ] Add invariant test: any current candidate with `feasible === false` is removed before immediate-action ranking and can never become `nextAction`.
- [ ] Build a compact future planning pool from consensus core/frequent/flex, high-confidence exact-enemy items, game-state items, optional composition items, T4 continuations, and currently owned items.
- [ ] Search future target sequences to depth `3`, beam width `8`, deterministic tie-break by item/action ID. Apply future discount by depth.
- [ ] Score future target coherence with skeleton/T4/context evidence, but do not call current affordability checks for depth > 0 targets.
- [ ] Compare the best proposed full plan against the previous published plan using hysteresis. Require stronger improvement for SELL and still stronger improvement for replacing protected core.
- [ ] Return full ordered `recommendedBuild`, `changes`, current ranked actions, plan score, and confidence.
- [ ] Run planner tests. Expected: pass.
- [ ] Commit: `feat: plan adaptive full builds`.

---

## Task 14: Persist decisions and deterministic replay

**Files:**
- Create: `apps/api/src/deadlock-live/entities/adaptive-recommendation-decision-v1.entity.ts`
- Create: `apps/api/src/statlocker-adaptive/adaptive-replay-v1.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/adaptive-replay-v1.spec.ts`

- [ ] Write a failing replay test that persists one complete decision input/result and reruns it with the same config and snapshot identities.
- [ ] Assert replay reproduces selected action, ordered build, ranked candidate scores, confidence, and snapshot IDs.
- [ ] Create a decision entity with indexed `decisionId`, `matchId`, `playerKey`, `stateRevision`, JSON-safe `replayInput`, JSON-safe `result`, and timestamp.
- [ ] Persist enough information to replay without Chromium or mutable current DB evidence: live context snapshot, deterministic candidate data, previous plan, normalized evidence payload or immutable snapshot references, config/scorer/planner versions, ruleset/catalog identity, sorted snapshot IDs.
- [ ] Implement `getPreviousPlan(matchId, playerKey)` from the latest successfully published adaptive decision.
- [ ] Register the entity in TypeORM.
- [ ] Run replay tests. Expected: pass.
- [ ] Commit: `feat: persist and replay adaptive decisions`.

---

## Task 15: Coordinate recommendations and run final deterministic legality

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-recommendation-v1.service.ts`
- Create: `apps/api/test/adaptive-recommendation-v1.spec.ts`

Coordinator flow:

```text
AdaptiveDecisionStateV1Service
  -> generateRecommendationCandidates(current state)
  -> previous adaptive plan
  -> local Statlocker evidence bundle
  -> scorer/planner
  -> rebuild freshest adaptive state
  -> regenerate deterministic candidates
  -> confirm selected immediate action is still feasible
  -> otherwise select next ranked feasible action or WAIT/HOLD
  -> persist decision
  -> return result
```

- [ ] Write a failing test proving `StatlockerBrowserCollectorService` is not a constructor dependency and no browser call occurs during `recommend()`.
- [ ] Write a failing test proving no V8 runtime service is a dependency of the coordinator.
- [ ] Write a stale-state race test: planner chooses a buy, final refreshed state makes it infeasible, service returns next feasible current action or `WAIT/HOLD`, never the illegal buy.
- [ ] Write fallback tests:
  - Statlocker unavailable + previous valid plan -> preserve plan, lower confidence, conservative action;
  - no usable Statlocker + no previous plan -> safe deterministic `WAIT`, `HOLD`, `CONTINUE_CORE`, or `ABSTAIN`, never an invented contextual buy.
- [ ] Generate current candidates directly with `generateRecommendationCandidates({ state, itemGraph })`.
- [ ] Persist only the final published action/plan after the second legality check.
- [ ] Run coordinator tests. Expected: pass.
- [ ] Commit: `feat: coordinate Statlocker adaptive recommendations`.

---

## Task 16: Expose the adaptive API and background refresh module

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-recommendation-v1.controller.ts`
- Create: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`
- Create: `apps/api/test/adaptive-recommendation-controller-v1.spec.ts`
- Modify: `apps/api/src/app.module.ts`

Primary endpoint:

```text
POST /deadlock/adaptive/v1/recommend
{ "matchId": "...", "localSteamId": "..." }
```

Status endpoint:

```text
GET /deadlock/adaptive/v1/status
```

- [ ] Write failing controller tests for invalid request, successful typed response, and status response.
- [ ] Build `StatlockerAdaptiveModule` with `ScheduleModule.forRoot()`, TypeORM feature entities, decision state, collector, normalizer, snapshot store, refresh, evidence, skeleton, game state/scorer, planner, replay, coordinator, and controller.
- [ ] Import existing `DeadlockLiveModule` only for non-ML services needed by the adaptive subsystem, or export those narrow services if not currently exported. Do not inject V8 runtime services into adaptive providers.
- [ ] Status returns last collector attempt/success, in-flight refreshes, active hero scopes, per-family freshness, ruleset/catalog identity, Statlocker minor patch ID, and active snapshot IDs. No browser/session material.
- [ ] Keep `StatlockerProbeModule` isolated and unchanged.
- [ ] Run controller tests and API build. Expected: pass.
- [ ] Commit: `feat: expose adaptive recommendation v1 api`.

---

## Task 17: Switch the Overwolf primary live path to one adaptive response

**Files:**
- Create: `apps/overwolf-client/src/adaptive-recommendation-client.ts`
- Create: `apps/overwolf-client/src/adaptive-recommendation-client.spec.ts`
- Modify: `apps/overwolf-client/src/index.ts`
- Modify: `apps/overwolf-client/src/ui.ts`

The old analysis/situational endpoints may stay for debug/manual compatibility. They stop being the primary live recommendation loop.

- [ ] Write a failing client test for debounce, payload dedupe, and no overlapping identical adaptive request.
- [ ] Implement typed `POST /deadlock/adaptive/v1/recommend` client.
- [ ] Track local Steam ID from roster state and schedule adaptive refresh after the live-event buffer has had time to reach the backend.
- [ ] Trigger on meaningful existing live signals: inventory changes, roster/enemy changes, local souls/context changes, match changes, and manual refresh. Do not request on every raw roster packet.
- [ ] Replace `latestSituational` as the primary live recommendation state with one `latestAdaptiveRecommendation` response containing both immediate action and full plan.
- [ ] Add `showAdaptiveRecommendation()` to render immediate action, target item, ordered remaining build, owned/next/planned status, concise reasons, confidence, and evidence freshness.
- [ ] Keep raw Statlocker payloads server-side. Client receives summaries/provenance only.
- [ ] Run:

```bash
yarn workspace @deadlock-live-probe/overwolf-client test
yarn workspace @deadlock-live-probe/overwolf-client build:bundle
```

Expected: pass.
- [ ] Commit: `feat: switch Overwolf runtime to adaptive recommendations`.

---

## Task 18: Package Chromium and build-domain for production

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

The current Dockerfile builds/copies shared + API only. Adaptive serving uses build-domain at runtime and background collection needs Chromium.

- [ ] Add `packages/deadlock-build-domain/package.json` to dependency metadata copied before install.
- [ ] Copy/build `packages/deadlock-build-domain` before API build and copy its runtime package metadata + `dist` into the final image.
- [ ] Install Chromium in the Alpine runtime image and set the actual executable path. Verify during image build with `test -x`.
- [ ] Keep collector configuration secret-free. Optional TTL/weight environment overrides can be added to compose only when needed; defaults must run without them.
- [ ] Build:

```bash
docker build -t deadlock-adaptive-v1 .
```

Expected: success.
- [ ] Verify runtime dependencies:

```bash
docker run --rm --entrypoint sh deadlock-adaptive-v1 -c \
  'test -x "$CHROMIUM_PATH" && node -e "require(\"puppeteer-core\"); require(\"@deadlock-live-probe/build-domain\")"'
```

Expected: exit code 0.
- [ ] Commit: `build: package adaptive runtime dependencies`.

---

## Task 19: Add end-to-end invariants, CI, and VPS smoke verification

**Files:**
- Create: `apps/api/test/adaptive-policy-v1.integration.spec.ts`
- Modify: `.github/workflows/recommendation-ci.yml`
- Create a focused self-hosted smoke workflow only if the existing deployment workflow cannot cleanly perform the checks.

- [ ] Write one deterministic integration fixture covering item graph, live roster, scoped spendable-souls verification, snapshots, skeleton, previous plan, scorer, planner, and coordinator.
- [ ] Assert all hard invariants:
  - infeasible immediate candidate is never selected;
  - Statlocker can never override legality;
  - low-sample enemy evidence cannot dominate core by itself;
  - SELL needs stronger improvement than insertion/buy;
  - tiny score changes do not flip plans;
  - stale evidence lowers confidence;
  - patch mismatch disables affected contextual WPA;
  - identical inputs and versions reproduce identical plan/result hash;
  - recommendation path does not launch Chromium;
  - recommendation path has no ML8 runtime dependency.
- [ ] Add `agent/statlocker-model-probe-poc` to Recommendation CI push branches while preserving pull-request coverage.
- [ ] Run full verification:

```bash
yarn workspace @deadlock-live-probe/shared test
yarn workspace @deadlock-live-probe/build-domain test
yarn workspace @deadlock-live-probe/api test
yarn workspace @deadlock-live-probe/overwolf-client test
yarn workspace @deadlock-live-probe/overwolf-client build:bundle
yarn workspace @deadlock-live-probe/api build
docker build -t deadlock-adaptive-v1 .
```

Expected: all pass.
- [ ] Deploy/verify the VPS through repository GitHub Actions, not ad-hoc host edits.
- [ ] Validate status with retry because Nginx graceful reload may briefly leave an old worker:

```bash
for i in 1 2 3 4 5; do
  curl -fsS https://aboba-telegramovich.duckdns.org/deadlock/adaptive/v1/status && break
  sleep 1
done
```

Expected: JSON status with freshness/provenance and no secrets.
- [ ] Start a collector refresh and confirm a simultaneous recommendation responds from local evidence without waiting for Chromium.
- [ ] Simulate collector failure and confirm last-known-good evidence/fallback remains usable.
- [ ] Confirm logs show no Behavioral/Value/Policy model invocation for `/deadlock/adaptive/v1/recommend`.
- [ ] Commit: `test: verify Statlocker adaptive policy v1 runtime`.

---

## Task 20: Final serving-path audit

**Files:**
- Modify only files needed to fix audit failures.

- [ ] Search adaptive runtime for forbidden ML serving dependencies:

```bash
grep -R "RecommendationBehavioral\|RecommendationValue\|RecommendationPolicy\|RecommendationRealtimeCoordinatorV8\|RecommendationEngineV8\|RecommendationRealtimeStateV8" \
  apps/api/src/statlocker-adaptive || true
```

Expected: no runtime dependency matches.
- [ ] Search adaptive collector for forbidden browser-state handling:

```bash
grep -R "cookies()\|localStorage\|X-API-Key\|authorization" \
  apps/api/src/statlocker-adaptive || true
```

Expected: no secret extraction/persistence implementation.
- [ ] Inspect the Overwolf primary fetch path and confirm `/deadlock/adaptive/v1/recommend` is the live recommendation endpoint.
- [ ] Confirm old ML8 source files still exist in the repository but are not invoked by the adaptive controller/service graph.
- [ ] Replay the deterministic integration decision and compare serialized result hash.
- [ ] Run the full verification suite from Task 19 one final time.
- [ ] Commit only if audit fixes were necessary.

---

## Implementation Notes

### Deterministic legality stays authoritative

`generateRecommendationCandidates()` already emits `WAIT_SAVE`, `BUY_ITEM`, `UPGRADE_ITEM`, `SELL_ITEM`, and `REPLACE_ITEM` while enforcing ruleset availability, wallet observability, affordability, slot limits, active limits, upgrade components, shop observability, and sell transaction knowledge. Adaptive V1 ranks only currently feasible immediate candidates from this layer.

`HOLD` and `CONTINUE_CORE` are planner-level semantic outcomes. When mapped to a concrete immediate transaction, they correspond to taking no transaction now, normally backed by a feasible `WAIT_SAVE` candidate.

### Team souls and spendable souls are deliberately separate

`LiveMatchStateService` roster souls are the approved input for total-team `AHEAD/EVEN/BEHIND`. They are not automatically spendable currency. The adaptive state builder marks local souls as verified spendable only when controlled affordability evidence passes for the exact current ruleset/catalog scope. Otherwise purchase affordability remains unknown and the deterministic candidate generator blocks immediate buys.

### Future build planning is not current transaction simulation

The complete `recommendedBuild` may contain items that are not affordable now. Only `nextAction` must map to a currently feasible deterministic candidate. Future beam-search steps are target sequence choices scored for skeleton/context/T4 coherence.

### Patch identity

`/api/info/wpa-patches` supplies Statlocker's current minor patch ID as collector control metadata. Every scoring snapshot also records our current ruleset + catalog SHA. Compatibility is explicit; mismatched evidence is `PATCH_MISMATCH` and affected contextual components are disabled.

### Active-hero collection

Global WPA/exact-enemy/T4 data refresh by TTL. Leaderboard and pro profile collection is demand scoped to recently active heroes. A recommendation request may enqueue missing hero evidence but never waits for it.

### Primary runtime cutover

The change does not delete old analysis endpoints or ML8 code. Cutover is defined by the Overwolf live client and `/deadlock/adaptive/v1/recommend`. ML8 remains available only for existing offline/admin uses.

## Completion Criteria

Implementation is complete only when all are true:

1. The primary Overwolf live loop calls `/deadlock/adaptive/v1/recommend`.
2. The adaptive endpoint does not depend on V8 recommendation telemetry or ML8 runtime services.
3. No adaptive recommendation request waits for Chromium.
4. Statlocker snapshots persist and recover after API restart.
5. Active heroes receive top-10 consensus skeletons with soft core protection.
6. Team state uses total team souls and the approved ±8% threshold.
7. Spendable souls remain fail-closed unless exact ruleset/catalog affordability evidence verifies them.
8. Exact enemy evidence uses confidence shrinkage, top-three aggregation, and bounded contribution.
9. T4 chain evidence affects future trajectory scoring.
10. Planner returns full ordered build plus immediate action and supports guarded SELL/REPLACE.
11. Only the immediate action must be a currently feasible deterministic candidate; future plan items are targets.
12. Final deterministic legality runs after planning and before persistence/response.
13. Failed collector refresh preserves the last valid snapshot.
14. Patch mismatch disables affected contextual evidence.
15. Decisions can be deterministically replayed from persisted inputs/versions.
16. Scenario/invariant tests pass.
17. Shared/build-domain/API/Overwolf tests and builds pass.
18. Production image contains Chromium, Puppeteer Core, and build-domain runtime artifacts.
19. ML8 source remains in the repository but is absent from the primary adaptive serving graph.
