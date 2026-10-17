import { FileText, MessageCircleQuestion, Plus, Settings2, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { AskAiPanel } from "@/features/analysis/components/ask-ai-panel"
import type { AskVideoAnswer } from "@/features/analysis/lib/analysis-schema"
import { EmptyState } from "@/features/common/components/empty-state"
import { getAskRequirement } from "@/sidepanel/lib/sidepanel-ux"
import type { QaMessageEntity, QaThreadEntity } from "@/lib/schemas/persistence"
import { QaThreadHistory } from "@/features/analysis/components/qa-thread-history"
import { useI18n } from "@/lib/i18n/i18n-provider"

type AskTabProps = {
  hasProvider: boolean
  hasAnalysis: boolean
  hasTranscript: boolean
  transcriptMismatch?: boolean
  question: string
  answer: AskVideoAnswer | null
  messages?: QaMessageEntity[]
  threads?: QaThreadEntity[]
  currentThreadId?: string | null
  isAsking: boolean
  canAsk: boolean
  errorMessage: string | null
  isTranscriptLoading: boolean
  onQuestionChange: (question: string) => void
  onAsk: () => void | Promise<void>
  onFollowUp: (question: string) => void
  onNewChat?: () => void
  onOpenThread?: (threadId: string) => void | Promise<void>
  onDeleteThread?: (threadId: string) => void | Promise<void>
  onJump: (timestampSeconds: number) => void | Promise<void>
  onOpenSettings: () => void
  onOpenOverview: () => void
  onLoadTranscript: () => void | Promise<void>
  formatTimestamp: (timestampSeconds: number) => string
}

export function AskTab({
  hasProvider,
  hasAnalysis,
  hasTranscript,
  transcriptMismatch = false,
  question,
  answer,
  messages = [],
  threads = [],
  currentThreadId,
  isAsking,
  canAsk,
  errorMessage,
  isTranscriptLoading,
  onQuestionChange,
  onAsk,
  onFollowUp,
  onNewChat = () => undefined,
  onOpenThread = () => undefined,
  onDeleteThread = () => undefined,
  onJump,
  onOpenSettings,
  onOpenOverview,
  onLoadTranscript,
  formatTimestamp,
}: AskTabProps) {
  const { t } = useI18n()
  const requirement = getAskRequirement({ hasProvider, hasAnalysis, hasTranscript })

  if (requirement === "provider") {
    return (
      <EmptyState
        className="border border-dashed border-border/70 bg-card/70"
        icon={<Settings2 />}
        title={t("ask.configureProvider")}
        description={t("ask.configureDescription")}
        action={<Button onClick={onOpenSettings}>{t("overview.configureProvider")}</Button>}
      />
    )
  }

  if (requirement === "analysis") {
    return (
      <EmptyState
        className="border border-dashed border-border/70 bg-card/70"
        icon={<Sparkles />}
        title={t("ask.generateFirst")}
        description={t("ask.generateDescription")}
        action={<Button onClick={onOpenOverview}>{t("ask.generateFirst")}</Button>}
      />
    )
  }

  if (transcriptMismatch && hasProvider && hasAnalysis) {
    return (
      <EmptyState
        className="border border-dashed border-border/70 bg-card/70"
        icon={<FileText />}
        title={t("ask.transcriptChanged")}
        description={t("ask.transcriptChangedDescription")}
        action={<Button onClick={onOpenOverview}>{t("ask.goOverview")}</Button>}
      />
    )
  }

  if (requirement === "transcript") {
    return (
      <EmptyState
        className="border border-dashed border-border/70 bg-card/70"
        icon={<FileText />}
        title={t("ask.loadTranscript")}
        description={t("ask.loadDescription")}
        action={(
          <Button disabled={isTranscriptLoading} onClick={onLoadTranscript}>
            {isTranscriptLoading ? t("task.loadingTranscript") : t("ask.loadTranscript")}
          </Button>
        )}
      />
    )
  }

  return (
    <div className="min-w-0" data-layout-check="ask-tab">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium"><MessageCircleQuestion className="h-4 w-4 text-primary" /> {t("ask.video")}</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={isAsking} onClick={onNewChat}><Plus className="h-4 w-4" /> {t("ask.newChat")}</Button>
          <details className="relative min-w-0">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-input bg-background px-3 text-sm font-medium">{t("ask.history")}</summary>
            <div className="absolute right-0 top-full z-20 mt-2 min-w-0 max-w-[calc(100vw-1.5rem)] w-[min(28rem,calc(100vw-1.5rem))] overflow-hidden">
              <QaThreadHistory disabled={isAsking} currentThreadId={currentThreadId} threads={threads} onOpen={onOpenThread} onDelete={onDeleteThread} />
            </div>
          </details>
        </div>
      </div>
      <AskAiPanel
        question={question}
        answer={answer}
        messages={messages}
        isAsking={isAsking}
        canAsk={canAsk}
        disabledReason={question.trim() ? null : t("ask.typeQuestion")}
        errorMessage={errorMessage}
        onQuestionChange={onQuestionChange}
        onAsk={onAsk}
        onFollowUp={onFollowUp}
        onJump={onJump}
        formatTimestamp={formatTimestamp}
      />
      <p className="sr-only">
        <MessageCircleQuestion /> {t("ask.loadDescription")}
      </p>
    </div>
  )
}
