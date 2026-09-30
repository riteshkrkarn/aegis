import json
import logging
import os
import re
from typing import Any

import httpx

from .schemas import AgentAction, AgentRunResponse, normalize_action_type

logger = logging.getLogger('sih.llm')

JSON_REPAIR_PROMPT = """Your previous reply was not valid agent JSON. Reply again with ONLY a JSON object:
{"actions":[...],"reasoning":"...","done":false,"answer":null}
No markdown fences. Prefer 0–3 valid actions (click/fill/scroll/navigate/wait)."""

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
- Some field values appear as [FIELD:category#xxxx] (e.g. [FIELD:phone#a1c9]) instead of the real value. This is expected and NOT an error: it is a real, already-filled value the client is holding for you so it never has to leave the device. Treat it exactly like any other value — reference it, put it in a fill action's value for the SAME or a different field the task requires, or copy it verbatim. Never try to decode, guess, invent, or replace it with a "real-looking" value, and never refuse a fill because the value looks like a placeholder.
- actions may be [] when you are answering from the current page.
- If intent is not met: refine (different query, filters, navigation, open a specific item, scroll for more).
  Do not repeat the exact same failed action sequence.
- If stuck or page lacks what you need, say so in reasoning and try an alternate path  -  do not invent facts.
- Prefer structured "Product / result listings" rows (title + price) when present  - 
  they are extracted from the DOM including prices that may not appear in plain visible text.
- Prefer stable selectors from the markdown (id, name, aria-label, placeholder).
- Copy the exact `selector=` value from an Interactive elements row. Those values are executable
  (including `tag:nth-of-type-hint(N)` index hints). Do NOT invent vague selectors like
  `button`, `button[type=button]`, or `a` — they match the wrong control or none.
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
            # Prefer an id from the markdown interactive list over a bare tag.
            md_id = re.search(r'selector=(#[A-Za-z][\w-]*)', page_markdown)
            if md_id:
                actions.append(AgentAction(action='click', selector=md_id.group(1)))
            else:
                actions.append(AgentAction(action='wait', amount=200))
    elif 'fill' in lower or 'type' in lower:
        value_match = re.search(r'["\']([^"\']+)["\']', task)
        value = value_match.group(1) if value_match else 'test'
        if id_match:
            actions.append(
                AgentAction(action='fill', selector=f'#{id_match.group(1)}', value=value)
            )
        else:
            md_input = re.search(r'selector=(#[A-Za-z][\w-]*)', page_markdown)
            if md_input:
                actions.append(AgentAction(action='fill', selector=md_input.group(1), value=value))
            else:
                actions.append(AgentAction(action='wait', amount=200))
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


def _sanitize_action_dict(raw: Any) -> dict[str, Any] | None:
    """Normalize one action dict; return None if it cannot be made valid."""
    if not isinstance(raw, dict):
        return None
    action_raw = raw.get('action') or raw.get('type') or raw.get('name')
    action = normalize_action_type(action_raw)
    if action is None:
        return None

    # Terminal pseudo-actions belong in done/answer, not the actions list.
    if isinstance(action_raw, str) and action_raw.strip().lower() in {
        'done',
        'answer',
        'finish',
        'complete',
    }:
        return None

    item: dict[str, Any] = {'action': action}
    selector = raw.get('selector') or raw.get('css') or raw.get('target')
    if isinstance(selector, str) and selector.strip():
        item['selector'] = selector.strip()
    value = raw.get('value')
    if value is None:
        value = raw.get('text')
    if value is not None:
        item['value'] = value if isinstance(value, str) else str(value)
    url = raw.get('url') or raw.get('href')
    if isinstance(url, str) and url.strip():
        item['url'] = url.strip()
    amount = raw.get('amount')
    if amount is None:
        amount = raw.get('ms') or raw.get('pixels') or raw.get('y')
    if amount is not None:
        try:
            item['amount'] = float(amount)
        except (TypeError, ValueError):
            pass
    return item


def _coerce_actions_list(actions: Any) -> list[dict[str, Any]]:
    if actions is None:
        return []
    if isinstance(actions, dict):
        actions = [actions]
    if not isinstance(actions, list):
        return []
    out: list[dict[str, Any]] = []
    for raw in actions:
        item = _sanitize_action_dict(raw)
        if item is None:
            continue
        try:
            validated = AgentAction.model_validate(item)
            out.append(validated.model_dump(exclude_none=True))
        except Exception:
            # Drop invalid actions rather than failing the whole turn.
            logger.info('dropping invalid action: %r', item)
            continue
    return out


def _coerce_model_payload(parsed: Any) -> dict[str, Any]:
    """Normalize LLM JSON so schema validation rarely 502s on shape drift."""
    if not isinstance(parsed, dict):
        raise ValueError('Model JSON root must be an object')

    out: dict[str, Any] = dict(parsed)

    out['actions'] = _coerce_actions_list(out.get('actions'))

    if 'answer' in out or 'response' in out or 'final_answer' in out or 'message' in out:
        answer = out.get('answer')
        if answer in (None, ''):
            answer = out.get('response') or out.get('final_answer') or out.get('message')
        out['answer'] = _as_plain_string(answer)
    if 'reasoning' in out:
        out['reasoning'] = _as_plain_string(out.get('reasoning'))

    done = out.get('done')
    if done is None:
        for key in ('finished', 'complete', 'is_done', 'task_complete'):
            if key in out:
                done = out[key]
                break
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

    async def _chat_once(messages: list[dict[str, str]]) -> dict[str, Any]:
        body = {**payload, 'messages': messages}
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(
                    api_url,
                    headers={
                        'Authorization': f'Bearer {api_key}',
                        'Content-Type': 'application/json',
                    },
                    json=body,
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
                return response.json()
        except httpx.HTTPStatusError as exc:
            raise _friendly_http_error(exc, model) from exc
        except httpx.TimeoutException as exc:
            logger.error('plan_actions timeout model=%s', model)
            raise LlmProviderError('Language model request timed out. Please try again.') from exc
        except httpx.RequestError as exc:
            logger.error('plan_actions request_error model=%s err=%s', model, exc)
            raise LlmProviderError('Could not reach the language model provider.') from exc

    messages: list[dict[str, str]] = [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': user_content},
    ]

    data = await _chat_once(messages)
    last_error: Exception | None = None

    for attempt in range(2):
        try:
            content = data['choices'][0]['message']['content']
            parsed = _coerce_model_payload(_parse_model_json(content))
            result = _normalize_result(
                AgentRunResponse.model_validate(parsed),
                force_answer=force_answer,
            )
            logger.info(
                'plan_actions parsed_ok attempt=%d actions=%d done=%s answer=%r',
                attempt + 1,
                len(result.actions),
                result.done,
                (result.answer or '')[:160],
            )
            return result
        except Exception as exc:
            last_error = exc
            logger.warning(
                'plan_actions parse_error attempt=%d preview=%r',
                attempt + 1,
                str(data.get('choices', data))[:400] if isinstance(data, dict) else str(data)[:400],
            )
            if attempt == 0:
                # One repair retry with a short corrective prompt.
                bad = ''
                try:
                    bad = str(data['choices'][0]['message']['content'])[:1200]
                except Exception:
                    bad = ''
                repair_messages = [
                    *messages,
                    {'role': 'assistant', 'content': bad or '{"actions":[]}'},
                    {'role': 'user', 'content': JSON_REPAIR_PROMPT},
                ]
                data = await _chat_once(repair_messages)
                continue
            break

    logger.exception('plan_actions parse_failed_after_retry')
    raise LlmProviderError(
        'The language model returned an unexpected response. Please try again.'
    ) from last_error
