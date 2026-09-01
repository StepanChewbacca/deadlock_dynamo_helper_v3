# Statlocker Adaptive Policy V1 Design

Date: 2026-08-31
Status: Approved design, pending implementation plan
Branch: `agent/statlocker-model-probe-poc`

## 1. Summary

Statlocker Adaptive Policy V1 becomes the primary recommendation runtime for Deadlock build planning.

The runtime uses:

- live game state from the existing Overwolf/GEP pipeline;
- the existing deterministic candidate generation and legality layer;
- normalized Statlocker evidence collected through Chromium from public Statlocker pages;
- a consensus build skeleton derived from the top 10 players for the selected hero;
- a deterministic adaptive scorer and limited-horizon build planner;
- PostgreSQL-backed versioned Statlocker snapshots with an in-memory hot cache.

ML8 is removed from the serving path. Its source files are not deleted in this change, but Behavioral, Value, Policy, and related ML8 serving logic do not participate in primary runtime decisions.

The policy returns both an immediate action and a complete current recommended build plan. It may insert, reorder, skip, sell, or replace items when strong contextual evidence justifies the change, while protecting high-confidence core items with soft penalties rather than hard locks.

## 2. Goals

V1 must:

1. Produce recommendations without requiring any ML model at runtime.
2. Keep deterministic Deadlock legality and feasibility authoritative.
3. Use Statlocker as the primary data-driven evidence source, never as a legality source.
4. Build a stable hero-specific consensus skeleton from the top 10 relevant high-ranked players.
5. Adapt the skeleton using current hero, enemy draft, inventory, game time, team soul state, shop state, and available Statlocker evidence.
6. Return a full recommended remaining build plus a separate `nextAction`.
7. Allow `SELL` and replacement actions, but only when their expected contextual gain exceeds strong transaction, churn, and plan-disruption penalties.
8. Avoid recommendation oscillation through previous-plan state and hysteresis.
9. Never block a recommendation waiting for Chromium.
10. Continue safely when Statlocker is partially unavailable by using the latest valid cached snapshot and reducing evidence confidence as it ages.
11. Persist enough provenance and score breakdown to explain and deterministically replay historical decisions.

## 3. Non-goals

V1 does not:

- delete the ML8 implementation from the repository;
- use ML8 as a shadow or fallback serving path;
- treat Statlocker WPA as a causal estimate of item value;
- depend on current-match Statlocker endpoints that require an active match ID;
- extract API keys, authentication tokens, cookies, local storage, request headers, or session material from Chromium;
- bypass authentication, beta gates, anti-bot controls, CAPTCHA, or access restrictions;
- perform a live Chromium request for every recommendation;
- exhaustively search every possible future Deadlock build trajectory.

## 4. Source constraints and evidence families

The collector uses browser-backed access from normal public Statlocker page context. The service does not supply an API key and does not persist browser credentials or session state.

V1 uses these Statlocker evidence families:

- `WPA_PATCH_DATA`
- `VS_HERO_WPA`
- `T4_CHAINS`
- `HERO_LEADERBOARD`
- `PRO_BUILD_ANALYSIS`
- `WPA_FILTERED_ITEMS` as optional supporting or validation evidence

Current-match endpoints such as Win Chance, player WPA, and build-context are not part of the live runtime because V1 cannot assume the running match is queryable by Statlocker.

Observed `WPA_PATCH_DATA` fields useful to V1 include:

- `mean_wpa`
- `sample_size`
- `std_wpa`
- `wpa_confidence`
- `mean_prob_before`
- `mean_net_worth_before`
- `mean_level_before`
- `mean_purchase_time_min`
- `conditional_wpa.ahead`
- `conditional_wpa.even`
- `conditional_wpa.behind`
- composition breakdowns
- build-archetype breakdowns
- best purchase time
- laning and post-lane breakdowns

Observed `VS_HERO_WPA` supports evidence keyed by our hero, candidate item, and a specific enemy hero, with values including `mean_wpa`, `delta_wpa`, and sample count.

These values are observational associations. They are evidence inputs, not guarantees of causal win-rate improvement.

## 5. High-level architecture

