import {
  Bot,
  Brain,
  CheckCircle2,
  Image as ImageIcon,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { ChangeEvent } from 'react'
import type {
  AgentAvatarProfile,
  AgentChannelConfig,
  AgentSkill,
  AgentTool,
  AgentVoiceConfig,
  DesktopPreferences,
} from '../desktop-api'
import {
  agentVoiceSourceOptions,
  agentWizardSteps,
  formatAgentChannelConfigSummary,
  getAgentAvatarPreviewStyle,
  type AgentCreateDraft,
} from './agent-create-wizard-model'
import { AgentChannelStep } from './agent-create-wizard-channel-step'
import { AgentVoiceStep } from './agent-create-wizard-voice-step'

type AgentWizardStep = (typeof agentWizardSteps)[number]

type AgentWizardStepContentProps = {
  agentDraft: AgentCreateDraft
  agentWizardActiveStep: AgentWizardStep
  agentWizardAvatar: AgentAvatarProfile
  derivedAgentDescription: string
  derivedAgentRole: string
  generateAgentAvatar: () => void
  generateAgentVoiceStyle: () => void
  modelOptions: string[]
  preferences: DesktopPreferences
  skillOptions: AgentSkill[]
  toggleAgentDraftChannel: (channelId: string) => void
  toggleAgentDraftSkill: (skillId: string) => void
  toggleAgentDraftTool: (toolId: string) => void
  toolOptions: AgentTool[]
  updateAgentDraft: (patch: Partial<AgentCreateDraft>) => void
  updateAgentDraftChannelConfig: (channelId: string, patch: Partial<AgentChannelConfig>) => void
  updateAgentDraftChannelField: (channelId: string, fieldId: string, value: string) => void
  updateAgentEmotionPrompt: (promptMd: string) => void
  updateAgentVoice: (patch: Partial<AgentVoiceConfig>) => void
  uploadAgentAvatar: (event: ChangeEvent<HTMLInputElement>) => void
  uploadAgentVoiceCloneSample: (event: ChangeEvent<HTMLInputElement>) => void
}

export function AgentWizardStepContent({
  agentDraft,
  agentWizardActiveStep,
  agentWizardAvatar,
  derivedAgentDescription,
  derivedAgentRole,
  generateAgentAvatar,
  generateAgentVoiceStyle,
  modelOptions,
  preferences,
  skillOptions,
  toggleAgentDraftChannel,
  toggleAgentDraftSkill,
  toggleAgentDraftTool,
  toolOptions,
  updateAgentDraft,
  updateAgentDraftChannelConfig,
  updateAgentDraftChannelField,
  updateAgentEmotionPrompt,
  updateAgentVoice,
  uploadAgentAvatar,
  uploadAgentVoiceCloneSample,
}: AgentWizardStepContentProps) {
  const renderToolChoice = (tool: AgentTool) => (
    <label className="agent-create-wizard__check-card" key={tool.id}>
      <input
        aria-label={`启用工具：${tool.name}`}
        checked={agentDraft.toolIds.includes(tool.id)}
        onChange={() => toggleAgentDraftTool(tool.id)}
        type="checkbox"
      />
      <span>
        <strong>{tool.name}</strong>
        <small>{tool.description}</small>
      </span>
    </label>
  )

  const renderSkillChoice = (skill: AgentSkill) => (
    <label className="agent-create-wizard__check-card" key={skill.id}>
      <input
        aria-label={`启用 Skill：${skill.name}`}
        checked={agentDraft.skillIds.includes(skill.id)}
        onChange={() => toggleAgentDraftSkill(skill.id)}
        type="checkbox"
      />
      <span>
        <strong>{skill.name}</strong>
        <small>{skill.trigger}</small>
      </span>
    </label>
  )

  const enabledAgentChannelDetails = agentDraft.channels
    .filter((channel) => channel.enabled)
    .map(formatAgentChannelConfigSummary)
    .filter(Boolean)

  const renderAgentWizardStepContent = () => {
    if (agentWizardActiveStep === '身份情感') {
      return (
        <div className="agent-create-wizard__identity">
          <div className="agent-create-wizard__fields">
            <label className="agent-create-wizard__field">
              <span>智能体名称</span>
              <input
                autoFocus
                onChange={(event) => updateAgentDraft({ name: event.currentTarget.value })}
                value={agentDraft.name}
              />
            </label>
            <label className="agent-create-wizard__field agent-create-wizard__field--agent-md">
              <span>智能体设定 Markdown</span>
              <textarea
                onChange={(event) => updateAgentDraft({ agentMd: event.currentTarget.value })}
                value={agentDraft.agentMd}
              />
            </label>
            <label className="agent-create-wizard__field agent-create-wizard__field--prompt">
              <span>情感提示词 Markdown</span>
              <textarea
                onChange={(event) => updateAgentEmotionPrompt(event.currentTarget.value)}
                value={agentDraft.emotion.promptMd}
              />
            </label>
          </div>
          <aside className="agent-create-wizard__avatar-preview" aria-label="智能体头像预览">
            <span
              className={agentWizardAvatar.imageDataUrl ? 'agent-create-wizard__avatar has-image' : 'agent-create-wizard__avatar'}
              role="img"
              style={getAgentAvatarPreviewStyle(agentWizardAvatar)}
            >
              {agentWizardAvatar.imageDataUrl ? null : <strong>{agentWizardAvatar.initials}</strong>}
            </span>
            <strong>{agentDraft.name.trim() || '新智能体'}</strong>
            <small>{derivedAgentRole}</small>
            <button
              className="agent-create-wizard__generate-button"
              disabled={!agentDraft.name.trim() || !agentDraft.agentMd.trim()}
              onClick={generateAgentAvatar}
              type="button"
            >
              <Sparkles aria-hidden="true" size={14} strokeWidth={2.2} />
              AI 生成头像
            </button>
            <label className="agent-create-wizard__upload-button">
              <input accept="image/*" onChange={uploadAgentAvatar} type="file" />
              <span>
                <ImageIcon aria-hidden="true" size={14} strokeWidth={2.1} />
                上传头像
              </span>
            </label>
            {agentDraft.generationNotice ? (
              <small>{agentDraft.generationNotice}</small>
            ) : null}
          </aside>
        </div>
      )
    }

    if (agentWizardActiveStep === '语音') {
      return (
        <AgentVoiceStep
          agentDraft={agentDraft}
          generateAgentVoiceStyle={generateAgentVoiceStyle}
          updateAgentVoice={updateAgentVoice}
          uploadAgentVoiceCloneSample={uploadAgentVoiceCloneSample}
        />
      )
    }

    if (agentWizardActiveStep === '渠道') {
      return (
        <AgentChannelStep
          agentDraft={agentDraft}
          toggleAgentDraftChannel={toggleAgentDraftChannel}
          updateAgentDraftChannelConfig={updateAgentDraftChannelConfig}
          updateAgentDraftChannelField={updateAgentDraftChannelField}
        />
      )
    }

    if (agentWizardActiveStep === '模型选择') {
      return (
        <div className="agent-create-wizard__model-layout">
          <section aria-label="选择模型" className="agent-create-wizard__model-picker" role="group">
            <div className="agent-create-wizard__section-heading">
              <h3>模型选择</h3>
              <p>先确定智能体默认使用的模型，再配置思考强度和权限边界。</p>
            </div>
            <div className="agent-create-wizard__model-list">
              {modelOptions.map((model, index) => {
                const isSelected = agentDraft.model === model
                const isRecommended = index === 0
                const modelDescription = model.includes('5.4')
                  ? '响应更轻，适合高频流程和日常任务。'
                  : model.includes('Sonnet')
                    ? '适合代码审查、长上下文和结构化分析。'
                    : '默认推荐，适合复杂规划和多步骤执行。'

                return (
                  <button
                    aria-label={`模型 ${model}${isRecommended ? ' 推荐' : ''}`}
                    aria-pressed={isSelected}
                    className={isSelected ? 'agent-create-wizard__model-card is-selected' : 'agent-create-wizard__model-card'}
                    key={model}
                    onClick={() => updateAgentDraft({ model })}
                    type="button"
                  >
                    <span className="agent-create-wizard__model-icon">
                      {isRecommended ? (
                        <Sparkles aria-hidden="true" size={16} strokeWidth={2.1} />
                      ) : (
                        <Bot aria-hidden="true" size={16} strokeWidth={2.1} />
                      )}
                    </span>
                    <span className="agent-create-wizard__model-body">
                      <span>
                        <strong>{model}</strong>
                        {isRecommended ? <em>推荐</em> : null}
                      </span>
                      <small>{modelDescription}</small>
                    </span>
                    {isSelected ? (
                      <CheckCircle2 aria-hidden="true" className="agent-create-wizard__model-check" size={17} strokeWidth={2.2} />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </section>
          <aside aria-label="模型配置" className="agent-create-wizard__model-config" role="region">
            <div className="agent-create-wizard__model-summary">
              <span>当前配置</span>
              <strong>{agentDraft.model}</strong>
              <p>思考模式 {agentDraft.thinking} · 权限 {agentDraft.permissionMode}</p>
            </div>
            <div className="agent-create-wizard__config-block">
              <span className="agent-create-wizard__label">思考模式</span>
              <div className="agent-create-wizard__segmented">
                {preferences.thinkingOptions.map((thinking) => (
                  <button
                    aria-pressed={agentDraft.thinking === thinking}
                    className={agentDraft.thinking === thinking ? 'is-selected' : ''}
                    key={thinking}
                    onClick={() => updateAgentDraft({ thinking })}
                    type="button"
                  >
                    <Brain aria-hidden="true" size={13} strokeWidth={2.1} />
                    {thinking}
                  </button>
                ))}
              </div>
            </div>
            <div className="agent-create-wizard__config-block">
              <span className="agent-create-wizard__label">权限模式</span>
              <div className="agent-create-wizard__permission-list">
                {preferences.permissionModeOptions.map((permissionModeOption) => (
                  <button
                    aria-pressed={agentDraft.permissionMode === permissionModeOption}
                    className={agentDraft.permissionMode === permissionModeOption ? 'is-selected' : ''}
                    key={permissionModeOption}
                    onClick={() => updateAgentDraft({ permissionMode: permissionModeOption })}
                    type="button"
                  >
                    <ShieldCheck aria-hidden="true" size={14} strokeWidth={2.1} />
                    <span>{permissionModeOption}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )
    }

    if (agentWizardActiveStep === '能力') {
      return (
        <div className="agent-create-wizard__section">
          <h3>能力选择</h3>
          <span className="agent-create-wizard__label">Tools</span>
          <div className="agent-create-wizard__checks">
            {toolOptions.map(renderToolChoice)}
          </div>
          <span className="agent-create-wizard__label">Skills</span>
          <div className="agent-create-wizard__checks">
            {skillOptions.map(renderSkillChoice)}
          </div>
        </div>
      )
    }

    const enabledChannels = agentDraft.channels.filter((channel) => channel.enabled).map((channel) => channel.label)
    return (
      <div className="agent-create-wizard__section">
        <h3>确认创建</h3>
        <div className="agent-create-wizard__summary">
          <span><strong>身份</strong>{agentDraft.name.trim()} · {derivedAgentRole}</span>
          <span><strong>任务</strong>{derivedAgentDescription}</span>
          <span>
            <strong>情感</strong>
            {agentDraft.emotion.style}
            {agentDraft.emotion.promptMd.trim() ? <em>已填写情感提示词</em> : <em>未填写情感提示词</em>}
          </span>
          <span><strong>语音</strong>{agentDraft.voice.enabled ? '语音已启用' : '语音关闭'} · {agentVoiceSourceOptions.find((source) => source.id === agentDraft.voice.source)?.label ?? 'Qwen 系统音色'} · {agentDraft.voice.source === 'voice-clone' ? (agentDraft.voice.cloneSampleName || '未上传样本') : agentDraft.voice.presetVoice} · {agentDraft.voice.style} · {agentDraft.voice.pace}</span>
          <span><strong>渠道</strong>{enabledChannels.join('、')}</span>
          {enabledAgentChannelDetails.length ? <span><strong>渠道配置</strong>{enabledAgentChannelDetails.join('；')}</span> : null}
          <span><strong>模型</strong>{agentDraft.model} · 思考模式 {agentDraft.thinking} · {agentDraft.permissionMode}</span>
          <span><strong>能力</strong>{agentDraft.toolIds.length} 个工具 · {agentDraft.skillIds.length} 个 Skill</span>
        </div>
      </div>
    )
  }


  return renderAgentWizardStepContent()
}
