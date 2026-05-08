import { describe, expect, it } from 'vitest'
import { createDesktopScreenshotDraft } from './desktop-host'

describe('createDesktopScreenshotDraft', () => {
  it('prefers saved media paths for desktop screenshot prompts', () => {
    expect(createDesktopScreenshotDraft({
      ok: true,
      mediaPath: 'desktop/screenshot.png',
      dataUrl: 'data:image/png;base64,ignored',
    }, 'Please inspect this screenshot.')).toBe('Please inspect this screenshot.\n\nMEDIA:desktop/screenshot.png')
  })

  it('falls back to a data URL when no media path is available', () => {
    expect(createDesktopScreenshotDraft({
      ok: true,
      dataUrl: 'data:image/png;base64,abc',
    }, 'Please inspect this screenshot.')).toBe('Please inspect this screenshot.\n\n![Screenshot](data:image/png;base64,abc)')
  })

  it('returns null for failed screenshot captures', () => {
    expect(createDesktopScreenshotDraft({ ok: false, error: 'denied' }, 'Please inspect this screenshot.')).toBeNull()
  })
})
