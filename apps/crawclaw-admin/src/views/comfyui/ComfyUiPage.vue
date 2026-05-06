<script setup lang="ts">
import { computed, h, onMounted } from 'vue'
import type { Component } from 'vue'
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
  NPopconfirm,
  NSpace,
  NSpin,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import {
  AlertCircleOutline,
  CheckmarkCircleOutline,
  DownloadOutline,
  OpenOutline,
  PlayOutline,
  RefreshOutline,
  WarningOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useComfyUiStore } from '@/stores/comfyui'
import type {
  ComfyUiDiagnostic,
  ComfyUiOutputSummary,
  ComfyUiRunRecord,
  ComfyUiRunStatus,
  ComfyUiWorkflowSummary,
} from '@/api/types'
import { formatDate, truncate } from '@/utils/format'

type TagType = 'default' | 'info' | 'success' | 'warning' | 'error'

const store = useComfyUiStore()
const authStore = useAuthStore()
const message = useMessage()
const { t } = useI18n()

const selectedWorkflow = computed(() => store.selectedWorkflow)
const selectedSummary = computed(() => store.selectedSummary)
const diagnostics = computed(() => selectedWorkflow.value?.meta.diagnostics ?? store.validationDiagnostics)
const isBusy = computed(() => store.loading || store.detailsLoading || store.validating || store.running)
const canOpenComfyUi = computed(() => Boolean(store.status?.baseUrl || selectedSummary.value?.baseUrl || selectedWorkflow.value?.meta.baseUrl))

function renderIcon(icon: Component) {
  return () => h(NIcon, { component: icon })
}

function statusTagType(status?: ComfyUiRunStatus): TagType {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
    case 'timed_out':
      return 'error'
    case 'running':
      return 'info'
    case 'queued':
      return 'warning'
    default:
      return 'default'
  }
}

function statusLabel(status?: ComfyUiRunStatus): string {
  if (!status) return '-'
  return t(`pages.comfyui.statuses.${status}`, status)
}

function formatOptionalDate(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === '') return '-'
  return formatDate(value)
}

function formatDuration(value: number | null | undefined): string {
  if (value === undefined || value === null) return '-'
  if (value < 1000) return `${value} ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes} min ${rest} s`
}

function renderStatusTag(status?: ComfyUiRunStatus) {
  return h(NTag, { size: 'small', type: statusTagType(status) }, { default: () => statusLabel(status) })
}

function renderCount(value: number) {
  return h(NTag, { size: 'small', bordered: false }, { default: () => String(value) })
}

function outputDownloadUrl(output: ComfyUiOutputSummary): string {
  const params = new URLSearchParams({ path: output.localPath ?? '' })
  const token = authStore.getToken()
  if (token) {
    params.set('token', token)
  }
  return `/api/comfyui/outputs/download?${params.toString()}`
}

function diagnosticIcon(diagnostic: ComfyUiDiagnostic): Component {
  return diagnostic.severity === 'error' ? AlertCircleOutline : WarningOutline
}

function diagnosticTagType(diagnostic: ComfyUiDiagnostic): TagType {
  return diagnostic.severity === 'error' ? 'error' : 'warning'
}

