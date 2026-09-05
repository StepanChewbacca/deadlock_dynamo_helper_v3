# Strategy-First Production-Ready Handoff Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish PR #76 from its current implemented-but-not-executably-verified state to production-ready strategy-first serving without weakening any correctness invariant.

**Architecture:** Keep the implemented strategy-first architecture. Do not restart the project, tune item scores as a substitute for semantics, or reintroduce ConsensusSkeleton as the global plan source of truth. The remaining work is historical-data provenance correctness, bounded mining data access, executable verification, migration rehearsal, real-data validation, shadow evidence, and release review.

**Tech Stack:** TypeScript 5.9, NestJS 11, Yarn 1 workspaces, Jest/ts-jest, PostgreSQL/TypeORM, Docker, Overwolf client, `@deadlock-live-probe/build-domain`.

**Spec:** `CURRENT-ROADMAP.md`

## Current handoff state

Repository: `StepanChewbacca/deadlock_dynamo_helper_v2`

Branch: `agent/strategy-first-build-planner`

Draft PR: `#76 Strategy-first build planner`

Known head before this handoff document: `47f54bf17cd1186f433c7e2dde008e996086342f`.

The implementation already contains strategy specs/contracts, archetype mining, feasibility, selector/session, slot planning, investment planning, situational overlay, strategy-first serving facade/router, persistent hero+patch+ruleset+catalog snapshots, hard runtime invariants, shared/UI output, promotion gating, and tests for those areas. Do not redo those subsystems unless verification exposes a defect.

The latest CI attempt did not execute any job steps: all four jobs failed with an empty `steps` array and no runner. Treat CI as **not executed**, not as a code/test failure and not as a passing signal.

## Global constraints

- Exact inventory remains exact. Consumed components are never reinserted.
- `RecommendationItemGraph` is the only source of transitive component/upgrade satisfaction.
- `RecommendationCandidate.feasible` remains transaction/game legality.
- `recommendationEligible` remains deterministic recommendation policy eligibility.
- Strategy code may select/filter/rank canonical actions but may not synthesize a transaction outside the candidate generator.
- `HOLD`/`WAIT` never imply `COMPLETE` while mandatory obligations remain.
- No hero-name/item-name production special cases.
- Unknown economy/catalog/ruleset evidence must fail closed where correctness depends on it.
- Do not use outcome/win as an archetype clustering feature.
- Do not merge multiple archetypes into a synthetic average strategy.
- Keep `ConsensusSkeleton` only as migration fallback/evidence prior until promotion is proven.
- Dataset/ML/BuildLM code does not own slot, recipe, branch, lineage, or completion semantics.
- Production code comments must be English.
- Do not declare production-ready until every verification gate in this document has observed output.

---

## Task 1 - Fix historical trajectory provenance before any more mining

