use super::*;

const TASK_OUTPUT_MAX_DEFAULT: usize = 32_000;
const TASK_OUTPUT_MAX_UPPER_LIMIT: usize = 160_000;

#[derive(Clone)]
pub(super) struct ProcessTool {
    registry: Arc<ProcessRegistry>,
}

impl ProcessTool {
    pub(super) fn new(registry: Arc<ProcessRegistry>) -> Self {
        Self { registry }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProcessInput {
    action: String,
    session_id: Option<String>,
    data: Option<String>,
    keys: Option<Vec<String>>,
    literal: Option<String>,
    text: Option<String>,
    eof: Option<bool>,
    timeout: Option<Value>,
}

#[async_trait]
impl pi::sdk::Tool for ProcessTool {
    fn name(&self) -> &str {
        "process"
    }

    fn label(&self) -> &str {
        "process"
    }

    fn description(&self) -> &str {
        "Manage running bash sessions: list, poll, log, write, send-keys, submit, paste, kill, clear, remove."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Process action: list, poll, log, write, send-keys, submit, paste, kill, clear, remove"
                },
                "sessionId": {
                    "type": "string",
                    "description": "Session id for actions other than list"
                },
                "data": {
                    "type": "string",
                    "description": "Data to write"
                },
                "keys": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Key tokens for send-keys"
                },
                "literal": {
                    "type": "string",
                    "description": "Literal text for send-keys"
                },
                "text": {
                    "type": "string",
                    "description": "Text to paste"
                },
                "eof": {
                    "type": "boolean",
                    "description": "Close stdin after write"
                },
                "timeout": {
                    "type": "integer",
                    "description": "For poll: wait up to this many milliseconds before returning"
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: ProcessInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        match input.action.as_str() {
            "list" => Ok(self.list()),
            "poll" => self.poll(&required_session_id(&input)?, poll_timeout(&input.timeout)),
            "log" => self.log(&required_session_id(&input)?),
            "write" => self.write(
                &required_session_id(&input)?,
                input.data.unwrap_or_default(),
                input.eof == Some(true),
            ),
            "send-keys" => self.write(
                &required_session_id(&input)?,
                encode_key_tokens(input.literal, input.keys)?,
                false,
            ),
            "submit" => self.write(&required_session_id(&input)?, "\n".to_string(), false),
            "paste" => self.write(
                &required_session_id(&input)?,
                input.text.unwrap_or_default(),
                false,
            ),
            "kill" => self.kill(&required_session_id(&input)?),
            "clear" | "remove" => Ok(self.remove(&required_session_id(&input)?)),
            action => Ok(text_output(
                format!("Unknown action {action}"),
                Some(json!({ "status": "failed" })),
                true,
            )),
        }
    }
}

impl ProcessTool {
    fn list(&self) -> pi::sdk::ToolOutput {
        let mut lines = Vec::new();
        for session in self.registry.list_running() {
            let snapshot = snapshot_session(&session);
            let status = if snapshot.exited {
                "completed"
            } else {
                "running"
            };
            lines.push(format!(
                "{} {:9} {} :: {}",
                snapshot.id,
                status,
                format_duration(now_millis().saturating_sub(snapshot.started_at)),
                snapshot.command
            ));
        }
        for finished in self.registry.list_finished() {
            lines.push(format!(
                "{} {:9} {} :: {}",
                finished.id,
                status_text(finished.status),
                format_duration(finished.ended_at.saturating_sub(finished.started_at)),
                finished.command
            ));
        }
        text_output(
            if lines.is_empty() {
                "No running or recent sessions.".to_string()
            } else {
                lines.join("\n")
            },
            Some(json!({ "status": "completed" })),
            false,
        )
    }

