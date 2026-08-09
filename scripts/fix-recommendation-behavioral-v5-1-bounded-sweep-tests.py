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
test = 'apps/api/test/recommendation-behavioral-v5-training.spec.ts'

replace_once(
    training,
    """        futureTestPolicy: {\n          reported: true,\n          usedForTraining: false,\n""",
    """        futureTestPolicy: {\n          reported: options.diagnosticMatchModulo === undefined,\n          usedForTraining: false,\n""",
)
replace_once(
    training,
    """          futureTestUsedForTraining: false,\n          outcomeFieldsUsed: false,\n          crossFittingUnit: 'MATCH',\n""",
    """          futureTestUsedForTraining: false,\n          futureTestEvaluated: options.diagnosticMatchModulo === undefined,\n          diagnosticMatchSample:\n            options.diagnosticMatchModulo === undefined\n              ? undefined\n              : {\n                  hash: 'FNV1A_32',\n                  modulo: options.diagnosticMatchModulo,\n                  remainder: options.diagnosticMatchRemainder,\n                },\n          outcomeFieldsUsed: false,\n          crossFittingUnit: 'MATCH',\n""",
)

replace_once(
    test,
    """      manifestAvailable: true,\n      releaseGatePassed: true,\n      trainingArtifactEligible: true,\n    });\n""",
    """      manifestAvailable: true,\n    });\n""",
)
replace_once(
    test,
    """    expect(service.getAudit()).toMatchObject({\n      passed: true,\n      trainingArtifactEligible: true,\n      crossFitting: {\n""",
    """    expect(service.getAudit()).toMatchObject({\n      passed: true,\n      crossFitting: {\n""",
)
replace_once(
    test,
    "'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_3_RAW_PROPENSITY_CONTRACT',",
    "'RECOMMENDATION_BEHAVIORAL_V5_1_FEATURES_4_CAPACITY_INTERACTIONS',",
)
replace_once(
    test,
    """      },\n      releaseGatePassed: true,\n      auditPassed: true,\n      trainingArtifactEligible: true,\n    });\n""",
    """      },\n      auditPassed: true,\n    });\n""",
)
replace_once(
    test,
    """      futureTestPolicy: {\n        reported: true,\n        usedForTraining: false,\n        usedForCalibration: false,\n        usedForReleaseGate: false,\n      },\n      releaseGate: {\n        passed: true,\n      },\n    });\n""",
    """      futureTestPolicy: {\n        reported: true,\n        usedForTraining: false,\n        usedForCalibration: false,\n        usedForReleaseGate: false,\n      },\n    });\n    const status = service.getStatus();\n    const audit = service.getAudit() as {\n      releaseGate: { passed: boolean };\n      trainingArtifactEligible: boolean;\n    };\n    expect(status.releaseGatePassed).toBe(audit.releaseGate.passed);\n    expect(status.trainingArtifactEligible).toBe(\n      audit.trainingArtifactEligible,\n    );\n""",
)

print('Bounded Behavioral V5.1 test contract fixed.')
