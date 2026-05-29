use super::*;

const WORKTREE_STATE_PATH: &[&str] = &[".crawclaw", "worktree-state.json"];
const WORKTREE_DIR_PATH: &[&str] = &[".crawclaw", "worktrees"];

#[derive(Clone, Copy, Debug)]
pub(super) enum WorktreeToolKind {
    Enter,
    Exit,
}

#[derive(Clone, Debug)]
pub(super) struct WorktreeTool {
    runtime_root: PathBuf,
    kind: WorktreeToolKind,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeState {
    name: String,
    original_cwd: String,
    worktree_path: String,
    worktree_branch: Option<String>,
    original_head_commit: Option<String>,
    created_at: String,
}

impl WorktreeTool {
    pub(super) fn new(runtime_root: &Path, kind: WorktreeToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

#[async_trait]
impl pi::sdk::Tool for WorktreeTool {
    fn name(&self) -> &str {
        match self.kind {
            WorktreeToolKind::Enter => "EnterWorktree",
            WorktreeToolKind::Exit => "ExitWorktree",
        }
    }

    fn label(&self) -> &str {
        self.name()
    }

    fn description(&self) -> &str {
        match self.kind {
            WorktreeToolKind::Enter => {
                "Creates an isolated worktree (via git or configured hooks) and switches the session into it"
            }
            WorktreeToolKind::Exit => {
                "Exits a worktree session created by EnterWorktree and restores the original working directory"
            }
        }
    }

    fn parameters(&self) -> Value {
        match self.kind {
            WorktreeToolKind::Enter => json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Optional name for the worktree. Each \"/\"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided."
                    }
                },
                "additionalProperties": false
            }),
            WorktreeToolKind::Exit => json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["keep", "remove"],
                        "description": "\"keep\" leaves the worktree and branch on disk; \"remove\" deletes both."
                    },
                    "discard_changes": {
                        "type": "boolean",
                        "description": "Required true when action is \"remove\" and the worktree has uncommitted files or unmerged commits. The tool will refuse and list them otherwise."
                    }
                },
                "required": ["action"],
                "additionalProperties": false
            }),
        }
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let runtime_root = self.runtime_root.clone();
        let kind = self.kind;
        let result = tokio::task::spawn_blocking(move || match kind {
            WorktreeToolKind::Enter => enter_worktree(&runtime_root, input),
            WorktreeToolKind::Exit => exit_worktree(&runtime_root, input),
        })
        .await
        .map_err(|error| tool_error(self.name(), format!("worktree task failed: {error}")))?
        .map_err(|error| tool_error(self.name(), error))?;
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        false
    }
}

pub(super) fn effective_tool_root(runtime_root: &Path) -> PathBuf {
    active_worktree_state(runtime_root)
        .and_then(|state| {
            let path = PathBuf::from(state.worktree_path);
            path.is_dir().then_some(path)
        })
        .unwrap_or_else(|| runtime_root.to_path_buf())
}

fn require_worktree_keys(
    input: &Value,
    allowed_keys: &[&str],
    tool_name: &str,
) -> Result<(), String> {
    let Some(object) = input.as_object() else {
        return Err(format!("{tool_name} input must be an object"));
    };
    for key in object.keys() {
        if !allowed_keys.contains(&key.as_str()) {
            return Err(format!("{tool_name} input contains unknown field: {key}"));
        }
    }
    Ok(())
}