```text
Statlocker public pages
        |
        v
StatlockerBrowserCollector
        |
        v
StatlockerNormalizer
        |
        v
StatlockerSnapshotStore
   |                 |
   v                 v
Hot in-memory     PostgreSQL
cache             snapshot history
   |                 |
   +--------+--------+
            |
            v
StatlockerEvidenceService
            |
            +-----------------------------+
            |                             |
            v                             v
BuildSkeletonService              AdaptiveEvidenceScorerV1
            |                             |
            +---------------+-------------+
                            |
                            v
                   AdaptiveBuildPlannerV1
                            |
                            v
                    Final legality pass
                            |
                            v
                   AdaptiveRecommendationV1
```

Primary runtime flow:

```text
Overwolf/GEP live state
        |
        v
Realtime state builder
        |
        v
Existing candidate generation
        |
        v
Existing deterministic legality
        |
        +-----------------------------+
        |                             |
        v                             v
Statlocker evidence             Previous plan
        |                             |
        +---------------+-------------+
                        |
                        v
               AdaptiveBuildPlannerV1
                        |
                        v
                 final legality
                        |
                        v
                recommendation
```

ML8 is not called from this path.

## 6. Component responsibilities

### 6.1 `StatlockerBrowserCollector`

Responsibilities:

- launch Chromium in the supported server environment;
- open a normal public Statlocker page;
- fetch approved evidence datasets through the page context;
- return response bodies and minimal collection metadata;
- enforce timeouts and bounded concurrency;
- close browser resources after the collection batch.

It must not:

- score recommendations;
- inspect or persist cookies, headers, local storage, API keys, or authentication material;
- bypass a 401, 403, login wall, beta gate, CAPTCHA, or other access control;
- become a synchronous dependency of a recommendation request.

A single collection batch should reuse one browser session for multiple datasets rather than launching one Chromium process per endpoint.

### 6.2 `StatlockerNormalizer`

Responsibilities:

- validate raw dataset shape;
- reject malformed, empty, incompatible, or structurally suspicious responses;
- convert Statlocker-specific JSON into stable internal contracts;
- attach dataset, patch, scope, schema, collector, and normalizer versions;
- compute deterministic content hashes.

The planner must not depend on Statlocker JSON field layout directly.

### 6.3 `StatlockerSnapshotStore`

Responsibilities:

- persist valid normalized snapshots append-only in PostgreSQL;
- provide the latest valid snapshot by dataset, patch, and scope;
- populate an in-memory hot cache on application startup;
- atomically replace hot-cache entries after a newly collected snapshot has been validated and persisted;
- retain the previous valid snapshot when a refresh fails.

A failed refresh must never overwrite the last known good snapshot.

### 6.4 `StatlockerEvidenceService`

Responsibilities:

- provide one stable read interface to the recommendation subsystem;
- resolve evidence from hot cache, with PostgreSQL as persistent recovery state;
- return freshness, snapshot IDs or hashes, and evidence confidence alongside normalized values;
- combine applicable dataset fragments into one evidence bundle for a decision.

The planner does not query PostgreSQL or Chromium directly.

Representative logical operations:

```text
getItemEvidence(heroId, itemId, patchId)
getEnemyMatchupEvidence(heroId, itemId, enemyHeroIds, patchId)
getT4ChainEvidence(heroId, ownedItems, candidateItemId, patchId)
getConsensusSkeleton(heroId, patchId)
```

### 6.5 `BuildSkeletonService`

Responsibilities:

- read the top hero leaderboard;
- select up to the top 10 relevant players for the hero;
- aggregate their `player-build-analysis` profiles;
- derive a deterministic consensus skeleton;
- publish or cache a normalized skeleton snapshot.

The skeleton is a prior, not a hard build guide.

Each skeleton item carries evidence such as:

- item ID;
- player coverage;
- purchase rate;
- frequency tier;
- expected purchase time;
- phase;
- expected order;
- item relationship support;
- aggregate core strength;
- supporting player count.

Interpretation:

- `CORE`: high deviation penalty;
- `FREQUENT`: moderate deviation penalty;
- `FLEX` or `SOMETIMES`: low deviation penalty.

