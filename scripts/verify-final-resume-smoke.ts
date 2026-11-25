/**
 * M3 Side Panel interaction smoke.
 *
 * This is NOT a unit test. It loads the real production extension artifact into
 * Chrome for Testing, serves a stub YouTube watch page and a stub
 * OpenAI-compatible provider, and drives the actual Side Panel buttons:
 *
 *   Generate -> 5 Map calls -> Final returns HTTP 502 -> "Continue final summary"
 *   -> exactly one Final call -> the analysis is saved and re-renders.
 *
 * --scenario refresh and --scenario reopen stop at the eligible checkpoint and
 * instead verify that a real panel reload / target destruction loses the entry,
 * never starts a provider request, and never persists intermediate summaries.
 * Reopen additionally seeds a normal completed history record before creating
 * the 502, requires that record to survive target destruction, then starts a
 * fresh full analysis on a distinct video.
 * Each invocation owns a new isolated Chrome profile.
 *
 * The provider is a local mock; no paid request is made. The script prints one
 * JSON evidence line and exits non-zero on any failed assertion. Secret-bearing
 * provider settings are represented only by their Chrome Storage keys.
 *
 * Run:
 *   bun scripts/verify-final-resume-smoke.ts --chrome "<chrome.exe>" \\
 *     --artifact build/chrome-mv3-prod
 *
 * ---------------------------------------------------------------------------
 * Why the stub is shaped the way it is (each item is a production rule, not a
 * convenience choice):
 *
 * 1. The video id is exactly 11 characters. `extractVideoId` in
 *    `src/features/youtube/lib/extract-video-id.ts` enforces
 *    /^[a-zA-Z0-9_-]{11}$/, while `getVideoIdentity` only checks scheme/host/path
 *    and the presence of `v`. A 12-character fixture therefore satisfies
 *    `getVideoIdentity` but makes `readPageMetadata` throw
 *    "Unable to resolve a canonical YouTube video ID.", which sends
 *    `readActiveVideoContext` down its catch branch and pins `isReady` to false
 *    forever. The fixture must be a legal id so the production adapter is
 *    exercised instead of its fallback.
 *
 * 2. `ytInitialPlayerResponse` is embedded in the served HTML because
 *    `readPageMetadata` scrapes it out of the document source to discover
 *    caption tracks. It must agree with the URL id or `readPageMetadata`
 *    discards the tracks.
 *
 * 3. The caption base URL is `https://www.youtube.com/api/timedtext?...`, not a
 *    loopback URL. The content script fetches from the page's own https origin,
 *    so an `http://127.0.0.1` caption URL would be blocked as mixed content
 *    before any stub could answer. Serving it under the youtube.com origin also
 *    keeps the request same-origin, so no CORS transition is introduced.
 *
 * 4. The provider also lives on `https://www.youtube.com/v1`. The mock must be
 *    reachable from the extension origin without a runtime permission prompt:
 *    `assertProviderHostPermission` asks `chrome.permissions.contains` for the
 *    provider origin, and the artifact already declares
 *    `https://www.youtube.com/*` in `host_permissions`. A loopback provider
 *    would sit in `optional_host_permissions` and fail that check, which is a
 *    real product guard this smoke must not bypass.
 *
 * 5. The transcript is 10 cues of ~9.8 KB each. The production planner
 *    (`planTranscriptChunks` + `DEFAULT_ANALYSIS_BUDGET_POLICY`) then yields
 *    exactly 5 Map chunks and a Final prompt that fits without any Reduction
 *    level, which is the shape this smoke asserts. The mock answers the same
 *    bytes on every request, so the transcript fingerprint is stable and a
 *    resume cannot be mistaken for a different transcript.
 *
 * 6. The player surface (`getVideoData`/`getOption`) is installed in the page's
 *    MAIN world: the background reads live player state through
 *    `chrome.scripting.executeScript({world:"MAIN"})`. It is installed twice, by
 *    an inline script and again through CDP, so a document that strips inline
 *    script still ends up with the same surface. Either way the DOM fallbacks
 *    (`ytd-watch-metadata h1`, `#owner a`) remain as the production second line
 *    of defence.
 * ---------------------------------------------------------------------------
 */

import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  DEFAULT_ARTIFACT_DIR,
  buildChromeArgs,
  planCleanup,
  parseArtifactManifest,
  resolveBackgroundScriptPath,
  resolveExtensionPagePath,
  selectExtensionTargets,
  validateChromePath,
  type CdpTarget,
} from "./lib/artifact-gate-policy"
import {
  CdpConnection,
  waitForCdpEndpoint,
  waitForDevToolsPort,
} from "./lib/cdp-client"
import {
  actWhenSmokeReady,
  waitForSmokeCondition,
  waitForSmokeOutcome,
} from "./lib/smoke-condition"

type SmokeScenario = "golden" | "refresh" | "reopen" | "cancel" | "source-switch" | "tab-switch" | "destructive" | "retry"

type CliOptions = {
  artifactDir: string
  chromePath: string
  keepProfile: boolean
  scenario: SmokeScenario
}

function parseArgs(argv: string[]): CliOptions {
  let artifactDir = resolve(DEFAULT_ARTIFACT_DIR)
  let chromePath = process.env.VSA_CHROME_PATH ?? ""
  let keepProfile = false
  let scenario: SmokeScenario = "golden"
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--chrome") {
      chromePath = argv[index + 1] ?? ""
      index += 1
    } else if (arg === "--artifact") {
      artifactDir = resolve(argv[index + 1] ?? DEFAULT_ARTIFACT_DIR)
      index += 1
    } else if (arg === "--keep-profile") {
      keepProfile = true
    } else if (arg === "--scenario") {
      const value = argv[index + 1] ?? ""
      if (!["golden", "refresh", "reopen", "cancel", "source-switch", "tab-switch", "destructive", "retry"].includes(value)) {
        throw new Error("--scenario must be golden, refresh, reopen, cancel, source-switch, tab-switch, destructive, or retry.")
      }
      scenario = value as SmokeScenario
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!chromePath) {
    throw new Error("A Chrome for Testing executable is required: pass --chrome <path>.")
  }
  const validated = validateChromePath(chromePath, existsSync)
  if (!validated.ok) throw new Error((validated as { message: string }).message)
  return { artifactDir, chromePath: validated.path, keepProfile, scenario }
}

/* ------------------------------------------------------------------ fixtures */

/**
 * Must satisfy the production `/^[a-zA-Z0-9_-]{11}$/` video-id rule. See the
 * header note (1): a longer fixture silently disables the real adapter.
 */
const VIDEO_ID = "smokeVideo1"
const VIDEO_TITLE = "Smoke M3 Video"
const VIDEO_AUTHOR = "Smoke Author"

/** Cue padding chosen so the production planner produces exactly 5 Map chunks. */
const CUE_COUNT = 10
const CUE_PADDING_REPEATS = 1225
const CUE_SECONDS = 10

const CUES = Array.from({ length: CUE_COUNT }, (_, index) => ({
  startSec: index * CUE_SECONDS,
  endSec: (index + 1) * CUE_SECONDS,
  text: `${index} ${"caption ".repeat(CUE_PADDING_REPEATS)}`,
}))

const VIDEO_DURATION_SEC = CUES.at(-1)!.endSec

const VALID_ANALYSIS = JSON.stringify({
  summary: "Smoke resume summary.",
  keyPoints: [{ text: "Smoke point.", startSec: 0, endSec: 10 }],
  chapters: [{
    title: "Chapter One",
    startSec: 0,
    endSec: 10,
    summary: "Chapter one summary.",
    detail: "Chapter one detail.",
  }],
})

type ProviderKind = "map" | "reduction" | "final" | "repair" | "models"
type ProviderCall = { kind: ProviderKind, status: number, index: number }
type Deferred = { promise: Promise<void>, release: () => void }

function deferred(): Deferred {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

type SmokeState = {
  calls: ProviderCall[]
  /** Consume the first failure only when explicitly starting a retryable run. */
  failFirstFinal: boolean
  /** Reserved for a later scenario; the common first failure remains HTTP 502. */
  finalSequence: Array<502 | 503 | 504 | "invalid">
  /** Which CDP session's Fetch domain answered each intercepted class. */
  interceptTargets: Record<string, string>
  interceptCounts: Record<string, number>
  /** Test-side gates; never exposed to the production page or extension. */
  holdCancelFinal: Deferred | null
  holdLateFinal: Deferred | null
  cancelFinalStarted: Deferred
  lateFinalStarted: Deferred
  resumeTransientStatus: 503 | 504 | null
  resumeTransientRemaining: number
  /** Arm before cancellation/clearing so a delayed response stays intercepted. */
  releaseHeldResponse: Deferred | null
  heldFinalActive: boolean
  heldFinalRequest: { sessionId: string, requestId: string } | null
  heldFinalFulfilled: boolean
  heldFinalError: string | null
}

const TIMEDTEXT_PATH = "/api/timedtext"
const STUB_ORIGIN = "https://www.youtube.com"

/* --------------------------------------------------------- stub page assets */

/**
 * The player JSON `readPageMetadata` scrapes. `videoDetails.videoId` must equal
 * the URL id or the caption tracks are dropped (see header note 2).
 */
function stubPlayerResponse(videoId: string = VIDEO_ID) {
  return {
    videoDetails: {
      videoId,
      title: VIDEO_TITLE,
      author: VIDEO_AUTHOR,
      lengthSeconds: String(VIDEO_DURATION_SEC),
      isLiveContent: false,
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{
          // Same-origin (header note 3): the content script fetches this from the
          // stub page's own https origin.
          baseUrl: `${STUB_ORIGIN}${TIMEDTEXT_PATH}?v=${videoId}&lang=en`,
          languageCode: "en",
          kind: "",
          name: { simpleText: "English" },
        }],
      },
    },
  }
}

/**
 * The MAIN-world player surface. YouTube exposes these on #movie_player; the
 * background's live-state reader calls exactly these three members.
 */
const playerSurfaceScript = (videoId: string = VIDEO_ID) => `(() => {
  const player = document.getElementById("movie_player");
  if (!player) return false;
  player.getVideoData = () => ({
    videoId: ${JSON.stringify(videoId)},
    title: ${JSON.stringify(VIDEO_TITLE)},
    author: ${JSON.stringify(VIDEO_AUTHOR)}
  });
  player.getOption = (category, option) => {
    if (category === "captions" && option === "tracklist") {
      return [{ languageCode: "en", languageName: "English", displayName: "English", kind: "" }];
    }
    if (category === "captions" && option === "track") return null;
    return null;
  };
  player.isSubtitlesOn = () => false;
  return true;
})()`

/**
 * A watch document that mirrors the surfaces the production adapter reads:
 * #movie_player (live state), ytd-watch-metadata h1 (title), #owner anchor
 * (author), a <video> element, and ytInitialPlayerResponse for caption tracks.
 *
 * The inline player script is a belt-and-braces install; CDP re-applies the same
 * surface after load, so the test does not depend on inline script surviving.
 */
