use std::path::Path;

use serde_json::{json, Value};

use crate::models::{
    AutomationActionSummary, AutomationRuntimeMetric, AutomationRuntimeSummary,
    AutomationSectionError, AutomationTabRuntimeSummary, AutomationTabSummary,
    AutomationWorkspaceItem, DesktopState,
};

pub(crate) async fn refresh_automation_workspace_tabs(
    desktop_state: &mut DesktopState,
    runtime_root: &Path,
) {
    let runtimes = desktop_state.automation_workspace.runtimes.clone();
    desktop_state.automation_workspace.tabs = vec![
        build_comfyui_tab(runtime_root, runtime_by_id(&runtimes, "comfyui")).await,
        build_n8n_tab(runtime_root, runtime_by_id(&runtimes, "n8n")).await,
        build_cron_tab(runtime_root).await,
    ];
}

async fn build_comfyui_tab(
    runtime_root: &Path,
    runtime: Option<AutomationRuntimeSummary>,
) -> AutomationTabSummary {
    let mut errors = Vec::new();
    let workflows = comfyui_operation(runtime_root, "workflows-list", "workflows", "workflows", &mut errors)
        .await
        .into_iter()
        .map(comfyui_workflow_item)
        .collect::<Vec<_>>();
    let runs = comfyui_operation(runtime_root, "runs-list", "history", "runs", &mut errors).await;
    let active_runs = runs
        .iter()
        .filter(|run| is_active_status(value_string(run, "status").as_deref()))
        .cloned()
        .map(comfyui_run_item)
        .collect::<Vec<_>>();
    let history = runs.into_iter().map(comfyui_run_item).collect::<Vec<_>>();
    let artifacts = comfyui_operation(runtime_root, "outputs-list", "artifacts", "outputs", &mut errors)
        .await
        .into_iter()
        .map(comfyui_artifact_item)
        .collect::<Vec<_>>();

    AutomationTabSummary {
        kind: "comfyui".to_string(),
        title: "ComfyUI".to_string(),
        runtime: runtime
            .as_ref()
            .map(tab_runtime_from_managed)
            .unwrap_or_else(|| unavailable_runtime("comfyui", "ComfyUI")),
        active_runs,
        workflows,
        history,
        artifacts,
        available_actions: vec![
            action("workflows-list", "工作流", "comfyui_workflow", "workflows"),
            action("workflow-get", "详情", "comfyui_workflow", "workflows"),
            action("runs-list", "执行历史", "comfyui_workflow", "history"),
            action("outputs-list", "产物", "comfyui_workflow", "artifacts"),
            action("run", "执行", "comfyui_workflow", "activeRuns"),
            action("status", "状态", "comfyui_workflow", "activeRuns"),
            action("outputs", "下载产物", "comfyui_workflow", "artifacts"),
        ],
        errors,
    }
}

async fn build_n8n_tab(
    runtime_root: &Path,
    runtime: Option<AutomationRuntimeSummary>,
) -> AutomationTabSummary {
    let mut errors = Vec::new();
    let workflows = workflow_tool_items(runtime_root, json!({ "action": "list", "limit": 50 }), "workflows", "workflows", &mut errors)
        .await
        .into_iter()
        .map(n8n_workflow_item)
        .collect::<Vec<_>>();
    let runs = workflow_tool_items(runtime_root, json!({ "action": "runs", "limit": 50 }), "history", "runs", &mut errors).await;
    let active_runs = runs
        .iter()
        .filter(|run| is_active_status(value_string(run, "status").as_deref()))
        .cloned()
        .map(n8n_run_item)
        .collect::<Vec<_>>();
    let history = runs.iter().cloned().map(n8n_run_item).collect::<Vec<_>>();
    let artifacts = n8n_artifact_items(&runs);

    AutomationTabSummary {
        kind: "n8n".to_string(),
        title: "n8n".to_string(),
        runtime: runtime
            .as_ref()
            .map(tab_runtime_from_managed)
            .unwrap_or_else(|| unavailable_runtime("n8n", "n8n")),
        active_runs,
        workflows,
        history,
        artifacts,
        available_actions: vec![
            action("list", "工作流", "workflow", "workflows"),
            action("get", "详情", "workflow", "workflows"),
            action("runs", "执行历史", "workflow", "history"),
            action("run", "执行", "workflow", "activeRuns"),
            action("status", "状态", "workflow", "activeRuns"),
            action("cancel", "取消", "workflow", "activeRuns"),
            action("resume", "恢复", "workflow", "activeRuns"),
        ],
        errors,
    }
}

