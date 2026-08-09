from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one replacement, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_count(path: str, old: str, new: str, expected: int) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{path}: expected {expected} replacements, found {count}')
    target.write_text(text.replace(old, new), encoding='utf-8')


path = 'apps/api/src/deadlock-live/recommendation-behavioral-v5-training.service.ts'
test = 'apps/api/test/recommendation-behavioral-v5-training.spec.ts'

replace_once(
    path,
    "const PROPENSITY_FILE_NAME = 'propensities.ndjson';\n",
    "const PROPENSITY_FILE_NAME = 'propensities.ndjson';\nconst DIAGNOSTIC_SAMPLE_FILE_NAME = 'diagnostic-sample.ndjson.gz';\n",
)
replace_once(
    path,
    """interface SourceSummary {\n  scannedRowCount: number;\n  invalidRowCount: number;\n""",
    """interface SourceSummary {\n  scannedRowCount: number;\n  diagnosticSampleRowCount: number;\n  invalidRowCount: number;\n""",
)
replace_once(
    path,
    """  private readonly paths = {\n    propensities: join(this.outputDirectory, PROPENSITY_FILE_NAME),\n""",
    """  private readonly paths = {\n    diagnosticSample: join(this.outputDirectory, DIAGNOSTIC_SAMPLE_FILE_NAME),\n    propensities: join(this.outputDirectory, PROPENSITY_FILE_NAME),\n""",
)
replace_once(
    path,
    """      const summary = await scanSource(\n        source.datasetPath,\n        source.rowCount,\n        options,\n      );\n""",
    """      const summary = await scanSource(\n        source.datasetPath,\n        source.rowCount,\n        options,\n        options.diagnosticMatchModulo === undefined\n          ? undefined\n          : this.paths.diagnosticSample,\n      );\n      const iterationDatasetPath =\n        options.diagnosticMatchModulo === undefined\n          ? source.datasetPath\n          : this.paths.diagnosticSample;\n      const diagnosticSampleArtifact =\n        options.diagnosticMatchModulo === undefined\n          ? undefined\n          : {\n              fileName: DIAGNOSTIC_SAMPLE_FILE_NAME,\n              rowCount: summary.diagnosticSampleRowCount,\n              byteLength: (await stat(this.paths.diagnosticSample)).size,\n              sha256: await hashFile(this.paths.diagnosticSample),\n            };\n""",
)
replace_count(
    path,
    """          await eachSourceRow(\n            source.datasetPath,\n            options,\n""",
    """          await eachSourceRow(\n            iterationDatasetPath,\n            options,\n""",
    1,
)
replace_count(
    path,
    """        await eachSourceRow(\n          source.datasetPath,\n          options,\n""",
    """        await eachSourceRow(\n          iterationDatasetPath,\n          options,\n""",
    2,
)
replace_once(
    path,
    """                  remainder: options.diagnosticMatchRemainder,\n                },\n          outcomeFieldsUsed: false,\n""",
    """                  remainder: options.diagnosticMatchRemainder,\n                  artifact: diagnosticSampleArtifact,\n                },\n          outcomeFieldsUsed: false,\n""",
)
replace_once(
    path,
    """                  remainder: options.diagnosticMatchRemainder,\n                  futureTestEvaluated: false,\n                },\n""",
    """                  remainder: options.diagnosticMatchRemainder,\n                  futureTestEvaluated: false,\n                  artifact: diagnosticSampleArtifact,\n                },\n""",
)
replace_once(
    path,
    """      rm(this.paths.propensities, { force: true }),\n      rm(`${this.paths.propensities}.partial`, { force: true }),\n""",
    """      rm(this.paths.diagnosticSample, { force: true }),\n      rm(`${this.paths.diagnosticSample}.partial`, { force: true }),\n      rm(this.paths.propensities, { force: true }),\n      rm(`${this.paths.propensities}.partial`, { force: true }),\n""",
)
old_scan = """async function scanSource(\n  datasetPath: string,\n  expectedRowCount: number,\n  options: RecommendationBehavioralV5TrainingOptions,\n): Promise<SourceSummary> {\n  const summary: SourceSummary = {\n    scannedRowCount: 0,\n    invalidRowCount: 0,\n    candidateCoveredSelectionDecisionCount: 0,\n    selectionDecisionCount: 0,\n    eligibleBySplit: { TRAIN: 0, TUNING: 0, FUTURE_TEST: 0 },\n    ineligibleBySplit: { TRAIN: 0, TUNING: 0, FUTURE_TEST: 0 },\n    trainMatchIdsByFold: Array.from(\n      { length: options.foldCount },\n      () => new Set<string>(),\n    ),\n    trainDecisionCountByFold: Array.from(\n      { length: options.foldCount },\n      () => 0,\n    ),\n  };\n  for await (const value of ndjson(datasetPath)) {\n    if (\n      options.maxRows !== undefined &&\n      summary.scannedRowCount >= options.maxRows\n    ) {\n      break;\n    }\n    summary.scannedRowCount += 1;\n    let row: RecommendationProDecisionDatasetV6Row;\n    try {\n      row = sourceRow(value, summary.scannedRowCount);\n    } catch {\n      summary.invalidRowCount += 1;\n      continue;\n    }\n    if (!behavioralRowSelected(row, options)) {\n      continue;\n    }\n    if (row.split !== 'FUTURE_TEST') {\n      summary.selectionDecisionCount += 1;\n      summary.candidateCoveredSelectionDecisionCount +=\n        row.observedActionInCandidateSet ? 1 : 0;\n    }\n    if (isBehavioralEligible(row)) {\n      summary.eligibleBySplit[row.split] += 1;\n      if (row.split === 'TRAIN') {\n        const foldId = recommendationBehavioralV5FoldId(\n          row.matchId,\n          options.foldCount,\n        );\n        summary.trainMatchIdsByFold[foldId].add(row.matchId);\n        summary.trainDecisionCountByFold[foldId] += 1;\n      }\n    } else {\n      summary.ineligibleBySplit[row.split] += 1;\n    }\n  }\n  if (options.maxRows === undefined && summary.scannedRowCount !== expectedRowCount) {\n    throw new Error('Recommendation Dataset V6 source row count mismatch.');\n  }\n  return summary;\n}\n"""
new_scan = """async function scanSource(\n  datasetPath: string,\n  expectedRowCount: number,\n  options: RecommendationBehavioralV5TrainingOptions,\n  diagnosticSamplePath?: string,\n): Promise<SourceSummary> {\n  const summary: SourceSummary = {\n    scannedRowCount: 0,\n    diagnosticSampleRowCount: 0,\n    invalidRowCount: 0,\n    candidateCoveredSelectionDecisionCount: 0,\n    selectionDecisionCount: 0,\n    eligibleBySplit: { TRAIN: 0, TUNING: 0, FUTURE_TEST: 0 },\n    ineligibleBySplit: { TRAIN: 0, TUNING: 0, FUTURE_TEST: 0 },\n    trainMatchIdsByFold: Array.from(\n      { length: options.foldCount },\n      () => new Set<string>(),\n    ),\n    trainDecisionCountByFold: Array.from(\n      { length: options.foldCount },\n      () => 0,\n    ),\n  };\n  const sampleWriter = diagnosticSamplePath\n    ? await GzipNdjsonWriter.create(`${diagnosticSamplePath}.partial`)\n    : undefined;\n  try {\n    for await (const value of ndjson(datasetPath)) {\n      if (\n        options.maxRows !== undefined &&\n        summary.scannedRowCount >= options.maxRows\n      ) {\n        break;\n      }\n      summary.scannedRowCount += 1;\n      let row: RecommendationProDecisionDatasetV6Row;\n      try {\n        row = sourceRow(value, summary.scannedRowCount);\n      } catch {\n        summary.invalidRowCount += 1;\n        continue;\n      }\n      if (!behavioralRowSelected(row, options)) {\n        continue;\n      }\n      if (sampleWriter) {\n        await sampleWriter.write(row);\n        summary.diagnosticSampleRowCount += 1;\n      }\n      if (row.split !== 'FUTURE_TEST') {\n        summary.selectionDecisionCount += 1;\n        summary.candidateCoveredSelectionDecisionCount +=\n          row.observedActionInCandidateSet ? 1 : 0;\n      }\n      if (isBehavioralEligible(row)) {\n        summary.eligibleBySplit[row.split] += 1;\n        if (row.split === 'TRAIN') {\n          const foldId = recommendationBehavioralV5FoldId(\n            row.matchId,\n            options.foldCount,\n          );\n          summary.trainMatchIdsByFold[foldId].add(row.matchId);\n          summary.trainDecisionCountByFold[foldId] += 1;\n        }\n      } else {\n        summary.ineligibleBySplit[row.split] += 1;\n      }\n    }\n    if (sampleWriter) {\n      await sampleWriter.close();\n      await rename(`${diagnosticSamplePath}.partial`, diagnosticSamplePath);\n    }\n  } catch (error) {\n    if (sampleWriter) {\n      await sampleWriter.abort();\n    }\n    throw error;\n  }\n  if (options.maxRows === undefined && summary.scannedRowCount !== expectedRowCount) {\n    throw new Error('Recommendation Dataset V6 source row count mismatch.');\n  }\n  return summary;\n}\n"""
replace_once(path, old_scan, new_scan)

replace_once(
    test,
    """      trainingDataPolicy: Record<string, unknown>;\n""",
    """      trainingDataPolicy: Record<string, unknown>;\n""",
)

print('Behavioral V5.1 diagnostic sample materialization patch applied.')
