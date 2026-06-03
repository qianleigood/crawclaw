use super::*;

#[derive(Clone, Debug)]
pub(super) struct GatewayAgentSpec {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub workspace: Option<String>,
    pub model: Option<Value>,
    pub reasoning_level: Option<String>,
    pub system_prompt: Option<String>,
    pub enabled_tools: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub permission_mode: Option<String>,
}

pub(super) fn agents_list(state: &GatewayState) -> Value {
    let agents = gateway_agent_specs(state)
        .into_iter()
        .map(gateway_agent_spec_value)
        .collect::<Vec<_>>();
    json!({
        "defaultId": "main",
        "mainKey": "agent:main:main",
        "scope": "global",
        "agents": agents
    })
}

pub(super) fn apply_gateway_agent_defaults(
    state: &GatewayState,
    params: &mut Value,
) -> Result<(), String> {
    let agent_id = string_param(params, &["agentId"])
        .or_else(|| string_param(params, &["subagent_type", "subagentType", "agentType"]))
        .unwrap_or_else(|| "main".to_string());
    let Some(agent) = gateway_agent_spec(state, &agent_id) else {
        return Ok(());
    };
    let params_object = ensure_json_object(params);
    params_object
        .entry("agentId".to_string())
        .or_insert_with(|| Value::String(agent.id.clone()));
    if let Some(model) = agent.model.clone() {
        params_object.entry("model".to_string()).or_insert(model);
    }
    if let Some(reasoning_level) = agent.reasoning_level {
        params_object
            .entry("reasoningLevel".to_string())
            .or_insert(Value::String(reasoning_level));
    }
    if let Some(system_prompt) = agent.system_prompt {
        params_object
            .entry("systemPrompt".to_string())
            .or_insert(Value::String(system_prompt));
    }
    if let Some(permission_mode) = agent.permission_mode {
        params_object
            .entry("permissionMode".to_string())
            .or_insert(Value::String(permission_mode));
    }
    if !agent.mcp_servers.is_empty() && !params_object.contains_key("mcpServers") {
        params_object.insert(
            "mcpServers".to_string(),
            Value::Array(agent.mcp_servers.into_iter().map(Value::String).collect()),
        );
    }
    if let Some(json_schema) = sdk_json_schema(state) {
        params_object
            .entry("jsonSchema".to_string())
            .or_insert(json_schema);
    }
    if !agent.enabled_tools.is_empty()
        && !params_object.contains_key("enabledTools")
        && !params_object.contains_key("allowedTools")
    {
        params_object.insert(
            "enabledTools".to_string(),
            Value::Array(agent.enabled_tools.into_iter().map(Value::String).collect()),
        );
    }
    Ok(())
}

pub(super) fn gateway_agent_spec(state: &GatewayState, agent_id: &str) -> Option<GatewayAgentSpec> {
    let normalized = agent_id.trim();
    if normalized.is_empty() {
        return None;
    }
    gateway_agent_specs(state)
        .into_iter()
        .find(|agent| agent.id == normalized || agent.name == normalized)
}

fn gateway_agent_specs(state: &GatewayState) -> Vec<GatewayAgentSpec> {
    let mut agents = BTreeMap::<String, GatewayAgentSpec>::new();
    let default_model = crawclaw_providers::bundled_provider_default_model_for("openai")
        .map(|entry| entry.model.to_string())
        .unwrap_or_else(|| "gpt-5.4".to_string());
    agents.insert(
        "main".to_string(),
        GatewayAgentSpec {
            id: "main".to_string(),
            name: "Main".to_string(),
            description: Some("Default CrawClaw agent".to_string()),
            workspace: Some(state.runtime_root.to_string_lossy().to_string()),
            model: Some(json!({
                "primary": default_model,
                "fallbacks": []
            })),
            reasoning_level: None,
            system_prompt: None,
            enabled_tools: Vec::new(),
            mcp_servers: Vec::new(),
            permission_mode: None,
        },
    );

    let config = read_config_value(&config_path(state)).ok();
    merge_builtin_task_agent_specs(&mut agents);
    merge_markdown_agent_specs(state, config.as_ref(), &mut agents);
    if let Some(config) = config.as_ref() {
        merge_config_agent_specs(state, config, &mut agents);
    }
    merge_desktop_agent_specs(state, &mut agents);
    merge_sdk_agent_specs(state, &mut agents);
    apply_sdk_prompt_settings(state, &mut agents);
    agents.into_values().collect()
}

fn merge_builtin_task_agent_specs(agents: &mut BTreeMap<String, GatewayAgentSpec>) {
    for definition in crawclaw_runtime::agent_definitions::user_visible_agent_definitions() {
        merge_gateway_agent_spec(
            agents,
            GatewayAgentSpec {
                id: definition.id.to_string(),
                name: definition.label.to_string(),
                description: Some(definition.description.to_string()),
                workspace: None,
                model: Some(Value::String(definition.model.to_string())),
                reasoning_level: None,
                system_prompt: Some(definition.prompt.to_string()),
                enabled_tools: definition
                    .tool_allowlist
                    .iter()
                    .map(|tool| (*tool).to_string())
                    .collect(),
                mcp_servers: definition
                    .mcp_servers
                    .iter()
                    .map(|server| (*server).to_string())
                    .collect(),
                permission_mode: Some(definition.permission_mode.to_string()),
            },
        );
    }
}

