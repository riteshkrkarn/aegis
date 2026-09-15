/**
 * Privacy & Integrity Certificate.
 *
 * A small, locally-hashed audit record for one task run: hashes of the
 * page markdown before/after masking, how many fields were tokenized
 * (never their values), which DOM-present-but-hidden nodes were filtered
 * out before reaching the LLM, every Two-Witness pass/fail, and whether
 * the run was answered from Muscle Memory instead of the server. Export
 * it as JSON and compare it against DevTools → Network, live, in front
 * of a judge: "here's proof of what left the device, not just a claim."
 *
 * Uses only the browser's built-in Web Crypto API — no new dependency,
 * no server round-trip. NOTE: this is a SHA-256 integrity hash, which
 * proves the record wasn't edited after the fact within a session — it
 * is not a full asymmetric signature / non-repudiation scheme. A natural
 * next step (not needed for the demo) is signing with a per-install
 * keypair via crypto.subtle.generateKey.
 */
import type { WitnessLogEntry, HiddenNodeLog } from './types'

export interface LedgerStepInput {
  step: number
  beforeMarkdown: string
  afterMarkdown: string
  tokensIssued: number
  hiddenNodesFiltered: HiddenNodeLog[]
  witnessChecks: WitnessLogEntry[]
  skillReplayed?: boolean
}

export interface LedgerEntry {
  step: number
  timestamp: string
  beforeMarkdownHash: string
  afterMarkdownHash: string
  tokensIssued: number
  hiddenNodesFiltered: HiddenNodeLog[]
  witnessChecks: WitnessLogEntry[]
  skillReplayed: boolean
}

export interface Certificate {
  task: string
  startedAt: string
  finishedAt: string
  steps: LedgerEntry[]
  summary: {
    totalTokensIssued: number
    totalHiddenNodesFiltered: number
    totalWitnessFailures: number
    anyStepReplayedFromSkillMemory: boolean
  }
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export class IntegrityLedger {
  private entries: LedgerEntry[] = []
  private task: string
  private startedAt: string

  constructor(task: string) {
    this.task = task
    this.startedAt = new Date().toISOString()
  }

  async recordStep(input: LedgerStepInput): Promise<void> {
    this.entries.push({
      step: input.step,
      timestamp: new Date().toISOString(),
      beforeMarkdownHash: await sha256(input.beforeMarkdown),
      afterMarkdownHash: await sha256(input.afterMarkdown),
      tokensIssued: input.tokensIssued,
      hiddenNodesFiltered: input.hiddenNodesFiltered,
      witnessChecks: input.witnessChecks,
      skillReplayed: input.skillReplayed ?? false,
    })
  }

  toCertificate(): Certificate {
    return {
      task: this.task,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      steps: this.entries,
      summary: {
        totalTokensIssued: this.entries.reduce((s, e) => s + e.tokensIssued, 0),
        totalHiddenNodesFiltered: this.entries.reduce(
          (s, e) => s + e.hiddenNodesFiltered.length,
          0,
        ),
        totalWitnessFailures: this.entries.reduce(
          (s, e) => s + e.witnessChecks.filter((w) => !w.ok).length,
          0,
        ),
        anyStepReplayedFromSkillMemory: this.entries.some((e) => e.skillReplayed),
      },
    }
  }

  /** SHA-256 of the whole certificate JSON — the hash you show on stage. */
  async toSignedExport(): Promise<{ certificate: Certificate; sha256: string }> {
    const certificate = this.toCertificate()
    const json = JSON.stringify(certificate)
    return { certificate, sha256: await sha256(json) }
  }
}
