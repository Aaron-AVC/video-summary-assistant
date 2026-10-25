/**
 * Pure policy/parsing helpers for the production artifact runtime gate.
 *
 * Everything in this module is deterministic and browser-free so it can be
 * unit-tested without launching Chromium. The runtime gate itself lives in
 * `scripts/verify-build-artifact.ts` and must always execute the real artifact
 * in a real browser; these helpers never stand in for that execution.
 */

/** Directory (workspace-relative) holding the Plasmo production extension. */
export const DEFAULT_ARTIFACT_DIR = "build/chrome-mv3-prod"

/** Environment variable naming the Chromium executable to launch. */
export const CHROME_PATH_ENV = "VSA_CHROME_PATH"

/** Files the production artifact must contain before any browser work starts. */
export const REQUIRED_ARTIFACT_FILES = ["manifest.json", "sidepanel.html", "options.html"] as const

/** Per-stage budget. Every stage must fail closed instead of polling forever. */
export const STAGE_TIMEOUTS_MS = {
  chromeStart: 30_000,
  extensionDiscovery: 30_000,
  background: 20_000,
  sidePanel: 30_000,
  options: 30_000,
  cleanup: 15_000,
} as const

/** How long a target must stay exception-free before it counts as stable. */
export const STABILITY_WINDOW_MS = 1_500

export type StageName = keyof typeof STAGE_TIMEOUTS_MS

/**
 * Stage labels used in failures. `preflight` covers artifact/executable checks
 * that happen before any browser process exists.
 */
export type GateStage = StageName | "preflight"

export type ArtifactManifest = {
  manifestVersion: number
  name: string
  backgroundServiceWorker: string | null
  backgroundPage: string | null
  sidePanelPath: string | null
  optionsPath: string | null
  /** Every extension-local page path the gate will execute. */
  pages: string[]
}

export type TargetKind = "service_worker" | "page" | "other"

export type CdpTarget = {
  id: string
  type: string
  url: string
  title?: string
}

export type ExceptionRecord = {
  /** Where the report came from, for actionable failure output. */
  source: "runtime.exceptionThrown" | "runtime.consoleAPICalled" | "log.entryAdded"
  target: string
  url: string
  message: string
  stack?: string
}

export type FatalClassification = {
  fatal: boolean
  reason: string
}

export class ArtifactGateError extends Error {
  readonly stage: GateStage
  readonly hint?: string