A core item can still be delayed or replaced when sufficiently strong evidence outweighs its protection.

### 6.6 `AdaptiveEvidenceScorerV1`

Responsibilities:

- score one legal candidate action or item in the current state;
- normalize heterogeneous evidence into bounded comparable components;
- apply sample-size and source-confidence shrinkage;
- compute explicit score components and aggregate confidence;
- apply transaction, churn, deviation, and instability penalties where applicable.

The scorer does not build the complete trajectory. It produces deterministic action or item values used by the planner.

### 6.7 `AdaptiveBuildPlannerV1`

Responsibilities:

- build the complete current recommended plan from owned inventory to the target late-game build;
- separately choose the immediate `nextAction`;
- search a compact contextual candidate pool rather than the full item universe;
- account for future progression through a limited beam search;
- compare keeping owned items against selling or replacing them;
- use previous plan state and hysteresis to avoid oscillation;
- return plan diffs, score breakdowns, confidence, and provenance.

### 6.8 Existing candidate generation and legality

The existing deterministic candidate and legality infrastructure remains authoritative.

It is responsible for feasibility dimensions such as:

- affordability;
- slot legality;
- recipe legality;
- shop legality;
- ruleset legality;
- known transaction mechanics.

Statlocker can change ranking but can never make an illegal action legal.

A second legality validation is performed immediately before publishing the selected action.

## 7. Live state contract

The adaptive runtime needs, when available:

- current hero ID;
- enemy hero IDs;
- current inventory;
- spendable souls;
- total souls for our team;
- total souls for the enemy team;
- game time;
- shop opportunity or shop state;
- current ruleset version and patch ID;
- recent player transaction history;
- previous published build plan.

Optional contextual features may be included only when upstream data is reliable. If a feature required by a score component is unavailable, that component contributes zero and reduces evidence confidence instead of inventing a value.

## 8. Team game-state classification

V1 classifies team state using total team souls.

```text
soulDelta = (ourTeamSouls - enemyTeamSouls) / enemyTeamSouls
```

Discrete state:

```text
AHEAD  when soulDelta >= +0.08
BEHIND when soulDelta <= -0.08
EVEN   otherwise
```

The discrete state is exposed to telemetry and UI.

The scorer may smoothly blend adjacent `conditional_wpa` evidence near the 8 percent boundaries so that a tiny change around the threshold does not cause an abrupt build switch.

If either team soul total is unavailable or invalid, the game-state component is disabled and state is treated as `UNKNOWN` internally for scoring purposes. This does not invalidate the entire recommendation if the remaining live state is sufficient.

## 9. Scoring model

The conceptual score is:

```text
Score =
    SkeletonPrior
  + BaseWpa
  + GameStateFit
  + ExactEnemyFit
  + EnemyCompositionFit
  + OwnBuildFit
  + TimingFit
  + LaneFit
  + ChainFit
  - SkeletonDeviationPenalty
  - TransactionPenalty
  - ChurnPenalty
  - InstabilityPenalty
```

All positive and negative components are normalized to a bounded common scale before weighting. Raw WPA, sample counts, purchase times, and probabilities are never added directly.

All weights, caps, shrinkage constants, beam parameters, and hysteresis thresholds belong to a versioned V1 config, not scattered hard-coded constants.

### 9.1 Confidence shrinkage

For evidence with sample size `n`, V1 starts from a saturating confidence function:

```text
sampleConfidence = n / (n + k)
shrunkEffect = normalizedEffect * sampleConfidence
```

`k` is configured per evidence family.

Exact hero-item-enemy slices use stronger shrinkage than broad hero-item evidence because their samples are narrower.

When Statlocker provides a usable confidence value, V1 may combine it with sample confidence:

```text
effectiveConfidence = sampleConfidence * statlockerConfidence
```

All confidence values are clamped to valid bounds before use.

### 9.2 Base WPA

`BaseWpa` uses hero and patch scoped item evidence. It is confidence weighted and bounded. It provides a broad prior, not the final action value.

### 9.3 Game-state fit

`GameStateFit` selects or blends `conditional_wpa` evidence for ahead, even, and behind based on total team souls.