**Why this is mandatory:** `HistoricalBuildTrajectorySourceV2Service` currently loads historical `MatchPlayer` rows and stamps the mining request's current `patchId`, `rulesetId`, and `catalogSha256` onto them. A historical match from another client/ruleset can therefore contaminate the current archetype if its per-match provenance is not checked first.

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/historical-build-trajectory-source-v2.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/build-strategy-mining-pipeline-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-operations-v1.service.ts`
- Modify if needed for DI only: `apps/api/src/statlocker-adaptive/statlocker-adaptive.module.ts`
- Test: `apps/api/test/historical-build-trajectory-source-v2.spec.ts`
- Test: `apps/api/test/build-strategy-mining-pipeline-v1.spec.ts`
- Test: `apps/api/test/strategy-first-operations-v1.spec.ts`
- Reuse: `apps/api/src/deadlock-live/ruleset-resolver.service.ts`
- Reuse: `apps/api/src/deadlock-live/entities/recommendation-item-catalog-version-v1.entity.ts`

**Required contract:**

```ts
export interface HistoricalBuildTrajectorySourceV2Input {
  heroId: number;
  patchId: string; // Strategy/Statlocker evidence scope, not proof of match client version.
  rulesetId: string;
  catalogSha256: string;
  catalogClientVersion: number;
  itemGraph: RecommendationItemGraph;
  economyRules: RecommendationEconomyRulesV1;
  limit?: number;
}
```

Use `RulesetResolverService.getLatestForMatch(matchId)` before constructing each trajectory.

Accepted match provenance for production mining:

```text
resolution method = OBSERVED or DEMO_METADATA
resolved ruleset key = requested rulesetId
resolved client version = requested catalogClientVersion
exact recommendation catalog mapping for rulesetId + clientVersion is unambiguous
```

`TIME_WINDOW` and `UNKNOWN` are not accepted for production archetype mining. Do not silently relax this if sample size becomes small. Backfill/collect stronger metadata instead.

`catalogSha256` is not directly present in match metadata. Therefore `StrategyFirstOperationsV1Service` must first resolve the requested exact `RecommendationItemCatalogVersionV1`, require a positive `clientVersion`, and verify that `(rulesetKey, clientVersion)` does not map to multiple distinct recommendation catalog SHA256 values. If ambiguous, mining must fail closed before loading trajectories.

Recommended reason codes:

```text
HISTORICAL_PROVENANCE_MISSING
HISTORICAL_PROVENANCE_NOT_EXACT
HISTORICAL_RULESET_MISMATCH
HISTORICAL_CLIENT_VERSION_MISMATCH
EXACT_CATALOG_CLIENT_VERSION_UNAVAILABLE
AMBIGUOUS_CATALOG_CLIENT_VERSION
```

- [ ] **Step 1: Write failing source tests before changing production code.**

Add cases proving:

```text
OBSERVED + matching ruleset/clientVersion -> accepted
DEMO_METADATA + matching ruleset/clientVersion -> accepted
TIME_WINDOW -> rejected
UNKNOWN -> rejected
no raw metadata / resolver cannot resolve -> rejected
matching clientVersion + wrong ruleset -> rejected
matching ruleset + wrong clientVersion -> rejected
```

Every rejected row must retain `matchId`, `playerKey`, and an explicit diagnostic code.

- [ ] **Step 2: Run the focused source test and observe RED.**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/historical-build-trajectory-source-v2.spec.ts
```

Expected before implementation: at least one new provenance regression fails.

- [ ] **Step 3: Implement provenance validation using the existing resolver.**

Do not duplicate ruleset parsing logic. Inject/reuse `RulesetResolverService`. Catch missing/unresolvable metadata and convert it to an explicit trajectory rejection instead of failing the entire hero mining run.

- [ ] **Step 4: Pass exact catalog client version through operations -> pipeline -> source.**

Change `loadExactGraph()` into an exact catalog identity loader, for example:

```ts
interface ExactStrategyCatalogIdentityV1 {
  graph: RecommendationItemGraph;
  clientVersion: number;
}
```

Validate the requested SHA, ruleset key, positive client version, and client-version mapping ambiguity before returning it.

- [ ] **Step 5: Add operations/pipeline tests.**

Prove that missing client version and ambiguous catalog mapping produce fail-closed mining results, not a published snapshot.

- [ ] **Step 6: Run the three focused suites and observe GREEN.**

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/historical-build-trajectory-source-v2.spec.ts \
  test/build-strategy-mining-pipeline-v1.spec.ts \
  test/strategy-first-operations-v1.spec.ts
```

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/statlocker-adaptive apps/api/test
git commit -m "fix: verify historical mining provenance"
```

---

## Task 2 - Remove the per-match peer-query scaling hazard

