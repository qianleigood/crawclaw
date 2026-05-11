import {
  AudioLines,
  ArrowUp,
  Blocks,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FastForward,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  MessageCircle,
  Mic,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Rewind,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  addPluginSkill,
  archiveMemoryItem,
  archiveThread,
  createAgent,
  createDesktopInitialState,
  createDesktopUnavailableState,
  createMemoryItem,
  decidePermission,
  DesktopApiRequestError,
  loadBootstrap,
  pinThread,
  renameThread,
  runMemoryDream,
  searchDesktop,
  selectAgent,
  selectMemoryAgent,
  selectMemoryItem,
  selectNav,
  selectThread,
  sendMessage,
  setMemoryFilter as setDesktopMemoryFilter,
  setMemoryQuery as setDesktopMemoryQuery,
  subscribeDesktopEvents,
  togglePluginSkill,
  unpinThread,
  updateMemoryItem,
  updatePreferences,
  type AddPluginSkillInput,
  type AgentAvatarProfile,
  type AgentChannelBinding,
  type AgentChannelConfig,
  type AgentChannelConfigField,
  type AgentEmotionProfile,
  type AgentProfile,
  type AgentSkill,
  type AgentTool,
  type AgentVoiceConfig,
  type BadgeTone,
  type CreateAgentInput,
  type CreateMemoryItemInput,
  type DesktopIconKey,
  type DesktopState,
  type MemoryCategory,
  type MemoryFilter,
  type UpdateMemoryItemPatch,
  type PluginSkill,
  type RuntimeStatusValue,
  type SearchSuggestion,
} from './desktop-api'
import { Badge } from './ui/badge'
import { Composer, PermissionModeButton } from './ui/composer'
import { IconButton } from './ui/icon-button'
import { Panel } from './ui/panel'
import { SearchOverlay } from './ui/search-overlay'
import { Sidebar } from './ui/sidebar'
import type { SidebarNavItem, SidebarThread } from './ui/sidebar'

const batchImageTiles = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
const batchImagePageSize = 4
const videoDurationSeconds = 42
const videoPreviewStartSeconds = 18

type ImagePreview = {
  index: number
  kind: 'batch' | 'single'
}

type MemoryDraft = {
  category: MemoryCategory
  content: string
  summary: string
  tags: string
  title: string
}

type PluginSourceFilter = 'Built by CrawClaw' | '全部来源' | '自定义'
type PluginStatusFilter = '全部' | '已启用' | '草稿' | '本地'
type PluginSkillDialogPhase = 'idle' | 'checking'
type PluginSkillInstallStatus = '检查中' | '本地'
type SettingsSectionId = 'general' | 'model' | 'permissions' | 'memory' | 'notifications' | 'privacy' | 'advanced'
type SettingsToggleKey =
  | 'launchAtLogin'
  | 'showInMenuBar'
  | 'allowTools'
  | 'showReasoningSummary'
  | 'confirmFileChanges'
  | 'confirmCommands'
  | 'confirmExternalApps'
  | 'confirmHighRisk'
  | 'rememberPreferences'
  | 'rememberProjectContext'
  | 'memoryDreamEnabled'
  | 'notifyTaskDone'
  | 'notifyConfirmNeeded'
  | 'notifyDreamDone'
  | 'notifyAutomationFailed'
  | 'notificationSound'

type SettingsUiState = {
  appearance: string
  dataLocation: string
  defaultPage: string
  language: string
  logLevel: string
  memoryCleanupConfirmation: string
  memoryDreamFrequency: string
  modelConfiguration: string
  responseSpeed: string
  toggles: Record<SettingsToggleKey, boolean>
}

const memoryCategories: MemoryFilter[] = ['全部', '偏好', '项目', '经验', '其他']
const pluginSourceFilters: PluginSourceFilter[] = ['Built by CrawClaw', '全部来源', '自定义']
const pluginStatusFilters: PluginStatusFilter[] = ['全部', '已启用', '草稿', '本地']
const pluginSkillInstallSteps = ['解析地址', '读取 Skill 信息', '校验入口文件']
const pluginSkillCheckDelayMs = 1_200
const pluginSkillReadyDelayMs = 880
const settingsSections: Array<{ icon: LucideIcon; id: SettingsSectionId; label: string }> = [
  { icon: Wrench, id: 'general', label: '常规' },
  { icon: Bot, id: 'model', label: '模型与回复' },
  { icon: ShieldCheck, id: 'permissions', label: '权限与确认' },
  { icon: Brain, id: 'memory', label: '记忆偏好' },
  { icon: MessageCircle, id: 'notifications', label: '通知' },
  { icon: FileText, id: 'privacy', label: '数据与隐私' },
  { icon: Clock3, id: 'advanced', label: '高级' },
]
const modelConfigurationOptions = [
  { detail: '平衡质量和速度，适合大多数日常对话。', label: '日常工作' },
  { detail: '更适合代码、长上下文和复杂任务。', label: '编程与项目' },
  { detail: '优先更快响应，适合简单指令。', label: '轻量快速' },
]
const defaultSettingsUiState: SettingsUiState = {
  appearance: '跟随系统',
  dataLocation: '本机默认位置',
  defaultPage: '新对话',
  language: '中文',
  logLevel: '标准',
  memoryCleanupConfirmation: '每次确认',
  memoryDreamFrequency: '空闲时',
  modelConfiguration: '日常工作',
  responseSpeed: '标准',
  toggles: {
    allowTools: true,
    confirmCommands: true,
    confirmExternalApps: true,
    confirmFileChanges: true,
    confirmHighRisk: true,
    launchAtLogin: false,
    memoryDreamEnabled: true,
    notificationSound: false,
    notifyAutomationFailed: true,
    notifyConfirmNeeded: true,
    notifyDreamDone: true,
    notifyTaskDone: true,
    rememberPreferences: true,
    rememberProjectContext: true,
    showInMenuBar: true,
    showReasoningSummary: false,
  },
}

const blankMemoryDraft = (): MemoryDraft => ({
  category: '其他',
  content: '',
  summary: '',
  tags: '',
  title: '',
})

const agentAvatarPalettes = [
  ['#2563eb', '#14b8a6', 'rgba(37, 99, 235, 0.24)'],
  ['#7c3aed', '#ec4899', 'rgba(124, 58, 237, 0.22)'],
  ['#0f766e', '#84cc16', 'rgba(15, 118, 110, 0.2)'],
  ['#be123c', '#f97316', 'rgba(190, 18, 60, 0.2)'],
  ['#4338ca', '#06b6d4', 'rgba(67, 56, 202, 0.22)'],
]

const agentWizardSteps = ['身份情感', '模型选择', '语音', '渠道', '能力', '确认'] as const
const agentVoiceSourceOptions = [
  { detail: '使用 Qwen-TTS 内置 voice 参数。', id: 'qwen-preset', label: 'Qwen 系统音色' },
  { detail: '用文字描述生成一个新声音。', id: 'voice-design', label: '描述生成声音' },
  { detail: '上传参考音频，保存克隆声音配置。', id: 'voice-clone', label: '克隆声音' },
]
const qwenVoicePresets = [
  { detail: '明亮、年轻，适合轻量助手。', id: 'Cherry', label: 'Cherry' },
  { detail: '自然、沉稳，适合说明和播报。', id: 'Serena', label: 'Serena' },
  { detail: '清晰、可靠，适合任务执行。', id: 'Ethan', label: 'Ethan' },
  { detail: '亲和、细腻，适合陪伴式交互。', id: 'Chelsie', label: 'Chelsie' },
]
const agentEmotionOptions: AgentEmotionProfile[] = [
  createAgentEmotionOption('专业克制', '清晰、直接', ['先确认关键风险']),
  createAgentEmotionOption('温和陪伴', '耐心、清晰', ['保留用户节奏']),
  createAgentEmotionOption('积极推进', '简短、有行动感', ['推动下一步执行']),
  createAgentEmotionOption('严谨审查', '审慎、证据优先', ['标出不确定性']),
]
const agentVoicePaces = ['正常', '慢速', '快速']
const agentChannelDmPolicies = [
  { detail: '允许联系人直接发起私聊。', id: 'open', label: '直接接收' },
  { detail: '先完成配对或授权后接收。', id: 'pairing', label: '配对后接收' },
]
const agentChannelGroupPolicies = [
  { detail: '只响应允许列表里的群或频道。', id: 'allowlist', label: '允许列表' },
  { detail: '允许所有已绑定群或频道。', id: 'open', label: '全部接收' },
]
const agentChannelOptions: AgentChannelBinding[] = [
  createAgentChannelOption('desktop', '桌面', true),
  createAgentChannelOption('ddingtalk', '钉钉', false),
  createAgentChannelOption('feishu', '飞书', false),
  createAgentChannelOption('esp32', 'ESP32', false),
  createAgentChannelOption('qqbot', 'QQ Bot', false),
  createAgentChannelOption('weixin', '微信', false),
]

function createAgentChannelOption(id: string, label: string, enabled: boolean): AgentChannelBinding {
  return {
    config: createAgentChannelConfig(id),
    enabled,
    id,
    label,
  }
}

function createAgentChannelConfig(id: string): AgentChannelConfig {
  switch (id) {
    case 'desktop':
      return {
        accountId: 'local',
        dmPolicy: 'open',
        fields: [],
        groupPolicy: 'open',
        target: 'desktop',
      }
    case 'feishu':
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [
          { id: 'appId', label: 'App ID', secret: false, value: '' },
          { id: 'appSecret', label: 'App Secret', secret: true, value: '' },
          { id: 'verificationToken', label: 'Verification Token', secret: true, value: '' },
          { id: 'encryptKey', label: 'Encrypt Key', secret: true, value: '' },
        ],
        groupPolicy: 'allowlist',
        target: '',
      }
    case 'ddingtalk':
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [
          { id: 'clientId', label: 'Client ID', secret: false, value: '' },
          { id: 'clientSecret', label: 'Client Secret', secret: true, value: '' },
        ],
        groupPolicy: 'allowlist',
        target: '',
      }
    case 'esp32':
      return {
        accountId: 'local',
        dmPolicy: 'open',
        fields: [
          { id: 'brokerMode', label: 'Broker Mode', secret: false, value: 'managed' },
          { id: 'bindHost', label: 'Bind Host', secret: false, value: '127.0.0.1' },
          { id: 'port', label: 'Port', secret: false, value: '1883' },
        ],
        groupPolicy: 'open',
        target: '',
      }
    case 'qqbot':
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [
          { id: 'appId', label: 'App ID', secret: false, value: '' },
          { id: 'clientSecret', label: 'Client Secret', secret: true, value: '' },
          { id: 'markdownSupport', label: 'Markdown 支持', secret: false, value: 'true' },
        ],
        groupPolicy: 'allowlist',
        target: '',
      }
    case 'weixin':
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [],
        groupPolicy: 'allowlist',
        target: '',
      }
    default:
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [],
        groupPolicy: 'allowlist',
        target: '',
      }
  }
}

function createAgentEmotionOption(style: string, tone: string, boundaries: string[]): AgentEmotionProfile {
  return {
    boundaries,
    promptMd: createEmotionPromptMarkdown(style, tone, boundaries),
    style,
    tone,
  }
}

function createEmotionPromptMarkdown(style: string, tone: string, boundaries: string[], context?: string) {
  return [
    '# 情感提示词',
    `- 情感风格：${style}`,
    `- 表达语气：${tone}`,
    `- 交互边界：${boundaries.join('、')}`,
    ...(context ? ['', context] : []),
  ].join('\n')
}

function createVoiceStyleFromEmotionPrompt(promptMd: string) {
  const compactPrompt = promptMd.replace(/\s+/g, '')
  if (compactPrompt.includes('温和') && (compactPrompt.includes('明确') || compactPrompt.includes('清晰'))) {
    return '温和明确'
  }
  if (compactPrompt.includes('温和')) {
    return '温和耐心'
  }
  if (compactPrompt.includes('严谨') || compactPrompt.includes('证据')) {
    return '严谨清晰'
  }
  if (compactPrompt.includes('积极') || compactPrompt.includes('推进')) {
    return '积极推进'
  }
  if (compactPrompt.includes('克制') || compactPrompt.includes('专业')) {
    return '专业克制'
  }
  if (compactPrompt.includes('活力') || compactPrompt.includes('明快')) {
    return '明快活力'
  }
  if (compactPrompt.includes('简短') || compactPrompt.includes('直接')) {
    return '简洁直接'
  }
  return '清晰直接'
}

type AgentCreateDraft = {
  agentMd: string
  avatar: AgentAvatarProfile | null
  channels: AgentChannelBinding[]
  description: string
  emotion: AgentEmotionProfile
  generationNotice: string
  model: string
  name: string
  permissionMode: string
  role: string
  skillIds: string[]
  thinking: string
  toolIds: string[]
  voice: AgentVoiceConfig
}

type AgentAvatarStyle = CSSProperties & {
  '--agent-avatar-from': string
  '--agent-avatar-glow': string
  '--agent-avatar-to': string
}

function getAgentAvatarInitials(name: string) {
  const compactName = name.trim().replace(/\s+/g, ' ')
  if (!compactName) {
    return 'A'
  }

  if (isAsciiText(compactName)) {
    return compactName
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }

  return Array.from(compactName.replace(/\s/g, '')).slice(0, 1).join('').toUpperCase()
}

function isAsciiText(value: string) {
  return Array.from(value).every((char) => char.charCodeAt(0) <= 0x7f)
}

function getAgentAvatarStyle(agent: AgentProfile): AgentAvatarStyle {
  const seed = Array.from(`${agent.id}:${agent.name}`).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const [from, to, glow] = agentAvatarPalettes[seed % agentAvatarPalettes.length]

  const style: AgentAvatarStyle = {
    '--agent-avatar-from': from,
    '--agent-avatar-glow': glow,
    '--agent-avatar-to': to,
    ...(agent.avatar?.gradient ? { background: agent.avatar.gradient } : {}),
  }
  if (agent.avatar?.imageDataUrl) {
    style.backgroundImage = `url(${agent.avatar.imageDataUrl})`
    style.backgroundPosition = 'center'
    style.backgroundSize = 'cover'
  }
  return style
}

function getAgentAvatarText(agent: AgentProfile) {
  if (agent.avatar?.imageDataUrl) {
    return ''
  }
  return agent.avatar?.initials || getAgentAvatarInitials(agent.name)
}

function defaultAgentVoiceDraft(): AgentVoiceConfig {
  return {
    cloneSampleName: '',
    cloneVoiceName: '',
    designPrompt: '',
    enabled: false,
    inputEnabled: true,
    outputEnabled: true,
    pace: '正常',
    presetVoice: 'Cherry',
    source: 'qwen-preset',
    style: '清晰',
    wakeEnabled: true,
  }
}

function cloneAgentChannel(channel: AgentChannelBinding): AgentChannelBinding {
  return {
    ...channel,
    config: cloneAgentChannelConfig(channel.config ?? createAgentChannelConfig(channel.id)),
  }
}

function cloneAgentChannelConfig(config: AgentChannelConfig): AgentChannelConfig {
  return {
    ...config,
    fields: config.fields.map((field) => ({ ...field })),
  }
}

