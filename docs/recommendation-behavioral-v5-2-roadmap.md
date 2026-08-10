# Recommendation Behavioral V5.2 Recovery Roadmap

## Why V5.2 exists

Behavioral V5.1 failed the quality gates across multiple bounded configurations. Increasing linear hash capacity did not recover support coverage and generally degraded raw log loss, top-1 accuracy, and major low-support cohorts. Probability-floor sensitivity remained far above the release limit.

The next step is therefore an architecture change, not another linear hashed-softmax hyperparameter sweep.

## Non-negotiable safety constraints

- Preserve Replay v2, Dataset V6 v2, all Behavioral V5/V5.1 artifacts, and their SHA-256 lineage.
- Do not lower release thresholds.
- Do not inject the observed action into candidate sets.
- Keep candidate probabilities as the raw within-decision softmax distribution.
- Do not floor or renormalize candidate probabilities.
- Apply propensity stabilization only downstream in Value V8 to the observed propensity.
- Cross-fit Behavioral predictions by MATCH.
- TRAIN is the only training split.
- TUNING may be used for bounded model selection only.
- FUTURE_TEST must not be used for training, calibration, or bounded selection.
- Do not run Value V8 until a full-corpus Behavioral artifact is release eligible.
- Do not enable production ranking, passive shadow, or randomized canary from this roadmap.

## Architecture

Behavioral V5.2 uses a deterministic low-rank two-tower conditional-choice model.

For each candidate, the score is:

`linear_score(state, candidate) + dot(context_tower(state), candidate_tower(candidate))`

The linear score retains the proven V5.1 sparse feature contract as a residual path. The low-rank interaction adds shared nonlinear structure without materializing every state-candidate conjunction into a larger hash table.

The context tower contains match/player state features such as hero, phase, time, economy, inventory, allied/enemy heroes, and recent actions. The candidate tower contains item/action identity, action type, slot, tier, tags, recipe structure, and bounded generator metadata.

Candidate-tower embeddings receive deterministic seeded initialization. Context embeddings start at zero, which keeps the untrained candidate distribution uniform while still producing a non-zero first-step gradient for the context tower. Training remains deterministic.

## Artifact contract

V5.2 is a new incompatible artifact contract:

- schema: `RECOMMENDATION_BEHAVIORAL_V5_2_SCHEMA_VERSION`
- model: `RECOMMENDATION_BEHAVIORAL_V5_2_LOW_RANK_TWO_TOWER_1_RAW_PROPENSITY`
- features: `RECOMMENDATION_BEHAVIORAL_V5_2_FEATURES_1_TWO_TOWER`
- probability contract: `RAW_SOFTMAX_WITHIN_DECISION`
- cross-fitting unit: `MATCH`

V5.1 and V5.2 artifacts must never be accepted interchangeably by downstream consumers.

## Stage 1 - Core model and regression tests

Implement the V5.2 model independently from V5.1 so the running V5.1 full job and immutable artifacts are untouched.

Required tests:

1. deterministic model initialization and prediction;
2. raw softmax normalization for candidate counts 2, 50, 139, and 200;
3. scalar observed-propensity clipping does not mutate the candidate distribution;
4. training increases probability of a repeatedly observed candidate;
5. low-rank context-candidate interaction changes candidate preference when context changes;
6. clone/validation preserve the new model contract;
7. MATCH fold assignment remains deterministic.

## Stage 2 - MATCH-cross-fitted bounded trainer

Add a standalone V5.2 bounded trainer that reads the immutable Dataset V6 artifact directly.

- `maxRows=50000` for the first architecture diagnostic.
- TRAIN only for fitting.
- TUNING for selection metrics.
- FUTURE_TEST excluded from bounded evaluation.
- OOF TRAIN predictions must come from a model that excluded the complete MATCH fold.
- Every output row records schema/model/feature versions and raw propensity semantics.

The first bounded comparison is precommitted before results are visible:

- A: linearHash=8192, embeddingHash=2048, latentDimension=4, epochs=3, learningRate=0.10
- B: linearHash=8192, embeddingHash=4096, latentDimension=8, epochs=4, learningRate=0.08
- C: linearHash=16384, embeddingHash=8192, latentDimension=12, epochs=4, learningRate=0.05
- common: foldCount=5, l2=0.0001, supportProbability=0.01

Selection protocol:

1. release gate pass;
2. fewer major low-support groups;
3. higher support coverage;
4. lower raw log loss;
5. higher top-1 rate;
6. lower probability-floor sensitivity;
7. smaller model footprint;
8. variant ID tie-breaker.

No sampled artifact is release eligible.

## Stage 3 - Architecture decision

Proceed only if V5.2 materially improves the failed V5.1 frontier.

Minimum continuation criteria on the bounded diagnostic:

- support coverage improves by at least 5 percentage points over the best comparable V5.1 bounded result;
- raw log loss is not worse than the best comparable V5.1 result by more than 0.02;
- major low-support group count decreases materially;
- no structural audit failures;
- raw propensity contract is intact.

If none of A/B/C meets the continuation criteria, stop V5.2 and move to a tree/boosted or neural sequence architecture rather than widening the same two-tower model indefinitely.

## Stage 4 - One bounded refinement

If Stage 3 passes, allow exactly one small refinement around the best latent configuration. Do not perform an open-ended sweep.

The refinement may vary only:

- latent dimension;
- embedding hash dimension;
- learning rate;
- epoch count.

Linear feature semantics, Dataset V6, split policy, and release thresholds remain frozen.

## Stage 5 - One full-corpus V5.2 run

Run exactly one full-corpus training using the selected configuration in a new immutable output directory.

Full release gates remain unchanged:

- candidate coverage >= 0.99;
- behavior support coverage >= 0.90;
- no major low-support groups below the configured support threshold;
- extreme candidate probability rate <= 0.01;
- probability-floor maximum log-loss delta <= 0.02;
- structural audit passed;
- training artifact eligible;
- exact Dataset V6 lineage;
- raw candidate probability contract;
- FUTURE_TEST reported but not used for training/calibration/release selection.

If full V5.2 fails, do not run Value V8 and do not repeat full V5.2 with nearby hyperparameters.

## Stage 6 - Resume Value V8 only after Behavioral PASS

Only a release-eligible full V5.2 artifact may unblock the existing bounded Value V8 diagnostic path. Value must be updated to require the exact V5.2 schema/model/feature contract and exact propensity SHA-256 before it can run.

Full Value training, passive shadow, production ranking, and randomized canary remain outside this roadmap unless separately authorized.
