import type { TranscriptSegment, VideoIdentity } from "@/features/platform/types"
import type { TranscriptCacheEntity } from "@/lib/schemas/persistence"
import {
  type CurrentTranscriptResult,
} from "@/sidepanel/lib/load-current-transcript"
import {
  acquireTranscript,
  type CachedTranscriptCandidate,
  type TranscriptAcquisitionRequest,
  type TranscriptSessionSnapshot,
} from "@/sidepanel/transcript/transcript-acquisition"
import {
  buildTranscriptCacheWrite,
  prepareCurrentTranscriptFinalization,
} from "@/sidepanel/transcript/transcript-finalization"

export type TranscriptSnapshot = {
  cues: TranscriptSegment[]
  identity: VideoIdentity | null
  title: string | null
  fingerprint: string | null
  rawVtt: string | null
  error: string | null
  isLoading: boolean
}

export type TranscriptPublication = {
  cues: TranscriptSegment[]
  identity: VideoIdentity | null
  title: string | null
  fingerprint: string | null
  rawVtt: string | null
}

type TranscriptListener = () => void

export type TranscriptControllerDependencies = {
  readCached: (contentKey: string) => Promise<CachedTranscriptCandidate | null>
  loadRemote: (input: {
    request: TranscriptAcquisitionRequest
    isCurrent: () => boolean
  }) => Promise<CurrentTranscriptResult>
  saveCache: (input: TranscriptCacheEntity) => Promise<unknown>
  now?: () => string
}

export type LoadCurrentTranscriptInput = {
  request: TranscriptAcquisitionRequest
  forceReload: boolean
  isTargetCurrent: () => boolean
  onFingerprintChanged?: (change: {
    previousFingerprint: string
    fingerprint: string | null
  }) => void
  onPublished?: (snapshot: TranscriptSnapshot) => void
}

function createInitialSnapshot(): TranscriptSnapshot {
  return {
    cues: [],
    identity: null,
    title: null,
    fingerprint: null,
    rawVtt: null,
    error: null,
    isLoading: false,
  }
}

function cloneSnapshot(snapshot: TranscriptSnapshot): TranscriptSnapshot {
  return {
    ...snapshot,
    cues: snapshot.cues.map((cue) => ({ ...cue })),
    identity: snapshot.identity ? { ...snapshot.identity } : null,
  }
}

function sameIdentity(left: VideoIdentity | null, right: VideoIdentity | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.platform === right.platform
    && left.videoId === right.videoId
    && left.partId === right.partId
    && left.contentKey === right.contentKey
}

function sameCues(left: TranscriptSegment[], right: TranscriptSegment[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((cue, index) => {
    const other = right[index]
    return cue.startSec === other.startSec
      && cue.endSec === other.endSec
      && cue.text === other.text
  })
}

function sameSnapshot(left: TranscriptSnapshot, right: TranscriptSnapshot): boolean {
  return sameCues(left.cues, right.cues)
    && sameIdentity(left.identity, right.identity)
    && left.title === right.title
    && left.fingerprint === right.fingerprint
    && left.rawVtt === right.rawVtt
    && left.error === right.error
    && left.isLoading === right.isLoading
}

export class TranscriptController {
  private snapshot = createInitialSnapshot()
  private loadEpoch = 0
  private readonly listeners = new Set<TranscriptListener>()

  constructor(private readonly dependencies: TranscriptControllerDependencies) {}

  getSnapshot(): TranscriptSnapshot {
    return cloneSnapshot(this.snapshot)
  }

  subscribe(listener: TranscriptListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  beginLoadEpoch(): number {
    this.loadEpoch += 1
    return this.loadEpoch
  }

  invalidateLoadEpoch(): number {
    this.loadEpoch += 1
    return this.loadEpoch
  }

  captureLoadEpoch(): number {
    return this.loadEpoch
  }

  isLoadEpochCurrent(epoch: number): boolean {
    return this.loadEpoch === epoch
  }

  async loadCurrent({
    request,
    forceReload,
    isTargetCurrent,
    onFingerprintChanged,
    onPublished,
  }: LoadCurrentTranscriptInput): Promise<CurrentTranscriptResult> {
    const epoch = this.beginLoadEpoch()
    const isCurrent = () => this.isLoadEpochCurrent(epoch) && isTargetCurrent()

    this.setLoading(true)
    this.setError(null)

    try {
      const currentSnapshot = this.getSnapshot()
      const session: TranscriptSessionSnapshot = {
        identity: currentSnapshot.identity,
        segments: currentSnapshot.cues,
        rawVtt: currentSnapshot.rawVtt,
      }
      const result = await acquireTranscript({
        request,
        session,
        forceReload,
        isCurrent,
        readCached: this.dependencies.readCached,
        loadRemote: this.dependencies.loadRemote,
      })
      const previousFingerprint = this.snapshot.fingerprint
      const finalization = await prepareCurrentTranscriptFinalization({
        result,
        previousFingerprint,
        isCurrent,
      })

      if (finalization.shouldInvalidateAsk && previousFingerprint) {
        onFingerprintChanged?.({
          previousFingerprint,
          fingerprint: finalization.fingerprint,
        })
      }

      this.publish({
        ...finalization.publication,
        fingerprint: finalization.fingerprint,
      })
      onPublished?.(this.getSnapshot())

      const now = this.dependencies.now?.() ?? new Date().toISOString()
      await this.dependencies.saveCache(buildTranscriptCacheWrite({
        result,
        fingerprint: finalization.fingerprint,
        now,
      }))
      return result
    } catch (error) {
      if (isCurrent()) {
        this.setError(error instanceof Error ? error.message : "Unknown transcript error.")
      }
      throw error
    } finally {
      if (isCurrent()) this.setLoading(false)
    }
  }

  publish(publication: TranscriptPublication): TranscriptSnapshot {
    return this.commit({
      ...this.snapshot,
      cues: publication.cues.map((cue) => ({ ...cue })),
      identity: publication.identity ? { ...publication.identity } : null,
      title: publication.title,
      fingerprint: publication.fingerprint,
      rawVtt: publication.rawVtt,
    })
  }

  setFingerprint(fingerprint: string | null): TranscriptSnapshot {
    return this.commit({ ...this.snapshot, fingerprint })
  }

  setError(error: string | null): TranscriptSnapshot {
    return this.commit({ ...this.snapshot, error })
  }

  setLoading(isLoading: boolean): TranscriptSnapshot {
    return this.commit({ ...this.snapshot, isLoading })
  }

  reset(): TranscriptSnapshot {
    return this.commit(createInitialSnapshot())
  }

  private commit(next: TranscriptSnapshot): TranscriptSnapshot {
    if (sameSnapshot(this.snapshot, next)) return this.getSnapshot()
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
    return this.getSnapshot()
  }
}
