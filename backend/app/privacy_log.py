"""Demo privacy logger: terminal + file (for showing in the editor)."""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger('sih.privacy')

_LOG_DIR = Path(__file__).resolve().parents[1] / 'logs'
_LOG_FILE = _LOG_DIR / 'privacy-demo.log'


def debug_enabled() -> bool:
    # Re-read .env so flipping DEBUG=1 is picked up without a full process restart.
    load_dotenv(override=True)
    return os.getenv('DEBUG', '').strip().lower() in {'1', 'true', 'yes', 'on'}


def log_privacy_audit(
    *,
    step_index: int,
    page_url: str,
    mask_method: str | None,
    before_markdown: str | None,
    after_markdown: str,
) -> None:
    """Log before/after masking when DEBUG=1. Never used for LLM planning."""
    after = after_markdown or ''
    before = before_markdown or ''
    method = mask_method or 'unknown'
    redacted_hits = len(re.findall(r'\[REDACTED_[A-Z0-9_]+\]', after))
    dbg = debug_enabled()

    # Always emit a one-line summary so demos are not silent when DEBUG is stale.
    logger.info(
        'privacy.summary step=%s mask=%s before_chars=%d after_chars=%d '
        'redacted_tokens=%d debug=%s',
        step_index,
        method,
        len(before),
        len(after),
        redacted_hits,
        dbg,
    )

    if not dbg:
        logger.info(
            'privacy.audit skipped  -  set DEBUG=1 in backend/.env to print BEFORE/AFTER',
        )
        return

    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')

    block = (
        f'\n{"=" * 72}\n'
        f'PRIVACY AUDIT  {stamp}\n'
        f'step={step_index}  mask={method}  url={page_url}\n'
        f'before_chars={len(before)}  after_chars={len(after)}  '
        f'redacted_tokens={redacted_hits}\n'
        f'{"-" * 72}\n'
        f'BEFORE (client pre-mask  -  demo only; not used by LLM)\n'
        f'{"-" * 72}\n'
        f'{before or "(not provided  -  rebuild/reload the extension)"}\n'
        f'{"-" * 72}\n'
        f'AFTER (what /agent/run received  -  sanitized markdown for LLM)\n'
        f'{"-" * 72}\n'
        f'{after}\n'
        f'{"=" * 72}\n'
    )

    logger.info('%s', block)

    try:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        with _LOG_FILE.open('a', encoding='utf-8') as fh:
            fh.write(block)
        logger.info('privacy audit also written to %s', _LOG_FILE)
    except OSError as exc:
        logger.warning('could not write privacy-demo.log: %s', exc)
