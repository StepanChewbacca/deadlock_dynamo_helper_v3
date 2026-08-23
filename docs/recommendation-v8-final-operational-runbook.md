# Recommendation V8 final operational runbook

This runbook is the end-to-end operational sequence for Recommendation V8. It describes how to move from the current code-complete state to a final production Policy V1 and, only after the one-shot FUTURE_TEST evaluation, to the conservative sequential-RL research boundary.

It is intentionally fail-closed. A code path existing in the repository is not evidence that a gate passed. No operator may replace missing evidence with configuration, a manually asserted boolean, or a copied PASS result from another model, dataset, candidate-generator version, ruleset, catalog, or experiment.

## Global invariants

- Deterministic legality and feasibility run before ML scoring.
- Spendable souls and direct shop opportunity remain UNKNOWN unless their validated evidence contracts permit a known value.
- Realtime roadmap gates are server-owned. Realtime callers do not provide observability, shadow, or safe-exploration authorization booleans.
- Exact action logging propensity must be recorded at action selection. Reconstructed propensities are forbidden for causal release evidence and sequential-RL research.
- TRAIN, VALIDATION, SHADOW_HOLDOUT, and FUTURE_TEST are chronological and match-isolated.
- FUTURE_TEST is never used for architecture selection, feature selection, target selection, hyperparameter tuning, candidate-generator changes, or Policy construction.
- FUTURE_TEST is evaluated exactly once after Policy V1 is frozen and Policy A/B release evidence is PASS.
- Model activation is distinct from model verification. Public activation goes through the gated promotion service.
- A Policy model cannot become ACTIVE until its exact immutable manifest has matching Policy A/B PASS evidence and matching one-shot FUTURE_TEST PASS evidence.
- Sequential RL remains research-only. It cannot use FUTURE_TEST for model selection and cannot unlock before the exact frozen Policy has passed FUTURE_TEST.

## 1. Foundational evidence

Collect real controlled-souls observations and real Overwolf direct-shop diagnostic sessions. The direct-shop candidate analyzer is discovery-only. Independently validate AVAILABLE and UNAVAILABLE transitions, then materialize the structured direct-shop validation snapshot.

Required outcome before prospective Dataset V8 collection:

- `controlledSoulsValidation=PASS`
- `directShopSourceValidation=PASS`
- exactly one approved direct-shop source key, bound to the immutable validation snapshot
- versioned ruleset/catalog evidence
- deterministic legality and telemetry contracts PASS

If any of these are missing, FAIL, or INSUFFICIENT_EVIDENCE, stop.

## 2. Prospective data and immutable Dataset V8

Collect prospective recommendation telemetry using one frozen `candidateGeneratorVersion`. Materialize foundational reports for that exact version. Require observability, Dataset V8 structural, and Dataset V8 empirical gates to pass on real evidence.

Only after those gates pass may the protected `Recommendation Dataset Export` workflow be run. The export remains a separate explicit operation. The immutable manifest binds:

- source commit SHA
- candidate-generator version
- direct-shop approval key
- direct-shop validation subject SHA256
- feature/action contracts
- ruleset versions
- catalog SHA256 values
- split descriptors
- exact artifact hashes

Upload the exact exported directory to an approved immutable store, register it, and independently verify the registry identity and bytes. FUTURE_TEST stays sealed and unmaterialized for model development.

## 3. Behavioral BuildLM

Run the protected no-training `Recommendation Pretraining Readiness` workflow first. It must emit `READY_TO_START_BEHAVIORAL_TRAINING` with `trainingPerformed=false` and `futureTestEvaluated=false` for the exact immutable dataset.

Only after explicit training authorization run `Recommendation Behavioral Training`. RNN and Transformer receive the same observable contract. Model selection is restricted to TRAIN, VALIDATION, and SHADOW_HOLDOUT. FUTURE_TEST remains inaccessible.

Register and verify the selected immutable Behavioral bundle. Materialize `behavioralOffline` from that exact verified manifest. Never copy evidence from another model version.

## 4. Passive shadow

Use the verified Behavioral model in SHADOW mode. The server-owned runtime trust service prevents caller-supplied shadow/observability assertions. Collect sufficient shadow telemetry and materialize `shadowSafety` using the protected roadmap evidence workflow.

A FAIL or insufficient shadow result blocks LIVE recommendation behavior. The deterministic WAIT_SAVE fallback remains available when runtime safety conditions are not met.

## 5. Match-level A/B and safe exploration

After shadow PASS, run the initial match-level randomized A/B and materialize `matchLevelAbSafety` from the exact experiment window.

Safe exploration is authorized by the server only when:

- runtime mode is LIVE
- `matchLevelAbSafety=PASS`
- FUTURE_TEST integrity is intact
- FUTURE_TEST has not been evaluated
- the experiment assignment is randomized

The caller cannot override these conditions. Materialize exact propensity and safe-exploration evidence only from logged randomized assignments. Stop on any critical safety failure.

## 6. Causal Value

Export causal Value data only from the permitted randomized evidence window and exact recorded propensities. Run the protected Value training workflow only after its readiness gates pass.

Materialize OPE and causal Value evidence. The release boundary requires action sensitivity, adequate off-policy support, and the causal Value release gate. Observational predictive performance alone is not causal evidence.

Register and independently verify the immutable VALUE bundle. Do not activate it from configuration alone; public activation requires matching immutable causal Value release evidence.

## 7. Build and verify frozen Policy V1

