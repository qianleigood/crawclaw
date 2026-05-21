import {
  AudioLines,
  Sparkles,
} from 'lucide-react'
import type { ChangeEvent } from 'react'
import type { AgentVoiceConfig } from '../desktop-api'
import {
  agentVoicePaces,
  agentVoiceSourceOptions,
  qwenVoicePresets,
  type AgentCreateDraft,
} from './agent-create-wizard-model'

type AgentVoiceStepProps = {
  agentDraft: AgentCreateDraft
  generateAgentVoiceStyle: () => void
  updateAgentVoice: (patch: Partial<AgentVoiceConfig>) => void
  uploadAgentVoiceCloneSample: (event: ChangeEvent<HTMLInputElement>) => void
}

export function AgentVoiceStep({
  agentDraft,
  generateAgentVoiceStyle,
  updateAgentVoice,
  uploadAgentVoiceCloneSample,
}: AgentVoiceStepProps) {
      const selectedVoicePreset = qwenVoicePresets.find((voice) => voice.id === agentDraft.voice.presetVoice) ?? qwenVoicePresets[0]

      return (
        <div className="agent-create-wizard__section">
          <h3>语音偏好</h3>
          <div className="agent-create-wizard__checks">
            <label className="agent-create-wizard__check-card">
              <input
                aria-label="启用语音"
                checked={agentDraft.voice.enabled}
                onChange={(event) => updateAgentVoice({ enabled: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>
                <strong>启用语音</strong>
                <small>保存语音入口和播报偏好</small>
              </span>
            </label>
            <label className="agent-create-wizard__check-card">
              <input
                aria-label="语音播报"
                checked={agentDraft.voice.outputEnabled}
                onChange={(event) => updateAgentVoice({ outputEnabled: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>
                <strong>语音播报</strong>
                <small>允许回复时播报摘要</small>
              </span>
            </label>
            <label className="agent-create-wizard__check-card">
              <input
                aria-label="唤醒响应"
                checked={agentDraft.voice.wakeEnabled}
                onChange={(event) => updateAgentVoice({ wakeEnabled: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>
                <strong>唤醒响应</strong>
                <small>保留后续语音唤醒入口</small>
              </span>
            </label>
          </div>
          <div className="agent-create-wizard__voice-source" aria-label="声音来源" role="group">
            {agentVoiceSourceOptions.map((source) => (
              <button
                aria-label={source.label}
                aria-pressed={agentDraft.voice.source === source.id}
                className={agentDraft.voice.source === source.id ? 'is-selected' : ''}
                key={source.id}
                onClick={() => updateAgentVoice({ source: source.id })}
                type="button"
              >
                <strong>{source.label}</strong>
                <small>{source.detail}</small>
              </button>
            ))}
          </div>
          {agentDraft.voice.source === 'qwen-preset' ? (
            <section aria-label="预设音色" className="agent-create-wizard__voice-presets">
              <span className="agent-create-wizard__label">Qwen-TTS 预设音色</span>
              <div className="agent-create-wizard__voice-preset-grid">
                {qwenVoicePresets.map((voice, index) => (
                  <button
                    aria-label={`音色 ${voice.label}${index === 0 ? ' 推荐' : ''}`}
                    aria-pressed={agentDraft.voice.presetVoice === voice.id}
                    className={agentDraft.voice.presetVoice === voice.id ? 'is-selected' : ''}
                    key={voice.id}
                    onClick={() => updateAgentVoice({ presetVoice: voice.id })}
                    type="button"
                  >
                    <strong>{voice.label}</strong>
                    <small>{voice.detail}</small>
                  </button>
                ))}
              </div>
              <p>当前 voice 参数：{selectedVoicePreset.id}</p>
            </section>
          ) : null}
          {agentDraft.voice.source === 'voice-design' ? (
            <section aria-label="描述生成声音" className="agent-create-wizard__voice-design">
              <label className="agent-create-wizard__field">
                <span>声音描述</span>
                <textarea
                  onChange={(event) => updateAgentVoice({ designPrompt: event.currentTarget.value })}
                  value={agentDraft.voice.designPrompt}
                />
              </label>
            </section>
          ) : null}
          {agentDraft.voice.source === 'voice-clone' ? (
            <section aria-label="克隆声音样本" className="agent-create-wizard__voice-clone">
              <label className="agent-create-wizard__field agent-create-wizard__field--compact">
                <span>克隆声音名称</span>
                <input
                  onChange={(event) => updateAgentVoice({ cloneVoiceName: event.currentTarget.value })}
                  value={agentDraft.voice.cloneVoiceName}
                />
              </label>
              <label className="agent-create-wizard__upload-button agent-create-wizard__upload-button--audio">
                <input accept="audio/*" aria-label="上传克隆声音样本" onChange={uploadAgentVoiceCloneSample} type="file" />
                <span>
                  <AudioLines aria-hidden="true" size={14} strokeWidth={2.1} />
                  上传克隆声音样本
                </span>
              </label>
              <small>{agentDraft.voice.cloneSampleName || '尚未选择音频样本'}</small>
            </section>
          ) : null}
          <div className="agent-create-wizard__voice-style">
            <div className="agent-create-wizard__generation-row">
              <span className="agent-create-wizard__label">语言风格</span>
              <button className="agent-create-wizard__generate-button" onClick={generateAgentVoiceStyle} type="button">
                <Sparkles aria-hidden="true" size={14} strokeWidth={2.2} />
                根据情感提示词生成
              </button>
            </div>
            <label className="agent-create-wizard__field agent-create-wizard__field--compact agent-create-wizard__field--voice-style">
              <span>自定义语言风格</span>
              <input
                onChange={(event) => updateAgentVoice({ style: event.currentTarget.value })}
                value={agentDraft.voice.style}
              />
            </label>
          </div>
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>回复节奏</span>
            <select
              onChange={(event) => updateAgentVoice({ pace: event.currentTarget.value })}
              value={agentDraft.voice.pace}
            >
              {agentVoicePaces.map((pace) => (
                <option key={pace} value={pace}>{pace}</option>
              ))}
            </select>
          </label>
        </div>
      )
}