function stubWatchHtml(videoId: string): string {
  const player = JSON.stringify(stubPlayerResponse(videoId))
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<title>${VIDEO_TITLE} - YouTube</title>
<meta itemprop="duration" content="PT1M40S">
<script>window.ytInitialPlayerResponse = ${player};</script>
</head>
<body>
<div id="player" class="style-scope ytd-watch-flexy">
  <div id="movie_player" class="html5-video-player ytp-large-width-mode">
    <div class="html5-video-container">
      <video id="smoke-video" class="video-stream html5-main-video" muted playsinline></video>
    </div>
  </div>
</div>
<ytd-watch-metadata class="style-scope ytd-watch-flexy">
  <div id="title">
    <h1 class="style-scope ytd-watch-metadata"><yt-formatted-string>${VIDEO_TITLE}</yt-formatted-string></h1>
  </div>
  <div id="owner">
    <ytd-channel-name class="style-scope ytd-watch-metadata">
      <div id="container"><div id="text-container"><yt-formatted-string>
        <a class="yt-simple-endpoint style-scope yt-formatted-string" href="/@smokeauthor">${VIDEO_AUTHOR}</a>
      </yt-formatted-string></div></div>
    </ytd-channel-name>
  </div>
</ytd-watch-metadata>
<script>${playerSurfaceScript(videoId)}</script>
</body></html>`
}

/* ----------------------------------------------------- stub timedtext / VTT */

function vttTimestamp(seconds: number): string {
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0")
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")
  const secs = (seconds % 60).toFixed(3).padStart(6, "0")
  return `${hours}:${minutes}:${secs}`
}

/**
 * The unparameterised timedtext response. Production tries the observed base URL
 * first and only then appends `fmt`, so the default body is XML, exactly like
 * YouTube's own endpoint. `convertXmlTimedtextToVtt` reads `start`/`dur` in
 * seconds and multiplies by 1000.
 */
function timedTextXml(): string {
  const cues = CUES.map((cue) =>
    `<text start="${cue.startSec}" dur="${cue.endSec - cue.startSec}">${cue.text}</text>`
  ).join("")
  return `<?xml version="1.0" encoding="utf-8" ?><transcript>${cues}</transcript>`
}

function timedTextVtt(): string {
  const lines = ["WEBVTT", ""]
  for (const [index, cue] of CUES.entries()) {
    lines.push(
      String(index + 1),
      `${vttTimestamp(cue.startSec)} --> ${vttTimestamp(cue.endSec)}`,
      cue.text,
      "",
    )
  }
  return lines.join("\n")
}

function timedTextJson3(): string {
  return JSON.stringify({
    events: CUES.map((cue) => ({
      tStartMs: cue.startSec * 1000,
      dDurationMs: (cue.endSec - cue.startSec) * 1000,
      segs: [{ utf8: cue.text }],
    })),
  })
}

/* ------------------------------------------------------ stub provider logic */

/**
 * Classifies a provider request by its prompt text.
 *
 * Order matters: Repair prompts also contain "JSON only", so Repair is matched
 * before Final, and Reduction before Final because a reduction prompt never
 * carries the structured-output instructions.
 */
function classifyPrompt(text: string): ProviderKind {
  if (/You repair a structured video analysis response|Return only one valid JSON object/i.test(text)) {
    return "repair"
  }
  if (/Reduction level:/i.test(text)) return "reduction"
  if (/Partial analyses|Return JSON only with exactly these keys/i.test(text)) return "final"
  return "map"
}

function providerBody(kind: ProviderKind): string {
  if (kind === "final" || kind === "repair") {
    return JSON.stringify({
      choices: [{ message: { role: "assistant", content: VALID_ANALYSIS } }],
    })
  }
  return JSON.stringify({
    choices: [{ message: { role: "assistant", content: "stub chunk summary" } }],
  })
}

type InterceptResult = {
  status: number
  headers: Array<{ name: string, value: string }>
  body: string
}

/**
 * Routes one paused request to a stub response. Every branch is local: no
 * request ever reaches the network, so no paid endpoint can be contacted even if
 * a pattern were mis-scoped.
 */
function respondToIntercepted(
  state: SmokeState,
  url: URL,
  method: string,
  postData: string | undefined,
  sessionKind: "page" | "sidepanel",
): InterceptResult | null {
  const json = (payload: string, status = 200): InterceptResult => ({
    status,
    headers: [
      { name: "content-type", value: "application/json; charset=utf-8" },
      // The mock answers its own response headers; the extension's real host
      // permission already covers this origin, this only keeps a CORS path safe.
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "*" },
      { name: "access-control-allow-methods", value: "POST, GET, OPTIONS" },
    ],
    body: payload,
  })

  if (url.pathname.startsWith("/watch")) {
    return {
      status: 200,
      headers: [{ name: "content-type", value: "text/html; charset=utf-8" }],
      body: stubWatchHtml(url.searchParams.get("v") ?? VIDEO_ID),
    }
  }

  if (url.pathname === TIMEDTEXT_PATH) {
    const format = url.searchParams.get("fmt")
    const body = format === "vtt" ? timedTextVtt()
      : format === "json3" ? timedTextJson3()
        : timedTextXml()
    return {
      status: 200,
      headers: [{ name: "content-type", value: "text/plain; charset=utf-8" }],
      body,
    }
  }

  if (url.pathname.startsWith("/v1/")) {
    if (method === "OPTIONS") return json("", 204)
    const text = postData ?? ""
    if (url.pathname.endsWith("/models")) {
      state.calls.push({ kind: "models", status: 200, index: state.calls.length })
      return json(JSON.stringify({ data: [{ id: "smoke-model" }] }))
    }
    let promptText = text
    try {
      const parsed = JSON.parse(text) as { messages?: Array<{ content?: string }> }
      promptText = (parsed.messages ?? []).map((message) => message.content ?? "").join("\n")
    } catch {
      // Keep the raw body for classification.
    }
    const kind = classifyPrompt(promptText)
    if (kind === "final" && state.finalSequence.length > 0) {
      const next = state.finalSequence.shift()!
      if (next === "invalid") {
        state.calls.push({ kind, status: 200, index: state.calls.length })
        return json(JSON.stringify({ choices: [{ message: { role: "assistant", content: "{}" } }] }))
      }
      state.calls.push({ kind, status: next, index: state.calls.length })
      return {
        status: next,
        headers: [{ name: "content-type", value: "application/json; charset=utf-8" }],
        body: JSON.stringify({ error: { message: "temporary upstream" } }),
      }
    }
    if (kind === "final" && state.failFirstFinal) {
      state.failFirstFinal = false
      state.calls.push({ kind, status: 502, index: state.calls.length })
      return {
        status: 502,
        headers: [{ name: "content-type", value: "text/html; charset=utf-8" }],
        body: "<html><body>upstream error</body></html>",
      }
    }
    if (kind === "final" && state.holdCancelFinal) {
      state.cancelFinalStarted.release()
      return { status: 0, headers: [], body: "" }
    }
    if (kind === "final" && state.holdLateFinal) {
      // Destructive-phase gating is armed only after the retryable failure has
      // been delivered. The first resume must return 503, not a success.
      if (state.resumeTransientRemaining === 0) state.lateFinalStarted.release()
      return { status: 0, headers: [], body: "" }
    }
    if (kind === "final" && state.resumeTransientRemaining > 0
      && !state.holdCancelFinal && !state.holdLateFinal) {
      state.resumeTransientRemaining -= 1
      const status = state.resumeTransientStatus ?? 503
      state.calls.push({ kind, status, index: state.calls.length })
      return {
        status,
        headers: [{ name: "content-type", value: "application/json; charset=utf-8" }],
        body: JSON.stringify({ error: { message: "temporary upstream" } }),
      }
    }
    state.calls.push({ kind, status: 200, index: state.calls.length })
    return json(providerBody(kind))
  }

  void sessionKind
  return null
}

/* --------------------------------------------------------------- CDP helpers */

type Target = { id: string, type: string, url: string, title: string }

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const state: SmokeState = {
    calls: [],
    // Reopen first seeds a normal successful history record. Its independent
    // 502 is armed only after that seed has been saved and its panel closed.
    failFirstFinal: options.scenario === "reopen" ? false : true,
    finalSequence: [],
    interceptTargets: {},
    interceptCounts: {},
    holdCancelFinal: options.scenario === "cancel" ? deferred() : null,
    holdLateFinal: null,
    cancelFinalStarted: deferred(),
    lateFinalStarted: deferred(),
    resumeTransientStatus: options.scenario === "retry" ? 503 : null,
    resumeTransientRemaining: 0,
    releaseHeldResponse: null,
    heldFinalActive: false,
    heldFinalRequest: null,
    heldFinalFulfilled: false,
    heldFinalError: null,
  }

  const profileDir = mkdtempSync(join(tmpdir(), "vsa-m3-smoke-"))
  mkdirSync(join(profileDir, "downloads"), { recursive: true })

  // The gate helper returns the executable as argv[0] and forces headless,
  // which cannot render a real Side Panel. Keep its isolation flags, drop
  // headless, and spawn the executable explicitly.
  const args = buildChromeArgs({
    chromePath: options.chromePath,
    userDataDir: profileDir,
    artifactDir: options.artifactDir,
    remoteDebuggingPort: 0,
  }).slice(1).filter((arg) => arg !== "--headless=new")

  const steps: string[] = []
  let browser: ChildProcess | null = null
  let cdp: CdpConnection | null = null
  const evidence: Record<string, any> = {}

  try {
    browser = spawn(options.chromePath, args, { stdio: "ignore" })
    const devToolsPort = await waitForDevToolsPort(profileDir, 30_000)
    const endpoint = await waitForCdpEndpoint(devToolsPort, 30_000)
    cdp = await CdpConnection.connect(endpoint.webSocketDebuggerUrl, 15_000)
    evidence["chrome"] = endpoint.browser
    evidence["scenario"] = options.scenario
    evidence["steps"] = steps
    evidence["stub"] = {
      videoId: VIDEO_ID,
      videoIdLength: VIDEO_ID.length,
      cueCount: CUE_COUNT,
      cuesPerChunkTarget: 5,
      providerOrigin: `${STUB_ORIGIN}/v1`,
      timedtextOrigin: `${STUB_ORIGIN}${TIMEDTEXT_PATH}`,
    }

    /* ------------------------------------------------------ stub interception */

    // One router for every session. `Fetch.enable` pauses only the URLs each
    // session asked for, so the same handler can serve the page (watch +
    // timedtext) and the side panel (provider) without cross-talk.
    const sessionKinds = new Map<string, "page" | "sidepanel">()
    cdp.onEvent((message) => {
      if (message.method !== "Fetch.requestPaused") return
      const sessionId = message.sessionId
      if (!sessionId) return
      const params = message.params as {
        requestId?: string
        request?: { url?: string, method?: string, postData?: string }
      }
      const requestId = String(params.requestId ?? "")
      if (!requestId) return
      const rawUrl = String(params.request?.url ?? "")
      const method = String(params.request?.method ?? "GET").toUpperCase()
      const sessionKind = sessionKinds.get(sessionId) ?? "page"
      let url: URL
      try {
        url = new URL(rawUrl)
      } catch {
        void cdp!.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => undefined)
        return
      }
      const result = respondToIntercepted(state, url, method, params.request?.postData, sessionKind)
      if (!result) {
        void cdp!.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => undefined)
        return
      }
      const label = url.pathname.startsWith("/watch") ? "watch"
        : url.pathname === TIMEDTEXT_PATH ? "timedtext"
          : url.pathname.startsWith("/v1/") ? "provider"
            : "other"
      state.interceptTargets[label] = sessionKind
      state.interceptCounts[label] = (state.interceptCounts[label] ?? 0) + 1
      const fulfill = async () => {
        // Only a genuine Final can use the hold sentinel; Map/Reduction must
        // retain their own classification and never acquire the held gate.
        const heldFinal = result.status === 0 && label === "provider"
          && (state.holdCancelFinal !== null || state.holdLateFinal !== null)
        if (heldFinal && state.releaseHeldResponse) {
          state.heldFinalActive = true
          state.heldFinalRequest = { sessionId, requestId }
          await state.releaseHeldResponse.promise
          state.heldFinalActive = false
        }
        const deliveredStatus = heldFinal ? 200 : result.status
        const deliveredBody = heldFinal ? providerBody("final") : result.body
        const deliveredHeaders = heldFinal
          ? [{ name: "content-type", value: "application/json; charset=utf-8" }]
          : result.headers
        try {
          await cdp!.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: deliveredStatus,
            responseHeaders: deliveredHeaders,
            body: Buffer.from(deliveredBody).toString("base64"),
          }, sessionId)
          if (heldFinal) {
            state.heldFinalFulfilled = true
            state.calls.push({ kind: "final", status: deliveredStatus, index: state.calls.length })
          }
        } catch (error) {
          if (heldFinal) state.heldFinalError = String(error)
        }
      }
      void fulfill()
    })

    steps.push("create-page")
    // The runtime bridge only treats a tab as a supported video when its URL is
    // a real YouTube watch URL, so the stub page is served through request
    // interception that answers the youtube.com origin locally.
    const pageResponse = await sendNamed(cdp, "Target.createTarget", { url: "about:blank" })
    const pageTargetId = String(pageResponse.result?.targetId)
    const pageSession = await attach(cdp, pageTargetId)
    sessionKinds.set(pageSession, "page")
    await sendNamed(cdp, "Page.enable", {}, pageSession)
    await sendNamed(cdp, "Fetch.enable", {
      patterns: [
        { urlPattern: `${STUB_ORIGIN}/watch*`, requestStage: "Request" },
        { urlPattern: `${STUB_ORIGIN}${TIMEDTEXT_PATH}*`, requestStage: "Request" },
      ],
    }, pageSession)

    await sendNamed(cdp, "Page.navigate", {
      url: `${STUB_ORIGIN}/watch?v=${VIDEO_ID}`,
    }, pageSession)
    await poll(
      async () => evaluate<boolean>(cdp!, pageSession, "Boolean(document.getElementById('movie_player'))"),
      30_000,
      "stub player element",
    )
    // CDP re-applies the MAIN-world player surface: CSP cannot block it, and it
    // does not depend on the inline script above having run.
    const bootstrapped = await evaluate<boolean>(cdp, pageSession, playerSurfaceScript())
    await poll(
      async () => evaluate<boolean>(cdp!, pageSession, "document.readyState === 'complete'"),
      30_000,
      "stub watch page",
    )
    if (!bootstrapped) throw new Error("could not install the stub player surface")

    steps.push("find-service-worker")
    // Discover the extension id from any extension target. The service worker
    // target is not attachable on every CfT build, so settings are seeded from
    // the extension page itself instead.
    const manifest = parseArtifactManifest(JSON.parse(
      readFileSync(join(options.artifactDir, "manifest.json"), "utf8"),
    ))
    if (!manifest) throw new Error("the built artifact manifest could not be parsed")
    const backgroundPath = resolveBackgroundScriptPath(manifest)
    const sidePanelPath = resolveExtensionPagePath(manifest.sidePanelPath ?? "sidepanel.html")
    const extensionTarget = await poll(async () => {
      const response = await cdp!.send("Target.getTargets")
      const infos = (response.result?.targetInfos ?? []) as CdpTarget[]
      return selectExtensionTargets(infos, backgroundPath, sidePanelPath, null)
    }, 30_000, "extension service worker target")
    const extensionId = extensionTarget.extensionId
    evidence["extensionId"] = extensionId

    steps.push("create-options")
    // Seed settings from the Options surface: it is an ordinary extension page
    // with chrome.storage, and using a separate page keeps the Side Panel's
    // first document the one that boots with the mock provider already present.
    const optionsPage = await sendNamed(cdp, "Target.createTarget", { url: "about:blank" })
    const optionsTargetId = String(optionsPage.result?.targetId)
    const optionsSession = await attach(cdp, optionsTargetId)
    await sendNamed(cdp, "Page.navigate", {
      url: `chrome-extension://${extensionId}/options.html`,
    }, optionsSession)
    const profileId = "smoke-provider"
    const nowIso = new Date().toISOString()
    steps.push("seed-storage")
    await poll(
      async () => evaluate<boolean>(cdp!, optionsSession,
        "location.protocol === 'chrome-extension:' && Boolean(globalThis.chrome?.storage?.local)"),
      30_000,
      "extension storage availability",
    )
    await evaluate(cdp, optionsSession, `(async () => {
      await chrome.storage.local.set({
        "yt-summarizer.provider.profiles": ${JSON.stringify([{
          id: profileId,
          name: "Smoke Mock",
          // Provider on the extension's own declared host permission (header
          // note 4): no runtime permission prompt, no real endpoint.
          baseUrl: `${STUB_ORIGIN}/v1`,
          model: "smoke-model",
          isDefault: true,
          generationTimeoutSec: 120,
          createdAt: nowIso,
          updatedAt: nowIso,
        }])},
        "yt-summarizer.provider.secrets": ${JSON.stringify({
          [profileId]: { apiKey: "sk-smoke-fixture-never-real", credentialRevision: "smoke-revision-1" },
        })},
        "yt-summarizer.provider.default": ${JSON.stringify(profileId)},
        "yt-summarizer.analysis.preset": "standard"
      });
      return true;
    })()`)
    const providerPermission = await evaluate<string>(cdp, optionsSession, `(async () => {
      const pattern = "${STUB_ORIGIN}/*";
      try {
        const granted = await chrome.permissions.contains({ origins: [pattern] });
        return JSON.stringify({ pattern, granted });
      } catch (error) {
        return JSON.stringify({ pattern, error: String(error) });
      }
    })()`)
    evidence["providerPermission"] = providerPermission

    // A real completed run is the reopen scenario's existing-history sentinel.
    // It uses the same public panel buttons and production persistence as the
    // failed run, rather than writing an IndexedDB fixture behind the product.
    if (options.scenario === "reopen") {
      await sendNamed(cdp, "Page.navigate", {
        url: `chrome-extension://${extensionId}/sidepanel.html`,
      }, optionsSession)
      await poll(
        async () => evaluate<boolean>(cdp!, optionsSession,
          "document.getElementById('__plasmo')?.childElementCount > 0"),
        60_000,
        "history-seed panel mount",
      )
      await seedNormalHistory(cdp, optionsSession, pageSession, sessionKinds)
      evidence["historySeedCallCount"] = state.calls.length
    }
    await sendNamed(cdp, "Target.closeTarget", { targetId: optionsTargetId })
    if (options.scenario === "reopen") state.failFirstFinal = true

    steps.push("create-sidepanel")
    const sidePanel = await sendNamed(cdp, "Target.createTarget", { url: "about:blank" })
    const originalSideTargetId = String(sidePanel.result?.targetId)
    steps.push("focus-sidepanel")
    let sideSession = await attach(cdp, originalSideTargetId)
    sessionKinds.set(sideSession, "sidepanel")
    // A background/occluded tab can have its rendering deferred; focusing the
    // target keeps React mounting and effect timers running.
    await sendNamed(cdp, "Emulation.setFocusEmulationEnabled", { enabled: true }, sideSession)
    await sendNamed(cdp, "Fetch.enable", {
      patterns: [{ urlPattern: `${STUB_ORIGIN}/v1/*`, requestStage: "Request" }],
    }, sideSession)
    // Mirror the artifact gate: enable Page/Runtime on about:blank, then
    // navigate. Enabling after navigation races the bundle's first evaluation.
    await sendNamed(cdp, "Page.enable", {}, sideSession)
    const navigation = await sendNamed(cdp, "Page.navigate", {
      url: `chrome-extension://${extensionId}/sidepanel.html`,
    }, sideSession)
    const navigationError = navigation.result?.errorText
    if (typeof navigationError === "string" && navigationError.length > 0) {
      throw new Error(`side panel navigation failed: ${navigationError}`)
    }

    const MOUNT_PROBE = `(() => {
      const root = document.getElementById("__plasmo")
      return JSON.stringify({
        href: location.href,
        readyState: document.readyState,
        rootChildCount: root ? root.childElementCount : 0
      })
    })()`
    await poll(
      async () => {
        const raw = await evaluate<string>(cdp!, sideSession, MOUNT_PROBE)
        const snapshot = JSON.parse(raw) as {
          href: string, readyState: string, rootChildCount: number
        }
        return snapshot.rootChildCount > 0 ? snapshot : null
      },
      60_000,
      "side panel react mount",
    )

    // The Side Panel reads settings asynchronously on boot; wait until it shows
    // the mock provider before looking for controls.
    await poll(async () => {
      const text = await evaluate<string>(cdp!, sideSession,
        "(document.body?.innerText || '')")
      return /Smoke Mock/.test(text) ? true : null
    }, 45_000, "mock provider resolved by the panel")

    // Making the video tab the active tab: the background resolves
    // `chrome.tabs.query({active:true,currentWindow:true})`, so the panel must
    // not remain the active tab when it asks for the current video context.
    await sendNamed(cdp, "Page.bringToFront", {}, pageSession)
    await Bun.sleep(300)
    const activation = await evaluate<string>(cdp, sideSession, `(async () => {
      const after = await chrome.tabs.query({ active: true, currentWindow: true });
      return JSON.stringify(after.map((tab) => tab.url));
    })()`)
    evidence["activation"] = activation
    await evaluate(cdp, sideSession, `(() => {
      const buttons = [...document.querySelectorAll("button")];
      const refresh = buttons.find((button) => {
        const label = (button.getAttribute("aria-label") || "") + " " + (button.getAttribute("title") || "");
        return /refresh|刷新视频上下文/i.test(label);
      });
      if (refresh) { refresh.click(); return true; }
      return false;
    })()`)
    await Bun.sleep(1200)

    const pageDiag = await evaluate<string>(cdp, pageSession, `JSON.stringify({
      href: location.href,
      title: document.title,
      hasPlayer: Boolean(window.ytInitialPlayerResponse),
      trackCount: window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0,
      playerVideoId: document.getElementById("movie_player")?.getVideoData?.()?.videoId ?? null,
      h1: document.querySelector("ytd-watch-metadata h1")?.textContent?.trim() ?? null,
      owner: document.querySelector("ytd-watch-metadata #owner a.yt-simple-endpoint")?.textContent?.trim() ?? null,
      readyState: document.readyState
    })`)
    evidence["pageDiag"] = pageDiag

    // Direct proof for the original failure: the same two production steps the
    // adapter takes, evaluated against the live stub document.
    const adapterStepDiag = await evaluate<string>(cdp, pageSession, `JSON.stringify({
      href: location.href,
      videoIdFromUrl: new URL(location.href).searchParams.get("v"),
      playerJsonVideoId: window.ytInitialPlayerResponse?.videoDetails?.videoId ?? null,
      documentTitle: document.title
    })`)
    evidence["adapterStepDiag"] = adapterStepDiag

    const backgroundProbe = await evaluate<string>(cdp, sideSession, `(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          channel: "video-summary-assistant/runtime",
          type: "get-active-video-context"
        });
        return JSON.stringify(response).slice(0, 800);
      } catch (error) {
        return JSON.stringify({ ok: false, error: String(error) });
      }
    })()`)
    evidence["backgroundProbe"] = backgroundProbe

    const pageErrors: string[] = []
    cdp.onEvent((message) => {
      if (message.sessionId !== pageSession) return
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails as
          { text?: string, exception?: { description?: string } } | undefined
        pageErrors.push(details?.exception?.description ?? details?.text ?? "unknown")
      }
    })
    await sendNamed(cdp, "Runtime.enable", {}, pageSession)

    const contentProbe = await evaluate<string>(cdp, sideSession, `(async () => {
      const tabs = await chrome.tabs.query({});
      const video = tabs.find((tab) => (tab.url || "").includes("youtube.com/watch"));
      if (!video || video.id === undefined) return "no-video-tab";
      try {
        const ping = await chrome.tabs.sendMessage(video.id, {
          channel: "video-summary-assistant/runtime",
          type: "get-active-video-context"
        });
        return JSON.stringify({ ok: true, ping }).slice(0, 800);
      } catch (error) {
        return JSON.stringify({ ok: false, error: String(error) });
      }
    })()`)
    evidence["contentProbe"] = contentProbe

    // The generation gate is `videoContext.isReady`, which the production code
    // derives as Boolean(videoId && title). Assert it before touching buttons so
    // a regression reports the real cause instead of a missing button.
    const contextIsReady = (() => {
      try {
        const parsed = JSON.parse(backgroundProbe) as {
          context?: { isReady?: boolean, videoId?: string, title?: string, author?: string | null }
        }
        return parsed.context ?? null
      } catch {
        return null
      }
    })()
    evidence["contextReady"] = contextIsReady
    expect(
      contextIsReady?.isReady === true,
      `the active video context must be ready before analyzing: ${backgroundProbe}`,
    )
    expect(
      contextIsReady?.videoId === VIDEO_ID,
      `the active video context must resolve ${VIDEO_ID}: ${backgroundProbe}`,
    )

    steps.push("click-generate")
    const generateState = await evaluate<string>(cdp, sideSession, `(() => {
      const buttons = [...document.querySelectorAll("button")];
      const target = buttons.find((button) => /Generate analysis|Regenerate|生成分析|重新生成/i.test(button.textContent || ""));
      if (!target) return JSON.stringify({ present: false, disabled: null });
      const snapshot = {
        present: true,
        disabled: Boolean(target.disabled),
        label: (target.textContent || "").trim(),
        ariaLabel: target.getAttribute("aria-label") ?? null
      };
      if (!target.disabled) target.click();
      return JSON.stringify(snapshot);
    })()`)
    evidence["generateButton"] = generateState
    const parsedGenerate = JSON.parse(generateState) as {
      present?: boolean, disabled?: boolean | null, label?: string
    }
    const clickedGenerate = parsedGenerate.present === true && parsedGenerate.disabled === false
    if (!clickedGenerate) {
      const diagnostic = await evaluate<string>(cdp, sideSession, `(async () => {
        const stored = await chrome.storage.local.get(null);
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return JSON.stringify({
          href: location.href,
          buttons: [...document.querySelectorAll("button")].map((b) => ({
            text: (b.textContent || "").trim(),
            disabled: b.disabled
          })).slice(0, 40),
          text: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 400),
          storageKeys: Object.keys(stored),
          activeTab: tabs.map((tab) => tab.url)
        });
      })()`)
      throw new Error(`the Generate/Regenerate button must be enabled and clickable: ${diagnostic}`)
    }

    // Wait for whichever resume surface appears. A hidden entry (reason != null)
    // is a decisive failure signal, so waiting the full budget for a CTA that can
    // never render would only delay the diagnosis.
    const resumeText = await poll(async () => {
      const snapshot = await evaluate<string>(cdp!, sideSession, `(() => {
        const unavailable = document.querySelector('[data-testid="final-resume-unavailable"]');
        const panel = document.querySelector('[data-testid="final-resume-panel"]');
        const text = document.body?.innerText || "";
        return JSON.stringify({
          text,
          reason: unavailable ? unavailable.getAttribute("data-resume-reason") : null,
          unavailableText: unavailable ? (unavailable.textContent || "").trim().slice(0, 200) : null,
          panelPresent: Boolean(panel),
          panelPhase: panel ? panel.getAttribute("data-resume-phase") : null
        });
      })()`)
      const parsed = JSON.parse(snapshot) as { text?: string, reason?: string | null, panelPresent?: boolean }
      const body = parsed.text ?? ""
      const hasCta = /Continue final summary|继续最终总结/.test(body)
      // Any rendered resume surface ends the wait: a CTA is the happy path, and a
      // reason-tagged panel is a terminal outcome this smoke must report.
      if (hasCta || parsed.reason || parsed.panelPresent) return snapshot
      return null
    }, 180_000, "final resume entry after HTTP 502").catch(async (error) => {
      const panel = await evaluate<string>(cdp!, sideSession,
        "(document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 900)")
      throw new Error(
        `${String(error)} | calls=${JSON.stringify(state.calls)} | panel=${panel}`,
      )
    })
    const parsedResumeView = JSON.parse(resumeText) as {
      text?: string, reason?: string | null, unavailableText?: string | null
      panelPresent?: boolean, panelPhase?: string | null
    }
    evidence["resumeEntryDiag"] = resumeText
    expect(
      parsedResumeView.panelPresent === true
        || /Continue final summary|继续最终总结/.test(parsedResumeView.text ?? ""),
      `no resume entry rendered: ${resumeText}`,
    )
    expect(
      parsedResumeView.reason !== "conflict",
      `the resume entry is hidden by a workspace conflict, which means the failed task never released: ${resumeText}`,
    )
    expect(
      parsedResumeView.reason == null,
      `the resume entry rendered as unavailable instead of offering a resume: ${resumeText}`,
    )

    const firstPassCalls = state.calls.slice(
      options.scenario === "reopen" ? Number(evidence["historySeedCallCount"]) : 0,
    )
    const firstPass = {
      mapCalls: firstPassCalls.filter((call) => call.kind === "map").length,
      reductionCalls: firstPassCalls.filter((call) => call.kind === "reduction").length,
      finalCalls: firstPassCalls.filter((call) => call.kind === "final").length,
      repairCalls: firstPassCalls.filter((call) => call.kind === "repair").length,
      finalStatuses: firstPassCalls.filter((call) => call.kind === "final").map((call) => call.status),
      // The resume panel renders "最终总结失败 · HTTP 502" and its own 502 status,
      // so both the visible status line and the provider record are checked.
      showed502: /HTTP 502/.test(parsedResumeView.text ?? ""),
    }
    evidence["firstPass"] = firstPass
    evidence["callsAfterFirstPass"] = [...firstPassCalls]

    expect(firstPass.mapCalls === 5, `the first pass must issue exactly 5 Map requests, saw ${firstPass.mapCalls}`)
    expect(firstPass.reductionCalls === 0, "the first pass must not need a Reduction level")
    expect(firstPass.finalCalls === 1, "the first pass must issue exactly one Final request")
    expect(firstPass.finalStatuses[0] === 502, "the first Final request must return HTTP 502")
    expect(firstPass.repairCalls === 0, "a transport failure must not trigger a Repair request")
    expect(firstPass.showed502, "the resume entry must show the 502 status")

    // Button-level evidence: the dedicated continue control exists, is enabled,
    // and is the element this smoke clicks. The reason attribute is read from the
    // same snapshot so a failure names the exact guard that hid the entry instead
    // of only reporting a timeout.
    const resumeButtonState = await evaluate<string>(cdp, sideSession, `(() => {
      const button = document.querySelector('[data-testid="final-resume-continue"]');
      const panel = document.querySelector('[data-testid="final-resume-panel"]');
      const unavailable = document.querySelector('[data-testid="final-resume-unavailable"]');
      const snapshot = {
        present: Boolean(button),
        disabled: button ? Boolean(button.disabled) : null,
        label: button ? (button.textContent || "").trim() : null,
        panelPresent: Boolean(panel),
        panelPhase: panel ? panel.getAttribute("data-resume-phase") : null,
        unavailableReason: unavailable ? unavailable.getAttribute("data-resume-reason") : null,
        panelCount: document.querySelectorAll('[data-testid="final-resume-panel"]').length
      };
      return JSON.stringify(snapshot);
    })()`)
    evidence["resumeButtonBeforeClick"] = resumeButtonState
    const parsedButtonState = JSON.parse(resumeButtonState) as {
      present?: boolean, disabled?: boolean | null, unavailableReason?: string | null
    }
    expect(parsedButtonState.present === true, "the dedicated continue button should be present")
    expect(parsedButtonState.disabled === false, "the dedicated continue button should be enabled")
    expect(
      parsedButtonState.unavailableReason == null,
      `an unavailable resume panel must not coexist with the continue button: ${resumeButtonState}`,
    )

    if (options.scenario === "refresh" || options.scenario === "reopen") {
      await runLifecycleScenario({
        cdp,
        evidence,
        state,
        steps,
        scenario: options.scenario,
        extensionId,
        pageSession,
        originalSideTargetId,
        sideSession,
        sessionKinds,
      })
      evidence["interceptTargets"] = state.interceptTargets
      evidence["interceptCounts"] = state.interceptCounts
      evidence["pageErrors"] = pageErrors.slice(0, 5)
      evidence["result"] = "PASS"
      console.log(`@@SMOKE_EVIDENCE@@${JSON.stringify(evidence)}`)
      return
    }

    // A quiet pre-click window proves there is no delayed automatic retry.
    await Bun.sleep(2000)
    expect(state.calls.length === firstPassCalls.length,
      `the retryable failure must not issue a request before the explicit click: ${JSON.stringify(state.calls)}`)
    if (options.scenario !== "golden") {
      await runNegativeScenario({
        cdp,
        evidence,
        state,
        steps,
        scenario: options.scenario as "cancel" | "source-switch" | "tab-switch" | "destructive" | "retry",
        extensionId,
        pageSession,
        originalSideTargetId,
        sideSession,
        sessionKinds,
      })
      evidence["interceptTargets"] = state.interceptTargets
      evidence["interceptCounts"] = state.interceptCounts
      evidence["pageErrors"] = pageErrors.slice(0, 5)
      evidence["result"] = "PASS"
      console.log(`@@SMOKE_EVIDENCE@@${JSON.stringify(evidence)}`)
      return
    }

    const callsBeforeResume = state.calls.length
    const clickedResume = await evaluate<boolean>(cdp, sideSession, `(() => {
      const button = document.querySelector('[data-testid="final-resume-continue"]');
      if (!button) return false;
      button.click();
      return true;
    })()`)
    expect(clickedResume, "the dedicated continue button should be clickable")

    const completedText = await poll(async () => {
      const text = await evaluate<string>(cdp!, sideSession, "document.body.innerText")
      return /Smoke resume summary/.test(text) ? text : null
    }, 180_000, "resumed analysis rendered")

    const resumeCalls = state.calls.slice(callsBeforeResume)
    // The success toast contains the CTA wording ("已继续最终总结并保存"), so the
    // entry is detected by its test ids rather than by body text.
    const resumeEntryGoneState = await evaluate<string>(cdp, sideSession, `JSON.stringify({
      continueButton: Boolean(document.querySelector('[data-testid="final-resume-continue"]')),
      resumePanel: Boolean(document.querySelector('[data-testid="final-resume-panel"]')),
      unavailable: Boolean(document.querySelector('[data-testid="final-resume-unavailable"]'))
    })`)
    evidence["resumeEntryAfterResume"] = resumeEntryGoneState
    const parsedEntryGone = JSON.parse(resumeEntryGoneState) as {
      continueButton?: boolean, resumePanel?: boolean, unavailable?: boolean
    }
    const resumePass = {
      mapCalls: resumeCalls.filter((call) => call.kind === "map").length,
      reductionCalls: resumeCalls.filter((call) => call.kind === "reduction").length,
      finalCalls: resumeCalls.filter((call) => call.kind === "final").length,
      repairCalls: resumeCalls.filter((call) => call.kind === "repair").length,
      finalStatuses: resumeCalls.filter((call) => call.kind === "final").map((call) => call.status),
      renderedSummary: /Smoke resume summary/.test(completedText),
      resumeEntryGone: parsedEntryGone.continueButton === false
        && parsedEntryGone.resumePanel === false
        && parsedEntryGone.unavailable === false,
    }
    evidence["resumePass"] = resumePass
    evidence["callsAfterResume"] = [...state.calls]

    expect(resumePass.mapCalls === 0, "resume must not call Map again")
    expect(resumePass.reductionCalls === 0, "resume must not call Reduction again")
    expect(resumePass.finalCalls === 1, "resume must issue exactly one Final request")
    expect(resumePass.finalStatuses[0] === 200, "the resumed Final request must return HTTP 200")
    expect(resumePass.repairCalls === 0, "a valid resumed response must not trigger Repair")
    expect(resumePass.renderedSummary, "the resumed analysis summary must render in the panel")
    expect(resumePass.resumeEntryGone, "the resume entry must disappear after a successful resume")

    // `innerText` alone cannot tell a rendered summary from a toast or an error
    // echo, so the rendered structure is captured independently.
    //
    // Two details this probe must respect:
    //  - Section labels carry an inline icon, so the label node has element
    //    children; labels are matched on trimmed textContent instead of requiring
    //    a leaf node, and ancestors are excluded by the short-length cap.
    const renderedEvidence = await evaluate<string>(cdp, sideSession, `(() => {
      const text = (document.body?.innerText || "");
      const labels = [...document.querySelectorAll("*")]
        .map((node) => (node.textContent || "").trim())
        .filter((label) => label.length > 0 && label.length <= 6);
      const hasLabel = (pattern) => labels.some((label) => pattern.test(label));
      return JSON.stringify({
        hasSummaryLabel: hasLabel(/^(摘要|Summary)$/),
        hasKeyPointsLabel: hasLabel(/^(要点|Key points)$/),
        hasChaptersLabel: hasLabel(/^(章节|Chapters)$/),
        summaryTextPresent: text.includes("Smoke resume summary."),
        keyPointTextPresent: text.includes("Smoke point."),
        chapterTitlePresent: text.includes("Chapter One"),
        continueButtonPresent: Boolean(document.querySelector('[data-testid="final-resume-continue"]')),
        resumePanelPresent: Boolean(document.querySelector('[data-testid="final-resume-panel"]')),
        unavailableReason: (() => {
          const node = document.querySelector('[data-testid="final-resume-unavailable"]');
          return node ? node.getAttribute("data-resume-reason") : null;
        })(),
        analysisErrorPresent: /^\\s*(分析失败|Analysis failed)\\s*$/m.test(text),
        savedCountLabel: (text.match(/(\\d+)\\s*已保存/) || [])[1] ?? null
      });
    })()`)
    evidence["renderedEvidence"] = renderedEvidence
    const parsedRendered = JSON.parse(renderedEvidence) as {
      hasSummaryLabel?: boolean, summaryTextPresent?: boolean, keyPointTextPresent?: boolean,
      chapterTitlePresent?: boolean, continueButtonPresent?: boolean,
      analysisErrorPresent?: boolean, savedCountLabel?: string | null
    }
    // The authoritative rendering evidence is the analysed content itself: the
    // summary line, a key point and a chapter title can only appear once the
    // resumed analysis has actually been published. Section labels are recorded
    // for transparency but are layout, not a contract.
    expect(parsedRendered.summaryTextPresent === true,
      `the saved summary text must render: ${renderedEvidence}`)
    expect(parsedRendered.keyPointTextPresent === true,
      `the saved key points must render: ${renderedEvidence}`)
    expect(parsedRendered.chapterTitlePresent === true,
      `the resumed analysis chapters must render: ${renderedEvidence}`)
    expect(parsedRendered.continueButtonPresent === false,
      `the continue button must be gone once the analysis is published: ${renderedEvidence}`)
    expect(parsedRendered.analysisErrorPresent === false,
      `the panel must not still show an analysis error after resume: ${renderedEvidence}`)
    expect(parsedRendered.savedCountLabel === "1",
      `exactly one saved analysis must be listed after resume: ${renderedEvidence}`)

    const postResumeButton = await evaluate<string>(cdp, sideSession, `(() => {
      const button = document.querySelector('[data-testid="final-resume-continue"]');
      const panel = document.querySelector('[data-testid="final-resume-panel"]');
      const unavailable = document.querySelector('[data-testid="final-resume-unavailable"]');
      return JSON.stringify({
        continuePresent: Boolean(button),
        panelPresent: Boolean(panel),
        unavailableReason: unavailable ? unavailable.getAttribute("data-resume-reason") : null
      });
    })()`)
    evidence["resumeButtonAfterClick"] = postResumeButton
    // Post-click evidence is captured at two distinct moments: as soon as the
    // resume settles the entry must be gone, which is what rules out a second
    // clickable resume or a stale panel lingering behind the saved analysis.
    const parsedAfter = JSON.parse(postResumeButton) as { continuePresent?: boolean }
    expect(parsedAfter.continuePresent === false,
      `the continue button must disappear after a successful resume: ${postResumeButton}`)

    // Persistence evidence: read the extension's own IndexedDB from its origin.
    const persisted = await evaluate<string>(cdp, sideSession, `(async () => {
      const openDb = () => new Promise((resolve, reject) => {
        const request = indexedDB.open("youtube-summarizer");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const readAll = (db, store) => new Promise((resolve, reject) => {
        let request;
        try { request = db.transaction(store, "readonly").objectStore(store).getAll(); }
        catch (error) { reject(error); return; }
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      try {
        const db = await openDb();
        const runs = await readAll(db, "analysisRuns");
        const recents = await readAll(db, "recentVideos");
        return JSON.stringify({
          runCount: runs.length,
          runs: runs.slice(0, 5).map((run) => ({
            id: run.id,
            videoId: run.videoId,
            status: run.status,
            summary: (run.summary || "").slice(0, 120),
            keyPointCount: (run.keyPoints || []).length,
            completedAt: run.completedAt ?? null,
            providerModel: run.providerModel ?? null
          })),
          recentCount: recents.length,
          recentVideoIds: recents.slice(0, 5).map((row) => row.videoId)
        });
      } catch (error) {
        return JSON.stringify({ error: String(error) });
      }
    })()`)
    evidence["persisted"] = persisted
    const parsedPersisted = JSON.parse(persisted) as {
      runs?: Array<{ id?: string, videoId?: string, status?: string, summary?: string }>
    }
    const savedRun = (parsedPersisted.runs ?? []).find((run) =>
      run.videoId === VIDEO_ID && /Smoke resume summary/.test(run.summary ?? ""))
    evidence["analysisRunId"] = savedRun?.id ?? null
    expect(Boolean(savedRun), `the resumed analysis must be persisted: ${persisted}`)
    expect(savedRun?.status === "completed", `the persisted run must be completed: ${persisted}`)
    expect(
      typeof savedRun?.id === "string" && savedRun.id.length > 0,
      "the persisted run must have a non-empty analysisRunId",
    )

    const html = await evaluate<string>(cdp, sideSession, "document.documentElement.outerHTML")
    evidence["leaks"] = {
      apiKey: html.includes("sk-smoke-fixture"),
      mapSummary: html.includes("stub chunk summary"),
    }
    expect(evidence["leaks"].apiKey === false, "the API key must never reach the panel DOM")
    expect(evidence["leaks"].mapSummary === false, "map summaries must never reach the panel DOM")

    evidence["interceptTargets"] = state.interceptTargets
    evidence["interceptCounts"] = state.interceptCounts
    evidence["pageErrors"] = pageErrors.slice(0, 5)
    evidence["result"] = "PASS"
    console.log(`@@SMOKE_EVIDENCE@@${JSON.stringify(evidence)}`)
  } catch (error) {
    evidence["steps"] = steps
    evidence["interceptTargets"] = state.interceptTargets
    evidence["interceptCounts"] = state.interceptCounts
    evidence["calls"] = [...state.calls]
    evidence["result"] = "FAIL"
    evidence["error"] = error instanceof Error ? error.message : String(error)
    console.log(`@@SMOKE_EVIDENCE@@${JSON.stringify(evidence)}`)
    process.exitCode = 1
  } finally {
    try {
      await cdp?.send("Browser.close")
    } catch {
      // The browser may already be gone.
    }
    cdp?.close()
    const cleanup = planCleanup({
      spawned: browser
        ? { pid: browser.pid ?? -1, executablePath: options.chromePath, userDataDir: profileDir }
        : null,
      exitedNormally: false,
      profileDir: profileDir,
    })
    if (!options.keepProfile) {
      if (cleanup.terminationCommand) {
        try {
          spawn(cleanup.terminationCommand.command, cleanup.terminationCommand.args, { stdio: "ignore" })
        } catch {
          // Best effort.
        }
      }
      try {
        rmSync(profileDir, { recursive: true, force: true })
      } catch {
        // The temp profile is disposable.
      }
    }
  }
}

