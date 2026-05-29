use super::*;

pub(super) fn config_path(state: &GatewayState) -> PathBuf {
    if let Some(value) = env::var_os("CRAWCLAW_CONFIG_PATH").filter(|value| !value.is_empty()) {
        return PathBuf::from(value);
    }
    state.state_dir.join("crawclaw.json")
}

pub(super) fn config_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let path = config_path(state);
    let exists = path.exists();
    let config = read_config_value(&path)?;
    if let Some(key) = string_param(&params, &["key", "path"]) {
        return Ok(json!({
            "exists": exists,
            "path": path.to_string_lossy(),
            "key": key,
            "value": get_json_path(&config, &key).cloned()
        }));
    }
    Ok(json!({
        "exists": exists,
        "path": path.to_string_lossy(),
        "config": config
    }))
}

pub(super) async fn config_set(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = required_param(&params, &["key", "path"])?;
    let value = params.get("value").cloned().unwrap_or(Value::Null);
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(&mut config, &key, value)?;
    write_config_value(&path, &config)?;
    run_sdk_config_change_hooks(state, &path, "local_settings").await?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "config": config }))
}

pub(super) async fn config_apply(state: &GatewayState, params: Value) -> Result<Value, String> {
    let config = params
        .get("config")
        .or_else(|| params.get("value"))
        .cloned()
        .unwrap_or(params);
    if !config.is_object() {
        return Err("config.apply requires an object config".to_string());
    }
    let path = config_path(state);
    write_config_value(&path, &config)?;
    run_sdk_config_change_hooks(state, &path, "local_settings").await?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "config": config }))
}

pub(super) async fn config_patch(state: &GatewayState, params: Value) -> Result<Value, String> {
    let patch = if let Some(raw) = string_param(&params, &["raw"]) {
        serde_json::from_str::<Value>(&raw)
            .map_err(|error| format!("invalid config.patch raw JSON: {error}"))?
    } else {
        params.get("patch").cloned().unwrap_or(params)
    };
    if !patch.is_object() {
        return Err("config.patch requires an object patch".to_string());
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    merge_json(&mut config, patch);
    write_config_value(&path, &config)?;
    run_sdk_config_change_hooks(state, &path, "local_settings").await?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "config": config }))
}

async fn run_sdk_config_change_hooks(
    state: &GatewayState,
    path: &Path,
    source: &str,
) -> Result<(), String> {
    let mut input = sdk_base_hook_input_for_session(state, "main", "main", "ConfigChange");
    if let Some(object) = input.as_object_mut() {
        object.insert("source".to_string(), Value::String(source.to_string()));
        object.insert(
            "file_path".to_string(),
            Value::String(path.to_string_lossy().to_string()),
        );
    }
    let _ = run_sdk_hook_callbacks(state, "ConfigChange", Some(source), input, None).await?;
    Ok(())
}

pub(super) fn config_schema() -> Result<Value, String> {
    let mut payload = crawclaw_providers::provider_config_schema();
    let properties = payload
        .pointer_mut("/schema/properties")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "provider config schema is missing schema.properties".to_string())?;
    properties.insert(
        "gateway".to_string(),
        json!({
            "type": "object",
            "properties": {
                "port": { "type": "integer" },
                "bind": { "type": "string" }
            }
        }),
    );
    properties.insert(
        "tools".to_string(),
        json!({
            "type": "object",
            "properties": {
                "allow": { "type": "array", "items": { "type": "string" } },
                "deny": { "type": "array", "items": { "type": "string" } }
            }
        }),
    );
    properties.insert("mcpServers".to_string(), mcp_servers_config_schema());
    properties.insert(
        "disabledMcpServers".to_string(),
        json!({ "type": "array", "items": { "type": "string" } }),
    );
    properties.insert(
        "enabledMcpServers".to_string(),
        json!({ "type": "array", "items": { "type": "string" } }),
    );

    let ui_hints = payload
        .get_mut("uiHints")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "provider config schema is missing uiHints".to_string())?;
    ui_hints.insert("gateway".to_string(), json!({ "label": "Gateway" }));
    ui_hints.insert("gateway.port".to_string(), json!({ "label": "Port" }));
    ui_hints.insert("tools".to_string(), json!({ "label": "Tools" }));
    ui_hints.insert("tools.allow".to_string(), json!({ "label": "Allow" }));
    ui_hints.insert("tools.deny".to_string(), json!({ "label": "Deny" }));
    ui_hints.insert("mcpServers".to_string(), json!({ "label": "MCP Servers" }));
    ui_hints.insert(
        "disabledMcpServers".to_string(),
        json!({ "label": "Disabled MCP Servers" }),
    );
    ui_hints.insert(
        "enabledMcpServers".to_string(),
        json!({ "label": "Enabled MCP Servers" }),
    );
    ui_hints.insert(
        "mcpServers.*.headers.*".to_string(),
        json!({ "sensitive": true }),
    );
    ui_hints.insert(
        "mcpServers.*.authToken".to_string(),
        json!({ "sensitive": true }),
    );
    Ok(payload)
}

