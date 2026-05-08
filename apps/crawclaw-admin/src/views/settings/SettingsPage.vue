<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { NCard, NSpace, NSelect, NText, NAlert, NForm, NFormItem, NInput, NButton, NSpin, NTag, useMessage } from 'naive-ui'
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
const baseAppTitle = import.meta.env.VITE_APP_TITLE || 'CrawClaw Admin'
const appVersion = import.meta.env.VITE_APP_VERSION || ''

const loading = ref(false)
const saving = ref(false)
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
const isDesktopMode = computed(() => desktopStore.isDesktopMode)
const isAdvancedMode = computed(() => desktopStore.advancedMode)
const appTitle = computed(() => (isDesktopMode.value ? 'CrawClaw Desktop' : baseAppTitle))
const runtimeStatusText = computed(() => {
  if (desktopStore.runtimeLastError) {
    return desktopStore.runtimeLastError
  }
  if (!desktopStore.runtimeStatus) {
    return t('pages.settings.runtimeStatusUnknown')
  }
  return JSON.stringify(desktopStore.runtimeStatus.result, null, 2)
})

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
  if (!isDesktopMode.value) {
    return configForm.value
  }

  return {
    AUTH_USERNAME: configForm.value.AUTH_USERNAME,
  }
}

async function refreshDesktopCapabilities() {
  await desktopStore.refreshCapabilities()
}

async function runDesktopRuntimeAction(action: () => Promise<unknown>, successKey: string) {
  const result = await action()
  if (result) {
    message.success(t(successKey))
  } else if (desktopStore.runtimeLastError) {
    message.error(desktopStore.runtimeLastError)
  }
}

async function installOptionalRuntime(id: string) {
  const result = await desktopStore.installOptionalRuntime(id)
  if (result?.installed) {
    message.success(t('pages.settings.runtimeInstalled'))
  } else if (desktopStore.optionalRuntimesLastError) {
    message.error(desktopStore.optionalRuntimesLastError)
  }
}

async function toggleAdvancedMode() {
  const nextValue = !desktopStore.advancedMode
  desktopStore.setAdvancedMode(nextValue)
  if (nextValue && isDesktopMode.value && desktopStore.optionalRuntimes.length === 0) {
    await desktopStore.refreshOptionalRuntimes()
  }
}

function optionalRuntimeTagType(state: string) {
  if (state === 'healthy') {return 'success'}
  if (state === 'unavailable') {return 'error'}
  return 'warning'
}

onMounted(() => {
  void loadConfig()
  void Promise.resolve(desktopStore.ensureCapabilitiesLoaded()).then(() => {
    if (isDesktopMode.value && isAdvancedMode.value) {
      void desktopStore.refreshOptionalRuntimes()
    }
  })
})
</script>