fn merge_config_agent_specs(
    state: &GatewayState,
    config: &Value,
    agents: &mut BTreeMap<String, GatewayAgentSpec>,
) {
    let default_workspace = get_json_path(config, "agents.defaults.workspace")
        .and_then(Value::as_str)
        .map(str::to_string);
    let default_model = get_json_path(config, "agents.defaults.model").cloned();
    if let Some(list) = get_json_path(config, "agents.list").and_then(Value::as_array) {
        for agent in list {
            if let Some(spec) = agent_spec_from_value(state, None, agent, &default_workspace) {
                merge_gateway_agent_spec(agents, spec);
            }
        }
    }
    if let Some(entries) = get_json_path(config, "agents.entries").and_then(Value::as_object) {
        for (id, agent) in entries {
            if let Some(mut spec) =
                agent_spec_from_value(state, Some(id.as_str()), agent, &default_workspace)
            {
                if spec.model.is_none() {
                    spec.model = default_model.clone();
                }
                merge_gateway_agent_spec(agents, spec);
            }
        }
    }
}

fn merge_desktop_agent_specs(
    state: &GatewayState,
    agents: &mut BTreeMap<String, GatewayAgentSpec>,
) {
    let path = state
        .runtime_root
        .join("agents")
        .join("desktop-agents.json");
    let Ok(raw) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(Value::Array(desktop_agents)) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    for agent in desktop_agents {
        if let Some(spec) = desktop_agent_spec_from_value(state, &agent) {
            merge_gateway_agent_spec(agents, spec);
        }
    }
}

fn merge_sdk_agent_specs(state: &GatewayState, agents: &mut BTreeMap<String, GatewayAgentSpec>) {
    let Ok(sdk_agents) = state.sdk_agent_definitions.lock() else {
        return;
    };
    for (id, agent) in sdk_agents.iter() {
        if let Some(spec) = agent_spec_from_value(state, Some(id.as_str()), agent, &None) {
            merge_gateway_agent_spec(agents, spec);
        }
    }
}

pub(super) fn register_sdk_agent_definitions(
    state: &GatewayState,
    agents: &Value,
) -> Result<usize, String> {
    let Some(entries) = agents.as_object() else {
        return Err("initialize agents must be an object keyed by agent name".to_string());
    };
    let mut store = state
        .sdk_agent_definitions
        .lock()
        .map_err(|_| "SDK agent definition store lock poisoned".to_string())?;
    let mut count = 0usize;
    for (id, definition) in entries {
        if !definition.is_object() {
            continue;
        }
        let mut definition = definition.clone();
        let object = ensure_json_object(&mut definition);
        object
            .entry("id".to_string())
            .or_insert_with(|| Value::String(id.clone()));
        object
            .entry("name".to_string())
            .or_insert_with(|| Value::String(id.clone()));
        store.insert(id.clone(), definition);
        count += 1;
    }
    Ok(count)
}

pub(super) fn register_sdk_prompt_settings(
    state: &GatewayState,
    params: &Value,
) -> Result<(), String> {
    let system_prompt = optional_sdk_prompt_param(params, "systemPrompt")?;
    let append_system_prompt = optional_sdk_prompt_param(params, "appendSystemPrompt")?;
    *state
        .sdk_system_prompt
        .lock()
        .map_err(|_| "SDK system prompt store lock poisoned".to_string())? = system_prompt;
    *state
        .sdk_append_system_prompt
        .lock()
        .map_err(|_| "SDK append system prompt store lock poisoned".to_string())? =
        append_system_prompt;
    Ok(())
}

pub(super) fn register_sdk_json_schema(
    state: &GatewayState,
    json_schema: Option<&Value>,
) -> Result<(), String> {
    let json_schema = match json_schema {
        None | Some(Value::Null) => None,
        Some(value) if value.is_object() => Some(value.clone()),
        Some(_) => return Err("initialize jsonSchema must be an object when provided".to_string()),
    };
    *state
        .sdk_json_schema
        .lock()
        .map_err(|_| "SDK JSON schema store lock poisoned".to_string())? = json_schema;
    write_sdk_json_schema(state)
}

fn write_sdk_json_schema(state: &GatewayState) -> Result<(), String> {
    let schema = sdk_json_schema(state);
    let path = state
        .runtime_root
        .join("sdk")
        .join("structured-output-schema.json");
    if let Some(schema) = schema {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create SDK runtime state dir: {error}"))?;
        }
        let body = serde_json::to_vec_pretty(&schema)
            .map_err(|error| format!("failed to encode SDK jsonSchema: {error}"))?;
        std::fs::write(path, body)
            .map_err(|error| format!("failed to write SDK jsonSchema: {error}"))?;
    } else if path.exists() {
        std::fs::remove_file(path)
            .map_err(|error| format!("failed to clear SDK jsonSchema: {error}"))?;
    }
    Ok(())
}

fn sdk_json_schema(state: &GatewayState) -> Option<Value> {
    state
        .sdk_json_schema
        .lock()
        .ok()
        .and_then(|schema| schema.clone())
}

fn apply_sdk_prompt_settings(
    state: &GatewayState,
    agents: &mut BTreeMap<String, GatewayAgentSpec>,
) {
    let system_prompt = state
        .sdk_system_prompt
        .lock()
        .ok()
        .and_then(|prompt| prompt.clone());
    let append_system_prompt = state
        .sdk_append_system_prompt
        .lock()
        .ok()
        .and_then(|prompt| prompt.clone());
    if system_prompt.is_none() && append_system_prompt.is_none() {
        return;
    }
    let Some(main_agent) = agents.get_mut("main") else {
        return;
    };
    let mut prompt = system_prompt
        .or_else(|| main_agent.system_prompt.clone())
        .unwrap_or_default();
    if let Some(append) = append_system_prompt {
        if !prompt.trim().is_empty() {
            prompt.push_str("\n\n");
        }
        prompt.push_str(&append);
    }
    if prompt.trim().is_empty() {
        main_agent.system_prompt = None;
    } else {
        main_agent.system_prompt = Some(prompt);
    }
}

fn optional_sdk_prompt_param(params: &Value, key: &str) -> Result<Option<String>, String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value.trim().is_empty() => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(format!("initialize {key} must be a string when provided")),
    }
}

