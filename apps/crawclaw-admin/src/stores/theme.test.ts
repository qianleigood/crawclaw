// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from './theme'

describe('useThemeStore', () => {
  beforeEach(() => {
    const entries = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
      clear: () => entries.clear(),
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      get length() {
        return entries.size
      },
    } satisfies Storage)
    document.documentElement.removeAttribute('data-theme')
    setActivePinia(createPinia())
  })

  it('defaults new desktop users to the light appearance', () => {
    const store = useThemeStore()

    expect(store.mode).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
