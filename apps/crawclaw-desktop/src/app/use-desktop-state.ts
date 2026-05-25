import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

import { loadBootstrap } from '../api/desktop-client'
import { subscribeDesktopEvents } from '../api/desktop-events'
import {
  createDesktopInitialState,
  createDesktopUnavailableState,
} from '../api/desktop-initial-state'
import { DesktopApiRequestError } from '../api/desktop-transport'
import type {
  BadgeTone,
  ConversationMessage,
  DesktopState,
  RuntimeStatusValue,
  SearchSuggestion,
} from '../generated/desktop-api-contract.generated'

export interface DesktopStateController {
  applyDesktopState: (operation: () => Promise<DesktopState>) => Promise<void>
  desktopState: DesktopState
  searchResults: SearchSuggestion[]
  setDesktopState: Dispatch<SetStateAction<DesktopState>>
  setSearchResults: Dispatch<SetStateAction<SearchSuggestion[]>>
}

export function useDesktopStateController(): DesktopStateController {
  const [desktopState, setDesktopState] = useState<DesktopState>(() => createDesktopInitialState())
  const [searchResults, setSearchResults] = useState<SearchSuggestion[]>(desktopState.searchSuggestions)

  const applyDesktopState = useCallback(async (operation: () => Promise<DesktopState>) => {
    try {
      const nextState = await operation()
      setDesktopState(nextState)
    } catch (error) {
      const detail = formatDesktopOperationError(error)
      setDesktopState((state) => ({
        ...state,
        conversation: {
          ...state.conversation,
          messages: [
            ...state.conversation.messages,
            createOperationErrorMessage(detail),
          ],
          resultItems: [detail],
        },
      }))
    }
  }, [])

  useEffect(() => {
    let unsubscribe = () => {}
    let cancelled = false

    loadBootstrap()
      .then((bootstrap) => {
        if (cancelled) {
          return
        }

        setDesktopState(bootstrap.desktopState)
        setSearchResults(bootstrap.desktopState.searchSuggestions)
        unsubscribe = subscribeDesktopEvents((event) => {
          if (event.type === 'stateChanged') {
            setDesktopState(event.desktopState)
          }

          if (event.type === 'runtime') {
            setDesktopState((state) => ({
              ...state,
              conversation: {
                ...state.conversation,
                resultItems: state.conversation.resultItems.length > 0
                  ? state.conversation.resultItems
                  : [event.detail],
                runtimeChecks: state.conversation.runtimeChecks.map((item) =>
                  item.label === 'Runtime'
                    ? {
                        ...item,
                        tone: runtimeEventTone(event.status),
                        value: event.status,
                      }
                    : item,
                ),
              },
            }))
          }

          if (event.type === 'permissionChanged') {
            setDesktopState((state) => ({
              ...state,
              permissionRequest: event.permissionRequest,
            }))
          }

          if (event.type === 'permissionRequested') {
            setDesktopState((state) => ({
              ...state,
              permissionRequest: event.permissionRequest,
            }))
          }
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const detail = error instanceof Error
            ? error.message
            : 'CrawClaw Desktop Gateway is not available.'
          const unavailableState = createDesktopUnavailableState(detail)
          setDesktopState(unavailableState)
          setSearchResults(unavailableState.searchSuggestions)
        }
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return {
    applyDesktopState,
    desktopState,
    searchResults,
    setDesktopState,
    setSearchResults,
  }
}

function runtimeEventTone(status: RuntimeStatusValue): BadgeTone {
  if (status === 'ready') {
    return 'ok'
  }
  if (status === 'checking') {
    return 'neutral'
  }
  return 'danger'
}

function formatDesktopOperationError(error: unknown): string {
  if (error instanceof DesktopApiRequestError) {
    if (error.status === 501 || error.code === 'unsupported') {
      return `当前操作还没有接入本机 CrawClaw runtime：${error.message}`
    }
    if (error.status === 503 || error.code === 'runtime_unavailable') {
      return `本机 CrawClaw runtime 暂不可用：${error.message}`
    }
    return error.message
  }
  return error instanceof Error ? error.message : 'Desktop API request failed.'
}

function createOperationErrorMessage(detail: string): ConversationMessage {
  return {
    code: 'desktop_operation_failed',
    createdAt: '刚刚',
    detail,
    id: `operation-error-${Date.now()}`,
    kind: 'error',
    title: '操作失败',
  }
}
