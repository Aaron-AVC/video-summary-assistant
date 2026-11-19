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
 * The provider is a local mock; no paid request is made. The script prints one
 * JSON evidence line and exits non-zero on any failed assertion.
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

type CliOptions = {
  artifactDir: string
  chromePath: string
  keepProfile: boolean
}

function parseArgs(argv: string[]): CliOptions {
  let artifactDir = resolve(DEFAULT_ARTIFACT_DIR)
  let chromePath = process.env.VSA_CHROME_PATH ?? ""
  let keepProfile = false
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
    }
  }
  if (!chromePath) {
    throw new Error("A Chrome for Testing executable is required: pass --chrome <path>.")
  }
  const validated = validateChromePath(chromePath, existsSync)
  if (!validated.ok) throw new Error((validated as { message: string }).message)
  return { artifactDir, chromePath: validated.path, keepProfile }
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

type SmokeState = {
  calls: ProviderCall[]
  failFirstFinal: boolean
  /** Which CDP session's Fetch domain answered each intercepted class. */
  interceptTargets: Record<string, string>
  interceptCounts: Record<string, number>
}

const TIMEDTEXT_PATH = "/api/timedtext"
const STUB_ORIGIN = "https://www.youtube.com"

/* --------------------------------------------------------- stub page assets */

/**
 * The player JSON `readPageMetadata` scrapes. `videoDetails.videoId` must equal
 * the URL id or the caption tracks are dropped (see header note 2).
 */
function stubPlayerResponse() {
  return {
    videoDetails: {
      videoId: VIDEO_ID,
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
          baseUrl: `${STUB_ORIGIN}${TIMEDTEXT_PATH}?v=${VIDEO_ID}&lang=en`,
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
const PLAYER_SURFACE_SCRIPT = `(() => {
  const player = document.getElementById("movie_player");
  if (!player) return false;
  player.getVideoData = () => ({
    videoId: ${JSON.stringify(VIDEO_ID)},
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
function stubWatchHtml(): string {
  const player = JSON.stringify(stubPlayerResponse())
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
<script>${PLAYER_SURFACE_SCRIPT}</script>
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
      body: stubWatchHtml(),
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
    if (kind === "final" && state.failFirstFinal) {
      state.failFirstFinal = false
      state.calls.push({ kind, status: 502, index: state.calls.length })
      return {
        status: 502,
        headers: [{ name: "content-type", value: "text/html; charset=utf-8" }],
        body: "<html><body>upstream error</body></html>",
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
    failFirstFinal: true,
    interceptTargets: {},
    interceptCounts: {},
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
      void cdp!.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: result.status,
        responseHeaders: result.headers,
        body: Buffer.from(result.body).toString("base64"),
      }, sessionId).catch(() => undefined)
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
    const bootstrapped = await evaluate<boolean>(cdp, pageSession, PLAYER_SURFACE_SCRIPT)
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
    await sendNamed(cdp, "Target.closeTarget", { targetId: optionsTargetId })

    steps.push("create-sidepanel")
    const sidePanel = await sendNamed(cdp, "Target.createTarget", { url: "about:blank" })
    steps.push("focus-sidepanel")
    const sideSession = await attach(cdp, String(sidePanel.result?.targetId))
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

    const firstPass = {
      mapCalls: state.calls.filter((call) => call.kind === "map").length,
      reductionCalls: state.calls.filter((call) => call.kind === "reduction").length,
      finalCalls: state.calls.filter((call) => call.kind === "final").length,
      repairCalls: state.calls.filter((call) => call.kind === "repair").length,
      finalStatuses: state.calls.filter((call) => call.kind === "final").map((call) => call.status),
      // The resume panel renders "最终总结失败 · HTTP 502" and its own 502 status,
      // so both the visible status line and the provider record are checked.
      showed502: /HTTP 502/.test(parsedResumeView.text ?? ""),
    }
    evidence["firstPass"] = firstPass
    evidence["callsAfterFirstPass"] = [...state.calls]

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
