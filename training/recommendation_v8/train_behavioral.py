from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Mapping

import torch
from torch import nn

from common import (
    ALLOWED_TRAINING_SPLITS,
    canonical_json,
    dataset_identity,
    iter_examples,
    major_cohort_key,
    sha256_bytes,
    verify_dataset_manifest,
)
from model import build_model, collate_examples, model_config_from_json

TRAINING_LAUNCH_CONTRACT = "recommendation-behavioral-training-launch-v1"
BEHAVIORAL_MODEL_CONTRACT = "recommendation-behavioral-v8"
PROBABILITY_CONTRACT = "RAW_SOFTMAX_FEASIBLE_CHOICE_SET"
OBJECTIVE = "GROUPED_LISTWISE_CROSS_ENTROPY"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Behavioral V8 on an immutable verified dataset")
    parser.add_argument("--dataset-dir", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--source-commit-sha", required=True)
    parser.add_argument("--expected-dataset-sha256")
    parser.add_argument("--expected-manifest-sha256")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dataset_dir = Path(args.dataset_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    config_path = Path(args.config).resolve()
    if output_dir.exists() and any(output_dir.iterdir()):
        raise ValueError("Training output directory must be empty")
    output_dir.mkdir(parents=True, exist_ok=True)
    if not is_git_sha(args.source_commit_sha):
        raise ValueError("sourceCommitSha must be a 40-character Git SHA")

    config = load_config(config_path)
    validate_launch_config(config)
    manifest = verify_dataset_manifest(
        dataset_dir,
        expected_dataset_sha256=args.expected_dataset_sha256,
        expected_manifest_sha256=args.expected_manifest_sha256,
    )
    identity = dataset_identity(manifest)
    if manifest.get("futureTestTouched") is not False:
        raise ValueError("FUTURE_TEST_ALREADY_TOUCHED")

    set_determinism(int(config["seed"]), bool(config["deterministic"]))
    device = resolve_device(config)
    model_config = model_config_from_json(config)
    model = build_model(model_config).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=float(config["learningRate"]),
        weight_decay=float(config["weightDecay"]),
    )
    scheduler = build_scheduler(optimizer, config)
    loss_fn = nn.CrossEntropyLoss()

    best_validation_loss = math.inf
    best_epoch = 0
    epochs_without_improvement = 0
    history: List[Dict[str, Any]] = []
    checkpoint_path = output_dir / "model.pt"
    max_epochs = int(config["maxEpochs"])

    for epoch in range(1, max_epochs + 1):
        started_at = time.time()
        train_metrics = train_epoch(
            model,
            optimizer,
            loss_fn,
            dataset_dir,
            manifest,
            config,
            device,
            epoch,
        )
        validation_metrics = evaluate_split(
            model,
            dataset_dir,
            manifest,
            "VALIDATION",
            config,
            device,
        )
        scheduler.step(validation_metrics["rawLogLoss"])
        history.append({
            "epoch": epoch,
            "durationSec": time.time() - started_at,
            "train": train_metrics,
            "validation": validation_metrics,
        })

        if validation_metrics["rawLogLoss"] + float(config.get("earlyStoppingMinDelta", 0.0)) < best_validation_loss:
            best_validation_loss = validation_metrics["rawLogLoss"]
            best_epoch = epoch
            epochs_without_improvement = 0
            save_checkpoint(checkpoint_path, model, config, manifest, args, epoch, validation_metrics)
        else:
            epochs_without_improvement += 1

        if epochs_without_improvement >= int(config["earlyStoppingPatience"]):
            break

    if best_epoch == 0 or not checkpoint_path.is_file():
        raise RuntimeError("Training completed without a valid checkpoint")

    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["stateDict"])
    validation_metrics = evaluate_split(model, dataset_dir, manifest, "VALIDATION", config, device)
    shadow_metrics = evaluate_split(model, dataset_dir, manifest, "SHADOW_HOLDOUT", config, device)
    behavioral_gate = evaluate_behavioral_gate(shadow_metrics, config)

    result = {
        "contractVersion": "recommendation-behavioral-training-result-v1",
        "modelId": args.model_id,
        "modelVersion": args.model_version,
        "family": config["family"],
        "datasetId": identity.dataset_id,
        "datasetSha256": identity.dataset_sha256,
        "manifestSha256": identity.manifest_sha256,
        "featureContractVersion": identity.feature_contract_version,
        "candidateGeneratorVersion": identity.candidate_generator_version,
        "probabilityContract": PROBABILITY_CONTRACT,
        "objective": OBJECTIVE,
        "futureTestEvaluated": False,
        "bestEpoch": best_epoch,
        "validation": validation_metrics,
        "shadowHoldout": shadow_metrics,
        "behavioralGate": behavioral_gate,
        "trainingHistory": history,
        "environment": environment_fingerprint(device),
        "observableContractSha256": observable_contract_sha256(config, manifest),
        "trainingConfigSha256": sha256_bytes(canonical_json(config).encode("utf-8")),
    }
    write_json(output_dir / "metrics.json", result)
    write_json(output_dir / "training-config.json", config)
    write_json(output_dir / "dataset-identity.json", {
        "datasetId": identity.dataset_id,
        "datasetSha256": identity.dataset_sha256,
        "manifestSha256": identity.manifest_sha256,
        "futureTestEvaluated": False,
    })
    write_json(output_dir / "model-metadata.json", {
        "contract": BEHAVIORAL_MODEL_CONTRACT,
        "family": config["family"],
        "modelId": args.model_id,
        "modelVersion": args.model_version,
        "featureContractVersion": identity.feature_contract_version,
        "candidateGeneratorVersion": identity.candidate_generator_version,
        "probabilityContract": PROBABILITY_CONTRACT,
        "objective": OBJECTIVE,
        "hashDimension": int(config.get("hashDimension", 65536)),
        "maximumHistoryEvents": int(config["maximumHistoryEvents"]),
    })

    if not behavioral_gate["passed"]:
        print("Behavioral offline gate did not pass: " + ",".join(behavioral_gate["blockers"]), file=sys.stderr)
        return 2
    print(json.dumps({"status": "PASS", "modelVersion": args.model_version, "metrics": str(output_dir / "metrics.json")}))
    return 0


