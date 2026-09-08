# Errors

Command failures and integration errors.

---

## Error: No element for selector: button[type=button]

**Timestamp:** 2026-09-08
**Severity:** high

### Summary
Agent "Run actions" failed on LinkedIn jobs after planning succeeded. UI also felt locked (could not scroll the popup).

### Context
- Task: Find fresher full stack jobs on LinkedIn
- Model: openai-gpt / gpt-4o-mini
- Plan returned 2 actions; execute threw `No element for selector: button[type=button]`

### Root Cause
1. `domToMd` emitted fake CSS `tag:nth-of-type-hint(N)` that `document.querySelector` cannot resolve.
2. LLM invented vague `button[type=button]` instead of usable selectors (aria-label / index hint).
3. Popup `.shell` was the only scroll container with flex + `margin-top: auto` on status — content overflow felt locked.

### Resolution
- Resolve `nth-of-type-hint` against the same interactive NodeList used in markdown.
- Prefer aria-label / placeholder in emitted selectors.
- Prompt: copy exact `selector=` values; ban vague button/a selectors.
- Popup: scrollable `.shell-scroll` middle + pinned status footer.

### Tags
`extension` `selectors` `popup-ui` `linkedin`
