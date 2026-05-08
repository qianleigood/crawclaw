import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesktopStore } from './desktop'
import type { DesktopCapabilities } from '@/api/types'

const mocks = vi.hoisted(() => ({
  getDesktopCapabilities: vi.fn(),
}))

vi.mock('@/stores/websocket', () => ({
  useWebSocketStore: () => ({
    rpc: {
      getDesktopCapabilities: mocks.getDesktopCapabilities,
    },
  }),
}))

const capabilities: DesktopCapabilities = {
  terminal: { available: true, platform: 'darwin' },
  files: { available: true, platform: 'darwin' },
  backup: { available: true, platform: 'darwin' },
  hermesCli: { available: false, platform: 'darwin', reason: 'Set HERMES_CLI_PATH to enable Hermes CLI.' },
  n8n: { available: true, platform: 'darwin' },
  comfyuiDownloads: { available: true, platform: 'darwin' },
  systemMetrics: { available: true, platform: 'darwin' },
  remoteDesktop: {
    available: false,
    platform: 'darwin',
    reason: 'Remote desktop capture is not implemented for this platform.',
  },
  desktopInput: {
    available: false,
    platform: 'darwin',
    reason: 'Desktop input is only implemented for Linux display sessions.',
  },
  desktopUpdate: { available: true, platform: 'darwin' },
  desktopLocal: { available: false, platform: 'darwin' },
}

describe('useDesktopStore', () => {
  beforeEach(() => {
    installLocalStorage()
    setActivePinia(createPinia())
    mocks.getDesktopCapabilities.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('retries capability loading after a transient failure', async () => {
    mocks.getDesktopCapabilities
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(capabilities)
    const store = useDesktopStore()

    await expect(store.ensureCapabilitiesLoaded()).resolves.toBeNull()

    expect(store.loaded).toBe(false)
    expect(store.lastError).toBe('offline')

    await expect(store.ensureCapabilitiesLoaded()).resolves.toEqual(capabilities)

    expect(mocks.getDesktopCapabilities).toHaveBeenCalledTimes(2)
    expect(store.loaded).toBe(true)
    expect(store.capabilities).toEqual(capabilities)
  })

  it('returns backend-provided unavailable reasons for gated features', async () => {
    const store = useDesktopStore()
    store.capabilities = {
      ...capabilities,
      remoteDesktop: {
        available: false,
        platform: 'darwin',
        reason: 'Remote desktop capture is not implemented for this platform.',
      },
    }

    expect(store.capabilityUnavailableReason('remoteDesktop', 'Fallback')).toBe(
      'Remote desktop capture is not implemented for this platform.'
    )
    expect(store.capabilityUnavailableReason('terminal', 'Fallback')).toBeNull()
  })

  it('treats unloaded sensitive capabilities as unavailable', () => {
    const store = useDesktopStore()

    expect(store.capabilityUnavailableReason('files', 'Fallback')).toBe('Fallback')
  })

  it('defaults desktop onboarding and advanced mode to simple first-run values', () => {
    const store = useDesktopStore()

    expect(store.onboardingComplete).toBe(false)
    expect(store.advancedMode).toBe(false)
  })

  it('persists desktop onboarding completion and advanced mode preference', () => {
    const store = useDesktopStore()

    store.completeOnboarding()
    store.setAdvancedMode(true)

    expect(localStorage.getItem('crawclaw-desktop-onboarding-complete')).toBe('true')
    expect(localStorage.getItem('crawclaw-desktop-advanced-mode')).toBe('true')

    setActivePinia(createPinia())
    const reloaded = useDesktopStore()

    expect(reloaded.onboardingComplete).toBe(true)
    expect(reloaded.advancedMode).toBe(true)
  })
})

function installLocalStorage() {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  })
}
