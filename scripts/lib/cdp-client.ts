/**
 * Minimal Chrome DevTools Protocol client built on Bun's WebSocket/fetch.
 *
 * Intentionally dependency-free: RG-01 must not add Playwright/Puppeteer or any
 * other browser automation package to the project.
 */

import { existsSync, readFileSync } from "node:fs"

export type CdpMessage = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { code: number; message: string; data?: string }
  sessionId?: string
}

export type CdpEventHandler = (message: CdpMessage) => void

export class CdpConnection {
  #socket: WebSocket
  #nextId = 1
  #pending = new Map<number, { resolve: (m: CdpMessage) => void; reject: (e: Error) => void }>()
  #handlers = new Set<CdpEventHandler>()
  #closed = false

  private constructor(socket: WebSocket) {
    this.#socket = socket
  }

  static async connect(url: string, timeoutMs: number): Promise<CdpConnection> {
    const socket = new WebSocket(url)
    const connection = new CdpConnection(socket)

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out opening CDP websocket at ${url}`))
      }, timeoutMs)
      socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`Failed to open CDP websocket at ${url}`))
      }
    })

    socket.onmessage = (event) => {
      let parsed: CdpMessage
      try {
        parsed = JSON.parse(String(event.data)) as CdpMessage
      } catch {
        return
      }
      if (parsed.id !== undefined) {
        const entry = connection.#pending.get(parsed.id)
        if (!entry) return
        connection.#pending.delete(parsed.id)
        if (parsed.error) {
          entry.reject(new Error(`${parsed.error.message} (code ${parsed.error.code})`))
        } else {
          entry.resolve(parsed)
        }
        return
      }
      for (const handler of connection.#handlers) handler(parsed)
    }

    socket.onclose = () => {
      connection.#closed = true
      for (const entry of connection.#pending.values()) {
        entry.reject(new Error("CDP connection closed"))
      }
      connection.#pending.clear()
    }

    return connection
  }

  get closed(): boolean {
    return this.#closed
  }

  onEvent(handler: CdpEventHandler): () => void {
    this.#handlers.add(handler)
    return () => this.#handlers.delete(handler)
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 15_000,
  ): Promise<CdpMessage> {
    if (this.#closed) return Promise.reject(new Error(`CDP connection closed before ${method}`))
    const id = this.#nextId++
    const payload: CdpMessage = { id, method, params }
    if (sessionId) payload.sessionId = sessionId

    return new Promise<CdpMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`CDP command timed out: ${method}`))
      }, timeoutMs)
      this.#pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        this.#socket.send(JSON.stringify(payload))
      } catch (error) {
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  close(): void {
    this.#closed = true
    try {
      this.#socket.close()
    } catch {
      // Closing an already-closed socket is not an error for the gate.
    }
  }
}

export type CdpVersionInfo = {
  browser: string
  webSocketDebuggerUrl: string
}

/**
 * Read the DevTools port that Chromium chose for this run.
 *
 * `--remote-debugging-port=0` makes Chromium pick a free port and publish it in
 * `<user-data-dir>/DevToolsActivePort` as `port\n/browser/ws/path`. Reading that
 * file keeps the gate free of fixed-port collisions and guarantees we only ever
 * talk to the browser instance this run spawned.
 */
export function readDevToolsActivePort(userDataDir: string): number | null {
  const file = `${userDataDir}/DevToolsActivePort`
  if (!existsSync(file)) return null
  try {
    const firstLine = readFileSync(file, "utf8").split(/\r?\n/, 1)[0]?.trim()
    if (!firstLine) return null
    const port = Number.parseInt(firstLine, 10)
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null
    return port
  } catch {
    return null
  }
}

/** Poll `<user-data-dir>/DevToolsActivePort` until Chromium publishes its port. */
export async function waitForDevToolsPort(
  userDataDir: string,
  timeoutMs: number,
  pollIntervalMs = 200,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const port = readDevToolsActivePort(userDataDir)
    if (port !== null) return port
    await Bun.sleep(pollIntervalMs)
  }
  throw new Error("Chromium never published DevToolsActivePort")
}

export async function fetchVersionInfo(
  port: number,
  timeoutMs: number,
): Promise<CdpVersionInfo | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body = (await response.json()) as { Browser?: string; webSocketDebuggerUrl?: string }
    if (!body.Browser || !body.webSocketDebuggerUrl) return null
    return { browser: body.Browser, webSocketDebuggerUrl: body.webSocketDebuggerUrl }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Poll the CDP endpoint until it answers or the budget expires. */
export async function waitForCdpEndpoint(
  port: number,
  timeoutMs: number,
  pollIntervalMs = 250,
): Promise<CdpVersionInfo> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const info = await fetchVersionInfo(port, Math.min(2_000, timeoutMs))
    if (info) return info
    await Bun.sleep(pollIntervalMs)
  }
  throw new Error("CDP endpoint never became available")
}
