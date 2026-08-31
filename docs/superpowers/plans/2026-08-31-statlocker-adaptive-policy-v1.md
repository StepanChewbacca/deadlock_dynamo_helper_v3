# Statlocker Adaptive Policy V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the primary live recommendation serving path with a deterministic Statlocker-driven adaptive build planner that returns a full current build plan plus an immediate legal action, while keeping ML8 source code in the repository but out of the serving flow.

**Architecture:** Keep the existing deterministic build-domain candidate generator and legality rules authoritative. Add a separate `statlocker-adaptive` subsystem that collects public Statlocker datasets through background Chromium, normalizes and persists versioned snapshots, builds top-10 consensus skeletons, assembles live match context, scores legal actions, searches a short build trajectory, applies hysteresis and sell penalties, persists replayable decisions, and serves the result to the Overwolf client. The recommendation request never waits for Chromium.

**Tech Stack:** TypeScript 5.9, NestJS 11, TypeORM/PostgreSQL, `@nestjs/schedule`, Puppeteer Core + system Chromium, Jest/ts-jest, existing `@deadlock-live-probe/build-domain`, Overwolf GEP client, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-31-statlocker-adaptive-policy-v1-design.md`

## Global Constraints

- ML8 Behavioral, Value, Policy, and model serving must not be called by the new primary recommendation endpoint.
- Do not delete ML8 source files, training workflows, registries, or offline evaluation code in this implementation.
- Statlocker is evidence only. It never changes affordability, recipe, slot, shop, ruleset, or transaction legality.
- Chromium is background-only. A recommendation request must use local memory/PostgreSQL evidence and must not open a browser.
- Do not inspect, return, log, or persist browser cookies, request headers, local storage, API keys, tokens, or session material.
- If Statlocker returns 401, 403, an authentication wall, CAPTCHA, or another access restriction, record collection failure and keep the previous valid snapshot. Do not attempt a bypass.
- Current-match Statlocker endpoints are excluded from live V1.
- Every score component is bounded before weighting. Raw WPA, samples, purchase seconds, and probabilities are never directly added together.
- Same live state + same previous plan + same evidence snapshot IDs + same config version must produce the same result.
- Failed collection never replaces the last known good snapshot.
- Patch-mismatched evidence never silently counts as current evidence.
- Use existing project style: TypeScript, strict types, English code comments, no `| null` return-type additions.

---

## File Map

### Shared contracts

- Create `packages/shared/src/adaptive-recommendation-v1.ts` - public request/response, plan, score breakdown, freshness, action, and provenance contracts used by API and Overwolf.
- Modify `packages/shared/src/index.ts` - export the V1 contract.
- Create `packages/shared/test/adaptive-recommendation-v1.test.js` - runtime contract smoke checks.
- Modify `packages/shared/package.json` - add the contract test to the explicit shared test chain.

### API adaptive subsystem

Create `apps/api/src/statlocker-adaptive/` with focused files:

- `statlocker-adaptive.config.ts` - versioned defaults and environment overrides.
- `statlocker-adaptive.types.ts` - internal normalized Statlocker evidence types.
- `statlocker-normalizer.service.ts` - raw Statlocker response validation and normalization.
- `statlocker-browser-collector.service.ts` - background browser collection only.
- `statlocker-snapshot-store.service.ts` - append-only persistence + hot cache.
- `statlocker-refresh.service.ts` - scheduling, TTL checks, single-flight, active-hero refresh queue.
- `statlocker-evidence.service.ts` - patch-scoped evidence bundle assembly.
- `build-skeleton.service.ts` - top-10 consensus skeleton derivation.
- `adaptive-game-state.ts` - team-souls classification and smooth blending.
- `adaptive-evidence-scorer-v1.service.ts` - bounded evidence scoring and confidence shrinkage.
- `adaptive-build-planner-v1.service.ts` - candidate-pool construction, beam search, sell/replace, hysteresis.
- `adaptive-realtime-context-v1.service.ts` - merge deterministic core state with live roster/team context and previous plan.
- `adaptive-recommendation-v1.service.ts` - coordinator, final legality, persistence.
- `adaptive-recommendation-v1.controller.ts` - primary serving/status endpoints.
- `adaptive-replay-v1.service.ts` - deterministic replay from persisted decision inputs.
- `statlocker-adaptive.module.ts` - module wiring.

### API persistence

- Create `apps/api/src/deadlock-live/entities/statlocker-evidence-snapshot-v1.entity.ts`.
- Create `apps/api/src/deadlock-live/entities/adaptive-recommendation-decision-v1.entity.ts`.
- Modify `apps/api/src/app.module.ts` - register entities and adaptive module.

### ML-neutral deterministic state extraction

- Create `apps/api/src/deadlock-live/recommendation-realtime-core-state.service.ts` - extract current non-ML state/catalog alignment logic.
- Modify `apps/api/src/deadlock-live/recommendation-realtime-state-v8.service.ts` - delegate the non-ML portion to the core service, then assemble V8 feature state only for legacy/offline V8 callers.
- Modify `apps/api/src/deadlock-live/deadlock-live.module.ts` - provide/export the core service while leaving ML8 providers available for non-primary use.

### Tests and fixtures

Create under `apps/api/test/`:

- `fixtures/statlocker-v1.ts`
- `statlocker-normalizer-v1.spec.ts`
- `statlocker-snapshot-store-v1.spec.ts`
- `statlocker-refresh-v1.spec.ts`
- `build-skeleton-v1.spec.ts`
- `adaptive-game-state-v1.spec.ts`
- `adaptive-evidence-scorer-v1.spec.ts`
- `adaptive-build-planner-v1.spec.ts`
- `adaptive-realtime-context-v1.spec.ts`
- `adaptive-recommendation-v1.spec.ts`
- `adaptive-replay-v1.spec.ts`

### Overwolf client

- Create `apps/overwolf-client/src/adaptive-recommendation-client.ts` - request scheduling, payload dedupe, response typing.
- Create `apps/overwolf-client/src/adaptive-recommendation-client.spec.ts`.
- Modify `apps/overwolf-client/src/index.ts` - stop the old baseline/situational pair from being the primary runtime and call the new endpoint.
- Modify `apps/overwolf-client/src/ui.ts` - render the full adaptive plan and immediate action while retaining existing guide layout where practical.

### Runtime packaging and CI

- Modify `apps/api/package.json` and `yarn.lock` - add `puppeteer-core` production dependency.
- Modify `Dockerfile` - build/copy `@deadlock-live-probe/build-domain`, install Chromium in runtime image, set `CHROMIUM_PATH`.
- Modify `docker-compose.yml` - expose adaptive refresh/config environment values only when an override is needed.
- Modify `.github/workflows/recommendation-ci.yml` - include this branch in push triggers and keep API/shared/build-domain/Overwolf tests mandatory.

---

## Task 1: Add the public Adaptive Recommendation V1 contract

**Files:**
- Create: `packages/shared/src/adaptive-recommendation-v1.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/test/adaptive-recommendation-v1.test.js`
- Modify: `packages/shared/package.json`

- [ ] Write the failing shared contract test first. Assert that a representative result can express `BUY`, `UPGRADE`, `SELL`, `REPLACE`, `WAIT`, and `CONTINUE_CORE`, and that a plan contains `OWNED`, `NEXT`, and `PLANNED` items.

Example contract shape to test:

```ts
export type AdaptiveActionTypeV1 =
  | 'BUY'
  | 'UPGRADE'
  | 'SELL'
  | 'REPLACE'
  | 'WAIT'
  | 'CONTINUE_CORE'
  | 'ABSTAIN';

