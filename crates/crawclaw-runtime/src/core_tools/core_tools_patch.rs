use super::*;

pub(super) struct ApplyPatchTool {
    cwd: PathBuf,
}

impl ApplyPatchTool {
    pub(super) fn new(cwd: &Path) -> Self {
        Self {
            cwd: cwd.to_path_buf(),
        }
    }
}

#[derive(Deserialize)]
pub(super) struct ApplyPatchInput {
    input: String,
}

#[async_trait]
impl pi::sdk::Tool for ApplyPatchTool {
    fn name(&self) -> &str {
        "apply_patch"
    }

    fn label(&self) -> &str {
        "apply_patch"
    }

    fn description(&self) -> &str {
        "Apply a patch to one or more files using the apply_patch format. The input should include *** Begin Patch and *** End Patch markers."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "input": {
                    "type": "string",
                    "description": "Patch content using the *** Begin Patch/End Patch format."
                }
            },
            "required": ["input"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: ApplyPatchInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        if input.input.trim().is_empty() {
            return Err(pi::sdk::Error::validation("Provide a patch input."));
        }
        let result = apply_patch_text(&input.input, &self.cwd)
            .map_err(|error| tool_error("apply_patch", error))?;
        Ok(text_output(
            result.text,
            Some(json!({ "summary": result.summary })),
            false,
        ))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ApplyPatchSummary {
    added: Vec<String>,
    modified: Vec<String>,
    deleted: Vec<String>,
}

pub(super) struct ApplyPatchResult {
    summary: ApplyPatchSummary,
    text: String,
}

pub(super) enum PatchHunk {
    Add {
        path: String,
        contents: String,
    },
    Delete {
        path: String,
    },
    Update {
        path: String,
        move_path: Option<String>,
        chunks: Vec<UpdateFileChunk>,
    },
}

#[derive(Clone)]
pub(super) struct UpdateFileChunk {
    change_context: Option<String>,
    old_lines: Vec<String>,
    new_lines: Vec<String>,
    is_end_of_file: bool,
}

pub(super) fn apply_patch_text(input: &str, cwd: &Path) -> Result<ApplyPatchResult, String> {
    let hunks = parse_patch_text(input)?;
    if hunks.is_empty() {
        return Err("No files were modified.".to_string());
    }

    let mut summary = ApplyPatchSummary {
        added: Vec::new(),
        modified: Vec::new(),
        deleted: Vec::new(),
    };

    for hunk in hunks {
        match hunk {
            PatchHunk::Add { path, contents } => {
                let target = resolve_workspace_path(cwd, &path)?;
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| format!("Failed to create parent directory: {error}"))?;
                }
                fs::write(&target, contents)
                    .map_err(|error| format!("Failed to write {}: {error}", path))?;
                record_summary(&mut summary.added, display_path(cwd, &target));
            }
            PatchHunk::Delete { path } => {
                let target = resolve_workspace_path(cwd, &path)?;
                remove_path(&target)
                    .map_err(|error| format!("Failed to delete {}: {error}", path))?;
                record_summary(&mut summary.deleted, display_path(cwd, &target));
            }
            PatchHunk::Update {
                path,
                move_path,
                chunks,
            } => {
                let target = resolve_workspace_path(cwd, &path)?;
                let updated = apply_update_hunks(&target, &chunks)?;
                if let Some(move_path) = move_path {
                    let move_target = resolve_workspace_path(cwd, &move_path)?;
                    if let Some(parent) = move_target.parent() {
                        fs::create_dir_all(parent).map_err(|error| {
                            format!("Failed to create parent directory: {error}")
                        })?;
                    }
                    fs::write(&move_target, updated)
                        .map_err(|error| format!("Failed to write {}: {error}", move_path))?;
                    remove_path(&target)
                        .map_err(|error| format!("Failed to delete {}: {error}", path))?;
                    record_summary(&mut summary.modified, display_path(cwd, &move_target));
                } else {
                    fs::write(&target, updated)
                        .map_err(|error| format!("Failed to write {}: {error}", path))?;
                    record_summary(&mut summary.modified, display_path(cwd, &target));
                }
            }
        }
    }

    let text = format_patch_summary(&summary);
    Ok(ApplyPatchResult { summary, text })
}

pub(super) fn record_summary(bucket: &mut Vec<String>, value: String) {
    if !bucket.contains(&value) {
        bucket.push(value);
    }
}

