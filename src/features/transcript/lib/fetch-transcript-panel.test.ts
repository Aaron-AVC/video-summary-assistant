import { describe, expect, it } from "bun:test"

import { fetchTranscriptPanel } from "./fetch-transcript-panel"

const METADATA = {
  videoId: "video-1",
  title: "Video 1",
  tracks: [
    {
      languageCode: "en",
      baseUrl: "https://www.youtube.com/api/timedtext?v=video-1&lang=en",
      name: "English",
    },
  ],
  captionsAvailable: true,
  transcriptPanel: {
    endpointUrl: "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false&key=test-key",
    params: "transcript-params",
    clientName: "1",
    clientVersion: "2.20260310.01.00",
    visitorData: "visitor-data",
    context: {
      client: {
        clientName: "WEB",
        clientVersion: "2.20260310.01.00",
      },
    },
  },
}

describe("fetchTranscriptPanel", () => {
  it("returns null when transcript panel bootstrap is unavailable", async () => {
    const result = await fetchTranscriptPanel({
      metadata: {
        ...METADATA,
        transcriptPanel: null,
      },
      pageUrl: "https://www.youtube.com/watch?v=video-1",
    })

    expect(result).toBeNull()
  })

  it("converts transcript panel segments into VTT", async () => {
    const result = await fetchTranscriptPanel({
      metadata: METADATA,
      pageUrl: "https://www.youtube.com/watch?v=video-1",
      fetchImpl: async (_input, init) => {
        expect(init?.method).toBe("POST")
        expect(init?.credentials).toBe("include")
        expect(init?.headers).toEqual({
          "Content-Type": "application/json",
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com/watch?v=video-1",
          "X-Goog-Visitor-Id": "visitor-data",
          "X-Youtube-Client-Name": "1",
          "X-Youtube-Client-Version": "2.20260310.01.00",
        })

        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              actions: [
                {
                  updateEngagementPanelAction: {
                    content: {
                      transcriptRenderer: {
                        content: {
                          transcriptSearchPanelRenderer: {
                            body: {
                              transcriptSegmentListRenderer: {
                                initialSegments: [
                                  {
                                    transcriptSegmentRenderer: {
                                      startMs: "0",
                                      endMs: "1200",
                                      snippet: {
                                        runs: [{ text: "Hello world" }],
                                      },
                                    },
                                  },
                                  {
                                    transcriptSegmentRenderer: {
                                      startMs: "1500",
                                      endMs: "2300",
                                      snippet: {
                                        runs: [{ text: "Second line" }],
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            }),
        }
      },
    })

    expect(result?.ok).toBe(true)

    if (result?.ok) {
      expect(result.sourceUrl).toContain("get_transcript")
      expect(result.track.languageCode).toBe("en")
      expect(result.rawVtt).toContain("WEBVTT")
      expect(result.rawVtt).toContain("Hello world")
      expect(result.rawVtt).toContain("Second line")
    }
  })
})
