import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Bot,
  Brain,
  ChevronDown,
  ChevronLeft,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  MessageCircle,
  PlugZap,
  Search,
  ShieldCheck,
  TestTube2,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import type {
  AutomationRuntimeInstallInput,
  AutomationWorkspaceState,
  DesktopModelProfileSummary,
  DesktopPreferences,
  DesktopPreferencesPatch,
  ModelProfileAuthMethod,
  ModelProfileSetupInput,
  ModelProfileSource,
} from '../desktop-api'
import type { ConfirmationRequestInput } from '../ui/confirmation-dialog'
import { AutomationEnvironment } from './automation-environment'
import { modelSupportsConfigurableThinking } from './model-capabilities'
import { normalizeReplyMode, replyModeLabel, replyModeOptions } from './reply-mode'

export type SettingsSectionId = 'general' | 'automation' | 'model' | 'permissions' | 'memory' | 'notifications' | 'privacy' | 'advanced'
type SettingsPreferencePatch = DesktopPreferencesPatch
type SettingsLanguage = 'en' | 'zh-CN'
type ModelSetupStep = 0 | 1 | 2 | 3

type ModelProviderOption = {
  source: ModelProfileSource
  provider: string
  label: string
  hint: Record<SettingsLanguage, string>
  defaultModel: string
  modelChoices: string[]
  defaultBaseUrl: string
  defaultApi: string
  defaultAuthMethod: ModelProfileAuthMethod
  authMethods: ModelProfileAuthMethod[]
  requiresBaseUrl: boolean
  setupOptions: ModelProviderSetupOption[]
}

type ModelProviderSetupOption = {
  value: string
  method: string
  label: string
  hint: string
  authMethod: ModelProfileAuthMethod
  baseUrl: string
  baseUrlPlaceholder?: string
  modelChoices?: string[]
  requiresBaseUrl?: boolean
}

type ModelSetupDraft = {
  source: ModelProfileSource
  provider: string
  setupOptionValue: string
  baseUrl: string
  api: string
  apiKey: string
  authMethod: ModelProfileAuthMethod
  model: string
  label: string
}

type BuiltInProviderDefault = readonly [provider: string, defaultModel: string, defaultApi: string]

const customModelChoiceValue = '__custom_model__'

const customProviderOptions: ModelProviderOption[] = [
  {
    source: 'custom',
    provider: 'openai-compatible',
    label: 'OpenAI-compatible',
    hint: {
      'zh-CN': '接入自建网关或兼容 OpenAI 的服务，例如 LM Studio、vLLM、SGLang。',
      en: 'Connect a self-hosted gateway or OpenAI-compatible service such as LM Studio, vLLM, or SGLang.',
    },
    defaultModel: 'gpt-oss',
    modelChoices: [],
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultApi: 'openai-completions',
    defaultAuthMethod: 'api-key',
    authMethods: ['api-key', 'local'],
    requiresBaseUrl: true,
    setupOptions: [],
  },
]

const hiddenModelSetupProviders = new Set([
  'byteplus-plan',
  'google-gemini-cli',
  'kimi-coding',
  'minimax-portal',
  'volcengine-plan',
])

const configurableBaseUrlProviders = new Set([
  'amazon-bedrock',
  'anthropic-vertex',
  'cloudflare-ai-gateway',
  'copilot-proxy',
  'litellm',
  'microsoft-foundry',
  'ollama',
  'sglang',
  'vllm',
])

