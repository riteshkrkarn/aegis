"""Edge-case / correctness fixtures beyond smoke_pipeline.

Covers: masking expectations, action schema normalization, server tools,
and light-vs-heavy routing heuristics (mirrored from the extension).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.schemas import AgentAction, AgentRunResponse  # noqa: E402
from app.tools import run_tool  # noqa: E402
from app.llm import _coerce_model_payload, _normalize_result  # noqa: E402

API = 'http://127.0.0.1:8001'


def mask_pii(text: str) -> str:
    text = re.sub(
        r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
        '[REDACTED_EMAIL]',
        text,
    )
    text = re.sub(r'\b(?:\d[ -]*?){13,19}\b', '[REDACTED_CARD]', text)
    text = re.sub(
        r'\b(?:\+?\d[\d\s().-]{8,}\d)\b',
        '[REDACTED_PHONE]',
        text,
    )
    return text


def classify_task_difficulty(task: str, page_markdown: str) -> str:
    """Mirror of extension/src/lib/routing.ts (keep in sync)."""
    t = task.strip()
    if not t:
        return 'heavy'
    if len(t) > 120 or len(re.findall(r'\band\b', t, flags=re.I)) >= 2:
        return 'heavy'
    heavy = re.search(
        r'\b(fill|form|payment|checkout|login|password|multi[- ]?step|navigate|search|find|compare|book|order|submit|sign\s*up|register)\b',
        t,
        flags=re.I,
    )
    light = re.search(
        r'^(click|scroll|wait|press|tap)\b|\b(click|scroll)\s+(the\s+)?(submit|#|button|link)',
        t,
        flags=re.I,
    )
    if heavy and not light:
        return 'heavy'
    if light:
        id_match = re.search(r'#([A-Za-z][\w-]*)', t)
        if id_match and f'#{id_match.group(1)}' in page_markdown:
            return 'light'
        if re.search(r'\bscroll\b', t, flags=re.I):
            return 'light'
        if re.search(r'\bsubmit\b', t, flags=re.I) and re.search(
            r'selector=#submit|#submit\b', page_markdown, flags=re.I
        ):
            return 'light'
        if (
            re.search(r'\bclick\b', t, flags=re.I)
            and re.search(r'selector=#', page_markdown, flags=re.I)
            and len(t) < 80
        ):
            return 'light'
    if (
        len(t) < 90
        and re.search(r'\b(what|who|which|how much|status|show|read|tell me)\b', t, flags=re.I)
        and not re.search(r'\b(click|fill|type|navigate|submit|open)\b', t, flags=re.I)
    ):
        return 'light'
    return 'heavy'


def test_masking() -> None:
    raw = 'Email user@example.com card 4111 1111 1111 1111 phone +91 98765 43210'
    masked = mask_pii(raw)
    assert 'user@example.com' not in masked
    assert '4111' not in masked or '[REDACTED_CARD]' in masked
    assert '[REDACTED_EMAIL]' in masked
    print('  masking OK')


def test_schema_aliases() -> None:
    payload = _coerce_model_payload(
        {
            'actions': [
                {'type': 'click', 'selector': '#submit'},
                {'action': 'button'},  # invalid → dropped
                {'action': 'fill', 'selector': '#email', 'text': 'a@b.co'},
            ],
            'finished': True,
            'final_answer': 'Payment blocked',
        }
    )
    result = _normalize_result(
        AgentRunResponse.model_validate(payload),
        force_answer=False,
    )
    assert result.done is True
    assert result.answer == 'Payment blocked'
    assert len(result.actions) == 2
    assert result.actions[0].action == 'click'
    assert result.actions[1].value == 'a@b.co'

    # Vague selector rejected at AgentAction level
    try:
        AgentAction.model_validate({'action': 'click', 'selector': 'button'})
        raise AssertionError('expected vague selector to fail')
    except Exception:
        pass
    print('  schema OK')


def test_tools() -> None:
    md = """# Demo
## Interactive elements
- button#submit | selector=#submit
Link https://example.com/path
"""
    summary, details = run_tool('summarize_page', md, query='submit')
    assert 'Headings' in summary
    assert details['heading_count'] >= 1
    links, link_details = run_tool('extract_links', md)
    assert 'https://example.com/path' in links
    assert link_details['count'] >= 1
    interactive, _ = run_tool('list_interactive', md)
    assert '#submit' in interactive
    print('  tools OK')


def test_routing() -> None:
    md = 'selector=#submit\nselector=#email'
    assert classify_task_difficulty('Click the submit button', md) == 'light'
    assert classify_task_difficulty('Scroll down', md) == 'light'
    assert (
        classify_task_difficulty(
            'Fill the billing form with name email phone and submit payment',
            md,
        )
        == 'heavy'
    )
    print('  routing OK')


def test_api_live() -> None:
    try:
        health = httpx.get(f'{API}/health', timeout=5.0)
    except httpx.HTTPError as exc:
        print(f'  api live SKIPPED (backend unreachable: {exc})')
        return
    health.raise_for_status()
    assert health.json()['status'] == 'ok'

    masked = mask_pii(
        '# Page\n## Interactive\n- button#submit | selector=#submit\n'
        'Email user@example.com\n'
    )
    res = httpx.post(
        f'{API}/agent/run',
        json={
            'task': 'Click the submit button',
            'page_markdown': masked,
            'page_url': 'http://127.0.0.1:8765/smoke.html',
        },
        timeout=30.0,
    )
    res.raise_for_status()
    data = res.json()
    assert data.get('actions'), data

    tool = httpx.post(
        f'{API}/agent/tool',
        json={'tool': 'list_interactive', 'page_markdown': masked},
        timeout=10.0,
    )
    tool.raise_for_status()
    assert tool.json()['ok'] is True
    print('  api live OK')


def main() -> int:
    print('EVAL suite')
    test_masking()
    test_schema_aliases()
    test_tools()
    test_routing()
    test_api_live()
    print('EVAL OK')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print('EVAL FAIL:', exc, file=sys.stderr)
        raise SystemExit(1) from exc
