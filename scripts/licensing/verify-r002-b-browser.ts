// Runs against the actual built pages in a new, owned Chrome for Testing profile.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildChromeArgs } from "../lib/artifact-gate-policy"
import { createArtifactGateProfile } from "../lib/artifact-gate-profile"
import { CdpConnection, fetchVersionInfo, waitForDevToolsPort } from "../lib/cdp-client"
import { verifyArtifact } from "../distribution-notices"
import { loadCandidate } from "./r002-b-candidate"

const [chromePath, artifact] = process.argv.slice(2)
if (!chromePath || !artifact) throw new Error("Provide Chrome for Testing executable and artifact directory")
const artifactDir = resolve(artifact)
verifyArtifact(artifactDir, loadCandidate().inputs.build)
const manifest = JSON.parse(readFileSync(resolve(artifactDir, "manifest.json"), "utf8"))
const profile = createArtifactGateProfile()
const child = Bun.spawn(buildChromeArgs({
  chromePath, artifactDir, userDataDir: profile.profileDir, remoteDebuggingPort: 0,
}), { stdout: "ignore", stderr: "ignore" })
let cdp: CdpConnection | undefined

async function wait<T>(label: string, promise: () => Promise<T | null | false>) {
  const deadline = Date.now() + 12_000
  do {
    const value = await promise()
    if (value) return value
    await Bun.sleep(100)
  } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}