    fn poll(&self, session_id: &str, timeout: Duration) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        if let Some(session) = self.registry.running(session_id) {
            if !session.lock().expect("session").backgrounded {
                return Ok(text_output(
                    format!("Session {session_id} is not backgrounded."),
                    Some(json!({ "status": "failed" })),
                    true,
                ));
            }
            wait_for_session(&session, timeout);
            thread::sleep(Duration::from_millis(20));
            let output = drain_pending(&session);
            let snapshot = snapshot_session(&session);
            if snapshot.exited {
                let status = if snapshot.exit_code == Some(0) && snapshot.exit_signal.is_none() {
                    "completed"
                } else {
                    "failed"
                };
                let text = if output.is_empty() {
                    snapshot.tail.clone()
                } else {
                    output
                };
                let text = format!(
                    "{}\n\nProcess exited with {}.",
                    if text.is_empty() {
                        "(no output)"
                    } else {
                        text.as_str()
                    },
                    snapshot.exit_signal.as_ref().map_or_else(
                        || format!("code {}", snapshot.exit_code.unwrap_or(0)),
                        |signal| { format!("signal {signal}") }
                    )
                );
                self.registry.finish_if_exited(session_id);
                return Ok(text_output(
                    text,
                    Some(json!({
                        "status": status,
                        "sessionId": session_id,
                        "exitCode": snapshot.exit_code,
                        "exitSignal": snapshot.exit_signal,
                        "aggregated": snapshot.aggregated,
                    })),
                    status == "failed",
                ));
            }
            return Ok(text_output(
                format!(
                    "{}\n\nProcess still running.",
                    if output.is_empty() {
                        "(no new output)"
                    } else {
                        output.as_str()
                    }
                ),
                Some(json!({
                    "status": "running",
                    "sessionId": session_id,
                    "aggregated": snapshot.aggregated,
                })),
                false,
            ));
        }

        if let Some(finished) = self.registry.finished(session_id) {
            let status = status_text(finished.status);
            return Ok(text_output(
                format!(
                    "{}\n\nProcess exited with {}.",
                    if finished.tail.is_empty() {
                        "(no output recorded)"
                    } else {
                        finished.tail.as_str()
                    },
                    finished.exit_signal.as_ref().map_or_else(
                        || format!("code {}", finished.exit_code.unwrap_or(0)),
                        |signal| { format!("signal {signal}") }
                    )
                ),
                Some(json!({
                    "status": status,
                    "sessionId": session_id,
                    "exitCode": finished.exit_code,
                    "exitSignal": finished.exit_signal,
                    "aggregated": finished.aggregated,
                })),
                status == "failed",
            ));
        }

        Ok(text_output(
            format!("No session found for {session_id}"),
            Some(json!({ "status": "failed" })),
            true,
        ))
    }

    fn log(&self, session_id: &str) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        if let Some(session) = self.registry.running(session_id) {
            let snapshot = snapshot_session(&session);
            let status = if snapshot.exited {
                "completed"
            } else {
                "running"
            };
            return Ok(text_output(
                if snapshot.aggregated.is_empty() {
                    "(no output yet)".to_string()
                } else {
                    snapshot.aggregated
                },
                Some(json!({
                    "status": status,
                    "sessionId": session_id,
                    "truncated": snapshot.truncated,
                    "outputPath": snapshot.output_path.as_ref().map(|path| path.to_string_lossy().to_string()),
                    "persistedOutputPath": snapshot.output_path.as_ref().map(|path| path.to_string_lossy().to_string()),
                })),
                false,
            ));
        }
        if let Some(finished) = self.registry.finished(session_id) {
            return Ok(text_output(
                if finished.aggregated.is_empty() {
                    "(no output recorded)".to_string()
                } else {
                    finished.aggregated.clone()
                },
                Some(json!({
                    "status": status_text(finished.status),
                    "sessionId": session_id,
                    "truncated": finished.truncated,
                    "outputPath": finished.output_path.as_ref().map(|path| path.to_string_lossy().to_string()),
                    "persistedOutputPath": finished.output_path.as_ref().map(|path| path.to_string_lossy().to_string()),
                })),
                false,
            ));
        }
        Ok(text_output(
            format!("No session found for {session_id}"),
            Some(json!({ "status": "failed" })),
            true,
        ))
    }

    fn write(
        &self,
        session_id: &str,
        data: String,
        close_stdin: bool,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let Some(session) = self.registry.running(session_id) else {
            return Ok(text_output(
                format!("No active session found for {session_id}"),
                Some(json!({ "status": "failed" })),
                true,
            ));
        };
        let stdin = session.lock().expect("session").stdin.clone();
        let Some(stdin) = stdin else {
            return Ok(text_output(
                format!("Session {session_id} stdin is not writable."),
                Some(json!({ "status": "failed" })),
                true,
            ));
        };
        let mut stdin = stdin.lock().expect("stdin");
        stdin
            .write_all(data.as_bytes())
            .map_err(|error| tool_error("process", format!("Failed to write stdin: {error}")))?;
        if close_stdin {
            let _ = stdin.flush();
            drop(stdin);
            session.lock().expect("session").stdin = None;
        }
        Ok(text_output(
            format!("Wrote {} bytes to session {session_id}.", data.len()),
            Some(json!({ "status": "running", "sessionId": session_id })),
            false,
        ))
    }

    fn kill(&self, session_id: &str) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let Some(session) = self.registry.running(session_id) else {
            return Ok(text_output(
                format!("No active session found for {session_id}"),
                Some(json!({ "status": "failed" })),
                true,
            ));
        };
        let child = Arc::clone(&session.lock().expect("session").child);
        child
            .lock()
            .expect("child process")
            .kill()
            .map_err(|error| tool_error("process", format!("Failed to kill process: {error}")))?;
        Ok(text_output(
            format!("Killed session {session_id}."),
            Some(json!({ "status": "failed", "sessionId": session_id })),
            true,
        ))
    }

    fn remove(&self, session_id: &str) -> pi::sdk::ToolOutput {
        if let Some(session) = self.registry.running(session_id) {
            let child = Arc::clone(&session.lock().expect("session").child);
            let _ = child.lock().expect("child process").kill();
        }
        self.registry.delete(session_id);
        text_output(
            format!("Removed session {session_id}."),
            Some(json!({ "status": "completed" })),
            false,
        )
    }
}

