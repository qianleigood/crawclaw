#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
const desktopRoot = join(repoRoot, 'apps/crawclaw-desktop')
const artifactRoot = join(repoRoot, '.artifacts/desktop-e2e')
const sessionToken = 'desktop-e2e-session'

const args = new Set(process.argv.slice(2))
const headed = args.has('--headed')
const suite = valueAfter('--suite') ?? 'smoke'

const cleanupTasks = []
const consoleErrors = []
const timings = {}
const performanceBudgets = {
  'p0.initialReadyMs': 5000,
  'p1.newChatSwitchMs': 1000,
  'p1.threadSwitchMs': 1000,
  'p2.finalReplyMs': 2500,
  'p2.immediateSendFeedbackMs': 120,
  'p4.memoryNavMs': 1000,
  'p5.agentNavMs': 1000,
  'p6.pluginNavMs': 1000,
  'p7.settingsNavMs': 1000,
}

async function main() {
  await mkdir(artifactRoot, { recursive: true })

  try {
    const fakeApi = await startFakeDesktopApi()
    cleanupTasks.push(fakeApi.close)

    const vitePort = await freePort()
    const vite = await startVite(vitePort)
    cleanupTasks.push(vite.close)

    const chrome = await startChrome()
    cleanupTasks.push(chrome.close)

    const page = await chrome.openPage(`http://127.0.0.1:${String(vitePort)}/?desktopApiBaseUrl=${encodeURIComponent(fakeApi.baseUrl)}`)
    page.onConsoleError((message) => consoleErrors.push(message))

    try {
      await runP0Smoke(page)
      await runP1SidebarSelection(page, fakeApi)
      await runP2MessageResponsiveness(page, fakeApi)
      await runP3SubagentActivity(page)
      await runP4MemoryWorkspace(page)
      await runP5AgentWorkspace(page)
      await runP6PluginWorkspace(page)
      await runP7SettingsWorkspace(page)
      runP8PerformanceBudgets()
      if (consoleErrors.length > 0) {
        throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`)
      }
    } catch (error) {
      await writeFailureArtifacts(page, error)
      throw error
    }

    await writePerformanceReport()
    console.log(`[desktop-e2e] ${suite} passed`)
  } finally {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup().catch(() => undefined)
    }
  }
}

function valueAfter(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function runP0Smoke(page) {
  await measure('p0.initialReadyMs', () => page.waitFor(() => Boolean(document.querySelector('[data-testid="composer-input"]')), {
    label: 'composer is ready',
    timeoutMs: 15000,
  }))
  await page.waitFor(() => document.querySelectorAll('[data-testid="sidebar-nav-item"]').length >= 6, {
    label: 'sidebar nav is ready',
  })
}

async function runP1SidebarSelection(page, fakeApi) {
  const initial = await sidebarSelection(page)
  assertDeepEqual(initial.activeNavIds, [], 'active thread must suppress the New Chat nav highlight')
  assertDeepEqual(initial.activeThreadIds, ['thread-hello'], 'initial active thread should be selected')
  assert(await page.exists('[data-testid="context-summary"]'), 'thread context summary should be visible before New Chat')

  await page.click('[data-testid="sidebar-nav-item"][data-nav-id="new-chat"]')
  await measure('p1.newChatSwitchMs', () => page.waitFor(() => {
    const selection = {
      activeNavIds: Array.from(document.querySelectorAll('[data-testid="sidebar-nav-item"].is-active'))
        .map((element) => element.getAttribute('data-nav-id')),
      activeThreadIds: Array.from(document.querySelectorAll('[data-testid="sidebar-thread"].is-active'))
        .map((element) => element.getAttribute('data-thread-id')),
    }
    return selection.activeNavIds.length === 1
      && selection.activeNavIds[0] === 'new-chat'
      && selection.activeThreadIds.length === 0
      && !document.querySelector('[data-testid="context-summary"]')
  }, {
    label: 'New Chat clears active thread and context',
  }))

  await page.click('[data-testid="sidebar-thread"][data-thread-id="thread-hello"] .thread-row__main')
  await measure('p1.threadSwitchMs', () => page.waitFor(() => {
    const selection = {
      activeNavIds: Array.from(document.querySelectorAll('[data-testid="sidebar-nav-item"].is-active'))
        .map((element) => element.getAttribute('data-nav-id')),
      activeThreadIds: Array.from(document.querySelectorAll('[data-testid="sidebar-thread"].is-active'))
        .map((element) => element.getAttribute('data-thread-id')),
    }
    return selection.activeNavIds.length === 0
      && selection.activeThreadIds.length === 1
      && selection.activeThreadIds[0] === 'thread-hello'
      && Boolean(document.querySelector('[data-testid="context-summary"]'))
  }, {
    label: 'thread selection has exactly one selected thread',
  }))

  await fakeApi.setStaleEmptyContext()
  await page.waitFor(() => {
    const selection = {
      activeNavIds: Array.from(document.querySelectorAll('[data-testid="sidebar-nav-item"].is-active'))
        .map((element) => element.getAttribute('data-nav-id')),
      activeThreadIds: Array.from(document.querySelectorAll('[data-testid="sidebar-thread"].is-active'))
        .map((element) => element.getAttribute('data-thread-id')),
    }
    return selection.activeNavIds.length === 1
      && selection.activeNavIds[0] === 'new-chat'
      && selection.activeThreadIds.length === 0
      && document.body.textContent?.includes('开始一个本机任务')
      && !document.querySelector('[data-testid="context-summary"]')
  }, {
    label: 'empty New Chat hides stale backend context',
  })
}

async function runP2MessageResponsiveness(page, fakeApi) {
  await fakeApi.setSubagentMode('running')
  await page.fill('[data-testid="composer-input"]', 'E2E immediate send')
  await page.click('[data-testid="composer-send"]')

  await measure('p2.immediateSendFeedbackMs', () => page.waitFor(() => (
    document.querySelector('[data-testid="composer-stop"]')
      && Array.from(document.querySelectorAll('[data-testid="conversation-message"][data-message-kind="user"]'))
        .some((element) => element.textContent?.includes('E2E immediate send'))
  ), {
    label: 'user message and stop button appear immediately',
    timeoutMs: 120,
  }))

  await assertRunningSubagentActivity(page)

  await measure('p2.finalReplyMs', () => page.waitFor(() => (
    Array.from(document.querySelectorAll('[data-testid="conversation-message"][data-message-kind="assistant"]'))
      .some((element) => element.textContent?.includes('E2E final reply'))
      && document.querySelector('[data-testid="composer-send"]')
      && !document.querySelector('[data-testid="composer-stop"]')
  ), {
    label: 'assistant final reply replaces running state',
    timeoutMs: 2500,
  }))

  const hasOperationFailure = await page.evaluate(() => document.body.textContent?.includes('操作失败') ?? false)
  assert(!hasOperationFailure, 'successful send must not show an operation failure bubble')
  await assertPerformanceMarks(page, [
    'crawclaw.desktop.send.click',
    'crawclaw.desktop.send.optimistic',
    'crawclaw.desktop.state.request.start',
    'crawclaw.desktop.state.request.success',
    'crawclaw.desktop.sse.message_delta.received',
    'crawclaw.desktop.sse.message_delta.render',
    'crawclaw.desktop.sse.message_final.received',
  ])
}

async function runP3SubagentActivity(page) {
  await page.waitFor(() => !document.querySelector('[data-testid="subagent-activity-panel"]'), {
    label: 'subagent activity hides after worker stops',
    timeoutMs: 4500,
  })
}

async function runP4MemoryWorkspace(page) {
  await page.click('[data-testid="sidebar-nav-item"][data-nav-id="memory"]')
  await measure('p4.memoryNavMs', () => page.waitFor(() => Boolean(document.querySelector('[data-testid="memory-workspace"]')), {
    label: 'memory workspace is visible',
  }))

  const runtimeText = await page.text('[data-testid="memory-runtime-strip"]')
  assert(runtimeText.includes('Hindsight') && runtimeText.includes('Worker') && runtimeText.includes('Outbox'), 'memory runtime strip should expose Hindsight, Worker, and Outbox')
  assert(runtimeText.includes('pending'), `memory outbox status should show pending count, got ${JSON.stringify(runtimeText)}`)
  assert(await page.exists('[data-testid="memory-list-item"][data-memory-id="memory-e2e-cn"]'), 'Chinese memory fixture should be visible')

  await page.fill('[data-testid="memory-search-input"]', '中文质量')
  await page.waitFor(() => (
    document.querySelector('[data-testid="memory-search-input"]')?.value === '中文质量'
      && document.querySelectorAll('[data-testid="memory-list-item"]').length === 1
      && Boolean(document.querySelector('[data-testid="memory-list-item"][data-memory-id="memory-e2e-cn"]'))
  ), {
    label: 'Chinese memory search filters the list',
  })

  await page.fill('[data-testid="memory-search-input"]', '')
  await page.waitFor(() => document.querySelector('[data-testid="memory-search-input"]')?.value === '', {
    label: 'memory search clears before create',
  })
  await page.click('[data-testid="memory-add-open"]')
  await page.fill('[data-testid="memory-add-title"]', 'E2E 新增记忆')
  await page.fill('[data-testid="memory-add-summary"]', '发送体验需要即时反馈')
  await page.fill('[data-testid="memory-add-content"]', '用户发送消息后，自己的消息和停止按钮必须立即出现。')
  await page.click('[data-testid="memory-add-submit"]')
  await page.waitFor(() => (
    Boolean(document.querySelector('[data-testid="memory-list-item"][data-memory-id="memory-created-e2e"]'))
      && Boolean(document.querySelector('[data-testid="memory-detail"][data-memory-id="memory-created-e2e"]'))
  ), {
    label: 'created memory appears in list and detail',
  })
}

async function runP5AgentWorkspace(page) {
  await page.click('[data-testid="sidebar-nav-item"][data-nav-id="agent"]')
  await measure('p5.agentNavMs', () => page.waitFor(() => Boolean(document.querySelector('[data-testid="agent-workspace"]')), {
    label: 'agent workspace is visible',
  }))

  await page.waitFor(() => (
    Boolean(document.querySelector('[data-testid="agent-list-row"][data-agent-id="agent-e2e"]'))
      && Boolean(document.querySelector('[data-testid="agent-summary"][data-agent-id="agent-e2e"]'))
  ), {
    label: 'selected agent summary is visible',
  })

  await page.click('[data-testid="agent-tool-toggle"][data-tool-id="tool-e2e"]')
  await page.waitFor(() => (
    document.querySelector('[data-testid="agent-tool-toggle"][data-tool-id="tool-e2e"]')?.getAttribute('aria-pressed') === 'false'
  ), {
    label: 'agent tool toggle updates state',
  })

  await page.click('[data-testid="agent-skill-toggle"][data-skill-id="skill-e2e"]')
  await page.waitFor(() => (
    document.querySelector('[data-testid="agent-skill-toggle"][data-skill-id="skill-e2e"]')?.getAttribute('aria-pressed') === 'true'
  ), {
    label: 'agent skill toggle updates state',
  })
}

async function runP6PluginWorkspace(page) {
  await page.click('[data-testid="sidebar-nav-item"][data-nav-id="plugins"]')
  await measure('p6.pluginNavMs', () => page.waitFor(() => Boolean(document.querySelector('[data-testid="plugin-workspace"]')), {
    label: 'plugin workspace is visible',
  }))

  assert(await page.exists('[data-testid="plugin-tool-row"][data-plugin-id="e2e-plugin"][data-tool-id="tool-e2e"]'), 'plugin tool row should be visible')
  assert(await page.exists('[data-testid="plugin-skill-row"][data-skill-id="plugin-skill-e2e"]'), 'plugin skill row should be visible')
  assert(await page.exists('[data-testid="plugin-installed-row"][data-installed-plugin-id="e2e-plugin"]'), 'installed plugin row should be visible')

  await page.click('[data-testid="plugin-tool-row"][data-tool-id="tool-e2e"] [data-testid="plugin-tool-open"]')
  await page.waitFor(() => Boolean(document.querySelector('[data-testid="plugin-tool-dialog"]')), {
    label: 'plugin tool dialog opens',
  })

  await page.click('[data-testid="plugin-use-switch"]')
  await page.waitFor(() => (
    document.querySelector('[data-testid="plugin-use-switch"]')?.getAttribute('aria-pressed') === 'false'
  ), {
    label: 'plugin tool can be disabled',
  })
  await page.click('[data-testid="plugin-use-switch"]')
  await page.waitFor(() => (
    document.querySelector('[data-testid="plugin-use-switch"]')?.getAttribute('aria-pressed') === 'true'
  ), {
    label: 'plugin tool can be enabled',
  })

  await page.fill('[data-testid="plugin-tool-input"]', '{"query":"e2e"}')
  await page.click('[data-testid="plugin-tool-run"]')
  await page.waitFor(() => document.body.textContent?.includes('已写入对话结果。'), {
    label: 'plugin tool run reports success',
  })
}

async function runP7SettingsWorkspace(page) {
  await page.click('[data-testid="sidebar-settings"]')
  await measure('p7.settingsNavMs', () => page.waitFor(() => Boolean(document.querySelector('[data-testid="settings-workspace"]')), {
    label: 'settings workspace is visible',
  }))

  await page.click('[data-testid="settings-sidebar-section"][data-settings-section="permissions"]')
  await page.waitFor(() => Boolean(document.querySelector('[data-testid="settings-section"][data-settings-section="permissions"].is-active')), {
    label: 'permissions settings section is active',
  })
  await page.selectOption('[data-testid="settings-select-row"][data-setting-label="权限模式"] [data-testid="settings-select"]', '只读模式')
  await page.waitFor(() => (
    document.querySelector('[data-testid="settings-select-row"][data-setting-label="权限模式"] [data-testid="settings-select"]')?.value === '只读模式'
  ), {
    label: 'permission mode preference updates',
  })

  await page.click('[data-testid="settings-sidebar-section"][data-settings-section="memory"]')
  await page.waitFor(() => Boolean(document.querySelector('[data-testid="settings-section"][data-settings-section="memory"].is-active')), {
    label: 'memory settings section is active',
  })
  await page.click('[data-testid="settings-toggle-row"][data-setting-label="整理项目上下文"] [data-testid="settings-toggle"]')
  await page.waitFor(() => (
    document.querySelector('[data-testid="settings-toggle-row"][data-setting-label="整理项目上下文"] [data-testid="settings-toggle"]')?.getAttribute('aria-pressed') === 'false'
  ), {
    label: 'memory preference toggle updates',
  })

  await page.click('[data-testid="settings-sidebar-section"][data-settings-section="advanced"]')
  await page.waitFor(() => Boolean(document.querySelector('[data-testid="settings-section"][data-settings-section="advanced"].is-active')), {
    label: 'advanced settings section is active',
  })
  assert(await page.exists('[data-testid="settings-action-row"][data-setting-label="诊断信息"] [data-testid="settings-action"]'), 'diagnostics action should be visible')
}

function runP8PerformanceBudgets() {
  const failures = Object.entries(performanceBudgets).flatMap(([name, budget]) => {
    const value = timings[name]
    if (typeof value !== 'number') {
      return [`${name} did not record a timing`]
    }
    return value <= budget ? [] : [`${name} took ${value}ms, budget ${budget}ms`]
  })
  assert(failures.length === 0, `Performance budgets failed:\n${failures.join('\n')}`)
}

async function assertRunningSubagentActivity(page) {
  await page.waitFor(() => Boolean(document.querySelector('[data-testid="subagent-activity-panel"]')), {
    label: 'running subagent activity appears',
    timeoutMs: 1000,
  })
  const runningItems = await page.evaluate(() => Array.from(
    document.querySelectorAll('[data-testid="subagent-activity-item"]'),
  ).map((element) => element.textContent?.replace(/\s+/g, ' ').trim()))
  assert(
    runningItems.some((item) => item?.includes('E2E worker') && item.includes('工作中')),
    `running subagent item should be visible, got ${JSON.stringify(runningItems)}`,
  )
}

async function assertPerformanceMarks(page, expectedMarks) {
  const actualMarks = await page.evaluate(() => performance.getEntriesByType('mark').map((entry) => entry.name))
  const missingMarks = expectedMarks.filter((mark) => !actualMarks.includes(mark))
  assert(
    missingMarks.length === 0,
    `missing desktop performance marks ${JSON.stringify(missingMarks)} from ${JSON.stringify(actualMarks)}`,
  )
}

async function sidebarSelection(page) {
  return page.evaluate(domSidebarSelection)
}

function domSidebarSelection() {
  return {
    activeNavIds: Array.from(document.querySelectorAll('[data-testid="sidebar-nav-item"].is-active'))
      .map((element) => element.getAttribute('data-nav-id')),
    activeThreadIds: Array.from(document.querySelectorAll('[data-testid="sidebar-thread"].is-active'))
      .map((element) => element.getAttribute('data-thread-id')),
  }
}

async function startFakeDesktopApi() {
  const state = createInitialDesktopState()
  const clients = new Set()
  let subagentMode = 'idle'
  let messageSequence = 0

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'content-type,x-crawclaw-desktop-session')
    response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (url.pathname === '/__e2e/subagents') {
      subagentMode = url.searchParams.get('mode') ?? 'idle'
      json(response, { ok: true })
      return
    }

    if (url.pathname === '/__e2e/stale-empty-context') {
      state.activeNavId = 'new-chat'
      for (const thread of state.sidebar.pinnedThreads) {
        thread.active = false
      }
      for (const thread of state.sidebar.threads) {
        thread.active = false
      }
      for (const thread of state.sidebar.discussionThreads) {
        thread.active = false
      }
      state.conversation.messages = []
      state.conversation.resultItems = []
      state.conversation.contextSummary = contextSummary(4, 703)
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, { ok: true })
      return
    }

    if (url.pathname === '/api/desktop/bootstrap') {
      json(response, {
        app: { name: 'CrawClaw Desktop E2E', version: 'test' },
        api: {
          baseUrl,
          eventsUrl: `${baseUrl}/api/desktop/events`,
          sessionToken,
        },
        runtime: runtimeStatus(),
        desktopState: state,
      })
      return
    }

    if (!authorized(request, url)) {
      json(response, { code: 'unauthorized', message: 'unauthorized' }, 401)
      return
    }

    if (url.pathname === '/api/desktop/events') {
      response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
      })
      clients.add(response)
      sendSse(response, 'runtime', { type: 'runtime', status: 'ready', detail: 'E2E runtime ready' })
      request.on('close', () => clients.delete(response))
      return
    }

    if (url.pathname === '/api/desktop/state') {
      json(response, state)
      return
    }

    if (url.pathname === '/api/desktop/runtime') {
      json(response, runtimeStatus())
      return
    }

    if (url.pathname === '/api/desktop/subagents') {
      json(response, {
        subagents: subagentMode === 'running'
          ? [{
              key: 'subagent-e2e',
              title: 'E2E worker',
              pinned: false,
              status: 'running',
              messageCount: 2,
              spawnedBy: url.searchParams.get('parentSessionKey') ?? 'thread-hello',
              yielded: false,
            }]
          : [{
              key: 'subagent-e2e-done',
              title: 'E2E worker done',
              pinned: false,
              status: 'idle',
              messageCount: 2,
              spawnedBy: url.searchParams.get('parentSessionKey') ?? 'thread-hello',
              yielded: true,
            }],
      })
      return
    }

    if (url.pathname === '/api/desktop/navigation/select' && request.method === 'POST') {
      const body = await readJson(request)
      state.activeNavId = body.navId
      if (body.navId === 'new-chat') {
        for (const thread of state.sidebar.pinnedThreads) {
          thread.active = false
        }
        for (const thread of state.sidebar.threads) {
          thread.active = false
        }
        for (const thread of state.sidebar.discussionThreads) {
          thread.active = false
        }
        state.conversation.messages = []
        state.conversation.resultItems = []
        delete state.conversation.contextSummary
      }
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname === '/api/desktop/threads/select' && request.method === 'POST') {
      const body = await readJson(request)
      selectThread(state, body.threadId)
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname === '/api/desktop/messages' && request.method === 'POST') {
      const body = await readJson(request)
      const activeThread = activeThreadId(state) || 'thread-hello'
      const runId = `run-e2e-${++messageSequence}`
      subagentMode = 'running'
      selectThread(state, activeThread)
      state.conversation.messages = [
        ...state.conversation.messages,
        {
          kind: 'user',
          id: `user-e2e-${messageSequence}`,
          text: body.text,
          createdAt: '刚刚',
        },
        {
          kind: 'assistant',
          id: `assistant-e2e-${messageSequence}`,
          text: '',
          status: 'running',
          runId,
          createdAt: '刚刚',
        },
      ]
      state.conversation.contextSummary = contextSummary(1, 48)

      setTimeout(() => {
        emit('messageDelta', { type: 'messageDelta', threadId: activeThread, text: 'E2E partial reply' })
      }, 320)
      setTimeout(() => {
        const assistant = state.conversation.messages.find((message) => message.id === `assistant-e2e-${messageSequence}`)
        if (assistant) {
          assistant.text = 'E2E final reply'
          assistant.status = 'done'
        }
        subagentMode = 'idle'
        emit('messageFinal', {
          type: 'messageFinal',
          threadId: activeThread,
          role: 'assistant',
          text: 'E2E final reply',
        })
      }, 700)

      await delay(250)
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname === '/api/desktop/preferences' && request.method === 'PATCH') {
      const patch = await readJson(request)
      state.preferences = mergePreferences(state.preferences, patch)
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname === '/api/desktop/memory/query' && request.method === 'PATCH') {
      const body = await readJson(request)
      state.memoryWorkspace.query = String(body.query ?? '')
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname === '/api/desktop/memory/filter' && request.method === 'PATCH') {
      const body = await readJson(request)
      state.memoryWorkspace.filter = String(body.filter ?? '全部')
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/memory/items/') && url.pathname.endsWith('/select') && request.method === 'POST') {
      const itemId = decodeURIComponent(url.pathname.split('/').at(-2) ?? '')
      state.memoryWorkspace.selectedItemId = itemId
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/memory/agents/') && url.pathname.endsWith('/select') && request.method === 'POST') {
      const agentId = decodeURIComponent(url.pathname.split('/').at(-2) ?? '')
      state.memoryWorkspace.selectedAgentId = agentId
      state.memoryWorkspace.selectedItemId = state.memoryWorkspace.items.find((item) => item.agentId === agentId && !item.archived)?.id ?? ''
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname === '/api/desktop/memory/items' && request.method === 'POST') {
      const body = await readJson(request)
      const item = {
        id: 'memory-created-e2e',
        agentId: body.agentId || state.memoryWorkspace.selectedAgentId,
        title: String(body.title ?? ''),
        summary: String(body.summary ?? ''),
        content: String(body.content ?? ''),
        category: body.category || '其他',
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        source: String(body.source ?? 'manual'),
        provider: 'local',
        layer: 'local',
        bankId: 'desktop-e2e',
        syncStatus: 'pending',
        updatedAt: '刚刚',
        archived: false,
      }
      state.memoryWorkspace.items = [
        item,
        ...state.memoryWorkspace.items.filter((memory) => memory.id !== item.id),
      ]
      state.memoryWorkspace.selectedItemId = item.id
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/memory/items/') && url.pathname.endsWith('/archive') && request.method === 'POST') {
      const itemId = decodeURIComponent(url.pathname.split('/').at(-2) ?? '')
      state.memoryWorkspace.items = state.memoryWorkspace.items.map((item) => item.id === itemId ? { ...item, archived: true } : item)
      state.memoryWorkspace.selectedItemId = state.memoryWorkspace.items.find((item) => !item.archived)?.id ?? ''
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname === '/api/desktop/memory/dream/run' && request.method === 'POST') {
      const body = await readJson(request)
      state.memoryWorkspace.dream = {
        agentId: body.agentId || state.memoryWorkspace.selectedAgentId,
        lastRunAt: '刚刚',
        message: 'E2E memory dream completed',
        status: 'completed',
      }
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/agents/') && url.pathname.endsWith('/select') && request.method === 'POST') {
      const agentId = decodeURIComponent(url.pathname.split('/').at(-2) ?? '')
      state.agentWorkspace.selectedAgentId = agentId
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/agents/') && url.pathname.includes('/tools/') && url.pathname.endsWith('/toggle') && request.method === 'POST') {
      const parts = url.pathname.split('/')
      const agentId = decodeURIComponent(parts.at(-4) ?? '')
      const toolId = decodeURIComponent(parts.at(-2) ?? '')
      state.agentWorkspace.agents = state.agentWorkspace.agents.map((agent) => agent.id === agentId
        ? {
            ...agent,
            tools: agent.tools.map((tool) => tool.id === toolId ? { ...tool, enabled: !tool.enabled } : tool),
          }
        : agent)
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/agents/') && url.pathname.includes('/skills/') && url.pathname.endsWith('/toggle') && request.method === 'POST') {
      const parts = url.pathname.split('/')
      const agentId = decodeURIComponent(parts.at(-4) ?? '')
      const skillId = decodeURIComponent(parts.at(-2) ?? '')
      state.agentWorkspace.agents = state.agentWorkspace.agents.map((agent) => agent.id === agentId
        ? {
            ...agent,
            skills: agent.skills.map((skill) => skill.id === skillId ? { ...skill, enabled: !skill.enabled } : skill),
          }
        : agent)
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/plugins/tools/') && url.pathname.endsWith('/enabled') && request.method === 'PATCH') {
      const body = await readJson(request)
      const toolId = decodeURIComponent(url.pathname.split('/').at(-2) ?? '')
      state.pluginsWorkspace.tools = state.pluginsWorkspace.tools.map((tool) => tool.id === toolId ? { ...tool, enabled: Boolean(body.enabled) } : tool)
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/plugins/skills/') && url.pathname.endsWith('/enabled') && request.method === 'PATCH') {
      const body = await readJson(request)
      const skillId = decodeURIComponent(url.pathname.split('/').at(-2) ?? '')
      state.pluginsWorkspace.skills = state.pluginsWorkspace.skills.map((skill) => skill.id === skillId ? { ...skill, enabled: Boolean(body.enabled) } : skill)
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/plugins/') && url.pathname.endsWith('/invoke') && request.method === 'POST') {
      const parts = url.pathname.split('/')
      const pluginId = decodeURIComponent(parts.at(-4) ?? '')
      const toolId = decodeURIComponent(parts.at(-2) ?? '')
      state.conversation.messages = [
        ...state.conversation.messages,
        {
          kind: 'toolResult',
          id: `tool-result-${pluginId}-${toolId}`,
          toolId,
          title: `${pluginId}/${toolId}`,
          ok: true,
          text: 'E2E plugin tool result',
          createdAt: '刚刚',
        },
      ]
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname.startsWith('/api/desktop/plugins/') && url.pathname.endsWith('/enabled') && request.method === 'PATCH') {
      const body = await readJson(request)
      const pluginId = decodeURIComponent(url.pathname.split('/').at(-2) ?? '')
      state.pluginsWorkspace.installed = state.pluginsWorkspace.installed.map((plugin) => plugin.id === pluginId ? { ...plugin, enabled: Boolean(body.enabled) } : plugin)
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    if (url.pathname === '/api/desktop/settings/diagnostics' && request.method === 'POST') {
      state.conversation.resultItems = ['E2E diagnostics generated']
      emit('stateChanged', { type: 'stateChanged', desktopState: state })
      json(response, state)
      return
    }

    json(response, { code: 'not_found', message: `No fake route for ${request.method} ${url.pathname}` }, 404)
  })

  const port = await listen(server)
  const baseUrl = `http://127.0.0.1:${String(port)}`
  return {
    baseUrl,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
    setSubagentMode: async (mode) => {
      const response = await fetch(`${baseUrl}/__e2e/subagents?mode=${encodeURIComponent(mode)}`)
      if (!response.ok) {
        throw new Error(`failed to set subagent mode: ${response.status}`)
      }
    },
    setStaleEmptyContext: async () => {
      const response = await fetch(`${baseUrl}/__e2e/stale-empty-context`)
      if (!response.ok) {
        throw new Error(`failed to inject stale empty context: ${response.status}`)
      }
    },
  }

  function emit(event, payload) {
    for (const client of clients) {
      sendSse(client, event, payload)
    }
  }
}

function createInitialDesktopState() {
  return {
    activeNavId: 'new-chat',
    sidebar: {
      navItems: [
        { id: 'new-chat', label: '新对话', icon: 'squarePen' },
        { id: 'search', label: '搜索', icon: 'search' },
        { id: 'agent', label: '智能体', icon: 'bot' },
        { id: 'plugins', label: '插件', icon: 'blocks' },
        { id: 'automation', label: '自动化', icon: 'clock3' },
        { id: 'memory', label: '记忆', icon: 'brain' },
      ],
      pinnedThreads: [],
      threads: [
        { id: 'thread-hello', title: '你好', time: '已保存', active: true, agentAvatar: true },
        { id: 'thread-e2e', title: 'E2E 子任务', time: '已保存', active: false, agentAvatar: true },
      ],
      discussionThreads: [],
    },
    conversation: {
      messages: [
        { kind: 'user', id: 'msg-user-hello', text: '你好', createdAt: '刚刚' },
        { kind: 'assistant', id: 'msg-assistant-hello', text: '你好！有什么可以帮你的？', status: 'done', createdAt: '刚刚' },
      ],
      resultItems: ['用户: 你好', '你好！有什么可以帮你的？'],
      runtimeChecks: [
        { label: 'Desktop Shell', value: '已加载', tone: 'ok' },
        { label: 'Desktop API', value: 'ready', tone: 'ok' },
        { label: 'Runtime', value: 'ready', tone: 'ok' },
      ],
      slashCommands: [],
      skillCommands: [],
      draftMessages: [],
      contextSummary: contextSummary(4, 703),
    },
    agentWorkspace: { selectedAgentId: 'agent-e2e', agents: [e2eAgent()] },
    memoryWorkspace: {
      selectedAgentId: 'agent-e2e',
      selectedItemId: 'memory-e2e-cn',
      filter: '全部',
      query: '',
      dream: { status: 'idle', agentId: '', message: '', lastRunAt: '' },
      runtimeStatus: e2eMemoryRuntimeStatus(),
      items: [e2eChineseMemory()],
    },
    pluginsWorkspace: e2ePluginsWorkspace(),
    preferences: {
      selectedModel: 'minimax/MiniMax-M2.7',
      selectedThinking: 'default',
      permissionMode: '工作区模式',
      taskDefaults: {
        selectedModel: 'minimax/MiniMax-M2.7',
        selectedThinking: 'default',
        permissionMode: '工作区模式',
        responseSpeed: '标准',
        allowTools: true,
      },
      confirmationDefaults: {
        confirmFileChanges: false,
        confirmCommands: false,
        confirmExternalApps: false,
        confirmHighRisk: false,
      },
      notificationDefaults: {
        notifyTaskDone: false,
        notifyConfirmNeeded: false,
        notifyDreamDone: false,
        notifyAutomationFailed: false,
        notificationSound: false,
      },
      uiDefaults: {
        defaultPage: '新对话',
        language: '中文',
        appearance: '跟随系统',
        launchAtLogin: false,
        showInMenuBar: true,
      },
      memoryDefaults: {
        rememberPreferences: true,
        rememberProjectContext: true,
        memoryDreamEnabled: true,
        memoryDreamFrequency: '空闲时',
        memoryCleanupConfirmation: '每次确认',
      },
      privacyDefaults: { dataLocation: 'E2E runtime root' },
      advancedDefaults: { logLevel: '标准' },
      modelOptions: ['minimax/MiniMax-M2.7', 'openai/gpt-5.4'],
      modelProfiles: [{
        id: 'profile-e2e-minimax',
        label: 'MiniMax M2.7 E2E',
        modelRef: 'minimax/MiniMax-M2.7',
        source: 'builtin',
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        authMethod: 'api-key',
        hasCredential: true,
        baseUrl: 'https://api.minimax.io/v1',
        lastConnectionStatus: 'connected',
        lastConnectionDetail: 'E2E fixture',
        lastConnectedAt: '刚刚',
      }],
      providerDescriptors: [{
        id: 'minimax',
        label: 'MiniMax',
        defaultModel: 'MiniMax-M2.7',
        modelChoices: ['MiniMax-M2.7'],
      }],
      providerSetupOptions: [],
      providerModelPickerEntries: [],
      webProviderBoundaries: [],
      thinkingOptions: ['default', 'high', 'medium', 'low'],
      permissionModeOptions: ['工作区模式', '只读模式', '完全访问'],
    },
    permissionRequest: { id: '', title: '', detail: '', status: 'denied' },
    searchSuggestions: [],
  }
}

function e2eAgent() {
  return {
    id: 'agent-e2e',
    name: 'E2E Agent',
    role: '桌面测试智能体',
    description: '覆盖桌面端 agent、memory 和 plugin 工作区。',
    status: '空闲',
    model: 'minimax/MiniMax-M2.7',
    thinking: 'default',
    permissionMode: '工作区模式',
    emotion: {
      style: '清晰',
      tone: '直接',
      boundaries: ['不要编造测试结果'],
      promptMd: 'E2E fixture agent.',
    },
    voice: {
      enabled: false,
      inputEnabled: false,
      outputEnabled: false,
      wakeEnabled: false,
      source: 'none',
      presetVoice: '',
      designPrompt: '',
      cloneVoiceName: '',
      cloneSampleName: '',
      style: '',
      pace: '',
    },
    channels: [{
      id: 'desktop',
      label: '桌面',
      enabled: true,
    }],
    avatar: {
      initials: 'E2E',
      gradient: 'blue',
    },
    tools: [{
      id: 'tool-e2e',
      name: 'E2E 工具',
      description: '用于端到端开关验证的本机工具。',
      status: '已启用',
      permission: 'local',
      icon: 'wrench',
      open: false,
      enabled: true,
    }],
    skills: [{
      id: 'skill-e2e',
      name: 'E2E Skill',
      trigger: '$e2e',
      description: '用于端到端开关验证的技能。',
      status: '已停用',
      source: 'local',
      icon: 'sparkles',
      open: false,
      enabled: false,
    }],
  }
}

function e2eChineseMemory() {
  return {
    id: 'memory-e2e-cn',
    agentId: 'agent-e2e',
    title: '中文质量保障',
    summary: '中文长文本切块、query rewrite、召回阈值和 rerank 需要闭环验证。',
    content: '中文质量保障需要覆盖中文长文本、中文 query rewrite、中英混合召回、rerank top-k 和阈值调优。',
    category: '项目',
    tags: ['中文质量', '召回', 'rerank'],
    source: 'hindsight',
    provider: 'local',
    layer: 'local',
    bankId: 'desktop-e2e',
    syncStatus: 'synced',
    updatedAt: '刚刚',
    archived: false,
  }
}

function e2eMemoryRuntimeStatus() {
  return {
    status: 'ready',
    hindsight: {
      lifecycle: {
        managed: true,
        mode: 'embedded',
        status: 'ready',
      },
    },
    worker: {
      enabled: true,
      lastProcessedCount: 2,
      lastRunStatus: 'ready',
    },
    outbox: {
      total: 3,
      statusCounts: {
        pending: 1,
        synced: 2,
      },
    },
  }
}

function e2ePluginsWorkspace() {
  return {
    tools: [{
      id: 'tool-e2e',
      pluginId: 'e2e-plugin',
      name: 'E2E Tool',
      description: '端到端插件工具验证。',
      status: '已启用',
      permission: 'local',
      icon: 'wrench',
      enabled: true,
      source: 'local',
      installStatus: '本地',
      open: false,
    }],
    skills: [{
      id: 'plugin-skill-e2e',
      skillKey: 'e2e.skill',
      name: 'E2E Plugin Skill',
      trigger: '$plugin-e2e',
      description: '端到端插件 Skill 验证。',
      status: '已启用',
      source: 'local',
      icon: 'sparkles',
      enabled: true,
      installStatus: '本地',
      open: false,
    }],
    installed: [{
      id: 'e2e-plugin',
      name: 'E2E Plugin',
      status: '已安装',
      source: 'local',
      installStatus: '本地',
      enabled: true,
      version: '0.0.0-e2e',
      manifestPath: '/tmp/crawclaw-desktop-e2e/plugin.json',
      open: false,
    }],
  }
}

function mergePreferences(preferences, patch) {
  const next = {
    ...preferences,
    ...patch,
  }
  for (const key of [
    'advancedDefaults',
    'confirmationDefaults',
    'memoryDefaults',
    'notificationDefaults',
    'privacyDefaults',
    'taskDefaults',
    'uiDefaults',
  ]) {
    if (patch[key]) {
      next[key] = {
        ...preferences[key],
        ...patch[key],
      }
    }
  }
  if (patch.taskDefaults?.selectedModel) {
    next.selectedModel = patch.taskDefaults.selectedModel
  }
  if (patch.taskDefaults?.selectedThinking) {
    next.selectedThinking = patch.taskDefaults.selectedThinking
  }
  if (patch.taskDefaults?.permissionMode) {
    next.permissionMode = patch.taskDefaults.permissionMode
  }
  return next
}

function contextSummary(messageCount, estimatedTokens) {
  return {
    profileKind: 'normal',
    parentContextPolicy: 'current_session',
    agentDefinition: 'main',
    projectedMessageCount: messageCount,
    projectedHistoryEstimatedTokens: Math.max(0, estimatedTokens - 100),
    projectedToolResultCount: 0,
    projectedToolResultOmittedChars: 0,
    persistedToolResultCount: 0,
    capabilityProjectionApplied: false,
    toolResultProjectionApplied: false,
    historyCompactionApplied: false,
    overflowProjectionApplied: false,
    projectionReason: 'E2E context fixture',
    provider: 'openai-compatible',
    model: 'minimax/MiniMax-M2.7',
    modelContextWindow: 128000,
    resolvedContextWindow: 128000,
    effectivePromptBudget: 96000,
    outputReserveTokens: 4096,
    providerOverheadTokens: 64,
    toolSchemaTokens: 256,
    budgetSource: 'model-profile',
    supportsTools: true,
    supportsReasoning: false,
    supportsImageInput: true,
    supportsStreaming: true,
    budgetState: 'within-budget',
    overflowRetryEnabled: false,
    includedTools: ['tool_search', 'load_skill', 'discover_skills', 'sessions_list'],
    deferredTools: Array.from({ length: 64 }, (_, index) => `deferred_tool_${index + 1}`),
    deferredToolCount: 64,
    activatedTools: [],
    surfacedSkills: [],
    loadedSkills: [],
    loadedSkillCount: 0,
    memorySnippets: [],
    memorySnippetCount: 0,
    compactionActive: false,
    compactSummaryApplied: false,
    retainedMessageCount: 0,
    warnings: [],
    messageCount,
    estimatedTokens,
  }
}

function selectThread(state, threadId) {
  state.activeNavId = 'new-chat'
  for (const thread of state.sidebar.pinnedThreads) {
    thread.active = thread.id === threadId
  }
  for (const thread of state.sidebar.threads) {
    thread.active = thread.id === threadId
  }
  for (const thread of state.sidebar.discussionThreads) {
    thread.active = thread.id === threadId
  }
  if (threadId === 'thread-hello') {
    state.conversation.messages = [
      { kind: 'user', id: 'msg-user-hello', text: '你好', createdAt: '刚刚' },
      { kind: 'assistant', id: 'msg-assistant-hello', text: '你好！有什么可以帮你的？', status: 'done', createdAt: '刚刚' },
    ]
    state.conversation.resultItems = ['用户: 你好', '你好！有什么可以帮你的？']
    state.conversation.contextSummary = contextSummary(4, 703)
  }
}

function activeThreadId(state) {
  return [
    ...state.sidebar.pinnedThreads,
    ...state.sidebar.threads,
    ...state.sidebar.discussionThreads,
  ].find((thread) => thread.active)?.id ?? ''
}

function runtimeStatus() {
  return {
    status: 'ready',
    detail: 'E2E runtime ready',
    runtimeRoot: '/tmp/crawclaw-desktop-e2e',
    binaryPath: '/tmp/crawclaw-desktop-e2e/crawclaw-runtime',
    compat: { mode: 'none', detail: '' },
  }
}

async function startVite(port) {
  const child = spawn('pnpm', [
    '--dir',
    desktopRoot,
    'exec',
    'vite',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  child.stdout.on('data', (data) => logs.push(data.toString()))
  child.stderr.on('data', (data) => logs.push(data.toString()))
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      logs.push(`[vite exited ${code}]`)
    }
  })

  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      return response.ok
    } catch {
      return false
    }
  }, {
    label: `Vite on ${port}`,
    timeoutMs: 15000,
    onTimeout: () => logs.join(''),
  })

  return {
    close: () => terminate(child),
  }
}

