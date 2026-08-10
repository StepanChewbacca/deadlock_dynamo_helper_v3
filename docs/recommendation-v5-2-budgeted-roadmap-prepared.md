# Recommendation V5.2 budgeted roadmap preparation

This document defines the prepared execution path after the initial Behavioral V5.2 bounded architecture sweep. It does not authorize any new training by itself.

## Immutable lineage

- Dataset V6 artifact SHA-256: `e8b11e26df37ff1e17b334eda18ea2141cfb7fa78f0a34eaf95d448c22962235`
- Pinned MATCH diagnostic sample SHA-256: `8d87519d797b54fc3f726837e80bb79968b44dc59960dadcb934261f329ce1ac`
- Frozen V5.1 sweep summary SHA-256: `0e06b01e8f33257754d6994a10411b5b76da16d07d17c2fc6c7c236b776d4f4e`
- Behavioral V5.2 model contract: `RECOMMENDATION_BEHAVIORAL_V5_2_LOW_RANK_TWO_TOWER_1_RAW_PROPENSITY`
- Behavioral V5.2 feature contract: `RECOMMENDATION_BEHAVIORAL_V5_2_FEATURES_1_TWO_TOWER`
- Behavioral probability contract: `RAW_SOFTMAX_WITHIN_DECISION`

Existing Replay, Dataset V6, V5.1, and diagnostic artifacts remain immutable.

## Cost-control rules

1. Model training is started only by an explicit one-shot file under `.github/training-requests/`.
2. Request templates live under `.github/training-request-templates/` and never trigger workflows.
3. A one-shot request file must be removed after GitHub creates the intended run so later commits cannot retrigger training.
4. Every prepared Behavioral refinement, Behavioral full, and bounded Value training process has a hard maximum of 20 minutes.
5. Every training workflow has a total job timeout of 30 minutes and explicit Docker cleanup.
6. A timeout is a failure. The workflow must not automatically retry with a larger budget.
7. No training is started directly on the VPS.
8. Full Value V8, production ranking, passive shadow, and randomized canary remain unauthorized.

## Stage 1 - initial V5.2 bounded architecture sweep

The current budgeted run uses the three precommitted V5.2 variants on the exact pinned MATCH sample.

Continue only when all architecture-continuation checks pass:

- support coverage improves by at least 5 percentage points versus the frozen preferred V5.1 sample baseline;
- raw log loss is within +0.02 of that V5.1 baseline;
- the number of major low-support cohorts decreases;
- structural audit passes;
- raw-softmax propensity semantics remain intact.

If any check fails, stop the low-rank two-tower path. Do not widen it indefinitely and do not run Value V8.

## Stage 2 - one bounded V5.2 refinement

Prepared files:

- `scripts/run-recommendation-behavioral-v5-2-refinement.mjs`
- `.github/workflows/recommendation-behavioral-v5-2-refinement-budgeted.yml`
- `.github/training-request-templates/recommendation-behavioral-v5-2-refinement-v1.example.json`

The refinement is allowed only after Stage 1 continuation passes. It keeps the same Dataset, MATCH sample, folds, L2, support threshold, release thresholds, and split semantics.

Only these dimensions may vary around the Stage 1 winner:

- embedding hash dimension;
- latent dimension;
- epoch count;
- learning rate.

The linear hash dimension remains fixed to the Stage 1 winner. Exactly one refinement sweep is allowed.

The refinement result may only prepare a full-training candidate. It never authorizes full training or Value V8.

## Stage 3 - Behavioral V5.2 full readiness and explicit cost decision

Prepared files:

- `scripts/verify-recommendation-behavioral-v5-2-full-readiness.mjs`
- `.github/workflows/recommendation-behavioral-v5-2-full-readiness.yml`
- `.github/training-request-templates/recommendation-behavioral-v5-2-full-readiness-v1.example.json`

This stage performs no training. It pins the refinement winner and emits deterministic work-unit estimates:

- training dataset passes;
- evaluation passes;
- estimated decision visits;
- model parameter count;
- approximate model weight bytes.

The readiness report ends with `fullTrainingAuthorized=false`. A separate explicit cost decision is required before a full-training request may be created.

## Stage 4 - full Behavioral V5.2, only after explicit authorization

Prepared files:

- `scripts/run-recommendation-behavioral-v5-2-full.mjs`
- `.github/workflows/recommendation-behavioral-v5-2-full-budgeted.yml`
- `.github/training-request-templates/recommendation-behavioral-v5-2-full-v1.example.json`

