# SIH26171: Browser AI Agent  -  Project Idea

**Sponsor:** ISRO | **Theme:** Smart Automation | **Prize:** ₹1,00,000

---

## The Problem

Build a browser-based AI agent (like **Comet by Perplexity**) that can complete tasks on the web for the user  -  clicking, filling forms, navigating, extracting info, etc.  -  while keeping sensitive data (passwords, emails, card numbers) from being exposed when processed by an LLM.

---

## Final Product Vision

A Chrome extension AI agent that:

1. **Sees** the page (capture + DOM)
2. **Masks** sensitive data locally with a **Transformers.js VLM** (vision + language; not WebLLM)
3. **Compresses** context via DOM → Markdown
4. **Thinks**  -  light tasks on-device (later), heavy/agentic tasks on a **Python FastAPI** server
5. **Acts** via JSON commands the extension runs on the page
6. **Remembers** via a chatbot-style session history opened from the popup (later)

Privacy invariant: raw screenshots never leave the machine; the server only gets sanitized Markdown + the task.

### Target full flow

```
User gives a task
      ↓
Capture page
      ↓
Local Transformers.js VLM masks PII
      ↓
DOM → Markdown
      ↓
Light? → local VLM    |    Heavy? → FastAPI server LLM
      ↓
JSON action(s)
      ↓
Extension executes on the page
      ↓
Logged in chatbot-style session history
```

---

## Status

### Done (MVP scaffold)

| Area | Status |
|------|--------|
| Chrome MV3 + TypeScript extension, popup task UI | Done |
| Page capture | Done |
| DOM → Markdown | Done |
| Pipeline: mask → API → execute actions | Done |
| PII masking | **Partial**  -  regex/placeholder; real VLM not wired |
| FastAPI `/agent/run` + action schemas | Done |
| Groq client (optional) + heuristic fallback | Done |
| Smoke test page + pipeline script | Done |
| Docs / root README | Done |
| Server-only reasoning after mask (MVP policy) | Done |
| Chrome-only; `frontend/` unused | Done |

### Left

| Area | Notes |
|------|--------|
| Real Transformers.js VLM masking | Done (SmolVLM + regex) |
| Local vs server routing | Done — light on-device planner, heavy → FastAPI |
| Multi-step agent loop + error handling | Done — retry, re-observe, stop conditions |
| Session history UX | Done — History page from popup |
| Model selection | Criteria in `docs/MODEL_SELECTION.md` |
| Agentic server features | Done — `POST /agent/tool` |
| Eval / edge cases | Done — `scripts/eval_suite.py` |
| `frontend/` web app | Minimal status page |
| Firefox | Notes only (`docs/FIREFOX.md`) |

---

## MVP vs full vision

**MVP (what we ship first):** always mask locally → always reason on FastAPI → execute JSON actions. No history UI, no local task routing.

**Full vision (after MVP):** same privacy pipeline, plus local VLM for easy tasks, server for hard/agentic work, and chatbot session history.

---

## Open questions

- What counts as light vs heavy for routing?
- Which Transformers.js VLM for masking (and later local reasoning)?
- Which server model is optimal under latency/cost?
- Exact multi-step / failure semantics
- What fields to store per session in history
- How we differentiate from Comet and similar agents

---

## Tech direction (locked)

- **Extension:** Chrome MV3, TypeScript
- **Local AI:** Transformers.js VLM only (not WebLLM)
- **Server:** Python FastAPI + open-weight LLM via cloud API (e.g. Groq)
- **Context path:** Capture → VLM mask → DOM → Markdown → model → JSON actions

---

*Vision is locked; remaining work is execution and polish on the items marked Left.*