**Why this is production work:** current historical loading caches peer rows, but still issues up to one `MatchPlayer` query per distinct match. With a default mining limit up to 10,000 target traces this can become thousands of database round trips.

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/historical-build-trajectory-source-v2.service.ts`
- Test: `apps/api/test/historical-build-trajectory-source-v2.spec.ts`

**Target design:**

- Load target hero rows once.
- Collect unique `matchId`s.
- Fetch peers in bounded chunks using `In(matchIds)`; use a chunk size such as 500.
- Group peers by `matchId` in memory.
- Do not fetch item-purchase relations for peer rows when only `id`, `matchId`, `heroId`, and `team` are needed.
- Preserve deterministic ally/enemy sorting.

- [ ] **Step 1: Add a regression test with multiple target matches that asserts peer loading is batched rather than one query per match.**
- [ ] **Step 2: Observe RED.**
- [ ] **Step 3: Implement chunked peer loading.**
- [ ] **Step 4: Observe GREEN and confirm output is byte-for-byte deterministic for equivalent input.**
- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/statlocker-adaptive/historical-build-trajectory-source-v2.service.ts \
  apps/api/test/historical-build-trajectory-source-v2.spec.ts
git commit -m "perf: batch historical mining peer loads"
```

---

## Task 3 - Add mining rejection observability

**Why:** production operators need to distinguish `no data` from `all data rejected because provenance is weak`.

**Files:**
- Modify: `apps/api/src/statlocker-adaptive/historical-build-trajectory-source-v2.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/build-strategy-mining-pipeline-v1.service.ts`
- Modify: `apps/api/src/statlocker-adaptive/strategy-first-operations-v1.service.ts`
- Modify if output type needs it: `apps/api/src/statlocker-adaptive/adaptive-recommendation-v1.controller.ts`
- Test corresponding source/pipeline/operations specs.

Add deterministic rejection counts by diagnostic code to the mining result/status. Do not expose raw match payloads or personal player data.

Example shape:

```ts
rejectionReasonCounts: Readonly<Record<string, number>>;
```

- [ ] Tests prove counts are deterministic and sum to `rejectedTraceCount`.
- [ ] `/deadlock/adaptive/v1/status` exposes the latest mining result with the rejection breakdown through `strategyOperations`.
- [ ] A hero with zero accepted trajectories reports `NO_ACCEPTED_HISTORICAL_TRAJECTORIES` plus the underlying rejection distribution.

Commit:

```bash
git add apps/api/src/statlocker-adaptive apps/api/test
git commit -m "feat: expose strategy mining rejection diagnostics"
```

---

## Task 4 - Rehearse and verify strategy snapshot migrations on a disposable PostgreSQL database

**Files to verify, not rewrite unless a test fails:**
- `apps/api/src/database/migrations/1788568800000-create-build-strategy-snapshots-v1.ts`
- `apps/api/src/database/migrations/1788568860000-create-recommendation-economy-rules-snapshots-v1.ts`
- `apps/api/src/database/migrations/1788568920000-scope-build-strategy-snapshots-by-hero-v1.ts`
- `apps/api/src/deadlock-live/entities/build-strategy-snapshot-v1.entity.ts`
- `apps/api/src/statlocker-adaptive/build-strategy-snapshot-store-v1.service.ts`

The hero-scope migration intentionally deletes old prototype rows with `heroId IS NULL`; those are derived artifacts and must be re-mined. Verify that this is acceptable on the target deployment database before rollout.

- [ ] Start a disposable PostgreSQL 16 instance.
- [ ] Run migrations from a schema matching the current production migration history.
- [ ] Verify `heroId` is NOT NULL and the scope index is present.
- [ ] Verify old prototype rows are deleted exactly as intended.
- [ ] Publish snapshots for two heroes in the same ruleset/patch/catalog scope and verify both stay active.
- [ ] Restart/hydrate the store and verify both heroes are restored independently.
- [ ] Revert the new migrations on the disposable DB, then run them forward again.

Commands:

```bash
yarn db:migrations
yarn db:migrate
yarn db:revert
yarn db:migrate
```

For Docker-based local Postgres, prefix Docker commands with `sudo`.

Commit only if the rehearsal exposes a migration defect. Otherwise record the observed output in the PR/release notes.

---

## Task 5 - Execute the focused strategy-first test matrix

Do not skip this because files already contain tests. Most of the current branch was written without an executable runner in the previous agent session.

