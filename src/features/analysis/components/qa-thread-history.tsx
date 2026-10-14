import { History, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { QaThreadEntity } from "@/lib/schemas/persistence"

type QaThreadHistoryProps = {
  disabled?: boolean
  currentThreadId?: string | null
  threads: QaThreadEntity[]
  onOpen: (threadId: string) => void | Promise<void>
  onDelete: (threadId: string) => void | Promise<void>
}

export function QaThreadHistory({ disabled = false, currentThreadId, threads, onOpen, onDelete }: QaThreadHistoryProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 p-3" data-layout-check="qa-thread-history">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <History className="h-4 w-4 text-primary" />
        <span>Conversation history</span>
      </div>
      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved conversations for this analysis.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {threads.map((thread) => (
            <div key={thread.id} className={`flex min-w-0 items-center gap-2 rounded-md border p-2 ${thread.id === currentThreadId ? "border-primary/50 bg-primary/5" : "border-border/60"}`}>
              <Button disabled={disabled} variant="ghost" size="sm" className="min-w-0 flex-1 justify-start text-left" aria-current={thread.id === currentThreadId ? "true" : undefined} onClick={() => onOpen(thread.id)}>
                <span className="min-w-0 truncate">{thread.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {new Date(thread.updatedAt).toLocaleString()}
                </span>
              </Button>
              <Button disabled={disabled} variant="ghost" size="icon" className="shrink-0" aria-label={`Delete ${thread.title}`} onClick={() => onDelete(thread.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
