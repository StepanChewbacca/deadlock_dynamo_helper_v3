# Recommendation Behavioral V7 - Observability and Support-Ceiling Recovery Roadmap

## 1. Why V7 exists

Behavioral V6 has now tested the major model-side explanations for the support failure on the pinned MATCH sample and `MERGED_TOP_96` choice set.

The following model families or corrections were evaluated without using FUTURE_TEST for selection:

- corrected equal-capacity linear model;
- corrected linear-plus-tower model;
- grouped boosted/listwise model;
- ordered-history Sequence Neural model;
- MATCH-disjoint temperature calibration;
- latent observable-regime diagnostic;
- Sequence Neural with auxiliary masked-history state reconstruction.

The best currently observed Behavioral result remains the Sequence Neural screen:

- support coverage: `0.835920177383592`;
- raw log loss: `2.747655053608051`;
- floor sensitivity: `0.2987322135195818`;
- major low-support groups: 2;
- PHASE:LATE support: `0.7670886075949367`;
- ECONOMY:GE_20000 support: `0.7611583421891605`.

The state-reconstruction screen completed successfully as an execution but failed every continuation condition:

- support coverage: `0.827120288248337`;
- raw log loss: `2.834121235561628`;
- floor sensitivity: `0.3047894224101251`;
- major low-support groups: 6;
- PHASE:LATE support: `0.7475587703435804`;
- ECONOMY:GE_20000 support: `0.7348565356004251`;
- auxiliary reconstruction loss increased across epochs instead of decreasing.

The current evidence therefore does not justify another capacity sweep or another model family trained on the same observables. The next problem is observability.

Behavioral V7 is the data-recovery program required before another production-eligible Behavioral model may be trained.

## 2. Frozen evidence and lineage

These artifacts remain immutable references:

- Dataset V6 SHA-256: `e8b11e26df37ff1e17b334eda18ea2141cfb7fa78f0a34eaf95d448c22962235`;
- pinned MATCH sample SHA-256: `8d87519d797b54fc3f726837e80bb79968b44dc59960dadcb934261f329ce1ac`;
- frozen `MERGED_TOP_96` choice-set report SHA-256: `b2953bc63baff315cc66d4bdfb0ca8655e5fef0a99fc6916c782821f8c31e664`;
- V6 Sequence Neural screen evidence;
- V6 balanced temperature-calibration evidence;
- V6 latent-regime diagnostic evidence;
- V6 state-reconstruction screen evidence.

FUTURE_TEST remains excluded from all investigation, feature selection, model selection, threshold selection and architecture selection until the final offline verification stage.

## 3. Current root-cause conclusion

The current failure should be treated as an observability/support ceiling unless disproved.

The evidence already establishes:

1. Broad support union was a real problem. Median candidate count was reduced from about 140 to at most 96 while preserving more than 99% observed-action coverage.
2. Candidate-count-dependent optimizer decay was a real implementation problem and was corrected.
3. Equal-capacity linear and tower models still failed after those fixes.
4. Ordered purchase history is genuinely predictive and materially improves late/high-economy support.
5. Temperature scaling does not solve the remaining failure.
6. Observable latent regime partitions did not provide sufficient stable entropy reduction in both MATCH partitions.
7. Auxiliary masked-history reconstruction did not improve the representation or propensity metrics.
8. Reliable spendable currency was not found in the audited historical timeline or PostgreSQL sources. `netWorth` is not a wallet and must never be treated as one.

The remaining hard tail is concentrated in states where the action opportunity is most likely to depend on variables that Dataset V6 does not observe precisely enough.

## 4. Ranked missing-state hypotheses

These are hypotheses to investigate, not facts to synthesize into the dataset.

### H1 - exact spendable currency at the decision timestamp

Highest-priority hypothesis.

Required candidate fields if a trustworthy source exists:

- `spendableSouls` or equivalent authoritative currency value;
- `candidateAffordable`;
- `currencyAfterPurchase`;
- `currencyShortfall` for unavailable candidates.