/* ------------------------------------------------------ M4 negative browser */

async function clickTestButton(cdp: CdpConnection, session: string, testId: string): Promise<void> {
  const clicked = await evaluate<boolean>(cdp, session, `(() => {
    const button = document.querySelector('[data-testid="${testId}"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  expect(clicked, `expected enabled button ${testId}`)
}

async function auditNegativePrivacy(cdp: CdpConnection, session: string): Promise<Record<string, boolean>> {
  const audit = await evaluate<Record<string, boolean>>(cdp, session, `(() => {
    const text = document.documentElement.outerHTML;
    const entries = Object.entries(localStorage).concat(Object.entries(sessionStorage));
    return {
      domApiKey: text.includes("sk-smoke-fixture"),
      domMapSummary: text.includes("stub chunk summary"),
      domPrompt: text.includes("You are a structured video analyst"),
      webStorageMapSummary: JSON.stringify(entries).includes("stub chunk summary"),
    };
  })()`)
  for (const [key, leaked] of Object.entries(audit)) expect(!leaked, `privacy assertion ${key}`)
  return audit
}

async function waitForResumeCta(cdp: CdpConnection, session: string, enabled: boolean): Promise<void> {
  await poll(async () => evaluate<string>(cdp!, session, `(() => {
    const button = document.querySelector('[data-testid="final-resume-continue"]');
    return JSON.stringify({ present: Boolean(button), disabled: button ? button.disabled : null });
  })()`).then((raw) => {
    const state = JSON.parse(raw) as { present: boolean, disabled: boolean | null }
    return state.present && state.disabled === !enabled ? raw : null
  }), 45_000, `resume CTA enabled=${enabled}`)
}

type SmokeLockInfo = { name: string; mode: string | null }

type DestructivePageObservation = {
  href: string
  clearButton: { disabled: boolean; label: string } | null
  inventorySummary: string | null
  alerts: Array<{ title: string; text: string }>
  locks: { held: SmokeLockInfo[]; pending: SmokeLockInfo[] }
  click?: { events: number; confirmations: number }
}

const ACTIVE_TASK_LOCK_PREFIX = "video-summary-assistant:active-task:v1:"
const ACTIVE_CLEAR_CONFLICT = "Cancel the active task before clearing/deleting this data."

async function readDestructivePageObservation(
  cdp: CdpConnection,
  session: string,
  click = false,
): Promise<DestructivePageObservation> {
  return evaluate<DestructivePageObservation>(cdp, session, `(async () => {
    const panel = document.querySelector('[data-layout-check="data-management-panel"]');
    const button = [...(panel?.querySelectorAll("button") ?? [])].find((node) =>
      /^(?:清除分析历史|清空分析历史|Clear analysis history)$/i.test(node.textContent.trim())
    );
    const snapshot = {
      href: location.href,
      clearButton: button ? { disabled: button.disabled, label: button.textContent.trim() } : null,
      inventorySummary: (panel?.innerText ?? "").split("\\n")
        .find((line) => /Current inventory:|当前库存：/.test(line)) ?? null,
      alerts: [...(panel?.querySelectorAll('[role="alert"]') ?? [])].map((node) => ({
        title: node.querySelector("h5")?.textContent?.trim() ?? "",
        text: node.innerText.trim(),
      })),
    };
    const locks = navigator.locks.query();
    if (${click}) {
      if (!button || button.disabled || !snapshot.inventorySummary) {
        throw new Error("analysis-history clear is no longer ready at click time");
      }
      const counts = { events: 0, confirmations: 0 };
      const originalConfirm = window.confirm;
      const onClick = () => { counts.events += 1; };
      button.addEventListener("click", onClick);
      window.confirm = () => { counts.confirmations += 1; return true; };
      try {
        button.click();
      } finally {
        window.confirm = originalConfirm;
        button.removeEventListener("click", onClick);
      }
      snapshot.click = counts;
    }
    const { held, pending } = await locks;
    const describe = (lock) => ({ name: lock.name, mode: lock.mode });
    return { ...snapshot, locks: { held: held.map(describe), pending: pending.map(describe) } };
  })()`)
}

function isAnalysisHistoryClearReady(page: DestructivePageObservation): boolean {
  return page.clearButton?.disabled === false && page.inventorySummary !== null
}

function activeSmokeTaskLock(page: DestructivePageObservation): string | undefined {
  return page.locks.held.find((lock) => lock.name?.startsWith(ACTIVE_TASK_LOCK_PREFIX))?.name
}

function classifyClearFeedback(page: DestructivePageObservation, before: DestructivePageObservation) {
  for (const alert of page.alerts.filter(({ text }) => !before.alerts.some((old) => old.text === text))) {
    if (/^(?:清除分析历史完成|Clear analysis history complete)$/i.test(alert.title)) {
      return { kind: "success", text: alert.text }
    }
    if (/^(?:无法清除分析历史|Could not clear analysis history)$/i.test(alert.title)) {
      return { kind: alert.text.includes(ACTIVE_CLEAR_CONFLICT) ? "blocked" : "error", text: alert.text }
    }
  }
  return null
}

async function waitForClearOperationFeedback(
  read: () => Promise<DestructivePageObservation>,
  before: DestructivePageObservation,
  expectedKind: "success" | "blocked",
  label: string,
  activeLock?: string,
) {
  return waitForSmokeOutcome(
    async () => {
      const observation = await read()
      if (activeLock && !observation.locks.held.some(({ name }) => name === activeLock)) {
        throw new Error("Final task lock released before the active clear attempt settled")
      }
      return {
        observation,
        outcome: classifyClearFeedback(observation, before),
      }
    },
    (value) => value.outcome !== null,
    (value) => value.outcome?.kind === expectedKind,
    label,
    (value) => value.outcome?.text ?? "",
    { timeoutMs: 30_000, intervalMs: 250 },
  )
}

async function runNegativeScenario(input: LifecycleInput): Promise<void> {
  const { cdp, evidence, state, steps, scenario, extensionId, pageSession } = input
  const beforeCalls = state.calls.length
  if (scenario === "cancel") {
    steps.push("resume-final-pending")
    state.releaseHeldResponse = deferred()
    await clickTestButton(cdp, input.sideSession, "final-resume-continue")
    await state.cancelFinalStarted.promise
    expect(state.calls.filter((call) => call.kind === "final").length === 1,
      "the initial 502 must be the only completed Final before cancellation")
    evidence["pendingResumeFinal"] = {
      intercepted: true,
      completedProviderCalls: state.calls.length,
      initialCalls: beforeCalls,
    }
    steps.push("cancel-pending-resume")
    await evaluate(cdp, input.sideSession, `(() => {
      const button = [...document.querySelectorAll("button")].find((node) => /^(取消|Cancel)$/.test((node.textContent || "").trim()));
      if (!button) throw new Error("pending resume Cancel button missing");
      button.click();
      return true;
    })()`)
    state.holdCancelFinal = null
    state.holdLateFinal = null
    state.releaseHeldResponse.release()
    await Bun.sleep(1500)
    evidence["heldFinalDelivery"] = {
      request: state.heldFinalRequest,
      fulfilled: state.heldFinalFulfilled,
      error: state.heldFinalError,
      lateSuccessScope: "NOT RUN (browser abort discards the interception); deterministic coordinator test covers an abort-ignoring late success",
    }
    if (!state.heldFinalFulfilled && state.heldFinalRequest) {
      const delivery = await cdp.send("Fetch.fulfillRequest", {
        requestId: state.heldFinalRequest.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "content-type", value: "application/json; charset=utf-8" }],
        body: Buffer.from(providerBody("final")).toString("base64"),
      }, state.heldFinalRequest.sessionId).then(() => true, (error) => String(error))
      evidence["manualLateFulfillResult"] = delivery
    }
    const audit = assertNoIntermediatePersistence(await readPersistenceAudit(cdp, input.sideSession))
    expect((audit.stores?.analysisRuns?.count ?? -1) === 0,
      "a cancelled late Final must not create a completed run")
    expect(state.calls.filter((call) => call.kind === "final").length === 1,
      "a real browser abort must not deliver a new billable Final response")
    const cancelledSurface = JSON.parse(await readResumeSurface(cdp, input.sideSession)) as Record<string, boolean>
    expect(!cancelledSurface.continueButton && !cancelledSurface.resumePanel
      && !cancelledSurface.unavailable && !cancelledSurface.regenerateButton,
    `cancel must remove the actionable checkpoint UI: ${JSON.stringify(cancelledSurface)}`)
    evidence["afterLateSuccess"] = {
      calls: [...state.calls],
      surface: await readResumeSurface(cdp, input.sideSession),
      persistence: await readPersistenceAudit(cdp, input.sideSession),
      privacy: await auditNegativePrivacy(cdp, input.sideSession),
    }
    expect(state.calls.length === beforeCalls,
      "cancellation must not complete another billable provider response")
    return
  }

  if (scenario === "source-switch" || scenario === "tab-switch") {
    steps.push(scenario === "tab-switch" ? "switch-tab-before-resume" : "switch-source-before-resume")
    let otherPageSession = pageSession
    if (scenario === "tab-switch") {
      const otherTab = await sendNamed(cdp, "Target.createTarget", {
        url: `${STUB_ORIGIN}/watch?v=${VIDEO_ID}`,
      })
      otherPageSession = await attach(cdp, String(otherTab.result?.targetId))
      input.sessionKinds.set(otherPageSession, "page")
      await sendNamed(cdp, "Page.enable", {}, otherPageSession)
      await sendNamed(cdp, "Fetch.enable", {
        patterns: [
          { urlPattern: `${STUB_ORIGIN}/watch*`, requestStage: "Request" },
          { urlPattern: `${STUB_ORIGIN}${TIMEDTEXT_PATH}*`, requestStage: "Request" },
        ],
      }, otherPageSession)
      await evaluate(cdp, otherPageSession, playerSurfaceScript())
    } else {
      await sendNamed(cdp, "Page.navigate", { url: `${STUB_ORIGIN}/watch?v=smokeVideo2` }, otherPageSession)
      await evaluate(cdp, otherPageSession, playerSurfaceScript("smokeVideo2"))
    }
    await settleActiveVideo(cdp, input.sideSession, otherPageSession)
    await Bun.sleep(1200)
    const afterB = await readResumeSurface(cdp, input.sideSession)
    evidence["afterSourceB"] = { surface: afterB, calls: [...state.calls] }
    assertNoResumeSurface(afterB)
    steps.push("return-source-a")
    await settleActiveVideo(cdp, input.sideSession, pageSession)
    await Bun.sleep(1200)
    const afterA = await readResumeSurface(cdp, input.sideSession)
    evidence["afterReturnA"] = { surface: afterA, calls: [...state.calls] }
    assertNoResumeSurface(afterA)
    expect(state.calls.length === beforeCalls,
      "A→B→A or a same-video tab switch must not issue an automatic Final")
    assertNoIntermediatePersistence(await readPersistenceAudit(cdp, input.sideSession))
    return
  }

  if (scenario === "retry") {
    state.resumeTransientRemaining = 1
    steps.push("double-click-resume")
    await evaluate(cdp, input.sideSession, `(() => {
      const button = document.querySelector('[data-testid="final-resume-continue"]');
      button.click();
      button.click();
      button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return true;
    })()`)
    await waitForResumeCta(cdp, input.sideSession, true)
    await Bun.sleep(2000)
    const callsAfterFirstRetry = state.calls.length
    expect(callsAfterFirstRetry === beforeCalls + 1,
      "double-click must issue exactly one Final request")
    expect(state.calls.at(-1)?.status === 503,
      "the resumed request must receive the injected transient 503")
    evidence["afterDoubleClick503"] = {
      calls: [...state.calls],
      surface: await readResumeSurface(cdp, input.sideSession),
    }
    steps.push("explicit-retry-after-transient")
    await clickTestButton(cdp, input.sideSession, "final-resume-continue")
    await poll(async () => evaluate<string>(cdp!, input.sideSession, "document.body?.innerText || ''")
      .then((text) => /Smoke resume summary/.test(text) ? true : null), 180_000, "explicit transient retry success")
    await Bun.sleep(1000)
    const callsAfterSuccess = state.calls.length
    expect(callsAfterSuccess === callsAfterFirstRetry + 1,
      "the second explicit click must issue exactly one more Final, with no auto retry")
    expect(state.calls.at(-1)?.status === 200,
      "the explicitly retried Final must succeed")
    const audit = assertNoIntermediatePersistence(await readPersistenceAudit(cdp, input.sideSession))
    expect((audit.stores?.analysisRuns?.count ?? 0) === 1,
      "the successful explicit retry must save exactly one completed run")
    evidence["afterExplicitSuccess"] = {
      calls: [...state.calls],
      surface: await readResumeSurface(cdp, input.sideSession),
      persistence: await readPersistenceAudit(cdp, input.sideSession),
      privacy: await auditNegativePrivacy(cdp, input.sideSession),
    }
    return
  }

  steps.push("retryable-resume-before-destructive-operation")
  state.resumeTransientStatus = 503
  state.resumeTransientRemaining = 1
  await clickTestButton(cdp, input.sideSession, "final-resume-continue")
  await waitForResumeCta(cdp, input.sideSession, true)
  evidence["beforeDestructiveResume"] = {
    calls: [...state.calls],
    surface: await readResumeSurface(cdp, input.sideSession),
    panel: await evaluate<string>(cdp, input.sideSession, "document.body?.innerText || ''"),
  }
  // Complete the explicit resume before opening Options. Activating Options
  // changes the active source tab and legitimately invalidates the checkpoint.
  evidence["beforeSuccessfulResumeClick"] = await evaluate<string>(cdp, input.sideSession, `(() => {
    const button = document.querySelector('[data-testid="final-resume-continue"]');
    const panel = document.querySelector('[data-testid="final-resume-panel"]');
    return JSON.stringify({
      present: Boolean(button), disabled: button ? button.disabled : null,
      phase: panel ? panel.getAttribute("data-resume-phase") : null,
      href: location.href,
    });
  })()`)
  await clickTestButton(cdp, input.sideSession, "final-resume-continue")
  await poll(async () => evaluate<string>(cdp!, input.sideSession, "document.body?.innerText || ''")
    .then((text) => /Smoke resume summary/.test(text) ? true : null), 180_000, "resume completes before clear")
  const beforeReleasedClear = state.calls.length
  const completedResumePersistence = await waitForSmokeCondition(
    async () => assertNoIntermediatePersistence(await readPersistenceAudit(cdp, input.sideSession)),
    (audit) => (audit.stores?.analysisRuns?.runs ?? []).some((run) => (
      run.status === "completed" && run.videoId === VIDEO_ID && /Smoke resume summary/.test(run.summary ?? "")
    )),
    "completed Final Resume persistence",
    { timeoutMs: 30_000, intervalMs: 250 },
  )
  const completedResumeTaskRelease = await waitForSmokeCondition(
    () => readDestructivePageObservation(cdp, input.sideSession),
    (observation) => !activeSmokeTaskLock(observation),
    "Final Resume task lock release",
    { timeoutMs: 30_000, intervalMs: 250 },
  )
  const oldRunIds = completedRunIds(completedResumePersistence)
  evidence["completedResumeBeforeOptions"] = {
    persistence: completedResumePersistence,
    uiAndLocks: completedResumeTaskRelease,
  }
  expect(oldRunIds.length === 1 && completedResumePersistence.stores?.analysisRuns?.count === 1,
    "the completed Final Resume must persist exactly one analysis before clear")
  steps.push("open-options-for-clear")
  const options = await sendNamed(cdp, "Target.createTarget", {
    url: `chrome-extension://${extensionId}/options.html#data`,
  })
  const optionsSession = await attach(cdp, String(options.result?.targetId))
  const readOptions = () => readDestructivePageObservation(cdp, optionsSession)
  const clickClear = () => readDestructivePageObservation(cdp, optionsSession, true)
  steps.push("clear-history-after-resume-completes")
  const firstClear = await actWhenSmokeReady(
    async () => evidence["firstClearLastReadiness"] = await readOptions() as DestructivePageObservation,
    isAnalysisHistoryClearReady,
    clickClear,
    "Options analysis-history inventory and clear button readiness",
    { timeoutMs: 45_000, intervalMs: 250 },
  )
  evidence["firstClearClickObservation"] = firstClear.result
  expect(firstClear.result.click?.events === 1,
    "the ready analysis-history control must dispatch exactly one click")
  expect(firstClear.result.click?.confirmations === 2,
    "the analysis-history clear must pass its two existing confirmations")
  const firstClearOutcome = await waitForClearOperationFeedback(
    async () => evidence["firstClearLastFeedback"] = await readOptions() as DestructivePageObservation,
    firstClear.result,
    "success",
    "analysis-history clear",
  )
  evidence["firstClearFeedback"] = firstClearOutcome
  const auditAfterClear = assertNoIntermediatePersistence(await readPersistenceAudit(cdp, input.sideSession))
  evidence["firstClearPersistenceAfterFeedback"] = auditAfterClear
  expect((auditAfterClear.stores?.analysisRuns?.count ?? -1) === 0,
    "the completed clear must leave no completed analysis history")
  const runsAtClear = auditAfterClear.stores?.analysisRuns?.runs ?? []
  evidence["clearAfterTaskRelease"] = {
    surface: await readResumeSurface(cdp, input.sideSession),
    persistence: await readPersistenceAudit(cdp, input.sideSession),
  }
  // After deletion, a new explicit full analysis is allowed. Hold its Final
  // across a second clear so the test proves no late save resurrects the data.
  steps.push("new-full-analysis-after-clear")
  await settleActiveVideo(cdp, input.sideSession, pageSession)
  state.holdLateFinal = deferred()
  state.releaseHeldResponse = deferred()
  await clickGenerate(cdp, input.sideSession, "fresh full analysis after clear")
  await waitForSmokeCondition(
    async () => state.heldFinalActive,
    Boolean,
    "new Final intercepted and held",
    { timeoutMs: 180_000 },
  )
  evidence["beforeSecondClearPersistence"] = assertNoIntermediatePersistence(
    await readPersistenceAudit(cdp, optionsSession),
  )
  const secondClear = await actWhenSmokeReady(
    async () => evidence["secondClearLastReadiness"] = await readOptions() as DestructivePageObservation,
    (observation) => isAnalysisHistoryClearReady(observation) && Boolean(activeSmokeTaskLock(observation)),
    clickClear,
    "ready analysis-history control while the new Final remains active",
    { timeoutMs: 45_000, intervalMs: 250 },
  )
  evidence["secondClearClickObservation"] = secondClear.result
  expect(secondClear.result.click?.events === 1,
    "the active-task clear attempt must dispatch exactly one click")
  expect(secondClear.result.click?.confirmations === 2,
    "the active-task clear attempt must pass its two existing confirmations")
  const finalLock = activeSmokeTaskLock(secondClear.result)
  expect(finalLock && state.heldFinalActive, "the new Final must remain held when clear is attempted")
  const blockedClearOutcome = await waitForClearOperationFeedback(
    async () => evidence["secondClearLastFeedback"] = await readOptions() as DestructivePageObservation,
    secondClear.result,
    "blocked",
    "an active full analysis must block another panel's destructive operation",
    finalLock,
  )
  evidence["clearDuringSecondFinal"] = blockedClearOutcome
  expect(state.heldFinalActive, "the new Final must still be held after the clear is blocked")
  const persistenceWhileFinalHeld = assertNoIntermediatePersistence(
    await readPersistenceAudit(cdp, input.sideSession),
  )
  evidence["persistenceWhileFinalHeldAfterBlockedClear"] = persistenceWhileFinalHeld
  expect((persistenceWhileFinalHeld.stores?.analysisRuns?.count ?? -1) === runsAtClear.length,
    "the blocked clear must not mutate history while the new Final is active")
  state.holdLateFinal = null
  state.releaseHeldResponse.release()
  evidence["afterSecondFinalRelease"] = await waitForSmokeCondition(
    async () => {
      if (state.heldFinalError) throw new Error(`held Final could not be fulfilled: ${state.heldFinalError}`)
      return readDestructivePageObservation(cdp, input.sideSession)
    },
    (observation) => state.heldFinalFulfilled && !activeSmokeTaskLock(observation),
    "held Final completion and task release",
    { timeoutMs: 180_000, intervalMs: 250 },
  )
  const audit = assertNoIntermediatePersistence(await readPersistenceAudit(cdp, input.sideSession))
  evidence["afterLateSuccessVsClear"] = {
    calls: [...state.calls],
    surface: await readResumeSurface(cdp, input.sideSession),
    persistence: audit,
    privacy: await auditNegativePrivacy(cdp, input.sideSession),
  }
  const finalRunIds = completedRunIds(audit)
  expect(runsAtClear.every((run) => typeof run.id === "string" && finalRunIds.includes(run.id!)),
    "the second destructive operation was blocked, so no old history may be resurrected")
  expect(finalRunIds.length === 1 && oldRunIds.every((id) => !finalRunIds.includes(id)),
    "the newly completed analysis must have a different ID from the deleted analysis")
  expect((audit.stores?.analysisRuns?.count ?? 0) === runsAtClear.length + 1,
    "the explicitly started fresh analysis may add exactly one new completed run")
  expect(state.calls.length === beforeReleasedClear + 6,
    "only the explicitly started fresh full analysis may add 5 Map + 1 Final")
  evidence["heldFinalDelivery"] = {
    request: state.heldFinalRequest,
    fulfilled: state.heldFinalFulfilled,
    error: state.heldFinalError,
  }
}

