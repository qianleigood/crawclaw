import {
  AudioLines,
  Blocks,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Play,
  Sparkles,
  Wrench,
} from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { ConversationState, PermissionRequest } from '../desktop-api'
import { Badge } from '../ui/badge'
import { Panel } from '../ui/panel'
import { ConversationMessageList } from './conversation-messages'
import {
  batchImagePageSize,
  videoPreviewStartSeconds,
  type ImagePreview,
} from './chat-workspace-model'

function ChatAvatar({ author }: { author: 'assistant' | 'user' }) {
  if (author === 'assistant') {
    return (
      <span className="chat-avatar chat-avatar--assistant" aria-hidden="true">
        <Sparkles size={14} strokeWidth={2.2} />
      </span>
    )
  }

  return (
    <span className="chat-avatar chat-avatar--user" aria-hidden="true">
      你
    </span>
  )
}

type ChatThreadProps = {
  conversation: ConversationState
  onDecidePermission: (requestId: string, status: 'approved' | 'denied') => void
  onOpenAsset: (assetId: string) => void
  onRevealAsset: (assetId: string) => void
  permissionRequest: PermissionRequest
  replyMode: string
}

type ChatThreadShowcaseProps = {
  batchImagePage: number
  batchImagePageCount: number
  conversation: ConversationState
  resultItems: ConversationState['resultItems']
  runtimeChecks: ConversationState['runtimeChecks']
  setBatchImagePage: Dispatch<SetStateAction<number>>
  setImagePreview: Dispatch<SetStateAction<ImagePreview | null>>
  setIsVideoPlaying: Dispatch<SetStateAction<boolean>>
  setIsVideoPreviewOpen: Dispatch<SetStateAction<boolean>>
  setVideoCurrentSeconds: Dispatch<SetStateAction<number>>
  visibleBatchImageTiles: string[]
}

function ContextSummaryPanel({ conversation }: { conversation: ConversationState }) {
  const summary = conversation.contextSummary
  if (!summary) {
    return null
  }

  const surfacedSkills = summary.surfacedSkills.map((skill) => skill.name)
  const contextMode = [
    summary.profileKind,
    summary.parentContextPolicy,
    summary.compactionActive ? 'compacted' : undefined,
  ]
    .filter(Boolean)
    .join(' / ')
  return (
    <details className="context-summary-panel">
      <summary>
        <span>
          <Wrench aria-hidden="true" size={14} strokeWidth={2.1} />
          上下文
        </span>
        <small>
          {contextMode} · {summary.includedTools.length} 可见 / {summary.deferredTools.length} 延后 · 约{' '}
          {summary.estimatedTokens} tokens
        </small>
      </summary>
      <div className="context-summary-grid">
        <section>
          <h2>Profile</h2>
          <p>{contextMode || 'normal'}</p>
        </section>
        <section>
          <h2>Compaction</h2>
          <p>
            {summary.compactionActive
              ? `${summary.compactedThrough ?? 'active'} / ${summary.retainedMessageCount} retained`
              : `${summary.retainedMessageCount} retained`}
          </p>
        </section>
        <section>
          <h2>可见工具</h2>
          <p>{summary.includedTools.join(', ') || '无'}</p>
        </section>
        <section>
          <h2>Activated</h2>
          <p>{summary.activatedTools.join(', ') || '无'}</p>
        </section>
        <section>
          <h2>延后工具</h2>
          <p>{summary.deferredTools.slice(0, 16).join(', ') || '无'}</p>
        </section>
        <section>
          <h2>Skills</h2>
          <p>{surfacedSkills.join(', ') || '无'}</p>
        </section>
        <section>
          <h2>Memory</h2>
          <p>{summary.memorySnippets.join(' · ') || '无'}</p>
        </section>
      </div>
    </details>
  )
}

export function ChatThread({
  conversation,
  onDecidePermission,
  onOpenAsset,
  onRevealAsset,
  permissionRequest,
  replyMode,
}: ChatThreadProps) {
  return (
    <section className="desktop-content" aria-label="对话工作区">
      <ContextSummaryPanel conversation={conversation} />
      <ConversationMessageList
        messages={conversation.messages}
        onDecidePermission={onDecidePermission}
        onOpenAsset={onOpenAsset}
        onRevealAsset={onRevealAsset}
        permissionRequest={permissionRequest}
        replyMode={replyMode}
      />
    </section>
  )
}

