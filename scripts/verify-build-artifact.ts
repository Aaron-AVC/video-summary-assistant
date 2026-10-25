/**
 * Production artifact runtime gate.
 *
 * Answers exactly one question: can the current production build
 * (`build/chrome-mv3-prod`) start and evaluate inside a real Chromium?
 *
 * It is NOT an E2E test and it does NOT test YouTube/Bilibili product flows.
 * It launches a throwaway Chromium profile, loads the built extension, and
 * verifies that the background service worker, the Side Panel bundle and the
 * Options bundle all evaluate and mount without uncaught runtime exceptions.
 *
 * No Playwright / Puppeteer / Selenium / jsdom: only Bun + CDP over WebSocket.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import { CdpConnection, fetchVersionInfo, waitForDevToolsPort } from "./lib/cdp-client"
import {
  ArtifactGateError,
  CHROME_PATH_ENV,
  DEFAULT_ARTIFACT_DIR,
  REQUIRED_ARTIFACT_FILES,
  STABILITY_WINDOW_MS,
  STAGE_TIMEOUTS_MS,
  buildChromeArgs,
  classifyFatalMessage,
  describeTimeout,
  extractExtensionId,
  findUnsafeManifestPath,
  isApplicationMounted,
  listExtensionServiceWorkerCandidates,
  matchesArtifactManifest,
  parseArtifactManifest,
  parseRuntimeManifestSnapshot,
  planCleanup,
  resolveArtifactPath,
  resolveBackgroundScriptPath,
  selectVerifiedExtensionCandidate,
  toExceptionRecord,
  validateChromePath,
  type ArtifactManifest,
  type CdpTarget,
  type ExceptionRecord,
  type GateStage,
  type ServiceWorkerCandidate,
  type SpawnedBrowser,
  type VerifiedExtensionCandidate,
} from "./lib/artifact-gate-policy"

type CliOptions = {
  artifactDir: string
  chromePath: string | null
}

/**
 * Set by the running gate so signal handlers can run the same cleanup path.
 * Null before any browser was spawned.
 */
let signalCleanup: (() => Promise<void>) | null = null

type GateResult = {
  chromeVersion: string
  extensionLoaded: boolean
  background: boolean
  sidePanel: boolean
  options: boolean
  noUncaughtExceptions: boolean
  informationalCount: number
}

function parseArgs(argv: readonly string[]): CliOptions {
  let artifactDir = DEFAULT_ARTIFACT_DIR
  let chromePath = process.env[CHROME_PATH_ENV]?.trim() || null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--artifact") {
      const value = argv[index + 1]
      if (!value) throw new ArtifactGateError("preflight", "--artifact requires a path argument.")
      artifactDir = value
      index += 1
      continue
    }
    if (arg === "--chrome") {
      const value = argv[index + 1]
      if (!value) throw new ArtifactGateError("preflight", "--chrome requires an executable path.")
      chromePath = value
      index += 1
      continue
    }
    if (arg === "--help" || arg === "-h") {
      printUsage()
      process.exit(0)
    }
    throw new ArtifactGateError("preflight", `Unknown argument: ${arg}`)
  }

  return { artifactDir, chromePath }
}

function printUsage(): void {
  console.log(`Production artifact runtime gate

Usage:
  bun run verify:artifact [--artifact <dir>] [--chrome <path>]

Options:
  --artifact <dir>  Extension directory to execute. Default: ${DEFAULT_ARTIFACT_DIR}
  --chrome <path>   Chromium executable. Default: $${CHROME_PATH_ENV}

The gate executes an existing production build; it never rebuilds the artifact.
Run \`bun run build\` first.
`)
}

function fail(stage: GateStage, message: string, hint?: string): never {
  throw new ArtifactGateError(stage, message, hint)
}

function assertFile(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail("preflight", `Production artifact is missing ${label}: ${path}`, "Run `bun run build` first.")
  }
}

