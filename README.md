# Aegis — Browser AI Agent

Privacy-first Chrome extension: it masks sensitive data on your device, then asks a local server how to click/fill the page.

## What you need

- Node.js 18+
- Python 3.11+
- Google Chrome

## Test locally (3 terminals)

### Terminal 1 — Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env
# macOS / Linux: cp .env.example .env

uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Open [http://127.0.0.1:8001/health](http://127.0.0.1:8001/health) — you should see `{"status":"ok"...}`.

Optional: put an API key in `backend/.env` (e.g. `OPENAI_API_KEY=` or `GROQ_API_KEY=`) for smarter planning. Without a key, a simple heuristic planner still works for smoke tests.

### Terminal 2 — Demo pages

```bash
cd backend
python -m http.server 8765 --directory test_pages
```

### Terminal 3 — Build the extension

```bash
cd extension
npm install
npm run build
```

## Load in Chrome

1. Go to `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select `extension/dist` (the folder inside this repo)
4. Pin **SIH Browser AI Agent**

## Try it

1. Open a demo page:
   - Simple: [http://127.0.0.1:8765/smoke.html](http://127.0.0.1:8765/smoke.html)
   - Privacy (must block payment): [http://127.0.0.1:8765/pii-demo.html](http://127.0.0.1:8765/pii-demo.html)
   - Safe payment: [http://127.0.0.1:8765/safe-demo.html](http://127.0.0.1:8765/safe-demo.html)
2. Click the extension icon
3. Type a task, e.g. `Click the submit button`
4. Click **Run**

Ready-made demos: [docs/DEMO_PROMPTS.md](docs/DEMO_PROMPTS.md)

### After you change code

```bash
cd extension
npm run build
```

Then click **Reload** on the extension card in `chrome://extensions`, refresh the page, and run again.

## Quick check (no browser)

With the backend running:

```bash
cd backend
# Windows
.\.venv\Scripts\python scripts\smoke_pipeline.py
# macOS / Linux
# .venv/bin/python scripts/smoke_pipeline.py
```

You should see `SMOKE OK`.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Connection error on Run | Start the backend (Terminal 1). Keep it on port `8001`. |
| Nothing happens on the page | Focus the demo tab (not the agent panel), then Run. Avoid `chrome://` pages. |
| Extension looks old | Rebuild, reload the extension, hard-refresh the page. |
| First run is slow | Privacy model downloads once; later runs are faster. |

## More docs

- [docs/DEMO_PROMPTS.md](docs/DEMO_PROMPTS.md) — privacy demos
- [docs/MVP_CHECKLIST.md](docs/MVP_CHECKLIST.md) — full local checklist
- [PLAN.md](PLAN.md) — architecture
