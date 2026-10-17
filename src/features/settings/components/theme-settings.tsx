import { LaptopMinimal, MoonStar, SunMedium } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useI18n } from "@/lib/i18n/i18n-provider"
import { useTheme } from "@/lib/theme/theme-provider"

const THEME_OPTIONS = [
  {
    value: "light",
    labelKey: "appearance.light",
    icon: SunMedium
  },
  {
    value: "dark",
    labelKey: "appearance.dark",
    icon: MoonStar
  },
  {
    value: "system",
    labelKey: "appearance.system",
    icon: LaptopMinimal
  }
] as const

export function ThemeSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { t, preference, setPreference } = useI18n()

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-2">
          <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
            {t("appearance.themeMode")}
          </Badge>
          <CardTitle className="text-base">{t("appearance.title")}</CardTitle>
          <CardDescription>{t("appearance.description")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-4 pt-0">
        <div className="rounded-lg border border-border/70 bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
          {t("appearance.currentMode", { mode: t(`appearance.${resolvedTheme}` as "appearance.light" | "appearance.dark" | "appearance.system") })}
        </div>

        <ToggleGroup
          className="grid w-full gap-2 md:grid-cols-3"
          onValueChange={(value) => {
            if (value === "light" || value === "dark" || value === "system") {
              setTheme(value)
            }
          }}
          type="single"
          value={theme}
          variant="outline">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon

            return (
              <ToggleGroupItem
                key={option.value}
                className="h-12 gap-2 rounded-lg border border-border/70 bg-background/80 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10"
                value={option.value}>
                <Icon className="h-4 w-4" />
                {t(option.labelKey)}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t("appearance.language")}</p>
          <p className="text-sm leading-6 text-muted-foreground">{t("appearance.languageDescription")}</p>
          <ToggleGroup
            className="grid w-full gap-2 md:grid-cols-3"
            onValueChange={(value) => {
              if (value === "auto" || value === "zh-CN" || value === "en") void setPreference(value)
            }}
            type="single"
            value={preference}
            variant="outline">
            <ToggleGroupItem value="auto" className="h-11 rounded-lg border border-border/70 bg-background/80 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10">{t("appearance.auto")}</ToggleGroupItem>
            <ToggleGroupItem value="zh-CN" className="h-11 rounded-lg border border-border/70 bg-background/80 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10">{t("appearance.simplifiedChinese")}</ToggleGroupItem>
            <ToggleGroupItem value="en" className="h-11 rounded-lg border border-border/70 bg-background/80 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10">{t("appearance.english")}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardContent>
    </Card>
  )
}