// Hidden showcase retained for the current media, tool, workflow, and voice bubbles.
export function ChatThreadShowcase({
  batchImagePage,
  batchImagePageCount,
  conversation,
  resultItems,
  runtimeChecks,
  setBatchImagePage,
  setImagePreview,
  setIsVideoPlaying,
  setIsVideoPreviewOpen,
  setVideoCurrentSeconds,
  visibleBatchImageTiles,
}: ChatThreadShowcaseProps) {
  return (
      <section className="desktop-content" aria-label="对话工作区">
        <ol className="chat-thread">
          <li className="chat-row chat-row--assistant">
            <ChatAvatar author="assistant" />
            <article className="chat-message">
              <p className="chat-message__speaker">CrawClaw</p>
              <p>准备 CrawClaw 在这台 Mac 上工作。当前版本先只落地对话界面，不连接后端。</p>
            </article>
          </li>

          <li className="chat-row chat-row--user">
            <article className="chat-message">
              <p>我想先看一个真正的桌面对话界面，保持苹果风格的简约。</p>
            </article>
            <ChatAvatar author="user" />
          </li>

          <li className="chat-row chat-row--assistant">
            <ChatAvatar author="assistant" />
            <article className="chat-message">
              <p>
                已把主工作区改成对话流。左侧负责会话入口，中央只保留多轮消息、轻量运行结果和底部输入框。
              </p>
            </article>
          </li>

          <li className="chat-row chat-row--assistant">
            <ChatAvatar author="assistant" />
            <Panel className="chat-card" label="本机任务结果">
              <header className="chat-card__header">
                <div>
                  <p className="panel-kicker">运行结果</p>
                  <h2>界面基础层已切换</h2>
                </div>
                <Badge tone="neutral">本机 UI</Badge>
              </header>

              <ul className="chat-card__list">
                {resultItems.map((item) => (
                  <li key={item}>
                    <CheckCircle2 aria-hidden="true" size={15} strokeWidth={2.2} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </li>

          <li className="chat-row chat-row--user">
            <article className="chat-message">
              <p>后端先不要接，先把静态会话、运行状态和结果呈现打磨好。</p>
            </article>
            <ChatAvatar author="user" />
          </li>

          <li className="chat-row chat-row--user">
            <article className="chat-message">
              <p>对话里也需要图片、视频、附件这些不同气泡，先看下静态设计。</p>
            </article>
            <ChatAvatar author="user" />
          </li>

          <li className="chat-row chat-row--assistant">
            <ChatAvatar author="assistant" />
            <div className="media-stack" aria-label="多媒体消息示例">
              <figure className="media-bubble media-bubble--image">
                <button
                  aria-label="放大图片消息"
                  className="media-visual-button"
                  onClick={() => setImagePreview({ index: 0, kind: 'single' })}
                  type="button"
                >
                  <span className="media-visual media-visual--image" role="img" aria-label="图片消息示例">
                    <span className="media-visual__sky" />
                    <span className="media-visual__panel media-visual__panel--wide" />
                    <span className="media-visual__panel" />
                    <span aria-label="图片加载中" className="media-loading media-loading--image" />
                  </span>
                </button>
                <figcaption>
                  <span className="media-caption__label">
                    <ImageIcon aria-hidden="true" size={15} strokeWidth={2} />
                    图片消息
                  </span>
                  <span className="media-caption__meta">
                    <small>分辨率 1280 x 720</small>
                    <button
                      aria-label="打开图片所在文件夹"
                      className="media-folder-button"
                      type="button"
                    >
                      <FolderOpen aria-hidden="true" size={14} strokeWidth={2} />
                    </button>
                  </span>
                </figcaption>
              </figure>

              <figure className="media-bubble media-bubble--video">
                <div className="media-visual media-visual--video" aria-label="视频消息示例">
                  <button
                    aria-label="播放视频"
                    className="video-play"
                    onClick={() => {
                      setIsVideoPreviewOpen(true)
                      setIsVideoPlaying(true)
                      setVideoCurrentSeconds(videoPreviewStartSeconds)
                    }}
                    type="button"
                  >
                    <Play aria-hidden="true" size={18} fill="currentColor" strokeWidth={0} />
                  </button>
                  <span className="video-timeline">
                    <span />
                  </span>
                  <span aria-label="视频加载中" className="media-loading media-loading--video" />
                </div>
                <figcaption>
                  <span className="media-caption__label">
                    <Play aria-hidden="true" size={15} strokeWidth={2} />
                    视频消息
                  </span>
                  <span className="media-caption__meta">
                    <small>视频时长 00:42</small>
                    <button
                      aria-label="打开视频所在文件夹"
                      className="media-folder-button"
                      type="button"
                    >
                      <FolderOpen aria-hidden="true" size={14} strokeWidth={2} />
                    </button>
                  </span>
                </figcaption>
              </figure>

              <figure className="media-bubble media-bubble--batch">
                <div aria-label="批量图片轮播" className="batch-image-carousel" role="region">
                  <button
                    aria-label="上一页批量图片"
                    className="batch-image-carousel__arrow batch-image-carousel__arrow--prev"
                    disabled={batchImagePage === 0}
                    onClick={() => setBatchImagePage((page) => Math.max(0, page - 1))}
                    type="button"
                  >
                    <ChevronLeft aria-hidden="true" size={16} strokeWidth={2.2} />
                  </button>
                  <button
                    aria-label="批量图片消息示例"
                    className="batch-image-grid"
                    key={batchImagePage}
                    onClick={() => setImagePreview({ index: batchImagePage * batchImagePageSize, kind: 'batch' })}
                    type="button"
                  >
                    {visibleBatchImageTiles.map((tile) => (
                      <span className={`batch-image-grid__tile batch-image-grid__tile--${tile}`} key={tile} />
                    ))}
                    <span aria-label="批量图片加载中" className="media-loading media-loading--batch" />
                  </button>
                  <button
                    aria-label="下一页批量图片"
                    className="batch-image-carousel__arrow batch-image-carousel__arrow--next"
                    disabled={batchImagePage === batchImagePageCount - 1}
                    onClick={() => setBatchImagePage((page) => Math.min(batchImagePageCount - 1, page + 1))}
                    type="button"
                  >
                    <ChevronRight aria-hidden="true" size={16} strokeWidth={2.2} />
                  </button>
                  <div className="batch-image-carousel__dots" aria-label="批量图片分页">
                    {Array.from({ length: batchImagePageCount }, (_, page) => (
                      <button
                        aria-current={page === batchImagePage ? 'page' : undefined}
                        aria-label={`批量图片第 ${page + 1} 页`}
                        className={page === batchImagePage ? 'is-active' : undefined}
                        key={page}
                        onClick={() => setBatchImagePage(page)}
                        type="button"
                      />
                    ))}
                  </div>
                </div>
                <figcaption>
                  <span className="media-caption__label">
                    <ImageIcon aria-hidden="true" size={15} strokeWidth={2} />
                    批量图片
                  </span>
                  <span className="media-caption__meta">
                    <small>8 张图片</small>
                    <button
                      aria-label="打开批量图片所在文件夹"
                      className="media-folder-button"
                      type="button"
                    >
                      <FolderOpen aria-hidden="true" size={14} strokeWidth={2} />
                    </button>
                  </span>
                </figcaption>
              </figure>

              <div className="attachment-bubble">
                <FileText aria-hidden="true" size={18} strokeWidth={2} />
                <div className="attachment-bubble__body">
                  <strong>desktop-ui-notes.md</strong>
                  <span>Markdown 附件 · 18 KB</span>
                </div>
                <div className="attachment-bubble__actions">
                  <button
                    aria-label="打开附件"
                    type="button"
                  >
                    <ExternalLink aria-hidden="true" size={15} strokeWidth={2} />
                  </button>
                  <button
                    aria-label="在文件夹中显示"
                    type="button"
                  >
                    <FolderOpen aria-hidden="true" size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          </li>

          <li className="chat-row chat-row--user">
            <article className="chat-message">
              <p>工具调用、Skill 执行和语音消息也要有独立气泡。</p>
            </article>
            <ChatAvatar author="user" />
          </li>

          <li className="chat-row chat-row--assistant">
            <ChatAvatar author="assistant" />
            <div className="execution-stack" aria-label="工具和 Skill 调用示例">
              <div className="call-bubble call-bubble--tool">
                <div className="call-bubble__icon">
                  <Wrench aria-hidden="true" size={16} strokeWidth={2} />
                </div>
                <div className="call-bubble__body">
                  <div className="call-bubble__header">
                    <strong>工具调用</strong>
                    <Badge tone="ok">已完成</Badge>
                  </div>
                  <p>desktop.inspect_ui</p>
                  <span>读取当前窗口结构与可见控件</span>
                </div>
              </div>

              <div className="call-bubble call-bubble--skill">
                <div className="call-bubble__icon">
                  <Sparkles aria-hidden="true" size={16} strokeWidth={2} />
                </div>
                <div className="call-bubble__body">
                  <div className="call-bubble__header">
                    <strong>Skill 执行</strong>
                    <Badge tone="neutral">设计中</Badge>
                  </div>
                  <p>macOS UI polish</p>
                  <span>整理对话气泡、媒体预览与底部输入体验</span>
                </div>
              </div>
            </div>
          </li>

          <li className="chat-row chat-row--assistant">
            <ChatAvatar author="assistant" />
            <div className="workflow-stack" aria-label="工作流消息示例">
              <div className="workflow-bubble workflow-bubble--n8n">
                <header className="workflow-bubble__header">
                  <div className="workflow-bubble__title">
                    <span className="workflow-bubble__icon">
                      <Blocks aria-hidden="true" size={16} strokeWidth={2} />
                    </span>
                    <div>
                      <strong>n8n 工作流</strong>
                      <p>线索同步与通知</p>
                    </div>
                  </div>
                  <Badge tone="neutral">运行中</Badge>
                </header>
                <div className="workflow-nodes" aria-label="n8n 节点状态">
                  <span className="workflow-node workflow-node--done">Webhook</span>
                  <i />
                  <span aria-current="step" className="workflow-node workflow-node--active">
                    清洗数据
                  </span>
                  <i />
                  <span className="workflow-node workflow-node--pending">Slack 通知</span>
                </div>
                <div className="workflow-current" aria-label="当前执行节点">
                  <span>当前节点</span>
                  <strong>清洗数据</strong>
                </div>
                <div className="workflow-meta">
                  <span>6 个节点</span>
                  <span>已完成 1/3</span>
                  <span>运行 1.4 秒</span>
                </div>
              </div>

              <div className="workflow-bubble workflow-bubble--comfyui">
                <header className="workflow-bubble__header">
                  <div className="workflow-bubble__title">
                    <span className="workflow-bubble__icon">
                      <ImageIcon aria-hidden="true" size={16} strokeWidth={2} />
                    </span>
                    <div>
                      <strong>ComfyUI 工作流</strong>
                      <p>产品图生成</p>
                    </div>
                  </div>
                  <Badge tone="neutral">生成中</Badge>
                </header>
                <div className="comfy-preview" role="img" aria-label="ComfyUI 图像预览">
                  <span className="comfy-preview__sheet" />
                  <span className="comfy-preview__subject" />
                  <span className="comfy-preview__shadow" />
                </div>
                <div className="workflow-meta">
                  <span>12 个节点</span>
                  <span>1024 x 1024</span>
                  <span>采样 18/24</span>
                </div>
              </div>

              <div className="workflow-bubble workflow-bubble--schedule">
                <header className="workflow-bubble__header">
                  <div className="workflow-bubble__title">
                    <span className="workflow-bubble__icon">
                      <Clock3 aria-hidden="true" size={16} strokeWidth={2} />
                    </span>
                    <div>
                      <strong>定时任务</strong>
                      <p>每日环境巡检</p>
                    </div>
                  </div>
                  <Badge tone="ok">已启用</Badge>
                </header>
                <div className="schedule-plan" aria-label="定时任务计划">
                  <div>
                    <span>触发规则</span>
                    <strong>每天 09:30</strong>
                  </div>
                  <div>
                    <span>下次运行</span>
                    <strong>今天 09:30</strong>
                  </div>
                  <div>
                    <span>失败处理</span>
                    <strong>通知我</strong>
                  </div>
                </div>
                <div className="workflow-meta">
                  <span>工作区模式</span>
                  <span>最近成功 昨天 09:31</span>
                  <span>运行 24 次</span>
                </div>
              </div>
            </div>
          </li>

          <li className="chat-row chat-row--user">
            <article className="chat-message voice-message" aria-label="语音消息示例">
              <div className="voice-message__icon">
                <AudioLines aria-hidden="true" size={17} strokeWidth={2} />
              </div>
              <div className="voice-message__body">
                <div className="voice-wave" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <p>语音消息 · 00:08</p>
              </div>
            </article>
            <ChatAvatar author="user" />
          </li>

          <li className="chat-row chat-row--assistant">
            <ChatAvatar author="assistant" />
            <article className="chat-message">
              <p>当前运行状态先作为对话上下文展示，后续接 Rust Desktop API 后再切换为真实状态。</p>
              <div className="chat-status-strip" aria-label="运行状态">
                {runtimeChecks.map((item) => (
                  <span className="chat-status-strip__item" key={item.label}>
                    <span>{item.label}</span>
                    <Badge tone={item.tone}>{item.value}</Badge>
                  </span>
                ))}
              </div>
            </article>
          </li>

          <li className="chat-row chat-row--assistant chat-row--loading">
            <ChatAvatar author="assistant" />
            <div aria-label="消息生成中" className="chat-message chat-message--loading">
              <span />
              <span />
              <span />
            </div>
          </li>

          {conversation.draftMessages.map((message) => (
            <li className="chat-row chat-row--user chat-row--draft" key={message.id}>
              <article className="chat-message">
                <p>{message.text}</p>
              </article>
              <ChatAvatar author="user" />
            </li>
          ))}
        </ol>
      </section>
  )
}