/* ----------------------------------------------------- AC-18 real lifecycle */

type LifecycleInput = {
  cdp: CdpConnection
  evidence: Record<string, any>
  state: SmokeState
  steps: string[]
  scenario: "refresh" | "reopen" | "cancel" | "source-switch" | "tab-switch" | "destructive" | "retry"
  extensionId: string
  pageSession: string
  originalSideTargetId: string
  sideSession: string
  sessionKinds: Map<string, "page" | "sidepanel">
}

/** Audit only metadata and test-fixture leak markers; never print stored secrets. */
async function readPersistenceAudit(cdp: CdpConnection, session: string): Promise<string> {
  return evaluate<string>(cdp, session, `(async () => {
    const readAll = (db, store) => new Promise((resolve, reject) => {
      let request;
      try { request = db.transaction(store, "readonly").objectStore(store).getAll(); }
      catch (error) { reject(error); return; }
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const openDb = () => new Promise((resolve, reject) => {
      const request = indexedDB.open("youtube-summarizer");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const [local, sync] = await Promise.all([
        chrome.storage.local.get(null), chrome.storage.sync.get(null),
      ]);
      const stores = {};
      const db = await openDb();
      for (const name of db.objectStoreNames) {
        const rows = await readAll(db, name);
        const serialized = JSON.stringify(rows);
        stores[name] = {
          count: rows.length,
          resumeMarker: /final.?resume|final.?checkpoint|resumeCheckpoint/i.test(serialized),
          mapSummaryLeak: serialized.includes("stub chunk summary"),
          statuses: [...new Set(rows.map((row) => row.status).filter((v) => typeof v === "string"))],
        };
        if (name === "analysisRuns") {
          stores[name].runs = rows.map((row) => ({
            id: row.id, videoId: row.videoId, status: row.status,
            summary: typeof row.summary === "string" ? row.summary.slice(0, 80) : null,
          }));
        }
      }
      db.close();
      const nonSecretStorageText = (area) => Object.entries(area)
        .filter(([key]) => key !== "yt-summarizer.provider.secrets")
        .map(([key, value]) => JSON.stringify([key, value])).join("\\n");
      const storageAudit = (area) => ({
        keys: Object.keys(area),
        resumeMarker: /final.?resume|final.?checkpoint|resumeCheckpoint/i.test(nonSecretStorageText(area)),
        mapSummaryLeak: nonSecretStorageText(area).includes("stub chunk summary"),
      });
      return JSON.stringify({
        database: "youtube-summarizer", stores,
        local: storageAudit(local), sync: storageAudit(sync),
      });
    } catch (error) {
      return JSON.stringify({ error: String(error) });
    }
  })()`)
}