async fn build_cron_tab(runtime_root: &Path) -> AutomationTabSummary {
    let mut errors = Vec::new();
    let store_path = runtime_root.join("cron").join("jobs.json");
    let status = cron_operation(runtime_root, "cron.status", json!({ "storePath": store_path }), "activeRuns", &mut errors)
        .await
        .unwrap_or_else(|| json!({ "status": "idle", "jobs": 0, "running": 0 }));
    let jobs = cron_operation(
        runtime_root,
        "cron.list",
        json!({ "storePath": runtime_root.join("cron").join("jobs.json"), "status": "all", "limit": 50 }),
        "workflows",
        &mut errors,
    )
    .await
    .and_then(|value| value.get("jobs").and_then(Value::as_array).cloned())
    .unwrap_or_default();
    let runs = cron_operation(
        runtime_root,
        "cron.runs",
        json!({ "storePath": runtime_root.join("cron").join("jobs.json"), "scope": "all", "limit": 50 }),
        "history",
        &mut errors,
    )
    .await
    .and_then(|value| value.get("entries").and_then(Value::as_array).cloned())
    .unwrap_or_default();

    let active_runs = jobs
        .iter()
        .filter(|job| job.get("state").and_then(|state| state.get("runningAtMs")).is_some())
        .cloned()
        .map(cron_job_item)
        .collect::<Vec<_>>();
    let workflows = jobs.into_iter().map(cron_job_item).collect::<Vec<_>>();
    let history = runs.into_iter().map(cron_run_item).collect::<Vec<_>>();
    let runtime = AutomationTabRuntimeSummary {
        id: "cron".to_string(),
        name: "Cron".to_string(),
        status: if value_u64(&status, "running").unwrap_or(0) > 0 {
            "running".to_string()
        } else {
            "idle".to_string()
        },
        detail: "Gateway 内置定时任务调度器。".to_string(),
        base_url: None,
        health_status: Some(
            value_string(&status, "status").unwrap_or_else(|| "unknown".to_string()),
        ),
        process_id: None,
        log_path: None,
        metrics: vec![
            metric("Jobs", value_u64(&status, "jobs").unwrap_or(0).to_string()),
            metric("Running", value_u64(&status, "running").unwrap_or(0).to_string()),
            metric(
                "Next",
                value_string(&status, "nextRunAt")
                    .or_else(|| value_u64(&status, "nextRunAtMs").map(|value| value.to_string()))
                    .unwrap_or_else(|| "none".to_string()),
            ),
        ],
    };

    AutomationTabSummary {
        kind: "cron".to_string(),
        title: "Cron".to_string(),
        runtime,
        active_runs,
        workflows,
        history,
        artifacts: Vec::new(),
        available_actions: vec![
            action("cron.status", "状态", "cron", "activeRuns"),
            action("cron.list", "任务列表", "cron", "workflows"),
            action("cron.runs", "执行历史", "cron", "history"),
            action("cron.run", "立即执行", "cron", "activeRuns"),
            action("cron.add", "创建", "cron", "workflows"),
            action("cron.remove", "删除", "cron", "workflows"),
        ],
        errors,
    }
}

