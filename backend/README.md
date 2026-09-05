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

Optional: set `GROQ_API_KEY` in `.env` for real LLM planning. Without it, a heuristic planner is used (enough for local smoke tests).

## Run

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- Health: `GET http://127.0.0.1:8000/health`
- Agent: `POST http://127.0.0.1:8000/agent/run`
