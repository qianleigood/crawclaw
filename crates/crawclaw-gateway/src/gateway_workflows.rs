use super::*;

pub(super) fn workflow_store_root(state: &GatewayState, params: &Value) -> PathBuf {
    if let Some(workspace_dir) = string_param(params, &["workspaceDir"]) {
        return PathBuf::from(workspace_dir)
            .join(".crawclaw")
            .join("workflows");
    }
    if let Some(agent_dir) = string_param(params, &["agentDir"]) {
        return PathBuf::from(agent_dir).join("workflows");
    }
    state.runtime_root.join("workflows")
}

pub(super) fn workflow_agent_id(params: &Value) -> String {
    string_param(params, &["agentId"]).unwrap_or_else(|| "main".to_string())
}

pub(super) fn workflow_registry_path(root: &std::path::Path) -> PathBuf {
    root.join("registry.json")
}

pub(super) fn workflow_executions_path(root: &std::path::Path) -> PathBuf {
    root.join("executions.json")
}

pub(super) fn workflow_spec_path(root: &std::path::Path, workflow_id: &str) -> PathBuf {
    root.join("specs").join(format!("{workflow_id}.json"))
}

pub(super) fn read_workflow_registry(root: &std::path::Path) -> Result<Value, String> {
    let mut registry = read_config_value(&workflow_registry_path(root))?;
    if !registry.is_object() {
        registry = json!({});
    }
    if !registry
        .get("workflows")
        .map(Value::is_array)
        .unwrap_or(false)
    {
        registry["workflows"] = json!([]);
    }
    if registry.get("version").is_none() {
        registry["version"] = json!(1);
    }
    Ok(registry)
}

pub(super) fn write_workflow_registry(
    root: &std::path::Path,
    registry: &Value,
) -> Result<(), String> {
    write_json_file(&workflow_registry_path(root), registry)
}

pub(super) fn read_workflow_executions_store(root: &std::path::Path) -> Result<Value, String> {
    let mut store = read_config_value(&workflow_executions_path(root))?;
    if !store.is_object() {
        store = json!({});
    }
    if !store
        .get("executions")
        .map(Value::is_array)
        .unwrap_or(false)
    {
        store["executions"] = json!([]);
    }
    if store.get("version").is_none() {
        store["version"] = json!(1);
    }
    Ok(store)
}

pub(super) fn write_workflow_executions_store(
    root: &std::path::Path,
    store: &Value,
) -> Result<(), String> {
    write_json_file(&workflow_executions_path(root), store)
}

pub(super) fn workflow_entries(registry: &Value) -> Vec<Value> {
    registry
        .get("workflows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

pub(super) fn workflow_executions(store: &Value) -> Vec<Value> {
    store
        .get("executions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

pub(super) fn workflow_id(entry: &Value) -> String {
    entry
        .get("workflowId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub(super) fn workflow_name(entry: &Value) -> String {
    entry
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            entry
                .get("workflowId")
                .and_then(Value::as_str)
                .unwrap_or_default()
        })
        .to_string()
}

pub(super) fn workflow_matches_ref(entry: &Value, workflow_ref: &str) -> bool {
    let needle = workflow_ref.trim().to_lowercase();
    if needle.is_empty() {
        return false;
    }
    entry
        .get("workflowId")
        .and_then(Value::as_str)
        .map(|value| value.trim().eq_ignore_ascii_case(&needle))
        .unwrap_or(false)
        || entry
            .get("name")
            .and_then(Value::as_str)
            .map(|value| value.trim().eq_ignore_ascii_case(&needle))
            .unwrap_or(false)
}

pub(super) fn find_workflow_entry(entries: &[Value], workflow_ref: &str) -> Option<Value> {
    entries
        .iter()
        .find(|entry| workflow_matches_ref(entry, workflow_ref))
        .cloned()
}

pub(super) fn workflow_invocation(entry: &Value) -> Value {
    if entry.get("archivedAt").is_some() {
        return json!({
            "canRun": false,
            "autoRunnable": false,
            "recommendedAction": "skip",
            "reason": "Workflow is archived."
        });
    }
    if !entry
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({
            "canRun": false,
            "autoRunnable": false,
            "recommendedAction": "skip",
            "reason": "Workflow is disabled."
        });
    }
    if entry
        .get("deploymentState")
        .and_then(Value::as_str)
        .unwrap_or("draft")
        != "deployed"
    {
        return json!({
            "canRun": false,
            "autoRunnable": false,
            "recommendedAction": "skip",
            "reason": "Workflow is still draft and must be deployed first."
        });
    }
    if entry
        .get("requiresApproval")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({
            "canRun": true,
            "autoRunnable": false,
            "recommendedAction": "ask",
            "reason": "Workflow requires explicit operator approval before running."
        });
    }
    if entry
        .get("safeForAutoRun")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({
            "canRun": true,
            "autoRunnable": true,
            "recommendedAction": "run",
            "reason": "Workflow is deployed, enabled, and marked safe for auto-run."
        });
    }
    json!({
        "canRun": true,
        "autoRunnable": false,
        "recommendedAction": "ask",
        "reason": "Workflow is runnable, but not marked safe for autonomous execution."
    })
}

