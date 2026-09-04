# Task 24 report: production economy/flex evidence boundary

## Outcome

Production has no verified investment rule table and no live flex-unlock telemetry, so the
adaptive decision state now reports that absence explicitly and remains fail-closed. The universal
slot model is fixed at nine base slots and three maximum flex slots. Unknown capacity is derived
only from held inventory; an unverified numeric value cannot unlock or free a flex slot.

`VERIFIED_RECOMMENDATION_ECONOMY_RULES_V1` remains intentionally empty. Fixture-injected exact
rules remain available to reconstruct recursive investment behavior and planner preference tests.

## RED

Added behavior tests before the implementation:

- `does not treat an unverified flex unlock count as capacity` in the candidate generator.
- `treats an unverified flex unlock count as unknown capacity` in adaptive economy derivation.
- live decision-state assertion that no production rules are present and their evidence is
  explicitly `UNKNOWN`.

Command run:

```text
yarn workspace @deadlock-live-probe/build-domain test recommendation-candidate-generator.spec.ts && yarn workspace @deadlock-live-probe/api test adaptive-economy-v1.spec.ts adaptive-decision-state-v1.spec.ts
```

The first command failed as expected: `BUY_ITEM:11` with ten held items, evidence `UNKNOWN`, and
an injected numeric value of three was incorrectly `FEASIBLE` instead of carrying
`FLEX_SLOT_CAPACITY_UNKNOWN`. The chained API command did not run because the domain test failed.

## GREEN

Implemented these minimal changes:

- UNKNOWN flex evidence ignores `unlockedFlexSlots` for both slot derivation and candidate
  legality; only existing observed overflow is the lower bound.
- Added `economyRulesEvidence` to live decision state and replay serialization/reconstruction.
- Centralized the production universal slot values as `baseSlots: 9`, `maxFlexSlots: 3`.
- Added coverage for 9/10/11/12 held-item lower bounds and RECONSTRUCTED future capacity.
- Added `docs/adaptive-planner-production-economy-flex-evidence.md` documenting the checked
  live-state, GEP, and catalog boundaries.

The first green focused run passed with 13 domain tests and 15 API tests. A subsequent API build
initially exposed one complete typed replay adapter missing the new required evidence field;
the adapter now serializes it and deterministically reconstructs it from exact replay rules,
while retaining backward compatibility for older persisted input without the field.

## Final verification

All commands completed successfully on the final tree:

```text
yarn workspace @deadlock-live-probe/build-domain test recommendation-candidate-generator.spec.ts
# 1 suite, 13 tests passed

yarn workspace @deadlock-live-probe/api test adaptive-economy-v1.spec.ts adaptive-decision-state-v1.spec.ts adaptive-evidence-scorer-v1.spec.ts adaptive-build-planner-v1.spec.ts
# 4 suites, 46 tests passed

yarn workspace @deadlock-live-probe/api build
# succeeded

git diff --check
# succeeded
```

## Self-review and remaining concern

Reviewed the final diff for universal-slot use, evidence propagation, replay compatibility, and
documentation accuracy. No task-local issues remained. The intentional product limitation is that
production investment utility and free flex capacity stay unknown until a versioned authoritative
breakpoint/contribution table and an observed or deterministically reconstructed flex-unlock
source are introduced.
