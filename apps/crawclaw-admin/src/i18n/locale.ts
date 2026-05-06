export type AppLocale = 'zh-CN' | 'en-US'

const STORAGE_KEY = 'crawclaw_locale'

export function normalizeLocale(input?: string | null): AppLocale | null {
  if (!input) {return null}
  const raw = String(input).trim()
  if (!raw) {return null}

  const lower = raw.toLowerCase()
  if (lower === 'zh-cn') {return 'zh-CN'}
  if (lower === 'en-us') {return 'en-US'}

  if (lower.startsWith('zh')) {return 'zh-CN'}
  if (lower.startsWith('en')) {return 'en-US'}

  return null
}

export function getSystemLocale(): AppLocale {
  if (typeof navigator === 'undefined') {return 'en-US'}

  const candidates = (navigator.languages?.length ? navigator.languages : [navigator.language]).filter(Boolean)
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate)
    if (normalized) {return normalized}
  }

  return 'en-US'
}

export function getStoredLocale(): AppLocale | null {
  if (typeof window === 'undefined') {return null}
  const storage = window.localStorage
  if (!storage || typeof storage.getItem !== 'function') {return null}
  return normalizeLocale(storage.getItem(STORAGE_KEY))
}

export function getPreferredLocale(): AppLocale {
  return getStoredLocale() || getSystemLocale()
}

export function saveLocale(locale: AppLocale): void {
  if (typeof window === 'undefined') {return}
  const storage = window.localStorage
  if (!storage || typeof storage.setItem !== 'function') {return}
  storage.setItem(STORAGE_KEY, locale)
}

export const LOCALE_STORAGE_KEY = STORAGE_KEY