fn enter_worktree(runtime_root: &Path, input: Value) -> Result<Value, String> {
    require_worktree_keys(&input, &["name"], "EnterWorktree")?;
    if let Some(state) = active_worktree_state(runtime_root) {
        return Err(format!(
            "Already in worktree {}. Use ExitWorktree before creating another worktree.",
            state.worktree_path
        ));
    }
    let root = git_toplevel(runtime_root)?.unwrap_or_else(|| runtime_root.to_path_buf());
    let name = string_param(&input, &["name"])
        .map(|value| validate_worktree_name(&value))
        .transpose()?
        .unwrap_or_else(default_worktree_name);
    let branch = format!("crawclaw/worktree/{name}");
    let worktree_path = worktree_base_dir(runtime_root).join(&name);
    if worktree_path.exists() {
        return Err(format!(
            "worktree path already exists: {}",
            worktree_path.display()
        ));
    }
    let original_head_commit = git_output(&root, ["rev-parse", "HEAD"]).ok();
    if let Some(parent) = worktree_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create worktree parent {}: {error}",
                parent.display()
            )
        })?;
    }
    git_status(
        &root,
        vec![
            "worktree".to_string(),
            "add".to_string(),
            "-b".to_string(),
            branch.clone(),
            path_arg(&worktree_path),
            "HEAD".to_string(),
        ],
    )?;
    let state = WorktreeState {
        name,
        original_cwd: runtime_root.to_string_lossy().to_string(),
        worktree_path: worktree_path.to_string_lossy().to_string(),
        worktree_branch: Some(branch),
        original_head_commit,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    write_worktree_state(runtime_root, &state)?;
    let branch_info = state
        .worktree_branch
        .as_ref()
        .map(|branch| format!(" on branch {branch}"))
        .unwrap_or_default();
    let message = format!(
        "Created worktree at {}{}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.",
        state.worktree_path, branch_info
    );
    Ok(tool_envelope(
        message.clone(),
        json!({
            "worktreePath": state.worktree_path,
            "worktreeBranch": state.worktree_branch,
            "message": message
        }),
        false,
    ))
}

fn exit_worktree(runtime_root: &Path, input: Value) -> Result<Value, String> {
    require_worktree_keys(&input, &["action", "discard_changes"], "ExitWorktree")?;
    let Some(state) = active_worktree_state(runtime_root) else {
        return Err(
            "No-op: there is no active EnterWorktree session to exit. This tool only operates on worktrees created by EnterWorktree in the current session - it will not touch worktrees created manually or in a previous session. No filesystem changes were made."
                .to_string(),
        );
    };
    let action = required_param_string("ExitWorktree", &input, &["action"])?;
    if !matches!(action.as_str(), "keep" | "remove") {
        return Err("ExitWorktree action must be keep or remove".to_string());
    }
    let worktree_path = PathBuf::from(&state.worktree_path);
    let mut discarded_files = 0usize;
    let mut discarded_commits = 0usize;
    if action == "remove" {
        let summary =
            worktree_change_summary(&worktree_path, state.original_head_commit.as_deref());
        match summary {
            Some((changed_files, commits)) => {
                discarded_files = changed_files;
                discarded_commits = commits;
                if (changed_files > 0 || commits > 0)
                    && input.get("discard_changes").and_then(Value::as_bool) != Some(true)
                {
                    let mut parts = Vec::new();
                    if changed_files > 0 {
                        parts.push(format!(
                            "{changed_files} uncommitted {}",
                            if changed_files == 1 { "file" } else { "files" }
                        ));
                    }
                    if commits > 0 {
                        parts.push(format!(
                            "{commits} {} on {}",
                            if commits == 1 { "commit" } else { "commits" },
                            state
                                .worktree_branch
                                .as_deref()
                                .unwrap_or("the worktree branch")
                        ));
                    }
                    return Err(format!(
                        "Worktree has {}. Removing will discard this work permanently. Confirm with the user, then re-invoke with discard_changes: true - or use action: \"keep\" to preserve the worktree.",
                        parts.join(" and ")
                    ));
                }
            }
            None if input.get("discard_changes").and_then(Value::as_bool) != Some(true) => {
                return Err(format!(
                    "Could not verify worktree state at {}. Refusing to remove without explicit confirmation. Re-invoke with discard_changes: true to proceed - or use action: \"keep\" to preserve the worktree.",
                    state.worktree_path
                ));
            }
            None => {}
        }
        if worktree_path.exists() {
            git_status(
                runtime_root,
                vec![
                    "worktree".to_string(),
                    "remove".to_string(),
                    "--force".to_string(),
                    path_arg(&worktree_path),
                ],
            )?;
        }
        if let Some(branch) = &state.worktree_branch {
            let _ = git_status(
                runtime_root,
                vec!["branch".to_string(), "-D".to_string(), branch.clone()],
            );
        }
    }
    clear_worktree_state(runtime_root)?;
    let message = if action == "keep" {
        let branch_info = state
            .worktree_branch
            .as_ref()
            .map(|branch| format!(" on branch {branch}"))
            .unwrap_or_default();
        format!(
            "Exited worktree. Your work is preserved at {}{}. Session is now back in {}.",
            state.worktree_path, branch_info, state.original_cwd
        )
    } else {
        let mut discard_parts = Vec::new();
        if discarded_commits > 0 {
            discard_parts.push(format!(
                "{discarded_commits} {}",
                if discarded_commits == 1 {
                    "commit"
                } else {
                    "commits"
                }
            ));
        }
        if discarded_files > 0 {
            discard_parts.push(format!(
                "{discarded_files} uncommitted {}",
                if discarded_files == 1 {
                    "file"
                } else {
                    "files"
                }
            ));
        }
        let discard_note = if discard_parts.is_empty() {
            String::new()
        } else {
            format!(" Discarded {}.", discard_parts.join(" and "))
        };
        format!(
            "Exited and removed worktree at {}.{} Session is now back in {}.",
            state.worktree_path, discard_note, state.original_cwd
        )
    };
    let mut details = Map::new();
    details.insert("action".to_string(), Value::String(action));
    details.insert("originalCwd".to_string(), Value::String(state.original_cwd));
    details.insert(
        "worktreePath".to_string(),
        Value::String(state.worktree_path),
    );
    if let Some(branch) = state.worktree_branch {
        details.insert("worktreeBranch".to_string(), Value::String(branch));
    }
    if details.get("action").and_then(Value::as_str) == Some("remove") {
        details.insert(
            "discardedFiles".to_string(),
            Value::Number(discarded_files.into()),
        );
        details.insert(
            "discardedCommits".to_string(),
            Value::Number(discarded_commits.into()),
        );
    }
    details.insert("message".to_string(), Value::String(message.clone()));
    Ok(tool_envelope(message, Value::Object(details), false))
}