type PersistenceAudit = {
  error?: string
  stores?: Record<string, {
    count: number, resumeMarker: boolean, mapSummaryLeak: boolean,
    runs?: Array<{ id?: string, videoId?: string, status?: string, summary?: string }>,
  }>
  local?: { keys: string[], resumeMarker: boolean, mapSummaryLeak: boolean }
  sync?: { keys: string[], resumeMarker: boolean, mapSummaryLeak: boolean }
}

function assertNoIntermediatePersistence(raw: string): PersistenceAudit {
  const audit = JSON.parse(raw) as PersistenceAudit
  expect(!audit.error, `persistence audit must succeed: ${raw}`)
  const stores = audit.stores ?? {}
  expect(Object.keys(stores).length > 0, "the real production IndexedDB schema must be present")
  for (const [name, store] of Object.entries(stores)) {
    expect(!store.resumeMarker, `IndexedDB ${name} must not contain a resume checkpoint`)
    expect(!store.mapSummaryLeak, `IndexedDB ${name} must not contain an intermediate Map summary`)
  }
  for (const [name, area] of [["local", audit.local], ["sync", audit.sync]] as const) {
    expect(!area?.resumeMarker, `Chrome ${name} Storage must not contain a resume checkpoint`)
    expect(!area?.mapSummaryLeak, `Chrome ${name} Storage must not contain an intermediate Map summary`)
  }
  return audit
}

