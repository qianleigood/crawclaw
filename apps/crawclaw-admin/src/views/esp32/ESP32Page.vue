<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NGrid,
  NGridItem,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NSpace,
  NSpin,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { CopyOutline, HardwareChipOutline, RefreshOutline, SendOutline } from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import type {
  Esp32DeviceCapabilities,
  Esp32DeviceSummary,
  Esp32DeviceTool,
  Esp32PairingRequestSummary,
} from '@/api/types'
import { useEsp32Store } from '@/stores/esp32'
import { useWebSocketStore } from '@/stores/websocket'
import { formatDate, formatRelativeTime, truncate } from '@/utils/format'

const store = useEsp32Store()
const wsStore = useWebSocketStore()
const message = useMessage()
const { t } = useI18n()

const showPairingModal = ref(false)
const showDeviceModal = ref(false)
const pairingName = ref('')
const testDisplayText = ref('Hello from CrawClaw')

let unsubscribeEvent: (() => void) | null = null

function statusTagType(value: boolean): 'success' | 'error' {
  return value ? 'success' : 'error'
}

function onlineTagType(value: boolean): 'success' | 'default' {
  return value ? 'success' : 'default'
}

function formatMaybeDate(value?: number): string {
  return value ? formatDate(value) : '-'
}

function capabilitiesSummary(value: unknown): string {
  if (!value) return '-'
  const row = value as Esp32DeviceCapabilities
  const buttons = Array.isArray(row.buttons) ? row.buttons.length : 0
  const expressions = Array.isArray(row.expressions) ? row.expressions.length : 0
  const tools = Array.isArray(row.tools) ? row.tools.length : 0
  return `${buttons}/${expressions}/${tools}`
}

function listValues(value?: string[]): string[] {
  return Array.isArray(value) ? value : []
}

function listTools(value?: Esp32DeviceTool[]): Esp32DeviceTool[] {
  return Array.isArray(value) ? value : []
}

function toolRiskTagType(risk?: string): 'success' | 'warning' | 'error' | 'default' {
  if (risk === 'low') return 'success'
  if (risk === 'medium') return 'warning'
  if (risk === 'high') return 'error'
  return 'default'
}

function formatDisplayCapability(value?: Esp32DeviceCapabilities['display']): string {
  if (!value) return '-'
  const parts: string[] = []
  if (typeof value.width === 'number' && typeof value.height === 'number') {
    parts.push(`${value.width}x${value.height}`)
  }
  if (typeof value.color === 'boolean') {
    parts.push(value.color ? t('pages.esp32.values.color') : t('pages.esp32.values.mono'))
  }
  return parts.join(' · ') || '-'
}

function formatAudioCapability(value?: Esp32DeviceCapabilities['audio']): string {
  if (!value) return '-'
  const parts = [value.input, value.output, value.codec].filter((item): item is string => Boolean(item))
  if (value.opus === true) {
    parts.push('Opus')
  }
  return parts.join(' · ') || '-'
}

