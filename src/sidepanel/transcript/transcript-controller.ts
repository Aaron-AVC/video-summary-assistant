import type { TranscriptSegment, VideoIdentity } from "@/features/platform/types"

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
