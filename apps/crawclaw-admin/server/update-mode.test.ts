import { describe, expect, it } from 'vitest'
import {
  buildDesktopUpdateResponse,
  buildNpmPackageSpec,
  resolveUpdateMode,
  runAdminUpdate,
} from './update-mode.js'

describe('admin update mode', () => {
  it('uses desktop release updates in desktop runtime mode', () => {
    expect(resolveUpdateMode('desktop')).toBe('desktop-release')
  })

  it('keeps npm global updates outside desktop runtime mode', () => {
    expect(resolveUpdateMode('web')).toBe('npm-global')
    expect(resolveUpdateMode(undefined)).toBe('npm-global')
  })

  it('returns a structured desktop update response without npm output', () => {
    expect(buildDesktopUpdateResponse()).toEqual({
      ok: false,
      updateMode: 'desktop-release',
      error: 'Desktop builds update through GitHub Releases.',
    })
  })

  it('builds npm package specs for web mode updates', () => {
    expect(buildNpmPackageSpec('crawclaw', '1.2.3')).toBe('crawclaw@1.2.3')
    expect(buildNpmPackageSpec('crawclaw', '')).toBe('crawclaw@latest')
  })

  it('does not execute npm updates in desktop mode', () => {
    let executed = false

    const result = runAdminUpdate({
      runtimeMode: 'desktop',
      packageName: 'crawclaw',
      version: '1.2.3',
      execNpmUpdate() {
        executed = true
        return ''
      },
    })

    expect(executed).toBe(false)
    expect(result).toEqual(buildDesktopUpdateResponse())
  })

  it('executes npm updates in web mode', () => {
    const result = runAdminUpdate({
      runtimeMode: 'web',
      packageName: 'crawclaw',
      version: '1.2.3',
      execNpmUpdate(packageSpec) {
        return `updated ${packageSpec}`
      },
    })

    expect(result).toEqual({
      ok: true,
      updateMode: 'npm-global',
      message: 'Successfully updated to crawclaw@1.2.3',
      output: 'updated crawclaw@1.2.3',
    })
  })
})
