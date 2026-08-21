from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Mapping


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare Behavioral RNN and Transformer on equal observables")
    parser.add_argument("--rnn-metrics", required=True)
    parser.add_argument("--transformer-metrics", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--min-decision-count", type=int, default=10000)
    parser.add_argument("--min-support", type=float, default=0.90)
    parser.add_argument("--min-major-cohort-support", type=float, default=0.75)
    parser.add_argument("--min-transformer-logloss-improvement", type=float, default=1e-6)
    parser.add_argument("--min-transformer-cohort-support-gain", type=float, default=1e-6)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rnn = load_json(Path(args.rnn_metrics))
    transformer = load_json(Path(args.transformer_metrics))
    rnn_shadow = require_metrics(rnn, "SEQUENCE_RNN")
    transformer_shadow = require_metrics(transformer, "SEQUENCE_TRANSFORMER")
    blockers: list[str] = []

    equal_observables = (
        rnn.get("datasetSha256") == transformer.get("datasetSha256")
        and rnn.get("featureContractVersion") == transformer.get("featureContractVersion")
        and rnn.get("candidateGeneratorVersion") == transformer.get("candidateGeneratorVersion")
        and rnn.get("observableContractSha256") == transformer.get("observableContractSha256")
        and rnn_shadow["decisionCount"] == transformer_shadow["decisionCount"]
    )
    if not equal_observables:
        blockers.append("EQUAL_OBSERVABLES_CONTRACT_MISMATCH")
    if transformer_shadow["decisionCount"] < args.min_decision_count:
        blockers.append("TRANSFORMER_DECISION_COUNT_TOO_LOW")
    if transformer_shadow["support"] < args.min_support:
        blockers.append("TRANSFORMER_SUPPORT_BELOW_GATE")
    if transformer_shadow["majorCohortSupportMin"] < args.min_major_cohort_support:
        blockers.append("TRANSFORMER_MAJOR_COHORT_SUPPORT_BELOW_GATE")
    if rnn_shadow.get("probabilityFloorApplied") or transformer_shadow.get("probabilityFloorApplied"):
        blockers.append("PROBABILITY_FLOOR_FORBIDDEN")

    logloss_improvement = rnn_shadow["rawLogLoss"] - transformer_shadow["rawLogLoss"]
    cohort_gain = transformer_shadow["majorCohortSupportMin"] - rnn_shadow["majorCohortSupportMin"]
    if logloss_improvement < args.min_transformer_logloss_improvement:
        blockers.append("TRANSFORMER_LOGLOSS_GAIN_NOT_PROVEN")
    if cohort_gain < args.min_transformer_cohort_support_gain:
        blockers.append("TRANSFORMER_COHORT_GAIN_NOT_PROVEN")

    report = {
        "version": "recommendation-behavioral-ablation-v1",
        "passed": not blockers,
        "equalObservables": equal_observables,
        "datasetSha256": transformer.get("datasetSha256"),
        "featureContractVersion": transformer.get("featureContractVersion"),
        "candidateGeneratorVersion": transformer.get("candidateGeneratorVersion"),
        "observableContractSha256": transformer.get("observableContractSha256"),
        "rnnModelVersion": rnn.get("modelVersion"),
        "transformerModelVersion": transformer.get("modelVersion"),
        "decisionCount": transformer_shadow["decisionCount"],
        "transformerLogLossImprovement": logloss_improvement,
        "transformerMajorCohortSupportGain": cohort_gain,
        "blockers": sorted(set(blockers)),
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report))
    return 0 if report["passed"] else 2


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def require_metrics(result: Mapping[str, Any], expected_family: str) -> Mapping[str, Any]:
    if result.get("family") != expected_family:
        raise ValueError(f"Expected {expected_family} result")
    if result.get("futureTestEvaluated") is not False:
        raise ValueError("FUTURE_TEST_MUST_NOT_BE_EVALUATED_DURING_ABLATION")
    metrics = result.get("shadowHoldout")
    if not isinstance(metrics, dict):
        raise ValueError("shadowHoldout metrics are required")
    return metrics


if __name__ == "__main__":
    raise SystemExit(main())