async function refreshPage() {
  try {
    await store.refreshAll()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function handleStartPairing() {
  try {
    await store.startPairing({ name: pairingName.value.trim() || undefined })
    message.success(t('pages.esp32.messages.pairingStarted'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function approveRequest(requestId: string) {
  try {
    await store.approveRequest(requestId)
    message.success(t('pages.esp32.messages.requestApproved'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function rejectRequest(requestId: string) {
  try {
    await store.rejectRequest(requestId)
    message.success(t('pages.esp32.messages.requestRejected'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function revokePairingSession(pairId: string) {
  try {
    await store.revokePairingSession(pairId)
    message.success(t('pages.esp32.messages.sessionRevoked'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function openDevice(deviceId: string) {
  try {
    await store.loadDevice(deviceId)
    showDeviceModal.value = true
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function revokeDevice(deviceId: string) {
  try {
    await store.revokeDevice(deviceId)
    message.success(t('pages.esp32.messages.deviceRevoked'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function sendTestDisplay(deviceId: string) {
  try {
    await store.sendTestDisplay(deviceId, testDisplayText.value.trim() || 'Hello from CrawClaw')
    message.success(t('pages.esp32.messages.displaySent'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    message.success(t('common.copied'))
  } catch {
    message.error(t('common.copyFailed'))
  }
}

const pendingColumns = computed<DataTableColumns<Esp32PairingRequestSummary>>(() => [
  {
    title: () => t('pages.esp32.columns.device'),
    key: 'deviceId',
    minWidth: 180,
    render: (row) =>
      h(NSpace, { vertical: true, size: 2 }, {
        default: () => [
          h(NText, { strong: true }, { default: () => row.name || row.deviceId }),
          h(NText, { depth: 3, code: true }, { default: () => truncate(row.deviceId, 40) }),
        ],
      }),
  },
  {
    title: () => t('pages.esp32.columns.fingerprint'),
    key: 'fingerprint',
    minWidth: 180,
    render: (row) => h(NText, { code: true }, { default: () => truncate(row.fingerprint || '-', 32) }),
  },
  {
    title: () => t('pages.esp32.columns.capabilities'),
    key: 'capabilities',
    width: 110,
    render: (row) => capabilitiesSummary(row.capabilities),
  },
  {
    title: () => t('pages.esp32.columns.requestedAt'),
    key: 'requestedAtMs',
    width: 150,
    render: (row) => formatRelativeTime(row.requestedAtMs),
  },
  {
    title: () => t('pages.esp32.columns.actions'),
    key: 'actions',
    width: 190,
    render: (row) =>
      h(NSpace, { size: 8 }, {
        default: () => [
          h(
            NButton,
            {
              size: 'small',
              type: 'primary',
              loading: Boolean(store.requestActions[row.requestId]),
              onClick: () => void approveRequest(row.requestId),
            },
            { default: () => t('pages.esp32.actions.approve') },
          ),
          h(
            NButton,
            {
              size: 'small',
              secondary: true,
              loading: Boolean(store.requestActions[row.requestId]),
              onClick: () => void rejectRequest(row.requestId),
            },
            { default: () => t('pages.esp32.actions.reject') },
          ),
        ],
      }),
  },
])

const deviceColumns = computed<DataTableColumns<Esp32DeviceSummary>>(() => [
  {
    title: () => t('pages.esp32.columns.device'),
    key: 'deviceId',
    minWidth: 180,
    render: (row) =>
      h(NSpace, { vertical: true, size: 2 }, {
        default: () => [
          h(NText, { strong: true }, { default: () => row.name || row.deviceId }),
          h(NText, { depth: 3, code: true }, { default: () => truncate(row.deviceId, 40) }),
        ],
      }),
  },
  {
    title: () => t('pages.esp32.columns.status'),
    key: 'online',
    width: 110,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: onlineTagType(row.online) },
        { default: () => (row.online ? t('common.online') : t('common.offline')) },
      ),
  },
  {
    title: () => t('pages.esp32.columns.lastSeen'),
    key: 'lastSeenAtMs',
    width: 150,
    render: (row) => (row.lastSeenAtMs ? formatRelativeTime(row.lastSeenAtMs) : '-'),
  },
  {
    title: () => t('pages.esp32.columns.capabilities'),
    key: 'capabilities',
    width: 110,
    render: (row) => capabilitiesSummary(row.capabilities),
  },
  {
    title: () => t('pages.esp32.columns.actions'),
    key: 'actions',
    width: 220,
    render: (row) =>
      h(NSpace, { size: 8 }, {
        default: () => [
          h(
            NButton,
            {
              size: 'small',
              secondary: true,
              onClick: () => void openDevice(row.deviceId),
            },
            { default: () => t('pages.esp32.actions.details') },
          ),
          h(
            NPopconfirm,
            {
              onPositiveClick: () => void revokeDevice(row.deviceId),
            },
            {
              trigger: () =>
                h(
                  NButton,
                  {
                    size: 'small',
                    tertiary: true,
                    type: 'error',
                    loading: Boolean(store.deviceActions[row.deviceId]),
                  },
                  { default: () => t('pages.esp32.actions.revoke') },
                ),
              default: () => t('pages.esp32.confirm.revoke'),
            },
          ),
        ],
      }),
  },
])

onMounted(async () => {
  await refreshPage()
  unsubscribeEvent = wsStore.subscribe('event', (evt: unknown) => {
    if (!evt || typeof evt !== 'object') return
    const row = evt as { event?: unknown }
    if (row.event === 'device.pair.requested' || row.event === 'device.pair.resolved') {
      void refreshPage()
    }
  })
})

onBeforeUnmount(() => {
  unsubscribeEvent?.()
  unsubscribeEvent = null
})
</script>

<template>
  <NSpin :show="store.loading">
    <div class="esp32-page">
      <NSpace justify="space-between" align="center" class="esp32-page__header">
        <div>
          <div class="esp32-page__title">{{ t('routes.esp32') }}</div>
          <div class="esp32-page__subtitle">{{ t('pages.esp32.subtitle') }}</div>
        </div>
        <NSpace>
          <NButton secondary :focusable="false" @click="refreshPage">
            <template #icon>
              <NIcon :component="RefreshOutline" />
            </template>
            {{ t('common.refresh') }}
          </NButton>
          <NButton type="primary" :focusable="false" @click="showPairingModal = true">
            <template #icon>
              <NIcon :component="HardwareChipOutline" />
            </template>
            {{ t('pages.esp32.actions.startPairing') }}
          </NButton>
        </NSpace>
      </NSpace>

      <NAlert
        v-if="store.status && (!store.status.enabled || !store.status.serviceRunning)"
        type="warning"
        class="esp32-page__alert"
      >
        {{ t('pages.esp32.statusHint') }}
      </NAlert>

      <NGrid cols="1 m:2" responsive="screen" :x-gap="16" :y-gap="16">
        <NGridItem>
          <NCard :title="t('pages.esp32.sections.status')" class="app-card">
            <NDescriptions :column="1" size="small" label-placement="left">
              <NDescriptionsItem :label="t('pages.esp32.fields.plugin')">
                <NTag size="small" :type="statusTagType(Boolean(store.status?.enabled))">
                  {{ store.status?.enabled ? t('common.enabled') : t('common.disabled') }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem :label="t('pages.esp32.fields.service')">
                <NTag size="small" :type="statusTagType(Boolean(store.status?.serviceRunning))">
                  {{ store.status?.serviceRunning ? t('common.online') : t('common.offline') }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem :label="t('pages.esp32.fields.broker')">
                {{ store.status?.broker.advertisedHost || store.status?.broker.bindHost || '-' }}:{{ store.status?.broker.port || '-' }}
              </NDescriptionsItem>
              <NDescriptionsItem :label="t('pages.esp32.fields.udp')">
                {{ store.status?.udp.advertisedHost || store.status?.udp.bindHost || '-' }}:{{ store.status?.udp.port || '-' }}
              </NDescriptionsItem>
              <NDescriptionsItem :label="t('pages.esp32.fields.renderer')">
                {{ store.status?.renderer.model || '-' }}
              </NDescriptionsItem>
              <NDescriptionsItem :label="t('pages.esp32.fields.tts')">
                {{ store.status?.tts.provider || '-' }}
              </NDescriptionsItem>
            </NDescriptions>
          </NCard>
        </NGridItem>

        <NGridItem>
          <NCard :title="t('pages.esp32.sections.counts')" class="app-card">
            <NGrid cols="2" :x-gap="12" :y-gap="12">
              <NGridItem>
                <div class="esp32-stat">
                  <div class="esp32-stat__label">{{ t('pages.esp32.counts.activePairingSessions') }}</div>
                  <div class="esp32-stat__value">{{ store.status?.counts.activePairingSessions ?? 0 }}</div>
                </div>
              </NGridItem>
              <NGridItem>
                <div class="esp32-stat">
                  <div class="esp32-stat__label">{{ t('pages.esp32.counts.pendingRequests') }}</div>
                  <div class="esp32-stat__value">{{ store.status?.counts.pendingRequests ?? 0 }}</div>
                </div>
              </NGridItem>
              <NGridItem>
                <div class="esp32-stat">
                  <div class="esp32-stat__label">{{ t('pages.esp32.counts.pairedDevices') }}</div>
                  <div class="esp32-stat__value">{{ store.status?.counts.pairedDevices ?? 0 }}</div>
                </div>
              </NGridItem>
              <NGridItem>
                <div class="esp32-stat">
                  <div class="esp32-stat__label">{{ t('pages.esp32.counts.onlineDevices') }}</div>
                  <div class="esp32-stat__value">{{ store.status?.counts.onlineDevices ?? 0 }}</div>
                </div>
              </NGridItem>
            </NGrid>

            <NSpace vertical size="small" class="esp32-page__section-block">
              <div class="esp32-page__section-label">{{ t('pages.esp32.sections.activePairingSessions') }}</div>
              <NEmpty
                v-if="(store.status?.activePairingSessions.length ?? 0) === 0"
                :description="t('pages.esp32.empty.sessions')"
              />
              <div
                v-for="session in store.status?.activePairingSessions ?? []"
                :key="session.pairId"
                class="esp32-session"
              >
                <div class="esp32-session__content">
                  <NText strong>{{ session.name || session.pairId }}</NText>
                  <NText depth="3" code>{{ session.username }}</NText>
                  <NText depth="3">
                    {{ t('pages.esp32.fields.expiresAt') }}: {{ formatDate(session.expiresAtMs) }}
                  </NText>
                </div>
                <NPopconfirm @positive-click="revokePairingSession(session.pairId)">
                  <template #trigger>
                    <NButton
                      size="small"
                      tertiary
                      type="error"
                      :loading="Boolean(store.pairingSessionActions[session.pairId])"
                    >
                      {{ t('pages.esp32.actions.revoke') }}
                    </NButton>
                  </template>
                  {{ t('pages.esp32.confirm.revokeSession') }}
                </NPopconfirm>
              </div>
            </NSpace>
          </NCard>
        </NGridItem>

        <NGridItem>
          <NCard :title="t('pages.esp32.sections.pairingRequests')" class="app-card">
            <NEmpty v-if="store.pendingRequests.length === 0" :description="t('pages.esp32.empty.requests')" />
            <NDataTable
              v-else
              :columns="pendingColumns"
              :data="store.pendingRequests"
              :bordered="false"
              :pagination="false"
              size="small"
              :single-line="false"
            />
          </NCard>
        </NGridItem>

        <NGridItem>
          <NCard :title="t('pages.esp32.sections.devices')" class="app-card">
            <NEmpty v-if="store.devices.length === 0" :description="t('pages.esp32.empty.devices')" />
            <NDataTable
              v-else
              :columns="deviceColumns"
              :data="store.devices"
              :bordered="false"
              :pagination="false"
              size="small"
              :single-line="false"
            />
          </NCard>
        </NGridItem>
      </NGrid>

      <NModal v-model:show="showPairingModal" preset="dialog" :title="t('pages.esp32.modals.pairing.title')">
        <NSpace vertical :size="12">
          <NInput v-model:value="pairingName" :placeholder="t('pages.esp32.modals.pairing.namePlaceholder')" />
          <NButton type="primary" :loading="store.startingPairing" @click="handleStartPairing">
            {{ t('pages.esp32.actions.startPairing') }}
          </NButton>

          <template v-if="store.latestPairing">
            <NDescriptions :column="1" size="small" label-placement="left">
              <NDescriptionsItem :label="t('pages.esp32.fields.pairCode')">
                <NSpace align="center" justify="space-between" style="width: 100%">
                  <NText code>{{ store.latestPairing.pairCode }}</NText>
                  <NButton quaternary circle @click="copyText(store.latestPairing.pairCode)">
                    <template #icon>
                      <NIcon :component="CopyOutline" />
                    </template>
                  </NButton>
                </NSpace>
              </NDescriptionsItem>
              <NDescriptionsItem :label="t('pages.esp32.fields.mqttUsername')">
                <NText code>{{ store.latestPairing.username }}</NText>
              </NDescriptionsItem>
              <NDescriptionsItem :label="t('pages.esp32.fields.broker')">
                {{ store.latestPairing.broker.host }}:{{ store.latestPairing.broker.port }}
              </NDescriptionsItem>
              <NDescriptionsItem :label="t('pages.esp32.fields.udp')">
                {{ store.latestPairing.udp.host }}:{{ store.latestPairing.udp.port }}
              </NDescriptionsItem>
              <NDescriptionsItem :label="t('pages.esp32.fields.expiresAt')">
                {{ formatDate(store.latestPairing.expiresAtMs) }}
              </NDescriptionsItem>
            </NDescriptions>
          </template>
        </NSpace>
      </NModal>

      <NModal
        v-model:show="showDeviceModal"
        preset="dialog"
        :title="store.selectedDevice?.name || store.selectedDevice?.deviceId || t('pages.esp32.modals.device.title')"
        @after-leave="store.clearSelectedDevice"
      >
        <NSpin :show="store.detailLoading">
          <template v-if="store.selectedDevice">
            <NSpace vertical :size="12">
              <NDescriptions :column="1" size="small" label-placement="left">
                <NDescriptionsItem :label="t('pages.esp32.fields.deviceId')">
                  <NText code>{{ store.selectedDevice.deviceId }}</NText>
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.fingerprint')">
                  <NText code>{{ store.selectedDevice.fingerprint || '-' }}</NText>
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.hardwareTarget')">
                  {{ store.selectedDevice.hardwareTarget }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.clientMode')">
                  <NText code>{{ store.selectedDevice.clientMode }}</NText>
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.approvedAt')">
                  {{ formatMaybeDate(store.selectedDevice.approvedAtMs) }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.lastSeen')">
                  {{ formatMaybeDate(store.selectedDevice.lastSeenAtMs) }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.display')">
                  {{ formatDisplayCapability(store.selectedDevice.capabilities.display) }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.audio')">
                  {{ formatAudioCapability(store.selectedDevice.capabilities.audio) }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.buttons')">
                  {{ listValues(store.selectedDevice.capabilities.buttons).join(', ') || '-' }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.expressions')">
                  {{ listValues(store.selectedDevice.capabilities.expressions).join(', ') || '-' }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.leds')">
                  {{ listValues(store.selectedDevice.capabilities.leds).join(', ') || '-' }}
                </NDescriptionsItem>
                <NDescriptionsItem :label="t('pages.esp32.fields.chimes')">
                  {{ listValues(store.selectedDevice.capabilities.chimes).join(', ') || '-' }}
                </NDescriptionsItem>
              </NDescriptions>

              <NSpace vertical size="small">
                <div class="esp32-page__section-label">{{ t('pages.esp32.fields.tools') }}</div>
                <NEmpty
                  v-if="listTools(store.selectedDevice.capabilities.tools).length === 0"
                  :description="t('pages.esp32.empty.tools')"
                />
                <NSpace v-else wrap>
                  <NTag
                    v-for="tool in listTools(store.selectedDevice.capabilities.tools)"
                    :key="tool.name"
                    :type="toolRiskTagType(tool.risk)"
                    size="small"
                  >
                    {{ tool.name }}<template v-if="tool.risk"> · {{ tool.risk }}</template>
                  </NTag>
                </NSpace>
              </NSpace>

              <NSpace vertical size="small">
                <div class="esp32-page__section-label">{{ t('pages.esp32.sections.testDisplay') }}</div>
                <NSpace>
                  <NInput v-model:value="testDisplayText" />
                  <NButton
                    type="primary"
                    :loading="Boolean(store.deviceActions[store.selectedDevice.deviceId])"
                    @click="sendTestDisplay(store.selectedDevice.deviceId)"
                  >
                    <template #icon>
                      <NIcon :component="SendOutline" />
                    </template>
                    {{ t('pages.esp32.actions.sendDisplay') }}
                  </NButton>
                </NSpace>
              </NSpace>
            </NSpace>
          </template>
          <NEmpty v-else :description="t('pages.esp32.empty.deviceDetail')" />
        </NSpin>
      </NModal>
    </div>
  </NSpin>
</template>

<style scoped>
.esp32-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.esp32-page__header {
  margin-bottom: 4px;
}

.esp32-page__title {
  font-size: 20px;
  font-weight: 600;
}

.esp32-page__subtitle {
  color: var(--n-text-color-3);
  margin-top: 4px;
}

.esp32-page__alert {
  margin-bottom: 4px;
}

.esp32-page__section-label {
  font-size: 12px;
  color: var(--n-text-color-3);
}

.esp32-page__section-block {
  margin-top: 16px;
}

.esp32-stat {
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
  padding: 12px;
}

.esp32-stat__label {
  color: var(--n-text-color-3);
  font-size: 12px;
}

.esp32-stat__value {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
  margin-top: 6px;
}

.esp32-session {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
  padding: 12px;
}

.esp32-session__content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
</style>
