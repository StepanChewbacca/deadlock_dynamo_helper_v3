from pathlib import Path

path = Path('apps/api/src/deadlock-live/recommendation-value-v8-diagnostic-training.service.ts')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        """import {\n  RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,\n  RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,\n} from './recommendation-behavioral-v5';\n""",
        """import {\n  RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION,\n  RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION,\n  RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION,\n} from './recommendation-behavioral-v5';\n""",
    ),
    (
        """    manifest.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION ||\n    manifest.modelVersion !== RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION ||\n    manifest.auditPassed !== true ||\n""",
        """    manifest.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION ||\n    manifest.modelVersion !== RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION ||\n    manifest.featureVersion !== RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION ||\n    manifest.auditPassed !== true ||\n""",
    ),
    (
        """    value.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION ||\n    value.modelVersion !== RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION ||\n    typeof value.decisionId !== 'string' ||\n""",
        """    value.schemaVersion !== RECOMMENDATION_BEHAVIORAL_V5_SCHEMA_VERSION ||\n    value.modelVersion !== RECOMMENDATION_BEHAVIORAL_V5_MODEL_VERSION ||\n    value.featureVersion !== RECOMMENDATION_BEHAVIORAL_V5_FEATURE_VERSION ||\n    typeof value.decisionId !== 'string' ||\n""",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected one replacement, found {count}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
