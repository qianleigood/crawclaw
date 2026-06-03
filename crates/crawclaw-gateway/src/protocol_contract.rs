use serde_json::Value;

const GATEWAY_PROTOCOL_SCHEMA_JSON: &str =
    include_str!("protocol_contract/protocol.schema.stable.json");

pub const GATEWAY_PROTOCOL_VERSION: u16 = 3;

pub const GATEWAY_PROTOCOL_EVENTS: &[&str] = &[
    "runtimeChanged",
    "sessionStarted",
    "messageDelta",
    "toolCall",
    "toolResult",
    "messageFinal",
    "permissionRequested",
    "operationFailed",
    "stateChanged",
    "session.message",
    "sessions.changed",
    "channel.lifecycle",
    "chat",
    "channel.send",
    "talk.mode",
    "voicewake.changed",
    "main-session-wake",
    "cron",
    "agent.contextProjected",
    "agent.providerBlock",
    "agent.toolProgress",
    "agent.toolUseSummary",
    "agent.permissionRequested",
    "agent.permissionDecision",
    "agent.hookDecision",
    "agent.subagentLifecycle",
    "agent.mcpElicitation",
];

pub const GATEWAY_PROTOCOL_METHODS: &[&str] = &[
    "health",
    "status",
    "system.status",
    "system.health",
    "config.get",
    "config.set",
    "config.apply",
    "config.patch",
    "config.schema",
    "config.schema.lookup",
    "control_request",
    "sdk.control_request",
    "control_cancel_request",
    "sdk.control_cancel_request",
    "hook_callback.list",
    "sdk.hook_callback.list",
    "hook_callback.respond",
    "sdk.hook_callback.respond",
    "elicitation.list",
    "sdk.elicitation.list",
    "elicitation.respond",
    "sdk.elicitation.respond",
    "update_environment_variables",
    "sdk.update_environment_variables",
    "keep_alive",
    "sdk.keep_alive",
    "initialize",
    "interrupt",
    "can_use_tool",
    "set_permission_mode",
    "set_model",
    "set_max_thinking_tokens",
    "mcp_status",
    "get_context_usage",
    "hook_callback",
    "mcp_message",
    "rewind_files",
    "cancel_async_message",
    "seed_read_state",
    "mcp_set_servers",
    "reload_plugins",
    "mcp_reconnect",
    "mcp_toggle",
    "stop_task",
    "apply_flag_settings",
    "get_settings",
    "elicitation",
    "secrets.reload",
    "secrets.resolve",
    "tools.catalog",
    "tools.effective",
    "tools.invoke",
    "message.policy",
    "nativePlugin.invoke",
    "nativePlugin.service.start",
    "nativePlugin.service.stop",
    "models.list",
    "agents.list",
    "logs.tail",
    "usage.status",
    "usage.cost",
    "doctor.memory.status",
    "agentRuntime.summary",
    "agentRuntime.list",
    "agentRuntime.get",
    "agentRuntime.cancel",
    "agent.identity.get",
    "agent.inspect",
    "agent.observations.list",
    "agent.wait",
    "agents.create",
    "agents.update",
    "agents.delete",
    "agents.files.list",
    "agents.files.get",
    "agents.files.set",
    "skills.status",
    "skills.bins",
    "skills.install",
    "skills.update",
    "plugins.list",
    "plugins.enable",
    "plugins.disable",
    "plugins.install",
    "plugins.update",
    "plugins.uninstall",
    "exec.approvals.get",
    "exec.approvals.set",
    "exec.approval.request",
    "exec.approval.waitDecision",
    "exec.approval.resolve",
    "plugin.approval.request",
    "plugin.approval.waitDecision",
    "plugin.approval.resolve",
    "channels.status",
    "channels.capabilities",
    "channels.setup.surface",
    "channels.config.get",
    "channels.config.schema",
    "channels.config.patch",
    "channels.config.apply",
    "channels.logout",
    "channels.account.logout",
    "channels.account.reconnect",
    "channels.account.verify",
    "channels.account.login.start",
    "channels.account.login.wait",
    "channels.login.start",
    "channels.login.wait",
    "tts.status",
    "tts.providers",
    "tts.enable",
    "tts.disable",
    "tts.setProvider",
    "tts.convert",
    "talk.config",
    "talk.mode",
    "talk.speak",
    "voice.getOverview",
    "voice.qwen3Tts.preview",
    "voice.qwen3Tts.uploadReferenceAudio",
    "voicewake.get",
    "voicewake.set",
    "update.run",
    "last-main-session-wake",
    "system.mainSessionWake.last",
    "gateway.identity.get",
    "system-presence",
    "system-event",
    "send",
    "channel.outbound.send",
    "poll",
    "channel.outbound.poll",
    "channel.outbound.action",
    "channel.inbound.handle",
    "channel.directory.lookup",
    "channel.lifecycle.status",
    "channel.lifecycle.start",
    "channel.lifecycle.stop",
    "channel.lifecycle.restart",
    "esp32.status.get",
    "esp32.pairing.start",
    "esp32.pairing.requests.list",
    "esp32.pairing.request.approve",
    "esp32.pairing.request.reject",
    "esp32.pairing.session.revoke",
    "esp32.devices.list",
    "esp32.devices.get",
    "esp32.devices.revoke",
    "esp32.devices.command.send",
    "workflow.list",
    "workflow.get",
    "workflow.n8n.get",
    "workflow.match",
    "workflow.runs",
    "workflow.enable",
    "workflow.disable",
    "workflow.archive",
    "workflow.unarchive",
    "workflow.delete",
    "workflow.deploy",
    "workflow.run",
    "workflow.status",
    "workflow.cancel",
    "workflow.resume",
    "workflow.agent.run",
    "agent.runTurn",
    "agent.command.run",
    "autoReply.run",
    "autoReply.command",
    "agent.streamEvents",
    "agent.cancel",
    "chat.history",
    "chat.send",
    "chat.abort",
    "chat.inject",
    "sessions.list",
    "sessions.create",
    "sessions.subscribe",
    "sessions.unsubscribe",
    "sessions.messages.subscribe",
    "sessions.messages.unsubscribe",
    "sessions.preview",
    "sessions.resolve",
    "sessions.patch",
    "sessions.reset",
    "sessions.delete",
    "sessions.compact",
    "sessions.abort",
    "sessions.status",
    "sessions.get",
    "sessions.send",
    "sessions.yield",
    "Agent",
    "Task",
    "subagents",
    "subagents_spawn",
    "subagents.control",
    "subagents.announce",
    "acp.session.list",
    "acp.session.new",
    "acp.session.load",
    "acp.session.patch",
    "acp.session.prompt",
    "acp.session.cancel",
    "acp.session.close",
    "wake",
    "cron.start",
    "cron.stop",
    "cron.status",
    "cron.list",
    "cron.add",
    "cron.update",
    "cron.remove",
    "cron.run",
    "cron.runs",
    "special_agents.list",
    "special_agents.run",
    "review_task",
    "memory.status",
    "memory.refresh",
    "memory.login",
    "memory.outbox.list",
    "memory.outbox.process",
    "memory.activity.list",
    "memory.dream.run",
    "memory.session_summary.status",
    "memory.session_summary.refresh",
    "memory.sessionSummary.status",
    "memory.sessionSummary.refresh",
    "memory.promptJournal.summary",
    "memory.bootstrap",
    "memory.ingestBatch",
    "memory.assemble",
    "memory.compact",
    "memory.afterTurn",
];

