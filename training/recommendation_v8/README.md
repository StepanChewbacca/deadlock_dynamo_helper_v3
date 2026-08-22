# Recommendation Behavioral V8 training

This directory is the model-development path for the `BEHAVIORAL_BUILDLM` roadmap phase. It deliberately does not provide a switch that can bypass prospective-data, immutable-dataset, registry, or FUTURE_TEST gates.

## Required state before training

Training is authorized only when all of the following are true:

1. Controlled souls evidence can mark spendable souls as verified.
2. Direct shop opportunity is observed with independently approved `DIRECT_SOURCE_SIGNAL` provenance.
3. Dataset V8 structural and empirical reports pass on the exact development window.
4. The roadmap evidence ledger unlocks `PROSPECTIVE_DATA`.
5. The Dataset V8 artifact is registered and independently `VERIFIED` with exact manifest/file hashes.
6. `futureTestUntouched=true` and `futureTestEvaluation=NOT_EVALUATED`.
7. `TRAIN`, `VALIDATION`, and `SHADOW_HOLDOUT` contain complete non-crossing matches, and `SHADOW_HOLDOUT` contains at least 10,000 decisions.
8. The current data still satisfy the final pretraining gates at launch time: ruleset evidence coverage >= 99.9%, explicit feasibility evaluation coverage >= 99.5%, observed historical action feasible coverage >= 99% overall, and >= 98% in every major action-type/game-phase cohort with at least 100 labeled decisions.
9. The secure training runner can recreate the pinned offline environment, import the exact training dependencies, and provide the configured CUDA device.
10. Both RNN and Transformer API preflights pass against the same verified dataset SHA.

The API endpoint `POST /deadlock-live/recommendation-training/v8/preflight/:datasetId` re-evaluates the current controlled-souls, observability, and Dataset V8 reports over the dataset development window in addition to checking the immutable registry and roadmap state. A stale historical PASS in the roadmap therefore cannot bypass a current failing data gate. The endpoint is disabled unless `RECOMMENDATION_TRAINING_TOKEN` is configured.

## The only accepted ready-to-train signal

Before starting training, run the manual `Recommendation Pretraining Readiness` workflow. It uses the same protected `recommendation-training` environment and the same dedicated self-hosted runner class as the real training workflow, but it does not execute either model trainer.

The readiness workflow fails closed unless it can:

1. confine the dataset path to `RECOMMENDATION_DATASET_STAGING_ROOT`;
2. recreate a Python 3.12 environment exclusively from `RECOMMENDATION_TRAINING_WHEELHOUSE`;
3. verify exact pinned training dependency versions and the configured CUDA device;
4. verify the immutable dataset and manifest SHA values plus every artifact file and development split isolation invariant;
5. verify the dataset action contract and untouched FUTURE_TEST state;
6. pass the current roadmap/registry/data API preflight for the RNN config;
7. pass the same API preflight for the Transformer config.

Only a successful final step with status `READY_TO_START_BEHAVIORAL_TRAINING` means that pre-training preparation is complete. Its `trainingPerformed` field is always `false`. The next action after that exact status is to run `Recommendation Behavioral Training` with the same dataset id, dataset SHA, manifest SHA, dataset directory, and action contract.

`training/recommendation_v8/pretraining_environment_check.py` is shared by the no-training readiness workflow and the real training workflow so the runner/device checks cannot silently drift between readiness and training.

## Dataset construction

Use the manual `Recommendation Dataset Export` workflow on the dedicated `recommendation-dataset-export` runner. The workflow requires explicit chronological windows in this order:

`TRAIN -> VALIDATION -> SHADOW_HOLDOUT -> FUTURE_TEST`

A match is eligible for a development split only when its first Decision V8 timestamp is at or after the split start and its last Decision V8 timestamp is strictly before the split end. Matches crossing a split boundary are excluded instead of being partially assigned. This preserves match-level isolation and prevents decisions occurring in a later window from leaking into an earlier split. The export uses the causal Feature Store V8 assembler and the persisted deterministic feasible candidate set. Observed actions are never injected into the candidate set. Development quality gates stop at the end of `SHADOW_HOLDOUT`; FUTURE_TEST diagnostics are not exposed.

The empirical Dataset V8 gate also checks that every candidate has explicit feasibility information whenever that action requires it, that the observed historical action remains feasible at the required overall and major-cohort rates, and that ruleset/inventory/transaction evidence meets the checked thresholds. `WAIT_SAVE` is treated as explicitly evaluated by construction rather than requiring a shop signal that is irrelevant to waiting.

The model-development artifact contains files only for `TRAIN`, `VALIDATION`, and `SHADOW_HOLDOUT`. The FUTURE_TEST split is represented only by its sealed chronological descriptor with hidden counts and is not materialized into a readable model-development file. The Python verifier rejects any `future_test.jsonl.gz` file in this artifact. Manifest validation also requires exact split order and exact equality between each development split's descriptor decision count and its artifact row count.

After export, upload the directory to an approved immutable object store, register the manifest through the protected dataset-registry endpoint, and independently verify the exact manifest SHA and all file SHA/size/row-count values. Training accepts only a registry-verified dataset id.

## GEP canonicalization evidence

