# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## Learning: Index-hint selectors must be executable

**Timestamp:** 2026-09-08
**Category:** correction
**Priority:** high
**Status:** resolved

### Summary
Markdown interactive rows must expose selectors the content script can actually resolve. Fake CSS pseudos without a resolver cause execute failures and vague LLM fallbacks.

### Details
`:nth-of-type-hint(N)` is a deliberate index into `INTERACTIVE_SELECTOR` NodeList. Keep emission and `resolveElement` in sync. Prefer real CSS (id/name/aria/placeholder) when available.

### Tags
`selectors` `agent-loop` `domToMd`

## Learning: Cache hydrate looks like re-download + status clip

**Timestamp:** 2026-09-08
**Category:** correction
**Priority:** high
**Status:** resolved

### Summary
Privacy model progress always said "Downloading" even for browser-cache loads; stale 99% events overwrote later pipeline stages. Status `max-height: 120px` truncated final answers.

### Details
- Relabel cache hydrate as Loading; keep in-memory model via offscreen keepalive + warm after create.
- Ignore late `model_download` progress once past that stage in the popup.
- Put status inside `.shell-scroll` without max-height so full answers are readable.

### Tags
`vlm` `offscreen` `popup-ui` `progress`
