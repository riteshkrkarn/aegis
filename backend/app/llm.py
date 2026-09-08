import json
import logging
import os
import re
from typing import Any

import httpx

from .schemas import AgentAction, AgentRunResponse

logger = logging.getLogger('sih.llm')

GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'


class LlmProviderError(RuntimeError):
    """User-facing provider failure (safe to show in API responses)."""


SYSTEM_PROMPT = """You are an autonomous browser agent. Complete the user's goal through a closed loop:
intent → plan → act → observe → verify → (refine or answer).

Each request is one turn. You get a fresh observation of the page (URL + sanitized Markdown)
plus prior action results. Treat every observation as ground truth for that turn.

Return ONLY valid JSON (no markdown fences):
{
  "actions": [
    {"action":"click","selector":"CSS selector"},
    {"action":"fill","selector":"CSS selector","value":"text"},
    {"action":"scroll","amount":400},
    {"action":"navigate","url":"https://..."},
    {"action":"wait","amount":800}
  ],
  "reasoning": "intent | observation vs intent | next plan",
  "done": false,
  "answer": null
}

Turn workflow (do this mentally every turn):
1. INTENT  -  Restate what success looks like for THIS task (outcome, constraints, what would NOT count).
2. OBSERVE  -  What does the current page actually show? Quote concrete evidence from the markdown.
3. VERIFY  -  Does this page state advance or satisfy the intent?
   - Match = relevant content for the asked outcome (not merely related or adjacent content).
   - Mismatch / partial / ambiguous = do NOT finish; plan a correction.
4. PLAN  -  Choose the smallest useful next move (1–3 actions), or finish if verified.
5. ACT or ANSWER  -  Emit actions, or set done=true with answer.

Autonomy rules:
- Prefer 1–3 actions per turn, then stop so the client can re-observe and you can verify.
- Never assume an action worked  -  the next turn's markdown is the proof.
- After navigate / search / submit / sort / filter / open, the following turn MUST verify.
- Set done=true ONLY when intent is satisfied AND answer cites evidence from the CURRENT markdown.
- When done=true, answer MUST be a clear user-facing result. Never done=true with empty answer.
- answer MUST be a plain string (or null). Never an object, array, or nested JSON for answer.
- If page status shows SUBMIT_BLOCKED, PRIVACY_FAIL, or CHECKOUT_INCOMPLETE, do NOT claim payment/form success. Report the block and any [REDACTED_*] tokens you observed.
- actions may be [] when you are answering from the current page.
- If intent is not met: refine (different query, filters, navigation, open a specific item, scroll for more).
  Do not repeat the exact same failed action sequence.
- If stuck or page lacks what you need, say so in reasoning and try an alternate path  -  do not invent facts.
- Prefer structured "Product / result listings" rows (title + price) when present  - 
  they are extracted from the DOM including prices that may not appear in plain visible text.
- Prefer stable selectors from the markdown (id, name, aria-label, placeholder, role).
- After fill on a search/input, click the matching submit/control when needed.
- Use wait when the page will change. Never invent passwords/secrets. Never ask the user questions in JSON.
"""

FORCE_ANSWER_PROMPT = """This is the FINAL turn. You MUST finish now  -  no more browsing actions.

Return ONLY valid JSON:
{
  "actions": [],
  "reasoning": "intent | what the page shows | whether intent was met",
  "done": true,
  "answer": "clear user-facing result based on evidence, or an honest report of what was found and what is still missing"
}

Rules:
- actions MUST be [].
- done MUST be true.
- answer MUST be a non-empty plain string the user can read (never an object or array).
- Base the answer only on the current markdown + prior results. Do not invent missing facts.
- If the page only partially matches intent, say what matched, what did not, and the best available finding.
"""


def _heuristic_actions(task: str, page_markdown: str) -> AgentRunResponse:
    """Offline fallback when no provider API key is available."""
    lower = task.lower()
    actions: list[AgentAction] = []

    id_match = re.search(r'#([A-Za-z][\w-]*)', task)
    if 'click' in lower:
        if id_match:
            actions.append(AgentAction(action='click', selector=f'#{id_match.group(1)}'))
        elif re.search(r'submit', lower):
            if re.search(r'#submit\b', page_markdown, re.I) or 'id=submit' in page_markdown.lower():
                actions.append(AgentAction(action='click', selector='#submit'))
            else:
                actions.append(AgentAction(action='click', selector='button[type="submit"]'))
        else:
            actions.append(AgentAction(action='click', selector='button'))
    elif 'fill' in lower or 'type' in lower:
        value_match = re.search(r'["\']([^"\']+)["\']', task)
        value = value_match.group(1) if value_match else 'test'
        if id_match:
            actions.append(
                AgentAction(action='fill', selector=f'#{id_match.group(1)}', value=value)
            )
        else:
            actions.append(AgentAction(action='fill', selector='input', value=value))
    elif 'scroll' in lower:
        actions.append(AgentAction(action='scroll', amount=400))
    else:
        actions.append(AgentAction(action='wait', amount=200))

    return AgentRunResponse(
        actions=actions,
        reasoning='heuristic fallback (no LLM API key / provider)',
        done=True,
        answer='Completed with heuristic planner (no LLM key configured).',
    )


