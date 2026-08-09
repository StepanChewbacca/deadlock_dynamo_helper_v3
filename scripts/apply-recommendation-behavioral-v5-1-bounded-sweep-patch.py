from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one replacement, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


core = 'apps/api/src/deadlock-live/recommendation-behavioral-v5.ts'
training = 'apps/api/src/deadlock-live/recommendation-behavioral-v5-training.service.ts'
core_test = 'apps/api/test/recommendation-behavioral-v5.spec.ts'
full_eval_test = 'apps/api/test/recommendation-value-v8-full-evaluation.spec.ts'

replace_once(
    core,
    "'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_3_RAW_PROPENSITY_CONTRACT' as const;",
    "'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_4_CAPACITY_INTERACTIONS' as const;",
)
replace_once(
    core,
    """export function recommendationBehavioralV5FoldId(\n  matchId: string,\n  foldCount: number,\n): number {\n""",
    """export function recommendationBehavioralV5DiagnosticMatchSelected(\n  matchId: string,\n  modulo: number,\n  remainder: number,\n): boolean {\n  if (!matchId.trim()) {\n    throw new Error('Behavioral V5 matchId is required for diagnostic sampling.');\n  }\n  if (!Number.isSafeInteger(modulo) || modulo < 2 || modulo > 10_000) {\n    throw new Error('Behavioral V5 diagnostic sample modulo must be between 2 and 10000.');\n  }\n  if (\n    !Number.isSafeInteger(remainder) ||\n    remainder < 0 ||\n    remainder >= modulo\n  ) {\n    throw new Error(\n      'Behavioral V5 diagnostic sample remainder must be in [0, modulo).',\n    );\n  }\n  return fnv1a(matchId) % modulo === remainder;\n}\n\nexport function recommendationBehavioralV5FoldId(\n  matchId: string,\n  foldCount: number,\n): number {\n""",
)
replace_once(
    core,
    """  const heroId = row.state.heroId;\n  const itemId = candidate.itemId;\n  const timeBucket = Math.floor(row.state.gameTimeS / 300);\n\n  add('bias');\n""",
    """  const heroId = row.state.heroId;\n  const itemId = candidate.itemId;\n  const timeBucket = Math.floor(row.state.gameTimeS / 300);\n  const economy = behavioralEconomyBand(row.state.netWorth);\n\n  add('bias');\n""",
)
replace_once(
    core,
    """  add(`hero-item:${heroId}:${itemId}`);\n  add(`phase-item:${row.state.phase}:${itemId}`);\n  add(`time-item:${timeBucket}:${itemId}`);\n  add(`action-type:${candidate.actionType}`);\n""",
    """  add(`hero-item:${heroId}:${itemId}`);\n  add(`phase-item:${row.state.phase}:${itemId}`);\n  add(`time-item:${timeBucket}:${itemId}`);\n  add(`time-bucket-action:${timeBucket}:${candidate.actionKey}`);\n  add(`hero-time-bucket-item:${heroId}:${timeBucket}:${itemId}`);\n  add(`economy-band-item:${economy}:${itemId}`);\n  add(`economy-band-action:${economy}:${candidate.actionKey}`);\n  add(`action-type:${candidate.actionType}`);\n""",
)
replace_once(
    core,
    """function bounded(value: number, minimum: number, maximum: number): number {\n  return Math.min(maximum, Math.max(minimum, value));\n}\n\nfunction fnv1a(value: string): number {\n""",
    """function bounded(value: number, minimum: number, maximum: number): number {\n  return Math.min(maximum, Math.max(minimum, value));\n}\n\nfunction behavioralEconomyBand(netWorth: number | undefined): string {\n  if (netWorth === undefined || !Number.isFinite(netWorth)) {\n    return 'UNKNOWN';\n  }\n  if (netWorth < 5_000) {\n    return 'LT_5000';\n  }\n  if (netWorth < 10_000) {\n    return '5000_9999';\n  }\n  if (netWorth < 20_000) {\n    return '10000_19999';\n  }\n  return 'GE_20000';\n}\n\nfunction fnv1a(value: string): number {\n""",
)

