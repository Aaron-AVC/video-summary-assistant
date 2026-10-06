import { describe, expect, it } from "bun:test"

import { chunkTranscript } from "@/features/analysis/lib/chunk-transcript"

describe("chunkTranscript", () => {
  it("splits long transcripts into bounded chunks", () => {
    const chunks = chunkTranscript(
      [
        { startSec: 0, endSec: 5, text: "alpha beta gamma" },
        { startSec: 5, endSec: 10, text: "delta epsilon zeta" },
        { startSec: 10, endSec: 15, text: "eta theta iota" }
      ],
      {
        maxCharacters: 25
      }
    )

    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual(
      expect.objectContaining({
        id: "chunk-1",
        startSec: 0,
        endSec: 5,
        text: "alpha beta gamma"
      })
    )
    expect(chunks[2]).toEqual(
      expect.objectContaining({
        id: "chunk-3",
        startSec: 10,
        endSec: 15
      })
    )
  })

  it("starts a new chunk when maxCues is reached", () => {
    const chunks = chunkTranscript(
      [
        { startSec: 0, endSec: 5, text: "alpha" },
        { startSec: 5, endSec: 10, text: "beta" },
        { startSec: 10, endSec: 15, text: "gamma" }
      ],
      {
        maxCues: 2,
        maxCharacters: 100
      }
    )

    expect(chunks).toEqual([
      expect.objectContaining({
        id: "chunk-1",
        startSec: 0,
        endSec: 10,
        text: "alpha\nbeta"
      }),
      expect.objectContaining({
        id: "chunk-2",
        startSec: 10,
        endSec: 15,
        text: "gamma"
      })
    ])
  })

  it("keeps an oversized cue intact in its own chunk", () => {
    const oversizedCue = "x".repeat(50)

    const chunks = chunkTranscript(
      [
        { startSec: 0, endSec: 5, text: oversizedCue },
        { startSec: 5, endSec: 8, text: "tail" }
      ],
      {
        maxCharacters: 10,
        maxCues: 5
      }
    )

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual(
      expect.objectContaining({
        startSec: 0,
        endSec: 5,
        text: oversizedCue
      })
    )
  })

  it("returns an empty list when no cues exist", () => {
    expect(chunkTranscript([])).toEqual([])
  })
})