Run `Recommendation Policy Bundle Build` with the exact verified Behavioral and VALUE model identities. The server verifies the corresponding immutable Behavioral and causal Value release snapshots before generating Policy V1.

The workflow emits an immutable local bundle handoff and does not activate it. Upload the exact bundle to the approved immutable artifact store, then run `Recommendation Model Register Verify` against the pre-staged exact bytes and remote immutable URI.

At this point the Policy is VERIFIED, not ACTIVE and not yet eligible for production activation.

## 8. Policy A/B release

Run the frozen Policy in the controlled match-level Policy A/B path using exact assignment propensities. Materialize `policyAbRelease` through `Recommendation Roadmap Materialization` with the exact Policy model identity.

The advanced evidence materializer binds the Policy A/B release snapshot to the exact Policy manifest SHA256. A Policy release record for another manifest cannot authorize this Policy.

If Policy A/B does not pass its configured safety/release evaluator, stop. Do not inspect FUTURE_TEST to decide how to modify the Policy.

## 9. One-shot FUTURE_TEST

Only after Policy V1 is frozen and `policyAbRelease=PASS` may the final evaluation process access FUTURE_TEST.

The final evaluation plan and metric/gate definition must have been frozen before access. The repository intentionally does not invent a new FUTURE_TEST success threshold: the materializer consumes a frozen `RecommendationFutureTestEvaluationArtifactV1` produced by the independently approved evaluation process.

The artifact must bind:

- exact Policy model id/version
- exact Policy manifest SHA256
- frozen evaluation-plan SHA256
- immutable evaluation-artifact SHA256 and reference
- `futureTestAccessCount=1`
- architecture/hyperparameters/candidate generator/target frozen flags
- final PASS or FAIL gate status

Run `Recommendation FUTURE_TEST Evaluation` exactly once. The server verifies that Policy V1 was already unlocked, Policy A/B PASS evidence matches the same manifest, and no previous FUTURE_TEST evaluation exists.

A FAIL result is final evidence for that frozen Policy. It must not be converted into a tuning loop on the same FUTURE_TEST.

## 10. Production model activation

Use `Recommendation Model Activation` only with a VERIFIED bundle and exact production runtime compatibility data. Public activation is routed through `RecommendationModelPromotionV1Service`.

Promotion requirements are model-kind specific:

- BEHAVIORAL: matching immutable `behavioralOffline=PASS` snapshot
- VALUE: matching immutable `causalValueRelease=PASS` snapshot
- POLICY: matching immutable `policyAbRelease=PASS` snapshot plus matching one-shot `futureTestEvaluation=PASS`

Registry verification must also be fresh and the bundle must satisfy feature/action/candidate-generator/ruleset/catalog/runtime gate compatibility.

Activation is therefore not an escape hatch around the roadmap.

## 11. Sequential RL research boundary

Sequential RL begins only after the frozen Policy has passed FUTURE_TEST. It is not a production release gate for Policy V1 and it must not feed back into the already-consumed FUTURE_TEST.

Prepare an immutable JSONL transition artifact. Each transition must use causal state/next-state ordering, exact logged action propensity, consistent ruleset/catalog identity, and valid terminal semantics.

Run `Recommendation Sequential RL Readiness`. The protected runner uses the canonical shared evaluator to produce an immutable attestation and report SHA256. The API revalidates the report identity, exact Policy manifest, Policy A/B release, and matching FUTURE_TEST PASS before materializing `sequentialRlResearchGate`.

The gate is PASS only when the transition artifact contains transitions and has no invalid transitions, future leakage, ruleset/catalog mismatch, or reconstructed propensities, with a non-empty match set and terminal transitions. The attestation is permanently marked `researchOnly=true` and `futureTestUsedForModelSelection=false`.

Once `futureTestEvaluation=PASS` and `sequentialRlResearchGate=PASS`, the roadmap's final `SEQUENTIAL_RL_RESEARCH` phase is unlocked. That is the end of the Recommendation V8 roadmap represented by the current repository contracts. Any later offline-RL algorithm, contextual bandit revision, or new Policy generation starts a new research/versioning cycle and must receive a new untouched evaluation protocol rather than reusing this FUTURE_TEST.

## Protected workflows

The following workflows are manual-only, protected-environment, dedicated self-hosted operations:

- `Recommendation Dataset Export`
- `Recommendation Pretraining Readiness`
- `Recommendation Behavioral Training`
- `Recommendation Value Dataset Export`
- `Recommendation Value Training`
- `Recommendation Roadmap Materialization`
- `Recommendation Policy Bundle Build`
- `Recommendation Model Register Verify`
- `Recommendation FUTURE_TEST Evaluation`
- `Recommendation Model Activation`
- `Recommendation Sequential RL Readiness`

Recommendation CI and Recommendation Security may run automatically because they do not execute training, artifact export, model activation, production deployment, randomized traffic, or FUTURE_TEST access.

## Stop conditions

Stop immediately instead of advancing the roadmap when any of these occurs:

- a required evidence gate is not PASS
- evidence identity does not match the exact immutable dataset/model/experiment subject
- candidate-generator, ruleset, catalog, feature, or action contract versions diverge
- exact propensity evidence is unavailable or reconstructed
- runtime telemetry is stale or direct feasibility evidence is UNKNOWN
- immutable artifact verification is stale or mismatched
- FUTURE_TEST access count is not exactly one
- FUTURE_TEST has already been evaluated for the current roadmap
- a sequential transition contains future leakage
- an operator would need to assert a PASS manually to continue

In all such cases the correct system behavior is block, abstain, or deterministic fallback, not silent promotion.
