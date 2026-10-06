import { Loader2, PlusCircle, Save, ShieldAlert, Sparkles, Star, Trash2 } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { z } from "zod"

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
  FieldError,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { type ProviderConnectionStatus } from "@/features/settings/components/connection-test"
import { SettingsSection } from "@/features/common/components/settings-ui"
import {
  classifyProviderUrlSafety,
  parseProviderConfigInput,
  type ProviderConfigInput
} from "@/features/settings/lib/provider-schema"
import {
  settingsStorage,
  type ProviderConfigRecord
} from "@/features/settings/lib/settings-storage"

type ProviderFormProps = {
  connectionStatus?: ProviderConnectionStatus | null
  onSelectedProviderChange?: (provider: ProviderConfigRecord | null) => void
  refreshToken?: number
}

type ProviderDraft = ProviderConfigInput & {
  id: string | null
  isDefault: boolean
}

type ProviderFieldErrors = Partial<Record<keyof ProviderConfigInput, string>>

const EMPTY_DRAFT: ProviderDraft = {
  id: null,
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  isDefault: false
}

function createEmptyState(defaultSelected = false): ProviderDraft {
  return {
    ...EMPTY_DRAFT,
    isDefault: defaultSelected
  }
}

export function ProviderForm({
  connectionStatus = null,
  onSelectedProviderChange,
  refreshToken = 0
}: ProviderFormProps) {
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfigRecord[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>("new")
  const [draft, setDraft] = useState<ProviderDraft>(createEmptyState(true))
  const [fieldErrors, setFieldErrors] = useState<ProviderFieldErrors>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  // Host the user has explicitly acknowledged for http-non-loopback delivery.
  // Cleared whenever baseUrl changes, so a fresh attacker URL never inherits
  // confirmation from a previous one.
  const [confirmedHttpHost, setConfirmedHttpHost] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    state: "idle" | "success" | "error"
    title: string
    message: string
  }>({
    state: "idle",
    title: "",
    message: ""
  })

  useEffect(() => {
    void hydrate()
  }, [refreshToken])

  const selectedProvider = useMemo(
    () =>
      providerConfigs.find((provider) => provider.id === selectedProviderId) ?? null,
    [providerConfigs, selectedProviderId]
  )

  useEffect(() => {
    onSelectedProviderChange?.(selectedProvider)
  }, [onSelectedProviderChange, selectedProvider])

  async function hydrate(nextSelectedProviderId?: string | null) {
    setIsLoading(true)

    const snapshot = await settingsStorage.getSettingsSnapshot()
    const nextProviders = snapshot.providerConfigs
    const resolvedSelectedProviderId =
      nextSelectedProviderId ??
      snapshot.defaultProviderId ??
      nextProviders[0]?.id ??
      null

    setProviderConfigs(nextProviders)
    setSelectedProviderId(resolvedSelectedProviderId ?? "new")
    setDraft(
      resolvedSelectedProviderId
        ? mapProviderToDraft(
            nextProviders.find((provider) => provider.id === resolvedSelectedProviderId) ??
              nextProviders[0] ??
              null
          )
        : createEmptyState(nextProviders.length === 0)
    )
    setFieldErrors({})
    setConfirmedHttpHost(null)
    setIsLoading(false)
  }

  function handleProviderSelection(value: string) {
    setFeedback({ state: "idle", title: "", message: "" })
    setFieldErrors({})
    setConfirmedHttpHost(null)
    setSelectedProviderId(value)

    if (value === "new") {
      setDraft(createEmptyState(providerConfigs.length === 0))
      return
    }

    const nextProvider = providerConfigs.find((provider) => provider.id === value)

    if (nextProvider) {
      setDraft(mapProviderToDraft(nextProvider))
    }
  }

  function updateDraft<K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value
    }))
    setFieldErrors((current) => ({
      ...current,
      [key]: undefined
    }))
    if (key === "baseUrl") {
      // Editing the base URL invalidates any prior http-host confirmation —
      // otherwise an attacker-controlled URL could inherit a green light from
      // a legitimate localhost confirmation.
      setConfirmedHttpHost(null)
    }
  }

  const urlSafety = useMemo(
    () => classifyProviderUrlSafety(draft.baseUrl),
    [draft.baseUrl]
  )
  const isUntrustedHttp = urlSafety.kind === "untrusted-http"
  const isUntrustedHttpConfirmed =
    isUntrustedHttp && confirmedHttpHost === urlSafety.host
  const blockSaveOnUntrustedHttp = isUntrustedHttp && !isUntrustedHttpConfirmed

  async function handleSave() {
    if (blockSaveOnUntrustedHttp) {
      setFeedback({
        state: "error",
        title: "Confirm http-only delivery",
        message:
          "This base URL would send your API key over plain http to a host outside the loopback allowlist. Tick the confirmation switch above to acknowledge the risk before saving."
      })
      return
    }

    setIsSaving(true)
    setFeedback({ state: "idle", title: "", message: "" })

    try {
      const parsed = parseProviderConfigInput(draft)
      const providerId = draft.id ?? globalThis.crypto.randomUUID()

      await settingsStorage.saveProviderConfig({
        id: providerId,
        name: parsed.name,
        baseUrl: parsed.baseUrl,
        apiKey: parsed.apiKey,
        model: parsed.model
      })

      if (draft.isDefault) {
        await settingsStorage.setDefaultProviderConfig(providerId)
      }

      await hydrate(providerId)
      setFeedback({
        state: "success",
        title: draft.id ? "Provider updated" : "Provider saved",
        message:
          parsed.name +
          (draft.isDefault
            ? " is ready as the default analysis provider."
            : " is available for connection tests and analysis runs.")
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        const nextFieldErrors: ProviderFieldErrors = {}

        for (const issue of error.issues) {
          const fieldName = issue.path[0]

          if (
            (fieldName === "name" ||
              fieldName === "baseUrl" ||
              fieldName === "apiKey" ||
              fieldName === "model") &&
            !nextFieldErrors[fieldName]
          ) {
            nextFieldErrors[fieldName] = issue.message
          }
        }

        setFieldErrors(nextFieldErrors)
        setFeedback({
          state: "error",
          title: "Fix the highlighted fields",
          message: "Provider details must be complete before they can be saved."
        })
      } else {
        setFeedback({
          state: "error",
          title: "Could not save provider",
          message: error instanceof Error ? error.message : "Unknown storage error."
        })
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!draft.id) {
      setDraft(createEmptyState(providerConfigs.length === 0))
      setSelectedProviderId("new")
      return
    }

    setIsDeleting(true)

    try {
      await settingsStorage.removeProviderConfig(draft.id)
      await hydrate(null)
      setFeedback({
        state: "success",
        title: "Provider removed",
        message: "The saved provider config has been deleted from local settings."
      })
    } catch (error) {
      setFeedback({
        state: "error",
        title: "Could not remove provider",
        message: error instanceof Error ? error.message : "Unknown storage error."
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Card className="border-primary/10 bg-card/95 shadow-xl shadow-primary/5">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1 rounded-full px-3 py-1">
                <Sparkles className="h-3.5 w-3.5" />
                Provider routing
              </Badge>
              {selectedProvider?.isDefault ? (
                <Badge className="gap-1 rounded-full px-3 py-1">
                  <Star className="h-3.5 w-3.5" />
                  Default
                </Badge>
              ) : null}
            </div>
            <CardTitle>Provider configuration</CardTitle>
            <CardDescription>
              Save one or more OpenAI-compatible endpoints, switch between them,
              and choose which config should be used by default.
            </CardDescription>
          </div>
          <div className="w-full max-w-xs space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Saved providers
            </span>
            <Select disabled={isLoading} onValueChange={handleProviderSelection} value={selectedProviderId}>
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="new">
                    <span className="flex items-center gap-2">
                      <PlusCircle className="h-4 w-4" />
                      New provider
                    </span>
                  </SelectItem>
                  {providerConfigs.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                      {provider.isDefault ? " · default" : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {feedback.state !== "idle" ? (
          <Alert variant={feedback.state === "error" ? "destructive" : "default"}>
            <AlertTitle>{feedback.title}</AlertTitle>
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        ) : null}

        {connectionStatus && connectionStatus.providerId === selectedProvider?.id ? (
          <Alert
            variant={connectionStatus.state === "error" ? "destructive" : "default"}>
            <AlertTitle>{connectionStatus.title}</AlertTitle>
            <AlertDescription>{connectionStatus.message}</AlertDescription>
          </Alert>
        ) : null}

        {isUntrustedHttp ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Plain http delivery to a non-loopback host</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                <code className="font-mono text-xs">{urlSafety.host}</code> is
                not on the loopback allowlist (<code className="font-mono text-xs">127.0.0.1</code>,{" "}
                <code className="font-mono text-xs">localhost</code>). Saving and
                testing this provider will send your API key over plain http
                where any network observer can read it. Prefer https or a
                local provider like Ollama / LM Studio.
              </p>
              <Field
                orientation="horizontal"
                className="rounded-lg border bg-background/80 px-4 py-3">
                <FieldContent>
                  <FieldLabel htmlFor="provider-untrusted-http-confirm">
                    I understand and want to send the API key over plain http
                  </FieldLabel>
                  <FieldDescription className="text-xs leading-5">
                    Required before this provider can be saved or tested.
                    Resets if you edit the base URL.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={isUntrustedHttpConfirmed}
                  id="provider-untrusted-http-confirm"
                  onCheckedChange={(checked) =>
                    setConfirmedHttpHost(checked ? urlSafety.host : null)
                  }
                />
              </Field>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <SettingsSection className="bg-background/70 p-5">
            <FieldGroup>
              <ProviderField
                description="A friendly label to distinguish local, hosted, or fallback models."
                error={fieldErrors.name}
                id="provider-name"
                label="Provider name"
                disabled={isLoading || isSaving}>
                <Input
                  aria-invalid={Boolean(fieldErrors.name)}
                  autoComplete="off"
                  className="h-11 rounded-xl"
                  disabled={isLoading || isSaving}
                  id="provider-name"
                  onChange={(event) => updateDraft("name", event.target.value)}
                  placeholder="Local LM Studio"
                  value={draft.name}
                />
              </ProviderField>

              <div className="grid gap-5 md:grid-cols-2">
                <ProviderField
                  description="Base URL for an OpenAI-compatible API, like /v1."
                  error={fieldErrors.baseUrl}
                  id="provider-base-url"
                  label="Base URL"
                  disabled={isLoading || isSaving}>
                  <Input
                    aria-invalid={Boolean(fieldErrors.baseUrl)}
                    autoComplete="url"
                    className="h-11 rounded-xl"
                    disabled={isLoading || isSaving}
                    id="provider-base-url"
                    onChange={(event) => updateDraft("baseUrl", event.target.value)}
                    placeholder="https://api.example.com/v1"
                    value={draft.baseUrl}
                  />
                </ProviderField>
                <ProviderField
                  description="Model name used for transcript analysis and repair requests."
                  error={fieldErrors.model}
                  id="provider-model"
                  label="Model"
                  disabled={isLoading || isSaving}>
                  <Input
                    aria-invalid={Boolean(fieldErrors.model)}
                    autoComplete="off"
                    className="h-11 rounded-xl"
                    disabled={isLoading || isSaving}
                    id="provider-model"
                    onChange={(event) => updateDraft("model", event.target.value)}
                    placeholder="gpt-4.1-mini"
                    value={draft.model}
                  />
                </ProviderField>
              </div>

              <ProviderField
                description="Stored locally only. Keep this secret scoped to your provider."
                error={fieldErrors.apiKey}
                id="provider-api-key"
                label="API key"
                disabled={isLoading || isSaving}>
                <Input
                  aria-invalid={Boolean(fieldErrors.apiKey)}
                  autoComplete="off"
                  className="h-11 rounded-xl"
                  disabled={isLoading || isSaving}
                  id="provider-api-key"
                  onChange={(event) => updateDraft("apiKey", event.target.value)}
                  placeholder="sk-..."
                  type="password"
                  value={draft.apiKey}
                />
              </ProviderField>
            </FieldGroup>
          </SettingsSection>

          <SettingsSection className="space-y-4 bg-muted/40 p-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Default provider</p>
              <p className="text-sm leading-6 text-muted-foreground">
                Make this config the primary choice for analysis requests across
                the extension.
              </p>
            </div>
            <Field
              data-disabled={isLoading || isSaving}
              orientation="horizontal"
              className="rounded-lg border bg-background/80 px-4 py-3">
              <FieldContent>
                <FieldLabel htmlFor="provider-default">
                  Use as default provider
                </FieldLabel>
                <FieldDescription className="text-xs leading-5">
                  One provider can stay preselected for faster analysis runs.
                </FieldDescription>
              </FieldContent>
              <Switch
                checked={draft.isDefault}
                disabled={isLoading || isSaving}
                id="provider-default"
                onCheckedChange={(checked) => updateDraft("isDefault", checked)}
              />
            </Field>

            <div className="rounded-2xl border border-dashed border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
                Selection status
              </p>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>
                  {selectedProvider
                    ? `${selectedProvider.name} is loaded for editing and testing.`
                    : "Create a provider to unlock connection tests and saved defaults."}
                </p>
                <p>
                  {providerConfigs.length > 0
                    ? `${providerConfigs.length} provider${providerConfigs.length === 1 ? "" : "s"} stored locally.`
                    : "No provider configs saved yet."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                className="flex-1 rounded-xl"
                disabled={isLoading || isSaving || blockSaveOnUntrustedHttp}
                onClick={handleSave}>
                {isSaving ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                {draft.id ? "Save changes" : "Save provider"}
              </Button>
              <Button
                className="rounded-xl"
                disabled={isLoading || isSaving}
                onClick={() => handleProviderSelection("new")}
                type="button"
                variant="outline">
                <PlusCircle data-icon="inline-start" />
                New
              </Button>
              <Button
                className="rounded-xl"
                disabled={isLoading || isSaving || isDeleting || !draft.id}
                onClick={handleDelete}
                type="button"
                variant="ghost">
                {isDeleting ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Trash2 data-icon="inline-start" />
                )}
                Remove
              </Button>
            </div>
          </SettingsSection>
        </div>
      </CardContent>
    </Card>
  )
}

function ProviderField({
  children,
  description,
  disabled,
  error,
  id,
  label
}: {
  children: ReactNode
  disabled?: boolean
  description: string
  error?: string
  id: string
  label: string
}) {
  const isInvalid = Boolean(error)

  return (
    <Field data-disabled={disabled} data-invalid={isInvalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <FieldDescription>{description}</FieldDescription>
      )}
    </Field>
  )
}

function mapProviderToDraft(provider: ProviderConfigRecord | null): ProviderDraft {
  if (!provider) {
    return createEmptyState(true)
  }

  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    isDefault: provider.isDefault
  }
}
