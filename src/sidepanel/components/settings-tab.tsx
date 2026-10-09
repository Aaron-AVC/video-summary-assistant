import { useState } from "react"

import {
  ConnectionTest,
  type ProviderConnectionStatus,
} from "@/features/settings/components/connection-test"
import { ProviderForm } from "@/features/settings/components/provider-form"
import type { ProviderConfigRecord } from "@/features/settings/lib/settings-storage"

type SettingsTabProps = {
  onProvidersChange: (providers: ProviderConfigRecord[]) => void
}

export function SettingsTab({ onProvidersChange }: SettingsTabProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfigRecord | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ProviderConnectionStatus | null>(null)

  return (
    <div className="flex min-w-0 flex-col gap-3" data-layout-check="settings-tab">
      <ProviderForm
        connectionStatus={connectionStatus}
        onSelectedProviderChange={setSelectedProvider}
        onProvidersChange={onProvidersChange}
      />
      <ConnectionTest
        provider={selectedProvider}
        status={connectionStatus}
        onStatusChange={setConnectionStatus}
      />
    </div>
  )
}
