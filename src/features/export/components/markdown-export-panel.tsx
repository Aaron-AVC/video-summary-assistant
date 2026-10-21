import { useState } from "react"
import { ClipboardCopy, Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  MarkdownExportAvailability,
  MarkdownExportSectionId,
  MarkdownExportSections,
} from "@/features/export/lib/markdown-export"
import { useI18n } from "@/lib/i18n/i18n-provider"

export type MarkdownExportPanelProps = {
  /** False while no authoritative runtime identity is available. */
  isAvailable: boolean
  /**
   * Per-section availability derived from the authoritative runtime
   * `contentKey`. A section from a stale source stays disabled, so a video
   * switch can never leave a stale section exportable.
   */
  availability: MarkdownExportAvailability
  sections: MarkdownExportSections
  onSectionsChange: (sections: MarkdownExportSections) => void
  onCopy: () => void | Promise<void>
  onDownload: () => void | Promise<void>
  isBusy?: boolean
}

const SECTION_IDS: MarkdownExportSectionId[] = ["analysis", "transcript", "knowledge"]

export function MarkdownExportPanel({
  isAvailable,
  availability,
  sections,
  onSectionsChange,
  onCopy,
  onDownload,
  isBusy = false,
}: MarkdownExportPanelProps) {
  const { t } = useI18n()
  const [localBusy, setLocalBusy] = useState(false)

  const selected = SECTION_IDS.filter((sectionId) => sections[sectionId])
  const exportable = SECTION_IDS.filter(
    (sectionId) => sections[sectionId] && availability[sectionId]
  )
  const hasAvailableSection = SECTION_IDS.some((sectionId) => availability[sectionId])
  const busy = isBusy || localBusy
  const disabled = !isAvailable || busy || exportable.length === 0

  const run = async (action: () => void | Promise<void>) => {
    if (busy) return
    setLocalBusy(true)
    try {
      await action()
    } finally {
      setLocalBusy(false)
    }
  }

  return (
    <Card data-export-panel="markdown">
      <CardHeader>
        <CardTitle>{t("export.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("export.description")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isAvailable ? (
          <>
            <div className="flex flex-col gap-2">
              <span id="markdown-export-sections-label" className="text-xs font-medium">
                {t("export.sectionsLabel")}
              </span>
              <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                aria-labelledby="markdown-export-sections-label"
                className="flex-wrap"
                value={selected}
                onValueChange={(values) => {
                  onSectionsChange({
                    analysis: values.includes("analysis"),
                    transcript: values.includes("transcript"),
                    knowledge: values.includes("knowledge"),
                  })
                }}
              >
                {SECTION_IDS.map((sectionId) => (
                  <ToggleGroupItem
                    key={sectionId}
                    value={sectionId}
                    disabled={!availability[sectionId]}
                    aria-label={t(`export.section.${sectionId}`)}
                  >
                    {t(`export.section.${sectionId}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {hasAvailableSection ? null : (
              <p className="text-xs text-muted-foreground">
                {t("export.noAvailableSections")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => void run(onCopy)}
              >
                <ClipboardCopy className="size-3.5" aria-hidden />
                {t("export.copy")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => void run(onDownload)}
              >
                <Download className="size-3.5" aria-hidden />
                {t("export.download")}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t("export.unavailable")}</p>
        )}
      </CardContent>
    </Card>
  )
}