pub(super) fn format_patch_summary(summary: &ApplyPatchSummary) -> String {
    let mut lines = vec!["Success. Updated the following files:".to_string()];
    lines.extend(summary.added.iter().map(|file| format!("A {file}")));
    lines.extend(summary.modified.iter().map(|file| format!("M {file}")));
    lines.extend(summary.deleted.iter().map(|file| format!("D {file}")));
    lines.join("\n")
}

pub(super) fn remove_path(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

pub(super) fn resolve_workspace_path(cwd: &Path, raw_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw_path.trim());
    if path.as_os_str().is_empty() {
        return Err("Patch path is empty.".to_string());
    }
    if path.is_absolute() {
        return Err(format!("Patch path must be relative: {raw_path}"));
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(format!("Patch path escapes the workspace root: {raw_path}"));
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!("Patch path must be relative: {raw_path}"));
            }
        }
    }

    let root = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    let target = root.join(normalized);
    if target.exists() {
        let canonical = target
            .canonicalize()
            .map_err(|error| format!("Failed to resolve {}: {error}", target.display()))?;
        if !canonical.starts_with(&root) {
            return Err(format!("Patch path escapes the workspace root: {raw_path}"));
        }
    }
    Ok(target)
}

pub(super) fn display_path(cwd: &Path, path: &Path) -> String {
    let root = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    path.strip_prefix(&root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

pub(super) fn parse_patch_text(input: &str) -> Result<Vec<PatchHunk>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Invalid patch: input is empty.".to_string());
    }
    let lines: Vec<String> = trimmed.lines().map(ToOwned::to_owned).collect();
    let lines = check_patch_boundaries_lenient(lines)?;
    let mut hunks = Vec::new();
    let mut index = 1;
    let last = lines.len().saturating_sub(1);
    let mut line_number = 2;
    while index < last {
        let (hunk, consumed) = parse_one_hunk(&lines[index..last], line_number)?;
        hunks.push(hunk);
        index += consumed;
        line_number += consumed;
    }
    Ok(hunks)
}

pub(super) fn check_patch_boundaries_lenient(lines: Vec<String>) -> Result<Vec<String>, String> {
    if check_patch_boundaries_strict(&lines).is_ok() {
        return Ok(lines);
    }
    if lines.len() >= 4 {
        let first = lines.first().map(String::as_str).unwrap_or_default();
        let last = lines.last().map(String::as_str).unwrap_or_default();
        if matches!(first, "<<EOF" | "<<'EOF'" | "<<\"EOF\"") && last.ends_with("EOF") {
            let inner = lines[1..lines.len() - 1].to_vec();
            check_patch_boundaries_strict(&inner)?;
            return Ok(inner);
        }
    }
    check_patch_boundaries_strict(&lines)?;
    Ok(lines)
}

pub(super) fn check_patch_boundaries_strict(lines: &[String]) -> Result<(), String> {
    let first = lines.first().map(|line| line.trim()).unwrap_or_default();
    let last = lines.last().map(|line| line.trim()).unwrap_or_default();
    if first == "*** Begin Patch" && last == "*** End Patch" {
        return Ok(());
    }
    if first != "*** Begin Patch" {
        return Err("The first line of the patch must be '*** Begin Patch'".to_string());
    }
    Err("The last line of the patch must be '*** End Patch'".to_string())
}