const fallbackBuiltInProviderDefaults: BuiltInProviderDefault[] = [
  ['amazon-bedrock', 'anthropic.claude-sonnet-4-5-20250929-v1:0', 'bedrock-converse-stream'],
  ['anthropic', 'sonnet-4.6', 'anthropic-messages'],
  ['anthropic-vertex', 'claude-sonnet-4-6', 'anthropic-messages'],
  ['byteplus', 'doubao-seed-1-6', 'openai-completions'],
  ['byteplus-plan', 'doubao-seed-1-6-thinking', 'openai-completions'],
  ['chutes', 'deepseek-ai/DeepSeek-V3.2', 'openai-completions'],
  ['cloudflare-ai-gateway', 'sonnet-4.6', 'anthropic-messages'],
  ['copilot-proxy', 'gpt-5.4', 'openai-completions'],
  ['deepseek', 'deepseek-chat', 'openai-completions'],
  ['github-copilot', 'gpt-5.4', 'github-copilot'],
  ['google', 'gemini-3-pro-preview', 'google-generative-ai'],
  ['google-gemini-cli', 'gemini-3-pro-preview', 'google-generative-ai'],
  ['huggingface', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'openai-completions'],
  ['kilocode', 'kilocode/code', 'openai-completions'],
  ['kimi', 'kimi-code', 'anthropic-messages'],
  ['kimi-coding', 'kimi-code', 'anthropic-messages'],
  ['litellm', 'gpt-5.4', 'openai-completions'],
  ['microsoft-foundry', 'gpt-5.4', 'openai-responses'],
  ['minimax', 'MiniMax-M2.7', 'anthropic-messages'],
  ['minimax-portal', 'MiniMax-M2.7', 'anthropic-messages'],
  ['mistral', 'mistral-large-latest', 'openai-completions'],
  ['modelstudio', 'qwen3-coder-plus', 'openai-completions'],
  ['moonshot', 'kimi-k2-0905-preview', 'openai-completions'],
  ['nvidia', 'nvidia/llama-3.3-nemotron-super-49b-v1', 'openai-completions'],
  ['ollama', 'glm-4.7-flash', 'ollama'],
  ['openai', 'gpt-5.4', 'openai-responses'],
  ['openai-codex', 'gpt-5.4', 'openai-codex-responses'],
  ['opencode', 'claude-opus-4-6', 'openai-completions'],
  ['opencode-go', 'kimi-k2.5', 'openai-completions'],
  ['openrouter', 'openai/gpt-5.4', 'openai-completions'],
  ['qianfan', 'ernie-4.5-turbo-128k', 'openai-completions'],
  ['sglang', 'local', 'openai-completions'],
  ['synthetic', 'synthetic/mock', 'anthropic-messages'],
  ['together', 'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'openai-completions'],
  ['venice', 'venice-uncensored', 'openai-completions'],
  ['vercel-ai-gateway', 'anthropic/claude-sonnet-4.6', 'anthropic-messages'],
  ['vllm', 'local', 'openai-completions'],
  ['volcengine', 'doubao-seed-1-6', 'openai-completions'],
  ['volcengine-plan', 'doubao-seed-1-6-thinking', 'openai-completions'],
  ['xai', 'grok-4.20', 'openai-responses'],
  ['xiaomi', 'xmi-large', 'openai-completions'],
  ['zai', 'glm-4.6', 'openai-completions'],
]

const fallbackBuiltInProviderModelChoicesByProvider: Record<string, string[]> = {
  'amazon-bedrock': ['anthropic.claude-sonnet-4-5-20250929-v1:0', 'us.anthropic.claude-opus-4-6-v1:0', 'us.anthropic.claude-sonnet-4-6-v1:0', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'],
  anthropic: ['sonnet-4.6', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5'],
  'anthropic-vertex': ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-sonnet-4-5', 'claude-opus-4-5'],
  byteplus: ['doubao-seed-1-6', 'doubao-seed-1-6-thinking', 'doubao-seed-code-preview'],
  'byteplus-plan': ['doubao-seed-1-6-thinking', 'doubao-seed-code-preview'],
  chutes: ['deepseek-ai/DeepSeek-V3.2', 'zai-org/GLM-4.7-TEE', 'zai-org/GLM-4.7-FP8', 'deepseek-ai/DeepSeek-V3.2-TEE', 'Qwen/Qwen3-32B', 'chutesai/Mistral-Small-3.2-24B-Instruct-2506'],
  'cloudflare-ai-gateway': ['sonnet-4.6', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5'],
  'copilot-proxy': ['gpt-5.4', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-4.1', 'gpt-4o'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  'github-copilot': ['gpt-5.4', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-4.1', 'gpt-4o'],
  google: ['gemini-3-pro-preview', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  'google-gemini-cli': ['gemini-3-pro-preview', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'],
  huggingface: ['Qwen/Qwen3-Coder-480B-A35B-Instruct', 'deepseek-ai/DeepSeek-R1', 'deepseek-ai/DeepSeek-V3.2', 'Qwen/Qwen3-8B', 'Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen3-32B', 'meta-llama/Llama-3.3-70B-Instruct', 'openai/gpt-oss-120b', 'zai-org/GLM-4.7', 'moonshotai/Kimi-K2.5'],
  kilocode: ['kilocode/code', 'kilo/auto', 'anthropic/claude-sonnet-4', 'openai/gpt-5.2', 'google/gemini-3-pro-preview'],
  kimi: ['kimi-code', 'kimi-k2.5', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo'],
  'kimi-coding': ['kimi-code', 'k2p5'],
  litellm: ['gpt-5.4', 'claude-opus-4-6', 'claude-sonnet-4-6', 'gpt-4o', 'qwen3-coder'],
  'microsoft-foundry': ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4o'],
  minimax: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  'minimax-portal': ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  mistral: ['mistral-large-latest', 'mistral-medium-2508', 'mistral-small-latest', 'magistral-medium-latest', 'magistral-small-latest', 'pixtral-large-latest'],
  modelstudio: ['qwen3-coder-plus', 'qwen3.5-plus', 'qwen3-coder-next'],
  moonshot: ['kimi-k2-0905-preview', 'kimi-k2.5', 'kimi-k2-turbo-preview', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo'],
  nvidia: ['nvidia/llama-3.3-nemotron-super-49b-v1', 'nvidia/llama-3.1-nemotron-70b-instruct', 'meta/llama-3.3-70b-instruct', 'nvidia/mistral-nemo-minitron-8b-8k-instruct'],
  ollama: ['glm-4.7-flash', 'gpt-oss:20b', 'llama3.3', 'kimi-k2.5:cloud', 'minimax-m2.5:cloud', 'glm-5:cloud'],
  openai: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.2'],
  'openai-codex': ['gpt-5.4', 'gpt-5.3-codex-spark', 'gpt-5.2-codex', 'gpt-5.1-codex'],
  opencode: ['claude-opus-4-6', 'gpt-5.2', 'gemini-3-pro'],
  'opencode-go': ['kimi-k2.5', 'glm-5', 'minimax-m2.5'],
  openrouter: ['openai/gpt-5.4', 'anthropic/claude-opus-4-6', 'anthropic/claude-sonnet-4-6', 'google/gemini-3-pro-preview', 'x-ai/grok-4.20', 'moonshotai/kimi-k2.5', 'deepseek/deepseek-chat'],
  qianfan: ['ernie-4.5-turbo-128k', 'ernie-4.5-turbo-vl-32k', 'ernie-x1-turbo-32k', 'ernie-4.0-turbo-8k'],
  sglang: ['local', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'deepseek-ai/DeepSeek-V3.2', 'zai-org/GLM-4.7'],
  synthetic: ['synthetic/mock', 'hf:MiniMaxAI/MiniMax-M2.5', 'hf:moonshotai/Kimi-K2-Thinking', 'hf:zai-org/GLM-4.7', 'hf:deepseek-ai/DeepSeek-R1-0528', 'hf:deepseek-ai/DeepSeek-V3.1'],
  together: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'zai-org/GLM-4.7-FP8', 'meta-llama/Llama-4-Scout-17B-16E-Instruct', 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'deepseek-ai/DeepSeek-V3.1', 'deepseek-ai/DeepSeek-R1', 'moonshotai/Kimi-K2-Instruct'],
  venice: ['venice-uncensored', 'kimi-k2-5', 'kimi-k2-thinking', 'qwen3-coder-480b-a35b-instruct', 'qwen3-4b', 'deepseek-v3.2', 'claude-opus-4-6', 'openai-gpt-54', 'gemini-3-1-pro-preview', 'grok-code-fast-1'],
  'vercel-ai-gateway': ['anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.6', 'openai/gpt-5.4', 'google/gemini-3-pro-preview', 'xai/grok-4.20'],
  vllm: ['local', 'Qwen/Qwen3-Coder-480B-A35B-Instruct', 'deepseek-ai/DeepSeek-V3.2', 'zai-org/GLM-4.7'],
  volcengine: ['doubao-seed-1-6', 'doubao-seed-1-8', 'doubao-seed-code-preview'],
  'volcengine-plan': ['doubao-seed-1-6-thinking', 'ark-code-latest', 'doubao-seed-code-preview'],
  xai: ['grok-4.20', 'grok-4', 'grok-4-0709', 'grok-4-fast-reasoning', 'grok-4-fast-non-reasoning', 'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-4.20-reasoning', 'grok-4.20-non-reasoning', 'grok-code-fast-1'],
  xiaomi: ['xmi-large', 'mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2.5-pro', 'mimo-v2.5'],
  zai: ['glm-4.6', 'glm-5', 'glm-4.7', 'glm-4.7-flash'],
}

function fallbackBuiltInProviderModelChoices(provider: string) {
  return fallbackBuiltInProviderModelChoicesByProvider[provider] ?? []
}

const fallbackBuiltInProviderSetupOptionsByProvider: Record<string, ModelProviderSetupOption[]> = {
  minimax: [
    {
      value: 'minimax-global-api',
      method: 'api-global',
      label: 'MiniMax API key (Global)',
      hint: 'Global endpoint - api.minimax.io',
      authMethod: 'api-key',
      baseUrl: 'https://api.minimax.io/anthropic',
    },
    {
      value: 'minimax-cn-api',
      method: 'api-cn',
      label: 'MiniMax API key (CN)',
      hint: 'CN endpoint - api.minimaxi.com',
      authMethod: 'api-key',
      baseUrl: 'https://api.minimaxi.com/anthropic',
    },
  ],
  modelstudio: [
    {
      value: 'modelstudio-standard-api-key-cn',
      method: 'standard-api-key-cn',
      label: 'Standard API Key for China (pay-as-you-go)',
      hint: 'Endpoint: dashscope.aliyuncs.com',
      authMethod: 'api-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    {
      value: 'modelstudio-standard-api-key',
      method: 'standard-api-key',
      label: 'Standard API Key for Global/Intl (pay-as-you-go)',
      hint: 'Endpoint: dashscope-intl.aliyuncs.com',
      authMethod: 'api-key',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    },
    {
      value: 'modelstudio-api-key-cn',
      method: 'api-key-cn',
      label: 'Coding Plan API Key for China (subscription)',
      hint: 'Endpoint: coding.dashscope.aliyuncs.com',
      authMethod: 'api-key',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    },
    {
      value: 'modelstudio-api-key',
      method: 'api-key',
      label: 'Coding Plan API Key for Global/Intl (subscription)',
      hint: 'Endpoint: coding-intl.dashscope.aliyuncs.com',
      authMethod: 'api-key',
      baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1',
    },
  ],
  moonshot: [
    {
      value: 'moonshot-api-key',
      method: 'api-key',
      label: 'Moonshot API key (.ai)',
      hint: 'Global endpoint - api.moonshot.ai',
      authMethod: 'api-key',
      baseUrl: 'https://api.moonshot.ai/v1',
    },
    {
      value: 'moonshot-api-key-cn',
      method: 'api-key-cn',
      label: 'Moonshot API key (.cn)',
      hint: 'CN endpoint - api.moonshot.cn',
      authMethod: 'api-key',
      baseUrl: 'https://api.moonshot.cn/v1',
    },
  ],
  zai: [
    {
      value: 'zai-api-key',
      method: 'api-key',
      label: 'Z.AI API key',
      hint: 'Standard global endpoint - api.z.ai',
      authMethod: 'api-key',
      baseUrl: 'https://api.z.ai/api/paas/v4',
    },
    {
      value: 'zai-coding-global',
      method: 'coding-global',
      label: 'Coding-Plan-Global',
      hint: 'GLM Coding Plan Global - api.z.ai',
      authMethod: 'api-key',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    },
    {
      value: 'zai-coding-cn',
      method: 'coding-cn',
      label: 'Coding-Plan-CN',
      hint: 'GLM Coding Plan CN - open.bigmodel.cn',
      authMethod: 'api-key',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    },
    {
      value: 'zai-global',
      method: 'global',
      label: 'Global',
      hint: 'Z.AI Global - api.z.ai',
      authMethod: 'api-key',
      baseUrl: 'https://api.z.ai/api/paas/v4',
    },
    {
      value: 'zai-cn',
      method: 'cn',
      label: 'CN',
      hint: 'Z.AI CN - open.bigmodel.cn',
      authMethod: 'api-key',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    },
  ],
  xiaomi: [
    {
      value: 'xiaomi-api-key',
      method: 'api-key',
      label: 'Xiaomi API key',
      hint: 'Pay-as-you-go endpoint - api.xiaomimimo.com',
      authMethod: 'api-key',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      modelChoices: ['xmi-large', 'mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2-omni'],
    },
    {
      value: 'xiaomi-token-plan',
      method: 'token-plan',
      label: 'Xiaomi Token Plan',
      hint: 'Paste the OpenAI-compatible Base URL from Subscription; use a tp- key.',
      authMethod: 'api-key',
      baseUrl: '',
      baseUrlPlaceholder: 'https://token-plan-cn.xiaomimimo.com/v1',
      modelChoices: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni'],
      requiresBaseUrl: true,
    },
  ],
}

function fallbackBuiltInProviderSetupOptions(provider: string) {
  return fallbackBuiltInProviderSetupOptionsByProvider[provider] ?? []
}

const fallbackBuiltInProviderOptions = fallbackBuiltInProviderDefaults.map(([provider, defaultModel, defaultApi]) =>
  builtInProviderOption(provider, defaultModel, defaultApi, fallbackBuiltInProviderModelChoices(provider)),
)

const settingsSections: Array<{ icon: LucideIcon; id: SettingsSectionId }> = [
  { icon: Wrench, id: 'general' },
  { icon: Blocks, id: 'automation' },
  { icon: Bot, id: 'model' },
  { icon: ShieldCheck, id: 'permissions' },
  { icon: Brain, id: 'memory' },
  { icon: MessageCircle, id: 'notifications' },
  { icon: FileText, id: 'privacy' },
  { icon: Clock3, id: 'advanced' },
]

const permissionModeDescriptions: Record<string, string> = {
  工作区模式: '只允许访问当前工作区中的内容，适合日常使用。',
  只读模式: 'CrawClaw 只查看信息，不会修改文件或执行写入操作。',
  完全访问: '允许更大范围的本机操作，适合你明确需要自动执行任务时。',
}

const englishPermissionModeDescriptions: Record<string, string> = {
  工作区模式: 'Only access content in the current workspace for everyday use.',
  只读模式: 'CrawClaw can inspect information but will not write files or make changes.',
  完全访问: 'Allow broader local actions when you explicitly want automation to run.',
}

const settingValueLabels: Record<SettingsLanguage, Record<string, string>> = {
  'zh-CN': {},
  en: {
    English: 'English',
    gpt: 'gpt',
    high: 'high',
    low: 'low',
    medium: 'medium',
    中文: 'Chinese',
    仅重要记忆: 'Important memories only',
    完全访问: 'Full access',
    工作区模式: 'Workspace mode',
    常规: 'General',
    手动: 'Manual',
    新对话: 'New chat',
    每天: 'Daily',
    每次确认: 'Always confirm',
    浅色: 'Light',
    深色: 'Dark',
    空闲时: 'When idle',
    详细: 'Verbose',
    记忆: 'Memory',
    跟随系统: 'Follow system',
    只读模式: 'Read-only mode',
    智能体: 'Agents',
    标准: 'Standard',
    更快: 'Faster',
    更稳: 'More stable',
    错误: 'Errors only',
    不自动清理: 'Do not auto-clean',
  },
}

const settingsCopy = {
  'zh-CN': {
    actions: {
      addModel: '添加模型',
      back: '上一步',
      cancel: '取消',
      execute: '执行',
      next: '下一步',
      off: '关闭',
      on: '开启',
      saveModel: '保存模型',
      testAndSaveModel: '测试连接并保存',
    },
    aria: {
      modelName: '模型名称',
      sections: {
        advanced: '高级',
        automation: '自动化环境',
        general: '常规',
        memory: '记忆偏好',
        model: '模型与回复',
        notifications: '通知',
        permissions: '权限与确认',
        privacy: '数据与隐私',
      },
      settingsCategories: '设置分类',
    },
    modelDraftPlaceholder: '输入模型名称',
    modelSetup: {
      authHint: 'API key 或 token 会保存为本机文件 SecretRef，设置页不会回显密钥。',
      authMethod: '认证方式',
      apiAdapter: 'API 适配器',
      baseUrl: 'Base URL',
      builtInDetail: '使用内置 Rust provider transport，适合官方或已有 provider。',
      builtInTitle: '内置 provider',
      connectionPreset: '连接方案',
      customDetail: '填写任意 OpenAI-compatible 自定义端点；Ollama、SGLang 和 vLLM 已在内置 provider 中可配置。',
      customTitle: '自定义 provider',
      displayName: '显示名称',
      displayNamePlaceholder: '例如 Local Qwen',
      customModelOption: '自定义模型 ID',
      failure: '连接测试失败，请检查地址、模型和凭证。',
      keyPlaceholder: '粘贴 API key 或访问 token',
      modelChoice: '选择模型',
      modelName: '模型名',
      modelNamePlaceholder: '例如 qwen3-coder',
      provider: 'Provider',
      saving: '正在测试连接...',
      searchEmpty: '没有找到匹配的 provider。',
      searchPlaceholder: '搜索 provider 或模型',
      source: '选择来源',
      stepLabels: ['来源', '连接', '模型', '保存'],
      success: '测试通过，模型已保存。',
      summaryTitle: '即将保存',
      title: '添加模型',
    },
    permissionFallback: '控制 CrawClaw 可以访问和操作的范围。',
    sections: {
      advanced: {
        detail: '只保留诊断入口和状态表达，不进入普通工作流。',
        title: '高级',
      },
      automation: {
        detail: '安装并维护 n8n / ComfyUI。',
        title: '自动化环境',
      },
      general: {
        detail: '控制桌面应用的基础使用习惯。',
        title: '常规',
      },
      memory: {
        detail: '控制 CrawClaw 什么时候记住、整理和清理信息。',
        title: '记忆偏好',
      },
      model: {
        detail: '设置新对话默认使用的模型、推理强度和回复偏好。',
        title: '模型与回复',
      },
      notifications: {
        detail: '决定什么时候让 CrawClaw 主动提醒你。',
        title: '通知',
      },
      permissions: {
        detail: '控制 CrawClaw 默认能查看或操作哪些内容。',
        title: '权限与确认',
      },
      privacy: {
        detail: '查看当前桌面数据目录，并清理、导出或删除本机数据。',
        title: '数据与隐私',
      },
    },
    rows: {
      addModel: ['模型', '添加并测试一套可切换的模型连接配置。'],
      allowTools: ['默认允许工具', '新对话默认允许 CrawClaw 使用工具完成任务。'],
      appearance: ['外观', '选择界面颜色模式。'],
      confirmCommands: ['执行命令前确认', '运行本机命令前先显示确认。'],
      confirmExternalApps: ['操作外部应用前确认', '控制浏览器、日历或其他应用前先确认。'],
      confirmFileChanges: ['修改文件前确认', '写入或覆盖文件前先询问你。'],
      confirmHighRisk: ['高风险操作始终确认', '删除、发布、支付等操作始终需要确认。'],
      dataLocation: ['当前桌面数据目录', 'CrawClaw Desktop 当前使用的本机 runtime 数据目录。'],
      defaultModel: ['默认模型', '选择 CrawClaw 默认使用的模型。'],
      defaultPage: ['默认打开页面', '启动后默认进入哪个工作区。'],
      diagnostics: ['诊断信息', '生成给开发者排查问题用的本机诊断信息。'],
      exportData: ['导出数据', '导出本机偏好、记忆和设置快照。'],
      language: ['语言', '设置桌面界面的显示语言。'],
      launchAtLogin: ['启动时打开 CrawClaw', '登录系统后自动打开桌面应用。'],
      logLevel: ['日志级别', '控制本机诊断日志的详细程度。'],
      memoryEnvironmentStatus: ['记忆环境状态', 'Hindsight 配置、生命周期和 worker 的当前状态。'],
      checkMemoryEnvironment: ['检查记忆环境', '检查 Hindsight 服务、banks、outbox 和 worker 状态。'],
      repairMemoryEnvironment: ['修复记忆环境', '重新准备 Hindsight 生命周期并初始化记忆 banks。'],
      reinstallMemoryEnvironment: ['重新安装记忆运行环境', '保留 memory/ 与 hindsight/ 数据目录，只重装/重启运行环境。'],
      memoryCleanupConfirmation: ['清理记忆确认', '清理记忆前是否需要再次确认。'],
      memoryDreamEnabled: ['做梦整理记忆', '空闲时整理最近对话中的长期记忆。'],
      memoryDreamFrequency: ['做梦频率', '决定记忆整理触发的频率。'],
      modelConfig: ['选择模型配置', '先选择一套默认回复配置，再按需要微调模型和思考等级。'],
      notifyAutomationFailed: ['自动化失败通知', '自动化任务失败时提醒。'],
      notifyConfirmNeeded: ['需要确认时通知', '需要你确认权限或操作时提醒。'],
      notifyDreamDone: ['做梦完成通知', '记忆整理完成后提醒。'],
      notifyTaskDone: ['任务完成通知', '长任务完成后发送通知。'],
      notificationSound: ['声音提示', '通知出现时播放提示音。'],
      permissionMode: ['权限模式', '选择 CrawClaw 默认能查看或操作哪些内容。'],
      rememberPreferences: ['自动记住偏好', '允许 CrawClaw 自动保存稳定的个人偏好。'],
      rememberProjectContext: ['整理项目上下文', '允许 CrawClaw 将项目相关事实整理为长期上下文。'],
      resetState: ['重置桌面状态', '只重置桌面 UI 状态，不删除真实项目文件。'],
      responseSpeed: ['回复模式', '控制聊天里展示多少过程信息：简洁只保留关键回复，标准显示简短过程，详细显示完整工具输出。'],
      refreshRuntime: ['刷新 Runtime', '重新读取本机 CrawClaw runtime 当前状态。'],
      runtimeStatus: ['Runtime 状态', '当前本机 CrawClaw runtime 的摘要状态。'],
      selectedThinking: ['思考等级', '决定回复前花多少时间推理。'],
      selectedThinkingUnsupported: ['思考等级', '当前模型不支持可调思考等级，会按模型默认策略运行。'],
      showInMenuBar: ['在菜单栏显示', '保留菜单栏入口，便于快速唤起。'],
      clearCache: ['清理缓存', '清理临时预览、下载和运行缓存。'],
      deleteLocalData: ['删除本机数据', '删除前会要求再次确认。'],
    },
    sidebar: {
      back: '返回应用',
    },
  },
  en: {
    actions: {
      addModel: 'Add model',
      back: 'Back',
      cancel: 'Cancel',
      execute: 'Run',
      next: 'Next',
      off: 'Off',
      on: 'On',
      saveModel: 'Save model',
      testAndSaveModel: 'Test and save',
    },
    aria: {
      modelName: 'Model name',
      sections: {
        advanced: 'Advanced',
        automation: 'Automation environment',
        general: 'General',
        memory: 'Memory',
        model: 'Models and replies',
        notifications: 'Notifications',
        permissions: 'Permissions and confirmations',
        privacy: 'Data and privacy',
      },
      settingsCategories: 'Settings categories',
    },
    modelDraftPlaceholder: 'Enter model name',
    modelSetup: {
      authHint: 'API keys or tokens are stored as local file SecretRefs and are never echoed in settings.',
      authMethod: 'Auth method',
      apiAdapter: 'API adapter',
      baseUrl: 'Base URL',
      builtInDetail: 'Use the built-in Rust provider transport for official or known providers.',
      builtInTitle: 'Built-in provider',
      connectionPreset: 'Connection',
      customDetail: 'Configure any OpenAI-compatible custom endpoint. Ollama, SGLang, and vLLM are configurable from built-in providers.',
      customTitle: 'Custom provider',
      displayName: 'Display name',
      displayNamePlaceholder: 'For example Local Qwen',
      customModelOption: 'Custom model ID',
      failure: 'Connection test failed. Check the URL, model, and credential.',
      keyPlaceholder: 'Paste API key or access token',
      modelChoice: 'Choose model',
      modelName: 'Model name',
      modelNamePlaceholder: 'For example qwen3-coder',
      provider: 'Provider',
      saving: 'Testing connection...',
      searchEmpty: 'No matching providers.',
      searchPlaceholder: 'Search provider or model',
      source: 'Choose source',
      stepLabels: ['Source', 'Connection', 'Model', 'Save'],
      success: 'Connection test passed and the model was saved.',
      summaryTitle: 'Ready to save',
      title: 'Add model',
    },
    permissionFallback: 'Control what CrawClaw can access and operate by default.',
    sections: {
      advanced: {
        detail: 'Keep diagnostics and runtime state separate from everyday workflows.',
        title: 'Advanced',
      },
      automation: {
        detail: 'Install and maintain n8n / ComfyUI.',
        title: 'Automation environment',
      },
      general: {
        detail: 'Control basic desktop app behavior.',
        title: 'General',
      },
      memory: {
        detail: 'Control when CrawClaw remembers, organizes, and cleans up information.',
        title: 'Memory preferences',
      },
      model: {
        detail: 'Set the default model, reasoning level, and reply behavior for new chats.',
        title: 'Models and replies',
      },
      notifications: {
        detail: 'Choose when CrawClaw should proactively notify you.',
        title: 'Notifications',
      },
      permissions: {
        detail: 'Control what CrawClaw can inspect or operate by default.',
        title: 'Permissions and confirmations',
      },
      privacy: {
        detail: 'View the current desktop data directory, then clean, export, or delete local data.',
        title: 'Data and privacy',
      },
    },
    rows: {
      addModel: ['Model', 'Add and test a switchable model connection profile.'],
      allowTools: ['Allow tools by default', 'Allow CrawClaw to use tools in new chats by default.'],
      appearance: ['Appearance', 'Choose the interface color mode.'],
      confirmCommands: ['Confirm before commands', 'Ask before running local commands.'],
      confirmExternalApps: ['Confirm before external apps', 'Ask before controlling browsers, calendars, or other apps.'],
      confirmFileChanges: ['Confirm file changes', 'Ask before writing or overwriting files.'],
      confirmHighRisk: ['Always confirm high-risk actions', 'Deleting, publishing, paying, and similar actions always need confirmation.'],
      dataLocation: ['Current desktop data directory', 'The local runtime data directory CrawClaw Desktop is using now.'],
      defaultModel: ['Default model', 'Choose the default model CrawClaw uses.'],
      defaultPage: ['Default page', 'Choose which workspace opens on startup.'],
      diagnostics: ['Diagnostics', 'Generate local diagnostics for debugging.'],
      exportData: ['Export data', 'Export a snapshot of local preferences, memory, and settings.'],
      language: ['Language', 'Set the desktop interface language.'],
      launchAtLogin: ['Open CrawClaw at login', 'Automatically open the desktop app after signing in.'],
      logLevel: ['Log level', 'Control local diagnostic log detail.'],
      memoryEnvironmentStatus: ['Memory environment status', 'Current Hindsight config, lifecycle, and worker status.'],
      checkMemoryEnvironment: ['Check memory environment', 'Check Hindsight service, banks, outbox, and worker status.'],
      repairMemoryEnvironment: ['Repair memory environment', 'Prepare the Hindsight lifecycle again and initialize memory banks.'],
      reinstallMemoryEnvironment: ['Reinstall memory runtime', 'Keep memory/ and hindsight/ data directories, then reinstall or restart the runtime environment.'],
      memoryCleanupConfirmation: ['Memory cleanup confirmation', 'Choose whether memory cleanup asks again.'],
      memoryDreamEnabled: ['Dream and organize memory', 'Organize long-term memory from recent chats while idle.'],
      memoryDreamFrequency: ['Dream frequency', 'Decide how memory organization is triggered.'],
      modelConfig: ['Model configuration', 'Start from a default reply profile, then tune model and reasoning.'],
      notifyAutomationFailed: ['Automation failure notifications', 'Notify when automation fails.'],
      notifyConfirmNeeded: ['Confirmation needed notifications', 'Notify when permission or action confirmation is needed.'],
      notifyDreamDone: ['Dream completion notifications', 'Notify after memory organization finishes.'],
      notifyTaskDone: ['Task completion notifications', 'Notify when long-running tasks finish.'],
      notificationSound: ['Notification sound', 'Play a sound when notifications appear.'],
      permissionMode: ['Permission mode', 'Choose what CrawClaw can inspect or operate by default.'],
      rememberPreferences: ['Remember preferences automatically', 'Allow CrawClaw to save stable personal preferences.'],
      rememberProjectContext: ['Organize project context', 'Allow CrawClaw to organize project facts as long-term context.'],
      resetState: ['Reset desktop state', 'Reset only desktop UI state without deleting real project files.'],
      responseSpeed: ['Reply mode', 'Controls how much process detail appears in chat: Compact keeps key replies, Standard shows brief progress, and Detailed shows full tool output.'],
      refreshRuntime: ['Refresh runtime', 'Read the current local CrawClaw runtime status again.'],
      runtimeStatus: ['Runtime status', 'Current local CrawClaw runtime summary.'],
      selectedThinking: ['Reasoning level', 'Decide how much reasoning time replies use.'],
      selectedThinkingUnsupported: ['Reasoning level', 'The current model does not support configurable reasoning and will use its model default.'],
      showInMenuBar: ['Show in menu bar', 'Keep a menu bar entry for quick access.'],
      clearCache: ['Clear cache', 'Clear temporary previews, downloads, and runtime cache.'],
      deleteLocalData: ['Delete local data', 'Requires another confirmation before deletion.'],
    },
    sidebar: {
      back: 'Back to app',
    },
  },
} as const

type SettingsWorkspaceProps = {
  activeSettingsSection: SettingsSectionId
  automationWorkspace: AutomationWorkspaceState
  confirmHighRisk: boolean
  language: SettingsLanguage
  memoryRuntimeStatus: unknown
  modelOptions: string[]
  onCheckMemoryEnvironment: () => void
  onClearCache: () => void
  onDeleteLocalData: () => void
  onExportData: () => void
  onGenerateDiagnostics: () => void
  onInstallRuntime: (runtimeId: string, input: AutomationRuntimeInstallInput) => Promise<void>
  onModelProfileTestAndSave: (input: ModelProfileSetupInput) => Promise<void>
  onPreferenceUpdate: (patch: SettingsPreferencePatch) => void
  onRepairMemoryEnvironment: () => void
  onRefreshAutomationRuntime: (runtimeId: string) => Promise<void>
  onRefreshRuntimeStatus: () => void
  onReinstallMemoryEnvironment: () => void
  onRequestConfirmation: (input: ConfirmationRequestInput) => Promise<boolean>
  onResetState: () => void
  onStartRuntime: (runtimeId: string) => Promise<void>
  onStopRuntime: (runtimeId: string) => Promise<void>
  preferences: DesktopPreferences
  runtimeStatus: string
}

type SettingsSidebarProps = {
  activeSettingsSection: SettingsSectionId
  language: SettingsLanguage
  onReturnToApp: () => void
  onSelectSection: (id: SettingsSectionId) => void
}

export function SettingsWorkspace({
  activeSettingsSection,
  automationWorkspace,
  confirmHighRisk,
  language,
  memoryRuntimeStatus,
  modelOptions,
  onCheckMemoryEnvironment,
  onClearCache,
  onDeleteLocalData,
  onExportData,
  onGenerateDiagnostics,
  onInstallRuntime,
  onModelProfileTestAndSave,
  onPreferenceUpdate,
  onRepairMemoryEnvironment,
  onRefreshAutomationRuntime,
  onRefreshRuntimeStatus,
  onReinstallMemoryEnvironment,
  onRequestConfirmation,
  onResetState,
  onStartRuntime,
  onStopRuntime,
  preferences,
  runtimeStatus,
}: SettingsWorkspaceProps) {
  const [isModelSetupOpen, setIsModelSetupOpen] = useState(false)
  const copy = settingsCopy[language]
  const taskDefaults = preferences.taskDefaults
  const taskReplyMode = normalizeReplyMode(taskDefaults.responseSpeed)
  const taskDefaultsThinkingSupported = modelSupportsConfigurableThinking(
    taskDefaults.selectedModel,
    preferences.modelProfiles,
  )
  const confirmationDefaults = preferences.confirmationDefaults
  const notificationDefaults = preferences.notificationDefaults
  const uiDefaults = preferences.uiDefaults
  const memoryDefaults = preferences.memoryDefaults
  const privacyDefaults = preferences.privacyDefaults
  const advancedDefaults = preferences.advancedDefaults

  const updateTaskDefaults = (patch: Partial<DesktopPreferences['taskDefaults']>) => {
    const nextTaskDefaults = {
      ...taskDefaults,
      ...patch,
    }
    onPreferenceUpdate({
      permissionMode: nextTaskDefaults.permissionMode,
      selectedModel: nextTaskDefaults.selectedModel,
      selectedThinking: nextTaskDefaults.selectedThinking,
      taskDefaults: nextTaskDefaults,
    })
  }

  const updateConfirmationDefaults = (patch: Partial<DesktopPreferences['confirmationDefaults']>) => {
    onPreferenceUpdate({
      confirmationDefaults: {
        ...confirmationDefaults,
        ...patch,
      },
    })
  }

  const updateNotificationDefaults = (patch: Partial<DesktopPreferences['notificationDefaults']>) => {
    onPreferenceUpdate({
      notificationDefaults: {
        ...notificationDefaults,
        ...patch,
      },
    })
  }

  const updateUiDefaults = (patch: Partial<DesktopPreferences['uiDefaults']>) => {
    onPreferenceUpdate({
      uiDefaults: patch,
    })
  }

  const updateMemoryDefaults = (patch: Partial<DesktopPreferences['memoryDefaults']>) => {
    onPreferenceUpdate({
      memoryDefaults: {
        ...memoryDefaults,
        ...patch,
      },
    })
  }

  const updateAdvancedDefaults = (patch: Partial<DesktopPreferences['advancedDefaults']>) => {
    onPreferenceUpdate({
      advancedDefaults: {
        ...advancedDefaults,
        ...patch,
      },
    })
  }

  const renderSettingsSelectRow = (
    label: string,
    detail: string,
    value: string,
    options: string[],
    onSelect: (value: string) => void,
    getSelectedDetail?: (value: string) => string,
    getOptionLabel: (value: string) => string = (option) => settingValueLabel(language, option),
  ) => (
    <div className="settings-field" data-setting-label={label} data-testid="settings-select-row">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <div className="settings-select-control">
        <select
          aria-label={label}
          className="settings-select"
          data-testid="settings-select"
          onChange={(event) => onSelect(event.currentTarget.value)}
          value={value}
        >
          {options.map((option) => (
            <option key={option} value={option}>{getOptionLabel(option)}</option>
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
    renderSettingsValueRow(
      copy.rows.modelConfig[0],
      copy.rows.modelConfig[1],
      `${taskDefaults.selectedModel} · ${taskDefaults.selectedThinking} · ${replyModeLabel(language, taskReplyMode)}`,
    )
  )

  const renderSettingsToggleRow = (
    label: string,
    detail: string,
    checked: boolean,
    onToggle: () => void,
    disabled = false,
  ) => (
    <div className="settings-field" data-setting-label={label} data-testid="settings-toggle-row">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <button
        aria-label={label}
        aria-pressed={checked}
        className={checked ? 'settings-switch is-on' : 'settings-switch'}
        data-testid="settings-toggle"
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        <span>{checked ? copy.actions.on : copy.actions.off}</span>
        <i aria-hidden="true" />
      </button>
    </div>
  )

  const renderSettingsValueRow = (
    label: string,
    detail: string,
    value: string,
  ) => (
    <div className="settings-field" data-setting-label={label} data-testid="settings-value-row">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <span className="settings-value-pill">{value}</span>
    </div>
  )

  const renderSettingsActionRow = (
    label: string,
    detail: string,
    onClick: () => void,
    tone: 'neutral' | 'danger' = 'neutral',
  ) => (
    <div className="settings-field" data-setting-label={label} data-testid="settings-action-row">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <button className={`settings-action-button is-${tone}`} data-testid="settings-action" onClick={onClick} type="button">
        {copy.actions.execute}
      </button>
    </div>
  )

  const renderAddModelRow = () => (
    <div className="settings-field settings-field--model-add" data-setting-label={copy.rows.addModel[0]} data-testid="settings-add-model-row">
      <div className="settings-field__label">
        <strong>{copy.rows.addModel[0]}</strong>
        <span>{copy.rows.addModel[1]}</span>
      </div>
      <button className="settings-action-button" data-testid="settings-add-model-open" onClick={() => setIsModelSetupOpen(true)} type="button">
        <PlugZap aria-hidden="true" size={14} strokeWidth={2} />
        {copy.actions.addModel}
      </button>
    </div>
  )

  const getSettingsSectionClass = (id: SettingsSectionId) => (
    activeSettingsSection === id ? 'settings-section is-active' : 'settings-section'
  )

  const getPermissionModeDescription = (mode: string) => (
    (language === 'en' ? englishPermissionModeDescriptions : permissionModeDescriptions)[mode]
      ?? copy.permissionFallback
  )

  return (
    <div className="settings-workspace" data-testid="settings-workspace">
      {isModelSetupOpen ? (
        <ModelSetupDialog
          language={language}
          onClose={() => setIsModelSetupOpen(false)}
          onSave={onModelProfileTestAndSave}
          preferences={preferences}
        />
      ) : null}
      <div className="settings-workspace__body">
        <section aria-label={copy.aria.sections.general} className={getSettingsSectionClass('general')} data-settings-section="general" data-testid="settings-section" id="settings-general">
          <header className="settings-section__header">
            <h2>{copy.sections.general.title}</h2>
            <p>{copy.sections.general.detail}</p>
          </header>
          <div className="settings-group">
            {renderSettingsSelectRow(copy.rows.defaultPage[0], copy.rows.defaultPage[1], uiDefaults.defaultPage, ['新对话', '记忆', '智能体'], (value) => updateUiDefaults({ defaultPage: value }))}
            {renderSettingsSelectRow(copy.rows.language[0], copy.rows.language[1], uiDefaults.language, ['中文', 'English'], (value) => updateUiDefaults({ language: value }))}
            {renderSettingsSelectRow(copy.rows.appearance[0], copy.rows.appearance[1], uiDefaults.appearance, ['跟随系统', '浅色', '深色'], (value) => updateUiDefaults({ appearance: value }))}
            {renderSettingsToggleRow(copy.rows.launchAtLogin[0], copy.rows.launchAtLogin[1], uiDefaults.launchAtLogin, () => updateUiDefaults({ launchAtLogin: !uiDefaults.launchAtLogin }))}
            {renderSettingsToggleRow(copy.rows.showInMenuBar[0], copy.rows.showInMenuBar[1], uiDefaults.showInMenuBar, () => updateUiDefaults({ showInMenuBar: !uiDefaults.showInMenuBar }))}
          </div>
        </section>

        <section aria-label={copy.aria.sections.automation} className={getSettingsSectionClass('automation')} data-settings-section="automation" data-testid="settings-section" id="settings-automation">
          <AutomationEnvironment
            automationWorkspace={automationWorkspace}
            confirmHighRisk={confirmHighRisk}
            onInstallRuntime={onInstallRuntime}
            onRequestConfirmation={onRequestConfirmation}
            onRefreshRuntime={onRefreshAutomationRuntime}
            onStartRuntime={onStartRuntime}
            onStopRuntime={onStopRuntime}
          />
        </section>

        <section aria-label={copy.aria.sections.model} className={getSettingsSectionClass('model')} data-settings-section="model" data-testid="settings-section" id="settings-model">
          <header className="settings-section__header">
            <h2>{copy.sections.model.title}</h2>
            <p>{copy.sections.model.detail}</p>
          </header>
          <div className="settings-group">
            {renderModelConfigurationSelector()}
            {renderSettingsSelectRow(copy.rows.defaultModel[0], copy.rows.defaultModel[1], taskDefaults.selectedModel, modelOptions, (value) => updateTaskDefaults({ selectedModel: value }), undefined, identityLabel)}
            {renderAddModelRow()}
            {renderSettingsSelectRow(copy.rows.selectedThinking[0], taskDefaultsThinkingSupported ? copy.rows.selectedThinking[1] : copy.rows.selectedThinkingUnsupported[1], taskDefaults.selectedThinking, preferences.thinkingOptions, (value) => updateTaskDefaults({ selectedThinking: value }))}
            {renderSettingsSelectRow(copy.rows.responseSpeed[0], copy.rows.responseSpeed[1], taskReplyMode, replyModeOptions, (value) => updateTaskDefaults({ responseSpeed: value }), undefined, (value) => replyModeLabel(language, value))}
            {renderSettingsToggleRow(copy.rows.allowTools[0], copy.rows.allowTools[1], taskDefaults.allowTools, () => updateTaskDefaults({ allowTools: !taskDefaults.allowTools }))}
          </div>
        </section>

        <section aria-label={copy.aria.sections.permissions} className={getSettingsSectionClass('permissions')} data-settings-section="permissions" data-testid="settings-section" id="settings-permissions">
          <header className="settings-section__header">
            <h2>{copy.sections.permissions.title}</h2>
            <p>{copy.sections.permissions.detail}</p>
          </header>
          <div className="settings-group">
            {renderSettingsSelectRow(
              copy.rows.permissionMode[0],
              copy.rows.permissionMode[1],
              taskDefaults.permissionMode,
              preferences.permissionModeOptions,
              (value) => updateTaskDefaults({ permissionMode: value }),
              getPermissionModeDescription,
            )}
            {renderSettingsToggleRow(copy.rows.confirmFileChanges[0], copy.rows.confirmFileChanges[1], confirmationDefaults.confirmFileChanges, () => updateConfirmationDefaults({ confirmFileChanges: !confirmationDefaults.confirmFileChanges }))}
            {renderSettingsToggleRow(copy.rows.confirmCommands[0], copy.rows.confirmCommands[1], confirmationDefaults.confirmCommands, () => updateConfirmationDefaults({ confirmCommands: !confirmationDefaults.confirmCommands }))}
            {renderSettingsToggleRow(copy.rows.confirmExternalApps[0], copy.rows.confirmExternalApps[1], confirmationDefaults.confirmExternalApps, () => updateConfirmationDefaults({ confirmExternalApps: !confirmationDefaults.confirmExternalApps }))}
            {renderSettingsToggleRow(copy.rows.confirmHighRisk[0], copy.rows.confirmHighRisk[1], confirmationDefaults.confirmHighRisk, () => updateConfirmationDefaults({ confirmHighRisk: !confirmationDefaults.confirmHighRisk }))}
          </div>
        </section>

        <section aria-label={copy.aria.sections.memory} className={getSettingsSectionClass('memory')} data-settings-section="memory" data-testid="settings-section" id="settings-memory">
          <header className="settings-section__header">
            <h2>{copy.sections.memory.title}</h2>
            <p>{copy.sections.memory.detail}</p>
          </header>
          <div className="settings-group">
            {renderSettingsValueRow(copy.rows.memoryEnvironmentStatus[0], copy.rows.memoryEnvironmentStatus[1], memoryRuntimeStatusLabel(language, memoryRuntimeStatus))}
            {renderSettingsActionRow(copy.rows.checkMemoryEnvironment[0], copy.rows.checkMemoryEnvironment[1], onCheckMemoryEnvironment)}
            {renderSettingsActionRow(copy.rows.repairMemoryEnvironment[0], copy.rows.repairMemoryEnvironment[1], onRepairMemoryEnvironment)}
            {renderSettingsActionRow(copy.rows.reinstallMemoryEnvironment[0], copy.rows.reinstallMemoryEnvironment[1], onReinstallMemoryEnvironment, 'danger')}
            {renderSettingsToggleRow(copy.rows.rememberPreferences[0], copy.rows.rememberPreferences[1], memoryDefaults.rememberPreferences, () => updateMemoryDefaults({ rememberPreferences: !memoryDefaults.rememberPreferences }))}
            {renderSettingsToggleRow(copy.rows.rememberProjectContext[0], copy.rows.rememberProjectContext[1], memoryDefaults.rememberProjectContext, () => updateMemoryDefaults({ rememberProjectContext: !memoryDefaults.rememberProjectContext }))}
            {renderSettingsToggleRow(copy.rows.memoryDreamEnabled[0], copy.rows.memoryDreamEnabled[1], memoryDefaults.memoryDreamEnabled, () => updateMemoryDefaults({ memoryDreamEnabled: !memoryDefaults.memoryDreamEnabled }))}
            {renderSettingsSelectRow(copy.rows.memoryDreamFrequency[0], copy.rows.memoryDreamFrequency[1], memoryDefaults.memoryDreamFrequency, ['空闲时', '每天', '手动'], (value) => updateMemoryDefaults({ memoryDreamFrequency: value }))}
            {renderSettingsSelectRow(copy.rows.memoryCleanupConfirmation[0], copy.rows.memoryCleanupConfirmation[1], memoryDefaults.memoryCleanupConfirmation, ['每次确认', '仅重要记忆', '不自动清理'], (value) => updateMemoryDefaults({ memoryCleanupConfirmation: value }))}
          </div>
        </section>

        <section aria-label={copy.aria.sections.notifications} className={getSettingsSectionClass('notifications')} data-settings-section="notifications" data-testid="settings-section" id="settings-notifications">
          <header className="settings-section__header">
            <h2>{copy.sections.notifications.title}</h2>
            <p>{copy.sections.notifications.detail}</p>
          </header>
          <div className="settings-group">
            {renderSettingsToggleRow(copy.rows.notifyTaskDone[0], copy.rows.notifyTaskDone[1], notificationDefaults.notifyTaskDone, () => updateNotificationDefaults({ notifyTaskDone: !notificationDefaults.notifyTaskDone }))}
            {renderSettingsToggleRow(copy.rows.notifyConfirmNeeded[0], copy.rows.notifyConfirmNeeded[1], notificationDefaults.notifyConfirmNeeded, () => updateNotificationDefaults({ notifyConfirmNeeded: !notificationDefaults.notifyConfirmNeeded }))}
            {renderSettingsToggleRow(copy.rows.notifyDreamDone[0], copy.rows.notifyDreamDone[1], notificationDefaults.notifyDreamDone, () => updateNotificationDefaults({ notifyDreamDone: !notificationDefaults.notifyDreamDone }))}
            {renderSettingsToggleRow(copy.rows.notifyAutomationFailed[0], copy.rows.notifyAutomationFailed[1], notificationDefaults.notifyAutomationFailed, () => updateNotificationDefaults({ notifyAutomationFailed: !notificationDefaults.notifyAutomationFailed }))}
            {renderSettingsToggleRow(copy.rows.notificationSound[0], copy.rows.notificationSound[1], notificationDefaults.notificationSound, () => updateNotificationDefaults({ notificationSound: !notificationDefaults.notificationSound }))}
          </div>
        </section>

        <section aria-label={copy.aria.sections.privacy} className={getSettingsSectionClass('privacy')} data-settings-section="privacy" data-testid="settings-section" id="settings-privacy">
          <header className="settings-section__header">
            <h2>{copy.sections.privacy.title}</h2>
            <p>{copy.sections.privacy.detail}</p>
          </header>
          <div className="settings-group">
            {renderSettingsValueRow(copy.rows.dataLocation[0], copy.rows.dataLocation[1], settingValueLabel(language, privacyDefaults.dataLocation))}
            {renderSettingsActionRow(copy.rows.clearCache[0], copy.rows.clearCache[1], onClearCache)}
            {renderSettingsActionRow(copy.rows.exportData[0], copy.rows.exportData[1], onExportData)}
            {renderSettingsActionRow(copy.rows.deleteLocalData[0], copy.rows.deleteLocalData[1], onDeleteLocalData, 'danger')}
          </div>
        </section>

        <section aria-label={copy.aria.sections.advanced} className={getSettingsSectionClass('advanced')} data-settings-section="advanced" data-testid="settings-section" id="settings-advanced">
          <header className="settings-section__header">
            <h2>{copy.sections.advanced.title}</h2>
            <p>{copy.sections.advanced.detail}</p>
          </header>
          <div className="settings-group">
            {renderSettingsSelectRow(copy.rows.logLevel[0], copy.rows.logLevel[1], advancedDefaults.logLevel, ['标准', '详细', '错误'], (value) => updateAdvancedDefaults({ logLevel: value }))}
            {renderSettingsValueRow(copy.rows.runtimeStatus[0], copy.rows.runtimeStatus[1], runtimeStatus)}
            {renderSettingsActionRow(copy.rows.refreshRuntime[0], copy.rows.refreshRuntime[1], onRefreshRuntimeStatus)}
            {renderSettingsActionRow(copy.rows.diagnostics[0], copy.rows.diagnostics[1], onGenerateDiagnostics)}
            {renderSettingsActionRow(copy.rows.resetState[0], copy.rows.resetState[1], onResetState, 'danger')}
          </div>
        </section>
      </div>
    </div>
  )
}

function ModelSetupDialog({
  language,
  onClose,
  onSave,
  preferences,
}: {
  language: SettingsLanguage
  onClose: () => void
  onSave: (input: ModelProfileSetupInput) => Promise<void>
  preferences: DesktopPreferences
}) {
  const copy = settingsCopy[language]
  const providerOptions = modelProviderOptions(preferences)
  const builtInOptions = providerOptions.filter((option) => option.source === 'builtin')
  const availableSourceOptions = builtInOptions.length > 0
    ? providerOptions
    : providerOptions.filter((option) => option.source === 'custom')
  const initialOption = availableSourceOptions[0] ?? customProviderOptions[0]
  const [step, setStep] = useState<ModelSetupStep>(0)
  const [draft, setDraft] = useState<ModelSetupDraft>(() => draftFromProviderOption(initialOption))
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [sourceSearch, setSourceSearch] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const currentProviderOptions = availableSourceOptions
  const filteredSourceOptions = sourceSearch.trim()
    ? availableSourceOptions.filter((option) => modelProviderOptionMatchesSearch(option, sourceSearch, language, copy))
    : availableSourceOptions
  const selectedProviderOption = currentProviderOptions.find((option) => option.source === draft.source && option.provider === draft.provider)
    ?? currentProviderOptions[0]
    ?? initialOption
  const selectedSetupOption = selectedProviderOption.setupOptions.find((option) => option.value === draft.setupOptionValue)
    ?? selectedProviderOption.setupOptions[0]
  const authMethods = selectedProviderOption.authMethods
  const showBaseUrl = shouldShowBaseUrlField(selectedProviderOption, selectedSetupOption)
  const showApiAdapter = selectedProviderOption.source === 'custom'
  const showSetupOption = selectedProviderOption.setupOptions.length > 1
  const showAuthMethod = authMethods.length > 1 && !showSetupOption
  const showApiKey = draft.authMethod !== 'local'
  const modelChoices = modelChoicesForProvider(selectedProviderOption, selectedSetupOption)
  const showModelChoice = selectedProviderOption.source === 'builtin' && modelChoices.length > 0
  const selectedModelChoice = showModelChoice && modelChoices.includes(draft.model)
    ? draft.model
    : customModelChoiceValue
  const showCustomModelInput = !showModelChoice || selectedModelChoice === customModelChoiceValue
  const canContinue = canContinueModelSetupStep(step, draft, selectedProviderOption, selectedSetupOption)

  const selectSourceOption = (option: ModelProviderOption) => {
    setDraft(draftFromProviderOption(option))
    setErrorMessage('')
  }

  const updateDraft = (patch: Partial<ModelSetupDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrorMessage('')
  }

  const selectModelChoice = (model: string) => {
    if (model === customModelChoiceValue) {
      updateDraft({ model: '', label: selectedProviderOption.label })
      return
    }
    updateDraft({ model, label: modelProfileLabel(selectedProviderOption, model) })
  }

  const selectSetupOption = (setupOption: ModelProviderSetupOption) => {
    const nextModelChoices = setupOption.modelChoices ?? []
    const shouldResetModel = nextModelChoices.length > 0 && !nextModelChoices.includes(draft.model)
    const nextModel = nextModelChoices[0] ?? selectedProviderOption.defaultModel
    updateDraft({
      authMethod: setupOption.authMethod,
      baseUrl: setupOption.requiresBaseUrl ? setupOption.baseUrl : setupOption.baseUrl || selectedProviderOption.defaultBaseUrl,
      setupOptionValue: setupOption.value,
      ...(shouldResetModel ? {
        model: nextModel,
        label: modelProfileLabel(selectedProviderOption, nextModel),
      } : {}),
    })
  }

  const saveModelProfile = async () => {
    if (!canContinue || isSaving) {
      return
    }
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      await onSave(modelProfileInputFromDraft(draft))
      setSuccessMessage(copy.modelSetup.success)
      window.setTimeout(onClose, 650)
    } catch (error) {
      setErrorMessage(errorMessageFromUnknown(error) || copy.modelSetup.failure)
    } finally {
      setIsSaving(false)
    }
  }

  const renderSourceStep = () => (
    <div className="model-setup-dialog__source-stack">
      <label className="model-setup-dialog__source-search">
        <Search aria-hidden="true" size={16} strokeWidth={2.1} />
        <input
          autoComplete="off"
          onChange={(event) => setSourceSearch(event.currentTarget.value)}
          placeholder={copy.modelSetup.searchPlaceholder}
          value={sourceSearch}
        />
      </label>
      {filteredSourceOptions.length > 0 ? (
        <div className="model-setup-dialog__source-grid" role="group" aria-label={copy.modelSetup.source}>
          {filteredSourceOptions.map((option) => {
            const isSelected = draft.source === option.source && draft.provider === option.provider
            return (
              <button
                className={isSelected ? 'model-setup-dialog__source is-selected' : 'model-setup-dialog__source'}
                key={`${option.source}:${option.provider}`}
                onClick={() => selectSourceOption(option)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`agent-create-wizard__model-icon model-setup-dialog__provider-icon ${providerOptionIconClass(option)}`}
                >
                  <ProviderLogoIcon option={option} />
                </span>
                <span className="agent-create-wizard__model-body">
                  <span>
                    <strong>{option.label}</strong>
                    <em>{option.source === 'builtin' ? copy.modelSetup.builtInTitle : copy.modelSetup.customTitle}</em>
                    {isSelected ? <CheckCircle2 aria-hidden="true" className="agent-create-wizard__model-check" size={16} strokeWidth={2.2} /> : null}
                  </span>
                  <small>{providerOptionHint(option, language)}</small>
                  <small>{option.defaultModel}</small>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="model-setup-dialog__source-empty">{copy.modelSetup.searchEmpty}</p>
      )}
    </div>
  )

  const renderConnectionStep = () => (
    <div className="model-setup-dialog__fields">
      <div className="model-setup-dialog__selected-provider">
        <span
          aria-hidden="true"
          className={`agent-create-wizard__model-icon model-setup-dialog__provider-icon ${providerOptionIconClass(selectedProviderOption)}`}
        >
          <ProviderLogoIcon option={selectedProviderOption} />
        </span>
        <span className="agent-create-wizard__model-body">
          <span>
            <strong>{selectedProviderOption.label}</strong>
            <em>{selectedProviderOption.source === 'builtin' ? copy.modelSetup.builtInTitle : copy.modelSetup.customTitle}</em>
          </span>
          <small>{providerOptionHint(selectedProviderOption, language)}</small>
        </span>
      </div>
      {showBaseUrl ? (
        <label className="agent-create-wizard__field">
          <span>{copy.modelSetup.baseUrl}</span>
          <input
            onChange={(event) => updateDraft({ baseUrl: event.currentTarget.value })}
            placeholder={baseUrlPlaceholder(selectedProviderOption, selectedSetupOption)}
            value={draft.baseUrl}
          />
        </label>
      ) : null}
      {showSetupOption ? (
        <div className="model-setup-dialog__auth">
          <span className="agent-create-wizard__label">{copy.modelSetup.connectionPreset}</span>
          <div className="agent-create-wizard__segmented model-setup-dialog__setup-options">
            {selectedProviderOption.setupOptions.map((setupOption) => (
              <button
                className={selectedSetupOption?.value === setupOption.value ? 'is-selected' : ''}
                key={setupOption.value}
                onClick={() => selectSetupOption(setupOption)}
                title={setupOptionHint(setupOption, language)}
                type="button"
              >
                {setupOptionLabel(setupOption, language)}
              </button>
            ))}
          </div>
          {selectedSetupOption ? <small>{setupOptionHint(selectedSetupOption, language)}</small> : null}
        </div>
      ) : null}
      {showApiAdapter ? (
        <label className="agent-create-wizard__field">
          <span>{copy.modelSetup.apiAdapter}</span>
          <select onChange={(event) => updateDraft({ api: event.currentTarget.value })} value={draft.api}>
            {apiAdapterOptions(selectedProviderOption).map((api) => (
              <option key={api} value={api}>{api || 'default'}</option>
            ))}
          </select>
        </label>
      ) : null}
      {showAuthMethod ? (
        <div className="model-setup-dialog__auth">
          <span className="agent-create-wizard__label">{copy.modelSetup.authMethod}</span>
          <div className="agent-create-wizard__segmented">
            {authMethods.map((method) => (
              <button
                className={draft.authMethod === method ? 'is-selected' : ''}
                key={method}
                onClick={() => updateDraft({ authMethod: method })}
                type="button"
              >
                {authMethodLabel(language, method)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {showApiKey ? (
        <label className="agent-create-wizard__field">
          <span>API key</span>
          <input
            autoComplete="off"
            onChange={(event) => updateDraft({ apiKey: event.currentTarget.value })}
            placeholder={copy.modelSetup.keyPlaceholder}
            type="password"
            value={draft.apiKey}
          />
          <small>{copy.modelSetup.authHint}</small>
        </label>
      ) : null}
    </div>
  )

  const renderModelStep = () => (
    <div className="model-setup-dialog__fields">
      {showModelChoice ? (
        <label className="agent-create-wizard__field">
          <span>{copy.modelSetup.modelChoice}</span>
          <select autoFocus onChange={(event) => selectModelChoice(event.currentTarget.value)} value={selectedModelChoice}>
            {modelChoices.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
            <option value={customModelChoiceValue}>{copy.modelSetup.customModelOption}</option>
          </select>
        </label>
      ) : null}
      {showCustomModelInput ? (
        <label className="agent-create-wizard__field">
          <span>{copy.modelSetup.modelName}</span>
          <input
            autoFocus={!showModelChoice}
            onChange={(event) => updateDraft({ model: event.currentTarget.value })}
            placeholder={copy.modelSetup.modelNamePlaceholder}
            value={draft.model}
          />
        </label>
      ) : null}
      <label className="agent-create-wizard__field">
        <span>{copy.modelSetup.displayName}</span>
        <input
          onChange={(event) => updateDraft({ label: event.currentTarget.value })}
          placeholder={copy.modelSetup.displayNamePlaceholder}
          value={draft.label}
        />
      </label>
      <SavedModelProfiles profiles={preferences.modelProfiles} />
    </div>
  )

  const renderSaveStep = () => (
    <div className="model-setup-dialog__summary">
      <div className="agent-create-wizard__model-summary">
        <span>{copy.modelSetup.summaryTitle}</span>
        <strong>{draft.label.trim() || `${draft.provider}/${draft.model}`}</strong>
        <p>{`${draft.provider}/${draft.model}`}</p>
      </div>
      <dl>
        <div>
          <dt>{copy.modelSetup.provider}</dt>
          <dd>{selectedProviderOption.label}</dd>
        </div>
        {selectedSetupOption ? (
          <div>
            <dt>{copy.modelSetup.connectionPreset}</dt>
            <dd>{setupOptionLabel(selectedSetupOption, language)}</dd>
          </div>
        ) : null}
        {showBaseUrl ? (
          <div>
            <dt>{copy.modelSetup.baseUrl}</dt>
            <dd>{draft.baseUrl.trim() || 'default'}</dd>
          </div>
        ) : null}
        <div>
          <dt>{copy.modelSetup.authMethod}</dt>
          <dd>{authMethodLabel(language, draft.authMethod)}</dd>
        </div>
      </dl>
      {errorMessage ? <p className="model-setup-dialog__message is-error">{errorMessage}</p> : null}
      {successMessage ? <p className="model-setup-dialog__message is-success">{successMessage}</p> : null}
      {isSaving ? <p className="model-setup-dialog__message"><Loader2 aria-hidden="true" size={14} strokeWidth={2} />{copy.modelSetup.saving}</p> : null}
    </div>
  )

  const stepContent = step === 0
    ? renderSourceStep()
    : step === 1
      ? renderConnectionStep()
      : step === 2
        ? renderModelStep()
        : renderSaveStep()

  return (
    <div className="agent-create-dialog-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isSaving) {
        onClose()
      }
    }}
    >
      <section aria-labelledby="model-setup-dialog-title" aria-modal="true" className="agent-create-dialog agent-create-wizard model-setup-dialog" role="dialog">
        <header className="agent-create-dialog__header">
          <span
            aria-hidden="true"
            className={`agent-create-dialog__icon model-setup-dialog__provider-icon ${providerOptionIconClass(selectedProviderOption)}`}
          >
            <ProviderLogoIcon option={selectedProviderOption} />
          </span>
          <div>
            <h2 id="model-setup-dialog-title">{copy.modelSetup.title}</h2>
            <p>{providerOptionHint(selectedProviderOption, language)}</p>
          </div>
          <button aria-label={copy.actions.cancel} disabled={isSaving} onClick={onClose} type="button">
            <X aria-hidden="true" size={15} strokeWidth={2} />
          </button>
        </header>

        <div className="agent-create-dialog__steps agent-create-wizard__steps agent-create-wizard__node-rail" aria-label={copy.modelSetup.title}>
          {copy.modelSetup.stepLabels.map((label, index) => (
            <span className="agent-create-wizard__step-node" key={label}>
              <span className={index === step ? 'agent-create-wizard__node is-active' : index < step ? 'agent-create-wizard__node is-complete' : 'agent-create-wizard__node'}>
                <span>{index + 1}</span>
                <strong>{label}</strong>
              </span>
              {index < copy.modelSetup.stepLabels.length - 1 ? (
                <i aria-hidden="true" className={index < step ? 'agent-create-wizard__connector is-complete' : 'agent-create-wizard__connector'} />
              ) : null}
            </span>
          ))}
        </div>

        <section className="agent-create-wizard__body model-setup-dialog__body" aria-label={copy.modelSetup.stepLabels[step]}>
          {stepContent}
        </section>

        <footer className="agent-create-dialog__footer agent-create-wizard__footer">
          <button disabled={isSaving} onClick={onClose} type="button">{copy.actions.cancel}</button>
          {step > 0 ? (
            <button disabled={isSaving} onClick={() => setStep((current) => Math.max(0, current - 1) as ModelSetupStep)} type="button">
              <ArrowLeft aria-hidden="true" size={14} strokeWidth={2} />
              {copy.actions.back}
            </button>
          ) : null}
          {step < 3 ? (
            <button className="agent-create-dialog__submit" disabled={!canContinue} onClick={() => setStep((current) => Math.min(3, current + 1) as ModelSetupStep)} type="button">
              {copy.actions.next}
              <ArrowRight aria-hidden="true" size={14} strokeWidth={2} />
            </button>
          ) : (
            <button className="agent-create-dialog__submit" disabled={!canContinue || isSaving || Boolean(successMessage)} onClick={saveModelProfile} type="button">
              {isSaving ? <Loader2 aria-hidden="true" className="model-setup-dialog__spinner" size={14} strokeWidth={2} /> : <TestTube2 aria-hidden="true" size={14} strokeWidth={2} />}
              {copy.actions.testAndSaveModel}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

function SavedModelProfiles({ profiles }: { profiles: DesktopModelProfileSummary[] }) {
  if (!profiles.length) {
    return null
  }
  return (
    <div className="model-setup-dialog__saved">
      {profiles.slice(0, 4).map((profile) => (
        <span key={profile.id}>
          <CheckCircle2 aria-hidden="true" size={13} strokeWidth={2.2} />
          {profile.label || profile.modelRef}
        </span>
      ))}
    </div>
  )
}

export function SettingsSidebar({
  activeSettingsSection,
  language,
  onReturnToApp,
  onSelectSection,
}: SettingsSidebarProps) {
  const copy = settingsCopy[language]
  return (
    <aside aria-label="设置导航" className="desktop-sidebar settings-sidebar">
      <button className="settings-sidebar__back" onClick={onReturnToApp} type="button">
        <ChevronLeft aria-hidden="true" size={15} strokeWidth={2} />
        <span>{copy.sidebar.back}</span>
      </button>
      <nav aria-label={copy.aria.settingsCategories} className="settings-sidebar__nav">
        {settingsSections.map((section) => (
          <button
            className={activeSettingsSection === section.id ? 'is-active' : ''}
            data-settings-section={section.id}
            data-testid="settings-sidebar-section"
            key={section.id}
            onClick={() => onSelectSection(section.id)}
            type="button"
          >
            <section.icon aria-hidden="true" size={15} strokeWidth={2} />
            <span>{copy.sections[section.id].title}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

function identityLabel(value: string) {
  return value
}

function settingValueLabel(language: SettingsLanguage, value: string) {
  return settingValueLabels[language][value] ?? value
}

function memoryRuntimeStatusLabel(language: SettingsLanguage, value: unknown) {
  const fallback = language === 'en' ? 'Unknown' : '未知'
  const status = recordValue(value)
  if (!status) {
    return fallback
  }

  const hindsight = recordValue(status['hindsight'])
  const lifecycle = hindsight ? recordValue(hindsight['lifecycle']) : null
  const action = memoryEnvironmentActionLabel(language, stringRecordValue(status, 'action'))
  const state = lifecycle
    ? stringRecordValue(lifecycle, 'status')
    : stringRecordValue(status, 'status')
  const reason = lifecycle
    ? stringRecordValue(lifecycle, 'reason')
    : stringRecordValue(status, 'error')
  const baseUrl = lifecycle ? stringRecordValue(lifecycle, 'baseUrl') : ''
  const checkedAt = stringRecordValue(status, 'checkedAt')
  const parts = [action, state || fallback, reason, baseUrl, checkedAt].filter(Boolean)
  return parts.join(' · ')
}

function memoryEnvironmentActionLabel(language: SettingsLanguage, action: string) {
  if (language === 'en') {
    if (action === 'check') {
      return 'Checked'
    }
    if (action === 'reinstall') {
      return 'Reinstalled'
    }
    if (action === 'repair') {
      return 'Repaired'
    }
    return ''
  }
  if (action === 'check') {
    return '已检查'
  }
  if (action === 'reinstall') {
    return '已重装'
  }
  if (action === 'repair') {
    return '已修复'
  }
  return ''
}

function modelProviderOptions(preferences: DesktopPreferences): ModelProviderOption[] {
  const descriptorOptions = preferences.providerDescriptors
    .map(providerOptionFromDescriptor)
    .filter((option): option is ModelProviderOption => Boolean(option))
  const builtInOptions = descriptorOptions.length > 0 ? descriptorOptions : fallbackBuiltInProviderOptions
  const allOptions = [...builtInOptions, ...customProviderOptions]
  const seen = new Set<string>()
  return allOptions.filter((option) => {
    if (hiddenModelSetupProviders.has(option.provider)) {
      return false
    }
    const key = `${option.source}:${option.provider}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function providerOptionFromDescriptor(value: unknown): ModelProviderOption | null {
  const record = recordValue(value)
  if (!record) {
    return null
  }
  const provider = stringRecordValue(record, 'provider')
  if (!provider || stringRecordValue(record, 'kind') !== 'chat') {
    return null
  }
  const authMethodRecords = arrayRecordValue(record, 'authMethods')
  const authMethods = authMethodRecords
    .map((method) => stringRecordValue(method, 'method'))
    .filter((method): method is string => Boolean(method))
  const authEnvVars = arrayStringRecordValue(record, 'authEnvVars')
  const defaultModel = stringRecordValue(record, 'defaultModel') || 'local'
  const modelChoices = arrayStringRecordValue(record, 'modelChoices')
  const resolvedModelChoices = modelChoices.length > 0 ? modelChoices : fallbackBuiltInProviderModelChoices(provider)
  const transport = stringRecordValue(record, 'transport') || ''
  if (!transport) {
    return null
  }
  return builtInProviderOption(
    provider,
    defaultModel,
    transport,
    resolvedModelChoices,
    authMethods,
    authEnvVars,
    setupOptionsFromAuthChoices(provider, authMethodRecords),
  )
}

function builtInProviderOption(
  provider: string,
  defaultModel: string,
  defaultApi: string,
  modelChoices: string[] = [],
  authMethods: string[] = [],
  authEnvVars: string[] = [],
  setupOptions: ModelProviderSetupOption[] = fallbackBuiltInProviderSetupOptions(provider),
): ModelProviderOption {
  return {
    source: 'builtin',
    provider,
    label: providerLabel(provider),
    hint: builtInProviderHint(provider, defaultApi),
    defaultModel,
    modelChoices,
    defaultBaseUrl: builtInProviderBaseUrl(provider),
    defaultApi,
    defaultAuthMethod: defaultBuiltInProviderAuthMethod(provider, authMethods, authEnvVars),
    authMethods: builtInProviderAuthMethods(provider, authMethods, authEnvVars),
    requiresBaseUrl: builtInProviderRequiresBaseUrl(provider, defaultApi),
    setupOptions,
  }
}

function setupOptionsFromAuthChoices(
  provider: string,
  authChoices: Record<string, unknown>[],
) {
  const setupOptions = authChoices
    .map((choice) => setupOptionFromAuthChoice(provider, choice))
    .filter((choice): choice is ModelProviderSetupOption => Boolean(choice))
  const fallbackOptions = fallbackBuiltInProviderSetupOptions(provider)
  const fallbackByValue = new Map(fallbackOptions.map((option) => [option.value, option]))
  const mergedOptions = setupOptions.map((option) => {
    const fallback = fallbackByValue.get(option.value)
    if (!fallback) {
      return option
    }
    return {
      ...fallback,
      ...option,
      baseUrl: option.baseUrl || fallback.baseUrl,
      baseUrlPlaceholder: option.baseUrlPlaceholder ?? fallback.baseUrlPlaceholder,
      hint: option.hint || fallback.hint,
      modelChoices: option.modelChoices ?? fallback.modelChoices,
      requiresBaseUrl: option.requiresBaseUrl ?? fallback.requiresBaseUrl,
    }
  })
  const setupValues = new Set(setupOptions.map((option) => option.value))
  return [
    ...mergedOptions,
    ...fallbackOptions.filter((option) => !setupValues.has(option.value)),
  ]
}

function setupOptionFromAuthChoice(
  provider: string,
  choice: Record<string, unknown>,
): ModelProviderSetupOption | null {
  const choiceProvider = stringRecordValue(choice, 'provider') || provider
  if (choiceProvider !== provider) {
    return null
  }
  const method = stringRecordValue(choice, 'method')
  const value = stringRecordValue(choice, 'choiceId')
  const label = stringRecordValue(choice, 'choiceLabel')
  const authMethod = modelProfileAuthMethodFromDescriptor(method)
  const baseUrl = baseUrlForSetupChoice(provider, method, value)
  const requiresBaseUrl = setupChoiceRequiresBaseUrl(provider, method, value)
  if (!method || !value || !label || !authMethod || (!baseUrl && !requiresBaseUrl)) {
    return null
  }
  return {
    value,
    method,
    label,
    hint: stringRecordValue(choice, 'choiceHint'),
    authMethod,
    baseUrl,
    requiresBaseUrl,
  }
}

function providerOptionHint(option: ModelProviderOption, language: SettingsLanguage) {
  return option.hint[language] ?? option.hint.en
}

function setupOptionLabel(option: ModelProviderSetupOption, language: SettingsLanguage) {
  if (language === 'zh-CN') {
    const labels: Record<string, string> = {
      'minimax-cn-api': 'MiniMax API key（国内）',
      'minimax-global-api': 'MiniMax API key（国际）',
      'modelstudio-api-key': '编码订阅 API Key（国际）',
      'modelstudio-api-key-cn': '编码订阅 API Key（国内）',
      'modelstudio-standard-api-key': '标准 API Key（国际）',
      'modelstudio-standard-api-key-cn': '标准 API Key（国内）',
      'moonshot-api-key': 'Moonshot API key（.ai）',
      'moonshot-api-key-cn': 'Moonshot API key（.cn）',
      'xiaomi-api-key': '小米按量 API',
      'xiaomi-token-plan': '小米 Token Plan',
      'zai-api-key': 'Z.AI 标准接口',
      'zai-cn': 'Z.AI 国内',
      'zai-coding-cn': '编码订阅（国内）',
      'zai-coding-global': '编码订阅（国际）',
      'zai-global': 'Z.AI 国际',
    }
    return labels[option.value] ?? option.label
  }
  return option.label
}

function setupOptionHint(option: ModelProviderSetupOption, language: SettingsLanguage) {
  if (language === 'zh-CN') {
    const hints: Record<string, string> = {
      'minimax-cn-api': '国内端点：api.minimaxi.com',
      'minimax-global-api': '国际端点：api.minimax.io',
      'modelstudio-api-key': '编码订阅国际端点：coding-intl.dashscope.aliyuncs.com',
      'modelstudio-api-key-cn': '编码订阅国内端点：coding.dashscope.aliyuncs.com',
      'modelstudio-standard-api-key': '标准国际端点：dashscope-intl.aliyuncs.com',
      'modelstudio-standard-api-key-cn': '标准国内端点：dashscope.aliyuncs.com',
      'moonshot-api-key': '国际端点：api.moonshot.ai',
      'moonshot-api-key-cn': '国内端点：api.moonshot.cn',
      'xiaomi-api-key': '按量接口：api.xiaomimimo.com，使用 sk- 开头 API key',
      'xiaomi-token-plan': '订阅套餐：粘贴 Subscription 页面 OpenAI-compatible Base URL，使用 tp- 开头 Token Plan key',
      'zai-api-key': '标准国际端点：api.z.ai',
      'zai-cn': '标准国内端点：open.bigmodel.cn',
      'zai-coding-cn': '编码订阅国内端点：open.bigmodel.cn',
      'zai-coding-global': '编码订阅国际端点：api.z.ai',
      'zai-global': '标准国际端点：api.z.ai',
    }
    return hints[option.value] ?? option.hint
  }
  return option.hint || option.label
}

function modelProviderOptionMatchesSearch(
  option: ModelProviderOption,
  query: string,
  language: SettingsLanguage,
  copy: typeof settingsCopy[SettingsLanguage],
) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return true
  }
  const sourceLabel = option.source === 'builtin' ? copy.modelSetup.builtInTitle : copy.modelSetup.customTitle
  return [
    option.provider,
    option.label,
    option.defaultModel,
    option.defaultApi,
    sourceLabel,
    providerOptionHint(option, language),
    ...option.setupOptions.flatMap((setupOption) => [
      setupOptionLabel(setupOption, language),
      setupOptionHint(setupOption, language),
    ]),
  ].some((value) => value.toLowerCase().includes(normalized))
}

const providerLogoPathById: Record<string, string> = {
  alibabacloud: 'M3.996 4.517h5.291L8.01 6.324 4.153 7.506a1.668 1.668 0 0 0-1.165 1.601v5.786a1.668 1.668 0 0 0 1.165 1.6l3.857 1.183 1.277 1.807H3.996A3.996 3.996 0 0 1 0 15.487V8.513a3.996 3.996 0 0 1 3.996-3.996m16.008 0h-5.291l1.277 1.807 3.857 1.182c.715.227 1.17.889 1.165 1.601v5.786a1.668 1.668 0 0 1-1.165 1.6l-3.857 1.183-1.277 1.807h5.291A3.996 3.996 0 0 0 24 15.487V8.513a3.996 3.996 0 0 0-3.996-3.996m-4.007 8.345H8.002v-1.804h7.995Z',
  anthropic: 'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z',
  baidu: 'M9.154 0C7.71 0 6.54 1.658 6.54 3.707c0 2.051 1.171 3.71 2.615 3.71 1.446 0 2.614-1.659 2.614-3.71C11.768 1.658 10.6 0 9.154 0zm7.025.594C14.86.58 13.347 2.589 13.2 3.927c-.187 1.745.25 3.487 2.179 3.735 1.933.25 3.175-1.806 3.422-3.364.252-1.555-.995-3.364-2.362-3.674a1.218 1.218 0 0 0-.261-.03zM3.582 5.535a2.811 2.811 0 0 0-.156.008c-2.118.19-2.428 3.24-2.428 3.24-.287 1.41.686 4.425 3.297 3.864 2.617-.561 2.262-3.68 2.183-4.362-.125-1.018-1.292-2.773-2.896-2.75zm16.534 1.753c-2.308 0-2.617 2.119-2.617 3.616 0 1.43.121 3.425 2.988 3.362 2.867-.063 2.553-3.238 2.553-3.988 0-.745-.62-2.99-2.924-2.99zm-8.264 2.478c-1.424.014-2.708.925-3.323 1.947-1.118 1.868-2.863 3.05-3.112 3.363-.25.309-3.61 2.116-2.864 5.42.746 3.301 3.365 3.237 3.365 3.237s1.93.19 4.171-.31c2.24-.495 4.17.123 4.17.123s5.233 1.748 6.665-1.616c1.43-3.364-.808-5.109-.808-5.109s-2.99-2.306-4.736-4.798c-1.072-1.665-2.348-2.268-3.528-2.257zm-2.234 3.84l1.542.024v8.197H7.758c-1.47-.291-2.055-1.292-2.13-1.462-.072-.173-.488-.976-.268-2.343.635-2.049 2.447-2.196 2.447-2.196h1.81zm3.964 2.39v3.881c.096.413.612.488.612.488h1.614v-4.343h1.689v5.782h-3.915c-1.517-.39-1.59-1.465-1.59-1.465v-4.317zm-5.458 1.147c-.66.197-.978.708-1.05.928-.076.22-.247.78-.1 1.269.294 1.095 1.248 1.144 1.248 1.144h1.37v-3.34z',
  bytedance: 'M19.8772 1.4685L24 2.5326v18.9426l-4.1228 1.0563V1.4685zm-13.3481 9.428l4.115 1.0641v8.9786l-4.115 1.0642v-11.107zM0 2.572l4.115 1.0642v16.7354L0 21.428V2.572zm17.4553 5.6205v11.107l-4.1228-1.0642V9.2568l4.1228-1.0642z',
  cloudflare: 'M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727',
  deepseek: 'M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45',
  github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  githubcopilot: 'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z',
  google: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  huggingface: 'M12.025 1.13c-5.77 0-10.449 4.647-10.449 10.378 0 1.112.178 2.181.503 3.185.064-.222.203-.444.416-.577a.96.96 0 0 1 .524-.15c.293 0 .584.124.84.284.278.173.48.408.71.694.226.282.458.611.684.951v-.014c.017-.324.106-.622.264-.874s.403-.487.762-.543c.3-.047.596.06.787.203s.31.313.4.467c.15.257.212.468.233.542.01.026.653 1.552 1.657 2.54.616.605 1.01 1.223 1.082 1.912.055.537-.096 1.059-.38 1.572.637.121 1.294.187 1.967.187.657 0 1.298-.063 1.921-.178-.287-.517-.44-1.041-.384-1.581.07-.69.465-1.307 1.081-1.913 1.004-.987 1.647-2.513 1.657-2.539.021-.074.083-.285.233-.542.09-.154.208-.323.4-.467a1.08 1.08 0 0 1 .787-.203c.359.056.604.29.762.543s.247.55.265.874v.015c.225-.34.457-.67.683-.952.23-.286.432-.52.71-.694.257-.16.547-.284.84-.285a.97.97 0 0 1 .524.151c.228.143.373.388.43.625l.006.04a10.3 10.3 0 0 0 .534-3.273c0-5.731-4.678-10.378-10.449-10.378M8.327 6.583a1.5 1.5 0 0 1 .713.174 1.487 1.487 0 0 1 .617 2.013c-.183.343-.762-.214-1.102-.094-.38.134-.532.914-.917.71a1.487 1.487 0 0 1 .69-2.803m7.486 0a1.487 1.487 0 0 1 .689 2.803c-.385.204-.536-.576-.916-.71-.34-.12-.92.437-1.103.094a1.487 1.487 0 0 1 .617-2.013 1.5 1.5 0 0 1 .713-.174m-10.68 1.55a.96.96 0 1 1 0 1.921.96.96 0 0 1 0-1.92m13.838 0a.96.96 0 1 1 0 1.92.96.96 0 0 1 0-1.92M8.489 11.458c.588.01 1.965 1.157 3.572 1.164 1.607-.007 2.984-1.155 3.572-1.164.196-.003.305.12.305.454 0 .886-.424 2.328-1.563 3.202-.22-.756-1.396-1.366-1.63-1.32q-.011.001-.02.006l-.044.026-.01.008-.03.024q-.018.017-.035.036l-.032.04a1 1 0 0 0-.058.09l-.014.025q-.049.088-.11.19a1 1 0 0 1-.083.116 1.2 1.2 0 0 1-.173.18q-.035.029-.075.058a1.3 1.3 0 0 1-.251-.243 1 1 0 0 1-.076-.107c-.124-.193-.177-.363-.337-.444-.034-.016-.104-.008-.2.022q-.094.03-.216.087-.06.028-.125.063l-.13.074q-.067.04-.136.086a3 3 0 0 0-.135.096 3 3 0 0 0-.26.219 2 2 0 0 0-.12.121 2 2 0 0 0-.106.128l-.002.002a2 2 0 0 0-.09.132l-.001.001a1.2 1.2 0 0 0-.105.212q-.013.036-.024.073c-1.139-.875-1.563-2.317-1.563-3.203 0-.334.109-.457.305-.454m.836 10.354c.824-1.19.766-2.082-.365-3.194-1.13-1.112-1.789-2.738-1.789-2.738s-.246-.945-.806-.858-.97 1.499.202 2.362c1.173.864-.233 1.45-.685.64-.45-.812-1.683-2.896-2.322-3.295s-1.089-.175-.938.647 2.822 2.813 2.562 3.244-1.176-.506-1.176-.506-2.866-2.567-3.49-1.898.473 1.23 2.037 2.16c1.564.932 1.686 1.178 1.464 1.53s-3.675-2.511-4-1.297c-.323 1.214 3.524 1.567 3.287 2.405-.238.839-2.71-1.587-3.216-.642-.506.946 3.49 2.056 3.522 2.064 1.29.33 4.568 1.028 5.713-.624m5.349 0c-.824-1.19-.766-2.082.365-3.194 1.13-1.112 1.789-2.738 1.789-2.738s.246-.945.806-.858.97 1.499-.202 2.362c-1.173.864.233 1.45.685.64.451-.812 1.683-2.896 2.322-3.295s1.089-.175.938.647-2.822 2.813-2.562 3.244 1.176-.506 1.176-.506 2.866-2.567 3.49-1.898-.473 1.23-2.037 2.16c-1.564.932-1.686 1.178-1.464 1.53s3.675-2.511 4-1.297c.323 1.214-3.524 1.567-3.287 2.405.238.839 2.71-1.587 3.216-.642.506.946-3.49 2.056-3.522 2.064-1.29.33-4.568 1.028-5.713-.624',
  minimax: 'M11.43 3.92a.86.86 0 1 0-1.718 0v14.236a1.999 1.999 0 0 1-3.997 0V9.022a.86.86 0 1 0-1.718 0v3.87a1.999 1.999 0 0 1-3.997 0V11.49a.57.57 0 0 1 1.139 0v1.404a.86.86 0 0 0 1.719 0V9.022a1.999 1.999 0 0 1 3.997 0v9.134a.86.86 0 0 0 1.719 0V3.92a1.998 1.998 0 1 1 3.996 0v11.788a.57.57 0 1 1-1.139 0zm10.572 3.105a2 2 0 0 0-1.999 1.997v7.63a.86.86 0 0 1-1.718 0V3.923a1.999 1.999 0 0 0-3.997 0v16.16a.86.86 0 0 1-1.719 0V18.08a.57.57 0 1 0-1.138 0v2a1.998 1.998 0 0 0 3.996 0V3.92a.86.86 0 0 1 1.719 0v12.73a1.999 1.999 0 0 0 3.996 0V9.023a.86.86 0 1 1 1.72 0v6.686a.57.57 0 0 0 1.138 0V9.022a2 2 0 0 0-1.998-1.997',
  mistralai: 'M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z',
  moonshotai: 'm1.053 16.91 9.538 2.55a21 20.981 0 0 0 .06 2.031l5.956 1.592a12 11.99 0 0 1-15.554-6.172m-1.02-5.79 11.352 3.035a21 20.981 0 0 0-.469 2.01l10.817 2.89a12 11.99 0 0 1-1.845 2.004L.658 15.918a12 11.99 0 0 1-.625-4.796m1.593-5.146L13.573 9.17a21 20.981 0 0 0-1.01 1.874l11.297 3.02a21 20.981 0 0 1-.67 2.362l-11.55-3.087L.125 10.26a12 11.99 0 0 1 1.499-4.285ZM6.067 1.58l11.285 3.016a21 20.981 0 0 0-1.688 1.719l7.824 2.091a21 20.981 0 0 1 .513 2.664L2.107 5.218a12 11.99 0 0 1 3.96-3.638M21.68 4.866 7.222 1.003A12 11.99 0 0 1 21.68 4.866',
  nvidia: 'M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z',
  openrouter: 'M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z',
  vercel: 'm12 1.608 12 20.784H0Z',
  vllm: 'm23.6 0-8.721 4.59L9.829 24h7.41zM9.83 24V5.142H.4Z',
  xiaomi: 'M12 0C8.016 0 4.756.255 2.493 2.516.23 4.776 0 8.033 0 12.012c0 3.98.23 7.235 2.494 9.497C4.757 23.77 8.017 24 12 24c3.983 0 7.243-.23 9.506-2.491C23.77 19.247 24 15.99 24 12.012c0-3.984-.233-7.243-2.502-9.504C19.234.252 15.978 0 12 0zM4.906 7.405h5.624c1.47 0 3.007.068 3.764.827.746.746.827 2.233.83 3.676v4.54a.15.15 0 0 1-.152.147h-1.947a.15.15 0 0 1-.152-.148V11.83c-.002-.806-.048-1.634-.464-2.051-.358-.36-1.026-.441-1.72-.458H7.158a.15.15 0 0 0-.151.147v6.98a.15.15 0 0 1-.152.148H4.906a.15.15 0 0 1-.15-.148V7.554a.15.15 0 0 1 .15-.149zm12.131 0h1.949a.15.15 0 0 1 .15.15v8.892a.15.15 0 0 1-.15.148h-1.949a.15.15 0 0 1-.151-.148V7.554a.15.15 0 0 1 .151-.149zM8.92 10.948h2.046c.083 0 .15.066.15.147v5.352a.15.15 0 0 1-.15.148H8.92a.15.15 0 0 1-.152-.148v-5.352a.15.15 0 0 1 .152-.147Z',
}

const sglangLogoDataUri =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAIQklEQVR4nOxaeXBT19U/9923aHnPWi0hb3jFBmMTQT7AAwmBDzIUCC1NOintJExogZIhlKSEQtJOYehAUuhCl0CTrmlS0iRsmZAE3LK4FEIAY2PMEmxsFq9Ysqz16em9dzvSDBkykWXZyNXQ6e8fPb137rnnd9855557JArucfyPQLqB023AbURXcgQGyKAAggSAJDmOHma7BkSRBmBpKWeYbGOdGh0WWAbdVCW19fAN0bfjUlhuCiUej/5ThsbD3Exk+E6x/iVfCC8iCGkRRQFRFNBqUGO2jd7KMsr+jcf7enZ3qP2+kLQRmMAj85pSfQ1nyS6vXLQcHOMnAkUz0HftKlzY9Qa0n6iR8rPpjbyO/H55tbvjX574etIWA+tGal+15hXMnLHp12AuLgUK04AQAo3JDDlV00Dy+/G1usaJZiNz1mlGrW+1RCLxXkNaslA5g7ItOmbh+CWrQGMwfuF5lEjlk0uBMVh4d5+yINeqs0/MiK8rLQQKefoBNsOAbRXOfmUww0LWxCkQCKqjgYC13IrjuntaCGgwMrK8EFvpROAEAygqaAGA0dPxhdNCoEdSW4K3ukEOiwnlvDdbgWWQCyEU6ArGz0RpIdDol2tIWOpp/mhfvzL+zjboOP0xGHjqY6TKXSe64xNISxYKEJALORLELY1zjAXFIGTlfu656OmFY5tfBCro+jTLxmw+ctV3ZedNRY2nK237gJUGeLlCs1kDmjXZk6ZSI+77P8AsB57WZmg9/BFgyXelMId51hUMHX282u/vkePrSetObGMA1pdzVSMF7UpfgMxUCQg6DbpoFPD7ZiP6y7mbgdY1p0NSu9S/jqQJ2DDAwiKaqhrBslY9piWJqGd7pPCuZkmp9d8dkekWgKV5+jcEPVOYn8WurGvz1f/uYihyxD3w2KSCeJ4N6f4wmX/hASNfp3oZ161Oqi0Sog89lC088/ocS86mShazd0Gg3g1YiVAz9FrqMqLUW1vqkjMekqlGZ5qQbVGu/u8ibakomjMfTMWloEhh6DhzctK1mupJRh5mzyszfN/I9jU+fVrqx1MTY76N/gqiKZtBwIe63aGec4HkxybMQmYK8NpR+mpDUfmEGZt+BY4Jk2MZw5CbD9mTpoJ1TCVcOXqkmMhyRnmOtq7DFXJfGqQ7lWpB860C3TtmA11vNlB/evWcr73Wk+xpYAAXmmFgHqNZ3eSq1euBy/hizWIbex84F6+AbrfyVVkB56IynXYwxudqANaVarfTGJuzMulftriCza+3KslbPxCBsgx6TnTV9Zn2fmVGTnsYMKfV+ANqVbFNY/upk6PH8wNPPI4H9PJYzS9YxH4jP4v5sUrkE+tOBEKRwVg/EAETQ2XzjuzECmgadJl2uN4hr2i6oeypyuKfjgb25koWa+LkOD0CWFmIzRvK+XdB4ZblZ9HrWU59e12Np+f8IHz/NhIGcZ+iusVeV0IFhJDYzmkx4QOqQrwtbfIWg0AtmFtqWFdg8p1dUiOG/QRgjBZgVi7NPpTJPSWK9AaZoHDJSHopBfIHzx3qcx1yDcpzkiPQ4leOtJ86/rVIKAiMVhdXpqvuFEi+PiWzkN3lFcV3e73SNhzk9rW0kd+MzclYvn8uc0EVSakM9Hy3hywKBsGeacLv2K34Z9ddwUurjwfESwOcexMh4UaWR4PwUrnQmPPgrNyJK9cCRX0+aQVdt+Dwi98FLtx9OM9Br9p+2t3wSrNCluRRZdOtfA2mEJEV4AkBHcug66YM6oDFSP05LEnnX2sIeKMBO1ifHxSBKJZl4fun2fXVltHjjKMf/SaYi0pBlsLQWXsSzu/8I1Cip6koj1l+0x049ug/guLtAnn1SPoRp0n/ns2Md5uN+Lcsipyp65T877eK0r42lSQupFNIIIpVRbhkhl2/1RdEX4oeLqL3KAq8ViPea7fgbc23AheWHQ+K3XfULFoE8PPRut32DHZMSR771IeXPZ88Xy8pKbJ7cASimGJE8PVizug0MyWCFhNEwY1P3RHv3qsh8W831LiuMJ2nxny7mG8ozGF/pOXk7TP3elw9KacwBBhuv4YBEF2dHSX6g/sfNB1teNw27ok8KuXV75BOZH0AkEzwRRNjjVt60+dXnUCIY4qDS4b3oDDsR8par3xAUUEIhcloZyYTPxffBYadQFOEdBJZbRfDpFjP03pHimdMeXPXwQCsLGfpsRaW4zBQ0UDw96IbUoTYgWDTW7MFb1ghQAgQd0iV9zSL4bfb++99DoSUBlUsaMdqfiAw3POEwJ2V6e0d8LMchCnwOzLp18xG9MoPj7iu7e0ahlJisCjjUCFPcxvHLX4GdBZrPJHPHMh15ZLp8p6dzxkF9uSCIk3n3q5QeChzppQAT1Mjop/Fs78MiKLA394KWqsj1m1oO/YhmErHAaMTgNELwDty4PKenbSigtXEUENu7wxbEPc2nYf6HRtBlSMgenqgtXoXiL09cGrrapD83jtFEboLVx4WAmGfB2q3vQD3f28LMDoerh/aB/mzHgPzqEoomLMQPvnJsymba1gIcIIRsqpmwdX9bwJRVeiqrQHH5P8HWQxCywd/hVELFqdsrmFzobKFKwBzGnBdOAN259TYry/ui2eh6JEnweaccqcoGXIOTXUQiyqJHQq9bddBbxsBhfOeiN03llTEOtHmMRNi36PX/s722DVCEAyqZMglXkoJNIXUBkWRDx5ctfjhZORNGdRBhob6f3aEh5RCYTh6oxMyAK2t0FUUWBhThEaIkPhzcBh8tEyuvtcc7NvQEFGG1BEbzuaukESARf1tqIb/1+Ce/6/EPU/g3wEAAP//XvcPAdxhbnQAAAAASUVORK5CYII='

function ProviderLogoIcon({ option }: { option: ModelProviderOption }) {
  const normalizedProvider = normalizedProviderId(option.provider)
  const providerLogoPath = providerLogoPathById[normalizedProvider]
  if (providerLogoPath) {
    return <SvgProviderLogo path={providerLogoPath} />
  }

  switch (normalizedProvider) {
    case 'ollama':
      return (
        <svg className="model-setup-dialog__provider-logo" viewBox="0 0 24 24">
          <path d="M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z" fill="currentColor" />
        </svg>
      )
    case 'openai':
      return (
        <svg className="model-setup-dialog__provider-logo" viewBox="0 0 24 24">
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" fill="currentColor" />
        </svg>
      )
    case 'openai-compatible':
      return (
        <svg className="model-setup-dialog__provider-logo" viewBox="0 0 32 32">
          <path d="M9.5 19.5 6.5 16l3-3.5M22.5 12.5l3 3.5-3 3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.7" />
          <path d="M13.25 22.5 18.75 9.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.7" />
          <path d="M5.5 24.5h21" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
        </svg>
      )
    case 'sglang':
      return <img alt="" className="model-setup-dialog__provider-logo" draggable={false} src={sglangLogoDataUri} />
    case 'vllm':
      return <SvgProviderLogo path={providerLogoPathById.vllm} />
    case 'xai':
      return (
        <svg className="model-setup-dialog__provider-logo" viewBox="0 0 466.04 516.93">
          <polygon fill="currentColor" points="0.12 182.71 234.14 516.92 338.15 516.92 104.13 182.71 0.12 182.71" />
          <polygon fill="currentColor" points="0 516.92 104.08 516.92 156.08 442.67 104.04 368.34 0 516.92" />
          <polygon fill="currentColor" points="466.04 0 361.96 0 182.1 256.86 234.15 331.18 466.04 0" />
          <polygon fill="currentColor" points="380.78 516.92 466.04 516.92 466.04 37.16 380.78 158.92 380.78 516.92" />
        </svg>
      )
    case 'zai':
      return (
        <svg className="model-setup-dialog__provider-logo" viewBox="0 0 30 30">
          <path d="M24.51,28.51H5.49c-2.21,0-4-1.79-4-4V5.49c0-2.21,1.79-4,4-4h19.03c2.21,0,4,1.79,4,4v19.03C28.51,26.72,26.72,28.51,24.51,28.51z" fill="#2d2d2d" stroke="#ffffff" strokeMiterlimit="10" strokeWidth="0.6317" />
          <path d="M15.47,7.1l-1.3,1.85c-0.2,0.29-0.54,0.47-0.9,0.47h-7.1V7.09C6.16,7.1,15.47,7.1,15.47,7.1z" fill="#ffffff" />
          <polygon fill="#ffffff" points="24.3,7.1 13.14,22.91 5.7,22.91 16.86,7.1" />
          <path d="M14.53,22.91l1.31-1.86c0.2-0.29,0.54-0.47,0.9-0.47h7.09v2.33H14.53z" fill="#ffffff" />
        </svg>
      )
    default:
      return <span className="model-setup-dialog__provider-letter">{providerFallbackInitial(option.label)}</span>
  }
}

function SvgProviderLogo({ path }: { path: string }) {
  return (
    <svg className="model-setup-dialog__provider-logo" viewBox="0 0 24 24">
      <path d={path} fill="currentColor" />
    </svg>
  )
}

function providerOptionIconClass(option: ModelProviderOption) {
  return `is-provider-${option.provider.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
}

function normalizedProviderId(provider: string) {
  const aliases: Record<string, string> = {
    'anthropic-vertex': 'anthropic',
    byteplus: 'bytedance',
    'byteplus-plan': 'bytedance',
    'cloudflare-ai-gateway': 'cloudflare',
    'copilot-proxy': 'github',
    'github-copilot': 'githubcopilot',
    'google-gemini-cli': 'google',
    kimi: 'moonshotai',
    'kimi-coding': 'moonshotai',
    'microsoft-foundry': 'alibabacloud',
    'minimax-portal': 'minimax',
    mistral: 'mistralai',
    modelstudio: 'alibabacloud',
    moonshot: 'moonshotai',
    'openai-codex': 'openai',
    qianfan: 'baidu',
    'vercel-ai-gateway': 'vercel',
    volcengine: 'bytedance',
    'volcengine-plan': 'bytedance',
  }
  return aliases[provider] ?? provider
}

function providerFallbackInitial(label: string) {
  const trimmed = label.trim()
  return trimmed ? trimmed.slice(0, 2).toUpperCase() : 'AI'
}

function builtInProviderHint(provider: string, _transport: string): Record<SettingsLanguage, string> {
  const fallback = providerLabel(provider)
  const hints: Record<string, Record<SettingsLanguage, string>> = {
    'amazon-bedrock': {
      'zh-CN': '连接 AWS Bedrock，适合在企业云环境中使用 Claude 等托管模型。',
      en: 'Connect AWS Bedrock for managed models such as Claude in enterprise cloud environments.',
    },
    anthropic: {
      'zh-CN': '直接连接 Anthropic 官方 API，使用 Claude 系列模型。',
      en: 'Connect directly to the official Anthropic API for Claude models.',
    },
    'anthropic-vertex': {
      'zh-CN': '通过 Google Vertex AI 运行 Claude，适合已有 GCP 配置的团队。',
      en: 'Run Claude through Google Vertex AI when your team already uses GCP.',
    },
    'azure-openai': {
      'zh-CN': '连接 Azure OpenAI 资源，使用你的部署名选择模型。',
      en: 'Connect Azure OpenAI resources and select models by deployment name.',
    },
    bedrock: {
      'zh-CN': '连接 AWS Bedrock，使用配置的区域和模型 ID。',
      en: 'Connect AWS Bedrock with your configured region and model ID.',
    },
    byteplus: {
      'zh-CN': '连接 BytePlus Ark 国际站，使用 Doubao 和托管第三方模型。',
      en: 'Connect BytePlus Ark global endpoints for Doubao and hosted third-party models.',
    },
    'byteplus-plan': {
      'zh-CN': '连接 BytePlus 规划通道，适合代码规划和推理任务。',
      en: 'Connect the BytePlus planning channel for coding plans and reasoning tasks.',
    },
    chutes: {
      'zh-CN': '连接 Chutes 云端推理平台，使用托管开源大模型。',
      en: 'Connect the Chutes inference cloud for hosted open-weight models.',
    },
    'cloudflare-ai-gateway': {
      'zh-CN': '通过 Cloudflare AI Gateway 转发 Claude 请求，适合统一网关和审计。',
      en: 'Route Claude requests through Cloudflare AI Gateway for central gateway control and auditing.',
    },
    'copilot-proxy': {
      'zh-CN': '连接本地 Copilot proxy，复用 GitHub Copilot 模型访问。',
      en: 'Connect a local Copilot proxy to reuse GitHub Copilot model access.',
    },
    deepseek: {
      'zh-CN': '直接连接 DeepSeek API，使用聊天和推理模型。',
      en: 'Connect directly to DeepSeek for chat and reasoning models.',
    },
    'github-copilot': {
      'zh-CN': '使用 GitHub Copilot provider 访问 Copilot 可用模型。',
      en: 'Use the GitHub Copilot provider for models available through Copilot.',
    },
    google: {
      'zh-CN': '直接连接 Gemini API，使用 Google Gemini 系列模型。',
      en: 'Connect directly to the Gemini API for Google Gemini models.',
    },
    'google-gemini-cli': {
      'zh-CN': '复用 Gemini CLI provider，适合已经配置 CLI 的本机环境。',
      en: 'Reuse the Gemini CLI provider when your local CLI environment is already configured.',
    },
    huggingface: {
      'zh-CN': '连接 Hugging Face Router，使用托管开源模型。',
      en: 'Connect Hugging Face Router for hosted open-weight models.',
    },
    kilocode: {
      'zh-CN': '连接 Kilo Code 网关，使用面向代码任务的模型。',
      en: 'Connect the Kilo Code gateway for coding-oriented models.',
    },
    kimi: {
      'zh-CN': '连接 Moonshot API，使用 Kimi 代码和推理模型。',
      en: 'Connect the Moonshot API for Kimi coding and reasoning models.',
    },
    'kimi-coding': {
      'zh-CN': '连接 Kimi Coding 通道，面向代码任务优化。',
      en: 'Connect the Kimi Coding channel optimized for coding tasks.',
    },
    litellm: {
      'zh-CN': '连接你自己的 LiteLLM 网关，用一个入口转发多家模型。',
      en: 'Connect your LiteLLM gateway to route multiple model providers through one endpoint.',
    },
    'microsoft-foundry': {
      'zh-CN': '连接 Azure AI Foundry 或 Azure OpenAI 资源，使用部署模型。',
      en: 'Connect Azure AI Foundry or Azure OpenAI resources for deployed models.',
    },
    minimax: {
      'zh-CN': '连接 MiniMax 国际或国内 Anthropic 兼容端点，使用 M 系列模型。',
      en: 'Connect MiniMax global or CN Anthropic-compatible endpoints for M-series models.',
    },
    'minimax-portal': {
      'zh-CN': '连接 MiniMax Portal 通道，适合门户侧模型和凭证配置。',
      en: 'Connect the MiniMax Portal channel for portal-managed models and credentials.',
    },
    mistral: {
      'zh-CN': '直接连接 Mistral API，使用 Mistral 和 Magistral 模型。',
      en: 'Connect directly to Mistral for Mistral and Magistral models.',
    },
    modelstudio: {
      'zh-CN': '连接阿里云百炼 DashScope 国内/国际、标准/编码订阅端点，使用 Qwen 模型。',
      en: 'Connect Alibaba Cloud Model Studio DashScope CN/global standard or coding-plan endpoints for Qwen models.',
    },
    moonshot: {
      'zh-CN': '连接 Moonshot .ai 或 .cn 兼容端点，使用 Kimi 系列模型。',
      en: 'Connect Moonshot .ai or .cn compatible endpoints for Kimi models.',
    },
    nvidia: {
      'zh-CN': '连接 NVIDIA NIM API，使用 NVIDIA 托管推理模型。',
      en: 'Connect NVIDIA NIM APIs for NVIDIA-hosted inference models.',
    },
    ollama: {
      'zh-CN': '连接本机或远程 Ollama，使用本地模型或 Ollama 云端模型。',
      en: 'Connect local or remote Ollama for local models or Ollama cloud models.',
    },
    openai: {
      'zh-CN': '直接连接 OpenAI Responses API，使用 GPT 系列模型。',
      en: 'Connect directly to the OpenAI Responses API for GPT models.',
    },
    'openai-codex': {
      'zh-CN': '使用 OpenAI Codex Responses 接口，面向代码任务。',
      en: 'Use the OpenAI Codex Responses interface for coding tasks.',
    },
    'openai-compatible': {
      'zh-CN': '连接兼容 OpenAI 的服务，适合自建网关和本地推理服务。',
      en: 'Connect OpenAI-compatible services such as self-hosted gateways and local inference servers.',
    },
    opencode: {
      'zh-CN': '连接 OpenCode Zen 网关，使用其聚合的代码模型。',
      en: 'Connect the OpenCode Zen gateway for its aggregated coding models.',
    },
    'opencode-go': {
      'zh-CN': '连接 OpenCode Go 网关，使用更轻量的代码模型路由。',
      en: 'Connect the OpenCode Go gateway for lighter coding-model routing.',
    },
    openrouter: {
      'zh-CN': '连接 OpenRouter 聚合网关，用一个 Key 选择多家模型。',
      en: 'Connect OpenRouter to choose models from many providers with one key.',
    },
    qianfan: {
      'zh-CN': '连接百度智能云千帆，使用文心等模型。',
      en: 'Connect Baidu Qianfan for ERNIE and related models.',
    },
    sglang: {
      'zh-CN': '连接本机或远程 SGLang 服务，适合自托管推理。',
      en: 'Connect local or remote SGLang services for self-hosted inference.',
    },
    synthetic: {
      'zh-CN': '连接 Synthetic 测试 provider，适合开发、演示和离线验证。',
      en: 'Connect the Synthetic test provider for development, demos, and offline validation.',
    },
    together: {
      'zh-CN': '连接 Together AI，使用托管开源模型。',
      en: 'Connect Together AI for hosted open-weight models.',
    },
    venice: {
      'zh-CN': '连接 Venice API，使用其开放模型目录。',
      en: 'Connect the Venice API for models from its open catalog.',
    },
    'vercel-ai-gateway': {
      'zh-CN': '通过 Vercel AI Gateway 统一转发多家模型。',
      en: 'Route multiple model providers through Vercel AI Gateway.',
    },
    vllm: {
      'zh-CN': '连接本机或远程 vLLM 服务，适合 OpenAI 兼容自托管模型。',
      en: 'Connect local or remote vLLM services for OpenAI-compatible self-hosted models.',
    },
    volcengine: {
      'zh-CN': '连接火山引擎 Ark 国内站，使用 Doubao 等模型。',
      en: 'Connect Volcengine Ark China endpoints for Doubao and related models.',
    },
    'volcengine-plan': {
      'zh-CN': '连接火山引擎规划通道，适合代码规划和推理任务。',
      en: 'Connect the Volcengine planning channel for coding plans and reasoning tasks.',
    },
    xai: {
      'zh-CN': '直接连接 xAI API，使用 Grok 系列模型。',
      en: 'Connect directly to the xAI API for Grok models.',
    },
    xiaomi: {
      'zh-CN': '连接小米 MiMo 按量 API 或 Token Plan，使用 MiMo V2 / V2.5 系列模型。',
      en: 'Connect Xiaomi MiMo pay-as-you-go API or Token Plan for MiMo V2 / V2.5 models.',
    },
    zai: {
      'zh-CN': '连接 z.ai / 智谱国内或国际、标准或编码订阅端点，使用 GLM 系列模型。',
      en: 'Connect z.ai / BigModel CN or global standard and coding-plan endpoints for GLM models.',
    },
  }
  return hints[provider] ?? {
    'zh-CN': `连接 ${fallback}，使用该 provider 提供的模型。`,
    en: `Connect ${fallback} for models provided by that provider.`,
  }
}

function defaultBuiltInProviderAuthMethod(
  provider: string,
  authMethods: string[],
  authEnvVars: string[],
): ModelProfileAuthMethod {
  return builtInProviderAuthMethods(provider, authMethods, authEnvVars)[0] ?? 'api-key'
}

function builtInProviderAuthMethods(
  provider: string,
  authMethods: string[],
  authEnvVars: string[],
): ModelProfileAuthMethod[] {
  if (provider === 'ollama' || provider === 'sglang' || provider === 'vllm') {
    return ['local', 'api-key']
  }
  const normalizedMethods = authMethods
    .map(modelProfileAuthMethodFromDescriptor)
    .filter((method): method is ModelProfileAuthMethod => Boolean(method))
  const allowedMethods = Array.from(new Set(normalizedMethods))
  if (allowedMethods.length > 0) {
    return allowedMethods
  }
  if (authEnvVars.length > 0) {
    return ['api-key']
  }
  return ['api-key']
}

function modelProfileAuthMethodFromDescriptor(method: string): ModelProfileAuthMethod | null {
  const normalized = method.toLowerCase()
  if (normalized === 'local') {
    return 'local'
  }
  if (normalized === 'custom') {
    return 'api-key'
  }
  if (
    normalized === 'api-key'
    || normalized.includes('api')
    || normalized.includes('token')
    || normalized === 'cn'
    || normalized === 'global'
    || normalized.startsWith('coding-')
  ) {
    return 'api-key'
  }
  return null
}

function baseUrlForSetupChoice(provider: string, method: string, value: string) {
  const byChoiceId: Record<string, string> = {
    'minimax-global-api': 'https://api.minimax.io/anthropic',
    'minimax-cn-api': 'https://api.minimaxi.com/anthropic',
    'modelstudio-standard-api-key-cn': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'modelstudio-standard-api-key': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    'modelstudio-api-key-cn': 'https://coding.dashscope.aliyuncs.com/v1',
    'modelstudio-api-key': 'https://coding-intl.dashscope.aliyuncs.com/v1',
    'moonshot-api-key': 'https://api.moonshot.ai/v1',
    'moonshot-api-key-cn': 'https://api.moonshot.cn/v1',
    'zai-api-key': 'https://api.z.ai/api/paas/v4',
    'zai-coding-global': 'https://api.z.ai/api/coding/paas/v4',
    'zai-coding-cn': 'https://open.bigmodel.cn/api/coding/paas/v4',
    'zai-global': 'https://api.z.ai/api/paas/v4',
    'zai-cn': 'https://open.bigmodel.cn/api/paas/v4',
    'xiaomi-api-key': 'https://api.xiaomimimo.com/v1',
  }
  if (byChoiceId[value]) {
    return byChoiceId[value]
  }
  const normalizedMethod = method.toLowerCase()
  if (provider === 'minimax' && normalizedMethod === 'api-global') {
    return byChoiceId['minimax-global-api']
  }
  if (provider === 'minimax' && normalizedMethod === 'api-cn') {
    return byChoiceId['minimax-cn-api']
  }
  return ''
}

function setupChoiceRequiresBaseUrl(provider: string, method: string, value: string) {
  return provider === 'xiaomi' && (method === 'token-plan' || value === 'xiaomi-token-plan')
}

function builtInProviderBaseUrl(provider: string) {
  const baseUrls: Record<string, string> = {
    'amazon-bedrock': 'https://bedrock-runtime.us-east-1.amazonaws.com',
    'anthropic-vertex': 'https://aiplatform.googleapis.com',
    byteplus: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    'byteplus-plan': 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
    'cloudflare-ai-gateway': 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic',
    kimi: 'https://api.moonshot.ai/v1',
    'kimi-coding': 'https://api.moonshot.ai/v1',
    modelstudio: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    moonshot: 'https://api.moonshot.ai/v1',
    chutes: 'https://llm.chutes.ai/v1',
    'copilot-proxy': 'http://127.0.0.1:4141/v1',
    deepseek: 'https://api.deepseek.com/v1',
    huggingface: 'https://router.huggingface.co/v1',
    kilocode: 'https://api.kilo.ai/api/gateway',
    litellm: 'http://localhost:4000/v1',
    'microsoft-foundry': 'https://<resource-name>.openai.azure.com/openai/v1',
    minimax: 'https://api.minimax.io/anthropic',
    mistral: 'https://api.mistral.ai/v1',
    nvidia: 'https://integrate.api.nvidia.com/v1',
    ollama: 'http://127.0.0.1:11434',
    opencode: 'https://opencode.ai/zen/v1',
    'opencode-go': 'https://opencode.ai/zen/go/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    qianfan: 'https://qianfan.baidubce.com/v2',
    sglang: 'http://127.0.0.1:30000/v1',
    synthetic: 'https://api.synthetic.new/anthropic',
    together: 'https://api.together.xyz/v1',
    venice: 'https://api.venice.ai/api/v1',
    'vercel-ai-gateway': 'https://ai-gateway.vercel.sh',
    volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
    vllm: 'http://127.0.0.1:8000/v1',
    xai: 'https://api.x.ai/v1',
    xiaomi: 'https://api.xiaomimimo.com/v1',
    zai: 'https://api.z.ai/api/coding/paas/v4',
  }
  return baseUrls[provider] ?? ''
}

function builtInProviderRequiresBaseUrl(provider: string, transport: string) {
  return !(
    (provider === 'anthropic' && transport === 'anthropic-messages')
    || (provider === 'github-copilot' && transport === 'github-copilot')
    || (provider === 'google' && transport === 'google-generative-ai')
    || (provider === 'ollama' && transport === 'ollama')
    || ((provider === 'openai' || provider === 'openai-codex') && transport.includes('openai'))
  )
}

function shouldShowBaseUrlField(
  option: ModelProviderOption,
  setupOption?: ModelProviderSetupOption,
) {
  return option.source === 'custom'
    || Boolean(setupOption?.requiresBaseUrl)
    || configurableBaseUrlProviders.has(option.provider)
    || (option.requiresBaseUrl && !option.defaultBaseUrl)
}

function baseUrlPlaceholder(
  option: ModelProviderOption,
  setupOption?: ModelProviderSetupOption,
) {
  return setupOption?.baseUrlPlaceholder || option.defaultBaseUrl || 'https://api.example.com/v1'
}

function draftFromProviderOption(
  option: ModelProviderOption,
  current?: ModelSetupDraft,
): ModelSetupDraft {
  const model = current?.model && current.provider === option.provider ? current.model : option.defaultModel
  const setupOption = option.setupOptions[0]
  return {
    source: option.source,
    provider: option.provider,
    setupOptionValue: setupOption?.value ?? '',
    baseUrl: setupOption?.requiresBaseUrl ? setupOption.baseUrl : setupOption?.baseUrl || option.defaultBaseUrl,
    api: option.defaultApi,
    apiKey: '',
    authMethod: setupOption?.authMethod ?? option.defaultAuthMethod,
    model,
    label: current?.label && current.provider === option.provider ? current.label : modelProfileLabel(option, model),
  }
}

function modelProfileLabel(option: ModelProviderOption, model: string) {
  return `${option.label} ${model}`
}

function modelChoicesForProvider(
  option: ModelProviderOption,
  setupOption?: ModelProviderSetupOption,
) {
  if (setupOption?.modelChoices?.length) {
    return setupOption.modelChoices
  }
  const candidates = [
    option.defaultModel,
    ...option.modelChoices,
  ]
  return Array.from(new Set(candidates.map((model) => model.trim()).filter(Boolean)))
}

function canContinueModelSetupStep(
  step: ModelSetupStep,
  draft: ModelSetupDraft,
  option: ModelProviderOption,
  setupOption?: ModelProviderSetupOption,
) {
  if (step === 0) {
    return Boolean(draft.source && draft.provider)
  }
  if (step === 1) {
    const hasBaseUrl = !shouldShowBaseUrlField(option, setupOption) || Boolean(draft.baseUrl.trim())
    const hasCredential = draft.authMethod === 'local' || Boolean(draft.apiKey.trim())
    return Boolean(draft.provider && hasBaseUrl && hasCredential)
  }
  if (step === 2) {
    return Boolean(draft.model.trim() && draft.label.trim())
  }
  return true
}

function modelProfileInputFromDraft(draft: ModelSetupDraft): ModelProfileSetupInput {
  return {
    source: draft.source,
    provider: draft.provider.trim(),
    model: draft.model.trim(),
    label: draft.label.trim(),
    ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}),
    ...(draft.api.trim() ? { api: draft.api.trim() } : {}),
    ...(draft.authMethod ? { authMethod: draft.authMethod } : {}),
    ...(draft.authMethod !== 'local' && draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
  }
}

function apiAdapterOptions(option: ModelProviderOption) {
  const options = [
    option.defaultApi,
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
    'ollama',
  ].filter((api): api is string => Boolean(api))
  return Array.from(new Set(options))
}

function authMethodLabel(language: SettingsLanguage, method: ModelProfileAuthMethod) {
  if (language === 'en') {
    return method === 'local' ? 'Local / No key' : 'API key / Token'
  }
  return method === 'local' ? '本地 / 无密钥' : 'API key / Token'
}

function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    'amazon-bedrock': 'Amazon Bedrock',
    anthropic: 'Anthropic',
    'anthropic-vertex': 'Anthropic Vertex',
    byteplus: 'BytePlus Ark (Global)',
    'byteplus-plan': 'BytePlus Plan',
    chutes: 'Chutes',
    'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
    'copilot-proxy': 'Copilot Proxy',
    deepseek: 'DeepSeek',
    'github-copilot': 'GitHub Copilot',
    google: 'Google Gemini',
    'google-gemini-cli': 'Google Gemini CLI',
    huggingface: 'Hugging Face',
    kilocode: 'Kilo Code',
    kimi: 'Kimi',
    'kimi-coding': 'Kimi Coding',
    litellm: 'LiteLLM',
    'microsoft-foundry': 'Microsoft Foundry',
    minimax: 'MiniMax (Global / CN)',
    'minimax-portal': 'MiniMax Portal',
    mistral: 'Mistral',
    modelstudio: 'Qwen Model Studio',
    moonshot: 'Moonshot / Kimi',
    nvidia: 'NVIDIA',
    ollama: 'Ollama',
    openai: 'OpenAI',
    'openai-codex': 'OpenAI Codex',
    opencode: 'OpenCode',
    'opencode-go': 'OpenCode Go',
    openrouter: 'OpenRouter',
    qianfan: 'Qianfan',
    sglang: 'SGLang',
    synthetic: 'Synthetic',
    together: 'Together AI',
    venice: 'Venice',
    'vercel-ai-gateway': 'Vercel AI Gateway',
    vllm: 'vLLM',
    volcengine: 'Volcengine Ark (CN)',
    'volcengine-plan': 'Volcengine Plan',
    xai: 'xAI',
    xiaomi: 'Xiaomi MiMo',
    zai: 'z.ai / GLM',
  }
  if (labels[provider]) {
    return labels[provider]
  }
  return provider
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return ''
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function arrayRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return Array.isArray(value) ? value.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item)) : []
}

function arrayStringRecordValue(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