fn merge_markdown_agent_specs(
    state: &GatewayState,
    config: Option<&Value>,
    agents: &mut BTreeMap<String, GatewayAgentSpec>,
) {
    for root in markdown_agent_roots(state, config) {
        let workspace = markdown_agent_workspace_for_root(state, &root);
        for path in markdown_files_under(&root) {
            let Ok(raw) = std::fs::read_to_string(&path) else {
                continue;
            };
            if let Some(spec) = markdown_agent_spec_from_raw(&workspace, &raw) {
                merge_gateway_agent_spec(agents, spec);
            }
        }
    }
}

fn markdown_agent_roots(state: &GatewayState, config: Option<&Value>) -> Vec<PathBuf> {
    let mut roots = BTreeSet::<PathBuf>::new();
    insert_markdown_agent_roots_for_workspace(&mut roots, &state.runtime_root);
    if let Some(config) = config {
        if let Some(workspace) = get_json_path(config, "agents.defaults.workspace")
            .and_then(Value::as_str)
            .map(|workspace| agent_workspace_path(state, workspace))
        {
            insert_markdown_agent_roots_for_workspace(&mut roots, &workspace);
        }
        if let Some(entries) = get_json_path(config, "agents.entries").and_then(Value::as_object) {
            for entry in entries.values() {
                if let Some(workspace) = string_field(entry, "workspace")
                    .map(|workspace| agent_workspace_path(state, &workspace))
                {
                    insert_markdown_agent_roots_for_workspace(&mut roots, &workspace);
                }
            }
        }
    }
    roots.into_iter().filter(|path| path.is_dir()).collect()
}

fn insert_markdown_agent_roots_for_workspace(roots: &mut BTreeSet<PathBuf>, workspace: &Path) {
    roots.insert(workspace.join(".claude").join("agents"));
    roots.insert(workspace.join(".agents"));
}

fn agent_workspace_path(state: &GatewayState, workspace: &str) -> PathBuf {
    let path = expand_user_path(workspace);
    if path.is_absolute() {
        path
    } else {
        state.runtime_root.join(path)
    }
}

fn markdown_agent_workspace_for_root(state: &GatewayState, root: &Path) -> PathBuf {
    if root.file_name().and_then(|name| name.to_str()) == Some("agents") {
        if let Some(parent) = root.parent() {
            if parent.file_name().and_then(|name| name.to_str()) == Some(".claude") {
                if let Some(workspace) = parent.parent() {
                    return workspace.to_path_buf();
                }
            }
        }
    }
    if root.file_name().and_then(|name| name.to_str()) == Some(".agents") {
        if let Some(workspace) = root.parent() {
            return workspace.to_path_buf();
        }
    }
    state.runtime_root.clone()
}

