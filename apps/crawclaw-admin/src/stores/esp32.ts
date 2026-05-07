import { ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  Esp32DeviceDetail,
  Esp32DeviceSummary,
  Esp32PairingRequestSummary,
  Esp32PairingStartResult,
  Esp32StatusSummary,
} from '@/api/types'
import { useWebSocketStore } from './websocket'

function addAction(map: Record<string, boolean>, key: string): Record<string, boolean> {
  return {
    ...map,
    [key]: true,
  }
}

function removeAction(map: Record<string, boolean>, key: string): Record<string, boolean> {
  const next = { ...map }
  delete next[key]
  return next
}

export const useEsp32Store = defineStore('esp32', () => {
  const wsStore = useWebSocketStore()

  const loading = ref(false)
  const statusLoading = ref(false)
  const startingPairing = ref(false)
  const detailLoading = ref(false)
  const status = ref<Esp32StatusSummary | null>(null)
  const latestPairing = ref<Esp32PairingStartResult | null>(null)
  const pendingRequests = ref<Esp32PairingRequestSummary[]>([])
  const devices = ref<Esp32DeviceSummary[]>([])
  const selectedDevice = ref<Esp32DeviceDetail | null>(null)
  const requestActions = ref<Record<string, boolean>>({})
  const pairingSessionActions = ref<Record<string, boolean>>({})
  const deviceActions = ref<Record<string, boolean>>({})

  async function refreshStatus(): Promise<void> {
    statusLoading.value = true
    try {
      status.value = await wsStore.rpc.getEsp32Status()
    } finally {
      statusLoading.value = false
    }
  }

  async function refreshRequests(): Promise<void> {
    pendingRequests.value = await wsStore.rpc.listEsp32PairingRequests()
  }

  async function refreshDevices(): Promise<void> {
    devices.value = await wsStore.rpc.listEsp32Devices()
  }

  async function refreshAll(): Promise<void> {
    loading.value = true
    try {
      await Promise.all([refreshStatus(), refreshRequests(), refreshDevices()])
    } finally {
      loading.value = false
    }
  }

  async function startPairing(params?: { name?: string; ttlMs?: number }): Promise<Esp32PairingStartResult> {
    startingPairing.value = true
    try {
      const result = await wsStore.rpc.startEsp32Pairing(params)
      latestPairing.value = result
      await refreshStatus()
      return result
    } finally {
      startingPairing.value = false
    }
  }

  async function approveRequest(requestId: string): Promise<void> {
    requestActions.value = addAction(requestActions.value, requestId)
    try {
      await wsStore.rpc.approveEsp32PairingRequest(requestId)
      await Promise.all([refreshStatus(), refreshRequests(), refreshDevices()])
    } finally {
      requestActions.value = removeAction(requestActions.value, requestId)
    }
  }

  async function rejectRequest(requestId: string): Promise<void> {
    requestActions.value = addAction(requestActions.value, requestId)
    try {
      await wsStore.rpc.rejectEsp32PairingRequest(requestId)
      await Promise.all([refreshStatus(), refreshRequests()])
    } finally {
      requestActions.value = removeAction(requestActions.value, requestId)
    }
  }

  async function revokePairingSession(pairId: string): Promise<void> {
    pairingSessionActions.value = addAction(pairingSessionActions.value, pairId)
    try {
      await wsStore.rpc.revokeEsp32PairingSession(pairId)
      if (latestPairing.value?.pairId === pairId) {
        latestPairing.value = null
      }
      await refreshStatus()
    } finally {
      pairingSessionActions.value = removeAction(pairingSessionActions.value, pairId)
    }
  }

  async function loadDevice(deviceId: string): Promise<Esp32DeviceDetail> {
    detailLoading.value = true
    try {
      const detail = await wsStore.rpc.getEsp32Device(deviceId)
      selectedDevice.value = detail
      return detail
    } finally {
      detailLoading.value = false
    }
  }

  function clearSelectedDevice(): void {
    selectedDevice.value = null
  }

  async function revokeDevice(deviceId: string): Promise<void> {
    deviceActions.value = addAction(deviceActions.value, deviceId)
    try {
      await wsStore.rpc.revokeEsp32Device(deviceId)
      if (selectedDevice.value?.deviceId === deviceId) {
        selectedDevice.value = null
      }
      await Promise.all([refreshStatus(), refreshRequests(), refreshDevices()])
    } finally {
      deviceActions.value = removeAction(deviceActions.value, deviceId)
    }
  }

  async function sendTestDisplay(deviceId: string, text: string): Promise<void> {
    deviceActions.value = addAction(deviceActions.value, deviceId)
    try {
      await wsStore.rpc.sendEsp32DisplayText(deviceId, text)
    } finally {
      deviceActions.value = removeAction(deviceActions.value, deviceId)
    }
  }

  return {
    loading,
    statusLoading,
    startingPairing,
    detailLoading,
    status,
    latestPairing,
    pendingRequests,
    devices,
    selectedDevice,
    requestActions,
    pairingSessionActions,
    deviceActions,
    refreshStatus,
    refreshRequests,
    refreshDevices,
    refreshAll,
    startPairing,
    approveRequest,
    rejectRequest,
    revokePairingSession,
    loadDevice,
    clearSelectedDevice,
    revokeDevice,
    sendTestDisplay,
  }
})