async function refreshOverview() {
  try {
    await store.refreshOverview()
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function selectWorkflow(workflowId: string) {
  await store.selectWorkflow(workflowId)
}

async function validateSelected() {
  try {
    const result = await store.validateSelected()
    if (result?.ok) {
      message.success(t('pages.comfyui.messages.validateSuccess'))
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function runSelected() {
  try {
    await store.runSelected()
    message.success(t('pages.comfyui.messages.runStarted'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const workflowColumns = computed<DataTableColumns<ComfyUiWorkflowSummary>>(() => [
  {
    title: () => t('pages.comfyui.fields.workflowId'),
    key: 'workflowId',
    minWidth: 180,
    render: (row) => h(NText, { code: true }, { default: () => truncate(row.workflowId, 32) }),
  },
  {
    title: () => t('pages.comfyui.fields.mediaKind'),
    key: 'mediaKind',
    width: 120,
    render: (row) => h(NTag, { size: 'small', bordered: false }, { default: () => row.mediaKind }),
  },
  {
    title: () => t('pages.comfyui.fields.lastRun'),
    key: 'lastRun',
    width: 130,
    render: (row) => renderStatusTag(row.lastRun?.status),
  },
  {
    title: () => t('pages.comfyui.fields.outputCount'),
    key: 'outputCount',
    width: 110,
    align: 'right',
    render: (row) => renderCount(row.outputCount),
  },
])

const runColumns = computed<DataTableColumns<ComfyUiRunRecord>>(() => [
  {
    title: () => t('pages.comfyui.fields.promptId'),
    key: 'promptId',
    minWidth: 170,
    render: (row) => h(NText, { code: true }, { default: () => truncate(row.promptId, 28) }),
  },
  {
    title: () => t('pages.comfyui.fields.status'),
    key: 'status',
    width: 120,
    render: (row) => renderStatusTag(row.status),
  },
  {
    title: () => t('pages.comfyui.fields.startedAt'),
    key: 'startedAt',
    width: 190,
    render: (row) => formatOptionalDate(row.startedAt),
  },
  {
    title: () => t('pages.comfyui.fields.duration'),
    key: 'durationMs',
    width: 110,
    render: (row) => formatDuration(row.durationMs),
  },
  {
    title: () => t('pages.comfyui.fields.outputCount'),
    key: 'outputCount',
    width: 110,
    align: 'right',
    render: (row) => renderCount(row.outputs?.length ?? 0),
  },
])

const outputColumns = computed<DataTableColumns<ComfyUiOutputSummary>>(() => [
  {
    title: () => t('pages.comfyui.fields.mediaKind'),
    key: 'kind',
    width: 110,
    render: (row) => h(NTag, { size: 'small', bordered: false }, { default: () => row.kind }),
  },
  {
    title: () => t('pages.comfyui.fields.filename'),
    key: 'filename',
    minWidth: 220,
    render: (row) => h(NText, { code: true }, { default: () => row.filename }),
  },
  {
    title: () => t('pages.comfyui.fields.promptId'),
    key: 'promptId',
    minWidth: 170,
    render: (row) => h(NText, { code: true }, { default: () => truncate(row.promptId, 28) }),
  },
  {
    title: () => t('pages.comfyui.fields.createdAt'),
    key: 'createdAt',
    width: 190,
    render: (row) => formatOptionalDate(row.createdAt),
  },
  {
    title: () => t('pages.comfyui.download'),
    key: 'download',
    width: 120,
    render: (row) => row.localPath
      ? h(
          NButton,
          {
            tag: 'a',
            href: outputDownloadUrl(row),
            download: row.filename,
            size: 'small',
            secondary: true,
            type: 'primary',
            renderIcon: renderIcon(DownloadOutline),
          },
          { default: () => t('pages.comfyui.download') }
        )
      : '-',
  },
])

onMounted(() => {
  void refreshOverview()
})
</script>

<template>
  <div class="comfyui-page">
    <div class="page-header">
      <div>
        <h1>{{ t('pages.comfyui.title') }}</h1>
        <p>{{ t('pages.comfyui.subtitle') }}</p>
      </div>
      <NSpace>
        <NButton :loading="store.loading" @click="refreshOverview">
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
          {{ t('pages.comfyui.refresh') }}
        </NButton>
        <NButton type="primary" :disabled="!canOpenComfyUi" @click="store.openComfyUi">
          <template #icon>
            <NIcon :component="OpenOutline" />
          </template>
          {{ t('pages.comfyui.openComfyUi') }}
        </NButton>
      </NSpace>
    </div>

    <NAlert v-if="store.lastError" type="error" class="page-alert" closable>
      {{ store.lastError }}
    </NAlert>

    <NSpin :show="isBusy">
      <NSpace vertical size="large">
        <NCard>
          <div class="status-list">
            <div class="status-item">
              <span class="status-label">{{ t('pages.comfyui.status.baseUrl') }}</span>
              <NText code class="status-value">{{ store.status?.baseUrl || '-' }}</NText>
            </div>
            <div class="status-item">
              <span class="status-label">{{ t('pages.comfyui.status.workflowsDir') }}</span>
              <NText code class="status-value">{{ store.status?.workflowsDir || '-' }}</NText>
            </div>
            <div class="status-item">
              <span class="status-label">{{ t('pages.comfyui.status.outputDir') }}</span>
              <NText code class="status-value">{{ store.status?.outputDir || '-' }}</NText>
            </div>
          </div>
        </NCard>

        <NGrid :cols="12" :x-gap="16" :y-gap="16" responsive="screen">
          <NGridItem :span="12" :lg="5">
            <NCard :title="t('pages.comfyui.sections.workflows')">
              <NDataTable
                :columns="workflowColumns"
                :data="store.workflows"
                :loading="store.loading"
                :pagination="{ pageSize: 8 }"
                :row-key="(row) => row.workflowId"
                size="small"
                max-height="420"
                :scroll-x="540"
                :row-props="(row) => ({
                  class: row.workflowId === store.selectedWorkflowId ? 'selected-row' : '',
                  onClick: () => selectWorkflow(row.workflowId)
                })"
              />
              <NEmpty v-if="!store.loading && store.workflows.length === 0" :description="t('pages.comfyui.empty.workflows')" />
            </NCard>
          </NGridItem>

          <NGridItem :span="12" :lg="7">
            <NCard :title="t('pages.comfyui.sections.detail')">
              <template #header-extra>
                <NSpace>
                  <NButton
                    size="small"
                    :disabled="!store.selectedWorkflowId"
                    :loading="store.validating"
                    @click="validateSelected"
                  >
                    <template #icon>
                      <NIcon :component="CheckmarkCircleOutline" />
                    </template>
                    {{ t('pages.comfyui.validate') }}
                  </NButton>
                  <NPopconfirm
                    :positive-text="t('common.confirm')"
                    :negative-text="t('common.cancel')"
                    @positive-click="runSelected"
                  >
                    <template #trigger>
                      <NButton
                        size="small"
                        type="primary"
                        :disabled="!store.selectedWorkflowId"
                        :loading="store.running"
                      >
                        <template #icon>
                          <NIcon :component="PlayOutline" />
                        </template>
                        {{ t('pages.comfyui.run') }}
                      </NButton>
                    </template>
                    <div class="confirm-content">
                      <strong>{{ t('pages.comfyui.runConfirmTitle') }}</strong>
                      <p>{{ t('pages.comfyui.runConfirmDescription') }}</p>
                    </div>
                  </NPopconfirm>
                </NSpace>
              </template>

              <NSpin :show="store.detailsLoading">
                <template v-if="selectedWorkflow || selectedSummary">
                  <NDescriptions :column="2" label-placement="top" bordered>
                    <NDescriptionsItem :label="t('pages.comfyui.fields.goal')" :span="2">
                      {{ selectedWorkflow?.meta.goal || selectedSummary?.goal || '-' }}
                    </NDescriptionsItem>
                    <NDescriptionsItem :label="t('pages.comfyui.fields.workflowId')">
                      <NText code>{{ selectedWorkflow?.workflowId || selectedSummary?.workflowId || '-' }}</NText>
                    </NDescriptionsItem>
                    <NDescriptionsItem :label="t('pages.comfyui.fields.mediaKind')">
                      {{ selectedWorkflow?.meta.mediaKind || selectedSummary?.mediaKind || '-' }}
                    </NDescriptionsItem>
                    <NDescriptionsItem :label="t('pages.comfyui.fields.lastRun')">
                      <NTag size="small" :type="statusTagType(selectedSummary?.lastRun?.status)">
                        {{ statusLabel(selectedSummary?.lastRun?.status) }}
                      </NTag>
                    </NDescriptionsItem>
                    <NDescriptionsItem :label="t('pages.comfyui.fields.outputCount')">
                      {{ selectedWorkflow?.meta.outputs?.length ?? selectedSummary?.outputCount ?? 0 }}
                    </NDescriptionsItem>
                    <NDescriptionsItem :label="t('pages.comfyui.fields.createdAt')">
                      {{ formatOptionalDate(selectedWorkflow?.meta.createdAt || selectedSummary?.createdAt) }}
                    </NDescriptionsItem>
                    <NDescriptionsItem :label="t('pages.comfyui.fields.updatedAt')">
                      {{ formatOptionalDate(selectedWorkflow?.meta.updatedAt || selectedSummary?.updatedAt) }}
                    </NDescriptionsItem>
                    <NDescriptionsItem :label="t('pages.comfyui.fields.diagnosticsCount')">
                      {{ diagnostics.length }}
                    </NDescriptionsItem>
                    <NDescriptionsItem :label="t('pages.comfyui.fields.promptId')">
                      <NText code>{{ selectedWorkflow?.meta.promptId || selectedSummary?.promptId || '-' }}</NText>
                    </NDescriptionsItem>
                  </NDescriptions>
                </template>
                <NEmpty v-else :description="t('pages.comfyui.empty.selected')" />
              </NSpin>
            </NCard>
          </NGridItem>
        </NGrid>

        <NGrid :cols="12" :x-gap="16" :y-gap="16" responsive="screen">
          <NGridItem :span="12" :lg="4">
            <NCard :title="t('pages.comfyui.sections.diagnostics')">
              <NSpace v-if="diagnostics.length > 0" vertical size="small">
                <NAlert
                  v-for="diagnostic in diagnostics"
                  :key="`${diagnostic.code}:${diagnostic.nodeId || ''}:${diagnostic.field || ''}:${diagnostic.message}`"
                  :type="diagnosticTagType(diagnostic)"
                  :show-icon="false"
                >
                  <div class="diagnostic-row">
                    <NIcon :component="diagnosticIcon(diagnostic)" />
                    <div>
                      <NSpace size="small" align="center">
                        <NTag size="small" :type="diagnosticTagType(diagnostic)">
                          {{ diagnostic.severity }}
                        </NTag>
                        <NText code>{{ diagnostic.code }}</NText>
                      </NSpace>
                      <div class="diagnostic-message">{{ diagnostic.message }}</div>
                      <NText v-if="diagnostic.repairHint" depth="3">{{ diagnostic.repairHint }}</NText>
                    </div>
                  </div>
                </NAlert>
              </NSpace>
              <NEmpty v-else :description="t('pages.comfyui.empty.diagnostics')" />
            </NCard>
          </NGridItem>

          <NGridItem :span="12" :lg="8">
            <NCard :title="t('pages.comfyui.sections.runs')">
              <NDataTable
                :columns="runColumns"
                :data="store.runs"
                :loading="store.runsLoading"
                :pagination="{ pageSize: 8 }"
                size="small"
                :scroll-x="700"
              />
              <NEmpty v-if="!store.runsLoading && store.runs.length === 0" :description="t('pages.comfyui.empty.runs')" />
            </NCard>
          </NGridItem>
        </NGrid>

        <NCard :title="t('pages.comfyui.sections.outputs')">
          <NDataTable
            :columns="outputColumns"
            :data="store.outputs"
            :loading="store.outputsLoading"
            :pagination="{ pageSize: 10 }"
            size="small"
            :scroll-x="950"
          />
          <NEmpty v-if="!store.outputsLoading && store.outputs.length === 0" :description="t('pages.comfyui.empty.outputs')" />
        </NCard>
      </NSpace>
    </NSpin>
  </div>
</template>

<style scoped>
.comfyui-page {
  padding: 24px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.25;
}

.page-header p {
  margin: 6px 0 0;
  color: var(--text-color-2);
}

.page-alert {
  margin-bottom: 16px;
}

.status-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.status-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.status-label {
  color: var(--text-color-2);
  font-size: 13px;
  line-height: 1.35;
}

.status-value {
  display: block;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.confirm-content {
  max-width: 260px;
}

.confirm-content p {
  margin: 6px 0 0;
  color: var(--text-color-2);
}

.diagnostic-row {
  display: flex;
  gap: 10px;
}

.diagnostic-message {
  margin: 6px 0 4px;
}

:deep(.selected-row td) {
  background: var(--table-color-hover);
}

:deep(.n-data-table-tr) {
  cursor: pointer;
}

@media (max-width: 720px) {
  .comfyui-page {
    padding: 16px;
  }

  .status-list {
    grid-template-columns: 1fr;
  }

  .page-header {
    flex-direction: column;
  }
}
</style>