fn markdown_files_under(root: &PathBuf) -> Vec<PathBuf> {
    let mut pending = vec![root.clone()];
    let mut files = Vec::new();
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if file_type.is_file()
                && path.extension().and_then(|value| value.to_str()) == Some("md")
            {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

fn markdown_agent_spec_from_raw(workspace: &Path, raw: &str) -> Option<GatewayAgentSpec> {
    let (frontmatter, content) = markdown_frontmatter(raw)?;
    let name = markdown_frontmatter_string(&frontmatter, "name")?;
    let description = markdown_frontmatter_string(&frontmatter, "description")?;
    let id =
        markdown_frontmatter_string(&frontmatter, "id").unwrap_or_else(|| slugify_agent_id(&name));
    let model = markdown_frontmatter_string(&frontmatter, "model").map(Value::String);
    let prompt = content.trim();
    let system_prompt = (!prompt.is_empty()).then(|| prompt.to_string());
    Some(GatewayAgentSpec {
        id,
        name,
        description: Some(description.replace("\\n", "\n")),
        workspace: Some(workspace.to_string_lossy().to_string()),
        model,
        reasoning_level: markdown_frontmatter_string(&frontmatter, "effort")
            .or_else(|| markdown_frontmatter_string(&frontmatter, "reasoningLevel"))
            .or_else(|| markdown_frontmatter_string(&frontmatter, "thinking")),
        system_prompt,
        enabled_tools: markdown_frontmatter_list(&frontmatter, "tools")
            .into_iter()
            .chain(markdown_frontmatter_list(&frontmatter, "allowedTools"))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        mcp_servers: markdown_frontmatter_list(&frontmatter, "mcpServers"),
        permission_mode: markdown_frontmatter_string(&frontmatter, "permissionMode"),
    })
}

fn markdown_frontmatter(raw: &str) -> Option<(BTreeMap<String, Value>, &str)> {
    let stripped = raw.strip_prefix("---")?;
    let stripped = stripped
        .strip_prefix("\r\n")
        .or_else(|| stripped.strip_prefix('\n'))?;
    let closing = stripped
        .find("\n---\n")
        .map(|index| (index, 5))
        .or_else(|| stripped.find("\r\n---\r\n").map(|index| (index, 7)))
        .or_else(|| stripped.find("\n---\r\n").map(|index| (index, 6)))
        .or_else(|| stripped.find("\r\n---\n").map(|index| (index, 6)))?;
    let frontmatter = &stripped[..closing.0];
    let content = &stripped[closing.0 + closing.1..];
    Some((parse_simple_frontmatter(frontmatter), content))
}

fn parse_simple_frontmatter(raw: &str) -> BTreeMap<String, Value> {
    let mut map = BTreeMap::new();
    let mut current_list_key: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(key) = current_list_key.as_ref() {
                push_frontmatter_list_item(&mut map, key, item);
            }
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            current_list_key = None;
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() {
            current_list_key = None;
            continue;
        }
        if value.is_empty() {
            map.insert(key.to_string(), Value::Array(Vec::new()));
            current_list_key = Some(key.to_string());
            continue;
        }
        current_list_key = None;
        map.insert(key.to_string(), parse_frontmatter_value(value));
    }
    map
}

fn parse_frontmatter_value(value: &str) -> Value {
    let value = strip_frontmatter_comment(value).trim();
    if value.starts_with('[') && value.ends_with(']') {
        let inner = &value[1..value.len() - 1];
        return Value::Array(
            split_frontmatter_csv(inner)
                .into_iter()
                .map(Value::String)
                .collect(),
        );
    }
    Value::String(unquote_frontmatter_value(value))
}

fn push_frontmatter_list_item(map: &mut BTreeMap<String, Value>, key: &str, item: &str) {
    let item = parse_frontmatter_value(item);
    match map.get_mut(key) {
        Some(Value::Array(items)) => items.push(item),
        _ => {
            map.insert(key.to_string(), Value::Array(vec![item]));
        }
    }
}

fn markdown_frontmatter_string(map: &BTreeMap<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn markdown_frontmatter_list(map: &BTreeMap<String, Value>, key: &str) -> Vec<String> {
    match map.get(key) {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .flat_map(split_frontmatter_csv)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        Some(Value::String(value)) => split_frontmatter_csv(value)
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn split_frontmatter_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(unquote_frontmatter_value)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn strip_frontmatter_comment(value: &str) -> &str {
    value
        .split_once(" #")
        .map(|(value, _)| value)
        .unwrap_or(value)
}

fn unquote_frontmatter_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

fn merge_gateway_agent_spec(
    agents: &mut BTreeMap<String, GatewayAgentSpec>,
    spec: GatewayAgentSpec,
) {
    agents
        .entry(spec.id.clone())
        .and_modify(|existing| {
            existing.name = spec.name.clone();
            existing.description = spec.description.clone().or(existing.description.clone());
            existing.workspace = spec.workspace.clone().or(existing.workspace.clone());
            existing.model = spec.model.clone().or(existing.model.clone());
            existing.reasoning_level = spec
                .reasoning_level
                .clone()
                .or(existing.reasoning_level.clone());
            existing.system_prompt = spec
                .system_prompt
                .clone()
                .or(existing.system_prompt.clone());
            if !spec.enabled_tools.is_empty() {
                existing.enabled_tools = spec.enabled_tools.clone();
            }
            if !spec.mcp_servers.is_empty() {
                existing.mcp_servers = spec.mcp_servers.clone();
            }
            existing.permission_mode = spec
                .permission_mode
                .clone()
                .or(existing.permission_mode.clone());
        })
        .or_insert(spec);
}

fn agent_spec_from_value(
    state: &GatewayState,
    fallback_id: Option<&str>,
    agent: &Value,
    default_workspace: &Option<String>,
) -> Option<GatewayAgentSpec> {
    let id = string_field(agent, "id")
        .or_else(|| fallback_id.map(str::to_string))
        .or_else(|| string_field(agent, "name").map(|name| slugify_agent_id(&name)))?;
    let name = string_field(agent, "name").unwrap_or_else(|| id.clone());
    let workspace = string_field(agent, "workspace")
        .or_else(|| default_workspace.clone())
        .map(|workspace| agent_workspace_string(state, &workspace));
    Some(GatewayAgentSpec {
        id,
        name,
        description: string_field(agent, "description").or_else(|| string_field(agent, "role")),
        workspace,
        model: agent.get("model").cloned(),
        reasoning_level: string_field(agent, "reasoningLevel")
            .or_else(|| string_field(agent, "effort"))
            .or_else(|| string_field(agent, "thinking")),
        system_prompt: agent_system_prompt_from_value(agent),
        enabled_tools: agent_tool_names(agent),
        mcp_servers: string_array_from_value(agent.get("mcpServers")),
        permission_mode: string_field(agent, "permissionMode"),
    })
}

fn desktop_agent_spec_from_value(state: &GatewayState, agent: &Value) -> Option<GatewayAgentSpec> {
    let id = string_field(agent, "id")?;
    let name = string_field(agent, "name").unwrap_or_else(|| id.clone());
    let model = string_field(agent, "model").map(Value::String);
    Some(GatewayAgentSpec {
        id,
        name: name.clone(),
        description: string_field(agent, "description").or_else(|| string_field(agent, "role")),
        workspace: Some(state.runtime_root.to_string_lossy().to_string()),
        model,
        reasoning_level: string_field(agent, "thinking"),
        system_prompt: Some(desktop_agent_system_prompt(agent, &name)),
        enabled_tools: agent_tool_names(agent),
        mcp_servers: string_array_from_value(agent.get("mcpServers")),
        permission_mode: string_field(agent, "permissionMode"),
    })
}

fn gateway_agent_spec_value(agent: GatewayAgentSpec) -> Value {
    let model = agent.model.unwrap_or_else(|| json!({ "fallbacks": [] }));
    let mut value = json!({
        "id": agent.id,
        "name": agent.name,
        "description": agent.description.unwrap_or_default(),
        "workspace": agent.workspace.unwrap_or_default(),
        "model": model,
        "enabledTools": agent.enabled_tools,
        "mcpServers": agent.mcp_servers
    });
    if let (Some(object), Some(reasoning_level)) = (value.as_object_mut(), agent.reasoning_level) {
        object.insert("reasoningLevel".to_string(), Value::String(reasoning_level));
    }
    if let (Some(object), Some(permission_mode)) = (value.as_object_mut(), agent.permission_mode) {
        object.insert("permissionMode".to_string(), Value::String(permission_mode));
    }
    value
}

fn agent_workspace_string(state: &GatewayState, workspace: &str) -> String {
    agent_workspace_path(state, workspace)
        .to_string_lossy()
        .to_string()
}

fn agent_system_prompt_from_value(agent: &Value) -> Option<String> {
    string_field(agent, "systemPrompt")
        .or_else(|| string_field(agent, "prompt"))
        .or_else(|| string_field(agent, "instructions"))
}

fn desktop_agent_system_prompt(agent: &Value, name: &str) -> String {
    let mut sections = vec!["# Agent Context".to_string(), format!("Name: {name}")];
    if let Some(role) = string_field(agent, "role") {
        sections.push(format!("Role: {role}"));
    }
    if let Some(permission_mode) = string_field(agent, "permissionMode") {
        sections.push(format!("Permission mode: {permission_mode}"));
    }
    if let Some(description) = string_field(agent, "description") {
        sections.push(format!("Description: {description}"));
    }
    if let Some(prompt) = agent
        .get("emotion")
        .and_then(|emotion| string_field(emotion, "promptMd"))
    {
        sections.push(prompt);
    }
    let skills = agent
        .get("skills")
        .and_then(Value::as_array)
        .map(|skills| {
            skills
                .iter()
                .filter(|skill| {
                    skill
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter_map(|skill| {
                    let name = string_field(skill, "name")?;
                    let description = string_field(skill, "description").unwrap_or_default();
                    Some(format!("- {name}: {description}"))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !skills.is_empty() {
        sections.push("Enabled skills:".to_string());
        sections.extend(skills);
    }
    sections.join("\n")
}

fn agent_tool_names(agent: &Value) -> Vec<String> {
    string_array_from_value(agent.get("enabledTools"))
        .into_iter()
        .chain(string_array_from_value(agent.get("allowedTools")))
        .chain(string_array_from_value(agent.get("toolAllowlist")))
        .chain(string_array_from_value(agent.get("tools")))
        .chain(
            agent
                .get("tools")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|tool| tool.get("enabled").and_then(Value::as_bool).unwrap_or(true))
                .filter_map(|tool| string_field(tool, "id").or_else(|| string_field(tool, "name"))),
        )
        .map(|tool| tool.trim().to_string())
        .filter(|tool| !tool.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn string_array_from_value(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn logs_tail() -> Value {
    json!({
        "file": "rust-gateway",
        "cursor": 0,
        "size": 0,
        "lines": []
    })
}

pub(super) fn agent_runtime_summary(state: &GatewayState, params: Value) -> Result<Value, String> {
    let sessions = agent_runtime_filtered_sessions(state, &params)?;
    Ok(agent_runtime_summary_value(&sessions))
}

pub(super) fn agent_runtime_summary_value(
    sessions: &[crawclaw_runtime::DesktopSessionSummary],
) -> Value {
    let mut by_category = Map::new();
    for category in ["memory", "review", "subagents", "acp", "cron", "cli"] {
        by_category.insert(category.to_string(), json!(0));
    }
    let mut running = 0;
    let mut failed = 0;
    let mut waiting = 0;
    let mut completed = 0;
    for session in sessions {
        let category = agent_runtime_category(session);
        let count = by_category
            .get(&category)
            .and_then(Value::as_u64)
            .unwrap_or(0)
            + 1;
        by_category.insert(category, json!(count));
        match agent_runtime_status_bucket(&session.status) {
            "running" => running += 1,
            "waiting" => waiting += 1,
            "failed" => failed += 1,
            _ => completed += 1,
        }
    }
    json!({
        "running": running,
        "failed": failed,
        "waiting": waiting,
        "completed": completed,
        "lastCompletedAt": Value::Null,
        "byCategory": Value::Object(by_category)
    })
}

pub(super) fn agent_runtime_list(state: &GatewayState, params: Value) -> Result<Value, String> {
    let sessions = agent_runtime_filtered_sessions(state, &params)?;
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value.max(1) as usize)
        .unwrap_or(40);
    let runs = sessions
        .iter()
        .take(limit)
        .map(|session| agent_runtime_run_value(state, session))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "summary": agent_runtime_summary_value(&sessions),
        "count": runs.len(),
        "runs": runs
    }))
}

pub(super) fn agent_runtime_cancel(state: &GatewayState, params: Value) -> Result<Value, String> {
    let task_id = required_param(&params, &["taskId", "runId", "sessionKey", "key"])?;
    let Some(session) = resolve_agent_runtime_session(state, &task_id)? else {
        return Ok(json!({
            "ok": true,
            "cancelled": false,
            "taskId": task_id,
            "reason": "not_found"
        }));
    };
    let aborted = abort_agent_task_handle(state, &session.key)?;
    if !aborted && !agent_runtime_can_cancel(&session.status) {
        return Ok(json!({
            "ok": true,
            "cancelled": false,
            "taskId": task_id,
            "sessionKey": session.key,
            "status": session.status,
            "reason": "not_running"
        }));
    }
    let cancelled = state
        .session_store
        .patch_session(&session.key, None, None, None, Some("cancelled"))
        .map_err(|error| error.to_string())?;
    emit(
        state,
        "sessions.changed",
        json!({ "session": cancelled.clone() }),
    );
    Ok(json!({
        "ok": true,
        "cancelled": true,
        "aborted": aborted,
        "taskId": task_id,
        "sessionKey": cancelled.key,
        "status": cancelled.status
    }))
}

pub(super) fn register_agent_task_abort_handle(
    state: &GatewayState,
    session_key: &str,
    abort_handle: tokio::task::AbortHandle,
) -> Result<(), String> {
    state
        .agent_task_abort_handles
        .lock()
        .map_err(|_| "agent task abort store lock poisoned".to_string())?
        .insert(session_key.to_string(), abort_handle);
    Ok(())
}

pub(super) fn unregister_agent_task_abort_handle(
    state: &GatewayState,
    session_key: &str,
) -> Result<(), String> {
    state
        .agent_task_abort_handles
        .lock()
        .map_err(|_| "agent task abort store lock poisoned".to_string())?
        .remove(session_key);
    Ok(())
}

fn abort_agent_task_handle(state: &GatewayState, session_key: &str) -> Result<bool, String> {
    let handle = state
        .agent_task_abort_handles
        .lock()
        .map_err(|_| "agent task abort store lock poisoned".to_string())?
        .remove(session_key);
    if let Some(handle) = handle {
        handle.abort();
        return Ok(true);
    }
    Ok(false)
}

pub(super) fn agent_runtime_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let task_id = required_param(&params, &["taskId", "runId", "sessionKey", "key"])?;
    let Some(session) = resolve_agent_runtime_session(state, &task_id)? else {
        return Err(format!("Task not found: {task_id}"));
    };
    let run = agent_runtime_run_value(
        state,
        &crawclaw_runtime::DesktopSessionSummary {
            key: session.key.clone(),
            title: session.title.clone(),
            pinned: session.pinned,
            status: session.status.clone(),
            message_count: session.message_count,
            spawned_by: session.spawned_by.clone(),
            yielded: session.yielded,
        },
    )?;
    Ok(json!({
        "run": run,
        "contract": {
            "definitionId": Value::Null,
            "definitionLabel": Value::Null,
            "spawnSource": run.get("spawnSource").cloned().unwrap_or(Value::Null),
            "executionMode": Value::Null,
            "transcriptPolicy": Value::Null,
            "cleanup": Value::Null,
            "defaultRunTimeoutSeconds": Value::Null,
            "toolAllowlistCount": Value::Null
        },
        "metadata": {
            "mode": "desktop-session",
            "runtimeStateRef": Value::Null,
            "transcriptRef": session.key,
            "trajectoryRef": Value::Null,
            "capabilitySnapshotRef": Value::Null
        },
        "availableActions": {
            "openSession": true,
            "cancel": agent_runtime_can_cancel(&session.status)
        }
    }))
}

pub(super) fn agent_inspect(state: &GatewayState, params: Value) -> Result<Value, String> {
    let target = string_param(
        &params,
        &["runId", "taskId", "traceId", "sessionKey", "key"],
    )
    .ok_or_else(|| "agent.inspect requires runId, taskId, or traceId".to_string())?;
    let Some(session) = resolve_agent_runtime_session(state, &target)? else {
        return Err("agent inspection target not found".to_string());
    };
    let summary = crawclaw_runtime::DesktopSessionSummary {
        key: session.key.clone(),
        title: session.title.clone(),
        pinned: session.pinned,
        status: session.status.clone(),
        message_count: session.message_count,
        spawned_by: session.spawned_by.clone(),
        yielded: session.yielded,
    };
    let run = agent_runtime_run_value(state, &summary)?;
    Ok(json!({
        "lookup": {
            "runId": target,
            "sessionKey": session.key
        },
        "runId": session.key,
        "taskId": run.get("taskId").cloned().unwrap_or(Value::Null),
        "sessionKey": run.get("sessionKey").cloned().unwrap_or(Value::Null),
        "sessionId": run.get("taskId").cloned().unwrap_or(Value::Null),
        "agentId": "main",
        "status": session.status,
        "run": run,
        "warnings": [],
        "refs": {
            "transcriptRef": session.key
        },
        "implementation": "rust-native"
    }))
}

pub(super) fn agent_wait(state: &GatewayState, params: Value) -> Result<Value, String> {
    let run_id = required_param(&params, &["runId", "taskId", "sessionKey", "key"])?;
    let Some(session) = resolve_agent_runtime_session(state, &run_id)? else {
        return Ok(json!({
            "runId": run_id,
            "status": "timeout"
        }));
    };
    let updated_at = session_updated_at_ms(state, &session.key) as u64;
    let status_bucket = agent_runtime_status_bucket(&session.status);
    Ok(json!({
        "runId": session.key,
        "status": match status_bucket {
            "waiting" => "running",
            "failed" => "failed",
            "completed" => "completed",
            _ => "running"
        },
        "startedAt": if matches!(status_bucket, "running" | "waiting") { json!(updated_at) } else { Value::Null },
        "endedAt": if matches!(status_bucket, "completed" | "failed") { json!(updated_at) } else { Value::Null },
        "error": Value::Null
    }))
}

pub(super) fn agent_runtime_filtered_sessions(
    state: &GatewayState,
    params: &Value,
) -> Result<Vec<crawclaw_runtime::DesktopSessionSummary>, String> {
    let category = string_param(params, &["category"]).unwrap_or_else(|| "all".to_string());
    let status = string_param(params, &["status"]).unwrap_or_else(|| "all".to_string());
    let agent = string_param(params, &["agent"]);
    let session_key = string_param(params, &["sessionKey", "key"]);
    let task_id = string_param(params, &["taskId"]);
    let run_id = string_param(params, &["runId"]);
    let mut sessions = state
        .session_store
        .list_summaries()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|session| category == "all" || agent_runtime_category(session) == category)
        .filter(|session| status == "all" || agent_runtime_status_bucket(&session.status) == status)
        .filter(|_session| match agent.as_deref() {
            Some(agent) => agent == "main",
            None => true,
        })
        .filter(|session| {
            session_key
                .as_deref()
                .map(|query| agent_runtime_session_matches_key(session, query))
                .unwrap_or(true)
        })
        .filter(|session| {
            task_id
                .as_deref()
                .map(|query| agent_runtime_session_matches_key(session, query))
                .unwrap_or(true)
        })
        .filter(|session| {
            run_id
                .as_deref()
                .map(|query| agent_runtime_session_matches_key(session, query))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| right.key.cmp(&left.key));
    Ok(sessions)
}

pub(super) fn agent_runtime_session_matches_key(
    session: &crawclaw_runtime::DesktopSessionSummary,
    query: &str,
) -> bool {
    let query = query.trim();
    if query.is_empty() {
        return true;
    }
    if session.key == query || session.key.contains(query) {
        return true;
    }
    normalize_session_key(query)
        .map(|normalized| session.key == normalized || session.key.contains(&normalized))
        .unwrap_or(false)
}

pub(super) fn resolve_agent_runtime_session(
    state: &GatewayState,
    task_id: &str,
) -> Result<Option<crawclaw_runtime::DesktopSessionStatus>, String> {
    if let Some(session) = state
        .session_store
        .session_status(task_id)
        .map_err(|error| error.to_string())?
    {
        return Ok(Some(session));
    }
    let normalized = normalize_session_key(task_id)?;
    if normalized == task_id {
        return Ok(None);
    }
    state
        .session_store
        .session_status(&normalized)
        .map_err(|error| error.to_string())
}

pub(super) fn agent_runtime_category(session: &crawclaw_runtime::DesktopSessionSummary) -> String {
    if session.spawned_by.is_some() {
        return "subagents".to_string();
    }
    let searchable = format!("{} {}", session.key, session.title).to_lowercase();
    if searchable.contains("memory")
        || searchable.contains("dream")
        || searchable.contains("session-summary")
        || searchable.contains("durable")
    {
        return "memory".to_string();
    }
    if searchable.contains("review") {
        return "review".to_string();
    }
    if searchable.contains("acp") {
        return "acp".to_string();
    }
    if searchable.contains("cron") || searchable.contains("schedule") {
        return "cron".to_string();
    }
    "cli".to_string()
}

pub(super) fn agent_runtime_status_bucket(status: &str) -> &'static str {
    match status.trim() {
        "queued" | "pending" | "spawned" | "waiting" => "waiting",
        "running" | "active" | "processing" => "running",
        "failed" | "error" | "timed_out" | "lost" => "failed",
        _ => "completed",
    }
}

pub(super) fn agent_runtime_can_cancel(status: &str) -> bool {
    matches!(agent_runtime_status_bucket(status), "running" | "waiting")
}

pub(super) fn agent_runtime_run_value(
    state: &GatewayState,
    session: &crawclaw_runtime::DesktopSessionSummary,
) -> Result<Value, String> {
    let updated_at = session_updated_at_ms(state, &session.key);
    let status_bucket = agent_runtime_status_bucket(&session.status);
    Ok(json!({
        "taskId": session.key,
        "category": agent_runtime_category(session),
        "runtime": "desktop-session",
        "status": session.status,
        "title": session.title,
        "summary": if session.message_count > 0 {
            Value::String(format!("{} message{}", session.message_count, if session.message_count == 1 { "" } else { "s" }))
        } else {
            Value::Null
        },
        "sessionKey": session.spawned_by.clone().unwrap_or_else(|| session.key.clone()),
        "ownerKey": session.spawned_by.clone().unwrap_or_else(|| session.key.clone()),
        "scopeKind": "session",
        "childSessionKey": if session.spawned_by.is_some() { Value::String(session.key.clone()) } else { Value::Null },
        "agentId": "main",
        "runId": Value::Null,
        "parentTaskId": Value::Null,
        "sourceId": session.spawned_by,
        "spawnSource": if session.spawned_by.is_some() { Value::String("subagents_spawn".to_string()) } else { Value::Null },
        "progressSummary": Value::Null,
        "terminalSummary": Value::Null,
        "error": Value::Null,
        "createdAt": updated_at,
        "updatedAt": updated_at,
        "startedAt": if matches!(status_bucket, "running" | "waiting") { json!(updated_at) } else { Value::Null },
        "endedAt": if status_bucket == "completed" || status_bucket == "failed" { json!(updated_at) } else { Value::Null }
    }))
}

pub(super) fn session_updated_at_ms(state: &GatewayState, key: &str) -> u128 {
    state
        .session_store
        .session_transcript_path(key)
        .ok()
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_else(now_millis)
}

pub(super) fn agent_identity(state: &GatewayState) -> Value {
    json!({
        "agentId": "main",
        "identity": {
            "name": "Main",
            "theme": "default"
        },
        "workspace": state.runtime_root.to_string_lossy()
    })
}

pub(super) fn agents_create(state: &GatewayState, params: Value) -> Result<Value, String> {
    let name = required_param(&params, &["name"])?;
    let workspace = required_param(&params, &["workspace"])?;
    let agent_id = slugify_agent_id(&name);
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("agents.entries.{agent_id}.name"),
        Value::String(name.clone()),
    )?;
    set_json_path(
        &mut config,
        &format!("agents.entries.{agent_id}.workspace"),
        Value::String(workspace.clone()),
    )?;
    if let Some(emoji) = string_param(&params, &["emoji"]) {
        set_json_path(
            &mut config,
            &format!("agents.entries.{agent_id}.identity.emoji"),
            Value::String(emoji),
        )?;
    }
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "name": name,
        "workspace": workspace
    }))
}

pub(super) fn agents_update(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    if agent_id.contains('.') {
        return Err("agent id cannot contain dots".to_string());
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    for (field, config_key) in [
        ("name", "name"),
        ("workspace", "workspace"),
        ("model", "model.primary"),
        ("avatar", "identity.avatar"),
    ] {
        if let Some(value) = string_param(&params, &[field]) {
            set_json_path(
                &mut config,
                &format!("agents.entries.{agent_id}.{config_key}"),
                Value::String(value),
            )?;
        }
    }
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "agentId": agent_id }))
}