replace_once(
    training,
    """  predictRecommendationBehavioralV5,\n  recommendationBehavioralV5FoldId,\n  stabilizeRecommendationBehavioralV5ObservedProbability,\n""",
    """  predictRecommendationBehavioralV5,\n  recommendationBehavioralV5DiagnosticMatchSelected,\n  recommendationBehavioralV5FoldId,\n  stabilizeRecommendationBehavioralV5ObservedProbability,\n""",
)
replace_once(
    training,
    """  expectedSourceSha256?: string;\n  maxRows?: number;\n}\n\nexport interface RecommendationBehavioralV5TrainingOptions {\n""",
    """  expectedSourceSha256?: string;\n  maxRows?: number;\n  diagnosticMatchModulo?: number;\n  diagnosticMatchRemainder?: number;\n}\n\nexport interface RecommendationBehavioralV5TrainingOptions {\n""",
)
replace_once(
    training,
    """  expectedSourceSha256?: string;\n  maxRows?: number;\n}\n\nexport interface RecommendationBehavioralV5TrainingStatus {\n""",
    """  expectedSourceSha256?: string;\n  maxRows?: number;\n  diagnosticMatchModulo?: number;\n  diagnosticMatchRemainder?: number;\n}\n\nexport interface RecommendationBehavioralV5TrainingStatus {\n""",
)
replace_once(
    training,
    """      const fullCorpus = options.maxRows === undefined;\n      if (fullCorpus && summary.scannedRowCount !== source.rowCount) {\n""",
    """      const completeSourceScan = options.maxRows === undefined;\n      if (completeSourceScan && summary.scannedRowCount !== source.rowCount) {\n""",
)
replace_once(
    training,
    """          await eachSourceRow(\n            source.datasetPath,\n            options.maxRows,\n            async (row) => {\n""",
    """          await eachSourceRow(\n            source.datasetPath,\n            options,\n            async (row) => {\n""",
)
replace_once(
    training,
    """        await eachSourceRow(\n          source.datasetPath,\n          options.maxRows,\n          async (row) => {\n""",
    """        await eachSourceRow(\n          source.datasetPath,\n          options,\n          async (row) => {\n""",
)
replace_once(
    training,
    """        await eachSourceRow(\n          source.datasetPath,\n          options.maxRows,\n          async (row) => {\n            if (!isBehavioralEligible(row)) {\n""",
    """        await eachSourceRow(\n          source.datasetPath,\n          options,\n          async (row) => {\n            if (!isBehavioralEligible(row)) {\n""",
)
replace_once(
    training,
    """      const fullCorpusEligible = options.maxRows === undefined;\n      if (!fullCorpusEligible) {\n        structuralReasons.push(\n          'Diagnostic maxRows was used; artifact is not eligible for Value V8.',\n        );\n      }\n      const auditPassed = structuralReasons.length === 0;\n""",
    """      const fullCorpusEligible =\n        options.maxRows === undefined &&\n        options.diagnosticMatchModulo === undefined;\n      const auditPassed = structuralReasons.length === 0;\n""",
)
replace_once(
    training,
    """        build: {\n          fullCorpus: fullCorpusEligible,\n          diagnosticMaxRows: options.maxRows,\n        },\n""",
    """        build: {\n          fullCorpus: fullCorpusEligible,\n          diagnosticMaxRows: options.maxRows,\n          diagnosticMatchSample:\n            options.diagnosticMatchModulo === undefined\n              ? undefined\n              : {\n                  unit: 'MATCH',\n                  hash: 'FNV1A_32',\n                  modulo: options.diagnosticMatchModulo,\n                  remainder: options.diagnosticMatchRemainder,\n                  futureTestEvaluated: false,\n                },\n        },\n""",
)
replace_once(
    training,
    """    if (row.split !== 'FUTURE_TEST') {\n      summary.selectionDecisionCount += 1;\n""",
    """    if (!behavioralRowSelected(row, options)) {\n      continue;\n    }\n    if (row.split !== 'FUTURE_TEST') {\n      summary.selectionDecisionCount += 1;\n""",
)
replace_once(
    training,
    """async function eachSourceRow(\n  path: string,\n  maxRows: number | undefined,\n  callback: (row: RecommendationProDecisionDatasetV6Row) => Promise<void>,\n): Promise<void> {\n  let count = 0;\n  for await (const value of ndjson(path)) {\n    if (maxRows !== undefined && count >= maxRows) {\n      break;\n    }\n    count += 1;\n    await callback(sourceRow(value, count));\n    if (count % 10_000 === 0) {\n      await tick();\n    }\n  }\n}\n""",
    """async function eachSourceRow(\n  path: string,\n  options: RecommendationBehavioralV5TrainingOptions,\n  callback: (row: RecommendationProDecisionDatasetV6Row) => Promise<void>,\n): Promise<void> {\n  let count = 0;\n  for await (const value of ndjson(path)) {\n    if (options.maxRows !== undefined && count >= options.maxRows) {\n      break;\n    }\n    count += 1;\n    const row = sourceRow(value, count);\n    if (!behavioralRowSelected(row, options)) {\n      continue;\n    }\n    await callback(row);\n    if (count % 10_000 === 0) {\n      await tick();\n    }\n  }\n}\n\nfunction behavioralRowSelected(\n  row: RecommendationProDecisionDatasetV6Row,\n  options: RecommendationBehavioralV5TrainingOptions,\n): boolean {\n  if (options.diagnosticMatchModulo === undefined) {\n    return true;\n  }\n  if (row.split === 'FUTURE_TEST') {\n    return false;\n  }\n  return recommendationBehavioralV5DiagnosticMatchSelected(\n    row.matchId,\n    options.diagnosticMatchModulo,\n    options.diagnosticMatchRemainder ?? 0,\n  );\n}\n""",
)
replace_once(
    training,
    """function normalizeOptions(\n  request: RecommendationBehavioralV5TrainingStartRequest,\n): RecommendationBehavioralV5TrainingOptions {\n  return {\n    foldCount: boundedInteger(request.foldCount, 5, 2, 10, 'foldCount'),\n    epochs: boundedInteger(request.epochs, 3, 1, 20, 'epochs'),\n    learningRate: boundedNumber(\n      request.learningRate,\n      0.2,\n      0.0001,\n      10,\n      'learningRate',\n    ),\n    l2: boundedNumber(request.l2, 0.0001, 0, 1, 'l2'),\n    hashDimension: boundedInteger(\n      request.hashDimension,\n      8_192,\n      256,\n      262_144,\n      'hashDimension',\n    ),\n    propensityFloor: boundedNumber(\n      request.propensityFloor,\n      0.01,\n      0,\n      0.2,\n      'propensityFloor',\n    ),\n    probabilityFloors: [0.005, 0.01, 0.02],\n    supportProbability: boundedNumber(\n      request.supportProbability,\n      0.01,\n      0,\n      1,\n      'supportProbability',\n    ),\n    majorGroupMinDecisions: boundedInteger(\n      request.majorGroupMinDecisions,\n      100,\n      1,\n      1_000_000,\n      'majorGroupMinDecisions',\n    ),\n    expectedSourceSha256: optionalSha(\n      request.expectedSourceSha256,\n      'expectedSourceSha256',\n    ),\n    maxRows: optionalPositiveInteger(request.maxRows, 'maxRows'),\n  };\n}\n""",
    """function normalizeOptions(\n  request: RecommendationBehavioralV5TrainingStartRequest,\n): RecommendationBehavioralV5TrainingOptions {\n  const maxRows = optionalPositiveInteger(request.maxRows, 'maxRows');\n  const diagnosticMatchModulo = optionalPositiveInteger(\n    request.diagnosticMatchModulo,\n    'diagnosticMatchModulo',\n  );\n  let diagnosticMatchRemainder = optionalNonNegativeInteger(\n    request.diagnosticMatchRemainder,\n    'diagnosticMatchRemainder',\n  );\n  if (maxRows !== undefined && diagnosticMatchModulo !== undefined) {\n    throw new Error(\n      'Behavioral V5 maxRows and diagnostic match sampling are mutually exclusive.',\n    );\n  }\n  if (diagnosticMatchModulo !== undefined) {\n    if (diagnosticMatchModulo < 2 || diagnosticMatchModulo > 10_000) {\n      throw new Error(\n        'diagnosticMatchModulo must be between 2 and 10000.',\n      );\n    }\n    diagnosticMatchRemainder ??= 0;\n    if (diagnosticMatchRemainder >= diagnosticMatchModulo) {\n      throw new Error(\n        'diagnosticMatchRemainder must be smaller than diagnosticMatchModulo.',\n      );\n    }\n  } else if (diagnosticMatchRemainder !== undefined) {\n    throw new Error(\n      'diagnosticMatchRemainder requires diagnosticMatchModulo.',\n    );\n  }\n  return {\n    foldCount: boundedInteger(request.foldCount, 5, 2, 10, 'foldCount'),\n    epochs: boundedInteger(request.epochs, 3, 1, 20, 'epochs'),\n    learningRate: boundedNumber(\n      request.learningRate,\n      0.2,\n      0.0001,\n      10,\n      'learningRate',\n    ),\n    l2: boundedNumber(request.l2, 0.0001, 0, 1, 'l2'),\n    hashDimension: boundedInteger(\n      request.hashDimension,\n      8_192,\n      256,\n      262_144,\n      'hashDimension',\n    ),\n    propensityFloor: boundedNumber(\n      request.propensityFloor,\n      0.01,\n      0,\n      0.2,\n      'propensityFloor',\n    ),\n    probabilityFloors: [0.005, 0.01, 0.02],\n    supportProbability: boundedNumber(\n      request.supportProbability,\n      0.01,\n      0,\n      1,\n      'supportProbability',\n    ),\n    majorGroupMinDecisions: boundedInteger(\n      request.majorGroupMinDecisions,\n      100,\n      1,\n      1_000_000,\n      'majorGroupMinDecisions',\n    ),\n    expectedSourceSha256: optionalSha(\n      request.expectedSourceSha256,\n      'expectedSourceSha256',\n    ),\n    maxRows,\n    diagnosticMatchModulo,\n    diagnosticMatchRemainder,\n  };\n}\n""",
)
replace_once(
    training,
    """function optionalPositiveInteger(\n  value: number | undefined,\n  label: string,\n): number | undefined {\n  if (value === undefined) {\n    return undefined;\n  }\n  if (!Number.isSafeInteger(value) || value <= 0) {\n    throw new Error(`${label} must be a positive safe integer.`);\n  }\n  return value;\n}\n\nfunction boundedInteger(\n""",
    """function optionalPositiveInteger(\n  value: number | undefined,\n  label: string,\n): number | undefined {\n  if (value === undefined) {\n    return undefined;\n  }\n  if (!Number.isSafeInteger(value) || value <= 0) {\n    throw new Error(`${label} must be a positive safe integer.`);\n  }\n  return value;\n}\n\nfunction optionalNonNegativeInteger(\n  value: number | undefined,\n  label: string,\n): number | undefined {\n  if (value === undefined) {\n    return undefined;\n  }\n  if (!Number.isSafeInteger(value) || value < 0) {\n    throw new Error(`${label} must be a non-negative safe integer.`);\n  }\n  return value;\n}\n\nfunction boundedInteger(\n""",
)

