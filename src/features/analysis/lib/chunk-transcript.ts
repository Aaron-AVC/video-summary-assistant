import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

export type TranscriptChunk = {
  id: string
  index: number
  startSec: number
  endSec: number
  cues: TranscriptCue[]
  text: string
}

export function createTranscriptChunkCueRanges(chunks: TranscriptChunk[]): Array<{
  cueStartIndex: number
  cueEndIndex: number
}> {
  let cueStartIndex = 0
  return chunks.map((chunk) => {
    const cueEndIndex = cueStartIndex + chunk.cues.length
    const range = { cueStartIndex, cueEndIndex }
    cueStartIndex = cueEndIndex
    return range
  })
}

export function createTranscriptChunk(index: number, cues: TranscriptCue[]): TranscriptChunk {
  const firstCue = cues[0]
  const lastCue = cues[cues.length - 1]

  return {
    id: `chunk-${index + 1}`,
    index,
    startSec: firstCue.startSec,
    endSec: lastCue.endSec,
    cues,
    text: cues.map((cue) => cue.text).join("\n")
  }
}
