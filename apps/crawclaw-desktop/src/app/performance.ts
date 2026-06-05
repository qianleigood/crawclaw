type DesktopPerformanceDetail = Record<string, boolean | number | string | undefined>

const markPrefix = 'crawclaw.desktop'

export function markDesktopPerformance(name: string, detail?: DesktopPerformanceDetail) {
  const performanceApi = globalThis.performance
  if (!performanceApi?.mark) {
    return
  }

  const markName = `${markPrefix}.${name}`
  try {
    if (detail) {
      performanceApi.mark(markName, { detail })
    } else {
      performanceApi.mark(markName)
    }
  } catch {
    performanceApi.mark(markName)
  }
}
