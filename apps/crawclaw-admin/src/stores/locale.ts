import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { i18n } from '@/i18n'
import { getStoredLocale, getSystemLocale, saveLocale, type AppLocale } from '@/i18n/locale'
import { useAuthStore } from '@/stores/auth'

function applyLocale(locale: AppLocale) {
  i18n.global.locale.value = locale
  if (typeof document === 'undefined') {return}
  document.documentElement.setAttribute('lang', locale)
}

async function syncLocaleToBackend(locale: AppLocale, token: string | null) {
  try {
    await fetch('/api/n8n/locale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ locale }),
    })
  } catch (error) {
    console.warn('[LocaleStore] Failed to sync locale to backend:', error)
  }
}

export const useLocaleStore = defineStore('locale', () => {
  const authStore = useAuthStore()
  const stored = getStoredLocale()
  const locale = ref<AppLocale>(stored || getSystemLocale())

  watch(locale, (val) => {
    applyLocale(val)
  }, { immediate: true })

  function canSyncToBackend() {
    return !authStore.authEnabled || !!authStore.token
  }

  function syncCurrentLocale() {
    if (!canSyncToBackend()) {return}
    void syncLocaleToBackend(locale.value, authStore.token)
  }

  watch(
    () => [authStore.authEnabled, authStore.token] as const,
    ([authEnabled, token], previous) => {
      const [prevAuthEnabled, prevToken] = previous ?? []
      if ((authEnabled === prevAuthEnabled) && (token === prevToken)) {return}
      syncCurrentLocale()
    },
    { immediate: true },
  )

  void authStore.checkAuthConfig().then(() => {
    if (!stored && authStore.serverLocale) {
      locale.value = authStore.serverLocale
    }
    syncCurrentLocale()
  })

  function setLocale(next: AppLocale, persist = true) {
    locale.value = next
    if (persist) {
      saveLocale(next)
      syncCurrentLocale()
    }
  }

  function toggle() {
    const next: AppLocale = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'
    setLocale(next, true)
  }

  return { locale, setLocale, toggle }
})