export type AdaptiveEvidenceFreshnessV1 =
  | 'FRESH'
  | 'STALE_USABLE'
  | 'UNAVAILABLE'
  | 'PATCH_MISMATCH';

export interface AdaptiveRecommendationRequestV1 {
  matchId: string;
  localSteamId?: string;
}

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

- [ ] Run `yarn workspace @deadlock-live-probe/shared test` and confirm the new test fails because the contract/export does not exist.
- [ ] Implement the contract with JSON-safe values only. Do not put `Map`, `Set`, class instances, or build-domain internal types into the public response.
- [ ] Export it from `packages/shared/src/index.ts` and add the JS test to the explicit shared `test` script chain.
- [ ] Run `yarn workspace @deadlock-live-probe/shared test` and confirm all shared tests pass.
- [ ] Commit: `feat: add adaptive recommendation v1 contract`.

---

## Task 2: Extract the ML-neutral deterministic realtime core state

**Files:**
- Create: `apps/api/src/deadlock-live/recommendation-realtime-core-state.service.ts`
- Modify: `apps/api/src/deadlock-live/recommendation-realtime-state-v8.service.ts`
- Modify: `apps/api/src/deadlock-live/deadlock-live.module.ts`
- Create: `apps/api/test/recommendation-realtime-core-state.spec.ts`
- Modify or extend: `apps/api/test/recommendation-realtime-coordinator-v8.spec.ts`

The new core service owns only the logic currently needed before V8 feature assembly: aligned `PLAYER_STATE` + `INVENTORY_SNAPSHOT`, strict catalog loading/compilation, verified spendable souls, approved direct shop state, `RecommendationDecisionState`, item graph, state revision, versions, and quality.

- [ ] Write a failing test that builds a state from aligned telemetry and asserts it returns `state`, `itemGraph`, `stateRevision`, `rulesetVersion`, `catalogSha256`, `versions`, and `quality`, with no V8 feature state.
- [ ] Add a failing test that unknown/unverified wallet state remains unknown and makes purchase candidates infeasible when passed to `generateRecommendationCandidates`.
- [ ] Run:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/recommendation-realtime-core-state.spec.ts
```

Expected: failure because the service does not exist.

- [ ] Move the non-ML query/catalog/state construction from `RecommendationRealtimeStateV8Service` into the new service without changing validation semantics.
- [ ] Keep a V8 wrapper flow equivalent to:

```ts
const core = await this.coreState.build(request);
if (!core.ready || !core.state || !core.itemGraph) return core;

const featureResult = assembleRecommendationFeatureStateV8({
  // existing V8-only feature inputs
});
```

- [ ] Register/export `RecommendationRealtimeCoreStateService` in `DeadlockLiveModule`.
- [ ] Run the new test plus existing V8 coordinator/engine tests:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/recommendation-realtime-core-state.spec.ts \
  test/recommendation-realtime-coordinator-v8.spec.ts \
  test/recommendation-engine-v8.spec.ts
```