#[derive(Clone)]
pub(super) struct TaskOutputTool {
    runtime_root: PathBuf,
    registry: Arc<ProcessRegistry>,
}

impl TaskOutputTool {
    pub(super) fn new(runtime_root: &Path, registry: Arc<ProcessRegistry>) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            registry,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskOutputInput {
    #[serde(rename = "task_id")]
    task_id: Option<String>,
    block: Option<Value>,
    timeout: Option<Value>,
}

#[async_trait]
impl pi::sdk::Tool for TaskOutputTool {
    fn name(&self) -> &str {
        "TaskOutput"
    }

    fn label(&self) -> &str {
        "TaskOutput"
    }

    fn description(&self) -> &str {
        "[Deprecated] — prefer Read on the task output file path"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The task ID to get output from"
                },
                "block": {
                    "type": "boolean",
                    "description": "Whether to wait for completion"
                },
                "timeout": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 600000,
                    "description": "Max wait time in ms"
                }
            },
            "required": ["task_id"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: TaskOutputInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        let task_id = input
            .task_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| pi::sdk::Error::validation("Task ID is required"))?;
        let block = optional_task_output_bool(input.block.as_ref(), "block")?.unwrap_or(true);
        let timeout = task_timeout_millis(&input.timeout)?;
        if let Some(output) = task_output_for_process(&self.registry, &task_id, block, timeout) {
            return Ok(output);
        }
        task_output_for_session(&self.runtime_root, &task_id, block, timeout)
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

#[derive(Clone)]
pub(super) struct TaskStopTool {
    runtime_root: PathBuf,
    registry: Arc<ProcessRegistry>,
}

impl TaskStopTool {
    pub(super) fn new(runtime_root: &Path, registry: Arc<ProcessRegistry>) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            registry,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskStopInput {
    task_id: Option<String>,
    shell_id: Option<String>,
}

#[async_trait]
impl pi::sdk::Tool for TaskStopTool {
    fn name(&self) -> &str {
        "TaskStop"
    }

    fn label(&self) -> &str {
        "TaskStop"
    }

