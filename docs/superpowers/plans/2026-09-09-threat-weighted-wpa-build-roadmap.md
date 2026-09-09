# Threat-weighted WPA build implementation roadmap

> Implementation plan for the approved hybrid architecture. This document is intentionally detailed and test-first. The branch containing this roadmap changes documentation only.

**Goal:** evolve the current strategy-first adaptive planner so it returns one coherent build whose structure comes from consensus/skeleton evidence while branch, optional, situational, and exceptional wildcard choices adapt to the exact enemy draft using Statlocker `VS_HERO_WPA` weighted by live enemy threat.

**Architecture:** preserve the existing strategy-first facade, strategy contract, item graph, transaction planner, and fail-closed invariants. Add four explicit layers: richer matchup evidence, live enemy threat, threat-weighted matchup aggregation/candidate discovery, and whole-build utility. Reuse existing situational target types and Overwolf `againstLabel` plumbing instead of creating parallel concepts.

**Tech stack:** NestJS/TypeScript API, Jest, shared TypeScript contracts, Overwolf TypeScript/webpack client, existing Statlocker browser collector/normalizer/evidence store, existing build-domain recommendation graph.

## Implementation principles

1. TDD for every behavior change: write failing focused test, run it, implement minimum behavior, run focused test, then run affected suite.
2. Do not revive the legacy planner. All final integration goes through `strategy-first-adaptive-planner-facade-v1.service.ts`.
3. Hard constraints are never compensated by high WPA. Catalog legality, hard-core contract, transaction feasibility, and inventory correctness stay fail closed.
4. Keep all policy thresholds named/configurable.
5. Keep decision math auditable. Every selected/rejected matchup candidate must be explainable from structured components and reason codes.
6. Preserve a neutral fallback path: when new matchup/threat evidence is unavailable, behavior collapses toward the existing skeleton-driven plan.
7. Roll out behind a policy/version flag and shadow evaluation before replacing the current production decision path.

---

# Milestone 0 - Lock down evidence semantics and regression fixtures

## Task 0.1 - Add a real `VS_HERO_WPA` fixture from the verified live shape

**Create:**
- `apps/api/test/fixtures/statlocker-vs-hero-wpa-v1.json`

**Modify:**
- `apps/api/test/statlocker-normalizer.spec.ts` or the current normalizer-specific test file if named differently after branch start.

**Fixture requirements:**
- at least two rank buckets;
- our hero with at least three items;
- at least three enemy heroes;
- `_baseline` entry;
- `mean_wpa`, `count`, `delta_wpa` leaves;
- one very large delta with tiny sample;
- one moderate delta with strong sample;
- one negative matchup.

**RED:** add tests proving the current normalizer intentionally aggregates `count`/`deltaWpa` across rank buckets and currently loses rank/`mean_wpa`.

**Run:**
```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/statlocker-normalizer.spec.ts
```

**GREEN:** no production behavior change yet. The test documents the current baseline and gives later schema changes a stable raw fixture.

**Commit:**
```bash
git commit -m "test: capture vs hero WPA raw fixture"
```

## Task 0.2 - Verify Statlocker field semantics before using `mean_wpa`

This is an evidence task, not speculative coding.

**Investigate:**
- official Statlocker WPA documentation/changelog if available;
- raw `_baseline` object from the endpoint;
- exact relationship between `mean_wpa`, `delta_wpa`, and `_baseline`.

**Document:**
- `docs/statlocker-vs-hero-wpa-semantics.md`

The document must explicitly classify each field as VERIFIED, INFERRED, or UNKNOWN.

**Gate:** until semantics are VERIFIED, `mean_wpa` is retained in normalized evidence for observability only and is not added to matchup utility. Existing base WPA continues to provide general item quality.

## Task 0.3 - Remove threshold ambiguity before adding new policy

Current code has overlapping situational improvement concepts, including the resolver default and adaptive config. Make one source authoritative before the new pipeline depends on it.