Expected: pass, proving the extraction did not alter existing deterministic/V8 behavior.
- [ ] Commit: `refactor: extract recommendation realtime core state`.

---

## Task 3: Define normalized Statlocker evidence and scoring configuration

**Files:**
- Create: `apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts`
- Create: `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`
- Create: `apps/api/test/adaptive-config-v1.spec.ts`

Use one explicit versioned config object. Initial V1 defaults are implementation defaults, not claims that they are optimal:

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

- [ ] Write a failing test asserting the approved invariants are represented in config: threshold `0.08`, max exact enemies `3`, depth `3`, width `8`, and sell/core-replace thresholds greater than the ordinary plan-switch threshold.
- [ ] Run `yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-config-v1.spec.ts`; expected failure.
- [ ] Implement internal normalized evidence types for patch item WPA, conditional WPA, exact enemy deltas, T4 chains, leaderboard entries, pro player item analysis, skeleton item support, and evidence freshness metadata.
- [ ] Implement config parsing so numeric environment overrides must be finite and inside explicit safe ranges; invalid overrides fall back to the versioned default and are reported in status metadata.
- [ ] Run the test and API build; expected pass.
- [ ] Commit: `feat: define adaptive policy v1 config and evidence types`.

---

## Task 4: Normalize all required Statlocker datasets from deterministic fixtures

**Files:**
- Create: `apps/api/test/fixtures/statlocker-v1.ts`
- Create: `apps/api/src/statlocker-adaptive/statlocker-normalizer.service.ts`
- Create: `apps/api/test/statlocker-normalizer-v1.spec.ts`

Fixtures must cover the observed response families:

- current patch index from `/api/info/wpa-patches` as collector control metadata;
- `/api/info/wpa-patch-data/{minorPatchId}`;
- `/api/info/vs-hero-wpa-data`;
- `/api/info/t4-chains-data`;
- `/api/leaderboard/get-valve-leaderboard`;
- `/api/info/player-build-analysis/{accountId}/{heroId}`;
- optional `/api/info/wpa-filtered-items`.

- [ ] Write failing tests that normalize representative fields including `mean_wpa`, `sample_size`, `wpa_confidence`, `conditional_wpa`, composition/build breakdowns, purchase timing, lane breakdowns, exact enemy `{delta_wpa,count}`, T4 2/3-item chains, and pro `purchaseRate`, `medianBuyTimeS`, `frequencyTier`, `phase`.
- [ ] Add rejection tests for `200` responses with missing primary sections, non-finite numeric fields, an empty exact-enemy map, and an incompatible pro-build structure.
- [ ] Run the test; expected failure because the normalizer does not exist.
- [ ] Implement normalization as pure deterministic parsing behind service methods. Unknown optional fields are ignored; required structural failures throw a typed `StatlockerDatasetValidationError`.
- [ ] Compute content SHA-256 from stable normalized JSON, not raw object property insertion order.
- [ ] Run the normalizer test; expected pass.
- [ ] Commit: `feat: normalize Statlocker adaptive evidence`.

---

## Task 5: Add append-only snapshot persistence and hot-cache recovery

**Files:**
- Create: `apps/api/src/deadlock-live/entities/statlocker-evidence-snapshot-v1.entity.ts`
- Create: `apps/api/src/statlocker-adaptive/statlocker-snapshot-store.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/statlocker-snapshot-store-v1.spec.ts`

Entity shape:

```ts
@Entity('statlocker_evidence_snapshots_v1')
export class StatlockerEvidenceSnapshotV1 {
  @PrimaryColumn({ type: 'char', length: 64 })
  snapshotId!: string;

  @Index('idx_statlocker_snapshot_lookup')
  @Column({ type: 'varchar', length: 48 })
  dataset!: string;

  @Column({ type: 'varchar', length: 128 })
  rulesetVersion!: string;

  @Column({ type: 'varchar', length: 128 })
  statlockerPatchId!: string;

  @Column({ type: 'varchar', length: 192 })
  scopeKey!: string;

  @Column({ type: 'timestamptz' })
  fetchedAt!: Date;

  @Column({ type: 'char', length: 64 })
  contentSha256!: string;

  @Column({ type: 'jsonb' })
  payload!: unknown;

  @Column({ type: 'jsonb' })
  metadata!: unknown;
}
```

- [ ] Write failing store tests using a mocked repository: publish a valid snapshot, read it from hot cache, restore cache on bootstrap, and keep the existing cache entry when a later write is rejected.
- [ ] Add a test that identical dataset/ruleset/scope/content hash does not append a duplicate row and does not change the active snapshot ID.
- [ ] Implement snapshot IDs deterministically from dataset + ruleset + Statlocker patch + scope + content SHA.
- [ ] Persist first, then atomically replace the in-memory entry. Never update memory before persistence succeeds.
- [ ] Implement `onModuleInit()` recovery that loads the newest valid snapshot for each lookup key.
- [ ] Register the entity in `AppModule` and the adaptive module TypeORM feature list. The repository currently uses `synchronize: true`; do not add an unrelated migration system in this change.
- [ ] Run store tests and API build; expected pass.
- [ ] Commit: `feat: persist Statlocker evidence snapshots`.

