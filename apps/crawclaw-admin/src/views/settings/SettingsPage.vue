<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { NCard, NSpace, NSelect, NText, NAlert, NForm, NFormItem, NInput, NButton, NSpin, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useThemeStore, type ThemeMode } from '@/stores/theme'
import { useWebSocketStore } from '@/stores/websocket'
import { useAuthStore } from '@/stores/auth'
import { useDesktopStore } from '@/stores/desktop'
import { ConnectionState } from '@/api/types'

const DESKTOP_RELEASES_URL = 'https://github.com/qianleigood/crawclaw/releases'
const themeStore = useThemeStore()
const wsStore = useWebSocketStore()
const authStore = useAuthStore()
const desktopStore = useDesktopStore()
const { t } = useI18n()
const message = useMessage()
const appTitle = import.meta.env.VITE_APP_TITLE || 'CrawClaw Admin'
const appVersion = import.meta.env.VITE_APP_VERSION || ''

const loading = ref(false)
const saving = ref(false)
const runtimeLoading = ref(false)
const runtimeAction = ref<'start' | 'stop' | 'restart' | null>(null)
const runtimeStatus = ref<Record<string, unknown> | null>(null)
const runtimeLogs = ref('')
const configForm = ref({
  AUTH_USERNAME: '',
  AUTH_PASSWORD: '',
  CRAWCLAW_WS_URL: '',
  CRAWCLAW_AUTH_TOKEN: '',
  CRAWCLAW_AUTH_PASSWORD: '', // Gateway 密码认证
})

const themeOptions = computed(() => ([
  { label: t('pages.settings.themeLight'), value: 'light' },
  { label: t('pages.settings.themeDark'), value: 'dark' },
]))

const desktopUpdateCapability = computed(() => desktopStore.capability('desktopUpdate'))
const isDesktopUpdateMode = computed(() => desktopUpdateCapability.value?.available ?? false)
const isDesktopLocal = computed(() => desktopStore.isDesktopLocal)
const runtimeStatusText = computed(() => runtimeStatus.value ? JSON.stringify(runtimeStatus.value, null, 2) : '-')

const connectionStatus = computed(() => {
  switch (wsStore.state) {
    case ConnectionState.CONNECTED: return { text: t('pages.settings.statusConnected'), type: 'success' as const }
    case ConnectionState.CONNECTING: return { text: t('pages.settings.statusConnecting'), type: 'info' as const }
    case ConnectionState.RECONNECTING: return { text: t('pages.settings.statusReconnecting', { count: wsStore.reconnectAttempts }), type: 'warning' as const }
    case ConnectionState.FAILED: return { text: t('pages.settings.statusFailed'), type: 'error' as const }
    default: return { text: t('pages.settings.statusDisconnected'), type: 'error' as const }
  }
})

function handleThemeChange(mode: ThemeMode) {
  themeStore.setMode(mode)
}

async function loadConfig() {
  loading.value = true
  try {
    const token = authStore.getToken()
    const response = await fetch('/api/config', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })
    const data = await response.json()
    if (data.ok) {
      configForm.value = {
        AUTH_USERNAME: data.config.AUTH_USERNAME || '',
        AUTH_PASSWORD: data.config.AUTH_PASSWORD || '',
        CRAWCLAW_WS_URL: data.config.CRAWCLAW_WS_URL || '',
        CRAWCLAW_AUTH_TOKEN: data.config.CRAWCLAW_AUTH_TOKEN || '',
        CRAWCLAW_AUTH_PASSWORD: data.config.CRAWCLAW_AUTH_PASSWORD || '',
      }
    }
  } catch (e) {
    message.error(t('pages.settings.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  try {
    const token = authStore.getToken()
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildConfigPayload()),
    })
    const data = await response.json()
    if (data.ok) {
      message.success(t('pages.settings.saveSuccess'))
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    } else {
      message.error(data.error?.message || t('pages.settings.saveFailed'))
    }
  } catch (e) {
    message.error(t('pages.settings.saveFailed'))
  } finally {
    saving.value = false
  }
}

