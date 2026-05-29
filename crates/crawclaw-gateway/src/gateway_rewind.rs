use super::*;

const MAX_REWIND_CHECKPOINTS: usize = 32;
const MAX_REWIND_FILES: usize = 2_000;
const MAX_REWIND_BYTES: usize = 16 * 1024 * 1024;
const MAX_LCS_DIFF_CELLS: usize = 4_000_000;

pub(super) fn record_rewind_checkpoint(state: &GatewayState, request: &AgentRunRequest) {
    let checkpoint_id = request
        .inbound
        .message_id
        .clone()
        .unwrap_or_else(|| request.run_id.clone());
    match create_rewind_checkpoint(&state.runtime_root, checkpoint_id.clone()) {
        Ok(Some(checkpoint)) => {
            if let Err(error) = store_rewind_checkpoint(state, checkpoint) {
                tracing::debug!(checkpoint_id = %checkpoint_id, error = %error, "sdk_rewind_checkpoint_skipped");
            }
        }
        Ok(None) => {}
        Err(error) => {
            tracing::debug!(checkpoint_id = %checkpoint_id, error = %error, "sdk_rewind_checkpoint_skipped");
        }
    }
}

pub(super) fn control_rewind_files(state: &GatewayState, params: Value) -> Result<Value, String> {
    let message_id = required_param(&params, &["user_message_id", "userMessageId"])?;
    let dry_run = bool_param(&params, &["dry_run", "dryRun"]).unwrap_or(false);
    let checkpoint = {
        let checkpoints = state
            .sdk_rewind_checkpoints
            .lock()
            .map_err(|_| "SDK rewind checkpoint store lock poisoned".to_string())?;
        checkpoints.get(&message_id).cloned()
    };
    let Some(checkpoint) = checkpoint else {
        return Ok(rewind_unavailable(format!(
            "No file checkpoint found for user_message_id {message_id}."
        )));
    };
    let preview = match rewind_preview(&checkpoint) {
        Ok(preview) => preview,
        Err(error) => return Ok(rewind_unavailable(error)),
    };
    if !dry_run {
        if let Err(error) = restore_rewind_checkpoint(&checkpoint, &preview.files_changed) {
            return Ok(rewind_unavailable(error));
        }
    }
    Ok(json!({
        "canRewind": true,
        "filesChanged": preview.files_changed,
        "insertions": preview.insertions,
        "deletions": preview.deletions
    }))
}

struct RewindPreview {
    files_changed: Vec<String>,
    insertions: usize,
    deletions: usize,
}

fn create_rewind_checkpoint(
    runtime_root: &Path,
    checkpoint_id: String,
) -> Result<Option<SdkRewindCheckpoint>, String> {
    if !runtime_root.exists() {
        return Ok(None);
    }
    let Some(root) = git_toplevel(runtime_root)? else {
        return Ok(None);
    };
    let files = git_visible_files(&root)?;
    if files.len() > MAX_REWIND_FILES {
        return Err(format!(
            "file checkpoint skipped because the Git worktree has more than {MAX_REWIND_FILES} visible files"
        ));
    }
    let mut total_bytes = 0usize;
    let mut snapshots = BTreeMap::new();
    for relative in files {
        let Some(path) = safe_relative_path(&root, &relative) else {
            continue;
        };
        let snapshot = file_snapshot(&path)?;
        if let SdkRewindFileSnapshot::Regular(bytes) = &snapshot {
            total_bytes = total_bytes.saturating_add(bytes.len());
            if total_bytes > MAX_REWIND_BYTES {
                return Err(format!(
                    "file checkpoint skipped because visible file contents exceed {} bytes",
                    MAX_REWIND_BYTES
                ));
            }
        }
        snapshots.insert(relative, snapshot);
    }
    Ok(Some(SdkRewindCheckpoint {
        id: checkpoint_id,
        root,
        created_at_ms: now_millis() as u64,
        files: snapshots,
    }))
}

