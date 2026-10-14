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
  const [isTesting, setIsTesting] = useState(false)

  async function handleTestConnection() {
    if (!provider) {
      onStatusChange({
        providerId: null,
        state: "error",
        title: "Select a provider first",
        message:
          "Save or select a provider configuration before running a connection probe."
      })
      return
    }

    setIsTesting(true)
    onStatusChange({
      providerId: provider.id,
      state: "pending",
      title: "Testing provider connection",
      message: `Sending a lightweight ping to ${provider.baseUrl}.`
    })

    try {
      const granted = await requestProviderHostPermission(provider.baseUrl)
      if (!granted) throw new Error("Provider host permission was not granted.")
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
          title: "Provider responded successfully",
          message: `${result.model} replied from ${result.baseUrl} in ${result.latencyMs}ms.`
        })
      } else {
        onStatusChange({
          providerId: provider.id,
          state: "error",
          title: "Provider connection failed",
          message: "error" in result ? result.error : "Unknown provider error."
        })
      }
    } catch (error) {
      onStatusChange({
        providerId: provider.id,
        state: "error",
        title: "Provider connection failed",
        message: error instanceof Error ? error.message : "Unknown provider error."
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
              Connection test
            </Badge>
            <CardTitle className="[overflow-wrap:anywhere]">Validate provider connectivity</CardTitle>
            <CardDescription className="[overflow-wrap:anywhere]">
              Run a lightweight request against the selected provider before you
              trust it for transcript analysis.
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
                {provider ? provider.name : "No provider selected"}
              </p>
              <p className="max-w-full text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {provider
                  ? `${provider.baseUrl} · ${provider.model}`
                  : "Choose a saved provider from the form above to enable testing."}
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
              Test connection
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
            <AlertTitle>Connection checks stay local to your browser</AlertTitle>
            <AlertDescription>
              The probe only validates the configured provider, model, and API key
              path. It does not start a full transcript analysis run.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
