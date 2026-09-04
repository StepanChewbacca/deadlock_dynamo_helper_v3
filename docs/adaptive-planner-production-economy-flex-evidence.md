# Adaptive planner production economy and flex evidence

The adaptive planner uses item costs, item slot types, and upgrade recipe topology only from the
strict catalog compiled by `AdaptiveDecisionStateV1Service`. Catalog identity is the exact pair of
`rulesetId` and `catalogSha256` (`RecommendationItemCatalogVersionV1.payloadSha256`). An economy
rule entry is usable only when both values match exactly; there is no wildcard, ruleset-only, or
catalog-only fallback.

The checked live-state contract is `MinimalMatchState` and `MinimalPlayerState` in
`packages/shared/src/live-events.ts`, populated through
`apps/api/src/deadlock-live/live-match-state.service.ts` from Overwolf events. The separately
checked GEP reducer contract is `packages/shared/src/gep-canonical-v2.ts`. Neither contract
exposes an authoritative objective-progress or flex-unlock count. The current catalog entities
provide item identity, costs, types, and recipe edges; they do not provide an authoritative
investment breakpoint or contribution table.

Accordingly, production deliberately registers no economy rules in
`VERIFIED_RECOMMENDATION_ECONOMY_RULES_V1`. The decision state reports
`economyRulesEvidence: 'UNKNOWN'`, investment evidence is `UNKNOWN` with zero investment utility,
and flex evidence is `UNKNOWN`. This is not a claim that three flex slots are unlocked.

Slot accounting is universal: nine base slots and at most three flex slots. Item category remains
an item semantic used for investment only; it is not a 4/4/4 capacity model. With unknown flex
telemetry, held inventory proves only its present overflow above nine (0 at nine held, 1 at ten,
2 at eleven, and 3 at twelve). It never proves free flex capacity, so new transactions requiring
additional flex are rejected until a future authoritative source supplies OBSERVED or
RECONSTRUCTED capacity.

Fixture-injected exact rules remain supported for deterministic tests and a future verified data
source. They reconstruct investment from direct costs and recursive recipes, including consumed
components, but they do not relax candidate legality or override higher-priority counter evidence.