    fn description(&self) -> &str {
        "Stop a running background task by ID"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The ID of the background task to stop"
                },
                "shell_id": {
                    "type": "string",
                    "description": "Deprecated: use task_id instead"
                }
            },
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: TaskStopInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        let task_id = input
            .task_id
            .or(input.shell_id)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| pi::sdk::Error::validation("Missing required parameter: task_id"))?;
        if let Some(session) = self.registry.running(&task_id) {
            let snapshot = snapshot_session(&session);
            let child = Arc::clone(&session.lock().expect("session").child);
            child
                .lock()
                .expect("child process")
                .kill()
                .map_err(|error| {
                    tool_error(
                        "TaskStop",
                        format!("Failed to stop task {task_id}: {error}"),
                    )
                })?;
            let details = json!({
                    "message": format!("Successfully stopped task: {task_id} ({})", snapshot.command),
                    "task_id": task_id,
                    "task_type": "local_bash",
                    "command": snapshot.command,
                    "source": "rust-native"
            });
            let text = serde_json::to_string(&details).unwrap_or_else(|_| "{}".to_string());
            return Ok(native_tool_output(tool_envelope(text, details, false)));
        }
        if abort_runtime_agent_task(&task_id) {
            let store = DesktopSessionStore::new(self.runtime_root.clone());
            let session = store
                .patch_session(&task_id, None, None, None, Some("cancelled"))
                .map_err(|error| tool_error("TaskStop", error.to_string()))?;
            let details = json!({
                    "message": format!("Successfully stopped task: {task_id} ({})", session.title),
                    "task_id": task_id,
                    "task_type": "local_agent",
                    "command": session.title,
                    "source": "rust-native"
            });
            let text = serde_json::to_string(&details).unwrap_or_else(|_| "{}".to_string());
            return Ok(native_tool_output(tool_envelope(text, details, false)));
        }
        if let Some(finished) = self.registry.finished(&task_id) {
            let status = status_text(finished.status);
            return Ok(text_output(
                format!("Task {task_id} is not running (status: {status})"),
                Some(json!({ "status": "failed", "task_id": task_id, "task_status": status })),
                true,
            ));
        }
        if let Some(session) = DesktopSessionStore::new(self.runtime_root.clone())
            .session_status(&task_id)
            .map_err(|error| tool_error("TaskStop", error.to_string()))?
        {
            if session.status != "running" {
                return Ok(text_output(
                    format!("Task {task_id} is not running (status: {})", session.status),
                    Some(json!({
                        "status": "failed",
                        "task_id": task_id,
                        "task_status": session.status
                    })),
                    true,
                ));
            }
        }
        Ok(text_output(
            format!("No task found with ID: {task_id}"),
            Some(json!({ "status": "failed", "task_id": task_id })),
            true,
        ))
    }
}

fn task_timeout_millis(value: &Option<Value>) -> pi::sdk::Result<Duration> {
    let Some(value) = value else {
        return Ok(Duration::from_millis(30_000));
    };
    let Some(number) = value.as_f64() else {
        return Err(pi::sdk::Error::validation(
            "timeout must be a number between 0 and 600000.",
        ));
    };
    if !(0.0..=600_000.0).contains(&number) {
        return Err(pi::sdk::Error::validation(
            "timeout must be a number between 0 and 600000.",
        ));
    }
    Ok(Duration::from_millis(number.floor() as u64))
}

fn optional_task_output_bool(value: Option<&Value>, name: &str) -> pi::sdk::Result<Option<bool>> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    if let Some(boolean) = value.as_bool() {
        return Ok(Some(boolean));
    }
    if let Some(text) = value.as_str() {
        return match text {
            "true" => Ok(Some(true)),
            "false" => Ok(Some(false)),
            _ => Err(pi::sdk::Error::validation(format!(
                "{name} must be true or false."
            ))),
        };
    }
    Err(pi::sdk::Error::validation(format!(
        "{name} must be true or false."
    )))
}

fn task_output_for_process(
    registry: &Arc<ProcessRegistry>,
    task_id: &str,
    block: bool,
    timeout: Duration,
) -> Option<pi::sdk::ToolOutput> {
    if let Some(session) = registry.running(task_id) {
        if block {
            wait_for_session(&session, timeout);
            thread::sleep(Duration::from_millis(20));
        }
        let snapshot = snapshot_session(&session);
        if snapshot.exited {
            registry.finish_if_exited(task_id);
            return Some(task_output_envelope(
                "success",
                Some(process_task_value_from_snapshot(&snapshot)),
            ));
        }
        let retrieval_status = if block { "timeout" } else { "not_ready" };
        return Some(task_output_envelope(
            retrieval_status,
            Some(process_task_value_from_snapshot(&snapshot)),
        ));
    }
    registry.finished(task_id).map(|finished| {
        task_output_envelope("success", Some(process_task_value_from_finished(&finished)))
    })
}

