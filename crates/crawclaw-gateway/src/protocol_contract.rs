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
    "sessions.spawn",
    "sessions.yield",
    "subagents",
    "subagents.spawnRun",
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
    "memory.sync",
    "memory.admin.overview",
    "memory.durable.index.list",
    "memory.durable.index.get",
    "memory.dream.status",
    "memory.dream.history",
    "memory.dream.run",
    "memory.session_summary.status",
    "memory.session_summary.refresh",
    "memory.sessionSummary.status",
    "memory.sessionSummary.refresh",
    "memory.experience.outbox.list",
    "memory.experience.outbox.updateStatus",
    "memory.experience.outbox.prune",
    "memory.experience.sync.flush",
    "memory.promptJournal.summary",
    "memory.bootstrap",
    "memory.ingestBatch",
    "memory.assemble",
    "memory.compact",
    "memory.afterTurn",
    "memory.prepareSubagentSpawn",
    "memory.onSubagentEnded",
];

pub fn gateway_protocol_schema_json() -> &'static str {
    GATEWAY_PROTOCOL_SCHEMA_JSON
}

pub fn gateway_protocol_schema_value() -> Result<Value, String> {
    serde_json::from_str(GATEWAY_PROTOCOL_SCHEMA_JSON)
        .map_err(|error| format!("invalid embedded gateway protocol schema: {error}"))
}

pub fn gateway_protocol_metadata_ts() -> String {
    let mut output = String::from(
        "/* @generated by crawclaw-gateway emit-protocol-artifacts. Do not edit. */\n\n",
    );
    output.push_str(&format!(
        "export const GATEWAY_PROTOCOL_VERSION = {} as const;\n\n",
        GATEWAY_PROTOCOL_VERSION
    ));
    output.push_str(&render_ts_string_array(
        "GATEWAY_PROTOCOL_METHODS",
        GATEWAY_PROTOCOL_METHODS,
    ));
    output.push('\n');
    output.push_str(&render_ts_string_array(
        "GATEWAY_PROTOCOL_EVENTS",
        GATEWAY_PROTOCOL_EVENTS,
    ));
    output
}

pub fn gateway_protocol_schema_ts() -> Result<String, String> {
    let schema = gateway_protocol_schema_value()?;
    let definitions = schema
        .get("definitions")
        .and_then(Value::as_object)
        .ok_or_else(|| "embedded gateway protocol schema is missing definitions".to_string())?;
    let mut names = definitions.keys().cloned().collect::<Vec<_>>();
    names.sort();

    let schema_json =
        serde_json::to_string_pretty(&schema).map_err(|error| format!("schema json: {error}"))?;
    let mut output = String::from(
        "/* @generated by crawclaw-gateway emit-protocol-artifacts. Do not edit. */\n\n",
    );
    output.push_str(
        "import { GATEWAY_PROTOCOL_VERSION } from \"./protocol-contract.generated.js\";\n\n",
    );
    output.push_str("export const PROTOCOL_VERSION = GATEWAY_PROTOCOL_VERSION;\n\n");
    output.push_str(
        "export type JsonObject = { readonly [key: string]: unknown };\nexport type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;\n\n",
    );
    output.push_str("export const GatewayProtocolSchema = ");
    output.push_str(&schema_json);
    output.push_str(" as const;\n\n");
    output.push_str("const ProtocolDefinitions = GatewayProtocolSchema.definitions;\n\n");

    for name in &names {
        output.push_str("export const ");
        output.push_str(name);
        output.push_str("Schema = ProtocolDefinitions.");
        output.push_str(name);
        output.push_str(";\n");
    }
    output.push('\n');

    output.push_str("export const ProtocolSchemas = {\n");
    for name in &names {
        output.push_str("  ");
        output.push_str(name);
        output.push_str(": ");
        output.push_str(name);
        output.push_str("Schema,\n");
    }
    output.push_str("} as const;\n\n");

    output.push_str(
        "export const ErrorCodes = {\n  NOT_LINKED: \"NOT_LINKED\",\n  NOT_PAIRED: \"NOT_PAIRED\",\n  AGENT_TIMEOUT: \"AGENT_TIMEOUT\",\n  INVALID_REQUEST: \"INVALID_REQUEST\",\n  APPROVAL_NOT_FOUND: \"APPROVAL_NOT_FOUND\",\n  UNAVAILABLE: \"UNAVAILABLE\",\n} as const;\n\n",
    );
    output.push_str("export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];\n\n");

    for name in &names {
        let definition = definitions
            .get(name)
            .ok_or_else(|| format!("missing protocol definition: {name}"))?;
        output.push_str("export type ");
        output.push_str(name);
        output.push_str(" = ");
        output.push_str(&render_ts_type(definition, name));
        output.push_str(";\n");
    }
    output.push('\n');
    output.push_str(
        "export function errorShape(\n  code: ErrorCode,\n  message: string,\n  opts?: { details?: unknown; retryable?: boolean; retryAfterMs?: number },\n): ErrorShape {\n  return {\n    code,\n    message,\n    ...opts,\n  };\n}\n",
    );
    Ok(output)
}