pub(super) fn workflow_require_n8n_base_url(state: &GatewayState) -> Result<String, String> {
    let config = read_config_value(&config_path(state))?;
    let base_url = workflow_n8n_config_string(&config, "baseUrl")
        .or_else(|| env::var("CRAWCLAW_N8N_BASE_URL").ok())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());
    let api_key = workflow_n8n_config_string(&config, "apiKey")
        .or_else(|| env::var("CRAWCLAW_N8N_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match (base_url, api_key) {
        (Some(base_url), Some(_)) => Ok(base_url),
        _ => Err(
            "n8n is not configured. Set workflow.n8n.baseUrl/apiKey or CRAWCLAW_N8N_BASE_URL and CRAWCLAW_N8N_API_KEY."
                .to_string(),
        ),
    }
}

pub(super) fn workflow_n8n_config_string(config: &Value, key: &str) -> Option<String> {
    get_json_path(config, &format!("workflow.n8n.{key}"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn workflow_with_invocation(entry: Value) -> Value {
    let mut object = entry.as_object().cloned().unwrap_or_default();
    object.insert(
        "invocation".to_string(),
        workflow_invocation(&Value::Object(object.clone())),
    );
    Value::Object(object)
}

pub(super) fn workflow_execution_updated_at(execution: &Value) -> u64 {
    execution
        .get("updatedAt")
        .or_else(|| execution.get("startedAt"))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

pub(super) fn workflow_execution_view(execution: Value) -> Value {
    let mut object = execution.as_object().cloned().unwrap_or_default();
    if let Some(execution_id) = object.get("executionId").cloned() {
        object.insert("localExecutionId".to_string(), execution_id);
    }
    if object.get("updatedAt").is_none() {
        object.insert("updatedAt".to_string(), json!(now_millis() as u64));
    }
    let source = if object.get("n8nExecutionId").is_some() || object.get("remote").is_some() {
        "local+n8n"
    } else {
        "local"
    };
    object.insert("source".to_string(), Value::String(source.to_string()));
    Value::Object(object)
}

pub(super) fn workflow_recent_execution_views(
    executions: &[Value],
    workflow_id: &str,
    limit: usize,
) -> Vec<Value> {
    let mut matches = executions
        .iter()
        .filter(|execution| {
            execution.get("workflowId").and_then(Value::as_str) == Some(workflow_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        workflow_execution_updated_at(right).cmp(&workflow_execution_updated_at(left))
    });
    matches
        .into_iter()
        .take(limit)
        .map(workflow_execution_view)
        .collect()
}

pub(super) fn workflow_list(state: &GatewayState, params: Value) -> Result<Value, String> {
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let executions = workflow_executions(&read_workflow_executions_store(&root)?);
    let include_disabled = params
        .get("includeDisabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    let mut workflows = workflow_entries(&registry)
        .into_iter()
        .filter(|workflow| {
            include_disabled
                || workflow
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    workflows.sort_by(|left, right| {
        right
            .get("updatedAt")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .cmp(&left.get("updatedAt").and_then(Value::as_u64).unwrap_or(0))
    });
    let count = workflows.len();
    let workflows = workflows
        .into_iter()
        .take(limit.unwrap_or(usize::MAX))
        .map(|workflow| {
            let workflow_id = workflow_id(&workflow);
            let run_count = executions
                .iter()
                .filter(|execution| {
                    execution.get("workflowId").and_then(Value::as_str)
                        == Some(workflow_id.as_str())
                })
                .count();
            let recent_execution = workflow_recent_execution_views(&executions, &workflow_id, 1)
                .into_iter()
                .next()
                .unwrap_or(Value::Null);
            let mut object = workflow_with_invocation(workflow)
                .as_object()
                .cloned()
                .unwrap_or_default();
            object.insert("runCount".to_string(), json!(run_count));
            object.insert("recentExecution".to_string(), recent_execution);
            Value::Object(object)
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "count": count,
        "workflows": workflows
    }))
}

pub(super) fn workflow_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow", "workflowId"])?;
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let entries = workflow_entries(&registry);
    let Some(entry) = find_workflow_entry(&entries, &workflow) else {
        return Err(format!("Workflow \"{workflow}\" not found."));
    };
    let workflow_id = workflow_id(&entry);
    let spec_path = workflow_spec_path(&root, &workflow_id);
    let spec = if spec_path.exists() {
        read_config_value(&spec_path)?
    } else {
        Value::Null
    };
    let recent_limit = params
        .get("recentRunsLimit")
        .and_then(Value::as_u64)
        .unwrap_or(5) as usize;
    let executions = workflow_executions(&read_workflow_executions_store(&root)?);
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "workflow": workflow_with_invocation(entry),
        "spec": spec,
        "specPath": spec_path.to_string_lossy(),
        "storeRoot": root.to_string_lossy(),
        "recentExecutions": workflow_recent_execution_views(&executions, &workflow_id, recent_limit),
        "implementation": "rust-native"
    }))
}

pub(super) fn workflow_match(state: &GatewayState, params: Value) -> Result<Value, String> {
    let query = required_param(&params, &["query"])?;
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let enabled_only = params
        .get("enabledOnly")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let deployed_only = params
        .get("deployedOnly")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let auto_only = params
        .get("autoRunnableOnly")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(5) as usize;
    let mut matches = workflow_entries(&registry)
        .into_iter()
        .filter_map(|entry| {
            let score = workflow_match_score(&entry, &query);
            if score == 0 {
                return None;
            }
            let invocation = workflow_invocation(&entry);
            if enabled_only
                && !entry
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                return None;
            }
            if deployed_only
                && entry
                    .get("deploymentState")
                    .and_then(Value::as_str)
                    .unwrap_or("draft")
                    != "deployed"
            {
                return None;
            }
            if auto_only
                && !invocation
                    .get("autoRunnable")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                return None;
            }
            let mut object = workflow_with_invocation(entry)
                .as_object()
                .cloned()
                .unwrap_or_default();
            object.insert("matchScore".to_string(), json!(score));
            Some(Value::Object(object))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        right
            .get("matchScore")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .cmp(&left.get("matchScore").and_then(Value::as_u64).unwrap_or(0))
            .then_with(|| {
                right
                    .get("updatedAt")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .cmp(&left.get("updatedAt").and_then(Value::as_u64).unwrap_or(0))
            })
    });
    let count = matches.len();
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "query": query,
        "count": count,
        "matches": matches.into_iter().take(limit).collect::<Vec<_>>()
    }))
}

