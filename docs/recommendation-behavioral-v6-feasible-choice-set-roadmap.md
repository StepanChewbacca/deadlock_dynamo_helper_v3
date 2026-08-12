# Recommendation Behavioral V6 - Feasible Choice Set and Propensity Recovery

## Status

Behavioral V5.2 is frozen as an architecture experiment that failed its continuation criteria. Dataset V6, Historical Replay, V5.1 evidence and V5.2 evidence remain immutable. Value V8, full Value training, passive shadow, production ranking and randomized canary stay blocked until a release-eligible Behavioral model exists.

This roadmap changes the order of work. The next expensive training run is forbidden until the data/choice-set and optimizer diagnostics below pass.

## Frozen evidence

- Dataset V6 SHA-256: `e8b11e26df37ff1e17b334eda18ea2141cfb7fa78f0a34eaf95d448c22962235`
- V5.1 MATCH diagnostic sample SHA-256: `8d87519d797b54fc3f726837e80bb79968b44dc59960dadcb934261f329ce1ac`
- V5.1 sweep summary SHA-256: `0e06b01e8f33257754d6994a10411b5b76da16d07d17c2fc6c7c236b776d4f4e`
- FUTURE_TEST is excluded from architecture selection.
- Existing replay and Dataset V6 artifacts are not rewritten.

## Root-cause evidence already established

A read-only forensic pass over the immutable MATCH sample found:

- selected decisions: 44,979
- Behavioral-eligible decisions: 44,942
- observed-action candidate coverage: about 99.9177%
- candidate count median: about 140
- all eligible decisions contain more than 100 candidates
- observed action rank becomes progressively worse with game time and economy
- raw retained `player_controller` events expose `net_worth`, but no separate spendable-souls field was found in the audited payloads

The evidence supports a primary hypothesis: the offline recovery universe used to maximize observed-action coverage is wider than the action set over which Behavioral propensity should be normalized.

## Non-negotiable semantics

Two concepts must remain separate:

1. Coverage universe - can the replay reconstruct the historically observed purchase at all?
2. Behavioral choice set - which actions were ex-ante plausible choices in the state being modeled?

The observed action may never be injected into either set merely because it was observed.

`netWorth` may not be reinterpreted as spendable currency. Affordability may only be used when a reliable decision-time source is identified.

## Stage 1 - Candidate provenance instrumentation

Add a provenance-aware candidate API without changing the existing replay contract.

Every merged candidate must report:

- source membership: `PRIMARY_STATE`, `HERO_SUPPORT_UNION`
- `primaryRank` when present
- `supportRank` when present
- `supportUnionOnly`

The old historical replay output remains byte-compatible and immutable.

### Gate

- unit tests prove primary/support membership
- observed action is never injected
- snapshot temporal leakage protections remain unchanged
- existing replay API remains unchanged

## Stage 2 - Frozen-sample choice-set audit

Run a read-only audit on the exact V5.1/V5.2 MATCH sample.

For every eligible decision, recompute primary and support candidates using the exact immutable candidate-generator snapshot referenced by the row lineage.

Report:

- primary candidate count distribution
- support-union candidate count distribution
- merged candidate count distribution
- observed action coverage in primary only
- observed action coverage after support union
- fraction of observed actions that are support-union-only
- observed primary/support ranks
- the same metrics by game time, economy band, hero, phase, action type and candidate count
- no-training priors evaluated on primary-only and merged sets

### Gate

The audit must produce exact lineage and zero FUTURE_TEST evaluation. Training remains unauthorized regardless of result.

## Stage 3 - Feasibility-source audit

Search existing historical sources for an actual decision-time spendable resource value.

Sources to check:

- retained raw timeline/demo events
- PostgreSQL match/player tables
- purchase/transaction history
- any immutable game-state snapshots already used by replay

### Outcomes

If a reliable field exists, define explicit features such as:

- `spendableSouls`
- `candidateAffordable`
- `soulShortfall`

If no reliable field exists, record `affordabilityObserved=false`. Do not infer affordability from net worth.

## Stage 4 - Behavioral choice-set candidates

Evaluate deterministic ex-ante set definitions. Candidate definitions may use only data available before the observed purchase.

Candidate filters/features may include:

- primary-state membership
- state distance
- time compatibility
- inventory/recipe legality
- slot legality
- action type
- generator score/rank
- reliable affordability only if Stage 3 finds it

Do not hard-code a target size such as 20. Measure the smallest defensible set that preserves observed-action coverage.

### Required diagnostics

For every proposed set:

- observed-action coverage
- p50/p90/p95 candidate count
- observed rank distribution
- historical/generator prior support at 0.01
- late-game coverage
- high-economy coverage
- support-union-only observed-action rate