async fn comfyui_operation(
    runtime_root: &Path,
    operation: &str,
    section: &str,
    array_key: &str,
    errors: &mut Vec<AutomationSectionError>,
) -> Vec<Value> {
    let input = json!({
        "workspaceDir": runtime_root,
        "params": { "limit": 50 }
    });
    match crawclaw_native_plugins::comfyui::handle_comfyui(operation, input).await {
        Ok(value) => value
            .get(array_key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        Err(error) => {
            errors.push(section_error(section, error.to_string()));
            Vec::new()
        }
    }
}

async fn workflow_tool_items(
    runtime_root: &Path,
    input: Value,
    section: &str,
    array_key: &str,
    errors: &mut Vec<AutomationSectionError>,
) -> Vec<Value> {
    match crawclaw_runtime::execute_rust_core_tool(runtime_root, "workflow", input).await {
        Ok(value) => tool_details(&value)
            .and_then(|details| details.get(array_key))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        Err(error) => {
            errors.push(section_error(section, error));
            Vec::new()
        }
    }
}

async fn cron_operation(
    runtime_root: &Path,
    operation: &str,
    input: Value,
    section: &str,
    errors: &mut Vec<AutomationSectionError>,
) -> Option<Value> {
    match crawclaw_runtime::execute_cron_runtime_operation(runtime_root, operation, input).await {
        Ok(value) => Some(value),
        Err(error) => {
            errors.push(section_error(section, error));
            None
        }
    }
}

fn runtime_by_id(
    runtimes: &[AutomationRuntimeSummary],
    runtime_id: &str,
) -> Option<AutomationRuntimeSummary> {
    runtimes
        .iter()
        .find(|runtime| runtime.id == runtime_id)
        .cloned()
}

fn tab_runtime_from_managed(runtime: &AutomationRuntimeSummary) -> AutomationTabRuntimeSummary {
    AutomationTabRuntimeSummary {
        id: runtime.id.clone(),
        name: runtime.name.clone(),
        status: runtime.status.clone(),
        detail: runtime.detail.clone(),
        base_url: Some(runtime.base_url.clone()),
        health_status: runtime.health_status.clone(),
        process_id: runtime.process_id,
        log_path: runtime.log_path.clone(),
        metrics: vec![
            metric("Runtime", runtime.runtime.clone()),
            metric("Mode", runtime.mode.clone()),
            metric("Install", runtime.install.channel.clone()),
        ],
    }
}

fn unavailable_runtime(id: &str, name: &str) -> AutomationTabRuntimeSummary {
    AutomationTabRuntimeSummary {
        id: id.to_string(),
        name: name.to_string(),
        status: "unavailable".to_string(),
        detail: "等待本机 Gateway 返回自动化状态。".to_string(),
        base_url: None,
        health_status: None,
        process_id: None,
        log_path: None,
        metrics: Vec::new(),
    }
}

fn comfyui_workflow_item(value: Value) -> AutomationWorkspaceItem {
    let workflow_id = value_string(&value, "workflowId").unwrap_or_else(|| "workflow".to_string());
    AutomationWorkspaceItem {
        id: workflow_id.clone(),
        title: value_string(&value, "goal").unwrap_or_else(|| workflow_id.clone()),
        status: "ready".to_string(),
        detail: format!(
            "{} output(s)",
            value_u64(&value, "outputCount").unwrap_or(0)
        ),
        kind: value_string(&value, "mediaKind"),
        workflow_id: Some(workflow_id),
        run_id: value_string(&value, "promptId"),
        path: value
            .get("paths")
            .and_then(|paths| paths.get("metaPath"))
            .and_then(json_path_string),
        started_at: value_string(&value, "createdAt"),
        updated_at: value_string(&value, "updatedAt"),
    }
}

fn comfyui_run_item(value: Value) -> AutomationWorkspaceItem {
    let prompt_id = value_string(&value, "promptId").unwrap_or_else(|| "prompt".to_string());
    let workflow_id = value_string(&value, "workflowId");
    AutomationWorkspaceItem {
        id: prompt_id.clone(),
        title: workflow_id
            .clone()
            .unwrap_or_else(|| format!("Prompt {prompt_id}")),
        status: value_string(&value, "status").unwrap_or_else(|| "unknown".to_string()),
        detail: output_count_detail(&value),
        kind: Some("comfyui-run".to_string()),
        workflow_id,
        run_id: Some(prompt_id),
        path: None,
        started_at: value_string(&value, "startedAt"),
        updated_at: value_string(&value, "completedAt").or_else(|| value_string(&value, "startedAt")),
    }
}

fn comfyui_artifact_item(value: Value) -> AutomationWorkspaceItem {
    let path = value_string(&value, "localPath");
    let filename = value_string(&value, "filename")
        .or_else(|| path.clone())
        .unwrap_or_else(|| "output".to_string());
    AutomationWorkspaceItem {
        id: path.clone().unwrap_or_else(|| filename.clone()),
        title: filename,
        status: value_string(&value, "status").unwrap_or_else(|| "ready".to_string()),
        detail: value_string(&value, "promptId").unwrap_or_else(|| "ComfyUI output".to_string()),
        kind: value_string(&value, "type").or_else(|| Some("output".to_string())),
        workflow_id: value_string(&value, "workflowId"),
        run_id: value_string(&value, "promptId"),
        path,
        started_at: value_string(&value, "createdAt"),
        updated_at: value_string(&value, "createdAt"),
    }
}

fn n8n_workflow_item(value: Value) -> AutomationWorkspaceItem {
    let workflow_id = value_string(&value, "workflowId").unwrap_or_else(|| "workflow".to_string());
    AutomationWorkspaceItem {
        id: workflow_id.clone(),
        title: value_string(&value, "name")
            .or_else(|| value_string(&value, "goal"))
            .unwrap_or_else(|| workflow_id.clone()),
        status: value_string(&value, "deploymentState").unwrap_or_else(|| {
            if value_bool(&value, "enabled").unwrap_or(false) {
                "enabled".to_string()
            } else {
                "disabled".to_string()
            }
        }),
        detail: value_string(&value, "description")
            .or_else(|| value_string(&value, "n8nWorkflowId"))
            .unwrap_or_else(|| "Workflow registry entry".to_string()),
        kind: value_string(&value, "target").or_else(|| Some("workflow".to_string())),
        workflow_id: Some(workflow_id),
        run_id: value_string(&value, "n8nWorkflowId"),
        path: None,
        started_at: value_u64(&value, "createdAt").map(|value| value.to_string()),
        updated_at: value_u64(&value, "updatedAt").map(|value| value.to_string()),
    }
}

fn n8n_run_item(value: Value) -> AutomationWorkspaceItem {
    let run_id = value_string(&value, "executionId")
        .or_else(|| value_string(&value, "localExecutionId"))
        .or_else(|| value_string(&value, "runId"))
        .unwrap_or_else(|| "execution".to_string());
    AutomationWorkspaceItem {
        id: run_id.clone(),
        title: value_string(&value, "workflowName").unwrap_or_else(|| run_id.clone()),
        status: value_string(&value, "status").unwrap_or_else(|| "unknown".to_string()),
        detail: value_string(&value, "currentExecutor")
            .or_else(|| value_string(&value, "source"))
            .unwrap_or_else(|| "workflow execution".to_string()),
        kind: Some("n8n-execution".to_string()),
        workflow_id: value_string(&value, "workflowId"),
        run_id: Some(run_id),
        path: None,
        started_at: value_u64(&value, "startedAt").map(|value| value.to_string()),
        updated_at: value_u64(&value, "updatedAt").map(|value| value.to_string()),
    }
}

fn n8n_artifact_items(runs: &[Value]) -> Vec<AutomationWorkspaceItem> {
    let mut items = Vec::new();
    for run in runs {
        let run_id = value_string(run, "executionId")
            .or_else(|| value_string(run, "localExecutionId"))
            .or_else(|| value_string(run, "runId"));
        for key in ["artifacts", "outputs"] {
            for artifact in run
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let path = value_string(artifact, "path").or_else(|| value_string(artifact, "localPath"));
                let id = value_string(artifact, "id")
                    .or_else(|| path.clone())
                    .unwrap_or_else(|| format!("{}-artifact", run_id.as_deref().unwrap_or("run")));
                items.push(AutomationWorkspaceItem {
                    id,
                    title: value_string(artifact, "title")
                        .or_else(|| value_string(artifact, "label"))
                        .or_else(|| path.clone())
                        .unwrap_or_else(|| "Workflow artifact".to_string()),
                    status: value_string(artifact, "status").unwrap_or_else(|| "ready".to_string()),
                    detail: run_id
                        .clone()
                        .unwrap_or_else(|| "workflow execution output".to_string()),
                    kind: value_string(artifact, "kind").or_else(|| Some(key.to_string())),
                    workflow_id: value_string(run, "workflowId"),
                    run_id: run_id.clone(),
                    path,
                    started_at: value_u64(run, "startedAt").map(|value| value.to_string()),
                    updated_at: value_u64(run, "updatedAt").map(|value| value.to_string()),
                });
            }
        }
    }
    items
}