async function startChrome() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'crawclaw-desktop-e2e-chrome-'))
  const chromePath = await resolveChromePath()
  const logs = []
  const child = spawn(chromePath, [
    headed ? '' : '--headless=new',
    '--disable-background-networking',
    '--disable-gpu',
    '--disable-search-engine-choice-screen',
    '--no-default-browser-check',
    '--no-first-run',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1200,900',
    'about:blank',
  ].filter(Boolean), {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (data) => logs.push(data.toString()))
  child.stderr.on('data', (data) => logs.push(data.toString()))
  child.on('exit', (code, signal) => {
    logs.push(`[chrome exited ${code ?? signal ?? 'unknown'}]`)
  })

  const devToolsPortPath = join(userDataDir, 'DevToolsActivePort')
  const port = await waitFor(async () => {
    try {
      const [line] = (await readFile(devToolsPortPath, 'utf8')).split('\n')
      return Number(line) || false
    } catch {
      return false
    }
  }, {
    label: 'Chrome DevTools port',
    timeoutMs: 15000,
    onTimeout: () => logs.join(''),
  })

  return {
    close: async () => {
      await terminate(child)
      await rm(userDataDir, { force: true, recursive: true })
    },
    openPage: async (url) => {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
        method: 'PUT',
      })
      if (!response.ok) {
        throw new Error(`Failed to open Chrome page: HTTP ${response.status}`)
      }
      const target = await response.json()
      const client = await CdpPage.connect(target.webSocketDebuggerUrl)
      await client.send('Runtime.enable')
      await client.send('Page.enable')
      return client
    },
  }
}

