use super::*;

#[derive(Clone)]
pub(super) struct BashTool {
    pub(super) cwd: PathBuf,
    pub(super) registry: Arc<ProcessRegistry>,
}

#[derive(Clone)]
pub(super) struct PowerShellTool {
    pub(super) cwd: PathBuf,
    pub(super) registry: Arc<ProcessRegistry>,
}

const DEFAULT_SHELL_TIMEOUT_MS: u64 = 120_000;
const MAX_SHELL_TIMEOUT_MS: u64 = 600_000;
const SHELL_MAX_OUTPUT_DEFAULT: usize = 30_000;
const SHELL_MAX_OUTPUT_UPPER_LIMIT: usize = 150_000;
const FOREGROUND_WAIT_GRACE_MS: u64 = 5_000;

#[derive(Clone, Copy)]
pub(super) struct ShellCommandInterpretation {
    pub(super) is_error: bool,
    pub(super) message: Option<&'static str>,
}

impl BashTool {
    pub(super) fn new(cwd: &Path, registry: Arc<ProcessRegistry>) -> Self {
        Self {
            cwd: cwd.to_path_buf(),
            registry,
        }
    }
}

impl PowerShellTool {
    pub(super) fn new(cwd: &Path, registry: Arc<ProcessRegistry>) -> Self {
        Self {
            cwd: cwd.to_path_buf(),
            registry,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BashInput {
    pub(super) command: String,
    pub(super) timeout: Option<Value>,
    #[serde(rename = "description")]
    pub(super) _description: Option<String>,
    pub(super) run_in_background: Option<Value>,
    #[serde(rename = "dangerouslyDisableSandbox")]
    pub(super) dangerously_disable_sandbox: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PowerShellInput {
    pub(super) command: String,
    pub(super) timeout: Option<Value>,
    #[serde(rename = "description")]
    pub(super) _description: Option<String>,
    pub(super) run_in_background: Option<Value>,
    #[serde(rename = "dangerouslyDisableSandbox")]
    pub(super) dangerously_disable_sandbox: Option<Value>,
}

fn optional_semantic_bool(value: Option<&Value>, name: &str) -> pi::sdk::Result<Option<bool>> {
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

fn optional_semantic_u64(value: Option<&Value>, name: &str) -> pi::sdk::Result<Option<u64>> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    if let Some(number) = value.as_u64() {
        return Ok(Some(number));
    }
    if let Some(number) = value.as_i64() {
        if number >= 0 {
            return Ok(Some(number as u64));
        }
    }
    if let Some(text) = value.as_str() {
        let text = text.trim();
        if !text.is_empty() && text.chars().all(|ch| ch.is_ascii_digit()) {
            return text
                .parse::<u64>()
                .map(Some)
                .map_err(|_| pi::sdk::Error::validation(format!("{name} is too large.")));
        }
    }
    Err(pi::sdk::Error::validation(format!(
        "{name} must be a nonnegative integer."
    )))
}

fn optional_semantic_timeout_ms(value: Option<&Value>) -> pi::sdk::Result<Option<u64>> {
    let timeout = optional_semantic_u64(value, "timeout")?;
    if timeout.is_some_and(|millis| millis > MAX_SHELL_TIMEOUT_MS) {
        return Err(pi::sdk::Error::validation(format!(
            "timeout must be less than or equal to {MAX_SHELL_TIMEOUT_MS}."
        )));
    }
    Ok(timeout)
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
        "Run shell command"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The command to execute"
                },
                "timeout": {
                    "type": "number",
                    "maximum": 600000,
                    "description": "Optional timeout in milliseconds (max 600000)"
                },
                "description": {
                    "type": "string",
                    "description": "Clear, concise description of what this command does in active voice. Never use words like \"complex\" or \"risk\" in the description - just describe what it does."
                },
                "run_in_background": {
                    "type": "boolean",
                    "description": "Set to true to run this command in the background. Use Read to read the output later."
                },
                "dangerouslyDisableSandbox": {
                    "type": "boolean",
                    "description": "Set this to true to dangerously override sandbox mode and run commands without sandboxing."
                }
            },
            "required": ["command"],
            "additionalProperties": false
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

        let background =
            optional_semantic_bool(input.run_in_background.as_ref(), "run_in_background")?
                == Some(true);
        let dangerously_disable_sandbox = optional_semantic_bool(
            input.dangerously_disable_sandbox.as_ref(),
            "dangerouslyDisableSandbox",
        )?;
        let yield_ms: Option<u64> = None;
        let input_timeout = optional_semantic_timeout_ms(input.timeout.as_ref())?;
        if !background && yield_ms.is_none() {
            if let Some(pattern) = detect_blocked_bash_sleep_pattern(&input.command) {
                return Err(pi::sdk::Error::validation(format!(
                    "Blocked: {pattern}. Run blocking commands in the background with run_in_background: true — you'll get a completion notification when done. For streaming events (watching logs, polling APIs), use the Monitor tool. If you genuinely need a delay (rate limiting, deliberate pacing), keep it under 2 seconds."
                )));
            }
        }
        let timeout = if background || yield_ms.is_some() {
            input_timeout
        } else {
            Some(input_timeout.unwrap_or(DEFAULT_SHELL_TIMEOUT_MS))
        };
        let session = start_shell_session(
            &self.registry,
            &self.cwd,
            input.command,
            timeout,
            dangerously_disable_sandbox,
        )?;

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
            wait_for_session(
                &session,
                Duration::from_millis(
                    timeout
                        .unwrap_or(DEFAULT_SHELL_TIMEOUT_MS)
                        .saturating_add(FOREGROUND_WAIT_GRACE_MS),
                ),
            );
        }

        let snapshot = snapshot_session(&session);
        self.registry.delete(&snapshot.id);
        Ok(completed_bash_output(&snapshot))
    }
}

