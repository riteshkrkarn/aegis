## Our Understanding
A Chrome browser extension that acts as an intelligent agent. It captures the page, masks sensitive data locally with a Transformers.js VLM, converts the DOM to Markdown, then sends only sanitized context to the server. The server never sees raw screen data. The extension executes structured action commands returned by the server.

- Client handles: page capture, PII detection/redaction (Transformers.js VLM), DOM → Markdown, action execution
- Server handles: all task reasoning (MVP), returning action commands (click, scroll, fill)

## MVP Flow
Page is captured locally → Transformers.js VLM masks PII → HTML/DOM converted to Markdown → sanitized Markdown + user task sent to FastAPI server → server LLM returns structured JSON action(s) → extension executes them on the page.

```
User gives a task
      ↓
Capture page (screenshot for VLM)
      ↓
Local Transformers.js VLM masks PII
      ↓
DOM → Markdown (lightweight context)
      ↓
All tasks → FastAPI server LLM
      ↓
JSON action(s) returned
      ↓
Extension executes on the page
```

## Architecture

**Client side (Chrome MV3, TypeScript):**
- Page capture via Chrome extension APIs
- Local VLM via Transformers.js for PII masking (vision + language in one runtime)
- DOM → Markdown conversion for faster, cleaner LLM context
- Action executor for commands returned by the server

**Server side (Python FastAPI):**
- Receives sanitized Markdown + task (never raw screenshots in the MVP contract)
- Processes with an open-weight LLM via cloud API (e.g. Groq)
- Returns structured actions like `{ "action": "click", "selector": "#submit" }`
- Chosen for future agentic workflows

## Tech Stack (MVP)
Chrome Extension (MV3), TypeScript, Transformers.js (VLM), Canvas API, DOM APIs, Python FastAPI, open-weight LLM via cloud API (Groq)

## Out of MVP / Later
- Easy vs difficult routing: local VLM for light tasks vs server for heavy tasks (decision deferred)
- Session history: popup opens a chatbot-style page listing all sessions
- `frontend/` web app (folder left unused for now)
- Firefox support
- WebLLM is not used — Transformers.js VLMs cover vision and language locally when we add local reasoning later

## Feasibility

**What's proven:**
- Running VLMs in browser via Transformers.js is established
- Browser extensions can capture pages and manipulate DOM reliably
- Open-weight LLMs are available via cloud APIs
- FastAPI is a solid base for agentic server workflows

**Main challenge:**
Balancing local VLM masking latency vs accuracy. Keep the local model small; MVP always offloads reasoning to the server after masking.
