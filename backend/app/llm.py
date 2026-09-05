import json
import os
import re
from typing import Any

import httpx

from .schemas import AgentAction, AgentRunResponse

GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'


SYSTEM_PROMPT = """You are a browser automation agent.
Given a user task and a sanitized Markdown description of the page, return JSON only.
Schema:
{
  "actions": [
    {"action":"click","selector":"CSS selector"},
    {"action":"fill","selector":"CSS selector","value":"text"},
    {"action":"scroll","amount":400},
    {"action":"navigate","url":"https://..."},
    {"action":"wait","amount":500}
  ],
  "reasoning": "brief why"
}
Rules:
- Prefer stable selectors from the markdown (id, name, aria).
- Never ask for or invent passwords or secrets.
- Return at most 5 actions for this step.
- Output valid JSON only, no markdown fences.
"""


def _heuristic_actions(task: str, page_markdown: str) -> AgentRunResponse:
    """Offline fallback when GROQ_API_KEY is missing — keeps local smoke tests working."""
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
        reasoning='heuristic fallback (no GROQ_API_KEY)',
    )


def _parse_model_json(content: str) -> dict[str, Any]:
    content = content.strip()
    fence = re.search(r'```(?:json)?\s*([\s\S]*?)```', content)
    if fence:
        content = fence.group(1).strip()
    return json.loads(content)


async def plan_actions(task: str, page_markdown: str, page_url: str) -> AgentRunResponse:
    api_key = os.getenv('GROQ_API_KEY', '').strip()
    model = os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile')

    if not api_key:
        return _heuristic_actions(task, page_markdown)

    user_content = (
        f'Page URL: {page_url}\n\n'
        f'User task: {task}\n\n'
        f'Page markdown:\n{page_markdown[:12000]}'
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            GROQ_API_URL,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            json={
                'model': model,
                'temperature': 0.2,
                'response_format': {'type': 'json_object'},
                'messages': [
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': user_content},
                ],
            },
        )
        response.raise_for_status()
        data = response.json()

    content = data['choices'][0]['message']['content']
    parsed = _parse_model_json(content)
    return AgentRunResponse.model_validate(parsed)
