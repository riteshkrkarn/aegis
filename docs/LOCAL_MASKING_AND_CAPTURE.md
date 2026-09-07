# Local PII Masking, Demo Logging & Tab Capture

Reference for how Aegis keeps sensitive data on-device, where the local model lives, what’s missing for demos, and why Chrome tab capture beats `getDisplayMedia`.

---

## 1. End-to-end privacy flow

```
User clicks Run
  → observePage (per agent step)
       → captureVisibleTab (JPEG stays on device)
       → GET_MARKDOWN (content script)
       → maskPiiWithLocalVlm
            ├─ step 0: SmolVLM findings + regex safety net
            └─ later steps: regex only (useVlm=false)
       → POST /agent/run { page_markdown: masked, task, url, … }
            ✗ screenshot never uploaded
  → server plans actions from sanitized markdown only
  → extension executes actions
```

**Hard rule:** the backend never sees raw screen pixels — only client-sanitized markdown + the user task.

---

## 2. How local model masking works

### Implementation map

| Path | Role |
|------|------|
| `extension/src/lib/mask.ts` | Regex PII patterns; `maskPiiInText`, `applyPiiFindings`, `maskPiiWithLocalVlm` |
| `extension/src/offscreen/main.ts` | SmolVLM load + inference (`OFFSCREEN_FIND_PII`) |
| `extension/src/lib/offscreen.ts` | Creates Chrome offscreen document for Transformers.js |
| `extension/src/lib/capture.ts` | `chrome.tabs.captureVisibleTab` → JPEG data URL |
| `extension/src/background/index.ts` | Pipeline: observe → mask → `runAgentOnServer` |
| `extension/src/lib/api.ts` | `POST ${apiBase}/agent/run` (no screenshot in body) |
| `backend/app/routes/agent.py` | Receives `page_markdown`; logs length, not body |
| `backend/app/schemas.py` | Documents `page_markdown` as client-sanitized |

### Masking methods

1. **VLM path** (`transformers-js-vlm`)
   - Offscreen SmolVLM sees screenshot + clipped markdown.
   - Returns `{ type, value }` findings.
   - Values are string-replaced with `[REDACTED_*]` labels.
   - Regex always runs afterward as a safety net.

2. **Placeholder / regex path** (`placeholder`)
   - Emails, card-like digit runs, phone-like numbers, `password:` fields → `[REDACTED_*]`.
   - Used when `useVlm=false`, screenshot missing, or VLM fails/times out.

### When VLM runs

- **First step of a task** (`step === 0`): `useVlm=true` — full VLM + regex.
- **Later steps:** `useVlm=false` — regex only (avoids capture/VLM thrashing).

---

## 3. Model download, cache, and “why only the first run is slow”

### Model identity

| Setting | Value |
|---------|--------|
| Model ID | `HuggingFaceTB/SmolVLM-256M-Instruct` |
| Runtime | `@huggingface/transformers` in an **offscreen** document |
| Device | WebGPU `fp32` preferred; fallback WASM `q8` |
| `env.allowLocalModels` | `false` — weights not bundled in the extension package |
| `env.useBrowserCache` | `true` — Cache API reuse after first download |

Constants of note (`offscreen/main.ts`): `MAX_MARKDOWN_CHARS=2500`, `MAX_NEW_TOKENS=256`, progress via `model_download` stage.

### Two reuse layers

| Layer | Behavior |
|-------|----------|
| **Browser cache (disk)** | First run downloads weights from Hugging Face / CDN into the **extension origin’s Cache Storage**. Later runs hit that cache — no full re-download. |
| **In-memory** | `processorPromise` / `modelPromise` / `modelReady` keep the loaded model for the lifetime of the offscreen document. |

So:

- **Cold start (clean profile / cleared extension data):** download + load — can take about a minute; UI shows `Downloading privacy model… N%`.
- **Warm start (cache present):** load from Cache Storage into memory — much faster.
- **Same offscreen session:** inference only — fastest.
- **Clearing extension storage / reinstall / “Clear site data” for the extension origin:** forces re-download.

### Where to find the downloaded model

It is **not** a folder under the repo. Transformers.js stores weights in Chrome’s caches for the extension origin.

**How to inspect:**

1. Open DevTools for the **offscreen** document (or service worker → related pages).
2. **Application → Cache Storage** — look for Hugging Face / transformers entries for `SmolVLM-256M-Instruct`.
3. On first run, **Network** shows fetches to hosts allowed in `extension/manifest.config.ts` (`host_permissions` for HF/CDN).

