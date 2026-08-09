from pathlib import Path

path = Path('apps/api/src/deadlock-live/recommendation-behavioral-v5-training.service.ts')
text = path.read_text(encoding='utf-8')
old = """    if (sampleWriter) {\n      await sampleWriter.close();\n      await rename(`${diagnosticSamplePath}.partial`, diagnosticSamplePath);\n    }\n"""
new = """    if (sampleWriter && diagnosticSamplePath) {\n      await sampleWriter.close();\n      await rename(`${diagnosticSamplePath}.partial`, diagnosticSamplePath);\n    }\n"""
if text.count(old) != 1:
    raise RuntimeError(f'expected one sample close block, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