function completedRunIds(audit: PersistenceAudit): string[] {
  return (audit.stores?.analysisRuns?.runs ?? [])
    .filter((run) => run.status === "completed" && typeof run.id === "string")
    .map((run) => run.id!)
}

async function readResumeSurface(cdp: CdpConnection, session: string): Promise<string> {
  return evaluate<string>(cdp, session, `JSON.stringify({
    continueButton: Boolean(document.querySelector('[data-testid="final-resume-continue"]')),
    resumePanel: Boolean(document.querySelector('[data-testid="final-resume-panel"]')),
    unavailable: Boolean(document.querySelector('[data-testid="final-resume-unavailable"]')),
    regenerateButton: Boolean(document.querySelector('[data-testid="final-resume-regenerate"]')),
    oldHttp502: (document.body?.innerText || "").includes("HTTP 502"),
    hasResumeCopy: /Continue final summary|继续最终总结/.test(document.body?.innerText || "")
  })`)
}

function assertNoResumeSurface(raw: string): void {
  const surface = JSON.parse(raw) as Record<string, boolean>
  expect(!surface.continueButton && !surface.resumePanel && !surface.unavailable
    && !surface.regenerateButton && !surface.oldHttp502 && !surface.hasResumeCopy,
  `the destroyed panel must not restore its resume UI: ${raw}`)
}

