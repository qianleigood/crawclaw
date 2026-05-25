import { Plus, Wrench } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import type {
  AgentProfile,
  AgentWorkspaceState,
  CreateAgentInput,
  DesktopPreferences,
  UpdateAgentInput,
} from '../desktop-api'
import { AgentCreateWizard } from './agent-create-wizard'

const agentAvatarPalettes = [
  ['#2563eb', '#14b8a6', 'rgba(37, 99, 235, 0.24)'],
  ['#7c3aed', '#ec4899', 'rgba(124, 58, 237, 0.22)'],
  ['#0f766e', '#84cc16', 'rgba(15, 118, 110, 0.2)'],
  ['#be123c', '#f97316', 'rgba(190, 18, 60, 0.2)'],
  ['#4338ca', '#06b6d4', 'rgba(67, 56, 202, 0.22)'],
]

type AgentAvatarStyle = CSSProperties & {
  '--agent-avatar-from': string
  '--agent-avatar-glow': string
  '--agent-avatar-to': string
}

type AgentWorkspaceProps = {
  modelOptions: string[]
  onCreateAgent: (input: CreateAgentInput) => void
  onSelectAgent: (agentId: string) => void
  onUpdateAgent: (agentId: string, input: UpdateAgentInput) => void
  preferences: DesktopPreferences
  workspace: AgentWorkspaceState
}

function getAgentAvatarInitials(name: string) {
  const compactName = name.trim().replace(/\s+/g, ' ')
  if (!compactName) {
    return 'A'
  }

  if (isAsciiText(compactName)) {
    return compactName
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }

  return Array.from(compactName.replace(/\s/g, '')).slice(0, 1).join('').toUpperCase()
}

function isAsciiText(value: string) {
  return Array.from(value).every((char) => char.charCodeAt(0) <= 0x7f)
}

function getAgentAvatarStyle(agent: AgentProfile): AgentAvatarStyle {
  const seed = Array.from(`${agent.id}:${agent.name}`).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const [from, to, glow] = agentAvatarPalettes[seed % agentAvatarPalettes.length]

  const style: AgentAvatarStyle = {
    '--agent-avatar-from': from,
    '--agent-avatar-glow': glow,
    '--agent-avatar-to': to,
    ...(agent.avatar?.gradient ? { background: agent.avatar.gradient } : {}),
  }
  if (agent.avatar?.imageDataUrl) {
    style.backgroundImage = `url(${agent.avatar.imageDataUrl})`
    style.backgroundPosition = 'center'
    style.backgroundSize = 'cover'
  }
  return style
}

function getAgentAvatarText(agent: AgentProfile) {
  if (agent.avatar?.imageDataUrl) {
    return ''
  }
  return agent.avatar?.initials || getAgentAvatarInitials(agent.name)
}

function agentEnabledChannelCount(agent: AgentProfile) {
  return agent.channels.filter((channel) => channel.enabled).length
}

function agentVoiceLabel(agent: AgentProfile) {
  return agent.voice.enabled ? '语音已启用' : '语音关闭'
}

export function AgentWorkspace({
  modelOptions,
  onCreateAgent,
  onSelectAgent,
  onUpdateAgent,
  preferences,
  workspace,
}: AgentWorkspaceProps) {
  const [isAgentWizardOpen, setIsAgentWizardOpen] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState('')
  const agentCapabilityTemplate = workspace.agents[0]
  const editingAgent = workspace.agents.find((agent) => agent.id === editingAgentId) ?? null

  return (
    <div className="agent-workspace">
      <section className="agent-list-panel" aria-label="智能体列表面板">
        <header>
          <div>
            <h1>配置中心</h1>
            <p>{workspace.agents.length} 个智能体</p>
          </div>
          <button className="workspace-primary-button" onClick={() => setIsAgentWizardOpen(true)} type="button">
            <Plus aria-hidden="true" size={15} strokeWidth={2.2} />
            新建智能体
          </button>
        </header>
        <ul className="agent-list agent-list--separated" aria-label="智能体列表">
          {workspace.agents.map((agent) => (
            <li className={agent.id === workspace.selectedAgentId ? 'agent-list-row is-active' : 'agent-list-row'} key={agent.id}>
              <button
                aria-label={`${agent.name} ${agent.role} · ${agent.model} · ${agent.status}`}
                className={agent.id === workspace.selectedAgentId ? 'agent-list-item is-active' : 'agent-list-item'}
                onClick={() => onSelectAgent(agent.id)}
                type="button"
              >
                <span className="agent-list-item__profile">
                  <span
                    aria-label={`${agent.name} 头像`}
                    className={agent.avatar?.imageDataUrl ? 'agent-list-item__avatar has-image' : 'agent-list-item__avatar'}
                    role="img"
                    style={getAgentAvatarStyle(agent)}
                  >
                    {getAgentAvatarText(agent) ? <strong>{getAgentAvatarText(agent)}</strong> : null}
                  </span>
                  <span className="agent-list-item__identity">
                    <span className="agent-list-item__name">{agent.name}</span>
                    <small>{agent.role}</small>
                  </span>
                </span>
                <span className="agent-list-item__info">
                  <span aria-label={`${agent.name} 运行信息`} className="agent-list-item__info-line agent-list-item__info-line--runtime">
                    <span className={agent.status === '运行中' ? 'agent-list-item__status is-live' : 'agent-list-item__status'} data-status={agent.status}>{agent.status}</span>
                    <span>{agent.model}</span>
                  </span>
                  <span aria-label={`${agent.name} 配置信息`} className="agent-list-item__info-line agent-list-item__info-line--settings">
                    <span className="agent-list-item__setting">
                      <span>思考模式</span>
                      <strong>{agent.thinking}</strong>
                    </span>
                    <span>{agent.permissionMode}</span>
                    <span>{agentEnabledChannelCount(agent)} 个渠道</span>
                    <span>{agentVoiceLabel(agent)}</span>
                    <span>{agent.tools.length} 个工具 · {agent.skills.length} 个 Skill</span>
                  </span>
                </span>
              </button>
              <button
                aria-label={`配置智能体：${agent.name}`}
                className="agent-list-item__configure"
                onClick={() => {
                  onSelectAgent(agent.id)
                  setEditingAgentId(agent.id)
                }}
                type="button"
              >
                <Wrench aria-hidden="true" size={14} strokeWidth={2.1} />
                <span>配置</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {isAgentWizardOpen || editingAgent ? (
        <AgentCreateWizard
          agent={editingAgent ?? undefined}
          mode={editingAgent ? 'edit' : 'create'}
          modelOptions={modelOptions}
          onClose={() => {
            setIsAgentWizardOpen(false)
            setEditingAgentId('')
          }}
          onCreateAgent={onCreateAgent}
          onUpdateAgent={onUpdateAgent}
          preferences={preferences}
          skillOptions={editingAgent?.skills ?? agentCapabilityTemplate?.skills ?? []}
          toolOptions={editingAgent?.tools ?? agentCapabilityTemplate?.tools ?? []}
        />
      ) : null}
    </div>
  )
}
