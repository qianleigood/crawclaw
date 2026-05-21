import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Pause,
  Play,
  Rewind,
  X,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import {
  batchImageTiles,
  formatVideoTime,
  videoDurationSeconds,
  type ImagePreview,
} from './chat-workspace-model'

type ChatMediaPreviewsProps = {
  imagePreview: ImagePreview | null
  isVideoPlaying: boolean
  isVideoPreviewOpen: boolean
  onCloseImagePreview: () => void
  onCloseVideoPreview: () => void
  onImagePreviewStep: (delta: number) => void
  onVideoPlayingChange: (value: boolean | ((playing: boolean) => boolean)) => void
  onVideoSecondChange: (value: number) => void
  onVideoStep: (delta: number) => void
  videoCurrentSeconds: number
}

export function ChatMediaPreviews({
  imagePreview,
  isVideoPlaying,
  isVideoPreviewOpen,
  onCloseImagePreview,
  onCloseVideoPreview,
  onImagePreviewStep,
  onVideoPlayingChange,
  onVideoSecondChange,
  onVideoStep,
  videoCurrentSeconds,
}: ChatMediaPreviewsProps) {
  const videoCurrentTime = formatVideoTime(videoCurrentSeconds)
  const videoDurationTime = formatVideoTime(videoDurationSeconds)
  const videoProgressPercent = (videoCurrentSeconds / videoDurationSeconds) * 100
  const videoProgressStyle = { '--video-progress': `${videoProgressPercent}%` } as CSSProperties
  const imagePreviewCount = imagePreview?.kind === 'batch' ? batchImageTiles.length : 1
  const imagePreviewCurrent = imagePreview ? imagePreview.index + 1 : 1
  const imagePreviewTile = imagePreview?.kind === 'batch' ? (batchImageTiles[imagePreview.index] ?? batchImageTiles[0]) : null

  return (
    <>
      {isVideoPreviewOpen ? (
        <div
          className="video-preview-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onCloseVideoPreview()
            }
          }}
        >
          <div aria-label="视频预览" aria-modal="true" className="video-preview-modal" role="dialog">
            <button aria-label="关闭视频预览" className="video-preview-close" onClick={onCloseVideoPreview} type="button">
              <X aria-hidden="true" size={17} strokeWidth={2} />
            </button>
            <div className="video-preview-visual" aria-label="放大视频消息示例">
              <div className="video-preview-controls">
                <button aria-label="后退 10 秒" className="video-control-button" onClick={() => onVideoStep(-10)} type="button">
                  <Rewind aria-hidden="true" size={17} fill="currentColor" strokeWidth={0} />
                </button>
                <button
                  aria-label={isVideoPlaying ? '暂停视频' : '播放视频'}
                  className={isVideoPlaying ? 'video-control-button is-playing' : 'video-control-button'}
                  onClick={() => onVideoPlayingChange((playing) => !playing)}
                  type="button"
                >
                  {isVideoPlaying ? (
                    <Pause aria-hidden="true" size={17} fill="currentColor" strokeWidth={0} />
                  ) : (
                    <Play aria-hidden="true" size={17} fill="currentColor" strokeWidth={0} />
                  )}
                </button>
                <button aria-label="快进 10 秒" className="video-control-button" onClick={() => onVideoStep(10)} type="button">
                  <FastForward aria-hidden="true" size={17} fill="currentColor" strokeWidth={0} />
                </button>
                <div className="video-preview-progress">
                  <time>{videoCurrentTime}</time>
                  <input
                    aria-label="视频播放进度"
                    aria-valuetext={`${videoCurrentTime} / ${videoDurationTime}`}
                    className="video-preview-progress__range"
                    max={videoDurationSeconds}
                    min={0}
                    onChange={(event) => onVideoSecondChange(Number(event.currentTarget.value))}
                    onInput={(event) => onVideoSecondChange(Number(event.currentTarget.value))}
                    style={videoProgressStyle}
                    type="range"
                    value={videoCurrentSeconds}
                  />
                  <time>{videoDurationTime}</time>
                </div>
              </div>
            </div>
            <footer className="video-preview-footer">
              <strong>视频消息</strong>
              <span>视频时长 {videoDurationTime}</span>
            </footer>
          </div>
        </div>
      ) : null}
      {imagePreview ? (
        <div
          className="image-preview-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onCloseImagePreview()
            }
          }}
        >
          <div
            aria-label={imagePreview.kind === 'batch' ? '批量图片预览' : '图片预览'}
            aria-modal="true"
            className="image-preview-modal"
            role="dialog"
          >
            <button aria-label="关闭图片预览" className="video-preview-close" onClick={onCloseImagePreview} type="button">
              <X aria-hidden="true" size={17} strokeWidth={2} />
            </button>
            <div className="image-preview-visual">
              {imagePreview.kind === 'batch' ? (
                <>
                  <button
                    aria-label="上一张图片"
                    className="image-preview-nav image-preview-nav--prev"
                    disabled={imagePreview.index === 0}
                    onClick={() => onImagePreviewStep(-1)}
                    type="button"
                  >
                    <ChevronLeft aria-hidden="true" size={20} strokeWidth={2.2} />
                  </button>
                  <span
                    aria-label={`批量图片第 ${imagePreviewCurrent} 张`}
                    className={`image-preview-art batch-image-grid__tile batch-image-grid__tile--${imagePreviewTile}`}
                    role="img"
                  />
                  <button
                    aria-label="下一张图片"
                    className="image-preview-nav image-preview-nav--next"
                    disabled={imagePreview.index === imagePreviewCount - 1}
                    onClick={() => onImagePreviewStep(1)}
                    type="button"
                  >
                    <ChevronRight aria-hidden="true" size={20} strokeWidth={2.2} />
                  </button>
                </>
              ) : (
                <span aria-label="放大图片消息示例" className="image-preview-art image-preview-art--single" role="img">
                  <span className="media-visual__sky" />
                  <span className="media-visual__panel media-visual__panel--wide" />
                  <span className="media-visual__panel" />
                </span>
              )}
            </div>
            <footer className="image-preview-footer">
              <strong>{imagePreview.kind === 'batch' ? '批量图片' : '图片消息'}</strong>
              <span>{imagePreview.kind === 'batch' ? `第 ${imagePreviewCurrent} / ${imagePreviewCount} 张` : '分辨率 1280 x 720'}</span>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  )
}
