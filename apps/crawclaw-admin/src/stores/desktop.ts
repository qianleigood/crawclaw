import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type { DesktopCapabilities, DesktopCapability, DesktopOptionalRuntime, DesktopRuntimeActionResponse } from '@/api/types'

const ONBOARDING_COMPLETE_KEY = 'crawclaw-desktop-onboarding-complete'
const ADVANCED_MODE_KEY = 'crawclaw-desktop-advanced-mode'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useDesktopStore = defineStore('desktop', () => {
  const wsStore = useWebSocketStore()
  const capabilities = ref<DesktopCapabilities | null>(null)
  const loading = ref(false)
  const loaded = ref(false)
  const lastError = ref<string | null>(null)
  const runtimeStatus = ref<DesktopRuntimeActionResponse | null>(null)
  const runtimeLogs = ref('')
  const runtimeLoading = ref(false)
  const runtimeLastError = ref<string | null>(null)
  const optionalRuntimes = ref<DesktopOptionalRuntime[]>([])
  const optionalRuntimesLoading = ref(false)
  const optionalRuntimesLastError = ref<string | null>(null)
  const onboardingComplete = ref(readStoredBoolean(ONBOARDING_COMPLETE_KEY, false))
  const advancedMode = ref(readStoredBoolean(ADVANCED_MODE_KEY, false))
  let pendingLoad: Promise<DesktopCapabilities | null> | null = null

  const isDesktopMode = computed(() => capabilities.value?.desktopUpdate.available ?? false)
  const isDesktopLocal = computed(() => capabilities.value?.desktopLocal.available ?? false)
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

  async function runRuntimeAction(
    action: () => Promise<DesktopRuntimeActionResponse>
  ): Promise<DesktopRuntimeActionResponse | null> {
    runtimeLoading.value = true
    runtimeLastError.value = null
    try {
      const result = await action()
      runtimeStatus.value = result
      return result
    } catch (error) {
      runtimeLastError.value = errorMessage(error)
      console.error('[DesktopStore] runtime action failed:', error)
      return null
    } finally {
      runtimeLoading.value = false
    }
  }

  function refreshRuntimeStatus(): Promise<DesktopRuntimeActionResponse | null> {
    return runRuntimeAction(() => wsStore.rpc.getDesktopRuntimeStatus())
  }

  function bootstrapRuntime(): Promise<DesktopRuntimeActionResponse | null> {
    return runRuntimeAction(() => wsStore.rpc.bootstrapDesktopRuntime())
  }

  function startGatewayService(): Promise<DesktopRuntimeActionResponse | null> {
    return runRuntimeAction(() => wsStore.rpc.startDesktopGatewayService())
  }

  function stopGatewayService(): Promise<DesktopRuntimeActionResponse | null> {
    return runRuntimeAction(() => wsStore.rpc.stopDesktopGatewayService())
  }

  function restartGatewayService(): Promise<DesktopRuntimeActionResponse | null> {
    return runRuntimeAction(() => wsStore.rpc.restartDesktopGatewayService())
  }

  async function tailRuntimeLogs(): Promise<DesktopRuntimeActionResponse | null> {
    const result = await runRuntimeAction(() => wsStore.rpc.tailDesktopRuntimeLogs({ lines: 120 }))
    runtimeLogs.value = formatRuntimeResult(result?.result)
    return result
  }

  async function refreshOptionalRuntimes(): Promise<DesktopOptionalRuntime[]> {
    optionalRuntimesLoading.value = true
    optionalRuntimesLastError.value = null
    try {
      optionalRuntimes.value = await wsStore.rpc.listDesktopOptionalRuntimes()
      return optionalRuntimes.value
    } catch (error) {
      optionalRuntimesLastError.value = errorMessage(error)
      console.error('[DesktopStore] optional runtime refresh failed:', error)
      return []
    } finally {
      optionalRuntimesLoading.value = false
    }
  }

  async function installOptionalRuntime(id: string): Promise<DesktopOptionalRuntime | null> {
    optionalRuntimesLoading.value = true
    optionalRuntimesLastError.value = null
    try {
      const runtime = await wsStore.rpc.installDesktopOptionalRuntime(id)
      optionalRuntimes.value = optionalRuntimes.value.some((item) => item.id === runtime.id)
        ? optionalRuntimes.value.map((item) => item.id === runtime.id ? runtime : item)
        : [...optionalRuntimes.value, runtime]
      return runtime
    } catch (error) {
      optionalRuntimesLastError.value = errorMessage(error)
      console.error('[DesktopStore] optional runtime install failed:', error)
      return null
    } finally {
      optionalRuntimesLoading.value = false
    }
  }

  function completeOnboarding(): void {
    onboardingComplete.value = true
    writeStoredBoolean(ONBOARDING_COMPLETE_KEY, true)
  }

  function setAdvancedMode(value: boolean): void {
    advancedMode.value = value
    writeStoredBoolean(ADVANCED_MODE_KEY, value)
  }

  function toggleAdvancedMode(): void {
    setAdvancedMode(!advancedMode.value)
  }

  return {
    capabilities,
    loading,
    loaded,
    lastError,
    runtimeStatus,
    runtimeLogs,
    runtimeLoading,
    runtimeLastError,
    optionalRuntimes,
    optionalRuntimesLoading,
    optionalRuntimesLastError,
    onboardingComplete,
    advancedMode,
    isDesktopMode,
    isDesktopLocal,
    platform,
    capability,
    capabilityUnavailableReason,
    refreshCapabilities,
    ensureCapabilitiesLoaded,
    refreshRuntimeStatus,
    bootstrapRuntime,
    startGatewayService,
    stopGatewayService,
    restartGatewayService,
    tailRuntimeLogs,
    refreshOptionalRuntimes,
    installOptionalRuntime,
    completeOnboarding,
    setAdvancedMode,
    toggleAdvancedMode,
  }
})

function formatRuntimeResult(value: unknown): string {
  if (!value) {return ''}
  if (typeof value === 'string') {return value}
  if (Array.isArray(value)) {return value.map((line) => String(line)).join('\n')}
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>
    if (Array.isArray(row.lines)) {
      return row.lines.map((line) => String(line)).join('\n')
    }
  }
  return JSON.stringify(value, null, 2)
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const storage = readLocalStorage()
  if (!storage) {return fallback}
  return storage.getItem(key) === 'true'
}

function writeStoredBoolean(key: string, value: boolean): void {
  const storage = readLocalStorage()
  storage?.setItem(key, String(value))
}

function readLocalStorage(): Storage | null {
  if (typeof globalThis.localStorage === 'undefined') {return null}
  return globalThis.localStorage
}
