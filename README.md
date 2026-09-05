# SIH26171 — Browser AI Agent

Privacy-first Chrome extension that completes web tasks for you. Sensitive data is masked locally before anything reaches the server; the server returns JSON actions the extension executes on the page.

**Sponsor:** ISRO · **Theme:** Smart Automation

## How it works (MVP)

```
User task
  → Capture page
  → Local PII mask (Transformers.js VLM; placeholder until model is wired)
  → DOM → Markdown
  → FastAPI server (all reasoning in MVP)
  → JSON actions (click / fill / scroll / …)
  → Extension executes on the page
```

The server never receives raw screenshots — only sanitized Markdown + the user task.

## Repo layout

| Path | Role |
|------|------|
| [`extension/`](extension/) | Chrome MV3 TypeScript extension |
| [`backend/`](backend/) | Python FastAPI agent API |
| [`frontend/`](frontend/) | Unused for now |
| [`PLAN.md`](PLAN.md) | Architecture notes |
| [`roughIdea.md`](roughIdea.md) | Product / MVP notes |

## Prerequisites

- Node.js 18+ and npm
- Python 3.11+
- Google Chrome

## Quick start

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- Health: `http://127.0.0.1:8000/health`
- Agent: `POST http://127.0.0.1:8000/agent/run`

Optional: set `GROQ_API_KEY` in `backend/.env` for real LLM planning. Without it, a heuristic planner is used for local smoke tests.

### 2. Extension

```bash
cd extension
npm install
npm run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `extension/dist`

### 3. Try it

1. Keep the API running on port `8000`
2. Serve the smoke page (optional):

   ```bash
   cd backend
   python -m http.server 8765 --directory test_pages
   ```

3. Open `http://127.0.0.1:8765/smoke.html`
4. Open the extension popup, enter e.g. `Click the submit button`, click **Run**

API-only smoke (no Chrome):

```bash
cd backend
.\.venv\Scripts\python scripts\smoke_pipeline.py
```

## Tech stack

- **Extension:** Chrome MV3, TypeScript, Vite, Transformers.js (VLM masking)
- **Backend:** FastAPI, Pydantic, Groq-compatible OpenAI chat API (or heuristic fallback)

## Later (not in MVP)

- Easy vs difficult routing (local VLM vs server)
- Session history via popup → chatbot-style page
- `frontend/` web app
- Firefox

## Docs

- [extension/README.md](extension/README.md) — extension build & pipeline
- [backend/README.md](backend/README.md) — API setup
- [PLAN.md](PLAN.md) · [roughIdea.md](roughIdea.md)
