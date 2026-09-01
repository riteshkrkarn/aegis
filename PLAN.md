## Our Understanding
A browser extension that acts as an intelligent agent. It sees the screen, decides what's sensitive, hides it, and only then talks to the server. Simple tasks are handled locally. Only tasks requiring heavier reasoning go to the server. The server never sees raw screen data.

- Client handles: screen capture, PII detection, redaction, lightweight decisions
- Server handles: complex reasoning, returning action commands (click, scroll, fill)

## Proposed Solution
Screen is captured locally → local vision model reads the screen state → PII detected and redacted → sanitized data sent to server only if needed → server LLM processes it and returns a structured action command → browser extension executes the action.

## Architecture

**Client side:**
- Screen capture using browser APIs
- Local vision model for screen understanding (ViT via Transformers.js / ONNX Runtime Web)
- PII detection and redaction (faces, passwords, card numbers) using Canvas API
- Lightweight local LLM for simple task decisions (WebLLM)
- Action executor that runs commands returned by server

**Server side:**
- Receives sanitized screen context
- Processes it using an open-weight LLM (Qwen, LLaMA, Mistral etc.) via cloud API
- Returns structured action commands like `{ "action": "click", "selector": "#submit" }`

## Tech Stack
Chrome Extension APIs, JavaScript, getDisplayMedia API, Transformers.js, ONNX Runtime Web, WebGPU, Canvas API, WebLLM, open-weight LLM via cloud API (Groq / Together AI / Mistral API), DOM manipulation APIs

## Feasibility

**What's proven:**
- Running vision models in browser via Transformers.js and ONNX Runtime Web is well established
- WebLLM can run small quantized models (Phi, Gemma) in browser using WebGPU
- Browser extensions can capture screen and manipulate DOM reliably
- Open-weight LLMs like Qwen, LLaMA, Mistral are available via cloud APIs

**Main challenge:**
Balancing inference latency vs accuracy on the client side, since running vision models in browser is resource heavy. The key is keeping local models small and only offloading to server when necessary.