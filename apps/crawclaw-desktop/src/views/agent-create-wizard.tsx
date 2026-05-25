import {
  Bot,
  X,
} from 'lucide-react'
import {
  useEffect,
  useState,
  type ChangeEvent,
} from 'react'
import type {
  AgentChannelConfig,
  AgentProfile,
  AgentSkill,
  AgentTool,
  AgentVoiceConfig,
  CreateAgentInput,
  DesktopPreferences,
  UpdateAgentInput,
} from '../desktop-api'

import {
  agentWizardSteps,
  createAgentAvatar,
  createAgentChannelConfig,
  createAgentDraft,
  createAgentDraftFromProfile,
  createVoiceStyleFromEmotionPrompt,
  deriveAgentDraftDescription,
  deriveAgentDraftRole,
  generateAgentAvatarDraft,
  getAgentAvatarInitials,
  type AgentCreateDraft,
} from './agent-create-wizard-model'
import { AgentWizardStepContent } from './agent-create-wizard-steps'

type AgentCreateWizardProps = {
  agent?: AgentProfile
  mode?: 'create' | 'edit'
  modelOptions: string[]
  onClose: () => void
  onCreateAgent: (input: CreateAgentInput) => void
  onUpdateAgent?: (agentId: string, input: UpdateAgentInput) => void
  preferences: DesktopPreferences
  skillOptions: AgentSkill[]
  toolOptions: AgentTool[]
}