function buildConfigPayload() {
  if (!isDesktopUpdateMode.value) {
    return configForm.value
  }

  return {
    AUTH_USERNAME: configForm.value.AUTH_USERNAME,
    CRAWCLAW_WS_URL: configForm.value.CRAWCLAW_WS_URL,
  }
}

async function refreshDesktopCapabilities() {
  await desktopStore.refreshCapabilities()
}

async function fetchDesktopRuntime(path: string, init: RequestInit = {}) {
  const token = authStore.getToken()
  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(path, {
    ...init,
    headers,
  })
  const data = await response.json()
  if (!response.ok || data.ok === false) {
    throw new Error(data.error?.message || 'Desktop runtime request failed')
  }
  return data
}

async function loadDesktopRuntimeStatus() {
  if (!isDesktopLocal.value) {return}
  runtimeLoading.value = true
  try {
    const data = await fetchDesktopRuntime('/api/desktop/runtime/status')
    runtimeStatus.value = data.status || data
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.settings.desktopRuntimeStatusFailed'))
  } finally {
    runtimeLoading.value = false
  }
}

async function runDesktopService(action: 'start' | 'stop' | 'restart') {
  runtimeAction.value = action
  try {
    const data = await fetchDesktopRuntime(`/api/desktop/runtime/service/${action}`, { method: 'POST' })
    runtimeStatus.value = data.result || data
    message.success(t('pages.settings.desktopServiceActionSuccess'))
    await loadDesktopRuntimeStatus()
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.settings.desktopServiceActionFailed'))
  } finally {
    runtimeAction.value = null
  }
}

async function loadDesktopLogs() {
  if (!isDesktopLocal.value) {return}
  try {
    const data = await fetchDesktopRuntime('/api/desktop/runtime/logs/tail')
    runtimeLogs.value = data.logs?.content || ''
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('pages.settings.desktopLogsFailed'))
  }
}

onMounted(() => {
  void loadConfig()
  void desktopStore.ensureCapabilitiesLoaded().then(() => {
    if (isDesktopLocal.value) {
      void loadDesktopRuntimeStatus()
      void loadDesktopLogs()
    }
  })
})
</script>

