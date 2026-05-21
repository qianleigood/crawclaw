use super::*;

pub(super) fn workflow_store_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join("workflows").join("registry.json")
}

pub(super) fn workflow_executions_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join("workflows").join("executions.json")
}

pub(super) fn workflow_spec_path(runtime_root: &Path, workflow_id: &str) -> PathBuf {
    runtime_root
        .join("workflows")
        .join("specs")
        .join(format!("{workflow_id}.json"))
}

pub(super) fn workflow_version_path(
    runtime_root: &Path,
    workflow_id: &str,
    version: u64,
) -> PathBuf {
    runtime_root
        .join("workflows")
        .join("versions")
        .join(workflow_id)
        .join(format!("{version}.json"))
}

pub(super) fn load_workflow_store(runtime_root: &Path) -> Result<Value, String> {
    let path = workflow_store_path(runtime_root);
    let mut store = if path.exists() {
        fs::read_to_string(&path)
            .map_err(|error| error.to_string())
            .and_then(|raw| serde_json::from_str(&raw).map_err(|error| error.to_string()))?
    } else {
        json!({})
    };
    if !store.is_object() {
        store = json!({});
    }
    if !store.get("workflows").map(Value::is_array).unwrap_or(false) {
        store["workflows"] = json!([]);
    }
    if store.get("version").is_none() {
        store["version"] = json!(1);
    }
    Ok(store)
}