#[async_trait]
impl pi::sdk::Tool for PowerShellTool {
    fn name(&self) -> &str {
        "PowerShell"
    }

    fn label(&self) -> &str {
        "PowerShell"
    }

    fn description(&self) -> &str {
        "Run PowerShell command"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The PowerShell command to execute"
                },
                "timeout": {
                    "type": "number",
                    "maximum": 600000,
                    "description": "Optional timeout in milliseconds (max 600000)"
                },
                "description": {
                    "type": "string",
                    "description": "Clear, concise description of what this command does in active voice."
                },
                "run_in_background": {
                    "type": "boolean",
                    "description": "Set to true to run this command in the background. Use Read to read the output later."
                },
                "dangerouslyDisableSandbox": {
                    "type": "boolean",
                    "description": "Set this to true to dangerously override sandbox mode and run commands without sandboxing."
                }
            },
            "required": ["command"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: PowerShellInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        if input.command.trim().is_empty() {
            return Err(pi::sdk::Error::validation(
                "Provide a PowerShell command to start.",
            ));
        }

        let background =
            optional_semantic_bool(input.run_in_background.as_ref(), "run_in_background")?
                == Some(true);
        let dangerously_disable_sandbox = optional_semantic_bool(
            input.dangerously_disable_sandbox.as_ref(),
            "dangerouslyDisableSandbox",
        )?;
        let yield_ms: Option<u64> = None;
        let input_timeout = optional_semantic_timeout_ms(input.timeout.as_ref())?;
        if !background && yield_ms.is_none() {
            if let Some(pattern) = detect_blocked_powershell_sleep_pattern(&input.command) {
                return Err(pi::sdk::Error::validation(format!(
                    "Blocked: {pattern}. Run blocking commands in the background with run_in_background: true — you'll get a completion notification when done. For streaming events (watching logs, polling APIs), use the Monitor tool. If you genuinely need a delay (rate limiting, deliberate pacing), keep it under 2 seconds."
                )));
            }
        }
        let timeout = if background || yield_ms.is_some() {
            input_timeout
        } else {
            Some(input_timeout.unwrap_or(DEFAULT_SHELL_TIMEOUT_MS))
        };
        let session = start_powershell_session(
            &self.registry,
            &self.cwd,
            input.command,
            timeout,
            dangerously_disable_sandbox,
        )?;

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
            wait_for_session(
                &session,
                Duration::from_millis(
                    timeout
                        .unwrap_or(DEFAULT_SHELL_TIMEOUT_MS)
                        .saturating_add(FOREGROUND_WAIT_GRACE_MS),
                ),
            );
        }

        let snapshot = snapshot_session(&session);
        self.registry.delete(&snapshot.id);
        Ok(completed_powershell_output(&snapshot))
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
    pub(super) tool_name: String,
    pub(super) command: String,
    pub(super) cwd: String,
    pub(super) output_path: Option<PathBuf>,
    pub(super) dangerously_disable_sandbox: Option<bool>,
    pub(super) pid: u32,
    pub(super) started_at: u128,
    pub(super) pending_stdout: String,
    pub(super) pending_stderr: String,
    pub(super) stdout: String,
    pub(super) stderr: String,
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
    pub(super) output_path: Option<PathBuf>,
    pub(super) dangerously_disable_sandbox: Option<bool>,
    pub(super) started_at: u128,
    pub(super) ended_at: u128,
    pub(super) status: ProcessStatus,
    pub(super) exit_code: Option<i32>,
    pub(super) exit_signal: Option<String>,
    pub(super) stdout: String,
    pub(super) stderr: String,
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
            output_path: snapshot.output_path,
            dangerously_disable_sandbox: snapshot.dangerously_disable_sandbox,
            started_at: snapshot.started_at,
            ended_at: now_millis(),
            status,
            exit_code: snapshot.exit_code,
            exit_signal: snapshot.exit_signal,
            stdout: snapshot.stdout,
            stderr: snapshot.stderr,
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
    pub(super) tool_name: String,
    pub(super) command: String,
    pub(super) cwd: String,
    pub(super) output_path: Option<PathBuf>,
    pub(super) dangerously_disable_sandbox: Option<bool>,
    pub(super) pid: u32,
    pub(super) started_at: u128,
    pub(super) stdout: String,
    pub(super) stderr: String,
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
    timeout_ms: Option<u64>,
    dangerously_disable_sandbox: Option<bool>,
) -> pi::sdk::Result<Arc<Mutex<ProcessSession>>> {
    let shell = resolve_shell();
    start_process_session(
        registry,
        cwd,
        command.clone(),
        shell,
        vec!["-lc".to_string(), command],
        timeout_ms,
        "bash",
        dangerously_disable_sandbox,
    )
}

