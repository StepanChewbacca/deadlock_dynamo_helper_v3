# Recommendation V8 pretraining handoff

This document defines the last operational sequence before Behavioral BuildLM training may start. It does not authorize or run training, Dataset V8 export, deployment, model activation, or FUTURE_TEST evaluation.

## Ready-to-train boundary

The system may be described as `READY_TO_START_BEHAVIORAL_TRAINING` only after all steps below have completed with real evidence and the protected `Recommendation Pretraining Readiness` workflow has emitted its final no-training attestation.

1. Collect controlled souls observations under the existing controlled evidence contract. Do not mark spendable souls verified from client self-assertion. Materialize foundational roadmap evidence and require `controlledSoulsValidation=PASS`.
2. Collect real Overwolf diagnostic sessions with manual `SHOP_AVAILABLE` and `SHOP_UNAVAILABLE` markers. Export the diagnostic candidate report. The candidate analyzer is discovery-only and must remain `candidateOnly=true` and `canPromoteToDirectSource=false`.
3. Independently validate the selected candidate against real AVAILABLE and UNAVAILABLE state transitions. Submit the candidate report together with the independent validation attestation to `POST /deadlock-live/recommendation-roadmap/v1/materialize/direct-shop-source`. The server verifies the canonical candidate-analysis SHA256 and materializes immutable evidence. Require `directShopSourceValidation=PASS`.
4. Configure exactly the validated approval key in `RECOMMENDATION_DIRECT_SHOP_SOURCE_ALLOWLIST`. Do not configure a candidate before step 3 passes. The exact key must match the immutable validation snapshot.
5. Collect prospective recommendation telemetry using one frozen `candidateGeneratorVersion`. Materialize foundational evidence with that exact version. Require the observability, Dataset V8 structural, and Dataset V8 empirical gates to pass on real data.
6. Freeze chronological `TRAIN -> VALIDATION -> SHADOW_HOLDOUT -> FUTURE_TEST` windows. FUTURE_TEST must remain sealed, unmaterialized for model development, and unevaluated.
7. Run the protected `Recommendation Dataset Export` workflow only after explicit operational authorization. The exported immutable manifest must bind the exact candidate generator version, exact validated direct-shop source approval key, ruleset versions, catalog hashes, split descriptors, and artifact hashes.
8. Upload the exported directory to the approved immutable object store, register it, and independently verify the manifest and artifact hashes. The Dataset V8 registry status must be `VERIFIED` and fresh.
9. Stage the verified immutable dataset on the protected self-hosted training runner together with the approved offline Python wheelhouse.
10. Run the protected `Recommendation Pretraining Readiness` workflow. This workflow performs no training. It verifies Python/runtime dependency pins, deterministic CUDA readiness, immutable dataset bytes, split isolation, RNN API preflight, Transformer API preflight, candidate-generator identity, direct-shop validation PASS, and direct-shop approval-key identity.
11. Only if that workflow emits `status=READY_TO_START_BEHAVIORAL_TRAINING`, with `trainingPerformed=false` and `futureTestEvaluated=false`, has the pretraining boundary been reached.

## Fail-closed invariants

- Missing or insufficient controlled souls evidence blocks the boundary.
- Missing, mismatched, candidate-only, or independently contradicted direct-shop evidence blocks the boundary.
- An allowlisted direct-shop key without its immutable structured validation snapshot blocks the boundary.
- A direct-shop key that differs between the validation snapshot, current server configuration, observability report, or immutable Dataset V8 manifest blocks the boundary.
- Mixed candidate-generator versions block the boundary.
- Telemetry received after the decision timestamp is excluded from point-in-time state reconstruction.
- Observed-action injection is forbidden.
- FUTURE_TEST access or evaluation during model development blocks the boundary.
- Dataset registry or hash mismatch blocks the boundary.
- RNN and Transformer preflights must both pass against the exact same immutable dataset and observable contract.
- No readiness step may fabricate empirical PASS from absent data.

## What happens after the boundary

The next action after a valid no-training readiness attestation is the protected Behavioral V8 training workflow using the exact verified dataset identifiers and hashes from the attestation. That action is intentionally outside this handoff and requires separate explicit authorization.
