/**
 * Declared upper bounds for every Zod container that parses untrusted or
 * externally-derived data.
 *
 * Why these exist as named constants instead of inline numbers:
 *
 * 1. `GHSA-mrhx-c7xc-m3w5` / `CWE-770`. Zod versions before 4.6.6 validated
 *    every array element and *then* checked `.max()`, so a bounded schema could
 *    still accumulate one issue per element — an O(N) memory amplification
 *    controlled by whoever supplied the payload. Zod 4.6.6 and later reject an
 *    oversized bounded container *before* element validation, but only when an
 *    explicit bound is declared. An unbounded container still walks every
 *    element.
 *
 * 2. Each number below is deliberately far above any legitimate product output
 *    while still rejecting a hostile payload long before it can exhaust memory.
 *    The product rationale is recorded next to each constant so a future reader
 *    can tell whether a schema change invalidates the bound.
 *
 * Bounds are intentionally generous. They are a safety ceiling, not a business
 * rule: shrinking one of these is a product decision, not a security tweak.
 */

/**
 * Analysis key points for one video.
 *
 * A two-hour video normally yields 5–30 key points. Even a ten-hour lecture
 * stays well under 100. 200 keeps a comfortable margin without letting a
 * provider response grow without limit.
 */
export const MAX_ANALYSIS_KEY_POINTS = 200

/**
 * Analysis chapters for one video.
 *
 * Chapters are coarser than key points: 3–20 is normal even for a long video.
 * 100 is five times the densest realistic output.
 */
export const MAX_ANALYSIS_CHAPTERS = 100

/**
 * Evidence citations in one Ask answer.
 *
 * A well-formed answer cites the spans that support its claims — normally 1–10.
 * 50 allows an unusually thorough answer without allowing an unbounded list.
 */
export const MAX_ASK_CITATIONS = 50

/**
 * Suggested timestamp jumps in one Ask answer.
 *
 * These are UI shortcuts, not evidence: a handful per answer is normal.
 */
export const MAX_ASK_SUGGESTED_JUMPS = 20

/**
 * Follow-up question suggestions in one Ask answer.
 *
 * Same shape as suggested jumps: a short list of UI affordances.
 */
export const MAX_ASK_FOLLOW_UPS = 20

/**
 * Transcript cues for one video, whether carried over the runtime message
 * channel or read back from a persisted snapshot.
 *
 * This is the densest legitimate payload in the product. Realistic caption
 * granularity is 2–4 seconds per cue, so a 24-hour captioned stream is roughly
 * 20k–40k cues; even a pathological 1-second-per-cue encoder stays under 50,000
 * for any video shorter than ~14 hours. That covers every plausible product use
 * while keeping a page-supplied array bounded.
 */
export const MAX_TRANSCRIPT_CUES = 50_000

/**
 * Legacy analysis key points, topics, segments, and moments.
 *
 * Only reachable through the legacy model-shape adapter. Bounded to the same
 * ceilings as the canonical contract so re-enabling that path cannot
 * reintroduce an unbounded container.
 */
export const MAX_LEGACY_ANALYSIS_KEY_POINTS = MAX_ANALYSIS_KEY_POINTS
export const MAX_LEGACY_ANALYSIS_TOPICS = MAX_ANALYSIS_CHAPTERS
export const MAX_LEGACY_ANALYSIS_SEGMENTS = MAX_ANALYSIS_CHAPTERS

/**
 * Persisted analysis rows re-read from IndexedDB.
 *
 * A stored run is produced from the same canonical contract as a fresh provider
 * response, so it inherits the same ceilings. Rows written before those ceilings
 * existed are re-validated on read; anything above the ceiling is treated as a
 * corrupt row by the existing `try { parse } catch { skip }` call sites rather
 * than being loaded into memory element by element.
 */
export const MAX_PERSISTED_KEY_POINTS = MAX_ANALYSIS_KEY_POINTS
export const MAX_PERSISTED_TOPICS = MAX_ANALYSIS_CHAPTERS

/**
 * Rows per table in a local-data export snapshot.
 *
 * This is a whole-database projection, not a per-video one. A heavy user with
 * thousands of analysed videos is expected; 100,000 rows per table is far above
 * any realistic history while still bounding the array before validation.
 */
export const MAX_EXPORTED_ROWS_PER_TABLE = 100_000

