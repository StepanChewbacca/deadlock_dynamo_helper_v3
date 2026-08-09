from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one replacement, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


training = 'apps/api/src/deadlock-live/recommendation-behavioral-v5-training.service.ts'
value_training = 'apps/api/src/deadlock-live/recommendation-value-v8-diagnostic-training.service.ts'
training_test = 'apps/api/test/recommendation-behavioral-v5-training.spec.ts'
full_eval_test = 'apps/api/test/recommendation-value-v8-full-evaluation.spec.ts'

replace_once(
    training,
    "  clipRecommendationBehavioralV5Probabilities,\n  createRecommendationBehavioralV5Model,",
    "  createRecommendationBehavioralV5Model,",
)
replace_once(
    training,
    "  recommendationBehavioralV5FoldId,\n  RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,",
    "  recommendationBehavioralV5FoldId,\n  stabilizeRecommendationBehavioralV5ObservedProbability,\n  RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,",
)
replace_once(
    training,
    "  trainRecommendationBehavioralV5Decision,\n  type RecommendationBehavioralV5CandidateProbability,\n  type RecommendationBehavioralV5Model,",
    "  trainRecommendationBehavioralV5Decision,\n  type RecommendationBehavioralV5Model,",
)
replace_once(
    training,
    "  observedActionRawProbability: number;\n  observedActionProbability: number;\n  supported: boolean;\n  propensityFloor: number;",
    "  observedActionRawProbability: number;\n  observedActionProbability: number;\n  probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION';\n  supported: boolean;\n  propensityFloor: number;\n  propensityFloorApplied: false;",
)
replace_once(
    training,
    "  rawLogLossSum: number;\n  stabilizedLogLossSum: number;\n  rawBrierSum: number;\n  stabilizedBrierSum: number;",
    "  rawLogLossSum: number;\n  floorClippedObservedLogLossSum: number;\n  rawBrierSum: number;",
)
replace_once(
    training,
    """  observe(\n    row: RecommendationProDecisionDatasetV6Row,\n    rawPrediction: RecommendationBehavioralV5Prediction,\n    stabilizedCandidates: readonly RecommendationBehavioralV5CandidateProbability[],\n  ): void {\n    const stabilizedObserved = stabilizedCandidates.find(\n      (candidate) => candidate.actionKey === row.observedActionKey,\n    );\n    if (!stabilizedObserved) {\n      throw new Error('Behavioral V5 stabilized probabilities lost the observed action.');\n    }\n    const supported =\n      rawPrediction.observedActionProbability >= this.supportProbability;\n    this.observeMetrics(\n      this.bySplit.get(row.split) as MetricsState,\n      row,\n      rawPrediction,\n      stabilizedCandidates,\n      supported,\n    );\n    if (row.split !== 'FUTURE_TEST') {\n      this.observeMetrics(\n        this.selection,\n        row,\n        rawPrediction,\n        stabilizedCandidates,\n        supported,\n      );\n      this.selectionDecisionCount += 1;\n      this.observeGroups(row, rawPrediction, supported);\n      for (const floor of this.probabilityFloors) {\n        const candidates = clipRecommendationBehavioralV5Probabilities(\n          rawPrediction.candidates,\n          floor,\n        );\n        const observed = candidates.find(\n          (candidate) => candidate.actionKey === row.observedActionKey,\n        );\n        if (!observed) {\n          throw new Error('Behavioral V5 floor sensitivity lost the observed action.');\n        }\n        this.floorLogLossSum.set(\n          floor,\n          (this.floorLogLossSum.get(floor) ?? 0) -\n            Math.log(Math.max(observed.probability, 1e-15)),\n        );\n      }\n    }\n  }\n""",
    """  observe(\n    row: RecommendationProDecisionDatasetV6Row,\n    rawPrediction: RecommendationBehavioralV5Prediction,\n    floorClippedObservedProbability: number,\n  ): void {\n    const supported =\n      rawPrediction.observedActionProbability >= this.supportProbability;\n    this.observeMetrics(\n      this.bySplit.get(row.split) as MetricsState,\n      row,\n      rawPrediction,\n      floorClippedObservedProbability,\n      supported,\n    );\n    if (row.split !== 'FUTURE_TEST') {\n      this.observeMetrics(\n        this.selection,\n        row,\n        rawPrediction,\n        floorClippedObservedProbability,\n        supported,\n      );\n      this.selectionDecisionCount += 1;\n      this.observeGroups(row, rawPrediction, supported);\n      for (const floor of this.probabilityFloors) {\n        const observedProbability =\n          stabilizeRecommendationBehavioralV5ObservedProbability(\n            rawPrediction.observedActionProbability,\n            floor,\n          );\n        this.floorLogLossSum.set(\n          floor,\n          (this.floorLogLossSum.get(floor) ?? 0) -\n            Math.log(Math.max(observedProbability, 1e-15)),\n        );\n      }\n    }\n  }\n""",
)
replace_once(
    training,
    """  private observeMetrics(\n    state: MetricsState,\n    row: RecommendationProDecisionDatasetV6Row,\n    rawPrediction: RecommendationBehavioralV5Prediction,\n    stabilizedCandidates: readonly RecommendationBehavioralV5CandidateProbability[],\n    supported: boolean,\n  ): void {\n    const rawByAction = new Map(\n      rawPrediction.candidates.map((candidate) => [\n        candidate.actionKey,\n        candidate.probability,\n      ]),\n    );\n    const stabilizedByAction = new Map(\n      stabilizedCandidates.map((candidate) => [\n        candidate.actionKey,\n        candidate.probability,\n      ]),\n    );\n    const stabilizedObserved = stabilizedByAction.get(row.observedActionKey) ?? 0;\n    state.decisionCount += 1;\n    state.candidateCount += row.candidates.length;\n    state.coveredDecisionCount += rawByAction.has(row.observedActionKey) ? 1 : 0;\n    state.supportedDecisionCount += supported ? 1 : 0;\n    state.top1Count += rawPrediction.topActionKey === row.observedActionKey ? 1 : 0;\n    state.rawLogLossSum += -Math.log(\n      Math.max(rawPrediction.observedActionProbability, 1e-15),\n    );\n    state.stabilizedLogLossSum += -Math.log(\n      Math.max(stabilizedObserved, 1e-15),\n    );\n    state.entropySum += rawPrediction.entropy;\n    state.observedRawProbabilitySum += rawPrediction.observedActionProbability;\n    state.observedProbabilitySum += stabilizedObserved;\n    state.minimumObservedRawProbability = Math.min(\n      state.minimumObservedRawProbability,\n      rawPrediction.observedActionProbability,\n    );\n    state.maximumCandidateProbability = Math.max(\n      state.maximumCandidateProbability,\n      rawPrediction.maximumProbability,\n    );\n\n    for (const candidate of row.candidates) {\n      const rawProbability = rawByAction.get(candidate.actionKey) ?? 0;\n      const stabilizedProbability =\n        stabilizedByAction.get(candidate.actionKey) ?? 0;\n      const label = candidate.actionKey === row.observedActionKey ? 1 : 0;\n      state.rawBrierSum += (rawProbability - label) ** 2;\n      state.stabilizedBrierSum += (stabilizedProbability - label) ** 2;\n      state.extremeCandidateProbabilityCount +=\n        rawProbability <= EXTREME_PROBABILITY_EPSILON ||\n        rawProbability >= 1 - EXTREME_PROBABILITY_EPSILON\n          ? 1\n          : 0;\n      const binIndex = Math.min(\n        CALIBRATION_BIN_COUNT - 1,\n        Math.floor(rawProbability * CALIBRATION_BIN_COUNT),\n      );\n      const bin = state.calibrationBins[binIndex];\n      bin.candidateCount += 1;\n      bin.probabilitySum += rawProbability;\n      bin.positiveCount += label;\n    }\n  }\n""",
    """  private observeMetrics(\n    state: MetricsState,\n    row: RecommendationProDecisionDatasetV6Row,\n    rawPrediction: RecommendationBehavioralV5Prediction,\n    floorClippedObservedProbability: number,\n    supported: boolean,\n  ): void {\n    const rawByAction = new Map(\n      rawPrediction.candidates.map((candidate) => [\n        candidate.actionKey,\n        candidate.probability,\n      ]),\n    );\n    state.decisionCount += 1;\n    state.candidateCount += row.candidates.length;\n    state.coveredDecisionCount += rawByAction.has(row.observedActionKey) ? 1 : 0;\n    state.supportedDecisionCount += supported ? 1 : 0;\n    state.top1Count += rawPrediction.topActionKey === row.observedActionKey ? 1 : 0;\n    state.rawLogLossSum += -Math.log(\n      Math.max(rawPrediction.observedActionProbability, 1e-15),\n    );\n    state.floorClippedObservedLogLossSum += -Math.log(\n      Math.max(floorClippedObservedProbability, 1e-15),\n    );\n    state.entropySum += rawPrediction.entropy;\n    state.observedRawProbabilitySum += rawPrediction.observedActionProbability;\n    state.observedProbabilitySum += rawPrediction.observedActionProbability;\n    state.minimumObservedRawProbability = Math.min(\n      state.minimumObservedRawProbability,\n      rawPrediction.observedActionProbability,\n    );\n    state.maximumCandidateProbability = Math.max(\n      state.maximumCandidateProbability,\n      rawPrediction.maximumProbability,\n    );\n\n    for (const candidate of row.candidates) {\n      const rawProbability = rawByAction.get(candidate.actionKey) ?? 0;\n      const label = candidate.actionKey === row.observedActionKey ? 1 : 0;\n      state.rawBrierSum += (rawProbability - label) ** 2;\n      state.extremeCandidateProbabilityCount +=\n        rawProbability <= EXTREME_PROBABILITY_EPSILON ||\n        rawProbability >= 1 - EXTREME_PROBABILITY_EPSILON\n          ? 1\n          : 0;\n      const binIndex = Math.min(\n        CALIBRATION_BIN_COUNT - 1,\n        Math.floor(rawProbability * CALIBRATION_BIN_COUNT),\n      );\n      const bin = state.calibrationBins[binIndex];\n      bin.candidateCount += 1;\n      bin.probabilitySum += rawProbability;\n      bin.positiveCount += label;\n    }\n  }\n""",
)
replace_once(
    training,
    """            const rawPrediction = predictRecommendationBehavioralV5(model, row);\n            const stabilizedCandidates =\n              clipRecommendationBehavioralV5Probabilities(\n                rawPrediction.candidates,\n                options.propensityFloor,\n              );\n            const observedStabilized = stabilizedCandidates.find(\n              (candidate) => candidate.actionKey === row.observedActionKey,\n            );\n            if (!observedStabilized) {\n              throw new Error('Behavioral V5 prediction lost the observed action.');\n            }\n            evaluationAccumulator.observe(\n              row,\n              rawPrediction,\n              stabilizedCandidates,\n            );\n            const stabilizedByAction = new Map(\n              stabilizedCandidates.map((candidate) => [\n                candidate.actionKey,\n                candidate,\n              ]),\n            );\n""",
    """            const rawPrediction = predictRecommendationBehavioralV5(model, row);\n            if (rawPrediction.observedActionProbability <= 0) {\n              throw new Error('Behavioral V5 prediction lost the observed action.');\n            }\n            const floorClippedObservedProbability =\n              stabilizeRecommendationBehavioralV5ObservedProbability(\n                rawPrediction.observedActionProbability,\n                options.propensityFloor,\n              );\n            evaluationAccumulator.observe(\n              row,\n              rawPrediction,\n              floorClippedObservedProbability,\n            );\n""",
)
replace_once(
    training,
    """              observedActionRawProbability:\n                rawPrediction.observedActionProbability,\n              observedActionProbability: observedStabilized.probability,\n              supported:\n                rawPrediction.observedActionProbability >=\n                options.supportProbability,\n              propensityFloor: options.propensityFloor,\n              candidates: rawPrediction.candidates.map((candidate) => ({\n                actionKey: candidate.actionKey,\n                itemId: candidate.itemId,\n                score: candidate.score,\n                rawProbability: candidate.probability,\n                probability:\n                  stabilizedByAction.get(candidate.actionKey)?.probability ?? 0,\n                rank:\n                  stabilizedByAction.get(candidate.actionKey)?.rank ??\n                  candidate.rank,\n              })),\n""",
    """              observedActionRawProbability:\n                rawPrediction.observedActionProbability,\n              observedActionProbability:\n                rawPrediction.observedActionProbability,\n              probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',\n              supported:\n                rawPrediction.observedActionProbability >=\n                options.supportProbability,\n              propensityFloor: options.propensityFloor,\n              propensityFloorApplied: false,\n              candidates: rawPrediction.candidates.map((candidate) => ({\n                actionKey: candidate.actionKey,\n                itemId: candidate.itemId,\n                score: candidate.score,\n                rawProbability: candidate.probability,\n                probability: candidate.probability,\n                rank: candidate.rank,\n              })),\n""",
)
replace_once(
    training,
    "    stabilizedLogLossSum: 0,\n    rawBrierSum: 0,\n    stabilizedBrierSum: 0,",
    "    floorClippedObservedLogLossSum: 0,\n    rawBrierSum: 0,",
)
replace_once(
    training,
    """    rawLogLoss: divide(state.rawLogLossSum, state.decisionCount),\n    stabilizedLogLoss: divide(\n      state.stabilizedLogLossSum,\n      state.decisionCount,\n    ),\n    rawBrierScore: divide(state.rawBrierSum, state.decisionCount),\n    stabilizedBrierScore: divide(\n      state.stabilizedBrierSum,\n      state.decisionCount,\n    ),\n""",
    """    rawLogLoss: divide(state.rawLogLossSum, state.decisionCount),\n    floorClippedObservedLogLoss: divide(\n      state.floorClippedObservedLogLossSum,\n      state.decisionCount,\n    ),\n    rawBrierScore: divide(state.rawBrierSum, state.decisionCount),\n""",
)
replace_once(
    training,
    """        predictions: {\n          fileName: PROPENSITY_FILE_NAME,\n          rowCount: predictionRowCount,\n          oofPredictionCount,\n          fullTrainPredictionCount,\n          sha256: await hashFile(this.paths.propensities),\n        },\n""",
    """        predictions: {\n          fileName: PROPENSITY_FILE_NAME,\n          rowCount: predictionRowCount,\n          oofPredictionCount,\n          fullTrainPredictionCount,\n          probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',\n          propensityFloorApplied: false,\n          sha256: await hashFile(this.paths.propensities),\n        },\n""",
)
replace_once(
    training,
    """          normalization: 'SOFTMAX_WITHIN_DECISION',\n          crossFittingUnit: 'MATCH',\n          trainSplitOnly: true,\n""",
    """          normalization: 'SOFTMAX_WITHIN_DECISION',\n          propensityOutput: 'RAW_SOFTMAX_WITHIN_DECISION',\n          candidateProbabilityFloorApplied: false,\n          ipsClippingApplied: false,\n          probabilityFloorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',\n          crossFittingUnit: 'MATCH',\n          trainSplitOnly: true,\n""",
)
replace_once(
    training,
    """      const evaluation = {\n        schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,\n        modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,\n        generatedAt,\n        metrics,\n""",
    """      const evaluation = {\n        schemaVersion: RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,\n        modelVersion: RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,\n        generatedAt,\n        propensityContract: {\n          output: 'RAW_SOFTMAX_WITHIN_DECISION',\n          candidateProbabilityFloorApplied: false,\n          floorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',\n        },\n        metrics,\n""",
)

