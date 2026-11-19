/**
 * M3 Side Panel interaction smoke.
 *
 * This is NOT a unit test. It loads the real production extension artifact into
 * Chrome for Testing, serves a stub YouTube watch page and a stub
 * OpenAI-compatible provider, and drives the actual Side Panel buttons:
 *
 *   Generate -> Map calls -> Final returns HTTP 502 -> "Continue final summary"
 *   -> exactly one Final call -> the analysis is saved and re-renders.
 *
 * The provider is a local mock; no paid request is made. The script prints one
 * JSON evidence line and exits non-zero on any failed assertion.
 *
 * Run:
 *   bun scripts/verify-final-resume-smoke.ts --chrome "<chrome.exe>" \
 *     --artifact build/chrome-mv3-prod
 */

import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
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
import { readFileSync } from "node:fs"
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

const CUES = Array.from({ length: 10 }, (_, index) => ({
  startSec: index * 10,
  endSec: (index + 1) * 10,
  text: `${index} ${"caption ".repeat(20)}`,
}))

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

type ProviderKind = "map" | "reduction" | "final" | "repair"
type ProviderCall = { kind: ProviderKind, status: number }

type SmokeState = {
  calls: ProviderCall[]
  failFirstFinal: boolean
}

function timedTextFromCues() {
  const stamp = (value: number) => {
    const hours = String(Math.floor(value / 3600)).padStart(2, "0")
    const minutes = String(Math.floor((value % 3600) / 60)).padStart(2, "0")
    const seconds = String(Math.floor(value % 60)).padStart(2, "0")
    return `${hours}:${minutes}:${seconds},000`
  }
  return CUES.map((cue, index) =>
    `${index + 1}\n${stamp(cue.startSec)} --> ${stamp(cue.endSec)}\n${cue.text}\n`
  ).join("\n")
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

function classifyPrompt(text: string): ProviderKind {
  if (/repair|invalid/i.test(text)) return "repair"
  if (/Reduction level:/i.test(text)) return "reduction"
  if (/JSON only|valid JSON object/i.test(text)) return "final"
  return "map"
}

/**
 * Stub server: `/watch` serves a YouTube-like page whose player metadata
 * advertises one caption track, `/api/timedtext` serves that transcript, and
 * `/v1/chat/completions` is the fake OpenAI-compatible provider.
 */
function startStubServer(state: SmokeState): Promise<{ server: Server, port: number }> {
  const server = createServer(async (request, response) => {
    const origin = `http://127.0.0.1:${(request.socket.localPort ?? 0)}`
    const url = new URL(request.url ?? "/", origin)

    if (url.pathname.startsWith("/v1/chat/completions")) {
      const body = await readBody(request)
      let text = body
      try {
        const parsed = JSON.parse(body) as { messages?: Array<{ content?: string }> }
        text = (parsed.messages ?? []).map((message) => message.content ?? "").join("\n")
      } catch {
        // Keep the raw body for classification.
      }
      const kind = classifyPrompt(text)
      if (kind === "final") {
        if (state.failFirstFinal) {
          state.failFirstFinal = false
          state.calls.push({ kind, status: 502 })
          response.writeHead(502, { "content-type": "text/html" })
          response.end("<html><body>upstream error</body></html>")
          return
        }
        state.calls.push({ kind, status: 200 })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: VALID_ANALYSIS } }],
        }))
        return
      }
      state.calls.push({ kind, status: 200 })
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "stub chunk summary" } }],
      }))
      return
    }

    if (url.pathname === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ data: [{ id: "smoke-model" }] }))
      return
    }

    if (url.pathname.includes("timedtext")) {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
      response.end(timedTextFromCues())
      return
    }

    if (url.pathname === "/watch") {
      const videoId = url.searchParams.get("v") ?? "smokeVideo01"
      const player = {
        videoDetails: {
          videoId,
          title: "Smoke M3 Video",
          author: "Smoke Author",
          lengthSeconds: String(CUES.at(-1)!.endSec),
          isLiveContent: false,
        },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{
              baseUrl: `${origin}/api/timedtext?v=${videoId}&lang=en`,
              languageCode: "en",
              kind: "",
              name: { simpleText: "English" },
            }],
          },
        },
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(`<!doctype html><html><head><title>Smoke M3 Video - YouTube</title></head>
<body>
<script>window.ytInitialPlayerResponse = ${JSON.stringify(player)};</script>
<div id="movie_player" class="html5-video-player"></div>
</body></html>`)
      return
    }

    response.writeHead(404, { "content-type": "text/plain" })
    response.end("not found")
  })

  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      resolveServer({ server, port })
    })
  })
}

