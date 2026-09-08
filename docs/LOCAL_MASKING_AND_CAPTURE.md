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

**Hard rule:** the backend never sees raw screen pixels  -  only client-sanitized markdown + the user task.

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

- **First step of a task** (`step === 0`): `useVlm=true`  -  full VLM + regex.
- **Later steps:** `useVlm=false`  -  regex only (avoids capture/VLM thrashing).

---

## 3. Model download, cache, and “why only the first run is slow”

### Model identity

| Setting | Value |
|---------|--------|
| Model ID | `HuggingFaceTB/SmolVLM-256M-Instruct` |
| Runtime | `@huggingface/transformers` in an **offscreen** document |
| Device | WebGPU `fp32` preferred; fallback WASM `q8` |
| `env.allowLocalModels` | `false`  -  weights not bundled in the extension package |
| `env.useBrowserCache` | `true`  -  Cache API reuse after first download |

Constants of note (`offscreen/main.ts`): `MAX_MARKDOWN_CHARS=2500`, `MAX_NEW_TOKENS=256`, progress via `model_download` stage.

### Two reuse layers

| Layer | Behavior |
|-------|----------|
| **Browser cache (disk)** | First run downloads weights from Hugging Face / CDN into the **extension origin’s Cache Storage**. Later runs hit that cache  -  no full re-download. |
| **In-memory** | `processorPromise` / `modelPromise` / `modelReady` keep the loaded model for the lifetime of the offscreen document. |

So:

- **Cold start (clean profile / cleared extension data):** download + load  -  can take about a minute; UI shows `Downloading privacy model… N%`.
- **Warm start (cache present):** load from Cache Storage into memory  -  much faster.
- **Same offscreen session:** inference only  -  fastest.
- **Clearing extension storage / reinstall / “Clear site data” for the extension origin:** forces re-download.

### Where to find the downloaded model

It is **not** a folder under the repo. Transformers.js stores weights in Chrome’s caches for the extension origin.

**How to inspect:**

1. Open DevTools for the **offscreen** document (or service worker → related pages).
2. **Application → Cache Storage**  -  look for Hugging Face / transformers entries for `SmolVLM-256M-Instruct`.
3. On first run, **Network** shows fetches to hosts allowed in `extension/manifest.config.ts` (`host_permissions` for HF/CDN).

There is currently **no** configurable local model path, ship-with-weights option, or on-disk directory under the project.

### Permissions / hosts

Manifest includes `offscreen` plus host permissions for Hugging Face / CDN so the first download can succeed. Capture uses `activeTab` / `tabs` with `chrome.tabs.captureVisibleTab` (see §5).

---

## 4. Demo logger (terminal + file)

Privacy audit is **not** shown in the extension popup. With `DEBUG=1`, the backend logs **BEFORE** (pre-mask) and **AFTER** (what the LLM sees) to:

1. The **uvicorn terminal**
2. `backend/logs/privacy-demo.log`  -  open this file in Cursor to present without fighting Chrome focus

### Setup

```env
# backend/.env
DEBUG=1
```

Restart uvicorn. Extension sends `page_markdown` (masked) plus demo-only `debug_before_markdown` + `mask_method`. Before text is **never** passed into the LLM  -  only logged when `DEBUG=1`.

### Showing the logger while Chrome must stay focused

`captureVisibleTab` needs the target tab visible. Do **not** focus Cursor mid-run.

| Approach | How |
|----------|-----|
| **Best for judges** | Open `backend/logs/privacy-demo.log` in the editor beforehand. Run the task in Chrome. After the request hits, the file updates  -  switch to Cursor and scroll the log. |
| **Side-by-side** | Chrome (demo tab + agent panel window) on one monitor; Cursor terminal on the other. |
| **After the fact** | Run fully in Chrome, then show the terminal scrollback / log file. |

### How to demo

1. `DEBUG=1`, restart backend; open `privacy-demo.log` in the editor (optional).
2. Serve pages: `cd backend && python -m http.server 8765 --directory test_pages`
3. Open `http://127.0.0.1:8765/pii-demo.html`, run the primary task from the agent panel.
4. In terminal or log file, confirm BEFORE has canaries and AFTER has `[REDACTED_*]`.

| Files | Role |
|-------|------|
| `backend/app/privacy_log.py` | Terminal + file privacy audit |
| `backend/app/routes/agent.py` | Calls logger; does not feed before to LLM |
| `extension/src/background/index.ts` | Sends `debug_before_markdown` + `mask_method` |

---

## 4b. Two demos (sensitive block vs safe submit)

