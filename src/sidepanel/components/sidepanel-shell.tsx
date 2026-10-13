import type { ReactNode } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  selectSidePanelTab,
  type SidePanelTab,
} from "@/sidepanel/lib/sidepanel-ux"

type SidePanelShellProps = {
  activeTab: SidePanelTab
  onTabChange: (tab: SidePanelTab) => void
  header: ReactNode
  taskBanner?: ReactNode
  overview: ReactNode
  transcript: ReactNode
  ask: ReactNode
  settings: ReactNode
}

const TAB_LABELS: Array<{ value: SidePanelTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "transcript", label: "Transcript" },
  { value: "ask", label: "Ask" },
  { value: "settings", label: "Settings" },
]

export function SidePanelShell({
  activeTab,
  onTabChange,
  header,
  taskBanner,
  overview,
  transcript,
  ask,
  settings,
}: SidePanelShellProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-3">
      {header}
      {taskBanner}
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(selectSidePanelTab(activeTab, value))}
        className="min-w-0">
        <TabsList
          aria-label="Side Panel sections"
          className="grid h-auto w-full min-w-0 grid-cols-2 gap-1 rounded-lg p-1 min-[420px]:grid-cols-4">
          {TAB_LABELS.map((tab) => (
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
        <TabsContent forceMount value="settings" className="mt-3 data-[state=inactive]:hidden">
          {settings}
        </TabsContent>
      </Tabs>
    </div>
  )
}
