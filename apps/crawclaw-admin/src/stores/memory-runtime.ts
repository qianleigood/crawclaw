import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useWebSocketStore } from './websocket'
import type {
  MemoryAdminOverview,
  MemoryDurableIndexEntry,
  MemoryExperienceOutboxEntry,
  MemoryExperienceOutboxListParams,
  MemoryExperienceOutboxStatus,
  MemorySessionSummaryRefreshParams,
  MemorySessionSummaryStatusParams,
  MemorySessionSummaryStatusResult,
} from '@/api/types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useMemoryRuntimeStore = defineStore('memoryRuntime', () => {
  const wsStore = useWebSocketStore()

  const overview = ref<MemoryAdminOverview | null>(null)
  const durableDocuments = ref<MemoryDurableIndexEntry[]>([])
  const experienceEntries = ref<MemoryExperienceOutboxEntry[]>([])
  const selectedExperienceStatus = ref<MemoryExperienceOutboxStatus | null>(null)
  const sessionSummary = ref<MemorySessionSummaryStatusResult | null>(null)
  const loadingOverview = ref(false)
  const loadingDurable = ref(false)
  const loadingExperience = ref(false)
  const loadingSessionSummary = ref(false)
  const refreshingSessionSummary = ref(false)
  const lastError = ref<string | null>(null)

  const providerReady = computed(() => overview.value?.provider.ready ?? false)
  const pendingExperienceSyncCount = computed(() => overview.value?.experience.pendingSyncCount ?? 0)
  const durableScopeCount = computed(() => overview.value?.durable.visibleCount ?? durableDocuments.value.length)

  async function fetchOverview() {
    loadingOverview.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.getMemoryAdminOverview({
        durableLimit: 20,
        experienceLimit: 50,
      })
      overview.value = result
      durableDocuments.value = result.durable.items
      experienceEntries.value = result.experience.items
    } catch (error) {
      overview.value = null
      lastError.value = errorMessage(error)
      console.error('[MemoryRuntimeStore] fetchOverview failed:', error)
    } finally {
      loadingOverview.value = false
    }
  }

  async function fetchDurableDocuments(limit = 50) {
    loadingDurable.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.listMemoryDurableDocuments(limit)
      durableDocuments.value = result.items
    } catch (error) {
      durableDocuments.value = []
      lastError.value = errorMessage(error)
      console.error('[MemoryRuntimeStore] fetchDurableDocuments failed:', error)
    } finally {
      loadingDurable.value = false
    }
  }

  async function fetchExperienceOutbox(params: MemoryExperienceOutboxListParams = {}) {
    loadingExperience.value = true
    lastError.value = null
    try {
      const result = await wsStore.rpc.listMemoryExperienceOutbox(params)
      experienceEntries.value = result.items
      selectedExperienceStatus.value = params.status ?? null
    } catch (error) {
      experienceEntries.value = []
      lastError.value = errorMessage(error)
      console.error('[MemoryRuntimeStore] fetchExperienceOutbox failed:', error)
    } finally {
      loadingExperience.value = false
    }
  }

  async function fetchSessionSummary(params: MemorySessionSummaryStatusParams) {
    loadingSessionSummary.value = true
    lastError.value = null
    try {
      sessionSummary.value = await wsStore.rpc.getMemorySessionSummaryStatus(params)
    } catch (error) {
      sessionSummary.value = null
      lastError.value = errorMessage(error)
      console.error('[MemoryRuntimeStore] fetchSessionSummary failed:', error)
    } finally {
      loadingSessionSummary.value = false
    }
  }

  async function refreshSessionSummary(params: MemorySessionSummaryRefreshParams) {
    refreshingSessionSummary.value = true
    lastError.value = null
    try {
      await wsStore.rpc.refreshMemorySessionSummary(params)
      await fetchSessionSummary({
        agent: params.agent,
        sessionId: params.sessionId,
      })
    } catch (error) {
      lastError.value = errorMessage(error)
      throw error
    } finally {
      refreshingSessionSummary.value = false
    }
  }

  async function refreshAll() {
    await fetchOverview()
    await Promise.all([
      fetchDurableDocuments(),
      fetchExperienceOutbox({
        ...(selectedExperienceStatus.value ? { status: selectedExperienceStatus.value } : {}),
        limit: 50,
      }),
    ])
  }

  return {
    overview,
    durableDocuments,
    experienceEntries,
    selectedExperienceStatus,
    sessionSummary,
    loadingOverview,
    loadingDurable,
    loadingExperience,
    loadingSessionSummary,
    refreshingSessionSummary,
    lastError,
    providerReady,
    pendingExperienceSyncCount,
    durableScopeCount,
    fetchOverview,
    fetchDurableDocuments,
    fetchExperienceOutbox,
    fetchSessionSummary,
    refreshSessionSummary,
    refreshAll,
  }
})