pub(super) fn parse_one_hunk(
    lines: &[String],
    line_number: usize,
) -> Result<(PatchHunk, usize), String> {
    if lines.is_empty() {
        return Err(format!(
            "Invalid patch hunk at line {line_number}: empty hunk"
        ));
    }
    let first = lines[0].trim();
    if let Some(path) = first.strip_prefix("*** Add File: ") {
        let mut contents = String::new();
        let mut consumed = 1;
        for line in &lines[1..] {
            if let Some(content) = line.strip_prefix('+') {
                contents.push_str(content);
                contents.push('\n');
                consumed += 1;
            } else {
                break;
            }
        }
        return Ok((
            PatchHunk::Add {
                path: path.to_string(),
                contents,
            },
            consumed,
        ));
    }
    if let Some(path) = first.strip_prefix("*** Delete File: ") {
        return Ok((
            PatchHunk::Delete {
                path: path.to_string(),
            },
            1,
        ));
    }
    if let Some(path) = first.strip_prefix("*** Update File: ") {
        let mut index = 1;
        let mut consumed = 1;
        let mut move_path = None;
        if let Some(candidate) = lines.get(index).map(|line| line.trim()) {
            if let Some(path) = candidate.strip_prefix("*** Move to: ") {
                move_path = Some(path.to_string());
                index += 1;
                consumed += 1;
            }
        }
        let mut chunks = Vec::new();
        while index < lines.len() {
            if lines[index].trim().is_empty() {
                index += 1;
                consumed += 1;
                continue;
            }
            if lines[index].starts_with("***") {
                break;
            }
            let (chunk, chunk_lines) = parse_update_file_chunk(
                &lines[index..],
                line_number + consumed,
                chunks.is_empty(),
            )?;
            chunks.push(chunk);
            index += chunk_lines;
            consumed += chunk_lines;
        }
        if chunks.is_empty() {
            return Err(format!(
                "Invalid patch hunk at line {line_number}: Update file hunk for path '{path}' is empty"
            ));
        }
        return Ok((
            PatchHunk::Update {
                path: path.to_string(),
                move_path,
                chunks,
            },
            consumed,
        ));
    }
    Err(format!(
        "Invalid patch hunk at line {line_number}: '{}' is not a valid hunk header.",
        lines[0]
    ))
}

pub(super) fn parse_update_file_chunk(
    lines: &[String],
    line_number: usize,
    allow_missing_context: bool,
) -> Result<(UpdateFileChunk, usize), String> {
    if lines.is_empty() {
        return Err(format!(
            "Invalid patch hunk at line {line_number}: Update hunk does not contain any lines"
        ));
    }

    let mut change_context = None;
    let mut start_index = 0;
    if lines[0] == "@@" {
        start_index = 1;
    } else if let Some(context) = lines[0].strip_prefix("@@ ") {
        change_context = Some(context.to_string());
        start_index = 1;
    } else if !allow_missing_context {
        return Err(format!(
            "Invalid patch hunk at line {line_number}: Expected update hunk to start with a @@ context marker, got: '{}'",
            lines[0]
        ));
    }

    if start_index >= lines.len() {
        return Err(format!(
            "Invalid patch hunk at line {}: Update hunk does not contain any lines",
            line_number + 1
        ));
    }

    let mut chunk = UpdateFileChunk {
        change_context,
        old_lines: Vec::new(),
        new_lines: Vec::new(),
        is_end_of_file: false,
    };
    let mut parsed_lines = 0;
    for line in &lines[start_index..] {
        if line == "*** End of File" {
            if parsed_lines == 0 {
                return Err(format!(
                    "Invalid patch hunk at line {}: Update hunk does not contain any lines",
                    line_number + 1
                ));
            }
            chunk.is_end_of_file = true;
            parsed_lines += 1;
            break;
        }

        let mut chars = line.chars();
        match chars.next() {
            None => {
                chunk.old_lines.push(String::new());
                chunk.new_lines.push(String::new());
                parsed_lines += 1;
            }
            Some(' ') => {
                let content = chars.as_str().to_string();
                chunk.old_lines.push(content.clone());
                chunk.new_lines.push(content);
                parsed_lines += 1;
            }
            Some('+') => {
                chunk.new_lines.push(chars.as_str().to_string());
                parsed_lines += 1;
            }
            Some('-') => {
                chunk.old_lines.push(chars.as_str().to_string());
                parsed_lines += 1;
            }
            Some(_) if parsed_lines > 0 => break,
            Some(_) => {
                return Err(format!(
                    "Invalid patch hunk at line {}: Unexpected line found in update hunk: '{}'.",
                    line_number + 1,
                    line
                ));
            }
        }
    }

    Ok((chunk, parsed_lines + start_index))
}

pub(super) fn apply_update_hunks(
    file_path: &Path,
    chunks: &[UpdateFileChunk],
) -> Result<String, String> {
    let contents = fs::read_to_string(file_path).map_err(|error| {
        format!(
            "Failed to read file to update {}: {error}",
            file_path.display()
        )
    })?;
    let mut original_lines: Vec<String> = contents.split('\n').map(ToOwned::to_owned).collect();
    if original_lines.last().is_some_and(String::is_empty) {
        original_lines.pop();
    }
    let replacements = compute_replacements(&original_lines, file_path, chunks)?;
    let mut new_lines = apply_replacements(&original_lines, &replacements);
    if new_lines.last().is_none_or(|line| !line.is_empty()) {
        new_lines.push(String::new());
    }
    Ok(new_lines.join("\n"))
}