pub(super) fn workflow_match_score(entry: &Value, query: &str) -> u64 {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return 0;
    }
    let name = workflow_name(entry).to_lowercase();
    let description = entry
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let tags = string_array_param(entry, "tags")
        .unwrap_or_default()
        .into_iter()
        .map(|tag| tag.to_lowercase())
        .collect::<Vec<_>>();
    let mut score = 0;
    if name == q {
        score += 100;
    }
    if name.contains(&q) {
        score += 50;
    }
    if description.contains(&q) {
        score += 20;
    }
    for tag in &tags {
        if tag == &q {
            score += 20;
        } else if tag.contains(&q) {
            score += 10;
        }
    }
    for term in q.split_whitespace() {
        if name.contains(term) {
            score += 8;
        }
        if description.contains(term) {
            score += 4;
        }
        if tags.iter().any(|tag| tag.contains(term)) {
            score += 2;
        }
    }
    score
}

pub(super) fn workflow_runs(state: &GatewayState, params: Value) -> Result<Value, String> {
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let workflow_ref = string_param(&params, &["workflow"]);
    let workflow_id = workflow_ref.as_ref().map(|workflow_ref| {
        find_workflow_entry(&workflow_entries(&registry), workflow_ref)
            .map(|entry| workflow_id(&entry))
            .unwrap_or_else(|| workflow_ref.to_string())
    });
    let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
    let mut executions = workflow_executions(&read_workflow_executions_store(&root)?)
        .into_iter()
        .filter(|execution| {
            workflow_id
                .as_ref()
                .map(|workflow_id| {
                    execution.get("workflowId").and_then(Value::as_str)
                        == Some(workflow_id.as_str())
                })
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    executions.sort_by(|left, right| {
        workflow_execution_updated_at(right).cmp(&workflow_execution_updated_at(left))
    });
    let count = executions.len();
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "count": count,
        "executions": executions
            .into_iter()
            .take(limit)
            .map(workflow_execution_view)
            .collect::<Vec<_>>()
    }))
}