<template>
  <NSpace vertical :size="16">
    <NCard :title="t('pages.settings.connectionSettings')" class="app-card">
      <NAlert :type="connectionStatus.type" :bordered="false">
        {{ t('pages.settings.currentStatus', { status: connectionStatus.text }) }}
        <span v-if="wsStore.lastError">（{{ wsStore.lastError }}）</span>
      </NAlert>
    </NCard>

    <NCard
      v-if="isDesktopUpdateMode"
      :title="t('pages.settings.desktopUpdateMode')"
      class="app-card"
    >
      <NSpace vertical :size="12">
        <NAlert type="info" :bordered="false">
          {{ t('components.connectionStatus.desktopUpdateMessage') }}
        </NAlert>
        <NSpace align="center" :size="12">
          <NText depth="3" style="font-size: 13px;">
            {{ t('pages.settings.desktopPlatform', { platform: desktopUpdateCapability?.platform || '-' }) }}
          </NText>
          <NButton
            size="small"
            :loading="desktopStore.loading"
            @click="refreshDesktopCapabilities"
          >
            {{ t('common.refresh') }}
          </NButton>
          <NButton
            tag="a"
            size="small"
            type="primary"
            :href="DESKTOP_RELEASES_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('components.connectionStatus.openReleases') }}
          </NButton>
        </NSpace>
      </NSpace>
    </NCard>

    <NCard
      v-if="isDesktopLocal"
      :title="t('pages.settings.desktopRuntime')"
      class="app-card"
    >
      <NSpace vertical :size="12">
        <NAlert type="info" :bordered="false">
          {{ t('pages.settings.desktopRuntimeHint') }}
        </NAlert>
        <NSpace align="center" :size="8">
          <NButton size="small" :loading="runtimeLoading" @click="loadDesktopRuntimeStatus">
            {{ t('common.refresh') }}
          </NButton>
          <NButton size="small" type="primary" :loading="runtimeAction === 'start'" @click="runDesktopService('start')">
            {{ t('pages.settings.desktopServiceStart') }}
          </NButton>
          <NButton size="small" :loading="runtimeAction === 'restart'" @click="runDesktopService('restart')">
            {{ t('pages.settings.desktopServiceRestart') }}
          </NButton>
          <NButton size="small" type="error" ghost :loading="runtimeAction === 'stop'" @click="runDesktopService('stop')">
            {{ t('pages.settings.desktopServiceStop') }}
          </NButton>
        </NSpace>
        <pre class="settings-runtime-output">{{ runtimeStatusText }}</pre>
      </NSpace>
    </NCard>

    <NCard
      v-if="isDesktopLocal"
      :title="t('pages.settings.desktopLogs')"
      class="app-card"
    >
      <NSpace vertical :size="12">
        <NButton size="small" @click="loadDesktopLogs">
          {{ t('common.refresh') }}
        </NButton>
        <pre class="settings-runtime-output">{{ runtimeLogs || t('pages.settings.desktopLogsEmpty') }}</pre>
      </NSpace>
    </NCard>

    <NCard v-if="!isDesktopLocal" :title="t('pages.settings.envSettings')" class="app-card">
      <NSpin :show="loading">
        <NForm label-placement="left" label-width="140" style="max-width: 600px;">
          <NFormItem :label="t('pages.settings.authUsername')">
            <NInput
              v-model:value="configForm.AUTH_USERNAME"
              :placeholder="t('pages.settings.authUsernamePlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="t('pages.settings.authPassword')">
            <NInput
              v-model:value="configForm.AUTH_PASSWORD"
              type="password"
              show-password-on="click"
              :disabled="isDesktopUpdateMode"
              :placeholder="t('pages.settings.authPasswordPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="t('pages.settings.crawclawUrl')">
            <NInput
              v-model:value="configForm.CRAWCLAW_WS_URL"
              :placeholder="t('pages.settings.crawclawUrlPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="t('pages.settings.crawclawToken')">
            <NInput
              v-model:value="configForm.CRAWCLAW_AUTH_TOKEN"
              type="password"
              show-password-on="click"
              :disabled="isDesktopUpdateMode"
              :placeholder="t('pages.settings.crawclawTokenPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="t('pages.settings.crawclawPassword')">
            <NInput
              v-model:value="configForm.CRAWCLAW_AUTH_PASSWORD"
              type="password"
              show-password-on="click"
              :disabled="isDesktopUpdateMode"
              :placeholder="t('pages.settings.crawclawPasswordPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem :label="''">
            <NSpace>
              <NButton type="primary" :loading="saving" @click="saveConfig">
                {{ t('pages.settings.save') }}
              </NButton>
            </NSpace>
          </NFormItem>
        </NForm>
      </NSpin>
      
      <NAlert type="info" :bordered="false" style="margin-top: 16px;">
        {{ t('pages.settings.envSettingsHint') }}
      </NAlert>
    </NCard>

    <NCard :title="t('pages.settings.appearanceSettings')" class="app-card">
      <NForm label-placement="left" label-width="120" style="max-width: 500px;">
        <NFormItem :label="t('pages.settings.themeMode')">
          <NSelect
            :value="themeStore.mode"
            :options="themeOptions"
            @update:value="handleThemeChange"
          />
        </NFormItem>
      </NForm>
    </NCard>
    <NCard :title="t('pages.settings.about')" class="app-card">
      <NSpace vertical :size="8">
        <NText>{{ appTitle }} v{{ appVersion }}</NText>
        <NText depth="3" style="font-size: 13px;">
          {{ t('pages.settings.aboutLine1') }}
        </NText>
        <NText depth="3" style="font-size: 13px;">
          {{ t('pages.settings.aboutLine2') }}
        </NText>
      </NSpace>
    </NCard>
  </NSpace>
</template>

<style scoped>
.settings-runtime-output {
  margin: 0;
  padding: 12px;
  max-height: 260px;
  overflow: auto;
  border-radius: 8px;
  background: var(--bg-muted, rgba(127, 127, 127, 0.08));
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
