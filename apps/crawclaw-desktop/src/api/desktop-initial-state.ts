import type {
  DesktopState,
  PluginSkill,
  PluginTool,
} from '../generated/desktop-api-contract.generated'

export function createDesktopInitialState(): DesktopState {
  return createDesktopUnavailableState()
}

export function createDesktopUnavailableState(detail = '正在连接本机 Gateway。'): DesktopState {
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
      threads: [],
      discussionThreads: [],
    },
    conversation: {
      messages: [],
      resultItems: [detail],
      runtimeChecks: [
        { label: 'Desktop Shell', value: '已加载', tone: 'ok' },
        { label: 'Desktop API', value: 'error', tone: 'danger' },
        { label: 'Runtime', value: 'missing', tone: 'danger' },
      ],
      slashCommands: [],
      skillCommands: [],
      draftMessages: [],
    },
    agentWorkspace: {
      selectedAgentId: '',
      agents: [],
    },
    memoryWorkspace: {
      selectedAgentId: '',
      selectedItemId: '',
      filter: '全部',
      query: '',
      dream: {
        agentId: '',
        lastRunAt: '',
        message: '',
        status: 'idle',
      },
      items: [],
    },
    pluginsWorkspace: {
      tools: fallbackPluginTools(),
      skills: fallbackPluginSkills(),
      installed: [],
    },
    preferences: {
      selectedModel: 'gpt-5.5',
      selectedThinking: 'high',
      permissionMode: '工作区模式',
      taskDefaults: {
        selectedModel: 'gpt-5.5',
        selectedThinking: 'high',
        permissionMode: '工作区模式',
        responseSpeed: '标准',
        allowTools: true,
      },
      confirmationDefaults: {
        confirmFileChanges: true,
        confirmCommands: true,
        confirmExternalApps: true,
        confirmHighRisk: true,
      },
      notificationDefaults: {
        notifyTaskDone: true,
        notifyConfirmNeeded: true,
        notifyDreamDone: true,
        notifyAutomationFailed: true,
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
      privacyDefaults: {
        dataLocation: '等待桌面 Gateway',
      },
      advancedDefaults: {
        logLevel: '标准',
      },
      modelOptions: ['gpt-5.5'],
      modelProfiles: [],
      providerDescriptors: [],
      providerSetupOptions: [],
      providerModelPickerEntries: [],
      webProviderBoundaries: [],
      thinkingOptions: ['high', 'medium', 'low'],
      permissionModeOptions: ['工作区模式', '只读模式', '完全访问'],
    },
    permissionRequest: {
      id: '',
      title: '',
      detail: '',
      status: 'denied',
    },
    searchSuggestions: [],
  }
}

function fallbackPluginTools(): PluginTool[] {
  return [
    ...fallbackRuntimeCoreTools(),
    fallbackTool({
      description: '打开网页、读取页面快照、截图并操作托管浏览器。',
      icon: 'search',
      id: 'browser',
      name: 'Browser',
      permission: 'externalApp',
      pluginId: 'browser',
    }),
    fallbackTool({
      description: '运行带审批和可恢复能力的本地工作流管线。',
      icon: 'blocks',
      id: 'lobster',
      name: 'Lobster Workflow',
      permission: 'highRisk',
      pluginId: 'lobster',
    }),
    fallbackTool({
      description: '检查、验证并运行本机 ComfyUI 工作流，用于 AI 生图和自动化出图任务。',
      icon: 'image',
      id: 'comfyui_workflow',
      name: 'ComfyUI Workflow',
      permission: 'requiresApproval',
      pluginId: 'comfyui',
    }),
    fallbackTool({
      description: '运行结构化 LLM JSON 任务，适合工作流里的模型子任务。',
      icon: 'blocks',
      id: 'llm-task',
      name: 'LLM Task',
      permission: 'highRisk',
      pluginId: 'llm-task',
    }),
    fallbackTool({
      description: '通过 SearXNG 搜索端点获取联网检索结果，用于公开网页信息查找。',
      icon: 'search',
      id: 'searxng_search',
      name: 'SearXNG Search',
      permission: 'network',
      pluginId: 'searxng',
    }),
    fallbackTool({
      description: '抓取静态或浏览器渲染后的网页内容，用于读取页面正文和结构化资料。',
      icon: 'search',
      id: 'spider_fetch',
      name: 'Spider Fetch',
      permission: 'network',
      pluginId: 'spider-fetch',
    }),
    fallbackTool({
      description: '整理 Qwen3-TTS 本地语音合成请求，把文本和声音参数转换成可执行载荷。',
      icon: 'wrench',
      id: 'qwen3_tts_build_payload',
      name: 'Qwen3-TTS Payload',
      permission: 'local',
      pluginId: 'qwen3-tts',
    }),
    fallbackTool({
      description: '调用本机 Qwen3-TTS 运行时合成语音，适合本地配音和语音预览。',
      icon: 'wrench',
      id: 'qwen3_tts_synthesize',
      name: 'Qwen3-TTS Synthesize',
      permission: 'local',
      pluginId: 'qwen3-tts',
    }),
  ]
}

