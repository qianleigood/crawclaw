use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_MAX_CONTEXT_TOOL_RESULT_CHARS: usize = 8_000;
const DEFAULT_TOOL_RESULT_PREVIEW_CHARS: usize = 2_000;
const DEFAULT_TOOL_RESULT_PERSIST_THRESHOLD_CHARS: usize = 64_000;
const MIN_CONTEXT_TOOL_RESULT_CHARS: usize = 2_000;
const MAX_CONTEXT_TOOL_RESULT_CHARS: usize = 16_000;
const MIN_TOOL_RESULT_PREVIEW_CHARS: usize = 500;
const MAX_TOOL_RESULT_PREVIEW_CHARS: usize = 4_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ToolResultProjectionBudget {
    pub(crate) max_chars: usize,
    pub(crate) preview_chars: usize,
    pub(crate) persist_threshold_chars: usize,
}

impl Default for ToolResultProjectionBudget {
    fn default() -> Self {
        Self {
            max_chars: DEFAULT_MAX_CONTEXT_TOOL_RESULT_CHARS,
            preview_chars: DEFAULT_TOOL_RESULT_PREVIEW_CHARS,
            persist_threshold_chars: DEFAULT_TOOL_RESULT_PERSIST_THRESHOLD_CHARS,
        }
    }
}

impl ToolResultProjectionBudget {
    pub(crate) fn from_prompt_budget_tokens(max_prompt_tokens: usize) -> Self {
        let max_chars = max_prompt_tokens
            .saturating_mul(4)
            .saturating_div(12)
            .clamp(MIN_CONTEXT_TOOL_RESULT_CHARS, MAX_CONTEXT_TOOL_RESULT_CHARS);
        let preview_chars = max_chars
            .saturating_div(4)
            .clamp(MIN_TOOL_RESULT_PREVIEW_CHARS, MAX_TOOL_RESULT_PREVIEW_CHARS);
        Self {
            max_chars,
            preview_chars,
            persist_threshold_chars: max_chars
                .saturating_mul(4)
                .max(DEFAULT_TOOL_RESULT_PERSIST_THRESHOLD_CHARS),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ToolResultProjectionStats {
    pub(crate) projected_count: usize,
    pub(crate) omitted_chars: usize,
    pub(crate) persisted_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProjectedToolResult {
    pub(crate) content: String,
    pub(crate) projected: bool,
    pub(crate) omitted_chars: usize,
    pub(crate) persisted_path: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ToolResultProjectionPersistence<'a> {
    pub(crate) runtime_root: &'a Path,
    pub(crate) thread_id: &'a str,
    pub(crate) tool_use_id: &'a str,
}

pub(crate) fn project_tool_result_content(
    content: &str,
    budget: ToolResultProjectionBudget,
) -> ProjectedToolResult {
    let original_chars = content.chars().count();
    if original_chars <= budget.max_chars {
        return ProjectedToolResult {
            content: content.to_string(),
            projected: false,
            omitted_chars: 0,
            persisted_path: None,
        };
    }

    let preview = content
        .chars()
        .take(budget.preview_chars)
        .collect::<String>();
    let omitted_chars = original_chars.saturating_sub(preview.chars().count());
    ProjectedToolResult {
        content: format!(
            "Tool result projected for context budget. Original length: {original_chars} chars; omitted: {omitted_chars} chars.\n\nPreview:\n{preview}"
        ),
        projected: true,
        omitted_chars,
        persisted_path: None,
    }
}

pub(crate) fn project_tool_result_content_with_persistence(
    content: &str,
    budget: ToolResultProjectionBudget,
    persistence: ToolResultProjectionPersistence<'_>,
) -> ProjectedToolResult {
    let original_chars = content.chars().count();
    if original_chars <= budget.max_chars {
        return ProjectedToolResult {
            content: content.to_string(),
            projected: false,
            omitted_chars: 0,
            persisted_path: None,
        };
    }
    if original_chars <= budget.persist_threshold_chars {
        return project_tool_result_content(content, budget);
    }

    let path = persisted_tool_result_path(
        persistence.runtime_root,
        persistence.thread_id,
        persistence.tool_use_id,
    );
    if fs::create_dir_all(path.parent().unwrap_or(persistence.runtime_root)).is_ok()
        && fs::write(&path, content).is_ok()
    {
        let preview = content
            .chars()
            .take(budget.preview_chars)
            .collect::<String>();
        let omitted_chars = original_chars.saturating_sub(preview.chars().count());
        return ProjectedToolResult {
            content: format!(
                "Tool result projected for context budget. Original length: {original_chars} chars; omitted: {omitted_chars} chars.\nFull output saved to: {}\n\nPreview:\n{preview}",
                path.display()
            ),
            projected: true,
            omitted_chars,
            persisted_path: Some(path),
        };
    }

    project_tool_result_content(content, budget)
}

fn persisted_tool_result_path(runtime_root: &Path, thread_id: &str, tool_use_id: &str) -> PathBuf {
    runtime_root
        .join("sessions")
        .join("tool-results")
        .join(sanitize_path_component(thread_id))
        .join(format!("{}.txt", sanitize_path_component(tool_use_id)))
}

fn sanitize_path_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "tool-result".to_string()
    } else {
        sanitized
    }
}