There is currently **no** configurable local model path, ship-with-weights option, or on-disk directory under the project.

### Permissions / hosts

Manifest includes `offscreen` plus host permissions for Hugging Face / CDN so the first download can succeed. Capture uses `activeTab` / `tabs` with `chrome.tabs.captureVisibleTab` (see §5).

---

## 4. Demo logger (implemented)

### Extension — Privacy audit panel

After each observe/mask turn, the background sends a `PRIVACY_AUDIT` message with:

- `beforeMarkdown` / `afterMarkdown` (preview capped at 6 000 chars)
- `method` (`transformers-js-vlm` or `placeholder`)
- char counts + step index

The agent panel (`popup/index.html`) shows a **Privacy audit (demo)** section: before (on device only) vs after (sent to backend). Final `PIPELINE_RESULT` also carries `maskMethod` + last `privacyAudit`.

| Files | Role |
|-------|------|
| `extension/src/lib/types.ts` | `PrivacyAudit`, `PRIVACY_AUDIT`, result fields |
| `extension/src/lib/progress.ts` | `buildPrivacyAudit`, `emitPrivacyAudit` |
| `extension/src/background/index.ts` | Emits audit after mask |
| `extension/src/popup/*` | Audit UI |

**Note:** “Before” text stays in the extension UI only — it is never uploaded. Screenshots still never leave the device.

### Backend — `DEBUG=1` post-mask body log

In `backend/.env`:

```env
DEBUG=1
```

Then `POST /agent/run` logs the full received `page_markdown` (already masked by the client) under logger `sih.agent`:

```text
agent.run DEBUG page_markdown (post-mask, received):
...
```

Default is off (`DEBUG=0`). Use only for demos — the body may still contain non-PII page content.

### How to demo

1. Serve test pages: `cd backend && python -m http.server 8765 --directory test_pages`
2. Open `http://127.0.0.1:8765/pii-demo.html` (rich PII) or `smoke.html` (minimal).
3. Run a task in the agent panel → watch **Privacy audit** before/after + `Mask=…`.
4. With `DEBUG=1`, watch the backend terminal for the post-mask markdown (should show `[REDACTED_*]`, no screenshot).
5. Optional: DevTools Network → `POST /agent/run` body confirms the same.

---

## 4b. Manual test scenarios

Serve pages first (`python -m http.server 8765 --directory test_pages` from `backend/`).
Reload the extension after build. Prefer `pii-demo.html` for full coverage.

| # | Scenario | Page / setup | Task to run | Pass criteria |
|---|----------|--------------|-------------|----------------|
| 1 | **Email redaction** | `pii-demo.html` Case A | `What email addresses are on this page?` | Before has `alice.privacy@example.com` / `secret@mail.test`; After has `[REDACTED_EMAIL]`; backend DEBUG log matches After |
| 2 | **Card redaction** | Case C | `List any card numbers visible.` | Before has `4111…`; After `[REDACTED_CARD]`; no full PAN in Network request |
| 3 | **Phone redaction** | Case B | `What phone numbers are listed?` | After shows `[REDACTED_PHONE]` (regex and/or VLM) |
| 4 | **Password line** | Case D | `Summarize any credentials mentioned.` | After has `password: [REDACTED_PASSWORD]`; raw secret not in After / DEBUG log |
| 5 | **VLM-only entities** | Case E (name/address) | `Who is the patient and where do they live?` | On **first step**, `Mask=VLM + regex` and name/address often become `[REDACTED_*]`. If VLM fails → `Mask=regex only` and name may remain (document as fallback) |
| 6 | **False positives** | Case F (₹34,999 / 113990) | `What is the product price?` | Price/SKU still readable in After — not wiped as phone/card |
| 7 | **No screenshot on wire** | Any | Any short task | Network `POST /agent/run` JSON has `page_markdown` only — no `screenshot`, no `data:image` |
| 8 | **Multi-step method switch** | `pii-demo.html` | `Fill the name with Test User and click Submit.` | Step 0 audit: often VLM; later observe steps: `Mask=regex only` is OK |
| 9 | **DEBUG off vs on** | Backend `.env` | Same task twice | `DEBUG=0`: only `markdown_chars=…`. `DEBUG=1`: full post-mask body logged |
| 10 | **Cold vs warm model** | Clear extension Cache Storage, then rerun | Any task on step 0 | First run: download progress; second run: much faster, still masks |
| 11 | **Minimal smoke** | `http://127.0.0.1:8765/smoke.html` | `Click the Submit button` | Email/card in Before; redacted in After; form submits locally |
| 12 | **Answer without leaking** | Case A–C | `What email and card number appear on the page?` | Model answer should not echo raw PII from server context (server only saw redacted markdown) |

