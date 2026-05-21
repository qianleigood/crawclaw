use super::*;

pub(super) fn agents_list(state: &GatewayState) -> Value {
    let default_model = crawclaw_providers::bundled_provider_default_model_for("openai")
        .map(|entry| entry.model.to_string())
        .unwrap_or_else(|| "gpt-5.4".to_string());
    json!({
        "defaultId": "main",
        "mainKey": "agent:main:main",
        "scope": "global",
        "agents": [{
            "id": "main",
            "name": "Main",
            "workspace": state.runtime_root.to_string_lossy(),
            "model": {
                "primary": default_model,
                "fallbacks": []
            }
        }]
    })
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

pub(super) fn agent_runtime_cancel(_state: &GatewayState, params: Value) -> Result<Value, String> {
    Ok(json!({
        "ok": true,
        "cancelled": false,
        "taskId": string_param(&params, &["taskId", "runId", "sessionKey", "key"])
    }))
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
        "spawnSource": if session.spawned_by.is_some() { Value::String("sessions.spawn".to_string()) } else { Value::Null },
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