Rules:

- do not estimate spendable currency from `netWorth`;
- do not backfill with a learned proxy and call it observed;
- preserve source timestamp and source provenance;
- require deterministic alignment to the decision timestamp.

### H2 - exact shop opportunity / purchase opportunity state

Investigate whether historical data can establish the actual opportunity to buy at the decision timestamp.

Potential observables include, only where actually available:

- player inside an eligible shop area;
- shop type or shop identifier;
- shop-entry and shop-exit timestamps;
- time since shop became available;
- time since previous purchase;
- time until/after death or respawn only when this is pre-decision observable;
- whether a purchase opportunity was physically available at that instant.

No map-distance or shop-access proxy may be presented as ground truth unless its source and reconstruction error are measured.

### H3 - exact inventory and slot legality

Audit whether Dataset V6 loses decision-time legality information by collapsing inventory into item counts.

Investigate:

- exact occupied slots and slot categories;
- flex-slot state where available;
- replacement or upgrade legality;
- component ownership and recipe transition state;
- item already owned / maximum-stack restrictions;
- sell/replace context if represented in source data.

The objective is to identify candidates that are historically plausible but not actually feasible in the current inventory configuration.

### H4 - exact item availability / ruleset state

Audit whether a candidate may be globally known to the historical generator but unavailable in the actual patch/ruleset/hero state.

Required provenance where available:

- patch/build identifier;
- item enable/disable state;
- hero/item restrictions;
- unlock or prerequisite state;
- candidate-generator snapshot version actually active at the timestamp.

### H5 - short-horizon opportunity context that is pre-decision observable

Only after H1-H4.

Examples to audit, not automatically add:

- current alive/dead state;
- current health and position-derived opportunity state;
- recent combat state;
- current objective/shop transition state;
- exact time since last purchase;
- time since last inventory mutation.

Future outcomes remain forbidden as Behavioral features.

## 5. Stage A - observability inventory

No model training is allowed in this stage.

Build `recommendation-behavioral-v7-observability-inventory.json` with one row per candidate source field:

- canonical field name;
- source system;
- source entity/table/event;
- data type;
- semantic meaning;
- timestamp semantics;
- availability rate;
- match coverage;
- player coverage;
- whether value is directly observed or reconstructed;
- reconstruction method if applicable;
- leakage classification;
- acceptable for Behavioral V7: yes/no;
- rejection reason.

Sources to audit:

- retained raw timeline/event payloads;
- PostgreSQL schema and historical rows;
- replay/demo-derived artifacts available on the VPS;
- purchase/inventory event streams;
- candidate-generator snapshots and metadata;
- any historical ingestion source already used by the application.

Stage A gate:

At least one genuinely new pre-decision variable family must be found with sufficient historical coverage, or the project must explicitly conclude that V7 cannot be backfilled from existing data.

## 6. Stage B - timestamp and leakage audit

No model training is allowed.

Every proposed V7 field must pass a temporal audit:

- source timestamp <= decision timestamp;
- no final outcome dependency;
- no short-horizon outcome dependency;
- no next-action dependency;
- no future inventory mutation dependency;
- no candidate-set construction using the observed action;
- no FUTURE_TEST access.

For reconstructed fields, measure:

- alignment lag distribution;
- missingness;
- duplicate/conflicting source records;
- interpolation or forward-fill interval;
- percentage of rows requiring reconstruction rather than exact observation.

Any field with ambiguous future leakage is rejected instead of being repaired statistically.

## 7. Stage C - Dataset V7 design

Only after Stage A/B pass.

Create a new immutable dataset version instead of modifying Dataset V6 in place.

Minimum Dataset V7 additions:

- `observabilityVersion`;
- per-field provenance metadata;
- exact source timestamp or alignment age for newly added state;
- missingness indicators for new variables;
- decision-opportunity contract;
- feasibility contract distinct from candidate coverage;
- candidate provenance retained from V6 work.

