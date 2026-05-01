import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type {
  WorkflowExecutionView,
  WorkflowGetResult,
  WorkflowListEntry,
  WorkflowN8nDetailsResult,
} from '@/api/types'

export const useWorkflowStore = defineStore('workflow', () => {
  const workflows = ref<WorkflowListEntry[]>([])
  const selectedWorkflowId = ref<string | null>(null)
  const selectedDetails = ref<WorkflowGetResult | null>(null)
  const n8nDetails = ref<WorkflowN8nDetailsResult | null>(null)
  const runs = ref<WorkflowExecutionView[]>([])
  const loading = ref(false)
  const detailsLoading = ref(false)
  const n8nLoading = ref(false)
  const runsLoading = ref(false)
  const saving = ref(false)
  const lastError = ref<string | null>(null)
  const n8nError = ref<string | null>(null)

  const wsStore = useWebSocketStore()

  async function fetchWorkflows() {
    loading.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.listWorkflows()
      workflows.value = result.workflows
      if (
        selectedWorkflowId.value &&
        !workflows.value.some((workflow) => workflow.workflowId === selectedWorkflowId.value)
      ) {
        selectedWorkflowId.value = null
        selectedDetails.value = null
        n8nDetails.value = null
        runs.value = []
      }
    } catch (error) {
      workflows.value = []
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[WorkflowStore] fetchWorkflows failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function fetchWorkflowDetails(workflowId: string) {
    detailsLoading.value = true
    lastError.value = null
    try {
      selectedDetails.value = await wsStore.rpc.getWorkflow(workflowId, 10)
    } catch (error) {
      selectedDetails.value = null
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[WorkflowStore] fetchWorkflowDetails failed:', error)
    } finally {
      detailsLoading.value = false
    }
  }

  async function fetchN8nDetails(workflowId: string) {
    n8nLoading.value = true
    n8nError.value = null
    try {
      n8nDetails.value = await wsStore.rpc.getWorkflowN8nDetails(workflowId, { executionsLimit: 10 })
    } catch (error) {
      n8nDetails.value = null
      n8nError.value = error instanceof Error ? error.message : String(error)
      console.warn('[WorkflowStore] fetchN8nDetails failed:', error)
    } finally {
      n8nLoading.value = false
    }
  }

  async function fetchRuns(workflowId?: string, limit = 30) {
    runsLoading.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.listWorkflowRuns(workflowId, limit)
      runs.value = result.executions
    } catch (error) {
      runs.value = []
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[WorkflowStore] fetchRuns failed:', error)
    } finally {
      runsLoading.value = false
    }
  }

  async function fetchOverview() {
    await fetchWorkflows()
    const firstWorkflowId = workflows.value[0]?.workflowId
    if (!selectedWorkflowId.value && firstWorkflowId) {
      await selectWorkflow(firstWorkflowId)
      return
    }
    if (selectedWorkflowId.value) {
      await refreshSelected()
    }
  }

  async function selectWorkflow(workflowId: string) {
    selectedWorkflowId.value = workflowId
    await Promise.all([
      fetchWorkflowDetails(workflowId),
      fetchN8nDetails(workflowId),
      fetchRuns(workflowId),
    ])
  }

  async function refreshSelected() {
    if (!selectedWorkflowId.value) {return}
    await Promise.all([
      fetchWorkflowDetails(selectedWorkflowId.value),
      fetchN8nDetails(selectedWorkflowId.value),
      fetchRuns(selectedWorkflowId.value),
    ])
  }

  async function deployWorkflow(workflowId: string) {
    saving.value = true
    lastError.value = null
    try {
      await wsStore.rpc.deployWorkflow(workflowId)
      await fetchWorkflows()
      await selectWorkflow(workflowId)
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function runWorkflow(workflowId: string, inputs?: Record<string, unknown>) {
    saving.value = true
    lastError.value = null
    try {
      await wsStore.rpc.runWorkflow(workflowId, inputs, true)
      await fetchWorkflows()
      await selectWorkflow(workflowId)
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function setWorkflowEnabled(workflowId: string, enabled: boolean) {
    saving.value = true
    lastError.value = null
    try {
      if (enabled) {
        await wsStore.rpc.enableWorkflow(workflowId)
      } else {
        await wsStore.rpc.disableWorkflow(workflowId)
      }
      await fetchWorkflows()
      await refreshSelected()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function setWorkflowArchived(workflowId: string, archived: boolean) {
    saving.value = true
    lastError.value = null
    try {
      if (archived) {
        await wsStore.rpc.archiveWorkflow(workflowId)
      } else {
        await wsStore.rpc.unarchiveWorkflow(workflowId)
      }
      await fetchWorkflows()
      await refreshSelected()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function deleteWorkflow(workflowId: string) {
    saving.value = true
    lastError.value = null
    try {
      await wsStore.rpc.deleteWorkflow(workflowId)
      if (selectedWorkflowId.value === workflowId) {
        selectedWorkflowId.value = null
        selectedDetails.value = null
        n8nDetails.value = null
        runs.value = []
      }
      await fetchWorkflows()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function cancelExecution(executionId: string) {
    saving.value = true
    lastError.value = null
    try {
      await wsStore.rpc.cancelWorkflowExecution(executionId)
      await refreshSelected()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function resumeExecution(executionId: string, input?: string) {
    saving.value = true
    lastError.value = null
    try {
      await wsStore.rpc.resumeWorkflowExecution(executionId, input)
      await refreshSelected()
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  return {
    workflows,
    selectedWorkflowId,
    selectedDetails,
    n8nDetails,
    runs,
    loading,
    detailsLoading,
    n8nLoading,
    runsLoading,
    saving,
    lastError,
    n8nError,
    fetchWorkflows,
    fetchWorkflowDetails,
    fetchN8nDetails,
    fetchRuns,
    fetchOverview,
    selectWorkflow,
    refreshSelected,
    deployWorkflow,
    runWorkflow,
    setWorkflowEnabled,
    setWorkflowArchived,
    deleteWorkflow,
    cancelExecution,
    resumeExecution,
  }
})