fn task_output_for_session(
    runtime_root: &Path,
    task_id: &str,
    block: bool,
    timeout: Duration,
) -> pi::sdk::Result<pi::sdk::ToolOutput> {
    let store = DesktopSessionStore::new(runtime_root.to_path_buf());
    let Some(mut session) = store
        .session_status(task_id)
        .map_err(|error| tool_error("TaskOutput", error.to_string()))?
    else {
        return Ok(text_output(
            format!("No task found with ID: {task_id}"),
            Some(json!({ "status": "failed", "task_id": task_id })),
            true,
        ));
    };
    if block {
        let start = Instant::now();
        while task_session_is_active(&session.status) && start.elapsed() < timeout {
            thread::sleep(Duration::from_millis(100));
            if let Some(next) = store
                .session_status(task_id)
                .map_err(|error| tool_error("TaskOutput", error.to_string()))?
            {
                session = next;
            } else {
                break;
            }
        }
    }
    let retrieval_status = if task_session_is_active(&session.status) {
        if block {
            "timeout"
        } else {
            "not_ready"
        }
    } else {
        "success"
    };
    let history = store
        .session_history(task_id)
        .map_err(|error| tool_error("TaskOutput", error.to_string()))?;
    let transcript_output = history
        .iter()
        .map(|message| format!("{}: {}", message.role, message.content))
        .collect::<Vec<_>>()
        .join("\n\n");
    let prompt = history
        .iter()
        .find(|message| message.role == "user")
        .map(|message| message.content.clone());
    let result = history
        .iter()
        .rev()
        .find(|message| message.role == "assistant")
        .map(|message| message.content.clone());
    let output = result.clone().unwrap_or(transcript_output);
    let output_path = store
        .session_transcript_path(task_id)
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    Ok(task_output_envelope(
        retrieval_status,
        Some(json!({
            "task_id": session.key,
            "task_type": "local_agent",
            "status": session.status,
            "description": session.title,
            "output": output,
            "outputPath": output_path.clone(),
            "persistedOutputPath": output_path,
            "prompt": prompt,
            "result": result,
        })),
    ))
}

fn task_session_is_active(status: &str) -> bool {
    matches!(status, "pending" | "running" | "spawned")
}

fn process_task_value_from_snapshot(snapshot: &SessionSnapshot) -> Value {
    let status = if snapshot.exited {
        if snapshot.exit_code == Some(0) && snapshot.exit_signal.is_none() {
            "completed"
        } else {
            "failed"
        }
    } else {
        "running"
    };
    let mut task = json!({
        "task_id": snapshot.id,
        "task_type": "local_bash",
        "status": status,
        "description": snapshot.command,
        "output": snapshot.aggregated,
        "stdout": snapshot.stdout,
        "stderr": snapshot.stderr,
        "dangerouslyDisableSandbox": snapshot.dangerously_disable_sandbox,
        "outputPath": snapshot.output_path.as_ref().map(|path| path.to_string_lossy().to_string()),
        "persistedOutputPath": snapshot.output_path.as_ref().map(|path| path.to_string_lossy().to_string()),
        "exitCode": snapshot.exit_code,
        "error": snapshot.exit_signal,
    });
    if snapshot.dangerously_disable_sandbox.is_none() {
        task.as_object_mut()
            .expect("process task value is an object")
            .remove("dangerouslyDisableSandbox");
    }
    task
}

fn process_task_value_from_finished(finished: &FinishedProcessSession) -> Value {
    let mut task = json!({
        "task_id": finished.id,
        "task_type": "local_bash",
        "status": status_text(finished.status),
        "description": finished.command,
        "output": finished.aggregated,
        "stdout": finished.stdout,
        "stderr": finished.stderr,
        "dangerouslyDisableSandbox": finished.dangerously_disable_sandbox,
        "outputPath": finished.output_path.as_ref().map(|path| path.to_string_lossy().to_string()),
        "persistedOutputPath": finished.output_path.as_ref().map(|path| path.to_string_lossy().to_string()),
        "exitCode": finished.exit_code,
        "error": finished.exit_signal,
    });
    if finished.dangerously_disable_sandbox.is_none() {
        task.as_object_mut()
            .expect("process task value is an object")
            .remove("dangerouslyDisableSandbox");
    }
    task
}

fn task_output_envelope(retrieval_status: &str, task: Option<Value>) -> pi::sdk::ToolOutput {
    let mut parts = vec![format!(
        "<retrieval_status>{retrieval_status}</retrieval_status>"
    )];
    if let Some(task) = task.as_ref() {
        push_task_output_part(&mut parts, task, "task_id", "task_id");
        push_task_output_part(&mut parts, task, "task_type", "task_type");
        push_task_output_part(&mut parts, task, "status", "status");
        if let Some(exit_code) = task.get("exitCode").and_then(Value::as_i64) {
            parts.push(format!("<exit_code>{exit_code}</exit_code>"));
        }
        if let Some(output) = task.get("output").and_then(Value::as_str) {
            if !output.trim().is_empty() {
                parts.push(format!(
                    "<output>\n{}\n</output>",
                    format_task_output_for_model(task, output).trim_end()
                ));
            }
        }
        if let Some(error) = task.get("error").and_then(Value::as_str) {
            if !error.trim().is_empty() {
                parts.push(format!("<error>{error}</error>"));
            }
        }
    }
    text_output(
        parts.join("\n\n"),
        Some(json!({
            "retrieval_status": retrieval_status,
            "task": task,
            "source": "rust-native"
        })),
        false,
    )
}

