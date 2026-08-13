# Recommendation Behavioral V6 - Latent-State Recovery

## Why this stage exists

The previous Behavioral V6 stages established the following facts on the pinned MATCH sample and `MERGED_TOP_96` choice set:

- the broad historical support union caused major softmax dilution and was reduced to a deterministic Top96 set while preserving more than 99% observed-action coverage;
- the candidate-count-dependent optimizer update was fixed;
- equal-capacity linear and linear-plus-tower models still failed the Behavioral release gate;
- grouped boosted/listwise stumps improved support slightly but worsened raw log loss relative to the best linear/tower reference and still failed late/high-economy support;
- ordered purchase history is a real predictive signal: the Sequence Neural screen materially improved support, raw log loss, late-game support, high-economy support and the number of major low-support cohorts compared with the same trained model evaluated with `previousActionKeys=[]`;
- simple temperature calibration did not explain the remaining failure. Balanced MATCH-disjoint calibration selected temperature `1`, leaving the support and floor-sensitivity failures unchanged.

The remaining question is therefore not whether history matters. It does. The question is whether the remaining hard tail is explained by observable multimodal build regimes that a single propensity surface averages together, or by genuinely unobserved state such as exact wallet/shop opportunity.

## Frozen lineage

- Dataset V6 SHA-256: `e8b11e26df37ff1e17b334eda18ea2141cfb7fa78f0a34eaf95d448c22962235`
- pinned MATCH sample SHA-256: `8d87519d797b54fc3f726837e80bb79968b44dc59960dadcb934261f329ce1ac`
- frozen `MERGED_TOP_96` report SHA-256: `b2953bc63baff315cc66d4bdfb0ca8655e5fef0a99fc6916c782821f8c31e664`
- FUTURE_TEST remains excluded from all current selection and diagnostics.

## Sequence evidence

Sequence screen configuration:

- ordered history length: 16
- hidden dimension: 12
- epochs: 3 TRAIN-only
- learning rate: 0.03
- TUNING is not used for training or early stopping
- raw within-decision softmax

Normal TUNING evaluation:

- support: `0.835920177383592`
- raw log loss: `2.747655053608051`
- top-1: `0.33141629711751663`
- floor sensitivity: `0.2987322135195818`
- major low-support groups: 2
- PHASE:LATE support: `0.7670886075949367`
- ECONOMY:GE_20000 support: `0.7611583421891605`

History-ablated evaluation of the same trained model:

- support: `0.7926829268292683`
- raw log loss: `2.985271611921615`
- top-1: `0.30245288248337027`
- floor sensitivity: `0.35805708704597805`
- major low-support groups: 16
- PHASE:LATE support: `0.679385171790235`
- ECONOMY:GE_20000 support: `0.6522316684378321`

This is the required evidence that ordered build history contains useful pre-decision information.

## Temperature falsification

The corrected calibration protocol uses whole MATCH groups, balances them by eligible decision count, and never uses observed action or outcome for partition assignment.

Contract:

`TUNING_MATCH_BALANCED_SPLIT_TEMPERATURE_CALIBRATION_2`

The selected temperature was `1`.

Independent validation at the selected temperature:

- support: `0.8349043526476296`
- raw log loss: `2.7463149591677933`
- floor sensitivity: `0.3023512084437867`
- major low-support groups: 3

Therefore simple temperature scaling is not the missing fix and strict Sequence cross-fit remains blocked.

## Read-only latent-state diagnostic

Executor:

`PREDECISION_REGIME_ENTROPY_DIAGNOSTIC_1`

The diagnostic does not fit model weights.

Regime assignment may use only pre-decision observables:

- hero
- team
- phase
- game time
- net worth band, never interpreted as wallet
- inventory size
- inventory tag counts
- ordered previous actions

Regime assignment explicitly may not use:

- observed action
- final outcome
- short-horizon outcomes
- future state
- FUTURE_TEST

Observed action is used only after regime assignment to measure descriptive conditional entropy.

The predefined nested regime families are:

1. `COARSE_STATE`
2. `STATE_HISTORY_STAGE_LAST1`
3. `STATE_HISTORY_SUFFIX2`
4. `STATE_BUILD_SIGNATURE`

TUNING matches are split into two decision-balanced, match-disjoint partitions. An enriched regime family supports the latent-state hypothesis only if, in both partitions:

- qualified regime coverage is at least 70%;
- conditional next-action entropy falls by at least 0.15 bits relative to the coarse state on the same rows;
- the weighted standard deviation of Sequence hard-row rate across qualified regimes is at least 0.04.

The selected family must also have positive entropy reduction in late-game and high-economy rows overall.

Only a passing report may set:

`boundedLatentMixtureScreenRecommended=true`

## Bounded latent-state mixture

Model contract:

`RECOMMENDATION_BEHAVIORAL_V6_LATENT_STATE_MIXTURE_1_RAW_PROPENSITY`

Probability contract:

`RAW_MIXTURE_OF_WITHIN_DECISION_SOFTMAX_EXPERTS`

Gate contract:

`PREDECISION_HASHED_SOFTMAX_GATE_1`

Expert contract:

`INVERSE_RANK_BASE_PLUS_EXPERT_CANDIDATE_BIAS_1`

Optimizer:

`RESPONSIBILITY_WEIGHTED_AGGREGATED_SGD_1`

Frozen bounded screen configuration:

- experts: 4
- gate history length: 8
- gate hash dimension: 4,096
- expert candidate-bias hash dimension: 8,192
- TRAIN epochs: 3
- learning rate: 0.03
- L2: 0
- gradient clipping: 1
- choice set: `MERGED_TOP_96`
- no TUNING training
- no TUNING early stopping
- no cross-fitting in the cheap screen
- FUTURE_TEST excluded

For expert `k`, the candidate distribution is a within-decision raw softmax over:

`-log(candidate rank) + expert candidate bias`

The gate is a softmax over pre-decision state/history tokens. The final candidate propensity is the proper probability mixture:

`p(a|x) = sum_k gate_k(x) * p_k(a|x)`

No candidate probability floor is applied.

The grouped negative-log-likelihood update computes posterior expert responsibility for the observed action and uses it to update both gate parameters and expert candidate biases. Hashed collisions are aggregated before the parameter update.

## Mixture screen continuation gate

Strict MATCH cross-fit is allowed only if the bounded screen satisfies every condition:

- candidate coverage >= 0.99;
- TUNING support >= 0.85;
- TUNING support >= Sequence support + 0.005;
- TUNING raw log loss < Sequence raw log loss;
- probability-floor sensitivity <= 0.25;
- major low-support groups <= 1;
- late support >= Sequence late support + 0.01;
- high-economy support >= Sequence high-economy support + 0.01;
- latent gate signal is observable against the same trained mixture with ordered history removed from the gate input.

If this screen fails, do not perform another latent-mixture parameter sweep. The next action is to document the observability/support ceiling and identify which missing state would be required to justify a new data-collection version.

## Still blocked

The current work does not authorize:

- full Behavioral training
- Value V8 training
- full Value training
- passive shadow
- production ranking changes
- randomized canary
- rollout
- automatic heap or memory increases
- automatic retries with larger model capacity
