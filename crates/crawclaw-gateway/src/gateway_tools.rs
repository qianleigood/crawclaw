use super::*;

pub(super) fn tools_catalog(state: &GatewayState, params: Value) -> Value {
    let agent_id = string_param(&params, &["agentId"]).unwrap_or_else(|| "main".to_string());
    let native_registry = crawclaw_runtime::native_plugin_registry(&state.runtime_root);
    let rust_tools =
        crawclaw_runtime::native_runtime_tool_descriptors_for_runtime_root(&state.runtime_root);
    let mut groups = vec![json!({
        "id": "core",
        "label": "Core tools",
        "source": "core",
        "tools": crawclaw_runtime::rust_core_tool_definitions()
            .iter()
            .map(|definition| tool_catalog_entry(
                definition,
                rust_tools.iter().find(|tool| tool.name == definition.id),
            ))
            .collect::<Vec<_>>()
    })];
    let mcp_tools = rust_tools
        .iter()
        .filter(|tool| tool.name.starts_with("mcp__"))
        .map(mcp_tool_catalog_entry)
        .collect::<Vec<_>>();
    if !mcp_tools.is_empty() {
        groups.push(json!({
            "id": "mcp",
            "label": "MCP tools",
            "source": "mcp",
            "tools": mcp_tools
        }));
    }
    groups.push(json!({
        "id": "native-plugins",
        "label": "Native plugin tools",
        "source": "native-plugin",
        "tools": native_registry
            .tool_descriptors()
            .into_iter()
            .map(native_tool_catalog_entry)
            .collect::<Vec<_>>()
    }));
    json!({
        "agentId": agent_id,
        "profiles": tool_profiles(),
        "groups": groups,
        "nativePluginRegistryDiagnostics": native_registry.diagnostics
    })
}

pub(super) fn tools_effective(state: &GatewayState, params: Value) -> Value {
    let agent_id = string_param(&params, &["agentId"]).unwrap_or_else(|| "main".to_string());
    let profile = if params.get("sessionKey").is_some() {
        "coding"
    } else {
        "full"
    };
    let native_registry = crawclaw_runtime::native_plugin_registry(&state.runtime_root);
    let rust_tools =
        crawclaw_runtime::native_runtime_tool_descriptors_for_runtime_root(&state.runtime_root);
    let mut groups = vec![json!({
        "id": "core",
        "label": "Core tools",
        "source": "core",
        "tools": crawclaw_runtime::rust_core_tool_definitions()
            .iter()
            .filter(|definition| definition.default_enabled)
            .map(|definition| tool_effective_entry(
                definition,
                rust_tools.iter().find(|tool| tool.name == definition.id),
            ))
            .collect::<Vec<_>>()
    })];
    let mcp_tools = rust_tools
        .iter()
        .filter(|tool| tool.name.starts_with("mcp__"))
        .map(mcp_tool_effective_entry)
        .collect::<Vec<_>>();
    if !mcp_tools.is_empty() {
        groups.push(json!({
            "id": "mcp",
            "label": "MCP tools",
            "source": "mcp",
            "tools": mcp_tools
        }));
    }
    groups.push(json!({
        "id": "native-plugins",
        "label": "Native plugin tools",
        "source": "native-plugin",
        "tools": native_registry
            .tool_descriptors()
            .into_iter()
            .filter(|(_, descriptor)| descriptor.default_enabled)
            .map(native_tool_effective_entry)
            .collect::<Vec<_>>()
    }));
    json!({
        "agentId": agent_id,
        "profile": profile,
        "groups": groups,
        "unavailableTools": [],
        "diagnostics": native_registry.diagnostics
    })
}

