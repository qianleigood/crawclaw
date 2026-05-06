// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function installLocalStorageMock() {
  const storage = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        return storage.get(key) ?? null
      },
      setItem(key: string, value: string) {
        storage.set(key, String(value))
      },
      removeItem(key: string) {
        storage.delete(key)
      },
      clear() {
        storage.clear()
      },
    },
  })
}

describe('locale store backend sync', () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

  beforeEach(() => {
    setActivePinia(createPinia())
    installLocalStorageMock()
    localStorage.clear()
    document.documentElement.lang = ''
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not call /api/n8n/locale before authentication when auth is enabled', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/api/auth/config') {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    useLocaleStore()
    await flushMicrotasks()

    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/n8n/locale',
      expect.anything(),
    )
  })

  it('syncs locale after login when auth is enabled', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/auth/config') {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 })
      }
      if (String(input) === '/api/auth/login') {
        return new Response(JSON.stringify({ ok: true, token: 'test-token' }), { status: 200 })
      }
      if (String(input) === '/api/n8n/locale') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${String(input)} ${init?.method || 'GET'}`)
    })

    useLocaleStore()
    const authStore = useAuthStore()
    await flushMicrotasks()
    await authStore.login('admin', 'admin')
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/n8n/locale',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('uses the server locale when no local preference exists', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input) === '/api/auth/config') {
        return new Response(JSON.stringify({ enabled: false, locale: 'zh-CN' }), { status: 200 })
      }
      if (String(input) === '/api/n8n/locale') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${String(input)}`)
    })

    const localeStore = useLocaleStore()
    await flushMicrotasks()

    expect(localeStore.locale).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
