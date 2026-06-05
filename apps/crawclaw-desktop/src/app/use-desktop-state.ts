import {
  useCallback,
  useEffect,
  useRef,
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
import { markDesktopPerformance } from './performance'
import type {
  BadgeTone,
  ConversationMessage,
  DesktopState,
  RuntimeStatusValue,
  SearchSuggestion,
} from '../generated/desktop-api-contract.generated'

export interface DesktopStateController {
  applyDesktopState: (operation: () => Promise<DesktopState>) => Promise<void>
  appendOptimisticConversationTurn: (text: string) => void
  desktopState: DesktopState
  searchResults: SearchSuggestion[]
  setDesktopState: Dispatch<SetStateAction<DesktopState>>
  setSearchResults: Dispatch<SetStateAction<SearchSuggestion[]>>
}

type PendingAssistantDelta = {
  text: string
  threadId: string
}

export function useDesktopStateController(): DesktopStateController {
  const [desktopState, setDesktopState] = useState<DesktopState>(() => createDesktopInitialState())
  const [searchResults, setSearchResults] = useState<SearchSuggestion[]>(desktopState.searchSuggestions)
  const pendingAssistantDeltaRef = useRef<PendingAssistantDelta | null>(null)
  const assistantDeltaFrameRef = useRef<number | null>(null)

  const applyDesktopState = useCallback(async (operation: () => Promise<DesktopState>) => {
    try {
      markDesktopPerformance('state.request.start')
      const nextState = await operation()
      markDesktopPerformance('state.request.success')
      setDesktopState((state) => mergeDesktopStateSnapshot(state, nextState))
    } catch (error) {
      const detail = formatDesktopOperationError(error)
      markDesktopPerformance('state.request.failure', { messageLength: detail.length })
      setDesktopState((state) => applyOperationFailure(state, detail))
    }
  }, [])

  const appendOptimisticConversationTurnToState = useCallback((text: string) => {
    markDesktopPerformance('send.optimistic', { textLength: text.trim().length })
    setDesktopState((state) => appendOptimisticConversationTurn(state, activeThreadId(state), text))
  }, [])

  useEffect(() => {
    let unsubscribe = () => {}
    let cancelled = false
    const flushPendingAssistantDelta = () => {
      assistantDeltaFrameRef.current = null
      const pending = pendingAssistantDeltaRef.current
      pendingAssistantDeltaRef.current = null
      if (!pending) {
        return
      }
      markDesktopPerformance('sse.message_delta.render', { textLength: pending.text.length })
      setDesktopState((state) => applyAssistantRealtimeMessage(state, pending.threadId, pending.text, 'running'))
    }
    const scheduleAssistantDelta = (pending: PendingAssistantDelta) => {
      pendingAssistantDeltaRef.current = pending
      if (assistantDeltaFrameRef.current !== null) {
        return
      }
      assistantDeltaFrameRef.current = window.requestAnimationFrame(flushPendingAssistantDelta)
    }
    const clearPendingAssistantDelta = () => {
      pendingAssistantDeltaRef.current = null
      if (assistantDeltaFrameRef.current !== null) {
        window.cancelAnimationFrame(assistantDeltaFrameRef.current)
        assistantDeltaFrameRef.current = null
      }
    }

    loadBootstrap()
      .then((bootstrap) => {
        if (cancelled) {
          return
        }

        setDesktopState((state) => mergeDesktopStateSnapshot(state, bootstrap.desktopState))
        setSearchResults(bootstrap.desktopState.searchSuggestions)
        markDesktopPerformance('bootstrap.loaded', {
          messageCount: bootstrap.desktopState.conversation.messages.length,
        })
        unsubscribe = subscribeDesktopEvents((event) => {
          if (event.type === 'stateChanged') {
            markDesktopPerformance('sse.state_changed', {
              messageCount: event.desktopState.conversation.messages.length,
            })
            setDesktopState((state) => mergeDesktopStateSnapshot(state, event.desktopState))
          }

          if (event.type === 'runtime') {
            setDesktopState((state) => applyRuntimeStatus(state, event.status, event.detail))
          }

          if (event.type === 'runtimeChanged') {
            setDesktopState((state) => applyRuntimeStatus(state, event.runtime.status, event.runtime.detail))
          }

          if (event.type === 'messageDelta') {
            markDesktopPerformance('sse.message_delta.received', { textLength: event.text.length })
            scheduleAssistantDelta({
              text: event.text,
              threadId: event.threadId,
            })
          }

          if (event.type === 'messageFinal') {
            markDesktopPerformance('sse.message_final.received', {
              role: event.role,
              textLength: event.text.length,
            })
            clearPendingAssistantDelta()
            setDesktopState((state) => applyFinalRealtimeMessage(state, event.threadId, event.role, event.text))
          }

          if (event.type === 'toolCall') {
            setDesktopState((state) => applyToolRealtimeMessage(state, event.threadId, event.toolId, 'call'))
          }

          if (event.type === 'toolResult') {
            setDesktopState((state) => applyToolRealtimeMessage(state, event.threadId, event.toolId, 'result', event.ok))
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

          if (event.type === 'operationFailed') {
            markDesktopPerformance('sse.operation_failed', { code: event.code, messageLength: event.message.length })
            clearPendingAssistantDelta()
            setDesktopState((state) => applyOperationFailure(state, event.message))
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
      clearPendingAssistantDelta()
      unsubscribe()
    }
  }, [])

  return {
    applyDesktopState,
    appendOptimisticConversationTurn: appendOptimisticConversationTurnToState,
    desktopState,
    searchResults,
    setDesktopState,
    setSearchResults,
  }
}

export function mergeDesktopStateSnapshot(currentState: DesktopState, nextState: DesktopState): DesktopState {
  const currentThreadId = activeThreadId(currentState)
  const nextThreadId = activeThreadId(nextState)
  if (currentThreadId && currentThreadId !== nextThreadId) {
    return nextState
  }

  const pendingMessages = currentState.conversation.messages.filter(isPendingRealtimeMessage)
  if (pendingMessages.length === 0) {
    return nextState
  }

  const messages = [...nextState.conversation.messages]
  let changed = false
  for (const pendingMessage of pendingMessages) {
    if (hasEquivalentRealtimeMessage(currentState.conversation.messages, messages, pendingMessage)) {
      continue
    }

    messages.splice(
      pendingMessageInsertIndex(currentState.conversation.messages, messages, pendingMessage.id),
      0,
      pendingMessage,
    )
    changed = true
  }

  if (!changed) {
    return nextState
  }

  return {
    ...nextState,
    conversation: {
      ...nextState.conversation,
      messages,
    },
  }
}

type UserConversationMessage = Extract<ConversationMessage, { kind: 'user' }>
type AssistantConversationMessage = Extract<ConversationMessage, { kind: 'assistant' }>
type PendingRealtimeMessage = UserConversationMessage | AssistantConversationMessage

function isPendingRealtimeMessage(message: ConversationMessage): message is PendingRealtimeMessage {
  return isPendingRealtimeUserMessage(message) || isPendingRealtimeAssistantMessage(message)
}

function isPendingRealtimeUserMessage(message: ConversationMessage): message is UserConversationMessage {
  return message.kind === 'user' && message.id.startsWith('realtime-user-')
}

function isPendingRealtimeAssistantMessage(message: ConversationMessage): message is AssistantConversationMessage {
  return message.kind === 'assistant' && message.id.startsWith('realtime-assistant-')
}

function hasEquivalentRealtimeMessage(
  currentMessages: ConversationMessage[],
  nextMessages: ConversationMessage[],
  pendingMessage: PendingRealtimeMessage,
): boolean {
  if (pendingMessage.kind === 'user') {
    return hasEquivalentUserMessage(currentMessages, nextMessages, pendingMessage)
  }
  return hasAssistantResponseAfterPendingPrompt(currentMessages, nextMessages, pendingMessage)
}

function hasEquivalentUserMessage(
  currentMessages: ConversationMessage[],
  nextMessages: ConversationMessage[],
  pendingMessage: UserConversationMessage,
): boolean {
  if (nextMessages.some((message) => message.kind === 'user' && message.id === pendingMessage.id)) {
    return true
  }

  const insertIndex = pendingMessageInsertIndex(currentMessages, nextMessages, pendingMessage.id)
  const searchStart = insertIndex >= nextMessages.length ? 0 : insertIndex
  return nextMessages.slice(searchStart).some((message) =>
    message.kind === 'user' && message.text === pendingMessage.text
  )
}

function hasAssistantResponseAfterPendingPrompt(
  currentMessages: ConversationMessage[],
  nextMessages: ConversationMessage[],
  pendingMessage: AssistantConversationMessage,
): boolean {
  if (nextMessages.some((message) => message.kind === 'assistant' && message.id === pendingMessage.id)) {
    return true
  }

  const promptMessage = previousUserMessage(currentMessages, pendingMessage.id)
  if (!promptMessage) {
    return false
  }

  const promptIndex = nextMessages.findIndex((message) =>
    message.kind === 'user' && (message.id === promptMessage.id || message.text === promptMessage.text)
  )
  if (promptIndex < 0) {
    return false
  }

  return nextMessages.slice(promptIndex + 1).some((message) =>
    message.kind === 'assistant' && !isPendingRealtimeAssistantMessage(message)
  )
}

function pendingMessageInsertIndex(
  currentMessages: ConversationMessage[],
  nextMessages: ConversationMessage[],
  pendingMessageId: string,
): number {
  const currentIndex = currentMessages.findIndex((message) => message.id === pendingMessageId)
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const nextIndex = nextMessages.findIndex((message) => message.id === currentMessages[index]?.id)
    if (nextIndex >= 0) {
      return nextIndex + 1
    }
  }
  return nextMessages.length
}

function previousUserMessage(
  messages: ConversationMessage[],
  messageId: string,
): UserConversationMessage | undefined {
  const messageIndex = messages.findIndex((message) => message.id === messageId)
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.kind === 'user') {
      return message
    }
  }
  return undefined
}

export function appendOptimisticConversationTurn(
  state: DesktopState,
  threadId: string,
  text: string,
): DesktopState {
  if (activeThreadId(state) !== threadId || !text.trim()) {
    return state
  }

  const createdAt = '刚刚'
  const timestamp = Date.now()
  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: [
        ...state.conversation.messages,
        {
          createdAt,
          id: `realtime-user-${threadId}-${timestamp}`,
          kind: 'user',
          text,
        },
        {
          createdAt,
          id: `realtime-assistant-${threadId}-${timestamp}`,
          kind: 'assistant',
          status: 'running',
          text: '',
        },
      ],
    },
  }
}

function applyOperationFailure(state: DesktopState, detail: string): DesktopState {
  const messages = [...state.conversation.messages]
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.kind === 'assistant' && message.id.startsWith('realtime-assistant-') && message.status === 'running') {
      messages[index] = {
        ...message,
        status: 'failed',
        text: detail,
      }
      return {
        ...state,
        conversation: {
          ...state.conversation,
          messages,
          resultItems: [detail],
        },
      }
    }
  }

  return {
    ...state,
    conversation: {
      ...state.conversation,
      resultItems: [detail],
    },
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

function applyRuntimeStatus(
  state: DesktopState,
  status: RuntimeStatusValue,
  detail: string,
): DesktopState {
  return {
    ...state,
    conversation: {
      ...state.conversation,
      resultItems: state.conversation.resultItems.length > 0
        ? state.conversation.resultItems
        : [detail],
      runtimeChecks: state.conversation.runtimeChecks.map((item) =>
        item.label === 'Runtime'
          ? {
              ...item,
              tone: runtimeEventTone(status),
              value: status,
            }
          : item,
      ),
    },
  }
}

function activeThreadId(state: DesktopState): string {
  return [
    ...state.sidebar.pinnedThreads,
    ...state.sidebar.threads,
    ...state.sidebar.discussionThreads,
  ].find((thread) => thread.active)?.id ?? ''
}

function applyFinalRealtimeMessage(
  state: DesktopState,
  threadId: string,
  role: 'assistant' | 'user',
  text: string,
): DesktopState {
  if (role === 'assistant') {
    return applyAssistantRealtimeMessage(state, threadId, text, 'done')
  }
  return applyUserRealtimeMessage(state, threadId, text)
}

function applyAssistantRealtimeMessage(
  state: DesktopState,
  threadId: string,
  text: string,
  status: 'running' | 'done',
): DesktopState {
  if (activeThreadId(state) !== threadId || !text.trim()) {
    return state
  }

  const messages = [...state.conversation.messages]
  let existingRunningIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.kind === 'assistant' && message.status === 'running') {
      existingRunningIndex = index
      break
    }
  }

  const existingRunningMessage = messages[existingRunningIndex]
  if (existingRunningMessage?.kind === 'assistant') {
    messages[existingRunningIndex] = {
      ...existingRunningMessage,
      status,
      text,
    }
    return {
      ...state,
      conversation: {
        ...state.conversation,
        messages,
        resultItems: status === 'done' ? [text] : state.conversation.resultItems,
      },
    }
  }

  if (messages.some((message) => message.kind === 'assistant' && message.text === text)) {
    return state
  }

  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: [
        ...messages,
        {
          createdAt: '刚刚',
          id: `realtime-assistant-${threadId}-${Date.now()}`,
          kind: 'assistant',
          status,
          text,
        },
      ],
      resultItems: status === 'done' ? [text] : state.conversation.resultItems,
    },
  }
}

