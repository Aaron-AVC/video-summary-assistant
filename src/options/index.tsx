import "@/styles/globals.css"

import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from "@/components/ui/input-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConnectionTest, type ProviderConnectionStatus } from "@/features/settings/components/connection-test"
import { DataManagement } from "@/features/settings/components/data-management"
import { DiagnosticLog } from "@/features/settings/components/diagnostic-log"
import { HistoryPanel } from "@/features/history/components/history-panel"
import { ProviderForm } from "@/features/settings/components/provider-form"
import { ThemeSettings } from "@/features/settings/components/theme-settings"
import type { ProviderConfigRecord } from "@/features/settings/lib/settings-storage"
import { I18nProvider, useI18n } from "@/lib/i18n/i18n-provider"
import { ExtensionProviders } from "@/lib/providers/extension-providers"
import { Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

const SETTINGS_TABS = [
  {
    value: "provider",
    keywords: ["provider", "model", "api", "key", "connection", "test", "default"],
    keywordKeys: ["options.keyword.provider", "options.keyword.model", "options.keyword.api"]
  },
  {
    value: "appearance",
    keywords: ["appearance", "theme", "light", "dark", "system", "language"],
    keywordKeys: ["options.keyword.appearance", "options.keyword.theme", "options.keyword.language", "options.keyword.lightDarkSystem"]
  },
  {
    value: "history",
    keywords: ["history", "search", "videos", "analyses", "saved", "recent", "log"],
    keywordKeys: ["options.keyword.history", "options.keyword.searchVideosAnalysesSavedRecentLog"]
  },
  {
    value: "data",
    keywords: ["data", "export", "clear", "local", "reset"],
    keywordKeys: ["options.keyword.data", "options.keyword.exportClearLocalReset"]
  },
  {
    value: "advanced",
    keywords: ["advanced", "diagnostics", "logs", "debug", "transcript log"],
    keywordKeys: ["options.keyword.diagnostics", "options.keyword.advancedLogsDebugTranscript"]
  }
] as const

type SettingsTab = (typeof SETTINGS_TABS)[number]["value"]

function OptionsPageContent() {
  const { t } = useI18n()
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfigRecord | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ProviderConnectionStatus | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (typeof window === "undefined") return "provider"
    const hash = window.location.hash.replace(/^#/, "")
    return SETTINGS_TABS.some((tab) => tab.value === hash) ? (hash as SettingsTab) : "provider"
  })
  const [searchQuery, setSearchQuery] = useState("")
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const settingsTabs = useMemo(() => SETTINGS_TABS.map((tab) => ({
    ...tab,
    label: t(`options.tab.${tab.value}` as Parameters<typeof t>[0]),
    localizedKeywords: [
      ...tab.keywords,
      ...tab.keywordKeys.flatMap((key) => t(key).split(/[\s、,]+/)),
    ],
  })), [t])
  const matchingTabs = useMemo(
    () =>
      normalizedQuery
        ? settingsTabs.filter((tab) =>
            [tab.label, ...tab.localizedKeywords].some((keyword) =>
              keyword.toLowerCase().includes(normalizedQuery)
            )
          )
        : settingsTabs,
    [normalizedQuery, settingsTabs]
  )

  useEffect(() => {
    if (matchingTabs.length > 0 && !matchingTabs.some((tab) => tab.value === activeTab)) {
      setActiveTab(matchingTabs[0].value)
    }
  }, [activeTab, matchingTabs])

  return (
    <ExtensionProviders surface="options">
      <main className="min-h-screen overflow-x-hidden bg-background px-4 py-5 text-foreground md:px-6">
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4">
          <section className="rounded-lg border border-border/70 bg-card/95 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-col gap-2">
                <Badge variant="secondary" className="w-fit rounded-full px-3 py-1 text-xs uppercase">
                  {t("options.settings")}
                </Badge>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                  {t("options.configure")}
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  {t("options.description")}
                </p>
              </div>
              <div className="w-full lg:max-w-sm">
                <InputGroup>
                  <InputGroupAddon>
                    <Search data-icon="inline-start" />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder={t("options.searchSettings")}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    aria-label={t("options.searchSettings")}
                  />
                </InputGroup>
              </div>
            </div>
          </section>

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-lg p-1">
              {matchingTabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="min-h-10">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {matchingTabs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-card/70 p-6 text-sm text-muted-foreground">
                {t("options.noMatch", { query: searchQuery })}
              </div>
            ) : null}

            {matchingTabs.length > 0 ? (
              <>
                <TabsContent value="provider" className="mt-4 flex flex-col gap-4">
                  <ProviderForm
                    connectionStatus={connectionStatus}
                    onSelectedProviderChange={setSelectedProvider}
                    refreshToken={refreshToken}
                  />
                  <ConnectionTest
                    onStatusChange={setConnectionStatus}
                    provider={selectedProvider}
                    status={connectionStatus}
                  />
                </TabsContent>

                <TabsContent value="appearance" className="mt-4">
                  <ThemeSettings />
                </TabsContent>

                <TabsContent value="history" className="mt-4">
                  <HistoryPanel />
                </TabsContent>

                <TabsContent value="data" className="mt-4">
                  <DataManagement
                    onDataCleared={() => {
                      setSelectedProvider(null)
                      setConnectionStatus(null)
                      setRefreshToken((value) => value + 1)
                    }}
                  />
                </TabsContent>

                <TabsContent value="advanced" className="mt-4">
                  <DiagnosticLog />
                </TabsContent>
              </>
            ) : null}
          </Tabs>
        </div>
      </main>
    </ExtensionProviders>
  )
}

export default function OptionsPage() {
  return (
    <I18nProvider>
      <OptionsPageContent />
    </I18nProvider>
  )
}