class CdpPage {
  static async connect(webSocketDebuggerUrl) {
    const socket = new WebSocket(webSocketDebuggerUrl)
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true })
      socket.addEventListener('error', rejectOpen, { once: true })
    })
    return new CdpPage(socket)
  }

  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.consoleErrorHandlers = []
    socket.addEventListener('message', (event) => this.handleMessage(event))
  }

  handleMessage(event) {
    const message = JSON.parse(event.data)
    if (message.id && this.pending.has(message.id)) {
      const { reject, resolve } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) {
        reject(new Error(message.error.message))
      } else {
        resolve(message.result)
      }
      return
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      this.consoleErrorHandlers.forEach((handler) => handler(formatConsoleArgs(message.params.args)))
    }
    if (message.method === 'Runtime.exceptionThrown') {
      this.consoleErrorHandlers.forEach((handler) => handler(message.params.exceptionDetails?.text ?? 'runtime exception'))
    }
  }

  onConsoleError(handler) {
    this.consoleErrorHandlers.push(handler)
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { reject: rejectSend, resolve: resolveSend })
    })
  }

  async evaluate(fnOrExpression, ...args) {
    const expression = typeof fnOrExpression === 'function'
      ? `(${fnOrExpression})(...${JSON.stringify(args)})`
      : fnOrExpression
    const result = await this.send('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'Runtime.evaluate failed')
    }
    return result.result?.value
  }

  async exists(selector) {
    return this.evaluate((value) => Boolean(document.querySelector(value)), selector)
  }

  async click(selector) {
    const clicked = await this.evaluate((value) => {
      const element = document.querySelector(value)
      if (!element) {
        return false
      }
      element.click()
      return true
    }, selector)
    if (!clicked) {
      throw new Error(`Unable to click missing selector ${selector}`)
    }
  }

  async fill(selector, value) {
    const filled = await this.evaluate((targetSelector, targetValue) => {
      const element = document.querySelector(targetSelector)
      if (!element) {
        return false
      }
      const prototype = Object.getPrototypeOf(element)
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      descriptor?.set?.call(element, targetValue)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }, selector, value)
    if (!filled) {
      throw new Error(`Unable to fill missing selector ${selector}`)
    }
  }

  async selectOption(selector, value) {
    const selected = await this.evaluate((targetSelector, targetValue) => {
      const element = document.querySelector(targetSelector)
      if (!element) {
        return false
      }
      const prototype = Object.getPrototypeOf(element)
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      descriptor?.set?.call(element, targetValue)
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, selector, value)
    if (!selected) {
      throw new Error(`Unable to select missing selector ${selector}`)
    }
  }

  async text(selector) {
    const text = await this.evaluate((value) => document.querySelector(value)?.textContent ?? '', selector)
    return text.replace(/\s+/g, ' ').trim()
  }

  async waitFor(predicate, options = {}) {
    return waitFor(() => this.evaluate(predicate), options)
  }

  async screenshot() {
    const result = await this.send('Page.captureScreenshot', { format: 'png' })
    return result.data
  }
}