pub(super) async fn tools_invoke(state: &GatewayState, params: Value) -> Result<Value, String> {
    let tool = required_param(&params, &["tool", "name"])?;
    let input = params
        .get("input")
        .or_else(|| params.get("args"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    crawclaw_runtime::execute_rust_core_tool(&state.runtime_root, &tool, input).await
}

pub(super) fn message_policy(params: Value) -> Result<Value, String> {
    crawclaw_runtime::execute_message_policy_operation(params)
}

pub(super) async fn native_plugin_invoke(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    crawclaw_runtime::execute_native_plugin_invoke_operation(&state.runtime_root, params).await
}

pub(super) async fn native_plugin_service_lifecycle(
    state: &GatewayState,
    params: Value,
    start: bool,
) -> Result<Value, String> {
    let mut input = params;
    if let Value::Object(object) = &mut input {
        object.insert("start".to_string(), Value::Bool(start));
    }
    crawclaw_runtime::execute_native_plugin_service_lifecycle_operation(&state.runtime_root, input)
        .await
}

pub(super) fn tool_profiles() -> Vec<Value> {
    vec![
        json!({ "id": "minimal", "label": "Minimal" }),
        json!({ "id": "coding", "label": "Coding" }),
        json!({ "id": "messaging", "label": "Messaging" }),
        json!({ "id": "full", "label": "Full" }),
    ]
}

pub(super) fn tool_catalog_entry(
    definition: &crawclaw_runtime::RustCoreToolDefinition,
    descriptor: Option<&crawclaw_runtime::RustAgentToolDescriptor>,
) -> Value {
    let label = descriptor
        .map(|tool| tool.label.clone())
        .unwrap_or_else(|| definition.label.to_string());
    let description = descriptor
        .map(|tool| tool.description.clone())
        .unwrap_or_else(|| definition.description.to_string());
    json!({
        "id": definition.id,
        "label": label,
        "description": description,
        "sectionId": definition.section_id,
        "lifecycle": definition.lifecycle,
        "parameters": descriptor
            .map(|tool| tool.parameters.clone())
            .unwrap_or_else(|| json!({ "type": "object" })),
        "readOnly": descriptor.map(|tool| tool.read_only).unwrap_or(definition.read_only),
        "source": "core",
        "optional": !definition.default_enabled,
        "defaultProfiles": definition.default_profiles,
        "includeInCrawClawGroup": definition.include_in_crawclaw_group
    })
}

pub(super) fn tool_effective_entry(
    definition: &crawclaw_runtime::RustCoreToolDefinition,
    descriptor: Option<&crawclaw_runtime::RustAgentToolDescriptor>,
) -> Value {
    let label = descriptor
        .map(|tool| tool.label.clone())
        .unwrap_or_else(|| definition.label.to_string());
    let description = descriptor
        .map(|tool| tool.description.clone())
        .unwrap_or_else(|| definition.description.to_string());
    json!({
        "id": definition.id,
        "label": label,
        "description": description,
        "rawDescription": description,
        "sectionId": definition.section_id,
        "lifecycle": definition.lifecycle,
        "parameters": descriptor
            .map(|tool| tool.parameters.clone())
            .unwrap_or_else(|| json!({ "type": "object" })),
        "readOnly": descriptor.map(|tool| tool.read_only).unwrap_or(definition.read_only),
        "source": "core",
        "defaultProfiles": definition.default_profiles,
        "includeInCrawClawGroup": definition.include_in_crawclaw_group
    })
}

pub(super) fn mcp_tool_catalog_entry(
    descriptor: &crawclaw_runtime::RustAgentToolDescriptor,
) -> Value {
    json!({
        "id": descriptor.name,
        "label": descriptor.label,
        "description": descriptor.description,
        "sectionId": "runtime",
        "lifecycle": "profile_default",
        "parameters": descriptor.parameters,
        "readOnly": descriptor.read_only,
        "source": "mcp",
        "optional": false,
        "defaultProfiles": ["coding", "full"],
        "includeInCrawClawGroup": true
    })
}

pub(super) fn mcp_tool_effective_entry(
    descriptor: &crawclaw_runtime::RustAgentToolDescriptor,
) -> Value {
    json!({
        "id": descriptor.name,
        "label": descriptor.label,
        "description": descriptor.description,
        "rawDescription": descriptor.description,
        "sectionId": "runtime",
        "lifecycle": "profile_default",
        "parameters": descriptor.parameters,
        "readOnly": descriptor.read_only,
        "source": "mcp",
        "defaultProfiles": ["coding", "full"],
        "includeInCrawClawGroup": true
    })
}

pub(super) fn native_tool_catalog_entry(
    (plugin_id, descriptor): (String, crawclaw_plugin_sdk::NativeToolDescriptor),
) -> Value {
    json!({
        "id": descriptor.name,
        "label": descriptor.label,
        "description": descriptor.description,
        "parameters": descriptor.parameters,
        "source": "native-plugin",
        "pluginId": plugin_id,
        "optional": !descriptor.default_enabled,
        "defaultProfiles": descriptor.default_profiles,
        "approval": descriptor.approval,
        "readOnly": descriptor.read_only
    })
}

pub(super) fn native_tool_effective_entry(
    (plugin_id, descriptor): (String, crawclaw_plugin_sdk::NativeToolDescriptor),
) -> Value {
    json!({
        "id": descriptor.name,
        "label": descriptor.label,
        "description": descriptor.description,
        "rawDescription": descriptor.description,
        "parameters": descriptor.parameters,
        "readOnly": descriptor.read_only,
        "source": "native-plugin",
        "pluginId": plugin_id
    })
}
