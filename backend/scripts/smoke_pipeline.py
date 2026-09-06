"""Simulate the MVP client→server contract after local masking."""
from __future__ import annotations

import re
import sys

import httpx

API = "http://127.0.0.1:8001"


def mask_pii(text: str) -> str:
    text = re.sub(
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
        "[REDACTED_EMAIL]",
        text,
    )
    text = re.sub(r"\b(?:\d[ -]*?){13,19}\b", "[REDACTED_CARD]", text)
    return text


def main() -> int:
    health = httpx.get(f"{API}/health", timeout=5.0)
    health.raise_for_status()
    assert health.json()["status"] == "ok"

    raw_md = """# Smoke test page
URL: http://127.0.0.1:8765/smoke.html

## Interactive elements
- button#submit | type=submit | selector=#submit
- input#email | type=email | selector=#email

## Visible text
Email for masking check: user@example.com
Card sample: 4111 1111 1111 1111
"""
    masked = mask_pii(raw_md)
    assert "user@example.com" not in masked
    assert "[REDACTED_EMAIL]" in masked
    assert "[REDACTED_CARD]" in masked

    res = httpx.post(
        f"{API}/agent/run",
        json={
            "task": "Click the submit button",
            "page_markdown": masked,
            "page_url": "http://127.0.0.1:8765/smoke.html",
        },
        timeout=30.0,
    )
    res.raise_for_status()
    data = res.json()
    actions = data.get("actions") or []
    assert actions, f"expected actions, got {data}"
    assert actions[0]["action"] == "click"
    assert actions[0]["selector"] in {"#submit", 'button[type="submit"]'}
    print("SMOKE OK:", data)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print("SMOKE FAIL:", exc, file=sys.stderr)
        raise SystemExit(1) from exc
