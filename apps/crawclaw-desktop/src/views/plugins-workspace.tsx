import {
  ChevronDown,
  MessageCircle,
  Package,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import type {
  AddPluginSkillInput,
  InstalledPlugin,
  PluginInstallInput,
  PluginSkill,
  PluginTool,
} from '../desktop-api'

export type PluginSourceFilter = 'CrawClaw 内置' | '全部来源' | '自定义' | '已安装' | '本机工具'
export type PluginStatusFilter = '全部' | '使用中' | '已停用' | '已安装' | '本地'
export type PluginSelectorId = 'plugin-source' | 'plugin-status'
type PluginDialogPhase = 'idle' | 'saving'
type PluginSkillInstallStatus = '检查中' | '本地'
type PluginDetailDialogState =
  | { id: string; kind: 'installed' }
  | { id: string; kind: 'skill' }
  | { id: string; kind: 'tool' }
  | null
type PluginVisualTone =
  | 'ai-image'
  | 'automation'
  | 'code'
  | 'crawler'
  | 'document'
  | 'github'
  | 'health'
  | 'installed'
  | 'link'
  | 'node'
  | 'react'
  | 'search'
  | 'skill'
  | 'summary'
  | 'voice'
  | 'weather'
type PluginPresentation = { description: string; name: string; tone: PluginVisualTone }

type ConfirmationInput = {
  cancelLabel?: string
  confirmLabel?: string
  detail: string
  title: string
}

const pluginSourceFilters: PluginSourceFilter[] = ['全部来源', 'CrawClaw 内置', '自定义', '已安装', '本机工具']
const pluginStatusFilters: PluginStatusFilter[] = ['全部', '使用中', '已停用', '已安装', '本地']

const toolPresentations: Record<string, PluginPresentation> = {
  'browser/browser': {
    description: '打开网页、读取页面快照、截图并操作托管浏览器。',
    name: '浏览器自动化',
    tone: 'crawler',
  },
  'comfyui/comfyui_workflow': {
    description: '检查、验证并运行本机 ComfyUI 工作流，用于 AI 生图和自动化出图任务。',
    name: 'ComfyUI 生图工作流',
    tone: 'ai-image',
  },
  'crawclaw-runtime/apply_patch': {
    description: '按补丁精确修改文件，适合可审阅的代码变更。',
    name: '应用补丁',
    tone: 'code',
  },
  'crawclaw-runtime/bash': {
    description: '运行 shell 命令，用于构建、测试、检查和本机任务。',
    name: '命令执行',
    tone: 'code',
  },
  'crawclaw-runtime/canvas': {
    description: '控制画布类 UI 能力，用于需要可视化承载的任务。',
    name: '画布控制',
    tone: 'automation',
  },
  'crawclaw-runtime/cron': {
    description: '创建或管理定时任务和后台自动化。',
    name: '定时任务',
    tone: 'automation',
  },
  'crawclaw-runtime/discover_skills': {
    description: '检索可用技能，为当前任务匹配更合适的能力。',
    name: '技能发现',
    tone: 'skill',
  },
  'crawclaw-runtime/edit': {
    description: '对已有文件做精准编辑，适合小范围代码或文档修改。',
    name: '精确编辑',
    tone: 'code',
  },
  'crawclaw-runtime/find': {
    description: '查找文件和目录，快速定位工作区里的目标路径。',
    name: '查找文件',
    tone: 'search',
  },
  'crawclaw-runtime/grep': {
    description: '搜索文件内容，定位代码、配置、日志或文档片段。',
    name: '内容搜索',
    tone: 'search',
  },
  'crawclaw-runtime/image': {
    description: '读取和理解图片内容，用于截图、图像资料和视觉检查。',
    name: '图片理解',
    tone: 'ai-image',
  },
  'crawclaw-runtime/ls': {
    description: '列出目录内容，查看工作区文件结构。',
    name: '目录列表',
    tone: 'document',
  },
  'crawclaw-runtime/memory_manifest_read': {
    description: '读取作用域内的长期记忆清单。',
    name: '读取记忆清单',
    tone: 'summary',
  },
  'crawclaw-runtime/memory_note_delete': {
    description: '删除作用域内的长期记忆笔记。',
    name: '删除记忆笔记',
    tone: 'health',
  },
  'crawclaw-runtime/memory_note_edit': {
    description: '编辑作用域内的长期记忆笔记。',
    name: '编辑记忆笔记',
    tone: 'summary',
  },
  'crawclaw-runtime/memory_note_read': {
    description: '读取作用域内的长期记忆笔记。',
    name: '读取记忆笔记',
    tone: 'summary',
  },
  'crawclaw-runtime/memory_note_write': {
    description: '写入作用域内的长期记忆笔记。',
    name: '写入记忆笔记',
    tone: 'summary',
  },
  'crawclaw-runtime/message': {
    description: '向外部消息渠道发送内容。',
    name: '消息发送',
    tone: 'automation',
  },
  'crawclaw-runtime/pdf': {
    description: '分析 PDF 文件内容，提取文本、结构和页面信息。',
    name: 'PDF 分析',
    tone: 'document',
  },
  'crawclaw-runtime/process': {
    description: '管理后台进程，用于启动、检查或停止本机任务。',
    name: '进程管理',
    tone: 'code',
  },
  'crawclaw-runtime/read': {
    description: '读取文件内容，用于理解代码、配置和文档。',
    name: '读取文件',
    tone: 'document',
  },
  'crawclaw-runtime/review_task': {
    description: '复核任务完成情况，检查实现和验证证据。',
    name: '任务复核',
    tone: 'health',
  },
  'crawclaw-runtime/session_status': {
    description: '查看当前会话状态。',
    name: '会话状态',
    tone: 'summary',
  },
  'crawclaw-runtime/session_summary_file_edit': {
    description: '编辑会话摘要文件。',
    name: '编辑会话摘要',
    tone: 'document',
  },
  'crawclaw-runtime/session_summary_file_read': {
    description: '读取会话摘要文件。',
    name: '读取会话摘要',
    tone: 'document',
  },
  'crawclaw-runtime/sessions_history': {
    description: '读取会话历史，找回上下文和执行记录。',
    name: '会话历史',
    tone: 'summary',
  },
  'crawclaw-runtime/sessions_list': {
    description: '列出可用会话。',
    name: '会话列表',
    tone: 'summary',
  },
  'crawclaw-runtime/sessions_send': {
    description: '向指定会话发送消息。',
    name: '发送到会话',
    tone: 'automation',
  },
  'crawclaw-runtime/sessions_spawn': {
    description: '启动子智能体会话处理独立任务。',
    name: '启动子智能体',
    tone: 'automation',
  },
  'crawclaw-runtime/sessions_yield': {
    description: '结束当前轮次并等待子智能体结果。',
    name: '等待子智能体',
    tone: 'automation',
  },
  'crawclaw-runtime/subagents': {
    description: '管理子智能体和并行任务。',
    name: '子智能体管理',
    tone: 'automation',
  },
  'crawclaw-runtime/tts': {
    description: '将文本转换成语音。',
    name: '文本转语音',
    tone: 'voice',
  },
  'crawclaw-runtime/web_fetch': {
    description: '抓取网页内容，用于读取公开页面资料。',
    name: '网页读取',
    tone: 'crawler',
  },
  'crawclaw-runtime/web_search': {
    description: '联网搜索公开网页信息。',
    name: '网页搜索',
    tone: 'search',
  },
  'crawclaw-runtime/workflow': {
    description: '管理和运行工作流。',
    name: '工作流执行',
    tone: 'automation',
  },
  'crawclaw-runtime/workflowize': {
    description: '把重复任务整理成工作流草稿。',
    name: '工作流生成',
    tone: 'automation',
  },
  'crawclaw-runtime/write': {
    description: '创建或覆盖文件。',
    name: '写入文件',
    tone: 'code',
  },
  'crawclaw-runtime/write_experience_note': {
    description: '写入可复用的经验笔记。',
    name: '写入经验',
    tone: 'summary',
  },
  'llm-task/llm-task': {
    description: '运行结构化 LLM JSON 任务，适合工作流里的模型子任务。',
    name: 'LLM 结构化任务',
    tone: 'automation',
  },
  'lobster/lobster': {
    description: '运行带审批和可恢复能力的本地工作流管线。',
    name: 'Lobster 工作流',
    tone: 'automation',
  },
  'qwen3-tts/qwen3_tts_build_payload': {
    description: '整理 Qwen3-TTS 本地语音合成请求，把文本和声音参数转换成可执行载荷。',
    name: 'Qwen3-TTS 载荷生成',
    tone: 'voice',
  },
  'qwen3-tts/qwen3_tts_synthesize': {
    description: '调用本机 Qwen3-TTS 运行时合成语音，适合本地配音和语音预览。',
    name: 'Qwen3-TTS 语音合成',
    tone: 'voice',
  },
  'searxng/searxng_search': {
    description: '通过 SearXNG 搜索端点获取联网检索结果，用于公开网页信息查找。',
    name: 'SearXNG 搜索',
    tone: 'search',
  },
  'spider-fetch/spider_fetch': {
    description: '抓取静态或浏览器渲染后的网页内容，用于读取页面正文和结构化资料。',
    name: '网页抓取',
    tone: 'crawler',
  },
}

const coreSkillPresentations: Record<string, PluginPresentation> = {
  'coding-agent': {
    description: '把复杂编码任务交给独立工作区里的编码智能体执行，适合实现、修复和评审。',
    name: '编码智能体',
    tone: 'code',
  },
  'find-skills': {
    description: '查找、比较、安装或创建技能，帮助为当前任务选择合适的能力。',
    name: '查找技能',
    tone: 'skill',
  },
  'frontend-dev': {
    description: '处理浏览器端 UI 的布局、交互、动效、文案和视觉打磨。',
    name: '前端开发',
    tone: 'react',
  },
  'fullstack-dev': {
    description: '处理横跨前端、后端、接口和生产稳定性的完整功能开发。',
    name: '全栈开发',
    tone: 'code',
  },
  'gh-issues': {
    description: '按仓库 Issue、标签、里程碑或评审请求选择并推进 GitHub 工作。',
    name: 'GitHub Issue 处理',
    tone: 'github',
  },
  github: {
    description: '查看或修改 GitHub 仓库数据，包括 PR、Issue、评论、检查、工作流和发布。',
    name: 'GitHub 操作',
    tone: 'github',
  },
  healthcheck: {
    description: '审计和加固 CrawClaw 所在主机，检查暴露面、版本、SSH 与防火墙状态。',
    name: '主机健康检查',
    tone: 'health',
  },
  'link-checker': {
    description: '检查网页或 URL 列表里的断链、重定向、超时和 HTTP 状态异常。',
    name: '链接检查',
    tone: 'link',
  },
  'node-connect': {
    description: '排查 Android、iOS 或 macOS 伴随应用的配对码、局域网、tailnet 和认证连接。',
    name: '节点连接排查',
    tone: 'node',
  },
  'openai-whisper': {
    description: '在 Apple Silicon 上用本地 Whisper 转录音频或视频，不依赖 API key。',
    name: '本地语音转写',
    tone: 'voice',
  },
  'pptx-generator': {
    description: '创建、编辑、读取或提取 PowerPoint 演示文稿内容。',
    name: 'PPTX 生成',
    tone: 'document',
  },
  react: {
    description: '处理 React 组件、Hooks、状态拆分、渲染行为、表单和性能问题。',
    name: 'React 工程',
    tone: 'react',
  },
  'session-logs': {
    description: '检索旧对话、父会话或 JSONL 会话日志，找回缺失上下文。',
    name: '会话日志',
    tone: 'document',
  },
  'skill-creator': {
    description: '创建、重构、收紧或评估技能，优化触发条件和技能说明内容。',
    name: '技能创建',
    tone: 'skill',
  },
  'skill-vetter': {
    description: '安装第三方技能前检查来源可信度、权限、密钥和命令风险。',
    name: '技能安全评估',
    tone: 'health',
  },
  summarize: {
    description: '总结 URL、网页、PDF、图片、音频、视频或本地文件，输出结构化摘要。',
    name: '资料总结',
    tone: 'summary',
  },
  superpowers: {
    description: '为复杂软件任务提供计划、调试、测试驱动、并行代理和收尾流程。',
    name: '工程流程增强',
    tone: 'automation',
  },
  weather: {
    description: '查询指定地点的当前天气、降雨、气温和短期预报。',
    name: '天气查询',
    tone: 'weather',
  },
}

function deriveSkillFromAddress(address: string): AddPluginSkillInput | null {
  const trimmedAddress = address.trim()
  if (!trimmedAddress) {
    return null
  }

  const pathLike = trimmedAddress.replace(/\/+$/, '')
  let rawName = ''
  try {
    const parsed = new URL(pathLike)
    const parts = parsed.pathname.split('/').filter(Boolean)
    rawName = parts.at(-1) ?? parsed.hostname
  } catch {
    rawName = pathLike.split(/[/:?#]+/).filter(Boolean).at(-1) ?? ''
  }

  const name = rawName
    .replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!name) {
    return null
  }

  return {
    description: `来自 ${formatSkillAddressSource(trimmedAddress)}`,
    name,
    trigger: `@${name}`,
  }
}

function formatSkillAddressSource(address: string) {
  try {
    const parsed = new URL(address)
    if (parsed.hostname === 'github.com') {
      const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
      return owner && repo ? `${parsed.hostname}/${owner}/${repo}` : parsed.hostname
    }
    return parsed.hostname || address
  } catch {
    return address
  }
}

function formatSource(source: string) {
  if (source === 'core' || source === '内置') {
    return 'CrawClaw 内置'
  }
  if (source === 'custom' || source === 'desktop' || source === '自定义') {
    return '自定义'
  }
  if (source === 'rust-native') {
    return '本机工具'
  }
  if (source === 'installed') {
    return '已安装'
  }
  return source || '未知来源'
}

function formatStatus(status: string, installStatus?: string, enabled = true) {
  if (!enabled) {
    return '已停用'
  }
  if (installStatus === 'installed') {
    return '已安装'
  }
  if (installStatus === 'available' || status === 'available') {
    return '使用中'
  }
  if (status === 'enabled' || status === '已启用') {
    return '使用中'
  }
  return status || installStatus || '可用'
}

function formatPermission(permission: string) {
  if (permission === 'requiresApproval') {
    return '需要确认'
  }
  if (permission === 'network') {
    return '联网'
  }
  if (permission === 'local') {
    return '本地'
  }
  if (permission === 'workspace') {
    return '工作区'
  }
  if (permission === 'command') {
    return '命令'
  }
  if (permission === 'externalApp') {
    return '外部应用'
  }
  if (permission === 'highRisk') {
    return '高风险'
  }
  if (permission === 'read') {
    return '只读'
  }
  return permission || '未声明'
}

function statusClass(status: string) {
  return status === '检查中'
    ? 'plugin-market-row__status is-checking'
    : status === '本地' || status === '已安装' || status === '已启用'
    ? 'plugin-market-row__status is-local'
    : status === '使用中'
    ? 'plugin-market-row__status is-enabled'
    : 'plugin-market-row__status'
}

function matchesSourceFilter(source: string, filter: PluginSourceFilter) {
  if (filter === '全部来源') {
    return true
  }
  return formatSource(source) === filter
}

function matchesStatusFilter(status: string, filter: PluginStatusFilter) {
  return filter === '全部' || status === filter
}

function getToolPresentation(tool: PluginTool): PluginPresentation {
  return toolPresentations[`${tool.pluginId}/${tool.id}`] ?? {
    description: tool.description,
    name: tool.name,
    tone: 'skill',
  }
}

function getSkillPresentation(skill: PluginSkill): PluginPresentation {
  if (formatSource(skill.source) !== 'CrawClaw 内置') {
    return {
      description: skill.description,
      name: skill.name,
      tone: 'skill',
    }
  }
  return coreSkillPresentations[skill.skillKey] ?? {
    description: skill.description,
    name: skill.name,
    tone: 'skill',
  }
}

function getToolSearchText(tool: PluginTool) {
  const presentation = getToolPresentation(tool)
  return `${tool.pluginId} ${tool.id} ${tool.name} ${tool.description} ${presentation.name} ${presentation.description}`
    .toLowerCase()
}

function getSkillSearchText(skill: PluginSkill) {
  const presentation = getSkillPresentation(skill)
  return `${skill.skillKey} ${skill.name} ${skill.trigger} ${skill.description} ${presentation.name} ${presentation.description}`
    .toLowerCase()
}

type PluginsWorkspaceProps = {
  installed: InstalledPlugin[]
  onFeaturedPlugin: () => void
  onInstallPlugin: (input: PluginInstallInput) => Promise<void>
  onInstallSkill: (input: AddPluginSkillInput) => Promise<void>
  onInvokePluginTool: (pluginId: string, toolId: string, input: unknown) => Promise<void>
  onRequestConfirmation?: (input: ConfirmationInput) => Promise<boolean>
  onRemovePluginSkill: (skillId: string) => Promise<void>
  onSetInstalledPluginEnabled: (pluginId: string, enabled: boolean) => void
  onSetPluginSkillEnabled: (skillId: string, enabled: boolean) => void
  onSetPluginToolEnabled: (toolId: string, enabled: boolean) => void
  onUninstallPlugin: (pluginId: string) => Promise<void>
  onUseSkill: (skill: PluginSkill) => void
  skills: PluginSkill[]
  tools: PluginTool[]
}

export function PluginsWorkspace({
  installed,
  onFeaturedPlugin,
  onInstallPlugin,
  onInstallSkill,
  onInvokePluginTool,
  onRequestConfirmation,
  onRemovePluginSkill,
  onSetInstalledPluginEnabled,
  onSetPluginSkillEnabled,
  onSetPluginToolEnabled,
  onUninstallPlugin,
  onUseSkill,
  skills,
  tools,
}: PluginsWorkspaceProps) {
  const [isPluginInstallDialogOpen, setIsPluginInstallDialogOpen] = useState(false)
  const [isPluginSkillDialogOpen, setIsPluginSkillDialogOpen] = useState(false)
  const [pluginDetailDialog, setPluginDetailDialog] = useState<PluginDetailDialogState>(null)
  const [pluginSearchQuery, setPluginSearchQuery] = useState('')
  const [pluginSelectorOpen, setPluginSelectorOpen] = useState<PluginSelectorId | null>(null)
  const [pluginSkillAddress, setPluginSkillAddress] = useState('')
  const [pluginSkillDialogPhase, setPluginSkillDialogPhase] = useState<PluginDialogPhase>('idle')
  const [pluginSkillError, setPluginSkillError] = useState('')
  const [pluginSkillInstallStatuses, setPluginSkillInstallStatuses] = useState<Record<string, PluginSkillInstallStatus>>({})
  const [pluginSourceFilter, setPluginSourceFilter] = useState<PluginSourceFilter>('全部来源')
  const [pluginStatusFilter, setPluginStatusFilter] = useState<PluginStatusFilter>('全部')
  const [pluginActionError, setPluginActionError] = useState('')
  const [pluginInstallSource, setPluginInstallSource] = useState('')
  const [pluginMarketplaceName, setPluginMarketplaceName] = useState('')
  const [pluginInstallPhase, setPluginInstallPhase] = useState<PluginDialogPhase>('idle')
  const [pluginInstallError, setPluginInstallError] = useState('')
  const [toolInputs, setToolInputs] = useState<Record<string, string>>({})
  const [toolErrors, setToolErrors] = useState<Record<string, string>>({})
  const normalizedPluginSearch = pluginSearchQuery.trim().toLowerCase()
  const isPluginSkillSaving = pluginSkillDialogPhase === 'saving'
  const isPluginInstalling = pluginInstallPhase === 'saving'
  const canSubmitPluginSkill = pluginSkillAddress.trim().length > 0 && !isPluginSkillSaving
  const canSubmitPluginInstall = pluginInstallSource.trim().length > 0 && !isPluginInstalling
  const detailTool = pluginDetailDialog?.kind === 'tool'
    ? tools.find((tool) => `${tool.pluginId}/${tool.id}` === pluginDetailDialog.id)
    : undefined
  const detailSkill = pluginDetailDialog?.kind === 'skill'
    ? skills.find((skill) => skill.id === pluginDetailDialog.id)
    : undefined
  const detailInstalledPlugin = pluginDetailDialog?.kind === 'installed'
    ? installed.find((plugin) => plugin.id === pluginDetailDialog.id)
    : undefined
  const getPluginSkillDisplayStatus = (skill: PluginSkill) =>
    pluginSkillInstallStatuses[skill.trigger] ?? formatStatus(skill.status, skill.installStatus, skill.enabled)
  const visiblePluginTools = tools.filter((tool) => {
    const status = formatStatus(tool.status, tool.installStatus, tool.enabled)
    const matchesSearch = !normalizedPluginSearch || getToolSearchText(tool).includes(normalizedPluginSearch)
    return matchesSearch
      && matchesSourceFilter(tool.source, pluginSourceFilter)
      && matchesStatusFilter(status, pluginStatusFilter)
  })
  const visiblePluginSkills = skills.filter((skill) => {
    const status = getPluginSkillDisplayStatus(skill)
    const matchesSearch = !normalizedPluginSearch || getSkillSearchText(skill).includes(normalizedPluginSearch)
    return matchesSearch
      && matchesSourceFilter(skill.source, pluginSourceFilter)
      && matchesStatusFilter(status, pluginStatusFilter)
  })
  const visibleInstalledPlugins = installed.filter((plugin) => {
    const status = formatStatus(plugin.status, plugin.installStatus, plugin.enabled)
    const matchesSearch = !normalizedPluginSearch
      || `${plugin.id} ${plugin.name} ${plugin.manifestPath ?? ''}`.toLowerCase().includes(normalizedPluginSearch)
    return matchesSearch
      && matchesSourceFilter(plugin.source, pluginSourceFilter)
      && matchesStatusFilter(status, pluginStatusFilter)
  })

  const closeSkillDialog = () => {
    if (!isPluginSkillSaving) {
      setIsPluginSkillDialogOpen(false)
      setPluginSkillError('')
    }
  }

  const closeInstallDialog = () => {
    if (!isPluginInstalling) {
      setIsPluginInstallDialogOpen(false)
      setPluginInstallError('')
    }
  }

  const closeDetailDialog = () => {
    setPluginDetailDialog(null)
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setPluginSelectorOpen(null)
      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    event.preventDefault()
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    if (items.length === 0) {
      return
    }

    const currentIndex = items.findIndex((item) => item === document.activeElement)
    const fallbackIndex = event.key === 'ArrowDown' ? -1 : 0
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (currentIndex === -1 ? fallbackIndex : currentIndex) + direction
    items[(nextIndex + items.length) % items.length]?.focus()
  }

  const submitPluginSkill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPluginSkillSaving) {
      return
    }

    const nextSkill = deriveSkillFromAddress(pluginSkillAddress)
    if (!nextSkill) {
      setPluginSkillError('请输入有效的技能地址。')
      return
    }

    setPluginSkillDialogPhase('saving')
    setPluginSkillError('')
    void (async () => {
      try {
        await onInstallSkill(nextSkill)
        setPluginSkillInstallStatuses((statuses) => ({
          ...statuses,
          [nextSkill.trigger]: '本地',
        }))
        setPluginSkillAddress('')
        setPluginSearchQuery('')
        setPluginSourceFilter('自定义')
        setPluginStatusFilter('全部')
        setIsPluginSkillDialogOpen(false)
      } catch (error) {
            setPluginSkillError(error instanceof Error ? error.message : '添加技能失败。')
      } finally {
        setPluginSkillDialogPhase('idle')
      }
    })()
  }

  const submitPluginInstall = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPluginInstalling) {
      return
    }

    setPluginInstallPhase('saving')
    setPluginInstallError('')
    void (async () => {
      try {
        await onInstallPlugin({
          link: false,
          marketplacePlugin: pluginMarketplaceName.trim() || undefined,
          pin: false,
          source: pluginInstallSource.trim(),
        })
        setPluginInstallSource('')
        setPluginMarketplaceName('')
        setPluginSearchQuery('')
        setPluginSourceFilter('已安装')
        setPluginStatusFilter('全部')
        setIsPluginInstallDialogOpen(false)
      } catch (error) {
        setPluginInstallError(error instanceof Error ? error.message : '安装插件失败。')
      } finally {
        setPluginInstallPhase('idle')
      }
    })()
  }

  const runTool = (tool: PluginTool) => {
    const key = `${tool.pluginId}/${tool.id}`
    const presentation = getToolPresentation(tool)
    const rawInput = toolInputs[key]?.trim() || '{}'
    let parsedInput: unknown
    try {
      parsedInput = JSON.parse(rawInput)
    } catch {
      setToolErrors((errors) => ({ ...errors, [key]: 'JSON 输入格式不正确。' }))
      return
    }

    void (async () => {
      const needsConfirmation = tool.permission !== 'local' && tool.permission !== '只读'
      if (needsConfirmation && onRequestConfirmation) {
        const confirmed = await onRequestConfirmation({
          cancelLabel: '取消',
          confirmLabel: '运行',
          detail: `${presentation.name} 将以${formatPermission(tool.permission)}权限执行。`,
          title: `运行 ${tool.pluginId}/${tool.id}`,
        })
        if (!confirmed) {
          return
        }
      }
      try {
        setToolErrors((errors) => ({ ...errors, [key]: '' }))
        await onInvokePluginTool(tool.pluginId, tool.id, parsedInput)
        setToolErrors((errors) => ({ ...errors, [key]: '已写入对话结果。' }))
      } catch (error) {
        setToolErrors((errors) => ({
          ...errors,
          [key]: error instanceof Error ? error.message : '工具试运行失败。',
        }))
      }
    })()
  }

  const removeSkill = async (skill: PluginSkill) => {
    if (skill.source === 'core') {
      return
    }
    const confirmed = onRequestConfirmation
      ? await onRequestConfirmation({
        cancelLabel: '取消',
        confirmLabel: '移除',
        detail: `将移除 ${skill.trigger} 的本机技能文件和运行时配置。内置 core skills 不会被删除。`,
        title: `移除技能：${getSkillPresentation(skill).name}`,
      })
      : true
    if (!confirmed) {
      return
    }
    try {
      setPluginActionError('')
      await onRemovePluginSkill(skill.id)
      setPluginDetailDialog(null)
      setPluginSkillInstallStatuses((statuses) => {
        const nextStatuses = { ...statuses }
        delete nextStatuses[skill.trigger]
        return nextStatuses
      })
    } catch (error) {
      setPluginActionError(error instanceof Error ? error.message : '移除技能失败。')
    }
  }

  const uninstallInstalledPlugin = async (plugin: InstalledPlugin) => {
    const confirmed = onRequestConfirmation
      ? await onRequestConfirmation({
        cancelLabel: '取消',
        confirmLabel: '卸载',
        detail: `将卸载 ${plugin.id}，移除安装记录和已安装文件；credentials 和模型配置不会被删除。`,
        title: `卸载插件：${plugin.name}`,
      })
      : true
    if (!confirmed) {
      return
    }
    try {
      setPluginActionError('')
      await onUninstallPlugin(plugin.id)
      setPluginDetailDialog(null)
    } catch (error) {
      setPluginActionError(error instanceof Error ? error.message : '卸载插件失败。')
    }
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      setPluginSelectorOpen(null)
      closeSkillDialog()
      closeInstallDialog()
      closeDetailDialog()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [isPluginInstalling, isPluginSkillSaving])

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || target.closest('.plugin-filter') || target.closest('.selector-menu')) {
        return
      }

      setPluginSelectorOpen(null)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])

  return (
    <div className="plugin-catalog">
      <header className="plugin-catalog__header">
        <h1>插件</h1>
        <div className="plugin-catalog__actions">
          <button className="workspace-secondary-button" onClick={() => setIsPluginInstallDialogOpen(true)} type="button">
            <Package aria-hidden="true" size={15} strokeWidth={2.2} />
            安装插件
          </button>
          <button className="workspace-secondary-button" onClick={() => setIsPluginSkillDialogOpen(true)} type="button">
            <Plus aria-hidden="true" size={15} strokeWidth={2.2} />
            添加技能
          </button>
        </div>
      </header>

      <div className="plugin-catalog__toolbar" aria-label="插件筛选">
        <label>
          <Search aria-hidden="true" size={15} strokeWidth={2} />
          <span className="sr-only">搜索插件</span>
          <input
            onChange={(event) => setPluginSearchQuery(event.currentTarget.value)}
            placeholder="搜索工具、技能或已安装插件"
            value={pluginSearchQuery}
          />
        </label>
        <PluginFilter
          isOpen={pluginSelectorOpen === 'plugin-source'}
          label={pluginSourceFilter}
          menuLabel="插件来源选择"
          onKeyDown={handleMenuKeyDown}
          onOpenChange={() => setPluginSelectorOpen(pluginSelectorOpen === 'plugin-source' ? null : 'plugin-source')}
          onSelect={(filter) => {
            setPluginSourceFilter(filter as PluginSourceFilter)
            setPluginSelectorOpen(null)
          }}
          options={pluginSourceFilters}
        />
        <PluginFilter
          isOpen={pluginSelectorOpen === 'plugin-status'}
          label={pluginStatusFilter}
          menuLabel="插件状态选择"
          onKeyDown={handleMenuKeyDown}
          onOpenChange={() => setPluginSelectorOpen(pluginSelectorOpen === 'plugin-status' ? null : 'plugin-status')}
          onSelect={(filter) => {
            setPluginStatusFilter(filter as PluginStatusFilter)
            setPluginSelectorOpen(null)
          }}
          options={pluginStatusFilters}
        />
      </div>
      {pluginActionError ? <p className="plugin-action-error">{pluginActionError}</p> : null}

      {!normalizedPluginSearch ? (
        <section className="plugin-hero" aria-label="推荐插件">
          <div className="plugin-hero__card">
            <span className="plugin-hero__icon">
              <Sparkles aria-hidden="true" size={15} strokeWidth={2.2} />
            </span>
            <strong>macOS UI polish</strong>
            <span>打磨桌面端气泡、动效和输入体验</span>
          </div>
          <button className="plugin-hero__action" onClick={onFeaturedPlugin} type="button">
            <MessageCircle aria-hidden="true" size={15} strokeWidth={2.2} />
            在对话中试用
          </button>
          <div className="plugin-hero__dots" aria-hidden="true">
            <span className="is-active" />
            <span />
            <span />
            <span />
            <span />
          </div>
        </section>
      ) : null}

      <PluginSection count={visiblePluginTools.length} sectionId="tools" title="工具">
        {visiblePluginTools.length > 0 ? (
          visiblePluginTools.map((tool) => (
            <PluginToolRow
              key={`${tool.pluginId}/${tool.id}`}
              onOpen={() => setPluginDetailDialog({ id: `${tool.pluginId}/${tool.id}`, kind: 'tool' })}
              status={formatStatus(tool.status, tool.installStatus, tool.enabled)}
              tool={tool}
            />
          ))
        ) : (
          <p className="plugin-featured__empty">没有找到匹配的工具。</p>
        )}
      </PluginSection>

      <PluginSection count={visiblePluginSkills.length} sectionId="skills" title="技能">
        {visiblePluginSkills.length > 0 ? (
          visiblePluginSkills.map((skill) => (
            <PluginSkillRow
              key={skill.id}
              onOpen={() => setPluginDetailDialog({ id: skill.id, kind: 'skill' })}
              skill={skill}
              status={getPluginSkillDisplayStatus(skill)}
            />
          ))
        ) : (
          <p className="plugin-featured__empty">没有找到匹配的技能。</p>
        )}
      </PluginSection>

      <PluginSection count={visibleInstalledPlugins.length} sectionId="installed" title="已安装">
        {visibleInstalledPlugins.length > 0 ? (
          visibleInstalledPlugins.map((plugin) => (
            <InstalledPluginRow
              key={plugin.id}
              onOpen={() => setPluginDetailDialog({ id: plugin.id, kind: 'installed' })}
              plugin={plugin}
              status={formatStatus(plugin.status, plugin.installStatus, plugin.enabled)}
            />
          ))
        ) : (
          <p className="plugin-featured__empty">还没有安装插件。安装后会在这里显示卸载操作。</p>
        )}
      </PluginSection>

      {isPluginInstallDialogOpen ? (
        <PluginInstallDialog
          canSubmit={canSubmitPluginInstall}
          error={pluginInstallError}
          isSaving={isPluginInstalling}
          marketplaceName={pluginMarketplaceName}
          onClose={closeInstallDialog}
          onMarketplaceNameChange={setPluginMarketplaceName}
          onSourceChange={setPluginInstallSource}
          onSubmit={submitPluginInstall}
          source={pluginInstallSource}
        />
      ) : null}

      {isPluginSkillDialogOpen ? (
        <PluginSkillDialog
          canSubmit={canSubmitPluginSkill}
          error={pluginSkillError}
          isSaving={isPluginSkillSaving}
          onAddressChange={setPluginSkillAddress}
          onClose={closeSkillDialog}
          onSubmit={submitPluginSkill}
          value={pluginSkillAddress}
        />
      ) : null}

      {detailTool ? (
        <PluginToolDialog
          message={toolErrors[`${detailTool.pluginId}/${detailTool.id}`] ?? ''}
          onClose={closeDetailDialog}
          onInputChange={(value) => {
            const key = `${detailTool.pluginId}/${detailTool.id}`
            setToolInputs((inputs) => ({ ...inputs, [key]: value }))
          }}
          onRun={() => runTool(detailTool)}
          onSetEnabled={(enabled) => onSetPluginToolEnabled(detailTool.id, enabled)}
          tool={detailTool}
          value={toolInputs[`${detailTool.pluginId}/${detailTool.id}`] ?? '{}'}
        />
      ) : null}

      {detailSkill ? (
        <PluginSkillDetailDialog
          onClose={closeDetailDialog}
          onRemove={() => void removeSkill(detailSkill)}
          onSetEnabled={(enabled) => onSetPluginSkillEnabled(detailSkill.id, enabled)}
          onUse={() => {
            const presentation = getSkillPresentation(detailSkill)
            onUseSkill({ ...detailSkill, description: presentation.description, name: presentation.name })
          }}
          skill={detailSkill}
          status={getPluginSkillDisplayStatus(detailSkill)}
        />
      ) : null}

      {detailInstalledPlugin ? (
        <InstalledPluginDialog
          onClose={closeDetailDialog}
          onSetEnabled={(enabled) => onSetInstalledPluginEnabled(detailInstalledPlugin.id, enabled)}
          onUninstall={() => void uninstallInstalledPlugin(detailInstalledPlugin)}
          plugin={detailInstalledPlugin}
          status={formatStatus(detailInstalledPlugin.status, detailInstalledPlugin.installStatus, detailInstalledPlugin.enabled)}
        />
      ) : null}
    </div>
  )
}

