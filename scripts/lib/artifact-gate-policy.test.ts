import { describe, expect, it } from "bun:test"

import {
  ArtifactGateError,
  CHROME_PATH_ENV,
  DEFAULT_ARTIFACT_DIR,
  STAGE_TIMEOUTS_MS,
  buildChromeArgs,
  buildFallbackTerminationCommand,
  classifyFatalMessage,
  classifyTargetType,
  describeTimeout,
  extractExtensionId,
  findUnsafeManifestPath,
  isApplicationMounted,
  isBenignBrowserNoise,
  isSafeArtifactRelativePath,
  parseArtifactManifest,
  planCleanup,
  resolveArtifactPath,
  resolveBackgroundScriptPath,
  resolveExtensionPagePath,
  selectExtensionTargets,
  toExceptionRecord,
  validateChromePath,
  type CdpTarget,
} from "../lib/artifact-gate-policy"

const VALID_MANIFEST = {
  manifest_version: 3,
  name: "Video Summary Assistant",
  background: { service_worker: "static/background/index.js" },
  side_panel: { default_path: "sidepanel.html" },
  options_ui: { page: "options.html", open_in_tab: true },
}

const EXTENSION_ID = "lemnahhmjlcifhkhhnaegbhiohpdbpcc"

function target(type: string, url: string, id = "t1"): CdpTarget {
  return { id, type, url }
}

describe("artifact path safety", () => {
  it("accepts normal relative paths", () => {
    expect(isSafeArtifactRelativePath("static/background/index.js")).toBe(true)
    expect(isSafeArtifactRelativePath("sidepanel.html")).toBe(true)
  })

  it("rejects traversal, absolute and empty paths", () => {
    expect(isSafeArtifactRelativePath("../outside.js")).toBe(false)
    expect(isSafeArtifactRelativePath("/etc/passwd")).toBe(false)
    expect(isSafeArtifactRelativePath("C:\\Windows\\system32\\x.dll")).toBe(false)
    expect(isSafeArtifactRelativePath("")).toBe(false)
    expect(isSafeArtifactRelativePath("nested/../../escape.js")).toBe(false)
  })
})

describe("manifest path resolution", () => {
  it("parses the MV3 fields the gate depends on", () => {
    const manifest = parseArtifactManifest(VALID_MANIFEST)
    expect(manifest).not.toBeNull()
    expect(manifest!.manifestVersion).toBe(3)
    expect(manifest!.backgroundServiceWorker).toBe("static/background/index.js")
    expect(manifest!.sidePanelPath).toBe("sidepanel.html")
    expect(manifest!.optionsPath).toBe("options.html")
    expect(manifest!.pages).toEqual(["sidepanel.html", "options.html"])
  })

  it("rejects non-MV3 and structurally broken manifests", () => {
    expect(parseArtifactManifest(null)).toBeNull()
    expect(parseArtifactManifest([])).toBeNull()
    expect(parseArtifactManifest({ ...VALID_MANIFEST, manifest_version: 2 })).toBeNull()
    expect(parseArtifactManifest({ ...VALID_MANIFEST, name: "" })).toBeNull()
  })

  it("resolves the background script from service_worker or page", () => {
    const sw = parseArtifactManifest(VALID_MANIFEST)!
    expect(resolveBackgroundScriptPath(sw)).toBe("static/background/index.js")

    const pageManifest = parseArtifactManifest({
      ...VALID_MANIFEST,
      background: { page: "background.html" },
    })!
    expect(resolveBackgroundScriptPath(pageManifest)).toBe("background.html")

    const none = parseArtifactManifest({ ...VALID_MANIFEST, background: {} })!
    expect(resolveBackgroundScriptPath(none)).toBeNull()
  })

  it("refuses to parse a manifest with an unsafe background path", () => {
    const raw = { ...VALID_MANIFEST, background: { service_worker: "../../evil.js" } }
    const manifest = parseArtifactManifest(raw)
    expect(manifest).toBeNull()
    expect(findUnsafeManifestPath(raw)).toEqual({
      field: "background.service_worker",
      value: "../../evil.js",
    })
  })

  it("refuses to parse a manifest with an unsafe page path instead of propagating it", () => {
    const raw = { ...VALID_MANIFEST, side_panel: { default_path: "../escape.html" } }
    const manifest = parseArtifactManifest(raw)
    expect(manifest).toBeNull()
    expect(findUnsafeManifestPath(raw)).toEqual({
      field: "side_panel.default_path",
      value: "../escape.html",
    })
  })

  it("resolves the artifact path against the workspace root", () => {
    const resolved = resolveArtifactPath({
      requested: "build/chrome-mv3-prod",
      workspaceRoot: "/workspace",
      defaultArtifactDir: DEFAULT_ARTIFACT_DIR,
      resolve: (...segments) => segments.join("/"),
    })
    expect(resolved).toBe("/workspace/build/chrome-mv3-prod")

    const fallback = resolveArtifactPath({
      requested: null,
      workspaceRoot: "/workspace",
      defaultArtifactDir: DEFAULT_ARTIFACT_DIR,
      resolve: (...segments) => segments.join("/"),
    })
    expect(fallback).toBe(`/workspace/${DEFAULT_ARTIFACT_DIR}`)
  })
})

