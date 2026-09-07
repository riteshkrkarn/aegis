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
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

- Health: `http://127.0.0.1:8001/health`
- Agent: `POST http://127.0.0.1:8001/agent/run`

Optional: set `GROQ_API_KEY` in `backend/.env` for real LLM planning (`LLM_PROVIDER=groq`). Use `LLM_PROVIDER=nvidia` with `NVIDIA_API_KEY` for NVIDIA NIM. Without a matching key, a heuristic planner is used for local smoke tests.

### 2. Extension (build)

```bash
cd extension
npm install
npm run build
```

This writes the loadable extension into `extension/dist`.

### 3. Run in Chrome (browser steps)

1. **Start the backend** (if it is not already running) — see step 1. Confirm `http://127.0.0.1:8001/health` returns `{"status":"ok"}`.
2. **(Optional) Start the smoke test page** in a second terminal:

   ```bash
   cd backend
   python -m http.server 8765 --directory test_pages
   ```

3. **Load the extension in Chrome**
   - Open a new tab and go to `chrome://extensions`
   - Turn on **Developer mode** (top-right)
   - Click **Load unpacked**
   - Select the folder: `d:\Projects\SIH\extension\dist` (or your clone’s `extension/dist`)
   - Confirm **SIH Browser AI Agent** appears and is enabled
4. **Open a page to control**
   - Smoke page: `http://127.0.0.1:8765/smoke.html`
   - PII demo (masking test cases): `http://127.0.0.1:8765/pii-demo.html`
   - Or any normal `http(s)` website (avoid `chrome://` pages — content scripts do not run there)
5. **Run a task**
   - Click the extension icon in the toolbar (puzzle piece → pin **SIH Browser AI Agent** if needed)
   - In the popup, type a task, e.g. `Click the submit button`
   - Click **Run**
   - Status text in the popup should show success; on the smoke page, **Submit** should be clicked / form status updated
6. **After code changes**
   - Run `npm run build` again in `extension/`
   - On `chrome://extensions`, click the **Reload** icon on the extension card
   - Refresh the tab you are testing, then run the task again

**Notes**
- The popup talks to the page via the background + content script; the active tab must be the page you want controlled.
- The extension calls `http://127.0.0.1:8001` — keep FastAPI on that host/port, or change `getApiBase()` in the extension and rebuild.
- If **Run** fails with a connection error, the backend is down or blocked.

### 4. API-only smoke (no browser)

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
