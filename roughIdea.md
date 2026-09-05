# SIH26171: Browser AI Agent — Project Idea

**Sponsor:** ISRO | **Theme:** Smart Automation | **Prize:** ₹1,00,000

---

## The Problem

Build a browser-based AI agent (like **Comet by Perplexity**) that can complete tasks on the web for the user — clicking, filling forms, navigating, extracting info, etc. — while keeping sensitive data (passwords, emails, card numbers) from being exposed when processed by an LLM.

---

## MVP Plan (Current)

### 1. Capture + Local PII Masking
- Capture the page (screenshot for the local VLM)
- Use a **Transformers.js VLM** to detect and mask sensitive data locally
- Server never receives raw screen pixels

### 2. DOM → Markdown
- Convert the page DOM into clean Markdown after masking
- Keeps context lightweight and easier for the server LLM to reason about

### 3. Server-Only Reasoning (MVP)
- **All** tasks go to the **Python FastAPI** backend after local masking
- Server uses an open-weight LLM via cloud API and returns JSON actions
- Easy vs difficult / local vs server routing comes **later**

### 4. Output = JSON Actions
- Server responds with JSON describing actions (click, fill, scroll, etc.)
- The Chrome extension executes them on the page

### 5. Chrome Only
- MVP targets Chrome (MV3) only
- `frontend/` is unused for now

---

## Basic Flow (MVP)

```
User gives a task
      ↓
Capture page
      ↓
Local Transformers.js VLM masks PII
      ↓
DOM → Markdown
      ↓
FastAPI server LLM decides
      ↓
JSON action(s)
      ↓
Extension performs the action on the page
```

---

## Later (Not in MVP)

### Session history UX
- Popup opens a chatbot-style page with all past sessions
- Not built in MVP (no history click-up yet)

### Local vs server routing
- Light tasks may run on local Transformers.js VLM
- Heavy / agentic tasks stay on the FastAPI server
- Criteria for easy vs difficult still TBD

### Other
- Firefox support
- Separate `frontend/` web app

---

## Open Questions (To Figure Out As We Build)

- What counts as "light" vs "heavy" when we add local routing?
- Which Transformers.js VLM for masking (and later local reasoning)?
- Which server-side open-weight model is optimal?
- Exact JSON action schema and multi-step / error handling
- What to store in session history when we add it
- Edge cases / eval set for correctness
- Differentiation vs existing agents (e.g. Comet)

---

## Tech Direction (MVP Locked)

- **Extension:** Chrome MV3, TypeScript
- **Local AI:** Transformers.js VLM (masking now; optional local reasoning later) — not WebLLM
- **Server:** Python FastAPI + open-weight LLM via cloud API (e.g. Groq)
- **Context:** Capture + VLM mask + DOM → Markdown

---

*Details will evolve as we build and test.*
