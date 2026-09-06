# SIH Browser AI Agent — Backend

Python FastAPI server that accepts sanitized page markdown + a user task and returns JSON browser actions.

## Setup

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

In `.env`:
- `GROQ_API_KEY` — used when `LLM_PROVIDER=groq` (default)
- `NVIDIA_API_KEY` — used when `LLM_PROVIDER=nvidia` (NVIDIA NIM)
- `LLM_PROVIDER=heuristic` — force offline fallback

Without a matching key, a heuristic planner is used for local smoke tests.

## Run

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

- Health: `GET http://127.0.0.1:8001/health`
- Agent: `POST http://127.0.0.1:8001/agent/run`
