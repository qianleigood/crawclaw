import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { i18n } from '@/i18n'
import { getStoredLocale, getSystemLocale, saveLocale, type AppLocale } from '@/i18n/locale'

function applyLocale(locale: AppLocale) {
  i18n.global.locale.value = locale
  if (typeof document === 'undefined') {return}
  document.documentElement.setAttribute('lang', locale)
}

async function syncLocaleToBackend(locale: AppLocale) {
  if (typeof localStorage === 'undefined') return
  try {
    const token = localStorage.getItem('auth_token')
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
  const stored = getStoredLocale()
  const locale = ref<AppLocale>(stored || getSystemLocale())

  watch(locale, (val) => {
    applyLocale(val)
  }, { immediate: true })
  void syncLocaleToBackend(locale.value)

  function setLocale(next: AppLocale, persist = true) {
    locale.value = next
    if (persist) {
      saveLocale(next)
      void syncLocaleToBackend(next)
    }
  }

  function toggle() {
    const next: AppLocale = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'
    setLocale(next, true)
  }

  return { locale, setLocale, toggle }
})