---

## Task 6: Implement the production browser collector with one session per batch

**Files:**
- Create: `apps/api/src/statlocker-adaptive/statlocker-browser-collector.service.ts`
- Create: `apps/api/test/statlocker-browser-collector-v1.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `yarn.lock`

The production collector is separate from `apps/api/src/statlocker-probe/`. Reuse its safe launch behavior, not its POC model abstraction.

- [ ] Write a failing collector unit test against a fake Puppeteer adapter. Verify one browser launch can collect multiple endpoint bodies and closes the browser exactly once.
- [ ] Add a test that HTTP 401/403 is returned as a collection failure and no attempt to inspect browser secrets is made.
- [ ] Add `puppeteer-core` as a production dependency:

```bash
yarn workspace @deadlock-live-probe/api add puppeteer-core@^24.0.0
```

- [ ] Implement a small injectable browser-launch adapter so unit tests do not require Chromium.
- [ ] Open `https://statlocker.gg/items/meta-model` as the public origin, then issue allowed same-origin page-context fetches for the approved aggregate datasets.
- [ ] Explicitly exclude Win Chance, player WPA, and build-context from the collector API.
- [ ] Use bounded response-body timeouts and bounded parallelism inside one browser session. Do not return request headers/cookies/storage in result types.
- [ ] Run collector unit test and API build; expected pass.
- [ ] Commit: `feat: add Statlocker background browser collector`.

---

## Task 7: Add scheduled refresh, TTL, single-flight, and active-hero collection

**Files:**
- Create: `apps/api/src/statlocker-adaptive/statlocker-refresh.service.ts`
- Create: `apps/api/test/statlocker-refresh-v1.spec.ts`
- Modify later wiring in `statlocker-adaptive.module.ts`

Refresh defaults:

```text
WPA_PATCH_DATA       30 minutes
VS_HERO_WPA          30 minutes
T4_CHAINS            30 minutes
HERO_LEADERBOARD     60 minutes per active hero
PRO_BUILD_ANALYSIS   60 minutes per active hero/player profile
```

Do not scrape all hero/player profiles every hour. Maintain an active-hero set populated by recommendation requests and refresh those hero scopes in background.

- [ ] Write failing tests for TTL gating, a second concurrent refresh joining the existing in-flight promise, failed refresh preserving the previous valid snapshot, and an active hero enqueue that returns immediately.
- [ ] Implement a one-minute scheduler tick that checks TTLs instead of blindly fetching every minute.
- [ ] First refresh collector control metadata from `/api/info/wpa-patches`, resolve the latest Statlocker minor patch ID, and persist the association with the current local `rulesetVersion` in snapshot metadata.
- [ ] For unchanged normalized content SHA, update refresh status metrics without writing a duplicate snapshot.
- [ ] Make `enqueueHeroRefresh(heroId)` fire-and-forget from runtime perspective.
- [ ] Run refresh tests; expected pass.
- [ ] Commit: `feat: schedule Statlocker evidence refresh`.

---

## Task 8: Build the Statlocker evidence bundle and freshness semantics

**Files:**
- Create: `apps/api/src/statlocker-adaptive/statlocker-evidence.service.ts`
- Create: `apps/api/test/statlocker-evidence-v1.spec.ts`

The service must return evidence plus provenance and per-family freshness:

```ts
interface AdaptiveEvidenceBundleV1 {
  rulesetVersion: string;
  statlockerPatchId?: string;
  itemEvidence: ReadonlyMap<number, NormalizedItemEvidenceV1>;
  exactEnemyEvidence: ReadonlyMap<number, readonly NormalizedEnemyItemEvidenceV1[]>;
  t4Chains: NormalizedT4ChainsV1;
  skeleton?: ConsensusBuildSkeletonV1;
  freshness: Record<string, AdaptiveEvidenceFreshnessV1>;
  snapshotIds: readonly string[];
  confidenceMultiplier: number;
}
```

- [ ] Write failing tests for all four freshness states: `FRESH`, `STALE_USABLE`, `UNAVAILABLE`, `PATCH_MISMATCH`.
- [ ] Add a test where WPA and enemy data are present but T4 is unavailable: the bundle remains usable and only chain evidence is disabled.
- [ ] Add a test where runtime ruleset differs from the snapshot ruleset: contextual WPA is excluded and marked `PATCH_MISMATCH`.
- [ ] Implement configurable `refreshAfter` and `maxStaleAge` per family. Freshness age reduces confidence smoothly; it never increases an effect.
- [ ] Return deterministic sorted snapshot IDs for replay identity.
- [ ] Run tests; expected pass.
- [ ] Commit: `feat: assemble Statlocker evidence bundles`.

---

## Task 9: Build top-10 consensus skeletons

**Files:**
- Create: `apps/api/src/statlocker-adaptive/build-skeleton.service.ts`
- Create: `apps/api/test/build-skeleton-v1.spec.ts`

Use up to top 10 leaderboard players with valid hero profile analysis. Initial publication minimum is 6 valid profiles; if a refresh yields fewer than 6, keep the previous skeleton. This threshold is configurable.