- [ ] Run historical/mining/persistence tests:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/planner-trajectory-v2.spec.ts \
  test/planner-trajectory-builder-v2.spec.ts \
  test/historical-planner-trajectory-extractor-v2.spec.ts \
  test/historical-build-trajectory-source-v2.spec.ts \
  test/build-archetype-features-v1.spec.ts \
  test/build-archetype-miner-v1.spec.ts \
  test/build-strategy-mining-pipeline-v1.spec.ts \
  test/build-strategy-snapshot-store-v1.spec.ts \
  test/build-strategy-registry-v1.spec.ts \
  test/strategy-first-operations-v1.spec.ts
```

- [ ] Run strategy semantic tests:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/build-strategy-v1.spec.ts \
  test/build-strategy-validator-v1.spec.ts \
  test/build-strategy-compiler-v1.spec.ts \
  test/build-strategy-feasibility-v1.spec.ts \
  test/build-strategy-feasibility-branches-v1.spec.ts \
  test/build-strategy-all-branches-feasibility-v1.spec.ts \
  test/build-strategy-hard-investment-feasibility-v1.spec.ts \
  test/build-strategy-selector-v1.spec.ts \
  test/build-strategy-session-v1.spec.ts \
  test/build-contract-v1.spec.ts \
  test/build-slot-planner-v1.spec.ts \
  test/build-investment-policy-v1.spec.ts \
  test/build-situational-resolver-v1.spec.ts
```

- [ ] Run serving/invariant/replay tests:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/strategy-first-build-planner-v1.spec.ts \
  test/strategy-first-adaptive-planner-facade-v1.spec.ts \
  test/strategy-first-invariants-v1.spec.ts \
  test/strategy-first-runtime-continuity-v1.spec.ts \
  test/strategy-first-situational-integration-v1.spec.ts \
  test/strategy-first-slot-blocked-v1.spec.ts \
  test/strategy-first-promotion-gate-v1.spec.ts \
  test/adaptive-planner-serving-router-v1.spec.ts \
  test/adaptive-replay-strategy-context-v1.spec.ts \
  test/adaptive-replay-previous-context-v1.spec.ts \
  test/adaptive-recommendation-inventory-delta-v1.spec.ts \
  test/adaptive-recommendation-lineage-rebase-v1.spec.ts
```

- [ ] Run exact economy and lineage regressions:

```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath \
  test/adaptive-economy-v1.spec.ts \
  test/adaptive-decision-state-v1.spec.ts \
  test/adaptive-build-planner-v1.spec.ts

yarn workspace @deadlock-live-probe/build-domain test
```

Any failure must be root-caused with `superpowers:systematic-debugging`; do not patch tests to match broken behavior.

---

## Task 6 - Execute the same full build/test/runtime gates as CI

The current GitHub Actions run failed before runner steps, so these gates still have no executable evidence.

- [ ] Install exactly as CI does:

```bash
yarn install --frozen-lockfile --ignore-engines
```

- [ ] Build shared + all workspaces:

```bash
yarn workspace @deadlock-live-probe/shared build
OVERWOLF_PUBLIC_TARGET=/tmp/overwolf-client/public yarn build
```

- [ ] Run complete tests and serving audit:

```bash
yarn workspace @deadlock-live-probe/shared test
node scripts/statlocker-adaptive-serving-audit.mjs
yarn workspace @deadlock-live-probe/build-domain test
yarn workspace @deadlock-live-probe/api test
yarn workspace @deadlock-live-probe/api test adaptive-replay-structured-v1.spec.ts
yarn workspace @deadlock-live-probe/overwolf-client test
```

- [ ] Build Overwolf client explicitly:

```bash
OVERWOLF_PUBLIC_TARGET=/tmp/overwolf-client/public \
  yarn workspace @deadlock-live-probe/overwolf-client build
```

- [ ] Run production DB migration integration with PostgreSQL 16 using the same environment expected by CI.

```bash
DB_MIGRATION_INTEGRATION=true \
DB_HOST=127.0.0.1 \
DB_PORT=5432 \
DB_USER=postgres \
DB_PASSWORD=postgres \
DB_NAME=deadlock_builds \
  yarn workspace @deadlock-live-probe/api test production-database-migration.integration.spec.ts
