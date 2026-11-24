import { randomUUID } from "node:crypto"
import {
  accessSync,
  constants,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, platform, tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"

export const ARTIFACT_GATE_PROFILE_ROOT_ENV = "ARTIFACT_GATE_PROFILE_ROOT"
const OWNER_MARKER = ".vsa-artifact-gate-owner"
const PROFILE_PREFIX = "vsa-artifact-gate-"

export type ArtifactGateProfile = {
  selectedRoot: string
  absoluteRoot: string
  rootRealPath: string
  profileDir: string
  profileRealPath: string
  pathLengthUtf16: number
  cleanup: () => void
}

export type CreateArtifactGateProfileOptions = {
  requestedRoot?: string | null
  envRoot?: string | null
  systemTempRoot?: string
}

function isUsableAbsolutePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && isAbsolute(value)
    && !/^undefined(?:[\\/]|$)/i.test(value)
}

function assertRealDirectory(path: string, label: string): void {
  const stats = lstatSync(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${path}`)
  }
}

function removeTreeWithoutFollowingLinks(path: string): void {
  const stats = lstatSync(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    unlinkSync(path)
    return
  }

  for (const name of readdirSync(path)) {
    if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
      throw new Error(`Unexpected directory entry during profile cleanup: ${name}`)
    }
    const child = join(path, name)
    if (dirname(resolve(child)) !== resolve(path)) {
      throw new Error(`Refusing to clean a path outside the owned profile: ${child}`)
    }
    removeTreeWithoutFollowingLinks(child)
  }
  rmdirSync(path)
}

export function createArtifactGateProfile(
  options: CreateArtifactGateProfileOptions = {},
): ArtifactGateProfile {
  const selectedRoot = options.requestedRoot
    || options.envRoot
    || options.systemTempRoot
    || getDefaultArtifactGateProfileRoot()
  if (selectedRoot.trim().length === 0) {
    throw new Error("Artifact Gate profile root must not be empty.")
  }

  let absoluteRoot: string
  let rootRealPath: string
  try {
    absoluteRoot = resolve(selectedRoot)
    rootRealPath = realpathSync(absoluteRoot)
    assertRealDirectory(rootRealPath, "Artifact Gate profile root")
    accessSync(rootRealPath, constants.R_OK | constants.W_OK)
  } catch (error) {
    throw new Error(`Artifact Gate profile root is unavailable or invalid: ${selectedRoot}`, { cause: error })
  }

  let profileDir: string
  try {
    // mkdtemp uses exclusive creation, so concurrent runs cannot share a profile.
    profileDir = mkdtempSync(join(rootRealPath, PROFILE_PREFIX))
  } catch (error) {
    throw new Error(`Could not create an isolated Artifact Gate profile under ${rootRealPath}`, { cause: error })
  }

  const profileRealPath = realpathSync(profileDir)
  const profileStats = lstatSync(profileDir)
  if (
    dirname(profileRealPath) !== rootRealPath
    || profileRealPath !== profileDir
    || !profileStats.isDirectory()
    || profileStats.isSymbolicLink()
  ) {
    try {
      if (profileStats.isDirectory() && !profileStats.isSymbolicLink()) rmdirSync(profileDir)
    } catch {
      // Leave the path untouched when isolation cannot be established.
    }
    throw new Error(`Created profile did not remain isolated under ${rootRealPath}`)
  }

  const ownerToken = randomUUID()
  const ownerPath = join(profileDir, OWNER_MARKER)
  try {
    writeFileSync(ownerPath, ownerToken, { encoding: "utf8", flag: "wx", mode: 0o600 })
  } catch (error) {
    try {
      rmdirSync(profileDir)
    } catch {
      // A non-empty directory is left untouched if ownership marking failed.
    }
    throw new Error(`Could not mark ownership of Artifact Gate profile ${profileDir}`, { cause: error })
  }

  let cleaned = false
  return {
    selectedRoot,
    absoluteRoot,
    rootRealPath,
    profileDir,
    profileRealPath,
    pathLengthUtf16: profileRealPath.length,
    cleanup() {
      if (cleaned) return
      try {
        assertRealDirectory(rootRealPath, "Artifact Gate profile root")
        const currentRoot = realpathSync(rootRealPath)
        const profileStatsNow = lstatSync(profileDir)
        if (!profileStatsNow.isDirectory() || profileStatsNow.isSymbolicLink()) {
          throw new Error(`Owned profile is no longer a real directory: ${profileDir}`)
        }
        const currentProfile = realpathSync(profileDir)
        if (
          currentRoot !== rootRealPath
          || currentProfile !== profileRealPath
          || dirname(currentProfile) !== rootRealPath
        ) {
          throw new Error(`Owned profile moved outside its original root: ${profileDir}`)
        }
        const markerStats = lstatSync(ownerPath)
        if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
          throw new Error(`Profile ownership marker was replaced: ${ownerPath}`)
        }
        if (readFileSync(ownerPath, "utf8") !== ownerToken) {
          throw new Error(`Profile ownership marker changed: ${ownerPath}`)
        }
      } catch (error) {
        throw new Error(`Refusing unsafe Artifact Gate profile cleanup for ${profileDir}`, { cause: error })
      }

      removeTreeWithoutFollowingLinks(profileDir)
      cleaned = true
    },
  }
}

export function getDefaultArtifactGateProfileRoot(): string {
  const systemTempRoot = tmpdir()
  if (isUsableAbsolutePath(systemTempRoot)) return systemTempRoot

  // Embedded Node-compatible runtimes can have a malformed temp path when
  // TEMP/TMP are missing. Use the platform's per-user temp directory instead.
  if (platform() === "win32") {
    const home = homedir()
    if (isUsableAbsolutePath(home)) return join(home, "AppData", "Local", "Temp")
  }
  for (const candidate of [process.env.TMPDIR, process.env.TMP, process.env.TEMP]) {
    if (isUsableAbsolutePath(candidate)) return candidate
  }
  if (platform() !== "win32") return "/tmp"
  throw new Error("Could not resolve a valid platform temporary directory for the Artifact Gate.")
}
