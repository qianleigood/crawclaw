use super::*;

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
