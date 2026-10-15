import { describe, expect, it } from "bun:test"

import {
  compareAskTranscriptIdentity,
  filterQaThreadsByTranscript,
  matchesAskRequestWorkspaceIdentity,
  resolveAskTranscriptRequestIdentity,
  resolveAskTranscriptFingerprint,
} from "@/sidepanel/lib/ask-transcript-identity"

describe("Ask transcript identity", () => {
  const cues = [{ startSec: 0, endSec: 2, text: "Current transcript" }]

  it("distinguishes matching, mismatched, legacy, and not-yet-known analysis identity", () => {
    expect(compareAskTranscriptIdentity({ analysisFingerprint: "fp-1", currentFingerprint: "fp-1" })).toBe("match")
    expect(compareAskTranscriptIdentity({ analysisFingerprint: "fp-1", currentFingerprint: "fp-2" })).toBe("mismatch")
    expect(compareAskTranscriptIdentity({ analysisFingerprint: null, currentFingerprint: "fp-2" })).toBe("match")
    expect(compareAskTranscriptIdentity({ analysisFingerprint: "fp-1", currentFingerprint: null })).toBe("unknown")
  })

  it("uses the fingerprint of the actual cues when persisted state is stale", async () => {
    const actual = await resolveAskTranscriptFingerprint({
      currentFingerprint: "old-fingerprint",
      transcriptCues: cues,
    })
    expect(actual).not.toBe("old-fingerprint")
    expect(await resolveAskTranscriptFingerprint({
      currentFingerprint: actual,
      transcriptCues: cues,
    })).toBe(actual)
  })

  it("uses the actual cue fingerprint for the Ask request and rejects a modern mismatch", async () => {
    const actual = await resolveAskTranscriptFingerprint({ currentFingerprint: null, transcriptCues: cues })
    await expect(resolveAskTranscriptRequestIdentity({
      analysisFingerprint: actual,
      currentFingerprint: "stale",
      transcriptCues: cues,
      contentMatches: true,
    })).resolves.toEqual({ ok: true, transcriptFingerprint: actual })
    await expect(resolveAskTranscriptRequestIdentity({
      analysisFingerprint: "different-analysis",
      currentFingerprint: actual,
      transcriptCues: cues,
      contentMatches: true,
    })).resolves.toEqual({ ok: false, reason: "transcript-mismatch" })
  })

  it("does not restore or reuse threads from another transcript", () => {
    const threads = [
      { id: "fp-1", transcriptFingerprint: "fp-1" },
      { id: "fp-2", transcriptFingerprint: "fp-2" },
    ]
    expect(filterQaThreadsByTranscript(threads, "fp-2")).toEqual([threads[1]])
    expect(filterQaThreadsByTranscript(threads, null)).toEqual([])
    expect(matchesAskRequestWorkspaceIdentity({
      contentKey: "youtube:video",
      analysisRunId: "run-1",
      threadId: "thread-1",
      transcriptFingerprint: "fp-1",
    }, {
      contentKey: "youtube:video",
      analysisRunId: "run-1",
      threadId: "thread-1",
      transcriptFingerprint: "fp-2",
    })).toBe(false)
    expect(matchesAskRequestWorkspaceIdentity({
      contentKey: "youtube:video",
      analysisRunId: "run-1",
      threadId: "thread-1",
      transcriptFingerprint: "fp-1",
    }, {
      contentKey: "youtube:video",
      analysisRunId: "run-1",
      threadId: "thread-1",
      transcriptFingerprint: "fp-1",
    })).toBe(true)
  })

  it("allows legacy analysis only when a current transcript is available", async () => {
    const actual = await resolveAskTranscriptFingerprint({ currentFingerprint: null, transcriptCues: cues })
    await expect(resolveAskTranscriptRequestIdentity({
      analysisFingerprint: null,
      currentFingerprint: null,
      transcriptCues: cues,
      contentMatches: true,
    })).resolves.toEqual({ ok: true, transcriptFingerprint: actual })
    await expect(resolveAskTranscriptRequestIdentity({
      analysisFingerprint: null,
      currentFingerprint: null,
      transcriptCues: [],
      contentMatches: true,
    })).resolves.toEqual({ ok: false, reason: "transcript-unavailable" })
  })
})
