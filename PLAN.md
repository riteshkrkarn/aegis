## Final Product Vision

A Chrome browser extension that acts as a privacy-first AI agent (similar in spirit to Comet). It completes web tasks for the user — click, fill, scroll, navigate, extract — while keeping sensitive data off the wire.

**End-state flow:**
1. Capture the page (screenshot for vision)
2. Local **Transformers.js VLM** masks PII (passwords, emails, cards, faces, etc.)
3. Convert DOM → Markdown for fast, clean context
4. Decide routing: light tasks → local VLM; heavy / agentic tasks → FastAPI server LLM
5. Model returns structured JSON actions
6. Extension executes actions on the page
7. Sessions live in a chatbot-style history UI opened from the popup

**Hard rule:** the server never sees raw screen pixels — only sanitized Markdown + the user task.

**Stack (locked):**
- Client: Chrome MV3, TypeScript, Transformers.js VLM (not WebLLM)
- Server: Python FastAPI + open-weight LLM via cloud API (e.g. Groq)
- `frontend/` reserved for a later web surface; unused now

---

## MVP slice (current target)

For the first working product, **all** reasoning goes to the server after local masking. Local-vs-server routing and session history come after.

```
User task
  → Capture page
  → Local PII mask (VLM; placeholder until model wired)
  → DOM → Markdown
  → FastAPI server LLM
  → JSON action(s)
  → Extension executes
```

---

## Status

### Done
- [x] Product docs aligned to locked vision (`PLAN.md`, `roughIdea.md`, root `README.md`)
- [x] Chrome MV3 TypeScript extension scaffold (Vite + CRXJS), popup with task input + Run
- [x] Page capture (`chrome.tabs.captureVisibleTab`)
- [x] DOM → Markdown converter (content script)
- [x] PII mask **pipeline hook** with regex/placeholder redaction (Transformers.js dependency present; real VLM inference not wired yet)
- [x] API client → `POST /agent/run` with sanitized markdown + task (no screenshot upload)
- [x] Action executor (`click`, `fill`, `scroll`, `navigate`, `wait`)
- [x] FastAPI backend: `/health`, `/agent/run`, CORS, Pydantic action schemas
- [x] Groq LLM client + heuristic fallback when `GROQ_API_KEY` is missing
- [x] Local smoke page + `scripts/smoke_pipeline.py`
- [x] Chrome-only; `frontend/` left untouched

### Left
- [x] Wire a real **Transformers.js VLM** for screenshot-aware PII masking (SmolVLM-256M in offscreen; regex fallback remains)
- [ ] Harden JSON action schema, multi-step loops, and error recovery
- [ ] Easy vs difficult **routing** (local VLM vs server) — criteria TBD
- [ ] Session history UX: popup → chatbot-style page with all past sessions
- [ ] Choose / evaluate optimal local VLM + server model
- [ ] Richer agentic server workflows (tools, planning loops) on FastAPI
- [ ] Eval set / edge-case suite for correctness
- [ ] Optional `frontend/` web app
- [ ] Firefox (if ever required)

---

## Architecture (reference)

**Client**
- Capture, local VLM mask, DOM→MD, action execution
- Later: local reasoning for light tasks via the same Transformers.js VLM runtime

**Server**
- Receives sanitized Markdown + task only
- Returns `{ "action": "click", "selector": "#submit" }`-style commands
- FastAPI chosen for future agentic tooling

## Feasibility notes
- Transformers.js VLMs in-browser are proven but latency-sensitive — keep models small
- MVP always offloads reasoning to the server after masking to ship sooner
- Main challenge remains mask quality vs speed on-device