**Modify:**
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`
- `apps/api/src/statlocker-adaptive/build-situational-resolver-v1.service.ts`
- `apps/api/src/statlocker-adaptive/strategy-first-situational-overlay-v1.service.ts`

**Test:**
- `apps/api/test/adaptive-config-v1.spec.ts`
- add/update `apps/api/test/build-situational-resolver-v1.spec.ts`

**RED:** prove resolver receives the configured threshold instead of silently using an unrelated hardcoded default.

**GREEN:** pass one canonical config value through the caller.

---

# Milestone 1 - Preserve richer matchup evidence

## Task 1.1 - Define a richer normalized matchup type without breaking existing readers

**Modify:**
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.types.ts`

**Add conceptually:**
```ts
interface StatlockerVsHeroItemEvidenceV2 {
  itemId: number;
  deltaWpa: number;
  count: number;
  meanWpa?: number;
  rankBreakdown?: readonly StatlockerVsHeroRankEvidenceV2[];
}
```

Do not force every caller onto rank-aware scoring yet.

**Required semantics:**
- aggregate `deltaWpa/count` remains available for current scorer compatibility;
- rank-specific rows remain available for future policy;
- raw `meanWpa` may be retained only when safely parseable;
- `_baseline` is preserved separately only if its semantics are understood enough to name correctly; otherwise keep it out of scoring.

## Task 1.2 - Update normalizer to preserve rank while keeping aggregate compatibility

**Modify:**
- `apps/api/src/statlocker-adaptive/statlocker-normalizer.service.ts`

**Test:**
- `apps/api/test/statlocker-normalizer.spec.ts`

**RED cases:**
1. two ranks for same hero/enemy/item stay distinguishable;
2. aggregate count is still sum of rank counts;
3. aggregate delta is still count-weighted, preserving current behavior;
4. `mean_wpa` is retained but not synthesized if missing;
5. invalid/non-numeric rows are ignored deterministically;
6. `_baseline` is not treated as an enemy hero.

**GREEN:** implement the richer representation.

**Run:**
```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/statlocker-normalizer.spec.ts
yarn workspace @deadlock-live-probe/api build
```

## Task 1.3 - Evidence store compatibility

**Modify only if required by serialization/type boundaries:**
- `apps/api/src/statlocker-adaptive/statlocker-evidence.service.ts`
- snapshot/entity serializers that persist normalized payloads.

**Test:** verify an older aggregate-only payload still scores and a richer payload is accepted.

**Acceptance:** no current recommendation path changes solely because richer evidence exists.

---

# Milestone 2 - Carry individual live enemy state into adaptive planning

## Task 2.1 - Add a typed enemy live-state contract

**Modify:**
- `apps/api/src/statlocker-adaptive/adaptive-decision-state-v1.service.ts`

**Add:**
```ts
interface AdaptiveEnemyLiveStateV1 {
  steamId: string;
  heroId: number;
  heroName?: string;
  level?: number;
  souls?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  heroDamage?: number;
}
```

Keep optional fields optional because GEP/live observations can be incomplete.

**Do not copy:** healing/object damage into threat v1 unless a concrete threat component needs them. Avoid YAGNI.

## Task 2.2 - Populate enemy live state from canonical roster

**Modify:**
- `apps/api/src/statlocker-adaptive/adaptive-decision-state-v1.service.ts`

**Test:**
- `apps/api/test/adaptive-decision-state-v1.spec.ts`

**RED cases:**
1. enemy hero identity + observed K/D/A/souls/level/heroDamage are copied;
2. allies are excluded;
3. local player is excluded;
4. missing metrics remain undefined, not zero;
5. ordering is stable/deterministic.

**GREEN:** add `enemyLiveStates` to `AdaptiveDecisionStateV1`.

**Run:**
```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/adaptive-decision-state-v1.spec.ts
```

---

# Milestone 3 - Build deterministic Enemy Threat V1

## Task 3.1 - Create threat scorer

**Create:**
- `apps/api/src/statlocker-adaptive/enemy-threat-v1.service.ts`
- `apps/api/test/enemy-threat-v1.spec.ts`