- [ ] Write failing tests with ten synthetic player profiles. Assert items shared by 8-10 players become high-strength core, less common items become frequent/flex, and median buy time controls deterministic order within phase.
- [ ] Add a test where only 5 profiles are valid and confirm the new skeleton is not published over an existing valid one.
- [ ] Score skeleton support from bounded components:

```text
coverage          0..1
purchaseRate      0..1
frequencyTier     core=1.0, frequent=0.65, sometimes=0.30
orderConsistency  0..1
relationship      0..1
```

Use weighted average, not raw sum. Store the exact component breakdown on each skeleton item.

- [ ] Derive phase from robust aggregate pro phase/timing and order the final skeleton deterministically by phase, median time, then item ID.
- [ ] Persist the consensus skeleton itself as a normalized snapshot scope `hero:{heroId}:consensus` so runtime does not recompute top-10 aggregation on every decision.
- [ ] Run skeleton tests; expected pass.
- [ ] Commit: `feat: derive Statlocker consensus build skeletons`.

---

## Task 10: Assemble live adaptive context and team-souls game state

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-game-state.ts`
- Create: `apps/api/src/statlocker-adaptive/adaptive-realtime-context-v1.service.ts`
- Create: `apps/api/test/adaptive-game-state-v1.spec.ts`
- Create: `apps/api/test/adaptive-realtime-context-v1.spec.ts`
- Modify only if required for an exposed accessor: `apps/api/src/deadlock-live/live-match-state.service.ts`

Use two existing state sources for different purposes:

1. `RecommendationRealtimeCoreStateService` supplies the strict catalog, deterministic candidate state, verified spendable wallet, shop observability, versions, and state revision.
2. `LiveMatchStateService` supplies roster hero IDs, team IDs, each player's total souls, and game time for contextual team totals.

- [ ] Write pure game-state tests:

```text
108000 vs 100000 => AHEAD
92000 vs 100000  => BEHIND
104000 vs 100000 => EVEN
missing enemy total => UNKNOWN
```

- [ ] Add blend tests proving a tiny movement around 8% changes weights smoothly rather than discontinuously.
- [ ] Write a failing context test with a local player, five allies, six enemies, known souls and hero IDs. Assert `ourTeamSouls`, `enemyTeamSouls`, sorted `enemyHeroIds`, game state, inventory, hero ID, and game time are assembled.
- [ ] Do not use roster `souls` as spendable currency. Affordability continues to use `state.economy.spendableSouls` from the deterministic core state.
- [ ] If roster team totals are incomplete, set contextual game state `UNKNOWN`; do not fabricate missing player souls.
- [ ] If enemy composition or own-build archetype cannot be reliably classified from available metadata, set that optional context to `UNKNOWN` and make its scorer component zero. Exact enemy, team-state, skeleton, and T4 remain the mandatory V1 contextual families when their evidence is available.
- [ ] Run both tests; expected pass.
- [ ] Commit: `feat: assemble adaptive live match context`.

---

## Task 11: Implement bounded scoring and confidence shrinkage

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-evidence-scorer-v1.service.ts`
- Create: `apps/api/test/adaptive-evidence-scorer-v1.spec.ts`

- [ ] Write failing unit tests for `n / (n + k)` shrinkage, bounded normalization, and sample confidence monotonicity.
- [ ] Write the exact-enemy tests from the spec: six enemy slices, only top three confidence-adjusted contributions used, weighted mean rather than sum, low sample unable to dominate core by itself.
- [ ] Add tests for game-state conditional WPA, timing falloff, stale confidence reduction, T4 chain contribution, skeleton deviation, and transaction/churn penalties.
- [ ] Implement each component as a named function returning `{ raw, normalized, confidence, weighted }` so score breakdown is explainable.
- [ ] Clamp normalized component values to `[-1, 1]` before multiplying by configured weight.
- [ ] Implement exact-enemy aggregation in this order:

```ts
const adjusted = enemyEvidence
  .map(shrinkEnemyEffect)
  .sort(byAbsoluteConfidenceAdjustedEffectDesc)
  .slice(0, config.exactEnemyMaxMatchups);

const fit = clamp(weightedMean(adjusted), -1, 1);
```

- [ ] Ensure contradictory evidence lowers aggregate recommendation confidence rather than silently choosing only positive signals.
- [ ] Run scorer tests; expected pass.
- [ ] Commit: `feat: score adaptive Statlocker evidence`.

---