/* --------------------------------------------------------------- CDP helpers */

type Target = { id: string, type: string, url: string, title: string }

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

/** The stub YouTube watch document served through request interception. */
function stubWatchHtml(port: number, videoId: string): string {
  const player = {
    videoDetails: {
      videoId,
      title: "Smoke M3 Video",
      author: "Smoke Author",
      lengthSeconds: String(CUES.at(-1)!.endSec),
      isLiveContent: false,
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{
          baseUrl: `http://127.0.0.1:${port}/api/timedtext?v=${videoId}&lang=en`,
          languageCode: "en",
          kind: "",
          name: { simpleText: "English" },
        }],
      },
    },
  }
  return `<!doctype html><html><head><title>Smoke M3 Video - YouTube</title></head>
<body>
<script>window.ytInitialPlayerResponse = ${JSON.stringify(player)};</script>
<div id="movie_player" class="html5-video-player">
  <video id="smoke-video" muted></video>
</div>
<ytd-watch-metadata><h1><yt-formatted-string>Smoke M3 Video</yt-formatted-string></h1></ytd-watch-metadata>
<meta itemprop="duration" content="PT1M40S">
</body></html>`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const state: SmokeState = { calls: [], failFirstFinal: true }
  const { server, port } = await startStubServer(state)

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

    steps.push("create-page")
    // The runtime bridge only treats a tab as a supported video when its URL is
    // a real YouTube watch URL, so the stub page is served through a request
    // interception that rewrites the host while keeping the local origin.
    const pageResponse = await sendNamed(cdp, "Target.createTarget", { url: "about:blank" })
    const pageTargetId = String(pageResponse.result?.targetId)
    let pageSession = ""
    pageSession = await attach(cdp, pageTargetId)
    await sendNamed(cdp, "Page.enable", {}, pageSession)
    await sendNamed(cdp, "Fetch.enable", {
      patterns: [{ urlPattern: "https://www.youtube.com/watch*", requestStage: "Request" }],
    }, pageSession)
    cdp.onEvent((message) => {
      if (message.sessionId !== pageSession) return
      if (message.method !== "Fetch.requestPaused") return
      const requestId = String((message.params as { requestId?: string })?.requestId)
      void (async () => {
        if (!requestId) return
        await cdp!.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: "content-type", value: "text/html; charset=utf-8" }],
          body: Buffer.from(stubWatchHtml(port, "smokeVideo01")).toString("base64"),
        }, pageSession).catch(() => undefined)
      })()
    })
    // The page CSP blocks inline scripts, so the player surface the adapter's
    // MAIN-world probe needs is installed through CDP (which CSP does not block).
    const playerBootstrap = `(() => {
      const player = document.getElementById("movie_player");
      if (!player) return false;
      player.getVideoData = () => ({
        videoId: "smokeVideo01",
        title: "Smoke M3 Video",
        author: "Smoke Author"
      });
      player.getOption = (category, option) => {
        if (category === "captions" && option === "tracklist") {
          return [{ languageCode: "en", languageName: "English", displayName: "English", kind: "" }];
        }
        return null;
      };
      player.isSubtitlesOn = () => false;
      return true;
    })()`
    await sendNamed(cdp, "Page.navigate", {
      url: `https://www.youtube.com/watch?v=smokeVideo01`,
    }, pageSession)
    await poll(
      async () => evaluate<boolean>(cdp!, pageSession, "Boolean(document.getElementById('movie_player'))"),
      30_000,
      "stub player element",
    )
    const bootstrapped = await evaluate<boolean>(cdp, pageSession, playerBootstrap)
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
    // The extension id is only needed to address extension pages. Storage is
    // seeded from a page loaded at the extension origin so `chrome.storage` is
    // available; `about:blank` has no extension APIs.
    const extensionId = extensionTarget.extensionId
    evidence["extensionId"] = extensionId

    steps.push("create-options")
    // Seed settings from the Options surface: it is an ordinary extension page
    // with chrome.storage, and using a separate page keeps the Side Panel's
    // first document the one that boots with the mock provider already present.
    // Attaching to a target created *with* the extension URL can miss the
    // extension execution context, which the artifact gate also avoids: create
    // about:blank, attach, then navigate.
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
          baseUrl: `http://127.0.0.1:${port}/v1`,
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
    await sendNamed(cdp, "Target.closeTarget", { targetId: optionsTargetId })

    steps.push("create-sidepanel")
    const sidePanel = await sendNamed(cdp, "Target.createTarget", { url: "about:blank" })
    steps.push("focus-sidepanel")
    const sideSession = await attach(cdp, String(sidePanel.result?.targetId))
    // A background/occluded tab can have its rendering deferred; focusing the
    // target keeps React mounting and effect timers running.
    await sendNamed(cdp, "Emulation.setFocusEmulationEnabled", { enabled: true }, sideSession)
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
      trackCount: window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0
    })`)
    evidence["pageDiag"] = pageDiag
    const runtimeDiag = await evaluate<string>(cdp, sideSession, `(async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const all = await chrome.tabs.query({});
      return JSON.stringify({
        active: tabs.map((t) => ({ id: t.id, url: t.url })),
        all: all.map((t) => ({ id: t.id, url: t.url })).slice(0, 8)
      });
    })()`)
    evidence["runtimeDiag"] = runtimeDiag
    const backgroundProbe = await evaluate<string>(cdp, sideSession, `(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          channel: "video-summary-assistant/runtime",
          type: "get-active-video-context"
        });
        return JSON.stringify(response).slice(0, 600);
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
    const contentDiagnostic = await evaluate<string>(cdp, pageSession, `(async () => {
      try {
        const adapterModule = await import("/contents/youtube-watch.js").catch(() => null);
        return JSON.stringify({ imported: Boolean(adapterModule) });
      } catch (error) {
        return JSON.stringify({ error: String(error) });
      }
    })()`).catch((error) => String(error))
    evidence["contentDiagnostic"] = contentDiagnostic
    evidence["pageErrors"] = pageErrors.slice(0, 5)

    const contentProbe = await evaluate<string>(cdp, sideSession, `(async () => {
      const tabs = await chrome.tabs.query({});
      const video = tabs.find((tab) => (tab.url || "").includes("youtube.com/watch"));
      if (!video || video.id === undefined) return "no-video-tab";
      try {
        const ping = await chrome.tabs.sendMessage(video.id, {
          channel: "video-summary-assistant/runtime",
          type: "get-active-video-context"
        });
        return JSON.stringify({ ok: true, ping });
      } catch (error) {
        return JSON.stringify({ ok: false, error: String(error) });
      }
    })()`)
    evidence["contentProbe"] = contentProbe

    const adapterProbe = await evaluate<string>(cdp, pageSession, `(async () => {
      const candidates = ["/contents/youtube-watch.js"];
      const results = [];
      for (const path of candidates) {
        try {
          const mod = await import(chrome.runtime.getURL(path));
          results.push({ path, keys: Object.keys(mod) });
        } catch (error) {
          results.push({ path, error: String(error) });
        }
      }
      return JSON.stringify(results);
    })()`).catch((error) => String(error))
    evidence["adapterProbe"] = adapterProbe

    const clickedGenerate = await evaluate<boolean>(cdp, sideSession, `(() => {
      const buttons = [...document.querySelectorAll("button")];
      const target = buttons.find((button) => /Generate analysis|Regenerate|生成分析|重新生成/i.test(button.textContent || ""));
      if (!target) return false;
      target.click();
      return true;
    })()`)
    if (!clickedGenerate) {
      const diagnostic = await evaluate<string>(cdp, sideSession, `(async () => {
        const stored = await chrome.storage.local.get(null);
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return JSON.stringify({
          href: location.href,
          buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).slice(0, 40),
          text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 400),
          storageKeys: Object.keys(stored),
          activeTab: tabs.map((tab) => tab.url)
        });
      })()`)
      throw new Error(`the Generate/Regenerate button should exist: ${diagnostic}`)
    }

    const resumeText = await poll(async () => {
      const text = await evaluate<string>(cdp!, sideSession, "document.body.innerText")
      return /Continue final summary|继续最终总结/.test(text) ? text : null
    }, 120_000, "final resume entry after HTTP 502").catch(async (error) => {
      const panel = await evaluate<string>(cdp!, sideSession,
        "(document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 700)")
      throw new Error(`${String(error)} | calls=${JSON.stringify(state.calls)} | panel=${panel}`)
    })

    evidence["firstPass"] = {
      mapCalls: state.calls.filter((call) => call.kind === "map").length,
      reductionCalls: state.calls.filter((call) => call.kind === "reduction").length,
      finalCalls: state.calls.filter((call) => call.kind === "final").length,
      showed502: /HTTP 502/.test(resumeText),
    }
    expect(state.calls.filter((call) => call.kind === "final").length === 1,
      "the first pass must issue exactly one Final request")

    const callsBeforeResume = state.calls.length
    const clickedResume = await evaluate<boolean>(cdp, sideSession, `(() => {
      const button = document.querySelector('[data-testid="final-resume-continue"]');
      if (!button) return false;
      button.click();
      return true;
    })()`)
    expect(clickedResume, "the dedicated continue button should be present")

    const completedText = await poll(async () => {
      const text = await evaluate<string>(cdp!, sideSession, "document.body.innerText")
      return /Smoke resume summary|Smoke M3/.test(text) ? text : null
    }, 120_000, "resumed analysis rendered")

    const resumeCalls = state.calls.slice(callsBeforeResume)
    evidence["resumePass"] = {
      mapCalls: resumeCalls.filter((call) => call.kind === "map").length,
      reductionCalls: resumeCalls.filter((call) => call.kind === "reduction").length,
      finalCalls: resumeCalls.filter((call) => call.kind === "final").length,
      renderedSummary: /Smoke resume summary/.test(completedText),
      resumeEntryGone: !/Continue final summary/.test(completedText),
    }
    expect(evidence["resumePass"].mapCalls === 0, "resume must not call Map again")
    expect(evidence["resumePass"].reductionCalls === 0, "resume must not call Reduction again")
    expect(evidence["resumePass"].finalCalls === 1, "resume must issue exactly one Final request")

    const html = await evaluate<string>(cdp, sideSession, "document.documentElement.outerHTML")
    evidence["leaks"] = {
      apiKey: html.includes("sk-smoke-fixture"),
      mapSummary: html.includes("stub chunk summary"),
    }
    expect(evidence["leaks"].apiKey === false, "the API key must never reach the panel DOM")
    expect(evidence["leaks"].mapSummary === false, "map summaries must never reach the panel DOM")

    evidence["result"] = "PASS"
    console.log(`@@SMOKE_EVIDENCE@@${JSON.stringify(evidence)}`)
  } catch (error) {
    evidence["steps"] = steps
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
    server.close()
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
