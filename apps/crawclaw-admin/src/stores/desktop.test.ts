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
}

describe('useDesktopStore', () => {
  beforeEach(() => {
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
})