async function writeFailureArtifacts(page, error) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await mkdir(artifactRoot, { recursive: true })
  const screenshot = await page.screenshot().catch(() => '')
  if (screenshot) {
    await writeFile(join(artifactRoot, `${stamp}-failure.png`), Buffer.from(screenshot, 'base64'))
  }
  const html = await page.evaluate(() => document.documentElement.outerHTML).catch(() => '')
  if (html) {
    await writeFile(join(artifactRoot, `${stamp}-failure.html`), html)
  }
  await writeFile(join(artifactRoot, `${stamp}-failure.txt`), [
    String(error?.stack ?? error),
    '',
    'Console errors:',
    ...consoleErrors,
  ].join('\n'))
  await writeFile(join(artifactRoot, `${stamp}-report.json`), JSON.stringify(performanceReport('failed', error), null, 2))
}

async function writePerformanceReport() {
  await writeFile(join(artifactRoot, 'latest-report.json'), JSON.stringify(performanceReport('passed'), null, 2))
}

function performanceReport(status, error = null) {
  return {
    budgets: performanceBudgets,
    consoleErrors,
    error: error ? String(error?.stack ?? error) : null,
    status,
    suite,
    timings,
  }
}

async function measure(name, action) {
  const startedAt = Date.now()
  try {
    return await action()
  } finally {
    timings[name] = Date.now() - startedAt
  }
}