## Task 12: Implement the full-build planner with beam search, WAIT, SELL, and hysteresis

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-build-planner-v1.service.ts`
- Create: `apps/api/test/adaptive-build-planner-v1.spec.ts`

The planner receives only deterministic candidates produced by `generateRecommendationCandidates` plus the evidence bundle and previous plan.

- [ ] Write failing scenario tests:
  - strong core + weak contextual evidence => `CONTINUE_CORE`;
  - flex slot + high-confidence exact enemy counter + valid timing => insert counter item, preserve core;
  - full inventory + weak owned flex + strong replacement => `REPLACE`;
  - same replacement but exact-enemy sample `11` => no sell/replace;
  - unaffordable strong target => `WAIT` for target instead of a weak filler buy;
  - tiny score change against previous plan => keep previous plan;
  - recently bought item => protected from immediate sale;
  - recently sold item => rebuy penalty active.
- [ ] Add an invariant test that filters all `candidate.feasible === false` before scoring or search and can never output one as `nextAction`.
- [ ] Build the planning pool from skeleton core/frequent/flex, strong contextual items, T4 continuations, and owned items. Deduplicate and sort deterministically.
- [ ] Implement beam state as plain immutable data:

```ts
interface BeamPlanStateV1 {
  itemIds: readonly number[];
  steps: readonly PlannedTransitionV1[];
  score: number;
  immediateScore: number;
}
```

- [ ] Expand at most `planningDepth=3`, keep at most `beamWidth=8` each layer, discount future item scores by `futureDiscount ** depth`.
- [ ] Apply `minPlanSwitchImprovement`, stronger `sellMinImprovement`, and stronger `coreReplaceMinImprovement` against the previous published plan.
- [ ] Return full ordered `recommendedBuild`, diff `changes`, ranked immediate candidates, total score, and confidence.
- [ ] Run planner tests; expected pass.
- [ ] Commit: `feat: plan adaptive full builds`.

---

## Task 13: Persist decisions and implement deterministic replay

**Files:**
- Create: `apps/api/src/deadlock-live/entities/adaptive-recommendation-decision-v1.entity.ts`
- Create: `apps/api/src/statlocker-adaptive/adaptive-replay-v1.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/adaptive-replay-v1.spec.ts`

Decision entity stores immutable JSON-safe request/input/result/provenance rather than duplicating every nested score into columns:

```ts
@Entity('adaptive_recommendation_decisions_v1')
export class AdaptiveRecommendationDecisionV1 {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  decisionId!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  matchId!: string;

  @Column({ type: 'varchar', length: 128 })
  playerKey!: string;

  @Column({ type: 'varchar', length: 128 })
  stateRevision!: string;

  @Column({ type: 'jsonb' })
  replayInput!: unknown;

  @Column({ type: 'jsonb' })
  result!: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  recordedAt!: Date;
}
```

- [ ] Write a failing replay test that persists a decision fixture and feeds its stored state/evidence/config/previous-plan identity back through scorer/planner.
- [ ] Assert the replay result has the same selected action, ordered build, candidate scores, confidence, and evidence snapshot IDs.
- [ ] Store score breakdown, ruleset/catalog versions, live context, previous plan, config/scorer/planner versions, and sorted snapshot IDs inside `replayInput`/`result`.
- [ ] Add `getPreviousPlan(matchId, playerKey)` using the latest successfully published decision.
- [ ] Register the entity in TypeORM.
- [ ] Run replay tests; expected pass.
- [ ] Commit: `feat: persist and replay adaptive decisions`.

---

## Task 14: Add the primary adaptive recommendation coordinator and final legality pass

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-recommendation-v1.service.ts`
- Create: `apps/api/test/adaptive-recommendation-v1.spec.ts`

Coordinator flow:

```text
build core deterministic state
+ merge live roster/team context
+ read previous plan
+ read local Statlocker evidence
+ generate deterministic candidates
+ score/plan
+ regenerate or validate immediate candidate against latest state
+ persist
+ return
```

- [ ] Write a failing service test proving `StatlockerBrowserCollectorService` is not a dependency and is never called during `recommend()`.
- [ ] Write a test where the planner selects a buy, then final legality state changes to make that buy unavailable; service must choose the next ranked legal action or `WAIT`, never publish the stale illegal buy.
- [ ] Write a test where Statlocker is unavailable but a previous valid plan exists; service returns the preserved plan with lower confidence and conservative next action.
- [ ] Write a test where no usable Statlocker evidence and no prior plan exist; service returns a safe deterministic `WAIT`/`CONTINUE_CORE`/`ABSTAIN` result according to candidate availability, never inventing a contextual item.
- [ ] Call `generateRecommendationCandidates({ state, itemGraph })` directly or through a tiny adaptive candidate adapter. Do not call `RecommendationEngineV8Service`, Behavioral serving, Value, or Policy.
- [ ] Persist only after final legality succeeds.
- [ ] Run service tests; expected pass.
- [ ] Commit: `feat: coordinate Statlocker adaptive recommendations`.

---

## Task 15: Expose the adaptive API and evidence status