  constructor(stage: GateStage, message: string, hint?: string) {
    super(message)
    this.name = "ArtifactGateError"
    this.stage = stage
    this.hint = hint
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/** Reject absolute paths and parent traversal so artifact paths stay inside the build. */
export function isSafeArtifactRelativePath(value: string): boolean {
  if (value.length === 0) return false
  if (value.startsWith("/") || value.startsWith("\\")) return false
  if (/^[a-zA-Z]:/.test(value)) return false
  const segments = value.split(/[\\/]+/)
  return segments.every((segment) => segment !== ".." && segment !== "")
}

/**
 * Validate one manifest-declared path into a safe artifact-relative path.
 *
 * Returns null for anything that could escape the artifact root: empty values,
 * absolute POSIX paths, Windows drive-qualified paths, and any `..` traversal.
 * Callers must treat null as a hard preflight failure; they must never fall back
 * to the raw manifest string, because the only consumer is
 * `join(artifactDir, path)`.
 */
export function resolveExtensionPagePath(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (!isSafeArtifactRelativePath(trimmed)) return null
  return trimmed
}

export type UnsafeManifestPath = { field: string; value: string }

/**
 * Locate the first manifest-declared path that cannot be contained inside the
 * artifact root.
 *
 * `parseArtifactManifest` returns null for such manifests; this helper recovers
 * which field was responsible so the preflight can print an actionable error
 * instead of a generic "unusable manifest".
 */
export function findUnsafeManifestPath(raw: unknown): UnsafeManifestPath | null {
  if (!isRecord(raw)) return null

  const background = isRecord(raw.background) ? raw.background : null
  const candidates: UnsafeManifestPath[] = []
  const declared: Array<[string, string | null]> = [
    ["background.service_worker", asString(background?.service_worker)],
    ["background.page", asString(background?.page)],
    [
      "side_panel.default_path",
      isRecord(raw.side_panel) ? asString(raw.side_panel.default_path) : null,
    ],
    ["options_ui.page", isRecord(raw.options_ui) ? asString(raw.options_ui.page) : null],
  ]

  for (const [field, value] of declared) {
    if (value !== null && resolveExtensionPagePath(value) === null) {
      candidates.push({ field, value })
    }
  }

  return candidates[0] ?? null
}

/**
 * Parse the parts of a manifest the gate depends on.
 *
 * Returns null for structurally unusable manifests so the caller can fail the
 * preflight with a precise message instead of crashing mid-run.
 *
 * Every declared path is validated here, before it is stored. An unsafe page
 * path makes the whole manifest unusable: retaining the raw string would let a
 * later `join(artifactDir, path)` escape the artifact root, and dropping it from
 * `pages` while keeping it in `sidePanelPath`/`optionsPath` only hides the
 * problem.
 */
export function parseArtifactManifest(raw: unknown): ArtifactManifest | null {
  if (!isRecord(raw)) return null
  if (raw.manifest_version !== 3) return null
  if (typeof raw.name !== "string" || raw.name.length === 0) return null

  const background = isRecord(raw.background) ? raw.background : null
  const rawServiceWorker = asString(background?.service_worker)
  const rawBackgroundPage = asString(background?.page)
  const rawSidePanel = isRecord(raw.side_panel) ? asString(raw.side_panel.default_path) : null
  const rawOptionsUi = isRecord(raw.options_ui) ? asString(raw.options_ui.page) : null

  const backgroundServiceWorker = resolveExtensionPagePath(rawServiceWorker)
  const backgroundPage = resolveExtensionPagePath(rawBackgroundPage)
  const sidePanel = resolveExtensionPagePath(rawSidePanel)
  const optionsUi = resolveExtensionPagePath(rawOptionsUi)

  const unsafe =
    (rawServiceWorker !== null && backgroundServiceWorker === null) ||
    (rawBackgroundPage !== null && backgroundPage === null) ||
    (rawSidePanel !== null && sidePanel === null) ||
    (rawOptionsUi !== null && optionsUi === null)
  if (unsafe) return null

  const pages: string[] = []
  for (const candidate of [sidePanel, optionsUi]) {
    if (candidate && !pages.includes(candidate)) {
      pages.push(candidate)
    }
  }

  return {
    manifestVersion: 3,
    name: raw.name,
    backgroundServiceWorker,
    backgroundPage,
    sidePanelPath: sidePanel,
    optionsPath: optionsUi,
    pages,
  }
}

/**
 * Resolve the manifest-declared background script to a safe relative path.
 *
 * Delegates to `resolveExtensionPagePath` so background, Side Panel and Options
 * pages all go through exactly one containment rule.
 */
export function resolveBackgroundScriptPath(manifest: ArtifactManifest): string | null {
  const script = manifest.backgroundServiceWorker ?? manifest.backgroundPage
  return resolveExtensionPagePath(script)
}

/** Classify a CDP target type into the coarse buckets the gate reasons about. */
export function classifyTargetType(type: string): TargetKind {
  if (type === "service_worker") return "service_worker"
  if (type === "page" || type === "background_page") return "page"
  return "other"
}

/** Extract the extension id from a `chrome-extension://<id>/...` URL. */
export function extractExtensionId(url: string): string | null {
  if (!url.startsWith("chrome-extension://")) return null
  const rest = url.slice("chrome-extension://".length)
  const host = rest.split("/")[0]
  if (!host || !/^[a-p]{32}$/.test(host)) return null
  return host
}

/**
 * One `service_worker` CDP target that belongs to some extension.
 *
 * The target URL is only used to obtain a candidate extension id. It is
 * deliberately NOT treated as the canonical identity of the manifest-declared
 * background script: Chromium may report a normalized worker URL such as
 * `chrome-extension://<id>/service_worker.js` even when the manifest declares
 * `static/background/index.js`. The manifest read inside the worker is the
 * authority.
 */
export type ServiceWorkerCandidate = {
  extensionId: string
  target: CdpTarget
}

/**
 * The manifest a service worker reports about itself, normalized exactly like
 * the artifact manifest so the two can be compared field by field.
 */
export type RuntimeManifestSnapshot = {
  extensionId: string | null
  manifestVersion: number | null
  name: string | null
  backgroundServiceWorker: string | null
  backgroundPage: string | null
  sidePanelPath: string | null
  optionsPath: string | null
}

export type VerifiedExtensionCandidate = {
  extensionId: string
  target: CdpTarget
  manifest: RuntimeManifestSnapshot
}

export type VerifiedCandidateSelection =
  | { kind: "selected"; candidate: VerifiedExtensionCandidate }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: VerifiedExtensionCandidate[] }

/**
 * Enumerate every extension service worker the browser is running.
 *
 * Not every candidate is the artifact under test: a stock Chromium profile also
 * runs bundled extensions. Verification happens in the runtime gate by reading
 * each worker's own manifest; this helper only narrows the target list to
 * well-formed extension service workers.
 */
export function listExtensionServiceWorkerCandidates(
  targets: readonly CdpTarget[],
): ServiceWorkerCandidate[] {
  const candidates: ServiceWorkerCandidate[] = []
  for (const target of targets) {
    if (classifyTargetType(target.type) !== "service_worker") continue
    const extensionId = extractExtensionId(target.url)
    if (!extensionId) continue
    candidates.push({ extensionId, target })
  }
  return candidates
}

/**
 * Normalize the `{ id, manifest }` payload read from inside a service worker.
 *
 * Returns null when the payload has no usable manifest object, so the caller
 * treats the worker as unverified instead of matching against partial data.
 */
export function parseRuntimeManifestSnapshot(raw: unknown): RuntimeManifestSnapshot | null {
  if (!isRecord(raw)) return null
  const manifest = isRecord(raw.manifest) ? raw.manifest : null
  if (!manifest) return null

  const background = isRecord(manifest.background) ? manifest.background : null
  const sidePanel = isRecord(manifest.side_panel) ? manifest.side_panel : null
  const optionsUi = isRecord(manifest.options_ui) ? manifest.options_ui : null

  return {
    extensionId: asString(raw.id),
    manifestVersion:
      typeof manifest.manifest_version === "number" ? manifest.manifest_version : null,
    name: asString(manifest.name),
    backgroundServiceWorker: resolveExtensionPagePath(asString(background?.service_worker)),
    backgroundPage: resolveExtensionPagePath(asString(background?.page)),
    sidePanelPath: resolveExtensionPagePath(asString(sidePanel?.default_path)),
    optionsPath: resolveExtensionPagePath(asString(optionsUi?.page)),
  }
}

/**
 * Decide whether one verified worker really is the production artifact.
 *
 * The runtime id must agree with the extension id in the target URL, and the
 * worker's own manifest must declare the same identity surface the preflight
 * read from the artifact. Any missing or unsafe path fails closed: a worker
 * that cannot prove its manifest is never selected.
 */
export function matchesArtifactManifest(
  candidate: { extensionId: string; manifest: RuntimeManifestSnapshot },
  expected: ArtifactManifest,
): boolean {
  const runtime = candidate.manifest
  if (runtime.extensionId === null) return false
  if (runtime.extensionId !== candidate.extensionId) return false
  if (runtime.manifestVersion !== expected.manifestVersion) return false
  if (runtime.name !== expected.name) return false
  return (
    runtime.backgroundServiceWorker === expected.backgroundServiceWorker &&
    runtime.backgroundPage === expected.backgroundPage &&
    runtime.sidePanelPath === expected.sidePanelPath &&
    runtime.optionsPath === expected.optionsPath
  )
}

/**
 * Pick the single verified candidate.
 *
 * Zero candidates is a discovery failure and more than one is an ambiguity
 * failure; neither is resolved by silently taking the first entry.
 */
export function selectVerifiedExtensionCandidate(
  candidates: readonly VerifiedExtensionCandidate[],
): VerifiedCandidateSelection {
  if (candidates.length === 0) return { kind: "none" }
  if (candidates.length > 1) return { kind: "ambiguous", candidates: [...candidates] }
  return { kind: "selected", candidate: candidates[0]! }
}

/**
 * Decide whether one observed browser message is fatal for the gate.
 *
 * Deliberately narrow: only signals that prove the bundle failed to evaluate or
 * the app failed to mount count. Browser chrome noise, favicon warnings and
 * telemetry complaints are reported as informational and never fail the gate.
 */
export function classifyFatalMessage(input: {
  source: ExceptionRecord["source"]
  message: string
  level?: string
}): FatalClassification {
  const message = input.message.trim()
  if (message.length === 0) return { fatal: false, reason: "empty message" }

  if (input.source === "runtime.exceptionThrown") {
    return { fatal: true, reason: "uncaught runtime exception" }
  }

  if (input.source === "runtime.consoleAPICalled") {
    if (input.level !== "error" && input.level !== "assert") {
      return { fatal: false, reason: "non-error console level" }
    }
    // `console.error` is not fatal by itself: the extension intentionally logs
    // recoverable provider/network problems. Only bundle-evaluation signatures
    // escalate, matching the SEC-02 failure shape.
    return classifyBundleEvaluationSignature(message)
  }

  // Log.entryAdded surfaces both page errors and benign browser-internal noise.
  const entryLevel = input.level ?? "info"
  if (entryLevel !== "error") return { fatal: false, reason: "non-error log level" }
  if (isBenignBrowserNoise(message)) return { fatal: false, reason: "benign browser noise" }
  return classifyBundleEvaluationSignature(message)
}

const BUNDLE_EVALUATION_SIGNATURES: readonly RegExp[] = [
  /is not a function/i,
  /is not a constructor/i,
  /Cannot read propert(?:y|ies) of (?:undefined|null)/i,
  /Cannot destructure property/i,
  /ReferenceError/i,
  /TypeError/i,
  /SyntaxError/i,
  /Failed to (?:load|fetch) (?:the )?(?:module )?script/i,
  /Importing a module script failed/i,
  /Failed to resolve module specifier/i,
  /module evaluation/i,
  /Uncaught \(in promise\)/i,
]

function classifyBundleEvaluationSignature(message: string): FatalClassification {
  for (const signature of BUNDLE_EVALUATION_SIGNATURES) {
    if (signature.test(message)) {
      return { fatal: true, reason: `bundle evaluation signature: ${signature.source}` }
    }
  }
  return { fatal: false, reason: "no bundle-evaluation signature" }
}

/**
 * Browser-generated messages that are never evidence about the artifact.
 * Each pattern is explicit and commented; there is no catch-all suppression.
 */
const BENIGN_BROWSER_NOISE: readonly RegExp[] = [
  // Missing favicon on an extension page is emitted by Chrome itself.
  /favicon\.ico/i,
  // Chrome telemetry / GCM endpoints are unavailable in isolated test profiles.
  /DEPRECATED_ENDPOINT/i,
  /registration_request\.cc/i,
  // Crashpad cannot write its pipe inside a throwaway profile.
  /crashpad/i,
  // Chrome's own network stack complaining about an unreachable update endpoint.
  /google_apis\/gcm/i,
  // Extension load warnings that Chrome emits for unpacked directories.
  /Unrecognized manifest key/i,
]

export function isBenignBrowserNoise(message: string): boolean {
  return BENIGN_BROWSER_NOISE.some((pattern) => pattern.test(message))
}

/** True when a page has finished loading and React rendered into its root. */
export function isApplicationMounted(input: {
  readyState: string
  rootChildCount: number
  bodyChildCount: number
}): boolean {
  if (input.readyState !== "complete" && input.readyState !== "interactive") return false
  return input.rootChildCount > 0 && input.bodyChildCount > 0
}

/** Convert a CDP exception payload into a printable record. */
export function toExceptionRecord(
  source: ExceptionRecord["source"],
  target: string,
  url: string,
  details: unknown,
): ExceptionRecord {
  const record: ExceptionRecord = { source, target, url, message: "" }
  if (!isRecord(details)) {
    record.message = String(details)
    return record
  }

  const exception = isRecord(details.exception) ? details.exception : null
  const description = asString(exception?.description)
  const value = exception?.value
  const text = asString(details.text)

  record.message = description ?? text ?? (value === undefined ? "unknown error" : String(value))
  const stack = asString(exception?.preview)
  if (stack) record.stack = stack
  return record
}

/** Build the exact browser flags for an isolated artifact run. */
export function buildChromeArgs(input: {
  chromePath: string
  userDataDir: string
  artifactDir: string
  remoteDebuggingPort: number
}): string[] {
  return [
    input.chromePath,
    "--headless=new",
    `--user-data-dir=${input.userDataDir}`,
    `--disable-extensions-except=${input.artifactDir}`,
    `--load-extension=${input.artifactDir}`,
    `--remote-debugging-port=${input.remoteDebuggingPort}`,
    // Required in containers/CI and on Windows CfT builds where the GPU sandbox
    // cannot initialise; without it Chrome exits before opening the CDP port.
    "--no-sandbox",
    // Throwaway profile: never prompt, never import the daily profile.
    "--no-first-run",
    "--no-default-browser-check",
    // Crashpad cannot reach its pipe inside an isolated profile and would make
    // Chrome self-terminate; the gate does not need crash dumps.
    "--disable-crash-reporter",
    "--disable-crashpad",
    // Keep the gate offline and independent from provider/network state.
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--metrics-recording-only",
    "about:blank",
  ]
}

/** Everything the cleanup path must remember about the process it started. */
export type SpawnedBrowser = {
  pid: number
  executablePath: string
  userDataDir: string
}

/**
 * Cleanup plan derived from the spawned process identity only.
 *
 * The gate must never terminate a process it did not start, so the fallback
 * kill target is the recorded pid of this run's spawn, never an executable name.
 */
export type CleanupPlan = {
  /** Whether a fallback termination is allowed at all. */
  allowProcessTermination: boolean
  /** Pid of the process this run spawned, or null when nothing was spawned. */
  pid: number | null
  /** Arguments for the fallback kill, or null when no termination is needed. */
  terminationCommand: { command: string; args: string[] } | null
  /** Profile directory to remove after the browser exits. */
  profileDirToRemove: string | null
}

export function planCleanup(input: {
  spawned: SpawnedBrowser | null
  exitedNormally: boolean
  profileDir: string | null
}): CleanupPlan {
  const pid = input.spawned?.pid ?? null
  const profileDirToRemove = input.profileDir

  if (pid === null) {
    return {
      allowProcessTermination: false,
      pid: null,
      terminationCommand: null,
      profileDirToRemove,
    }
  }

  if (input.exitedNormally) {
    return {
      allowProcessTermination: false,
      pid,
      terminationCommand: null,
      profileDirToRemove,
    }
  }

  return {
    allowProcessTermination: true,
    pid,
    terminationCommand: buildFallbackTerminationCommand(pid, process.platform),
    profileDirToRemove,
  }
}

/**
 * Build the fallback termination for the exact pid this run spawned.
 *
 * `taskkill /PID <pid> /T /F` is the only permitted Windows form; the pid must
 * come from `Bun.spawn`'s handle, never from a process-name lookup. POSIX uses
 * a direct signal to the same recorded pid.
 */
export function buildFallbackTerminationCommand(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "win32") {
    return { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] }
  }
  return { command: "kill", args: ["-KILL", String(pid)] }
}