def load_config(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    if not isinstance(config, dict):
        raise ValueError("Training config must be a JSON object")
    return config


def validate_launch_config(config: Mapping[str, Any]) -> None:
    errors: List[str] = []
    if config.get("contractVersion") != TRAINING_LAUNCH_CONTRACT:
        errors.append("TRAINING_CONFIG_CONTRACT_MISMATCH")
    if config.get("family") not in ("SEQUENCE_RNN", "SEQUENCE_TRANSFORMER"):
        errors.append("TRAINING_FAMILY_INVALID")
    if config.get("deterministic") is not True:
        errors.append("DETERMINISTIC_TRAINING_REQUIRED")
    if config.get("trainSplit") != "TRAIN":
        errors.append("TRAIN_SPLIT_MUST_BE_TRAIN")
    if config.get("validationSplit") != "VALIDATION":
        errors.append("VALIDATION_SPLIT_MUST_BE_VALIDATION")
    if config.get("selectionSplit") != "SHADOW_HOLDOUT":
        errors.append("SELECTION_SPLIT_MUST_BE_SHADOW_HOLDOUT")
    if config.get("futureTestAllowed") is not False:
        errors.append("FUTURE_TEST_MUST_BE_BLOCKED")
    for name in ("maxEpochs", "batchSize", "maximumHistoryEvents", "embeddingDimension", "hiddenDimension", "layerCount", "earlyStoppingPatience"):
        if not isinstance(config.get(name), int) or int(config[name]) <= 0:
            errors.append(f"{name}_INVALID")
    for name in ("learningRate", "gradientClip"):
        if not positive_finite(config.get(name)):
            errors.append(f"{name}_INVALID")
    if not nonnegative_finite(config.get("weightDecay")):
        errors.append("weightDecay_INVALID")
    support_threshold = config.get("supportProbabilityThreshold", 1e-4)
    if not isinstance(support_threshold, (int, float)) or not 0 < float(support_threshold) < 1:
        errors.append("supportProbabilityThreshold_INVALID")
    diagnostic_floor = config.get("diagnosticProbabilityFloor", 1e-4)
    if not isinstance(diagnostic_floor, (int, float)) or not 0 < float(diagnostic_floor) < 1:
        errors.append("diagnosticProbabilityFloor_INVALID")
    calibration_bins = config.get("calibrationBins", 20)
    if not isinstance(calibration_bins, int) or calibration_bins < 2 or calibration_bins > 1000:
        errors.append("calibrationBins_INVALID")
    if config.get("family") == "SEQUENCE_TRANSFORMER":
        heads = config.get("attentionHeads")
        if not isinstance(heads, int) or heads <= 0:
            errors.append("ATTENTION_HEADS_REQUIRED")
        elif isinstance(config.get("hiddenDimension"), int) and int(config["hiddenDimension"]) % heads != 0:
            errors.append("HIDDEN_DIMENSION_NOT_DIVISIBLE_BY_ATTENTION_HEADS")
    if errors:
        raise ValueError("Invalid training config: " + ",".join(sorted(set(errors))))


def set_determinism(seed: int, deterministic: bool) -> None:
    if seed < 0:
        raise ValueError("seed must be non-negative")
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    if deterministic:
        torch.use_deterministic_algorithms(True, warn_only=False)
        if hasattr(torch.backends, "cudnn"):
            torch.backends.cudnn.benchmark = False
            torch.backends.cudnn.deterministic = True
    os.environ["PYTHONHASHSEED"] = str(seed)


def resolve_device(config: Mapping[str, Any]) -> torch.device:
    requested = str(config.get("device", "cuda" if torch.cuda.is_available() else "cpu"))
    if requested.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available")
    return torch.device(requested)


def build_scheduler(optimizer: torch.optim.Optimizer, config: Mapping[str, Any]):
    return torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="min",
        factor=float(config.get("lrPlateauFactor", 0.5)),
        patience=int(config.get("lrPlateauPatience", 1)),
        min_lr=float(config.get("minimumLearningRate", 1e-6)),
    )


