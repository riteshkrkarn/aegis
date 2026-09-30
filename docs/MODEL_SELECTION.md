# Model selection criteria

How we choose the **local VLM** (masking / future light reasoning) and **server planner** models.

## Privacy invariant (non-negotiable)

- Screenshots never leave the device.
- Server receives only client-sanitized Markdown + task.
- Local model must run in the extension (Transformers.js), preferably WebGPU with WASM fallback.

## Local VLM (masking)

| Criterion | Target | Current default |
|-----------|--------|-----------------|
| Size | ≤ ~500M params for acceptable first-load | `HuggingFaceTB/SmolVLM-256M-Instruct` |
| Cold start | Cache after first download; UI shows progress | Cache API via Transformers.js |
| Quality | Finds emails, phones, names, addresses, cards in viewport text | VLM findings + regex safety net |
| Latency | Step 0 VLM OK; later steps regex unless remask needed | VLM on step 0; remask after fill/navigate |
| Fallback | Must degrade to regex without failing the task | `maskMethod: placeholder` |

**Upgrade rule:** keep SmolVLM-256M until a candidate beats it on (1) PII recall on demo pages A/B, (2) median step-0 latency on mid-range hardware, (3) still fits WebGPU/WASM path.

## Server planner

| Criterion | Target | Notes |
|-----------|--------|-------|
| Structured JSON | Reliable `actions` / `done` / `answer` | Repair retry once on parse failure |
| Latency | Prefer &lt; 5s per turn for demos | Provider-dependent |
| Cost | Open-weight via cloud API preferred | Groq / NVIDIA / OpenAI catalog in UI |
| Offline | Heuristic planner when no API key | Smoke / CI |

**UI catalog** (`extension/src/lib/models.ts` + `backend/app/models_catalog.py`) is the source of selectable server models. Retire models that 404/410 via friendly errors.

## Bake-off procedure (when evaluating a change)

1. Run `scripts/eval_suite.py` (mask + schema + tool + routing fixtures).
2. Manual Demo A/B with `DEBUG=1`.
3. Record: mask method, planner model id, wall time to first action, pass/fail.
4. Only change the default if the new model wins on demos without breaking smoke.