pub(super) fn agents_delete(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    if agent_id == "main" {
        return Ok(json!({ "ok": true, "agentId": agent_id, "removedBindings": 0 }));
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let removed = delete_json_path(&mut config, &format!("agents.entries.{agent_id}"));
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "removedBindings": if removed { 1 } else { 0 }
    }))
}

pub(super) fn agents_files_list(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    let workspace = agent_workspace(state, &agent_id)?;
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&workspace) {
        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !metadata.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            files.push(json!({
                "name": name,
                "path": entry.path().to_string_lossy(),
                "missing": false,
                "size": metadata.len()
            }));
        }
    }
    Ok(json!({
        "agentId": agent_id,
        "workspace": workspace.to_string_lossy(),
        "files": files
    }))
}

pub(super) fn agents_files_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    let name = required_param(&params, &["name"])?;
    let workspace = agent_workspace(state, &agent_id)?;
    let path = safe_agent_file_path(&workspace, &name)?;
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => Some(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "failed to read agent file {}: {error}",
                path.display()
            ))
        }
    };
    Ok(json!({
        "agentId": agent_id,
        "workspace": workspace.to_string_lossy(),
        "file": {
            "name": name,
            "path": path.to_string_lossy(),
            "missing": content.is_none(),
            "content": content
        }
    }))
}

