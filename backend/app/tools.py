"""Server-side agentic helpers (post-MVP Phase 4).

These tools operate only on client-sanitized markdown — never on screenshots.
"""
from __future__ import annotations

import re
from typing import Any


def summarize_page(page_markdown: str, query: str | None = None) -> tuple[str, dict[str, Any]]:
    lines = [ln.strip() for ln in page_markdown.splitlines() if ln.strip()]
    headings = [ln for ln in lines if ln.startswith('#')]
    interactive = [ln for ln in lines if 'selector=' in ln.lower() or ln.startswith('- ')]
    preview = '\n'.join(lines[:24])
    focus = ''
    if query:
        q = query.lower()
        hits = [ln for ln in lines if q in ln.lower()][:8]
        focus = '\n'.join(hits) if hits else f'(no lines matched query {query!r})'
    summary = (
        f'Headings ({len(headings)}): ' + '; '.join(headings[:6]) + '\n'
        f'Interactive-ish lines: {len(interactive)}\n'
        f'Preview:\n{preview}'
    )
    if focus:
        summary += f'\n\nQuery hits:\n{focus}'
    return summary, {
        'heading_count': len(headings),
        'interactive_lines': len(interactive),
        'line_count': len(lines),
    }


def extract_links(page_markdown: str) -> tuple[str, dict[str, Any]]:
    urls = re.findall(r'https?://[^\s)\]>"\']+', page_markdown)
    # Also markdown links [text](url)
    urls += re.findall(r'\[[^\]]+\]\((https?://[^)]+)\)', page_markdown)
    unique: list[str] = []
    seen: set[str] = set()
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique.append(u)
    text = '\n'.join(unique) if unique else '(no links found)'
    return text, {'count': len(unique), 'links': unique[:50]}


def list_interactive(page_markdown: str) -> tuple[str, dict[str, Any]]:
    rows: list[str] = []
    for ln in page_markdown.splitlines():
        if 'selector=' in ln.lower():
            rows.append(ln.strip())
    text = '\n'.join(rows[:40]) if rows else '(no interactive selector rows found)'
    return text, {'count': len(rows), 'rows': rows[:40]}


def run_tool(tool: str, page_markdown: str, query: str | None = None) -> tuple[str, dict[str, Any]]:
    if tool == 'summarize_page':
        return summarize_page(page_markdown, query)
    if tool == 'extract_links':
        return extract_links(page_markdown)
    if tool == 'list_interactive':
        return list_interactive(page_markdown)
    raise ValueError(f'unknown tool: {tool}')
