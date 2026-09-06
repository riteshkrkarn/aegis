"""Catalog of selectable planner models (OpenAI + Groq + NVIDIA NIM)."""

from __future__ import annotations

from typing import Literal, TypedDict

ModelChoiceId = Literal[
    'openai-gpt',
    'groq-qwen',
    'nvidia-llama',
    'nvidia-nemotron',
]


class ModelOption(TypedDict):
    id: ModelChoiceId
    label: str
    provider: Literal['openai', 'groq', 'nvidia']
    model: str
    description: str


# Best currently available IDs for each family (as of 2026).
MODEL_OPTIONS: list[ModelOption] = [
    {
        'id': 'openai-gpt',
        'label': 'OpenAI GPT-4.1 Mini',
        'provider': 'openai',
        'model': 'gpt-4.1-mini',
        'description': 'OpenAI · mid-cost, strong agent planner',
    },
    {
        'id': 'groq-qwen',
        'label': 'Qwen3.6 27B',
        'provider': 'groq',
        'model': 'qwen/qwen3.6-27b',
        'description': 'Groq · best Qwen chat model on GroqCloud',
    },
    {
        'id': 'nvidia-llama',
        'label': 'Llama 3.2 11B Vision',
        'provider': 'nvidia',
        'model': 'meta/llama-3.2-11b-vision-instruct',
        'description': 'NVIDIA NIM · Meta Llama (hosted text+vision)',
    },
    {
        'id': 'nvidia-nemotron',
        'label': 'Nemotron 3 Super 120B',
        'provider': 'nvidia',
        'model': 'nvidia/nemotron-3-super-120b-a12b',
        'description': 'NVIDIA NIM · Nemotron agentic specialist',
    },
]

DEFAULT_MODEL_ID: ModelChoiceId = 'openai-gpt'

_BY_ID = {opt['id']: opt for opt in MODEL_OPTIONS}


def resolve_model_choice(model_id: str | None) -> ModelOption:
    # Migrate retired UI id from Groq OpenAI-OSS slot.
    if model_id == 'groq-openai':
        model_id = 'openai-gpt'
    if model_id and model_id in _BY_ID:
        return _BY_ID[model_id]  # type: ignore[return-value]
    return _BY_ID[DEFAULT_MODEL_ID]