pub(super) fn agents_files_set(state: &GatewayState, params: Value) -> Result<Value, String> {
    let agent_id = required_param(&params, &["agentId", "id"])?;
    let name = required_param(&params, &["name"])?;
    let content = string_param(&params, &["content"]).unwrap_or_default();
    let workspace = agent_workspace(state, &agent_id)?;
    std::fs::create_dir_all(&workspace)
        .map_err(|error| format!("failed to create agent workspace: {error}"))?;
    let path = safe_agent_file_path(&workspace, &name)?;
    std::fs::write(&path, &content)
        .map_err(|error| format!("failed to write agent file {}: {error}", path.display()))?;
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "workspace": workspace.to_string_lossy(),
        "file": {
            "name": name,
            "path": path.to_string_lossy(),
            "missing": false,
            "size": content.len(),
            "content": content
        }
    }))
}

pub(super) fn agent_workspace(state: &GatewayState, agent_id: &str) -> Result<PathBuf, String> {
    let config = read_config_value(&config_path(state))?;
    let workspace = get_json_path(&config, &format!("agents.entries.{agent_id}.workspace"))
        .and_then(Value::as_str)
        .map(expand_user_path)
        .unwrap_or_else(|| state.runtime_root.clone());
    Ok(if workspace.is_absolute() {
        workspace
    } else {
        state.runtime_root.join(workspace)
    })
}