**Modify:**
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`

**Inputs:**
- enemy live states;
- enemy-team totals/medians that can be computed from those states;
- game time if a component requires time normalization.

**Components for V1:**
- economic share from souls;
- combat-output share from hero damage;
- kill pressure from kills + assists relative to team activity;
- death pressure as a bounded negative component;
- level position relative to enemy team / match where reliable;
- evidence completeness.

**Output:**
- per-enemy raw score;
- normalized score;
- bounded weight;
- confidence/completeness;
- component breakdown and reason codes.

**RED cases:**
1. a clearly fed/high-output enemy gets a higher weight than a far-behind enemy;
2. KDA alone does not dominate when souls/damage contradict it;
3. missing all individual stats returns neutral weight `1`, not `0`;
4. one absurd metric cannot exceed configured clamp;
5. identical snapshots produce byte-stable ordering/results;
6. no NaN/Infinity can leave the service.

**Policy:** exact numeric weights/clamps start conservative and named in config. Do not hide constants in the service.

**Run:**
```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/enemy-threat-v1.spec.ts
```

## Task 3.2 - Add threat smoothing state only after the snapshot scorer is correct

Do not mix smoothing into the pure scorer.

**Create:**
- `apps/api/src/statlocker-adaptive/enemy-threat-history-v1.service.ts`
- `apps/api/test/enemy-threat-history-v1.spec.ts`

**Behavior:**
- keyed by match + enemy hero/player identity;
- bounded EMA or another explicitly configured deterministic smoother;
- TTL cleanup when match becomes inactive;
- neutral on first observation;
- no persistent DB requirement for V1 unless restart continuity is explicitly required later.

**RED:** threat does not jump from neutral to max after one noisy snapshot if smoothing is enabled.

---

# Milestone 4 - Threat-weighted matchup aggregation across the full enemy draft

## Task 4.1 - Add a pure matchup aggregation service

**Create:**
- `apps/api/src/statlocker-adaptive/threat-weighted-matchup-v1.service.ts`
- `apps/api/test/threat-weighted-matchup-v1.spec.ts`

**Inputs:**
- our hero ID;
- item ID;
- all observed enemy hero IDs;
- normalized `VS_HERO_WPA` slices;
- `EnemyThreatScoreV1` by enemy;
- matchup config.

**For every enemy with evidence calculate:**
- raw `deltaWpa`;
- sample size;
- shrink confidence;
- normalized matchup signal;
- threat weight;
- final contribution;
- contribution priority for explanation only.

**Important:** do not truncate to top 3 for the draft aggregate. All observed enemies with evidence contribute.

**Output concept:**
```ts
interface ThreatWeightedMatchupScoreV1 {
  itemId: number;
  aggregate: number;
  confidence: number;
  coverage: number;
  positiveTargetHeroIds: readonly number[];
  negativeTargetHeroIds: readonly number[];
  contributions: readonly ThreatWeightedEnemyContributionV1[];
}
```

**RED cases:**
1. moderate positive value against several meaningful threats can beat a narrow item;
2. a single fed enemy can make a strong matchup against that enemy more important;
3. bounded threat prevents one enemy from completely dwarfing the draft;
4. huge positive raw delta with `n=12` loses confidence versus smaller well-supported evidence;
5. negative matchup against the primary threat materially hurts the aggregate;
6. no live threat data is equivalent to neutral enemy weighting;
7. partial enemy evidence reports lower coverage rather than inventing missing rows;
8. all six enemy rows are present in trace when available.

**Run:**
```bash
yarn workspace @deadlock-live-probe/api test --runTestsByPath test/threat-weighted-matchup-v1.spec.ts
```

## Task 4.2 - Expose matchup aggregate as an auditable scorer component

**Modify:**
- `apps/api/src/statlocker-adaptive/adaptive-evidence-scorer-v1.service.ts`
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`
- `apps/api/test/adaptive-evidence-scorer-v1.spec.ts`

**Plan:**
- add `draftMatchupFit` as a new component or version the scorer cleanly;
- keep `exactEnemyFit` during compatibility/shadow period if other paths depend on it;
- do not double count both in production final utility without an explicit policy;
- scorer context gets threat scores or the precomputed matchup score, not raw mutable state.