### Gate

A candidate Behavioral set may proceed only if:

- observed-action coverage >= 0.99
- it materially reduces the broad-union tail
- late-game and high-economy coverage do not collapse
- construction is deterministic and ex-ante

If no such set exists, do not train. The data contract must be revised first.

## Stage 5 - Optimizer correction

Before comparing model families, remove candidate-count-dependent regularization artifacts from hashed models.

For each decision:

1. compute all candidate gradients
2. aggregate gradients by unique hashed parameter bucket
3. update each bucket once
4. apply regularization/weight decay once per updated parameter

Add diagnostics for:

- unique hashed buckets per decision
- repeated bucket touches
- collision rate
- update magnitude by candidate-count band
- effective regularization by candidate-count band

### Gate

Unit tests must prove that duplicate candidate touches do not multiply L2 decay for the same parameter in one decision.

## Stage 6 - Equal-capacity architecture ablation

Use one immutable bounded MATCH sample and the same Behavioral choice set for all variants.

Required controls:

- `L`: V5.1-style linear model with `linearHashDimension=65536`
- `LT`: identical `linearHashDimension=65536` plus low-rank context-candidate tower
- optional tower-only negative control

Do not compare a 65k linear baseline against an 8k/16k linear challenger and attribute the result only to the tower.

### Metrics

- raw log loss
- Brier score
- top-1 rate
- support coverage at 0.01
- major low-support cohorts
- calibration
- candidate separation
- probability-floor sensitivity on the observed propensity only
- TRAIN/TUNING gap

## Stage 7 - Cheap non-training/model-light baselines

Always report:

- normalized historical-probability prior
- normalized generator-score prior
- inverse-rank diagnostic prior
- equal-capacity linear model

A new family must beat trivial priors on predictive quality while maintaining support. A high support number alone is not enough.

## Stage 8 - Model-family escalation

If the corrected equal-capacity linear/tower family still fails, stop widening V5.2.

Preferred next challenger:

- grouped boosted/listwise conditional-choice model over `state x candidate`

Only move to a sequence/neural purchase-history encoder if residual diagnostics show that ordered action history is the remaining missing signal after choice-set and optimizer fixes.

No neural model can compensate for an incorrectly defined normalization universe or an unobserved feasibility variable.

## Stage 9 - Behavioral V6 bounded training gate

Only after Stages 1-8 are complete may one bounded Behavioral V6 architecture comparison run.

Safety:

- exact immutable MATCH sample
- no FUTURE_TEST
- no automatic budget expansion
- no duplicate concurrent run
- sampled outputs remain `trainingArtifactEligible=false`

Release thresholds are not relaxed:

- candidate coverage >= 0.99
- behavior support coverage >= 0.90
- no major group below 0.75 support
- extreme candidate probability rate <= 0.01
- probability-floor maximum log-loss delta <= 0.02
- structural audit PASS
- raw within-decision propensity contract

## Stage 10 - Full Behavioral V6

Full training is allowed only after bounded PASS and a separate readiness report pins:

- Dataset SHA
- choice-set contract/version
- model/feature versions
- selected hyperparameters
- bounded evidence SHA
- projected runtime/memory

A failed or timed-out full run does not authorize a larger automatic budget.

## Stage 11 - Value V8

Only a release-eligible full Behavioral V6 may unblock:

1. Value input-readiness audit
2. bounded Value V8 diagnostic
3. candidate sensitivity tests
4. candidate permutation test
5. metadata permutation test
6. state-only comparison
7. offline verification

Full Value training, passive shadow, production ranking and randomized canary remain separately blocked.

## Falsification tests

### H1 - Support union is the main dilution source

Test: compare primary-only and merged normalization universes.

Reject H1 if the set shrinks materially with >=99% coverage but propensity support/log loss do not improve.

### H2 - Missing economic feasibility drives late-game ambiguity

Test: identify an exact spendable-resource source and add true affordability.

Reject H2 if late-game/high-economy diagnostics do not improve after using reliable affordability.

### H3 - V5.2 looked weak because the linear residual was reduced

Test: 65,536 linear versus the same 65,536 linear plus tower.

Reject H3 if the tower challenger does not improve the equal-capacity control.

### H4 - Per-candidate L2/hash reuse harms large candidate sets

Test: aggregate bucket gradients and decouple decay.

Reject H4 if results remain insensitive to the corrected update semantics.

### H5 - Current function class remains insufficient

Only after H1-H4 are resolved compare linear/tower against boosted/listwise and then sequence models.

## Stop boundaries

This roadmap does not authorize:

- Value training before Behavioral PASS
- full Value V8
- passive shadow
- production ranking changes
- randomized canary
- production rollout
