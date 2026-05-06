<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NAlert,
  NAvatar,
  NButton,
  NCard,
  NDivider,
  NEllipsis,
  NEmpty,
  NIcon,
  NInput,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NTabPane,
  NTabs,
  NText,
  useMessage,
} from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import {
  BookOutline,
  CreateOutline,
  DocumentTextOutline,
  RefreshOutline,
  SaveOutline,
  SparklesOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/utils/format'
import { renderSimpleMarkdown } from '@/utils/markdown'
import { useMemoryStore } from '@/stores/memory'
import { useMemoryRuntimeStore } from '@/stores/memory-runtime'
import type { MemoryExperienceOutboxStatus } from '@/api/types'

type DocGroupKey = 'role' | 'runtime' | 'memory' | 'other'
type DocRisk = 'high' | 'normal'

type DocMeta = {
  label: string
  group: DocGroupKey
  descriptionKey: string
  risk: DocRisk
}

type DocEntry = {
  name: string
  path: string
  missing: boolean
  size?: number
  updatedAtMs?: number
  label: string
  group: DocGroupKey
  description: string
  risk: DocRisk
}

type Snippet = {
  label: string
  content: string
}

const DOC_META_MAP: Record<string, DocMeta> = {
  'AGENTS.md': {
    label: 'AGENTS',
    group: 'role',
    descriptionKey: 'pages.memory.docs.AGENTS.description',
    risk: 'high',
  },
  'SOUL.md': {
    label: 'SOUL',
    group: 'role',
    descriptionKey: 'pages.memory.docs.SOUL.description',
    risk: 'high',
  },
  'IDENTITY.md': {
    label: 'IDENTITY',
    group: 'role',
    descriptionKey: 'pages.memory.docs.IDENTITY.description',
    risk: 'normal',
  },
  'USER.md': {
    label: 'USER',
    group: 'memory',
    descriptionKey: 'pages.memory.docs.USER.description',
    risk: 'normal',
  },
  'TOOLS.md': {
    label: 'TOOLS',
    group: 'runtime',
    descriptionKey: 'pages.memory.docs.TOOLS.description',
    risk: 'normal',
  },
  'HEARTBEAT.md': {
    label: 'HEARTBEAT',
    group: 'runtime',
    descriptionKey: 'pages.memory.docs.HEARTBEAT.description',
    risk: 'normal',
  },
  'BOOTSTRAP.md': {
    label: 'BOOTSTRAP',
    group: 'runtime',
    descriptionKey: 'pages.memory.docs.BOOTSTRAP.description',
    risk: 'high',
  },
  'MEMORY.md': {
    label: 'MEMORY',
    group: 'memory',
    descriptionKey: 'pages.memory.docs.MEMORY.description',
    risk: 'normal',
  },
  'memory.md': {
    label: 'memory',
    group: 'memory',
    descriptionKey: 'pages.memory.docs.MEMORY.description',
    risk: 'normal',
  },
}

const memoryStore = useMemoryStore()
const runtimeStore = useMemoryRuntimeStore()
const message = useMessage()
const { t } = useI18n()
const editorContent = ref('')
const isEditing = ref(false)
const activeTab = ref('overview')
const sessionSummaryAgent = ref('main')
const sessionSummarySessionId = ref('')
const sessionSummarySessionKey = ref('')

function isMemoryAliasName(name: string): boolean {
  return name.trim().toLowerCase() === 'memory.md'
}

function isSameDocName(left: string, right: string): boolean {
  if (left === right) return true
  return isMemoryAliasName(left) && isMemoryAliasName(right)
}

function shouldReplaceDoc(current: DocEntry, next: DocEntry): boolean {
  if (current.missing !== next.missing) return current.missing

  const currentUpdated = current.updatedAtMs || 0
  const nextUpdated = next.updatedAtMs || 0
  if (currentUpdated !== nextUpdated) return nextUpdated > currentUpdated

  const currentSize = current.size || 0
  const nextSize = next.size || 0
  if (currentSize !== nextSize) return nextSize > currentSize

  if (current.name === 'MEMORY.md') return false
  if (next.name === 'MEMORY.md') return true
  return false
}

interface AgentSelectOption extends SelectOption {
  agent: {
    id: string
    name?: string
    identity?: {
      name?: string
      emoji?: string
      avatar?: string
      avatarUrl?: string
    }
  }
}

const agentOptions = computed<AgentSelectOption[]>(() =>
  memoryStore.agents.map((agent) => ({
    label: agent.identity?.name || agent.name || agent.id,
    value: agent.id,
    agent: {
      id: agent.id,
      name: agent.name,
      identity: agent.identity,
    },
  }))
)

function renderAgentLabel(option: SelectOption) {
  const agentOption = option as AgentSelectOption
  const agent = agentOption.agent
  if (!agent) return option.label as string

  const identity = agent.identity
  const emoji = identity?.emoji
  const avatar = identity?.avatarUrl || identity?.avatar
  const name = identity?.name || agent.name || agent.id

  return h(
    NSpace,
    { align: 'center', size: 8 },
    {
      default: () => [
        emoji
          ? h('span', { style: 'font-size: 18px; line-height: 1;' }, emoji)
          : h(NAvatar, {
              round: true,
              size: 22,
              src: avatar || undefined,
              style: avatar ? undefined : 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);',
            }, { default: () => name.charAt(0).toUpperCase() }),
        h('span', null, name),
      ],
    }
  )
}

const docEntries = computed<DocEntry[]>(() => {
  const deduped = new Map<string, DocEntry>()
  for (const file of memoryStore.docFiles) {
    const meta = DOC_META_MAP[file.name]
    const entry: DocEntry = {
      name: file.name,
      path: file.path,
      missing: file.missing,
      size: file.size,
      updatedAtMs: file.updatedAtMs,
      label: meta?.label || file.name,
      group: meta?.group || 'other',
      description: meta?.descriptionKey ? t(meta.descriptionKey) : t('pages.memory.uncategorizedDoc'),
      risk: meta?.risk || 'normal',
    }
    const key = isMemoryAliasName(entry.name) ? 'memory.md' : entry.name
    const existing = deduped.get(key)
    if (!existing || shouldReplaceDoc(existing, entry)) {
      deduped.set(key, entry)
    }
  }
  return Array.from(deduped.values())
})