def train_epoch(
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    loss_fn: nn.Module,
    dataset_dir: Path,
    manifest: Mapping[str, Any],
    config: Mapping[str, Any],
    device: torch.device,
    epoch: int,
) -> Dict[str, float]:
    model.train()
    batch_size = int(config["batchSize"])
    seed = int(config["seed"]) + epoch * 1009
    shuffle_buffer = int(config.get("shuffleBufferDecisions", max(4096, batch_size * 16)))
    loss_sum = 0.0
    decision_count = 0
    optimizer.zero_grad(set_to_none=True)

    for examples in batch_stream(
        shuffled_stream(iter_examples(dataset_dir, manifest, "TRAIN"), shuffle_buffer, seed),
        batch_size,
    ):
        batch = collate_examples(examples, model.config, device)
        scores = model(batch)
        loss = loss_fn(scores, batch["labels"])
        if not torch.isfinite(loss):
            raise RuntimeError("Non-finite Behavioral training loss")
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), float(config["gradientClip"]), error_if_nonfinite=True)
        optimizer.step()
        optimizer.zero_grad(set_to_none=True)
        count = len(examples)
        loss_sum += float(loss.detach().cpu()) * count
        decision_count += count

    if decision_count == 0:
        raise RuntimeError("TRAIN split emitted zero decisions")
    return {"decisionCount": decision_count, "rawLogLoss": loss_sum / decision_count}


