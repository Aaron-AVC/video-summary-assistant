import type { ParsedVttCue } from "./transcript-schema"

const TIMING_SEPARATOR = "-->"

export function parseVtt(rawVtt: string): ParsedVttCue[] {
  const lines = rawVtt.replace(/\r\n/g, "\n").split("\n")
  const cues: ParsedVttCue[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ""

    if (!line || line === "WEBVTT" || line.startsWith("NOTE")) {
      continue
    }

    const identifier = line.includes(TIMING_SEPARATOR) ? undefined : line
    const timingLine = identifier ? (lines[index + 1]?.trim() ?? "") : line

    if (!timingLine.includes(TIMING_SEPARATOR)) {
      continue
    }

    const [startToken, endToken] = timingLine
      .split(TIMING_SEPARATOR)
      .map((token) => token.trim().split(/[\s]/)[0])

    const startSec = parseTimestamp(startToken)
    const endSec = parseTimestamp(endToken)
    const textLines: string[] = []

    index += identifier ? 2 : 1

    while (index < lines.length && lines[index]?.trim()) {
      textLines.push(lines[index] ?? "")
      index += 1
    }

    cues.push({
      identifier,
      startSec,
      endSec,
      text: textLines.join("\n"),
    })
  }

  return cues
}

export function parseTimestamp(token: string): number {
  const parts = token.split(":")

  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`Invalid VTT timestamp: ${token}`)
  }

  const [hoursPart, minutesPart, secondsPart] =
    parts.length === 3 ? parts : ["0", parts[0] ?? "0", parts[1] ?? "0"]

  const hours = Number(hoursPart)
  const minutes = Number(minutesPart)
  const seconds = Number(secondsPart)

  if ([hours, minutes, seconds].some((value) => Number.isNaN(value))) {
    throw new Error(`Invalid VTT timestamp: ${token}`)
  }

  return hours * 3600 + minutes * 60 + seconds
}