The dataset must distinguish:

1. `coverageUniverse` - actions reconstructable from historical support;
2. `behavioralChoiceSet` - ex-ante feasible/available actions at the decision timestamp;
3. `observedActionCovered` - whether the realized action is in that ex-ante set.

Observed action must never be injected after the fact.

## 8. Stage D - feasible choice-set V7 reconstruction

No neural or boosted model training yet.

Rebuild deterministic candidate sets using only V7 pre-decision observables.

Evaluate several predefined contracts, for example:

- V6 `MERGED_TOP_96` reference;
- V7 feasibility-filtered Top96;
- V7 feasibility-filtered dynamic set;
- primary generator plus strictly justified recovery candidates.

For every contract report:

- observed-action coverage;
- candidate count p50/p90/p95/p99;
- observed rank p50/p90/p95;
- support of cheap inverse-rank/historical/generator priors;
- coverage by PHASE, TIME, ECONOMY, HERO, ACTION and TIER;
- fraction of candidates removed by each feasibility rule;
- fraction of observed actions that would be removed;
- missing-observability rate.

Choice-set V7 gate:

- overall observed-action coverage >= 0.99;
- every major cohort coverage >= 0.95;
- observed action never injected;
- no future information;
- meaningful candidate-set reduction or feasibility discrimination relative to V6 Top96;
- late/high-economy choice-set behavior must improve or at least remain coverage-safe.

If new observables do not change the feasible set or prior support characteristics, do not proceed to expensive training.

## 9. Stage E - information-gain falsification gate

This is the key permission gate before any new Behavioral model training.

Use TRAIN/TUNING MATCH-disjoint diagnostics only.

Compare Dataset V6 observables against V7 observables using cheap models or non-parametric conditional diagnostics.

Required evidence on independent TUNING matches:

- V7 features improve raw log loss over the equivalent V6 cheap baseline;
- V7 features improve support, especially late/high-economy cohorts;
- the gain remains when model capacity is held fixed;
- improvement is not explained only by candidate-set size reduction;
- at least one newly observed variable family has measurable incremental predictive information after conditioning on V6 state/history.

Recommended minimum authorization threshold before expensive training:

- overall support improvement >= 1.0 percentage point over the matched V6 diagnostic baseline;
- late support improvement >= 2.0 percentage points or late raw-log-loss improvement >= 0.03;
- high-economy support improvement >= 2.0 percentage points or high-economy raw-log-loss improvement >= 0.03;
- no degradation in observed-action candidate coverage below the Stage D gate.

If this gate fails, stop. Do not compensate with a larger model.

## 10. Stage F - Behavioral V7 bounded model screen

Only Stage E may authorize this training.

Start with the simplest model family that can consume the new information:

1. fixed-capacity linear/listwise baseline;
2. ordered-history Sequence model using the same architecture capacity as the best V6 Sequence reference;
3. only if justified by diagnostics, one richer model family.

Do not start with a broad architecture sweep.

All bounded screens must use:

- immutable Dataset V7 lineage;
- immutable MATCH split;
- FUTURE_TEST excluded;
- raw within-decision propensity contract;
- no candidate probability flooring;
- TUNING excluded from parameter updates and early stopping unless a separate nested split is explicitly defined;
- long training launched as detached background systemd service;
- 6 GiB RAM limit, 10 GiB memory+swap limit and 4096 MiB Node heap unless separately justified;
- one-shot training requests deleted immediately after the intended launcher run appears;
- duplicate service/container protection.

## 11. Behavioral V7 continuation and release gates

A bounded V7 model may continue only if it materially exceeds the V6 ceiling.

Minimum bounded continuation gate:

- candidate coverage >= 0.99;
- support >= 0.86;
- support > V6 Sequence support by at least 1 percentage point;
- raw log loss < `2.747655053608051`;
- floor sensitivity < `0.28`;
- major low-support groups <= 2;
- PHASE:LATE support > `0.7670886075949367`;
- ECONOMY:GE_20000 support > `0.7611583421891605`;
- structural audit pass;
- raw propensity contract preserved.