function fallbackRuntimeCoreTools(): PluginTool[] {
  return [
    ['read', 'read', 'Read file contents', 'fs', true],
    ['write', 'write', 'Create or overwrite files', 'fs', false],
    ['edit', 'edit', 'Make precise edits', 'fs', false],
    ['apply_patch', 'apply_patch', 'Patch files', 'fs', false],
    ['bash', 'bash', 'Run shell commands', 'runtime', false],
    ['process', 'process', 'Manage background processes', 'runtime', false],
    ['grep', 'grep', 'Search file contents', 'runtime', true],
    ['find', 'find', 'Find files and directories', 'runtime', true],
    ['ls', 'ls', 'List directory contents', 'runtime', true],
    ['web_search', 'web_search', 'Search the web', 'web', true],
    ['web_fetch', 'web_fetch', 'Fetch web content', 'web', true],
    ['session_status', 'session_status', 'Session status', 'sessions', true],
    ['sessions_list', 'sessions_list', 'List sessions', 'sessions', true],
    ['sessions_history', 'sessions_history', 'Session history', 'sessions', true],
    ['sessions_send', 'sessions_send', 'Send to session', 'sessions', false],
    ['sessions_spawn', 'sessions_spawn', 'Spawn sub-agent', 'sessions', false],
    ['sessions_yield', 'sessions_yield', 'End turn to receive sub-agent results', 'sessions', false],
    ['subagents', 'subagents', 'Manage sub-agents', 'sessions', true],
    ['canvas', 'canvas', 'Control canvases', 'ui', true],
    ['message', 'message', 'Send messages', 'messaging', false],
    ['cron', 'cron', 'Schedule tasks', 'automation', false],
    ['image', 'image', 'Image understanding', 'media', true],
    ['pdf', 'pdf', 'PDF analysis', 'media', true],
    ['tts', 'tts', 'Text-to-speech conversion', 'media', false],
    ['discover_skills', 'discover_skills', 'Search available skills', 'skills', true],
    ['workflow', 'workflow', 'Manage and run workflows', 'workflow', false],
    ['workflowize', 'workflowize', 'Create workflow drafts', 'workflow', false],
    ['review_task', 'review_task', 'Review task completion', 'review', true],
    ['write_experience_note', 'write_experience_note', 'Write reusable experience notes', 'memory', false],
    ['memory_manifest_read', 'memory_manifest_read', 'Read scoped durable-memory manifest', 'memory', true],
    ['memory_note_read', 'memory_note_read', 'Read scoped durable-memory notes', 'memory', true],
    ['memory_note_write', 'memory_note_write', 'Write scoped durable-memory notes', 'memory', false],
    ['memory_note_edit', 'memory_note_edit', 'Edit scoped durable-memory notes', 'memory', false],
    ['memory_note_delete', 'memory_note_delete', 'Delete scoped durable-memory notes', 'memory', false],
    ['session_summary_file_read', 'session_summary_file_read', 'Read session-summary files', 'session_summary', true],
    ['session_summary_file_edit', 'session_summary_file_edit', 'Edit session-summary files', 'session_summary', false],
  ].map(([id, name, description, sectionId, readOnly]) =>
    fallbackTool({
      description: String(description),
      icon: fallbackRuntimeToolIcon(String(sectionId), String(id)),
      id: String(id),
      name: String(name),
      permission: readOnly ? '只读' : fallbackRuntimeToolPermission(String(sectionId)),
      pluginId: 'crawclaw-runtime',
    })
  )
}

function fallbackTool(input: {
  description: string
  icon: PluginTool['icon']
  id: string
  name: string
  permission: string
  pluginId: string
}): PluginTool {
  return {
    description: input.description,
    enabled: true,
    icon: input.icon,
    id: input.id,
    installStatus: 'available',
    name: input.name,
    open: false,
    permission: input.permission,
    pluginId: input.pluginId,
    source: 'rust-native',
    status: 'available',
  }
}

function fallbackRuntimeToolIcon(sectionId: string, id: string): PluginTool['icon'] {
  if (id === 'image') {
    return 'image'
  }
  if (sectionId === 'web') {
    return 'search'
  }
  if (sectionId === 'memory') {
    return 'brain'
  }
  if (sectionId === 'automation') {
    return 'clock3'
  }
  if (sectionId === 'sessions' || sectionId === 'messaging') {
    return 'messageCircle'
  }
  if (sectionId === 'workflow') {
    return 'blocks'
  }
  if (sectionId === 'fs' || sectionId === 'session_summary') {
    return 'fileText'
  }
  return 'wrench'
}