fn format_task_output_for_model(task: &Value, output: &str) -> String {
    let max_len = task_output_max_len();
    if output.len() <= max_len {
        return output.to_string();
    }
    let Some(output_path) = task_output_file_path(task) else {
        return tail(output, max_len);
    };
    let header = format!("[Truncated. Full output: {output_path}]\n\n");
    let available = max_len.saturating_sub(header.len());
    if available == 0 {
        return header;
    }
    format!("{header}{}", tail(output, available))
}

fn task_output_file_path(task: &Value) -> Option<&str> {
    task.get("persistedOutputPath")
        .and_then(Value::as_str)
        .or_else(|| task.get("outputPath").and_then(Value::as_str))
        .filter(|path| !path.is_empty())
}

fn task_output_max_len() -> usize {
    match std::env::var("TASK_MAX_OUTPUT_LENGTH")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
    {
        Some(value) if value > TASK_OUTPUT_MAX_UPPER_LIMIT => TASK_OUTPUT_MAX_UPPER_LIMIT,
        Some(value) if value > 0 => value,
        _ => TASK_OUTPUT_MAX_DEFAULT,
    }
}

fn push_task_output_part(parts: &mut Vec<String>, task: &Value, key: &str, tag: &str) {
    if let Some(value) = task.get(key).and_then(Value::as_str) {
        parts.push(format!("<{tag}>{value}</{tag}>"));
    }
}

pub(super) fn required_session_id(input: &ProcessInput) -> pi::sdk::Result<String> {
    input
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| pi::sdk::Error::validation("sessionId is required for this action."))
}

pub(super) fn encode_key_tokens(
    literal: Option<String>,
    keys: Option<Vec<String>>,
) -> pi::sdk::Result<String> {
    if let Some(literal) = literal {
        if !literal.is_empty() {
            return Ok(literal);
        }
    }
    let Some(keys) = keys else {
        return Err(pi::sdk::Error::validation("No key data provided."));
    };
    let mut encoded = String::new();
    for key in keys {
        let normalized = key.trim().to_ascii_lowercase();
        let sequence = match normalized.as_str() {
            "enter" | "return" => "\r",
            "tab" => "\t",
            "escape" | "esc" => "\u{1b}",
            "backspace" => "\u{7f}",
            "ctrl-c" | "control-c" => "\u{3}",
            "ctrl-d" | "control-d" => "\u{4}",
            "up" => "\u{1b}[A",
            "down" => "\u{1b}[B",
            "right" => "\u{1b}[C",
            "left" => "\u{1b}[D",
            "" => "",
            _ => {
                return Err(pi::sdk::Error::validation(format!(
                    "Unsupported key token: {key}"
                )));
            }
        };
        encoded.push_str(sequence);
    }
    if encoded.is_empty() {
        return Err(pi::sdk::Error::validation("No key data provided."));
    }
    Ok(encoded)
}

pub(super) fn poll_timeout(value: &Option<Value>) -> Duration {
    let millis = match value {
        Some(Value::Number(number)) => number.as_u64().unwrap_or(0),
        Some(Value::String(value)) => value.trim().parse::<u64>().unwrap_or(0),
        _ => 0,
    };
    Duration::from_millis(millis.min(120_000))
}

pub(super) fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(super) fn tail(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let start = char_boundary_at_or_after(text, text.len() - max);
    text[start..].to_string()
}

pub(super) fn char_boundary_at_or_after(text: &str, mut index: usize) -> usize {
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

pub(super) fn status_text(status: ProcessStatus) -> &'static str {
    match status {
        ProcessStatus::Completed => "completed",
        ProcessStatus::Failed => "failed",
    }
}

pub(super) fn format_duration(millis: u128) -> String {
    if millis < 1000 {
        format!("{millis}ms")
    } else {
        format!("{:.1}s", millis as f64 / 1000.0)
    }
}