function formatAgentChannelConfigSummary(channel: AgentChannelBinding) {
  if (channel.id === 'desktop') {
    return `${channel.label}：本机桌面`
  }

  const config = channel.config ?? createAgentChannelConfig(channel.id)
  const primaryField = config.fields
    .find((field) => !field.secret && field.id !== 'markdownSupport' && field.value.trim())
    ?.value.trim()
  const account = primaryField || config.accountId.trim() || '未填写账号'
  const target = config.target.trim()
  return `${channel.label}：${account}${target ? ` · 目标 ${target}` : ''}`
}

function createAgentDraft(state?: DesktopState): AgentCreateDraft {
  return {
    agentMd: '',
    avatar: null,
    channels: agentChannelOptions.map(cloneAgentChannel),
    description: '',
    emotion: cloneAgentEmotion(agentEmotionOptions[0]),
    generationNotice: '',
    model: state?.preferences.selectedModel ?? 'GPT-5.5',
    name: '',
    permissionMode: state?.preferences.permissionMode ?? '工作区模式',
    role: '',
    skillIds: [],
    thinking: state?.preferences.selectedThinking ?? '高',
    toolIds: [],
    voice: defaultAgentVoiceDraft(),
  }
}

function createAgentAvatar(draft: AgentCreateDraft): AgentAvatarProfile {
  if (draft.avatar) {
    return draft.avatar
  }

  const name = draft.name.trim() || '智能体'
  const seed = Array.from(`${name}:${draft.role}`).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const [from, to] = agentAvatarPalettes[seed % agentAvatarPalettes.length]
  return {
    gradient: `linear-gradient(135deg, ${from}, ${to})`,
    initials: getAgentAvatarInitials(name),
    source: 'generated',
  }
}

function getAgentAvatarPreviewStyle(avatar: AgentAvatarProfile): CSSProperties {
  const style: CSSProperties = { background: avatar.gradient }
  if (avatar.imageDataUrl) {
    style.backgroundImage = `url(${avatar.imageDataUrl})`
    style.backgroundPosition = 'center'
    style.backgroundSize = 'cover'
  }
  return style
}

function cloneAgentEmotion(emotion: AgentEmotionProfile): AgentEmotionProfile {
  return {
    boundaries: [...emotion.boundaries],
    promptMd: emotion.promptMd,
    style: emotion.style,
    tone: emotion.tone,
  }
}

function extractAgentMarkdownHeading(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('#'))
    ?.replace(/^#+\s*/, '')
    .trim()
}

function extractAgentMarkdownSummary(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/^[-*]\s*/, ''))
    .find(Boolean)
    ?? ''
}

function createAiAgentAvatar(name: string, agentMd: string): AgentAvatarProfile {
  const seed = Array.from(`${name}:${agentMd}`).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const [from, to] = agentAvatarPalettes[seed % agentAvatarPalettes.length]
  return {
    gradient: `linear-gradient(135deg, ${from}, ${to})`,
    initials: getAgentAvatarInitials(name),
    source: 'ai',
  }
}

function deriveAgentDraftRole(draft: AgentCreateDraft) {
  const name = draft.name.trim() || '新智能体'
  const heading = extractAgentMarkdownHeading(draft.agentMd)
  return draft.role.trim() || heading || `${name}助手`
}

function deriveAgentDraftDescription(draft: AgentCreateDraft) {
  const name = draft.name.trim() || '新智能体'
  const summary = extractAgentMarkdownSummary(draft.agentMd)
  return draft.description.trim() || summary || `根据智能体设定为 ${name} 生成配置草稿。`
}

function generateAgentAvatarDraft(draft: AgentCreateDraft): AgentCreateDraft {
  const name = draft.name.trim() || '新智能体'

  return {
    ...draft,
    avatar: createAiAgentAvatar(name, draft.agentMd),
    generationNotice: '已生成头像',
    name,
  }
}

function agentEnabledChannelCount(agent: AgentProfile) {
  return agent.channels.filter((channel) => channel.enabled).length
}

