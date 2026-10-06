import { describe, expect, it } from "bun:test"

import {
  parseAnalysisResult,
  parseAskVideoAnswer
} from "@/features/analysis/lib/analysis-schema"

describe("analysisResultSchema", () => {
  it("accepts valid structured analysis payloads", () => {
    expect(
      parseAnalysisResult({
        summary: "A concise summary.",
        keyPoints: [
          {
            text: "Point one",
            startSec: 4,
            endSec: 18
          }
        ],
        topics: [
          {
            label: "Topic",
            startSec: 0,
            endSec: 30
          }
        ],
        segments: [
          {
            title: "Opening",
            summary: "Introduces the topic",
            startSec: 0,
            endSec: 30
          }
        ]
      })
    ).toEqual(
      expect.objectContaining({
        summary: "A concise summary.",
        keyPoints: [
          {
            text: "Point one",
            startSec: 4,
            endSec: 18
          }
        ],
        moments: [
          {
            title: "Opening",
            summary: "Introduces the topic",
            startSec: 0,
            endSec: 30
          }
        ]
      })
    )
  })

  it("defaults topics when the model omits them", () => {
    expect(
      parseAnalysisResult({
        summary: "A concise summary.",
        keyPoints: [
          {
            text: "Point one",
            startSec: 4,
            endSec: 18
          }
        ],
        segments: [
          {
            title: "Opening",
            summary: "Introduces the topic",
            startSec: 0,
            endSec: 30
          }
        ]
      }).topics
    ).toEqual([])
  })

  it("falls back to segments when moments are empty", () => {
    expect(
      parseAnalysisResult({
        summary: "A concise summary.",
        keyPoints: [
          {
            text: "Point one",
            startSec: 4,
            endSec: 18
          }
        ],
        topics: [],
        moments: [],
        segments: [
          {
            title: "Opening",
            summary: "Introduces the topic",
            startSec: 0,
            endSec: 30
          }
        ]
      }).moments
    ).toEqual([
      {
        title: "Opening",
        summary: "Introduces the topic",
        startSec: 0,
        endSec: 30
      }
    ])
  })

  it("normalizes legacy string key points and topics", () => {
    expect(
      parseAnalysisResult({
        summary: "A concise summary.",
        keyPoints: ["Point one"],
        topics: ["Topic"],
        segments: [
          {
            title: "Opening",
            summary: "Introduces the topic",
            startSec: 0,
            endSec: 30
          }
        ]
      })
    ).toEqual(
      expect.objectContaining({
        keyPoints: [{ text: "Point one" }],
        topics: [{ label: "Topic" }]
      })
    )
  })

  it("rejects empty arrays and blank text", () => {
    expect(() =>
      parseAnalysisResult({
        summary: "",
        keyPoints: [],
        topics: [],
        segments: []
      })
    ).toThrow()
  })

  it("rejects segments whose end time precedes the start time", () => {
    expect(() =>
      parseAnalysisResult({
        summary: "A concise summary.",
        keyPoints: [
          {
            text: "Point one",
            startSec: 4,
            endSec: 18
          }
        ],
        topics: [],
        segments: [
          {
            title: "Opening",
            summary: "Introduces the topic",
            startSec: 45,
            endSec: 30
          }
        ]
      })
    ).toThrow("End time must be greater than or equal to start time")
  })

  it("rejects malformed key point and topic ranges", () => {
    expect(() =>
      parseAnalysisResult({
        summary: "A concise summary.",
        keyPoints: [
          {
            text: "Point one",
            startSec: 30,
            endSec: 18
          }
        ],
        topics: [],
        segments: [
          {
            title: "Opening",
            summary: "Introduces the topic",
            startSec: 0,
            endSec: 30
          }
        ]
      })
    ).toThrow("End time must be greater than or equal to start time")

    expect(() =>
      parseAnalysisResult({
        summary: "A concise summary.",
        keyPoints: [
          {
            text: "Point one",
            startSec: 4,
            endSec: 18
          }
        ],
        topics: [
          {
            label: "Topic",
            startSec: 0
          }
        ],
        segments: [
          {
            title: "Opening",
            summary: "Introduces the topic",
            startSec: 0,
            endSec: 30
          }
        ]
      })
    ).toThrow("Start and end time must be provided together")
  })

  it("accepts structured Ask AI answers with citations and jumps", () => {
    expect(
      parseAskVideoAnswer({
        answer: "The demo starts after the setup.",
        citations: [
          {
            text: "Demo begins",
            startSec: 42,
            endSec: 58
          }
        ],
        suggestedJumps: [
          {
            title: "Watch the demo",
            reason: "This is where the visual walkthrough starts.",
            startSec: 42,
            endSec: 58
          }
        ],
        followUps: ["What tools are used?"]
      })
    ).toEqual(
      expect.objectContaining({
        answer: "The demo starts after the setup.",
        citations: [
          {
            text: "Demo begins",
            startSec: 42,
            endSec: 58
          }
        ]
      })
    )
  })

  it("rejects Ask AI answers without citation ranges", () => {
    expect(() =>
      parseAskVideoAnswer({
        answer: "The demo starts after the setup.",
        citations: [
          {
            text: "Demo begins"
          }
        ]
      })
    ).toThrow()
  })
})
