<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NInputNumber,
  NSelect,
  NSlider,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useWebSocketStore } from '@/stores/websocket'
import { useTTSSettings } from '@/composables/useTTSSettings'
import { useEdgeTTS } from '@/composables/useEdgeTTS'
import type { AgentInfo, Qwen3TtsProfile, VoiceOverviewResult } from '@/api/types'

const wsStore = useWebSocketStore()
const { t } = useI18n()
const message = useMessage()

const loading = ref(false)
const saving = ref(false)
const previewing = ref(false)
const uploading = ref(false)
const browserVoicesLoading = ref(false)
const overview = ref<VoiceOverviewResult | null>(null)
const agents = ref<AgentInfo[]>([])
const selectedProfileId = ref('')
const previewText = ref('你好，这是语音模块试听。')
const previewAgentId = ref<string | null>(null)
const previewAudioUrl = ref<string | null>(null)
const activeTab = ref('profiles')
const browserVoiceOptions = ref<{ label: string; value: string }[]>([])

const cloneDraft = ref({
  profileId: '',
  quality: 'clone' as 'clone-fast' | 'clone',
  refAudio: '',
  refText: '',
  language: 'zh',
  instructions: '',
})

const designDraft = ref({
  profileId: '',
  prompt: '',
  language: 'zh',
})

const dialogueDraft = ref({
  profileId: '',
  role: '',
  style: '',
  scene: '',
  notes: '',
  language: 'zh',
})

const {
  settings: playbackPrefs,
  resetSettings: resetPlaybackPrefs,
} = useTTSSettings()
const {
  speak: speakBrowserTts,
  stop: stopBrowserTts,
  isPlaying: browserTtsPlaying,
  isLoading: browserTtsLoading,
} = useEdgeTTS()

const qwen = computed(() => overview.value?.qwen3Tts ?? null)
const profileEntries = computed(() => Object.entries(qwen.value?.profiles ?? {}))
const profileOptions = computed(() =>
  profileEntries.value.map(([id]) => ({
    label: id === qwen.value?.defaultProfile ? `${id}（默认）` : id,
    value: id,
  })),
)
const agentOptions = computed(() =>
  agents.value.map((agent) => ({
    label: agent.name?.trim() || agent.id,
    value: agent.id,
  })),
)
const builtinVoiceOptions = computed(() =>
  (qwen.value?.builtinVoices ?? []).map((voice) => ({ label: voice, value: voice })),
)
const currentProfile = computed<Qwen3TtsProfile | null>(() => {
  const config = qwen.value
  if (!config || !selectedProfileId.value) {
    return null
  }
  return config.profiles[selectedProfileId.value] ?? null
})

function ensureSelectedProfile() {
  if (!qwen.value) {
    selectedProfileId.value = ''
    return
  }
  if (selectedProfileId.value && qwen.value.profiles[selectedProfileId.value]) {
    return
  }
  selectedProfileId.value = qwen.value.defaultProfile || Object.keys(qwen.value.profiles)[0] || ''
}

function revokePreviewAudioUrl() {
  if (previewAudioUrl.value) {
    URL.revokeObjectURL(previewAudioUrl.value)
    previewAudioUrl.value = null
  }
}

async function loadVoiceModule() {
  loading.value = true
  try {
    const [nextOverview, agentsList] = await Promise.all([
      wsStore.rpc.getVoiceOverview(),
      wsStore.rpc.listAgents(),
    ])
    overview.value = nextOverview
    agents.value = agentsList.agents
    ensureSelectedProfile()
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : t('pages.voiceModule.messages.loadFailed'),
    )
  } finally {
    loading.value = false
  }
}

function serializeProviderConfig() {
  const config = qwen.value
  if (!config) {
    throw new Error(t('pages.voiceModule.messages.providerUnavailable'))
  }
  return {
    enabled: config.enabled,
    runtime: config.runtime,
    autoStart: config.autoStart,
    baseUrl: config.baseUrl,
    healthPath: config.healthPath,
    defaultProfile: config.defaultProfile,
    voiceDirectory: config.voiceDirectory,
    agentProfiles: config.agentProfiles,
    profiles: config.profiles,
  }
}