def _parse_model_json(content: str) -> dict[str, Any]:
    content = content.strip()
    fence = re.search(r'```(?:json)?\s*([\s\S]*?)```', content)
    if fence:
        content = fence.group(1).strip()
    return json.loads(content)


def _as_plain_string(value: Any) -> str | None:
    """Coerce model quirks (dict/list answers) into a readable string."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, ensure_ascii=False, indent=2)
        except (TypeError, ValueError):
            return str(value)
    if isinstance(value, (bool, int, float)):
        return str(value)
    return str(value)


def _coerce_model_payload(parsed: Any) -> dict[str, Any]:
    """Normalize LLM JSON so schema validation rarely 502s on shape drift."""
    if not isinstance(parsed, dict):
        raise ValueError('Model JSON root must be an object')

    out: dict[str, Any] = dict(parsed)

    actions = out.get('actions')
    if actions is None:
        out['actions'] = []
    elif isinstance(actions, dict):
        out['actions'] = [actions]
    elif not isinstance(actions, list):
        out['actions'] = []

    if 'answer' in out:
        out['answer'] = _as_plain_string(out.get('answer'))
    if 'reasoning' in out:
        out['reasoning'] = _as_plain_string(out.get('reasoning'))

    done = out.get('done')
    if isinstance(done, str):
        out['done'] = done.strip().lower() in {'1', 'true', 'yes', 'on'}
    elif done is None:
        out['done'] = False
    else:
        out['done'] = bool(done)

    return out


def _provider_config(model_id: str | None = None) -> tuple[str, str, str] | None:
    """Return (api_url, api_key, model) or None to use heuristics.

    UI `model_id` overrides env LLM_PROVIDER when provided.
    """
    from .models_catalog import resolve_model_choice

    # Explicit heuristic mode still wins.
    env_provider = os.getenv('LLM_PROVIDER', 'groq').strip().lower()
    if env_provider in {'heuristic', 'none', 'off'} and not model_id:
        return None

    choice = resolve_model_choice(model_id)
    provider = choice['provider']
    model = choice['model']

    if provider == 'nvidia':
        api_key = os.getenv('NVIDIA_API_KEY', '').strip()
        if not api_key:
            return None
        base = os.getenv('NVIDIA_BASE_URL', DEFAULT_NVIDIA_BASE_URL).rstrip('/')
        return f'{base}/chat/completions', api_key, model

    if provider == 'openai':
        api_key = os.getenv('OPENAI_API_KEY', '').strip()
        if not api_key:
            return None
        base = os.getenv('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
        return f'{base}/chat/completions', api_key, model

    api_key = os.getenv('GROQ_API_KEY', '').strip()
    if not api_key:
        return None
    return GROQ_API_URL, api_key, model


def _friendly_http_error(exc: httpx.HTTPStatusError, model: str) -> LlmProviderError:
    code = exc.response.status_code
    if code == 404:
        return LlmProviderError(
            f'The configured language model "{model}" was not found. '
            'Pick another model in the UI or check provider availability.'
        )
    if code == 410:
        detail = ''
        try:
            detail = str(exc.response.json().get('detail') or '')
        except Exception:
            detail = (exc.response.text or '')[:240]
        suffix = f' ({detail})' if detail else ''
        return LlmProviderError(
            f'The language model "{model}" has been retired by the provider{suffix}. '
            'Pick another model in the UI.'
        )
    if code in {401, 403}:
        return LlmProviderError('Language model API key is missing or invalid.')
    if code == 429:
        return LlmProviderError('Language model rate limit reached. Try again shortly.')
    if code >= 500:
        return LlmProviderError('Language model provider is temporarily unavailable.')
    return LlmProviderError('Language model provider returned an error. Please try again.')


def _normalize_result(
    result: AgentRunResponse,
    *,
    force_answer: bool,
) -> AgentRunResponse:
    """Enforce done⇔answer consistency for the agent loop."""
    answer = (result.answer or '').strip() or None
    result.answer = answer

    if force_answer:
        result.actions = []
        result.done = True
        if not result.answer:
            result.answer = (result.reasoning or '').strip() or (
                'Could not determine a reliable answer from the current page.'
            )
        return result

    if result.done and not result.answer:
        # Incomplete finish  -  keep the loop going.
        result.done = False
        result.reasoning = (
            (result.reasoning or '')
            + ' | incomplete: done without answer; continue verify/refine'
        ).strip(' |')
    elif result.answer and not result.done and not result.actions:
        # Answer-only response counts as finished.
        result.done = True

    if not force_answer:
        result.actions = result.actions[:3]
    return result


async def plan_actions(
    task: str,
    page_markdown: str,
    page_url: str,
    step_index: int = 0,
    prior_results: list[str] | None = None,
    prior_reasoning: str = '',
    model_id: str | None = None,
    force_answer: bool = False,
) -> AgentRunResponse:
    config = _provider_config(model_id)
    if config is None:
        logger.info('plan_actions using heuristic fallback (no provider/key)')
        return _heuristic_actions(task, page_markdown)

    api_url, api_key, model = config
    logger.info(
        'plan_actions provider_call model=%s choice=%s step=%s force_answer=%s url=%s',
        model,
        model_id or 'default',
        step_index,
        force_answer,
        api_url,
    )

    prior = prior_results or []
    system = FORCE_ANSWER_PROMPT if force_answer else SYSTEM_PROMPT
    turn_focus = (
        'FINALIZE: intent was met or time is up  -  answer from evidence only.'
        if force_answer
        else (
            'First turn: infer intent, inspect the page, plan the first useful actions.'
            if step_index == 0
            else (
                'VERIFY turn: compare this fresh observation to the user intent. '
                'If mismatched or incomplete, refine the plan; if satisfied, answer with evidence.'
            )
        )
    )
    user_content = (
        f'Turn focus: {turn_focus}\n'
        f'Page URL: {page_url}\n'
        f'Step index: {step_index}\n'
        f'User task: {task}\n'
        f'Prior reasoning: {prior_reasoning or "(none)"}\n'
        f'Prior action results:\n'
        + ('\n'.join(f'- {r}' for r in prior[-16:]) if prior else '- (none)')
        + '\n\nFresh page observation (Markdown). '
        'Use it to verify progress toward intent before acting or finishing:\n'
        + page_markdown[:14000]
    )
    if force_answer:
        user_content += (
            '\n\nFINAL TURN: produce done=true and a non-empty answer from this observation.'
        )

    payload: dict[str, Any] = {
        'model': model,
        'temperature': 0.2,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user_content},
        ],
    }
    # Structured JSON works on OpenAI + Groq; NVIDIA may ignore unknown fields.
    if 'openai.com' in api_url or 'groq.com' in api_url:
        payload['response_format'] = {'type': 'json_object'}

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                api_url,
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json',
                },
                json=payload,
            )
            if not response.is_success:
                body_preview = (response.text or '')[:500]
                logger.error(
                    'plan_actions http_error status=%s model=%s body=%r',
                    response.status_code,
                    model,
                    body_preview,
                )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        raise _friendly_http_error(exc, model) from exc
    except httpx.TimeoutException as exc:
        logger.error('plan_actions timeout model=%s', model)
        raise LlmProviderError('Language model request timed out. Please try again.') from exc
    except httpx.RequestError as exc:
        logger.error('plan_actions request_error model=%s err=%s', model, exc)
        raise LlmProviderError('Could not reach the language model provider.') from exc

    try:
        content = data['choices'][0]['message']['content']
        parsed = _coerce_model_payload(_parse_model_json(content))
        result = _normalize_result(
            AgentRunResponse.model_validate(parsed),
            force_answer=force_answer,
        )
        logger.info(
            'plan_actions parsed_ok actions=%d done=%s answer=%r',
            len(result.actions),
            result.done,
            (result.answer or '')[:160],
        )
        return result
    except Exception as exc:
        # Includes pydantic ValidationError, KeyError, JSON errors, etc.
        logger.exception(
            'plan_actions parse_error content_preview=%r',
            str(data.get('choices', data))[:400] if isinstance(data, dict) else str(data)[:400],
        )
        raise LlmProviderError(
            'The language model returned an unexpected response. Please try again.'
        ) from exc
