# Recommendation Behavioral V8 training

This directory is the model-development path for the `BEHAVIORAL_BUILDLM` roadmap phase. It deliberately does not provide a switch that can bypass prospective-data, immutable-dataset, registry, or FUTURE_TEST gates.

## Required state before training

Training is authorized only when all of the following are true:

1. Controlled souls evidence can mark spendable souls as verified.
2. Direct shop opportunity is observed with `DIRECT_SOURCE_SIGNAL` provenance.
3. Dataset V8 structural and empirical reports pass on the development window.
4. The roadmap evidence ledger unlocks `PROSPECTIVE_DATA`.
5. The Dataset V8 artifact is registered and independently `VERIFIED` with exact manifest/file hashes.
6. `futureTestUntouched=true` and `futureTestEvaluation=NOT_EVALUATED`.

The API endpoint `POST /deadlock-live/recommendation-training/v8/preflight/:datasetId` enforces the registry and roadmap checks. It is disabled unless `RECOMMENDATION_TRAINING_TOKEN` is configured.

## Dataset construction

Use the manual `Recommendation Dataset Export` workflow on the dedicated `recommendation-dataset-export` runner. The workflow requires explicit chronological windows in this order:

`TRAIN -> VALIDATION -> SHADOW_HOLDOUT -> FUTURE_TEST`

Match assignment uses the first Decision V8 timestamp for the match, so a match cannot cross splits. The export uses the causal Feature Store V8 assembler and the persisted deterministic feasible candidate set. Observed actions are never injected into the candidate set. Development quality gates stop at the end of `SHADOW_HOLDOUT`; FUTURE_TEST diagnostics are not exposed.

The model-development artifact contains files only for `TRAIN`, `VALIDATION`, and `SHADOW_HOLDOUT`. The FUTURE_TEST split is represented only by its sealed chronological descriptor with hidden counts and is not materialized into a readable model-development file. The Python verifier rejects any `future_test.jsonl.gz` file in this artifact.

After export, upload the directory to an approved immutable object store, register the manifest through the protected dataset-registry endpoint, and independently verify the exact manifest SHA and all file SHA/size/row-count values. Training accepts only a registry-verified dataset id.

## Model training

The manual `Recommendation Behavioral Training` workflow runs only on the protected `recommendation-training` environment and a self-hosted runner with the `recommendation-training` label. It has no push, pull-request, or schedule trigger.

The workflow:

1. verifies local dataset bytes against the registry SHA values;
2. asks the API for roadmap/registry preflight for both architectures;
3. trains the RNN baseline on `TRAIN`, with early stopping on `VALIDATION`;
4. trains the Transformer candidate on exactly the same observables and split contract;
5. evaluates both on `SHADOW_HOLDOUT` only;
6. runs the equal-observables RNN/Transformer ablation gate;
7. builds an immutable Transformer model bundle only if the Behavioral and ablation gates pass.

`FUTURE_TEST` cannot be decoded by `train_behavioral.py` or `compare_behavioral.py` because it is not present in the model-development artifact and the shared loader explicitly rejects that split. No FUTURE_TEST example can enter training, validation, architecture selection, or model-bundle metrics.

## Objective and probabilities

Both architectures optimize grouped listwise cross entropy over the complete deterministic feasible choice set. Probabilities are raw softmax probabilities over that set. Probability floors are forbidden.

The RNN and Transformer use the same state, history, action tokenization, hash dimension, history limit, dataset SHA, feature contract, and candidate-generator version. Architecture-specific parameters are the sequence encoder only. The ablation report refuses comparison when the equal-observables identity differs.

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
