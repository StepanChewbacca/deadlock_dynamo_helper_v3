from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Sequence

import torch
from torch import Tensor, nn

from common import action_tokens, fnv1a_index, history_tokens, state_tokens


@dataclass(frozen=True)
class ModelConfig:
    family: str
    hash_dimension: int
    embedding_dimension: int
    hidden_dimension: int
    layer_count: int
    attention_heads: int | None
    dropout: float
    maximum_history_events: int


def encode_tokens(tokens: Sequence[str], dimension: int) -> List[int]:
    return [fnv1a_index(token, dimension) for token in tokens] or [0]


def collate_examples(examples: Sequence[Mapping[str, Any]], config: ModelConfig, device: torch.device) -> Dict[str, Any]:
    if not examples:
        raise ValueError("Cannot collate an empty decision batch")

    state_rows = [encode_tokens(state_tokens(example["state"]), config.hash_dimension) for example in examples]
    history_rows = [
        encode_tokens(history_tokens(example["state"], config.maximum_history_events), config.hash_dimension)
        for example in examples
    ]
    candidate_rows: List[List[List[int]]] = []
    labels: List[int] = []
    candidate_counts: List[int] = []

    for example in examples:
        candidates = example["candidates"]
        candidate_rows.append([encode_tokens(action_tokens(candidate), config.hash_dimension) for candidate in candidates])
        candidate_counts.append(len(candidates))
        observed_key = example["observedActionKey"]
        labels.append(next(index for index, candidate in enumerate(candidates) if candidate["actionKey"] == observed_key))

    state_ids, state_mask = pad_2d(state_rows, device)
    history_ids, history_mask = pad_2d(history_rows, device)
    candidate_ids, candidate_token_mask, candidate_mask = pad_candidates(candidate_rows, device)

    return {
        "state_ids": state_ids,
        "state_mask": state_mask,
        "history_ids": history_ids,
        "history_mask": history_mask,
        "candidate_ids": candidate_ids,
        "candidate_token_mask": candidate_token_mask,
        "candidate_mask": candidate_mask,
        "labels": torch.tensor(labels, dtype=torch.long, device=device),
        "candidate_counts": candidate_counts,
        "examples": examples,
    }


def pad_2d(rows: Sequence[Sequence[int]], device: torch.device) -> tuple[Tensor, Tensor]:
    width = max(len(row) for row in rows)
    values = torch.zeros((len(rows), width), dtype=torch.long, device=device)
    mask = torch.zeros((len(rows), width), dtype=torch.bool, device=device)
    for row_index, row in enumerate(rows):
        if row:
            values[row_index, : len(row)] = torch.tensor(row, dtype=torch.long, device=device)
            mask[row_index, : len(row)] = True
    return values, mask


def pad_candidates(rows: Sequence[Sequence[Sequence[int]]], device: torch.device) -> tuple[Tensor, Tensor, Tensor]:
    max_candidates = max(len(row) for row in rows)
    max_tokens = max(len(tokens) for row in rows for tokens in row)
    values = torch.zeros((len(rows), max_candidates, max_tokens), dtype=torch.long, device=device)
    token_mask = torch.zeros_like(values, dtype=torch.bool)
    candidate_mask = torch.zeros((len(rows), max_candidates), dtype=torch.bool, device=device)
    for batch_index, candidates in enumerate(rows):
        for candidate_index, tokens in enumerate(candidates):
            values[batch_index, candidate_index, : len(tokens)] = torch.tensor(tokens, dtype=torch.long, device=device)
            token_mask[batch_index, candidate_index, : len(tokens)] = True
            candidate_mask[batch_index, candidate_index] = True
    return values, token_mask, candidate_mask


class TokenPool(nn.Module):
    def __init__(self, hash_dimension: int, embedding_dimension: int) -> None:
        super().__init__()
        self.embedding = nn.Embedding(hash_dimension, embedding_dimension, padding_idx=0)

    def forward(self, token_ids: Tensor, mask: Tensor) -> Tensor:
        embeddings = self.embedding(token_ids)
        weights = mask.to(embeddings.dtype).unsqueeze(-1)
        denominator = weights.sum(dim=-2).clamp_min(1.0)
        return (embeddings * weights).sum(dim=-2) / denominator


class CandidateScorer(nn.Module):
    def __init__(self, hidden_dimension: int, embedding_dimension: int, dropout: float) -> None:
        super().__init__()
        self.candidate_projection = nn.Sequential(
            nn.Linear(embedding_dimension, hidden_dimension),
            nn.GELU(),
            nn.LayerNorm(hidden_dimension),
        )
        self.score = nn.Sequential(
            nn.Linear(hidden_dimension * 3, hidden_dimension),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dimension, 1),
        )

    def forward(self, context: Tensor, candidate_embeddings: Tensor, candidate_mask: Tensor) -> Tensor:
        candidates = self.candidate_projection(candidate_embeddings)
        expanded_context = context.unsqueeze(1).expand(-1, candidates.shape[1], -1)
        features = torch.cat([expanded_context, candidates, expanded_context * candidates], dim=-1)
        scores = self.score(features).squeeze(-1)
        return scores.masked_fill(~candidate_mask, -torch.inf)


