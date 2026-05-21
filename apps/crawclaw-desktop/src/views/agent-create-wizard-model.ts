import type { CSSProperties } from 'react'
import type {
  AgentAvatarProfile,
  AgentChannelBinding,
  AgentChannelConfig,
  AgentEmotionProfile,
  AgentVoiceConfig,
  DesktopPreferences,
} from '../desktop-api'

const agentAvatarPalettes = [
  ['#2563eb', '#14b8a6', 'rgba(37, 99, 235, 0.24)'],
  ['#7c3aed', '#ec4899', 'rgba(124, 58, 237, 0.22)'],
  ['#0f766e', '#84cc16', 'rgba(15, 118, 110, 0.2)'],
  ['#be123c', '#f97316', 'rgba(190, 18, 60, 0.2)'],
  ['#4338ca', '#06b6d4', 'rgba(67, 56, 202, 0.22)'],
]

export const agentWizardSteps = ['身份情感', '模型选择', '语音', '渠道', '能力', '确认'] as const

export const agentVoiceSourceOptions = [
  { detail: '使用 Qwen-TTS 内置 voice 参数。', id: 'qwen-preset', label: 'Qwen 系统音色' },
  { detail: '用文字描述生成一个新声音。', id: 'voice-design', label: '描述生成声音' },
  { detail: '上传参考音频，保存克隆声音配置。', id: 'voice-clone', label: '克隆声音' },
]

export const qwenVoicePresets = [
  { detail: '明亮、年轻，适合轻量助手。', id: 'Cherry', label: 'Cherry' },
  { detail: '自然、沉稳，适合说明和播报。', id: 'Serena', label: 'Serena' },
  { detail: '清晰、可靠，适合任务执行。', id: 'Ethan', label: 'Ethan' },
  { detail: '亲和、细腻，适合陪伴式交互。', id: 'Chelsie', label: 'Chelsie' },
]

export const agentVoicePaces = ['正常', '慢速', '快速']

export const agentChannelDmPolicies = [
  { detail: '允许联系人直接发起私聊。', id: 'open', label: '直接接收' },
  { detail: '先完成配对或授权后接收。', id: 'pairing', label: '配对后接收' },
]

export const agentChannelGroupPolicies = [
  { detail: '只响应允许列表里的群或频道。', id: 'allowlist', label: '允许列表' },
  { detail: '允许所有已绑定群或频道。', id: 'open', label: '全部接收' },
]

const agentEmotionOptions: AgentEmotionProfile[] = [
  createAgentEmotionOption('专业克制', '清晰、直接', ['先确认关键风险']),
  createAgentEmotionOption('温和陪伴', '耐心、清晰', ['保留用户节奏']),
  createAgentEmotionOption('积极推进', '简短、有行动感', ['推动下一步执行']),
  createAgentEmotionOption('严谨审查', '审慎、证据优先', ['标出不确定性']),
]

const agentChannelOptions: AgentChannelBinding[] = [
  createAgentChannelOption('desktop', '桌面', true),
  createAgentChannelOption('ddingtalk', '钉钉', false),
  createAgentChannelOption('feishu', '飞书', false),
  createAgentChannelOption('esp32', 'ESP32', false),
  createAgentChannelOption('qqbot', 'QQ Bot', false),
  createAgentChannelOption('weixin', '微信', false),
]

export type AgentCreateDraft = {
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

function createAgentChannelOption(id: string, label: string, enabled: boolean): AgentChannelBinding {
  return {
    config: createAgentChannelConfig(id),
    enabled,
    id,
    label,
  }
}

export function createAgentChannelConfig(id: string): AgentChannelConfig {
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
          { id: 'advertisedHost', label: 'Advertised Host', secret: false, value: '' },
          { id: 'port', label: 'Port', secret: false, value: '1883' },
          { id: 'udpPort', label: 'UDP Port', secret: false, value: '1884' },
          { id: 'otaPath', label: 'OTA Path', secret: false, value: '/api/esp32/ota' },
          { id: 'wakeWord', label: 'Wake Word', secret: false, value: 'true' },
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

export function createVoiceStyleFromEmotionPrompt(promptMd: string) {
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

export function getAgentAvatarInitials(name: string) {
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

export function formatAgentChannelConfigSummary(channel: AgentChannelBinding) {
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

export function createAgentDraft(preferences: DesktopPreferences): AgentCreateDraft {
  return {
    agentMd: '',
    avatar: null,
    channels: agentChannelOptions.map(cloneAgentChannel),
    description: '',
    emotion: cloneAgentEmotion(agentEmotionOptions[0]),
    generationNotice: '',
    model: preferences.selectedModel,
    name: '',
    permissionMode: preferences.permissionMode,
    role: '',
    skillIds: [],
    thinking: preferences.selectedThinking,
    toolIds: [],
    voice: defaultAgentVoiceDraft(),
  }
}

export function createAgentAvatar(draft: AgentCreateDraft): AgentAvatarProfile {
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

export function getAgentAvatarPreviewStyle(avatar: AgentAvatarProfile): CSSProperties {
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

export function deriveAgentDraftRole(draft: AgentCreateDraft) {
  const name = draft.name.trim() || '新智能体'
  const heading = extractAgentMarkdownHeading(draft.agentMd)
  return draft.role.trim() || heading || `${name}助手`
}

export function deriveAgentDraftDescription(draft: AgentCreateDraft) {
  const name = draft.name.trim() || '新智能体'
  const summary = extractAgentMarkdownSummary(draft.agentMd)
  return draft.description.trim() || summary || `根据智能体设定为 ${name} 生成配置草稿。`
}

export function generateAgentAvatarDraft(draft: AgentCreateDraft): AgentCreateDraft {
  const name = draft.name.trim() || '新智能体'

  return {
    ...draft,
    avatar: createAiAgentAvatar(name, draft.agentMd),
    generationNotice: '已生成头像',
    name,
  }
}