function assertArtifactReady(artifactDir: string): ArtifactManifest {
  if (!existsSync(artifactDir) || !statSync(artifactDir).isDirectory()) {
    fail(
      "preflight",
      `Production artifact not found: ${artifactDir}`,
      "Run `bun run build` before `bun run verify:artifact`.",
    )
  }

  for (const required of REQUIRED_ARTIFACT_FILES) {
    assertFile(join(artifactDir, required), required)
  }

  const manifestPath = join(artifactDir, "manifest.json")
  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch (error) {
    fail("preflight", `Unreadable manifest at ${manifestPath}: ${String(error)}`)
  }

  const manifest = parseArtifactManifest(rawManifest)
  if (!manifest) {
    // Distinguish "escape attempt" from "just not MV3" so the failure is actionable.
    const unsafePath = findUnsafeManifestPath(rawManifest)
    if (unsafePath) {
      fail(
        "preflight",
        `Manifest declares an unsafe ${unsafePath.field} path: ${JSON.stringify(unsafePath.value)}`,
        "Extension page paths must stay inside the artifact directory (no absolute, drive-qualified or `..` traversal paths).",
      )
    }
    fail("preflight", `Manifest at ${manifestPath} is not a usable Manifest V3 extension.`)
  }

  const backgroundScript = resolveBackgroundScriptPath(manifest)
  if (!backgroundScript) {
    fail("preflight", "Manifest does not declare a usable background service worker.")
  }
  assertFile(join(artifactDir, backgroundScript), `manifest background script (${backgroundScript})`)

  if (!manifest.sidePanelPath) {
    fail("preflight", "Manifest does not declare side_panel.default_path.")
  }
  assertFile(join(artifactDir, manifest.sidePanelPath), "side panel page")
  if (!manifest.optionsPath) {
    fail("preflight", "Manifest does not declare options_ui.page.")
  }
  assertFile(join(artifactDir, manifest.optionsPath), "options page")

  return manifest
}

function randomRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toTargets(list: readonly unknown[]): CdpTarget[] {
  const targets: CdpTarget[] = []
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue
    const record = raw as Record<string, unknown>
    // `Target.getTargets` reports `targetId`; `/json/list` reports `id`.
    const id = typeof record.targetId === "string" ? record.targetId : record.id
    if (typeof id !== "string" || typeof record.type !== "string" || typeof record.url !== "string") {
      continue
    }
    targets.push({
      id,
      type: record.type,
      url: record.url,
      title: typeof record.title === "string" ? record.title : undefined,
    })
  }
  return targets
}

async function listTargets(connection: CdpConnection): Promise<CdpTarget[]> {
  const response = await connection.send("Target.getTargets")
  const infos = response.result?.targetInfos
  if (!Array.isArray(infos)) return []
  return toTargets(infos)
}

class ExceptionCollector {
  readonly fatal: ExceptionRecord[] = []
  readonly informational: ExceptionRecord[] = []

  add(record: ExceptionRecord, level?: string): void {
    const classification = classifyFatalMessage({
      source: record.source,
      message: record.message,
      level,
    })
    if (classification.fatal) {
      this.fatal.push(record)
    } else {
      this.informational.push(record)
    }
  }

  get hasFatal(): boolean {
    return this.fatal.length > 0
  }

  /** Attach Runtime/Log listeners for one CDP session. */
  watch(
    connection: CdpConnection,
    sessionId: string,
    label: string,
    resolveUrl: () => string,
  ): () => void {
    return connection.onEvent((message) => {
      if (message.sessionId !== sessionId) return

      if (message.method === "Runtime.exceptionThrown") {
        this.add(toExceptionRecord("runtime.exceptionThrown", label, resolveUrl(), message.params?.exceptionDetails))
        return
      }

      if (message.method === "Runtime.consoleAPICalled") {
        const type = typeof message.params?.type === "string" ? message.params.type : "log"
        if (type !== "error" && type !== "assert") return
        const args = Array.isArray(message.params?.args) ? message.params.args : []
        const text = args
          .map((arg) => {
            if (typeof arg !== "object" || arg === null) return String(arg)
            const record = arg as Record<string, unknown>
            if (typeof record.value === "string") return record.value
            if (typeof record.description === "string") return record.description
            return ""
          })
          .filter((part) => part.length > 0)
          .join(" ")
        this.add({ source: "runtime.consoleAPICalled", target: label, url: resolveUrl(), message: text }, type)
        return
      }

      if (message.method === "Log.entryAdded") {
        const entry = message.params?.entry
        if (typeof entry !== "object" || entry === null) return
        const record = entry as Record<string, unknown>
        const level = typeof record.level === "string" ? record.level : "info"
        if (level !== "error" && level !== "warning") return
        this.add(
          {
            source: "log.entryAdded",
            target: label,
            url: typeof record.url === "string" ? record.url : resolveUrl(),
            message: typeof record.text === "string" ? record.text : "",
          },
          level,
        )
      }
    })
  }
}

