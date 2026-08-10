# Authoritative Recommendation V5.2 budgeted execution chain

This file is the execution source of truth for the prepared V5.2 recovery path.

## Global rule

Every model-training stage is a one-shot GitHub Actions run only.

- hard training-process budget: 20 minutes;
- hard self-hosted job budget: 30 minutes;
- a timeout is a failed experiment;
- no automatic retry with a larger budget;
- no direct VPS model training;
- trigger files are deleted immediately after the intended run is created.

Non-training offline verification also has a 10-minute process cap and a 20-minute job timeout.

## Authoritative stages

1. Initial architecture sweep
   - `Recommendation Behavioral V5.2 Bounded V3 Budgeted`;
   - current intended run: `31357375817`;
   - immutable Dataset V6 and MATCH sample lineage only.

2. Exactly one bounded refinement, only after architecture continuation PASS
   - workflow: `.github/workflows/recommendation-behavioral-v5-2-refinement-budgeted-v3.yml`;
   - request template: `.github/training-request-templates/recommendation-behavioral-v5-2-refinement-v3.example.json`;
   - required executor: `CANDIDATE_COVERAGE_FIXED_2`;
   - candidate coverage comes from the complete pinned sample, not from the already-eligible subset.

3. Full readiness and cost projection, no model training
   - workflow: `.github/workflows/recommendation-behavioral-v5-2-full-readiness-v2.yml`;
   - request template: `.github/training-request-templates/recommendation-behavioral-v5-2-full-readiness-v2.example.json`;
   - required executor: `IMMUTABLE_COST_PROJECTION_2`;
   - output: immutable `readiness-report.json` in storage;
   - cost work units include the preflight dataset scan, every OOF training pass, every final TRAIN pass, and the propensity/evaluation pass.

4. Full Behavioral V5.2, only after exact readiness SHA is known
   - workflow: `.github/workflows/recommendation-behavioral-v5-2-full-budgeted-v2.yml`;
   - request template: `.github/training-request-templates/recommendation-behavioral-v5-2-full-v2.example.json`;
   - required executor: `READINESS_PINNED_2`;
   - request pins Dataset SHA, corrected refinement summary SHA, immutable readiness report SHA, and exact selected configuration;
   - release gates remain unchanged;
   - FUTURE_TEST is neither trained on, selected on, nor evaluated.

5. Value V8 input readiness, no Value training
   - workflow: `.github/workflows/recommendation-value-v8-v5-2-input-readiness-v2.yml`;
   - request template: `.github/training-request-templates/recommendation-value-v8-v5-2-input-readiness-v2.example.json`;
   - required executor: `FULL_V5_2_PINNED_2`;
   - exact Behavioral directory: `recommendation-behavioral-v5-2-full-v2`;
   - require release-eligible full Behavioral V5.2 and exact artifact SHA lineage.

6. Bounded Value V8 diagnostic
   - workflow: `.github/workflows/recommendation-value-v8-bounded-v5-2-v2.yml`;
   - request template: `.github/training-request-templates/recommendation-value-v8-bounded-v5-2-v2.example.json`;
   - required executor: `FULL_PROPENSITY_STREAM_AUDIT_2`;
   - exact output directory: `recommendation-value-v8-diagnostic-v5-2-v2`;
   - the complete Behavioral propensity artifact is streamed and validated before any Value update;
   - `maxRows=50000`;
   - Value applies observed-propensity stabilization and importance-weight clipping exactly once;
   - FUTURE_TEST is not trained on, selected on, or evaluated.

7. Offline verification
   - workflow: `.github/workflows/recommendation-value-v8-offline-verification-v5-2-v2.yml`;
   - request template: `.github/training-request-templates/recommendation-value-v8-offline-verification-v5-2-v2.example.json`;
   - required executor: `BOUNDED_VALUE_V2_PINNED_2`;
   - exact input Value directory: `recommendation-value-v8-diagnostic-v5-2-v2`;
   - exact output directory: `recommendation-value-v8-offline-verification-v5-2-v2`;
   - deterministic replay and exact stored-prediction comparison;
   - state-only vs state+action comparison;
   - candidate and metadata permutation diagnostics;
   - candidate ranking/separation diagnostics;
   - latency and heap measurements;
   - no model training.

## Removed superseded paths

Earlier refinement, readiness, full Behavioral, Value input-readiness, bounded Value, and offline-verification executable drafts were removed from PR #39. They are not selectable from the current branch. Their history remains available through git history only.

## Stop boundary

This chain does not authorize:

- full Value V8 training;
- production ranking changes;
- passive shadow;
- randomized canary;
- production rollout.