pub(super) fn save_workflow_store(runtime_root: &Path, store: &Value) -> Result<(), String> {
    let path = workflow_store_path(runtime_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_vec_pretty(store).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub(super) fn load_workflow_executions(runtime_root: &Path) -> Result<Value, String> {
    let path = workflow_executions_path(runtime_root);
    let mut store = if path.exists() {
        fs::read_to_string(&path)
            .map_err(|error| error.to_string())
            .and_then(|raw| serde_json::from_str(&raw).map_err(|error| error.to_string()))?
    } else {
        json!({})
    };
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

pub(super) fn save_workflow_executions(runtime_root: &Path, store: &Value) -> Result<(), String> {
    let path = workflow_executions_path(runtime_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_vec_pretty(store).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub(super) fn save_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub(super) fn load_json_file(path: &Path) -> Result<Value, String> {
    fs::read_to_string(path)
        .map_err(|error| error.to_string())
        .and_then(|raw| serde_json::from_str(&raw).map_err(|error| error.to_string()))
}

pub(super) fn slug(value: &str) -> String {
    let slug = value
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
        "workflow".to_string()
    } else {
        slug
    }
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
        .or_else(|| entry.get("workflowId").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

pub(super) fn workflow_invocation(entry: &Value) -> Value {
    if entry.get("archivedAt").is_some() {
        return json!({ "canRun": false, "autoRunnable": false, "recommendedAction": "skip", "reason": "Workflow is archived." });
    }
    if !entry
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({ "canRun": false, "autoRunnable": false, "recommendedAction": "skip", "reason": "Workflow is disabled." });
    }
    if entry
        .get("deploymentState")
        .and_then(Value::as_str)
        .unwrap_or("draft")
        != "deployed"
    {
        return json!({ "canRun": false, "autoRunnable": false, "recommendedAction": "skip", "reason": "Workflow is still draft and must be deployed first." });
    }
    if entry
        .get("requiresApproval")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({ "canRun": true, "autoRunnable": false, "recommendedAction": "ask", "reason": "Workflow requires explicit operator approval before running." });
    }
    if entry
        .get("safeForAutoRun")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return json!({ "canRun": true, "autoRunnable": true, "recommendedAction": "run", "reason": "Workflow is deployed, enabled, and marked safe for auto-run." });
    }
    json!({ "canRun": true, "autoRunnable": false, "recommendedAction": "ask", "reason": "Workflow is runnable, but not marked safe for autonomous execution." })
}

pub(super) fn workflow_view(entry: Value) -> Value {
    let mut object = entry.as_object().cloned().unwrap_or_default();
    object.insert(
        "invocation".to_string(),
        workflow_invocation(&Value::Object(object.clone())),
    );
    Value::Object(object)
}

pub(super) fn workflow_execution_view(execution: Value) -> Value {
    let mut object = execution.as_object().cloned().unwrap_or_default();
    if let Some(execution_id) = object.get("executionId").cloned() {
        object.insert("localExecutionId".to_string(), execution_id);
    }
    object
        .entry("source".to_string())
        .or_insert_with(|| Value::String("rust-native".to_string()));
    Value::Object(object)
}

pub(super) fn workflow_match_score(entry: &Value, query: &str) -> u64 {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return 0;
    }
    let name = workflow_name(entry).to_lowercase();
    let description = entry
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let tags = entry
        .get("tags")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|tag| tag.as_str().map(str::to_lowercase))
        .collect::<Vec<_>>();
    let mut score = 0;
    if name == query {
        score += 100;
    }
    if name.contains(&query) {
        score += 50;
    }
    if description.contains(&query) {
        score += 20;
    }
    for tag in &tags {
        if tag == &query {
            score += 20;
        } else if tag.contains(&query) {
            score += 10;
        }
    }
    for term in query.split_whitespace() {
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

pub(super) fn save_workflow_snapshot(
    runtime_root: &Path,
    workflow_id: &str,
    spec_version: u64,
    spec: &Value,
) -> Result<PathBuf, String> {
    let snapshot = json!({
        "workflowId": workflow_id,
        "specVersion": spec_version,
        "createdAt": now_millis(),
        "spec": spec
    });
    let path = workflow_version_path(runtime_root, workflow_id, spec_version);
    save_json_file(&path, &snapshot)?;
    Ok(path)
}

pub(super) fn workflow_versions(
    runtime_root: &Path,
    workflow_id: &str,
) -> Result<Vec<Value>, String> {
    let dir = runtime_root
        .join("workflows")
        .join("versions")
        .join(workflow_id);
    let mut versions = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Ok(snapshot) = load_json_file(&path) {
                versions.push(snapshot);
            }
        }
    }
    versions.sort_by(|left, right| {
        left.get("specVersion")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .cmp(
                &right
                    .get("specVersion")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            )
    });
    Ok(versions)
}

pub(super) fn run_workflowize_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let name = required_param_string("workflowize", &input, &["name"])?;
    let goal = required_param_string("workflowize", &input, &["goal"])?;
    let now = now_millis();
    let workflow_id = format!("wf_{}_{}", slug(&name), now);
    let spec = json!({
        "workflowId": workflow_id,
        "name": name,
        "goal": goal,
        "topology": string_param(&input, &["topology"]).unwrap_or_else(|| "linear_v1".to_string()),
        "description": string_param(&input, &["description"]),
        "sourceSummary": string_param(&input, &["sourceSummary"]),
        "steps": input.get("stepSpecs").cloned().or_else(|| input.get("steps").cloned()).unwrap_or_else(|| json!([])),
        "tags": input.get("tags").cloned().unwrap_or_else(|| json!([])),
        "inputs": input.get("inputs").cloned().unwrap_or_else(|| json!([])),
        "outputs": input.get("outputs").cloned().unwrap_or_else(|| json!([])),
        "createdAt": now,
        "updatedAt": now
    });
    let mut store = load_workflow_store(runtime_root)?;
    let workflows = store
        .get_mut("workflows")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "workflow store is invalid".to_string())?;
    if workflows
        .iter()
        .any(|entry| entry.get("name").and_then(Value::as_str) == Some(&name))
    {
        return Err(format!("Workflow \"{name}\" already exists."));
    }
    let entry = json!({
        "workflowId": workflow_id,
        "name": name,
        "goal": goal,
        "enabled": true,
        "scope": "runtime",
        "target": "rust-native",
        "deploymentState": "draft",
        "specVersion": 1,
        "deploymentVersion": 0,
        "safeForAutoRun": input.get("safeForAutoRun").and_then(Value::as_bool).unwrap_or(false),
        "requiresApproval": input.get("requiresApproval").and_then(Value::as_bool).unwrap_or(true),
        "createdAt": now,
        "updatedAt": now
    });
    workflows.push(entry.clone());
    store["updatedAt"] = json!(now);
    save_workflow_store(runtime_root, &store)?;
    let spec_path = workflow_spec_path(runtime_root, &workflow_id);
    save_json_file(&spec_path, &spec)?;
    let snapshot_path = save_workflow_snapshot(runtime_root, &workflow_id, 1, &spec)?;
    Ok(tool_envelope(
        "Workflow draft created.",
        json!({
            "status": "created",
            "workflowId": workflow_id,
            "name": entry["name"],
            "deploymentState": "draft",
            "target": "rust-native",
            "storeRoot": runtime_root.join("workflows").to_string_lossy(),
            "specPath": spec_path.to_string_lossy(),
            "snapshotPath": snapshot_path.to_string_lossy(),
            "workflow": entry,
            "spec": spec
        }),
        false,
    ))
}