pub(super) fn config_schema_lookup(params: Value) -> Result<Value, String> {
    let path = string_param(&params, &["path"]).unwrap_or_default();
    let children = match path.as_str() {
        "" => vec![
            json!({ "key": "gateway", "path": "gateway", "label": "Gateway" }),
            json!({ "key": "tools", "path": "tools", "label": "Tools" }),
            json!({ "key": "models", "path": "models", "label": "Model Providers" }),
            json!({ "key": "mcpServers", "path": "mcpServers", "label": "MCP Servers" }),
            json!({ "key": "disabledMcpServers", "path": "disabledMcpServers", "label": "Disabled MCP Servers" }),
            json!({ "key": "enabledMcpServers", "path": "enabledMcpServers", "label": "Enabled MCP Servers" }),
        ],
        "gateway" => vec![
            json!({ "key": "port", "path": "gateway.port", "label": "Port" }),
            json!({ "key": "bind", "path": "gateway.bind", "label": "Bind" }),
        ],
        "tools" => vec![
            json!({ "key": "allow", "path": "tools.allow", "label": "Allow" }),
            json!({ "key": "deny", "path": "tools.deny", "label": "Deny" }),
        ],
        "mcpServers" => vec![json!({ "key": "*", "path": "mcpServers.*", "label": "MCP Server" })],
        "mcpServers.*" => mcp_server_lookup_children(),
        "mcpServers.*.oauth" => vec![
            json!({ "key": "clientId", "path": "mcpServers.*.oauth.clientId", "label": "OAuth Client ID" }),
            json!({ "key": "callbackPort", "path": "mcpServers.*.oauth.callbackPort", "label": "OAuth Callback Port" }),
            json!({ "key": "authServerMetadataUrl", "path": "mcpServers.*.oauth.authServerMetadataUrl", "label": "OAuth Metadata URL" }),
            json!({ "key": "xaa", "path": "mcpServers.*.oauth.xaa", "label": "Cross App Access" }),
        ],
        _ => {
            return Ok(crawclaw_providers::provider_config_schema_lookup(&path));
        }
    };
    Ok(json!({ "path": path, "children": children }))
}

fn mcp_servers_config_schema() -> Value {
    json!({
        "type": "object",
        "propertyNames": { "type": "string" },
        "additionalProperties": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": [
                        "stdio",
                        "http",
                        "sse",
                        "sse-ide",
                        "ws",
                        "ws-ide",
                        "sdk",
                        "claudeai-proxy"
                    ]
                },
                "command": { "type": "string" },
                "args": { "type": "array", "items": { "type": "string" } },
                "env": {
                    "type": "object",
                    "propertyNames": { "type": "string" },
                    "additionalProperties": { "type": "string" }
                },
                "cwd": { "type": "string" },
                "workingDirectory": { "type": "string" },
                "name": { "type": "string" },
                "id": { "type": "string" },
                "url": { "type": "string" },
                "ideName": { "type": "string" },
                "ideRunningInWindows": { "type": "boolean" },
                "headers": {
                    "type": "object",
                    "propertyNames": { "type": "string" },
                    "additionalProperties": { "type": "string" }
                },
                "headersHelper": { "type": "string" },
                "authToken": { "type": "string" },
                "oauth": {
                    "type": "object",
                    "properties": {
                        "clientId": { "type": "string" },
                        "callbackPort": {
                            "type": "integer",
                            "exclusiveMinimum": 0
                        },
                        "authServerMetadataUrl": { "type": "string" },
                        "xaa": { "type": "boolean" }
                    },
                    "additionalProperties": false
                }
            },
            "additionalProperties": true
        }
    })
}