async function saveVoiceConfig(successKey = 'pages.voiceModule.messages.saved') {
  if (!qwen.value) {
    return
  }
  saving.value = true
  try {
    await wsStore.rpc.patchConfig([
      { path: 'messages.tts.provider', value: 'qwen3-tts' },
      { path: 'messages.tts.providers.qwen3-tts', value: serializeProviderConfig() },
    ])
    message.success(t(successKey))
    await loadVoiceModule()
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('common.saveFailed'))
  } finally {
    saving.value = false
  }
}

function buildDialoguePrompt() {
  return [
    dialogueDraft.value.role ? `角色：${dialogueDraft.value.role}` : '',
    dialogueDraft.value.style ? `风格：${dialogueDraft.value.style}` : '',
    dialogueDraft.value.scene ? `场景：${dialogueDraft.value.scene}` : '',
    dialogueDraft.value.notes ? `补充要求：${dialogueDraft.value.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function createProfile(profileId: string, profile: Qwen3TtsProfile) {
  if (!qwen.value) {
    return
  }
  const normalizedId = profileId.trim()
  if (!normalizedId) {
    throw new Error(t('pages.voiceModule.messages.profileIdRequired'))
  }
  qwen.value.profiles[normalizedId] = profile
  selectedProfileId.value = normalizedId
}

async function savePresetProfile() {
  if (!currentProfile.value || !selectedProfileId.value) {
    return
  }
  await saveVoiceConfig()
}

async function saveCloneProfile() {
  if (!cloneDraft.value.profileId.trim() || !cloneDraft.value.refAudio || !cloneDraft.value.refText.trim()) {
    message.error(t('pages.voiceModule.messages.cloneFieldsRequired'))
    return
  }
  createProfile(cloneDraft.value.profileId, {
    source: 'clone',
    quality: cloneDraft.value.quality,
    refAudio: cloneDraft.value.refAudio,
    refText: cloneDraft.value.refText.trim(),
    language: cloneDraft.value.language.trim() || undefined,
    instructions: cloneDraft.value.instructions.trim() || undefined,
  })
  qwen.value!.defaultProfile = cloneDraft.value.profileId.trim()
  await saveVoiceConfig('pages.voiceModule.messages.cloneSaved')
}

async function saveDesignProfile() {
  if (!designDraft.value.profileId.trim() || !designDraft.value.prompt.trim()) {
    message.error(t('pages.voiceModule.messages.designFieldsRequired'))
    return
  }
  createProfile(designDraft.value.profileId, {
    source: 'design',
    prompt: designDraft.value.prompt.trim(),
    language: designDraft.value.language.trim() || undefined,
  })
  await saveVoiceConfig('pages.voiceModule.messages.designSaved')
}

async function saveDialogueProfile() {
  const prompt = buildDialoguePrompt()
  if (!dialogueDraft.value.profileId.trim() || !prompt.trim()) {
    message.error(t('pages.voiceModule.messages.dialogueFieldsRequired'))
    return
  }
  createProfile(dialogueDraft.value.profileId, {
    source: 'design',
    prompt,
    language: dialogueDraft.value.language.trim() || undefined,
  })
  await saveVoiceConfig('pages.voiceModule.messages.dialogueSaved')
}

function createNewPresetProfile() {
  const nextId = `preset-${Object.keys(qwen.value?.profiles ?? {}).length + 1}`
  createProfile(nextId, {
    source: 'preset',
    quality: 'balanced',
    voice: qwen.value?.builtinVoices[0] || 'vivian',
    language: 'Auto',
    instructions: 'natural, warm, expressive',
  })
}

function deleteCurrentProfile() {
  if (!qwen.value || !selectedProfileId.value) {
    return
  }
  if (selectedProfileId.value === qwen.value.defaultProfile) {
    message.error(t('pages.voiceModule.messages.cannotDeleteDefault'))
    return
  }
  delete qwen.value.profiles[selectedProfileId.value]
  for (const [agentId, profileId] of Object.entries(qwen.value.agentProfiles)) {
    if (profileId === selectedProfileId.value) {
      delete qwen.value.agentProfiles[agentId]
    }
  }
  ensureSelectedProfile()
}

async function previewSelectedProfile() {
  if (!selectedProfileId.value || !currentProfile.value || !previewText.value.trim()) {
    return
  }
  previewing.value = true
  revokePreviewAudioUrl()
  try {
    const result = await wsStore.rpc.previewQwen3Tts({
      text: previewText.value.trim(),
      profileId: selectedProfileId.value,
      draftProfile: currentProfile.value,
      agentId: previewAgentId.value || undefined,
    })
    const mimeType = result.outputFormat === 'wav' ? 'audio/wav' : 'audio/ogg'
    const buffer = Uint8Array.from(atob(result.audioBase64), (char) => char.charCodeAt(0))
    const blob = new Blob([buffer], { type: mimeType })
    previewAudioUrl.value = URL.createObjectURL(blob)
    await new Audio(previewAudioUrl.value).play()
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.voiceModule.messages.previewFailed'))
  } finally {
    previewing.value = false
  }
}

async function handleReferenceAudioPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  uploading.value = true
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        const commaIndex = result.indexOf(',')
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
      }
      reader.onerror = () => reject(reader.error ?? new Error('failed to read file'))
      reader.readAsDataURL(file)
    })
    const result = await wsStore.rpc.uploadQwen3TtsReferenceAudio({
      filename: file.name,
      audioBase64: base64,
    })
    cloneDraft.value.refAudio = result.storedPath
    if (!cloneDraft.value.profileId.trim()) {
      cloneDraft.value.profileId = result.filename.replace(/\.[^.]+$/u, '')
    }
    message.success(t('pages.voiceModule.messages.referenceUploaded'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.voiceModule.messages.uploadFailed'))
  } finally {
    input.value = ''
    uploading.value = false
  }
}

async function loadBrowserVoices() {
  browserVoicesLoading.value = true
  try {
    let voices = window.speechSynthesis.getVoices()
    if (voices.length === 0) {
      await new Promise<void>((resolve) => {
        const handleVoicesChanged = () => {
          window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged)
          resolve()
        }
        window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged)
        setTimeout(() => {
          window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged)
          resolve()
        }, 2000)
      })
      voices = window.speechSynthesis.getVoices()
    }
    browserVoiceOptions.value = voices.map((voice) => ({
      label: `${voice.name} (${voice.lang})`,
      value: voice.name,
    }))
  } finally {
    browserVoicesLoading.value = false
  }
}

async function previewBrowserPlayback() {
  if (browserTtsPlaying.value || browserTtsLoading.value) {
    stopBrowserTts()
    return
  }
  try {
    await speakBrowserTts(previewText.value, {
      voice: playbackPrefs.value.voice,
      rate: playbackPrefs.value.rate,
      volume: playbackPrefs.value.volume,
      pitch: playbackPrefs.value.pitch,
    })
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.voiceModule.messages.previewFailed'))
  }
}

onMounted(async () => {
  await Promise.all([loadVoiceModule(), loadBrowserVoices()])
})

onBeforeUnmount(() => {
  revokePreviewAudioUrl()
  stopBrowserTts()
})
</script>

<template>
  <NSpin :show="loading">
    <NSpace vertical :size="16">
      <NCard :title="t('routes.voiceModule')" class="app-card">
        <NSpace justify="space-between" align="start" wrap>
          <div>
            <NText strong>Qwen3-TTS</NText>
            <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
              <NTag :type="qwen?.health.ready ? 'success' : 'warning'">
                {{ qwen?.health.ready ? t('pages.voiceModule.status.ready') : t('pages.voiceModule.status.notReady') }}
              </NTag>
              <NTag>{{ t('pages.voiceModule.fields.runtime') }}：{{ qwen?.runtime || '-' }}</NTag>
              <NTag v-if="qwen?.managedRuntime">{{ t('pages.voiceModule.fields.managedRuntime') }}：{{ qwen.managedRuntime }}</NTag>
              <NTag>{{ t('pages.voiceModule.fields.activeProvider') }}：{{ overview?.activeProvider || '-' }}</NTag>
            </div>
          </div>
          <NSpace>
            <NButton @click="loadVoiceModule">{{ t('common.refresh') }}</NButton>
            <NButton type="primary" :loading="saving" @click="saveVoiceConfig()">{{ t('common.save') }}</NButton>
          </NSpace>
        </NSpace>
        <NAlert v-if="qwen?.health.error" type="warning" style="margin-top: 16px;">
          {{ qwen.health.error }}
        </NAlert>
      </NCard>

      <NAlert v-if="!qwen" type="error">
        {{ t('pages.voiceModule.messages.providerUnavailable') }}
      </NAlert>

      <template v-else>
      <NGrid cols="1 s:1 m:3" responsive="screen" :x-gap="16" :y-gap="16">
        <NGridItem>
          <NCard :title="t('pages.voiceModule.cards.runtime')" class="app-card">
            <NForm label-placement="top">
              <NFormItem :label="t('pages.voiceModule.fields.enabled')">
                <NSwitch v-model:value="qwen!.enabled" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.autoStart')">
                <NSwitch v-model:value="qwen!.autoStart" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.runtime')">
                <NSelect
                  v-model:value="qwen!.runtime"
                  :options="[
                    { label: 'mlx-audio', value: 'mlx-audio' },
                    { label: 'qwen-tts', value: 'qwen-tts' },
                    { label: 'vllm-omni', value: 'vllm-omni' },
                    { label: 'qwen3-tts.cpp', value: 'qwen3-tts.cpp' },
                  ]"
                />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.baseUrl')">
                <NInput v-model:value="qwen!.baseUrl" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.voiceDirectory')">
                <NInput v-model:value="qwen!.voiceDirectory" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.defaultProfile')">
                <NSelect v-model:value="qwen!.defaultProfile" :options="profileOptions" />
              </NFormItem>
            </NForm>
          </NCard>
        </NGridItem>

        <NGridItem>
          <NCard :title="t('pages.voiceModule.cards.profiles')" class="app-card">
            <NSpace vertical>
              <NSelect v-model:value="selectedProfileId" :options="profileOptions" />
              <NSpace>
                <NButton @click="createNewPresetProfile">{{ t('pages.voiceModule.actions.newPreset') }}</NButton>
                <NButton @click="deleteCurrentProfile">{{ t('common.delete') }}</NButton>
              </NSpace>
              <NAlert v-if="!currentProfile" type="info">{{ t('pages.voiceModule.messages.noProfileSelected') }}</NAlert>
              <NForm v-else label-placement="top">
                <NFormItem :label="t('pages.voiceModule.fields.profileType')">
                  <NTag>{{ currentProfile.source }}</NTag>
                </NFormItem>
                <template v-if="currentProfile.source === 'preset'">
                  <NFormItem :label="t('pages.voiceModule.fields.quality')">
                    <NSelect
                      v-model:value="currentProfile.quality"
                      :options="[
                        { label: 'fast', value: 'fast' },
                        { label: 'balanced', value: 'balanced' },
                      ]"
                    />
                  </NFormItem>
                  <NFormItem :label="t('pages.voiceModule.fields.voice')">
                    <NSelect v-model:value="currentProfile.voice" :options="builtinVoiceOptions" />
                  </NFormItem>
                  <NFormItem :label="t('pages.voiceModule.fields.language')">
                    <NInput v-model:value="currentProfile.language" />
                  </NFormItem>
                  <NFormItem :label="t('pages.voiceModule.fields.instructions')">
                    <NInput v-model:value="currentProfile.instructions" type="textarea" :rows="3" />
                  </NFormItem>
                </template>
                <template v-else-if="currentProfile.source === 'clone'">
                  <NFormItem :label="t('pages.voiceModule.fields.quality')">
                    <NSelect
                      v-model:value="currentProfile.quality"
                      :options="[
                        { label: 'clone-fast', value: 'clone-fast' },
                        { label: 'clone', value: 'clone' },
                      ]"
                    />
                  </NFormItem>
                  <NFormItem :label="t('pages.voiceModule.fields.referenceAudioPath')">
                    <NInput v-model:value="currentProfile.refAudio" />
                  </NFormItem>
                  <NFormItem :label="t('pages.voiceModule.fields.referenceText')">
                    <NInput v-model:value="currentProfile.refText" type="textarea" :rows="3" />
                  </NFormItem>
                  <NFormItem :label="t('pages.voiceModule.fields.language')">
                    <NInput v-model:value="currentProfile.language" />
                  </NFormItem>
                  <NFormItem :label="t('pages.voiceModule.fields.instructions')">
                    <NInput v-model:value="currentProfile.instructions" type="textarea" :rows="3" />
                  </NFormItem>
                </template>
                <template v-else>
                  <NFormItem :label="t('pages.voiceModule.fields.designPrompt')">
                    <NInput v-model:value="currentProfile.prompt" type="textarea" :rows="5" />
                  </NFormItem>
                  <NFormItem :label="t('pages.voiceModule.fields.language')">
                    <NInput v-model:value="currentProfile.language" />
                  </NFormItem>
                </template>
                <NButton type="primary" :loading="saving" @click="savePresetProfile">
                  {{ t('pages.voiceModule.actions.saveProfile') }}
                </NButton>
              </NForm>
            </NSpace>
          </NCard>
        </NGridItem>

        <NGridItem>
          <NCard :title="t('pages.voiceModule.cards.preview')" class="app-card">
            <NForm label-placement="top">
              <NFormItem :label="t('pages.voiceModule.fields.previewAgent')">
                <NSelect v-model:value="previewAgentId" clearable :options="agentOptions" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.previewText')">
                <NInput v-model:value="previewText" type="textarea" :rows="5" />
              </NFormItem>
            </NForm>
            <NSpace>
              <NButton type="primary" :loading="previewing" @click="previewSelectedProfile">
                {{ t('pages.voiceModule.actions.preview') }}
              </NButton>
              <NButton v-if="previewAudioUrl" tag="a" :href="previewAudioUrl" target="_blank">
                {{ t('pages.voiceModule.actions.openAudio') }}
              </NButton>
            </NSpace>
          </NCard>
        </NGridItem>
      </NGrid>

      <NCard :title="t('pages.voiceModule.cards.agentBindings')" class="app-card">
        <div v-if="agentOptions.length === 0">
          <NEmpty :description="t('pages.voiceModule.messages.noAgents')" />
        </div>
        <NGrid v-else cols="1 s:1 m:2" responsive="screen" :x-gap="16" :y-gap="12">
          <NGridItem v-for="agent in agents" :key="agent.id">
            <NFormItem :label="agent.name?.trim() || agent.id">
              <NSelect
                v-model:value="qwen!.agentProfiles[agent.id]"
                clearable
                :options="profileOptions"
              />
            </NFormItem>
          </NGridItem>
        </NGrid>
      </NCard>

      <NCard class="app-card">
        <NTabs v-model:value="activeTab" type="line" animated>
          <NTabPane name="profiles" :tab="t('pages.voiceModule.tabs.profiles')">
            <NAlert type="info">{{ t('pages.voiceModule.hints.profiles') }}</NAlert>
          </NTabPane>
          <NTabPane name="clone" :tab="t('pages.voiceModule.tabs.clone')">
            <NForm label-placement="top">
              <NFormItem :label="t('pages.voiceModule.fields.profileId')">
                <NInput v-model:value="cloneDraft.profileId" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.referenceAudio')">
                <input type="file" accept="audio/*" :disabled="uploading" @change="handleReferenceAudioPicked" />
                <NText depth="3" style="display: block; margin-top: 8px;">{{ cloneDraft.refAudio || t('pages.voiceModule.messages.noReferenceAudio') }}</NText>
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.referenceText')">
                <NInput v-model:value="cloneDraft.refText" type="textarea" :rows="4" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.quality')">
                <NSelect
                  v-model:value="cloneDraft.quality"
                  :options="[
                    { label: 'clone-fast', value: 'clone-fast' },
                    { label: 'clone', value: 'clone' },
                  ]"
                />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.language')">
                <NInput v-model:value="cloneDraft.language" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.instructions')">
                <NInput v-model:value="cloneDraft.instructions" type="textarea" :rows="3" />
              </NFormItem>
            </NForm>
            <NButton type="primary" :loading="saving || uploading" @click="saveCloneProfile">
              {{ t('pages.voiceModule.actions.saveClone') }}
            </NButton>
          </NTabPane>
          <NTabPane name="design" :tab="t('pages.voiceModule.tabs.design')">
            <NForm label-placement="top">
              <NFormItem :label="t('pages.voiceModule.fields.profileId')">
                <NInput v-model:value="designDraft.profileId" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.designPrompt')">
                <NInput v-model:value="designDraft.prompt" type="textarea" :rows="6" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.language')">
                <NInput v-model:value="designDraft.language" />
              </NFormItem>
            </NForm>
            <NButton type="primary" :loading="saving" @click="saveDesignProfile">
              {{ t('pages.voiceModule.actions.saveDesign') }}
            </NButton>
          </NTabPane>
          <NTabPane name="dialogue" :tab="t('pages.voiceModule.tabs.dialogue')">
            <NForm label-placement="top">
              <NFormItem :label="t('pages.voiceModule.fields.profileId')">
                <NInput v-model:value="dialogueDraft.profileId" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.dialogueRole')">
                <NInput v-model:value="dialogueDraft.role" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.dialogueStyle')">
                <NInput v-model:value="dialogueDraft.style" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.dialogueScene')">
                <NInput v-model:value="dialogueDraft.scene" />
              </NFormItem>
              <NFormItem :label="t('pages.voiceModule.fields.dialogueNotes')">
                <NInput v-model:value="dialogueDraft.notes" type="textarea" :rows="4" />
              </NFormItem>
            </NForm>
            <NAlert type="info" style="margin-bottom: 12px;">{{ buildDialoguePrompt() || t('pages.voiceModule.messages.dialoguePromptEmpty') }}</NAlert>
            <NButton type="primary" :loading="saving" @click="saveDialogueProfile">
              {{ t('pages.voiceModule.actions.saveDialogue') }}
            </NButton>
          </NTabPane>
        </NTabs>
      </NCard>

      <NCard :title="t('pages.voiceModule.cards.browserPlayback')" class="app-card">
        <NAlert type="info" style="margin-bottom: 16px;">
          {{ t('pages.voiceModule.hints.browserPlayback') }}
        </NAlert>
        <NForm label-placement="top">
          <NGrid cols="1 s:1 m:2" responsive="screen" :x-gap="16">
            <NGridItem>
              <NFormItem :label="t('pages.voiceModule.fields.browserEnabled')">
                <NSwitch v-model:value="playbackPrefs.enabled" />
              </NFormItem>
            </NGridItem>
            <NGridItem>
              <NFormItem :label="t('pages.voiceModule.fields.browserAutoPlay')">
                <NSwitch v-model:value="playbackPrefs.autoPlay" />
              </NFormItem>
            </NGridItem>
          </NGrid>
          <NFormItem :label="t('pages.voiceModule.fields.voice')">
            <NSelect
              v-model:value="playbackPrefs.voice"
              :loading="browserVoicesLoading"
              :options="browserVoiceOptions"
              filterable
            />
          </NFormItem>
          <NDivider />
          <NFormItem :label="`${t('pages.voiceModule.fields.rate')} (${playbackPrefs.rate.toFixed(1)})`">
            <NSlider v-model:value="playbackPrefs.rate" :min="0.5" :max="2" :step="0.1" />
          </NFormItem>
          <NFormItem :label="`${t('pages.voiceModule.fields.volume')} (${playbackPrefs.volume.toFixed(1)})`">
            <NSlider v-model:value="playbackPrefs.volume" :min="0" :max="1" :step="0.1" />
          </NFormItem>
          <NFormItem :label="`${t('pages.voiceModule.fields.pitch')} (${playbackPrefs.pitch.toFixed(1)})`">
            <NSlider v-model:value="playbackPrefs.pitch" :min="0.5" :max="2" :step="0.1" />
          </NFormItem>
        </NForm>
        <NSpace>
          <NButton :loading="browserTtsLoading && !browserTtsPlaying" @click="previewBrowserPlayback">
            {{ browserTtsPlaying ? t('common.cancel') : t('pages.voiceModule.actions.previewBrowser') }}
          </NButton>
          <NButton @click="resetPlaybackPrefs">{{ t('common.reset') }}</NButton>
        </NSpace>
      </NCard>
      </template>
    </NSpace>
  </NSpin>
</template>
