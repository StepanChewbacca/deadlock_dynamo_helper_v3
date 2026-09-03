# Task 5 Report: Fresh action and alternative consistency

## Scope

- Updated the adaptive recommendation serving path to publish only ranked actions that remain feasible against the second, fresh decision state and do not target an item freshly marked owned.
- Rebased `WAIT_SAVE` wrapper keys through the fresh feasible-candidate map. A target-specific key is emitted only when that exact fresh key exists; otherwise the generic `WAIT_SAVE` key is used.
- Kept replay-input construction unchanged.

## Test-first evidence

Added `aligns a rebased semantic wait wrapper with the fresh target and hides owned alternatives` to `apps/api/test/adaptive-recommendation-v1.spec.ts`.

RED command:

```text
yarn workspace @deadlock-live-probe/api test adaptive-recommendation-v1.spec.ts
```

The new test failed as intended: the returned semantic hold carried `WAIT_SAVE:1` while its rebased target was `2`.

## GREEN verification

```text
yarn workspace @deadlock-live-probe/api test adaptive-recommendation-v1.spec.ts
13 passed

yarn workspace @deadlock-live-probe/overwolf-client test adaptive-recommendation-presentation.spec.ts
7 passed

yarn workspace @deadlock-live-probe/api build
passed

git diff --check
passed
```

The Overwolf presentation code did not need modification: it renders the ranked candidates provided by the API, and the API now excludes stale alternatives at the publication boundary.

## Self-review

- The fresh feasible map is the action-key authority for primary action selection and ranked output.
- Targeted waits are canonicalized only when the corresponding fresh `WAIT_SAVE:<target>` candidate is feasible; generic `WAIT_SAVE` remains the fallback.
- The owned-item filter uses `targetItemId`, preserving valid sell-only alternatives that intentionally refer to owned inventory via `sellItemId`.
- Replay input continues to be derived from the initial decision state as before.

## Concerns

None identified within Task 5 scope.

## Fix round 1: generic fallback and survivor coverage

Added two API regressions:

- A rebased build whose fresh target is item `2` and whose fresh candidate map contains only generic `WAIT_SAVE`. The published action remains generic `WAIT_SAVE` while `nextTargetItemId` remains `2`.
- A stale-alternative case with a still-feasible, non-owned `WAIT_SAVE:2` candidate. The stale item `1` alternatives are removed and the fresh item `2` alternative remains published.

The implementation already satisfied the generic fallback contract, so no production adjustment was needed. To validate the new generic-fallback assertion, a temporary mutation that returned `WAIT_SAVE:2` without a fresh targeted candidate produced the required semantic RED:

```text
Expected actionKey: WAIT_SAVE
Received actionKey: WAIT_SAVE:2
```

The mutation was restored before GREEN verification.

GREEN commands:

```text
yarn workspace @deadlock-live-probe/api test adaptive-recommendation-v1.spec.ts
14 passed

yarn workspace @deadlock-live-probe/overwolf-client test adaptive-recommendation-presentation.spec.ts
7 passed
```