const groupedDocs = computed<Array<{ key: DocGroupKey; label: string; items: DocEntry[] }>>(() => {
  const groups: Record<DocGroupKey, DocEntry[]> = {
    role: [],
    runtime: [],
    memory: [],
    other: [],
  }
  for (const item of docEntries.value) {
    groups[item.group].push(item)
  }
  return (Object.keys(groups) as DocGroupKey[])
    .map((key) => ({
      key,
      label: t(`pages.memory.groups.${key}`),
      items: groups[key],
    }))
    .filter((group) => group.items.length > 0)
})

const loading = computed(
  () =>
    memoryStore.loadingAgents ||
    memoryStore.loadingFiles ||
    memoryStore.loadingFileContent ||
    runtimeStore.loadingOverview ||
    runtimeStore.loadingDurable ||
    runtimeStore.loadingExperience
)
const activeFile = computed(() => memoryStore.activeFile)
const activeDoc = computed<DocEntry | null>(() => {
  const selected = activeFile.value?.name || memoryStore.selectedFileName
  if (!selected) return null
  return docEntries.value.find((item) => isSameDocName(item.name, selected)) || null
})

const hasUnsavedChanges = computed(() => editorContent.value !== memoryStore.currentContent)
const charCount = computed(() => editorContent.value.length)
const lineCount = computed(() => (editorContent.value ? editorContent.value.split(/\r?\n/).length : 0))
const previewHtml = computed(() =>
  renderSimpleMarkdown(memoryStore.currentContent || '', {
    emptyHtml: `<p class="memory-markdown-empty">${t('pages.memory.emptyDocHtml')}</p>`,
  })
)

const fileStateLabel = computed(() => {
  if (!activeFile.value) return t('pages.memory.fileState.notLoaded')
  return activeFile.value.missing ? t('pages.memory.fileState.notCreated') : t('pages.memory.fileState.exists')
})

const fileStateType = computed<'warning' | 'success'>(() => {
  if (!activeFile.value || activeFile.value.missing) return 'warning'
  return 'success'
})

const fileUpdatedText = computed(() =>
  activeFile.value?.updatedAtMs ? formatDate(activeFile.value.updatedAtMs) : t('pages.memory.fileState.notCreated')
)

const fileSizeText = computed(() => formatBytes(activeFile.value?.size))

const docCount = computed(() => docEntries.value.length)
const highRiskDocCount = computed(() => docEntries.value.filter((item) => item.risk === 'high').length)
const overview = computed(() => runtimeStore.overview)
const providerTagType = computed<'success' | 'warning'>(() => runtimeStore.providerReady ? 'success' : 'warning')
const providerStateLabel = computed(() => {
  if (!overview.value) return t('pages.memory.runtime.state.unknown')
  return overview.value.provider.ready
    ? t('pages.memory.runtime.state.ready')
    : t('pages.memory.runtime.state.notReady')
})
const experienceStatusOptions = computed(() => [
  { label: t('pages.memory.runtime.filters.all'), value: '' },
  { label: t('pages.memory.runtime.status.active'), value: 'active' },
  { label: t('pages.memory.runtime.status.stale'), value: 'stale' },
  { label: t('pages.memory.runtime.status.superseded'), value: 'superseded' },
  { label: t('pages.memory.runtime.status.archived'), value: 'archived' },
])

const snippets = computed<Snippet[]>(() => {
  const fileName = memoryStore.selectedFileName
  const common = [
    {
      label: t('pages.memory.snippets.facts.label'),
      content: [
        `## ${t('pages.memory.snippets.facts.heading')}`,
        `- ${t('pages.memory.snippets.facts.items.background')}`,
        `- ${t('pages.memory.snippets.facts.items.decision')}`,
        `- ${t('pages.memory.snippets.facts.items.conclusion')}`,
      ].join('\n'),
    },
  ]

  if (fileName === 'AGENTS.md') {
    return [
      {
        label: t('pages.memory.snippets.principles.label'),
        content: [
          `## ${t('pages.memory.snippets.principles.heading')}`,
          `- ${t('pages.memory.snippets.principles.items.goal')}`,
          `- ${t('pages.memory.snippets.principles.items.constraints')}`,
          `- ${t('pages.memory.snippets.principles.items.prohibited')}`,
        ].join('\n'),
      },
      ...common,
    ]
  }

  if (fileName === 'SOUL.md') {
    return [
      {
        label: t('pages.memory.snippets.persona.label'),
        content: [
          `## ${t('pages.memory.snippets.persona.heading')}`,
          `- ${t('pages.memory.snippets.persona.items.tone')}`,
          `- ${t('pages.memory.snippets.persona.items.style')}`,
          `- ${t('pages.memory.snippets.persona.items.principles')}`,
        ].join('\n'),
      },
      ...common,
    ]
  }

  if (fileName === 'BOOTSTRAP.md') {
    return [
      {
        label: t('pages.memory.snippets.bootstrap.label'),
        content: [
          `## ${t('pages.memory.snippets.bootstrap.heading')}`,
          `- ${t('pages.memory.snippets.bootstrap.items.goal')}`,
          `- ${t('pages.memory.snippets.bootstrap.items.environment')}`,
          `- ${t('pages.memory.snippets.bootstrap.items.firstRun')}`,
        ].join('\n'),
      },
      ...common,
    ]
  }

  if (fileName === 'USER.md') {
    return [
      {
        label: t('pages.memory.snippets.userPreference.label'),
        content: [
          `## ${t('pages.memory.snippets.userPreference.heading')}`,
          `- ${t('pages.memory.snippets.userPreference.items.output')}`,
          `- ${t('pages.memory.snippets.userPreference.items.taboo')}`,
          `- ${t('pages.memory.snippets.userPreference.items.tone')}`,
        ].join('\n'),
      },
      ...common,
    ]
  }

  if (fileName === 'HEARTBEAT.md') {
    return [
      {
        label: t('pages.memory.snippets.heartbeat.label'),
        content: [
          `## ${t('pages.memory.snippets.heartbeat.heading')}`,
          `- [ ] ${t('pages.memory.snippets.heartbeat.items.dailyStatus')}`,
          `- [ ] ${t('pages.memory.snippets.heartbeat.items.cleanup')}`,
        ].join('\n'),
      },
      ...common,
    ]
  }

  return [
    {
      label: t('pages.memory.snippets.preferenceTemplate.label'),
      content: [
        `## ${t('pages.memory.snippets.preferenceTemplate.heading')}`,
        `- ${t('pages.memory.snippets.preferenceTemplate.items.outputStyle')}`,
        `- ${t('pages.memory.snippets.preferenceTemplate.items.disabled')}`,
        `- ${t('pages.memory.snippets.preferenceTemplate.items.pacing')}`,
      ].join('\n'),
    },
    {
      label: t('pages.memory.snippets.projectConventions.label'),
      content: [
        `## ${t('pages.memory.snippets.projectConventions.heading')}`,
        `- ${t('pages.memory.snippets.projectConventions.items.branching')}`,
        `- ${t('pages.memory.snippets.projectConventions.items.release')}`,
        `- ${t('pages.memory.snippets.projectConventions.items.verification')}`,
      ].join('\n'),
    },
    ...common,
  ]
})

