import { Check, Plus, Wrench } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import type {
  AddAgentSkillInput,
  AgentProfile,
  AgentSkill,
  AgentTool,
  AgentWorkspaceState,
  CreateAgentInput,
  DesktopPreferences,
  PluginSkill,
  PluginTool,
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
  availableSkills: PluginSkill[]
  availableTools: PluginTool[]
  modelOptions: string[]
  onAddAgentSkill: (agentId: string, skill: AddAgentSkillInput) => void
  onCreateAgent: (input: CreateAgentInput) => void
  onSelectAgent: (agentId: string) => void
  onToggleAgentSkill: (agentId: string, skillId: string) => void
  onToggleAgentTool: (agentId: string, toolId: string) => void
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

function pluginToolsToAgentOptions(tools: PluginTool[]): AgentTool[] {
  return tools.map((tool) => ({
    description: tool.description,
    enabled: false,
    icon: tool.icon,
    id: tool.id,
    name: tool.name,
    open: tool.open,
    permission: tool.permission,
    status: tool.status,
  }))
}

function pluginSkillsToAgentOptions(skills: PluginSkill[]): AgentSkill[] {
  return skills.map((skill) => ({
    description: skill.description,
    enabled: false,
    icon: skill.icon,
    id: skill.id,
    name: skill.name,
    open: skill.open,
    source: skill.source,
    status: skill.status,
    trigger: skill.trigger,
  }))
}

export function AgentWorkspace({
  availableSkills,
  availableTools,
  modelOptions,
  onAddAgentSkill,
  onCreateAgent,
  onSelectAgent,
  onToggleAgentSkill,
  onToggleAgentTool,
  onUpdateAgent,
  preferences,
  workspace,
}: AgentWorkspaceProps) {
  const [isAgentWizardOpen, setIsAgentWizardOpen] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState('')
  const editingAgent = workspace.agents.find((agent) => agent.id === editingAgentId) ?? null
  const selectedAgent = workspace.agents.find((agent) => agent.id === workspace.selectedAgentId) ?? workspace.agents[0] ?? null
  const agentSkillOptions = pluginSkillsToAgentOptions(availableSkills)
  const agentToolOptions = pluginToolsToAgentOptions(availableTools)
  const addableSkills = selectedAgent
    ? availableSkills.filter((skill) => !selectedAgent.skills.some((agentSkill) =>
      agentSkill.id === skill.id || agentSkill.trigger === skill.trigger
    ))
    : []

  return (
    <div className="agent-workspace" data-testid="agent-workspace">
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
            <li
              className={agent.id === workspace.selectedAgentId ? 'agent-list-row is-active' : 'agent-list-row'}
              data-agent-id={agent.id}
              data-testid="agent-list-row"
              key={agent.id}
            >
              <button
                aria-label={`${agent.name} ${agent.role} · ${agent.model} · ${agent.status}`}
                className={agent.id === workspace.selectedAgentId ? 'agent-list-item is-active' : 'agent-list-item'}
                data-agent-id={agent.id}
                data-testid="agent-list-item"
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

      {selectedAgent ? (
        <section
          aria-label={`${selectedAgent.name} 能力开关`}
          className="agent-summary-panel"
          data-agent-id={selectedAgent.id}
          data-testid="agent-summary"
        >
          <div className="agent-summary-panel__title">
            <div>
              <p className="panel-kicker">Agent capabilities</p>
              <h2>{selectedAgent.name}</h2>
              <p>{selectedAgent.description || selectedAgent.role}</p>
            </div>
            <button
              className="workspace-secondary-button"
              onClick={() => {
                onSelectAgent(selectedAgent.id)
                setEditingAgentId(selectedAgent.id)
              }}
              type="button"
            >
              <Wrench aria-hidden="true" size={14} strokeWidth={2.1} />
              完整配置
            </button>
          </div>
          <div className="agent-capability-columns">
            <div className="agent-capability-panel">
              <div className="agent-capability-panel__title">
                <strong>工具</strong>
                <small>{selectedAgent.tools.filter((tool) => tool.enabled).length}/{selectedAgent.tools.length} enabled</small>
              </div>
              <div className="agent-capability-list">
                {selectedAgent.tools.length > 0 ? selectedAgent.tools.map((tool) => (
                  <button
                    aria-pressed={tool.enabled}
                    className={tool.enabled ? 'agent-capability-toggle is-on' : 'agent-capability-toggle'}
                    data-agent-id={selectedAgent.id}
                    data-testid="agent-tool-toggle"
                    data-tool-id={tool.id}
                    key={tool.id}
                    onClick={() => onToggleAgentTool(selectedAgent.id, tool.id)}
                    type="button"
                  >
                    <span className="agent-capability-toggle__check">
                      <Check aria-hidden="true" size={13} strokeWidth={2.3} />
                    </span>
                    <span>
                      <strong>{tool.name}</strong>
                      <small>{tool.description || tool.permission}</small>
                    </span>
                  </button>
                )) : (
                  <div className="agent-capability-empty">这个 agent 还没有工具。</div>
                )}
              </div>
            </div>
            <div className="agent-capability-panel">
              <div className="agent-capability-panel__title">
                <strong>Skill</strong>
                <small>{selectedAgent.skills.filter((skill) => skill.enabled).length}/{selectedAgent.skills.length} enabled</small>
              </div>
              <div className="agent-capability-list">
                {selectedAgent.skills.length > 0 ? selectedAgent.skills.map((skill) => (
                  <button
                    aria-pressed={skill.enabled}
                    className={skill.enabled ? 'agent-capability-toggle is-on' : 'agent-capability-toggle'}
                    data-agent-id={selectedAgent.id}
                    data-skill-id={skill.id}
                    data-testid="agent-skill-toggle"
                    key={skill.id}
                    onClick={() => onToggleAgentSkill(selectedAgent.id, skill.id)}
                    type="button"
                  >
                    <span className="agent-capability-toggle__check">
                      <Check aria-hidden="true" size={13} strokeWidth={2.3} />
                    </span>
                    <span>
                      <strong>{skill.name}</strong>
                      <small>{skill.trigger || skill.source}</small>
                    </span>
                  </button>
                )) : (
                  <div className="agent-capability-empty">这个 agent 还没有 Skill。</div>
                )}
              </div>
              {addableSkills.length > 0 ? (
                <div className="agent-skill-add-list" aria-label="可添加 Skill">
                  {addableSkills.slice(0, 4).map((skill) => (
                    <button
                      key={skill.id}
                      onClick={() => onAddAgentSkill(selectedAgent.id, {
                        description: skill.description,
                        name: skill.name,
                        trigger: skill.trigger,
                      })}
                      type="button"
                    >
                      <Plus aria-hidden="true" size={13} strokeWidth={2.2} />
                      {skill.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

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
          skillOptions={agentSkillOptions}
          toolOptions={agentToolOptions}
        />
      ) : null}
    </div>
  )
}
