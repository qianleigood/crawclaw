import type { DesktopPreferences } from '../desktop-api'

export const batchImageTiles = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
export const batchImagePageSize = 4
export const videoDurationSeconds = 42
export const videoPreviewStartSeconds = 18

export type ImagePreview = {
  index: number
  kind: 'batch' | 'single'
}

export type PreferencePatch = Pick<DesktopPreferences, 'permissionMode' | 'selectedModel' | 'selectedThinking'>

export const formatVideoTime = (seconds: number) => `00:${String(seconds).padStart(2, '0')}`