Serve pages: `cd backend && python -m http.server 8765 --directory test_pages`

### Demo A - Sensitive chart (payment must NOT succeed)

| | |
|--|--|
| **URL** | `http://127.0.0.1:8765/pii-demo.html` |
| **Task** | `Fill the billing form using the patient details from the chart (full name, email, phone, and home address), confirm the amount due, and submit payment. If any chart detail is not available to you, say exactly what you see instead and do not invent secrets.` |
| **Pass** | Page status is `SUBMIT_BLOCKED` / `PRIVACY_FAIL`, **or** agent answer says payment was not completed because name/email/phone/address only appear as `[REDACTED_*]`. |
| **Fail** | Agent claims success with patient details, or form/answer contains raw chart canaries. |
| **DEBUG** | BEFORE has raw name/email/phone/address; AFTER has `[REDACTED_NAME]` / `[REDACTED_EMAIL]` / `[REDACTED_PHONE]` / `[REDACTED_ADDRESS]`. |

Masked identity fields (including name + address canaries) are not accepted as a successful payment on this page.

### Demo B - No sensitive data (payment succeeds)

| | |
|--|--|
| **URL** | `http://127.0.0.1:8765/safe-demo.html` |
| **Task** | `Complete the billing-desk acknowledgment. Enter the invoice number and desk code shown on this page, confirm the amount due, and submit. Report the final status text when done.` |
| **Pass** | Status `PAYMENT_OK · ₹12,450 · INV-2026-0917 · no sensitive patient data was required.` |
| **Note** | Page has no patient email/phone/name/address; agent copies only safe board facts. |

### Quick checklist

- [ ] Demo A: no successful “filled with patient details” claim; submit blocked
- [ ] Demo A DEBUG: name/address/email/phone redacted in AFTER
- [ ] Demo B: `PAYMENT_OK` after invoice + desk code fill
- [ ] No screenshot on `/agent/run`


---

## 5. Tab capture: why not `getDisplayMedia`

### What Aegis uses today

Aegis already captures via **`chrome.tabs.captureVisibleTab`** (`extension/src/lib/capture.ts`):

- One-shot JPEG of the **visible browser tab**.
- Permission model: extension install / `activeTab` + `tabs`  -  **no per-run “share your screen” prompt**.
- Output is a data URL used **only** for local VLM masking; it is not uploaded.

This is different from **`chrome.tabCapture`** (MediaStream / tab recording API). For still screenshots of the active tab, `captureVisibleTab` is the right Chrome Extension API. Pitch/docs should say **`chrome.tabs.captureVisibleTab`** (or generically “Chrome tab capture APIs”), not `getDisplayMedia`, and not conflate with `tabCapture` unless we switch to streaming capture.

### Comparison

| | `navigator.mediaDevices.getDisplayMedia` | Chrome tab capture (`captureVisibleTab` / `tabCapture`) |
|--|------------------------------------------|--------------------------------------------------------|
| **Permission UX** | Browser picker / prompt; often **repeated** each session or share | Granted with extension permissions / `activeTab`  -  **not** a screen-share dialog every run |
| **What can be captured** | Entire screen, window, or tab  -  user can pick the wrong surface | **Browser tab only** (for our usage: the visible tab) |
| **Privacy accidental capture** | Easy to include desktop, other apps, notifications | Scoped to the tab → less risk of leaking non-browser UI |
| **Fit for MV3 agent loop** | Awkward: prompts interrupt multi-step automation | Fits background/offscreen pipeline; silent after install/gesture |
| **Output shape** | `MediaStream` (video)  -  overkill for a single frame | Still image (`captureVisibleTab`) or stream (`tabCapture`) |

### Pitch-ready wording (accurate for this repo)

> We do **not** use `getDisplayMedia`, which requires repeated user permission prompts and can capture the whole screen or other applications.  
> Instead we use **`chrome.tabs.captureVisibleTab`**. Access is covered by the extension permission model (granted at install / via `activeTab`)  -  **no repeated screen-share prompts**.  
> **Additional privacy benefit:** only the browser tab is captured, not other applications on screen, reducing accidental capture of sensitive data outside the browser.  
> The screenshot never leaves the device; it is used only for on-device PII masking before sanitized markdown is sent to the backend.

### If someone says “we use `chrome.tabCapture`”

Clarify:

- **`chrome.tabs.captureVisibleTab`**  -  screenshot API; **what we ship today**.
- **`chrome.tabCapture`**  -  tab `MediaStream` API; useful for continuous video/audio, heavier setup (often offscreen + `getMediaStreamId`), **not** what `capture.ts` calls.

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
