import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type {
  ComfyUiDiagnostic,
  ComfyUiOutputSummary,
  ComfyUiRunRecord,
  ComfyUiRunResult,
  ComfyUiStatus,
  ComfyUiWorkflowDetail,
  ComfyUiWorkflowSummary,
} from '@/api/types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useComfyUiStore = defineStore('comfyui', () => {
  const status = ref<ComfyUiStatus | null>(null)
  const workflows = ref<ComfyUiWorkflowSummary[]>([])
  const selectedWorkflowId = ref<string | null>(null)
  const selectedWorkflow = ref<ComfyUiWorkflowDetail | null>(null)
  const runs = ref<ComfyUiRunRecord[]>([])
  const outputs = ref<ComfyUiOutputSummary[]>([])
  const validationDiagnostics = ref<ComfyUiDiagnostic[]>([])
  const lastRunResult = ref<ComfyUiRunResult | null>(null)
  const loading = ref(false)
  const detailsLoading = ref(false)
  const runsLoading = ref(false)
  const outputsLoading = ref(false)
  const validating = ref(false)
  const running = ref(false)
  const lastError = ref<string | null>(null)

  const wsStore = useWebSocketStore()

  const selectedSummary = computed(() => {
    if (!selectedWorkflowId.value) {return null}
    return workflows.value.find((workflow) => workflow.workflowId === selectedWorkflowId.value) ?? null
  })

  function resetSelected() {
    selectedWorkflowId.value = null
    selectedWorkflow.value = null
    runs.value = []
    outputs.value = []
    validationDiagnostics.value = []
    lastRunResult.value = null
  }

  async function refreshStatus() {
    lastError.value = null
    try {
      status.value = await wsStore.rpc.getComfyUiStatus()
    } catch (error) {
      status.value = null
      lastError.value = errorMessage(error)
      console.error('[ComfyUiStore] refreshStatus failed:', error)
    }
  }

  async function fetchWorkflows(limit = 100) {
    loading.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.listComfyUiWorkflows(limit)
      workflows.value = result.workflows
      if (
        selectedWorkflowId.value &&
        !workflows.value.some((workflow) => workflow.workflowId === selectedWorkflowId.value)
      ) {
        resetSelected()
      }
    } catch (error) {
      workflows.value = []
      resetSelected()
      lastError.value = errorMessage(error)
      console.error('[ComfyUiStore] fetchWorkflows failed:', error)
    } finally {
      loading.value = false
    }
  }

  async function fetchWorkflowDetail(workflowId: string) {
    detailsLoading.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.getComfyUiWorkflow(workflowId)
      selectedWorkflow.value = result.workflow
    } catch (error) {
      selectedWorkflow.value = null
      lastError.value = errorMessage(error)
      console.error('[ComfyUiStore] fetchWorkflowDetail failed:', error)
    } finally {
      detailsLoading.value = false
    }
  }

  async function fetchRuns(workflowId = selectedWorkflowId.value ?? undefined, limit = 50) {
    runsLoading.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.listComfyUiRuns(workflowId, limit)
      runs.value = result.runs
    } catch (error) {
      runs.value = []
      lastError.value = errorMessage(error)
      console.error('[ComfyUiStore] fetchRuns failed:', error)
    } finally {
      runsLoading.value = false
    }
  }

  async function fetchOutputs(workflowId = selectedWorkflowId.value ?? undefined, limit = 50) {
    outputsLoading.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.listComfyUiOutputs(workflowId, limit)
      outputs.value = result.outputs
    } catch (error) {
      outputs.value = []
      lastError.value = errorMessage(error)
      console.error('[ComfyUiStore] fetchOutputs failed:', error)
    } finally {
      outputsLoading.value = false
    }
  }

  async function refreshOverview() {
    await Promise.all([
      refreshStatus(),
      fetchWorkflows(),
      fetchRuns(undefined),
      fetchOutputs(undefined),
    ])
    if (!selectedWorkflowId.value && workflows.value[0]) {
      await selectWorkflow(workflows.value[0].workflowId)
      return
    }
    await refreshSelected()
  }

  async function selectWorkflow(workflowId: string) {
    selectedWorkflowId.value = workflowId
    validationDiagnostics.value = []
    lastRunResult.value = null
    await Promise.all([
      fetchWorkflowDetail(workflowId),
      fetchRuns(workflowId),
      fetchOutputs(workflowId),
    ])
  }

  async function refreshSelected() {
    if (!selectedWorkflowId.value) {return}
    const workflowId = selectedWorkflowId.value
    await Promise.all([
      fetchWorkflowDetail(workflowId),
      fetchRuns(workflowId),
      fetchOutputs(workflowId),
    ])
  }

  async function validateSelected() {
    if (!selectedWorkflowId.value) {return null}
    validating.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.validateComfyUiWorkflow(selectedWorkflowId.value)
      validationDiagnostics.value = result.diagnostics
      return result
    } catch (error) {
      validationDiagnostics.value = []
      lastError.value = errorMessage(error)
      throw error
    } finally {
      validating.value = false
    }
  }

  async function runSelected() {
    if (!selectedWorkflowId.value) {return null}
    const workflowId = selectedWorkflowId.value
    let runError: unknown
    running.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.runComfyUiWorkflow(workflowId)
      lastRunResult.value = result
      validationDiagnostics.value = result.diagnostics ?? []
      return result
    } catch (error) {
      runError = error
      lastRunResult.value = null
      lastError.value = errorMessage(error)
    } finally {
      await fetchWorkflows()
      if (selectedWorkflowId.value) {
        await refreshSelected()
      }
      running.value = false
      if (runError) {
        lastError.value = errorMessage(runError)
      }
    }
    throw runError
  }

  function openComfyUi() {
    const url = status.value?.baseUrl || selectedSummary.value?.baseUrl || selectedWorkflow.value?.meta.baseUrl
    if (!url) {return}
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return {
    status,
    workflows,
    selectedWorkflowId,
    selectedWorkflow,
    runs,
    outputs,
    validationDiagnostics,
    lastRunResult,
    loading,
    detailsLoading,
    runsLoading,
    outputsLoading,
    validating,
    running,
    lastError,
    selectedSummary,
    refreshStatus,
    fetchWorkflows,
    fetchRuns,
    fetchOutputs,
    refreshOverview,
    selectWorkflow,
    refreshSelected,
    validateSelected,
    runSelected,
    openComfyUi,
  }
})
