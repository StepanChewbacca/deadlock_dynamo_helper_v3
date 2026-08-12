# Recommendation Behavioral V6 - Execution Ledger

## Authoritative lineage

- Dataset V6 SHA-256: `e8b11e26df37ff1e17b334eda18ea2141cfb7fa78f0a34eaf95d448c22962235`
- pinned MATCH diagnostic sample SHA-256: `8d87519d797b54fc3f726837e80bb79968b44dc59960dadcb934261f329ce1ac`
- V5.1 sweep summary SHA-256: `0e06b01e8f33257754d6994a10411b5b76da16d07d17c2fc6c7c236b776d4f4e`
- frozen `MERGED_TOP_96` choice-set report SHA-256: `b2953bc63baff315cc66d4bdfb0ca8655e5fef0a99fc6916c782821f8c31e664`
- FUTURE_TEST is excluded from all architecture selection and current diagnostics.

## Completed read-only gates

### Frozen choice-set provenance audit

Output: `recommendation-behavioral-v6-choice-set-audit-v2-background`

- selected decisions: 44,979
- Behavioral-eligible decisions: 44,942
- regenerated merged mismatch count: 0
- missing snapshot count: 0
- primary observed coverage: `0.67469263434047`
- broad support/merged observed coverage: `0.9991773938949288`
- support-union-only observed rate: `0.32448475955445877`
- median primary candidate count: 9
- median broad merged candidate count: 140

### Feasibility-source audit

Run: `31617224864`

- raw timeline and PostgreSQL schema audited
- reliable spendable-souls/current-wallet field not observed
- `netWorth` is not treated as spendable currency
- no synthetic affordability features are permitted

### Choice-set candidate evaluation

Run: `31617573169`

Selected deterministic ex-ante contract:

- definition: `MERGED_TOP_96`
- observed-action coverage: approximately `0.9913515`
- zero major cohorts below the frozen 95% choice-set coverage gate
- observed action is never injected into the set

## Behavioral V6 model contracts

- model: `RECOMMENDATION_BEHAVIORAL_V6_AGGREGATED_OPTIMIZER_1_RAW_PROPENSITY`
- probability: `RAW_SOFTMAX_WITHIN_DECISION`
- optimizer: `AGGREGATE_DATA_GRADIENT_THEN_SINGLE_L2_UPDATE_PER_PARAMETER`
- L architecture: `LINEAR_ONLY`
- LT architecture: `LINEAR_PLUS_TOWER`

Equal-capacity ablation configuration:

- choice set: `MERGED_TOP_96`
- linear hash dimension: 65,536 for both L and LT
- LT embedding hash dimension: 4,096
- LT latent dimension: 8
- MATCH folds: 5
- epochs: 5
- learning rate: 0.1
- L2: 0.0001

## Failed execution attempts retained as evidence

### V1

Launcher run: `31618670655`

Failed before model training because a root-owned volume path was used by shell redirection. No model evidence was produced.

### V2

Launcher run: `31637348131`

- detached launch succeeded
- Node failed with `Reached heap limit`
- Docker `OOMKilled=false`
- memory/heap limits were not increased

Root cause: full 44,979-row sample plus candidate objects was materialized in JavaScript heap.

## Authoritative V3 streaming ablation

Launcher run: `31638521581`

Output:

`recommendation-behavioral-v6-equal-capacity-ablation-v3-streaming-background`

Executor:

`MERGED_TOP_96_AGGREGATED_OPTIMIZER_STREAMING_2`

Runtime execution:

`DISK_SPOOLED_STREAMING_ROWS_2`

Systemd unit/container:

`deadlock-behavioral-v6-ablation-v3-31638521581`

Streaming spool counts:

- pinned rows: 44,979
- selected rows: 44,979
- candidate-covered rows: 44,590
- filtered rows: 44,590
- TRAIN: 30,158
- TUNING: 14,432
- FUTURE_TEST: 0
- folds: `[6740, 5830, 6220, 4661, 6707]`
- candidate coverage: `0.9913515195980347`

Ordering contract:

- global TRAIN order preserved
- TUNING order preserved
- original order within each MATCH fold preserved
- cross-fit fold iteration remains ascending fold id excluding holdout

Latest persisted health check after safe Docker cleanup:

- state: RUNNING
- CPU: approximately 105%
- container memory: approximately 139 MiB / 6 GiB
- L holdout 0: epochs 1-5 complete
- L holdout 1: epochs 1-5 complete
- L holdout 2: epochs 1-4 complete
- no recurrence of the V2 heap failure

## Safe Docker cleanup

Maintenance run: `31640712761`

Validator run: `31640712926` - PASS

Only these operations were allowed/performed:

- dangling image prune
- unused build cache prune older than 24 hours

Explicitly not performed:

- container prune
- volume prune
- system prune
- container stop/kill/remove

Disk evidence:

- before free: 10,574,276 KiB
- after free: 12,000,668 KiB
- reclaimed: 1,426,392 KiB
- V3 systemd unit and container remained active after cleanup

The post-V3 Docker-build gate remains strict at more than 12 GiB free. The current active spool is expected to be removed by the V3 executor after successful completion.

## Prepared post-V3 read-only gates

### Streaming Top96 baselines

Executor: `MERGED_TOP_96_BASELINES_STREAMING_2`

Baselines:

- `HISTORICAL_PRIOR`
- `GENERATOR_PRIOR`
- `INVERSE_RANK`

The workflow refuses to run until V3 is SUCCEEDED and its service/container are inactive.

### TUNING probability diagnostics

Executor: `TUNING_INFERENCE_STREAMING_1`

Inference-only metrics:

- raw log loss
- support
- top-1
- multiclass Brier
- candidate Brier
- candidate-level calibration ECE
- top-label calibration ECE
- entropy
- top1-top2 probability margin
- probability standard deviation
- score range
- zero-separation rate

No train function is called.

### Ablation baseline envelope gate

The preferred L/LT variant must simultaneously:

- pass its own Behavioral release gate
- have support strictly above the maximum support of all three cheap baselines
- have raw log loss strictly below the minimum raw log loss of all three cheap baselines
- preserve raw-softmax and aggregated-optimizer contracts

If this gate fails, the next family is:

`GROUPED_BOOSTED_LISTWISE`

## Blocked operations

The current work does not authorize:

- another V1/V2/V3 training request
- automatic V4 retry
- larger heap or memory limits
- full Behavioral training
- Value V8 training
- full Value training
- passive shadow
- production ranking changes
- randomized canary
- production rollout