**Files:**
- Create: `apps/api/src/statlocker-adaptive/adaptive-recommendation-v1.controller.ts`
- Create: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`
- Create: `apps/api/test/adaptive-recommendation-controller-v1.spec.ts`
- Modify: `apps/api/src/app.module.ts`

Primary endpoint:

```text
POST /deadlock/adaptive/v1/recommend
body: { matchId, localSteamId? }
```

Status endpoint:

```text
GET /deadlock/adaptive/v1/status
```

Status returns collector last-attempt/last-success times, in-flight flags, active hero scopes, per-family freshness, current local ruleset, Statlocker patch ID, and active snapshot IDs. It must not include browser/session material.

- [ ] Write failing controller tests for request validation and a typed successful response.
- [ ] Build `StatlockerAdaptiveModule` with `ScheduleModule.forRoot()`, TypeORM feature entities, collector, normalizer, store, refresh, evidence, skeleton, scorer, planner, context, coordinator, replay, and controller.
- [ ] Import `DeadlockLiveModule` for the exported ML-neutral core state and `LiveMatchStateService`.
- [ ] Import the new module into `AppModule` while leaving `StatlockerProbeModule` isolated and unchanged.
- [ ] Verify no adaptive provider constructor takes `RecommendationBehavioralServingV1Service`, `RecommendationEngineV8Service`, `RecommendationPolicyBuildV1Service`, or `RecommendationRealtimeCoordinatorV8Service`.
- [ ] Run controller tests and API build; expected pass.
- [ ] Commit: `feat: expose adaptive recommendation v1 api`.

---

## Task 16: Make the Overwolf runtime use one adaptive recommendation path

**Files:**
- Create: `apps/overwolf-client/src/adaptive-recommendation-client.ts`
- Create: `apps/overwolf-client/src/adaptive-recommendation-client.spec.ts`
- Modify: `apps/overwolf-client/src/index.ts`
- Modify: `apps/overwolf-client/src/ui.ts`

The old `/deadlock/analysis/recommend` and `/deadlock/analysis/situational/recommend` code can remain for manual/debug compatibility, but the live background controller must stop using that pair as its primary recommendation loop.

- [ ] Write a failing client test proving meaningful state-change requests are debounced/deduplicated and that two identical `{matchId, localSteamId}` requests do not overlap.
- [ ] Add a typed fetch client for `POST /deadlock/adaptive/v1/recommend`.
- [ ] In `index.ts`, track the local Steam ID from roster state and schedule the adaptive request after buffered live events have had time to reach the backend.
- [ ] Trigger on the already available meaningful events: inventory changes, roster/enemy composition changes, local souls/context changes, match changes, and manual refresh. Keep the existing debounce rather than requesting on every roster packet.
- [ ] Replace `latestSituational` as the live primary concept with `latestAdaptiveRecommendation`; one response now contains both the immediate action and full plan.
- [ ] Add `showAdaptiveRecommendation()` in `ui.ts`. Render:
  - immediate action and target item;
  - ordered next build items;
  - owned/planned status;
  - concise reasons from score components/plan changes;
  - confidence/freshness indicator.
- [ ] Do not expose raw 1.1 MB Statlocker evidence payloads to the client; response carries only score/provenance summaries.
- [ ] Run:

```bash
yarn workspace @deadlock-live-probe/overwolf-client test
yarn workspace @deadlock-live-probe/overwolf-client build:bundle
```

Expected: pass.
- [ ] Commit: `feat: switch Overwolf runtime to adaptive recommendations`.

---

## Task 17: Package Chromium and build-domain for the production API image

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Potential lockfile already changed in Task 6.

The current Dockerfile copies only shared + API artifacts. The adaptive runtime directly relies on `@deadlock-live-probe/build-domain`, so production image packaging must include it explicitly.

- [ ] Add `packages/deadlock-build-domain/package.json` to builder dependency metadata and copy/build the package before API build.
- [ ] Copy build-domain package metadata and `dist` into the runtime stage.
- [ ] Install Chromium in the Alpine runtime image and set an explicit executable path, for example:

```dockerfile
RUN apk add --no-cache chromium
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
```

If the installed Alpine package exposes `/usr/bin/chromium` instead, use that actual path in the image and test it with `test -x` during image build.

- [ ] Add optional compose environment overrides for refresh intervals/config version only if operators need them; defaults must run without extra secrets.
- [ ] Build locally/CI:

```bash
docker build -t deadlock-adaptive-v1 .
```

Expected: image builds successfully.
- [ ] Verify inside the image:

```bash
docker run --rm --entrypoint sh deadlock-adaptive-v1 -c \
  'test -x "$CHROMIUM_PATH" && node -e "require(\"puppeteer-core\"); require(\"@deadlock-live-probe/build-domain\")"'
```

Expected: exit code 0.
- [ ] Commit: `build: package adaptive runtime dependencies`.

---

## Task 18: Add end-to-end invariants, CI coverage, and operational smoke

**Files:**
- Create: `apps/api/test/adaptive-policy-v1.integration.spec.ts`
- Modify: `.github/workflows/recommendation-ci.yml`
- Optionally create a focused self-hosted smoke workflow only if the existing deploy workflow cannot execute the checks cleanly.

- [ ] Write an integration test with a deterministic item graph, live context, snapshot bundle, previous plan, scorer, planner, and coordinator. Assert the full approved invariant set:
  - illegal candidate is never selected;
  - Statlocker cannot override legality;
  - low-sample enemy evidence cannot dominate core by itself;
  - SELL requires stronger evidence than insertion/buy;
  - tiny score changes do not flip the plan;
  - stale evidence lowers confidence;
  - patch mismatch disables contextual WPA;
  - identical inputs and versions reproduce the same plan.
- [ ] Run the targeted integration test first; expected pass after Tasks 1-17.
- [ ] Add `agent/statlocker-model-probe-poc` to Recommendation CI push branches while retaining pull-request coverage.
- [ ] Run full repository verification:

```bash
yarn workspace @deadlock-live-probe/shared test
yarn workspace @deadlock-live-probe/build-domain test
yarn workspace @deadlock-live-probe/api test
yarn workspace @deadlock-live-probe/overwolf-client test
yarn workspace @deadlock-live-probe/overwolf-client build:bundle
yarn workspace @deadlock-live-probe/api build
```

Expected: all pass.
- [ ] Build the production image and verify Chromium/build-domain as in Task 17.
- [ ] On the self-hosted VPS, use the repository's GitHub Actions deployment mechanism, not ad-hoc host edits. After deploy, validate with retries because Nginx graceful reload can briefly leave an old worker:

```bash
for i in 1 2 3 4 5; do
  curl -fsS https://aboba-telegramovich.duckdns.org/deadlock/adaptive/v1/status && break
  sleep 1
