/**
 * "Available but invisible" token store.
 *
 * Sensitive field values are replaced with a short opaque token (e.g.
 * [FIELD:phone#a1c9]) before the markdown ever leaves the device. The LLM
 * plans against the token exactly like any other value — it can be told
 * to fill it into a different field, reference it in reasoning, etc. The
 * REAL value is substituted back in only inside the content script,
 * immediately before it is written into the DOM (see actions.ts) — so
 * the token is what the agent "knows", and the value is what actually
 * gets typed. The server and the LLM never see the real value, even for
 * a field the task genuinely needs filled.
 *
 * Lives in content-script memory only: never persisted, never
 * serialized, never sent in any network request. Cleared and re-minted
 * on every fresh page observation (documentToMarkdown() calls
 * resetTokenStore() first) so a token from a previous step can never
 * resolve against a new page.
 */

const tokenToValue = new Map<string, string>()
const selectorToToken = new Map<string, string>()

const TOKEN_PATTERN = /\[FIELD:[a-z0-9-]+#[a-z0-9]{4,8}\]/gi

export function resetTokenStore(): void {
  tokenToValue.clear()
  selectorToToken.clear()
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6)
}

/** Mint a fresh opaque token for a sensitive value tied to one selector. */
export function mintToken(category: string, realValue: string, selector: string): string {
  const safeCategory =
    category
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 24) || 'field'

  let token: string
  do {
    token = `[FIELD:${safeCategory}#${randomSuffix()}]`
  } while (tokenToValue.has(token))

  tokenToValue.set(token, realValue)
  selectorToToken.set(selector, token)
  return token
}

/** True if the string IS (only) a minted token, nothing else. */
export function isBareToken(value: string): boolean {
  const trimmed = value.trim()
  TOKEN_PATTERN.lastIndex = 0
  const match = TOKEN_PATTERN.exec(trimmed)
  return !!match && match[0] === trimmed
}

/**
 * Resolve any minted tokens inside a value back to their real values.
 * Text the LLM composed itself (no token substring) passes through
 * unchanged. A token-shaped string this store did NOT mint (stale run,
 * hallucinated) is left as-is rather than silently blanked, so a
 * mismatch fails loudly instead of typing garbage into a form.
 */
export function resolveTokens(value: string): string {
  if (!value) return value
  TOKEN_PATTERN.lastIndex = 0
  return value.replace(TOKEN_PATTERN, (match) => tokenToValue.get(match) ?? match)
}

/** Look up the token minted for a specific selector in THIS observation. */
export function getTokenForSelector(selector: string): string | null {
  return selectorToToken.get(selector) ?? null
}

export function tokenCount(): number {
  return tokenToValue.size
}