function agentVoiceLabel(agent: AgentProfile) {
  return agent.voice.enabled ? '语音已启用' : '语音关闭'
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

const iconByKey: Record<DesktopIconKey, LucideIcon> = {
  blocks: Blocks,
  bot: Bot,
  brain: Brain,
  clock3: Clock3,
  fileText: FileText,
  image: ImageIcon,
  messageCircle: MessageCircle,
  search: Search,
  sparkles: Sparkles,
  squarePen: SquarePen,
  wrench: Wrench,
}

const formatVideoTime = (seconds: number) => `00:${String(seconds).padStart(2, '0')}`

const navPanels: Record<string, { detail: string; items: string[]; title: string }> = {
  agent: {
    title: '智能体工作区',
    detail: '选择或配置本机智能体，后续会接入运行状态与技能能力。',
    items: ['CrawClaw', 'UI Polish', 'Workflow Runner'],
  },
  plugins: {
    title: '插件工作区',
    detail: '展示已安装插件、启用状态和可调用能力。',
    items: ['文件系统', '浏览器检查', '工作流连接器'],
  },
  automation: {
    title: '自动化工作区',
    detail: '管理 n8n、ComfyUI 和定时任务的静态入口。',
    items: ['n8n 工作流', 'ComfyUI 工作流', '每日环境巡检'],
  },
  memory: {
    title: '记忆工作区',
    detail: '管理智能体可以复用的本地记忆与项目偏好。',
    items: ['项目偏好', 'UI 设计约束', '运行经验'],
  },
}

const permissionModeDescriptions: Record<string, string> = {
  工作区模式: '只允许访问当前工作区中的内容，适合日常使用。',
  只读模式: 'CrawClaw 只查看信息，不会修改文件或执行写入操作。',
  完全访问: '允许更大范围的本机操作，适合你明确需要自动执行任务时。',
}

function getPermissionModeDescription(mode: string) {
  return permissionModeDescriptions[mode] ?? '控制 CrawClaw 可以访问和操作的范围。'
}

function ChatAvatar({ author }: { author: 'assistant' | 'user' }) {
  if (author === 'assistant') {
    return (
      <span className="chat-avatar chat-avatar--assistant" aria-hidden="true">
        <Sparkles size={14} strokeWidth={2.2} />
      </span>
    )
  }

  return (
    <span className="chat-avatar chat-avatar--user" aria-hidden="true">
      你
    </span>
  )
}

function DesktopIcon({
  icon,
  size = 15,
}: {
  icon: DesktopIconKey
  size?: number
}) {
  const Icon = iconByKey[icon]
  return <Icon aria-hidden="true" size={size} strokeWidth={2} />
}

function parseMemoryTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
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

function localPluginSkillId(trigger: string) {
  return `skill-custom-${trigger.replace(/^@/, '').replace(/[^a-zA-Z0-9_.-]+/g, '-')}`
}

function addPluginSkillLocally(state: DesktopState, input: AddPluginSkillInput): DesktopState {
  const id = localPluginSkillId(input.trigger)
  const skill: PluginSkill = {
    description: input.description,
    icon: 'sparkles',
    id,
    name: input.name,
    open: false,
    source: '自定义',
    status: '本地',
    trigger: input.trigger,
  }
  const hasSkill = state.pluginsWorkspace.skills.some((item) => item.trigger === input.trigger)
  const hasCommand = state.conversation.skillCommands.some((item) => item.mention.trim() === input.trigger)
  const hasSearchSuggestion = state.searchSuggestions.some((item) => item.id === `search-${id}`)

  return {
    ...state,
    conversation: {
      ...state.conversation,
      skillCommands: hasCommand
        ? state.conversation.skillCommands
        : [
          ...state.conversation.skillCommands,
          {
            detail: input.description,
            icon: skill.icon,
            id,
            label: input.name,
            mention: `${input.trigger} `,
          },
        ],
    },
    pluginsWorkspace: {
      ...state.pluginsWorkspace,
      skills: hasSkill ? state.pluginsWorkspace.skills : [...state.pluginsWorkspace.skills, skill],
    },
    searchSuggestions: hasSearchSuggestion
      ? state.searchSuggestions
      : [
        ...state.searchSuggestions,
        {
          icon: skill.icon,
          id: `search-${id}`,
          label: input.name,
          meta: 'Skill',
          targetNavId: 'plugins',
        },
      ],
  }
}

export default function App() {
  const [desktopState, setDesktopState] = useState<DesktopState>(() => createDesktopInitialState())
  const [batchImagePage, setBatchImagePage] = useState(0)
  const [composerText, setComposerText] = useState('')
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchSuggestion[]>(desktopState.searchSuggestions)
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const [videoCurrentSeconds, setVideoCurrentSeconds] = useState(videoPreviewStartSeconds)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isVideoPreviewOpen, setIsVideoPreviewOpen] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState<'thinking' | 'model' | 'permission' | 'plugin-source' | 'plugin-status' | null>(null)
  const [isPluginSkillDialogOpen, setIsPluginSkillDialogOpen] = useState(false)
  const [pluginSourceFilter, setPluginSourceFilter] = useState<PluginSourceFilter>('Built by CrawClaw')
  const [pluginStatusFilter, setPluginStatusFilter] = useState<PluginStatusFilter>('全部')
  const [pluginSearchQuery, setPluginSearchQuery] = useState('')
  const [pluginSkillAddress, setPluginSkillAddress] = useState('')
  const [pluginSkillDialogPhase, setPluginSkillDialogPhase] = useState<PluginSkillDialogPhase>('idle')
  const [pluginSkillInstallStatuses, setPluginSkillInstallStatuses] = useState<Record<string, PluginSkillInstallStatus>>({})
  const [isAgentWizardOpen, setIsAgentWizardOpen] = useState(false)
  const [agentWizardStep, setAgentWizardStep] = useState(0)
  const [agentDraft, setAgentDraft] = useState<AgentCreateDraft>(() => createAgentDraft())
  const [isMemoryFormOpen, setIsMemoryFormOpen] = useState(false)
  const [isMemoryEditing, setIsMemoryEditing] = useState(false)
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>(() => blankMemoryDraft())
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('general')
  const [settingsUi, setSettingsUi] = useState<SettingsUiState>(() => defaultSettingsUiState)
  const [customModelOptions, setCustomModelOptions] = useState<string[]>([])
  const [isAddingModel, setIsAddingModel] = useState(false)
  const [modelDraftName, setModelDraftName] = useState('')
  const activeNavId = desktopState.activeNavId
  const activeNavItem = desktopState.sidebar.navItems.find((item) => item.id === activeNavId)
  const activeNavLabel = activeNavId === 'settings' ? '设置' : (activeNavItem?.label ?? '新对话')
  const activeNavPanel = activeNavId === 'new-chat' ? null : navPanels[activeNavId]
  const isChatWorkspace = activeNavId === 'new-chat'
  const runtimeChecks = desktopState.conversation.runtimeChecks
  const resultItems = desktopState.conversation.resultItems
  const slashCommands = desktopState.conversation.slashCommands
  const skillCommands = desktopState.conversation.skillCommands
  const memoryWorkspace = desktopState.memoryWorkspace
  const selectedMemoryAgent = desktopState.agentWorkspace.agents.find((agent) => agent.id === memoryWorkspace.selectedAgentId)
  const memoryFilter = memoryWorkspace.filter
  const memorySearchQuery = memoryWorkspace.query
  const normalizedMemorySearch = memorySearchQuery.trim().toLowerCase()
  const visibleMemories = memoryWorkspace.items.filter((memory) => {
    if (memory.archived || memory.agentId !== memoryWorkspace.selectedAgentId) {
      return false
    }

    const matchesFilter = memoryFilter === '全部' || memory.category === memoryFilter
    const matchesSearch = !normalizedMemorySearch
      || `${memory.title} ${memory.summary} ${memory.content} ${memory.tags.join(' ')}`.toLowerCase().includes(normalizedMemorySearch)
    return matchesFilter && matchesSearch
  })
  const selectedMemory = visibleMemories.find((memory) => memory.id === memoryWorkspace.selectedItemId)
    ?? visibleMemories[0]
  const isMemoryDreaming = memoryWorkspace.dream.status === 'running'
  const normalizedPluginSearch = pluginSearchQuery.trim().toLowerCase()
  const getPluginSkillDisplayStatus = (skill: PluginSkill) => pluginSkillInstallStatuses[skill.trigger] ?? skill.status
  const visiblePluginSkills = desktopState.pluginsWorkspace.skills.filter((skill) => {
    const matchesSearch = !normalizedPluginSearch
      || `${skill.name} ${skill.trigger} ${skill.description}`.toLowerCase().includes(normalizedPluginSearch)
    const matchesSource = pluginSourceFilter === '全部来源'
      || (pluginSourceFilter === 'Built by CrawClaw' ? skill.source === '内置' : skill.source === '自定义')
    const matchesStatus = pluginStatusFilter === '全部' || getPluginSkillDisplayStatus(skill) === pluginStatusFilter
    return matchesSearch && matchesSource && matchesStatus
  })
  const approvalState = desktopState.permissionRequest.status
  const hasPermissionRequest = Boolean(desktopState.permissionRequest.id)
  const permissionMode = desktopState.preferences.permissionMode
  const selectedModel = desktopState.preferences.selectedModel
  const selectedThinking = desktopState.preferences.selectedThinking
  const modelOptions = Array.from(new Set([
    ...desktopState.preferences.modelOptions,
    ...customModelOptions,
    selectedModel,
  ].filter(Boolean)))
  const agentCapabilityTemplate = desktopState.agentWorkspace.agents[0]
  const agentToolOptions = agentCapabilityTemplate?.tools ?? []
  const agentSkillOptions = agentCapabilityTemplate?.skills ?? []
  const agentWizardAvatar = createAgentAvatar(agentDraft)
  const agentWizardActiveStep = agentWizardSteps[agentWizardStep]
  const derivedAgentRole = deriveAgentDraftRole(agentDraft)
  const derivedAgentDescription = deriveAgentDraftDescription(agentDraft)
  const isAgentIdentityValid = Boolean(agentDraft.name.trim() && agentDraft.agentMd.trim())
  const hasAgentChannel = agentDraft.channels.some((channel) => channel.enabled)
  const canAdvanceAgentWizard = (agentWizardActiveStep === '身份情感' && isAgentIdentityValid)
    || (agentWizardActiveStep === '渠道' && hasAgentChannel)
    || (agentWizardActiveStep !== '身份情感' && agentWizardActiveStep !== '渠道')
  const navItems: SidebarNavItem[] = desktopState.sidebar.navItems.map((item) => ({
    ...item,
    active: item.id === activeNavId,
    icon: iconByKey[item.icon],
  }))
  const pinnedThreads: SidebarThread[] = desktopState.sidebar.pinnedThreads
  const conversations: SidebarThread[] = desktopState.sidebar.threads
  const discussionThreads: SidebarThread[] = desktopState.sidebar.discussionThreads
  const batchImagePageCount = Math.ceil(batchImageTiles.length / batchImagePageSize)
  const visibleBatchImageTiles = batchImageTiles.slice(
    batchImagePage * batchImagePageSize,
    batchImagePage * batchImagePageSize + batchImagePageSize,
  )
  const commandTrigger = composerText.startsWith('/') ? '/' : composerText.startsWith('@') ? '@' : null
  const commandQuery = commandTrigger ? composerText.slice(1).trim().toLowerCase() : ''
  const visibleSlashCommands = isCommandMenuOpen && commandTrigger === '/'
    ? slashCommands.filter((command) => {
        if (!commandQuery) {
          return true
        }

        return command.command.includes(commandQuery) || command.label.toLowerCase().includes(commandQuery)
      })
    : []
  const visibleSkillCommands = isCommandMenuOpen && commandTrigger === '@'
    ? skillCommands.filter((skill) => {
        if (!commandQuery) {
          return true
        }

        return skill.mention.toLowerCase().includes(commandQuery) || skill.label.toLowerCase().includes(commandQuery)
      })
    : []
  const videoCurrentTime = formatVideoTime(videoCurrentSeconds)
  const videoDurationTime = formatVideoTime(videoDurationSeconds)
  const videoProgressPercent = (videoCurrentSeconds / videoDurationSeconds) * 100
  const videoProgressStyle = { '--video-progress': `${videoProgressPercent}%` } as CSSProperties
  const imagePreviewCount = imagePreview?.kind === 'batch' ? batchImageTiles.length : 1
  const imagePreviewCurrent = imagePreview ? imagePreview.index + 1 : 1
  const imagePreviewTile = imagePreview?.kind === 'batch' ? (batchImageTiles[imagePreview.index] ?? batchImageTiles[0]) : null
  const isPluginSkillChecking = pluginSkillDialogPhase === 'checking'
  const canSubmitPluginSkill = pluginSkillAddress.trim().length > 0 && !isPluginSkillChecking

  const closeFloatingControls = () => {
    setSelectorOpen(null)
    setIsAttachmentMenuOpen(false)
    setIsCommandMenuOpen(false)
  }

  const closeVideoPreview = () => {
    setIsVideoPreviewOpen(false)
    setIsVideoPlaying(false)
  }

  const closeImagePreview = () => {
    setImagePreview(null)
  }

  const applyDesktopState = async (operation: () => Promise<DesktopState>) => {
    try {
      const nextState = await operation()
      setDesktopState(nextState)
    } catch (error) {
      const detail = formatDesktopOperationError(error)
      setDesktopState((state) => ({
        ...state,
        conversation: {
          ...state.conversation,
          resultItems: [detail],
        },
      }))
    }
  }

  const applyPreferenceUpdate = (patch: Parameters<typeof updatePreferences>[0]) => {
    setDesktopState((state) => ({
      ...state,
      preferences: {
        ...state.preferences,
        ...patch,
      },
    }))
    void applyDesktopState(() => updatePreferences(patch))
  }

  const submitCustomModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const modelName = modelDraftName.trim()
    if (!modelName) {
      return
    }

    setCustomModelOptions((models) => (
      models.some((model) => model.toLowerCase() === modelName.toLowerCase())
        ? models
        : [...models, modelName]
    ))
    setModelDraftName('')
    setIsAddingModel(false)
    applyPreferenceUpdate({ selectedModel: modelName })
  }

  const setSettingsValue = <Key extends keyof Omit<SettingsUiState, 'toggles'>>(key: Key, value: SettingsUiState[Key]) => {
    setSettingsUi((state) => ({
      ...state,
      [key]: value,
    }))
  }

  const toggleSettingsValue = (key: SettingsToggleKey) => {
    setSettingsUi((state) => ({
      ...state,
      toggles: {
        ...state.toggles,
        [key]: !state.toggles[key],
      },
    }))
  }

  const selectSettingsSection = (id: SettingsSectionId) => {
    setActiveSettingsSection(id)
  }

  const stepImagePreview = (delta: number) => {
    setImagePreview((preview) => {
      if (!preview) {
        return preview
      }

      const count = preview.kind === 'batch' ? batchImageTiles.length : 1
      return {
        ...preview,
        index: Math.min(count - 1, Math.max(0, preview.index + delta)),
      }
    })
  }

  const stepVideoTime = (delta: number) => {
    setVideoCurrentSeconds((seconds) => Math.min(videoDurationSeconds, Math.max(0, seconds + delta)))
  }

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

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeFloatingControls()
        closeVideoPreview()
        closeImagePreview()
        if (!isPluginSkillChecking) {
          setIsPluginSkillDialogOpen(false)
        }
      }
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [isPluginSkillChecking])

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (
        !(target instanceof Element)
        || target.closest('.composer-area')
        || target.closest('.plugin-filter')
        || target.closest('.selector-menu')
      ) {
        return
      }

      closeFloatingControls()
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFloatingControls()
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

  const submitDraft = () => {
    const message = composerText.trim()
    if (!message) {
      return
    }

    void applyDesktopState(() => sendMessage(message))
    setComposerText('')
    setIsCommandMenuOpen(false)
  }

  const updateComposerText = (value: string) => {
    setComposerText(value)
    setIsCommandMenuOpen(value.startsWith('/') || value.startsWith('@'))
  }

  const selectNavItem = (item: SidebarNavItem) => {
    if (item.id === 'search') {
      setIsSearchOpen(true)
      return
    }

    setDesktopState((state) => ({
      ...state,
      activeNavId: item.id,
    }))
    void applyDesktopState(() => selectNav(item.id))
  }

  const openSettings = () => {
    setDesktopState((state) => ({
      ...state,
      activeNavId: 'settings',
    }))
    void applyDesktopState(() => selectNav('settings'))
  }

  const returnToApp = () => {
    setDesktopState((state) => ({
      ...state,
      activeNavId: 'new-chat',
    }))
    void applyDesktopState(() => selectNav('new-chat'))
  }

  const showSearchResult = (item: { targetItemId?: string; targetNavId: string }) => {
    void applyDesktopState(async () => {
      let nextState = await selectNav(item.targetNavId)
      if (item.targetNavId === 'memory' && item.targetItemId) {
        nextState = await selectMemoryItem(item.targetItemId)
      }
      return nextState
    })
  }

  const tryFeaturedPlugin = () => {
    setComposerText('@macOS UI polish ')
    setIsCommandMenuOpen(false)
    closeFloatingControls()
    void applyDesktopState(() => selectNav('new-chat'))
  }

  const updateSearchResults = useCallback((query: string) => {
    void searchDesktop(query).then(setSearchResults).catch(() => {
      setSearchResults(desktopState.searchSuggestions)
    })
  }, [desktopState.searchSuggestions])

  const submitPluginSkill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPluginSkillChecking) {
      return
    }

    const nextSkill = deriveSkillFromAddress(pluginSkillAddress)
    if (!nextSkill) {
      return
    }

    setPluginSkillDialogPhase('checking')
    void (async () => {
      await new Promise((resolve) => window.setTimeout(resolve, pluginSkillCheckDelayMs))

      try {
        const nextState = await addPluginSkill(nextSkill)
        setDesktopState(nextState)
      } catch {
        setDesktopState((state) => addPluginSkillLocally(state, nextSkill))
      } finally {
        setPluginSkillInstallStatuses((statuses) => ({
          ...statuses,
          [nextSkill.trigger]: '检查中',
        }))
        setPluginSkillAddress('')
        setPluginSearchQuery('')
        setPluginSourceFilter('自定义')
        setPluginStatusFilter('全部')
        setIsPluginSkillDialogOpen(false)
        setPluginSkillDialogPhase('idle')

        window.setTimeout(() => {
          setPluginSkillInstallStatuses((statuses) => (
            statuses[nextSkill.trigger] === '检查中'
              ? { ...statuses, [nextSkill.trigger]: '本地' }
              : statuses
          ))
        }, pluginSkillReadyDelayMs)
      }
    })()
  }

  const openAgentWizard = () => {
    setAgentDraft(createAgentDraft(desktopState))
    setAgentWizardStep(0)
    setIsAgentWizardOpen(true)
  }

  const closeAgentWizard = () => {
    setAgentDraft(createAgentDraft(desktopState))
    setAgentWizardStep(0)
    setIsAgentWizardOpen(false)
  }

  const updateAgentDraft = (patch: Partial<AgentCreateDraft>) => {
    setAgentDraft((draft) => ({ ...draft, ...patch }))
  }

  const updateAgentEmotionPrompt = (promptMd: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      emotion: {
        ...draft.emotion,
        promptMd,
      },
    }))
  }

  const generateAgentAvatar = () => {
    setAgentDraft(generateAgentAvatarDraft)
  }

  const uploadAgentAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        return
      }
      setAgentDraft((draft) => ({
        ...draft,
        avatar: {
          gradient: createAgentAvatar(draft).gradient,
          imageDataUrl: reader.result as string,
          initials: getAgentAvatarInitials(draft.name.trim() || '智能体'),
          source: 'uploaded',
        },
        generationNotice: '已上传头像',
      }))
    })
    reader.readAsDataURL(file)
  }

  const updateAgentVoice = (patch: Partial<AgentVoiceConfig>) => {
    setAgentDraft((draft) => ({
      ...draft,
      voice: {
        ...draft.voice,
        ...patch,
      },
    }))
  }

  const uploadAgentVoiceCloneSample = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }

    updateAgentVoice({
      cloneSampleName: file.name,
      cloneVoiceName: agentDraft.voice.cloneVoiceName || `${agentDraft.name.trim() || '新智能体'}声音`,
      source: 'voice-clone',
    })
  }

  const generateAgentVoiceStyle = () => {
    updateAgentVoice({ style: createVoiceStyleFromEmotionPrompt(agentDraft.emotion.promptMd) })
  }

  const toggleAgentDraftChannel = (channelId: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      channels: draft.channels.map((channel) => (
        channel.id === channelId ? { ...channel, enabled: !channel.enabled } : channel
      )),
    }))
  }

  const updateAgentDraftChannelConfig = (channelId: string, patch: Partial<AgentChannelConfig>) => {
    setAgentDraft((draft) => ({
      ...draft,
      channels: draft.channels.map((channel) => {
        if (channel.id !== channelId) {
          return channel
        }
        const config = channel.config ?? createAgentChannelConfig(channel.id)
        return {
          ...channel,
          config: {
            ...config,
            ...patch,
            fields: patch.fields ?? config.fields,
          },
        }
      }),
    }))
  }

  const updateAgentDraftChannelField = (channelId: string, fieldId: string, value: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      channels: draft.channels.map((channel) => {
        if (channel.id !== channelId) {
          return channel
        }
        const config = channel.config ?? createAgentChannelConfig(channel.id)
        return {
          ...channel,
          config: {
            ...config,
            fields: config.fields.map((field) => (
              field.id === fieldId ? { ...field, value } : field
            )),
          },
        }
      }),
    }))
  }

  const toggleAgentDraftTool = (toolId: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      toolIds: draft.toolIds.includes(toolId)
        ? draft.toolIds.filter((id) => id !== toolId)
        : [...draft.toolIds, toolId],
    }))
  }

  const toggleAgentDraftSkill = (skillId: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      skillIds: draft.skillIds.includes(skillId)
        ? draft.skillIds.filter((id) => id !== skillId)
        : [...draft.skillIds, skillId],
    }))
  }

  const goToNextAgentWizardStep = () => {
    if (!canAdvanceAgentWizard) {
      return
    }

    setAgentWizardStep((step) => Math.min(step + 1, agentWizardSteps.length - 1))
  }

  const goToPreviousAgentWizardStep = () => {
    setAgentWizardStep((step) => Math.max(step - 1, 0))
  }

  const submitAgentWizard = () => {
    const payload: CreateAgentInput = {
      avatar: agentWizardAvatar,
      channels: agentDraft.channels,
      description: derivedAgentDescription,
      emotion: agentDraft.emotion,
      model: agentDraft.model,
      name: agentDraft.name.trim(),
      permissionMode: agentDraft.permissionMode,
      role: derivedAgentRole,
      skillIds: agentDraft.skillIds,
      thinking: agentDraft.thinking,
      toolIds: agentDraft.toolIds,
      voice: agentDraft.voice,
    }
    if (!isAgentIdentityValid || !payload.name || !payload.role || !payload.channels?.some((channel) => channel.enabled)) {
      return
    }

    void applyDesktopState(() => createAgent(payload))
    setAgentDraft(createAgentDraft(desktopState))
    setAgentWizardStep(0)
    setIsAgentWizardOpen(false)
  }

  const submitMemory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = memoryDraft.title.trim()
    const summary = memoryDraft.summary.trim()
    const content = memoryDraft.content.trim()
    if (!title || !summary || !content) {
      return
    }

    const input: CreateMemoryItemInput = {
      agentId: memoryWorkspace.selectedAgentId,
      category: memoryDraft.category,
      content,
      summary,
      tags: parseMemoryTags(memoryDraft.tags),
      title,
    }
    void applyDesktopState(() => createMemoryItem(input))
    setMemoryDraft(blankMemoryDraft())
    setIsMemoryFormOpen(false)
  }

  const startMemoryEdit = () => {
    if (!selectedMemory) {
      return
    }
    setMemoryDraft({
      category: selectedMemory.category,
      content: selectedMemory.content,
      summary: selectedMemory.summary,
      tags: selectedMemory.tags.join(', '),
      title: selectedMemory.title,
    })
    setIsMemoryEditing(true)
    setIsMemoryFormOpen(false)
  }

  const saveMemoryEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedMemory) {
      return
    }
    const title = memoryDraft.title.trim()
    const summary = memoryDraft.summary.trim()
    if (!title || !summary) {
      return
    }

    const patch: UpdateMemoryItemPatch = {
      category: memoryDraft.category,
      content: memoryDraft.content.trim(),
      summary,
      tags: parseMemoryTags(memoryDraft.tags),
      title,
    }
    void applyDesktopState(() => updateMemoryItem(selectedMemory.id, patch))
    setIsMemoryEditing(false)
  }

  const archiveSelectedMemory = () => {
    if (!selectedMemory) {
      return
    }
    void applyDesktopState(() => archiveMemoryItem(selectedMemory.id))
    setIsMemoryEditing(false)
  }

  const startMemoryDream = () => {
    if (isMemoryDreaming) {
      return
    }
    void applyDesktopState(() => runMemoryDream(memoryWorkspace.selectedAgentId))
    setIsMemoryEditing(false)
    setIsMemoryFormOpen(false)
  }

  const renderMemoryWorkspace = () => (
    <div className="memory-workspace">
      <header className="config-workspace__header memory-workspace__header">
        <h1>记忆</h1>
        <div className="memory-workspace__top-actions">
          <label className="memory-agent-select">
            <span>智能体</span>
            <select
              aria-label="选择智能体"
              onChange={(event) => void applyDesktopState(() => selectMemoryAgent(event.currentTarget.value))}
              value={memoryWorkspace.selectedAgentId}
            >
              {desktopState.agentWorkspace.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label className="memory-search">
            <span className="sr-only">搜索记忆</span>
            <Search aria-hidden="true" size={15} strokeWidth={2} />
            <input
              aria-label="搜索记忆"
              onChange={(event) => {
                const value = event.currentTarget.value
                void applyDesktopState(() => setDesktopMemoryQuery(value))
              }}
              placeholder="搜索 CrawClaw 记住了什么"
              role="searchbox"
              value={memorySearchQuery}
            />
          </label>
          <button className="workspace-secondary-button" disabled={isMemoryDreaming} onClick={startMemoryDream} type="button">
            <Sparkles aria-hidden="true" size={15} strokeWidth={2.1} />
            {isMemoryDreaming ? '做梦中' : '做梦'}
          </button>
          <button className="workspace-primary-button" onClick={() => setIsMemoryFormOpen((open) => !open)} type="button">
            <Plus aria-hidden="true" size={15} strokeWidth={2.2} />
            添加记忆
          </button>
        </div>
      </header>

      <div className="memory-filter" role="radiogroup" aria-label="分类筛选">
        {memoryCategories.map((category) => (
          <button
            aria-checked={memoryFilter === category}
            className={memoryFilter === category ? 'is-active' : undefined}
            key={category}
            onClick={() => void applyDesktopState(() => setDesktopMemoryFilter(category))}
            role="radio"
            type="button"
          >
            {category}
          </button>
        ))}
      </div>

      {isMemoryDreaming ? (
        <div aria-busy="true" aria-label="做梦状态" className="memory-dream-status memory-dream-status--running" role="status">
          <span aria-hidden="true" className="memory-dream-status__orb">
            <Sparkles size={15} strokeWidth={2.1} />
          </span>
          <span className="memory-dream-status__copy">
            <strong>正在整理记忆</strong>
            <span>{memoryWorkspace.dream.message}</span>
          </span>
          <span aria-hidden="true" className="memory-dream-status__zzz">
            <i>z</i>
            <i>z</i>
            <i>z</i>
          </span>
        </div>
      ) : null}

      {isMemoryFormOpen ? (
        <form aria-label="添加记忆" className="workspace-form memory-form" onSubmit={submitMemory}>
          <label>
            标题
            <input
              onChange={(event) => {
                const value = event.currentTarget.value
                setMemoryDraft((draft) => ({ ...draft, title: value }))
              }}
              value={memoryDraft.title}
            />
          </label>
          <label>
            一句话摘要
            <input
              onChange={(event) => {
                const value = event.currentTarget.value
                setMemoryDraft((draft) => ({ ...draft, summary: value }))
              }}
              value={memoryDraft.summary}
            />
          </label>
          <label>
            内容
            <textarea
              onChange={(event) => {
                const value = event.currentTarget.value
                setMemoryDraft((draft) => ({ ...draft, content: value }))
              }}
              value={memoryDraft.content}
            />
          </label>
          <label>
            分类
            <select
              onChange={(event) => {
                const value = event.currentTarget.value as MemoryCategory
                setMemoryDraft((draft) => ({ ...draft, category: value }))
              }}
              value={memoryDraft.category}
            >
              {memoryCategories
                .filter((category): category is MemoryCategory => category !== '全部')
                .map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
            </select>
          </label>
          <label>
            标签
            <input
              onChange={(event) => {
                const value = event.currentTarget.value
                setMemoryDraft((draft) => ({ ...draft, tags: value }))
              }}
              value={memoryDraft.tags}
            />
          </label>
          <button className="workspace-primary-button" type="submit">保存记忆</button>
        </form>
      ) : null}

      <div className="memory-workspace__body">
        {selectedMemory ? (
          <Panel className="memory-detail" label="记忆详情">
            {isMemoryEditing ? (
              <form aria-label="编辑记忆" className="workspace-form" onSubmit={saveMemoryEdit}>
                <label>
                  详情标题
                  <input
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setMemoryDraft((draft) => ({ ...draft, title: value }))
                    }}
                    value={memoryDraft.title}
                  />
                </label>
                <label>
                  详情摘要
                  <input
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setMemoryDraft((draft) => ({ ...draft, summary: value }))
                    }}
                    value={memoryDraft.summary}
                  />
                </label>
                <label>
                  详情内容
                  <textarea
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setMemoryDraft((draft) => ({ ...draft, content: value }))
                    }}
                    value={memoryDraft.content}
                  />
                </label>
                <label>
                  详情分类
                  <select
                    onChange={(event) => {
                      const value = event.currentTarget.value as MemoryCategory
                      setMemoryDraft((draft) => ({ ...draft, category: value }))
                    }}
                    value={memoryDraft.category}
                  >
                    {memoryCategories
                      .filter((category): category is MemoryCategory => category !== '全部')
                      .map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                  </select>
                </label>
                <label>
                  详情标签
                  <input
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setMemoryDraft((draft) => ({ ...draft, tags: value }))
                    }}
                    value={memoryDraft.tags}
                  />
                </label>
                <button className="workspace-primary-button" type="submit">保存修改</button>
              </form>
            ) : (
              <>
                <div className="memory-detail__header">
                  <div>
                    <div className="memory-detail__meta">
                      {selectedMemoryAgent ? <Badge tone="neutral">{selectedMemoryAgent.name}</Badge> : null}
                      <Badge tone="neutral">{selectedMemory.category}</Badge>
                      <Badge tone="neutral">{selectedMemory.source}</Badge>
                      <span>{selectedMemory.updatedAt}</span>
                    </div>
                    <h2>{selectedMemory.title}</h2>
                  </div>
                  <div className="memory-detail__actions">
                    <button className="workspace-secondary-button" onClick={startMemoryEdit} type="button">编辑记忆</button>
                    <button className="workspace-secondary-button" onClick={archiveSelectedMemory} type="button">清理记忆</button>
                  </div>
                </div>
                <p>{selectedMemory.summary}</p>
                <p>{selectedMemory.content}</p>
                <div className="memory-tags">
                  {selectedMemory.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </>
            )}
          </Panel>
        ) : (
          <Panel className="memory-detail" label="记忆详情">
            <div className="memory-detail__empty">
              <strong>{selectedMemoryAgent ? selectedMemoryAgent.name : '当前智能体'} 还没有匹配记忆</strong>
              <p>可以调整搜索和分类，或者添加一条新记忆。</p>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )

  const renderSettingsSelectRow = (
    label: string,
    detail: string,
    value: string,
    options: string[],
    onSelect: (value: string) => void,
    getSelectedDetail?: (value: string) => string,
  ) => (
    <div className="settings-field">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <div className="settings-select-control">
        <select
          aria-label={label}
          className="settings-select"
          onChange={(event) => onSelect(event.currentTarget.value)}
          value={value}
        >
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="settings-select-control__icon" size={14} strokeWidth={2} />
        {getSelectedDetail ? (
          <small className="settings-select-control__detail">{getSelectedDetail(value)}</small>
        ) : null}
      </div>
    </div>
  )

  const renderModelConfigurationSelector = () => (
    renderSettingsSelectRow(
      '选择模型配置',
      '先选择一套默认回复配置，再按需要微调模型、思考等级和回复速度。',
      settingsUi.modelConfiguration,
      modelConfigurationOptions.map((option) => option.label),
      (value) => setSettingsValue('modelConfiguration', value),
      (value) => modelConfigurationOptions.find((option) => option.label === value)?.detail ?? '',
    )
  )

  const renderSettingsToggleRow = (label: string, detail: string, key: SettingsToggleKey) => (
    <div className="settings-field">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <button
        aria-label={label}
        aria-pressed={settingsUi.toggles[key]}
        className={settingsUi.toggles[key] ? 'settings-switch is-on' : 'settings-switch'}
        onClick={() => toggleSettingsValue(key)}
        type="button"
      >
        <span>{settingsUi.toggles[key] ? '开启' : '关闭'}</span>
        <i aria-hidden="true" />
      </button>
    </div>
  )

  const renderSettingsValueRow = (label: string, detail: string, value: string) => (
    <div className="settings-field">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <span className="settings-value-pill">{value}</span>
    </div>
  )

  const renderSettingsActionRow = (label: string, detail: string, tone: 'neutral' | 'danger' = 'neutral') => (
    <div className="settings-field">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <button className={`settings-action-button is-${tone}`} disabled type="button">
        稍后接入
      </button>
    </div>
  )

  const renderAddModelRow = () => (
    <div className="settings-field settings-field--model-add">
      <div className="settings-field__label">
        <strong>模型</strong>
        <span>添加一个可在默认模型中选择的模型名称。</span>
      </div>
      {isAddingModel ? (
        <form className="settings-model-add-form" onSubmit={submitCustomModel}>
          <input
            aria-label="模型名称"
            autoFocus
            onChange={(event) => setModelDraftName(event.currentTarget.value)}
            placeholder="输入模型名称"
            value={modelDraftName}
          />
          <button disabled={!modelDraftName.trim()} type="submit">保存模型</button>
          <button
            onClick={() => {
              setIsAddingModel(false)
              setModelDraftName('')
            }}
            type="button"
          >
            取消
          </button>
        </form>
      ) : (
        <button className="settings-action-button" onClick={() => setIsAddingModel(true)} type="button">
          添加模型
        </button>
      )}
    </div>
  )

  const getSettingsSectionClass = (id: SettingsSectionId) => (
    activeSettingsSection === id ? 'settings-section is-active' : 'settings-section'
  )

  const renderSettingsWorkspace = () => (
    <div className="settings-workspace">
      <header className="settings-workspace__header">
        <h1>设置</h1>
        <p>调整 CrawClaw 的默认规则和偏好，不重复管理智能体、记忆、插件或自动化。</p>
      </header>

      <div className="settings-workspace__body">
        <section aria-label="常规" className={getSettingsSectionClass('general')} id="settings-general">
          <header className="settings-section__header">
            <h2>常规</h2>
            <p>控制桌面应用的基础使用习惯。</p>
          </header>
          <div className="settings-group">
            {renderSettingsSelectRow('默认打开页面', '启动后默认进入哪个工作区。', settingsUi.defaultPage, ['新对话', '记忆', '智能体'], (value) => setSettingsValue('defaultPage', value))}
            {renderSettingsSelectRow('语言', '设置桌面界面的显示语言。', settingsUi.language, ['中文', 'English'], (value) => setSettingsValue('language', value))}
            {renderSettingsSelectRow('外观', '选择界面颜色模式。', settingsUi.appearance, ['跟随系统', '浅色', '深色'], (value) => setSettingsValue('appearance', value))}
            {renderSettingsToggleRow('启动时打开 CrawClaw', '登录系统后自动打开桌面应用。', 'launchAtLogin')}
            {renderSettingsToggleRow('在菜单栏显示', '保留菜单栏入口，便于快速唤起。', 'showInMenuBar')}
          </div>
        </section>

        <section aria-label="模型与回复" className={getSettingsSectionClass('model')} id="settings-model">
          <header className="settings-section__header">
            <h2>模型与回复</h2>
            <p>设置新对话默认使用的模型、推理强度和回复偏好。</p>
          </header>
          <div className="settings-group">
            {renderModelConfigurationSelector()}
            {renderSettingsSelectRow('默认模型', '选择 CrawClaw 默认使用的模型。', selectedModel, modelOptions, (value) => applyPreferenceUpdate({ selectedModel: value }))}
            {renderAddModelRow()}
            {renderSettingsSelectRow('思考等级', '决定回复前花多少时间推理。', selectedThinking, desktopState.preferences.thinkingOptions, (value) => applyPreferenceUpdate({ selectedThinking: value }))}
            {renderSettingsSelectRow('回复速度', '控制回复时更重视速度还是稳定性。', settingsUi.responseSpeed, ['标准', '更快', '更稳'], (value) => setSettingsValue('responseSpeed', value))}
            {renderSettingsToggleRow('默认允许工具', '新对话默认允许 CrawClaw 使用工具完成任务。', 'allowTools')}
            {renderSettingsToggleRow('显示推理摘要', '在适合的回复里显示简短思考摘要。', 'showReasoningSummary')}
          </div>
        </section>

        <section aria-label="权限与确认" className={getSettingsSectionClass('permissions')} id="settings-permissions">
          <header className="settings-section__header">
            <h2>权限与确认</h2>
            <p>控制 CrawClaw 默认能查看或操作哪些内容。</p>
          </header>
          <div className="settings-group">
            {renderSettingsSelectRow(
              '权限模式',
              '选择 CrawClaw 默认能查看或操作哪些内容。',
              permissionMode,
              desktopState.preferences.permissionModeOptions,
              (value) => applyPreferenceUpdate({ permissionMode: value }),
              getPermissionModeDescription,
            )}
            {renderSettingsToggleRow('修改文件前确认', '写入或覆盖文件前先询问你。', 'confirmFileChanges')}
            {renderSettingsToggleRow('执行命令前确认', '运行本机命令前先显示确认。', 'confirmCommands')}
            {renderSettingsToggleRow('操作外部应用前确认', '控制浏览器、日历或其他应用前先确认。', 'confirmExternalApps')}
            {renderSettingsToggleRow('高风险操作始终确认', '删除、发布、支付等操作始终需要确认。', 'confirmHighRisk')}
          </div>
        </section>

        <section aria-label="记忆偏好" className={getSettingsSectionClass('memory')} id="settings-memory">
          <header className="settings-section__header">
            <h2>记忆偏好</h2>
            <p>控制 CrawClaw 什么时候记住、整理和清理信息。</p>
          </header>
          <div className="settings-group">
            {renderSettingsToggleRow('自动记住偏好', '允许 CrawClaw 自动保存稳定的个人偏好。', 'rememberPreferences')}
            {renderSettingsToggleRow('整理项目上下文', '允许 CrawClaw 将项目相关事实整理为长期上下文。', 'rememberProjectContext')}
            {renderSettingsToggleRow('做梦整理记忆', '空闲时整理最近对话中的长期记忆。', 'memoryDreamEnabled')}
            {renderSettingsSelectRow('做梦频率', '决定记忆整理触发的频率。', settingsUi.memoryDreamFrequency, ['空闲时', '每天', '手动'], (value) => setSettingsValue('memoryDreamFrequency', value))}
            {renderSettingsSelectRow('清理记忆确认', '清理记忆前是否需要再次确认。', settingsUi.memoryCleanupConfirmation, ['每次确认', '仅重要记忆', '不自动清理'], (value) => setSettingsValue('memoryCleanupConfirmation', value))}
          </div>
        </section>

        <section aria-label="通知" className={getSettingsSectionClass('notifications')} id="settings-notifications">
          <header className="settings-section__header">
            <h2>通知</h2>
            <p>决定什么时候让 CrawClaw 主动提醒你。</p>
          </header>
          <div className="settings-group">
            {renderSettingsToggleRow('任务完成通知', '长任务完成后发送通知。', 'notifyTaskDone')}
            {renderSettingsToggleRow('需要确认时通知', '需要你确认权限或操作时提醒。', 'notifyConfirmNeeded')}
            {renderSettingsToggleRow('做梦完成通知', '记忆整理完成后提醒。', 'notifyDreamDone')}
            {renderSettingsToggleRow('自动化失败通知', '自动化任务失败时提醒。', 'notifyAutomationFailed')}
            {renderSettingsToggleRow('声音提示', '通知出现时播放提示音。', 'notificationSound')}
          </div>
        </section>

        <section aria-label="数据与隐私" className={getSettingsSectionClass('privacy')} id="settings-privacy">
          <header className="settings-section__header">
            <h2>数据与隐私</h2>
            <p>查看本机数据位置，并保留后续清理与导出入口。</p>
          </header>
          <div className="settings-group">
            {renderSettingsValueRow('本机数据位置', 'CrawClaw Desktop 默认把数据保存在本机。', settingsUi.dataLocation)}
            {renderSettingsActionRow('清理缓存', '清理临时预览、下载和运行缓存。')}
            {renderSettingsActionRow('导出数据', '导出本机偏好、记忆和设置快照。')}
            {renderSettingsActionRow('删除本机数据', '删除前会要求再次确认。', 'danger')}
          </div>
        </section>

        <section aria-label="高级" className={getSettingsSectionClass('advanced')} id="settings-advanced">
          <header className="settings-section__header">
            <h2>高级</h2>
            <p>只保留诊断入口和状态表达，不进入普通工作流。</p>
          </header>
          <div className="settings-group">
            {renderSettingsSelectRow('日志级别', '控制本机诊断日志的详细程度。', settingsUi.logLevel, ['标准', '详细', '错误'], (value) => setSettingsValue('logLevel', value))}
            {renderSettingsValueRow('Runtime 状态', '当前本机 CrawClaw runtime 的摘要状态。', runtimeChecks.find((item) => item.label === 'Runtime')?.value ?? '未知')}
            {renderSettingsActionRow('诊断信息', '生成给开发者排查问题用的本机诊断信息。')}
            {renderSettingsActionRow('重置桌面状态', '只重置桌面 UI 状态，不删除真实项目文件。', 'danger')}
          </div>
        </section>
      </div>
    </div>
  )

  const renderSettingsSidebar = () => (
    <aside aria-label="设置导航" className="desktop-sidebar settings-sidebar">
      <button className="settings-sidebar__back" onClick={returnToApp} type="button">
        <ChevronLeft aria-hidden="true" size={15} strokeWidth={2} />
        <span>返回应用</span>
      </button>
      <nav aria-label="设置分类" className="settings-sidebar__nav">
        {settingsSections.map((section) => (
          <button
            className={activeSettingsSection === section.id ? 'is-active' : ''}
            key={section.id}
            onClick={() => selectSettingsSection(section.id)}
            type="button"
          >
            <section.icon aria-hidden="true" size={15} strokeWidth={2} />
            <span>{section.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  )

  const renderPluginWorkspace = () => (
    <div className="plugin-catalog">
      <h1>让 CrawClaw 按你的方式工作</h1>

      <div className="plugin-catalog__toolbar" aria-label="插件筛选">
        <label>
          <Search aria-hidden="true" size={15} strokeWidth={2} />
          <span className="sr-only">搜索插件</span>
          <input
            onChange={(event) => setPluginSearchQuery(event.currentTarget.value)}
            placeholder="搜索插件"
            value={pluginSearchQuery}
          />
        </label>
        <div className="plugin-filter">
          <button
            aria-expanded={selectorOpen === 'plugin-source'}
            aria-haspopup="menu"
            className="plugin-filter-pill"
            onClick={() => setSelectorOpen(selectorOpen === 'plugin-source' ? null : 'plugin-source')}
            type="button"
          >
            {pluginSourceFilter}
            <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
          </button>
          {selectorOpen === 'plugin-source' ? (
            <div aria-label="插件来源选择" className="selector-menu plugin-filter-menu" onKeyDown={handleMenuKeyDown} role="menu">
              {pluginSourceFilters.map((filter) => (
                <button
                  className={filter === pluginSourceFilter ? 'is-selected' : ''}
                  key={filter}
                  onClick={() => {
                    setPluginSourceFilter(filter)
                    setSelectorOpen(null)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {filter}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="plugin-filter">
          <button
            aria-expanded={selectorOpen === 'plugin-status'}
            aria-haspopup="menu"
            className="plugin-filter-pill"
            onClick={() => setSelectorOpen(selectorOpen === 'plugin-status' ? null : 'plugin-status')}
            type="button"
          >
            {pluginStatusFilter}
            <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
          </button>
          {selectorOpen === 'plugin-status' ? (
            <div aria-label="插件状态选择" className="selector-menu plugin-filter-menu" onKeyDown={handleMenuKeyDown} role="menu">
              {pluginStatusFilters.map((filter) => (
                <button
                  className={filter === pluginStatusFilter ? 'is-selected' : ''}
                  key={filter}
                  onClick={() => {
                    setPluginStatusFilter(filter)
                    setSelectorOpen(null)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {filter}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {!normalizedPluginSearch ? (
        <section className="plugin-hero" aria-label="推荐插件">
          <div className="plugin-hero__card">
            <span className="plugin-hero__icon">
              <Sparkles aria-hidden="true" size={15} strokeWidth={2.2} />
            </span>
            <strong>macOS UI polish</strong>
            <span>打磨桌面端气泡、动效和输入体验</span>
          </div>
          <button className="plugin-hero__action" onClick={tryFeaturedPlugin} type="button">
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

      <section className="plugin-featured" aria-labelledby="plugin-featured-title">
        <div className="plugin-featured__header">
          <h2 id="plugin-featured-title">Featured</h2>
          <button
            className="workspace-secondary-button"
            onClick={() => {
              setPluginSkillAddress('')
              setIsPluginSkillDialogOpen(true)
            }}
            type="button"
          >
            <Plus aria-hidden="true" size={15} strokeWidth={2.2} />
            添加技能
          </button>
        </div>

        <div className="plugin-featured__list">
          {visiblePluginSkills.length > 0 ? (
            visiblePluginSkills.map((skill) => (
              <PluginSkillRow
                key={skill.id}
                onToggle={() => void applyDesktopState(() => togglePluginSkill(skill.id))}
                skill={skill}
                status={getPluginSkillDisplayStatus(skill)}
              />
            ))
          ) : (
            <p className="plugin-featured__empty">没有找到匹配的插件。</p>
          )}
        </div>
      </section>

      {isPluginSkillDialogOpen ? (
        <div
          className="plugin-skill-dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPluginSkillChecking) {
              setIsPluginSkillDialogOpen(false)
            }
          }}
        >
          <form
            aria-labelledby="plugin-skill-dialog-title"
            aria-modal="true"
            className="plugin-skill-dialog"
            onSubmit={submitPluginSkill}
            role="dialog"
          >
            <header className="plugin-skill-dialog__header">
              <span className="plugin-skill-dialog__icon">
                <Sparkles aria-hidden="true" size={17} strokeWidth={2.2} />
              </span>
              <div>
                <h2 id="plugin-skill-dialog-title">添加技能</h2>
                <p>粘贴 GitHub 地址或技能地址，后续安装流程会接到这里。</p>
              </div>
              <button
                aria-label="关闭添加技能"
                disabled={isPluginSkillChecking}
                onClick={() => setIsPluginSkillDialogOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            </header>

            <label className="plugin-skill-dialog__field">
              <span>技能地址</span>
              <input
                autoFocus
                disabled={isPluginSkillChecking}
                onChange={(event) => setPluginSkillAddress(event.currentTarget.value)}
                placeholder="GitHub 地址或技能地址"
                value={pluginSkillAddress}
              />
            </label>

            {isPluginSkillChecking ? (
              <ol aria-label="添加技能进度" className="plugin-skill-dialog__steps">
                {pluginSkillInstallSteps.map((step) => (
                  <li key={step}>
                    <span aria-hidden="true" />
                    {step}
                  </li>
                ))}
              </ol>
            ) : null}

            <div className="plugin-skill-dialog__examples" aria-label="地址格式示例">
              <span>支持</span>
              <code>github.com/owner/repo/skills/name</code>
              <code>crawclaw://skills/name</code>
            </div>

            <footer className="plugin-skill-dialog__footer">
              <button disabled={isPluginSkillChecking} onClick={() => setIsPluginSkillDialogOpen(false)} type="button">取消</button>
              <button className="plugin-skill-dialog__submit" disabled={!canSubmitPluginSkill} type="submit">
                {isPluginSkillChecking ? '正在检查…' : '添加'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  )

  const renderToolChoice = (tool: AgentTool) => (
    <label className="agent-create-wizard__check-card" key={tool.id}>
      <input
        aria-label={`启用工具：${tool.name}`}
        checked={agentDraft.toolIds.includes(tool.id)}
        onChange={() => toggleAgentDraftTool(tool.id)}
        type="checkbox"
      />
      <span>
        <strong>{tool.name}</strong>
        <small>{tool.description}</small>
      </span>
    </label>
  )

  const renderSkillChoice = (skill: AgentSkill) => (
    <label className="agent-create-wizard__check-card" key={skill.id}>
      <input
        aria-label={`启用 Skill：${skill.name}`}
        checked={agentDraft.skillIds.includes(skill.id)}
        onChange={() => toggleAgentDraftSkill(skill.id)}
        type="checkbox"
      />
      <span>
        <strong>{skill.name}</strong>
        <small>{skill.trigger}</small>
      </span>
    </label>
  )

  const renderAgentChannelConfigField = (channel: AgentChannelBinding, field: AgentChannelConfigField) => {
    if (field.id === 'markdownSupport') {
      return (
        <label className="agent-create-wizard__channel-toggle" key={field.id}>
          <input
            aria-label={`${channel.label} ${field.label}`}
            checked={field.value !== 'false'}
            onChange={(event) => updateAgentDraftChannelField(channel.id, field.id, event.currentTarget.checked ? 'true' : 'false')}
            type="checkbox"
          />
          <span>{field.label}</span>
        </label>
      )
    }

    return (
      <label className="agent-create-wizard__field agent-create-wizard__field--channel-secret" key={field.id}>
        <span>{`${channel.label} ${field.label}`}</span>
        <input
          aria-label={`${channel.label} ${field.label}`}
          onChange={(event) => updateAgentDraftChannelField(channel.id, field.id, event.currentTarget.value)}
          type={field.secret ? 'password' : 'text'}
          value={field.value}
        />
      </label>
    )
  }

  const renderAgentChannelConfig = (channel: AgentChannelBinding) => {
    const config = channel.config ?? createAgentChannelConfig(channel.id)

    if (channel.id === 'desktop') {
      return (
        <section aria-label={`${channel.label} 渠道配置`} className="agent-create-wizard__channel-config" key={channel.id}>
          <div className="agent-create-wizard__channel-config-header">
            <strong>{channel.label}</strong>
            <span>本机桌面</span>
          </div>
          <div className="agent-create-wizard__channel-static">
            <span>入口</span>
            <strong>本机桌面</strong>
          </div>
        </section>
      )
    }

    return (
      <section aria-label={`${channel.label} 渠道配置`} className="agent-create-wizard__channel-config" key={channel.id}>
        <div className="agent-create-wizard__channel-config-header">
          <strong>{channel.label}</strong>
          <span>
            {channel.id === 'weixin' ? '扫码或配对登录' : channel.id === 'esp32' ? '本机设备连接参数' : '保存连接参数'}
          </span>
        </div>
        <div className="agent-create-wizard__channel-config-grid">
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>{`${channel.label} 账号 ID`}</span>
            <input
              aria-label={`${channel.label} 账号 ID`}
              onChange={(event) => updateAgentDraftChannelConfig(channel.id, { accountId: event.currentTarget.value })}
              value={config.accountId}
            />
          </label>
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>{`${channel.label} 默认目标`}</span>
            <input
              aria-label={`${channel.label} 默认目标`}
              onChange={(event) => updateAgentDraftChannelConfig(channel.id, { target: event.currentTarget.value })}
              placeholder={channel.id === 'feishu' ? 'open_chat_id / user_id' : '会话、群或频道 ID'}
              value={config.target}
            />
          </label>
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>{`${channel.label} DM 策略`}</span>
            <select
              aria-label={`${channel.label} DM 策略`}
              onChange={(event) => updateAgentDraftChannelConfig(channel.id, { dmPolicy: event.currentTarget.value })}
              value={config.dmPolicy}
            >
              {agentChannelDmPolicies.map((policy) => (
                <option key={policy.id} value={policy.id}>{policy.label}</option>
              ))}
            </select>
          </label>
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>{`${channel.label} 群聊策略`}</span>
            <select
              aria-label={`${channel.label} 群聊策略`}
              onChange={(event) => updateAgentDraftChannelConfig(channel.id, { groupPolicy: event.currentTarget.value })}
              value={config.groupPolicy}
            >
              {agentChannelGroupPolicies.map((policy) => (
                <option key={policy.id} value={policy.id}>{policy.label}</option>
              ))}
            </select>
          </label>
        </div>
        {config.fields.length ? (
          <div className="agent-create-wizard__channel-secret-grid">
            {config.fields.map((field) => renderAgentChannelConfigField(channel, field))}
          </div>
        ) : (
          <p className="agent-create-wizard__channel-note">
            {channel.id === 'weixin'
              ? '微信使用扫码或本机配对完成登录，这里只保存账号和目标偏好。'
              : channel.id === 'esp32'
                ? 'ESP32 使用本机托管的 MQTT/UDP 连接参数。'
                : '当前渠道不需要额外凭据字段。'}
          </p>
        )}
      </section>
    )
  }

  const enabledAgentChannelDetails = agentDraft.channels
    .filter((channel) => channel.enabled)
    .map(formatAgentChannelConfigSummary)
    .filter(Boolean)

  const renderAgentWizardStepContent = () => {
    if (agentWizardActiveStep === '身份情感') {
      return (
        <div className="agent-create-wizard__identity">
          <div className="agent-create-wizard__fields">
            <label className="agent-create-wizard__field">
              <span>智能体名称</span>
              <input
                autoFocus
                onChange={(event) => updateAgentDraft({ name: event.currentTarget.value })}
                value={agentDraft.name}
              />
            </label>
            <label className="agent-create-wizard__field agent-create-wizard__field--agent-md">
              <span>智能体设定 Markdown</span>
              <textarea
                onChange={(event) => updateAgentDraft({ agentMd: event.currentTarget.value })}
                value={agentDraft.agentMd}
              />
            </label>
            <label className="agent-create-wizard__field agent-create-wizard__field--prompt">
              <span>情感提示词 Markdown</span>
              <textarea
                onChange={(event) => updateAgentEmotionPrompt(event.currentTarget.value)}
                value={agentDraft.emotion.promptMd}
              />
            </label>
          </div>
          <aside className="agent-create-wizard__avatar-preview" aria-label="智能体头像预览">
            <span
              className={agentWizardAvatar.imageDataUrl ? 'agent-create-wizard__avatar has-image' : 'agent-create-wizard__avatar'}
              role="img"
              style={getAgentAvatarPreviewStyle(agentWizardAvatar)}
            >
              {agentWizardAvatar.imageDataUrl ? null : <strong>{agentWizardAvatar.initials}</strong>}
            </span>
            <strong>{agentDraft.name.trim() || '新智能体'}</strong>
            <small>{derivedAgentRole}</small>
            <button
              className="agent-create-wizard__generate-button"
              disabled={!agentDraft.name.trim() || !agentDraft.agentMd.trim()}
              onClick={generateAgentAvatar}
              type="button"
            >
              <Sparkles aria-hidden="true" size={14} strokeWidth={2.2} />
              AI 生成头像
            </button>
            <label className="agent-create-wizard__upload-button">
              <input accept="image/*" onChange={uploadAgentAvatar} type="file" />
              <span>
                <ImageIcon aria-hidden="true" size={14} strokeWidth={2.1} />
                上传头像
              </span>
            </label>
            {agentDraft.generationNotice ? (
              <small>{agentDraft.generationNotice}</small>
            ) : null}
          </aside>
        </div>
      )
    }

    if (agentWizardActiveStep === '语音') {
      const selectedVoicePreset = qwenVoicePresets.find((voice) => voice.id === agentDraft.voice.presetVoice) ?? qwenVoicePresets[0]

      return (
        <div className="agent-create-wizard__section">
          <h3>语音偏好</h3>
          <div className="agent-create-wizard__checks">
            <label className="agent-create-wizard__check-card">
              <input
                aria-label="启用语音"
                checked={agentDraft.voice.enabled}
                onChange={(event) => updateAgentVoice({ enabled: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>
                <strong>启用语音</strong>
                <small>保存语音入口和播报偏好</small>
              </span>
            </label>
            <label className="agent-create-wizard__check-card">
              <input
                aria-label="语音播报"
                checked={agentDraft.voice.outputEnabled}
                onChange={(event) => updateAgentVoice({ outputEnabled: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>
                <strong>语音播报</strong>
                <small>允许回复时播报摘要</small>
              </span>
            </label>
            <label className="agent-create-wizard__check-card">
              <input
                aria-label="唤醒响应"
                checked={agentDraft.voice.wakeEnabled}
                onChange={(event) => updateAgentVoice({ wakeEnabled: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>
                <strong>唤醒响应</strong>
                <small>保留后续语音唤醒入口</small>
              </span>
            </label>
          </div>
          <div className="agent-create-wizard__voice-source" aria-label="声音来源" role="group">
            {agentVoiceSourceOptions.map((source) => (
              <button
                aria-label={source.label}
                aria-pressed={agentDraft.voice.source === source.id}
                className={agentDraft.voice.source === source.id ? 'is-selected' : ''}
                key={source.id}
                onClick={() => updateAgentVoice({ source: source.id })}
                type="button"
              >
                <strong>{source.label}</strong>
                <small>{source.detail}</small>
              </button>
            ))}
          </div>
          {agentDraft.voice.source === 'qwen-preset' ? (
            <section aria-label="预设音色" className="agent-create-wizard__voice-presets">
              <span className="agent-create-wizard__label">Qwen-TTS 预设音色</span>
              <div className="agent-create-wizard__voice-preset-grid">
                {qwenVoicePresets.map((voice, index) => (
                  <button
                    aria-label={`音色 ${voice.label}${index === 0 ? ' 推荐' : ''}`}
                    aria-pressed={agentDraft.voice.presetVoice === voice.id}
                    className={agentDraft.voice.presetVoice === voice.id ? 'is-selected' : ''}
                    key={voice.id}
                    onClick={() => updateAgentVoice({ presetVoice: voice.id })}
                    type="button"
                  >
                    <strong>{voice.label}</strong>
                    <small>{voice.detail}</small>
                  </button>
                ))}
              </div>
              <p>当前 voice 参数：{selectedVoicePreset.id}</p>
            </section>
          ) : null}
          {agentDraft.voice.source === 'voice-design' ? (
            <section aria-label="描述生成声音" className="agent-create-wizard__voice-design">
              <label className="agent-create-wizard__field">
                <span>声音描述</span>
                <textarea
                  onChange={(event) => updateAgentVoice({ designPrompt: event.currentTarget.value })}
                  value={agentDraft.voice.designPrompt}
                />
              </label>
            </section>
          ) : null}
          {agentDraft.voice.source === 'voice-clone' ? (
            <section aria-label="克隆声音样本" className="agent-create-wizard__voice-clone">
              <label className="agent-create-wizard__field agent-create-wizard__field--compact">
                <span>克隆声音名称</span>
                <input
                  onChange={(event) => updateAgentVoice({ cloneVoiceName: event.currentTarget.value })}
                  value={agentDraft.voice.cloneVoiceName}
                />
              </label>
              <label className="agent-create-wizard__upload-button agent-create-wizard__upload-button--audio">
                <input accept="audio/*" aria-label="上传克隆声音样本" onChange={uploadAgentVoiceCloneSample} type="file" />
                <span>
                  <AudioLines aria-hidden="true" size={14} strokeWidth={2.1} />
                  上传克隆声音样本
                </span>
              </label>
              <small>{agentDraft.voice.cloneSampleName || '尚未选择音频样本'}</small>
            </section>
          ) : null}
          <div className="agent-create-wizard__voice-style">
            <div className="agent-create-wizard__generation-row">
              <span className="agent-create-wizard__label">语言风格</span>
              <button className="agent-create-wizard__generate-button" onClick={generateAgentVoiceStyle} type="button">
                <Sparkles aria-hidden="true" size={14} strokeWidth={2.2} />
                根据情感提示词生成
              </button>
            </div>
            <label className="agent-create-wizard__field agent-create-wizard__field--compact agent-create-wizard__field--voice-style">
              <span>自定义语言风格</span>
              <input
                onChange={(event) => updateAgentVoice({ style: event.currentTarget.value })}
                value={agentDraft.voice.style}
              />
            </label>
          </div>
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>回复节奏</span>
            <select
              onChange={(event) => updateAgentVoice({ pace: event.currentTarget.value })}
              value={agentDraft.voice.pace}
            >
              {agentVoicePaces.map((pace) => (
                <option key={pace} value={pace}>{pace}</option>
              ))}
            </select>
          </label>
        </div>
      )
    }

    if (agentWizardActiveStep === '渠道') {
      const enabledChannels = agentDraft.channels.filter((channel) => channel.enabled)
      return (
        <div className="agent-create-wizard__section">
          <h3>绑定渠道</h3>
          <div className="agent-create-wizard__channel-layout">
            <div className="agent-create-wizard__checks agent-create-wizard__checks--channels">
              {agentDraft.channels.map((channel) => (
                <label className="agent-create-wizard__check-card" key={channel.id}>
                  <input
                    aria-label={channel.label}
                    checked={channel.enabled}
                    onChange={() => toggleAgentDraftChannel(channel.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{channel.label}</strong>
                    <small>{channel.id === 'desktop' ? '本机桌面入口' : '启用后配置账号、目标和凭据'}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="agent-create-wizard__channel-configs">
              {enabledChannels.map(renderAgentChannelConfig)}
            </div>
          </div>
        </div>
      )
    }

    if (agentWizardActiveStep === '模型选择') {
      return (
        <div className="agent-create-wizard__model-layout">
          <section aria-label="选择模型" className="agent-create-wizard__model-picker" role="group">
            <div className="agent-create-wizard__section-heading">
              <h3>模型选择</h3>
              <p>先确定智能体默认使用的模型，再配置思考强度和权限边界。</p>
            </div>
            <div className="agent-create-wizard__model-list">
              {modelOptions.map((model, index) => {
                const isSelected = agentDraft.model === model
                const isRecommended = index === 0
                const modelDescription = model.includes('5.4')
                  ? '响应更轻，适合高频流程和日常任务。'
                  : model.includes('Sonnet')
                    ? '适合代码审查、长上下文和结构化分析。'
                    : '默认推荐，适合复杂规划和多步骤执行。'

                return (
                  <button
                    aria-label={`模型 ${model}${isRecommended ? ' 推荐' : ''}`}
                    aria-pressed={isSelected}
                    className={isSelected ? 'agent-create-wizard__model-card is-selected' : 'agent-create-wizard__model-card'}
                    key={model}
                    onClick={() => updateAgentDraft({ model })}
                    type="button"
                  >
                    <span className="agent-create-wizard__model-icon">
                      {isRecommended ? (
                        <Sparkles aria-hidden="true" size={16} strokeWidth={2.1} />
                      ) : (
                        <Bot aria-hidden="true" size={16} strokeWidth={2.1} />
                      )}
                    </span>
                    <span className="agent-create-wizard__model-body">
                      <span>
                        <strong>{model}</strong>
                        {isRecommended ? <em>推荐</em> : null}
                      </span>
                      <small>{modelDescription}</small>
                    </span>
                    {isSelected ? (
                      <CheckCircle2 aria-hidden="true" className="agent-create-wizard__model-check" size={17} strokeWidth={2.2} />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </section>
          <aside aria-label="模型配置" className="agent-create-wizard__model-config" role="region">
            <div className="agent-create-wizard__model-summary">
              <span>当前配置</span>
              <strong>{agentDraft.model}</strong>
              <p>思考模式 {agentDraft.thinking} · 权限 {agentDraft.permissionMode}</p>
            </div>
            <div className="agent-create-wizard__config-block">
              <span className="agent-create-wizard__label">思考模式</span>
              <div className="agent-create-wizard__segmented">
                {desktopState.preferences.thinkingOptions.map((thinking) => (
                  <button
                    aria-pressed={agentDraft.thinking === thinking}
                    className={agentDraft.thinking === thinking ? 'is-selected' : ''}
                    key={thinking}
                    onClick={() => updateAgentDraft({ thinking })}
                    type="button"
                  >
                    <Brain aria-hidden="true" size={13} strokeWidth={2.1} />
                    {thinking}
                  </button>
                ))}
              </div>
            </div>
            <div className="agent-create-wizard__config-block">
              <span className="agent-create-wizard__label">权限模式</span>
              <div className="agent-create-wizard__permission-list">
                {desktopState.preferences.permissionModeOptions.map((permissionModeOption) => (
                  <button
                    aria-pressed={agentDraft.permissionMode === permissionModeOption}
                    className={agentDraft.permissionMode === permissionModeOption ? 'is-selected' : ''}
                    key={permissionModeOption}
                    onClick={() => updateAgentDraft({ permissionMode: permissionModeOption })}
                    type="button"
                  >
                    <ShieldCheck aria-hidden="true" size={14} strokeWidth={2.1} />
                    <span>{permissionModeOption}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )
    }

    if (agentWizardActiveStep === '能力') {
      return (
        <div className="agent-create-wizard__section">
          <h3>能力选择</h3>
          <span className="agent-create-wizard__label">Tools</span>
          <div className="agent-create-wizard__checks">
            {agentToolOptions.map(renderToolChoice)}
          </div>
          <span className="agent-create-wizard__label">Skills</span>
          <div className="agent-create-wizard__checks">
            {agentSkillOptions.map(renderSkillChoice)}
          </div>
        </div>
      )
    }

    const enabledChannels = agentDraft.channels.filter((channel) => channel.enabled).map((channel) => channel.label)
    return (
      <div className="agent-create-wizard__section">
        <h3>确认创建</h3>
        <div className="agent-create-wizard__summary">
          <span><strong>身份</strong>{agentDraft.name.trim()} · {derivedAgentRole}</span>
          <span><strong>任务</strong>{derivedAgentDescription}</span>
          <span>
            <strong>情感</strong>
            {agentDraft.emotion.style}
            {agentDraft.emotion.promptMd.trim() ? <em>已填写情感提示词</em> : <em>未填写情感提示词</em>}
          </span>
          <span><strong>语音</strong>{agentDraft.voice.enabled ? '语音已启用' : '语音关闭'} · {agentVoiceSourceOptions.find((source) => source.id === agentDraft.voice.source)?.label ?? 'Qwen 系统音色'} · {agentDraft.voice.source === 'voice-clone' ? (agentDraft.voice.cloneSampleName || '未上传样本') : agentDraft.voice.presetVoice} · {agentDraft.voice.style} · {agentDraft.voice.pace}</span>
          <span><strong>渠道</strong>{enabledChannels.join('、')}</span>
          {enabledAgentChannelDetails.length ? <span><strong>渠道配置</strong>{enabledAgentChannelDetails.join('；')}</span> : null}
          <span><strong>模型</strong>{agentDraft.model} · 思考模式 {agentDraft.thinking} · {agentDraft.permissionMode}</span>
          <span><strong>能力</strong>{agentDraft.toolIds.length} 个工具 · {agentDraft.skillIds.length} 个 Skill</span>
        </div>
      </div>
    )
  }

  const renderAgentCreateWizard = () => (
    <div
      className="agent-create-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeAgentWizard()
        }
      }}
    >
      <div
        aria-labelledby="agent-create-dialog-title"
        aria-modal="true"
        className="agent-create-dialog agent-create-wizard"
        role="dialog"
      >
        <header className="agent-create-dialog__header">
          <span className="agent-create-dialog__icon">
            <Bot aria-hidden="true" size={18} strokeWidth={2.2} />
          </span>
          <div>
            <h2 id="agent-create-dialog-title">新建智能体</h2>
            <p>按步骤完成配置，最后一次性创建。</p>
          </div>
          <button aria-label="关闭新建智能体" onClick={closeAgentWizard} type="button">
            <X aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        </header>

        <div className="agent-create-dialog__steps agent-create-wizard__steps agent-create-wizard__node-rail" aria-label="新建智能体引导">
          {agentWizardSteps.map((step, index) => (
            <span className="agent-create-wizard__step-node" key={step}>
              <span
                aria-label={`${index + 1} ${step}`}
                className={index === agentWizardStep ? 'agent-create-wizard__node is-active' : index < agentWizardStep ? 'agent-create-wizard__node is-complete' : 'agent-create-wizard__node'}
              >
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </span>
              {index < agentWizardSteps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={index < agentWizardStep ? 'agent-create-wizard__connector is-complete' : 'agent-create-wizard__connector'}
                />
              ) : null}
            </span>
          ))}
        </div>

        <section className="agent-create-wizard__body" aria-label={`当前步骤：${agentWizardActiveStep}`}>
          {renderAgentWizardStepContent()}
        </section>

        <footer className="agent-create-dialog__footer agent-create-wizard__footer">
          <button disabled={agentWizardStep === 0} onClick={goToPreviousAgentWizardStep} type="button">上一步</button>
          {agentWizardStep === agentWizardSteps.length - 1 ? (
            <button
              className="agent-create-dialog__submit"
              disabled={!isAgentIdentityValid || !hasAgentChannel}
              onClick={submitAgentWizard}
              type="button"
            >
              创建智能体
            </button>
          ) : (
            <button disabled={!canAdvanceAgentWizard} onClick={goToNextAgentWizardStep} type="button">下一步</button>
          )}
        </footer>
      </div>
    </div>
  )

  const renderAgentWorkspace = () => (
    <div className="agent-workspace">
      <section className="agent-list-panel" aria-label="智能体列表面板">
        <header>
          <div>
            <h1>配置中心</h1>
            <p>{desktopState.agentWorkspace.agents.length} 个智能体</p>
          </div>
          <button className="workspace-primary-button" onClick={openAgentWizard} type="button">
            <Plus aria-hidden="true" size={15} strokeWidth={2.2} />
            新建智能体
          </button>
        </header>
        <ul className="agent-list agent-list--separated" aria-label="智能体列表">
          {desktopState.agentWorkspace.agents.map((agent) => (
            <li className={agent.id === desktopState.agentWorkspace.selectedAgentId ? 'agent-list-row is-active' : 'agent-list-row'} key={agent.id}>
              <button
                aria-label={`${agent.name} ${agent.role} · ${agent.model} · ${agent.status}`}
                className={agent.id === desktopState.agentWorkspace.selectedAgentId ? 'agent-list-item is-active' : 'agent-list-item'}
                onClick={() => void applyDesktopState(() => selectAgent(agent.id))}
                type="button"
              >
                <span className="agent-list-item__profile">
                  <span
                    aria-label={`${agent.name} 头像`}
                    className={agent.avatar?.imageDataUrl ? 'agent-list-item__avatar has-image' : 'agent-list-item__avatar'}
                    role="img"
                    style={getAgentAvatarStyle(agent)}
                  >
                    {getAgentAvatarText(agent) ? <strong>{getAgentAvatarText(agent)}</strong> : null}
                  </span>
                  <span className="agent-list-item__identity">
                    <span className="agent-list-item__name">{agent.name}</span>
                    <small>{agent.role}</small>
                  </span>
                </span>
                <span className="agent-list-item__info">
                  <span aria-label={`${agent.name} 运行信息`} className="agent-list-item__info-line agent-list-item__info-line--runtime">
                    <span className={agent.status === '运行中' ? 'agent-list-item__status is-live' : 'agent-list-item__status'} data-status={agent.status}>{agent.status}</span>
                    <span>{agent.model}</span>
                  </span>
                  <span aria-label={`${agent.name} 配置信息`} className="agent-list-item__info-line agent-list-item__info-line--settings">
                    <span className="agent-list-item__setting">
                      <span>思考模式</span>
                      <strong>{agent.thinking}</strong>
                    </span>
                    <span>{agent.permissionMode}</span>
                    <span>{agentEnabledChannelCount(agent)} 个渠道</span>
                    <span>{agentVoiceLabel(agent)}</span>
                    <span>{agent.tools.length} 个工具 · {agent.skills.length} 个 Skill</span>
                  </span>
                </span>
              </button>
              <button
                aria-label={`配置智能体：${agent.name}`}
                className="agent-list-item__configure"
                onClick={() => void applyDesktopState(() => selectAgent(agent.id))}
                type="button"
              >
                <Wrench aria-hidden="true" size={14} strokeWidth={2.1} />
                <span>配置</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {isAgentWizardOpen ? renderAgentCreateWizard() : null}
    </div>
  )

  return (
    <div className="desktop-app">
      {activeNavId === 'settings' ? (
        renderSettingsSidebar()
      ) : (
        <Sidebar
          activeNavLabel={activeNavLabel}
          discussionThreads={discussionThreads}
          navItems={navItems}
          onNavItemClick={selectNavItem}
          onThreadArchive={(thread) => {
            void applyDesktopState(() => archiveThread(thread.id))
          }}
          onThreadPin={(thread) => {
            void applyDesktopState(() => pinThread(thread.id))
          }}
          onThreadRename={(thread, title) => {
            void applyDesktopState(() => renameThread(thread.id, title))
          }}
          onThreadSelect={(thread) => {
            void applyDesktopState(() => selectThread(thread.id))
          }}
          onThreadUnpin={(thread) => {
            void applyDesktopState(() => unpinThread(thread.id))
          }}
          onSettingsClick={openSettings}
          pinnedThreads={pinnedThreads}
          threads={conversations}
        />
      )}
      <SearchOverlay
        onClose={() => setIsSearchOpen(false)}
        onQueryChange={updateSearchResults}
        onSelect={showSearchResult}
        open={isSearchOpen}
        suggestions={searchResults.map((item) => ({
          ...item,
          icon: iconByKey[item.icon],
        }))}
      />
      {isVideoPreviewOpen ? (
        <div
          className="video-preview-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeVideoPreview()
            }
          }}
        >
          <div aria-label="视频预览" aria-modal="true" className="video-preview-modal" role="dialog">
            <button aria-label="关闭视频预览" className="video-preview-close" onClick={closeVideoPreview} type="button">
              <X aria-hidden="true" size={17} strokeWidth={2} />
            </button>
            <div className="video-preview-visual" aria-label="放大视频消息示例">
              <div className="video-preview-controls">
                <button aria-label="后退 10 秒" className="video-control-button" onClick={() => stepVideoTime(-10)} type="button">
                  <Rewind aria-hidden="true" size={17} fill="currentColor" strokeWidth={0} />
                </button>
                <button
                  aria-label={isVideoPlaying ? '暂停视频' : '播放视频'}
                  className={isVideoPlaying ? 'video-control-button is-playing' : 'video-control-button'}
                  onClick={() => setIsVideoPlaying((playing) => !playing)}
                  type="button"
                >
                  {isVideoPlaying ? (
                    <Pause aria-hidden="true" size={17} fill="currentColor" strokeWidth={0} />
                  ) : (
                    <Play aria-hidden="true" size={17} fill="currentColor" strokeWidth={0} />
                  )}
                </button>
                <button aria-label="快进 10 秒" className="video-control-button" onClick={() => stepVideoTime(10)} type="button">
                  <FastForward aria-hidden="true" size={17} fill="currentColor" strokeWidth={0} />
                </button>
                <div className="video-preview-progress">
                  <time>{videoCurrentTime}</time>
                  <input
                    aria-label="视频播放进度"
                    aria-valuetext={`${videoCurrentTime} / ${videoDurationTime}`}
                    className="video-preview-progress__range"
                    max={videoDurationSeconds}
                    min={0}
                    onChange={(event) => setVideoCurrentSeconds(Number(event.currentTarget.value))}
                    onInput={(event) => setVideoCurrentSeconds(Number(event.currentTarget.value))}
                    style={videoProgressStyle}
                    type="range"
                    value={videoCurrentSeconds}
                  />
                  <time>{videoDurationTime}</time>
                </div>
              </div>
            </div>
            <footer className="video-preview-footer">
              <strong>视频消息</strong>
              <span>视频时长 {videoDurationTime}</span>
            </footer>
          </div>
        </div>
      ) : null}
      {imagePreview ? (
        <div
          className="image-preview-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeImagePreview()
            }
          }}
        >
          <div
            aria-label={imagePreview.kind === 'batch' ? '批量图片预览' : '图片预览'}
            aria-modal="true"
            className="image-preview-modal"
            role="dialog"
          >
            <button aria-label="关闭图片预览" className="video-preview-close" onClick={closeImagePreview} type="button">
              <X aria-hidden="true" size={17} strokeWidth={2} />
            </button>
            <div className="image-preview-visual">
              {imagePreview.kind === 'batch' ? (
                <>
                  <button
                    aria-label="上一张图片"
                    className="image-preview-nav image-preview-nav--prev"
                    disabled={imagePreview.index === 0}
                    onClick={() => stepImagePreview(-1)}
                    type="button"
                  >
                    <ChevronLeft aria-hidden="true" size={20} strokeWidth={2.2} />
                  </button>
                  <span
                    aria-label={`批量图片第 ${imagePreviewCurrent} 张`}
                    className={`image-preview-art batch-image-grid__tile batch-image-grid__tile--${imagePreviewTile}`}
                    role="img"
                  />
                  <button
                    aria-label="下一张图片"
                    className="image-preview-nav image-preview-nav--next"
                    disabled={imagePreview.index === imagePreviewCount - 1}
                    onClick={() => stepImagePreview(1)}
                    type="button"
                  >
                    <ChevronRight aria-hidden="true" size={20} strokeWidth={2.2} />
                  </button>
                </>
              ) : (
                <span aria-label="放大图片消息示例" className="image-preview-art image-preview-art--single" role="img">
                  <span className="media-visual__sky" />
                  <span className="media-visual__panel media-visual__panel--wide" />
                  <span className="media-visual__panel" />
                </span>
              )}
            </div>
            <footer className="image-preview-footer">
              <strong>{imagePreview.kind === 'batch' ? '批量图片' : '图片消息'}</strong>
              <span>{imagePreview.kind === 'batch' ? `第 ${imagePreviewCurrent} / ${imagePreviewCount} 张` : '分辨率 1280 x 720'}</span>
            </footer>
          </div>
        </div>
      ) : null}

      <main className="desktop-workspace">
        <section className="desktop-content" aria-label={activeNavId === 'new-chat' ? '对话工作区' : `${activeNavLabel} 工作区`}>
          {activeNavId === 'agent' ? (
            renderAgentWorkspace()
          ) : activeNavId === 'plugins' ? (
            renderPluginWorkspace()
          ) : activeNavId === 'memory' ? (
            renderMemoryWorkspace()
          ) : activeNavId === 'settings' ? (
            renderSettingsWorkspace()
          ) : activeNavPanel ? (
            <div className="nav-workspace-panel">
              <div className="nav-workspace-card">
                <p className="panel-kicker">{activeNavLabel}</p>
                <h1>{activeNavPanel.title}</h1>
                <p>{activeNavPanel.detail}</p>
                <div className="nav-workspace-card__items" aria-label={`${activeNavLabel} 可用入口`}>
                  {activeNavPanel.items.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
          <ol className="chat-thread">
            <li className="chat-row chat-row--assistant">
              <ChatAvatar author="assistant" />
              <article className="chat-message">
                <p className="chat-message__speaker">CrawClaw</p>
                <p>准备 CrawClaw 在这台 Mac 上工作。当前版本先只落地对话界面，不连接后端。</p>
              </article>
            </li>

            <li className="chat-row chat-row--user">
              <article className="chat-message">
                <p>我想先看一个真正的桌面对话界面，保持苹果风格的简约。</p>
              </article>
              <ChatAvatar author="user" />
            </li>

            <li className="chat-row chat-row--assistant">
              <ChatAvatar author="assistant" />
              <article className="chat-message">
                <p>
                  已把主工作区改成对话流。左侧负责会话入口，中央只保留多轮消息、轻量运行结果和底部输入框。
                </p>
              </article>
            </li>

            <li className="chat-row chat-row--assistant">
              <ChatAvatar author="assistant" />
              <Panel className="chat-card" label="本机任务结果">
                <header className="chat-card__header">
                  <div>
                    <p className="panel-kicker">运行结果</p>
                    <h2>界面基础层已切换</h2>
                  </div>
                  <Badge tone="neutral">本机 UI</Badge>
                </header>

                <ul className="chat-card__list">
                  {resultItems.map((item) => (
                    <li key={item}>
                      <CheckCircle2 aria-hidden="true" size={15} strokeWidth={2.2} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </li>

            <li className="chat-row chat-row--user">
              <article className="chat-message">
                <p>后端先不要接，先把静态会话、运行状态和结果呈现打磨好。</p>
              </article>
              <ChatAvatar author="user" />
            </li>

            <li className="chat-row chat-row--user">
              <article className="chat-message">
                <p>对话里也需要图片、视频、附件这些不同气泡，先看下静态设计。</p>
              </article>
              <ChatAvatar author="user" />
            </li>

            <li className="chat-row chat-row--assistant">
              <ChatAvatar author="assistant" />
              <div className="media-stack" aria-label="多媒体消息示例">
                <figure className="media-bubble media-bubble--image">
                  <button
                    aria-label="放大图片消息"
                    className="media-visual-button"
                    onClick={() => setImagePreview({ index: 0, kind: 'single' })}
                    type="button"
                  >
                    <span className="media-visual media-visual--image" role="img" aria-label="图片消息示例">
                      <span className="media-visual__sky" />
                      <span className="media-visual__panel media-visual__panel--wide" />
                      <span className="media-visual__panel" />
                      <span aria-label="图片加载中" className="media-loading media-loading--image" />
                    </span>
                  </button>
                  <figcaption>
                    <span className="media-caption__label">
                      <ImageIcon aria-hidden="true" size={15} strokeWidth={2} />
                      图片消息
                    </span>
                    <span className="media-caption__meta">
                      <small>分辨率 1280 x 720</small>
                      <button
                        aria-label="打开图片所在文件夹"
                        className="media-folder-button"
                        type="button"
                      >
                        <FolderOpen aria-hidden="true" size={14} strokeWidth={2} />
                      </button>
                    </span>
                  </figcaption>
                </figure>

                <figure className="media-bubble media-bubble--video">
                  <div className="media-visual media-visual--video" aria-label="视频消息示例">
                    <button
                      aria-label="播放视频"
                      className="video-play"
                      onClick={() => {
                        setIsVideoPreviewOpen(true)
                        setIsVideoPlaying(true)
                        setVideoCurrentSeconds(videoPreviewStartSeconds)
                      }}
                      type="button"
                    >
                      <Play aria-hidden="true" size={18} fill="currentColor" strokeWidth={0} />
                    </button>
                    <span className="video-timeline">
                      <span />
                    </span>
                    <span aria-label="视频加载中" className="media-loading media-loading--video" />
                  </div>
                  <figcaption>
                    <span className="media-caption__label">
                      <Play aria-hidden="true" size={15} strokeWidth={2} />
                      视频消息
                    </span>
                    <span className="media-caption__meta">
                      <small>视频时长 00:42</small>
                      <button
                        aria-label="打开视频所在文件夹"
                        className="media-folder-button"
                        type="button"
                      >
                        <FolderOpen aria-hidden="true" size={14} strokeWidth={2} />
                      </button>
                    </span>
                  </figcaption>
                </figure>

                <figure className="media-bubble media-bubble--batch">
                  <div aria-label="批量图片轮播" className="batch-image-carousel" role="region">
                    <button
                      aria-label="上一页批量图片"
                      className="batch-image-carousel__arrow batch-image-carousel__arrow--prev"
                      disabled={batchImagePage === 0}
                      onClick={() => setBatchImagePage((page) => Math.max(0, page - 1))}
                      type="button"
                    >
                      <ChevronLeft aria-hidden="true" size={16} strokeWidth={2.2} />
                    </button>
                    <button
                      aria-label="批量图片消息示例"
                      className="batch-image-grid"
                      key={batchImagePage}
                      onClick={() => setImagePreview({ index: batchImagePage * batchImagePageSize, kind: 'batch' })}
                      type="button"
                    >
                      {visibleBatchImageTiles.map((tile) => (
                        <span className={`batch-image-grid__tile batch-image-grid__tile--${tile}`} key={tile} />
                      ))}
                      <span aria-label="批量图片加载中" className="media-loading media-loading--batch" />
                    </button>
                    <button
                      aria-label="下一页批量图片"
                      className="batch-image-carousel__arrow batch-image-carousel__arrow--next"
                      disabled={batchImagePage === batchImagePageCount - 1}
                      onClick={() => setBatchImagePage((page) => Math.min(batchImagePageCount - 1, page + 1))}
                      type="button"
                    >
                      <ChevronRight aria-hidden="true" size={16} strokeWidth={2.2} />
                    </button>
                    <div className="batch-image-carousel__dots" aria-label="批量图片分页">
                      {Array.from({ length: batchImagePageCount }, (_, page) => (
                        <button
                          aria-current={page === batchImagePage ? 'page' : undefined}
                          aria-label={`批量图片第 ${page + 1} 页`}
                          className={page === batchImagePage ? 'is-active' : undefined}
                          key={page}
                          onClick={() => setBatchImagePage(page)}
                          type="button"
                        />
                      ))}
                    </div>
                  </div>
                  <figcaption>
                    <span className="media-caption__label">
                      <ImageIcon aria-hidden="true" size={15} strokeWidth={2} />
                      批量图片
                    </span>
                    <span className="media-caption__meta">
                      <small>8 张图片</small>
                      <button
                        aria-label="打开批量图片所在文件夹"
                        className="media-folder-button"
                        type="button"
                      >
                        <FolderOpen aria-hidden="true" size={14} strokeWidth={2} />
                      </button>
                    </span>
                  </figcaption>
                </figure>

                <div className="attachment-bubble">
                  <FileText aria-hidden="true" size={18} strokeWidth={2} />
                  <div className="attachment-bubble__body">
                    <strong>desktop-ui-notes.md</strong>
                    <span>Markdown 附件 · 18 KB</span>
                  </div>
                  <div className="attachment-bubble__actions">
                    <button
                      aria-label="打开附件"
                      type="button"
                    >
                      <ExternalLink aria-hidden="true" size={15} strokeWidth={2} />
                    </button>
                    <button
                      aria-label="在文件夹中显示"
                      type="button"
                    >
                      <FolderOpen aria-hidden="true" size={15} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </div>
            </li>

            <li className="chat-row chat-row--user">
              <article className="chat-message">
                <p>工具调用、Skill 执行和语音消息也要有独立气泡。</p>
              </article>
              <ChatAvatar author="user" />
            </li>

            <li className="chat-row chat-row--assistant">
              <ChatAvatar author="assistant" />
              <div className="execution-stack" aria-label="工具和 Skill 调用示例">
                <div className="call-bubble call-bubble--tool">
                  <div className="call-bubble__icon">
                    <Wrench aria-hidden="true" size={16} strokeWidth={2} />
                  </div>
                  <div className="call-bubble__body">
                    <div className="call-bubble__header">
                      <strong>工具调用</strong>
                      <Badge tone="ok">已完成</Badge>
                    </div>
                    <p>desktop.inspect_ui</p>
                    <span>读取当前窗口结构与可见控件</span>
                  </div>
                </div>

                <div className="call-bubble call-bubble--skill">
                  <div className="call-bubble__icon">
                    <Sparkles aria-hidden="true" size={16} strokeWidth={2} />
                  </div>
                  <div className="call-bubble__body">
                    <div className="call-bubble__header">
                      <strong>Skill 执行</strong>
                      <Badge tone="neutral">设计中</Badge>
                    </div>
                    <p>macOS UI polish</p>
                    <span>整理对话气泡、媒体预览与底部输入体验</span>
                  </div>
                </div>
              </div>
            </li>

            <li className="chat-row chat-row--assistant">
              <ChatAvatar author="assistant" />
              <div className="workflow-stack" aria-label="工作流消息示例">
                <div className="workflow-bubble workflow-bubble--n8n">
                  <header className="workflow-bubble__header">
                    <div className="workflow-bubble__title">
                      <span className="workflow-bubble__icon">
                        <Blocks aria-hidden="true" size={16} strokeWidth={2} />
                      </span>
                      <div>
                        <strong>n8n 工作流</strong>
                        <p>线索同步与通知</p>
                      </div>
                    </div>
                    <Badge tone="neutral">运行中</Badge>
                  </header>
                  <div className="workflow-nodes" aria-label="n8n 节点状态">
                    <span className="workflow-node workflow-node--done">Webhook</span>
                    <i />
                    <span aria-current="step" className="workflow-node workflow-node--active">
                      清洗数据
                    </span>
                    <i />
                    <span className="workflow-node workflow-node--pending">Slack 通知</span>
                  </div>
                  <div className="workflow-current" aria-label="当前执行节点">
                    <span>当前节点</span>
                    <strong>清洗数据</strong>
                  </div>
                  <div className="workflow-meta">
                    <span>6 个节点</span>
                    <span>已完成 1/3</span>
                    <span>运行 1.4 秒</span>
                  </div>
                </div>

                <div className="workflow-bubble workflow-bubble--comfyui">
                  <header className="workflow-bubble__header">
                    <div className="workflow-bubble__title">
                      <span className="workflow-bubble__icon">
                        <ImageIcon aria-hidden="true" size={16} strokeWidth={2} />
                      </span>
                      <div>
                        <strong>ComfyUI 工作流</strong>
                        <p>产品图生成</p>
                      </div>
                    </div>
                    <Badge tone="neutral">生成中</Badge>
                  </header>
                  <div className="comfy-preview" role="img" aria-label="ComfyUI 图像预览">
                    <span className="comfy-preview__sheet" />
                    <span className="comfy-preview__subject" />
                    <span className="comfy-preview__shadow" />
                  </div>
                  <div className="workflow-meta">
                    <span>12 个节点</span>
                    <span>1024 x 1024</span>
                    <span>采样 18/24</span>
                  </div>
                </div>

                <div className="workflow-bubble workflow-bubble--schedule">
                  <header className="workflow-bubble__header">
                    <div className="workflow-bubble__title">
                      <span className="workflow-bubble__icon">
                        <Clock3 aria-hidden="true" size={16} strokeWidth={2} />
                      </span>
                      <div>
                        <strong>定时任务</strong>
                        <p>每日环境巡检</p>
                      </div>
                    </div>
                    <Badge tone="ok">已启用</Badge>
                  </header>
                  <div className="schedule-plan" aria-label="定时任务计划">
                    <div>
                      <span>触发规则</span>
                      <strong>每天 09:30</strong>
                    </div>
                    <div>
                      <span>下次运行</span>
                      <strong>今天 09:30</strong>
                    </div>
                    <div>
                      <span>失败处理</span>
                      <strong>通知我</strong>
                    </div>
                  </div>
                  <div className="workflow-meta">
                    <span>工作区模式</span>
                    <span>最近成功 昨天 09:31</span>
                    <span>运行 24 次</span>
                  </div>
                </div>
              </div>
            </li>

            <li className="chat-row chat-row--user">
              <article className="chat-message voice-message" aria-label="语音消息示例">
                <div className="voice-message__icon">
                  <AudioLines aria-hidden="true" size={17} strokeWidth={2} />
                </div>
                <div className="voice-message__body">
                  <div className="voice-wave" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <p>语音消息 · 00:08</p>
                </div>
              </article>
              <ChatAvatar author="user" />
            </li>

            <li className="chat-row chat-row--assistant">
              <ChatAvatar author="assistant" />
              <article className="chat-message">
                <p>当前运行状态先作为对话上下文展示，后续接 Rust Desktop API 后再切换为真实状态。</p>
                <div className="chat-status-strip" aria-label="运行状态">
                  {runtimeChecks.map((item) => (
                    <span className="chat-status-strip__item" key={item.label}>
                      <span>{item.label}</span>
                      <Badge tone={item.tone}>{item.value}</Badge>
                    </span>
                  ))}
                </div>
              </article>
            </li>

            <li className="chat-row chat-row--assistant chat-row--loading">
              <ChatAvatar author="assistant" />
              <div aria-label="消息生成中" className="chat-message chat-message--loading">
                <span />
                <span />
                <span />
              </div>
            </li>

            {desktopState.conversation.draftMessages.map((message) => (
              <li className="chat-row chat-row--user chat-row--draft" key={message.id}>
                <article className="chat-message">
                  <p>{message.text}</p>
                </article>
                <ChatAvatar author="user" />
              </li>
            ))}
          </ol>
          )}
        </section>

        {isChatWorkspace ? (
        <Composer
          approvalNotice={hasPermissionRequest
            ? (
            <>
              <div className={`permission-review is-${approvalState}`} aria-label="权限审核">
                <div className="permission-review__icon">
                  <ShieldCheck aria-hidden="true" size={15} strokeWidth={2.1} />
                </div>
                <div className="permission-review__body">
                  <strong>{approvalState === 'pending' ? '权限审核' : approvalState === 'approved' ? '已允许一次' : '已拒绝'}</strong>
                  <span>
                    {approvalState === 'pending'
                      ? 'CrawClaw 请求读取当前窗口内容，用于继续本轮 UI 调整。'
                      : approvalState === 'approved'
                        ? '这次操作已通过，继续保持本地静态 UI 演示。'
                        : '这次权限请求已拒绝，界面停留在本地预览状态。'}
                  </span>
                </div>
                {approvalState === 'pending' ? (
                  <div className="permission-review__actions">
                    <button onClick={() => void applyDesktopState(() => decidePermission(desktopState.permissionRequest.id, 'denied'))} type="button">
                      拒绝
                    </button>
                    <button className="permission-review__allow" onClick={() => void applyDesktopState(() => decidePermission(desktopState.permissionRequest.id, 'approved'))} type="button">
                      允许一次
                    </button>
                  </div>
                ) : null}
              </div>
            </>
              )
            : null}
          commandMenu={
            visibleSlashCommands.length > 0 ? (
              <div aria-label="命令菜单" className="command-menu" onKeyDown={handleMenuKeyDown} role="menu">
                <p>命令</p>
                {visibleSlashCommands.map((command) => (
                  <button
                    aria-label={command.label}
                    key={command.command}
                    onClick={() => {
                      setComposerText(command.command)
                      setIsCommandMenuOpen(false)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="command-menu__icon">
                      <DesktopIcon icon={command.icon} />
                    </span>
                    <span className="command-menu__body">
                      <strong>{command.label}</strong>
                      <small>{command.detail}</small>
                    </span>
                    <span className="command-menu__shortcut">{command.command.trim()}</span>
                  </button>
                ))}
              </div>
            ) : visibleSkillCommands.length > 0 ? (
              <div aria-label="Skill 菜单" className="command-menu command-menu--skills" onKeyDown={handleMenuKeyDown} role="menu">
                <p>Skill</p>
                {visibleSkillCommands.map((skill) => (
                  <button
                    aria-label={skill.label}
                    key={skill.mention}
                    onClick={() => {
                      setComposerText(skill.mention)
                      setIsCommandMenuOpen(false)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="command-menu__icon">
                      <DesktopIcon icon={skill.icon} />
                    </span>
                    <span className="command-menu__body">
                      <strong>{skill.label}</strong>
                      <small>{skill.detail}</small>
                    </span>
                    <span className="command-menu__shortcut">{skill.mention.trim()}</span>
                  </button>
                ))}
              </div>
            ) : null
          }
          leftControls={
            <>
              <IconButton
                icon={Plus}
                label="添加"
                onClick={() => {
                  setIsAttachmentMenuOpen((open) => !open)
                  setSelectorOpen(null)
                }}
              />
              {isAttachmentMenuOpen ? (
                <div aria-label="添加内容菜单" className="selector-menu selector-menu--attach" onKeyDown={handleMenuKeyDown} role="menu">
                  {[
                    { label: '添加图片', icon: ImageIcon },
                    { label: '添加视频', icon: Play },
                    { label: '添加文件', icon: FileText },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => {
                        setIsAttachmentMenuOpen(false)
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <item.icon aria-hidden="true" size={14} strokeWidth={2} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                aria-expanded={selectorOpen === 'thinking'}
                aria-haspopup="menu"
                aria-label={`思考等级 ${selectedThinking}`}
                className="thinking-level-pill"
                onClick={() => setSelectorOpen(selectorOpen === 'thinking' ? null : 'thinking')}
                type="button"
              >
                <Brain aria-hidden="true" size={14} strokeWidth={2} />
                <span>思考 {selectedThinking}</span>
                <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
              </button>
              {selectorOpen === 'thinking' ? (
                <div aria-label="思考等级选择" className="selector-menu selector-menu--thinking" onKeyDown={handleMenuKeyDown} role="menu">
                  {desktopState.preferences.thinkingOptions.map((level) => (
                    <button
                      className={level === selectedThinking ? 'is-selected' : ''}
                      key={level}
                      onClick={() => {
                        applyPreferenceUpdate({ selectedThinking: level })
                        setSelectorOpen(null)
                      }}
                      role="menuitem"
                      type="button"
                    >
                      {level}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                aria-expanded={selectorOpen === 'model'}
                aria-haspopup="menu"
                aria-label={`模型 ${selectedModel}`}
                className="model-pill"
                onClick={() => setSelectorOpen(selectorOpen === 'model' ? null : 'model')}
                type="button"
              >
                <span>{selectedModel}</span>
                <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
              </button>
              {selectorOpen === 'model' ? (
                <div aria-label="模型选择" className="selector-menu selector-menu--model" onKeyDown={handleMenuKeyDown} role="menu">
                  {modelOptions.map((model) => (
                    <button
                      className={model === selectedModel ? 'is-selected' : ''}
                      key={model}
                      onClick={() => {
                        applyPreferenceUpdate({ selectedModel: model })
                        setSelectorOpen(null)
                      }}
                      role="menuitem"
                      type="button"
                    >
                      {model}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          }
          onInputChange={updateComposerText}
          onSubmit={submitDraft}
          metaControls={
            <>
              <PermissionModeButton
                expanded={selectorOpen === 'permission'}
                label={permissionMode}
                onClick={() => setSelectorOpen(selectorOpen === 'permission' ? null : 'permission')}
              />
              {selectorOpen === 'permission' ? (
                <div aria-label="权限模式选择" className="selector-menu selector-menu--permission" onKeyDown={handleMenuKeyDown} role="menu">
                  {desktopState.preferences.permissionModeOptions.map((mode) => (
                    <button
                      className={mode === permissionMode ? 'is-selected' : ''}
                      key={mode}
                      onClick={() => {
                        applyPreferenceUpdate({ permissionMode: mode })
                        setSelectorOpen(null)
                      }}
                      role="menuitem"
                      type="button"
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          }
          placeholder="告诉 CrawClaw 要做什么..."
          rightControls={
            <>
              {isListening ? (
                <span aria-label="正在收声" className="listening-meter" data-tone="active">
                  <span />
                  <span />
                  <span />
                </span>
              ) : null}
              <IconButton
                className={isListening ? 'composer-voice is-listening' : 'composer-voice'}
                icon={Mic}
                label={isListening ? '停止收声' : '语音输入'}
                onClick={() => setIsListening((value) => !value)}
              />
              <IconButton className="composer-send" icon={ArrowUp} label="发送" onClick={submitDraft} />
            </>
          }
          value={composerText}
        />
        ) : null}
      </main>
    </div>
  )
}

function PluginSkillRow({
  onToggle,
  skill,
  status,
}: {
  onToggle: () => void
  skill: PluginSkill
  status: string
}) {
  const statusClass = status === '检查中'
    ? 'plugin-market-row__status is-checking'
    : status === '本地'
    ? 'plugin-market-row__status is-local'
    : status === '已启用'
    ? 'plugin-market-row__status is-enabled'
    : 'plugin-market-row__status'

  return (
    <article className={skill.open ? 'plugin-market-row is-open' : 'plugin-market-row'}>
      <button aria-label={`${skill.open ? '收起' : '打开'} Skill：${skill.name}`} className="plugin-market-row__main" onClick={onToggle} type="button">
        <span className="plugin-market-row__icon">
          <DesktopIcon icon={skill.icon} />
        </span>
        <span className="plugin-market-row__body">
          <strong>{skill.name}</strong>
          <small>{skill.description}</small>
          <code>{skill.trigger}</code>
        </span>
        <span className={statusClass}>{status}</span>
      </button>
      {skill.open ? (
        <div className="plugin-market-row__detail">
          <p>触发词 {skill.trigger}</p>
          <span>{skill.source}</span>
        </div>
      ) : null}
    </article>
  )
}
