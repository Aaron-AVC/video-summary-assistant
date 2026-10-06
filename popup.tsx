import { useEffect } from "react"

/**
 * Plasmo still discovers this root entry during builds.
 * The generated manifest intentionally omits default_popup so toolbar clicks
 * flow through chrome.action.onClicked and open the sidepanel.
 */
export default function Popup() {
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        ;(chrome as any).sidePanel.open({ tabId: tab.id })
      }
      window.close()
    })
  }, [])

  return null
}