```

- [ ] Validate Compose and production image locally:

```bash
DB_PASSWORD=ci-placeholder \
DEADLOCK_API_KEY=ci-placeholder \
DEADLOCK_API_IMAGE=deadlock-adaptive-production:ci \
  sudo docker compose -p deadlock-ci config >/dev/null

sudo docker build -t deadlock-adaptive-production:ci .

sudo docker run --rm --entrypoint sh deadlock-adaptive-production:ci -c \
  'test -x "$CHROMIUM_PATH" && node -e "require(\"puppeteer-core\"); require(\"@deadlock-live-probe/build-domain\")"'
```

All commands must exit 0. Capture actual output or logs. Do not infer success from code inspection.

---

## Task 7 - Run real-data strategy mining validation before promotion

Use a staging copy or production-like database. Do not mutate production strategy mode during this task.

For at least 3 heroes with meaningful recent match volume:

- [ ] Resolve exact current `rulesetId + catalogSha256 + catalogClientVersion`.
- [ ] Confirm exact economy rules are available for the same ruleset/catalog.
- [ ] Mine each hero independently.
- [ ] Confirm accepted traces all have exact provenance under Task 1 policy.
- [ ] Inspect `rejectionReasonCounts`; no accepted trajectory may come from `TIME_WINDOW`, `UNKNOWN`, wrong ruleset, or wrong client version.
- [ ] Confirm more than one hero snapshot coexists for the same patch/ruleset/catalog when multiple heroes publish.
- [ ] Restart the API and confirm active snapshot hydration restores those heroes.
- [ ] Confirm strategy lookup is patch-aware: a snapshot from patch A is not served under patch B.
- [ ] Confirm catalog/ruleset mismatch returns no strategy snapshot rather than selecting a near match.
- [ ] Record source trace count, rejection count/reasons, noise share, archetype count, strategy count, support, and stability for every tested hero.

Do not weaken provenance or clustering thresholds just to force a snapshot to publish. If data is insufficient, keep serving in legacy/shadow and fix data collection/backfill.

---

## Task 8 - Re-run the original upgrade-lineage incident through strategy-first serving

PR #75 lineage behavior remains a mandatory invariant.

Use the actual current catalog IDs for High-Velocity Rounds and Opening Rounds.

- [ ] Confirm the catalog graph contains `Opening Rounds -> High-Velocity Rounds` as a component relation.
- [ ] With Opening Rounds already owned, High-Velocity Rounds must not appear as actionable BUY, targeted WAIT, NEXT, or PLANNED.
- [ ] Confirm a topology-known recipe with unknown executable upgrade price still satisfies lineage without fabricating an `UPGRADE_ITEM` transaction.
- [ ] Confirm strategy-first planning does not bypass `recommendationEligible` or shared graph satisfaction.

Zero required regressions:

```text
redundant ancestor recommendation = 0
lineage downgrade recommendation = 0
satisfied target as NEXT = 0
satisfied target as targeted WAIT = 0
nextAction/build mismatch = 0
illegal action = 0
```

---

## Task 9 - Golden replay/property release gate

The following hard strategy-first metrics must all be exactly zero over the golden/replay release set:

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

The golden set must include at least:

1. incomplete build + HOLD;
2. full slots + remaining core;
3. full slots + legal upgrade;
4. full slots + replacement;
5. future item waits for flex;
6. consumed component satisfied by owned descendant;
7. two archetypes sharing early items;
8. committed branch;
9. player divergence;
10. no fitting strategy -> OOD;
11. urgent situational interrupt;
12. weak situational signal -> continue core;
13. hard investment objective beats minor optional item;
14. strategy intentionally ignores a later breakpoint;
15. temporary item exits under slot pressure.

If any hard rate is non-zero, promotion is blocked regardless of recommendation quality anecdotes.

---

## Task 10 - Shadow serving evidence and controlled promotion

Default production mode remains `SHADOW` until evidence is collected.

- [ ] Set/confirm:

```text
ADAPTIVE_STRATEGY_PLANNER_MODE=SHADOW
ADAPTIVE_STRATEGY_PROMOTION_APPROVED=false
```

- [ ] Collect at least the configured `ADAPTIVE_STRATEGY_PROMOTION_MIN_DECISIONS` comparisons (default 100) with no shadow runtime failure.
- [ ] Confirm all hard release metrics remain zero.
- [ ] Inspect strategy/posterior stability, committed-switch frequency, OOD rate, HOLD-while-incomplete behavior, slot plan feasibility, situational frequency, and next-action alignment.
- [ ] Do not promote merely because the new recommendation “looks better.” Promotion is based on deterministic gates plus shadow stability.
- [ ] Only after approval set `ADAPTIVE_STRATEGY_PROMOTION_APPROVED=true` and `ADAPTIVE_STRATEGY_PLANNER_MODE=STRATEGY`.
- [ ] Verify the router still falls back to legacy when `economyRulesEvidence !== RECONSTRUCTED`.
- [ ] Verify invariant failures fail closed to HOLD/REPLAN_REQUIRED and do not leak an illegal strategy action.

---

## Task 11 - Final static review of the 94-file PR diff

Use `superpowers:requesting-code-review` or an equivalent fresh-agent review.

Review specifically for:

- stale constructor fixtures after interface expansion;
- unsafe `as any` added by strategy-first work;
- silent exact-evidence fallbacks;
- hero/patch/catalog snapshot scope mismatch;
- code paths that bypass `RecommendationItemGraph` satisfaction;
- code paths that rank `feasible=false` or `recommendationEligible=false` candidates;
- strategy-generated transactions not present in canonical candidates;
- completion from HOLD/WAIT;
- branch alternatives leaking after commitment;
- full-slot future purchases with no exit transition;
- situational items without a declared strategy window;
- outcome/win entering archetype features;
- non-deterministic iteration/hash/order behavior;
- N+1 or unbounded DB loops in scheduled mining;
- logging of sensitive/raw match payloads;
- migration/entity drift;
- replay/shared/Overwolf contract mismatch.

Every substantive finding gets a regression test before its fix.

---

## Task 12 - Final release procedure

- [ ] Rebase/merge latest `main` into the feature branch only if required by repository policy; resolve conflicts without dropping PR #75 lineage behavior.
- [ ] Re-run Tasks 5, 6, and 9 on the final head SHA after the last code change.
- [ ] Re-run CI once GitHub Actions actually allocates runners. Required jobs:

```text
Build project = success
Build Overwolf client = success
Run tests = success
Validate production runtime = success
```

A workflow run with empty job `steps` is infrastructure-not-executed and does not satisfy this gate.

- [ ] Record the exact verified head SHA and test commands/results in PR #76.
- [ ] Mark the PR ready for review only after all hard gates are green.
- [ ] Use `superpowers:verification-before-completion` before claiming done.
- [ ] Use `superpowers:finishing-a-development-branch` to decide merge strategy.
- [ ] Do not merge/deploy without explicit owner authorization.

## Definition of production-ready

PR #76 is production-ready only when all of the following are simultaneously true:

```text
historical match provenance cannot contaminate current mining scope
catalog/ruleset/client-version ambiguity fails closed
historical peer loading is bounded/batched
multi-hero + multi-patch snapshots coexist and hydrate correctly
exact economy rules gate strategy serving
all focused tests pass
all workspace tests pass
all builds pass
migration integration passes
production image/runtime dependency checks pass
real-data mining has reviewed rejection/noise/stability diagnostics
original upgrade-lineage incident stays fixed
all hard strategy-first invariant rates are 0
shadow sample minimum is met with 0 shadow runtime failures
final code review has no unresolved correctness findings
CI has actually executed and all required jobs are green
verified final head SHA is recorded
```

Anything less is still pre-production/shadow state.