fn cron_job_item(value: Value) -> AutomationWorkspaceItem {
    let id = value_string(&value, "id").unwrap_or_else(|| "cron-job".to_string());
    let state = value.get("state").unwrap_or(&Value::Null);
    let status = if state.get("runningAtMs").is_some() {
        "running".to_string()
    } else if value_bool(&value, "enabled").unwrap_or(true) {
        "scheduled".to_string()
    } else {
        "disabled".to_string()
    };
    AutomationWorkspaceItem {
        id: id.clone(),
        title: value_string(&value, "name").unwrap_or_else(|| id.clone()),
        status,
        detail: cron_schedule_detail(&value),
        kind: Some("cron-job".to_string()),
        workflow_id: Some(id),
        run_id: value_string(state, "lastRunStatus"),
        path: None,
        started_at: value_u64(&value, "createdAtMs").map(|value| value.to_string()),
        updated_at: value_u64(&value, "updatedAtMs")
            .or_else(|| value_u64(state, "lastRunAtMs"))
            .map(|value| value.to_string()),
    }
}

fn cron_run_item(value: Value) -> AutomationWorkspaceItem {
    let run_id = value_string(&value, "runId")
        .or_else(|| value_u64(&value, "ts").map(|value| value.to_string()))
        .unwrap_or_else(|| "cron-run".to_string());
    AutomationWorkspaceItem {
        id: run_id.clone(),
        title: value_string(&value, "jobId").unwrap_or_else(|| "Cron run".to_string()),
        status: value_string(&value, "status").unwrap_or_else(|| "unknown".to_string()),
        detail: value_string(&value, "summary")
            .or_else(|| value_string(&value, "error"))
            .unwrap_or_else(|| value_string(&value, "action").unwrap_or_else(|| "run".to_string())),
        kind: Some("cron-run".to_string()),
        workflow_id: value_string(&value, "jobId"),
        run_id: Some(run_id),
        path: None,
        started_at: value_u64(&value, "runAtMs")
            .or_else(|| value_u64(&value, "ts"))
            .map(|value| value.to_string()),
        updated_at: value_u64(&value, "ts").map(|value| value.to_string()),
    }
}