export function AgentCreateWizard({
  agent,
  mode = 'create',
  modelOptions,
  onClose,
  onCreateAgent,
  onUpdateAgent,
  preferences,
  skillOptions,
  toolOptions,
}: AgentCreateWizardProps) {
  const [agentWizardStep, setAgentWizardStep] = useState(0)
  const [agentDraft, setAgentDraft] = useState<AgentCreateDraft>(() => (
    agent ? createAgentDraftFromProfile(agent) : createAgentDraft(preferences)
  ))
  const agentWizardAvatar = createAgentAvatar(agentDraft)
  const agentWizardActiveStep = agentWizardSteps[agentWizardStep]
  const derivedAgentRole = deriveAgentDraftRole(agentDraft)
  const derivedAgentDescription = deriveAgentDraftDescription(agentDraft)
  const isAgentIdentityValid = Boolean(agentDraft.name.trim() && agentDraft.agentMd.trim())
  const hasAgentChannel = agentDraft.channels.some((channel) => channel.enabled)
  const canAdvanceAgentWizard = (agentWizardActiveStep === '身份情感' && isAgentIdentityValid)
    || (agentWizardActiveStep === '渠道' && hasAgentChannel)
    || (agentWizardActiveStep !== '身份情感' && agentWizardActiveStep !== '渠道')

  useEffect(() => {
    setAgentDraft(agent ? createAgentDraftFromProfile(agent) : createAgentDraft(preferences))
    setAgentWizardStep(0)
  }, [agent, preferences])


  const closeAgentWizard = () => {
    setAgentDraft(agent ? createAgentDraftFromProfile(agent) : createAgentDraft(preferences))
    setAgentWizardStep(0)
    onClose()
  }

  const updateAgentDraft = (patch: Partial<AgentCreateDraft>) => {
    setAgentDraft((draft) => ({ ...draft, ...patch }))
  }

  const updateAgentEmotionPrompt = (promptMd: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      emotion: {
        ...draft.emotion,
        promptMd,
      },
    }))
  }

  const generateAgentAvatar = () => {
    setAgentDraft(generateAgentAvatarDraft)
  }

  const uploadAgentAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        return
      }
      setAgentDraft((draft) => ({
        ...draft,
        avatar: {
          gradient: createAgentAvatar(draft).gradient,
          imageDataUrl: reader.result as string,
          initials: getAgentAvatarInitials(draft.name.trim() || '智能体'),
          source: 'uploaded',
        },
        generationNotice: '已上传头像',
      }))
    })
    reader.readAsDataURL(file)
  }

  const updateAgentVoice = (patch: Partial<AgentVoiceConfig>) => {
    setAgentDraft((draft) => ({
      ...draft,
      voice: {
        ...draft.voice,
        ...patch,
      },
    }))
  }

  const uploadAgentVoiceCloneSample = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }

    updateAgentVoice({
      cloneSampleName: file.name,
      cloneVoiceName: agentDraft.voice.cloneVoiceName || `${agentDraft.name.trim() || '新智能体'}声音`,
      source: 'voice-clone',
    })
  }

  const generateAgentVoiceStyle = () => {
    updateAgentVoice({ style: createVoiceStyleFromEmotionPrompt(agentDraft.emotion.promptMd) })
  }

  const toggleAgentDraftChannel = (channelId: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      channels: draft.channels.map((channel) => (
        channel.id === channelId ? { ...channel, enabled: !channel.enabled } : channel
      )),
    }))
  }

  const updateAgentDraftChannelConfig = (channelId: string, patch: Partial<AgentChannelConfig>) => {
    setAgentDraft((draft) => ({
      ...draft,
      channels: draft.channels.map((channel) => {
        if (channel.id !== channelId) {
          return channel
        }
        const config = channel.config ?? createAgentChannelConfig(channel.id)
        return {
          ...channel,
          config: {
            ...config,
            ...patch,
            fields: patch.fields ?? config.fields,
          },
        }
      }),
    }))
  }

  const updateAgentDraftChannelField = (channelId: string, fieldId: string, value: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      channels: draft.channels.map((channel) => {
        if (channel.id !== channelId) {
          return channel
        }
        const config = channel.config ?? createAgentChannelConfig(channel.id)
        return {
          ...channel,
          config: {
            ...config,
            fields: config.fields.map((field) => (
              field.id === fieldId ? { ...field, value } : field
            )),
          },
        }
      }),
    }))
  }

  const toggleAgentDraftTool = (toolId: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      toolIds: draft.toolIds.includes(toolId)
        ? draft.toolIds.filter((id) => id !== toolId)
        : [...draft.toolIds, toolId],
    }))
  }

  const toggleAgentDraftSkill = (skillId: string) => {
    setAgentDraft((draft) => ({
      ...draft,
      skillIds: draft.skillIds.includes(skillId)
        ? draft.skillIds.filter((id) => id !== skillId)
        : [...draft.skillIds, skillId],
    }))
  }

  const goToNextAgentWizardStep = () => {
    if (!canAdvanceAgentWizard) {
      return
    }

    setAgentWizardStep((step) => Math.min(step + 1, agentWizardSteps.length - 1))
  }

  const goToPreviousAgentWizardStep = () => {
    setAgentWizardStep((step) => Math.max(step - 1, 0))
  }

  const submitAgentWizard = () => {
    const payload: CreateAgentInput = {
      avatar: agentWizardAvatar,
      channels: agentDraft.channels,
      description: derivedAgentDescription,
      emotion: agentDraft.emotion,
      model: agentDraft.model,
      name: agentDraft.name.trim(),
      permissionMode: agentDraft.permissionMode,
      role: derivedAgentRole,
      skillIds: agentDraft.skillIds,
      thinking: agentDraft.thinking,
      toolIds: agentDraft.toolIds,
      voice: agentDraft.voice,
    }
    if (!isAgentIdentityValid || !payload.name || !payload.role || !payload.channels?.some((channel) => channel.enabled)) {
      return
    }

    if (mode === 'edit' && agent && onUpdateAgent) {
      onUpdateAgent(agent.id, payload)
    } else {
      onCreateAgent(payload)
    }
    setAgentDraft(createAgentDraft(preferences))
    setAgentWizardStep(0)
    onClose()
  }


  return (
    <div
      className="agent-create-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeAgentWizard()
        }
      }}
    >
      <div
        aria-labelledby="agent-create-dialog-title"
        aria-modal="true"
        className="agent-create-dialog agent-create-wizard"
        role="dialog"
      >
        <header className="agent-create-dialog__header">
          <span className="agent-create-dialog__icon">
            <Bot aria-hidden="true" size={18} strokeWidth={2.2} />
          </span>
          <div>
            <h2 id="agent-create-dialog-title">{mode === 'edit' ? '编辑智能体' : '新建智能体'}</h2>
            <p>{mode === 'edit' ? '调整配置后一次性保存。' : '按步骤完成配置，最后一次性创建。'}</p>
          </div>
          <button aria-label={mode === 'edit' ? '关闭编辑智能体' : '关闭新建智能体'} onClick={closeAgentWizard} type="button">
            <X aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        </header>

        <div className="agent-create-dialog__steps agent-create-wizard__steps agent-create-wizard__node-rail" aria-label="新建智能体引导">
          {agentWizardSteps.map((step, index) => (
            <span className="agent-create-wizard__step-node" key={step}>
              <span
                aria-label={`${index + 1} ${step}`}
                className={index === agentWizardStep ? 'agent-create-wizard__node is-active' : index < agentWizardStep ? 'agent-create-wizard__node is-complete' : 'agent-create-wizard__node'}
              >
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </span>
              {index < agentWizardSteps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={index < agentWizardStep ? 'agent-create-wizard__connector is-complete' : 'agent-create-wizard__connector'}
                />
              ) : null}
            </span>
          ))}
        </div>

        <section className="agent-create-wizard__body" aria-label={`当前步骤：${agentWizardActiveStep}`}>
          <AgentWizardStepContent
            agentDraft={agentDraft}
            agentWizardActiveStep={agentWizardActiveStep}
            agentWizardAvatar={agentWizardAvatar}
            derivedAgentDescription={derivedAgentDescription}
            derivedAgentRole={derivedAgentRole}
            generateAgentAvatar={generateAgentAvatar}
            generateAgentVoiceStyle={generateAgentVoiceStyle}
            modelOptions={modelOptions}
            preferences={preferences}
            skillOptions={skillOptions}
            toggleAgentDraftChannel={toggleAgentDraftChannel}
            toggleAgentDraftSkill={toggleAgentDraftSkill}
            toggleAgentDraftTool={toggleAgentDraftTool}
            toolOptions={toolOptions}
            updateAgentDraft={updateAgentDraft}
            updateAgentDraftChannelConfig={updateAgentDraftChannelConfig}
            updateAgentDraftChannelField={updateAgentDraftChannelField}
            updateAgentEmotionPrompt={updateAgentEmotionPrompt}
            updateAgentVoice={updateAgentVoice}
            uploadAgentAvatar={uploadAgentAvatar}
            uploadAgentVoiceCloneSample={uploadAgentVoiceCloneSample}
          />
        </section>

        <footer className="agent-create-dialog__footer agent-create-wizard__footer">
          <button disabled={agentWizardStep === 0} onClick={goToPreviousAgentWizardStep} type="button">上一步</button>
          {agentWizardStep === agentWizardSteps.length - 1 ? (
            <button
              className="agent-create-dialog__submit"
              disabled={!isAgentIdentityValid || !hasAgentChannel}
              onClick={submitAgentWizard}
              type="button"
            >
              {mode === 'edit' ? '保存配置' : '创建智能体'}
            </button>
          ) : (
            <button disabled={!canAdvanceAgentWizard} onClick={goToNextAgentWizardStep} type="button">下一步</button>
          )}
        </footer>
      </div>
    </div>
  )
}