fn mcp_server_lookup_children() -> Vec<Value> {
    vec![
        json!({ "key": "type", "path": "mcpServers.*.type", "label": "Transport" }),
        json!({ "key": "command", "path": "mcpServers.*.command", "label": "Command" }),
        json!({ "key": "args", "path": "mcpServers.*.args", "label": "Arguments" }),
        json!({ "key": "env", "path": "mcpServers.*.env", "label": "Environment" }),
        json!({ "key": "cwd", "path": "mcpServers.*.cwd", "label": "Working Directory" }),
        json!({ "key": "workingDirectory", "path": "mcpServers.*.workingDirectory", "label": "Working Directory" }),
        json!({ "key": "url", "path": "mcpServers.*.url", "label": "URL" }),
        json!({ "key": "headers", "path": "mcpServers.*.headers", "label": "Headers" }),
        json!({ "key": "headersHelper", "path": "mcpServers.*.headersHelper", "label": "Headers Helper" }),
        json!({ "key": "authToken", "path": "mcpServers.*.authToken", "label": "Auth Token" }),
        json!({ "key": "oauth", "path": "mcpServers.*.oauth", "label": "OAuth" }),
        json!({ "key": "name", "path": "mcpServers.*.name", "label": "SDK Name" }),
        json!({ "key": "id", "path": "mcpServers.*.id", "label": "Remote ID" }),
        json!({ "key": "ideName", "path": "mcpServers.*.ideName", "label": "IDE Name" }),
        json!({ "key": "ideRunningInWindows", "path": "mcpServers.*.ideRunningInWindows", "label": "IDE Running In Windows" }),
    ]
}

pub(super) fn mcp_set_servers(state: &GatewayState, params: Value) -> Result<Value, String> {
    let servers = params
        .get("servers")
        .or_else(|| params.get("mcpServers"))
        .cloned()
        .ok_or_else(|| "mcp_set_servers requires servers".to_string())?;
    let servers_object = servers
        .as_object()
        .ok_or_else(|| "mcp_set_servers servers must be an object".to_string())?;
    for (name, server) in servers_object {
        if name.trim().is_empty() {
            return Err("mcp_set_servers server names cannot be empty".to_string());
        }
        if !server.is_object() {
            return Err(format!("mcp_set_servers server {name} must be an object"));
        }
    }

    let path = runtime_mcp_config_path(state);
    let mut config = read_config_value(&path)?;
    let previous_config_names = config
        .get("mcpServers")
        .and_then(Value::as_object)
        .map(|servers| servers.keys().cloned().collect::<BTreeSet<_>>())
        .unwrap_or_default();
    let previous_sdk_names = sdk_mcp_server_names(state)?;
    let previous_names = previous_config_names
        .union(&previous_sdk_names)
        .cloned()
        .collect::<BTreeSet<_>>();
    let next_names = servers_object.keys().cloned().collect::<BTreeSet<_>>();
    let mut sanitized_servers = Map::new();
    let mut sdk_servers = BTreeMap::new();
    for (name, server) in servers_object {
        let mut server = server.clone();
        if let Some(object) = server.as_object_mut() {
            object.remove("disabled");
        }
        if is_sdk_mcp_server(&server) {
            sdk_servers.insert(name.clone(), normalized_sdk_mcp_server(name, &server));
        } else {
            sanitized_servers.insert(name.clone(), server);
        }
    }
    retain_string_array_members(&mut config, "disabledMcpServers", &next_names)?;
    retain_string_array_members(&mut config, "enabledMcpServers", &next_names)?;
    ensure_json_object(&mut config)
        .insert("mcpServers".to_string(), Value::Object(sanitized_servers));
    write_config_value(&path, &config)?;
    replace_sdk_mcp_servers(state, sdk_servers)?;
    Ok(json!({
        "added": next_names
            .difference(&previous_names)
            .cloned()
            .collect::<Vec<_>>(),
        "removed": previous_names
            .difference(&next_names)
            .cloned()
            .collect::<Vec<_>>(),
        "errors": {}
    }))
}

pub(super) fn mcp_servers_snapshot(state: &GatewayState) -> Vec<Value> {
    let mut servers = read_merged_mcp_config_value(state)
        .map(|config| mcp_servers_summary_from_config(&config))
        .unwrap_or_default();
    extend_missing_sdk_mcp_servers(&mut servers, state);
    servers
}

pub(super) fn mcp_servers_control_status_snapshot(state: &GatewayState) -> Vec<Value> {
    let mut servers = read_merged_mcp_config_value(state)
        .map(|config| mcp_servers_control_status_from_config(&config))
        .unwrap_or_default();
    extend_missing_sdk_mcp_servers(&mut servers, state);
    servers
}

fn runtime_mcp_config_path(state: &GatewayState) -> PathBuf {
    state.runtime_root.join("config").join("crawclaw.json")
}