The state component is disabled when required live team-soul values are missing.

### 9.4 Exact enemy matchup fit

For each enemy hero:

1. load item matchup `delta_wpa` and count;
2. normalize the effect;
3. apply sample shrinkage;
4. rank matchup contributions by absolute confidence-adjusted relevance;
5. keep at most the three most informative matchup contributions;
6. compute a confidence-weighted mean;
7. clamp the final `ExactEnemyFit` contribution.

V1 does not sum all enemy matchup deltas because those effects can be correlated and would overcount one item against a six-hero draft.

Low-sample exact matchup data must not independently overpower a strong core skeleton.

### 9.5 Enemy composition fit

If reliable upstream information exists to classify the enemy state into Statlocker's supported composition categories, the matching composition breakdown contributes a bounded score.

If reliable classification is unavailable, `EnemyCompositionFit` is zero and its absence is reflected in confidence. V1 does not infer a composition category from incomplete data.

### 9.6 Own-build fit

If current inventory can be reliably classified into a supported build archetype, the appropriate Statlocker build breakdown contributes a bounded score.

Supported internal archetypes are:

- `GUN`
- `SPIRIT`
- `HYBRID`
- `TANK`
- `UNKNOWN`

When unknown, the component is disabled.

The actual owned inventory takes precedence over the starting skeleton. V1 does not force the player back into an obsolete initial archetype.

### 9.7 Timing fit

Timing uses available Statlocker and pro-profile purchase timing evidence together with current game time.

The timing function is smooth. Being slightly early or late changes a bonus gradually. A late purchase is not made illegal merely because the historical timing window has passed.

### 9.8 Lane fit

When available, lane or post-lane evidence contributes a bounded score based on current game phase. If the phase cannot be determined reliably, the component is omitted.

### 9.9 T4 chain fit

T4 chain evidence rewards coherent two-item and three-item continuations involving current inventory, the proposed item, and likely near-future skeleton steps.

T4 evidence is a planning association, never a hard legality rule.

### 9.10 Skeleton protection

Consensus core strength is derived from:

- top-player coverage;
- purchase rate;
- frequency tier;
- order consistency;
- relationship support.

Core items receive a high deviation penalty, frequent items receive a moderate penalty, and flex items receive a low penalty.

This is soft protection. Strong multi-signal contextual evidence can delay, insert around, skip, sell, or replace a core item if the total plan score improves by a sufficiently large configured margin.

## 10. Build planning

### 10.1 Two outputs

Every planning decision returns:

1. `nextAction`: the action that is legal and appropriate now;
2. `recommendedBuild`: the complete current target build from owned inventory through remaining planned items.

Affordability applies to the immediate action. Future planned items are targets and are not assumed to be currently affordable.

### 10.2 Planning candidate pool

The planner forms a compact pool from:

- consensus core items;
- consensus frequent items;
- consensus flex items;
- strong exact-enemy candidates;
- strong game-state candidates;
- strong optional composition candidates when available;
- relevant T4 continuations;
- already owned items.

The pool is deduplicated and bounded before trajectory search. This prevents exhaustive search over the entire item catalog and reduces sensitivity to isolated noisy Statlocker values.

### 10.3 Limited beam search

V1 uses a small configurable beam search over the next few planning steps.

Initial config target:

```text
planningDepth = 3
beamWidth = 8
```

These are config defaults, not API guarantees.

Trajectory score includes:

```text
PlanScore =
    immediateActionValue
  + discountedFutureItemValues
  + chainCoherence
  + skeletonCoherence
  - deviationPenalties
  - transactionPenalties
  - instabilityPenalty
```

Near-term decisions receive more weight than distant speculative items.

### 10.4 Owned items

Owned inventory is the starting state, not a suggestion.

The planner compares keeping each owned item against selling or replacing it. A different ideal build from zero does not automatically justify selling a currently owned item.

### 10.5 Sell and replace behavior

`SELL` and `SELL_AND_BUY` are allowed.

A replacement is considered only when contextual improvement exceeds:

- value of the owned item in the future plan;
- economic sell loss;
- churn penalty;
- skeleton disruption penalty;
- recent-transaction protection when applicable.

