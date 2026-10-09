import { FileText, MessageCircleQuestion, Settings2, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { AskAiPanel } from "@/features/analysis/components/ask-ai-panel"
import type { AskVideoAnswer } from "@/features/analysis/lib/analysis-schema"
import { EmptyState } from "@/features/common/components/empty-state"
import { getAskRequirement } from "@/sidepanel/lib/sidepanel-ux"

type AskTabProps = {
  hasProvider: boolean
  hasAnalysis: boolean
  hasTranscript: boolean
  question: string
  answer: AskVideoAnswer | null
  isAsking: boolean
  canAsk: boolean
  errorMessage: string | null
  isTranscriptLoading: boolean
  onQuestionChange: (question: string) => void
  onAsk: () => void | Promise<void>
  onFollowUp: (question: string) => void
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
  question,
  answer,
  isAsking,
  canAsk,
  errorMessage,
  isTranscriptLoading,
  onQuestionChange,
  onAsk,
  onFollowUp,
  onJump,
  onOpenSettings,
  onOpenOverview,
  onLoadTranscript,
  formatTimestamp,
}: AskTabProps) {
  const requirement = getAskRequirement({ hasProvider, hasAnalysis, hasTranscript })

  if (requirement === "provider") {
    return (
      <EmptyState
        className="border border-dashed border-border/70 bg-card/70"
        icon={<Settings2 />}
        title="Configure a provider"
        description="Ask Video uses the current default provider after you explicitly save it in Settings."
        action={<Button onClick={onOpenSettings}>Configure provider</Button>}
      />
    )
  }

  if (requirement === "analysis") {
    return (
      <EmptyState
        className="border border-dashed border-border/70 bg-card/70"
        icon={<Sparkles />}
        title="Generate analysis first"
        description="Ask Video needs the canonical analysis context before it can answer follow-up questions."
        action={<Button onClick={onOpenOverview}>Generate analysis first</Button>}
      />
    )
  }

  if (requirement === "transcript") {
    return (
      <EmptyState
        className="border border-dashed border-border/70 bg-card/70"
        icon={<FileText />}
        title="Load transcript"
        description="Ask Video grounds answers in the transcript for this analysis."
        action={(
          <Button disabled={isTranscriptLoading} onClick={onLoadTranscript}>
            {isTranscriptLoading ? "Loading transcript…" : "Load transcript"}
          </Button>
        )}
      />
    )
  }

  return (
    <div className="min-w-0" data-layout-check="ask-tab">
      <AskAiPanel
        question={question}
        answer={answer}
        isAsking={isAsking}
        canAsk={canAsk}
        disabledReason={question.trim() ? null : "Type a question to enable Ask Video."}
        errorMessage={errorMessage}
        onQuestionChange={onQuestionChange}
        onAsk={onAsk}
        onFollowUp={onFollowUp}
        onJump={onJump}
        formatTimestamp={formatTimestamp}
      />
      <p className="sr-only">
        <MessageCircleQuestion /> Ask answers stay grounded in the loaded transcript.
      </p>
    </div>
  )
}