@torch.no_grad()
def evaluate_split(
    model: nn.Module,
    dataset_dir: Path,
    manifest: Mapping[str, Any],
    split: str,
    config: Mapping[str, Any],
    device: torch.device,
) -> Dict[str, Any]:
    if split not in ALLOWED_TRAINING_SPLITS:
        raise ValueError(f"Evaluation split is forbidden during model development: {split}")
    model.eval()
    batch_size = int(config.get("evaluationBatchSize", config["batchSize"]))
    support_threshold = float(config.get("supportProbabilityThreshold", 1e-4))
    diagnostic_floor = float(config.get("diagnosticProbabilityFloor", 1e-4))
    calibration_bins = int(config.get("calibrationBins", 20))
    decision_count = 0
    covered = 0
    supported = 0
    hit_at_1 = 0
    hit_at_3 = 0
    hit_at_5 = 0
    reciprocal_rank_sum = 0.0
    ndcg_at_3_sum = 0.0
    ndcg_at_5_sum = 0.0
    log_loss_sum = 0.0
    floored_log_loss_sum = 0.0
    baseline_log_loss_sum = 0.0
    brier_sum = 0.0
    entropy_sum = 0.0
    cohort_total: Dict[str, int] = defaultdict(int)
    cohort_supported: Dict[str, int] = defaultdict(int)
    cohort_log_loss: Dict[str, float] = defaultdict(float)
    illegal_candidate_count = 0
    candidate_count = 0
    observed_probabilities: List[float] = []
    candidate_counts: List[int] = []
    calibration_count = [0 for _ in range(calibration_bins)]
    calibration_probability_sum = [0.0 for _ in range(calibration_bins)]
    calibration_outcome_sum = [0.0 for _ in range(calibration_bins)]
    action_type_confusion: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for examples in batch_stream(iter_examples(dataset_dir, manifest, split), batch_size):
        batch = collate_examples(examples, model.config, device)
        scores = model(batch)
        probabilities = torch.softmax(scores, dim=1)
        for index, example in enumerate(examples):
            count = batch["candidate_counts"][index]
            probs = probabilities[index, :count].detach().cpu()
            label = int(batch["labels"][index].detach().cpu())
            probability = float(probs[label])
            decision_count += 1
            covered += 1
            candidate_count += count
            candidate_counts.append(count)
            observed_probabilities.append(probability)
            illegal_candidate_count += sum(1 for candidate in example["candidates"] if candidate.get("feasible") is not True)
            raw_loss = -math.log(max(probability, sys.float_info.min))
            log_loss_sum += raw_loss
            baseline_log_loss_sum += math.log(count)
            entropy_sum += -sum(float(p) * math.log(max(float(p), sys.float_info.min)) for p in probs)

            floored = [max(float(p), diagnostic_floor) for p in probs]
            floored_total = sum(floored)
            floored_probability = floored[label] / floored_total
            floored_log_loss_sum += -math.log(max(floored_probability, sys.float_info.min))

            brier_sum += sum(
                (float(p) - (1.0 if candidate_index == label else 0.0)) ** 2
                for candidate_index, p in enumerate(probs)
            )
            for candidate_index, p in enumerate(probs):
                p_value = float(p)
                bin_index = min(calibration_bins - 1, int(p_value * calibration_bins))
                calibration_count[bin_index] += 1
                calibration_probability_sum[bin_index] += p_value
                calibration_outcome_sum[bin_index] += 1.0 if candidate_index == label else 0.0

            ranking = torch.argsort(probs, descending=True)
            rank = int((ranking == label).nonzero(as_tuple=False)[0].item()) + 1
            reciprocal_rank_sum += 1.0 / rank
            if rank <= 1:
                hit_at_1 += 1
            if rank <= 3:
                hit_at_3 += 1
                ndcg_at_3_sum += 1.0 / math.log2(rank + 1)
            if rank <= 5:
                hit_at_5 += 1
                ndcg_at_5_sum += 1.0 / math.log2(rank + 1)

            predicted_index = int(ranking[0].item())
            observed_type = str(example["candidates"][label].get("actionType", "UNKNOWN"))
            predicted_type = str(example["candidates"][predicted_index].get("actionType", "UNKNOWN"))
            action_type_confusion[observed_type][predicted_type] += 1

            is_supported = probability >= support_threshold
            if is_supported:
                supported += 1
            cohort = major_cohort_key(example)
            cohort_total[cohort] += 1
            cohort_log_loss[cohort] += raw_loss
            if is_supported:
                cohort_supported[cohort] += 1

    if decision_count == 0:
        raise RuntimeError(f"{split} split emitted zero decisions")
    major_min_count = max(
        int(config.get("majorCohortMinDecisions", 50)),
        math.ceil(decision_count * float(config.get("majorCohortMinFraction", 0.005))),
    )
    major_keys = sorted(key for key, total in cohort_total.items() if total >= major_min_count)
    major_support = [cohort_supported[key] / cohort_total[key] for key in major_keys]
    major_cohort_support_min = min(major_support) if major_support else supported / decision_count
    illegal_rate = illegal_candidate_count / candidate_count if candidate_count else 0.0
    raw_log_loss = log_loss_sum / decision_count
    floored_log_loss = floored_log_loss_sum / decision_count

    reliability = []
    ece = 0.0
    for bin_index in range(calibration_bins):
        count = calibration_count[bin_index]
        if count == 0:
            continue
        mean_probability = calibration_probability_sum[bin_index] / count
        empirical_rate = calibration_outcome_sum[bin_index] / count
        ece += (count / candidate_count) * abs(mean_probability - empirical_rate)
        reliability.append({
            "bin": bin_index,
            "count": count,
            "meanProbability": mean_probability,
            "empiricalRate": empirical_rate,
        })

    cohort_metrics = {
        key: {
            "decisionCount": cohort_total[key],
            "support": cohort_supported[key] / cohort_total[key],
            "rawLogLoss": cohort_log_loss[key] / cohort_total[key],
            "major": cohort_total[key] >= major_min_count,
        }
        for key in sorted(cohort_total)
    }

    return {
        "split": split,
        "decisionCount": decision_count,
        "labeledDecisionCount": decision_count,
        "coveredDecisionCount": covered,
        "candidateCoverage": covered / decision_count,
        "support": supported / decision_count,
        "supportProbabilityThreshold": support_threshold,
        "supportDistribution": quantile_report(observed_probabilities),
        "majorCohortSupportMin": major_cohort_support_min,
        "majorCohortCount": len(major_keys),
        "cohortMetrics": cohort_metrics,
        "rawLogLoss": raw_log_loss,
        "baselineRawLogLoss": baseline_log_loss_sum / decision_count,
        "multiclassBrier": brier_sum / decision_count,
        "expectedCalibrationError": ece,
        "reliability": reliability,
        "hitAt1": hit_at_1 / decision_count,
        "hitAt3": hit_at_3 / decision_count,
        "hitAt5": hit_at_5 / decision_count,
        "top1Accuracy": hit_at_1 / decision_count,
        "mrr": reciprocal_rank_sum / decision_count,
        "ndcgAt3": ndcg_at_3_sum / decision_count,
        "ndcgAt5": ndcg_at_5_sum / decision_count,
        "meanEntropy": entropy_sum / decision_count,
        "candidateCountDistribution": quantile_report([float(value) for value in candidate_counts]),
        "exactActionTypeConfusion": {
            observed: dict(sorted(predicted.items()))
            for observed, predicted in sorted(action_type_confusion.items())
        },
        "probabilityFloorApplied": False,
        "diagnosticProbabilityFloor": diagnostic_floor,
        "diagnosticFlooredLogLoss": floored_log_loss,
        "floorSensitivity": abs(floored_log_loss - raw_log_loss),
        "illegalCandidateRate": illegal_rate,
        "temporalHoldout": split == "SHADOW_HOLDOUT",
    }


