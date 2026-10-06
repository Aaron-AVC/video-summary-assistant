import { Loader2, MessageCircleQuestion, Play, Send } from "lucide-react"

import type { AskVideoAnswer } from "@/features/analysis/lib/analysis-schema"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type AskAiPanelProps = {
  question: string
  answer: AskVideoAnswer | null
  isAsking: boolean
  canAsk: boolean
  disabledReason?: string | null
  errorMessage: string | null
  onQuestionChange: (question: string) => void
  onAsk: () => void | Promise<void>
  onFollowUp: (question: string) => void
  onJump: (timestampSeconds: number) => void | Promise<void>
  formatTimestamp: (timestampSeconds: number) => string
}

export function AskAiPanel({
  question,
  answer,
  isAsking,
  canAsk,
  disabledReason = null,
  errorMessage,
  onQuestionChange,
  onAsk,
  onFollowUp,
  onJump,
  formatTimestamp
}: AskAiPanelProps) {
  return (
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95" data-layout-check="ask-ai-panel">
      <CardHeader className="min-w-0 p-4">
        <CardDescription className="flex min-w-0 items-center gap-2 text-xs font-medium uppercase text-primary">
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          Ask AI
        </CardDescription>
        <CardTitle className="max-w-full text-base [overflow-wrap:anywhere]">
          Grounded follow-up
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3 p-4 pt-1">
        <form
          className="flex min-w-0 gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void onAsk()
          }}>
          <Input
            className="min-w-0"
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder="Ask about this video"
            aria-label="Ask AI a question about this video"
            disabled={isAsking}
          />
          <Button type="submit" size="icon" className="shrink-0" disabled={!canAsk || isAsking} aria-label="Ask AI">
            {isAsking ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Send data-icon="inline-start" />
            )}
          </Button>
        </form>
        {errorMessage ? (
          <p className="max-w-full rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive [overflow-wrap:anywhere]">
            {errorMessage}
          </p>
        ) : null}
        {answer ? (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="max-w-full text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{answer.answer}</p>
            <div className="flex min-w-0 flex-col gap-2">
              {answer.citations.map((citation, index) => (
                <div
                  key={`${citation.startSec}-${citation.endSec}-${index}`}
                  className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-2 overflow-hidden rounded-lg border border-border/70 bg-background/80 p-3">
                  <div className="min-w-0 max-w-full">
                    <Badge variant="secondary" className="w-fit max-w-full rounded-full px-2 py-0.5">
                      {formatTimestamp(citation.startSec)} - {formatTimestamp(citation.endSec)}
                    </Badge>
                    {citation.text ? (
                      <p className="mt-2 max-w-full text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">{citation.text}</p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-2"
                    onClick={() => onJump(citation.startSec)}>
                    <Play data-icon="inline-start" />
                    Jump
                  </Button>
                </div>
              ))}
            </div>
            {answer.suggestedJumps.length > 0 ? (
              <div className="flex min-w-0 flex-wrap gap-2">
                {answer.suggestedJumps.map((jump, index) => (
                  <Button
                    key={`${jump.title}-${index}`}
                    variant="secondary"
                    size="sm"
                    className="h-auto max-w-full shrink gap-2 whitespace-normal text-left leading-5"
                    onClick={() => onJump(jump.startSec)}>
                    <Play data-icon="inline-start" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{jump.title}</span>
                  </Button>
                ))}
              </div>
            ) : null}
            {answer.followUps.length > 0 ? (
              <div className="flex min-w-0 flex-wrap gap-2">
                {answer.followUps.map((followUp) => (
                  <Button
                    key={followUp}
                    variant="outline"
                    size="sm"
                    className="h-auto max-w-full whitespace-normal text-left leading-5"
                    onClick={() => onFollowUp(followUp)}>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{followUp}</span>
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="max-w-full text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {disabledReason ?? "Ask a question after a transcript-backed analysis is available."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