async function settleActiveVideo(cdp: CdpConnection, sideSession: string, pageSession: string): Promise<void> {
  await sendNamed(cdp, "Page.bringToFront", {}, pageSession)
  await Bun.sleep(300)
  await evaluate(cdp, sideSession, `(() => {
    const button = [...document.querySelectorAll("button")].find((node) => {
      const label = (node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "");
      return /refresh|刷新视频上下文/i.test(label);
    });
    if (button) button.click();
    return Boolean(button);
  })()`)
  await Bun.sleep(1200)
}

async function clickGenerate(cdp: CdpConnection, session: string, label: string): Promise<void> {
  const snapshot = await evaluate<string>(cdp, session, `(() => {
    const button = [...document.querySelectorAll("button")].find((node) =>
      /Generate analysis|Regenerate|生成分析|重新生成/i.test(node.textContent || ""));
    if (!button) return JSON.stringify({ present: false, disabled: null });
    const state = { present: true, disabled: button.disabled, text: (button.textContent || "").trim() };
    if (!button.disabled) button.click();
    return JSON.stringify(state);
  })()`)
  const button = JSON.parse(snapshot) as { present?: boolean, disabled?: boolean | null }
  expect(button.present === true && button.disabled === false,
    `${label} must expose an enabled full-analysis button: ${snapshot}`)
}

