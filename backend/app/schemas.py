from typing import Literal, Optional

from pydantic import BaseModel, Field


ActionType = Literal['click', 'fill', 'scroll', 'navigate', 'wait']


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


class AgentRunResponse(BaseModel):
    actions: list[AgentAction]
    reasoning: Optional[str] = None