function formatConsoleArgs(args) {
  return args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
}

async function resolveChromePath() {
  const candidates = [
    process.env.CRAWCLAW_E2E_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'google-chrome',
    'chromium',
    'chromium-browser',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      try {
        await readFile(candidate)
        return candidate
      } catch {
        continue
      }
    }
    return candidate
  }
  throw new Error('Chrome/Chromium not found. Set CRAWCLAW_E2E_CHROME to a browser executable.')
}

async function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        rejectListen(new Error('unexpected server address'))
      } else {
        resolveListen(address.port)
      }
    })
  })
}

async function freePort() {
  const server = net.createServer()
  const port = await listen(server)
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function waitFor(predicate, {
  label = 'condition',
  onTimeout = () => '',
  timeoutMs = 5000,
} = {}) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await predicate()
      if (result) {
        return result
      }
    } catch (error) {
      lastError = error
    }
    await delay(25)
  }
  const details = typeof onTimeout === 'function' ? onTimeout() : ''
  throw new Error(`Timed out waiting for ${label}${details ? `\n${String(details)}` : ''}${lastError ? `\n${lastError.stack ?? lastError}` : ''}`)
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function json(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function sendSse(response, event, payload) {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function authorized(request, url) {
  return request.headers['x-crawclaw-desktop-session'] === sessionToken
    || url.searchParams.get('sessionToken') === sessionToken
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
  }
  return body ? JSON.parse(body) : {}
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(1500).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    }),
  ])
}

function assert(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`)
  }
}

await main()
