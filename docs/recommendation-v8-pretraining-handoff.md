# Recommendation V8 pretraining handoff

This document defines the last operational sequence before Behavioral BuildLM training may start. It does not authorize or run training, Dataset V8 export, deployment, model activation, or FUTURE_TEST evaluation.

## Ready-to-train boundary

The system may be described as `READY_TO_START_BEHAVIORAL_TRAINING` only after all steps below have completed with real evidence and the protected `Recommendation Pretraining Readiness` workflow has emitted its final no-training attestation.

1. Collect controlled souls observations under the existing controlled evidence contract. Do not mark spendable souls verified from client self-assertion. Materialize foundational roadmap evidence and require `controlledSoulsValidation=PASS`.
2. Collect real Overwolf diagnostic sessions with manual `SHOP_AVAILABLE` and `SHOP_UNAVAILABLE` markers. Export the diagnostic candidate report. The candidate analyzer is discovery-only and must remain `candidateOnly=true` and `canPromoteToDirectSource=false`.
3. Independently validate the selected candidate against real AVAILABLE and UNAVAILABLE state transitions. Preserve the independent validation evidence as immutable bytes and record its SHA256. Submit the exact candidate report, its canonical SHA256, the independent evidence SHA256, and the transition-validation attestation to `POST /deadlock-live/recommendation-roadmap/v1/materialize/direct-shop-source`. The server verifies the candidate-analysis SHA256, requires the exact supported analyzer version, rejects self-promotion, and materializes a content-addressed immutable validation snapshot. Require `directShopSourceValidation=PASS`.
4. Configure exactly the validated approval key in `RECOMMENDATION_DIRECT_SHOP_SOURCE_ALLOWLIST`. Do not configure a candidate before step 3 passes. The exact key must match the immutable validation snapshot.
5. Collect prospective recommendation telemetry using one frozen `candidateGeneratorVersion`. Materialize foundational evidence with that exact version. Require the observability, Dataset V8 structural, and Dataset V8 empirical gates to pass on real data.
6. Freeze chronological `TRAIN -> VALIDATION -> SHADOW_HOLDOUT -> FUTURE_TEST` windows. FUTURE_TEST must remain sealed, unmaterialized for model development, and unevaluated.
7. Run the protected `Recommendation Dataset Export` workflow only after explicit operational authorization. The export preflight re-validates the exact direct-shop snapshot and fails closed if its content hash, evaluator, timestamp, approval key, or current observability/configuration scope differs. The exported immutable manifest must bind the exact candidate generator version, exact validated direct-shop source approval key, `directShopSourceValidationSubjectSha256`, ruleset versions, catalog hashes, split descriptors, and artifact hashes.
8. Upload the exported directory to the approved immutable object store, register it, and independently verify the manifest and artifact hashes. The Dataset V8 registry status must be `VERIFIED` and fresh.
9. Stage the verified immutable dataset on the protected self-hosted training runner together with the approved offline Python wheelhouse.
10. Freeze the exact offline wheelhouse bytes. Run `python training/recommendation_v8/wheelhouse_identity.py --wheelhouse <absolute-wheelhouse-path>` on the protected runner, record the returned `wheelhouseSha256`, and set the protected `recommendation-training` environment variable `RECOMMENDATION_TRAINING_WHEELHOUSE_SHA256` to exactly that 64-hex value. Any added, removed, modified, symlinked, or replaced wheelhouse artifact must invalidate this identity and require a new explicit freeze.
11. Run the protected `Recommendation Pretraining Readiness` workflow. This workflow performs no training. Before installing anything, it recomputes the wheelhouse identity and requires it to equal `RECOMMENDATION_TRAINING_WHEELHOUSE_SHA256`. It then verifies Python/runtime dependency pins, deterministic CUDA readiness, immutable dataset bytes, split isolation, RNN API preflight, Transformer API preflight, candidate-generator identity, direct-shop validation PASS, the exact approval-key identity, and the exact `directShopSourceValidationSubjectSha256` identity across the immutable manifest and both API preflights. The final server-owned readiness subject is cryptographically bound to the exact wheelhouse SHA as well as the dataset, manifest, source commit, model configs, roadmap gates, and runner gates.
12. Only if that workflow emits `status=READY_TO_START_BEHAVIORAL_TRAINING`, with `trainingPerformed=false`, `futureTestEvaluated=false`, and the exact dataset, manifest, source commit, direct-shop validation subject SHA, and training wheelhouse SHA recorded in the attestation, has the pretraining boundary been reached.

## Fail-closed invariants

- Missing or insufficient controlled souls evidence blocks the boundary.
- Missing, mismatched, candidate-only, or independently contradicted direct-shop evidence blocks the boundary.
- An allowlisted direct-shop key without its immutable structured validation snapshot blocks the boundary.
- A direct-shop candidate report whose canonical hash differs from the attested hash blocks the boundary.
- A direct-shop validation snapshot whose content-addressed SHA or timestamp differs from the roadmap evidence record blocks the boundary.
- A direct-shop key or validation subject SHA that differs between the validation snapshot, current server configuration, observability report, immutable Dataset V8 manifest, or final API preflight blocks the boundary.
- Mixed candidate-generator versions block the boundary.
- Telemetry received after the decision timestamp is excluded from point-in-time state reconstruction.
- Observed-action injection is forbidden.
- FUTURE_TEST access or evaluation during model development blocks the boundary.
- Dataset registry or hash mismatch blocks the boundary.
- Missing, malformed, or mismatched `RECOMMENDATION_TRAINING_WHEELHOUSE_SHA256` blocks both readiness and training before dependency installation or optimizer execution.
- RNN and Transformer preflights must both pass against the exact same immutable dataset, direct-shop validation snapshot, observable contract, and frozen training wheelhouse identity.
- The readiness/training API must use HTTPS except for explicit loopback HTTP on the protected runner.
- The actual Behavioral training workflow recomputes the exact wheelhouse identity, rechecks the runtime and immutable dataset, and re-evaluates server-owned final readiness immediately before the first optimizer step.
- No readiness step may fabricate empirical PASS from absent data.

## What happens after the boundary

The next action after a valid no-training readiness attestation is the protected Behavioral V8 training workflow using the exact verified dataset identifiers, hashes, source commit, and frozen wheelhouse SHA from the attestation. The training workflow emits both the registry-compatible canonical model-manifest SHA and raw manifest-byte SHA, but it does not register, activate, deploy, or evaluate FUTURE_TEST. Starting that workflow remains a separate explicit authorization decision.
