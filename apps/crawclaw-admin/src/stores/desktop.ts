import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type { DesktopCapabilities, DesktopCapability } from '@/api/types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useDesktopStore = defineStore('desktop', () => {
  const wsStore = useWebSocketStore()
  const capabilities = ref<DesktopCapabilities | null>(null)
  const loading = ref(false)
  const loaded = ref(false)
  const lastError = ref<string | null>(null)
  let pendingLoad: Promise<DesktopCapabilities | null> | null = null

  const isDesktopMode = computed(() => capabilities.value?.desktopUpdate.available ?? false)
  const platform = computed(() => capabilities.value?.terminal.platform ?? null)

  function capability(key: keyof DesktopCapabilities): DesktopCapability | null {
    return capabilities.value?.[key] ?? null
  }

  function capabilityUnavailableReason(key: keyof DesktopCapabilities, fallback: string): string | null {
    const selected = capability(key)
    if (!selected) {return fallback}
    if (selected.available) {return null}
    return selected.reason || fallback
  }

  async function refreshCapabilities(): Promise<DesktopCapabilities | null> {
    if (pendingLoad) {return pendingLoad}

    loading.value = true
    lastError.value = null
    pendingLoad = wsStore.rpc.getDesktopCapabilities()
      .then((nextCapabilities) => {
        capabilities.value = nextCapabilities
        loaded.value = true
        return nextCapabilities
      })
      .catch((error) => {
        capabilities.value = null
        loaded.value = false
        lastError.value = errorMessage(error)
        console.error('[DesktopStore] refreshCapabilities failed:', error)
        return null
      })
      .finally(() => {
        loading.value = false
        pendingLoad = null
      })

    return pendingLoad
  }

  async function ensureCapabilitiesLoaded(): Promise<DesktopCapabilities | null> {
    if (loaded.value) {return capabilities.value}
    return refreshCapabilities()
  }

  return {
    capabilities,
    loading,
    loaded,
    lastError,
    isDesktopMode,
    platform,
    capability,
    capabilityUnavailableReason,
    refreshCapabilities,
    ensureCapabilitiesLoaded,
  }
})