fn store_rewind_checkpoint(
    state: &GatewayState,
    checkpoint: SdkRewindCheckpoint,
) -> Result<(), String> {
    let mut checkpoints = state
        .sdk_rewind_checkpoints
        .lock()
        .map_err(|_| "SDK rewind checkpoint store lock poisoned".to_string())?;
    checkpoints.insert(checkpoint.id.clone(), checkpoint);
    while checkpoints.len() > MAX_REWIND_CHECKPOINTS {
        let Some(oldest) = checkpoints
            .values()
            .min_by_key(|checkpoint| checkpoint.created_at_ms)
            .map(|checkpoint| checkpoint.id.clone())
        else {
            break;
        };
        checkpoints.remove(&oldest);
    }
    Ok(())
}

fn rewind_preview(checkpoint: &SdkRewindCheckpoint) -> Result<RewindPreview, String> {
    let mut current_files = BTreeMap::new();
    for relative in git_visible_files(&checkpoint.root)? {
        let Some(path) = safe_relative_path(&checkpoint.root, &relative) else {
            continue;
        };
        current_files.insert(relative, file_snapshot(&path)?);
    }

    let mut changed = BTreeSet::new();
    changed.extend(checkpoint.files.keys().cloned());
    changed.extend(current_files.keys().cloned());

    let mut files_changed = Vec::new();
    let mut insertions = 0usize;
    let mut deletions = 0usize;
    for relative in changed {
        let before = checkpoint
            .files
            .get(&relative)
            .unwrap_or(&SdkRewindFileSnapshot::Missing);
        let after = current_files
            .get(&relative)
            .unwrap_or(&SdkRewindFileSnapshot::Missing);
        if !snapshots_differ(before, after) {
            continue;
        }
        files_changed.push(relative);
        let (file_insertions, file_deletions) = diff_counts(before, after);
        insertions = insertions.saturating_add(file_insertions);
        deletions = deletions.saturating_add(file_deletions);
    }
    Ok(RewindPreview {
        files_changed,
        insertions,
        deletions,
    })
}

fn restore_rewind_checkpoint(
    checkpoint: &SdkRewindCheckpoint,
    files_changed: &[String],
) -> Result<(), String> {
    for relative in files_changed {
        let Some(path) = safe_relative_path(&checkpoint.root, relative) else {
            continue;
        };
        match checkpoint
            .files
            .get(relative)
            .unwrap_or(&SdkRewindFileSnapshot::Missing)
        {
            SdkRewindFileSnapshot::Regular(bytes) => write_snapshot_file(&path, bytes)?,
            SdkRewindFileSnapshot::Missing => remove_regular_file(&path)?,
            SdkRewindFileSnapshot::Unsupported => {}
        }
    }
    Ok(())
}

fn git_toplevel(path: &Path) -> Result<Option<PathBuf>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|error| format!("failed to run git rev-parse: {error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let root = String::from_utf8(output.stdout)
        .map_err(|error| format!("git rev-parse returned non-UTF-8 output: {error}"))?;
    let root = root.trim();
    if root.is_empty() {
        return Ok(None);
    }
    Ok(Some(PathBuf::from(root)))
}

fn git_visible_files(root: &Path) -> Result<BTreeSet<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .output()
        .map_err(|error| format!("failed to run git ls-files: {error}"))?;
    if !output.status.success() {
        return Err("git ls-files failed while preparing file rewind data".to_string());
    }
    let mut files = BTreeSet::new();
    for raw in output.stdout.split(|byte| *byte == 0) {
        if raw.is_empty() {
            continue;
        }
        let relative = String::from_utf8_lossy(raw).to_string();
        if safe_relative_path(root, &relative).is_some() {
            files.insert(relative);
        }
    }
    Ok(files)
}