describe("page path containment", () => {
  // Every declared page path is a future `join(artifactDir, path)` argument, so
  // containment has to be enforced at parse time, not at use time.
  const unsafePaths = [
    ["/absolute.html", "absolute POSIX path"],
    ["\\absolute.html", "absolute backslash path"],
    ["C:\\Windows\\escape.html", "drive-qualified path"],
    ["c:/escape.html", "drive-qualified path with forward slashes"],
    ["../escape.html", "single parent traversal"],
    ["../../escape.html", "nested parent traversal"],
    ["nested/../../escape.html", "traversal hidden behind a segment"],
    ["nested\\..\\..\\escape.html", "traversal with backslashes"],
  ] as const

  it("accepts valid side panel and options pages", () => {
    expect(resolveExtensionPagePath("sidepanel.html")).toBe("sidepanel.html")
    expect(resolveExtensionPagePath("options.html")).toBe("options.html")
    expect(resolveExtensionPagePath("nested/panel.html")).toBe("nested/panel.html")
    expect(resolveExtensionPagePath(null)).toBeNull()

    const manifest = parseArtifactManifest(VALID_MANIFEST)
    expect(manifest).not.toBeNull()
    expect(manifest!.sidePanelPath).toBe("sidepanel.html")
    expect(manifest!.optionsPath).toBe("options.html")
  })

  for (const [path, label] of unsafePaths) {
    it(`fails the preflight for a ${label} side panel path`, () => {
      expect(resolveExtensionPagePath(path)).toBeNull()
      const raw = { ...VALID_MANIFEST, side_panel: { default_path: path } }
      expect(parseArtifactManifest(raw)).toBeNull()
      expect(findUnsafeManifestPath(raw)).toEqual({ field: "side_panel.default_path", value: path })
    })

    it(`fails the preflight for a ${label} options path`, () => {
      expect(resolveExtensionPagePath(path)).toBeNull()
      const raw = { ...VALID_MANIFEST, options_ui: { page: path } }
      expect(parseArtifactManifest(raw)).toBeNull()
      expect(findUnsafeManifestPath(raw)).toEqual({ field: "options_ui.page", value: path })
    })
  }

  it("reports no unsafe path for a fully safe manifest", () => {
    expect(findUnsafeManifestPath(VALID_MANIFEST)).toBeNull()
    expect(findUnsafeManifestPath(null)).toBeNull()
    expect(findUnsafeManifestPath([])).toBeNull()
  })

  it("treats an empty declared path as unusable rather than as a usable page", () => {
    // An empty path is rejected by `resolveExtensionPagePath`; the manifest parse
    // then leaves the field null so the preflight fails with "does not declare".
    expect(resolveExtensionPagePath("")).toBeNull()
    expect(resolveExtensionPagePath("   ")).toBeNull()

    const manifest = parseArtifactManifest({
      ...VALID_MANIFEST,
      side_panel: { default_path: "" },
    })
    expect(manifest).not.toBeNull()
    expect(manifest!.sidePanelPath).toBeNull()
    expect(manifest!.pages).toEqual(["options.html"])
  })

  it("never keeps a raw unsafe path on the parsed manifest", () => {
    // Regression guard for the reported defect: an unsafe path must not survive
    // in `sidePanelPath`/`optionsPath` while merely being dropped from `pages`.
    const manifest = parseArtifactManifest({
      ...VALID_MANIFEST,
      side_panel: { default_path: "../escape.html" },
    })
    expect(manifest).toBeNull()
  })
})