function PluginFilter({
  isOpen,
  label,
  menuLabel,
  onKeyDown,
  onOpenChange,
  onSelect,
  options,
}: {
  isOpen: boolean
  label: string
  menuLabel: string
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  onOpenChange: () => void
  onSelect: (value: string) => void
  options: readonly string[]
}) {
  return (
    <div className="plugin-filter">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="plugin-filter-pill"
        onClick={onOpenChange}
        type="button"
      >
        {label}
        <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
      </button>
      {isOpen ? (
        <div aria-label={menuLabel} className="selector-menu plugin-filter-menu" onKeyDown={onKeyDown} role="menu">
          {options.map((filter) => (
            <button
              className={filter === label ? 'is-selected' : ''}
              key={filter}
              onClick={() => onSelect(filter)}
              role="menuitem"
              type="button"
            >
              {filter}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PluginSection({
  children,
  count,
  sectionId,
  title,
}: {
  children: ReactNode
  count: number
  sectionId: string
  title: string
}) {
  return (
    <section className="plugin-featured" aria-labelledby={`plugin-section-${sectionId}`}>
      <div className="plugin-featured__header">
        <h2 id={`plugin-section-${sectionId}`}>{title}</h2>
        <span className="plugin-section-count">{count}</span>
      </div>
      <div className="plugin-featured__list">{children}</div>
    </section>
  )
}

function PluginToolRow({
  onOpen,
  status,
  tool,
}: {
  onOpen: () => void
  status: string
  tool: PluginTool
}) {
  const presentation = getToolPresentation(tool)
  return (
    <article className="plugin-market-row">
      <div className="plugin-market-row__main">
        <button aria-label={`打开工具详情：${presentation.name}`} className="plugin-market-row__summary" onClick={onOpen} type="button">
          <span className="plugin-market-row__icon">
            <PluginVisualIcon tone={presentation.tone} />
          </span>
          <span className="plugin-market-row__body">
            <strong>{presentation.name}</strong>
            <small>{presentation.description}</small>
            <code>{tool.pluginId}/{tool.id}</code>
          </span>
        </button>
        <span className="plugin-market-row__controls">
          <span className={statusClass(status)}>{status}</span>
        </span>
      </div>
    </article>
  )
}

function PluginSkillRow({
  onOpen,
  skill,
  status,
}: {
  onOpen: () => void
  skill: PluginSkill
  status: string
}) {
  const presentation = getSkillPresentation(skill)
  return (
    <article className="plugin-market-row">
      <div className="plugin-market-row__main">
        <button aria-label={`打开技能详情：${presentation.name}`} className="plugin-market-row__summary" onClick={onOpen} type="button">
          <span className="plugin-market-row__icon">
            <PluginVisualIcon tone={presentation.tone} />
          </span>
          <span className="plugin-market-row__body">
            <strong>{presentation.name}</strong>
            <small>{presentation.description}</small>
            <code>{skill.trigger}</code>
          </span>
        </button>
        <span className="plugin-market-row__controls">
          <span className={statusClass(status)}>{status}</span>
        </span>
      </div>
    </article>
  )
}

function PluginUseSwitch({
  enabled,
  label,
  onChange,
}: {
  enabled: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      aria-label={`${enabled ? '停用' : '启用'}${label}`}
      aria-pressed={enabled}
      className={enabled ? 'plugin-use-switch is-on' : 'plugin-use-switch'}
      onClick={onChange}
      type="button"
    >
      <span>使用</span>
      <i aria-hidden="true" />
    </button>
  )
}

function InstalledPluginRow({
  onOpen,
  plugin,
  status,
}: {
  onOpen: () => void
  plugin: InstalledPlugin
  status: string
}) {
  return (
    <article className="plugin-market-row">
      <div className="plugin-market-row__main">
        <button aria-label={`打开插件详情：${plugin.name}`} className="plugin-market-row__summary" onClick={onOpen} type="button">
          <span className="plugin-market-row__icon">
            <PluginVisualIcon tone="installed" />
          </span>
          <span className="plugin-market-row__body">
            <strong>{plugin.name}</strong>
            <small>{plugin.manifestPath ?? plugin.id}</small>
            <code>{plugin.version ? `${plugin.id}@${plugin.version}` : plugin.id}</code>
          </span>
        </button>
        <span className="plugin-market-row__controls">
          <span className={statusClass(status)}>{status}</span>
        </span>
      </div>
    </article>
  )
}

function PluginToolDialog({
  message,
  onClose,
  onInputChange,
  onRun,
  onSetEnabled,
  tool,
  value,
}: {
  message: string
  onClose: () => void
  onInputChange: (value: string) => void
  onRun: () => void
  onSetEnabled: (enabled: boolean) => void
  tool: PluginTool
  value: string
}) {
  const presentation = getToolPresentation(tool)
  return (
    <PluginDetailOverlay onClose={onClose}>
      <section aria-labelledby="plugin-tool-detail-title" aria-modal="true" className="plugin-skill-dialog plugin-detail-dialog" role="dialog">
        <DialogHeader
          icon={<PluginVisualIcon tone={presentation.tone} />}
          isSaving={false}
          onClose={onClose}
          subtitle={`${tool.pluginId}/${tool.id}`}
          title={presentation.name}
          titleId="plugin-tool-detail-title"
        />
        <div className="plugin-detail-dialog__content">
          <p>{presentation.description}</p>
          <div className="plugin-detail-dialog__meta">
            <span>权限 {formatPermission(tool.permission)}</span>
            <span>来源 {formatSource(tool.source)}</span>
          </div>
          <div className="plugin-detail-dialog__setting">
            <span>使用状态</span>
            <PluginUseSwitch enabled={tool.enabled} label={`工具 ${presentation.name}`} onChange={() => onSetEnabled(!tool.enabled)} />
          </div>
          <label className="plugin-tool-input">
            <span>JSON 输入</span>
            <textarea
              onChange={(event) => onInputChange(event.currentTarget.value)}
              rows={6}
              spellCheck={false}
              value={value}
            />
          </label>
          <div className="plugin-tool-actions">
            <button className="workspace-secondary-button" disabled={!tool.enabled} onClick={onRun} type="button">
              <Play aria-hidden="true" size={14} strokeWidth={2.2} />
              试运行
            </button>
            {message ? <span className={message.includes('失败') || message.includes('不正确') ? 'is-error' : ''}>{message}</span> : null}
          </div>
        </div>
      </section>
    </PluginDetailOverlay>
  )
}

function PluginSkillDetailDialog({
  onClose,
  onRemove,
  onSetEnabled,
  onUse,
  skill,
  status,
}: {
  onClose: () => void
  onRemove: () => void
  onSetEnabled: (enabled: boolean) => void
  onUse: () => void
  skill: PluginSkill
  status: string
}) {
  const presentation = getSkillPresentation(skill)
  const canRemove = skill.source !== 'core'
  return (
    <PluginDetailOverlay onClose={onClose}>
      <section aria-labelledby="plugin-skill-detail-title" aria-modal="true" className="plugin-skill-dialog plugin-detail-dialog" role="dialog">
        <DialogHeader
          icon={<PluginVisualIcon tone={presentation.tone} />}
          isSaving={false}
          onClose={onClose}
          subtitle={skill.trigger}
          title={presentation.name}
          titleId="plugin-skill-detail-title"
        />
        <div className="plugin-detail-dialog__content">
          <p>{presentation.description}</p>
          <div className="plugin-detail-dialog__meta">
            <span>Key {skill.skillKey}</span>
            <span>来源 {formatSource(skill.source)}</span>
            <span>{status}</span>
          </div>
          <div className="plugin-detail-dialog__setting">
            <span>使用状态</span>
            <PluginUseSwitch enabled={skill.enabled} label={`技能 ${presentation.name}`} onChange={() => onSetEnabled(!skill.enabled)} />
          </div>
          <div className="plugin-detail-dialog__actions">
            <button className="workspace-secondary-button" disabled={!skill.enabled} onClick={onUse} type="button">
              <MessageCircle aria-hidden="true" size={14} strokeWidth={2.2} />
              在对话中试用
            </button>
            {canRemove ? (
              <button className="plugin-row-danger-button" onClick={onRemove} type="button">
                <Trash2 aria-hidden="true" size={13} strokeWidth={2.2} />
                移除技能
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </PluginDetailOverlay>
  )
}

function InstalledPluginDialog({
  onClose,
  onSetEnabled,
  onUninstall,
  plugin,
  status,
}: {
  onClose: () => void
  onSetEnabled: (enabled: boolean) => void
  onUninstall: () => void
  plugin: InstalledPlugin
  status: string
}) {
  return (
    <PluginDetailOverlay onClose={onClose}>
      <section aria-labelledby="plugin-installed-detail-title" aria-modal="true" className="plugin-skill-dialog plugin-detail-dialog" role="dialog">
        <DialogHeader
          icon={<PluginVisualIcon tone="installed" />}
          isSaving={false}
          onClose={onClose}
          subtitle={plugin.version ? `${plugin.id}@${plugin.version}` : plugin.id}
          title={plugin.name}
          titleId="plugin-installed-detail-title"
        />
        <div className="plugin-detail-dialog__content">
          <p>{plugin.manifestPath ?? plugin.id}</p>
          <div className="plugin-detail-dialog__meta">
            <span>来源 {formatSource(plugin.source)}</span>
            <span>{status}</span>
          </div>
          <div className="plugin-detail-dialog__setting">
            <span>使用状态</span>
            <PluginUseSwitch enabled={plugin.enabled} label={`插件 ${plugin.name}`} onChange={() => onSetEnabled(!plugin.enabled)} />
          </div>
          <div className="plugin-detail-dialog__actions">
            <button className="plugin-row-danger-button" onClick={onUninstall} type="button">
              <Trash2 aria-hidden="true" size={13} strokeWidth={2.2} />
              卸载插件
            </button>
          </div>
        </div>
      </section>
    </PluginDetailOverlay>
  )
}

function PluginDetailOverlay({
  children,
  onClose,
}: {
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div
      className="plugin-skill-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      {children}
    </div>
  )
}

function PluginVisualIcon({ tone }: { tone: PluginVisualTone }) {
  return (
    <span aria-hidden="true" className={`plugin-generated-icon is-${tone}`}>
      <span />
    </span>
  )
}

function PluginInstallDialog({
  canSubmit,
  error,
  isSaving,
  marketplaceName,
  onClose,
  onMarketplaceNameChange,
  onSourceChange,
  onSubmit,
  source,
}: {
  canSubmit: boolean
  error: string
  isSaving: boolean
  marketplaceName: string
  onClose: () => void
  onMarketplaceNameChange: (value: string) => void
  onSourceChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  source: string
}) {
  return (
    <div
      className="plugin-skill-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose()
        }
      }}
    >
      <form aria-labelledby="plugin-install-dialog-title" aria-modal="true" className="plugin-skill-dialog" onSubmit={onSubmit} role="dialog">
        <DialogHeader
          icon={<Package aria-hidden="true" size={17} strokeWidth={2.2} />}
          isSaving={isSaving}
          onClose={onClose}
          subtitle="粘贴本地路径、bundled id、npm/GitHub spec、clawhub 或市场源。"
          title="安装插件"
          titleId="plugin-install-dialog-title"
        />
        <label className="plugin-skill-dialog__field">
          <span>安装源</span>
          <input
            autoFocus
            disabled={isSaving}
            onChange={(event) => onSourceChange(event.currentTarget.value)}
            placeholder="本地路径、插件 id、npm/GitHub spec 或 clawhub:package"
            value={source}
          />
        </label>
        <label className="plugin-skill-dialog__field">
          <span>市场插件名</span>
          <input
            disabled={isSaving}
            onChange={(event) => onMarketplaceNameChange(event.currentTarget.value)}
            placeholder="仅市场源需要填写"
            value={marketplaceName}
          />
        </label>
        {isSaving ? <p className="plugin-skill-dialog__message">正在安装插件...</p> : null}
        {error ? <p className="plugin-skill-dialog__message is-error">{error}</p> : null}
        <div className="plugin-skill-dialog__examples" aria-label="安装源示例">
          <span>示例</span>
          <code>/path/to/plugin</code>
          <code>fal</code>
          <code>clawhub:demo</code>
        </div>
        <DialogFooter canSubmit={canSubmit} isSaving={isSaving} onClose={onClose} submitLabel="安装" savingLabel="正在安装..." />
      </form>
    </div>
  )
}

function PluginSkillDialog({
  canSubmit,
  error,
  isSaving,
  onAddressChange,
  onClose,
  onSubmit,
  value,
}: {
  canSubmit: boolean
  error: string
  isSaving: boolean
  onAddressChange: (value: string) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  value: string
}) {
  return (
    <div
      className="plugin-skill-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose()
        }
      }}
    >
      <form aria-labelledby="plugin-skill-dialog-title" aria-modal="true" className="plugin-skill-dialog" onSubmit={onSubmit} role="dialog">
        <DialogHeader
          icon={<Sparkles aria-hidden="true" size={17} strokeWidth={2.2} />}
          isSaving={isSaving}
          onClose={onClose}
          subtitle="粘贴 GitHub 地址或技能地址，保存为本机技能。"
          title="添加技能"
          titleId="plugin-skill-dialog-title"
        />
        <label className="plugin-skill-dialog__field">
          <span>技能地址</span>
          <input
            autoFocus
            disabled={isSaving}
            onChange={(event) => onAddressChange(event.currentTarget.value)}
            placeholder="GitHub 地址或技能地址"
            value={value}
          />
        </label>
        {isSaving ? <p className="plugin-skill-dialog__message">正在保存本机技能...</p> : null}
        {error ? <p className="plugin-skill-dialog__message is-error">{error}</p> : null}
        <div className="plugin-skill-dialog__examples" aria-label="地址格式示例">
          <span>支持</span>
          <code>github.com/owner/repo/skills/name</code>
          <code>crawclaw://skills/name</code>
        </div>
        <DialogFooter canSubmit={canSubmit} isSaving={isSaving} onClose={onClose} submitLabel="添加" savingLabel="正在保存..." />
      </form>
    </div>
  )
}

function DialogHeader({
  icon,
  isSaving,
  onClose,
  subtitle,
  title,
  titleId,
}: {
  icon: ReactNode
  isSaving: boolean
  onClose: () => void
  subtitle: string
  title: string
  titleId: string
}) {
  return (
    <header className="plugin-skill-dialog__header">
      <span className="plugin-skill-dialog__icon">{icon}</span>
      <div>
        <h2 id={titleId}>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <button aria-label={`关闭${title}`} disabled={isSaving} onClick={onClose} type="button">
        <X aria-hidden="true" size={16} strokeWidth={2} />
      </button>
    </header>
  )
}

function DialogFooter({
  canSubmit,
  isSaving,
  onClose,
  savingLabel,
  submitLabel,
}: {
  canSubmit: boolean
  isSaving: boolean
  onClose: () => void
  savingLabel: string
  submitLabel: string
}) {
  return (
    <footer className="plugin-skill-dialog__footer">
      <button disabled={isSaving} onClick={onClose} type="button">取消</button>
      <button className="plugin-skill-dialog__submit" disabled={!canSubmit} type="submit">
        {isSaving ? savingLabel : submitLabel}
      </button>
    </footer>
  )
}
