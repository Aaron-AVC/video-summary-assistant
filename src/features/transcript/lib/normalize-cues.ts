import type { ParsedVttCue, TranscriptCue } from "./transcript-schema"

export function normalizeCues(cues: ParsedVttCue[]): TranscriptCue[] {
  return cues
    .map((cue) => ({
      startSec: cue.startSec,
      endSec: cue.endSec,
      text: normalizeCueText(cue.text),
    }))
    .filter((cue) => Boolean(cue.text))
}

export function normalizeCueText(text: string): string {
  return decodeEntities(stripTags(text))
    .replace(/\s+/g, " ")
    .trim()
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, " ")
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