def evaluate_behavioral_gate(metrics: Mapping[str, Any], config: Mapping[str, Any]) -> Dict[str, Any]:
    thresholds = {
        "minDecisions": int(config.get("gateMinDecisions", 10000)),
        "minCandidateCoverage": float(config.get("gateMinCandidateCoverage", 0.99)),
        "minSupport": float(config.get("gateMinSupport", 0.90)),
        "minMajorCohortSupport": float(config.get("gateMinMajorCohortSupport", 0.75)),
        "maxFloorSensitivity": float(config.get("gateMaxFloorSensitivity", 0.02)),
    }
    blockers: List[str] = []
    if metrics["decisionCount"] < thresholds["minDecisions"]:
        blockers.append("DECISION_COUNT")
    if metrics["candidateCoverage"] < thresholds["minCandidateCoverage"]:
        blockers.append("CANDIDATE_COVERAGE")
    if metrics["support"] < thresholds["minSupport"]:
        blockers.append("SUPPORT")
    if metrics["majorCohortSupportMin"] < thresholds["minMajorCohortSupport"]:
        blockers.append("MAJOR_COHORT_SUPPORT")
    if metrics["floorSensitivity"] > thresholds["maxFloorSensitivity"]:
        blockers.append("FLOOR_SENSITIVITY")
    if metrics["probabilityFloorApplied"] is not False:
        blockers.append("NO_PROBABILITY_FLOOR")
    if metrics["illegalCandidateRate"] != 0:
        blockers.append("ILLEGAL_CANDIDATE_RATE")
    if metrics["rawLogLoss"] >= metrics["baselineRawLogLoss"]:
        blockers.append("RAW_LOG_LOSS")
    return {"passed": not blockers, "blockers": blockers, "thresholds": thresholds}