fn tool_details(value: &Value) -> Option<&Value> {
    value.get("details").or(Some(value))
}

fn is_active_status(status: Option<&str>) -> bool {
    matches!(status, Some("running" | "queued" | "pending"))
}

fn output_count_detail(value: &Value) -> String {
    let count = value
        .get("outputs")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    if count == 0 {
        "No outputs recorded".to_string()
    } else {
        format!("{count} output(s)")
    }
}

fn cron_schedule_detail(value: &Value) -> String {
    let schedule = value.get("schedule").unwrap_or(&Value::Null);
    match value_string(schedule, "kind").as_deref() {
        Some("every") => value_string(schedule, "everyMs")
            .map(|every_ms| format!("Every {every_ms} ms"))
            .unwrap_or_else(|| "Recurring schedule".to_string()),
        Some("cron") => value_string(schedule, "expr")
            .map(|expr| format!("Cron {expr}"))
            .unwrap_or_else(|| "Cron expression".to_string()),
        Some("at") => value_string(schedule, "at")
            .or_else(|| value_string(schedule, "atMs"))
            .map(|at| format!("At {at}"))
            .unwrap_or_else(|| "One-shot schedule".to_string()),
        _ => "Scheduled job".to_string(),
    }
}

fn metric(label: impl Into<String>, value: impl Into<String>) -> AutomationRuntimeMetric {
    AutomationRuntimeMetric {
        label: label.into(),
        value: value.into(),
    }
}

fn action(id: &str, label: &str, tool: &str, section: &str) -> AutomationActionSummary {
    AutomationActionSummary {
        id: id.to_string(),
        label: label.to_string(),
        tool: tool.to_string(),
        section: section.to_string(),
    }
}

fn section_error(section: &str, detail: impl Into<String>) -> AutomationSectionError {
    AutomationSectionError {
        section: section.to_string(),
        detail: detail.into(),
    }
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(json_path_string)
}

fn json_path_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) if !value.trim().is_empty() => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn value_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn value_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}
