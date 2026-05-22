import { invoke } from '@tauri-apps/api/core'

import type { DesktopApiInfo, DesktopState } from '../generated/desktop-api-contract.generated'

export interface DesktopApiContext {
  api: DesktopApiInfo
  baseUrl: string
}

let apiContext: DesktopApiContext | null = null
const DESKTOP_API_BASE_URL_STORAGE_KEY = 'crawclaw.desktopApiBaseUrl'

export class DesktopApiRequestError extends Error {
  code?: string
  method: string
  path: string
  status: number

  constructor(params: { code?: string; message: string; method: string; path: string; status: number }) {
    super(params.message)
    this.name = 'DesktopApiRequestError'
    this.code = params.code
    this.method = params.method
    this.path = params.path
    this.status = params.status
  }
}

export function setDesktopApiContext(context: DesktopApiContext) {
  apiContext = context
}

export function getCurrentDesktopApiContext(): DesktopApiContext | null {
  return apiContext
}

export async function ensureDesktopApiContext(initialize: () => Promise<void>): Promise<DesktopApiContext> {
  if (!apiContext) {
    await initialize()
  }

  return apiContext!
}

export async function resolveDesktopApiBaseUrl(): Promise<string> {
  const configured = import.meta.env.VITE_CRAWCLAW_DESKTOP_API_BASE_URL?.trim()
  if (configured) {
    return normalizeDesktopApiBaseUrl(configured)
  }

  const queryBaseUrl = desktopApiBaseUrlFromLocation()
  if (queryBaseUrl) {
    return queryBaseUrl
  }

  const storedBaseUrl = desktopApiBaseUrlFromStorage()
  if (storedBaseUrl) {
    return storedBaseUrl
  }

  try {
    return normalizeDesktopApiBaseUrl(await invoke<string>('desktop_api_base_url'))
  } catch {
    return ''
  }
}

function desktopApiBaseUrlFromLocation(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const candidate = new URLSearchParams(window.location.search).get('desktopApiBaseUrl')?.trim() ?? ''
  if (!candidate || !isLoopbackDesktopApiBaseUrl(candidate)) {
    return ''
  }
  const baseUrl = normalizeDesktopApiBaseUrl(candidate)

  try {
    window.localStorage.setItem(DESKTOP_API_BASE_URL_STORAGE_KEY, baseUrl)
  } catch {
    // Storage is optional for development browser sessions.
  }
  return baseUrl
}

function desktopApiBaseUrlFromStorage(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    const candidate = window.localStorage.getItem(DESKTOP_API_BASE_URL_STORAGE_KEY)?.trim() ?? ''
    if (isLoopbackDesktopApiBaseUrl(candidate)) {
      return normalizeDesktopApiBaseUrl(candidate)
    }
    if (candidate) {
      window.localStorage.removeItem(DESKTOP_API_BASE_URL_STORAGE_KEY)
    }
  } catch {
    return ''
  }
  return ''
}

function isLoopbackDesktopApiBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}

function normalizeDesktopApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

export async function requestDesktopState(
  context: DesktopApiContext,
  path: string,
  init: RequestInit = {},
): Promise<DesktopState> {
  return requestDesktop<DesktopState>(context, path, init)
}

export async function requestDesktop<T>(
  context: DesktopApiContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${context.baseUrl}${path}`, {
    ...init,
    headers: requestHeaders(init, context.api.sessionToken),
  })
  if (!response.ok) {
    const method = init.method ?? 'GET'
    const errorBody = await readErrorBody(response)
    const message = typeof errorBody?.message === 'string' && errorBody.message.trim()
      ? errorBody.message.trim()
      : `Desktop API request failed: ${method} ${path} HTTP ${response.status}`
    throw new DesktopApiRequestError({
      code: typeof errorBody?.code === 'string' ? errorBody.code : undefined,
      message,
      method,
      path,
      status: response.status,
    })
  }

  return response.json() as Promise<T>
}

function requestHeaders(init: RequestInit, sessionToken: string): Record<string, string> {
  return {
    ...headersToRecord(init.headers),
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    'x-crawclaw-desktop-session': sessionToken,
  }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {}
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return headers
}

async function readErrorBody(response: Response): Promise<{ code?: unknown; message?: unknown } | null> {
  try {
    const body = await response.clone().json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