fn project_mcp_config_path(state: &GatewayState) -> PathBuf {
    state.runtime_root.join(".mcp.json")
}

fn read_merged_mcp_config_value(state: &GatewayState) -> Result<Value, String> {
    let mut merged = Value::Object(Map::new());
    merge_mcp_config_value(
        &mut merged,
        read_config_value(&project_mcp_config_path(state))?,
    );
    merge_mcp_config_value(
        &mut merged,
        read_config_value(&runtime_mcp_config_path(state))?,
    );
    Ok(merged)
}

fn merge_mcp_config_value(target: &mut Value, source: Value) {
    let Some(source_object) = source.as_object() else {
        return;
    };
    let Some(target_object) = target.as_object_mut() else {
        return;
    };
    if let Some(source_servers) = source_object.get("mcpServers").and_then(Value::as_object) {
        let target_servers = target_object
            .entry("mcpServers".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(target_servers) = target_servers.as_object_mut() {
            for (name, server) in source_servers {
                target_servers.insert(name.clone(), server.clone());
            }
        }
    }
    for key in ["disabledMcpServers", "enabledMcpServers"] {
        let Some(values) = source_object.get(key).and_then(Value::as_array) else {
            continue;
        };
        let mut names = target_object
            .get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<BTreeSet<_>>()
            })
            .unwrap_or_default();
        names.extend(values.iter().filter_map(Value::as_str).map(str::to_string));
        if !names.is_empty() {
            target_object.insert(
                key.to_string(),
                Value::Array(names.into_iter().map(Value::String).collect()),
            );
        }
    }
}