pub(super) fn safe_agent_file_path(
    workspace: &std::path::Path,
    name: &str,
) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err("agent file name must be a direct file name".to_string());
    }
    Ok(workspace.join(name))
}

pub(super) fn slugify_agent_id(name: &str) -> String {
    let slug = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        format!("agent-{}", now_millis())
    } else {
        slug
    }
}

pub(super) fn skills_status(state: &GatewayState, params: Value) -> Value {
    let agent_id = string_param(&params, &["agentId"]).unwrap_or_else(|| "main".to_string());
    let skills_root = state.runtime_root.join("skills");
    let config =
        read_config_value(&config_path(state)).unwrap_or_else(|_| Value::Object(Map::new()));
    let mut seen = std::collections::BTreeSet::new();
    let mut skills = Vec::new();

    if let Some(entries) = get_json_path(&config, "skills.entries").and_then(Value::as_object) {
        for (skill_key, entry) in entries {
            seen.insert(skill_key.clone());
            skills.push(json!({
                "skillKey": skill_key,
                "enabled": entry.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                "source": entry.get("source").and_then(Value::as_str).unwrap_or("config"),
                "path": skills_root.join(skill_key).join("SKILL.md").to_string_lossy()
            }));
        }
    }
    if let Ok(entries) = std::fs::read_dir(&skills_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() || !path.join("SKILL.md").exists() {
                continue;
            }
            let Some(skill_key) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !seen.insert(skill_key.to_string()) {
                continue;
            }
            skills.push(json!({
                "skillKey": skill_key,
                "enabled": true,
                "source": "rust-local",
                "path": path.join("SKILL.md").to_string_lossy()
            }));
        }
    }
    json!({
        "agentId": agent_id,
        "skillsRoot": skills_root.to_string_lossy(),
        "skills": skills,
        "implementation": "rust-native"
    })
}