fn active_worktree_state(runtime_root: &Path) -> Option<WorktreeState> {
    let raw = fs::read_to_string(worktree_state_path(runtime_root)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_worktree_state(runtime_root: &Path, state: &WorktreeState) -> Result<(), String> {
    let path = worktree_state_path(runtime_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

fn clear_worktree_state(runtime_root: &Path) -> Result<(), String> {
    let path = worktree_state_path(runtime_root);
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn worktree_state_path(runtime_root: &Path) -> PathBuf {
    WORKTREE_STATE_PATH
        .iter()
        .fold(runtime_root.to_path_buf(), |path, segment| {
            path.join(segment)
        })
}

fn worktree_base_dir(runtime_root: &Path) -> PathBuf {
    WORKTREE_DIR_PATH
        .iter()
        .fold(runtime_root.to_path_buf(), |path, segment| {
            path.join(segment)
        })
}

fn default_worktree_name() -> String {
    format!("session-{}", now_millis())
}

fn validate_worktree_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_matches('/');
    if trimmed.is_empty() {
        return Err("worktree name cannot be empty".to_string());
    }
    if trimmed.len() > 64 {
        return Err("worktree name must be 64 characters or fewer".to_string());
    }
    for segment in trimmed.split('/') {
        if segment.is_empty()
            || !segment
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        {
            return Err(format!("invalid worktree name: {value}"));
        }
    }
    Ok(trimmed.to_string())
}

fn worktree_change_summary(
    worktree_path: &Path,
    original_head_commit: Option<&str>,
) -> Option<(usize, usize)> {
    let status = git_output(worktree_path, ["status", "--porcelain"]).ok()?;
    let changed_files = status
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    let original_head_commit = original_head_commit?;
    let commits = git_output(
        worktree_path,
        vec![
            "rev-list".to_string(),
            "--count".to_string(),
            format!("{original_head_commit}..HEAD"),
        ],
    )
    .ok()
    .and_then(|value| value.trim().parse::<usize>().ok())?;
    Some((changed_files, commits))
}

fn git_toplevel(cwd: &Path) -> Result<Option<PathBuf>, String> {
    match git_output(cwd, ["rev-parse", "--show-toplevel"]) {
        Ok(value) => Ok(Some(PathBuf::from(value.trim()))),
        Err(error) if error.contains("not a git repository") => Ok(None),
        Err(error) => Err(error),
    }
}

fn git_output<I, S>(cwd: &Path, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;
    if !output.status.success() {
        return Err(git_error(output.status, &output.stderr));
    }
    String::from_utf8(output.stdout).map_err(|error| format!("git output was not UTF-8: {error}"))
}

fn git_status<I, S>(cwd: &Path, args: I) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("failed to run git: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(git_error(output.status, &output.stderr))
}

fn git_error(status: ExitStatus, stderr: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    format!(
        "git failed with status {}: {}",
        status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "signal".to_string()),
        stderr.trim()
    )
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