describe("target filtering", () => {
  const background = "static/background/index.js"

  it("classifies target types", () => {
    expect(classifyTargetType("service_worker")).toBe("service_worker")
    expect(classifyTargetType("page")).toBe("page")
    expect(classifyTargetType("background_page")).toBe("page")
    expect(classifyTargetType("browser_ui")).toBe("other")
  })

  it("extracts extension ids only from chrome-extension URLs", () => {
    expect(extractExtensionId(`chrome-extension://${EXTENSION_ID}/sidepanel.html`)).toBe(EXTENSION_ID)
    expect(extractExtensionId("https://example.com/x")).toBeNull()
    expect(extractExtensionId("chrome-extension://not-a-real-id/x")).toBeNull()
    expect(extractExtensionId("chrome-extension://")).toBeNull()
  })

  it("selects the artifact's own service worker, not a bundled browser extension", () => {
    const targets = [
      target("service_worker", "chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome/thunk.js", "a"),
      target("service_worker", `chrome-extension://${EXTENSION_ID}/${background}`, "b"),
      target("page", "about:blank", "c"),
    ]
    const selected = selectExtensionTargets(targets, background, "sidepanel.html", "options.html")
    expect(selected).not.toBeNull()
    expect(selected!.extensionId).toBe(EXTENSION_ID)
    expect(selected!.background!.id).toBe("b")
  })

  it("ignores extension service workers whose path does not match the manifest", () => {
    const targets = [
      target("service_worker", "chrome-extension://glbjnfimcajjenihimblfaponejbkoph/background.js", "a"),
    ]
    expect(selectExtensionTargets(targets, background, "sidepanel.html", "options.html")).toBeNull()
  })

  it("ignores non service_worker targets even with a matching URL", () => {
    const targets = [target("page", `chrome-extension://${EXTENSION_ID}/${background}`, "a")]
    expect(selectExtensionTargets(targets, background, "sidepanel.html", "options.html")).toBeNull()
  })

  it("requires a manifest background path before selecting anything", () => {
    const targets = [target("service_worker", `chrome-extension://${EXTENSION_ID}/${background}`, "a")]
    expect(selectExtensionTargets(targets, null, "sidepanel.html", "options.html")).toBeNull()
  })

  it("finds already-open side panel and options page targets", () => {
    const targets = [
      target("service_worker", `chrome-extension://${EXTENSION_ID}/${background}`, "sw"),
      target("page", `chrome-extension://${EXTENSION_ID}/sidepanel.html`, "sp"),
      target("page", `chrome-extension://${EXTENSION_ID}/options.html`, "opt"),
      target("page", "chrome-extension://otheridotheridotheridotherid/options.html", "foreign"),
    ]
    const selected = selectExtensionTargets(targets, background, "sidepanel.html", "options.html")
    expect(selected!.sidePanel!.id).toBe("sp")
    expect(selected!.options!.id).toBe("opt")
  })

  it("does not attach a foreign extension's page to this artifact", () => {
    const foreignId = "abcdefghijklmnopabcdefghijklmnop"
    const targets = [
      target("service_worker", `chrome-extension://${EXTENSION_ID}/${background}`, "sw"),
      target("page", `chrome-extension://${foreignId}/options.html`, "foreign"),
    ]
    const selected = selectExtensionTargets(targets, background, "sidepanel.html", "options.html")
    expect(selected!.options).toBeNull()
  })
})

