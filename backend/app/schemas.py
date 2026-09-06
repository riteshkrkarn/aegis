from typing import Literal, Optional

from pydantic import BaseModel, Field


ActionType = Literal['click', 'fill', 'scroll', 'navigate', 'wait']
ModelChoiceId = Literal[
    'openai-gpt',
    'groq-qwen',
    'nvidia-llama',
    'nvidia-nemotron',
    # Legacy UI id (mapped to openai-gpt in the catalog)
    'groq-openai',
]


class AgentAction(BaseModel):
    action: ActionType
    selector: Optional[str] = None
    value: Optional[str] = None
    url: Optional[str] = None
    amount: Optional[float] = None


class AgentRunRequest(BaseModel):
    task: str = Field(..., min_length=1)
    page_markdown: str = Field(..., description='Sanitized page markdown (PII already masked client-side)')
    page_url: str = ''
    step_index: int = 0
    prior_results: list[str] = Field(default_factory=list)
    prior_reasoning: str = ''
    model_id: Optional[ModelChoiceId] = Field(
        default=None,
        description='UI model choice: openai-gpt | groq-qwen | nvidia-llama | nvidia-nemotron',
    )
    force_answer: bool = Field(
        default=False,
        description='When true, model must finish with done=true and a user-facing answer',
    )


class AgentRunResponse(BaseModel):
    actions: list[AgentAction]
    reasoning: Optional[str] = None
    done: bool = False
    answer: Optional[str] = Field(
        default=None,
        description='Plain-language answer for the user when the goal is complete',
    )