pub(super) fn compute_replacements(
    original_lines: &[String],
    file_path: &Path,
    chunks: &[UpdateFileChunk],
) -> Result<Vec<(usize, usize, Vec<String>)>, String> {
    let mut replacements = Vec::new();
    let mut line_index = 0;
    for chunk in chunks {
        if let Some(context) = &chunk.change_context {
            let Some(context_index) = seek_sequence(
                original_lines,
                std::slice::from_ref(context),
                line_index,
                false,
            ) else {
                return Err(format!(
                    "Failed to find context '{}' in {}",
                    context,
                    file_path.display()
                ));
            };
            line_index = context_index + 1;
        }
        if chunk.old_lines.is_empty() {
            let insertion_index = if original_lines.last().is_some_and(String::is_empty) {
                original_lines.len().saturating_sub(1)
            } else {
                original_lines.len()
            };
            replacements.push((insertion_index, 0, chunk.new_lines.clone()));
            continue;
        }

        let mut pattern = chunk.old_lines.clone();
        let mut new_slice = chunk.new_lines.clone();
        let mut found = seek_sequence(original_lines, &pattern, line_index, chunk.is_end_of_file);
        if found.is_none() && pattern.last().is_some_and(String::is_empty) {
            pattern.pop();
            if new_slice.last().is_some_and(String::is_empty) {
                new_slice.pop();
            }
            found = seek_sequence(original_lines, &pattern, line_index, chunk.is_end_of_file);
        }
        let Some(found) = found else {
            return Err(format!(
                "Failed to find expected lines in {}:\n{}",
                file_path.display(),
                chunk.old_lines.join("\n")
            ));
        };
        replacements.push((found, pattern.len(), new_slice));
        line_index = found + pattern.len();
    }
    replacements.sort_by_key(|replacement| replacement.0);
    Ok(replacements)
}

pub(super) fn apply_replacements(
    original_lines: &[String],
    replacements: &[(usize, usize, Vec<String>)],
) -> Vec<String> {
    let mut result = original_lines.to_vec();
    for (start, old_len, new_lines) in replacements.iter().rev() {
        for _ in 0..*old_len {
            if *start < result.len() {
                result.remove(*start);
            }
        }
        for (offset, line) in new_lines.iter().enumerate() {
            result.insert(start + offset, line.clone());
        }
    }
    result
}

pub(super) fn seek_sequence(
    lines: &[String],
    pattern: &[String],
    start: usize,
    eof: bool,
) -> Option<usize> {
    if pattern.is_empty() {
        return Some(start);
    }
    if pattern.len() > lines.len() {
        return None;
    }
    let max_start = lines.len() - pattern.len();
    let search_start = if eof && lines.len() >= pattern.len() {
        max_start
    } else {
        start
    };
    if search_start > max_start {
        return None;
    }
    let normalizers: &[fn(&str) -> String] = &[
        |value| value.to_string(),
        |value| value.trim_end().to_string(),
        |value| value.trim().to_string(),
        |value| normalize_punctuation(value.trim()),
    ];
    for normalize in normalizers {
        for index in search_start..=max_start {
            if lines_match(lines, pattern, index, *normalize) {
                return Some(index);
            }
        }
    }
    None
}

pub(super) fn lines_match(
    lines: &[String],
    pattern: &[String],
    start: usize,
    normalize: fn(&str) -> String,
) -> bool {
    pattern
        .iter()
        .enumerate()
        .all(|(offset, expected)| normalize(&lines[start + offset]) == normalize(expected))
}

pub(super) fn normalize_punctuation(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}'
            | '\u{2212}' => '-',
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => '\'',
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => '"',
            '\u{00A0}' | '\u{2002}' | '\u{2003}' | '\u{2004}' | '\u{2005}' | '\u{2006}'
            | '\u{2007}' | '\u{2008}' | '\u{2009}' | '\u{200A}' | '\u{202F}' | '\u{205F}'
            | '\u{3000}' => ' ',
            other => other,
        })
        .collect()
}