function fallbackRuntimeToolPermission(sectionId: string): string {
  if (sectionId === 'fs' || sectionId === 'memory' || sectionId === 'session_summary') {
    return 'workspace'
  }
  if (sectionId === 'runtime') {
    return 'command'
  }
  if (sectionId === 'ui') {
    return 'externalApp'
  }
  if (sectionId === 'messaging' || sectionId === 'automation' || sectionId === 'workflow' || sectionId === 'sessions') {
    return 'highRisk'
  }
  return 'local'
}

function fallbackPluginSkills(): PluginSkill[] {
  return [
    fallbackSkill('coding-agent', 'Use when a coding task should be delegated to Codex, Claude Code, OpenCode, or Pi in a separate workdir, temp review workspace, background run, or focused implementation agent.'),
    fallbackSkill('find-skills', 'Use when the user asks to find, compare, install, vet, or create skills, including Chinese requests like 技能, 找技能, 安装 skill, find-skill, find-skills, or install skill.'),
    fallbackSkill('frontend-dev', 'Use when building or improving browser-facing UI where visual hierarchy, responsive layout, interaction design, motion, media, copy, or product polish is the main challenge.'),
    fallbackSkill('fullstack-dev', 'Use when work spans backend services and browser-facing behavior, including APIs, auth/session flows, uploads, CRUD/business workflows, realtime features, or production hardening.'),
    fallbackSkill('gh-issues', 'Use when a repository has GitHub issues, review requests, labels, milestones, or watch-mode triage that should be selected and handled with GitHub CLI access.'),
    fallbackSkill('github', 'Use when inspecting or changing GitHub repository data with gh or gh api, including PRs, issues, comments, checks, workflow runs, releases, or repo metadata.'),
    fallbackSkill('healthcheck', 'Use when auditing or hardening the host running CrawClaw, including security posture review, exposure assessment, firewall or SSH hardening, periodic host audits, or version checks.'),
    fallbackSkill('link-checker', 'Use when auditing webpages or URL lists for broken links, redirects, crawl health, HTTP status failures, timeouts, or link-report generation.'),
    fallbackSkill('node-connect', 'Use when CrawClaw Android, iOS, or macOS companion apps cannot pair or connect through QR codes, setup codes, LAN, tailnet, public URL, bootstrap token, or auth routes.'),
    fallbackSkill('openai-whisper', 'Use when transcribing local audio or video on Apple Silicon without an API key, especially when MLX Whisper should be the default general-purpose local speech-to-text path.'),
    fallbackSkill('pptx-generator', 'Use when creating, editing, reading, or extracting PowerPoint presentations, including PptxGenJS deck generation, structured PPTX XML edits, or slide-content analysis.'),
    fallbackSkill('react', 'Use when the main complexity is React engineering, including component architecture, hooks, React 19, rendering behavior, state separation, forms, performance, or React-specific debugging.'),
    fallbackSkill('session-logs', 'Use when the user references an older conversation, parent session, prior reply, missing context, or session JSONL that needs searching with jq or rg.'),
    fallbackSkill('skill-creator', 'Use when adding, refactoring, tightening, evaluating, packaging, or comparing skills, especially when improving SKILL.md trigger descriptions, pruning stale wording, or deciding when a skill should fire.'),
    fallbackSkill('skill-vetter', 'Use before installing or trusting third-party skills from skillhub, clawhub, GitHub, or other external sources when source trust, permissions, secrets, or command/network risk need review.'),
    fallbackSkill('summarize', 'Use when summarizing URLs, webpages, PDFs, images, audio, YouTube links, or local files with the summarize CLI, especially when a concise extract or structured summary is needed.'),
    fallbackSkill('superpowers', 'Use when a non-trivial software task has ambiguous requirements, multi-step implementation risk, failing technical behavior, independent subtasks, or a feature branch to finish. Not for one-line fixes or passive code reading.'),
    fallbackSkill('weather', 'Use when the user asks for current weather, rain, temperature, conditions, or short forecasts for a location. Not for historical weather, severe alerts, aviation, marine, or climate analysis.'),
  ]
}

function fallbackSkill(skillKey: string, description: string): PluginSkill {
  return {
    description,
    enabled: true,
    icon: 'sparkles',
    id: `core-skill-${skillKey}`,
    installStatus: 'installed',
    name: skillKey,
    open: false,
    skillKey,
    source: 'core',
    status: 'enabled',
    trigger: `@${skillKey}`,
  }
}
