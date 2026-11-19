import { AlertTriangle, Loader2, RotateCcw, Sparkles } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { FinalResumeView } from "@/sidepanel/analysis/final-resume-availability"
import { translate } from "@/lib/i18n/i18n"
import type { TranslationKey } from "@/lib/i18n/en"
import { useI18n } from "@/lib/i18n/i18n-provider"

/** Optional locale injection so component tests can pin a language explicitly. */
export type FinalResumeTranslate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string

/** Renders panel copy for a pinned locale; used by component tests. */
export function createFinalResumeTranslate(locale: "en" | "zh-CN"): FinalResumeTranslate {
  return (key, params) => translate(locale, key, params)
}

type FinalResumePanelProps = {
  view: FinalResumeView
  /** The status carried by the original Final failure, shown as a sanitized HTTP code. */
  errorMessage: string | null
  videoTitle: string | null
  onResume: () => void
  onRegenerate: () => void
  onCancel: () => void
  /** Test-only override; production always reads the active i18n locale. */
  translate?: FinalResumeTranslate
}

/**
 * The manual Final-only resume entry.
 *
 * It is deliberately separate from Generate/Regenerate: resuming reuses the
 * retained chunk summaries and costs one final request, while regenerating
 * discards the checkpoint and repeats the whole run. When the checkpoint is no
 * longer usable the panel only offers a fresh regeneration.
 */
export function FinalResumePanel({
  view,
  errorMessage,
  videoTitle,
  onResume,
  onRegenerate,
  onCancel,
  translate,
}: FinalResumePanelProps) {
  const i18n = useI18n()
  const t: FinalResumeTranslate = translate ?? i18n.t
  const isResuming = view.phaseLabel === "resuming"
  const isSaving = view.phaseLabel === "saving"
  const busy = isResuming || isSaving

  if (view.visible) {
    return (
      <Card
        className="border-amber-500/40 bg-amber-500/10"
        data-testid="final-resume-panel"
        data-resume-phase={view.phaseLabel}>
        <CardContent className="flex flex-col gap-3 p-3">
          <div className="flex min-w-0 items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1 text-xs">
              <div className="font-medium [overflow-wrap:anywhere]">
                {t("finalResume.title")}
                {view.status?.status ? ` · HTTP ${view.status.status}` : ""}
              </div>
              <div className="text-muted-foreground [overflow-wrap:anywhere]">
                {isSaving
                  ? t("finalResume.saving")
                  : isResuming
                    ? t("finalResume.resuming")
                    : t("finalResume.description")}
              </div>
              {!busy ? (
                <>
                  <div className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">
                    {t("finalResume.cost")}
                  </div>
                  <div className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">
                    {t("finalResume.remaining", { minutes: view.remainingMinutes })}
                  </div>
                </>
              ) : null}
              {errorMessage ? (
                <div className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">{errorMessage}</div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isSaving ? (
              <Button variant="secondary" className="min-w-0 flex-1 gap-2" disabled>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                {t("finalResume.saving")}
              </Button>
            ) : isResuming ? (
              <>
                <Button variant="secondary" className="min-w-0 flex-1 gap-2" disabled>
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                  {t("finalResume.resuming")}
                </Button>
                <Button variant="destructive" className="gap-2" onClick={onCancel}>
                  {t("common.cancel")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  className="min-w-0 flex-1 gap-2"
                  disabled={!view.canStart}
                  onClick={onResume}
                  data-testid="final-resume-continue">
                  <Sparkles data-icon="inline-start" />
                  {t("finalResume.cta")}
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={onRegenerate}
                  data-testid="final-resume-regenerate">
                  <RotateCcw data-icon="inline-start" />
                  {t("finalResume.regenerate")}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // A checkpoint that can no longer be resumed must still offer a fresh run and
  // explain why the cheaper continuation is gone.
  const reasonKey = view.reason === "expired"
    ? "finalResume.expired"
    : view.reason === "conflict"
      ? "finalResume.conflict"
      : view.reason === "tab-changed"
        || view.reason === "content-key-changed"
        || view.reason === "part-changed"
        || view.reason === "title-changed"
        || view.reason === "duration-changed"
        || view.reason === "transcript-changed"
        || view.reason === "provider-changed"
        || view.reason === "preset-changed"
        ? "finalResume.identityChanged"
        : "finalResume.invalidated"

  if (!errorMessage && view.reason === "no-checkpoint") return null

  return (
    <Card
      className="border-border/70 bg-card/95"
      data-testid="final-resume-unavailable"
      data-resume-reason={view.reason ?? "unknown"}>
      <CardContent className="flex flex-col gap-3 p-3">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {t("finalResume.title")}
            {view.status?.status ? ` · HTTP ${view.status.status}` : ""}
          </AlertTitle>
          <AlertDescription className="[overflow-wrap:anywhere]">
            {errorMessage ?? t(reasonKey)}
          </AlertDescription>
        </Alert>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{t(reasonKey)}</p>
        <Button
          variant="outline"
          className="gap-2"
          onClick={onRegenerate}
          data-testid="final-resume-regenerate-unavailable">
          <RotateCcw data-icon="inline-start" />
          {videoTitle ? t("finalResume.regenerate") : t("overview.generate")}
        </Button>
      </CardContent>
    </Card>
  )
}
