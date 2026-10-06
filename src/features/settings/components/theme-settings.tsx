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
import { useTheme } from "@/lib/theme/theme-provider"

const THEME_OPTIONS = [
  {
    value: "light",
    label: "Light",
    icon: SunMedium
  },
  {
    value: "dark",
    label: "Dark",
    icon: MoonStar
  },
  {
    value: "system",
    label: "System",
    icon: LaptopMinimal
  }
] as const

export function ThemeSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-2">
          <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
            Theme mode
          </Badge>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Choose light, dark, or system mode.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-4 pt-0">
        <div className="rounded-lg border border-border/70 bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
          Current mode: <span className="font-medium text-foreground">{resolvedTheme}</span>
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
                {option.label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </CardContent>
    </Card>
  )
}