The production-eligible Behavioral release gate remains stricter:

- candidate coverage >= 0.99;
- behavior support coverage >= 0.90;
- no major cohort support below 0.75;
- extreme candidate probability rate <= 0.01;
- probability-floor maximum log-loss delta <= 0.02;
- full structural audit pass;
- full-corpus build;
- training artifact eligible;
- exact Dataset V7 SHA lineage.

Do not lower the 90% support release target to make V7 pass.

## 12. Stage G - strict MATCH cross-fit and full Behavioral

Only after a bounded V7 continuation PASS.

Order:

1. strict MATCH-grouped cross-fit on TRAIN;
2. independent TUNING evaluation;
3. propensity audit;
4. full-readiness cost/resource check;
5. one full Behavioral V7 training run;
6. full release-gate verification.

If strict cross-fit fails, do not run full training.

## 13. Stage H - Value V8 remains downstream

Value V8 remains blocked until a full Behavioral V7 artifact passes the release gate.

Only then:

1. Value V8 input-readiness verification;
2. bounded Value V8;
3. offline Value verification;
4. explicit new authorization for any full Value/shadow/production/canary work.

Behavioral observability work must not silently unlock production rollout.

## 14. Explicit stop conditions

Stop the V7 program and document the ceiling if any of the following occurs:

- no reliable new pre-decision state can be recovered from existing historical sources;
- reliable new state exists but historical coverage is too low to build an unbiased V7 dataset;
- V7 choice-set reconstruction fails the 99%/95% coverage gates;
- V7 information-gain diagnostic fails on independent MATCH groups;
- bounded V7 still remains near the V6 ceiling after genuinely new observables are added;
- apparent improvements require future leakage, observed-action injection, synthetic wallet proxies or relaxed support thresholds.

In that case the correct next project is new telemetry/data collection, not another offline model sweep.

## 15. New telemetry plan if historical backfill is impossible

If existing history cannot provide the missing state, introduce a forward-looking telemetry schema before collecting more training data.

Priority fields:

- exact spendable currency;
- exact shop/purchase-opportunity state;
- exact inventory-slot legality state;
- candidate feasibility flags with reason codes;
- item/ruleset availability version;
- source timestamps for every decision-time state block;
- candidate generator version and provenance.

Telemetry must be stored before/at recommendation time and must not depend on the later observed action.

Collection must preserve a clear version boundary so Dataset V7/V8 rows with new telemetry are not mixed silently with V6 rows lacking it.

## 16. Deliverables

The V7 program should produce, in order:

1. `recommendation-behavioral-v7-observability-inventory.json`;
2. `recommendation-behavioral-v7-temporal-audit.json`;
3. Dataset V7 schema + immutable build artifact;
4. `recommendation-behavioral-v7-choice-set-audit.json`;
5. `recommendation-behavioral-v7-information-gain-report.json`;
6. bounded Behavioral V7 screen only after information-gain PASS;
7. strict cross-fit evidence only after bounded PASS;
8. full Behavioral V7 artifact only after strict cross-fit PASS.

Every stage must write a machine-readable continuation verdict and the next authorized operation.

## 17. Operations blocked now

Until Stage E passes, the following are explicitly blocked:

- another V6 model-family sweep;
- another V6 Sequence hyperparameter sweep;
- latent-mixture training;
- state-reconstruction retry;
- strict cross-fit on the failed V6 screens;
- full Behavioral training;
- Value V8 training;
- full Value training;
- passive shadow;
- production ranking changes;
- randomized canary;
- rollout;
- synthetic spendable-currency proxies presented as observed data;
- lowering support or floor-sensitivity release thresholds.

The next authorized action is Stage A: build the complete observability inventory from every historical source available to the project.
