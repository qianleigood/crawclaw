<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NCode,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NPopconfirm,
  NSpace,
  NSpin,
  NStatistic,
  NTabPane,
  NTabs,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import {
  ArchiveOutline,
  CheckmarkCircleOutline,
  CloudUploadOutline,
  LinkOutline,
  PauseCircleOutline,
  PlayOutline,
  RefreshOutline,
  StopCircleOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { useI18n } from 'vue-i18n'
import { useWorkflowStore } from '@/stores/workflow'
import type {
  N8nExecutionRecord,
  N8nWorkflowNodeRecord,
  WorkflowExecutionStatus,
  WorkflowExecutionView,
  WorkflowFieldSpec,
  WorkflowListEntry,
  WorkflowStepSpec,
} from '@/api/types'
import { formatDate, formatRelativeTime, truncate } from '@/utils/format'

type TagType = 'default' | 'info' | 'success' | 'warning' | 'error'

const workflowStore = useWorkflowStore()
const message = useMessage()
const { t } = useI18n()

const searchQuery = ref('')
const showRunModal = ref(false)
const showResumeModal = ref(false)
const runInputText = ref('{}')
const resumeInputText = ref('')
const runTarget = ref<WorkflowListEntry | null>(null)
const resumeTarget = ref<WorkflowExecutionView | null>(null)

const filteredWorkflows = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return workflowStore.workflows

  return workflowStore.workflows.filter((workflow) =>
    [
      workflow.workflowId,
      workflow.name,
      workflow.description || '',
      workflow.n8nWorkflowId || '',
      workflow.deploymentState,
      ...workflow.tags,
    ].some((field) => field.toLowerCase().includes(query))
  )
})

const visibleRuns = computed(() =>
  workflowStore.selectedDetails?.recentExecutions?.length
    ? workflowStore.selectedDetails.recentExecutions
    : workflowStore.runs
)
const selectedWorkflow = computed<WorkflowListEntry | null>(() => {
  const listed = workflowStore.workflows.find(
    (workflow) => workflow.workflowId === workflowStore.selectedWorkflowId
  )
  if (listed) return listed

  const workflow = workflowStore.selectedDetails?.workflow
  if (!workflow) return null
  return {
    ...workflow,
    runCount: visibleRuns.value.length,
    recentExecution: visibleRuns.value[0] || null,
  }
})
const selectedSpec = computed(() => workflowStore.selectedDetails?.spec || null)
const n8nNodes = computed(() => workflowStore.n8nDetails?.remoteWorkflow.nodes || [])
const n8nExecutions = computed(() => workflowStore.n8nDetails?.remoteExecutions || [])
const n8nConnectionsText = computed(() =>
  JSON.stringify(workflowStore.n8nDetails?.remoteWorkflow.connections || {}, null, 2)
)

const stats = computed(() => {
  const workflows = workflowStore.workflows
  return {
    total: workflows.length,
    deployed: workflows.filter((workflow) => workflow.deploymentState === 'deployed').length,
    enabled: workflows.filter((workflow) => workflow.enabled && !workflow.archivedAt).length,
    running: workflows.filter((workflow) => {
      const status = workflow.recentExecution?.status
      return status === 'running' || status === 'waiting_input' || status === 'waiting_external'
    }).length,
  }
})

function renderIcon(icon: Component) {
  return () => h(NIcon, { component: icon })
}

function workflowDeploymentTagType(workflow: WorkflowListEntry): TagType {
  if (workflow.archivedAt) return 'default'
  if (workflow.deploymentState === 'deployed') return 'success'
  return 'warning'
}

function executionStatusTagType(status?: string): TagType {
  switch (status) {
    case 'succeeded':
    case 'success':
      return 'success'
    case 'failed':
    case 'error':
      return 'error'
    case 'running':
      return 'info'
    case 'waiting_input':
    case 'waiting_external':
      return 'warning'
    case 'cancelled':
      return 'default'
    default:
      return 'default'
  }
}

function workflowStatusLabel(workflow: WorkflowListEntry): string {
  if (workflow.archivedAt) return t('pages.workflows.workflowStatus.archived')
  if (workflow.deploymentState === 'deployed') return t('pages.workflows.workflowStatus.deployed')
  return t('pages.workflows.workflowStatus.draft')
}