<template>
  <NSpace vertical :size="16" class="settings-page">
    <NCard v-if="!isDesktopMode" :title="t('pages.settings.connectionSettings')" class="app-card">
      <NAlert :type="connectionStatus.type" :bordered="false">
        {{ t('pages.settings.currentStatus', { status: connectionStatus.text }) }}
        <span v-if="wsStore.lastError">（{{ wsStore.lastError }}）</span>
      </NAlert>
    </NCard>

    <NCard
      v-if="isDesktopMode"
      :title="t('pages.settings.desktopExperience')"
      class="app-card settings-apple-card"
    >
      <NSpace vertical :size="12">
        <NAlert type="info" :bordered="false">
          {{ t('pages.settings.desktopExperienceHint') }}
        </NAlert>
        <NSpace align="center" justify="space-between" class="desktop-experience-row">
          <NSpace vertical :size="4">
            <NText strong>{{ t('pages.settings.advancedMode') }}</NText>
            <NText depth="3" style="font-size: 13px;">
              {{ isAdvancedMode ? t('pages.settings.advancedModeEnabled') : t('pages.settings.advancedModeDisabled') }}
            </NText>
          </NSpace>
          <NButton size="small" secondary @click="toggleAdvancedMode">
            {{ isAdvancedMode ? t('pages.settings.disableAdvancedMode') : t('pages.settings.enableAdvancedMode') }}
          </NButton>
        </NSpace>
      </NSpace>
    </NCard>

    <NCard
      v-if="isDesktopUpdateMode"
      :title="t('pages.settings.desktopUpdateMode')"
      class="app-card settings-apple-card"
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
      v-if="isDesktopMode && isAdvancedMode"
      :title="t('pages.settings.gatewayService')"
      class="app-card"
    >
      <NSpace vertical :size="12">
        <NAlert
          :type="desktopStore.runtimeLastError ? 'error' : 'info'"
          :bordered="false"
        >
          {{ t('pages.settings.runtimeStatus') }}: {{ runtimeStatusText }}
        </NAlert>
        <NSpace :size="8">
          <NButton
            size="small"
            :loading="desktopStore.runtimeLoading"
            @click="runDesktopRuntimeAction(desktopStore.refreshRuntimeStatus, 'pages.settings.runtimeRefreshed')"
          >
            {{ t('pages.settings.runtimeStatus') }}
          </NButton>
          <NButton
            size="small"
            :loading="desktopStore.runtimeLoading"
            @click="runDesktopRuntimeAction(desktopStore.bootstrapRuntime, 'pages.settings.serviceBootstrapped')"
          >
            {{ t('pages.settings.serviceBootstrap') }}
          </NButton>
          <NButton
            size="small"
            :loading="desktopStore.runtimeLoading"
            @click="runDesktopRuntimeAction(desktopStore.startGatewayService, 'pages.settings.serviceStarted')"
          >
            {{ t('pages.settings.serviceStart') }}
          </NButton>
          <NButton
            size="small"
            :loading="desktopStore.runtimeLoading"
            @click="runDesktopRuntimeAction(desktopStore.stopGatewayService, 'pages.settings.serviceStopped')"
          >
            {{ t('pages.settings.serviceStop') }}
          </NButton>
          <NButton
            size="small"
            :loading="desktopStore.runtimeLoading"
            @click="runDesktopRuntimeAction(desktopStore.restartGatewayService, 'pages.settings.serviceRestarted')"
          >
            {{ t('pages.settings.serviceRestart') }}
          </NButton>
          <NButton
            size="small"
            :loading="desktopStore.runtimeLoading"
            @click="runDesktopRuntimeAction(desktopStore.tailRuntimeLogs, 'pages.settings.serviceLogsLoaded')"
          >
            {{ t('pages.settings.serviceLogs') }}
          </NButton>
        </NSpace>
        <NInput
          v-if="desktopStore.runtimeLogs"
          :value="desktopStore.runtimeLogs"
          type="textarea"
          readonly
          :autosize="{ minRows: 6, maxRows: 14 }"
        />
      </NSpace>
    </NCard>

    <NCard
      v-if="isDesktopMode && isAdvancedMode"
      :title="t('pages.settings.optionalComponents')"
      class="app-card"
    >
      <NSpace vertical :size="12">
        <NAlert
          v-if="desktopStore.optionalRuntimesLastError"
          type="error"
          :bordered="false"
        >
          {{ desktopStore.optionalRuntimesLastError }}
        </NAlert>
        <div
          v-for="runtime in desktopStore.optionalRuntimes"
          :key="runtime.id"
          class="optional-runtime-row"
        >
          <NSpace align="center" justify="space-between">
            <NSpace vertical :size="4">
              <NSpace align="center" :size="8">
                <NText strong>{{ runtime.name || runtime.id }}</NText>
                <NTag size="small" :type="optionalRuntimeTagType(runtime.state)">
                  {{ runtime.installed ? t('pages.settings.runtimeInstalledState') : t('pages.settings.runtimeNotInstalledState') }}
                </NTag>
                <NText v-if="runtime.estimatedSize" depth="3" style="font-size: 12px;">
                  {{ runtime.estimatedSize }}
                </NText>
              </NSpace>
              <NText depth="3" style="font-size: 13px;">
                {{ runtime.description || runtime.reason || runtime.error || runtime.id }}
              </NText>
            </NSpace>
            <NButton
              size="small"
              :type="runtime.installed ? 'default' : 'primary'"
              :loading="desktopStore.optionalRuntimesLoading"
              @click="installOptionalRuntime(runtime.id)"
            >
              {{ runtime.installed ? t('pages.settings.repairRuntime') : t('pages.settings.installRuntime') }}
            </NButton>
          </NSpace>
        </div>
      </NSpace>
    </NCard>

    <NCard :title="t('pages.settings.envSettings')" class="app-card settings-apple-card">
      <NSpin :show="loading">
        <NForm label-placement="left" label-width="140" style="max-width: 600px;">
          <NFormItem :label="t('pages.settings.authUsername')">
            <NInput
              v-model:value="configForm.AUTH_USERNAME"
              :placeholder="t('pages.settings.authUsernamePlaceholder')"
            />
          </NFormItem>
          
          <NFormItem v-if="!isDesktopMode" :label="t('pages.settings.authPassword')">
            <NInput
              v-model:value="configForm.AUTH_PASSWORD"
              type="password"
              show-password-on="click"
              :placeholder="t('pages.settings.authPasswordPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem v-if="!isDesktopMode" :label="t('pages.settings.crawclawUrl')">
            <NInput
              v-model:value="configForm.CRAWCLAW_WS_URL"
              :placeholder="t('pages.settings.crawclawUrlPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem v-if="!isDesktopMode" :label="t('pages.settings.crawclawToken')">
            <NInput
              v-model:value="configForm.CRAWCLAW_AUTH_TOKEN"
              type="password"
              show-password-on="click"
              :placeholder="t('pages.settings.crawclawTokenPlaceholder')"
            />
          </NFormItem>
          
          <NFormItem v-if="!isDesktopMode" :label="t('pages.settings.crawclawPassword')">
            <NInput
              v-model:value="configForm.CRAWCLAW_AUTH_PASSWORD"
              type="password"
              show-password-on="click"
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
      
      <NAlert v-if="!isDesktopMode" type="info" :bordered="false" style="margin-top: 16px;">
        {{ t('pages.settings.envSettingsHint') }}
      </NAlert>
    </NCard>

    <NCard :title="t('pages.settings.appearanceSettings')" class="app-card settings-apple-card">
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
    <NCard :title="t('pages.settings.about')" class="app-card settings-apple-card">
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
.optional-runtime-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

.optional-runtime-row:last-child {
  border-bottom: 0;
}

.desktop-experience-row {
  width: 100%;
}

.settings-page {
  max-width: 920px;
  margin: 0 auto;
}

.settings-apple-card :deep(.n-card-header__main) {
  font-size: 15px;
  font-weight: 650;
}
</style>
