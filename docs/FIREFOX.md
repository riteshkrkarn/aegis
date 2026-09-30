# Firefox notes

Chrome MV3 is the supported target for SIH demos.

Firefox support is **deferred**. If required later:

| Area | Chrome today | Firefox gap |
|------|--------------|-------------|
| Manifest | MV3 via CRXJS | Need Firefox MV3 packaging (`web-ext`) |
| Offscreen + Transformers.js | `offscreen` permission | No Chrome offscreen API — use a hidden extension page / worker |
| `captureVisibleTab` | Supported | Supported with similar tab permissions |
| Detached panel | `chrome.windows` popup | Similar, test focus quirks |
| Host permissions | HF CDN for model download | Same hosts must be declared |

Do not block MVP or Chrome demos on Firefox parity.