Replacement becomes more reasonable under real slot pressure. When a legal free slot exists, insertion is generally preferred over unnecessary replacement.

Recently purchased items receive temporary additional protection against immediate sale. Recently sold items receive a rebuy penalty to prevent oscillation such as buy, sell, buy, sell.

### 10.6 WAIT, HOLD, CONTINUE_CORE, and ABSTAIN

The planner must not be forced to buy a mediocre item merely because it is affordable.

V1 supports conservative outcomes:

- `WAIT`: preserve resources for a stronger planned target;
- `HOLD`: make no transaction now;
- `CONTINUE_CORE`: contextual evidence is insufficient to justify deviating from the current consensus path;
- `ABSTAIN`: state or evidence quality is too weak to safely produce an adaptive transaction recommendation.

These are valid policy decisions, not errors.

### 10.7 Hysteresis and plan stability

The previous published plan is an input to the next decision.

A new plan replaces the previous plan only when its improvement exceeds a configurable `minPlanSwitchImprovement` threshold.

Higher thresholds apply to disruptive changes such as:

- dropping a protected core item;
- selling an owned item;
- reversing a recent plan change.

This prevents score noise or tiny evidence changes from constantly rewriting the UI build.

## 11. Recommendation result

The conceptual result includes:

```ts
interface AdaptiveBuildPlanV1 {
  nextAction: AdaptiveActionV1;
  nextTargetItemId?: number;
  recommendedBuild: readonly PlannedItemV1[];
  changes: readonly BuildPlanChangeV1[];
  rankedImmediateCandidates: readonly ScoredActionV1[];
  gameState: 'AHEAD' | 'EVEN' | 'BEHIND' | 'UNKNOWN';
  totalScore: number;
  confidence: number;
  evidenceVersion: string;
  scorerVersion: string;
  plannerVersion: string;
}
```

Each planned item should expose enough explanation metadata for UI and telemetry, including position, status, confidence, skeleton support, contextual support, and reason codes.

The client-facing explanation can describe changes such as:

```text
KEEP A
KEEP B
INSERT Q before C
KEEP C
SKIP D
KEEP E
```

## 12. Collector scheduling and refresh policy

Chromium collection is background-only.

Initial refresh configuration:

```text
WPA_PATCH_DATA       every 30 minutes
VS_HERO_WPA          every 30 minutes
T4_CHAINS            every 30 minutes
HERO_LEADERBOARD     every 60 minutes
PRO_BUILD_ANALYSIS   every 60 minutes
```

These intervals are configurable.

The system does not refresh every minute without evidence that a dataset changes at that cadence.

A runtime miss may enqueue a non-blocking refresh request, but the recommendation call never waits for that refresh.

Collection must be single-flight per dataset and scope so concurrent requests do not launch duplicate Chromium refreshes.

## 13. Pro-player consensus collection

For each hero refresh:

```text
hero leaderboard
      |
      v
select top 10 relevant account IDs
      |
      v
player-build-analysis for each
      |
      v
normalize valid profiles
      |
      v
BuildSkeletonService
      |
      v
consensus skeleton snapshot
```

The collector may publish a skeleton when a strong majority of the selected profiles are valid. The initial publication rule is at least 8 valid profiles out of the requested top 10.

If fewer than 8 valid profiles are available, the system retains the previous valid skeleton rather than publishing a weak replacement. If no prior skeleton exists, the skeleton is unavailable and planner confidence is reduced.

## 14. Snapshot persistence and versioning

Snapshots are append-only for audit and replay.

Conceptual fields:

```text
id
dataset
patchId
scopeKey
fetchedAt
schemaVersion
normalizerVersion
collectorVersion
contentSha256
payload
```

`scopeKey` identifies dataset scope, for example:

```text
GLOBAL
hero:6
hero:6:player:281768392
```

The exact relational schema is an implementation-plan concern, but the persistence contract must preserve immutable snapshot identity and payload provenance.

The hot cache contains the latest valid snapshot for each active key. PostgreSQL is the source used to rebuild that cache after application restart.

## 15. Snapshot validation and publication

A newly fetched dataset becomes active only after:

- successful browser retrieval;
- expected top-level dataset shape validation;
- required sections are present and non-empty;
- numeric values pass finite/range checks;
- patch identity is known when the dataset is patch-scoped;
- normalization succeeds;
- the resulting payload passes dataset-specific sanity checks;
- persistence succeeds.

A 200 response with a changed or incomplete schema is not automatically valid.

Publication is atomic from the runtime reader's perspective.

## 16. Patch isolation

Statlocker evidence is patch scoped whenever the source supports patch identity.

Evidence from patch `P1` must not silently count as current evidence for patch `P2`.

Freshness states are:

- `FRESH`
- `STALE_USABLE`
- `UNAVAILABLE`
- `PATCH_MISMATCH`

On a patch mismatch:

- current ruleset legality remains authoritative;
- mismatched contextual WPA components are disabled rather than treated as current;
- the existing valid plan may be retained if still legal;
- planner confidence drops;
- the collector prioritizes current-patch refresh.

## 17. Partial failure and fallback

Statlocker datasets fail independently.

Example:

```text
WPA_PATCH_DATA   FRESH
VS_HERO_WPA      FRESH
T4_CHAINS        STALE_USABLE
PRO_BUILD        UNAVAILABLE
```

The planner continues with available evidence and reduces confidence for missing or stale components.

If Statlocker is unavailable but valid snapshots exist:

- use the latest valid snapshots;
- reduce their influence as freshness degrades;
- make aggressive actions such as sell or core replacement less likely.

If no usable Statlocker evidence exists:

- never invent an adaptive recommendation from unsupported data;
- preserve the previous valid legal plan when possible;
- otherwise prefer `CONTINUE_CORE`, `HOLD`, `WAIT`, or `ABSTAIN` according to available deterministic state.

## 18. Runtime decision triggers

The planner is not recomputed for every raw telemetry packet.

Meaningful triggers include:

- inventory changed;
- spendable souls crossed a relevant purchase threshold;
- shop opportunity changed;
- enemy draft became known or changed;
- team soul state changed materially or crossed the ahead/even/behind region;
- the previous target became affordable;
- the previous target became illegal;
- a relevant Statlocker snapshot was published.

Events are debounced so bursts of related telemetry produce one decision.

The implementation may also recompute for other deterministic state changes when they can materially alter candidate legality or score.

## 19. Final legality pass

Immediately before publishing `nextAction`, the system revalidates the action against the latest deterministic state.

If the selected action is no longer legal:

1. choose the next highest-ranked action that is still legal if one exists;
2. otherwise return a conservative non-transaction action such as `WAIT`, `HOLD`, or `ABSTAIN`.

An illegal transaction is never emitted merely because it scored highly earlier in planning.

## 20. Error classes

### 20.1 Fatal runtime-state blockers

Examples:

- hero unknown;
- inventory state unusable;
- ruleset unavailable;
- candidate-generation prerequisites missing.

The result is not ready and contains explicit blockers.

### 20.2 Degraded Statlocker evidence

Missing, stale, or partially invalid evidence is normally non-fatal.

Affected score components are disabled or down-weighted and confidence is reduced.

### 20.3 Collector failure

Collector timeouts, network errors, schema changes, and bad payloads do not delete valid data and do not block the recommendation runtime.

## 21. ML8 runtime removal

The new primary serving path does not depend on:

- Behavioral runtime prediction;
- Value models;
- Policy model artifacts;
- ML8 experiment assignment;
- ML8 safe-exploration selection;
- ML8 model compatibility gates.

Existing ML8 source files remain in the repository during V1 rollout.

Implementation should remove ML8 services from the primary recommendation wiring and production decision coordinator where safe, without combining Statlocker evidence into ML8 pseudo-model fields.

No ML8 shadow serving path is required for V1.

## 22. Telemetry and replay

Each published decision records enough information to reconstruct why it happened.

Required logical telemetry includes:

