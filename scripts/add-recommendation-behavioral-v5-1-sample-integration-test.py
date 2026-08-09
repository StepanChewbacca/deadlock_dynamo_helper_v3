from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'apps/api/test/recommendation-behavioral-v5-training.spec.ts'
text = PATH.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected exactly one replacement, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    """import {\n  recommendationBehavioralV5FoldId,\n  type RecommendationBehavioralV5Model,\n} from '../src/deadlock-live/recommendation-behavioral-v5';\n""",
    """import {\n  recommendationBehavioralV5DiagnosticMatchSelected,\n  recommendationBehavioralV5FoldId,\n  type RecommendationBehavioralV5Model,\n} from '../src/deadlock-live/recommendation-behavioral-v5';\n""",
)

anchor = """    expect(status.trainingArtifactEligible).toBe(\n      audit.trainingArtifactEligible,\n    );\n  });\n});\n"""
addition = """    expect(status.trainingArtifactEligible).toBe(\n      audit.trainingArtifactEligible,\n    );\n\n    const sampledOutputDirectory = join(root, 'sampled-output');\n    process.env[OUTPUT_ENV] = sampledOutputDirectory;\n    const sampledService = new RecommendationBehavioralV5TrainingService();\n    await sampledService.onModuleInit();\n    await sampledService.start({\n      foldCount,\n      epochs: 1,\n      learningRate: 0.2,\n      l2: 0.0001,\n      hashDimension: 512,\n      propensityFloor: 0.01,\n      supportProbability: 0.0001,\n      majorGroupMinDecisions: 1_000,\n      expectedSourceSha256: datasetSha256,\n      diagnosticMatchModulo: 2,\n      diagnosticMatchRemainder: 0,\n    });\n    await sampledService.waitForIdle();\n\n    expect(sampledService.getStatus()).toMatchObject({\n      state: 'COMPLETE',\n      trainEligibleDecisionCount: trainMatchIds.length,\n      futureTestEligibleDecisionCount: 0,\n      trainingArtifactEligible: false,\n    });\n    const sampledRows = gunzipSync(\n      await readFile(join(sampledOutputDirectory, 'diagnostic-sample.ndjson.gz')),\n    )\n      .toString('utf8')\n      .trim()\n      .split('\\n')\n      .filter(Boolean)\n      .map((line) => JSON.parse(line) as RecommendationProDecisionDatasetV6Row);\n    expect(sampledRows.length).toBeGreaterThanOrEqual(trainMatchIds.length);\n    expect(sampledRows.every((value) => value.split !== 'FUTURE_TEST')).toBe(\n      true,\n    );\n    expect(\n      sampledRows.every((value) =>\n        recommendationBehavioralV5DiagnosticMatchSelected(\n          value.matchId,\n          2,\n          0,\n        ),\n      ),\n    ).toBe(true);\n\n    const sampledAudit = sampledService.getAudit() as {\n      passed: boolean;\n      trainingArtifactEligible: boolean;\n      build: {\n        fullCorpus: boolean;\n        diagnosticMatchSample: {\n          unit: string;\n          hash: string;\n          modulo: number;\n          remainder: number;\n          futureTestEvaluated: boolean;\n          artifact: {\n            fileName: string;\n            rowCount: number;\n            sha256: string;\n          };\n        };\n      };\n    };\n    expect(sampledAudit).toMatchObject({\n      passed: true,\n      trainingArtifactEligible: false,\n      build: {\n        fullCorpus: false,\n        diagnosticMatchSample: {\n          unit: 'MATCH',\n          hash: 'FNV1A_32',\n          modulo: 2,\n          remainder: 0,\n          futureTestEvaluated: false,\n          artifact: {\n            fileName: 'diagnostic-sample.ndjson.gz',\n            rowCount: sampledRows.length,\n          },\n        },\n      },\n    });\n    expect(sampledAudit.build.diagnosticMatchSample.artifact.sha256).toMatch(\n      /^[a-f0-9]{64}$/,\n    );\n    expect(sampledService.getEvaluation()).toMatchObject({\n      futureTestPolicy: {\n        reported: false,\n        usedForTraining: false,\n        usedForCalibration: false,\n        usedForReleaseGate: false,\n      },\n    });\n  });\n});\n"""
replace_once(anchor, addition)

replace_once(
    """    const matchId = `train-match-${index}`;\n    const foldId = recommendationBehavioralV5FoldId(matchId, foldCount);\n    if (!result.has(foldId)) {\n      result.set(foldId, matchId);\n    }\n""",
    """    const matchId = `train-match-${index}`;\n    if (!recommendationBehavioralV5DiagnosticMatchSelected(matchId, 2, 0)) {\n      continue;\n    }\n    const foldId = recommendationBehavioralV5FoldId(matchId, foldCount);\n    if (!result.has(foldId)) {\n      result.set(foldId, matchId);\n    }\n""",
)

PATH.write_text(text, encoding='utf-8')
print('Behavioral V5.1 sample integration regression added.')