### Quick pass/fail checklist (demo day)

- [ ] Audit panel appears after mask
- [ ] Before ≠ After for at least email or card
- [ ] After contains `[REDACTED_EMAIL]` or `[REDACTED_CARD]`
- [ ] `DEBUG=1` terminal shows same redacted text
- [ ] No screen-share permission prompt (`captureVisibleTab`)
- [ ] No image payload in `/agent/run`

---

## 5. Tab capture: why not `getDisplayMedia`

### What Aegis uses today

Aegis already captures via **`chrome.tabs.captureVisibleTab`** (`extension/src/lib/capture.ts`):

- One-shot JPEG of the **visible browser tab**.
- Permission model: extension install / `activeTab` + `tabs` — **no per-run “share your screen” prompt**.
- Output is a data URL used **only** for local VLM masking; it is not uploaded.

This is different from **`chrome.tabCapture`** (MediaStream / tab recording API). For still screenshots of the active tab, `captureVisibleTab` is the right Chrome Extension API. Pitch/docs should say **`chrome.tabs.captureVisibleTab`** (or generically “Chrome tab capture APIs”), not `getDisplayMedia`, and not conflate with `tabCapture` unless we switch to streaming capture.

### Comparison

| | `navigator.mediaDevices.getDisplayMedia` | Chrome tab capture (`captureVisibleTab` / `tabCapture`) |
|--|------------------------------------------|--------------------------------------------------------|
| **Permission UX** | Browser picker / prompt; often **repeated** each session or share | Granted with extension permissions / `activeTab` — **not** a screen-share dialog every run |
| **What can be captured** | Entire screen, window, or tab — user can pick the wrong surface | **Browser tab only** (for our usage: the visible tab) |
| **Privacy accidental capture** | Easy to include desktop, other apps, notifications | Scoped to the tab → less risk of leaking non-browser UI |
| **Fit for MV3 agent loop** | Awkward: prompts interrupt multi-step automation | Fits background/offscreen pipeline; silent after install/gesture |
| **Output shape** | `MediaStream` (video) — overkill for a single frame | Still image (`captureVisibleTab`) or stream (`tabCapture`) |

### Pitch-ready wording (accurate for this repo)

> We do **not** use `getDisplayMedia`, which requires repeated user permission prompts and can capture the whole screen or other applications.  
> Instead we use **`chrome.tabs.captureVisibleTab`**. Access is covered by the extension permission model (granted at install / via `activeTab`) — **no repeated screen-share prompts**.  
> **Additional privacy benefit:** only the browser tab is captured, not other applications on screen, reducing accidental capture of sensitive data outside the browser.  
> The screenshot never leaves the device; it is used only for on-device PII masking before sanitized markdown is sent to the backend.

### If someone says “we use `chrome.tabCapture`”

Clarify:

- **`chrome.tabs.captureVisibleTab`** — screenshot API; **what we ship today**.
- **`chrome.tabCapture`** — tab `MediaStream` API; useful for continuous video/audio, heavier setup (often offscreen + `getMediaStreamId`), **not** what `capture.ts` calls.

Using `tabCapture` instead of `getDisplayMedia` would still be better on permission and scope grounds, but for still-frame masking we already have the simpler, better-fitting API.

---

## 6. Quick verification checklist

**Masking / model**

- [ ] First run: popup shows model download progress; Cache Storage fills under extension origin.
- [ ] Second run: no full re-download (or much faster).
- [ ] Agent panel **Privacy audit**: before has raw PII strings; after shows `[REDACTED_*]`.
- [ ] Status / meta shows `Mask=VLM + regex` or `Mask=regex only`.
- [ ] Network `POST /agent/run` body has `[REDACTED_*]` and no `screenshot` / data URL field.
- [ ] With `DEBUG=1`, backend logs full post-mask `page_markdown`; with `DEBUG=0`, only `markdown_chars`.

**Capture**

- [ ] Running a task does **not** open a “Share screen / window / tab” picker.
- [ ] Only the active tab content is used for local VLM (confirm via offscreen / progress stages).

---

## 7. Related files

- `extension/src/lib/mask.ts`
- `extension/src/offscreen/main.ts`
- `extension/src/lib/capture.ts`
- `extension/src/background/index.ts`
- `extension/manifest.config.ts`
- `backend/app/routes/agent.py`
- `extension/README.md` / root `README.md` / `PLAN.md`