- decision ID;
- match ID or live session identifier;
- player identifier used by the existing subsystem;
- decision timestamp;
- live-state revision;
- hero ID;
- enemy hero IDs;
- inventory;
- spendable souls;
- our total team souls;
- enemy total team souls;
- game time;
- game state;
- candidate-generator version;
- ruleset version;
- Statlocker snapshot IDs or hashes;
- scorer config version;
- scorer version;
- planner version;
- previous plan;
- ranked immediate candidate scores;
- selected trajectory;
- resulting full plan;
- `nextAction`;
- per-component score breakdown;
- aggregate confidence;
- degraded-evidence flags and blockers.

Offline replay must run without Chromium by loading the exact persisted evidence snapshot identities used by the historical decision.

For identical:

- live state;
- evidence snapshots;
- config versions;
- previous plan;

V1 must produce the same candidates, scores, and result.

## 23. Testing strategy

### 23.1 Unit tests

Cover at minimum:

- team-soul state classification;
- smooth ahead/even/behind blending;
- sample confidence shrinkage;
- low-sample exact-enemy suppression;
- robust multi-enemy aggregation;
- timing normalization;
- skeleton scoring;
- soft core protection;
- T4 chain contribution;
- sell and churn penalties;
- recent-purchase protection;
- recent-sell rebuy protection;
- hysteresis;
- `WAIT` versus immediate `BUY`;
- `CONTINUE_CORE` behavior;
- patch mismatch handling;
- stale evidence handling;
- partial dataset failure.

### 23.2 Scenario tests

Representative deterministic fixtures:

**Scenario A: strong core, weak contextual evidence**

Expected result: continue the core plan.

**Scenario B: flex slot, high-confidence enemy counter, correct timing**

Expected result: insert the counter item while preserving protected core.

**Scenario C: full inventory, weak owned flex item, strong replacement candidate**

Expected result: `SELL_AND_BUY` may be selected.

**Scenario D: same as C but exact-counter sample size is very low**

Expected result: no aggressive sale based on the weak sample.

**Scenario E: Statlocker temporarily unavailable, last snapshots usable**

Expected result: valid recommendation with lower confidence.

**Scenario F: snapshot patch mismatch**

Expected result: old WPA does not count as current evidence.

### 23.3 Collector tests

Cover:

- successful normalized collection;
- one Chromium session reused for a batch;
- timeout handling;
- 401 or 403 access refusal without bypass attempts;
- malformed schema rejection;
- 200 response with missing critical sections;
- previous valid snapshot retained after failed refresh;
- single-flight refresh behavior;
- application restart and hot-cache restore from PostgreSQL.

## 24. Hard invariants

V1 must enforce these invariants:

1. An illegal candidate is never selected.
2. Statlocker evidence can never override deterministic legality.
3. Low-sample evidence cannot dominate protected core by itself.
4. `SELL` and replacement require stronger evidence than normal insert or buy actions.
5. Tiny score changes cannot repeatedly flip the published plan.
6. A failed collector refresh never destroys the last valid snapshot.
7. Patch-mismatched evidence never silently counts as current evidence.
8. Runtime recommendation never waits for Chromium.
9. Same inputs and versions produce the same result.
10. ML8 does not participate in the primary serving path.

## 25. Acceptance criteria

V1 is implementation-complete when:

- the Chromium collector reliably gathers the required accessible datasets;
- normalized snapshots are persisted and survive application restart;
- the runtime can serve without waiting for Chromium;
- ML8 is absent from the production recommendation serving flow;
- a top-10 consensus skeleton is generated and versioned per hero and relevant patch state;
- the planner returns a full build plus `nextAction`;
- exact enemy evidence, team game state, consensus skeleton, and T4 chains participate in scoring when available;
- sell and replacement are supported with strong penalties and slot-pressure-aware behavior;
- stale or partially unavailable Statlocker data degrades confidence without crashing the runtime;
- total Statlocker loss has a conservative deterministic fallback;
- every emitted transaction passes a final legality check;
- decisions include evidence provenance and score breakdown;
- historical decisions can be replayed without Chromium;
- unit, scenario, collector, and invariant tests pass.

## 26. Implementation boundary

This document defines architecture and behavior only. It does not prescribe the exact file-by-file implementation sequence, migration names, table decomposition, or final configuration values for scoring weights and shrinkage constants.

Those details belong in the implementation plan after this design receives final review.
