import { useState } from "react"
import { Bookmark, NotebookPen, Pencil, Trash2 } from "lucide-react"

import { useI18n } from "@/lib/i18n/i18n-provider"

import { EmptyState } from "@/features/common/components/empty-state"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { KnowledgeItemEntity } from "@/lib/schemas/persistence"

export type KnowledgePanelHandlers = {
  onToggleBookmark: () => void | Promise<void>
  onCreateNote: (input: { text: string; attachTimestamp: boolean }) => void | Promise<void>
  onUpdateNote: (id: string, text: string) => void | Promise<void>
  onDeleteItem: (id: string) => void | Promise<void>
  onJump: (timestampSeconds: number) => void | Promise<void>
}

export type KnowledgePanelProps = {
  items: KnowledgeItemEntity[]
  isLoading: boolean
  error: string | null
  /** Normalized playback point, or null when the runtime cannot report one. */
  currentTimestamp: number | null
  formatTimestamp: (timestampSeconds: number) => string
  handlers: KnowledgePanelHandlers
}

const MAX_NOTE_LENGTH = 10000

/**
 * Presentation-only Knowledge collection. It receives plain entities and
 * callbacks, so it never touches IndexedDB, provider state, or timestamps on
 * its own.
 */
export function KnowledgePanel({
  items,
  isLoading,
  error,
  currentTimestamp,
  formatTimestamp,
  handlers,
}: KnowledgePanelProps) {
  const { t } = useI18n()
  const [noteText, setNoteText] = useState("")
  const [attachTimestamp, setAttachTimestamp] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")

  const trimmedNote = noteText.trim()
  const canSaveNote = trimmedNote.length > 0 && trimmedNote.length <= MAX_NOTE_LENGTH
  const canBookmark = currentTimestamp !== null

  async function saveNote() {
    if (!canSaveNote) return
    await handlers.onCreateNote({
      text: trimmedNote,
      attachTimestamp: attachTimestamp && currentTimestamp !== null,
    })
    setNoteText("")
  }

  async function saveEdit() {
    if (!editingId) return
    const trimmed = editingText.trim()
    if (!trimmed) return
    await handlers.onUpdateNote(editingId, trimmed)
    setEditingId(null)
    setEditingText("")
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card/70 p-3" data-layout-check="knowledge-panel">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-sm font-semibold">{t("knowledge.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("knowledge.description")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canBookmark}
          title={canBookmark ? undefined : t("knowledge.bookmarkUnavailable")}
          onClick={() => void handlers.onToggleBookmark()}
        >
          <Bookmark aria-hidden /> {t("knowledge.bookmarkCurrent")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {canBookmark
            ? formatTimestamp(currentTimestamp)
            : t("knowledge.bookmarkUnavailable")}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <label className="text-xs font-medium" htmlFor="knowledge-note-input">
          {t("knowledge.noteLabel")}
        </label>
        <Textarea
          id="knowledge-note-input"
          value={noteText}
          maxLength={MAX_NOTE_LENGTH}
          placeholder={t("knowledge.notePlaceholder")}
          onChange={(event) => setNoteText(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={attachTimestamp}
              disabled={!canBookmark}
              onChange={(event) => setAttachTimestamp(event.target.checked)}
            />
            {t("knowledge.attachCurrentTime")}
          </label>
          <Button type="button" size="sm" disabled={!canSaveNote} onClick={() => void saveNote()}>
            {t("knowledge.saveNote")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t("knowledge.loading")}</p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error || t("knowledge.error")}
        </p>
      ) : null}

      {!isLoading && items.length === 0 ? (
        <EmptyState
          className="border border-dashed border-border/70 bg-background/40"
          icon={<NotebookPen />}
          title={t("knowledge.emptyTitle")}
          description={t("knowledge.emptyDescription")}
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="flex min-w-0 flex-col gap-2">
          {items.map((item) => {
            const anchored = item.startSec !== null
            const isEditing = editingId === item.id
            return (
              <li
                key={item.id}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/60 bg-background/50 p-2"
                data-knowledge-kind={item.kind}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {item.kind === "bookmark" ? <Bookmark aria-hidden /> : <NotebookPen aria-hidden />}
                  <span className="font-medium text-foreground">
                    {item.kind === "bookmark" ? t("knowledge.bookmarkKind") : t("knowledge.noteKind")}
                  </span>
                  {anchored ? <span>{formatTimestamp(item.startSec!)}</span> : null}
                </div>

                {item.kind === "note" ? (
                  isEditing ? (
                    <div className="flex min-w-0 flex-col gap-2">
                      <Textarea
                        value={editingText}
                        maxLength={MAX_NOTE_LENGTH}
                        onChange={(event) => setEditingText(event.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={() => void saveEdit()}>
                          {t("knowledge.saveEdit")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null)
                            setEditingText("")
                          }}
                        >
                          {t("knowledge.cancelEdit")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm">{item.text}</p>
                  )
                ) : null}

                {!isEditing ? (
                  <div className="flex flex-wrap gap-1">
                    {anchored ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void handlers.onJump(item.startSec!)}
                      >
                        {t("knowledge.jump")}
                      </Button>
                    ) : null}
                    {item.kind === "note" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t("knowledge.edit")}
                        onClick={() => {
                          setEditingId(item.id)
                          setEditingText(item.text ?? "")
                        }}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={t("knowledge.delete")}
                      onClick={() => void handlers.onDeleteItem(item.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
