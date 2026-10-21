export const MAX_KNOWLEDGE_NOTE_LENGTH = 10000

/**
 * Authoring state for the Knowledge panel. `identityKey` is the canonical
 * runtime `contentKey` the draft belongs to; every transition compares it
 * against the current workspace identity so a draft authored on one video can
 * never be persisted onto another.
 */
export type KnowledgePanelDraft = {
  identityKey: string | null
  noteText: string
  attachTimestamp: boolean
  editingId: string | null
  editingText: string
}

export function createKnowledgePanelDraft(identityKey: string | null): KnowledgePanelDraft {
  return {
    identityKey,
    noteText: "",
    attachTimestamp: true,
    editingId: null,
    editingText: "",
  }
}

export function isKnowledgePanelDraftCurrent(
  draft: KnowledgePanelDraft,
  identityKey: string | null
): boolean {
  return draft.identityKey === identityKey
}

/**
 * Drops `noteText`, timestamp attachment, `editingId`, and `editingText`
 * whenever the bound identity changes (A -> B or supported -> unsupported).
 */
export function syncKnowledgePanelDraft(
  draft: KnowledgePanelDraft,
  identityKey: string | null
): KnowledgePanelDraft {
  if (isKnowledgePanelDraftCurrent(draft, identityKey)) return draft
  return createKnowledgePanelDraft(identityKey)
}

export type KnowledgePanelDraftAction =
  | { type: "note-text"; value: string }
  | { type: "attach-timestamp"; value: boolean }
  | { type: "begin-edit"; id: string; text: string }
  | { type: "edit-text"; value: string }
  | { type: "end-edit" }

export type KnowledgePanelDraftUpdate = {
  action: KnowledgePanelDraftAction
  identityKey: string | null
}

/**
 * Applies one action against the identity that was authoritative for that
 * render. The identity sync runs first, so an action issued after a content
 * switch lands on a cleared draft instead of resurrecting the previous one.
 */
export function applyKnowledgePanelDraftUpdate(
  draft: KnowledgePanelDraft,
  update: KnowledgePanelDraftUpdate
): KnowledgePanelDraft {
  const synced = syncKnowledgePanelDraft(draft, update.identityKey)
  switch (update.action.type) {
    case "note-text":
      return { ...synced, noteText: update.action.value }
    case "attach-timestamp":
      return { ...synced, attachTimestamp: update.action.value }
    case "begin-edit":
      return {
        ...synced,
        editingId: update.action.id,
        editingText: update.action.text,
      }
    case "edit-text":
      return { ...synced, editingText: update.action.value }
    case "end-edit":
      return { ...synced, editingId: null, editingText: "" }
  }
}

export type KnowledgeNoteSubmission = {
  text: string
  attachTimestamp: boolean
}

/**
 * Returns the note payload only while the draft still belongs to the current
 * identity. A draft carried over from a previous video therefore yields `null`
 * instead of being saved onto the new one.
 */
export function selectKnowledgeNoteSubmission(
  draft: KnowledgePanelDraft,
  identityKey: string | null,
  currentTimestamp: number | null
): KnowledgeNoteSubmission | null {
  if (!isKnowledgePanelDraftCurrent(draft, identityKey)) return null
  const text = draft.noteText.trim()
  if (!text || text.length > MAX_KNOWLEDGE_NOTE_LENGTH) return null
  return {
    text,
    attachTimestamp: draft.attachTimestamp && currentTimestamp !== null,
  }
}

export type KnowledgeEditSubmission = {
  id: string
  text: string
}

export function selectKnowledgeEditSubmission(
  draft: KnowledgePanelDraft,
  identityKey: string | null
): KnowledgeEditSubmission | null {
  if (!isKnowledgePanelDraftCurrent(draft, identityKey)) return null
  if (!draft.editingId) return null
  const text = draft.editingText.trim()
  if (!text || text.length > MAX_KNOWLEDGE_NOTE_LENGTH) return null
  return { id: draft.editingId, text }
}

export type KnowledgePanelDraftStore = {
  getSnapshot(): KnowledgePanelDraft
  subscribe(listener: () => void): () => void
  update(update: KnowledgePanelDraftUpdate): KnowledgePanelDraft
}

/**
 * Minimal external store so the panel stays a thin view over React-free state.
 * The same shape lets tests drive successive renders against one live draft.
 */
export function createKnowledgePanelDraftStore(
  identityKey: string | null = null
): KnowledgePanelDraftStore {
  let snapshot = createKnowledgePanelDraft(identityKey)
  const listeners = new Set<() => void>()

  return {
    getSnapshot() {
      return snapshot
    },

    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    update(update: KnowledgePanelDraftUpdate) {
      const next = applyKnowledgePanelDraftUpdate(snapshot, update)
      if (next !== snapshot) {
        snapshot = next
        for (const listener of listeners) listener()
      }
      return snapshot
    },
  }
}