fn render_ts_type(schema: &Value, current_name: &str) -> String {
    if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
        if let Some(name) = reference.strip_prefix("#/definitions/") {
            return name.to_string();
        }
        if reference == "T0" {
            return current_name.to_string();
        }
        return "unknown".to_string();
    }
    if let Some(value) = schema.get("const") {
        return render_ts_literal(value);
    }
    if let Some(values) = schema.get("enum").and_then(Value::as_array) {
        if values.is_empty() {
            return "never".to_string();
        }
        return values
            .iter()
            .map(render_ts_literal)
            .collect::<Vec<_>>()
            .join(" | ");
    }
    if let Some(variants) = schema
        .get("anyOf")
        .or_else(|| schema.get("oneOf"))
        .and_then(Value::as_array)
    {
        if variants.is_empty() {
            return "never".to_string();
        }
        return render_ts_union(
            variants
                .iter()
                .map(|variant| render_ts_type(variant, current_name))
                .collect(),
        );
    }
    match schema.get("type") {
        Some(Value::String(kind)) => render_ts_type_by_kind(kind, schema, current_name),
        Some(Value::Array(kinds)) => render_ts_union(
            kinds
                .iter()
                .filter_map(Value::as_str)
                .map(|kind| render_ts_type_by_kind(kind, schema, current_name))
                .collect(),
        ),
        _ => {
            if schema.get("properties").is_some() || schema.get("patternProperties").is_some() {
                render_ts_object_type(schema, current_name)
            } else if schema.get("items").is_some() {
                render_ts_array_type(schema, current_name)
            } else {
                "unknown".to_string()
            }
        }
    }
}

fn render_ts_union(parts: Vec<String>) -> String {
    let has_string = parts.iter().any(|part| part == "string");
    let mut rendered = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for part in parts {
        if has_string && is_ts_string_literal_union(&part) {
            continue;
        }
        if seen.insert(part.clone()) {
            rendered.push(part);
        }
    }
    if rendered.is_empty() {
        "never".to_string()
    } else {
        rendered.join(" | ")
    }
}

fn is_ts_string_literal_union(value: &str) -> bool {
    value
        .split(" | ")
        .all(|part| part.starts_with('"') && part.ends_with('"'))
}

fn render_ts_type_by_kind(kind: &str, schema: &Value, current_name: &str) -> String {
    match kind {
        "string" => "string".to_string(),
        "integer" | "number" => "number".to_string(),
        "boolean" => "boolean".to_string(),
        "null" => "null".to_string(),
        "array" => render_ts_array_type(schema, current_name),
        "object" => render_ts_object_type(schema, current_name),
        _ => "JsonValue".to_string(),
    }
}

fn render_ts_array_type(schema: &Value, current_name: &str) -> String {
    let item_type = schema
        .get("items")
        .map(|items| render_ts_type(items, current_name))
        .unwrap_or_else(|| "unknown".to_string());
    format!("readonly ({item_type})[]")
}