fn safe_relative_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let path = Path::new(relative);
    if path.components().any(|component| {
        !matches!(
            component,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    }) {
        return None;
    }
    Some(root.join(path))
}

fn file_snapshot(path: &Path) -> Result<SdkRewindFileSnapshot, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SdkRewindFileSnapshot::Missing);
        }
        Err(error) => return Err(format!("failed to stat {}: {error}", path.display())),
    };
    if !metadata.file_type().is_file() {
        return Ok(SdkRewindFileSnapshot::Unsupported);
    }
    let bytes = std::fs::read(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    Ok(SdkRewindFileSnapshot::Regular(bytes))
}

fn snapshots_differ(before: &SdkRewindFileSnapshot, after: &SdkRewindFileSnapshot) -> bool {
    match (before, after) {
        (SdkRewindFileSnapshot::Regular(left), SdkRewindFileSnapshot::Regular(right)) => {
            left != right
        }
        (SdkRewindFileSnapshot::Missing, SdkRewindFileSnapshot::Missing)
        | (SdkRewindFileSnapshot::Unsupported, _)
        | (_, SdkRewindFileSnapshot::Unsupported) => false,
        _ => true,
    }
}

fn diff_counts(before: &SdkRewindFileSnapshot, after: &SdkRewindFileSnapshot) -> (usize, usize) {
    let before = match before {
        SdkRewindFileSnapshot::Regular(bytes) => bytes.as_slice(),
        SdkRewindFileSnapshot::Missing => &[],
        SdkRewindFileSnapshot::Unsupported => return (0, 0),
    };
    let after = match after {
        SdkRewindFileSnapshot::Regular(bytes) => bytes.as_slice(),
        SdkRewindFileSnapshot::Missing => &[],
        SdkRewindFileSnapshot::Unsupported => return (0, 0),
    };
    let Ok(before) = std::str::from_utf8(before) else {
        return (0, 0);
    };
    let Ok(after) = std::str::from_utf8(after) else {
        return (0, 0);
    };
    let before_lines = before.lines().collect::<Vec<_>>();
    let after_lines = after.lines().collect::<Vec<_>>();
    let cells = before_lines.len().saturating_mul(after_lines.len());
    if cells > MAX_LCS_DIFF_CELLS {
        return line_count_delta(before_lines.len(), after_lines.len());
    }

    let lcs = lcs_len(&before_lines, &after_lines);
    (
        after_lines.len().saturating_sub(lcs),
        before_lines.len().saturating_sub(lcs),
    )
}

fn lcs_len(left: &[&str], right: &[&str]) -> usize {
    let mut previous = vec![0usize; right.len() + 1];
    let mut current = vec![0usize; right.len() + 1];
    for left_line in left {
        for (index, right_line) in right.iter().enumerate() {
            let column = index + 1;
            current[column] = if left_line == right_line {
                previous[column - 1] + 1
            } else {
                previous[column].max(current[column - 1])
            };
        }
        std::mem::swap(&mut previous, &mut current);
        current.fill(0);
    }
    previous[right.len()]
}

fn line_count_delta(before: usize, after: usize) -> (usize, usize) {
    if after >= before {
        (after - before, 0)
    } else {
        (0, before - after)
    }
}

fn write_snapshot_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if matches!(std::fs::symlink_metadata(path), Ok(metadata) if metadata.file_type().is_symlink())
    {
        std::fs::remove_file(path)
            .map_err(|error| format!("failed to remove symlink {}: {error}", path.display()))?;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    std::fs::write(path, bytes)
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn remove_regular_file(path: &Path) -> Result<(), String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("failed to stat {}: {error}", path.display())),
    };
    if metadata.file_type().is_file() {
        std::fs::remove_file(path)
            .map_err(|error| format!("failed to remove {}: {error}", path.display()))?;
    }
    Ok(())
}

fn rewind_unavailable(error: String) -> Value {
    json!({
        "canRewind": false,
        "error": error
    })
}