replace_once(
    core_test,
    """  predictRecommendationBehavioralV5,\n  recommendationBehavioralV5FeatureCount,\n  recommendationBehavioralV5FoldId,\n""",
    """  predictRecommendationBehavioralV5,\n  recommendationBehavioralV5DiagnosticMatchSelected,\n  recommendationBehavioralV5FeatureCount,\n  recommendationBehavioralV5FoldId,\n""",
)
replace_once(
    core_test,
    """  it('assigns a deterministic match-level fold', () => {\n""",
    """  it('selects bounded diagnostic samples deterministically at match level', () => {\n    const selected = recommendationBehavioralV5DiagnosticMatchSelected(\n      'match-1',\n      64,\n      0,\n    );\n    expect(\n      recommendationBehavioralV5DiagnosticMatchSelected('match-1', 64, 0),\n    ).toBe(selected);\n    expect(() =>\n      recommendationBehavioralV5DiagnosticMatchSelected('match-1', 64, 64),\n    ).toThrow('remainder');\n  });\n\n  it('assigns a deterministic match-level fold', () => {\n""",
)
replace_once(
    core_test,
    """    expect(first).toBeGreaterThan(20);\n    expect(second).toBeGreaterThan(20);\n""",
    """    expect(first).toBeGreaterThan(24);\n    expect(second).toBeGreaterThan(24);\n""",
)

replace_once(
    full_eval_test,
    "'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_3_RAW_PROPENSITY_CONTRACT',",
    "'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_4_CAPACITY_INTERACTIONS',",
)

print('Behavioral V5.1 bounded sweep patch applied successfully.')