**RED:** prove fed enemy weighting changes `draftMatchupFit` while baseline/skeleton components remain unchanged.

---

# Milestone 5 - Make core rigidity an explicit planner concept

## Task 5.1 - Canonicalize hard core / soft core / flex mapping

**Modify:**
- `apps/api/src/statlocker-adaptive/build-strategy-v1.ts`
- `apps/api/src/statlocker-adaptive/build-strategy-compiler-v1.service.ts`
- strategy miner if needed: `apps/api/src/statlocker-adaptive/build-strategy-miner-v1.service.ts`

**Preferred model:** add an explicit rigidity enum/property rather than relying on several partially overlapping fields.

```ts
type BuildGoalRigidityV1 = 'HARD_CORE' | 'SOFT_CORE' | 'FLEX';
```

Existing lifecycle/goal type still describes lifecycle/role. Rigidity describes how difficult the goal is to displace.

**Test:**
- create `apps/api/test/build-strategy-rigidity-v1.spec.ts`
- update strategy compiler tests.

**RED cases:**
1. strongest structural core maps to `HARD_CORE` deterministically;
2. common but non-structural core maps to `SOFT_CORE`;
3. situational/optional candidates map to `FLEX`;
4. current mandatory branch semantics are preserved;
5. old strategy records without the new field resolve through a deterministic compatibility rule.

## Task 5.2 - Enforce hard core as a constraint

**Modify:**
- `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- invariant helpers/tests.

**Test:**
- `apps/api/test/adaptive-build-planner-strategy-contract-v1.spec.ts`

**RED:** a candidate plan with fantastic matchup score still cannot silently drop an unsatisfied hard-core commitment.

---

# Milestone 6 - Resolve OR / CHOICE using current draft evidence

## Task 6.1 - Add branch-option contextual evaluation

**Modify:**
- `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- `apps/api/src/statlocker-adaptive/adaptive-choice-resolver-v1.service.ts` if this remains the canonical branch helper.

**Test:**
- `apps/api/test/adaptive-choice-resolver-v1.spec.ts`
- `apps/api/test/adaptive-choice-k-of-n-v1.spec.ts`
- `apps/api/test/adaptive-committed-choice-replacement-v1.spec.ts`

**Behavior:**
- only declared branch alternatives compete in the normal branch resolver;
- use threat-weighted draft matchup score + existing base/skeleton/chain/timing/economy evidence;
- select exactly K options required by the branch;
- final current build contains only the selected branch, not every alternative.

**RED cases:**
1. same skeleton, different enemy draft -> different branch winner where evidence justifies it;
2. same draft, fed target change -> winner can change if material;
3. low-sample matchup spike cannot force branch switch;
4. committed choice requires a larger improvement before replacement;
5. ties remain deterministic.

## Task 6.2 - Keep wildcard logic out of normal branch semantics

No code should mutate `optionGoalIds` dynamically just to fit a WPA winner. Outside-skeleton items enter through the controlled discovery/escape path in Milestone 7.

---

# Milestone 7 - WPA-driven situational discovery and controlled wildcard escape

## Task 7.1 - Create full-universe matchup candidate discovery

**Create:**
- `apps/api/src/statlocker-adaptive/matchup-candidate-discovery-v1.service.ts`
- `apps/api/test/matchup-candidate-discovery-v1.spec.ts`

**Reuse:**
- existing `generateRecommendationCandidates` / item graph legality;
- slot/economy rules;
- existing situational purpose/contract structures;
- threat-weighted matchup scorer.

**Do not:** iterate every catalog row and assume it is purchasable. Candidate source must be legal recommendation candidates from the item graph/rules.

**Candidate gates:**
- feasible/recommendation-eligible;
- positive enough matchup aggregate;
- minimum matchup confidence/coverage;
- no hard-core contract violation;
- timing/phase plausible;
- slot impact acceptable;
- transaction cost known/acceptable;
- no already-satisfied target;
- no obvious duplicate purpose if existing strategy rules already encode that conflict.

**Explicit skeleton situational candidates:** receive a prior/boost, but are not the only candidates.

