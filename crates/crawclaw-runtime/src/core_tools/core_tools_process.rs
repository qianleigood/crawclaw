use super::*;

#[derive(Clone)]
pub(super) struct BashTool {
    pub(super) cwd: PathBuf,
    pub(super) registry: Arc<ProcessRegistry>,
}

impl BashTool {
    pub(super) fn new(cwd: &Path, registry: Arc<ProcessRegistry>) -> Self {
        Self {
            cwd: cwd.to_path_buf(),
            registry,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BashInput {
    pub(super) command: String,
    pub(super) timeout: Option<u64>,
    pub(super) background: Option<bool>,
    pub(super) yield_ms: Option<u64>,
}

#[async_trait]
impl pi::sdk::Tool for BashTool {
    fn name(&self) -> &str {
        "bash"
    }

    fn label(&self) -> &str {
        "bash"
    }

    fn description(&self) -> &str {
        "Execute shell commands with background continuation. Use yieldMs/background to continue later via process tool."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds. Foreground commands default to 120 seconds; background commands have no default timeout."
                },
                "yieldMs": {
                    "type": "integer",
                    "description": "Milliseconds to wait before backgrounding"
                },
                "background": {
                    "type": "boolean",
                    "description": "Run in background immediately"
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: BashInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        if input.command.trim().is_empty() {
            return Err(pi::sdk::Error::validation("Provide a command to start."));
        }

        let background = input.background == Some(true);
        let yield_ms = input.yield_ms;
        let timeout = if background || yield_ms.is_some() {
            input.timeout
        } else {
            Some(input.timeout.unwrap_or(120))
        };
        let session = start_shell_session(&self.registry, &self.cwd, input.command, timeout)?;

        if background || yield_ms == Some(0) {
            mark_session_backgrounded(&session);
            return Ok(running_session_output(&session));
        }

        if let Some(yield_ms) = yield_ms {
            wait_for_session(&session, Duration::from_millis(yield_ms));
            if !session.lock().expect("session").exited {
                mark_session_backgrounded(&session);
                return Ok(running_session_output(&session));
            }
        } else {
            wait_for_session(&session, Duration::from_secs(timeout.unwrap_or(120) + 5));
        }

        let snapshot = snapshot_session(&session);
        self.registry.delete(&snapshot.id);
        Ok(completed_bash_output(&snapshot))
    }
}

#[derive(Default)]
pub(super) struct ProcessRegistry {
    pub(super) next_id: AtomicU64,
    pub(super) inner: Mutex<ProcessRegistryInner>,
}

#[derive(Default)]
pub(super) struct ProcessRegistryInner {
    pub(super) running: HashMap<String, Arc<Mutex<ProcessSession>>>,
    pub(super) finished: HashMap<String, FinishedProcessSession>,
}

pub(super) struct ProcessSession {
    pub(super) id: String,
    pub(super) command: String,
    pub(super) cwd: String,
    pub(super) pid: u32,
    pub(super) started_at: u128,
    pub(super) pending_stdout: String,
    pub(super) pending_stderr: String,
    pub(super) aggregated: String,
    pub(super) tail: String,
    pub(super) exit_code: Option<i32>,
    pub(super) exit_signal: Option<String>,
    pub(super) exited: bool,
    pub(super) backgrounded: bool,
    pub(super) truncated: bool,
    pub(super) child: Arc<Mutex<Child>>,
    pub(super) stdin: Option<Arc<Mutex<ChildStdin>>>,
}

#[derive(Clone)]
pub(super) struct FinishedProcessSession {
    pub(super) id: String,
    pub(super) command: String,
    pub(super) started_at: u128,
    pub(super) ended_at: u128,
    pub(super) status: ProcessStatus,
    pub(super) exit_code: Option<i32>,
    pub(super) exit_signal: Option<String>,
    pub(super) aggregated: String,
    pub(super) tail: String,
    pub(super) truncated: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ProcessStatus {
    Completed,
    Failed,
}

impl ProcessRegistry {
    fn next_session_id(&self) -> String {
        let next = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        format!("bash-{}-{next}", now_millis())
    }

    fn add(&self, session: Arc<Mutex<ProcessSession>>) {
        let id = session.lock().expect("session").id.clone();
        self.inner
            .lock()
            .expect("process registry")
            .running
            .insert(id, session);
    }

    pub(super) fn running(&self, session_id: &str) -> Option<Arc<Mutex<ProcessSession>>> {
        self.inner
            .lock()
            .expect("process registry")
            .running
            .get(session_id)
            .cloned()
    }

    pub(super) fn finished(&self, session_id: &str) -> Option<FinishedProcessSession> {
        self.inner
            .lock()
            .expect("process registry")
            .finished
            .get(session_id)
            .cloned()
    }

    pub(super) fn list_running(&self) -> Vec<Arc<Mutex<ProcessSession>>> {
        self.inner
            .lock()
            .expect("process registry")
            .running
            .values()
            .cloned()
            .collect()
    }

    pub(super) fn list_finished(&self) -> Vec<FinishedProcessSession> {
        self.inner
            .lock()
            .expect("process registry")
            .finished
            .values()
            .cloned()
            .collect()
    }

    pub(super) fn delete(&self, session_id: &str) {
        let mut inner = self.inner.lock().expect("process registry");
        inner.running.remove(session_id);
        inner.finished.remove(session_id);
    }

    pub(super) fn finish_if_exited(&self, session_id: &str) -> Option<FinishedProcessSession> {
        let session = self.running(session_id)?;
        let snapshot = snapshot_session(&session);
        if !snapshot.exited || !snapshot.backgrounded {
            return None;
        }
        let status = if snapshot.exit_code == Some(0) && snapshot.exit_signal.is_none() {
            ProcessStatus::Completed
        } else {
            ProcessStatus::Failed
        };
        let finished = FinishedProcessSession {
            id: snapshot.id.clone(),
            command: snapshot.command,
            started_at: snapshot.started_at,
            ended_at: now_millis(),
            status,
            exit_code: snapshot.exit_code,
            exit_signal: snapshot.exit_signal,
            aggregated: snapshot.aggregated,
            tail: snapshot.tail,
            truncated: snapshot.truncated,
        };
        let mut inner = self.inner.lock().expect("process registry");
        inner.running.remove(session_id);
        inner
            .finished
            .insert(session_id.to_string(), finished.clone());
        Some(finished)
    }
}

pub(super) struct SessionSnapshot {
    pub(super) id: String,
    pub(super) command: String,
    pub(super) cwd: String,
    pub(super) pid: u32,
    pub(super) started_at: u128,
    pub(super) aggregated: String,
    pub(super) tail: String,
    pub(super) exit_code: Option<i32>,
    pub(super) exit_signal: Option<String>,
    pub(super) exited: bool,
    pub(super) backgrounded: bool,
    pub(super) truncated: bool,
}

pub(super) fn start_shell_session(
    registry: &Arc<ProcessRegistry>,
    cwd: &Path,
    command: String,
    timeout: Option<u64>,
) -> pi::sdk::Result<Arc<Mutex<ProcessSession>>> {
    let shell = resolve_shell();
    let mut child = Command::new(shell)
        .arg("-lc")
        .arg(&command)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| tool_error("bash", format!("Failed to spawn shell: {error}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| tool_error("bash", "Missing stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| tool_error("bash", "Missing stderr"))?;
    let stdin = child.stdin.take().map(|stdin| Arc::new(Mutex::new(stdin)));
    let pid = child.id();
    let child = Arc::new(Mutex::new(child));
    let id = registry.next_session_id();
    let session = Arc::new(Mutex::new(ProcessSession {
        id: id.clone(),
        command,
        cwd: cwd.to_string_lossy().to_string(),
        pid,
        started_at: now_millis(),
        pending_stdout: String::new(),
        pending_stderr: String::new(),
        aggregated: String::new(),
        tail: String::new(),
        exit_code: None,
        exit_signal: None,
        exited: false,
        backgrounded: false,
        truncated: false,
        child: Arc::clone(&child),
        stdin,
    }));
    registry.add(Arc::clone(&session));
    spawn_output_reader(Arc::clone(&session), stdout, true);
    spawn_output_reader(Arc::clone(&session), stderr, false);
    spawn_waiter(Arc::clone(&session), child, timeout);
    Ok(session)
}

pub(super) fn resolve_shell() -> &'static str {
    for candidate in ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"] {
        if Path::new(candidate).exists() {
            return candidate;
        }
    }
    "sh"
}

pub(super) fn spawn_output_reader(
    session: Arc<Mutex<ProcessSession>>,
    mut reader: impl Read + Send + 'static,
    stdout: bool,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let text = String::from_utf8_lossy(&buffer[..count]).to_string();
                    append_output(&session, &text, stdout);
                }
                Err(_) => break,
            }
        }
    });
}

