# SIH Browser AI Agent — Extension

Chrome MV3 TypeScript extension.

## Setup

```bash
cd extension
npm install
npm run build
```

## Run in Chrome

1. Build: `npm run build` (output in `dist/`)
2. Start the FastAPI backend on `http://127.0.0.1:8001` (see [../backend/README.md](../backend/README.md))
3. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder’s `dist`
4. Open a normal web page (e.g. smoke page at `http://127.0.0.1:8765/smoke.html`)
5. Click the **SIH Browser AI Agent** toolbar icon → enter a task → **Run**
6. After source changes: `npm run build`, then hit **Reload** on the extension card and refresh the page

Full walkthrough: [../README.md](../README.md#3-run-in-chrome-browser-steps).

## Dev

```bash
npm run dev
```

Then load/reload the `dist` folder produced by the CRX Vite plugin (or follow CRXJS HMR flow).

## Pipeline

1. Capture visible tab
2. Local PII mask via Transformers.js VLM in an **offscreen document** (`HuggingFaceTB/SmolVLM-256M-Instruct`, WebGPU preferred) + regex safety net
3. DOM → Markdown via content script
4. `POST /agent/run` to FastAPI (sanitized markdown only — no screenshot)
5. Execute returned JSON actions

**First Run note:** the VLM downloads from Hugging Face on first use (can take a minute). Later runs reuse the browser cache. If the VLM fails/times out, masking falls back to regex and the popup shows `Mask=placeholder`.
