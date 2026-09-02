# SIH26171: Browser AI Agent — Project Idea

**Sponsor:** ISRO | **Theme:** Smart Automation | **Prize:** ₹1,00,000

---

## The Problem

Build a browser-based AI agent (like **Comet by Perplexity**) that can complete tasks on the web for the user — clicking, filling forms, navigating, extracting info, etc. — while keeping sensitive data (passwords, emails, card numbers) from being exposed when processed by an LLM.

---

## Our Rough Plan

### 1. Session Tracker
- Extension popup has a "History" page
- Shows past tasks/sessions the agent has run — like browser history but for AI tasks

### 2. The Agent (Brain)
- Use **WebLLM** for planning + deciding what actions to take (click, fill, scroll, etc.)
- This is what "thinks" — understands the user's request and figures out what needs to be done on the page

### 3. DOM → Markdown
- Instead of sending raw HTML/CSS/JS to the LLM, convert the page's DOM into a clean **Markdown** representation
- Keeps it lightweight and easier for the LLM to reason about

### 4. Masking Before Sending
- Before the markdown is sent anywhere (local LLM or server), sensitive parts (passwords, numbers, etc.) get masked
- Masking is just part of doing the task safely — not the main point of the project

### 5. Two Modes: Local vs Server
- **Local:** if the task is light, the AI (WebLLM) handles everything on the user's machine
- **Server:** if the task is heavy, it gets offloaded to a backend where a bigger model does the work

### 6. Output = JSON Actions
- Whether local or server, the model responds with a JSON object describing what action to take (e.g., click a button, fill a field)
- The extension executes this on the page

---

## Basic Flow (High Level)

```
User gives a task
      ↓
Agent looks at the page (DOM → Markdown)
      ↓
Sensitive data gets masked
      ↓
Light task? → Local WebLLM decides & acts
Heavy task? → Sent to server → server LLM decides
      ↓
Get back JSON action(s)
      ↓
Extension performs the action on the page
      ↓
Logged in session history
```

---

## Open Questions (To Figure Out As We Build)

- What exactly gets tracked in session history?
- What counts as "light" vs "heavy" task (how do we decide local vs server)?
- Which open-source model(s) to use, both locally and server-side?
- How exactly is masking done — regex? CV? Both?
- What does the JSON action format look like exactly?
- How do we handle multi-step tasks / errors?
- What edge cases / test cases do we need to define, to check if the model is working correctly?
- Which model is actually the optimal choice for this project (need to evaluate options)?
- What's the business model / income side of this project?
- What existing solutions are out there (e.g., Comet), and what can we improve on?
- Any unique feature we can add to stand out?

---

## Tech Direction (Not Finalized)

- **Extension:** Browser extension (Chrome/Firefox)
- **Local AI:** WebLLM
- **Server AI:** Some open-source LLM (TBD)
- **Masking:** Computer vision + possibly pattern matching

---

*This is a rough working idea — details will evolve as we build and test.*