class BehavioralModelBase(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()
        self.config = config
        self.tokens = TokenPool(config.hash_dimension, config.embedding_dimension)
        self.scorer = CandidateScorer(config.hidden_dimension, config.embedding_dimension, config.dropout)

    def candidate_embeddings(self, candidate_ids: Tensor, candidate_token_mask: Tensor) -> Tensor:
        shape = candidate_ids.shape
        flat_ids = candidate_ids.reshape(shape[0] * shape[1], shape[2])
        flat_mask = candidate_token_mask.reshape(shape[0] * shape[1], shape[2])
        pooled = self.tokens(flat_ids, flat_mask)
        return pooled.reshape(shape[0], shape[1], -1)


class RnnBehavioralModel(BehavioralModelBase):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__(config)
        self.state_projection = nn.Linear(config.embedding_dimension, config.hidden_dimension)
        self.history_projection = nn.Linear(config.embedding_dimension, config.hidden_dimension)
        self.rnn = nn.GRU(
            input_size=config.hidden_dimension,
            hidden_size=config.hidden_dimension,
            num_layers=config.layer_count,
            batch_first=True,
            dropout=config.dropout if config.layer_count > 1 else 0.0,
        )
        self.context_norm = nn.LayerNorm(config.hidden_dimension)

    def forward(self, batch: Mapping[str, Tensor]) -> Tensor:
        state_embedding = self.tokens(batch["state_ids"], batch["state_mask"])
        history_embedding = self.tokens.embedding(batch["history_ids"])
        history_projected = self.history_projection(history_embedding)
        lengths = batch["history_mask"].sum(dim=1).clamp_min(1).to(torch.long)
        packed = nn.utils.rnn.pack_padded_sequence(
            history_projected,
            lengths.cpu(),
            batch_first=True,
            enforce_sorted=False,
        )
        _, hidden = self.rnn(packed)
        history_context = hidden[-1]
        context = self.context_norm(torch.tanh(self.state_projection(state_embedding) + history_context))
        candidates = self.candidate_embeddings(batch["candidate_ids"], batch["candidate_token_mask"])
        return self.scorer(context, candidates, batch["candidate_mask"])


class TransformerBehavioralModel(BehavioralModelBase):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__(config)
        if not config.attention_heads or config.hidden_dimension % config.attention_heads != 0:
            raise ValueError("Transformer hidden dimension must be divisible by attention heads")
        self.state_projection = nn.Linear(config.embedding_dimension, config.hidden_dimension)
        self.history_projection = nn.Linear(config.embedding_dimension, config.hidden_dimension)
        max_history_tokens = max(1, config.maximum_history_events * 3)
        self.position = nn.Embedding(max_history_tokens + 1, config.hidden_dimension)
        layer = nn.TransformerEncoderLayer(
            d_model=config.hidden_dimension,
            nhead=config.attention_heads,
            dim_feedforward=config.hidden_dimension * 4,
            dropout=config.dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=config.layer_count, enable_nested_tensor=False)
        self.context_norm = nn.LayerNorm(config.hidden_dimension)

    def forward(self, batch: Mapping[str, Tensor]) -> Tensor:
        state_embedding = self.tokens(batch["state_ids"], batch["state_mask"])
        history_embedding = self.tokens.embedding(batch["history_ids"])
        state_token = self.state_projection(state_embedding).unsqueeze(1)
        history_tokens_projected = self.history_projection(history_embedding)
        sequence = torch.cat([state_token, history_tokens_projected], dim=1)
        positions = torch.arange(sequence.shape[1], device=sequence.device).unsqueeze(0)
        sequence = sequence + self.position(positions)
        sequence_mask = torch.cat([
            torch.ones((sequence.shape[0], 1), dtype=torch.bool, device=sequence.device),
            batch["history_mask"],
        ], dim=1)
        encoded = self.encoder(sequence, src_key_padding_mask=~sequence_mask)
        context = self.context_norm(encoded[:, 0, :])
        candidates = self.candidate_embeddings(batch["candidate_ids"], batch["candidate_token_mask"])
        return self.scorer(context, candidates, batch["candidate_mask"])


def build_model(config: ModelConfig) -> BehavioralModelBase:
    if config.family == "SEQUENCE_RNN":
        return RnnBehavioralModel(config)
    if config.family == "SEQUENCE_TRANSFORMER":
        return TransformerBehavioralModel(config)
    raise ValueError(f"Unsupported Behavioral model family: {config.family}")


def model_config_from_json(value: Mapping[str, Any]) -> ModelConfig:
    family = str(value["family"])
    attention_heads = value.get("attentionHeads")
    config = ModelConfig(
        family=family,
        hash_dimension=int(value.get("hashDimension", 65536)),
        embedding_dimension=int(value["embeddingDimension"]),
        hidden_dimension=int(value["hiddenDimension"]),
        layer_count=int(value["layerCount"]),
        attention_heads=int(attention_heads) if attention_heads is not None else None,
        dropout=float(value.get("dropout", 0.1)),
        maximum_history_events=int(value["maximumHistoryEvents"]),
    )
    if config.hash_dimension < 1024:
        raise ValueError("hashDimension must be >= 1024")
    if config.embedding_dimension <= 0 or config.hidden_dimension <= 0 or config.layer_count <= 0:
        raise ValueError("Model dimensions and layerCount must be positive")
    if not 0 <= config.dropout < 1:
        raise ValueError("dropout must be in [0,1)")
    return config