describe("fatal exception classification", () => {
  it("treats every uncaught runtime exception as fatal", () => {
    expect(
      classifyFatalMessage({ source: "runtime.exceptionThrown", message: "boom" }).fatal,
    ).toBe(true)
  })

  it("treats SEC-02 style bundle evaluation errors as fatal", () => {
    const messages = [
      "TypeError: z.object is not a function",
      "TypeError: Cannot read properties of undefined (reading 'object')",
      "ReferenceError: require is not defined",
      "SyntaxError: Unexpected token 'export'",
      "Uncaught (in promise) TypeError: x is not a constructor",
    ]
    for (const message of messages) {
      expect(
        classifyFatalMessage({ source: "runtime.consoleAPICalled", message, level: "error" }).fatal,
      ).toBe(true)
    }
  })

  it("does not fail on ordinary console.error logging", () => {
    expect(
      classifyFatalMessage({
        source: "runtime.consoleAPICalled",
        message: "Provider request failed: 401",
        level: "error",
      }).fatal,
    ).toBe(false)
  })

  it("ignores non-error console levels", () => {
    expect(
      classifyFatalMessage({
        source: "runtime.consoleAPICalled",
        message: "TypeError: not fatal at log level",
        level: "log",
      }).fatal,
    ).toBe(false)
  })

  it("ignores benign browser noise from Log.entryAdded", () => {
    expect(
      classifyFatalMessage({
        source: "log.entryAdded",
        message: "Failed to load resource: favicon.ico",
        level: "error",
      }).fatal,
    ).toBe(false)
    expect(
      classifyFatalMessage({
        source: "log.entryAdded",
        message: "Registration response error message: DEPRECATED_ENDPOINT",
        level: "error",
      }).fatal,
    ).toBe(false)
  })

  it("still fails on a bundle error reported through Log.entryAdded", () => {
    expect(
      classifyFatalMessage({
        source: "log.entryAdded",
        message: "Uncaught TypeError: Cannot read properties of undefined",
        level: "error",
      }).fatal,
    ).toBe(true)
  })

  it("ignores empty messages instead of inventing failures", () => {
    expect(classifyFatalMessage({ source: "log.entryAdded", message: "   " }).fatal).toBe(false)
  })

  it("documents benign noise patterns explicitly", () => {
    expect(isBenignBrowserNoise("favicon.ico")).toBe(true)
    expect(isBenignBrowserNoise("DEPRECATED_ENDPOINT")).toBe(true)
    expect(isBenignBrowserNoise("TypeError: real failure")).toBe(false)
  })

  it("normalizes CDP exception payloads into printable records", () => {
    const record = toExceptionRecord("runtime.exceptionThrown", "sidepanel", "chrome-extension://x/s.html", {
      exception: { description: "Error: RG01_NEGATIVE_CONTROL\n    at s.js:1:7" },
      text: "Uncaught",
    })
    expect(record.message).toContain("RG01_NEGATIVE_CONTROL")
    expect(record.target).toBe("sidepanel")
  })

  it("falls back gracefully when the payload shape is unknown", () => {
    expect(toExceptionRecord("log.entryAdded", "t", "u", "plain string").message).toBe("plain string")
    expect(toExceptionRecord("log.entryAdded", "t", "u", {}).message).toBe("unknown error")
  })
})

describe("mount detection", () => {
  it("requires a completed document and a populated root", () => {
    expect(isApplicationMounted({ readyState: "complete", rootChildCount: 1, bodyChildCount: 2 })).toBe(true)
    expect(isApplicationMounted({ readyState: "interactive", rootChildCount: 1, bodyChildCount: 2 })).toBe(true)
  })

  it("rejects an empty React root even when the document is complete", () => {
    expect(isApplicationMounted({ readyState: "complete", rootChildCount: 0, bodyChildCount: 2 })).toBe(false)
  })

  it("rejects a document that is still loading", () => {
    expect(isApplicationMounted({ readyState: "loading", rootChildCount: 1, bodyChildCount: 2 })).toBe(false)
  })
})

describe("chrome path and config validation", () => {
  it("fails with an actionable message when no executable is configured", () => {
    const result = validateChromePath(null, () => false)
    expect(result.ok).toBe(false)
    if ("message" in result) {
      expect(result.message).toContain("No compatible Chromium executable was found")
      expect(result.message).toContain(CHROME_PATH_ENV)
    }
  })

  it("fails when the configured executable does not exist", () => {
    const result = validateChromePath("/nope/chrome.exe", () => false)
    expect(result.ok).toBe(false)
    if ("message" in result) expect(result.message).toContain("not found")
  })

  it("accepts an existing executable and trims the path", () => {
    const result = validateChromePath("  /opt/chrome  ", (path) => path === "/opt/chrome")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.path).toBe("/opt/chrome")
  })

  it("builds isolated browser flags for the artifact under test", () => {
    const args = buildChromeArgs({
      chromePath: "/opt/chrome",
      userDataDir: "/tmp/profile",
      artifactDir: "/work/build/chrome-mv3-prod",
      remoteDebuggingPort: 0,
    })
    expect(args[0]).toBe("/opt/chrome")
    expect(args).toContain("--user-data-dir=/tmp/profile")
    expect(args).toContain("--disable-extensions-except=/work/build/chrome-mv3-prod")
    expect(args).toContain("--load-extension=/work/build/chrome-mv3-prod")
    expect(args).toContain("--remote-debugging-port=0")
    // The gate must never point at the user's daily profile.
    expect(args.some((arg) => arg.startsWith("--user-data-dir=") && arg.includes(".buntmp") === false)).toBe(true)
    expect(args.join(" ")).not.toContain("--profile-directory")
  })
})