replace_once(
    value_training,
    """      propensity.trainingMatchExcluded !== true ||\n      propensity.observedActionKey !== row.observedActionKey ||\n      !Number.isFinite(propensity.observedActionProbability) ||\n      propensity.observedActionProbability <= 0\n    ) {\n      throw new Error(`Invalid Behavioral V5 propensity join ${row.decisionId}.`);\n    }\n""",
    """      propensity.trainingMatchExcluded !== true ||\n      propensity.observedActionKey !== row.observedActionKey ||\n      propensity.probabilityContract !== 'RAW_SOFTMAX_WITHIN_DECISION' ||\n      propensity.propensityFloorApplied !== false ||\n      !Number.isFinite(propensity.observedActionRawProbability) ||\n      propensity.observedActionRawProbability <= 0 ||\n      !Number.isFinite(propensity.observedActionProbability) ||\n      propensity.observedActionProbability <= 0 ||\n      Math.abs(\n        propensity.observedActionProbability -\n          propensity.observedActionRawProbability,\n      ) > 1e-12 ||\n      !isRawSoftmaxCandidateDistribution(propensity)\n    ) {\n      throw new Error(`Invalid Behavioral V5 propensity join ${row.decisionId}.`);\n    }\n""",
)
replace_once(
    value_training,
    """function datasetRow(\n  value: unknown,\n  line: number,\n): RecommendationProDecisionDatasetV6Row {\n""",
    """function isRawSoftmaxCandidateDistribution(\n  propensity: RecommendationBehavioralV5PropensityRow,\n): boolean {\n  if (propensity.candidates.length < 2) {\n    return false;\n  }\n  let total = 0;\n  for (const candidate of propensity.candidates) {\n    if (\n      !Number.isFinite(candidate.rawProbability) ||\n      candidate.rawProbability <= 0 ||\n      !Number.isFinite(candidate.probability) ||\n      candidate.probability <= 0 ||\n      Math.abs(candidate.probability - candidate.rawProbability) > 1e-12\n    ) {\n      return false;\n    }\n    total += candidate.probability;\n  }\n  return Math.abs(total - 1) <= 1e-9;\n}\n\nfunction datasetRow(\n  value: unknown,\n  line: number,\n): RecommendationProDecisionDatasetV6Row {\n""",
)

