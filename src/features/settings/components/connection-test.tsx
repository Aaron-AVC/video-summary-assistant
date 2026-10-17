import { CheckCircle2, Loader2, PlugZap, ShieldAlert } from "lucide-react"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  SettingsSection,
  StatusBadge
} from "@/features/common/components/settings-ui"
import { createOpenAICompatibleClient } from "@/features/analysis/lib/openai-compatible-client"
import { requestProviderHostPermission } from "@/features/settings/lib/provider-permissions"
import { settingsStorage, type ProviderConfigRecord } from "@/features/settings/lib/settings-storage"
import { useI18n } from "@/lib/i18n/i18n-provider"

export type ProviderConnectionStatus = {
  providerId: string | null
  state: "idle" | "pending" | "success" | "error"
  title: string
  message: string
}

type ConnectionTestProps = {
  provider: ProviderConfigRecord | null
  status: ProviderConnectionStatus | null
  onStatusChange: (status: ProviderConnectionStatus) => void
}

export function ConnectionTest({
  provider,
  status,
  onStatusChange
}: ConnectionTestProps) {
  const { t } = useI18n()
  const [isTesting, setIsTesting] = useState(false)

  async function handleTestConnection() {
    if (!provider) {
      onStatusChange({
        providerId: null,
        state: "error",
        title: t("provider.select"),
        message: t("provider.defaultProviderDescription")
      })
      return
    }

    setIsTesting(true)
    onStatusChange({
      providerId: provider.id,
      state: "pending",
      title: t("provider.testing"),
      message: t("provider.sendingPing", { url: provider.baseUrl })
    })

    try {
      const granted = await requestProviderHostPermission(provider.baseUrl)
      if (!granted) throw new Error(t("provider.permissionDenied"))
      const resolved = await settingsStorage.resolveProvider(provider.id)
      const client = createOpenAICompatibleClient({
        baseUrl: resolved.profile.baseUrl,
        apiKey: resolved.apiKey,
        model: resolved.profile.model,
        generationTimeoutSec: resolved.profile.generationTimeoutSec ?? 600,
      })
      const result = await client.testConnection()

      if (result.ok) {
        onStatusChange({
          providerId: provider.id,
          state: "success",
          title: t("provider.responded"),
          message: t("provider.testSuccess", { model: result.model, url: result.baseUrl, latency: result.latencyMs })
        })
      } else {
        onStatusChange({
          providerId: provider.id,
          state: "error",
          title: t("provider.connectionFailed"),
          message: "error" in result ? result.error : t("provider.unknownModelsError")
        })
      }
    } catch (error) {
      onStatusChange({
        providerId: provider.id,
        state: "error",
        title: t("provider.connectionFailed"),
        message: error instanceof Error ? error.message : t("provider.unknownModelsError")
      })
    } finally {
      setIsTesting(false)
    }
  }

  const statusTone =
    status?.state === "success"
      ? "success"
      : status?.state === "error"
        ? "destructive"
        : "info"

  return (
    <Card className="min-w-0 overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-primary/5">
      <CardHeader className="min-w-0 gap-3 p-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
              {t("provider.connection")}
            </Badge>
            <CardTitle className="[overflow-wrap:anywhere]">{t("provider.connection")}</CardTitle>
            <CardDescription className="[overflow-wrap:anywhere]">
              {t("provider.testDescription")}
            </CardDescription>
          </div>
          <StatusBadge
            tone={statusTone}
            className="hidden rounded-lg p-3 md:inline-flex"
          >
            {status?.state === "success" ? (
              <CheckCircle2 data-icon="inline-start" />
            ) : status?.state === "error" ? (
              <ShieldAlert data-icon="inline-start" />
            ) : (
              <PlugZap data-icon="inline-start" />
            )}
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 p-4 pt-0">
        <SettingsSection className="min-w-0">
          <div className="flex min-w-0 flex-col gap-3 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
            <div className="min-w-0 space-y-1.5">
              <p className="text-sm font-medium text-foreground">
                {provider ? provider.name : t("provider.select")}
              </p>
              <p className="max-w-full text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {provider
                  ? `${provider.baseUrl} · ${provider.model}`
                  : t("provider.defaultProviderDescription")}
              </p>
            </div>
            <Button
              className="rounded-xl"
              disabled={isTesting}
              onClick={handleTestConnection}
              type="button">
              {isTesting ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <PlugZap data-icon="inline-start" />
              )}
              {t("provider.connection")}
            </Button>
          </div>
        </SettingsSection>

        {status ? (
          <Alert
            variant={status.state === "error" ? "destructive" : "default"}>
            <AlertTitle>{status.title}</AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        ) : (
          <Alert>
          <AlertTitle>{t("provider.localConnection")}</AlertTitle>
            <AlertDescription>{t("provider.probeOnly")}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
