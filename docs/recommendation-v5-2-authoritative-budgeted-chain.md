# Authoritative Recommendation V5.2 detached execution chain

This file is the execution source of truth for the prepared V5.2 recovery path.

## Global rule

GitHub Actions is the control plane for every model-training stage. The Action may perform immutable-lineage preflight, build the isolated image, launch the training container on the self-hosted VPS, confirm `running=true` and `oomKilled=false`, and then exit.

The model-training process is not bound to the GitHub Actions job lifetime.

- model training must be launched by an authorized GitHub Action trigger;
- no manual direct shell command may start model training;
- the Action must launch training detached on the VPS and return promptly;
- Action `timeout-minutes` limits only trigger/preflight/build/launch work and must not limit model-training runtime;
- the launched container and image must not be stopped or removed by successful trigger-job cleanup;
- source Dataset V6, pinned samples, and frozen artifacts stay read-only;
- every training attempt writes to a fresh immutable output directory;
- no Replay or Dataset V6 rebuild is authorized;
- no audit threshold may be lowered;
- no observed action may be injected;
- FUTURE_TEST remains excluded wherever the stage contract requires it;
- one-shot authorization files are removed after the intended trigger job has successfully launched the detached container.

Non-training readiness and offline-verification stages may run to completion inside GitHub Actions because they do not own a long-running model-training process.

## Stage 1 recovery status

The V3 architecture sweep run `31382112874` failed operationally because the training process was attached to the Actions job lifetime. Preflight lineage checks and image build passed, but the 30-minute job timeout cancelled the job before a valid sweep summary was produced. The partial V3 output is failed-run evidence and must not be reused or deleted.

The old V4 watchdog design is superseded because it still kept the Actions job alive while waiting for model training. It must not be executed.

The authoritative Stage 1 recovery is now:

- workflow: `.github/workflows/recommendation-behavioral-v5-2-bounded-v5-detached.yml`;
- launcher: `DETACHED_DOCKER_TRIGGER_1`;
- fresh output: `recommendation-behavioral-v5-2-bounded-v5-detached-1`;
- immutable Dataset V6 SHA: `e8b11e26df37ff1e17b334eda18ea2141cfb7fa78f0a34eaf95d448c22962235`;
- pinned MATCH sample SHA: `8d87519d797b54fc3f726837e80bb79968b44dc59960dadcb934261f329ce1ac`;
- frozen V5.1 sweep summary SHA: `0e06b01e8f33257754d6994a10411b5b76da16d07d17c2fc6c7c236b776d4f4e`;
- Action timeout: 15 minutes for trigger/preflight/build/launch only;
- training continues independently in the detached Docker container after the Action completes;
- the container writes `container.log` and `training-exit-code.txt` into the fresh output directory;
- the trigger records container ID/name/image and launch metadata in the output directory.

## Authoritative stages

1. Initial architecture sweep
   - failed attached run: `31382112874`;
   - authoritative detached trigger: `Recommendation Behavioral V5.2 Bounded V5 Detached Trigger`;
   - immutable Dataset V6 and MATCH sample lineage only;
   - after launch, status is read from the detached container and the fresh output directory, not from a long-running Actions job.

2. Exactly one bounded refinement, only after architecture continuation PASS
   - required executor: `CANDIDATE_COVERAGE_FIXED_2`;
   - candidate coverage comes from the complete pinned sample, not from the already-eligible subset;
   - before execution, this model-training stage must use the same trigger-only detached-launch contract as Stage 1;
   - no in-job training watchdog is authoritative.

3. Full readiness and cost projection, no model training
   - workflow: `.github/workflows/recommendation-behavioral-v5-2-full-readiness-v2.yml`;
   - request template: `.github/training-request-templates/recommendation-behavioral-v5-2-full-readiness-v2.example.json`;
   - required executor: `IMMUTABLE_COST_PROJECTION_2`;
   - output: immutable `readiness-report.json` in storage.

4. Full Behavioral V5.2, only after exact readiness SHA is known
   - required executor: `READINESS_PINNED_2`;
   - release gates remain unchanged;
   - FUTURE_TEST is neither trained on, selected on, nor evaluated;
   - before execution, this model-training stage must use the trigger-only detached-launch contract.

5. Value V8 input readiness, no Value training
   - workflow: `.github/workflows/recommendation-value-v8-v5-2-input-readiness-v2.yml`;
   - request template: `.github/training-request-templates/recommendation-value-v8-v5-2-input-readiness-v2.example.json`;
   - required executor: `FULL_V5_2_PINNED_2`;
   - exact Behavioral input is pinned by immutable SHA lineage.

6. Bounded Value V8 diagnostic
   - required executor: `FULL_PROPENSITY_STREAM_AUDIT_2`;
   - `maxRows=50000`;
   - the complete Behavioral propensity artifact is streamed and validated before any Value update;
   - Value applies observed-propensity stabilization and importance-weight clipping exactly once;
   - FUTURE_TEST is not trained on, selected on, or evaluated;
   - before execution, this model-training stage must use the trigger-only detached-launch contract.

7. Offline verification
   - workflow: `.github/workflows/recommendation-value-v8-offline-verification-v5-2-v2.yml`;
   - request template: `.github/training-request-templates/recommendation-value-v8-offline-verification-v5-2-v2.example.json`;
   - required executor: `BOUNDED_VALUE_V2_PINNED_2`;
   - deterministic replay and exact stored-prediction comparison;
   - state-only vs state+action comparison;
   - candidate and metadata permutation diagnostics;
   - candidate ranking/separation diagnostics;
   - latency and heap measurements;
   - no model training.

## Superseded execution paths

Any workflow that keeps a model-training process attached to a long-running GitHub Actions job is non-authoritative for this chain. In particular, the V4 watchdog path is removed from the authoritative branch.

## Stop boundary

This chain does not authorize:

- full Value V8 training;
- production ranking changes;
- passive shadow;
- randomized canary;
- production rollout.
