# SIH Browser AI Agent — Extension

Chrome MV3 TypeScript extension.

## Setup

```bash
cd extension
npm install
npm run build
```

Load unpacked in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `extension/dist`.

## Dev

```bash
npm run dev
```

Then load the dist folder produced by the CRX Vite plugin (or follow CRXJS HMR flow).

## Pipeline

1. Capture visible tab
2. Local PII mask (placeholder until Transformers.js VLM is wired)
3. DOM → Markdown via content script
4. `POST /agent/run` to FastAPI
5. Execute returned JSON actions