**RED cases:**
1. strong legal item outside explicit window candidates is discovered;
2. illegal/unshopable item is never discovered;
3. low-sample high-delta item is rejected;
4. item with positive aggregate but catastrophic slot/core impact is rejected later with explicit reason;
5. skeleton-listed candidate wins a near tie due to prior, preventing gratuitous deviation.

## Task 7.2 - Define the wildcard escape gate

**Create or keep in discovery service depending size:**
- `apps/api/src/statlocker-adaptive/wildcard-build-deviation-v1.service.ts`
- `apps/api/test/wildcard-build-deviation-v1.spec.ts`

**Modify config:**
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`

**Required named thresholds:**
- minimum matchup confidence;
- minimum matchup uplift;
- minimum whole-build utility improvement;
- larger threshold when replacing soft core;
- no ordinary replacement of hard core.

**RED:** a +tiny improvement outside the skeleton is rejected; a large, well-supported improvement that keeps the build coherent is allowed.

## Task 7.3 - Integrate discovery into strategy-first situational overlay

**Modify:**
- `apps/api/src/statlocker-adaptive/strategy-first-situational-overlay-v1.service.ts`
- `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`
- Nest module provider list if new services require injection.

**Desired flow:**
```text
strategy plan
 -> explicit situational candidates
 -> discovered matchup candidates
 -> merge/dedupe with source metadata
 -> contextual scoring
 -> whole-build utility check
 -> resolver selects or retains core
```

**Test:**
- add `apps/api/test/strategy-first-matchup-discovery-v1.spec.ts`

**Acceptance:** the current `candidateItemIdsByPurpose` restriction no longer prevents a demonstrably better legal matchup item from being considered.

---

# Milestone 8 - Score the complete coherent build

## Task 8.1 - Create whole-build utility service

**Create:**
- `apps/api/src/statlocker-adaptive/build-utility-v1.service.ts`
- `apps/api/test/build-utility-v1.spec.ts`

**Input:** one candidate build/plan with explicit roles and transaction implications.

**Utility components:**
- skeleton adherence;
- hard-core completion status;
- soft-core deviation;
- branch coherence;
- aggregate draft matchup value;
- chain/synergy evidence;
- timing fit;
- slot efficiency/pressure;
- economic cost/opportunity cost;
- owned investment continuity;
- transaction penalty;
- churn penalty.

**Constraints checked before score:**
- no impossible inventory/recipe state;
- no missing hard-core requirement that candidate illegally displaced;
- no illegal branch cardinality;
- transaction plan feasible.

**Output:**
- total utility;
- confidence/completeness;
- component breakdown;
- hard reject reason when invalid.

**RED cases:**
1. highest standalone-WPA item can lose because it makes the full build worse;
2. slightly lower matchup item can win due to synergy/timing/slots;
3. hard-core violation is rejected, not merely penalized;
4. wildcard requires higher utility improvement than normal branch alternative;
5. deterministic tie breaking.

## Task 8.2 - Integrate build utility into planning search

**Modify:**
- `apps/api/src/statlocker-adaptive/strategy-first-build-planner-v1.service.ts`
- planning helper(s) used for candidate ranking.

Reuse the existing bounded planning/beam architecture where practical. Do not introduce a second planner pipeline.

**Test:**
- `apps/api/test/adaptive-build-planner-v1.spec.ts`
- `apps/api/test/adaptive-build-planner-capacity-v1.spec.ts`
- add `apps/api/test/strategy-first-whole-build-utility-v1.spec.ts`

**Acceptance:** ranking of a plan can be reconstructed from explicit build-utility components.

---

# Milestone 9 - Stabilize plans over time

## Task 9.1 - Add plan identity and switch policy

**Create:**
- `apps/api/src/statlocker-adaptive/adaptive-plan-switch-policy-v1.service.ts`
- `apps/api/test/adaptive-plan-switch-policy-v1.spec.ts`

**Inputs:**
- current committed plan/session;
- challenger utility;
- current utility;
- purchased hard/soft core count;
- recent purchases/sells;
- investment/breakpoint state;
- whether challenger is wildcard.

**Behavior:**
- minimum improvement threshold for any switch;
- larger threshold after meaningful investment;
- larger threshold for wildcard;
- preserve recent-purchase/sell-rebuy protections;
- stable reason code when current plan is retained.

**RED time-series tests:**
1. small alternating threat changes do not flip plan repeatedly;
2. major sustained change does switch;
3. after expensive core purchase, same challenger no longer crosses the higher barrier;
4. deterministic after process restart if required state is persisted by existing transaction session.

## Task 9.2 - Keep transaction plan/session authoritative

**Modify:**
- `apps/api/src/statlocker-adaptive/strategy-first-transaction-plan-v1.service.ts`
- `apps/api/src/statlocker-adaptive/strategy-first-adaptive-planner-facade-v1.service.ts`

Only as required to attach the newly selected coherent build to the existing executable transaction-plan semantics.

**Test:**
- existing transaction plan/shared tests;
- add regression proving displayed current build and executable next action describe the same plan.

---

# Milestone 10 - Add canonical decision trace for debugging

## Task 10.1 - Shared trace contract

**Modify:**
- `packages/shared/src/adaptive-recommendation-v1.ts`
- shared barrel exports if needed.

**Test:**
- `packages/shared/test/adaptive-recommendation-v1.test.js`

**Add types conceptually:**
```ts
type AdaptiveBuildDecisionStageKindV1 =
  | 'SKELETON'
  | 'BRANCH_CHOICE'
  | 'MATCHUP_DISCOVERY'
  | 'WHOLE_BUILD_VALIDATION'
  | 'FINAL_SELECTION';