done
```

Expected: JSON status with no secrets and evidence freshness fields.
- [ ] Validate that a recommendation request returns quickly from local evidence even while a collector refresh is in progress. The request must not wait for Chromium completion.
- [ ] Simulate collector failure or temporarily disable collection in the smoke environment and confirm the endpoint continues with last-known-good evidence/fallback behavior.
- [ ] Confirm runtime logs show no Behavioral/Value/Policy model invocation for adaptive requests.
- [ ] Commit: `test: verify Statlocker adaptive policy v1 runtime`.

---

## Task 19: Final regression and serving-path audit

**Files:**
- Modify only files needed to fix failures found in the audit.

- [ ] Search the new adaptive subsystem for forbidden ML serving dependencies:

```bash
grep -R "RecommendationBehavioral\|RecommendationValue\|RecommendationPolicy\|RecommendationRealtimeCoordinatorV8\|RecommendationEngineV8" \
  apps/api/src/statlocker-adaptive || true
```

Expected: no runtime dependency matches.
- [ ] Search for forbidden browser-state handling:

```bash
grep -R "cookie\|localStorage\|authorization\|X-API-Key" \
  apps/api/src/statlocker-adaptive || true
```

Expected: no secret extraction/persistence implementation. A literal security assertion in a test is acceptable only if it does not read browser state.
- [ ] Run the full test/build suite again.
- [ ] Replay at least one persisted integration fixture and compare serialized result hashes.
- [ ] Inspect the primary Overwolf fetch path and confirm it targets `/deadlock/adaptive/v1/recommend`.
- [ ] Confirm old ML8 files still exist but are not called by the primary live adaptive endpoint.
- [ ] Commit any audit fixes with a focused message, otherwise leave the previous verified commit as the implementation head.

---

## Implementation Notes

### Why keep the deterministic candidate generator unchanged

`generateRecommendationCandidates` already emits `WAIT_SAVE`, `BUY_ITEM`, `UPGRADE_ITEM`, `SELL_ITEM`, and `REPLACE_ITEM` candidates and enforces item availability, wallet observability, affordability, slot limits, active-item limits, upgrade components, shop observability, and sell transaction knowledge. Adaptive V1 should rank only feasible candidates from this layer rather than reimplementing shop rules.

### Why split live context from affordability

Roster `souls` are appropriate for the approved team total comparison, but they are not assumed to equal verified spendable wallet currency. Team `AHEAD/EVEN/BEHIND` therefore comes from `LiveMatchStateService`, while purchase legality continues to rely on the existing verified `spendableSouls` fact in the ML-neutral recommendation core state.

### Evidence freshness behavior

A dataset can be stale but usable. Staleness reduces confidence and therefore makes aggressive deviations, especially SELL/core replacement, harder. `PATCH_MISMATCH` is different: affected contextual terms are disabled, not merely discounted.

### Active-hero refresh behavior

Global patch, exact-enemy, and T4 datasets refresh on their own TTL. Top-10 leaderboard/profile work is scoped to heroes that are currently requested or were recently active. A recommendation request may enqueue a missing hero refresh, but it proceeds immediately using existing evidence or conservative fallback.

### Primary runtime cutover

The implementation does not delete old analysis endpoints or ML8 code. The cutover is defined by the Overwolf live client and the new adaptive controller using the new coordinator. ML8 remains available for offline/admin work but is not a fallback for V1.

## Completion Criteria

Implementation is complete only when all of the following are true:

1. The primary Overwolf runtime calls the adaptive V1 endpoint.
2. No adaptive recommendation request waits for Chromium.
3. Statlocker snapshots persist and recover after API restart.
4. Top-10 consensus skeletons are available for active heroes and remain soft-protected.
5. Team state uses total team souls with the approved ±8% threshold.
6. Exact enemy evidence uses confidence shrinkage, top-three aggregation, and a bounded contribution.
7. T4 chain evidence influences trajectory scoring.
8. Planner returns a full ordered build plus immediate action and supports guarded SELL/REPLACE.
9. Final deterministic legality runs after planning.
10. Failed refresh keeps the last valid snapshot.
11. Patch mismatch disables mismatched contextual evidence.
12. Decisions store sufficient data for deterministic replay.
13. Scenario/invariant tests pass.
14. Full shared/build-domain/API/Overwolf test and build commands pass.
15. Production Docker image contains Chromium, Puppeteer Core, and build-domain runtime artifacts.
16. ML8 source remains in the repository but is absent from the primary adaptive serving flow.
