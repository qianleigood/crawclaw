import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Desktop API client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('requires a Gateway URL unless fixture mode is explicitly enabled', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockRejectedValue(new Error('not tauri')),
    }))

    const api = await import('./desktop-api')

    await expect(api.loadBootstrap()).rejects.toThrow(/Gateway URL/)
  })

  it('uses browser fixtures only when fixture mode is explicitly enabled', async () => {
    vi.stubEnv('VITE_CRAWCLAW_DESKTOP_FIXTURE', '1')
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockRejectedValue(new Error('not tauri')),
    }))

    const api = await import('./desktop-api')
    const bootstrap = await api.loadBootstrap()

    expect(bootstrap.api.baseUrl).toBe('')
    expect(bootstrap.desktopState.sidebar.navItems.map((item) => item.id)).toContain('agent')
    expect(bootstrap.desktopState.memoryWorkspace).toMatchObject({
      dream: {
        agentId: '',
        lastRunAt: '',
        message: '',
        status: 'idle',
      },
      filter: '全部',
      query: '',
      selectedAgentId: 'agent-main',
      selectedItemId: 'memory-preference-simple-ui',
    })
    expect(bootstrap.desktopState.memoryWorkspace.items[0]).toMatchObject({
      agentId: 'agent-main',
      archived: false,
      category: '偏好',
      source: '来自对话',
      title: '默认使用简洁桌面界面',
    })

    const pinned = await api.pinThread('thread-cleanup')
    expect(pinned.sidebar.pinnedThreads.map((thread) => thread.id)).toContain('thread-cleanup')
    expect(pinned.sidebar.threads.map((thread) => thread.id)).not.toContain('thread-cleanup')

    const results = await api.searchDesktop('n8n')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      label: 'n8n 工作流',
      targetNavId: 'automation',
    })
    const memoryResults = await api.searchDesktop('简洁')
    expect(memoryResults[0]).toMatchObject({
      label: '默认使用简洁桌面界面',
      targetItemId: 'memory-preference-simple-ui',
      targetNavId: 'memory',
    })

    const selectedMemory = await api.selectMemoryItem('memory-project-desktop-bff')
    expect(selectedMemory.activeNavId).toBe('memory')
    expect(selectedMemory.memoryWorkspace.selectedAgentId).toBe('agent-main')
    expect(selectedMemory.memoryWorkspace.selectedItemId).toBe('memory-project-desktop-bff')

    const selectedMemoryAgent = await api.selectMemoryAgent('agent-workflow')
    expect(selectedMemoryAgent.activeNavId).toBe('memory')
    expect(selectedMemoryAgent.memoryWorkspace.selectedAgentId).toBe('agent-workflow')
    expect(selectedMemoryAgent.memoryWorkspace.selectedItemId).toBe('memory-lesson-gateway-reconfigure')

    const dreamRun = await api.runMemoryDream('agent-workflow')
    expect(dreamRun.activeNavId).toBe('memory')
    expect(dreamRun.memoryWorkspace.selectedAgentId).toBe('agent-workflow')
    expect(dreamRun.memoryWorkspace.dream).toMatchObject({
      agentId: 'agent-workflow',
      lastRunAt: '刚刚',
      status: 'running',
    })
    expect(dreamRun.memoryWorkspace.dream.message).toContain('Workflow Runner')

    const queriedMemory = await api.setMemoryQuery('Gateway')
    expect(queriedMemory.memoryWorkspace.query).toBe('Gateway')

    const filteredMemory = await api.setMemoryFilter('项目')
    expect(filteredMemory.memoryWorkspace.filter).toBe('项目')

    const createdMemory = await api.createMemoryItem({
      category: '经验',
      content: '提交前检查测试、构建和 diff，确认没有无关修改。',
      summary: '提交前先跑直接相关验证',
      tags: ['测试', '发布'],
      title: '发布前检查清单',
    })
    const createdMemoryId = createdMemory.memoryWorkspace.selectedItemId
    expect(createdMemory.activeNavId).toBe('memory')
    expect(createdMemory.memoryWorkspace.items[0]).toMatchObject({
      agentId: 'agent-workflow',
      archived: false,
      category: '经验',
      source: '手动添加',
      summary: '提交前先跑直接相关验证',
      tags: ['测试', '发布'],
      title: '发布前检查清单',
    })

    const updatedMemory = await api.updateMemoryItem(createdMemoryId, {
      summary: '提交前跑测试和构建',
      tags: ['验证'],
      title: '发布前验证清单',
    })
    expect(updatedMemory.memoryWorkspace.items[0]).toMatchObject({
      summary: '提交前跑测试和构建',
      tags: ['验证'],
      title: '发布前验证清单',
    })

    const archivedMemory = await api.archiveMemoryItem(createdMemoryId)
    expect(archivedMemory.memoryWorkspace.items.find((item) => item.id === createdMemoryId)?.archived).toBe(true)
    expect(archivedMemory.memoryWorkspace.selectedItemId).not.toBe(createdMemoryId)

    const openedTool = await api.togglePluginTool('tool-filesystem')
    expect(openedTool.pluginsWorkspace.tools.find((tool) => tool.id === 'tool-filesystem')?.open).toBe(true)

    const selectedAgent = await api.selectAgent('agent-workflow')
    expect(selectedAgent.agentWorkspace.selectedAgentId).toBe('agent-workflow')

    const createdAgent = await api.createAgent({
      avatar: {
        gradient: 'linear-gradient(135deg, #0f766e, #2563eb)',
        imageDataUrl: 'data:image/png;base64,YXZhdGFy',
        initials: '网',
        source: 'uploaded',
      },
      channels: [
        {
          config: {
            accountId: 'local',
            dmPolicy: 'open',
            fields: [],
            groupPolicy: 'open',
            target: 'desktop',
          },
          enabled: true,
          id: 'desktop',
          label: '桌面',
        },
        { enabled: false, id: 'ddingtalk', label: '钉钉' },
        {
          config: {
            accountId: 'default',
            dmPolicy: 'pairing',
            fields: [
              { id: 'appId', label: 'App ID', secret: false, value: 'cli_test_agent' },
              { id: 'appSecret', label: 'App Secret', secret: true, value: 'feishu-secret' },
            ],
            groupPolicy: 'allowlist',
            target: 'oc_research_room',
          },
          enabled: true,
          id: 'feishu',
          label: '飞书',
        },
        { enabled: false, id: 'esp32', label: 'ESP32' },
        { enabled: false, id: 'qqbot', label: 'QQ Bot' },
        { enabled: false, id: 'weixin', label: '微信' },
      ],
      description: '持续跟踪网页资料并产出结构化摘要',
      emotion: {
        boundaries: ['主动提醒风险'],
        promptMd: '# 情感提示词\n保持温和但明确。',
        style: '温和陪伴',
        tone: '耐心、清晰',
      },
      model: 'GPT-5.4',
      name: '网页研究员',
      permissionMode: '只读模式',
      role: '研究',
      skillIds: ['agent-skill-ui-polish'],
      thinking: '中',
      toolIds: ['agent-tool-filesystem'],
      voice: {
        cloneSampleName: 'researcher.wav',
        cloneVoiceName: '网页研究员声音',
        designPrompt: '沉着鼓励，适合长文摘要。',
        enabled: true,
        inputEnabled: true,
        outputEnabled: true,
        pace: '慢速',
        presetVoice: 'Ethan',
        source: 'voice-clone',
        style: '沉稳',
        wakeEnabled: true,
      },
    })
    expect(createdAgent.agentWorkspace.agents.at(-1)?.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ enabled: true, id: 'desktop', label: '桌面' }),
      expect.objectContaining({
        config: expect.objectContaining({
          accountId: 'default',
          target: 'oc_research_room',
        }),
        enabled: true,
        id: 'feishu',
        label: '飞书',
      }),
      expect.objectContaining({ enabled: false, id: 'ddingtalk', label: '钉钉' }),
      expect.objectContaining({ enabled: false, id: 'esp32', label: 'ESP32' }),
      expect.objectContaining({ enabled: false, id: 'weixin', label: '微信' }),
    ]))
    const agentId = createdAgent.agentWorkspace.selectedAgentId
    expect(agentId).toMatch(/^agent-custom-\d+$/)
    expect(createdAgent.agentWorkspace.agents.at(-1)).toMatchObject({
      description: '持续跟踪网页资料并产出结构化摘要',
      emotion: {
        boundaries: ['主动提醒风险'],
        promptMd: '# 情感提示词\n保持温和但明确。',
        style: '温和陪伴',
        tone: '耐心、清晰',
      },
      avatar: {
        imageDataUrl: 'data:image/png;base64,YXZhdGFy',
        source: 'uploaded',
      },
      id: agentId,
      model: 'GPT-5.4',
      name: '网页研究员',
      permissionMode: '只读模式',
      role: '研究',
      status: '草稿',
      thinking: '中',
      voice: {
        cloneSampleName: 'researcher.wav',
        cloneVoiceName: '网页研究员声音',
        designPrompt: '沉着鼓励，适合长文摘要。',
        enabled: true,
        inputEnabled: true,
        outputEnabled: true,
        pace: '慢速',
        presetVoice: 'Ethan',
        source: 'voice-clone',
        style: '沉稳',
        wakeEnabled: true,
      },
    })
    expect(
      createdAgent.agentWorkspace.agents
        .at(-1)
        ?.tools.find((tool) => tool.id === 'agent-tool-filesystem')?.enabled,
    ).toBe(true)
    expect(
      createdAgent.agentWorkspace.agents
        .at(-1)
        ?.skills.find((skill) => skill.id === 'agent-skill-ui-polish')?.enabled,
    ).toBe(true)

    const updatedAgent = await api.updateAgent(agentId, {
      model: 'GPT-5.4',
      permissionMode: '只读模式',
      thinking: '中',
    })
    expect(updatedAgent.agentWorkspace.agents.at(-1)).toMatchObject({
      model: 'GPT-5.4',
      permissionMode: '只读模式',
      thinking: '中',
    })

    const toggledTool = await api.toggleAgentTool(agentId, 'agent-tool-filesystem')
    expect(
      toggledTool.agentWorkspace.agents
        .find((agent) => agent.id === agentId)
        ?.tools.find((tool) => tool.id === 'agent-tool-filesystem')?.enabled,
    ).toBe(false)

    const addedAgentSkill = await api.addAgentSkill(agentId, {
      description: '总结当前网页内容并生成可执行要点',
      name: '网页总结',
      trigger: '@web.summary',
    })
    expect(
      addedAgentSkill.agentWorkspace.agents
        .find((agent) => agent.id === agentId)
        ?.skills.at(-1),
    ).toMatchObject({
      name: '网页总结',
      trigger: '@web.summary',
    })

    const addedSkill = await api.addPluginSkill({
      description: '总结当前网页内容并生成可执行要点',
      name: '网页总结',
      trigger: '@web.summary',
    })
    expect(addedSkill.pluginsWorkspace.skills).toContainEqual(
      expect.objectContaining({
        name: '网页总结',
        trigger: '@web.summary',
      }),
    )
  })

  it('uses the Gateway base URL and session token for HTTP mutations', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockResolvedValue('http://127.0.0.1:43001'),
    }))

    const api = await import('./desktop-api')
    const desktopState = api.createDesktopFixtureState()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/desktop/bootstrap')) {
        return jsonResponse({
          api: {
            baseUrl: 'http://127.0.0.1:43001',
            eventsUrl: 'http://127.0.0.1:43001/api/desktop/events',
            sessionToken: 'session',
          },
          app: {
            name: 'CrawClaw Desktop',
            version: 'test',
          },
          desktopState,
          runtime: {
            detail: 'Missing runtime',
            entrypointPath: '',
            nodePath: '',
            runtimeRoot: '',
            status: 'missing',
          },
        })
      }

      if (url.endsWith('/api/desktop/messages')) {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'x-crawclaw-desktop-session': 'session',
        })
        return jsonResponse({
          ...desktopState,
          conversation: {
            ...desktopState.conversation,
            draftMessages: [{ id: 'draft-1', text: 'hello' }],
          },
        })
      }

      if (url.endsWith('/api/desktop/messages/abort')) {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'x-crawclaw-desktop-session': 'session',
        })
        return jsonResponse(desktopState)
      }

      if (url.endsWith('/api/desktop/messages/steer')) {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'x-crawclaw-desktop-session': 'session',
        })
        expect(requestJsonBody(init)).toMatchObject({
          text: 'prefer shorter',
        })
        return jsonResponse(desktopState)
      }

      if (url.endsWith('/api/desktop/plugins/skills')) {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'x-crawclaw-desktop-session': 'session',
        })
        expect(requestJsonBody(init)).toMatchObject({
          name: '网页总结',
          trigger: '@web.summary',
        })
        return jsonResponse({
          ...desktopState,
          pluginsWorkspace: {
            ...desktopState.pluginsWorkspace,
            skills: [
              ...desktopState.pluginsWorkspace.skills,
              {
                description: '总结当前网页内容并生成可执行要点',
                id: 'skill-custom-web-summary',
                name: '网页总结',
                open: false,
                source: '自定义',
                status: '本地',
                trigger: '@web.summary',
              },
            ],
          },
        })
      }

      if (url.endsWith('/api/desktop/agents/agent-main/select')) {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'x-crawclaw-desktop-session': 'session',
        })
        return jsonResponse({
          ...desktopState,
          agentWorkspace: {
            ...desktopState.agentWorkspace,
            selectedAgentId: 'agent-main',
          },
        })
      }

      if (url.endsWith('/api/desktop/agents/agent-main')) {
        expect(init?.method).toBe('PATCH')
        expect(init?.headers).toMatchObject({
          'x-crawclaw-desktop-session': 'session',
        })
        expect(requestJsonBody(init)).toMatchObject({
          model: 'GPT-5.4',
          permissionMode: '只读模式',
          thinking: '中',
        })
        return jsonResponse({
          ...desktopState,
          agentWorkspace: {
            ...desktopState.agentWorkspace,
            agents: desktopState.agentWorkspace.agents.map((agent) =>
              agent.id === 'agent-main'
                ? {
                    ...agent,
                    model: 'GPT-5.4',
                    permissionMode: '只读模式',
                    thinking: '中',
                  }
                : agent,
            ),
          },
        })
      }

      if (url.endsWith('/api/desktop/memory/dream/run')) {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'x-crawclaw-desktop-session': 'session',
        })
        expect(requestJsonBody(init)).toMatchObject({
          agentId: 'agent-main',
        })
        return jsonResponse({
          ...desktopState,
          activeNavId: 'memory',
          memoryWorkspace: {
            ...desktopState.memoryWorkspace,
            dream: {
              agentId: 'agent-main',
              lastRunAt: '刚刚',
              message: 'CrawClaw Agent 正在把最近对话整理成可长期记住的内容。',
              status: 'running',
            },
          },
        })
      }

      if (url.endsWith('/api/desktop/memory/items')) {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'x-crawclaw-desktop-session': 'session',
        })
        expect(requestJsonBody(init)).toMatchObject({
          category: '经验',
          title: '发布前检查清单',
        })
        return jsonResponse({
          ...desktopState,
          activeNavId: 'memory',
          memoryWorkspace: {
            ...desktopState.memoryWorkspace,
            selectedItemId: 'memory-custom-release-checklist',
            items: [
              {
                agentId: 'agent-main',
                archived: false,
                category: '经验',
                content: '提交前检查测试、构建和 diff，确认没有无关修改。',
                id: 'memory-custom-release-checklist',
                source: '手动添加',
                summary: '提交前先跑直接相关验证',
                tags: ['测试', '发布'],
                title: '发布前检查清单',
                updatedAt: '刚刚',
              },
              ...desktopState.memoryWorkspace.items,
            ],
          },
        })
      }

      throw new Error(`unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.loadBootstrap()
    const state = await api.sendMessage('hello')
    const abortState = await api.abortMessage()
    const steerState = await api.steerMessage('prefer shorter')
    const selectedAgentState = await api.selectAgent('agent-main')
    const updatedAgentState = await api.updateAgent('agent-main', {
      model: 'GPT-5.4',
      permissionMode: '只读模式',
      thinking: '中',
    })
    const customSkillState = await api.addPluginSkill({
      description: '总结当前网页内容并生成可执行要点',
      name: '网页总结',
      trigger: '@web.summary',
    })
    const dreamRunState = await api.runMemoryDream('agent-main')
    const memoryState = await api.createMemoryItem({
      category: '经验',
      content: '提交前检查测试、构建和 diff，确认没有无关修改。',
      summary: '提交前先跑直接相关验证',
      tags: ['测试', '发布'],
      title: '发布前检查清单',
    })

    expect(fetchMock).toHaveBeenCalledTimes(9)
    expect(state.conversation.draftMessages[0]).toMatchObject({
      text: 'hello',
    })
    expect(abortState.activeNavId).toBe(desktopState.activeNavId)
    expect(steerState.activeNavId).toBe(desktopState.activeNavId)
    expect(selectedAgentState.agentWorkspace.selectedAgentId).toBe('agent-main')
    expect(updatedAgentState.agentWorkspace.agents[0]).toMatchObject({
      model: 'GPT-5.4',
      permissionMode: '只读模式',
      thinking: '中',
    })
    expect(customSkillState.pluginsWorkspace.skills.at(-1)).toMatchObject({
      name: '网页总结',
      trigger: '@web.summary',
    })
    expect(dreamRunState.memoryWorkspace.dream).toMatchObject({
      agentId: 'agent-main',
      status: 'running',
    })
    expect(memoryState.memoryWorkspace.items[0]).toMatchObject({
      agentId: 'agent-main',
      category: '经验',
      title: '发布前检查清单',
    })
  })

  it('surfaces Gateway unsupported responses without fixture fallback', async () => {
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockResolvedValue('http://127.0.0.1:43001'),
    }))

    const api = await import('./desktop-api')
    const desktopState = api.createDesktopFixtureState()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/desktop/bootstrap')) {
        return jsonResponse({
          api: {
            baseUrl: 'http://127.0.0.1:43001',
            eventsUrl: 'http://127.0.0.1:43001/api/desktop/events',
            sessionToken: 'session',
          },
          app: { name: 'CrawClaw Desktop', version: 'test' },
          desktopState,
          runtime: {
            detail: 'Runtime ready',
            entrypointPath: '',
            nodePath: '',
            runtimeRoot: '',
            status: 'ready',
          },
        })
      }
      if (url.endsWith('/api/desktop/messages')) {
        return jsonResponse({ code: 'unsupported', message: 'send_message unsupported' }, 501)
      }
      throw new Error(`unexpected request ${url}`)
    }))

    await api.loadBootstrap()
    await expect(api.sendMessage('hello')).rejects.toMatchObject({
      code: 'unsupported',
      status: 501,
    })
  })
})

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  return input.url
}

function requestJsonBody(init: RequestInit | undefined) {
  if (typeof init?.body !== 'string') {
    throw new Error('expected JSON string request body')
  }
  return JSON.parse(init.body) as unknown
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  })
}