pub(super) fn spawn_waiter(
    session: Arc<Mutex<ProcessSession>>,
    child: Arc<Mutex<Child>>,
    timeout: Option<u64>,
) {
    thread::spawn(move || {
        let deadline = timeout.map(|seconds| Instant::now() + Duration::from_secs(seconds));
        loop {
            let status = {
                let mut child = child.lock().expect("child process");
                match child.try_wait() {
                    Ok(status) => status,
                    Err(error) => {
                        mark_runtime_exit(&session, format!("Failed to wait for process: {error}"));
                        return;
                    }
                }
            };
            if let Some(status) = status {
                mark_status_exit(&session, status);
                return;
            }
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                let _ = child.lock().expect("child process").kill();
                mark_timeout_exit(&session);
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
    });
}

pub(super) fn append_output(session: &Arc<Mutex<ProcessSession>>, text: &str, stdout: bool) {
    const MAX_OUTPUT: usize = 1_000_000;
    let mut session = session.lock().expect("session");
    if stdout {
        session.pending_stdout.push_str(text);
    } else {
        session.pending_stderr.push_str(text);
    }
    session.aggregated.push_str(text);
    if session.aggregated.len() > MAX_OUTPUT {
        let keep_from =
            char_boundary_at_or_after(&session.aggregated, session.aggregated.len() - MAX_OUTPUT);
        session.aggregated = session.aggregated[keep_from..].to_string();
        session.truncated = true;
    }
    session.tail = tail(&session.aggregated, 2000);
}

pub(super) fn mark_status_exit(session: &Arc<Mutex<ProcessSession>>, status: ExitStatus) {
    let mut session = session.lock().expect("session");
    session.exited = true;
    session.exit_code = status.code();
    session.exit_signal = exit_signal(&status);
}

pub(super) fn mark_timeout_exit(session: &Arc<Mutex<ProcessSession>>) {
    let mut session = session.lock().expect("session");
    session.exited = true;
    session.exit_code = None;
    session.exit_signal = Some("timeout".to_string());
}

pub(super) fn mark_runtime_exit(session: &Arc<Mutex<ProcessSession>>, message: String) {
    append_output(session, &message, false);
    let mut session = session.lock().expect("session");
    session.exited = true;
    session.exit_code = None;
    session.exit_signal = Some("runtime-error".to_string());
}

#[cfg(unix)]
pub(super) fn exit_signal(status: &ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt as _;
    status.signal().map(|signal| signal.to_string())
}

#[cfg(not(unix))]
pub(super) fn exit_signal(_status: &ExitStatus) -> Option<String> {
    None
}

pub(super) fn mark_session_backgrounded(session: &Arc<Mutex<ProcessSession>>) {
    session.lock().expect("session").backgrounded = true;
}

pub(super) fn wait_for_session(session: &Arc<Mutex<ProcessSession>>, duration: Duration) {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if session.lock().expect("session").exited {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

pub(super) fn snapshot_session(session: &Arc<Mutex<ProcessSession>>) -> SessionSnapshot {
    let session = session.lock().expect("session");
    SessionSnapshot {
        id: session.id.clone(),
        command: session.command.clone(),
        cwd: session.cwd.clone(),
        pid: session.pid,
        started_at: session.started_at,
        aggregated: session.aggregated.clone(),
        tail: session.tail.clone(),
        exit_code: session.exit_code,
        exit_signal: session.exit_signal.clone(),
        exited: session.exited,
        backgrounded: session.backgrounded,
        truncated: session.truncated,
    }
}

pub(super) fn drain_pending(session: &Arc<Mutex<ProcessSession>>) -> String {
    let mut session = session.lock().expect("session");
    let output = [
        session.pending_stdout.trim_end(),
        session.pending_stderr.trim_end(),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    session.pending_stdout.clear();
    session.pending_stderr.clear();
    output
}

pub(super) fn running_session_output(session: &Arc<Mutex<ProcessSession>>) -> pi::sdk::ToolOutput {
    let snapshot = snapshot_session(session);
    text_output(
        format!(
            "Command still running (session {}, pid {}). Use process (list/poll/log/write/kill/clear/remove) for follow-up.",
            snapshot.id, snapshot.pid
        ),
        Some(json!({
            "status": "running",
            "sessionId": snapshot.id,
            "pid": snapshot.pid,
            "startedAt": snapshot.started_at,
            "cwd": snapshot.cwd,
            "tail": snapshot.tail,
        })),
        false,
    )
}

pub(super) fn completed_bash_output(snapshot: &SessionSnapshot) -> pi::sdk::ToolOutput {
    let status = if snapshot.exit_code == Some(0) && snapshot.exit_signal.is_none() {
        "completed"
    } else {
        "failed"
    };
    let text = if snapshot.aggregated.trim().is_empty() {
        "(no output)".to_string()
    } else {
        snapshot.aggregated.clone()
    };
    text_output(
        text,
        Some(json!({
            "status": status,
            "exitCode": snapshot.exit_code,
            "exitSignal": snapshot.exit_signal,
            "aggregated": snapshot.aggregated,
            "cwd": snapshot.cwd,
        })),
        status == "failed",
    )
}
