# Task 27 Report

Commit: `5cb8d809` (`Fix adaptive legality fallback counting`)

## Outcome

Adaptive planner observability is wired through the real recommendation boundary and exposed on the adaptive status response.

Added coverage for:

- planner latency
- evidence degraded/fallback
- final legality fallback
- phase violation prevented
- choice-group violation prevented
- UNKNOWN flex capacity
- UNKNOWN investment rules
- plan switch/churn
- SELL / REPLACE frequency
- post-commit replacement
- externally diverged choice state

## Verification

GREEN:

```bash
yarn workspace @deadlock-live-probe/api test adaptive-recommendation-v1.spec.ts adaptive-recommendation-controller-v1.spec.ts
yarn workspace @deadlock-live-probe/api build
```

Result: both commands passed.

Round 1 fix verification:

```bash
yarn workspace @deadlock-live-probe/api test adaptive-recommendation-v1.spec.ts adaptive-recommendation-controller-v1.spec.ts
yarn workspace @deadlock-live-probe/api build
```

Result: both commands passed after the selector fix.

Round 1 red:

```text
AdaptiveRecommendationV1Service › records a final-legality fallback when a non-transaction action is rewritten
Expected: 1
Received: 0

AdaptiveRecommendationV1Service › records SELL frequency and final-legality retargeting when the fresh target changes
Expected: 1
Received: 0
```

Fix: `selectFreshLegalAction()` now marks `changed` when the published action differs from the planner output, including non-transaction rebases and SELL retargets, so `finalLegalityFallbackCount` matches real rewrites.

RED encountered and fixed:

```text
TS2542: Index signature in type 'Readonly<Record<string, number>>' only permits reading.
```

Fix: kept the public snapshot immutable, but made the internal reason-code counter map mutable.

## Forbidden-Behavior Audit

Executed:

```bash
rg -n "remainingSkeleton|allSkeletonItems|future.*itemIds|maxFlexSlots.*unlocked|AHEAD.*phase|relationships.*CHOICE" apps/api/src/statlocker-adaptive packages/deadlock-build-domain/src
```

Result:

```text
apps/api/src/statlocker-adaptive/adaptive-economy-v1.ts:112:    : Math.min(maxFlexSlots, Math.max(0, Math.floor(capacity.unlockedFlexSlots)));
packages/deadlock-build-domain/src/recommendation-candidate-generator.ts:270:  const unlocked = Math.min(rules.maxFlexSlots, Math.max(0, rules.unlockedFlexSlots ?? 0));
```

Assessment: these are safe clamps of unlocked flex capacity, not a runtime use of `maxFlexSlots` as unlocked capacity. No other forbidden-pattern hits were present in the adaptive runtime path.

## Notes

- The observability surface is secret-safe: it records counters, reason codes, and status summaries only.
- The controller status response now includes the observability snapshot alongside refresh/evidence status.