interface AdaptiveBuildCandidateTraceV1 {
  itemId: number;
  source: 'SKELETON' | 'BRANCH' | 'SITUATIONAL_EXPLICIT' | 'MATCHUP_DISCOVERY' | 'WILDCARD';
  selected: boolean;
  rejectedReasonCodes: readonly string[];
  matchup?: ThreatWeightedMatchupTraceV1;
  utilityDelta?: number;
}
```

Keep it structured and bounded. Do not ship entire raw Statlocker snapshots in recommendation payloads.

**Run:**
```bash
yarn workspace @deadlock-live-probe/shared test
```

## Task 10.2 - Produce trace from planner stages

**Create:**
- `apps/api/src/statlocker-adaptive/adaptive-build-decision-trace-v1.service.ts`
- `apps/api/test/adaptive-build-decision-trace-v1.spec.ts`

**Modify:**
- strategy-first planner/facade result types;
- API serialization response that exposes adaptive recommendation.

**Trace must answer:**
- baseline item/goal;
- all serious alternatives considered;
- matchup targets and contributions;
- selection/rejection reason codes;
- wildcard threshold outcome;
- final build and next action.

**Failure rule:** trace construction failure cannot silently alter recommendation selection. Recommendation behavior must be testable independently from presentation trace.

## Task 10.3 - Add debug payload size guard

If trace can become large, add a debug/detail mode or bounded top-N rejected candidates while keeping selected candidate and all reason-critical competitors.

**Test:** response size/candidate count remains bounded for a full catalog discovery pass.

---

# Milestone 11 - Build the simple item-centric desktop/debug UI

## Task 11.1 - Rework diagnostic presentation around item decisions

**Modify:**
- `apps/overwolf-client/src/live-build-desktop-full-build-ui.ts`
- relevant HTML/CSS entry files used by that screen.

**Add/modify tests:**
- create `apps/overwolf-client/src/live-build-desktop-decision-trace.spec.ts`

**Required visible sections:**

1. `Было` / baseline skeleton item or branch.
2. `Рассматривали` / serious alternatives with compact score/target labels.
3. `Выбрали` / winner with main reason.
4. `Откинули` / rejected alternatives with one primary structured reason each.

**Default UI deliberately hides:**
- every raw component weight;
- every raw Statlocker row;
- every candidate that failed trivial legality before becoming a serious candidate.

**Expandable details:**
- enemy hero contributions;
- WPA delta;
- sample/confidence;
- live threat weight;
- whole-build utility delta;
- slot/economy/timing failure.

**Acceptance:** when a recommendation looks wrong, a developer can identify whether the failure came from skeleton, matchup data, live threat, discovery, utility, or validation without reading backend logs.

**Run:**
```bash
yarn workspace @deadlock-live-probe/overwolf-client test --runTestsByPath src/live-build-desktop-decision-trace.spec.ts
yarn workspace @deadlock-live-probe/overwolf-client build:bundle
```

---

# Milestone 12 - Show `vs Billy, Dynamo` in the in-game HUD

## Task 12.1 - Reuse existing `againstLabel` instead of creating a duplicate field

**Modify as needed:**
- `apps/overwolf-client/src/adaptive-recommendation-presentation.ts`
- active compact HUD renderer(s).

**Backend requirement:** selected matchup-driven action/item must carry canonical `AdaptiveSituationalContextV1.targetEnemies` or the evolved equivalent.

**Ordering:**
- primary/high-threat materially contributing target first;
- then secondary material targets;
- do not list enemies with negligible/negative contribution;
- cap display count to keep HUD compact.

**Example:**
```text
Counterspell
vs Billy, Dynamo
```

**If not matchup-driven:** no `vs` line.

## Task 12.2 - Presentation tests

**Modify/add:**
- existing adaptive presentation spec or create `apps/overwolf-client/src/adaptive-recommendation-presentation.spec.ts`.

**RED cases:**
1. two material targets -> `Against: Billy, Dynamo` or final agreed wording;
2. primary target appears first;
3. low-impact enemies are omitted;
4. no context -> no label;
5. duplicate target IDs/names are deduped.

**Run:**
```bash
yarn workspace @deadlock-live-probe/overwolf-client test --runTestsByPath src/adaptive-recommendation-presentation.spec.ts
```

---

# Milestone 13 - End-to-end strategy-first scenarios

## Task 13.1 - Add fixture-driven scenario suite

**Create:**
- `apps/api/test/strategy-first-threat-weighted-build-v1.spec.ts`

**Minimum scenarios:**

### Scenario A - normal skeleton wins
- weak/neutral matchup deltas;
- no extreme live threat;
- expected: skeleton branch remains, no wildcard.

### Scenario B - OR branch changes by draft
- same skeleton;
- two declared alternatives;
- one has materially stronger supported matchup against current draft;
- expected: choose exactly that branch.

### Scenario C - fed primary enemy changes the choice
- historical deltas identical to prior fixture;
- live stats make one enemy the clear threat;
- expected: item strong against that enemy gains enough utility to win.

### Scenario D - tiny sample spike rejected
- wildcard has huge `deltaWpa` but tiny `count`;
- expected: confidence shrink prevents escape.

### Scenario E - strong wildcard accepted
- outside-skeleton legal item has high supported threat-weighted uplift;
- full-build utility remains coherent;
- expected: wildcard enters current build with trace reason.

### Scenario F - hard core protected
- wildcard would score better if core were removed;
- expected: invalid plan rejected.

### Scenario G - economy/slot blocks attractive item
- matchup strong, transaction impossible/too disruptive;
- expected: rejected with explicit reason.

### Scenario H - stale `VS_HERO_WPA`
- expected: skeleton fallback, no invented matchup targets.

### Scenario I - missing live stats
- expected: neutral threat weights, matchup still works historically.

### Scenario J - no churn
- series of close snapshots;
- expected: same plan retained until configured improvement barrier is crossed.

## Task 13.2 - Response contract scenario

Verify one API recommendation contains:
- one current coherent build;
- one next action;
- selected branch only;
- matchup target metadata where applicable;
- bounded decision trace;
- no impossible transaction.

---

# Milestone 14 - Shadow mode, calibration, and rollout

## Task 14.1 - Add policy/version flag

**Modify:**
- `apps/api/src/statlocker-adaptive/statlocker-adaptive.config.ts`
- strategy-first facade routing/config.

Suggested states:
- `CURRENT` - current production policy;
- `THREAT_WEIGHTED_SHADOW` - run new policy, do not expose it as recommendation;
- `THREAT_WEIGHTED_ACTIVE` - new policy is user-visible.

Do not couple this rollout flag to experimental UI rendering.

## Task 14.2 - Capture comparison telemetry

For each shadow decision capture bounded metrics:
- current plan fingerprint;
- challenger plan fingerprint;
- current vs new next item;
- branch difference;
- wildcard activated yes/no;
- aggregate matchup confidence/coverage;
- top target threats;
- utility improvement;
- whether switch would occur;
- reason codes.

Do not log full raw snapshots if not necessary.

## Task 14.3 - Calibration dashboard/report

Before active rollout inspect:
- branch switch rate;
- wildcard discovery rate;
- wildcard acceptance rate;
- plan churn per match/minute;
- hard-core violation attempts and accepted violations (accepted must be zero);
- low-confidence recommendation rate;
- average enemy evidence coverage;
- stale evidence fallback rate;
- disagreement rate with current production plan.

Thresholds to tune from evidence:
- threat component weights;
- threat clamp;
- smoothing;
- wildcard uplift;
- soft-core replacement threshold;
- branch switch threshold;
- invested-plan switch threshold;
- HUD material-target threshold.

## Task 14.4 - Active rollout gate

Before changing production default, require:
- focused suites green;
- full API/shared/Overwolf tests green;
- builds green;
- zero hard-core invariant violations in shadow evaluation;
- acceptable churn;
- manual review of representative decision traces including wrong-looking cases.

---

# Final verification commands before merge

Run from repository root:

```bash
yarn workspace @deadlock-live-probe/shared test
yarn workspace @deadlock-live-probe/api test
yarn workspace @deadlock-live-probe/api build
yarn workspace @deadlock-live-probe/overwolf-client test
yarn workspace @deadlock-live-probe/overwolf-client build:bundle
```

Then, if runtime/CI cost is acceptable:

```bash
yarn test
yarn build
```

Do not use the Overwolf full `build` command for routine local verification if its release script would sync/configure machine-specific output; `build:bundle` is the safer code/bundle verification path.

---

# Recommended implementation order and merge boundaries

Keep changes reviewable. Suggested PR/commit boundaries when implementation starts:

1. Fixture + verified Statlocker semantics + threshold cleanup.
2. Rich normalized matchup evidence, backward compatible.
3. Enemy live-state contract + pure threat scorer.
4. Threat smoothing.
5. Threat-weighted all-enemy matchup aggregate.
6. Explicit core rigidity.
7. Branch/OR contextual selection.
8. Full-universe situational discovery + wildcard gate.
9. Whole-build utility integration.
10. Plan-switch hysteresis.
11. Shared decision trace + backend producer.
12. Desktop/debug trace UI.
13. In-game `vs Billy, Dynamo` integration using existing `againstLabel`.
14. End-to-end scenarios + shadow telemetry.
15. Threshold calibration and active rollout.

Each boundary must keep current production fallback viable. Do not land a half-connected scorer that changes recommendations before discovery, trace, and invariants can explain it.

# Definition of done

The feature is done only when all of the following are true:

- The system starts from a coherent strategy/skeleton rather than a global WPA item sort.
- Hard core is structurally protected.
- OR/CHOICE produces one selected branch using current-draft evidence.
- Situational discovery can find strong legal items outside the skeleton's explicit candidate list.
- Wildcards require a clearly stronger and well-supported result.
- Matchup utility considers all observed enemies and weights them by bounded live threat.
- Live threat uses multiple observed metrics, not raw KDA alone.
- Low sample sizes reduce confidence strongly.
- The full build, not only the next item, is scored for coherence/economy/slots/timing/investment.
- Plan changes have explicit hysteresis and do not oscillate.
- One coherent current build and one executable next action are returned.
- Overwolf shows a compact matchup reason such as `vs Billy, Dynamo` when it is genuinely causal.
- Debug UI shows what the skeleton proposed, what was considered, what was rejected, what won, and why.
- Every significant choice can be reconstructed from structured trace components/reason codes.
- Missing/stale evidence safely falls back instead of hallucinating certainty.
- New policy passes shadow evaluation before becoming the production default.
