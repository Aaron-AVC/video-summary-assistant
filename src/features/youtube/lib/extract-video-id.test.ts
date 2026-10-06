import { describe, expect, it } from "bun:test"

import { extractVideoId } from "./extract-video-id"

const VIDEO_ID = "dQw4w9WgXcQ"

describe("extractVideoId", () => {
  it("accepts raw IDs and common YouTube URL shapes", () => {
    expect(extractVideoId(`  ${VIDEO_ID}  `)).toBe(VIDEO_ID)
    expect(extractVideoId(`https://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID)
    expect(extractVideoId(`https://m.youtube.com/watch?v=${VIDEO_ID}&t=42s`)).toBe(VIDEO_ID)
    expect(extractVideoId(`https://youtu.be/${VIDEO_ID}?si=abc`)).toBe(VIDEO_ID)
    expect(extractVideoId(`https://www.youtube.com/embed/${VIDEO_ID}`)).toBe(VIDEO_ID)
    expect(extractVideoId(`https://www.youtube.com/shorts/${VIDEO_ID}`)).toBe(VIDEO_ID)
    expect(extractVideoId(`https://www.youtube.com/live/${VIDEO_ID}`)).toBe(VIDEO_ID)
  })

  it("rejects invalid hosts malformed IDs and missing parameters", () => {
    expect(extractVideoId("")).toBeNull()
    expect(extractVideoId("https://example.com/watch?v=123")).toBeNull()
    expect(extractVideoId(`https://www.notyoutube.com/watch?v=${VIDEO_ID}`)).toBeNull()
    expect(extractVideoId("https://www.youtube.com/watch?v=short")).toBeNull()
    expect(extractVideoId("https://www.youtube.com/watch")).toBeNull()
    expect(extractVideoId("not a url")).toBeNull()
  })
})
