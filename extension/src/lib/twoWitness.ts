/**
 * Two-Witness Actuation Guard.
 *
 * We observe the page once, plan, then act — possibly several seconds
 * later. Before firing anything sensitive/irreversible (submit, pay,
 * delete, confirm, send…) we re-check that the element we are about to
 * act on is still the SAME element the plan was made against, not just
 * "whatever currently matches this selector". This defends against a
 * page mutating a control's target in the gap between observation and
 * action (TOCTOU), and against a control whose DOM label doesn't match
 * what a human would actually see rendered.
 *
 * This is the deterministic "witness" (tag / label / position). The
 * second witness — cross-checking against the rendered pixels via the
 * local VLM on a small crop — is wired as an explicit opt-in in
 * offscreen/main.ts (requestCropVerification) because it costs a model
 * call; the structural check below is what should be on by default,
 * since it alone already defeats the TOCTOU class and costs nothing.
 *
 * Deliberately code-level, not model-level: the check can't itself be
 * talked out of firing by adversarial page content.
 */

export interface ElementSignature {
  tag: string
  type: string
  label: string
  rectBucket: string
}

const planTimeSignatures = new Map<string, ElementSignature>()

export function resetPlanSignatures(): void {
  planTimeSignatures.clear()
}

function bucket(n: number): number {
  // Coarse 20px buckets — tolerant of reflow/scroll, not of a real move.
  return Math.round(n / 20) * 20
}

export function signatureOf(el: Element): ElementSignature {
  const html = el as HTMLElement
  const rect = html.getBoundingClientRect()
  const label =
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('name') ||
    (el.textContent || '').trim().slice(0, 60)
  return {
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    label: label.toLowerCase().trim(),
    rectBucket: `${bucket(rect.left)},${bucket(rect.top)}`,
  }
}

/** Called from describeInteractive() while building markdown (plan time). */
export function recordPlanSignature(selector: string, el: Element): void {
  planTimeSignatures.set(selector, signatureOf(el))
}

export type WitnessResult = { ok: true } | { ok: false; reason: string }

/** Called from actions.ts immediately before an action fires (act time). */
export function verifyBeforeAction(selector: string, el: Element): WitnessResult {
  const recorded = planTimeSignatures.get(selector)
  const now = signatureOf(el)

  if (!recorded) {
    return { ok: false, reason: 'no plan-time record for this element' }
  }
  if (recorded.tag !== now.tag) {
    return { ok: false, reason: `element type changed (${recorded.tag} -> ${now.tag})` }
  }
  if (recorded.label && now.label && recorded.label !== now.label) {
    return { ok: false, reason: `label changed ("${recorded.label}" -> "${now.label}")` }
  }
  if (recorded.rectBucket !== now.rectBucket) {
    return { ok: false, reason: 'element moved since it was observed' }
  }
  return { ok: true }
}

const SENSITIVE_WORDS =
  /\b(submit|confirm|pay|checkout|delete|remove|send|place\s*order|transfer|approve|authorize|buy\s*now)\b/i

/** Deterministic, keyword-based irreversibility check — no model call. */
export function isSensitiveAction(labelText: string): boolean {
  return SENSITIVE_WORDS.test(labelText)
}

/**
 * OPTIONAL second witness: crop the element and ask the local VLM what it
 * reads on it, independent of the DOM. Off by default (see actions.ts) —
 * enable once the structural check above is verified working. Requires
 * the OFFSCREEN_READ_CROP handler added in offscreen/main.ts.
 */
export async function requestCropVerification(
  screenshotDataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
): Promise<{ ok: boolean; readText?: string; error?: string }> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_READ_CROP',
      screenshotDataUrl,
      rect,
    })) as { ok?: boolean; text?: string; error?: string }
    if (!response?.ok) return { ok: false, error: response?.error || 'crop check failed' }
    return { ok: true, readText: response.text }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
