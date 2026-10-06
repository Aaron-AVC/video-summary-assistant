import { describe, expect, it, mock } from "bun:test"

import { copyDiagnosticLogsToClipboard } from "@/features/settings/components/diagnostic-log"
import type { TranscriptLogEntry } from "@/features/transcript/lib/transcript-log"

const sampleLog: TranscriptLogEntry = {
  videoId: "abc123",
  pageUrl: "https://www.youtube.com/watch?v=abc123",
  timestamp: "2026-05-04T00:00:00.000Z",
  outcome: "success",
  successStep: "fetchVtt",
  steps: [
    {
      step: "fetchVtt",
      durationMs: 12,
      ok: true,
    },
  ],
}

describe("copyDiagnosticLogsToClipboard", () => {
  it("calls notifySuccess after a successful clipboard write", async () => {
    const write = mock(async () => {})
    const notifySuccess = mock((_message: string) => {})
    const notifyError = mock((_message: string) => {})

    await copyDiagnosticLogsToClipboard([sampleLog], {
      write,
      notifySuccess,
      notifyError,
    })

    expect(write).toHaveBeenCalledTimes(1)
    expect(notifySuccess).toHaveBeenCalledTimes(1)
    expect(notifyError).not.toHaveBeenCalled()
    expect(notifySuccess.mock.calls[0]?.[0]).toContain("Copied 1 diagnostic entry")
  })

  it("surfaces a toast.error when navigator.clipboard.writeText rejects", async () => {
    const write = mock(async () => {
      throw new Error("Clipboard permission denied")
    })
    const notifySuccess = mock((_message: string) => {})
    const notifyError = mock((_message: string) => {})

    await copyDiagnosticLogsToClipboard([sampleLog], {
      write,
      notifySuccess,
      notifyError,
    })

    expect(notifySuccess).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalledTimes(1)
    expect(notifyError.mock.calls[0]?.[0]).toContain("Clipboard permission denied")
  })

  it("falls back to a generic message for non-Error rejection values", async () => {
    const write = mock(async () => {
      throw "permission-denied"
    })
    const notifyError = mock((_message: string) => {})

    await copyDiagnosticLogsToClipboard([], {
      write,
      notifySuccess: () => {},
      notifyError,
    })

    expect(notifyError).toHaveBeenCalledTimes(1)
    expect(notifyError.mock.calls[0]?.[0]).toBe(
      "Could not copy diagnostic logs to the clipboard.",
    )
  })
})
