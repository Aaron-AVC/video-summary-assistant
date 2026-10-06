import { Hash, Tags } from "lucide-react"

import type { AnalysisTopic } from "@/features/analysis/lib/analysis-schema"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

type TopicsPanelProps = {
  topics: AnalysisTopic[]
  isLoading: boolean
}

export function TopicsPanel({ topics, isLoading }: TopicsPanelProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card/95 p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-primary">
        <Tags className="h-3.5 w-3.5" />
        Topics
      </div>
      {isLoading ? (
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {topics.map((topic, index) => (
            <Badge
              key={"id" in topic && topic.id ? topic.id : `topic-${index}`}
              variant="secondary"
              className="gap-1 rounded-full px-3 py-1">
              <Hash className="h-3.5 w-3.5" />
              {topic.label}
            </Badge>
          ))}
          {topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Topic chips appear after analysis.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