pub(super) fn run_workflow_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let action = required_param_string("workflow", &input, &["action"])?;
    let mut store = load_workflow_store(runtime_root)?;
    let workflows = store
        .get_mut("workflows")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "workflow store is invalid".to_string())?;
    match action.as_str() {
        "list" => {
            let include_disabled = input
                .get("includeDisabled")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let limit = input
                .get("limit")
                .and_then(Value::as_u64)
                .map(|value| value as usize);
            let executions = load_workflow_executions(runtime_root)?;
            let execution_items = executions
                .get("executions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut items = workflows
                .iter()
                .filter(|entry| {
                    include_disabled
                        || entry
                            .get("enabled")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                })
                .cloned()
                .map(|entry| {
                    let id = workflow_id(&entry);
                    let run_count = execution_items
                        .iter()
                        .filter(|execution| {
                            execution.get("workflowId").and_then(Value::as_str) == Some(&id)
                        })
                        .count();
                    let mut view = workflow_view(entry);
                    view["runCount"] = json!(run_count);
                    view
                })
                .collect::<Vec<_>>();
            items.sort_by(|left, right| {
                right
                    .get("updatedAt")
                    .and_then(Value::as_u64)
                    .cmp(&left.get("updatedAt").and_then(Value::as_u64))
            });
            if let Some(limit) = limit {
                items.truncate(limit);
            }
            Ok(tool_envelope(
                "Workflow list loaded.",
                json!({ "status": "ok", "workflows": items, "implementation": "rust-native" }),
                false,
            ))
        }
        "describe" | "get" => {
            let workflow =
                required_param_string("workflow", &input, &["workflow", "workflowId", "name"])?;
            let entry = workflows
                .iter()
                .find(|entry| workflow_matches(entry, &workflow))
                .cloned()
                .ok_or_else(|| format!("Workflow \"{workflow}\" not found."))?;
            let id = workflow_id(&entry);
            let spec_path = workflow_spec_path(runtime_root, &id);
            let spec = if spec_path.exists() {
                load_json_file(&spec_path).ok()
            } else {
                None
            };
            let executions = load_workflow_executions(runtime_root)?;
            let mut recent_executions = executions
                .get("executions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|execution| {
                    execution.get("workflowId").and_then(Value::as_str) == Some(&id)
                })
                .map(workflow_execution_view)
                .collect::<Vec<_>>();
            recent_executions.sort_by(|left, right| {
                right
                    .get("updatedAt")
                    .and_then(Value::as_u64)
                    .cmp(&left.get("updatedAt").and_then(Value::as_u64))
            });
            recent_executions.truncate(10);
            Ok(tool_envelope(
                "Workflow loaded.",
                json!({
                    "status": "ok",
                    "workflow": workflow_view(entry),
                    "spec": spec,
                    "specPath": spec_path.to_string_lossy(),
                    "recentExecutions": recent_executions,
                    "implementation": "rust-native"
                }),
                false,
            ))
        }
        "versions" => {
            let workflow =
                required_param_string("workflow", &input, &["workflow", "workflowId", "name"])?;
            let entry = workflows
                .iter()
                .find(|entry| workflow_matches(entry, &workflow))
                .cloned()
                .ok_or_else(|| format!("Workflow \"{workflow}\" not found."))?;
            let versions = workflow_versions(runtime_root, &workflow_id(&entry))?;
            Ok(tool_envelope(
                "Workflow versions loaded.",
                json!({ "status": "ok", "versions": versions, "implementation": "rust-native" }),
                false,
            ))
        }
        "diff" => {
            let workflow =
                required_param_string("workflow", &input, &["workflow", "workflowId", "name"])?;
            let entry = workflows
                .iter()
                .find(|entry| workflow_matches(entry, &workflow))
                .cloned()
                .ok_or_else(|| format!("Workflow \"{workflow}\" not found."))?;
            let id = workflow_id(&entry);
            let current_version = entry
                .get("specVersion")
                .and_then(Value::as_u64)
                .unwrap_or(1);
            let from_version = input
                .get("specVersion")
                .or_else(|| input.get("fromSpecVersion"))
                .and_then(Value::as_u64)
                .unwrap_or_else(|| current_version.saturating_sub(1).max(1));
            let to_version = input
                .get("toSpecVersion")
                .and_then(Value::as_u64)
                .unwrap_or(current_version);
            let from_path = workflow_version_path(runtime_root, &id, from_version);
            let to_path = workflow_version_path(runtime_root, &id, to_version);
            let from = if from_path.exists() {
                Some(load_json_file(&from_path)?)
            } else {
                None
            };
            let to = if to_path.exists() {
                Some(load_json_file(&to_path)?)
            } else {
                None
            };
            Ok(tool_envelope(
                "Workflow diff loaded.",
                json!({
                    "status": "ok",
                    "workflowId": id,
                    "fromSpecVersion": from_version,
                    "toSpecVersion": to_version,
                    "changed": from != to,
                    "from": from,
                    "to": to,
                    "implementation": "rust-native"
                }),
                false,
            ))
        }
        "update" => {
            let workflow =
                required_param_string("workflow", &input, &["workflow", "workflowId", "name"])?;
            let patch = input
                .get("patch")
                .and_then(Value::as_object)
                .cloned()
                .ok_or_else(|| "workflow update requires patch object".to_string())?;
            let index = workflows
                .iter()
                .position(|entry| workflow_matches(entry, &workflow))
                .ok_or_else(|| format!("Workflow \"{workflow}\" not found."))?;
            let mut entry = workflows[index].clone();
            let id = workflow_id(&entry);
            let spec_path = workflow_spec_path(runtime_root, &id);
            let mut spec = if spec_path.exists() {
                load_json_file(&spec_path)?
            } else {
                json!({ "workflowId": id })
            };
            let now = now_millis();
            for (key, value) in patch {
                match key.as_str() {
                    "name" | "goal" | "description" | "tags" | "inputs" | "outputs"
                    | "topology" | "steps" | "safeForAutoRun" | "requiresApproval" => {
                        spec[&key] = value.clone();
                        if matches!(
                            key.as_str(),
                            "name"
                                | "goal"
                                | "description"
                                | "tags"
                                | "safeForAutoRun"
                                | "requiresApproval"
                        ) {
                            entry[&key] = value;
                        }
                    }
                    _ => return Err(format!("unsupported workflow patch field: {key}")),
                }
            }
            let next_version = entry
                .get("specVersion")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                + 1;
            entry["specVersion"] = json!(next_version);
            entry["updatedAt"] = json!(now);
            spec["specVersion"] = json!(next_version);
            spec["updatedAt"] = json!(now);
            workflows[index] = entry.clone();
            store["updatedAt"] = json!(now);
            save_workflow_store(runtime_root, &store)?;
            save_json_file(&spec_path, &spec)?;
            let snapshot_path = save_workflow_snapshot(runtime_root, &id, next_version, &spec)?;
            Ok(tool_envelope(
                "Workflow updated.",
                json!({
                    "status": "updated",
                    "workflow": workflow_view(entry),
                    "spec": spec,
                    "snapshotPath": snapshot_path.to_string_lossy(),
                    "implementation": "rust-native"
                }),
                false,
            ))
        }
        "match" => {
            let query = string_param(&input, &["query"])
                .unwrap_or_default()
                .to_lowercase();
            let enabled_only = input
                .get("enabledOnly")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let deployed_only = input
                .get("deployedOnly")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let auto_runnable_only = input
                .get("autoRunnableOnly")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(5) as usize;
            let mut matches = workflows
                .iter()
                .filter(|entry| {
                    (!enabled_only
                        || entry
                            .get("enabled")
                            .and_then(Value::as_bool)
                            .unwrap_or(false))
                        && (!deployed_only
                            || entry
                                .get("deploymentState")
                                .and_then(Value::as_str)
                                .unwrap_or("draft")
                                == "deployed")
                        && (!auto_runnable_only
                            || workflow_invocation(entry)
                                .get("autoRunnable")
                                .and_then(Value::as_bool)
                                .unwrap_or(false))
                })
                .filter_map(|entry| {
                    let score = workflow_match_score(entry, &query);
                    if !query.is_empty() && score == 0 {
                        return None;
                    }
                    let mut view = workflow_view(entry.clone());
                    view["score"] = json!(score);
                    Some(view)
                })
                .collect::<Vec<_>>();
            matches.sort_by(|left, right| {
                right
                    .get("score")
                    .and_then(Value::as_u64)
                    .cmp(&left.get("score").and_then(Value::as_u64))
            });
            matches.truncate(limit.max(1));
            Ok(tool_envelope(
                "Workflow match complete.",
                json!({ "status": "ok", "matches": matches, "implementation": "rust-native" }),
                false,
            ))
        }
        "enable" | "disable" | "archive" | "unarchive" | "deploy" | "delete" => {
            let workflow =
                required_param_string("workflow", &input, &["workflow", "workflowId", "name"])?;
            let index = workflows
                .iter()
                .position(|entry| workflow_matches(entry, &workflow))
                .ok_or_else(|| format!("Workflow \"{workflow}\" not found."))?;
            let mut entry = workflows[index].clone();
            let now = now_millis();
            match action.as_str() {
                "enable" => entry["enabled"] = Value::Bool(true),
                "disable" => entry["enabled"] = Value::Bool(false),
                "archive" => entry["archivedAt"] = json!(now),
                "unarchive" => {
                    if let Some(object) = entry.as_object_mut() {
                        object.remove("archivedAt");
                    }
                }
                "deploy" => {
                    let deployment_version = entry
                        .get("deploymentVersion")
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                        + 1;
                    entry["deploymentState"] = json!("deployed");
                    entry["target"] = json!("rust-native");
                    entry["deploymentVersion"] = json!(deployment_version);
                    entry["deployedAt"] = json!(now);
                }
                "delete" => {
                    let removed_id = workflow_id(&workflows[index]);
                    let removed = workflows.remove(index);
                    save_workflow_store(runtime_root, &store)?;
                    let mut executions = load_workflow_executions(runtime_root)?;
                    if let Some(items) = executions
                        .get_mut("executions")
                        .and_then(Value::as_array_mut)
                    {
                        items.retain(|execution| {
                            execution.get("workflowId").and_then(Value::as_str) != Some(&removed_id)
                        });
                    }
                    save_workflow_executions(runtime_root, &executions)?;
                    return Ok(tool_envelope(
                        "Workflow deleted.",
                        json!({ "status": "deleted", "workflow": removed, "implementation": "rust-native" }),
                        false,
                    ));
                }
                _ => {}
            }
            entry["updatedAt"] = json!(now);
            workflows[index] = entry.clone();
            store["updatedAt"] = json!(now);
            save_workflow_store(runtime_root, &store)?;
            Ok(tool_envelope(
                "Workflow updated.",
                json!({ "status": "ok", "action": action, "workflow": workflow_view(entry), "implementation": "rust-native" }),
                false,
            ))
        }
        "runs" => {
            let workflow_filter = string_param(&input, &["workflow", "workflowId", "name"]);
            let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            let executions = load_workflow_executions(runtime_root)?;
            let mut runs = executions
                .get("executions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|execution| {
                    workflow_filter
                        .as_deref()
                        .map(|needle| {
                            workflows
                                .iter()
                                .find(|entry| workflow_matches(entry, needle))
                                .map(|entry| {
                                    execution.get("workflowId").and_then(Value::as_str)
                                        == Some(workflow_id(entry).as_str())
                                })
                                .unwrap_or_else(|| workflow_execution_matches(execution, needle))
                        })
                        .unwrap_or(true)
                })
                .map(workflow_execution_view)
                .collect::<Vec<_>>();
            runs.sort_by(|left, right| {
                right
                    .get("updatedAt")
                    .and_then(Value::as_u64)
                    .cmp(&left.get("updatedAt").and_then(Value::as_u64))
            });
            runs.truncate(limit.max(1));
            Ok(tool_envelope(
                "Workflow runs loaded.",
                json!({ "status": "ok", "runs": runs, "implementation": "rust-native" }),
                false,
            ))
        }
        "run" => {
            let workflow =
                required_param_string("workflow", &input, &["workflow", "workflowId", "name"])?;
            let index = workflows
                .iter()
                .position(|entry| workflow_matches(entry, &workflow))
                .ok_or_else(|| format!("Workflow \"{workflow}\" not found."))?;
            let mut entry = workflows[index].clone();
            let invocation = workflow_invocation(&entry);
            if !invocation
                .get("canRun")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return Err(invocation
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("Workflow cannot run.")
                    .to_string());
            }
            if entry
                .get("requiresApproval")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                && !input
                    .get("approved")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                return Err("workflow run requires approved=true".to_string());
            }
            let now = now_millis();
            let execution_id = format!("rust-workflow-{now}");
            let execution = json!({
                "executionId": execution_id,
                "localExecutionId": execution_id,
                "workflowId": workflow_id(&entry),
                "workflowName": workflow_name(&entry),
                "status": "running",
                "currentExecutor": "rust-native",
                "startedAt": now,
                "updatedAt": now,
                "inputs": input.get("inputs").cloned().unwrap_or(Value::Null),
                "originSessionKey": string_param(&input, &["sessionKey", "originSessionKey"])
            });
            let mut executions = load_workflow_executions(runtime_root)?;
            executions
                .get_mut("executions")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| "workflow execution store is invalid".to_string())?
                .push(execution.clone());
            save_workflow_executions(runtime_root, &executions)?;
            entry["lastRunAt"] = json!(now);
            entry["updatedAt"] = json!(now);
            workflows[index] = entry.clone();
            store["updatedAt"] = json!(now);
            save_workflow_store(runtime_root, &store)?;
            Ok(tool_envelope(
                "Workflow run started.",
                json!({
                    "status": "running",
                    "runId": execution_id,
                    "execution": workflow_execution_view(execution),
                    "workflow": workflow_view(entry),
                    "implementation": "rust-native"
                }),
                false,
            ))
        }
        "status" | "cancel" | "resume" => {
            let execution_id = required_param_string(
                "workflow",
                &input,
                &[
                    "executionId",
                    "runId",
                    "localExecutionId",
                    "n8nExecutionId",
                    "remoteExecutionId",
                ],
            )?;
            let mut executions = load_workflow_executions(runtime_root)?;
            let items = executions
                .get_mut("executions")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| "workflow execution store is invalid".to_string())?;
            let index = items
                .iter()
                .position(|execution| workflow_execution_matches(execution, &execution_id))
                .ok_or_else(|| format!("Workflow execution \"{execution_id}\" not found."))?;
            if action == "cancel" || action == "resume" {
                let now = now_millis();
                let execution = &mut items[index];
                if action == "cancel" {
                    execution["status"] = json!("cancelled");
                    execution["endedAt"] = json!(now);
                } else {
                    execution["status"] = json!("running");
                    execution["resumedAt"] = json!(now);
                    if let Some(resume_input) = input.get("resumeInput") {
                        execution["resumeInput"] = resume_input.clone();
                    }
                }
                execution["updatedAt"] = json!(now);
                save_workflow_executions(runtime_root, &executions)?;
            }
            let execution = executions
                .get("executions")
                .and_then(Value::as_array)
                .and_then(|items| items.get(index))
                .cloned()
                .ok_or_else(|| "workflow execution store is invalid".to_string())?;
            Ok(tool_envelope(
                "Workflow execution loaded.",
                json!({
                    "status": execution.get("status").and_then(Value::as_str).unwrap_or("unknown"),
                    "action": action,
                    "execution": workflow_execution_view(execution),
                    "implementation": "rust-native"
                }),
                false,
            ))
        }
        other => Err(format!("unsupported workflow action: {other}")),
    }
}

pub(super) fn workflow_matches(entry: &Value, needle: &str) -> bool {
    entry.get("workflowId").and_then(Value::as_str) == Some(needle)
        || entry.get("name").and_then(Value::as_str) == Some(needle)
}

pub(super) fn workflow_execution_matches(execution: &Value, needle: &str) -> bool {
    execution.get("executionId").and_then(Value::as_str) == Some(needle)
        || execution.get("localExecutionId").and_then(Value::as_str) == Some(needle)
        || execution.get("runId").and_then(Value::as_str) == Some(needle)
        || execution.get("n8nExecutionId").and_then(Value::as_str) == Some(needle)
        || execution.get("remoteExecutionId").and_then(Value::as_str) == Some(needle)
}
