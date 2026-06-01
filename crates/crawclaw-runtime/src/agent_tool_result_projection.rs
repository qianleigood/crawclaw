const MAX_CONTEXT_TOOL_RESULT_CHARS: usize = 8_000;
const TOOL_RESULT_PREVIEW_CHARS: usize = 2_000;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ToolResultProjectionStats {
    pub(crate) projected_count: usize,
    pub(crate) omitted_chars: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProjectedToolResult {
    pub(crate) content: String,
    pub(crate) projected: bool,
    pub(crate) omitted_chars: usize,
}

pub(crate) fn project_tool_result_content(content: &str) -> ProjectedToolResult {
    let original_chars = content.chars().count();
    if original_chars <= MAX_CONTEXT_TOOL_RESULT_CHARS {
        return ProjectedToolResult {
            content: content.to_string(),
            projected: false,
            omitted_chars: 0,
        };
    }

    let preview = content
        .chars()
        .take(TOOL_RESULT_PREVIEW_CHARS)
        .collect::<String>();
    let omitted_chars = original_chars.saturating_sub(preview.chars().count());
    ProjectedToolResult {
        content: format!(
            "Tool result projected for context budget. Original length: {original_chars} chars; omitted: {omitted_chars} chars.\n\nPreview:\n{preview}"
        ),
        projected: true,
        omitted_chars,
    }
}
