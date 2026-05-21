use super::*;

pub(super) fn workflow_mutation(
    state: &GatewayState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow"])?;
    let root = workflow_store_root(state, &params);
    let mut registry = read_workflow_registry(&root)?;
    let Some(index) = registry
        .get("workflows")
        .and_then(Value::as_array)
        .ok_or_else(|| "invalid workflow registry".to_string())?
        .iter()
        .position(|entry| workflow_matches_ref(entry, &workflow))
    else {
        return Err(format!("Workflow \"{workflow}\" not found."));
    };

    let now = now_millis() as u64;
    if method == "workflow.delete" {
        let removed = registry
            .get_mut("workflows")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "invalid workflow registry".to_string())?
            .remove(index);
        let workflow_id = workflow_id(&removed);
        registry["updatedAt"] = json!(now);
        write_workflow_registry(&root, &registry)?;
        let mut execution_store = read_workflow_executions_store(&root)?;
        let mut removed_executions = 0;
        if let Some(executions) = execution_store
            .get_mut("executions")
            .and_then(Value::as_array_mut)
        {
            let before = executions.len();
            executions.retain(|execution| {
                execution.get("workflowId").and_then(Value::as_str) != Some(workflow_id.as_str())
            });
            removed_executions = before.saturating_sub(executions.len());
        }
        if removed_executions > 0 {
            execution_store["updatedAt"] = json!(now);
            write_workflow_executions_store(&root, &execution_store)?;
        }
        return Ok(json!({
            "agentId": workflow_agent_id(&params),
            "deleted": true,
            "workflowId": workflow_id,
            "removedExecutions": removed_executions
        }));
    }

    let workflow = {
        let workflows = registry
            .get_mut("workflows")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "invalid workflow registry".to_string())?;
        let entry = workflows
            .get_mut(index)
            .ok_or_else(|| "workflow entry disappeared".to_string())?;
        match method {
            "workflow.enable" => {
                entry["enabled"] = json!(true);
            }
            "workflow.disable" => {
                entry["enabled"] = json!(false);
            }
            "workflow.archive" => {
                entry["enabled"] = json!(false);
                entry["archivedAt"] = json!(now);
            }
            "workflow.unarchive" => {
                if let Some(object) = entry.as_object_mut() {
                    object.remove("archivedAt");
                }
            }
            "workflow.deploy" => {
                let _ = workflow_require_n8n_base_url(state)?;
                entry["deploymentState"] = json!("deployed");
                let next_version = entry
                    .get("deploymentVersion")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    + 1;
                entry["deploymentVersion"] = json!(next_version);
                let n8n_id = string_param(&params, &["n8nWorkflowId", "remoteWorkflowId"])
                    .or_else(|| {
                        entry
                            .get("n8nWorkflowId")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned)
                    })
                    .unwrap_or_else(|| format!("rust-{}", workflow_id(entry)));
                entry["n8nWorkflowId"] = Value::String(n8n_id);
            }
            _ => {}
        }
        entry["updatedAt"] = json!(now);
        entry.clone()
    };
    registry["updatedAt"] = json!(now);
    write_workflow_registry(&root, &registry)?;
    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "workflow": workflow_with_invocation(workflow)
    }))
}

pub(super) fn workflow_run(state: &GatewayState, params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow"])?;
    let n8n_base_url = workflow_require_n8n_base_url(state)?;
    let root = workflow_store_root(state, &params);
    let mut registry = read_workflow_registry(&root)?;
    let Some(entry) = find_workflow_entry(&workflow_entries(&registry), &workflow) else {
        return Err(format!("Workflow \"{workflow}\" not found."));
    };
    workflow_ensure_runnable(&root, &entry, &workflow, &params)?;
    let workflow_id = workflow_id(&entry);
    let workflow_name = workflow_name(&entry);
    let n8n_workflow_id = entry
        .get("n8nWorkflowId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let now = now_millis() as u64;
    let execution_id = format!("rust-workflow-{now}");
    let execution = json!({
        "executionId": execution_id,
        "workflowId": workflow_id,
        "workflowName": workflow_name,
        "n8nWorkflowId": n8n_workflow_id,
        "n8nBaseUrl": n8n_base_url,
        "status": "running",
        "currentExecutor": "n8n",
        "startedAt": now,
        "updatedAt": now,
        "inputs": params.get("inputs").cloned().unwrap_or(Value::Null),
        "originSessionKey": string_param(&params, &["sessionKey", "originSessionKey"]),
        "originAgentId": workflow_agent_id(&params)
    });
    let mut execution_store = read_workflow_executions_store(&root)?;
    execution_store["updatedAt"] = json!(now);
    execution_store
        .get_mut("executions")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "invalid workflow execution store".to_string())?
        .push(execution.clone());
    write_workflow_executions_store(&root, &execution_store)?;

    if let Some(workflows) = registry.get_mut("workflows").and_then(Value::as_array_mut) {
        if let Some(workflow_entry) = workflows
            .iter_mut()
            .find(|entry| workflow_matches_ref(entry, &workflow_id))
        {
            workflow_entry["lastRunAt"] = json!(now);
            workflow_entry["updatedAt"] = json!(now);
            registry["updatedAt"] = json!(now);
            write_workflow_registry(&root, &registry)?;
        }
    }

    let execution_view = workflow_execution_view(execution.clone());
    let result = json!({
        "agentId": workflow_agent_id(&params),
        "workflow": workflow_with_invocation(entry),
        "execution": execution_view,
        "localExecution": execution
    });
    emit(state, "workflow.run", result.clone());
    Ok(result)
}