async function seedNormalHistory(
  cdp: CdpConnection,
  sideSession: string,
  pageSession: string,
  sessionKinds: Map<string, "page" | "sidepanel">,
): Promise<void> {
  sessionKinds.set(sideSession, "sidepanel")
  await sendNamed(cdp, "Fetch.enable", {
    patterns: [{ urlPattern: `${STUB_ORIGIN}/v1/*`, requestStage: "Request" }],
  }, sideSession)
  await poll(async () => evaluate<string>(cdp!, sideSession, "document.body?.innerText || ''")
    .then((text) => /Smoke Mock/.test(text) ? true : null), 45_000, "history-seed provider")
  await settleActiveVideo(cdp, sideSession, pageSession)
  await clickGenerate(cdp, sideSession, "history seed")
  await poll(async () => evaluate<string>(cdp!, sideSession, "document.body?.innerText || ''")
    .then((text) => /Smoke resume summary/.test(text) ? true : null),
  180_000, "normal history seeded through the real panel")
  await Bun.sleep(1000)
}

async function runLifecycleScenario(input: LifecycleInput): Promise<void> {
  const { cdp, evidence, state, steps, scenario, extensionId, pageSession } = input
  const before = {
    calls: [...state.calls],
    persistence: await readPersistenceAudit(cdp, input.sideSession),
  }
  assertNoIntermediatePersistence(before.persistence)
  evidence["beforeLifecycle"] = { calls: before.calls, persistence: before.persistence }

  let replacementSession: string
  if (scenario === "refresh") {
    steps.push("refresh-sidepanel")
    // Page.reload replaces the document within the same target. Keeping this
    // session proves that the checkpoint was bound to the destroyed document.
    replacementSession = input.sideSession
    await sendNamed(cdp, "Page.reload", { ignoreCache: true }, replacementSession)
  } else {
    steps.push("close-sidepanel-target")
    const closeResult = await sendNamed(cdp, "Target.closeTarget", { targetId: input.originalSideTargetId })
    expect(closeResult.result?.success === true, "the original Side Panel target must actually close")
    await poll(async () => {
      const response = await cdp.send("Target.getTargets")
      const infos = (response.result?.targetInfos ?? []) as Array<{ targetId?: string }>
      return infos.some((target) => target.targetId === input.originalSideTargetId) ? null : true
    }, 15_000, "original Side Panel target destruction")
    steps.push("reopen-new-sidepanel-target")
    const created = await sendNamed(cdp, "Target.createTarget", {
      url: `chrome-extension://${extensionId}/sidepanel.html`, background: true,
    })
    expect(String(created.result?.targetId) !== input.originalSideTargetId,
      "reopen must create a distinct Side Panel target")
    replacementSession = await attach(cdp, String(created.result?.targetId))
    evidence["lifecycleTargetIds"] = {
      closedTargetId: input.originalSideTargetId,
      reopenedTargetId: String(created.result?.targetId),
      distinct: String(created.result?.targetId) !== input.originalSideTargetId,
    }
    input.sessionKinds.set(replacementSession, "sidepanel")
  }

  await sendNamed(cdp, "Fetch.enable", {
    patterns: [{ urlPattern: `${STUB_ORIGIN}/v1/*`, requestStage: "Request" }],
  }, replacementSession)
  await sendNamed(cdp, "Page.enable", {}, replacementSession)
  await poll(async () => evaluate<boolean>(cdp!, replacementSession,
    "document.getElementById('__plasmo')?.childElementCount > 0"),
  60_000, `${scenario} replacement panel mount`)
  await poll(async () => evaluate<string>(cdp!, replacementSession,
    "document.body?.innerText || ''").then((text) => /Smoke Mock/.test(text) ? true : null),
  45_000, `${scenario} replacement provider`)
  await settleActiveVideo(cdp, replacementSession, pageSession)
  // A quiet window rules out a delayed automatic request, not only an immediate one.
  await Bun.sleep(2000)
  const callsBeforeSecondRun = [...state.calls]
  expect(callsBeforeSecondRun.length === before.calls.length,
    `${scenario} must not send any provider request: ${JSON.stringify(callsBeforeSecondRun.slice(before.calls.length))}`)
  expect(callsBeforeSecondRun.every((call, index) => call.kind === before.calls[index]?.kind
    && call.status === before.calls[index]?.status),
  `${scenario} must not alter the completed provider call history`)
  evidence["afterLifecycle"] = {
    providerCalls: callsBeforeSecondRun,
    surface: await readResumeSurface(cdp, replacementSession),
    persistence: await readPersistenceAudit(cdp, replacementSession),
  }
  assertNoResumeSurface(evidence["afterLifecycle"].surface)
  const after = assertNoIntermediatePersistence(evidence["afterLifecycle"].persistence)
  if (scenario === "reopen") {
    const originalIds = completedRunIds(assertNoIntermediatePersistence(before.persistence))
    const reopenedIds = completedRunIds(after)
    expect(originalIds.length > 0, "the reopen scenario must seed a real completed history record")
    expect(originalIds.every((id) => reopenedIds.includes(id)),
      "closing/reopening must preserve the pre-existing normal history")
    evidence["preservedHistoryIds"] = originalIds
  }

  if (scenario === "refresh") return
  steps.push("fresh-analysis-after-reopen")
  await sendNamed(cdp, "Page.navigate", {
    url: `${STUB_ORIGIN}/watch?v=smokeVideo2`,
  }, pageSession)
  await evaluate(cdp, pageSession, playerSurfaceScript("smokeVideo2"))
  await settleActiveVideo(cdp, replacementSession, pageSession)
  const beforeFresh = state.calls.length
  await clickGenerate(cdp, replacementSession, "fresh post-reopen analysis")
  await poll(async () => evaluate<string>(cdp!, replacementSession, "document.body?.innerText || ''")
    .then((text) => /Smoke resume summary/.test(text) ? true : null),
  180_000, "fresh analysis after reopen")
  await Bun.sleep(1000)
  const freshCalls = state.calls.slice(beforeFresh)
  evidence["freshAfterReopen"] = {
    calls: freshCalls,
    surface: await readResumeSurface(cdp, replacementSession),
    persistence: await readPersistenceAudit(cdp, replacementSession),
  }
  expect(freshCalls.filter((call) => call.kind === "map").length === 5,
    "the fresh post-reopen analysis must execute 5 Map calls")
  expect(freshCalls.filter((call) => call.kind === "reduction").length === 0,
    "the fresh post-reopen analysis must not require Reduction")
  expect(freshCalls.filter((call) => call.kind === "final").length === 1
    && freshCalls.find((call) => call.kind === "final")?.status === 200,
  "the fresh post-reopen analysis must execute one successful Final")
  assertNoResumeSurface(evidence["freshAfterReopen"].surface)
  const finalAudit = assertNoIntermediatePersistence(evidence["freshAfterReopen"].persistence)
  expect((finalAudit.stores?.analysisRuns?.runs ?? []).some((run) =>
    run.videoId === "smokeVideo2" && run.status === "completed"),
  "the fresh post-reopen analysis must be persisted as a normal completed run")
  expect(completedRunIds(after).every((id) => completedRunIds(finalAudit).includes(id)),
    "the fresh analysis must not overwrite the pre-existing normal history")
}

async function sendNamed(
  cdp: CdpConnection,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
) {
  const response = await cdp.send(method, params, sessionId)
  if (response.error) {
    throw new Error(`CDP ${method} failed (${response.error.code}): ${response.error.message}`)
  }
  return response
}

async function attach(cdp: CdpConnection, targetId: string): Promise<string> {
  const response = await sendNamed(cdp, "Target.attachToTarget", { targetId, flatten: true })
  const sessionId = response.result?.sessionId
  if (typeof sessionId !== "string") throw new Error(`could not attach to ${targetId}`)
  await sendNamed(cdp, "Runtime.enable", {}, sessionId)
  return sessionId
}

async function evaluate<T>(
  cdp: CdpConnection,
  sessionId: string,
  expression: string,
): Promise<T> {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  if (response.error) {
    throw new Error(`CDP Runtime.evaluate failed (${response.error.code}): ${response.error.message}`)
  }
  const exception = response.result?.exceptionDetails
  if (exception) throw new Error(`evaluate failed: ${JSON.stringify(exception)}`)
  const result = response.result?.result as { value?: unknown } | undefined
  return result?.value as T
}

async function poll<T>(
  read: () => Promise<T | null>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: unknown = null
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value !== null) return value
    } catch (error) {
      last = error
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${String(last)}` : ""}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
