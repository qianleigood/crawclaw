import type { DesktopEvent } from '../generated/desktop-api-contract.generated'
import { getCurrentDesktopApiContext } from './desktop-transport'

export function subscribeDesktopEvents(onEvent: (event: DesktopEvent) => void): () => void {
  const context = getCurrentDesktopApiContext()
  if (!context || !context.api.eventsUrl) {
    return () => {}
  }

  const url = `${context.api.eventsUrl}?sessionToken=${encodeURIComponent(context.api.sessionToken)}`
  const source = new EventSource(url)
  const handleMessage = (event: MessageEvent) => {
    try {
      onEvent(JSON.parse(event.data) as DesktopEvent)
    } catch {
      // Ignore malformed local events; the next valid event will resync state.
    }
  }

  source.addEventListener('runtime', handleMessage)
  source.addEventListener('stateChanged', handleMessage)
  source.addEventListener('permissionRequested', handleMessage)
  source.addEventListener('permissionChanged', handleMessage)
  return () => source.close()
}
