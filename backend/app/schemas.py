from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


ActionType = Literal['click', 'fill', 'scroll', 'navigate', 'wait']
ALLOWED_ACTIONS: frozenset[str] = frozenset({'click', 'fill', 'scroll', 'navigate', 'wait'})

# Common model typos / aliases → canonical action names.
ACTION_ALIASES: dict[str, ActionType] = {
    'click': 'click',
    'tap': 'click',
    'press': 'click',
    'submit': 'click',
    'fill': 'fill',
    'type': 'fill',
    'input': 'fill',
    'enter': 'fill',
    'write': 'fill',
    'scroll': 'scroll',
    'scroll_down': 'scroll',
    'scroll_up': 'scroll',
    'navigate': 'navigate',
    'goto': 'navigate',
    'go': 'navigate',
    'open': 'navigate',
    'wait': 'wait',
    'sleep': 'wait',
    'pause': 'wait',
    # Terminal aliases (normalized away from the actions list)
    'done': 'wait',
    'answer': 'wait',
    'finish': 'wait',
}

ModelChoiceId = Literal[
    'openai-gpt',
    'groq-qwen',
    'nvidia-llama',
    'nvidia-nemotron',
    # Legacy UI id (mapped to openai-gpt in the catalog)
    'groq-openai',
]


def normalize_action_type(raw: Any) -> ActionType | None:
    if not isinstance(raw, str):
        return None
    key = raw.strip().lower().replace('-', '_').replace(' ', '_')
    return ACTION_ALIASES.get(key)


def _is_unsafe_selector(selector: str) -> bool:
    """Reject selectors that are too vague or clearly non-executable."""
    s = selector.strip().lower()
    if not s:
        return True
    # Bare tags with no qualifier — match the wrong control too often.
    if s in {'a', 'button', 'input', 'div', 'span', 'form', 'label', 'select', 'textarea'}:
        return True
    if s in {'button[type=button]', 'button[type="button"]'}:
        return True
    return False


class AgentAction(BaseModel):
    action: ActionType
    selector: Optional[str] = None
    value: Optional[str] = None
    url: Optional[str] = None
    amount: Optional[float] = None

    @field_validator('action', mode='before')
    @classmethod
    def _coerce_action(cls, v: Any) -> Any:
        normalized = normalize_action_type(v)
        return normalized if normalized is not None else v

    @field_validator('selector', mode='before')
    @classmethod
    def _strip_selector(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v

    @field_validator('url', mode='before')
    @classmethod
    def _strip_url(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v

    @model_validator(mode='after')
    def _require_fields(self) -> 'AgentAction':
        if self.action in {'click', 'fill'}:
            if not self.selector:
                raise ValueError(f'{self.action} requires selector')
            if _is_unsafe_selector(self.selector):
                raise ValueError(f'{self.action} selector too vague: {self.selector!r}')
        if self.action == 'fill' and self.value is None:
            # Allow empty string fills; missing value is invalid.
            raise ValueError('fill requires value')
        if self.action == 'navigate':
            if not self.url:
                raise ValueError('navigate requires url')
            if not (
                self.url.startswith('http://')
                or self.url.startswith('https://')
                or self.url.startswith('/')
            ):
                raise ValueError(f'navigate url must be http(s) or path: {self.url!r}')
        if self.action == 'scroll' and self.amount is None:
            self.amount = 400.0
        if self.action == 'wait' and self.amount is None:
            self.amount = 500.0
        return self


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
    # Demo-only fields: logged when DEBUG=1; never passed to the LLM.
    debug_before_markdown: Optional[str] = Field(
        default=None,
        description='Pre-mask markdown for local DEBUG privacy audit (not used for planning)',
    )
    mask_method: Optional[str] = Field(
        default=None,
        description='Client mask method: transformers-js-vlm | placeholder',
    )


class AgentRunResponse(BaseModel):
    actions: list[AgentAction] = Field(default_factory=list)
    reasoning: Optional[str] = None
    done: bool = False
    answer: Optional[str] = Field(
        default=None,
        description='Plain-language answer for the user when the goal is complete',
    )

    @model_validator(mode='before')
    @classmethod
    def _normalize_done_answer_aliases(cls, data: Any) -> Any:
        """Accept finished/complete aliases and mirror done ↔ answer consistency hooks."""
        if not isinstance(data, dict):
            return data
        out = dict(data)

        # Alias keys some models emit instead of done
        if 'done' not in out:
            for key in ('finished', 'complete', 'is_done', 'task_complete'):
                if key in out:
                    out['done'] = out[key]
                    break

        # Alias keys for answer
        if out.get('answer') in (None, '') and 'response' in out:
            out['answer'] = out.get('response')
        if out.get('answer') in (None, '') and 'final_answer' in out:
            out['answer'] = out.get('final_answer')
        if out.get('answer') in (None, '') and 'message' in out:
            out['answer'] = out.get('message')

        return out


class ToolCallRequest(BaseModel):
    """Server-side agentic tool invocation (post-MVP Phase 4)."""

    tool: Literal['summarize_page', 'extract_links', 'list_interactive']
    page_markdown: str = Field(..., min_length=1)
    query: Optional[str] = None


class ToolCallResponse(BaseModel):
    tool: str
    ok: bool = True
    result: str
    details: Optional[dict[str, Any]] = None