describe("cleanup bookkeeping", () => {
  it("never authorises termination when nothing was spawned", () => {
    const plan = planCleanup({ spawned: null, exitedNormally: false, profileDir: "/tmp/p" })
    expect(plan.allowProcessTermination).toBe(false)
    expect(plan.pid).toBeNull()
    expect(plan.terminationCommand).toBeNull()
    expect(plan.profileDirToRemove).toBe("/tmp/p")
  })

  it("skips termination after a clean exit", () => {
    const plan = planCleanup({
      spawned: { pid: 4242, executablePath: "/opt/chrome", userDataDir: "/tmp/p" },
      exitedNormally: true,
      profileDir: "/tmp/p",
    })
    expect(plan.allowProcessTermination).toBe(false)
    expect(plan.terminationCommand).toBeNull()
    expect(plan.pid).toBe(4242)
  })

  it("targets only the spawned pid, never an executable name", () => {
    const plan = planCleanup({
      spawned: { pid: 4242, executablePath: "/opt/chrome", userDataDir: "/tmp/p" },
      exitedNormally: false,
      profileDir: "/tmp/p",
    })
    expect(plan.allowProcessTermination).toBe(true)
    expect(plan.pid).toBe(4242)
    expect(plan.terminationCommand).toEqual({
      command: "taskkill",
      args: ["/PID", "4242", "/T", "/F"],
    })
    // A name-based kill would target processes this run never started.
    const flat = [plan.terminationCommand!.command, ...plan.terminationCommand!.args].join(" ")
    expect(flat).not.toMatch(/\/IM\b/)
    expect(flat).not.toContain("chrome.exe")
  })

  it("derives the cleanup target from the spawned identity, not the path", () => {
    const first = planCleanup({
      spawned: { pid: 11, executablePath: "/a/chrome.exe", userDataDir: "/tmp/a" },
      exitedNormally: false,
      profileDir: null,
    })
    const second = planCleanup({
      spawned: { pid: 22, executablePath: "/a/chrome.exe", userDataDir: "/tmp/b" },
      exitedNormally: false,
      profileDir: null,
    })
    expect(first.pid).toBe(11)
    expect(second.pid).toBe(22)
    expect(first.terminationCommand).not.toEqual(second.terminationCommand)
  })

  it("uses taskkill /PID on Windows and never /IM or a process name", () => {
    const command = buildFallbackTerminationCommand(4242, "win32")
    expect(command.command).toBe("taskkill")
    expect(command.args).toEqual(["/PID", "4242", "/T", "/F"])
    const flat = [command.command, ...command.args].join(" ")
    expect(flat).not.toContain("/IM")
    expect(flat).not.toContain("chrome.exe")
  })

  it("uses a direct pid signal on POSIX instead of a name-based kill", () => {
    const command = buildFallbackTerminationCommand(4242, "linux")
    expect(command.command).toBe("kill")
    expect(command.args).toEqual(["-KILL", "4242"])
    expect([command.command, ...command.args].join(" ")).not.toContain("chrome")
  })
})

describe("timeout policy", () => {
  it("defines a finite budget for every stage", () => {
    for (const value of Object.values(STAGE_TIMEOUTS_MS)) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it("names the stalled stage in every timeout message", () => {
    expect(describeTimeout("chromeStart")).toContain("CDP endpoint")
    expect(describeTimeout("extensionDiscovery")).toContain("service worker")
    expect(describeTimeout("sidePanel")).toContain("Side Panel")
    expect(describeTimeout("options")).toContain("Options")
    expect(describeTimeout("cleanup")).toContain("exit")
  })

  it("carries the stage on the thrown error", () => {
    const error = new ArtifactGateError("background", "boom")
    expect(error.stage).toBe("background")
    expect(error.name).toBe("ArtifactGateError")
  })
})