The runner streams Dataset V6, trains MATCH-level OOF fold models plus one full-TRAIN model, and writes raw propensities for TRAIN and TUNING. FUTURE_TEST is counted for audit only and is never trained on, selected on, calibrated on, or evaluated.

Required release gates are unchanged:

- candidate coverage >= 0.99;
- behavior support coverage >= 0.90;
- major low-support group count = 0;
- extreme candidate probability rate <= 0.01;
- probability-floor maximum log-loss delta <= 0.02;
- structural audit passed;
- full-corpus build;
- training artifact eligible;
- exact Dataset V6 SHA lineage;
- raw-softmax propensity contract;
- no Behavioral candidate flooring or IPS clipping.

A failed or timed-out full run does not authorize another larger/longer retry.

## Stage 5 - Value V8 input readiness

Prepared files:

- `scripts/verify-recommendation-value-v8-v5-2-input-readiness.mjs`
- `.github/workflows/recommendation-value-v8-v5-2-input-readiness.yml`
- `.github/training-request-templates/recommendation-value-v8-v5-2-input-readiness-v1.example.json`

This stage performs no training. It re-hashes the full Behavioral V5.2 artifacts, streams the propensity artifact, verifies raw-softmax semantics, and emits the exact manifest/model/propensity/evaluation/audit hashes needed by the bounded Value request.

The V5.2 path uses the standalone V5.2-aware bounded Value executor instead of pretending the artifact is a V5.1 model.

## Stage 6 - bounded Value V8 diagnostic

Prepared files:

- `scripts/run-recommendation-value-v8-bounded-v5-2.mjs`
- `.github/workflows/recommendation-value-v8-bounded-v5-2.yml`
- `.github/training-request-templates/recommendation-value-v8-bounded-v5-2-v1.example.json`

Fixed diagnostic configuration:

- maxRows = 50000;
- foldCount = 5;
- stateEpochs = 3;
- actionEpochs = 5;
- stateLearningRate = 0.03;
- actionLearningRate = 0.02;
- stateL2 = 0.0001;
- actionL2 = 0.0001;
- hashDimension = 4096;
- propensityFloor = 0.01;
- maximumImportanceWeight = 20.

The action model receives the raw Behavioral V5.2 observed propensity. Value V8 performs the propensity floor and maximum importance-weight clipping once, at action training.

Required bounded Value gates:

- audit passed;
- diagnostic artifact eligible;
- diagnostic gate passed;
- full training recommended by the diagnostic gate;
- diagnosticOnly = true;
- maxRows = 50000;
- not full corpus;
- TUNING not used for training;
- FUTURE_TEST not used for training or selection and not evaluated;
- exact Dataset and Behavioral propensity lineage.

This stage does not authorize full Value V8.

## Stage 7 - deterministic offline verification

Prepared files:

- `scripts/run-recommendation-value-v8-offline-verification-v5-2.mjs`
- `.github/workflows/recommendation-value-v8-offline-verification-v5-2.yml`
- `.github/training-request-templates/recommendation-value-v8-offline-verification-v5-2-v1.example.json`

This stage performs no training. It verifies:

- exact SHA lineage for Dataset and all bounded Value artifacts;
- deterministic repeated inference;
- replayed predictions exactly matching stored diagnostic predictions;
- TUNING-only replay;
- non-trivial candidate ranking;
- state-only versus state+action-residual metrics;
- candidate and metadata permutation degradation;
- p50/p95/p99/max inference latency;
- heap usage before/after/peak;
- FUTURE_TEST isolation.

This is the end of the currently prepared/authorized restart roadmap.

## Explicitly outside this roadmap

Do not start or activate any of the following without a new user authorization and a separate cost/safety decision:

- full Value V8 training;
- production ranking changes;
- passive shadow;
- randomized canary;
- canary rollout percentages;
- production rollout.

## One-shot execution order

```text
bounded V5.2 architecture
  -> if continuation PASS: one bounded refinement
  -> full readiness/cost report
  -> explicit user cost authorization
  -> budgeted full Behavioral V5.2
  -> if full Behavioral PASS: Value input readiness
  -> budgeted bounded Value V8
  -> if bounded Value PASS: deterministic offline verification
  -> STOP
```

No request files are committed by the preparation PR. Therefore preparation changes cannot start training by themselves.