replace_once(
    training_test,
    """      expect(value).toMatchObject({\n        predictionSource: 'CROSS_FITTED_OOF',\n        trainingMatchExcluded: true,\n        foldId: recommendationBehavioralV5FoldId(value.matchId, foldCount),\n      });\n      expect(value.observedActionProbability).toBeGreaterThan(0);\n""",
    """      expect(value).toMatchObject({\n        predictionSource: 'CROSS_FITTED_OOF',\n        trainingMatchExcluded: true,\n        foldId: recommendationBehavioralV5FoldId(value.matchId, foldCount),\n        probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',\n        propensityFloorApplied: false,\n      });\n      expect(value.observedActionProbability).toBeGreaterThan(0);\n      expect(value.observedActionProbability).toBeCloseTo(\n        value.observedActionRawProbability,\n        15,\n      );\n      for (const candidate of value.candidates) {\n        expect(candidate.probability).toBeCloseTo(candidate.rawProbability, 15);\n      }\n""",
)
replace_once(
    training_test,
    """    expect(service.getManifest()).toMatchObject({\n      modelVersion: 'RECOMMENDATION_BEHAVIORAL_V5_HASHED_CONDITIONAL_CHOICE_1',\n      trainingContract: {\n        input: 'STATE_PLUS_CANDIDATE',\n        target: 'OBSERVED_ACTION_WITHIN_CANDIDATE_SET',\n        normalization: 'SOFTMAX_WITHIN_DECISION',\n        crossFittingUnit: 'MATCH',\n""",
    """    expect(service.getManifest()).toMatchObject({\n      schemaVersion: 2,\n      modelVersion:\n        'RECOMMENDATION_BEHAVIORAL_V5_1_HASHED_CONDITIONAL_CHOICE_2_RAW_PROPENSITY',\n      featureVersion:\n        'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_3_RAW_PROPENSITY_CONTRACT',\n      trainingContract: {\n        input: 'STATE_PLUS_CANDIDATE',\n        target: 'OBSERVED_ACTION_WITHIN_CANDIDATE_SET',\n        normalization: 'SOFTMAX_WITHIN_DECISION',\n        propensityOutput: 'RAW_SOFTMAX_WITHIN_DECISION',\n        candidateProbabilityFloorApplied: false,\n        ipsClippingApplied: false,\n        probabilityFloorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',\n        crossFittingUnit: 'MATCH',\n""",
)
replace_once(
    training_test,
    """    expect(service.getEvaluation()).toMatchObject({\n      futureTestPolicy: {\n""",
    """    expect(service.getEvaluation()).toMatchObject({\n      propensityContract: {\n        output: 'RAW_SOFTMAX_WITHIN_DECISION',\n        candidateProbabilityFloorApplied: false,\n        floorSensitivity: 'OBSERVED_PROPENSITY_CLIP_ONLY',\n      },\n      futureTestPolicy: {\n""",
)

replace_once(
    full_eval_test,
    """    schemaVersion: 1,\n    modelVersion: 'RECOMMENDATION_BEHAVIORAL_V5_HASHED_CONDITIONAL_CHOICE_1',\n    featureVersion: 'RECOMMENDATION_BEHAVIORAL_V5_FEATURES_2_FUTURE_TIMELINE_FALLBACK',\n""",
    """    schemaVersion: 2,\n    modelVersion:\n      'RECOMMENDATION_BEHAVIORAL_V5_1_HASHED_CONDITIONAL_CHOICE_2_RAW_PROPENSITY',\n    featureVersion:\n      'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_3_RAW_PROPENSITY_CONTRACT',\n""",
)
replace_once(
    full_eval_test,
    """    observedActionRawProbability: 0.5,\n    observedActionProbability: 0.5,\n    supported: true,\n    propensityFloor: 0.01,\n""",
    """    observedActionRawProbability: 0.5,\n    observedActionProbability: 0.5,\n    probabilityContract: 'RAW_SOFTMAX_WITHIN_DECISION',\n    supported: true,\n    propensityFloor: 0.01,\n    propensityFloorApplied: false,\n""",
)

print('Behavioral V5.1 raw propensity patch applied successfully.')