try {
  const port = await waitForDevToolsPort(profile.profileDir, 12_000)
  const version = await fetchVersionInfo(port, 5_000)
  if (!version) throw new Error("Missing Chrome version")
  const connection = cdp = await CdpConnection.connect(version.webSocketDebuggerUrl, 5_000)
  const send = connection.send.bind(connection)
  const extensionId = await wait("production service worker target", async () => {
    const res = await send("Target.getTargets")
    const targets = res.result?.targetInfos as { url: string, type: string }[]
    const target = targets.find(t => t.type === "service_worker" && t.url.endsWith(`/${manifest.background.service_worker}`))
    return target?.url.match(/^chrome-extension:\/\/([a-p]{32})\//)?.[1] ?? null
  })
  async function openPage(path: string, failDb: boolean) {
    const target = await send("Target.createTarget", { url: "about:blank" })
    const targetId = target.result?.targetId as string
    const session = await send("Target.attachToTarget", { targetId, flatten: true })
    const id = session.result?.sessionId as string
    await send("Page.enable", {}, id)
    if (failDb) await send("Page.addScriptToEvaluateOnNewDocument", { source: `
      globalThis.vsaBrowserProbeBlockDatabase = true
      const open = IDBFactory.prototype.open
      IDBFactory.prototype.open = function(...args) {
        if (globalThis.vsaBrowserProbeBlockDatabase) throw new DOMException('R002-B local test', 'UnknownError')
        return open.apply(this, args)
      }
    ` }, id)
    await send("Page.navigate", { url: `chrome-extension://${extensionId}/${path}` }, id)
    return id
  }
  async function evaluate<T>(session: string, expression: string): Promise<T> {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session)
    if (response.result?.exceptionDetails) throw new Error(`Chrome evaluation failed: ${JSON.stringify(response.result.exceptionDetails)}`)
    return (response.result?.result as {value: T}).value
  }
  const selector = JSON.stringify("#provider-generation-timeout")
  async function key(session: string, key: string, code: number) {
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", {type, key, code: key, windowsVirtualKeyCode: code}, session)
    }
  }
  async function selectCycles(session: string) {
    const cond = (label: string, expression: string) => wait(label, () => evaluate<boolean>(session, expression))
    await cond("select control ready", `document.querySelector(${selector})?.getClientRects().length && !document.querySelector(${selector}).disabled`)
    for (let repeat = 0; repeat < 2; repeat++) {
      await evaluate(session, `document.querySelector(${selector}).focus()`)
      await key(session, "Enter", 13)
      await cond("Radix Select locks scroll", `!!document.querySelector('[role=listbox]') &&
        +document.body.getAttribute('data-scroll-locked') > 0 && getComputedStyle(document.body).overflowY === 'hidden'`)
      await key(session, "ArrowDown", 40)
      await key(session, "Escape", 27)
      await cond("escape restores focus and page scrolling",
        `!document.querySelector('[role=listbox]') && !document.body.hasAttribute('data-scroll-locked') &&
        getComputedStyle(document.body).overflowY !== 'hidden' && document.activeElement === document.querySelector(${selector})`)
    }
  }
  const options = await openPage(manifest.options_ui.page, false)
  await selectCycles(options)
  console.log("PASS Options Select: two keyboard open/close cycles; scroll lock/unlock and focus restoration")
  const icons = await evaluate<number[][]>(options, `Promise.all(Object.entries(chrome.runtime.getManifest().icons).map(async ([size, path]) => {
    const image = new Image(); image.src = chrome.runtime.getURL(path); await image.decode()
    return [+size, image.naturalWidth, image.naturalHeight]
  }))`)
  if (icons.length !== 5 || icons.some(([size, width, height]) => size !== width || size !== height)) {
    throw new Error("Production manifest icons did not decode at their expected sizes")
  }
  console.log(`PASS Chrome decoded manifest icons: ${JSON.stringify(icons)}`)
  const panel = await openPage(manifest.side_panel.default_path, true)
  await wait("Side Panel DB unavailable", () => evaluate<boolean>(panel, `!!document.querySelector('[data-database-status=unavailable]')`))
  await evaluate(panel, `globalThis.vsaBrowserProbeBlockDatabase = false;
    [...document.querySelectorAll('[role=alert] button')].find(button => /Retry|重试/i.test(button.textContent ?? '')).click()`)
  await wait("Side Panel retry completed", () => evaluate<boolean>(panel,
    `document.querySelector('[data-database-status=retrying]') === null || globalThis.vsaBrowserProbeBlockDatabase === false`))
  await Bun.sleep(500)
  const recovery = await evaluate<{ status: string | null, alert: string | null, testOpen: string }>(panel, `new Promise(resolve => {
    const request = indexedDB.open('vsa-r002-b-recovery-probe')
    request.onsuccess = () => { request.result.close(); resolve({status: document.querySelector('[data-database-status]')?.getAttribute('data-database-status') ?? null, alert: document.querySelector('[role=alert]')?.textContent ?? null, testOpen: 'ok'}) }
    request.onerror = () => resolve({status: document.querySelector('[data-database-status]')?.getAttribute('data-database-status') ?? null, alert: document.querySelector('[role=alert]')?.textContent ?? null, testOpen: request.error?.name ?? 'error'})
  })`)
  if (recovery.testOpen !== "ok" || recovery.status !== "available") {
    throw new Error(`Side Panel retry did not recover: ${JSON.stringify(recovery)}`)
  }
  console.log(`PASS Side Panel IndexedDB failure and Retry recovery: ${JSON.stringify(recovery)}`)
  await evaluate(panel, `document.querySelector('[role=tab][aria-controls$="-content-settings"]').focus()`)
  await key(panel, "Enter", 13)
  await wait("Side Panel Settings tab activation", () => evaluate<boolean>(panel,
    `!!document.querySelector('[role=tab][aria-controls$="-content-settings"][aria-selected=true]')`))
  await selectCycles(panel)
  console.log(`PASS Side Panel Settings and two Select keyboard/scroll/focus cycles after IndexedDB retry on ${version.browser}`)
} finally {
  try { await cdp?.send("Browser.close", {}, undefined, 4_000) } catch { /* may close before acknowledgement */ }
  cdp?.close()
  const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(5_000).then(() => false)])
  if (exited) profile.cleanup()
  else {
    child.kill()
    console.warn(`Owned browser did not close normally; profile retained: ${profile.profileDir}`)
  }
}
