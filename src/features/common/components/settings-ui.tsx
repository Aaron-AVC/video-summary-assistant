import type { ComponentProps, ComponentType, ReactNode } from "react"
import { Check, ClipboardCopy } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type StatusTone = "success" | "warning" | "muted" | "info" | "destructive"

const statusToneClassNames: Record<StatusTone, string> = {
  success:
    "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning:
    "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  muted: "border-border/70 bg-muted text-muted-foreground",
  info: "border-primary/20 bg-primary/10 text-primary",
  destructive:
    "border-destructive/20 bg-destructive/10 text-destructive"
}

type IconComponent = ComponentType<{ className?: string }>

export function SettingsSection({
  className,
  ...props
}: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-lg border border-border/70 bg-muted/35 p-4", className)}
      {...props}
    />
  )
}

export function SettingsRow({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
      {...props}
    />
  )
}

export function SettingsLabelBlock({
  children,
  className,
  description,
  icon: Icon,
  title,
  titleId
}: {
  children?: ReactNode
  className?: string
  description?: ReactNode
  icon?: IconComponent
  title: ReactNode
  titleId?: string
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {Icon ? <Icon className="size-5 shrink-0 text-primary" /> : null}
      <div className="min-w-0 space-y-0.5">
        <p id={titleId} className="text-sm font-medium text-foreground">
          {title}
        </p>
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
        {children}
      </div>
    </div>
  )
}

export function SwitchRow({
  checked,
  className,
  description,
  disabled,
  icon: Icon,
  id,
  label,
  onCheckedChange
}: {
  checked: boolean
  className?: string
  description?: ReactNode
  disabled?: boolean
  icon?: IconComponent
  id: string
  label: ReactNode
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <SettingsSection className={className}>
      <Field data-disabled={disabled} orientation="horizontal">
        {Icon ? <Icon className="size-5 shrink-0 text-primary" /> : null}
        <FieldContent>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
        </FieldContent>
        <Switch
          checked={checked}
          disabled={disabled}
          id={id}
          onCheckedChange={onCheckedChange}
        />
      </Field>
    </SettingsSection>
  )
}

export function StatusBadge({
  children,
  className,
  showDot = false,
  tone = "muted"
}: {
  children: ReactNode
  className?: string
  showDot?: boolean
  tone?: StatusTone
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-full font-medium [&_svg]:size-3 [&_svg]:shrink-0",
        statusToneClassNames[tone],
        className
      )}
    >
      {showDot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </Badge>
  )
}

export function CopyButton({
  className,
  copied,
  copiedLabel = "Copied",
  label = "Copy",
  onClick
}: {
  className?: string
  copied: boolean
  copiedLabel?: string
  label?: string
  onClick: () => void
}) {
  const tooltipLabel = copied ? copiedLabel : label

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={tooltipLabel}
            className={cn("shrink-0", className)}
            onClick={onClick}
            size="sm"
            type="button"
            variant="ghost"
          >
            {copied ? <Check data-icon="inline-start" /> : <ClipboardCopy data-icon="inline-start" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function CodeCopyBlock({
  className,
  copied,
  field,
  onCopy,
  text
}: {
  className?: string
  copied: boolean
  field: string
  onCopy: (text: string, field: string) => void
  text: string
}) {
  return (
    <div className={cn("mt-2 flex min-w-0 items-center gap-2", className)}>
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-lg border border-border/70 bg-background/90 px-4 py-2.5 font-mono text-xs text-foreground">
        {text}
      </code>
      <CopyButton
        copied={copied}
        onClick={() => onCopy(text, field)}
      />
    </div>
  )
}

export function StepIndicator({
  complete,
  value
}: {
  complete: boolean
  value: number
}) {
  return (
    <div
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        complete
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground"
      )}
    >
      {complete ? <Check data-icon="inline-start" /> : value}
    </div>
  )
}
