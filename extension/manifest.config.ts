import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'SIH Browser AI Agent',
  description: 'Privacy-first browser AI agent: local PII masking, server reasoning, JSON actions.',
  version: '0.1.0',
  action: {
    // No default_popup — icon opens a persistent panel window instead.
    default_title: 'Browser AI Agent',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['activeTab', 'scripting', 'tabs', 'storage', 'offscreen'],
  host_permissions: [
    'http://127.0.0.1:8001/*',
    'http://localhost:8001/*',
    // Transformers.js downloads SmolVLM weights on first run
    'https://huggingface.co/*',
    'https://*.huggingface.co/*',
    'https://hf.co/*',
    'https://*.hf.co/*',
    'https://cdn.jsdelivr.net/*',
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
})