pub(super) fn skills_bins(state: &GatewayState) -> Value {
    let bins = [
        state.runtime_root.join("skills"),
        resolve_home_dir().join(".codex").join("skills"),
    ]
    .into_iter()
    .map(|path| path.to_string_lossy().to_string())
    .collect::<Vec<_>>();
    json!({ "bins": bins })
}

pub(super) fn skills_update(state: &GatewayState, params: Value) -> Result<Value, String> {
    let skill_key = required_param(&params, &["skillKey", "name", "slug"])?;
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    if let Some(enabled) = params.get("enabled").and_then(Value::as_bool) {
        set_json_path(
            &mut config,
            &format!("skills.entries.{skill_key}.enabled"),
            Value::Bool(enabled),
        )?;
    }
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "skillKey": skill_key }))
}

pub(super) fn skills_install(state: &GatewayState, params: Value) -> Result<Value, String> {
    let skill_key = safe_runtime_component_id(
        &required_param(&params, &["skillKey", "name", "slug"])?,
        "skill key",
    )?;
    let skill_dir = state.runtime_root.join("skills").join(&skill_key);
    let skill_path = skill_dir.join("SKILL.md");
    let content = params
        .get("content")
        .or_else(|| params.get("body"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                "---\nname: {skill_key}\ndescription: Local Rust Gateway installed skill.\n---\n\n# {skill_key}\n"
            )
        });
    std::fs::create_dir_all(&skill_dir)
        .map_err(|error| format!("failed to create skill directory: {error}"))?;
    std::fs::write(&skill_path, content)
        .map_err(|error| format!("failed to write skill {}: {error}", skill_path.display()))?;

    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("skills.entries.{skill_key}.enabled"),
        Value::Bool(true),
    )?;
    set_json_path(
        &mut config,
        &format!("skills.entries.{skill_key}.source"),
        Value::String("rust-local".to_string()),
    )?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "skillKey": skill_key,
        "path": skill_path.to_string_lossy(),
        "implementation": "rust-native"
    }))
}
