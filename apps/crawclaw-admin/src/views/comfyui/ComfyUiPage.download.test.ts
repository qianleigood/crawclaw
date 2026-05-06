import { describe, expect, it } from 'vitest'
import enUS from '@/i18n/messages/en-US'
import zhCN from '@/i18n/messages/zh-CN'
import comfyUiSource from './ComfyUiPage.vue?raw'

describe('ComfyUiPage output downloads', () => {
  it('renders saved output paths as download links instead of local paths', () => {
    expect(comfyUiSource).toContain('/api/comfyui/outputs/download')
    expect(comfyUiSource).toContain("t('pages.comfyui.download')")
    expect(comfyUiSource).not.toContain("t('pages.comfyui.fields.localPath')")
    expect(comfyUiSource).not.toContain('row.localPath })')
  })

  it('localizes the output download action', () => {
    expect(enUS.pages.comfyui.download).toBe('Download')
    expect(zhCN.pages.comfyui.download).toBe('下载')
  })
})
