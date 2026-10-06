import { CheckCircle2, Loader2, PlugZap, ShieldAlert } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

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
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import {
  SettingsSection,
  StatusBadge
} from "@/features/common/components/settings-ui"
import { createOpenAICompatibleClient } from "@/features/analysis/lib/openai-compatible-client"
import { classifyProviderUrlSafety } from "@/features/settings/lib/provider-schema"
import type { ProviderConfigRecord } from "@/features/settings/lib/settings-storage"

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
  // Host the user has explicitly confirmed for plain-http delivery.
  // Stored per host so changing the saved provider revokes the green light.
  const [confirmedHttpHost, setConfirmedHttpHost] = useState<string | null>(null)

  const urlSafety = useMemo(
    () => (provider ? classifyProviderUrlSafety(provider.baseUrl) : null),
    [provider]
  )
  const isUntrustedHttp = urlSafety?.kind === "untrusted-http"
  const untrustedHttpHost = urlSafety?.kind === "untrusted-http" ? urlSafety.host : null
  const isUntrustedHttpConfirmed =
    isUntrustedHttp && untrustedHttpHost === confirmedHttpHost

  // Whenever the user switches to a different provider, drop any prior
  // confirmation so a green light never carries across distinct hosts.
  useEffect(() => {
    setConfirmedHttpHost(null)
  }, [provider?.id])

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

    if (isUntrustedHttp && !isUntrustedHttpConfirmed) {
      onStatusChange({
        providerId: provider.id,
        state: "error",
        title: "Confirm plain-http delivery",
        message: `${provider.baseUrl} is http and outside the loopback allowlist. Toggle the confirmation switch to acknowledge sending your API key in clear text before testing.`
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
      const client = createOpenAICompatibleClient(provider)
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
    <Card className="border-border/70 bg-card/95 shadow-lg shadow-primary/5">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1.5">
            <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
              Connection test
            </Badge>
            <CardTitle>Validate provider connectivity</CardTitle>
            <CardDescription>
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
      <CardContent className="space-y-4">
        <SettingsSection>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">
                {provider ? provider.name : "No provider selected"}
              </p>
              <p className="text-sm text-muted-foreground">
                {provider
                  ? `${provider.baseUrl} · ${provider.model}`
                  : "Choose a saved provider from the form above to enable testing."}
              </p>
            </div>
            <Button
              className="rounded-xl"
              disabled={isTesting || (isUntrustedHttp && !isUntrustedHttpConfirmed)}
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

        {isUntrustedHttp && untrustedHttpHost ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Plain http delivery to a non-loopback host</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                <code className="font-mono text-xs">{untrustedHttpHost}</code>{" "}
                is not on the loopback allowlist. Testing this provider sends
                the saved API key over clear text.
              </p>
              <Field
                orientation="horizontal"
                className="rounded-lg border bg-background/80 px-4 py-3">
                <FieldContent>
                  <FieldLabel htmlFor="connection-test-untrusted-http-confirm">
                    I understand and want to send the API key over plain http
                  </FieldLabel>
                  <FieldDescription className="text-xs leading-5">
                    Required before this provider can be tested. Resets when
                    you switch to a different saved provider.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={isUntrustedHttpConfirmed}
                  id="connection-test-untrusted-http-confirm"
                  onCheckedChange={(checked) =>
                    setConfirmedHttpHost(checked ? untrustedHttpHost : null)
                  }
                />
              </Field>
            </AlertDescription>
          </Alert>
        ) : null}

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
