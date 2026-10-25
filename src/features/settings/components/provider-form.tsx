import { Loader2, PlusCircle, Save, Sparkles, Star, Trash2 } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import * as z from "zod"

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
  DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC,
  parseProviderModelDiscoveryInput,
  parseProviderProfileInput,
  type ProviderProfileInput
} from "@/features/settings/lib/provider-schema"
import { fetchProviderModels } from "@/features/analysis/lib/openai-compatible-client"
import { requestProviderHostPermission } from "@/features/settings/lib/provider-permissions"
import {
  settingsStorage,
  type ProviderConfigRecord
} from "@/features/settings/lib/settings-storage"
import { useI18n } from "@/lib/i18n/i18n-provider"

type ProviderFormProps = {
  connectionStatus?: ProviderConnectionStatus | null
  onSelectedProviderChange?: (provider: ProviderConfigRecord | null) => void
  onProvidersChange?: (providers: ProviderConfigRecord[]) => void
  refreshToken?: number
}

export type ProviderDraft = ProviderProfileInput & {
  id: string | null
  apiKey: string
  isDefault: boolean
  hasApiKey: boolean
  modelOptions: string[]
}

type ProviderFieldErrors = Partial<Record<keyof ProviderProfileInput | "apiKey", string>>

const EMPTY_DRAFT: ProviderDraft = {
  id: null,
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  generationTimeoutSec: DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC,
  isDefault: false,
  hasApiKey: false,
  modelOptions: []
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
  onProvidersChange,
  refreshToken = 0
}: ProviderFormProps) {
  const { t } = useI18n()
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfigRecord[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>("new")
  const [draft, setDraft] = useState<ProviderDraft>(createEmptyState(true))
  const [fieldErrors, setFieldErrors] = useState<ProviderFieldErrors>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [modelSearch, setModelSearch] = useState("")
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
    setIsLoading(false)
    onProvidersChange?.(nextProviders)
  }

  function handleProviderSelection(value: string) {
    setFeedback({ state: "idle", title: "", message: "" })
    setFieldErrors({})
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
  }

  async function handleSave() {
    setIsSaving(true)
    setFeedback({ state: "idle", title: "", message: "" })

    try {
      const parsed = parseProviderProfileInput(draft)
      const providerId = draft.id ?? globalThis.crypto.randomUUID()
      if (!draft.id && !draft.apiKey.trim()) {
        setFieldErrors({ apiKey: t("provider.requiredApiKey") })
        throw new Error(t("provider.requiredApiKey"))
      }

      const permissionGranted = await requestProviderHostPermission(parsed.baseUrl)
      if (!permissionGranted) throw new Error(t("provider.permissionDenied"))

      await settingsStorage.saveProviderProfile({
        id: providerId,
        name: parsed.name,
        baseUrl: parsed.baseUrl,
        model: parsed.model,
        generationTimeoutSec: parsed.generationTimeoutSec,
      }, draft.apiKey.trim() || undefined)

      if (draft.isDefault) {
        await settingsStorage.setDefaultProviderConfig(providerId)
      }

      await hydrate(providerId)
      setFeedback({
        state: "success",
        title: draft.id ? t("provider.updated") : t("provider.savedTitle"),
        message: t(draft.isDefault ? "provider.successDefault" : "provider.successAvailable", { name: parsed.name })
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        const nextFieldErrors: ProviderFieldErrors = {}

        for (const issue of error.issues) {
          const fieldName = issue.path[0]

          if (
            (fieldName === "name" || fieldName === "baseUrl" || fieldName === "apiKey" || fieldName === "model" || fieldName === "generationTimeoutSec") &&
            !nextFieldErrors[fieldName]
          ) {
            nextFieldErrors[fieldName] = t(`provider.fieldError.${fieldName}` as
              | "provider.fieldError.name"
              | "provider.fieldError.baseUrl"
              | "provider.fieldError.apiKey"
              | "provider.fieldError.model"
              | "provider.fieldError.generationTimeoutSec")
          }
        }

        setFieldErrors(nextFieldErrors)
        setFeedback({
          state: "error",
          title: t("provider.fixFields"),
          message: t("provider.incomplete")
        })
      } else {
        setFeedback({
          state: "error",
          title: t("provider.saveFailed"),
          message: error instanceof Error ? error.message : t("provider.unknownStorageError")
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
        title: t("provider.removed"),
        message: t("provider.deleteSuccess")
      })
    } catch (error) {
      setFeedback({
        state: "error",
        title: t("provider.removeFailed"),
        message: error instanceof Error ? error.message : t("provider.unknownStorageError")
      })
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleFetchModels() {
    setIsFetchingModels(true)
    setFeedback({ state: "idle", title: "", message: "" })
    try {
      const providerId = draft.id
      const apiKey = draft.apiKey.trim() || (providerId
        ? (await settingsStorage.resolveProvider(providerId)).apiKey
        : "")
      const parsed = parseProviderModelDiscoveryInput({
        baseUrl: draft.baseUrl,
        apiKey,
      })
      const permissionGranted = await requestProviderHostPermission(parsed.baseUrl)
      if (!permissionGranted) throw new Error(t("provider.permissionDenied"))
      const result = await fetchProviderModels({
        baseUrl: parsed.baseUrl,
        apiKey,
      })
      setDraft((current) => ({ ...current, modelOptions: result.models }))
      if (result.error) {
        setFeedback({ state: "error", title: t("provider.modelsUnavailable"), message: result.error })
      } else {
        setFeedback({ state: "success", title: t("provider.modelsLoaded"), message: t("provider.modelsFound", { count: result.models.length }) })
      }
    } catch (error) {
      setFeedback({ state: "error", title: t("provider.fetchModelsFailed"), message: error instanceof Error ? error.message : t("provider.unknownModelsError") })
    } finally {
      setIsFetchingModels(false)
    }
  }

  return (
    <Card className="min-w-0 overflow-hidden border-primary/10 bg-card/95 shadow-xl shadow-primary/5">
      <CardHeader className="min-w-0 gap-4 p-4">
        <div className="flex min-w-0 flex-col gap-3 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1 rounded-full px-3 py-1">
                <Sparkles className="h-3.5 w-3.5" />
                {t("provider.routing")}
              </Badge>
              {selectedProvider?.isDefault ? (
                <Badge className="gap-1 rounded-full px-3 py-1">
                  <Star className="h-3.5 w-3.5" />
                  {t("provider.default")}
                </Badge>
              ) : null}
            </div>
            <CardTitle className="[overflow-wrap:anywhere]">{t("provider.configuration")}</CardTitle>
            <CardDescription className="[overflow-wrap:anywhere]">
              {t("provider.description")}
            </CardDescription>
          </div>
          <div className="w-full min-w-0 max-w-xs space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {t("provider.saved")}
            </span>
            <Select disabled={isLoading} onValueChange={handleProviderSelection} value={selectedProviderId}>
              <SelectTrigger className="h-11 min-w-0 rounded-xl">
                <SelectValue placeholder={t("provider.select")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="new">
                    <span className="flex items-center gap-2">
                      <PlusCircle className="h-4 w-4" />
                      {t("provider.new")}
                    </span>
                  </SelectItem>
                  {providerConfigs.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                      {provider.isDefault ? t("provider.defaultSuffix") : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-6 p-4 pt-0">
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

        <div className="grid min-w-0 gap-4 min-[760px]:grid-cols-[1.35fr_0.65fr]">
          <SettingsSection className="min-w-0 bg-background/70 p-4">
            <FieldGroup>
              <ProviderField
                description={t("provider.nameDescription")}
                error={fieldErrors.name}
                id="provider-name"
                label={t("provider.name")}
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

              <div className="grid min-w-0 gap-5 min-[620px]:grid-cols-2">
                <ProviderField
                  description={t("provider.baseUrlDescription")}
                  error={fieldErrors.baseUrl}
                  id="provider-base-url"
                  label={t("provider.baseUrl")}
                  disabled={isLoading || isSaving}>
                  <Input
                    aria-invalid={Boolean(fieldErrors.baseUrl)}
                    autoComplete="url"
                    className="h-11 min-w-0 rounded-xl"
                    disabled={isLoading || isSaving}
                    id="provider-base-url"
                    onChange={(event) => updateDraft("baseUrl", event.target.value)}
                    placeholder="https://api.example.com/v1"
                    value={draft.baseUrl}
                  />
                </ProviderField>
                <ProviderField
                  description={t("provider.modelDescription")}
                  error={fieldErrors.model}
                  id="provider-model"
                  label={t("provider.model")}
                  disabled={isLoading || isSaving}>
                  <Input
                    aria-invalid={Boolean(fieldErrors.model)}
                    autoComplete="off"
                    className="h-11 min-w-0 rounded-xl"
                    disabled={isLoading || isSaving}
                    id="provider-model"
                    onChange={(event) => updateDraft("model", event.target.value)}
                    placeholder="gpt-4.1-mini"
                    value={draft.model}
                  />
                </ProviderField>
              </div>

              <ProviderField
                description={draft.hasApiKey ? t("provider.keepKey") : t("provider.newKey")}
                error={fieldErrors.apiKey}
                id="provider-api-key"
                label={t("provider.apiKey")}
                disabled={isLoading || isSaving}>
                <Input
                  aria-invalid={Boolean(fieldErrors.apiKey)}
                  autoComplete="off"
                  className="h-11 min-w-0 rounded-xl"
                  disabled={isLoading || isSaving}
                  id="provider-api-key"
                  onChange={(event) => updateDraft("apiKey", event.target.value)}
                  placeholder={draft.hasApiKey ? t("provider.savedKey") : "sk-..."}
                  type="password"
                  value={draft.apiKey}
                />
              </ProviderField>
              <ProviderField
                description={t("provider.timeoutDescription")}
                error={fieldErrors.generationTimeoutSec}
                id="provider-generation-timeout"
                label={t("provider.timeout")}
                disabled={isLoading || isSaving}>
                <Select
                  disabled={isLoading || isSaving}
                  onValueChange={(value) => updateDraft("generationTimeoutSec", Number(value))}
                  value={String(draft.generationTimeoutSec ?? DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC)}>
                  <SelectTrigger className="h-11 min-w-0 rounded-xl" id="provider-generation-timeout">
                    <SelectValue placeholder={t("provider.selectTimeout")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="180">{t("provider.minutes", { count: 3 })}</SelectItem>
                    <SelectItem value="300">{t("provider.minutes", { count: 5 })}</SelectItem>
                    <SelectItem value="600">{t("provider.minutes", { count: 10 })}</SelectItem>
                    <SelectItem value="1200">{t("provider.minutes", { count: 20 })}</SelectItem>
                    <SelectItem value="1800">{t("provider.minutes", { count: 30 })}</SelectItem>
                  </SelectContent>
                </Select>
              </ProviderField>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  className="rounded-xl"
                  disabled={isLoading || isSaving || isFetchingModels}
                  onClick={handleFetchModels}
                  type="button"
                  variant="outline">
                  {isFetchingModels ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                  {t("provider.fetchModels")}
                </Button>
                {draft.modelOptions.length > 0 ? (
                  <Input
                    aria-label={t("provider.searchModels")}
                    className="h-10 min-w-0 max-w-xs rounded-xl"
                    onChange={(event) => setModelSearch(event.target.value)}
                    placeholder={t("provider.searchModels")}
                    value={modelSearch}
                  />
                ) : null}
              </div>
              {draft.modelOptions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {draft.modelOptions
                    .filter((model) => model.toLowerCase().includes(modelSearch.trim().toLowerCase()))
                    .map((model) => (
                      <Button
                        key={model}
                        className="h-auto max-w-full min-w-0 whitespace-normal text-left [overflow-wrap:anywhere]"
                        onClick={() => updateDraft("model", model)}
                        type="button"
                        variant="secondary">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{model}</span>
                      </Button>
                    ))}
                </div>
              ) : null}
            </FieldGroup>
          </SettingsSection>

          <SettingsSection className="min-w-0 space-y-4 bg-muted/40 p-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t("provider.defaultProvider")}</p>
              <p className="text-sm leading-6 text-muted-foreground">
                {t("provider.defaultProviderDescription")}
              </p>
            </div>
            <Field
              data-disabled={isLoading || isSaving}
              orientation="horizontal"
              className="rounded-lg border bg-background/80 px-4 py-3">
              <FieldContent>
                <FieldLabel htmlFor="provider-default">
                  {t("provider.useAsDefault")}
                </FieldLabel>
                <FieldDescription className="text-xs leading-5">
                  {t("provider.oneDefault")}
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
                {t("provider.selectionStatus")}
              </p>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>
                  {selectedProvider
                    ? t("provider.editingStatus", { name: selectedProvider.name })
                    : t("provider.createToUnlock")}
                </p>
                <p>
                  {providerConfigs.length > 0
                    ? t("provider.storedCount", { count: providerConfigs.length })
                    : t("provider.noneSaved")}
                </p>
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap gap-3">
              <Button
                className="flex-1 rounded-xl"
                disabled={isLoading || isSaving}
                onClick={handleSave}>
                {isSaving ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                {draft.id ? t("provider.update") : t("provider.save")}
              </Button>
              <Button
                className="rounded-xl"
                disabled={isLoading || isSaving}
                onClick={() => handleProviderSelection("new")}
                type="button"
                variant="outline">
                <PlusCircle data-icon="inline-start" />
                {t("provider.new")}
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
                {t("provider.delete")}
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

export function mapProviderToDraft(provider: ProviderConfigRecord | null): ProviderDraft {
  if (!provider) {
    return createEmptyState(true)
  }

  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: "",
    model: provider.model,
    generationTimeoutSec: provider.generationTimeoutSec ?? DEFAULT_PROVIDER_GENERATION_TIMEOUT_SEC,
    isDefault: provider.isDefault,
    hasApiKey: provider.hasApiKey,
    modelOptions: []
  }
}
