# Feature Requests

Capabilities requested by the user.

---


## FR-001: Movable agent panel
**Date**: 2026-09-08
**Requested by**: user
**Status**: implemented
**Priority**: medium

### Request
Make the Chrome extension agent panel movable on screen (not stuck under the toolbar icon).

### Use Case
During demos / normal use, reposition the panel so it does not cover the page being automated.

### Acceptance Criteria
- [x] Panel can be moved freely on screen
- [x] Last position is restored when reopened

### Implementation
Detached `chrome.windows` popup via `action.onClicked` (no `default_popup`); position persisted in `chrome.storage.local`.

---
