import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { DatabaseAvailabilityStatus } from "@/sidepanel/workspace/database-availability"
import {
  selectSidePanelTab,
  type SidePanelTab,
} from "@/sidepanel/lib/sidepanel-ux"
import { useI18n } from "@/lib/i18n/i18n-provider"

type SidePanelShellProps = {
  activeTab: SidePanelTab
  onTabChange: (tab: SidePanelTab) => void
  header: ReactNode
  databaseStatus?: DatabaseAvailabilityStatus
  onDatabaseRetry?: () => void
  systemNotice?: ReactNode
  taskBanner?: ReactNode
  overview: ReactNode
  transcript: ReactNode
  ask: ReactNode
  search: ReactNode
  settings: ReactNode
}

export function SidePanelShell({
  activeTab,
  onTabChange,
  header,
  databaseStatus,
  onDatabaseRetry,
  systemNotice,
  taskBanner,
  overview,
  transcript,
  ask,
  search,
  settings,
}: SidePanelShellProps) {
  const { t } = useI18n()
  const tabLabels: Array<{ value: SidePanelTab; label: string }> = [
    { value: "overview", label: t("side.overview") },
    { value: "transcript", label: t("side.transcript") },
    { value: "ask", label: t("side.ask") },
    { value: "search", label: t("side.search") },
    { value: "settings", label: t("side.settings") },
  ]
  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-3">
      {header}
      {systemNotice}
      {databaseStatus === "unavailable" || databaseStatus === "retrying" ? (
        <div
          role={databaseStatus === "retrying" ? "status" : "alert"}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="min-w-0 flex-1 text-sm text-foreground">
            {t("database.unavailable")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={databaseStatus === "retrying"}
            onClick={onDatabaseRetry}>
            {t(databaseStatus === "retrying" ? "database.retrying" : "database.retry")}
          </Button>
        </div>
      ) : null}
      {taskBanner}
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(selectSidePanelTab(activeTab, value))}
        className="min-w-0">
        <TabsList
          aria-label={t("side.sections")}
          className="grid h-auto w-full min-w-0 grid-cols-3 gap-1 rounded-lg p-1 min-[420px]:grid-cols-5">
          {tabLabels.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="min-h-10 min-w-0 px-2 text-xs min-[420px]:text-sm">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent forceMount value="overview" className="mt-3 data-[state=inactive]:hidden">
          {overview}
        </TabsContent>
        <TabsContent forceMount value="transcript" className="mt-3 data-[state=inactive]:hidden">
          {transcript}
        </TabsContent>
        <TabsContent forceMount value="ask" className="mt-3 data-[state=inactive]:hidden">
          {ask}
        </TabsContent>
        <TabsContent forceMount value="search" className="mt-3 data-[state=inactive]:hidden">
          {search}
        </TabsContent>
        <TabsContent forceMount value="settings" className="mt-3 data-[state=inactive]:hidden">
          {settings}
        </TabsContent>
      </Tabs>
    </div>
  )
}