pub fn gateway_protocol_schema_json() -> &'static str {
    GATEWAY_PROTOCOL_SCHEMA_JSON
}

pub fn gateway_protocol_schema_value() -> Result<Value, String> {
    serde_json::from_str(GATEWAY_PROTOCOL_SCHEMA_JSON)
        .map_err(|error| format!("invalid embedded gateway protocol schema: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn path<'a>(value: &'a Value, keys: &[&str]) -> &'a Value {
        let mut current = value;
        for key in keys {
            current = current
                .get(*key)
                .unwrap_or_else(|| panic!("missing JSON path segment: {key}"));
        }
        current
    }

    #[test]
    fn protocol_schema_exposes_gateway_frame_contract() {
        let schema = gateway_protocol_schema_value().expect("protocol schema");
        assert_eq!(schema["title"], "CrawClaw Gateway Protocol");
        assert_eq!(path(&schema, &["discriminator", "propertyName"]), "type");
        let one_of = schema["oneOf"].as_array().expect("oneOf schemas");
        assert!(one_of
            .iter()
            .any(|entry| entry["$ref"] == "#/definitions/RequestFrame"));
        assert!(one_of
            .iter()
            .any(|entry| entry["$ref"] == "#/definitions/ResponseFrame"));
        assert!(one_of
            .iter()
            .any(|entry| entry["$ref"] == "#/definitions/EventFrame"));
    }

    #[test]
    fn protocol_schema_covers_core_methods_and_secret_refs() {
        let schema = gateway_protocol_schema_value().expect("protocol schema");
        let definitions = path(&schema, &["definitions"])
            .as_object()
            .expect("schema definitions");
        assert!(definitions.contains_key("ConnectParams"));
        assert!(definitions.contains_key("ConfigPatchParams"));
        assert!(definitions.contains_key("ConfigApplyParams"));
        assert!(definitions.contains_key("SecretsResolveParams"));
        assert!(!definitions.contains_key("WizardStartParams"));

        let config_patch = definitions
            .get("ConfigPatchParams")
            .expect("ConfigPatchParams definition");
        assert_eq!(
            path(config_patch, &["properties", "restartDelayMs", "type"]),
            "integer"
        );
        let secrets_resolve = definitions
            .get("SecretsResolveParams")
            .expect("SecretsResolveParams definition");
        assert_eq!(
            path(secrets_resolve, &["properties", "targetIds", "type"]),
            "array"
        );
    }

    #[test]
    fn protocol_metadata_has_stable_version_methods_events() {
        assert_eq!(GATEWAY_PROTOCOL_VERSION, 3);
        assert!(GATEWAY_PROTOCOL_METHODS.contains(&"config.apply"));
        assert!(GATEWAY_PROTOCOL_METHODS.contains(&"subagents_spawn"));
        assert!(!GATEWAY_PROTOCOL_METHODS.contains(&"sessions.spawn"));
        assert!(GATEWAY_PROTOCOL_METHODS.contains(&"memory.afterTurn"));
        assert!(GATEWAY_PROTOCOL_METHODS.contains(&"memory.outbox.list"));
        assert!(GATEWAY_PROTOCOL_METHODS.contains(&"memory.outbox.process"));
        assert!(GATEWAY_PROTOCOL_METHODS.contains(&"memory.activity.list"));
        assert!(!GATEWAY_PROTOCOL_METHODS
            .iter()
            .any(|method| method.starts_with("wizard.")));
        assert!(GATEWAY_PROTOCOL_EVENTS.contains(&"session.message"));
        assert!(GATEWAY_PROTOCOL_EVENTS.contains(&"cron"));
        assert!(GATEWAY_PROTOCOL_EVENTS.contains(&"agent.contextProjected"));
        assert!(GATEWAY_PROTOCOL_EVENTS.contains(&"agent.providerBlock"));
        assert!(GATEWAY_PROTOCOL_EVENTS.contains(&"agent.toolUseSummary"));
        assert!(GATEWAY_PROTOCOL_EVENTS.contains(&"agent.permissionRequested"));
        assert!(GATEWAY_PROTOCOL_EVENTS.contains(&"agent.permissionDecision"));

        let methods = GATEWAY_PROTOCOL_METHODS
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        assert_eq!(
            methods.len(),
            GATEWAY_PROTOCOL_METHODS.len(),
            "Gateway protocol method metadata contains duplicates"
        );
        let events = GATEWAY_PROTOCOL_EVENTS
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        assert_eq!(
            events.len(),
            GATEWAY_PROTOCOL_EVENTS.len(),
            "Gateway protocol event metadata contains duplicates"
        );
    }
}