async function attachToTarget(
  connection: CdpConnection,
  targetId: string,
  stage: GateStage,
): Promise<string> {
  const response = await connection.send("Target.attachToTarget", { targetId, flatten: true })
  const sessionId = response.result?.sessionId
  if (typeof sessionId !== "string") {
    fail(stage, `CDP refused to attach to target ${targetId}.`)
  }
  return sessionId
}

async function evaluate<T>(
  connection: CdpConnection,
  sessionId: string,
  expression: string,
  stage: GateStage,
): Promise<T> {
  const response = await connection.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  const details = response.result?.exceptionDetails
  if (details) {
    const record = toExceptionRecord("runtime.exceptionThrown", "evaluate", "cdp://evaluate", details)
    fail(stage, `Evaluation failed: ${record.message}`, `Expression: ${expression}`)
  }
  const remote = response.result?.result
  if (typeof remote !== "object" || remote === null) {
    fail(stage, `CDP returned no value for expression: ${expression}`)
  }
  return (remote as Record<string, unknown>).value as T
}

/**
 * Read the worker's own manifest. This is the authoritative identity surface:
 * the target URL is only used to enumerate candidates and is not trusted as the
 * background-script path.
 */
const MANIFEST_PROBE = `(() => {
  try {
    return JSON.stringify({ id: chrome.runtime.id, manifest: chrome.runtime.getManifest() })
  } catch (error) {
    return JSON.stringify({ id: null, error: String(error) })
  }
})()`

type MountSnapshot = {
  readyState: string
  rootChildCount: number
  bodyChildCount: number
}

const MOUNT_PROBE = `(() => {
  const root = document.getElementById("__plasmo")
  return JSON.stringify({
    readyState: document.readyState,
    rootChildCount: root ? root.childElementCount : 0,
    bodyChildCount: document.body ? document.body.children.length : 0
  })
})()`

async function waitForMount(
  connection: CdpConnection,
  sessionId: string,
  stage: "sidePanel" | "options",
  pageLabel: string,
  collector: ExceptionCollector,
): Promise<void> {
  const deadline = Date.now() + STAGE_TIMEOUTS_MS[stage]
  let lastSnapshot: MountSnapshot | null = null

  while (Date.now() < deadline) {
    // Fail fast on a bundle evaluation error instead of waiting out the mount
    // budget and reporting a misleading timeout.
    if (collector.hasFatal) {
      fail(stage, `${pageLabel} production bundle threw during evaluation; it can never mount.`)
    }
    const raw = await evaluate<string>(connection, sessionId, MOUNT_PROBE, stage)
    lastSnapshot = JSON.parse(raw) as MountSnapshot
    if (isApplicationMounted(lastSnapshot)) return
    await Bun.sleep(200)
  }

  fail(
    stage,
    describeTimeout(stage),
    `${pageLabel} never mounted. Last observation: ${JSON.stringify(lastSnapshot)}`,
  )
}

async function stabilityWindow(): Promise<void> {
  const deadline = Date.now() + STABILITY_WINDOW_MS
  while (Date.now() < deadline) await Bun.sleep(100)
}

/**
 * Read one service worker's own manifest and keep it only if it matches the
 * artifact under test.
 *
 * A worker that cannot be attached to, or that reports a different manifest,
 * is simply not the artifact: returning null keeps discovery polling instead of
 * failing the run on a bundled browser extension. Failures are not cached by the
 * caller so a worker that restarts mid-discovery gets another chance.
 */