/** Validate the configured Chrome executable without launching it. */
export function validateChromePath(
  configuredPath: string | null | undefined,
  exists: (path: string) => boolean,
): { ok: true; path: string } | { ok: false; message: string } {
  if (!configuredPath || configuredPath.trim().length === 0) {
    return {
      ok: false,
      message:
        `No compatible Chromium executable was found.\n` +
        `Set ${CHROME_PATH_ENV} to Chrome for Testing or another Chromium executable.`,
    }
  }
  const path = configuredPath.trim()
  if (!exists(path)) {
    return {
      ok: false,
      message:
        `Chrome executable not found at "${path}".\n` +
        `Set ${CHROME_PATH_ENV} to Chrome for Testing or another Chromium executable.`,
    }
  }
  return { ok: true, path }
}

/** Format a stage timeout so failures always name the stage that stalled. */
export function describeTimeout(stage: StageName): string {
  switch (stage) {
    case "chromeStart":
      return "Timed out waiting for the Chromium CDP endpoint to become available."
    case "extensionDiscovery":
      return "Timed out waiting for the extension service worker target to appear."
    case "background":
      return "Timed out waiting for the background service worker to evaluate."
    case "sidePanel":
      return "Timed out waiting for Side Panel application to mount."
    case "options":
      return "Timed out waiting for Options application to mount."
    case "cleanup":
      return "Timed out waiting for the Chromium process to exit during cleanup."
  }
}

/** Reject obviously incompatible artifact paths before spawning a browser. */
export function resolveArtifactPath(input: {
  requested: string | null
  workspaceRoot: string
  defaultArtifactDir: string
  resolve: (...segments: string[]) => string
}): string {
  const relative = input.requested ?? input.defaultArtifactDir
  return input.resolve(input.workspaceRoot, relative)
}