fn mcp_servers_summary_from_config(config: &Value) -> Vec<Value> {
    let disabled_names = string_set_from_config_path(config, "disabledMcpServers");
    config
        .get("mcpServers")
        .and_then(Value::as_object)
        .map(|servers| {
            servers
                .iter()
                .map(|(name, server)| {
                    mcp_server_summary(name, server, disabled_names.contains(name))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn mcp_servers_control_status_from_config(config: &Value) -> Vec<Value> {
    let disabled_names = string_set_from_config_path(config, "disabledMcpServers");
    config
        .get("mcpServers")
        .and_then(Value::as_object)
        .map(|servers| {
            servers
                .iter()
                .map(|(name, server)| {
                    let mut entry = mcp_server_summary(name, server, disabled_names.contains(name));
                    if let Some(status_config) = mcp_server_status_config(name, server) {
                        ensure_json_object(&mut entry).insert("config".to_string(), status_config);
                    }
                    entry
                })
                .collect()
        })
        .unwrap_or_default()
}

fn mcp_server_summary(name: &str, server: &Value, disabled: bool) -> Value {
    let object = server.as_object();
    let server_type = object
        .and_then(|object| object.get("type"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            if object
                .and_then(|object| object.get("url"))
                .and_then(Value::as_str)
                .is_some()
            {
                "http".to_string()
            } else {
                "stdio".to_string()
            }
        });
    json!({
        "name": name,
        "type": server_type,
        "enabled": !disabled,
        "hasCommand": object
            .and_then(|object| object.get("command"))
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        "hasUrl": object
            .and_then(|object| object.get("url"))
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        "hasEnv": object
            .and_then(|object| object.get("env"))
            .and_then(Value::as_object)
            .map(|value| !value.is_empty())
            .unwrap_or(false),
        "hasHeaders": object
            .and_then(|object| object.get("headers"))
            .and_then(Value::as_object)
            .map(|value| !value.is_empty())
            .unwrap_or(false)
            || object
                .and_then(|object| object.get("headersHelper"))
                .and_then(Value::as_str)
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
    })
}

pub(super) fn register_sdk_mcp_servers(
    state: &GatewayState,
    servers: Option<&Value>,
) -> Result<(), String> {
    let Some(servers) = servers else {
        return Ok(());
    };
    let Some(names) = servers.as_array() else {
        return Err("initialize sdkMcpServers must be an array of server names".to_string());
    };
    let mut sdk_servers = BTreeMap::new();
    for name in names {
        let Some(name) = name.as_str().map(str::trim).filter(|name| !name.is_empty()) else {
            return Err("initialize sdkMcpServers entries must be non-empty strings".to_string());
        };
        sdk_servers.insert(name.to_string(), json!({ "type": "sdk", "name": name }));
    }
    replace_sdk_mcp_servers(state, sdk_servers)
}

pub(super) fn is_registered_sdk_mcp_server(
    state: &GatewayState,
    server_name: &str,
) -> Result<bool, String> {
    Ok(state
        .sdk_mcp_servers
        .lock()
        .map_err(|_| "SDK MCP server store lock poisoned".to_string())?
        .contains_key(server_name))
}

fn replace_sdk_mcp_servers(
    state: &GatewayState,
    servers: BTreeMap<String, Value>,
) -> Result<(), String> {
    *state
        .sdk_mcp_servers
        .lock()
        .map_err(|_| "SDK MCP server store lock poisoned".to_string())? = servers;
    Ok(())
}

fn sdk_mcp_server_names(state: &GatewayState) -> Result<BTreeSet<String>, String> {
    Ok(state
        .sdk_mcp_servers
        .lock()
        .map_err(|_| "SDK MCP server store lock poisoned".to_string())?
        .keys()
        .cloned()
        .collect())
}

fn sdk_mcp_server_summaries(state: &GatewayState) -> Vec<Value> {
    state
        .sdk_mcp_servers
        .lock()
        .map(|servers| {
            servers
                .iter()
                .map(|(name, server)| sdk_mcp_server_summary(name, server))
                .collect()
        })
        .unwrap_or_default()
}

fn extend_missing_sdk_mcp_servers(servers: &mut Vec<Value>, state: &GatewayState) {
    let existing_names = servers
        .iter()
        .filter_map(|server| server.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    servers.extend(
        sdk_mcp_server_summaries(state)
            .into_iter()
            .filter(|server| {
                server
                    .get("name")
                    .and_then(Value::as_str)
                    .map(|name| !existing_names.contains(name))
                    .unwrap_or(false)
            }),
    );
}

fn sdk_mcp_server_summary(name: &str, server: &Value) -> Value {
    json!({
        "name": name,
        "type": "sdk",
        "enabled": true,
        "hasCommand": false,
        "hasUrl": false,
        "hasEnv": false,
        "hasHeaders": false,
        "config": normalized_sdk_mcp_server(name, server)
    })
}

fn is_sdk_mcp_server(server: &Value) -> bool {
    server
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|server_type| server_type == "sdk")
}

fn normalized_sdk_mcp_server(name: &str, server: &Value) -> Value {
    json!({
        "type": "sdk",
        "name": server
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(name)
    })
}

fn mcp_server_status_config(name: &str, server: &Value) -> Option<Value> {
    let object = server.as_object()?;
    let server_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            if object.get("url").and_then(Value::as_str).is_some() {
                "http"
            } else {
                "stdio"
            }
        });
    match server_type {
        "http" | "sse" => {
            let url = object.get("url").and_then(Value::as_str)?;
            Some(json!({
                "type": server_type,
                "url": url
            }))
        }
        "sdk" => Some(json!({
            "type": "sdk",
            "name": object
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(name)
        })),
        "claudeai-proxy" => {
            let url = object.get("url").and_then(Value::as_str)?;
            let id = object.get("id").and_then(Value::as_str)?;
            Some(json!({
                "type": "claudeai-proxy",
                "url": url,
                "id": id
            }))
        }
        "stdio" => {
            let command = object.get("command").and_then(Value::as_str)?;
            let args = object
                .get("args")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|item| Value::String(item.to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(json!({
                "type": "stdio",
                "command": command,
                "args": args
            }))
        }
        _ => None,
    }
}

fn string_set_from_config_path(config: &Value, path: &str) -> BTreeSet<String> {
    get_json_path(config, path)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn retain_string_array_members(
    config: &mut Value,
    path: &str,
    allowed: &BTreeSet<String>,
) -> Result<(), String> {
    let names = get_json_path(config, path)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|name| allowed.contains(*name))
                .map(str::to_string)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    if names.is_empty() {
        delete_json_path(config, path);
        return Ok(());
    }
    set_json_path(
        config,
        path,
        Value::Array(names.into_iter().map(Value::String).collect()),
    )
}

pub(super) fn secrets_reload(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let mut refs = Vec::<(String, Value)>::new();
    collect_config_secret_refs(&config, "", &mut refs);
    let mut diagnostics = Vec::new();
    let mut inactive_ref_paths = Vec::new();
    for (path, value) in &refs {
        match resolve_secret_value(state, path, value) {
            Ok(Some(_)) => {}
            Ok(None) => inactive_ref_paths.push(path.clone()),
            Err(message) => {
                inactive_ref_paths.push(path.clone());
                diagnostics.push(message);
            }
        }
    }
    Ok(json!({
        "ok": true,
        "warningCount": diagnostics.len(),
        "checkedRefCount": refs.len(),
        "diagnostics": diagnostics,
        "inactiveRefPaths": inactive_ref_paths
    }))
}

pub(super) fn secrets_resolve(state: &GatewayState, params: Value) -> Result<Value, String> {
    let target_ids = params
        .get("targetIds")
        .and_then(Value::as_array)
        .ok_or_else(|| "secrets.resolve requires targetIds".to_string())?;
    let config = read_config_value(&config_path(state))?;
    let mut assignments = Vec::new();
    let mut diagnostics = Vec::new();
    let mut inactive_ref_paths = Vec::new();

    for target_id in target_ids {
        let Some(target_id) = target_id.as_str().filter(|value| !value.trim().is_empty()) else {
            return Err("secrets.resolve targetIds must be non-empty strings".to_string());
        };
        let path_segments = target_id
            .split('.')
            .filter(|segment| !segment.trim().is_empty())
            .collect::<Vec<_>>();
        if path_segments.is_empty() {
            return Err("secrets.resolve targetId cannot be empty".to_string());
        }
        let Some(value) = get_json_path(&config, target_id) else {
            inactive_ref_paths.push(target_id.to_string());
            diagnostics.push(format!("No configured secret value found at {target_id}."));
            continue;
        };

        match resolve_secret_value(state, target_id, value) {
            Ok(Some(secret_value)) => assignments.push(json!({
                "path": target_id,
                "pathSegments": path_segments,
                "value": secret_value
            })),
            Ok(None) => {
                inactive_ref_paths.push(target_id.to_string());
            }
            Err(message) => {
                inactive_ref_paths.push(target_id.to_string());
                diagnostics.push(message);
            }
        }
    }

    Ok(json!({
        "ok": true,
        "assignments": assignments,
        "diagnostics": diagnostics,
        "inactiveRefPaths": inactive_ref_paths
    }))
}

pub(super) fn collect_config_secret_refs(
    value: &Value,
    path: &str,
    refs: &mut Vec<(String, Value)>,
) {
    match value {
        Value::Object(object) => {
            if is_secret_ref_object(object) {
                refs.push((path.to_string(), value.clone()));
                return;
            }
            for (key, child) in object {
                let child_path = if path.is_empty() {
                    key.to_string()
                } else {
                    format!("{path}.{key}")
                };
                collect_config_secret_refs(child, &child_path, refs);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                let child_path = if path.is_empty() {
                    format!("[{index}]")
                } else {
                    format!("{path}[{index}]")
                };
                collect_config_secret_refs(child, &child_path, refs);
            }
        }
        _ => {}
    }
}

pub(super) fn is_secret_ref_object(object: &Map<String, Value>) -> bool {
    let source = object
        .get("source")
        .or_else(|| object.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    matches!(source, "env" | "file" | "exec")
        && object
            .get("id")
            .or_else(|| object.get("name"))
            .or_else(|| object.get("path"))
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
}

pub(super) fn resolve_secret_value(
    state: &GatewayState,
    target_id: &str,
    value: &Value,
) -> Result<Option<Value>, String> {
    if let Some(raw) = value.as_str() {
        return Ok(Some(Value::String(raw.to_string())));
    }
    let Some(object) = value.as_object() else {
        return Ok(Some(value.clone()));
    };
    let source = object
        .get("source")
        .or_else(|| object.get("type"))
        .or_else(|| object.get("provider"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = object
        .get("id")
        .or_else(|| object.get("name"))
        .or_else(|| object.get("path"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    match source {
        "env" => match env::var(id) {
            Ok(secret) => Ok(Some(Value::String(secret))),
            Err(_) => Err(format!(
                "Environment variable {id} for {target_id} is not set."
            )),
        },
        "file" => {
            let path = expand_user_path(id);
            let path = if path.is_absolute() {
                path
            } else {
                state.state_dir.join(path)
            };
            match std::fs::read_to_string(&path) {
                Ok(secret) => Ok(Some(Value::String(secret.trim_end().to_string()))),
                Err(error) => Err(format!(
                    "Failed to read file secret {} for {target_id}: {error}",
                    path.display()
                )),
            }
        }
        "exec" => Err(format!(
            "Exec SecretRef resolution for {target_id} is not enabled in the Rust Gateway."
        )),
        "" => Ok(Some(value.clone())),
        other => Err(format!(
            "Unsupported SecretRef source {other} for {target_id}."
        )),
    }
}