def save_checkpoint(
    path: Path,
    model: nn.Module,
    config: Mapping[str, Any],
    manifest: Mapping[str, Any],
    args: argparse.Namespace,
    epoch: int,
    validation_metrics: Mapping[str, Any],
) -> None:
    torch.save({
        "contract": BEHAVIORAL_MODEL_CONTRACT,
        "family": config["family"],
        "modelId": args.model_id,
        "modelVersion": args.model_version,
        "sourceCommitSha": args.source_commit_sha,
        "datasetSha256": manifest["datasetSha256"],
        "featureContractVersion": manifest["featureContractVersion"],
        "candidateGeneratorVersion": manifest["candidateGeneratorVersion"],
        "probabilityContract": PROBABILITY_CONTRACT,
        "objective": OBJECTIVE,
        "futureTestEvaluated": False,
        "epoch": epoch,
        "validationMetrics": dict(validation_metrics),
        "config": dict(config),
        "stateDict": model.state_dict(),
    }, path)


def shuffled_stream(source: Iterable[Dict[str, Any]], buffer_size: int, seed: int) -> Iterator[Dict[str, Any]]:
    if buffer_size <= 0:
        raise ValueError("shuffleBufferDecisions must be positive")
    rng = random.Random(seed)
    buffer: List[Dict[str, Any]] = []
    iterator = iter(source)
    for _ in range(buffer_size):
        try:
            buffer.append(next(iterator))
        except StopIteration:
            break
    while buffer:
        index = rng.randrange(len(buffer))
        item = buffer[index]
        try:
            buffer[index] = next(iterator)
        except StopIteration:
            buffer.pop(index)
        yield item


def batch_stream(source: Iterable[Dict[str, Any]], batch_size: int) -> Iterator[List[Dict[str, Any]]]:
    if batch_size <= 0:
        raise ValueError("batchSize must be positive")
    batch: List[Dict[str, Any]] = []
    for item in source:
        batch.append(item)
        if len(batch) == batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


def quantile_report(values: List[float]) -> Dict[str, float]:
    if not values:
        return {"p01": 0.0, "p05": 0.0, "p10": 0.0, "p50": 0.0, "p90": 0.0, "p95": 0.0, "p99": 0.0}
    ordered = sorted(values)
    return {
        "p01": percentile(ordered, 0.01),
        "p05": percentile(ordered, 0.05),
        "p10": percentile(ordered, 0.10),
        "p50": percentile(ordered, 0.50),
        "p90": percentile(ordered, 0.90),
        "p95": percentile(ordered, 0.95),
        "p99": percentile(ordered, 0.99),
    }


def percentile(ordered: List[float], fraction: float) -> float:
    if len(ordered) == 1:
        return float(ordered[0])
    position = fraction * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(ordered[lower])
    weight = position - lower
    return float(ordered[lower] * (1 - weight) + ordered[upper] * weight)


def observable_contract_sha256(config: Mapping[str, Any], manifest: Mapping[str, Any]) -> str:
    contract = {
        "datasetSha256": manifest["datasetSha256"],
        "featureContractVersion": manifest["featureContractVersion"],
        "candidateGeneratorVersion": manifest["candidateGeneratorVersion"],
        "hashDimension": int(config.get("hashDimension", 65536)),
        "maximumHistoryEvents": int(config["maximumHistoryEvents"]),
        "stateTokenContract": "recommendation-features-v8:state-tokens",
        "historyTokenContract": "recommendation-features-v8:history-tokens",
        "actionTokenContract": "recommendation-features-v8:action-tokens",
    }
    return sha256_bytes(canonical_json(contract).encode("utf-8"))


def environment_fingerprint(device: torch.device) -> Dict[str, Any]:
    return {
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "cudaRuntime": torch.version.cuda,
        "device": str(device),
        "deviceName": torch.cuda.get_device_name(device) if device.type == "cuda" else "cpu",
    }


def write_json(path: Path, value: Any) -> None:
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")


def positive_finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)) and float(value) > 0


def nonnegative_finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)) and float(value) >= 0


def is_git_sha(value: str) -> bool:
    return len(value) == 40 and all(character in "0123456789abcdefABCDEF" for character in value)


if __name__ == "__main__":
    raise SystemExit(main())