pub(super) fn start_powershell_session(
    registry: &Arc<ProcessRegistry>,
    cwd: &Path,
    command: String,
    timeout_ms: Option<u64>,
    dangerously_disable_sandbox: Option<bool>,
) -> pi::sdk::Result<Arc<Mutex<ProcessSession>>> {
    let program = resolve_powershell();
    start_process_session(
        registry,
        cwd,
        command.clone(),
        program.as_str(),
        vec![
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-Command".to_string(),
            command,
        ],
        timeout_ms,
        "PowerShell",
        dangerously_disable_sandbox,
    )
}

pub(super) fn start_process_session(
    registry: &Arc<ProcessRegistry>,
    cwd: &Path,
    display_command: String,
    program: &str,
    args: Vec<String>,
    timeout_ms: Option<u64>,
    tool_name: &str,
    dangerously_disable_sandbox: Option<bool>,
) -> pi::sdk::Result<Arc<Mutex<ProcessSession>>> {
    let mut child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| tool_error(tool_name, format!("Failed to spawn process: {error}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| tool_error(tool_name, "Missing stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| tool_error(tool_name, "Missing stderr"))?;
    let stdin = child.stdin.take().map(|stdin| Arc::new(Mutex::new(stdin)));
    let pid = child.id();
    let child = Arc::new(Mutex::new(child));
    let id = registry.next_session_id();
    let output_path = create_process_output_path(cwd, &id);
    let session = Arc::new(Mutex::new(ProcessSession {
        id: id.clone(),
        tool_name: tool_name.to_string(),
        command: display_command,
        cwd: cwd.to_string_lossy().to_string(),
        output_path,
        dangerously_disable_sandbox,
        pid,
        started_at: now_millis(),
        pending_stdout: String::new(),
        pending_stderr: String::new(),
        stdout: String::new(),
        stderr: String::new(),
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
    spawn_waiter(Arc::clone(&session), child, timeout_ms);
    Ok(session)
}

pub(super) fn resolve_powershell() -> String {
    if cfg!(windows) {
        return "powershell.exe".to_string();
    }
    for candidate in [
        "/opt/homebrew/bin/pwsh",
        "/usr/local/bin/pwsh",
        "/usr/bin/pwsh",
    ] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "pwsh".to_string()
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
    timeout_ms: Option<u64>,
) {
    thread::spawn(move || {
        let deadline = timeout_ms.map(|millis| Instant::now() + Duration::from_millis(millis));
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
    let text = strip_claude_code_hint_lines(text);
    if text.is_empty() {
        return;
    }
    let output_path = {
        let mut session = session.lock().expect("session");
        if stdout {
            session.pending_stdout.push_str(&text);
            session.stdout.push_str(&text);
        } else {
            session.pending_stderr.push_str(&text);
            session.stderr.push_str(&text);
        }
        session.aggregated.push_str(&text);
        if session.aggregated.len() > MAX_OUTPUT {
            let keep_from = char_boundary_at_or_after(
                &session.aggregated,
                session.aggregated.len() - MAX_OUTPUT,
            );
            session.aggregated = session.aggregated[keep_from..].to_string();
            session.truncated = true;
        }
        session.tail = tail(&session.aggregated, 2000);
        session.output_path.clone()
    };
    if let Some(path) = output_path {
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut file| file.write_all(text.as_bytes()));
    }
}

fn strip_claude_code_hint_lines(text: &str) -> String {
    if !text.contains("<claude-code-hint") {
        return text.to_string();
    }
    let mut stripped = String::with_capacity(text.len());
    for line in text.split_inclusive('\n') {
        if is_claude_code_hint_line(line) {
            continue;
        }
        stripped.push_str(line);
    }
    collapse_claude_hint_blank_lines(stripped)
}

fn is_claude_code_hint_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with("<claude-code-hint ") && trimmed.ends_with("/>")
}

fn collapse_claude_hint_blank_lines(text: String) -> String {
    let mut collapsed = String::with_capacity(text.len());
    let mut newline_run = 0;
    for ch in text.chars() {
        if ch == '\n' {
            newline_run += 1;
            if newline_run <= 2 {
                collapsed.push(ch);
            }
        } else {
            newline_run = 0;
            collapsed.push(ch);
        }
    }
    collapsed
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
        tool_name: session.tool_name.clone(),
        command: session.command.clone(),
        cwd: session.cwd.clone(),
        output_path: session.output_path.clone(),
        dangerously_disable_sandbox: session.dangerously_disable_sandbox,
        pid: session.pid,
        started_at: session.started_at,
        stdout: session.stdout.clone(),
        stderr: session.stderr.clone(),
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
    let output_path = snapshot
        .output_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    let text = output_path.as_ref().map_or_else(
        || format!("Command running in background with ID: {}.", snapshot.id),
        |path| {
            format!(
                "Command running in background with ID: {}. Output is being written to: {path}",
                snapshot.id
            )
        },
    );
    let mut details = json!({
        "status": "running",
        "sessionId": snapshot.id,
        "backgroundTaskId": snapshot.id,
        "pid": snapshot.pid,
        "startedAt": snapshot.started_at,
        "cwd": snapshot.cwd,
        "stdout": snapshot.stdout,
        "stderr": snapshot.stderr,
        "interrupted": false,
        "tail": snapshot.tail,
        "outputPath": output_path.clone(),
        "persistedOutputPath": output_path,
        "persistedOutputSize": process_output_size(snapshot.output_path.as_ref()),
    });
    if snapshot.tool_name == "bash" {
        if let Some(value) = snapshot.dangerously_disable_sandbox {
            details["dangerouslyDisableSandbox"] = Value::Bool(value);
        }
    }
    text_output(text, Some(details), false)
}

pub(super) fn completed_bash_output(snapshot: &SessionSnapshot) -> pi::sdk::ToolOutput {
    let interpretation = bash_return_code_interpretation(&snapshot.command, snapshot.exit_code);
    let failed = snapshot.exit_signal.is_some() || interpretation.is_error;
    let status = if failed { "failed" } else { "completed" };
    let output_path = snapshot
        .output_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    let output_size = process_output_size(snapshot.output_path.as_ref());
    let mut text = if should_persist_shell_output(output_size) {
        shell_persisted_output_text(output_path.as_deref(), output_size, &snapshot.tail)
    } else {
        shell_stdout_stderr_text(&snapshot.stdout, &snapshot.stderr)
    };
    if snapshot.exit_signal.is_some() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str("<error>Command was aborted before completion</error>");
    } else if interpretation.is_error && snapshot.exit_code != Some(0) {
        if !text.is_empty() {
            text.push('\n');
        }
        let exit_code = snapshot.exit_code.unwrap_or(1);
        text.push_str(&format!("Exit code {exit_code}"));
    }
    let mut details = shell_output_details(snapshot, status, output_path, output_size);
    if let Some(message) = interpretation.message {
        details.insert(
            "returnCodeInterpretation".to_string(),
            Value::String(message.to_string()),
        );
    }
    details.insert(
        "noOutputExpected".to_string(),
        Value::Bool(is_silent_bash_command(&snapshot.command)),
    );
    shell_completed_output(text, details, failed)
}

pub(super) fn completed_powershell_output(snapshot: &SessionSnapshot) -> pi::sdk::ToolOutput {
    let interpretation =
        powershell_return_code_interpretation(&snapshot.command, snapshot.exit_code);
    let failed = snapshot.exit_signal.is_some() || interpretation.is_error;
    let status = if failed { "failed" } else { "completed" };
    let output_path = snapshot
        .output_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    let output_size = process_output_size(snapshot.output_path.as_ref());
    let mut text = if should_persist_shell_output(output_size) {
        shell_persisted_output_text(output_path.as_deref(), output_size, &snapshot.tail)
    } else {
        shell_result_text(&snapshot.stdout)
    };
    let stderr = snapshot.stderr.trim();
    if !stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(stderr);
    }
    if snapshot.exit_signal.is_some() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str("<error>Command was aborted before completion</error>");
    } else if interpretation.is_error && snapshot.exit_code != Some(0) {
        if !text.is_empty() {
            text.push('\n');
        }
        let exit_code = snapshot.exit_code.unwrap_or(1);
        text.push_str(&format!("Exit code {exit_code}"));
    }
    let mut details = shell_output_details(snapshot, status, output_path, output_size);
    if let Some(message) = interpretation.message {
        details.insert(
            "returnCodeInterpretation".to_string(),
            Value::String(message.to_string()),
        );
    }
    shell_completed_output(text, details, failed)
}

fn shell_completed_output(
    text: String,
    mut details: Map<String, Value>,
    is_error: bool,
) -> pi::sdk::ToolOutput {
    if let Some((mime_type, data)) = shell_image_data_uri(&text) {
        details.insert("isImage".to_string(), Value::Bool(true));
        return pi::sdk::ToolOutput {
            content: vec![pi::sdk::ContentBlock::Image(pi::sdk::ImageContent {
                data,
                mime_type,
            })],
            details: Some(Value::Object(details)),
            is_error,
        };
    }
    text_output(text, Some(Value::Object(details)), is_error)
}

fn shell_output_details(
    snapshot: &SessionSnapshot,
    status: &str,
    output_path: Option<String>,
    output_size: Option<u64>,
) -> Map<String, Value> {
    let mut details = Map::new();
    details.insert("status".to_string(), Value::String(status.to_string()));
    details.insert("stdout".to_string(), Value::String(snapshot.stdout.clone()));
    details.insert("stderr".to_string(), Value::String(snapshot.stderr.clone()));
    details.insert(
        "interrupted".to_string(),
        Value::Bool(snapshot.exit_signal.is_some()),
    );
    details.insert("exitCode".to_string(), json!(snapshot.exit_code));
    details.insert("exitSignal".to_string(), json!(snapshot.exit_signal));
    details.insert(
        "aggregated".to_string(),
        Value::String(snapshot.aggregated.clone()),
    );
    details.insert("cwd".to_string(), Value::String(snapshot.cwd.clone()));
    details.insert("truncated".to_string(), Value::Bool(snapshot.truncated));
    details.insert("outputPath".to_string(), json!(output_path.clone()));
    details.insert("persistedOutputPath".to_string(), json!(output_path));
    details.insert("persistedOutputSize".to_string(), json!(output_size));
    if snapshot.tool_name == "bash" {
        if let Some(value) = snapshot.dangerously_disable_sandbox {
            details.insert("dangerouslyDisableSandbox".to_string(), Value::Bool(value));
        }
    }
    details
}

fn create_process_output_path(cwd: &Path, session_id: &str) -> Option<PathBuf> {
    let dir = cwd.join(".crawclaw").join("tool-results");
    fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{session_id}.output.txt"));
    fs::File::create(&path).ok()?;
    Some(path)
}

fn process_output_size(path: Option<&PathBuf>) -> Option<u64> {
    path.and_then(|path| fs::metadata(path).ok().map(|metadata| metadata.len()))
}

fn should_persist_shell_output(output_size: Option<u64>) -> bool {
    output_size.is_some_and(|size| size as usize > shell_max_output_length())
}

fn shell_max_output_length() -> usize {
    match std::env::var("BASH_MAX_OUTPUT_LENGTH")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
    {
        Some(value) if value > SHELL_MAX_OUTPUT_UPPER_LIMIT => SHELL_MAX_OUTPUT_UPPER_LIMIT,
        Some(value) if value > 0 => value,
        _ => SHELL_MAX_OUTPUT_DEFAULT,
    }
}

fn shell_persisted_output_text(
    output_path: Option<&str>,
    output_size: Option<u64>,
    tail_text: &str,
) -> String {
    let Some(output_path) = output_path else {
        return shell_result_text(tail_text);
    };
    let preview_source = fs::read_to_string(output_path).unwrap_or_else(|_| tail_text.to_string());
    let (preview, has_more) = shell_persisted_output_preview(&shell_result_text(&preview_source));
    let size = output_size
        .map(format_shell_file_size)
        .unwrap_or_else(|| "unknown size".to_string());
    let mut text = format!(
        "<persisted-output>\nOutput too large ({size}). Full output saved to: {output_path}\n\nPreview (first {}):\n{preview}",
        format_shell_file_size(PERSISTED_OUTPUT_PREVIEW_BYTES as u64)
    );
    if has_more {
        text.push_str("\n...\n");
    } else {
        text.push('\n');
    }
    text.push_str("</persisted-output>");
    text
}

const PERSISTED_OUTPUT_PREVIEW_BYTES: usize = 2000;

fn shell_persisted_output_preview(content: &str) -> (String, bool) {
    if content.len() <= PERSISTED_OUTPUT_PREVIEW_BYTES {
        return (content.to_string(), false);
    }
    let limit = char_boundary_at_or_after(content, PERSISTED_OUTPUT_PREVIEW_BYTES);
    let truncated = &content[..limit];
    let cut_point = truncated
        .rfind('\n')
        .filter(|index| *index > PERSISTED_OUTPUT_PREVIEW_BYTES / 2)
        .unwrap_or(limit);
    (content[..cut_point].to_string(), true)
}

fn format_shell_file_size(size_in_bytes: u64) -> String {
    let kb = size_in_bytes as f64 / 1024.0;
    if kb < 1.0 {
        return format!("{size_in_bytes} bytes");
    }
    if kb < 1024.0 {
        return format_shell_decimal_size(kb, "KB");
    }
    let mb = kb / 1024.0;
    if mb < 1024.0 {
        return format_shell_decimal_size(mb, "MB");
    }
    format_shell_decimal_size(mb / 1024.0, "GB")
}

fn format_shell_decimal_size(value: f64, unit: &str) -> String {
    let formatted = format!("{value:.1}");
    let formatted = formatted.strip_suffix(".0").unwrap_or(&formatted);
    format!("{formatted}{unit}")
}

fn shell_stdout_stderr_text(stdout: &str, stderr: &str) -> String {
    [shell_result_text(stdout), stderr.trim().to_string()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn shell_result_text(output: &str) -> String {
    let mut text = output;
    loop {
        let without_line_space = text.trim_start_matches([' ', '\t', '\r']);
        let Some(rest) = without_line_space.strip_prefix('\n') else {
            return text.trim_end().to_string();
        };
        text = rest;
    }
}

fn shell_image_data_uri(output: &str) -> Option<(String, String)> {
    let trimmed = output.trim();
    let rest = trimmed.strip_prefix("data:")?;
    let marker = ";base64,";
    let lower = rest.to_ascii_lowercase();
    let marker_index = lower.find(marker)?;
    let mime_type = rest[..marker_index].trim();
    if !mime_type.to_ascii_lowercase().starts_with("image/") {
        return None;
    }
    let data = rest[marker_index + marker.len()..].trim();
    if data.is_empty() || data.contains(['\n', '\r']) {
        return None;
    }
    Some((mime_type.to_string(), data.to_string()))
}

fn bash_return_code_interpretation(
    command: &str,
    exit_code: Option<i32>,
) -> ShellCommandInterpretation {
    let exit_code = exit_code.unwrap_or(1);
    match shell_semantic_base_command(command).as_str() {
        "grep" | "rg" => ShellCommandInterpretation {
            is_error: exit_code >= 2,
            message: (exit_code == 1).then_some("No matches found"),
        },
        "find" => ShellCommandInterpretation {
            is_error: exit_code >= 2,
            message: (exit_code == 1).then_some("Some directories were inaccessible"),
        },
        "diff" => ShellCommandInterpretation {
            is_error: exit_code >= 2,
            message: (exit_code == 1).then_some("Files differ"),
        },
        "test" | "[" => ShellCommandInterpretation {
            is_error: exit_code >= 2,
            message: (exit_code == 1).then_some("Condition is false"),
        },
        _ => default_return_code_interpretation(exit_code),
    }
}

fn powershell_return_code_interpretation(
    command: &str,
    exit_code: Option<i32>,
) -> ShellCommandInterpretation {
    let exit_code = exit_code.unwrap_or(1);
    match powershell_semantic_base_command(command).as_str() {
        "grep" | "rg" | "findstr" => ShellCommandInterpretation {
            is_error: exit_code >= 2,
            message: (exit_code == 1).then_some("No matches found"),
        },
        "robocopy" => ShellCommandInterpretation {
            is_error: exit_code >= 8,
            message: if exit_code == 0 {
                Some("No files copied (already in sync)")
            } else if (1..8).contains(&exit_code) {
                Some(if exit_code & 1 == 1 {
                    "Files copied successfully"
                } else {
                    "Robocopy completed (no errors)"
                })
            } else {
                None
            },
        },
        _ => default_return_code_interpretation(exit_code),
    }
}

fn default_return_code_interpretation(exit_code: i32) -> ShellCommandInterpretation {
    ShellCommandInterpretation {
        is_error: exit_code != 0,
        message: None,
    }
}

fn shell_semantic_base_command(command: &str) -> String {
    let segments = shell_command_segments(command);
    let last_command = segments
        .iter()
        .rev()
        .map(String::as_str)
        .next()
        .unwrap_or(command);
    first_shell_word(last_command).to_string()
}

fn powershell_semantic_base_command(command: &str) -> String {
    let segment = command
        .split([';', '|'])
        .rev()
        .find(|segment| !segment.trim().is_empty())
        .unwrap_or(command)
        .trim();
    let invoked = segment
        .strip_prefix("& ")
        .or_else(|| segment.strip_prefix(". "))
        .unwrap_or(segment);
    let first = first_shell_word(invoked).trim_matches(['"', '\'']);
    let basename = first.rsplit(['/', '\\']).next().unwrap_or(first);
    let lower = basename.to_ascii_lowercase();
    lower
        .strip_suffix(".exe")
        .unwrap_or(lower.as_str())
        .to_string()
}

fn shell_command_segments(command: &str) -> Vec<String> {
    let mut commands = Vec::new();
    let mut skip_next_as_redirect_target = false;
    for part in split_shell_command_with_operators(command) {
        if skip_next_as_redirect_target {
            skip_next_as_redirect_target = false;
            continue;
        }
        if matches!(part.as_str(), ">" | ">>" | ">&") {
            skip_next_as_redirect_target = true;
            continue;
        }
        if !is_shell_operator(part.as_str()) {
            commands.push(part);
        }
    }
    commands
}

fn is_silent_bash_command(command: &str) -> bool {
    let mut has_non_fallback_command = false;
    let mut last_operator: Option<&str> = None;
    let mut skip_next_as_redirect_target = false;
    for part in split_shell_command_with_operators(command) {
        if skip_next_as_redirect_target {
            skip_next_as_redirect_target = false;
            continue;
        }
        if matches!(part.as_str(), ">" | ">>" | ">&") {
            skip_next_as_redirect_target = true;
            continue;
        }
        if is_shell_operator(part.as_str()) {
            last_operator = Some(match part.as_str() {
                "||" => "||",
                "&&" => "&&",
                "|" => "|",
                ";" => ";",
                _ => "",
            });
            continue;
        }
        let base_command = first_shell_word(&part);
        if base_command.is_empty() {
            continue;
        }
        if last_operator == Some("||") && is_bash_semantic_neutral_command(base_command) {
            continue;
        }
        has_non_fallback_command = true;
        if !is_bash_silent_command(base_command) {
            return false;
        }
    }
    has_non_fallback_command
}

fn detect_blocked_bash_sleep_pattern(command: &str) -> Option<String> {
    let segments = shell_command_segments(command);
    let first = segments.first()?.trim();
    let secs = bash_sleep_seconds(first)?;
    if secs < 2 {
        return None;
    }
    let rest = segments
        .iter()
        .skip(1)
        .map(|segment| segment.trim())
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if rest.is_empty() {
        Some(format!("standalone sleep {secs}"))
    } else {
        Some(format!("sleep {secs} followed by: {rest}"))
    }
}

fn bash_sleep_seconds(command: &str) -> Option<u64> {
    let mut words = command.split_whitespace();
    if words.next()? != "sleep" {
        return None;
    }
    let seconds = words.next()?;
    if words.next().is_some() || !seconds.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    seconds.parse::<u64>().ok()
}

fn detect_blocked_powershell_sleep_pattern(command: &str) -> Option<String> {
    let trimmed = command.trim();
    let first = trimmed
        .split([';', '|', '&', '\r', '\n'])
        .next()
        .unwrap_or("")
        .trim();
    let secs = powershell_sleep_seconds(first)?;
    if secs < 2 {
        return None;
    }
    let rest = trimmed[first.len()..]
        .trim_start_matches(|ch: char| ch.is_whitespace() || matches!(ch, ';' | '|' | '&'))
        .trim();
    if rest.is_empty() {
        Some(format!("standalone Start-Sleep {secs}"))
    } else {
        Some(format!("Start-Sleep {secs} followed by: {rest}"))
    }
}

fn powershell_sleep_seconds(command: &str) -> Option<u64> {
    let mut words = command.split_whitespace();
    let command_name = words.next()?.to_ascii_lowercase();
    if command_name != "start-sleep" && command_name != "sleep" {
        return None;
    }
    let mut next = words.next()?;
    if matches!(next.to_ascii_lowercase().as_str(), "-s" | "-seconds") {
        next = words.next()?;
    }
    if words.next().is_some() || !next.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    next.parse::<u64>().ok()
}

fn split_shell_command_with_operators(command: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = command.chars().peekable();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    while let Some(ch) = chars.next() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' && quote != Some('\'') {
            current.push(ch);
            escaped = true;
            continue;
        }
        if let Some(quote_char) = quote {
            current.push(ch);
            if ch == quote_char {
                quote = None;
            }
            continue;
        }
        if matches!(ch, '\'' | '"') {
            quote = Some(ch);
            current.push(ch);
            continue;
        }
        let operator = match ch {
            '&' if chars.peek() == Some(&'&') => {
                chars.next();
                Some("&&")
            }
            '|' if chars.peek() == Some(&'|') => {
                chars.next();
                Some("||")
            }
            '|' => Some("|"),
            ';' => Some(";"),
            '>' if chars.peek() == Some(&'>') => {
                chars.next();
                Some(">>")
            }
            '>' if chars.peek() == Some(&'&') => {
                chars.next();
                Some(">&")
            }
            '>' => Some(">"),
            _ => None,
        };
        if let Some(operator) = operator {
            push_shell_part(&mut parts, &mut current);
            parts.push(operator.to_string());
        } else {
            current.push(ch);
        }
    }
    push_shell_part(&mut parts, &mut current);
    parts
}

fn push_shell_part(parts: &mut Vec<String>, current: &mut String) {
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        parts.push(trimmed.to_string());
    }
    current.clear();
}

fn first_shell_word(segment: &str) -> &str {
    segment.split_whitespace().next().unwrap_or("")
}

fn is_shell_operator(part: &str) -> bool {
    matches!(part, "||" | "&&" | "|" | ";" | ">" | ">>" | ">&")
}

fn is_bash_semantic_neutral_command(command: &str) -> bool {
    matches!(command, "echo" | "printf" | "true" | "false" | ":")
}

fn is_bash_silent_command(command: &str) -> bool {
    matches!(
        command,
        "mv" | "cp"
            | "rm"
            | "mkdir"
            | "rmdir"
            | "chmod"
            | "chown"
            | "chgrp"
            | "touch"
            | "ln"
            | "cd"
            | "export"
            | "unset"
            | "wait"
    )
}
