# MVP exit checklist

Use this after code changes to confirm the MVP bar from the feature-scope plan.

## Automated

```bash
# Backend must be running on :8001
cd backend
.\.venv\Scripts\python scripts\smoke_pipeline.py
.\.venv\Scripts\python scripts\eval_suite.py
```

Both scripts must print `OK` / exit 0.

## Manual demos (from [DEMO_PROMPTS.md](./DEMO_PROMPTS.md))

1. `DEBUG=1` in `backend/.env`, restart uvicorn.
2. Serve pages: `python -m http.server 8765 --directory test_pages`
3. Reload the extension after `npm run build`.
4. **Demo A** (`pii-demo.html`): payment must fail; agent must not leak raw PII; DEBUG AFTER shows `[REDACTED_*]`.
5. **Demo B** (`safe-demo.html`): payment succeeds with board values.

## Privacy network check

- DevTools → Network → `POST /agent/run` body has no `screenshot` / data URL.
- Body markdown uses `[REDACTED_*]` for sensitive fields after masking.

## Loop / schema

- Multi-step tasks stop with a clear answer or a graceful “Stopped: …” message (no hang).
- Malformed planner JSON is retried once server-side.
- Failed actions trigger re-observe instead of inventing success.
