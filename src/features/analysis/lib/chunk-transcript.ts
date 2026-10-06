import type { TranscriptCue } from "@/features/transcript/lib/transcript-schema"

export type TranscriptChunk = {
  id: string
  index: number
  startSec: number
  endSec: number
  cues: TranscriptCue[]
  text: string
}

export type ChunkTranscriptOptions = {
  maxCharacters?: number
  maxCues?: number
}

const DEFAULT_MAX_CHARACTERS = 2_400
const DEFAULT_MAX_CUES = 40

export function chunkTranscript(
  cues: TranscriptCue[],
  options: ChunkTranscriptOptions = {}
): TranscriptChunk[] {
  if (cues.length === 0) {
    return []
  }

  const maxCharacters = Math.max(1, options.maxCharacters ?? DEFAULT_MAX_CHARACTERS)
  const maxCues = Math.max(1, options.maxCues ?? DEFAULT_MAX_CUES)
  const chunks: TranscriptChunk[] = []
  let currentCues: TranscriptCue[] = []
  let currentCharacters = 0

  for (const cue of cues) {
    const cueLength = cue.text.length
    const wouldOverflow =
      currentCues.length > 0 &&
      (currentCharacters + cueLength > maxCharacters || currentCues.length >= maxCues)

    if (wouldOverflow) {
      chunks.push(createChunk(chunks.length, currentCues))
      currentCues = []
      currentCharacters = 0
    }

    currentCues.push(cue)
    currentCharacters += cueLength
  }

  if (currentCues.length > 0) {
    chunks.push(createChunk(chunks.length, currentCues))
  }

  return chunks
}

function createChunk(index: number, cues: TranscriptCue[]): TranscriptChunk {
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
