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

## Stage 1 final status

The V3 architecture sweep run `31382112874` failed operationally because the training process was attached to the Actions job lifetime. Its partial output remains immutable failed-run evidence and must not be reused or deleted.

The superseded V4 watchdog design must not be executed.

The authoritative detached Stage 1 recovery completed through:

- workflow run: `31403705105`;
- workflow: `.github/workflows/recommendation-behavioral-v5-2-bounded-v5-detached.yml`;
- launcher: `DETACHED_DOCKER_TRIGGER_1`;
- output: `recommendation-behavioral-v5-2-bounded-v5-detached-1`;
- immutable Dataset V6 SHA: `e8b11e26df37ff1e17b334eda18ea2141cfb7fa78f0a34eaf95d448c22962235`;
- pinned MATCH sample SHA: `8d87519d797b54fc3f726837e80bb79968b44dc59960dadcb934261f329ce1ac`;
- frozen V5.1 sweep summary SHA: `0e06b01e8f33257754d6994a10411b5b76da16d07d17c2fc6c7c236b776d4f4e`;
- detached container exited normally with exit code `0`;
- `oomKilled=false`;
- `sweep-summary.json` and `sweep-report.txt` were produced;
- preferred V5.2 variant: `A`;
- structural audit passed;
- raw propensity contract passed;
- architecture continuation recommendation: `false`.

The unchanged continuation gate failed these required checks:

- support coverage improvement: FAIL;
- raw log-loss within allowed regression bound: FAIL;
- major low-support-group reduction: FAIL.

The structural-audit and raw-propensity-contract checks passed, but all continuation checks are conjunctive. Therefore Stage 2 bounded refinement is not authorized.

For the preferred V5.2 variant A:

- support coverage: `0.7659205197810511` vs V5.1 baseline `0.7767122068443773`;
- raw log-loss: `2.964878289755934` vs V5.1 baseline `2.9291381922162625`;
- major low-support groups: `21` vs V5.1 baseline `17`;
- candidate coverage: `0.9991773938949288`;
- structural audit: PASS;
- release gate: FAIL.

The release gate reasons were unchanged threshold failures: behavior support below 90%, at least one major cohort below 75% support, and instability across probability floors.

## Chain disposition

The Recommendation V5.2 recovery chain stops after Stage 1 because architecture continuation did not pass.

Do not execute:

- Stage 2 bounded refinement;
- full Behavioral V5.2 training;
- Value V8 input readiness for a nonexistent release-eligible full Behavioral V5.2 artifact;
- bounded Value V8 diagnostic;
- downstream offline verification tied to that Value artifact.

A future attempt requires a new explicitly authorized architecture/research plan rather than weakening the existing thresholds or silently retrying this chain.

## Preserved safety boundaries

The stopped chain does not authorize:

- Replay or Dataset V6 rebuild;
- threshold lowering;
- observed-action injection;
- FUTURE_TEST use where prohibited;
- full Value V8 training;
- production ranking changes;
- passive shadow;
- randomized canary;
- production rollout.