pub(super) fn workflow_ensure_runnable(
    root: &std::path::Path,
    entry: &Value,
    workflow_ref: &str,
    params: &Value,
) -> Result<(), String> {
    if entry.get("archivedAt").is_some() {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is archived and cannot run."
        ));
    }
    if !entry
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is disabled and cannot run."
        ));
    }
    if entry
        .get("deploymentState")
        .and_then(Value::as_str)
        .unwrap_or("draft")
        != "deployed"
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is not currently deployed. Run workflow.deploy or workflow.republish first."
        ));
    }
    if entry
        .get("n8nWorkflowId")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
        == false
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is missing its n8n workflow id. Run workflow.republish before running it."
        ));
    }
    let workflow_id = workflow_id(entry);
    let spec_path = workflow_spec_path(root, &workflow_id);
    if !spec_path.exists() {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is missing its workflow spec and cannot run."
        ));
    }
    let spec = read_json_file(&spec_path)?;
    if !spec.is_object()
        || spec
            .as_object()
            .map(|object| object.is_empty())
            .unwrap_or(true)
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" is missing its workflow spec and cannot run."
        ));
    }
    if entry
        .get("requiresApproval")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && params.get("approved").and_then(Value::as_bool) != Some(true)
    {
        return Err(format!(
            "Workflow \"{workflow_ref}\" requires explicit approval before running."
        ));
    }
    let invocation = workflow_invocation(entry);
    if !invocation
        .get("canRun")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let reason = invocation
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("not runnable");
        return Err(format!("Workflow \"{workflow_ref}\" cannot run: {reason}."));
    }
    Ok(())
}

pub(super) fn workflow_agent_run(state: &GatewayState, params: Value) -> Result<Value, String> {
    let workflow = required_param(&params, &["workflow", "workflowId"])?;
    let execution_id = required_param(&params, &["executionId"])?;
    let step_id = required_param(&params, &["stepId"])?;
    let goal = required_param(&params, &["goal", "message", "task"])?;
    let root = workflow_store_root(state, &params);
    let registry = read_workflow_registry(&root)?;
    let entry = find_workflow_entry(&workflow_entries(&registry), &workflow)
        .ok_or_else(|| format!("workflow not found: {workflow}"))?;

    let mut store = read_workflow_executions_store(&root)?;
    let execution_index = store
        .get("executions")
        .and_then(Value::as_array)
        .and_then(|executions| {
            executions
                .iter()
                .position(|execution| workflow_execution_matches_ref(execution, &execution_id))
        })
        .ok_or_else(|| format!("workflow execution not found: {execution_id}"))?;

    let parent = string_param(&params, &["parentSessionKey", "sessionKey", "key"])
        .unwrap_or_else(|| "main".to_string());
    let label = format!("Workflow: {} / {step_id}", workflow_name(&entry));
    let session = state
        .session_store
        .spawn_session(Some(&parent), Some(&label), &goal)
        .map_err(|error| error.to_string())?;
    let session_key = session.key.clone();
    let now = now_millis() as u64;
    let execution = {
        let executions = store
            .get_mut("executions")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "invalid workflow execution store".to_string())?;
        let execution = executions
            .get_mut(execution_index)
            .ok_or_else(|| "workflow execution disappeared".to_string())?;
        workflow_update_agent_step(execution, &step_id, &goal, &session_key, now)?;
        workflow_execution_view(execution.clone())
    };
    store["updatedAt"] = json!(now);
    write_workflow_executions_store(&root, &store)?;

    let result = json!({
        "status": "running",
        "summary": format!("Workflow step \"{step_id}\" is running in Rust Gateway session {session_key}."),
        "sessionKey": session_key
    });
    let payload = json!({
        "ok": true,
        "status": "running",
        "result": result,
        "workflow": workflow_with_invocation(entry),
        "execution": execution,
        "session": session,
        "implementation": "rust-native"
    });
    emit(state, "workflow.agent.run", payload.clone());
    Ok(payload)
}