function applyUserRealtimeMessage(
  state: DesktopState,
  threadId: string,
  text: string,
): DesktopState {
  if (activeThreadId(state) !== threadId || !text.trim()) {
    return state
  }

  if (state.conversation.messages.some((message) => message.kind === 'user' && message.text === text)) {
    return state
  }

  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: [
        ...state.conversation.messages,
        {
          createdAt: '刚刚',
          id: `realtime-user-${threadId}-${Date.now()}`,
          kind: 'user',
          text,
        },
      ],
    },
  }
}

function applyToolRealtimeMessage(
  state: DesktopState,
  threadId: string,
  toolId: string,
  phase: 'call' | 'result',
  ok = true,
): DesktopState {
  if (activeThreadId(state) !== threadId || !toolId.trim()) {
    return state
  }

  const alreadyShown = state.conversation.messages.some((message) =>
    (message.kind === 'toolCall' || message.kind === 'toolResult') && message.toolId === toolId
  )
  if (alreadyShown && phase === 'call') {
    return state
  }

  const title = phase === 'call' ? '工具调用' : ok ? '工具完成' : '工具失败'
  const message: ConversationMessage = phase === 'call'
    ? {
        createdAt: '刚刚',
        detail: toolId,
        id: `realtime-tool-call-${threadId}-${toolId}-${Date.now()}`,
        kind: 'toolCall',
        title,
        toolId,
      }
    : {
        createdAt: '刚刚',
        id: `realtime-tool-result-${threadId}-${toolId}-${Date.now()}`,
        kind: 'toolResult',
        ok,
        text: ok ? '工具调用完成。' : '工具调用失败。',
        title,
        toolId,
      }

  return {
    ...state,
    conversation: {
      ...state.conversation,
      messages: [
        ...state.conversation.messages,
        message,
      ],
    },
  }
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