function executionStatusLabel(status?: string): string {
  if (!status) return '-'
  return t(`pages.workflows.executionStatuses.${status}`, status)
}

function formatOptionalDate(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === '') return '-'
  return formatDate(value)
}

function formatOptionalRelative(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === '') return '-'
  return formatRelativeTime(value)
}

function openUrl(url?: string) {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function refreshAll() {
  await workflowStore.fetchOverview()
}

async function selectWorkflow(workflowId: string) {
  await workflowStore.selectWorkflow(workflowId)
}

async function deployWorkflow(workflow: WorkflowListEntry) {
  try {
    await workflowStore.deployWorkflow(workflow.workflowId)
    message.success(t('pages.workflows.messages.deployed'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

function openRunModal(workflow: WorkflowListEntry) {
  runTarget.value = workflow
  runInputText.value = '{}'
  showRunModal.value = true
}

async function submitRun() {
  if (!runTarget.value) return

  let inputs: Record<string, unknown> | undefined
  const raw = runInputText.value.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        message.error(t('pages.workflows.messages.inputsMustBeObject'))
        return
      }
      inputs = parsed as Record<string, unknown>
    } catch {
      message.error(t('pages.workflows.messages.invalidJson'))
      return
    }
  }

  try {
    await workflowStore.runWorkflow(runTarget.value.workflowId, inputs)
    showRunModal.value = false
    message.success(t('pages.workflows.messages.runStarted'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function setEnabled(workflow: WorkflowListEntry, enabled: boolean) {
  try {
    await workflowStore.setWorkflowEnabled(workflow.workflowId, enabled)
    message.success(enabled ? t('pages.workflows.messages.enabled') : t('pages.workflows.messages.disabled'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function setArchived(workflow: WorkflowListEntry, archived: boolean) {
  try {
    await workflowStore.setWorkflowArchived(workflow.workflowId, archived)
    message.success(archived ? t('pages.workflows.messages.archived') : t('pages.workflows.messages.unarchived'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function deleteWorkflow(workflow: WorkflowListEntry) {
  try {
    await workflowStore.deleteWorkflow(workflow.workflowId)
    message.success(t('pages.workflows.messages.deleted'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

function openResumeModal(execution: WorkflowExecutionView) {
  resumeTarget.value = execution
  resumeInputText.value = ''
  showResumeModal.value = true
}

async function submitResume() {
  if (!resumeTarget.value) return
  try {
    await workflowStore.resumeExecution(resumeTarget.value.executionId, resumeInputText.value)
    showResumeModal.value = false
    message.success(t('pages.workflows.messages.resumed'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function cancelExecution(execution: WorkflowExecutionView) {
  try {
    await workflowStore.cancelExecution(execution.executionId)
    message.success(t('pages.workflows.messages.cancelled'))
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const workflowColumns = computed<DataTableColumns<WorkflowListEntry>>(() => [
  {
    title: t('pages.workflows.columns.workflow'),
    key: 'name',
    minWidth: 240,
    render(row) {
      return h('button', {
        class: [
          'workflow-name-button',
          row.workflowId === workflowStore.selectedWorkflowId ? 'is-active' : '',
        ],
        onClick: () => selectWorkflow(row.workflowId),
      }, [
        h('span', { class: 'workflow-name' }, row.name),
        h('span', { class: 'workflow-id' }, row.workflowId),
      ])
    },
  },
  {
    title: t('pages.workflows.columns.status'),
    key: 'status',
    width: 150,
    render(row) {
      return h(NSpace, { size: 6, vertical: true }, {
        default: () => [
          h(NTag, { size: 'small', type: workflowDeploymentTagType(row) }, {
            default: () => workflowStatusLabel(row),
          }),
          h(NTag, { size: 'small', type: row.enabled ? 'success' : 'default' }, {
            default: () => (row.enabled ? t('common.enabled') : t('common.disabled')),
          }),
        ],
      })
    },
  },
  {
    title: t('pages.workflows.columns.n8n'),
    key: 'n8nWorkflowId',
    minWidth: 170,
    render(row) {
      return row.n8nWorkflowId
        ? h(NText, { code: true }, { default: () => row.n8nWorkflowId })
        : h(NText, { depth: 3 }, { default: () => t('pages.workflows.notDeployed') })
    },
  },
  {
    title: t('pages.workflows.columns.recentRun'),
    key: 'recentRun',
    minWidth: 160,
    render(row) {
      const execution = row.recentExecution
      if (!execution) return h(NText, { depth: 3 }, { default: () => t('common.empty') })
      return h(NSpace, { size: 4, vertical: true }, {
        default: () => [
          h(NTag, { size: 'small', type: executionStatusTagType(execution.status) }, {
            default: () => executionStatusLabel(execution.status),
          }),
          h(NText, { depth: 3 }, {
            default: () => formatOptionalRelative(execution.updatedAt || execution.startedAt),
          }),
        ],
      })
    },
  },
  {
    title: t('pages.workflows.columns.actions'),
    key: 'actions',
    width: 380,
    render(row) {
      return h(NSpace, { size: 6 }, {
        default: () => [
          h(NButton, {
            size: 'small',
            type: 'primary',
            secondary: true,
            disabled: workflowStore.saving || !!row.archivedAt,
            onClick: () => openRunModal(row),
          }, { icon: renderIcon(PlayOutline), default: () => t('pages.workflows.actions.run') }),
          h(NButton, {
            size: 'small',
            secondary: true,
            disabled: workflowStore.saving,
            onClick: () => deployWorkflow(row),
          }, { icon: renderIcon(CloudUploadOutline), default: () => t('pages.workflows.actions.deploy') }),
          h(NButton, {
            size: 'small',
            secondary: true,
            disabled: workflowStore.saving,
            onClick: () => setEnabled(row, !row.enabled),
          }, {
            icon: renderIcon(row.enabled ? PauseCircleOutline : CheckmarkCircleOutline),
            default: () => (row.enabled ? t('pages.workflows.actions.disable') : t('pages.workflows.actions.enable')),
          }),
          h(NButton, {
            size: 'small',
            quaternary: true,
            disabled: workflowStore.saving,
            onClick: () => setArchived(row, !row.archivedAt),
          }, {
            icon: renderIcon(ArchiveOutline),
            default: () => (row.archivedAt ? t('pages.workflows.actions.unarchive') : t('pages.workflows.actions.archive')),
          }),
          h(NPopconfirm, { onPositiveClick: () => deleteWorkflow(row) }, {
            trigger: () => h(NButton, {
              size: 'small',
              quaternary: true,
              type: 'error',
              disabled: workflowStore.saving,
            }, { icon: renderIcon(TrashOutline), default: () => t('common.delete') }),
            default: () => t('pages.workflows.confirmDelete'),
          }),
        ],
      })
    },
  },
])

const fieldColumns = computed<DataTableColumns<WorkflowFieldSpec>>(() => [
  { title: t('pages.workflows.columns.name'), key: 'name', minWidth: 120 },
  { title: t('pages.workflows.columns.type'), key: 'type', width: 120 },
  {
    title: t('pages.workflows.columns.required'),
    key: 'required',
    width: 100,
    render(row) {
      return h(NTag, { size: 'small', type: row.required ? 'warning' : 'default' }, {
        default: () => (row.required ? t('pages.workflows.required') : t('pages.workflows.optional')),
      })
    },
  },
  { title: t('pages.workflows.columns.description'), key: 'description', minWidth: 180 },
])

const stepColumns = computed<DataTableColumns<WorkflowStepSpec>>(() => [
  { title: t('pages.workflows.columns.step'), key: 'id', minWidth: 150 },
  { title: t('pages.workflows.columns.kind'), key: 'kind', width: 130 },
  {
    title: t('pages.workflows.columns.title'),
    key: 'title',
    minWidth: 190,
    render(row) {
      return row.title || row.goal || row.service || '-'
    },
  },
  {
    title: t('pages.workflows.columns.path'),
    key: 'path',
    minWidth: 130,
    render(row) {
      return row.path || row.branchGroup || '-'
    },
  },
])

const runColumns = computed<DataTableColumns<WorkflowExecutionView>>(() => [
  {
    title: t('pages.workflows.columns.execution'),
    key: 'executionId',
    minWidth: 170,
    render(row) {
      return h(NSpace, { size: 4, vertical: true }, {
        default: () => [
          h(NText, { code: true }, { default: () => truncate(row.executionId, 22) }),
          row.n8nExecutionId
            ? h(NText, { depth: 3 }, { default: () => `n8n: ${truncate(row.n8nExecutionId || '', 22)}` })
            : null,
        ],
      })
    },
  },
  {
    title: t('pages.workflows.columns.status'),
    key: 'status',
    width: 140,
    render(row) {
      return h(NTag, { size: 'small', type: executionStatusTagType(row.status) }, {
        default: () => executionStatusLabel(row.status),
      })
    },
  },
  {
    title: t('pages.workflows.columns.currentStep'),
    key: 'currentStepId',
    minWidth: 150,
    render(row) {
      return row.currentStepId || row.currentExecutor || '-'
    },
  },
  {
    title: t('pages.workflows.columns.updatedAt'),
    key: 'updatedAt',
    minWidth: 160,
    render(row) {
      return formatOptionalRelative(row.updatedAt || row.startedAt)
    },
  },
  {
    title: t('pages.workflows.columns.actions'),
    key: 'actions',
    width: 180,
    render(row) {
      const canResume =
        row.waiting?.canResume || row.status === 'waiting_input' || row.status === 'waiting_external'
      const canCancel = row.status === 'running' || canResume
      return h(NSpace, { size: 6 }, {
        default: () => [
          h(NButton, {
            size: 'small',
            disabled: !canResume || workflowStore.saving,
            onClick: () => openResumeModal(row),
          }, { default: () => t('pages.workflows.actions.resume') }),
          h(NPopconfirm, { onPositiveClick: () => cancelExecution(row) }, {
            trigger: () => h(NButton, {
              size: 'small',
              disabled: !canCancel || workflowStore.saving,
              type: 'error',
              secondary: true,
            }, { icon: renderIcon(StopCircleOutline), default: () => t('pages.workflows.actions.cancel') }),
            default: () => t('pages.workflows.confirmCancel'),
          }),
        ],
      })
    },
  },
])

const n8nNodeColumns = computed<DataTableColumns<N8nWorkflowNodeRecord>>(() => [
  { title: t('pages.workflows.columns.node'), key: 'name', minWidth: 180 },
  { title: t('pages.workflows.columns.type'), key: 'type', minWidth: 220 },
  {
    title: t('pages.workflows.columns.state'),
    key: 'disabled',
    width: 120,
    render(row) {
      return h(NTag, { size: 'small', type: row.disabled ? 'default' : 'success' }, {
        default: () => (row.disabled ? t('common.disabled') : t('common.enabled')),
      })
    },
  },
])

const n8nExecutionColumns = computed<DataTableColumns<N8nExecutionRecord>>(() => [
  {
    title: t('pages.workflows.columns.execution'),
    key: 'id',
    minWidth: 160,
    render(row) {
      return h(NText, { code: true }, { default: () => truncate(row.id || row.executionId || '-', 22) })
    },
  },
  {
    title: t('pages.workflows.columns.status'),
    key: 'status',
    width: 130,
    render(row) {
      return h(NTag, { size: 'small', type: executionStatusTagType(row.status) }, {
        default: () => row.status || '-',
      })
    },
  },
  {
    title: t('pages.workflows.columns.startedAt'),
    key: 'startedAt',
    minWidth: 160,
    render(row) {
      return formatOptionalDate(row.startedAt)
    },
  },
  {
    title: t('pages.workflows.columns.stoppedAt'),
    key: 'stoppedAt',
    minWidth: 160,
    render(row) {
      return formatOptionalDate(row.stoppedAt)
    },
  },
])

onMounted(() => {
  refreshAll()
})
</script>

<template>
  <div class="workflows-page">
    <div class="page-header">
      <div>
        <h1>{{ t('pages.workflows.title') }}</h1>
        <p>{{ t('pages.workflows.subtitle') }}</p>
      </div>
      <NSpace>
        <NButton :loading="workflowStore.loading" @click="refreshAll">
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
          {{ t('common.refresh') }}
        </NButton>
      </NSpace>
    </div>

    <NAlert v-if="workflowStore.lastError" type="error" closable class="page-alert">
      {{ workflowStore.lastError }}
    </NAlert>

    <div class="stats-grid">
      <NCard>
        <NStatistic :label="t('pages.workflows.stats.total')" :value="stats.total" />
      </NCard>
      <NCard>
        <NStatistic :label="t('pages.workflows.stats.deployed')" :value="stats.deployed" />
      </NCard>
      <NCard>
        <NStatistic :label="t('pages.workflows.stats.enabled')" :value="stats.enabled" />
      </NCard>
      <NCard>
        <NStatistic :label="t('pages.workflows.stats.running')" :value="stats.running" />
      </NCard>
    </div>

    <div class="content-grid">
      <NCard class="list-card">
        <template #header>
          <div class="card-header">
            <span>{{ t('pages.workflows.listTitle') }}</span>
            <NInput
              v-model:value="searchQuery"
              clearable
              size="small"
              class="search-input"
              :placeholder="t('pages.workflows.searchPlaceholder')"
            />
          </div>
        </template>
        <NDataTable
          :columns="workflowColumns"
          :data="filteredWorkflows"
          :loading="workflowStore.loading"
          :pagination="{ pageSize: 8 }"
          :row-key="(row: WorkflowListEntry) => row.workflowId"
          size="small"
          :scroll-x="920"
        />
      </NCard>

      <NCard v-if="selectedWorkflow" class="detail-card">
        <template #header>
          <div class="detail-title">
            <div>
              <span>{{ selectedWorkflow.name }}</span>
              <NText depth="3">{{ selectedWorkflow.workflowId }}</NText>
            </div>
            <NSpace>
              <NButton
                size="small"
                type="primary"
                secondary
                :disabled="workflowStore.saving || !!selectedWorkflow.archivedAt"
                @click="openRunModal(selectedWorkflow)"
              >
                <template #icon>
                  <NIcon :component="PlayOutline" />
                </template>
                {{ t('pages.workflows.actions.run') }}
              </NButton>
              <NButton
                size="small"
                :disabled="workflowStore.saving"
                @click="deployWorkflow(selectedWorkflow)"
              >
                <template #icon>
                  <NIcon :component="CloudUploadOutline" />
                </template>
                {{ t('pages.workflows.actions.deploy') }}
              </NButton>
            </NSpace>
          </div>
        </template>

        <NTabs type="line" animated>
          <NTabPane name="overview" :tab="t('pages.workflows.tabs.overview')">
            <NSpin :show="workflowStore.detailsLoading">
              <NSpace vertical size="large">
                <NDescriptions bordered size="small" :column="2" label-placement="top">
                  <NDescriptionsItem :label="t('pages.workflows.fields.status')">
                    <NSpace size="small">
                      <NTag :type="workflowDeploymentTagType(selectedWorkflow)" size="small">
                        {{ workflowStatusLabel(selectedWorkflow) }}
                      </NTag>
                      <NTag :type="selectedWorkflow.enabled ? 'success' : 'default'" size="small">
                        {{ selectedWorkflow.enabled ? t('common.enabled') : t('common.disabled') }}
                      </NTag>
                    </NSpace>
                  </NDescriptionsItem>
                  <NDescriptionsItem :label="t('pages.workflows.fields.n8nWorkflowId')">
                    <NText v-if="selectedWorkflow.n8nWorkflowId" code>
                      {{ selectedWorkflow.n8nWorkflowId }}
                    </NText>
                    <NText v-else depth="3">{{ t('pages.workflows.notDeployed') }}</NText>
                  </NDescriptionsItem>
                  <NDescriptionsItem :label="t('pages.workflows.fields.goal')">
                    {{ selectedSpec?.goal || selectedWorkflow.description || '-' }}
                  </NDescriptionsItem>
                  <NDescriptionsItem :label="t('pages.workflows.fields.updatedAt')">
                    {{ formatOptionalDate(selectedWorkflow.updatedAt) }}
                  </NDescriptionsItem>
                  <NDescriptionsItem :label="t('pages.workflows.fields.tags')">
                    <NSpace v-if="selectedWorkflow.tags.length" size="small">
                      <NTag v-for="tag in selectedWorkflow.tags" :key="tag" size="small">
                        {{ tag }}
                      </NTag>
                    </NSpace>
                    <NText v-else depth="3">-</NText>
                  </NDescriptionsItem>
                  <NDescriptionsItem :label="t('pages.workflows.fields.invocation')">
                    <NText v-if="selectedWorkflow.invocation?.url" code>
                      {{ selectedWorkflow.invocation.url }}
                    </NText>
                    <NText v-else depth="3">-</NText>
                  </NDescriptionsItem>
                </NDescriptions>

                <div class="section">
                  <div class="section-title">{{ t('pages.workflows.sections.inputs') }}</div>
                  <NDataTable
                    :columns="fieldColumns"
                    :data="selectedSpec?.inputs || []"
                    size="small"
                    :pagination="false"
                    :scroll-x="520"
                  />
                </div>

                <div class="section">
                  <div class="section-title">{{ t('pages.workflows.sections.outputs') }}</div>
                  <NDataTable
                    :columns="fieldColumns"
                    :data="selectedSpec?.outputs || []"
                    size="small"
                    :pagination="false"
                    :scroll-x="520"
                  />
                </div>

                <div class="section">
                  <div class="section-title">{{ t('pages.workflows.sections.steps') }}</div>
                  <NDataTable
                    :columns="stepColumns"
                    :data="selectedSpec?.steps || []"
                    size="small"
                    :pagination="{ pageSize: 6 }"
                    :scroll-x="650"
                  />
                </div>
              </NSpace>
            </NSpin>
          </NTabPane>

          <NTabPane name="runs" :tab="t('pages.workflows.tabs.runs')">
            <NDataTable
              :columns="runColumns"
              :data="visibleRuns"
              :loading="workflowStore.runsLoading || workflowStore.detailsLoading"
              size="small"
              :pagination="{ pageSize: 8 }"
              :scroll-x="820"
            />
          </NTabPane>

          <NTabPane name="n8n" :tab="t('pages.workflows.tabs.n8n')">
            <NSpin :show="workflowStore.n8nLoading">
              <NAlert v-if="workflowStore.n8nError" type="warning" class="page-alert">
                {{ workflowStore.n8nError }}
              </NAlert>

              <NSpace v-if="workflowStore.n8nDetails" vertical size="large">
                <div class="n8n-header">
                  <div>
                    <div class="section-title">{{ workflowStore.n8nDetails.remoteWorkflow.name }}</div>
                    <NText code>{{ workflowStore.n8nDetails.remoteWorkflow.id }}</NText>
                  </div>
                  <NSpace>
                    <NTag :type="workflowStore.n8nDetails.remoteWorkflow.active ? 'success' : 'default'">
                      {{ workflowStore.n8nDetails.remoteWorkflow.active ? t('pages.workflows.n8n.active') : t('pages.workflows.n8n.inactive') }}
                    </NTag>
                    <NButton size="small" @click="openUrl(workflowStore.n8nDetails.remoteWorkflowUrl)">
                      <template #icon>
                        <NIcon :component="LinkOutline" />
                      </template>
                      {{ t('pages.workflows.actions.openWorkflow') }}
                    </NButton>
                    <NButton size="small" @click="openUrl(workflowStore.n8nDetails.remoteExecutionsUrl)">
                      <template #icon>
                        <NIcon :component="LinkOutline" />
                      </template>
                      {{ t('pages.workflows.actions.openExecutions') }}
                    </NButton>
                  </NSpace>
                </div>

                <NDescriptions bordered size="small" :column="2" label-placement="top">
                  <NDescriptionsItem :label="t('pages.workflows.fields.createdAt')">
                    {{ formatOptionalDate(workflowStore.n8nDetails.remoteWorkflow.createdAt) }}
                  </NDescriptionsItem>
                  <NDescriptionsItem :label="t('pages.workflows.fields.updatedAt')">
                    {{ formatOptionalDate(workflowStore.n8nDetails.remoteWorkflow.updatedAt) }}
                  </NDescriptionsItem>
                </NDescriptions>

                <div class="section">
                  <div class="section-title">{{ t('pages.workflows.sections.n8nNodes') }}</div>
                  <NDataTable
                    :columns="n8nNodeColumns"
                    :data="n8nNodes"
                    size="small"
                    :pagination="{ pageSize: 8 }"
                    :scroll-x="620"
                  />
                </div>

                <div class="section">
                  <div class="section-title">{{ t('pages.workflows.sections.n8nExecutions') }}</div>
                  <NDataTable
                    :columns="n8nExecutionColumns"
                    :data="n8nExecutions"
                    size="small"
                    :pagination="{ pageSize: 8 }"
                    :scroll-x="640"
                  />
                </div>

                <div class="section">
                  <div class="section-title">{{ t('pages.workflows.sections.connections') }}</div>
                  <NCode :code="n8nConnectionsText" language="json" word-wrap />
                </div>
              </NSpace>

              <NEmpty v-else-if="!workflowStore.n8nError" :description="t('pages.workflows.emptyN8n')" />
            </NSpin>
          </NTabPane>
        </NTabs>
      </NCard>

      <NCard v-else class="detail-card empty-detail">
        <NEmpty :description="t('pages.workflows.emptySelect')" />
      </NCard>
    </div>

    <NModal
      v-model:show="showRunModal"
      preset="card"
      :title="t('pages.workflows.runModal.title')"
      class="workflow-modal"
    >
      <NSpace vertical>
        <NAlert type="info">{{ t('pages.workflows.runModal.description') }}</NAlert>
        <NInput
          v-model:value="runInputText"
          type="textarea"
          :autosize="{ minRows: 8, maxRows: 16 }"
          placeholder="{ }"
        />
        <NSpace justify="end">
          <NButton @click="showRunModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="workflowStore.saving" @click="submitRun">
            <template #icon>
              <NIcon :component="PlayOutline" />
            </template>
            {{ t('pages.workflows.actions.run') }}
          </NButton>
        </NSpace>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="showResumeModal"
      preset="card"
      :title="t('pages.workflows.resumeModal.title')"
      class="workflow-modal"
    >
      <NSpace vertical>
        <NAlert type="info">{{ resumeTarget?.waiting?.prompt || t('pages.workflows.resumeModal.description') }}</NAlert>
        <NInput
          v-model:value="resumeInputText"
          type="textarea"
          :autosize="{ minRows: 5, maxRows: 12 }"
          :placeholder="t('pages.workflows.resumeModal.placeholder')"
        />
        <NSpace justify="end">
          <NButton @click="showResumeModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="workflowStore.saving" @click="submitResume">
            {{ t('pages.workflows.actions.resume') }}
          </NButton>
        </NSpace>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.workflows-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}

.page-header p {
  margin: 6px 0 0;
  color: var(--text-color-secondary);
}

.page-alert {
  margin-bottom: 4px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(420px, 0.9fr) minmax(0, 1.4fr);
  gap: 16px;
  align-items: start;
}

.card-header,
.detail-title,
.n8n-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.detail-title > div,
.n8n-header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.search-input {
  width: min(280px, 46vw);
}

.workflow-name-button {
  display: flex;
  width: 100%;
  min-width: 0;
  cursor: pointer;
  border: 0;
  background: transparent;
  color: inherit;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  text-align: left;
}

.workflow-name-button.is-active .workflow-name {
  color: var(--primary-color);
}

.workflow-name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-id {
  overflow: hidden;
  color: var(--text-color-3);
  font-family: var(--font-family-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-card {
  min-width: 0;
}

.empty-detail {
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.section {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 650;
}

.workflow-modal {
  width: min(720px, 92vw);
}

@media (max-width: 1180px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .page-header,
  .card-header,
  .detail-title,
  .n8n-header {
    align-items: stretch;
    flex-direction: column;
  }

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search-input {
    width: 100%;
  }
}
</style>