pub(super) fn workflow_execution_matches_ref(execution: &Value, execution_ref: &str) -> bool {
    [
        execution.get("executionId"),
        execution.get("localExecutionId"),
        execution.get("n8nExecutionId"),
        execution.get("remoteExecutionId"),
        execution
            .get("remote")
            .and_then(|remote| remote.get("executionId")),
    ]
    .into_iter()
    .flatten()
    .any(|value| value.as_str() == Some(execution_ref))
}

pub(super) fn workflow_update_agent_step(
    execution: &mut Value,
    step_id: &str,
    goal: &str,
    session_key: &str,
    now: u64,
) -> Result<(), String> {
    let execution_object = execution
        .as_object_mut()
        .ok_or_else(|| "invalid workflow execution record".to_string())?;
    execution_object.insert("status".to_string(), Value::String("running".to_string()));
    execution_object.insert(
        "currentStepId".to_string(),
        Value::String(step_id.to_string()),
    );
    execution_object.insert(
        "currentExecutor".to_string(),
        Value::String("crawclaw_agent".to_string()),
    );
    execution_object.insert("updatedAt".to_string(), json!(now));
    execution_object.remove("endedAt");
    execution_object.remove("finishedAt");
    if !execution_object
        .get("steps")
        .map(Value::is_array)
        .unwrap_or(false)
    {
        execution_object.insert("steps".to_string(), Value::Array(Vec::new()));
    }
    let steps = execution_object
        .get_mut("steps")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "invalid workflow execution steps".to_string())?;
    let step_index = steps
        .iter()
        .position(|step| step.get("stepId").and_then(Value::as_str) == Some(step_id));
    let step = if let Some(index) = step_index {
        steps
            .get_mut(index)
            .ok_or_else(|| "workflow step disappeared".to_string())?
    } else {
        steps.push(json!({ "stepId": step_id, "title": goal }));
        steps
            .last_mut()
            .ok_or_else(|| "workflow step was not created".to_string())?
    };
    let step_object = step
        .as_object_mut()
        .ok_or_else(|| "invalid workflow execution step".to_string())?;
    if step_object.get("title").is_none() {
        step_object.insert("title".to_string(), Value::String(goal.to_string()));
    }
    if step_object.get("startedAt").is_none() {
        step_object.insert("startedAt".to_string(), json!(now));
    }
    step_object.insert("status".to_string(), Value::String("running".to_string()));
    step_object.insert(
        "executor".to_string(),
        Value::String("crawclaw_agent".to_string()),
    );
    step_object.insert(
        "sessionKey".to_string(),
        Value::String(session_key.to_string()),
    );
    step_object.insert("runId".to_string(), Value::String(session_key.to_string()));
    step_object.insert("updatedAt".to_string(), json!(now));
    Ok(())
}

pub(super) fn workflow_execution_action(
    state: &GatewayState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let execution_id = required_param(&params, &["executionId"])?;
    let n8n_base_url = workflow_require_n8n_base_url(state)?;
    let root = workflow_store_root(state, &params);
    let mut store = read_workflow_executions_store(&root)?;
    let now = now_millis() as u64;
    let mut found = Value::Null;
    let mut changed = false;

    if let Some(executions) = store.get_mut("executions").and_then(Value::as_array_mut) {
        if let Some(execution) = executions.iter_mut().find(|execution| {
            execution.get("executionId").and_then(Value::as_str) == Some(execution_id.as_str())
                || execution.get("n8nExecutionId").and_then(Value::as_str)
                    == Some(execution_id.as_str())
        }) {
            match method {
                "workflow.cancel" => {
                    execution["status"] = json!("cancelled");
                    execution["endedAt"] = json!(now);
                    execution["updatedAt"] = json!(now);
                    changed = true;
                }
                "workflow.resume" => {
                    execution["status"] = json!("running");
                    execution["updatedAt"] = json!(now);
                    changed = true;
                }
                _ => {}
            }
            found = workflow_execution_view(execution.clone());
            if let Some(object) = found.as_object_mut() {
                object.insert(
                    "n8nBaseUrl".to_string(),
                    Value::String(n8n_base_url.clone()),
                );
            }
        }
    }

    if changed {
        store["updatedAt"] = json!(now);
        write_workflow_executions_store(&root, &store)?;
    }

    if !found.is_null() {
        let mut result = json!({
            "agentId": workflow_agent_id(&params),
            "execution": found
        });
        if method == "workflow.resume" {
            result["resumeAccepted"] = json!(true);
        }
        return Ok(result);
    }

    Ok(json!({
        "agentId": workflow_agent_id(&params),
        "execution": {
            "executionId": execution_id,
            "status": "not_found",
            "startedAt": Value::Null,
            "finishedAt": Value::Null
        }
    }))
}

pub(super) fn read_json_object_file(path: PathBuf) -> Result<Map<String, Value>, String> {
    match read_config_value(&path)? {
        Value::Object(object) => Ok(object),
        _ => Err(format!("expected JSON object in {}", path.display())),
    }
}
