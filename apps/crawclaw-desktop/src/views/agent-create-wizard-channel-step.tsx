import type {
  AgentChannelBinding,
  AgentChannelConfig,
  AgentChannelConfigField,
} from '../desktop-api'
import {
  agentChannelDmPolicies,
  agentChannelGroupPolicies,
  createAgentChannelConfig,
  type AgentCreateDraft,
} from './agent-create-wizard-model'

type AgentChannelStepProps = {
  agentDraft: AgentCreateDraft
  toggleAgentDraftChannel: (channelId: string) => void
  updateAgentDraftChannelConfig: (channelId: string, patch: Partial<AgentChannelConfig>) => void
  updateAgentDraftChannelField: (channelId: string, fieldId: string, value: string) => void
}

export function AgentChannelStep({
  agentDraft,
  toggleAgentDraftChannel,
  updateAgentDraftChannelConfig,
  updateAgentDraftChannelField,
}: AgentChannelStepProps) {
  const renderAgentChannelConfigField = (channel: AgentChannelBinding, field: AgentChannelConfigField) => {
    if (field.id === 'markdownSupport' || field.id === 'wakeWord') {
      return (
        <label className="agent-create-wizard__channel-toggle" key={field.id}>
          <input
            aria-label={`${channel.label} ${field.label}`}
            checked={field.value !== 'false'}
            onChange={(event) => updateAgentDraftChannelField(channel.id, field.id, event.currentTarget.checked ? 'true' : 'false')}
            type="checkbox"
          />
          <span>{field.label}</span>
        </label>
      )
    }

    return (
      <label className="agent-create-wizard__field agent-create-wizard__field--channel-secret" key={field.id}>
        <span>{`${channel.label} ${field.label}`}</span>
        <input
          aria-label={`${channel.label} ${field.label}`}
          onChange={(event) => updateAgentDraftChannelField(channel.id, field.id, event.currentTarget.value)}
          type={field.secret ? 'password' : 'text'}
          value={field.value}
        />
      </label>
    )
  }

  const renderAgentChannelConfig = (channel: AgentChannelBinding) => {
    const config = channel.config ?? createAgentChannelConfig(channel.id)

    if (channel.id === 'desktop') {
      return (
        <section aria-label={`${channel.label} 渠道配置`} className="agent-create-wizard__channel-config" key={channel.id}>
          <div className="agent-create-wizard__channel-config-header">
            <strong>{channel.label}</strong>
            <span>本机桌面</span>
          </div>
          <div className="agent-create-wizard__channel-static">
            <span>入口</span>
            <strong>本机桌面</strong>
          </div>
        </section>
      )
    }

    return (
      <section aria-label={`${channel.label} 渠道配置`} className="agent-create-wizard__channel-config" key={channel.id}>
        <div className="agent-create-wizard__channel-config-header">
          <strong>{channel.label}</strong>
          <span>
            {channel.id === 'weixin' ? '扫码或配对登录' : channel.id === 'esp32' ? '本机设备连接参数' : '保存连接参数'}
          </span>
        </div>
        <div className="agent-create-wizard__channel-config-grid">
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>{`${channel.label} 账号 ID`}</span>
            <input
              aria-label={`${channel.label} 账号 ID`}
              onChange={(event) => updateAgentDraftChannelConfig(channel.id, { accountId: event.currentTarget.value })}
              value={config.accountId}
            />
          </label>
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>{`${channel.label} 默认目标`}</span>
            <input
              aria-label={`${channel.label} 默认目标`}
              onChange={(event) => updateAgentDraftChannelConfig(channel.id, { target: event.currentTarget.value })}
              placeholder={
                channel.id === 'feishu'
                  ? 'open_chat_id / user_id'
                  : channel.id === 'esp32'
                    ? 'deviceId，留空则配对后选择'
                    : '会话、群或频道 ID'
              }
              value={config.target}
            />
          </label>
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>{`${channel.label} DM 策略`}</span>
            <select
              aria-label={`${channel.label} DM 策略`}
              onChange={(event) => updateAgentDraftChannelConfig(channel.id, { dmPolicy: event.currentTarget.value })}
              value={config.dmPolicy}
            >
              {agentChannelDmPolicies.map((policy) => (
                <option key={policy.id} value={policy.id}>{policy.label}</option>
              ))}
            </select>
          </label>
          <label className="agent-create-wizard__field agent-create-wizard__field--compact">
            <span>{`${channel.label} 群聊策略`}</span>
            <select
              aria-label={`${channel.label} 群聊策略`}
              onChange={(event) => updateAgentDraftChannelConfig(channel.id, { groupPolicy: event.currentTarget.value })}
              value={config.groupPolicy}
            >
              {agentChannelGroupPolicies.map((policy) => (
                <option key={policy.id} value={policy.id}>{policy.label}</option>
              ))}
            </select>
          </label>
        </div>
        {config.fields.length ? (
          <div className="agent-create-wizard__channel-secret-grid">
            {config.fields.map((field) => renderAgentChannelConfigField(channel, field))}
          </div>
        ) : (
          <p className="agent-create-wizard__channel-note">
            {channel.id === 'weixin'
              ? '微信使用扫码或本机配对完成登录，这里只保存账号和目标偏好。'
              : channel.id === 'esp32'
                ? 'ESP32 使用本机托管的 MQTT/UDP 连接参数。'
                : '当前渠道不需要额外凭据字段。'}
          </p>
        )}
      </section>
    )
  }

      const enabledChannels = agentDraft.channels.filter((channel) => channel.enabled)
      return (
        <div className="agent-create-wizard__section">
          <h3>绑定渠道</h3>
          <div className="agent-create-wizard__channel-layout">
            <div className="agent-create-wizard__checks agent-create-wizard__checks--channels">
              {agentDraft.channels.map((channel) => (
                <label className="agent-create-wizard__check-card" key={channel.id}>
                  <input
                    aria-label={channel.label}
                    checked={channel.enabled}
                    onChange={() => toggleAgentDraftChannel(channel.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{channel.label}</strong>
                    <small>{channel.id === 'desktop' ? '本机桌面入口' : '启用后配置账号、目标和凭据'}</small>
                  </span>
                </label>
              ))}
            </div>
            <div className="agent-create-wizard__channel-configs">
              {enabledChannels.map(renderAgentChannelConfig)}
            </div>
          </div>
        </div>
      )
}