The canonical GEP contract includes a versioned `match_info.roster` documented-shape fixture under `packages/shared/test/fixtures/gep`. CI requires 100% mapping coverage for the expected canonical fields and preserves unknown raw fields instead of silently dropping them. This fixture is explicitly documentation-derived; it must not be described as a captured Overwolf Simulator payload unless such a capture is actually added later.

## Model training

The manual `Recommendation Behavioral Training` workflow runs only on the protected `recommendation-training` environment and a self-hosted runner with the `recommendation-training` label. It has no push, pull-request, or schedule trigger.

The workflow:

1. recreates the pinned offline Python environment and rechecks Python/Torch/CUDA readiness;
2. verifies local dataset bytes against the registry SHA values and split-isolation invariants;
3. asks the API for current roadmap/registry/data preflight for both architectures;
4. trains the RNN baseline on `TRAIN`, with early stopping on `VALIDATION`;
5. trains the Transformer candidate on exactly the same observables and split contract;
6. evaluates both on `SHADOW_HOLDOUT` only;
7. runs the equal-observables RNN/Transformer ablation gate;
8. builds an immutable Transformer model bundle only if the Behavioral and ablation gates pass.

`FUTURE_TEST` cannot be decoded by `train_behavioral.py` or `compare_behavioral.py` because it is not present in the model-development artifact and the shared loader explicitly rejects that split. No FUTURE_TEST example can enter training, validation, architecture selection, or model-bundle metrics.

## Objective and probabilities

Both architectures optimize grouped listwise cross entropy over the complete deterministic feasible choice set. Probabilities are raw softmax probabilities over that set. Probability floors are forbidden.

The RNN and Transformer use the same state, history, action tokenization, hash dimension, history limit, dataset SHA, feature contract, candidate-generator version, seed, chronological split contract, and release-gate thresholds. Architecture-specific parameters are the sequence encoder only. The pretraining environment checker and security audit reject equal-observables configuration drift before training, and the ablation report refuses comparison when the runtime equal-observables identity differs.

## Artifacts

A successful run leaves a staging directory on the secure runner containing RNN metrics/checkpoint, Transformer metrics/checkpoint, the ablation report, and a model bundle. The bundle is not active merely because training succeeded.

The next control-plane sequence is:

`upload immutable bundle -> model registry REGISTERED -> independent hash verification -> VERIFIED -> runtime compatibility/gate check -> ACTIVE`

## Policy V1 construction and release identity

Policy V1 is a support-constrained composition of an exact verified Behavioral bundle, an exact verified causal Value bundle, and the frozen policy parameters `temperature`, `behaviorRegularization`, and a strictly positive `minimumBehaviorSupport`.

`POST /deadlock-live/recommendation-policy/v1/build-spec` is the protected Policy builder. It is authorized only after the roadmap has unlocked `CAUSAL_VALUE`, FUTURE_TEST is still untouched, and the selected Behavioral and Value manifests are the exact manifests referenced by the immutable `behavioralOffline` and `causalValueRelease` PASS evidence snapshots. The two dependencies must also agree on feature contract, action contract, candidate generator, and have non-empty ruleset/catalog compatibility intersections.

The builder returns the exact bytes for `policy.json`, their SHA/size, and a valid immutable `POLICY` model-bundle manifest. It does not register, verify, activate, deploy, or expose the policy. The operator must upload those exact bytes and manifest to the immutable artifact store, register the manifest, independently verify it, and only then use that exact policy in the Policy A/B experiment.

When `policyAbRelease` is materialized, `modelId` and `modelVersion` are mandatory. The A/B PASS snapshot records the exact verified POLICY manifest SHA. A later FUTURE_TEST evaluation is rejected unless its policy manifest SHA is exactly the same SHA that passed Policy A/B. This prevents swapping in a tuned or otherwise different policy between online release validation and the final test.

## Final FUTURE_TEST opening

FUTURE_TEST is a one-time final evaluation, not a model-development split. It remains unavailable until the roadmap has unlocked `POLICY_V1` and the exact final policy exists as a verified immutable `POLICY` model bundle.

The final evaluator must produce a `recommendation-future-test-evaluation-v1` artifact tied to the exact policy manifest SHA. That artifact records the pre-registered evaluation-plan SHA, immutable evaluation-artifact SHA/reference, frozen model-selection/hyperparameter/candidate-generator/feature-contract assertions, and `futureTestAccessCount=1`.

Only `POST /deadlock-live/recommendation-roadmap/v1/materialize/future-test` can turn that artifact into `futureTestEvaluation` evidence. The generic roadmap evidence endpoint explicitly rejects direct FUTURE_TEST evaluation writes, and the shared evidence contract requires the dedicated frozen-artifact evaluator identity. A second final evaluation is rejected.

The FUTURE_TEST materializer also requires the latest `policyAbRelease` evidence to be PASS, loads its immutable snapshot, and verifies that the released policy manifest SHA equals the exact verified policy named by the final evaluation artifact.

`SEQUENTIAL_RL_RESEARCH` can unlock only after this final evidence is `PASS` and its separate sequential-RL research gate is also `PASS`. No workflow in this directory automatically opens FUTURE_TEST, activates a policy, deploys to production, or enables randomized traffic.