async function probeServiceWorkerManifest(
  connection: CdpConnection,
  candidate: ServiceWorkerCandidate,
  expected: ArtifactManifest,
): Promise<VerifiedExtensionCandidate | null> {
  let sessionId: string | null = null
  const trace = (message: string): void => {
    if (process.env.VSA_GATE_DEBUG) console.log(`[discovery-debug] ${candidate.target.id}: ${message}`)
  }
  try {
    const attached = await connection.send("Target.attachToTarget", {
      targetId: candidate.target.id,
      flatten: true,
    })
    const attachedSession = attached.result?.sessionId
    if (typeof attachedSession !== "string") {
      trace(`attach returned no session: ${JSON.stringify(attached)}`)
      return null
    }
    sessionId = attachedSession

    await connection.send("Runtime.enable", {}, sessionId)
    const response = await connection.send(
      "Runtime.evaluate",
      { expression: MANIFEST_PROBE, returnByValue: true },
      sessionId,
    )
    if (response.result?.exceptionDetails) {
      trace(`evaluate threw: ${JSON.stringify(response.result.exceptionDetails)}`)
      return null
    }

    const remote = response.result?.result
    const value =
      typeof remote === "object" && remote !== null
        ? (remote as Record<string, unknown>).value
        : undefined
    if (typeof value !== "string") {
      trace(`evaluate returned non-string: ${JSON.stringify(response)}`)
      return null
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      trace(`payload is not JSON: ${value.slice(0, 200)}`)
      return null
    }
    const snapshot = parseRuntimeManifestSnapshot(parsed)
    if (!snapshot) {
      trace(`payload has no usable manifest: ${value.slice(0, 200)}`)
      return null
    }

    const verified: VerifiedExtensionCandidate = {
      extensionId: candidate.extensionId,
      target: candidate.target,
      manifest: snapshot,
    }
    const matched = matchesArtifactManifest(verified, expected)
    if (!matched) {
      trace(
        `manifest mismatch: runtime=${JSON.stringify(snapshot)} expected=${JSON.stringify(expected)}`,
      )
    }
    return matched ? verified : null
  } catch {
    return null
  } finally {
    if (sessionId !== null) {
      try {
        await connection.send("Target.detachFromTarget", { sessionId })
      } catch {
        // Detach is best effort; the connection is closed during cleanup anyway.
      }
    }
  }
}

function printExceptionReport(collector: ExceptionCollector): void {
  for (const record of collector.fatal) {
    console.error(`  [fatal] ${record.source}`)
    console.error(`    target:  ${record.target}`)
    console.error(`    url:     ${record.url}`)
    console.error(`    message: ${record.message}`)
    if (record.stack) console.error(`    stack:   ${record.stack}`)
  }
  for (const record of collector.informational) {
    const firstLine = record.message.split("\n")[0] ?? ""
    console.log(`  [ignored] ${firstLine.slice(0, 200)}`)
  }
}

/**
 * Open an extension page and guarantee exception capture from first evaluation.
 *
 * The target is created on about:blank, Runtime/Log are enabled, and only then
 * is the real extension URL navigated. Attaching after `Target.createTarget(url)`
 * would race the bundle's first evaluation and could miss the very module
 * evaluation failure this gate exists to catch.
 *
 * The returned `stop` detaches this page's listeners from the shared collector.
 * Callers must invoke it when the stage ends so a later stage cannot inherit the
 * earlier page's console noise; already-recorded exceptions are kept.
 */
async function openExtensionPage(
  connection: CdpConnection,
  url: string,
  collector: ExceptionCollector,
  label: string,
  stage: "sidePanel" | "options",
): Promise<{ sessionId: string; stop: () => void }> {
  const created = await connection.send("Target.createTarget", { url: "about:blank" })
  const targetId = created.result?.targetId
  if (typeof targetId !== "string") {
    fail(stage, `CDP refused to create a page target for ${url}`)
  }

  const sessionId = await attachToTarget(connection, targetId, stage)
  await connection.send("Page.enable", {}, sessionId)
  await connection.send("Runtime.enable", {}, sessionId)
  await connection.send("Log.enable", {}, sessionId)

  let currentUrl = "about:blank"
  const stop = collector.watch(connection, sessionId, label, () => currentUrl)

  // Record the destination before navigating: the bundle can throw during the
  // very first evaluation, and that report must name the real page URL.
  currentUrl = url
  const navigation = await connection.send("Page.navigate", { url }, sessionId, 15_000)
  const errorText = navigation.result?.errorText
  if (typeof errorText === "string" && errorText.length > 0) {
    stop()
    fail(stage, `Navigation to ${url} failed: ${errorText}`)
  }
  return { sessionId, stop }
}

async function drain(stream: ReadableStream<Uint8Array> | number | null | undefined): Promise<void> {
  if (!stream || typeof stream === "number") return
  try {
    const reader = stream.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
    }
  } catch {
    // Pipe closure during shutdown is expected.
  }
}