watch(
  () => memoryStore.currentContent,
  (value) => {
    editorContent.value = value
  },
  { immediate: true }
)

watch(activeTab, (value) => {
  if (value === 'durable' && runtimeStore.durableDocuments.length === 0) {
    void runtimeStore.fetchDurableDocuments(50)
  }
  if (value === 'experience' && runtimeStore.experienceEntries.length === 0) {
    void runtimeStore.fetchExperienceOutbox({ limit: 50 })
  }
})

onMounted(async () => {
  try {
    await Promise.all([
      memoryStore.initialize(),
      runtimeStore.fetchOverview(),
    ])
  } catch (error) {
    message.warning(error instanceof Error ? error.message : t('pages.memory.messages.initFailed'))
  }
  document.addEventListener('click', handleCodeCopy)
})

onUnmounted(() => {
  document.removeEventListener('click', handleCodeCopy)
})

function handleCodeCopy(event: Event) {
  const target = event.target as HTMLElement
  const button = target.closest('.code-copy-btn') as HTMLButtonElement
  if (!button) return
  
  const code = button.dataset.code || ''
  navigator.clipboard.writeText(code).then(() => {
    button.classList.add('copied')
    button.title = 'Copied!'
    setTimeout(() => {
      button.classList.remove('copied')
      button.title = 'Copy code'
    }, 2000)
  }).catch((err) => {
    console.error('Failed to copy:', err)
  })
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatMaybeDate(value?: string | number | null): string {
  if (!value) return '-'
  if (typeof value === 'number') return formatDate(value)
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? formatDate(parsed) : value
}

function formatMs(value?: number): string {
  if (!value || value <= 0) return '-'
  if (value < 1000) return `${value} ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toFixed(1)} min`
  return `${(minutes / 60).toFixed(1)} h`
}

function confirmDiscardIfNeeded(): boolean {
  if (!isEditing.value || !hasUnsavedChanges.value) return true
  return window.confirm(t('pages.memory.messages.discardConfirm'))
}

function handleStartEdit() {
  isEditing.value = true
  editorContent.value = memoryStore.currentContent
}

function handleCancelEdit() {
  editorContent.value = memoryStore.currentContent
  isEditing.value = false
}

function handleResetEditor() {
  editorContent.value = memoryStore.currentContent
  message.info(t('pages.memory.messages.resetToLoaded'))
}

function appendSnippet(text: string) {
  if (!isEditing.value) {
    handleStartEdit()
  }
  const prefix = editorContent.value.trim() ? '\n\n' : ''
  editorContent.value = `${editorContent.value}${prefix}${text}`.trim()
}

function insertTodayTemplate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const dateText = `${now.getFullYear()}-${month}-${day}`
  appendSnippet(`## ${dateText}\n- `)
}

async function handleSwitchAgent(agentId: string) {
  if (!agentId || (agentId === memoryStore.selectedAgentId && activeFile.value)) return
  if (!confirmDiscardIfNeeded()) return
  try {
    isEditing.value = false
    await memoryStore.switchAgent(agentId)
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.memory.messages.switchAgentFailed'))
  }
}

async function handleSelectDoc(name: string) {
  if (!name || name === memoryStore.selectedFileName) return
  if (!confirmDiscardIfNeeded()) return
  try {
    isEditing.value = false
    await memoryStore.loadFile(name)
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.memory.messages.loadDocFailed'))
  }
}

