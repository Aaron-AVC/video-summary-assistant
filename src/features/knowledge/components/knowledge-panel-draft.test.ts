import { describe, expect, it } from "bun:test"

import {
  MAX_KNOWLEDGE_NOTE_LENGTH,
  applyKnowledgePanelDraftUpdate,
  createKnowledgePanelDraft,
  createKnowledgePanelDraftStore,
  isKnowledgePanelDraftCurrent,
  selectKnowledgeEditSubmission,
  selectKnowledgeNoteSubmission,
  syncKnowledgePanelDraft,
} from "@/features/knowledge/components/knowledge-panel-draft"

describe("knowledge panel draft", () => {
  it("starts empty and bound to the given identity", () => {
    expect(createKnowledgePanelDraft("youtube:video-a")).toEqual({
      identityKey: "youtube:video-a",
      noteText: "",
      attachTimestamp: true,
      editingId: null,
      editingText: "",
    })
  })

  it("keeps the very same draft while the identity is unchanged", () => {
    const draft = createKnowledgePanelDraft("youtube:video-a")
    const authored = applyKnowledgePanelDraftUpdate(draft, {
      action: { type: "note-text", value: "hello" },
      identityKey: "youtube:video-a",
    })

    expect(isKnowledgePanelDraftCurrent(authored, "youtube:video-a")).toBe(true)
    expect(syncKnowledgePanelDraft(authored, "youtube:video-a")).toBe(authored)
  })

  it("drops the whole authoring state when the identity changes", () => {
    const authored = applyKnowledgePanelDraftUpdate(
      createKnowledgePanelDraft("youtube:video-a"),
      { action: { type: "note-text", value: "for video A" }, identityKey: "youtube:video-a" }
    )
    const editing = applyKnowledgePanelDraftUpdate(authored, {
      action: { type: "begin-edit", id: "note-1", text: "A note" },
      identityKey: "youtube:video-a",
    })

    const switched = syncKnowledgePanelDraft(editing, "youtube:video-b")

    expect(switched).toEqual({
      identityKey: "youtube:video-b",
      noteText: "",
      attachTimestamp: true,
      editingId: null,
      editingText: "",
    })
  })

  it("drops the draft when the runtime stops supporting the content", () => {
    const authored = applyKnowledgePanelDraftUpdate(
      createKnowledgePanelDraft("youtube:video-a"),
      { action: { type: "note-text", value: "draft" }, identityKey: "youtube:video-a" }
    )

    expect(syncKnowledgePanelDraft(authored, null)).toEqual({
      identityKey: null,
      noteText: "",
      attachTimestamp: true,
      editingId: null,
      editingText: "",
    })
  })

  it("applies an action against the new identity instead of the stale draft", () => {
    const authored = applyKnowledgePanelDraftUpdate(
      createKnowledgePanelDraft("youtube:video-a"),
      { action: { type: "note-text", value: "typed on A" }, identityKey: "youtube:video-a" }
    )

    const next = applyKnowledgePanelDraftUpdate(authored, {
      action: { type: "note-text", value: "typed on B" },
      identityKey: "youtube:video-b",
    })

    expect(next.identityKey).toBe("youtube:video-b")
    expect(next.noteText).toBe("typed on B")
  })

  it("tracks the timestamp attachment and inline edit actions", () => {
    let draft = createKnowledgePanelDraft("youtube:video-a")

    draft = applyKnowledgePanelDraftUpdate(draft, {
      action: { type: "attach-timestamp", value: false },
      identityKey: "youtube:video-a",
    })
    expect(draft.attachTimestamp).toBe(false)

    draft = applyKnowledgePanelDraftUpdate(draft, {
      action: { type: "begin-edit", id: "note-1", text: "before" },
      identityKey: "youtube:video-a",
    })
    expect(draft.editingId).toBe("note-1")
    expect(draft.editingText).toBe("before")

    draft = applyKnowledgePanelDraftUpdate(draft, {
      action: { type: "edit-text", value: "after" },
      identityKey: "youtube:video-a",
    })
    expect(draft.editingText).toBe("after")

    draft = applyKnowledgePanelDraftUpdate(draft, {
      action: { type: "end-edit" },
      identityKey: "youtube:video-a",
    })
    expect(draft.editingId).toBeNull()
    expect(draft.editingText).toBe("")
  })

  it("refuses to submit a note that was authored for another identity", () => {
    const authored = applyKnowledgePanelDraftUpdate(
      createKnowledgePanelDraft("youtube:video-a"),
      { action: { type: "note-text", value: "  keep me  " }, identityKey: "youtube:video-a" }
    )

    expect(selectKnowledgeNoteSubmission(authored, "youtube:video-b", 12)).toBeNull()
    expect(selectKnowledgeNoteSubmission(authored, "youtube:video-a", 12)).toEqual({
      text: "keep me",
      attachTimestamp: true,
    })
  })

  it("never anchors a note when the runtime has no timestamp", () => {
    const authored = applyKnowledgePanelDraftUpdate(
      createKnowledgePanelDraft("youtube:video-a"),
      { action: { type: "note-text", value: "note" }, identityKey: "youtube:video-a" }
    )

    expect(selectKnowledgeNoteSubmission(authored, "youtube:video-a", null)).toEqual({
      text: "note",
      attachTimestamp: false,
    })
  })

  it("rejects empty and oversized note drafts", () => {
    const blank = createKnowledgePanelDraft("youtube:video-a")
    expect(selectKnowledgeNoteSubmission(blank, "youtube:video-a", 3)).toBeNull()

    const oversized = applyKnowledgePanelDraftUpdate(blank, {
      action: { type: "note-text", value: "x".repeat(MAX_KNOWLEDGE_NOTE_LENGTH + 1) },
      identityKey: "youtube:video-a",
    })
    expect(selectKnowledgeNoteSubmission(oversized, "youtube:video-a", 3)).toBeNull()
  })

  it("refuses to submit an edit that belongs to another identity", () => {
    const editing = applyKnowledgePanelDraftUpdate(
      createKnowledgePanelDraft("youtube:video-a"),
      { action: { type: "begin-edit", id: "note-1", text: " edit me " }, identityKey: "youtube:video-a" }
    )

    expect(selectKnowledgeEditSubmission(editing, "youtube:video-b")).toBeNull()
    expect(selectKnowledgeEditSubmission(editing, "youtube:video-a")).toEqual({
      id: "note-1",
      text: "edit me",
    })
    expect(selectKnowledgeEditSubmission(createKnowledgePanelDraft("youtube:video-a"), "youtube:video-a")).toBeNull()
  })

  it("keeps one live draft across successive renders and clears it on switch", () => {
    const store = createKnowledgePanelDraftStore("youtube:video-a")
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    const first = store.update({
      action: { type: "note-text", value: "authored on A" },
      identityKey: "youtube:video-a",
    })
    expect(first.noteText).toBe("authored on A")
    expect(store.getSnapshot()).toBe(first)
    expect(notifications).toBe(1)

    const switched = store.update({ action: { type: "end-edit" }, identityKey: "youtube:video-b" })
    expect(switched.identityKey).toBe("youtube:video-b")
    expect(switched.noteText).toBe("")
    expect(store.getSnapshot()).toBe(switched)

    unsubscribe()
    const afterUnsubscribe = notifications
    store.update({ action: { type: "note-text", value: "ignored" }, identityKey: "youtube:video-b" })
    expect(notifications).toBe(afterUnsubscribe)
  })
})