async function runGate(options: CliOptions): Promise<GateResult> {
  const workspaceRoot = resolve(import.meta.dir, "..")
  const artifactDir = resolveArtifactPath({
    requested: options.artifactDir,
    workspaceRoot,
    defaultArtifactDir: DEFAULT_ARTIFACT_DIR,
    resolve,
  })

  console.log("Artifact runtime gate")
  console.log(`Artifact: ${options.artifactDir}`)

  const manifest = assertArtifactReady(artifactDir)
  const backgroundScript = resolveBackgroundScriptPath(manifest)
  if (!backgroundScript) fail("preflight", "Manifest background script could not be resolved.")

  const chrome = validateChromePath(options.chromePath, existsSync)
  if ("message" in chrome) {
    throw new ArtifactGateError("preflight", chrome.message)
  }

  const runId = randomRunId()
  const runDir = join(workspaceRoot, ".buntmp", `artifact-runtime-${runId}`)
  const profileDir = join(runDir, "profile")
  mkdirSync(profileDir, { recursive: true })

  const args = buildChromeArgs({
    chromePath: chrome.path,
    userDataDir: profileDir,
    artifactDir,
    // Port 0: Chromium picks a free port and publishes it in DevToolsActivePort.
    remoteDebuggingPort: 0,
  })

  let spawned: SpawnedBrowser | null = null
  let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null
  let connection: CdpConnection | null = null
  let cleanupStarted = false
  let cleanupDone: Promise<void> | null = null
  const collector = new ExceptionCollector()

  const cleanup = (): Promise<void> => {
    if (cleanupDone) return cleanupDone
    cleanupStarted = true
    cleanupDone = (async () => {
      if (connection && !connection.closed) {
        try {
          await connection.send("Browser.close", {}, undefined, 5_000)
        } catch {
          // Browser.close is best effort; the pid fallback below covers the rest.
        }
        connection.close()
      }

      if (child) {
        const exited = await Promise.race([
          child.exited.then(() => true),
          Bun.sleep(STAGE_TIMEOUTS_MS.cleanup).then(() => false),
        ])
        if (!exited) {
          const plan = planCleanup({ spawned, exitedNormally: false, profileDir: null })
          if (plan.terminationCommand && plan.pid !== null) {
            // Only this run's recorded pid may be terminated; never match by name.
            console.log(`Cleanup: terminating spawned process ${plan.pid} after timeout.`)
            try {
              Bun.spawnSync([plan.terminationCommand.command, ...plan.terminationCommand.args], {
                stdout: "ignore",
                stderr: "ignore",
              })
            } catch (error) {
              console.error(`Cleanup: fallback termination failed: ${String(error)}`)
            }
          }
        }
      }

      if (existsSync(runDir)) {
        try {
          rmSync(runDir, { recursive: true, force: true })
        } catch (error) {
          console.error(`Cleanup: could not remove ${runDir}: ${String(error)}`)
        }
      }
    })()
    return cleanupDone
  }

  // Signals must still run cleanup: a Ctrl-C that skipped it would leak a
  // browser process and a temp profile. The handlers are installed before the
  // browser is spawned so no window exists where a signal can escape.
  signalCleanup = cleanup

  try {
    child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "ignore" })
    spawned = { pid: child.pid, executablePath: chrome.path, userDataDir: profileDir }
    // Drain both pipes so a chatty browser can never block on a full buffer.
    void drain(child.stdout)
    void drain(child.stderr)

    // ---- Stage: Chrome start ------------------------------------------------
    let version: Awaited<ReturnType<typeof fetchVersionInfo>>
    try {
      const port = await waitForDevToolsPort(profileDir, STAGE_TIMEOUTS_MS.chromeStart)
      version = await fetchVersionInfo(port, 5_000)
      if (!version) {
        fail("chromeStart", `Chromium published DevToolsActivePort ${port} but /json/version did not answer.`)
      }
    } catch (error) {
      if (error instanceof ArtifactGateError) throw error
      const earlyExit = await Promise.race([
        child.exited.then((code) => code),
        Bun.sleep(1_000).then(() => null),
      ])
      if (earlyExit !== null) {
        fail(
          "chromeStart",
          `Chromium exited with code ${earlyExit} before exposing a CDP endpoint.`,
          `Confirm ${chrome.path} accepts --load-extension.`,
        )
      }
      fail("chromeStart", describeTimeout("chromeStart"), String(error))
    }

    console.log(`Chrome: ${version.browser}`)
    console.log(`Chrome executable: ${chrome.path}`)
    try {
      connection = await CdpConnection.connect(version.webSocketDebuggerUrl, 10_000)
    } catch (error) {
      // Distinct from "Chrome did not start": the browser answered HTTP but the
      // WebSocket upgrade failed, so the CDP transport itself is unusable.
      fail("chromeStart", `CDP connection failed: ${String(error)}`)
    }

    // ---- Stage: extension discovery ----------------------------------------
    // A stock Chromium profile also runs bundled extension service workers, so
    // a service_worker target alone is not proof that the artifact is loaded.
    // Each candidate worker is asked for its own manifest, and only an exact
    // manifest/identity match is selected. The target URL is never compared with
    // the manifest-declared background script: Chromium may normalize it (for
    // example `static/background/index.js` in the manifest versus
    // `/service_worker.js` in the target URL).
    const discoveryDeadline = Date.now() + STAGE_TIMEOUTS_MS.extensionDiscovery
    let extension: VerifiedExtensionCandidate | null = null
    let lastTargets: CdpTarget[] = []
    let lastCandidates: ServiceWorkerCandidate[] = []
    const verifiedWorkers = new Map<string, VerifiedExtensionCandidate>()

    while (Date.now() < discoveryDeadline) {
      try {
        lastTargets = await listTargets(connection)
      } catch (error) {
        // A dead CDP socket here means the browser died mid-run, which is a
        // different failure from "extension never loaded".
        fail("extensionDiscovery", `CDP target enumeration failed: ${String(error)}`)
      }
      lastCandidates = listExtensionServiceWorkerCandidates(lastTargets)

      const verified: VerifiedExtensionCandidate[] = []
      for (const candidate of lastCandidates) {
        let entry = verifiedWorkers.get(candidate.target.id)
        if (!entry) {
          entry = (await probeServiceWorkerManifest(connection, candidate, manifest)) ?? undefined
          if (entry) verifiedWorkers.set(candidate.target.id, entry)
        }
        if (entry) verified.push(entry)
      }

      const selection = selectVerifiedExtensionCandidate(verified)
      if (selection.kind === "selected") {
        extension = selection.candidate
        break
      }
      if (selection.kind === "ambiguous") {
        fail(
          "extensionDiscovery",
          "Ambiguous extension discovery: multiple service workers report the artifact manifest.",
          `Candidates: ${selection.candidates
            .map((candidate) => `${candidate.target.id}:${candidate.target.url}`)
            .join(", ")}`,
        )
      }
      await Bun.sleep(300)
    }

    if (!extension) {
      const extensionTargets = lastTargets.filter((target) => extractExtensionId(target.url) !== null)
      if (extensionTargets.length === 0) {
        fail(
          "extensionDiscovery",
          "Chrome started but the extension never loaded.",
          "Confirm the build directory is a loadable unpacked MV3 extension and that " +
            "this Chromium build accepts --load-extension.",
        )
      }
      if (lastCandidates.length === 0) {
        fail(
          "extensionDiscovery",
          "The extension loaded but no service worker target appeared.",
          `Expected background service worker path: ${backgroundScript}. Observed extension targets: ` +
            extensionTargets.map((target) => `${target.type}:${target.url}`).join(", "),
        )
      }
      fail(
        "extensionDiscovery",
        "Extension service workers started but none reported the artifact manifest.",
        `Expected manifest: manifest_version=${manifest.manifestVersion}, name=${manifest.name}, ` +
          `background.service_worker=${manifest.backgroundServiceWorker}. Observed candidates: ` +
          lastCandidates.map((candidate) => `${candidate.target.id}:${candidate.target.url}`).join(", ") +
          `. Observed extension targets: ` +
          extensionTargets.map((target) => `${target.type}:${target.url}`).join(", "),
      )
    }

    const extensionId = extension.extensionId
    if (extractExtensionId(extension.target.url) !== extensionId) {
      fail("extensionDiscovery", "Extension id extraction disagreed with the discovered target.")
    }
    console.log(`Extension ID: ${extensionId} (verified from the worker manifest)`)
    console.log("[PASS] Extension loaded")

    // ---- Gate A: background service worker ---------------------------------
    {
      const backgroundTarget = extension.target
      const sessionId = await attachToTarget(connection, backgroundTarget.id, "background")
      const stop = collector.watch(connection, sessionId, "background", () => backgroundTarget.url)
      try {
        await connection.send("Runtime.enable", {}, sessionId)
        await connection.send("Log.enable", {}, sessionId)

        const sum = await evaluate<number>(connection, sessionId, "1 + 1", "background")
        if (sum !== 2) {
          fail("background", `Background service worker returned ${String(sum)} for 1 + 1.`)
        }
        await stabilityWindow()

        // MV3 restarts a crashed service worker, which would hide the original
        // evaluation failure behind a fresh target. Confirm the instance we
        // attached to is still the live one after the stability window.
        const liveTargets = await listTargets(connection)
        const stillAlive = liveTargets.some(
          (target) => target.id === backgroundTarget.id && target.type === "service_worker",
        )
        if (!stillAlive) {
          fail(
            "background",
            "Background service worker target disappeared during the stability window; it crashed and was restarted.",
          )
        }

        if (collector.hasFatal) {
          fail("background", "Background service worker raised an uncaught runtime exception.")
        }
        console.log("[PASS] Background service worker evaluated")
      } finally {
        stop()
      }
    }

    // ---- Gate B: Side Panel production page --------------------------------
    const sidePanelPath = manifest.sidePanelPath!
    const sidePanelUrl = `chrome-extension://${extensionId}/${sidePanelPath}`
    {
      const page = await openExtensionPage(connection, sidePanelUrl, collector, "sidepanel", "sidePanel")
      try {
        await waitForMount(connection, page.sessionId, "sidePanel", "Side Panel", collector)
        await stabilityWindow()
        if (collector.hasFatal) {
          fail("sidePanel", "Side Panel production bundle raised an uncaught runtime exception.")
        }
        console.log("[PASS] Side Panel production bundle mounted")
      } finally {
        // Release this page's listeners: a later stage must not inherit them.
        page.stop()
      }
    }

    // ---- Gate C: Options production page -----------------------------------
    const optionsPath = manifest.optionsPath!
    const optionsUrl = `chrome-extension://${extensionId}/${optionsPath}`
    {
      const page = await openExtensionPage(connection, optionsUrl, collector, "options", "options")
      try {
        await waitForMount(connection, page.sessionId, "options", "Options", collector)
        await stabilityWindow()
        if (collector.hasFatal) {
          fail("options", "Options production bundle raised an uncaught runtime exception.")
        }
        console.log("[PASS] Options production bundle mounted")
      } finally {
        page.stop()
      }
    }

    if (collector.hasFatal) {
      fail("options", "Uncaught runtime exceptions were observed during the gate.")
    }
    console.log("[PASS] No uncaught runtime exceptions")
    if (collector.informational.length > 0) printExceptionReport(collector)

    return {
      chromeVersion: version.browser,
      extensionLoaded: true,
      background: true,
      sidePanel: true,
      options: true,
      noUncaughtExceptions: true,
      informationalCount: collector.informational.length,
    }
  } catch (error) {
    if (collector.hasFatal) printExceptionReport(collector)
    throw error
  } finally {
    await cleanup()
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof ArtifactGateError) {
    const stageLabel: Record<GateStage, string> = {
      preflight: "preflight",
      chromeStart: "chrome start",
      extensionDiscovery: "extension discovery",
      background: "background service worker",
      sidePanel: "side panel",
      options: "options",
      cleanup: "cleanup",
    }
    const lines = [
      `ARTIFACT RUNTIME GATE FAIL`,
      `  stage: ${stageLabel[error.stage]}`,
      `  ${error.message}`,
    ]
    if (error.hint) lines.push(`  hint: ${error.hint}`)
    return lines.join("\n")
  }
  return `ARTIFACT RUNTIME GATE FAIL\n  ${error instanceof Error ? error.message : String(error)}`
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))

  const onSignal = async (signal: NodeJS.Signals) => {
    console.error(`\nInterrupted by ${signal}; cleaning up the browser this gate started.`)
    // Run the same cleanup the normal paths use; it only ever touches the pid
    // this process spawned and the temp profile it created.
    if (signalCleanup) {
      try {
        await signalCleanup()
      } catch (error) {
        console.error(`Cleanup after ${signal} failed: ${String(error)}`)
      }
    }
    process.exit(130)
  }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  runGate(options)
    .then(() => {
      console.log("")
      console.log("ARTIFACT RUNTIME GATE PASS")
      process.exit(0)
    })
    .catch((error: unknown) => {
      console.error("")
      console.error(describeFailure(error))
      process.exit(1)
    })
}

main()