fn render_ts_object_type(schema: &Value, current_name: &str) -> String {
    let Some(properties) = schema.get("properties").and_then(Value::as_object) else {
        return render_ts_index_signature(schema, current_name)
            .map(|signature| format!("{{ {signature} }}"))
            .unwrap_or_else(|| "JsonObject".to_string());
    };
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .collect::<std::collections::BTreeSet<_>>()
        })
        .unwrap_or_default();
    let mut keys = properties.keys().collect::<Vec<_>>();
    keys.sort();
    let mut parts = Vec::new();
    for key in keys {
        let optional = if required.contains(key.as_str()) {
            ""
        } else {
            "?"
        };
        let value_type = render_ts_type(&properties[key], current_name);
        parts.push(format!(
            "readonly {}{}: {}",
            render_ts_property_name(key),
            optional,
            value_type
        ));
    }
    if let Some(index_signature) = render_ts_index_signature(schema, current_name) {
        parts.push(index_signature);
    }
    if parts.is_empty() {
        "JsonObject".to_string()
    } else {
        format!("{{ {} }}", parts.join("; "))
    }
}

fn render_ts_index_signature(schema: &Value, current_name: &str) -> Option<String> {
    if let Some(patterns) = schema.get("patternProperties").and_then(Value::as_object) {
        if let Some(value_schema) = patterns.values().next() {
            return Some(format!(
                "readonly [key: string]: {}",
                render_ts_type(value_schema, current_name)
            ));
        }
    }
    match schema.get("additionalProperties") {
        Some(Value::Object(value_schema)) => Some(format!(
            "readonly [key: string]: {}",
            render_ts_type(&Value::Object(value_schema.clone()), current_name)
        )),
        Some(Value::Bool(true)) => Some("readonly [key: string]: unknown".to_string()),
        _ => None,
    }
}

fn render_ts_property_name(name: &str) -> String {
    if name.chars().enumerate().all(is_ts_property_name_char) {
        name.to_string()
    } else {
        serde_json::to_string(name).expect("property name")
    }
}

fn is_ts_property_name_char((index, ch): (usize, char)) -> bool {
    ch == '_' || ch == '$' || (ch.is_ascii_alphanumeric() && (index > 0 || !ch.is_ascii_digit()))
}

fn render_ts_literal(value: &Value) -> String {
    match value {
        Value::String(value) => serde_json::to_string(value).expect("string literal"),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Null => "null".to_string(),
        _ => "unknown".to_string(),
    }
}

fn render_ts_string_array(name: &str, values: &[&str]) -> String {
    let mut output = format!("export const {name} = [\n");
    for value in values {
        output.push_str("  ");
        output.push_str(&serde_json::to_string(value).expect("protocol metadata string"));
        output.push_str(",\n");
    }
    output.push_str("] as const;\n");
    output
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
        assert!(GATEWAY_PROTOCOL_METHODS.contains(&"sessions.spawn"));
        assert!(GATEWAY_PROTOCOL_METHODS.contains(&"memory.afterTurn"));
        assert!(!GATEWAY_PROTOCOL_METHODS.iter().any(|method| method.starts_with("wizard.")));
        assert!(GATEWAY_PROTOCOL_EVENTS.contains(&"session.message"));
        assert!(GATEWAY_PROTOCOL_EVENTS.contains(&"cron"));

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

    #[test]
    fn protocol_metadata_ts_is_generated_from_rust_contract() {
        let artifact = gateway_protocol_metadata_ts();
        assert!(artifact.contains("export const GATEWAY_PROTOCOL_VERSION = 3 as const;"));
        assert!(artifact.contains("\"config.apply\""));
        assert!(artifact.contains("\"session.message\""));
        assert!(artifact.ends_with("] as const;\n"));
    }

    #[test]
    fn protocol_schema_ts_is_generated_from_rust_contract() {
        let artifact = gateway_protocol_schema_ts().expect("protocol schema ts");
        assert!(artifact.contains("export const GatewayProtocolSchema = {"));
        assert!(artifact
            .contains("export const ConnectParamsSchema = ProtocolDefinitions.ConnectParams;"));
        assert!(artifact.contains("export type ConfigPatchParams ="));
        assert!(artifact.contains("export const ProtocolSchemas = {"));
        assert!(artifact.contains("export function errorShape("));
        assert!(!artifact.contains("@sinclair/typebox"));
        assert!(!artifact.contains("\"last\" | string"));
        assert!(!artifact.contains("\"current\" | string"));
    }
}