async function handleRefresh() {
  if (!confirmDiscardIfNeeded()) return
  try {
    isEditing.value = false
    await memoryStore.refresh()
    message.success(t('pages.memory.messages.refreshed'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.memory.messages.refreshFailed'))
  }
}

async function handlePageRefresh() {
  if (activeTab.value === 'agentDocs') {
    await handleRefresh()
    return
  }
  try {
    await runtimeStore.refreshAll()
    message.success(t('pages.memory.messages.refreshed'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.memory.messages.refreshFailed'))
  }
}

async function handleFetchDurableDocuments() {
  await runtimeStore.fetchDurableDocuments(50)
}

async function handleExperienceStatusChange(value: string | null) {
  const status = value ? (value as MemoryExperienceOutboxStatus) : undefined
  await runtimeStore.fetchExperienceOutbox({
    ...(status ? { status } : {}),
    limit: 50,
  })
}

async function handleLoadSessionSummary() {
  const sessionId = sessionSummarySessionId.value.trim()
  if (!sessionId) {
    message.warning(t('pages.memory.runtime.session.sessionIdRequired'))
    return
  }
  await runtimeStore.fetchSessionSummary({
    agent: sessionSummaryAgent.value.trim() || undefined,
    sessionId,
  })
}

async function handleRefreshSessionSummary() {
  const sessionId = sessionSummarySessionId.value.trim()
  const sessionKey = sessionSummarySessionKey.value.trim()
  if (!sessionId || !sessionKey) {
    message.warning(t('pages.memory.runtime.session.refreshRequiresKey'))
    return
  }
  try {
    await runtimeStore.refreshSessionSummary({
      agent: sessionSummaryAgent.value.trim() || undefined,
      sessionId,
      sessionKey,
      force: true,
    })
    message.success(t('pages.memory.runtime.session.refreshStarted'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.memory.messages.refreshFailed'))
  }
}

async function handleSave() {
  if (!memoryStore.selectedAgentId || !memoryStore.selectedFileName) {
    message.warning(t('pages.memory.messages.selectAgentAndDocFirst'))
    return
  }
  if (activeDoc.value?.risk === 'high') {
    const confirmed = window.confirm(t('pages.memory.messages.saveHighRiskConfirm', { name: memoryStore.selectedFileName }))
    if (!confirmed) return
  }
  try {
    await memoryStore.saveFile(editorContent.value, memoryStore.selectedFileName)
    message.success(t('pages.memory.messages.saved'))
    isEditing.value = false
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('common.saveFailed'))
  }
}

function isActiveDoc(name: string): boolean {
  return isSameDocName(name, memoryStore.selectedFileName)
}
</script>

<template>
  <div class="memory-page">
    <NCard class="memory-hero" :bordered="false">
      <template #header>
        <div class="memory-hero-title">{{ t('pages.memory.title') }}</div>
      </template>
      <template #header-extra>
        <NSpace :size="8">
          <NButton size="small" :loading="loading" @click="handlePageRefresh">
            <template #icon><NIcon :component="RefreshOutline" /></template>
            {{ t('common.refresh') }}
          </NButton>
          <NButton v-if="activeTab === 'agentDocs' && !isEditing" size="small" type="primary" tertiary @click="handleStartEdit">
            <template #icon><NIcon :component="CreateOutline" /></template>
            {{ t('pages.memory.actions.edit') }}
          </NButton>
          <NButton v-else-if="activeTab === 'agentDocs'" size="small" @click="handleCancelEdit">
            {{ t('pages.memory.actions.cancelEdit') }}
          </NButton>
          <NButton v-if="activeTab === 'agentDocs' && isEditing" size="small" type="primary" :loading="memoryStore.saving" @click="handleSave">
            <template #icon><NIcon :component="SaveOutline" /></template>
            {{ t('pages.memory.actions.saveDoc') }}
          </NButton>
        </NSpace>
      </template>

      <NSpace vertical :size="10">
        <NAlert type="info" :show-icon="true" :bordered="false">
          {{ t('pages.memory.coveredDocsPrefix') }}
          <code>AGENTS</code>, <code>SOUL</code>, <code>IDENTITY</code>, <code>USER</code>, <code>TOOLS</code>, <code>HEARTBEAT</code>, <code>BOOTSTRAP</code>, <code>MEMORY</code>{{ t('pages.memory.coveredDocsSuffix') }}
        </NAlert>
        <NAlert v-if="memoryStore.lastError" type="warning" :show-icon="true" :bordered="false">
          {{ t('pages.memory.gatewayLimited', { error: memoryStore.lastError }) }}
        </NAlert>
        <NAlert v-if="runtimeStore.lastError" type="warning" :show-icon="true" :bordered="false">
          {{ t('pages.memory.runtime.gatewayLimited', { error: runtimeStore.lastError }) }}
        </NAlert>
      </NSpace>
    </NCard>

    <NTabs v-model:value="activeTab" class="memory-tabs" animated>
      <NTabPane name="overview" :tab="t('pages.memory.tabs.overview')">
        <NSpin :show="runtimeStore.loadingOverview">
          <section class="memory-runtime-grid">
            <NCard class="memory-card memory-runtime-card" :bordered="false">
              <template #header>{{ t('pages.memory.runtime.provider.title') }}</template>
              <template #header-extra>
                <NTag size="small" :type="providerTagType" :bordered="false" round>
                  {{ providerStateLabel }}
                </NTag>
              </template>
              <div class="memory-runtime-metric">
                <span>{{ t('pages.memory.runtime.provider.notebook') }}</span>
                <strong>{{ overview?.provider.notebookId || '-' }}</strong>
              </div>
              <div class="memory-runtime-kv">
                <span>{{ t('pages.memory.runtime.provider.profile') }}</span>
                <code>{{ overview?.provider.profile || '-' }}</code>
              </div>
              <div class="memory-runtime-kv">
                <span>{{ t('pages.memory.runtime.provider.lastValidated') }}</span>
                <span>{{ formatMaybeDate(overview?.provider.lastValidatedAt) }}</span>
              </div>
              <div class="memory-runtime-kv">
                <span>{{ t('pages.memory.runtime.provider.reason') }}</span>
                <span>{{ overview?.provider.reason || overview?.provider.details || '-' }}</span>
              </div>
            </NCard>

            <NCard class="memory-card memory-runtime-card" :bordered="false">
              <template #header>{{ t('pages.memory.runtime.durable.title') }}</template>
              <div class="memory-runtime-metric">
                <span>{{ t('pages.memory.runtime.durable.scopes') }}</span>
                <strong>{{ runtimeStore.durableScopeCount }}</strong>
              </div>
              <div class="memory-runtime-kv">
                <span>{{ t('pages.memory.runtime.durable.recent') }}</span>
                <span>{{ formatMaybeDate(overview?.durable.recentUpdatedAt) }}</span>
              </div>
              <div class="memory-runtime-kv">
                <span>{{ t('pages.memory.runtime.durable.notes') }}</span>
                <span>{{ overview?.durable.items.reduce((sum, item) => sum + item.noteCount, 0) ?? 0 }}</span>
              </div>
            </NCard>

            <NCard class="memory-card memory-runtime-card" :bordered="false">
              <template #header>{{ t('pages.memory.runtime.experience.title') }}</template>
              <div class="memory-runtime-metric">
                <span>{{ t('pages.memory.runtime.experience.visible') }}</span>
                <strong>{{ overview?.experience.visibleCount ?? 0 }}</strong>
              </div>
              <div class="memory-runtime-kv">
                <span>{{ t('pages.memory.runtime.experience.pendingSync') }}</span>
                <span>{{ runtimeStore.pendingExperienceSyncCount }}</span>
              </div>
              <div class="memory-runtime-status-row">
                <NTag size="small" type="success" :bordered="false">{{ t('pages.memory.runtime.status.active') }} {{ overview?.experience.statusCounts.active ?? 0 }}</NTag>
                <NTag size="small" type="warning" :bordered="false">{{ t('pages.memory.runtime.status.stale') }} {{ overview?.experience.statusCounts.stale ?? 0 }}</NTag>
                <NTag size="small" type="default" :bordered="false">{{ t('pages.memory.runtime.status.archived') }} {{ overview?.experience.statusCounts.archived ?? 0 }}</NTag>
              </div>
            </NCard>

            <NCard class="memory-card memory-runtime-card" :bordered="false">
              <template #header>{{ t('pages.memory.runtime.session.title') }}</template>
              <div class="memory-runtime-metric">
                <span>{{ t('pages.memory.runtime.session.enabled') }}</span>
                <strong>{{ overview?.sessionSummary.enabled ? t('common.enabled') : t('common.disabled') }}</strong>
              </div>
              <div class="memory-runtime-kv">
                <span>{{ t('pages.memory.runtime.session.initTokens') }}</span>
                <span>{{ overview?.sessionSummary.minTokensToInit ?? '-' }}</span>
              </div>
              <div class="memory-runtime-kv">
                <span>{{ t('pages.memory.runtime.session.maxWait') }}</span>
                <span>{{ formatMs(overview?.sessionSummary.maxWaitMs) }}</span>
              </div>
            </NCard>
          </section>
        </NSpin>
      </NTabPane>

      <NTabPane name="durable" :tab="t('pages.memory.tabs.durable')">
        <NCard class="memory-card" :bordered="false">
          <template #header>{{ t('pages.memory.runtime.durable.title') }}</template>
          <template #header-extra>
            <NButton size="small" :loading="runtimeStore.loadingDurable" @click="handleFetchDurableDocuments">
              <template #icon><NIcon :component="RefreshOutline" /></template>
              {{ t('common.refresh') }}
            </NButton>
          </template>
          <div v-if="runtimeStore.durableDocuments.length" class="memory-runtime-list">
            <div v-for="item in runtimeStore.durableDocuments" :key="item.id" class="memory-runtime-list-item">
              <div>
                <strong>{{ item.title || item.scopeKey }}</strong>
                <div class="memory-runtime-subtext">{{ item.scopeKey }} · {{ item.relativePath }}</div>
              </div>
              <NSpace :size="6" align="center">
                <NTag size="small" :bordered="false">{{ t('pages.memory.runtime.durable.noteCount', { count: item.noteCount }) }}</NTag>
                <NText depth="3">{{ formatMaybeDate(item.updatedAt) }}</NText>
              </NSpace>
            </div>
          </div>
          <NEmpty v-else :description="t('pages.memory.runtime.durable.empty')" />
        </NCard>
      </NTabPane>

      <NTabPane name="experience" :tab="t('pages.memory.tabs.experience')">
        <NCard class="memory-card" :bordered="false">
          <template #header>{{ t('pages.memory.runtime.experience.title') }}</template>
          <template #header-extra>
            <NSelect
              class="memory-runtime-filter"
              :value="runtimeStore.selectedExperienceStatus || ''"
              :options="experienceStatusOptions"
              size="small"
              @update:value="(value) => handleExperienceStatusChange(String(value || ''))"
            />
          </template>
          <div v-if="runtimeStore.experienceEntries.length" class="memory-runtime-list">
            <div v-for="item in runtimeStore.experienceEntries" :key="item.id" class="memory-runtime-list-item">
              <div>
                <strong>{{ item.title || item.id }}</strong>
                <div class="memory-runtime-subtext">
                  {{ item.summary || item.content || item.id }}
                </div>
              </div>
              <NSpace :size="6" align="center">
                <NTag size="small" :bordered="false">{{ t(`pages.memory.runtime.status.${item.status}`) }}</NTag>
                <NTag v-if="item.syncStatus" size="small" type="info" :bordered="false">{{ item.syncStatus }}</NTag>
              </NSpace>
            </div>
          </div>
          <NEmpty v-else :description="t('pages.memory.runtime.experience.empty')" />
        </NCard>
      </NTabPane>

      <NTabPane name="sessionSummary" :tab="t('pages.memory.tabs.sessionSummary')">
        <NCard class="memory-card" :bordered="false">
          <template #header>{{ t('pages.memory.runtime.session.title') }}</template>
          <div class="memory-session-controls">
            <NInput v-model:value="sessionSummaryAgent" :placeholder="t('pages.memory.runtime.session.agentPlaceholder')" />
            <NInput v-model:value="sessionSummarySessionId" :placeholder="t('pages.memory.runtime.session.sessionIdPlaceholder')" />
            <NInput v-model:value="sessionSummarySessionKey" :placeholder="t('pages.memory.runtime.session.sessionKeyPlaceholder')" />
            <NButton :loading="runtimeStore.loadingSessionSummary" @click="handleLoadSessionSummary">{{ t('pages.memory.runtime.session.load') }}</NButton>
            <NButton type="primary" tertiary :loading="runtimeStore.refreshingSessionSummary" @click="handleRefreshSessionSummary">{{ t('pages.memory.runtime.session.refresh') }}</NButton>
          </div>

          <div v-if="runtimeStore.sessionSummary" class="memory-session-summary">
            <div class="memory-meta-grid">
              <div class="memory-meta-item">
                <NText depth="3">{{ t('pages.memory.runtime.session.summaryPath') }}</NText>
                <code><NEllipsis>{{ runtimeStore.sessionSummary.summaryPath }}</NEllipsis></code>
              </div>
              <div class="memory-meta-item">
                <NText depth="3">{{ t('pages.memory.runtime.session.profile') }}</NText>
                <div>{{ runtimeStore.sessionSummary.profile || '-' }}</div>
              </div>
              <div class="memory-meta-item">
                <NText depth="3">{{ t('pages.memory.infoCard.updatedAt') }}</NText>
                <div>{{ formatMaybeDate(runtimeStore.sessionSummary.updatedAt) }}</div>
              </div>
              <div class="memory-meta-item">
                <NText depth="3">{{ t('pages.memory.runtime.session.state') }}</NText>
                <div>{{ runtimeStore.sessionSummary.state?.summaryInProgress ? t('pages.memory.runtime.session.inProgress') : t('pages.memory.runtime.session.idle') }}</div>
              </div>
            </div>
            <div class="memory-session-sections">
              <section v-for="section in Object.entries(runtimeStore.sessionSummary.sections)" :key="section[0]">
                <h4>{{ t(`pages.memory.runtime.session.sections.${section[0]}`) }}</h4>
                <p>{{ section[1] || '-' }}</p>
              </section>
            </div>
          </div>
          <NEmpty v-else :description="t('pages.memory.runtime.session.empty')" />
        </NCard>
      </NTabPane>

      <NTabPane name="agentDocs" :tab="t('pages.memory.tabs.agentDocs')">
      <div class="memory-toolbar">
        <NSelect
          :value="memoryStore.selectedAgentId"
          :options="agentOptions"
          :loading="memoryStore.loadingAgents"
          :placeholder="t('pages.memory.agentPlaceholder')"
          :render-label="renderAgentLabel"
          @update:value="(value) => handleSwitchAgent(String(value || ''))"
        />
        <div class="memory-stats-inline">
          <span>{{ t('pages.memory.stats.docsCount', { count: docCount }) }}</span>
          <span>{{ t('pages.memory.stats.highRiskCount', { count: highRiskDocCount }) }}</span>
          <span>{{ t('pages.memory.stats.currentDoc', { name: memoryStore.selectedFileName || '-' }) }}</span>
        </div>
        <NSpace :size="6">
          <NTag size="small" :type="fileStateType" :bordered="false" round>
            {{ fileStateLabel }}
          </NTag>
          <NTag v-if="activeDoc?.risk === 'high'" size="small" type="error" :bordered="false" round>
            {{ t('pages.memory.tags.highRisk') }}
          </NTag>
          <NTag v-if="isEditing && hasUnsavedChanges" size="small" type="warning" :bordered="false" round>
            {{ t('pages.memory.tags.unsaved') }}
          </NTag>
        </NSpace>
      </div>

    <section class="memory-layout">
      <NCard class="memory-card memory-nav-card" :bordered="false">
        <template #header>
          <NSpace :size="6" align="center">
            <NIcon :component="BookOutline" />
            <NText strong>{{ t('pages.memory.nav.title') }}</NText>
          </NSpace>
        </template>

        <div class="memory-doc-list">
          <template v-if="groupedDocs.length > 0">
            <section v-for="group in groupedDocs" :key="group.key" class="memory-doc-group">
              <header class="memory-doc-group-title">{{ group.label }}</header>
              <div class="memory-doc-items">
                <button
                  v-for="item in group.items"
                  :key="item.name"
                  type="button"
                  class="memory-doc-item"
                  :class="{ active: isActiveDoc(item.name) }"
                  @click="handleSelectDoc(item.name)"
                >
                  <div class="memory-doc-item-title">
                    <span>{{ item.label }}</span>
                    <NTag
                      size="small"
                      :bordered="false"
                    :type="item.missing ? 'warning' : 'success'"
                    class="memory-doc-item-state"
                  >
                      {{ item.missing ? t('pages.memory.fileState.notCreated') : t('pages.memory.fileState.exists') }}
                    </NTag>
                  </div>
                  <div class="memory-doc-item-name">{{ item.name }}</div>
                  <div class="memory-doc-item-desc">
                    <NEllipsis :line-clamp="1">{{ item.description }}</NEllipsis>
                  </div>
                </button>
              </div>
            </section>
          </template>
          <NEmpty v-else :description="t('pages.memory.emptyDocs')" />
        </div>
      </NCard>

      <div class="memory-main-column">
        <NCard class="memory-card" :bordered="false">
          <template #header>
            <div class="memory-main-header">
              <NSpace :size="6" align="center">
                <NIcon :component="DocumentTextOutline" />
                <NText strong>{{ activeDoc?.label || memoryStore.selectedFileName || t('pages.memory.noDocSelected') }}</NText>
                <NText depth="3">{{ memoryStore.selectedFileName || '-' }}</NText>
              </NSpace>
              <NText depth="3" style="font-size: 12px;">{{ t('pages.memory.editor.stats', { lines: lineCount, chars: charCount }) }}</NText>
            </div>
          </template>

          <template v-if="isEditing">
            <NInput
              v-model:value="editorContent"
              class="memory-editor"
              type="textarea"
              :autosize="{ minRows: 20, maxRows: 30 }"
              :placeholder="t('pages.memory.editor.placeholder')"
            />
            <div class="memory-editor-footer">
              <NText depth="3">{{ t('pages.memory.editor.saveHint') }}</NText>
              <NSpace :size="8">
                <NButton size="small" @click="handleResetEditor">{{ t('pages.memory.actions.restore') }}</NButton>
                <NButton size="small" @click="handleCancelEdit">{{ t('common.cancel') }}</NButton>
                <NButton size="small" type="primary" :loading="memoryStore.saving" @click="handleSave">{{ t('common.save') }}</NButton>
              </NSpace>
            </div>
          </template>

          <template v-else>
            <div class="memory-markdown" v-html="previewHtml"></div>
            <div class="memory-editor-footer">
              <NText depth="3">{{ t('pages.memory.readonlyHint') }}</NText>
              <NButton size="small" type="primary" tertiary @click="handleStartEdit">
                <template #icon><NIcon :component="CreateOutline" /></template>
                {{ t('pages.memory.actions.edit') }}
              </NButton>
            </div>
          </template>
        </NCard>

        <NCard class="memory-card" :bordered="false">
          <template #header>
            <NSpace :size="6" align="center">
              <NIcon :component="SparklesOutline" />
              <NText strong>{{ t('pages.memory.infoCard.title') }}</NText>
            </NSpace>
          </template>

          <div class="memory-meta-grid">
            <div class="memory-meta-item">
              <NText depth="3">{{ t('pages.memory.infoCard.workspace') }}</NText>
              <code><NEllipsis>{{ memoryStore.workspace || '-' }}</NEllipsis></code>
            </div>
            <div class="memory-meta-item">
              <NText depth="3">{{ t('pages.memory.infoCard.filePath') }}</NText>
              <code><NEllipsis>{{ activeDoc?.path || activeFile?.path || '-' }}</NEllipsis></code>
            </div>
            <div class="memory-meta-item">
              <NText depth="3">{{ t('pages.memory.infoCard.updatedAt') }}</NText>
              <div>{{ fileUpdatedText }}</div>
            </div>
            <div class="memory-meta-item">
              <NText depth="3">{{ t('pages.memory.infoCard.fileSize') }}</NText>
              <div>{{ fileSizeText }}</div>
            </div>
          </div>

          <NDivider title-placement="left">{{ t('pages.memory.snippets.title') }}</NDivider>
          <NSpace :size="6" wrap>
            <NButton
              v-for="snippet in snippets"
              :key="snippet.label"
              size="small"
              tertiary
              type="primary"
              @click="appendSnippet(snippet.content)"
            >
              {{ snippet.label }}
            </NButton>
            <NButton size="small" tertiary @click="insertTodayTemplate">{{ t('pages.memory.snippets.insertToday') }}</NButton>
          </NSpace>

          <NText depth="3" style="display: block; margin-top: 10px; font-size: 12px;">
            {{ t('pages.memory.snippets.footerHintPrefix') }} <code>memory/YYYY-MM-DD.md</code>{{ t('pages.memory.snippets.footerHintSuffix') }}
          </NText>
        </NCard>
      </div>
    </section>
      </NTabPane>
    </NTabs>
  </div>
</template>

<style scoped>
.memory-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.memory-hero {
  border-radius: var(--radius-lg);
  background:
    radial-gradient(circle at 84% 14%, rgba(24, 160, 88, 0.15), transparent 36%),
    linear-gradient(125deg, var(--bg-card), rgba(32, 128, 240, 0.08));
  border: 1px solid rgba(24, 160, 88, 0.14);
}

.memory-hero-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.memory-tabs {
  min-width: 0;
}

.memory-runtime-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.memory-runtime-card {
  min-height: 180px;
}

.memory-runtime-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.memory-runtime-metric span,
.memory-runtime-kv span:first-child {
  color: var(--text-secondary);
  font-size: 12px;
}

.memory-runtime-metric strong {
  font-size: 24px;
  line-height: 1.1;
}

.memory-runtime-kv {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  min-width: 0;
  margin-top: 8px;
  font-size: 13px;
}

.memory-runtime-kv code,
.memory-meta-item code {
  min-width: 0;
}

.memory-runtime-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.memory-runtime-filter {
  width: 160px;
}

.memory-runtime-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.memory-runtime-list-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
}

.memory-runtime-subtext {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.memory-session-controls {
  display: grid;
  grid-template-columns: minmax(140px, 180px) minmax(180px, 1fr) minmax(220px, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.memory-session-summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.memory-session-sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.memory-session-sections section {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
}

.memory-session-sections h4 {
  margin: 0 0 6px;
  font-size: 13px;
}

.memory-session-sections p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.memory-toolbar {
  margin-top: 10px;
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr auto;
  gap: 8px;
  align-items: center;
}

.memory-stats-inline {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  display: flex;
  gap: 14px;
  white-space: nowrap;
  overflow: auto;
}

.memory-layout {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.memory-main-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.memory-card {
  border-radius: var(--radius-lg);
}

.memory-nav-card {
  min-height: auto;
}

.memory-doc-list {
  max-height: none;
  overflow: visible;
  padding-right: 0;
}

.memory-doc-group + .memory-doc-group {
  margin-top: 14px;
}

.memory-doc-group-title {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
  padding-left: 2px;
}

.memory-doc-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.memory-doc-item {
  width: 100%;
  text-align: left;
  padding: 10px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: inherit;
  transition: all 0.18s ease;
  cursor: pointer;
}

.memory-doc-item:hover {
  border-color: rgba(32, 128, 240, 0.35);
  transform: translateY(-1px);
}

.memory-doc-item.active {
  border-color: rgba(32, 128, 240, 0.6);
  background: rgba(32, 128, 240, 0.08);
  box-shadow: inset 0 0 0 1px rgba(32, 128, 240, 0.24);
}

.memory-doc-item-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}

.memory-doc-item-state {
  flex-shrink: 0;
}

.memory-doc-item-name {
  font-size: 12px;
  margin-top: 2px;
  color: var(--text-secondary);
}

.memory-doc-item-desc {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.memory-main-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.memory-editor :deep(.n-input__textarea-el) {
  font-size: 13px;
  line-height: 1.55;
}

.memory-markdown {
  min-height: 460px;
  max-height: min(64vh, 760px);
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 14px;
  background: var(--bg-primary);
  font-size: 13.5px;
  line-height: 1.72;
  word-break: break-word;
  overflow-wrap: break-word;
}

.memory-markdown :deep(> :first-child) {
  margin-top: 0;
}

.memory-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

/* —— 标题 —— */
.memory-markdown :deep(h1),
.memory-markdown :deep(h2),
.memory-markdown :deep(h3),
.memory-markdown :deep(h4),
.memory-markdown :deep(h5),
.memory-markdown :deep(h6) {
  margin: 16px 0 4px;
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.memory-markdown :deep(h1) { font-size: 1.35em; }
.memory-markdown :deep(h2) { font-size: 1.18em; }
.memory-markdown :deep(h3) { font-size: 1.06em; }
.memory-markdown :deep(h4) { font-size: 1em; }
.memory-markdown :deep(h5),
.memory-markdown :deep(h6) { font-size: 0.94em; }

/* —— 段落 —— */
.memory-markdown :deep(p) {
  margin: 5px 0;
  line-height: 1.72;
}

/* —— 无序列表 —— */
.memory-markdown :deep(ul) {
  margin: 4px 0;
  padding-left: 1.1em;
  list-style: none;
}

.memory-markdown :deep(ul > li) {
  position: relative;
  margin: 2px 0;
  line-height: 1.72;
}

.memory-markdown :deep(ul > li::before) {
  content: '';
  position: absolute;
  left: -0.88em;
  top: 0.58em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--md-bullet-color);
}

/* 嵌套列表 */
.memory-markdown :deep(ul ul) {
  margin: 1px 0 1px 0.15em;
}

.memory-markdown :deep(ul ul > li::before) {
  width: 3.5px;
  height: 3.5px;
  background: transparent;
  border: 1px solid var(--md-bullet-nested-color);
  top: 0.62em;
}

/* 三级列表 */
.memory-markdown :deep(ul ul ul > li::before) {
  width: 3px;
  height: 3px;
  border: none;
  background: var(--md-bullet-nested-color);
  border-radius: 0;
}

/* —— 有序列表 —— */
.memory-markdown :deep(ol) {
  margin: 4px 0;
  padding-left: 1.5em;
  list-style-position: outside;
}

.memory-markdown :deep(ol > li) {
  margin: 2px 0;
  line-height: 1.72;
}

.memory-markdown :deep(ol > li::marker) {
  color: var(--md-bullet-color);
  font-size: 0.9em;
  font-weight: 500;
}

/* —— 链接 —— */
.memory-markdown :deep(a) {
  color: var(--link-color);
  text-decoration: none;
  font-weight: 500;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  transition: color 0.12s ease, text-decoration-color 0.12s ease;
  text-decoration-line: underline;
  text-decoration-color: var(--link-underline);
}

.memory-markdown :deep(a:hover) {
  color: var(--link-color-hover);
  text-decoration-color: var(--link-color-hover);
}

/* —— 引用块 —— */
.memory-markdown :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 2.5px solid var(--md-blockquote-border);
  border-radius: 0 4px 4px 0;
  background: var(--md-blockquote-bg);
}

.memory-markdown :deep(blockquote p) {
  margin: 2px 0;
  color: var(--text-secondary);
  font-size: 0.94em;
}

/* —— 代码 —— */
.memory-markdown :deep(pre) {
  margin: 6px 0;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--md-code-border);
  background: var(--md-pre-bg);
  overflow-x: auto;
  line-height: 1.52;
}

.memory-markdown :deep(code) {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 0.87em;
}

.memory-markdown :deep(p code),
.memory-markdown :deep(li code) {
  padding: 0.5px 4.5px;
  border-radius: 3px;
  border: 1px solid var(--md-code-border);
  background: var(--md-code-bg);
}

/* —— 代码块容器 —— */
.memory-markdown :deep(.code-block-container) {
  display: flex;
  position: relative;
  margin: 6px 0;
  border-radius: 6px;
  border: 1px solid var(--md-code-border);
  background: var(--md-pre-bg);
  overflow-x: auto;
}

.memory-markdown :deep(.code-block-container) pre {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  overflow: visible;
}

.memory-markdown :deep(.code-line-numbers) {
  display: flex;
  flex-direction: column;
  padding: 10px 8px;
  background: rgba(0, 0, 0, 0.03);
  border-right: 1px solid var(--md-code-border);
  text-align: right;
  user-select: none;
  min-width: 40px;
}

.memory-markdown :deep(.line-number) {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 0.87em;
  line-height: 1.52;
  color: var(--text-tertiary);
  padding: 0 4px;
}

.memory-markdown :deep(.code-content) {
  flex: 1;
  padding: 10px 12px;
  overflow-x: auto;
  min-width: 0;
}

.memory-markdown :deep(.code-content code) {
  display: block;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  font-size: 0.87em;
  line-height: 1.52;
  white-space: pre;
}

.memory-markdown :deep(.code-copy-btn) {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 4px 6px;
  border: 1px solid var(--md-code-border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.memory-markdown :deep(.code-block-container:hover .code-copy-btn) {
  opacity: 1;
}

.memory-markdown :deep(.code-copy-btn:hover) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.memory-markdown :deep(.code-copy-btn.copied) {
  color: var(--link-color);
}

/* —— 分割线 —— */
.memory-markdown :deep(hr) {
  border: 0;
  height: 1px;
  background: var(--border-color);
  margin: 10px 0;
}

/* —— 加粗/强调 —— */
.memory-markdown :deep(strong) {
  font-weight: 600;
}

.memory-markdown :deep(em) {
  font-style: italic;
}

.memory-markdown-empty {
  color: var(--text-secondary);
}

.memory-editor-footer {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.memory-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.memory-meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.memory-meta-item code {
  display: inline-block;
  min-width: 0;
}

@media (max-width: 1200px) {
  .memory-runtime-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .memory-session-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .memory-layout {
    grid-template-columns: 1fr;
  }

  .memory-nav-card {
    min-height: auto;
  }

  .memory-doc-list {
    max-height: none;
  }

  .memory-main-column {
    max-height: none;
  }
}

@media (max-width: 1024px) {
  .memory-runtime-grid,
  .memory-session-controls,
  .memory-session-sections {
    grid-template-columns: 1fr;
  }

  .memory-runtime-list-item {
    grid-template-columns: 1fr;
  }

  .memory-toolbar {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .memory-stats-inline {
    gap: 10px;
  }

  .memory-main-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .memory-meta-grid {
    grid-template-columns: 1fr;
  }

  .memory-editor-footer {
    flex-direction: column;
    align-items: stretch;
  }
}

/* —— 暗色主题代码块适配 —— */
[data-theme='dark'] .memory-markdown :deep(.code-line-numbers) {
  background: rgba(255, 255, 255, 0.03);
}
</style>
