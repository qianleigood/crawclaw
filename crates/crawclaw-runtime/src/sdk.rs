use std::fmt;
use std::fs;
use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub enum Error {
    Provider { provider: String, message: String },
    Tool { tool: String, message: String },
    Validation(String),
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl Error {
    pub fn provider(provider: impl ToString, message: impl ToString) -> Self {
        Self::Provider {
            provider: provider.to_string(),
            message: message.to_string(),
        }
    }

    pub fn tool(tool: impl ToString, message: impl ToString) -> Self {
        Self::Tool {
            tool: tool.to_string(),
            message: message.to_string(),
        }
    }

    pub fn validation(message: impl ToString) -> Self {
        Self::Validation(message.to_string())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Provider { provider, message } => {
                write!(formatter, "Provider error: {provider}: {message}")
            }
            Self::Tool { tool, message } => write!(formatter, "Tool error: {tool}: {message}"),
            Self::Validation(message) => write!(formatter, "Validation error: {message}"),
            Self::Io(error) => write!(formatter, "IO error: {error}"),
            Self::Json(error) => write!(formatter, "JSON error: {error}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ContentBlock {
    Text(TextContent),
    Thinking(ThinkingContent),
    Image(ImageContent),
    ToolCall(ToolCall),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextContent {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_signature: Option<String>,
}

impl TextContent {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            text_signature: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingContent {
    pub thinking: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageContent {
    pub data: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thought_signature: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutput {
    pub content: Vec<ContentBlock>,
    pub details: Option<Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_error: bool,
}

const fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUpdate {
    pub content: Vec<ContentBlock>,
    pub details: Option<Value>,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;

    fn label(&self) -> &str;

    fn description(&self) -> &str;

    fn parameters(&self) -> Value;

    async fn execute(
        &self,
        tool_call_id: &str,
        input: Value,
        on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput>;

    fn is_read_only(&self) -> bool {
        false
    }
}

pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn from_tools(tools: Vec<Box<dyn Tool>>) -> Self {
        Self { tools }
    }

    pub fn into_tools(self) -> Vec<Box<dyn Tool>> {
        self.tools
    }

    pub fn tools(&self) -> &[Box<dyn Tool>] {
        &self.tools
    }

    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        self.tools
            .iter()
            .find(|tool| tool.name() == name)
            .map(std::convert::AsRef::as_ref)
    }
}

fn text_output(text: impl Into<String>, details: Option<Value>) -> ToolOutput {
    ToolOutput {
        content: vec![ContentBlock::Text(TextContent::new(text))],
        details,
        is_error: false,
    }
}

fn resolve_workspace_path(cwd: &Path, raw_path: &str) -> Result<PathBuf> {
    if raw_path.trim().is_empty() {
        return Err(Error::validation("path is required"));
    }
    let path = Path::new(raw_path);
    if path.is_absolute() {
        return Err(Error::validation("path must be relative to the workspace"));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(Error::validation("path must not contain parent traversal"));
    }
    Ok(cwd.join(path))
}

#[derive(Clone)]
struct ReadTool {
    cwd: PathBuf,
}

pub fn create_read_tool(cwd: &Path) -> Box<dyn Tool> {
    Box::new(ReadTool {
        cwd: cwd.to_path_buf(),
    })
}

#[async_trait]
impl Tool for ReadTool {
    fn name(&self) -> &str {
        "read"
    }

    fn label(&self) -> &str {
        "read"
    }

    fn description(&self) -> &str {
        "Read a workspace file"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "offset": { "type": "integer" },
                "limit": { "type": "integer" }
            },
            "required": ["path"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let path = input
            .get("path")
            .or_else(|| input.get("file_path"))
            .and_then(Value::as_str)
            .ok_or_else(|| Error::validation("read requires path"))?;
        let resolved = resolve_workspace_path(&self.cwd, path)?;
        let content = fs::read_to_string(&resolved).map_err(|error| Error::tool("read", error))?;
        Ok(text_output(
            content,
            Some(
                json!({ "path": path, "bytes": fs::metadata(&resolved).map(|m| m.len()).unwrap_or_default() }),
            ),
        ))
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

#[derive(Clone)]
struct WriteTool {
    cwd: PathBuf,
}

pub fn create_write_tool(cwd: &Path) -> Box<dyn Tool> {
    Box::new(WriteTool {
        cwd: cwd.to_path_buf(),
    })
}

#[async_trait]
impl Tool for WriteTool {
    fn name(&self) -> &str {
        "write"
    }

    fn label(&self) -> &str {
        "write"
    }

    fn description(&self) -> &str {
        "Write a workspace file"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "content": { "type": "string" }
            },
            "required": ["path", "content"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let path = input
            .get("path")
            .or_else(|| input.get("file_path"))
            .and_then(Value::as_str)
            .ok_or_else(|| Error::validation("write requires path"))?;
        let content = input
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::validation("write requires content"))?;
        let resolved = resolve_workspace_path(&self.cwd, path)?;
        if let Some(parent) = resolved.parent() {
            fs::create_dir_all(parent).map_err(|error| Error::tool("write", error))?;
        }
        fs::write(&resolved, content).map_err(|error| Error::tool("write", error))?;
        Ok(text_output(
            format!("Wrote {path}"),
            Some(json!({ "path": path, "bytes": content.len() })),
        ))
    }
}

#[derive(Clone)]
struct EditTool {
    cwd: PathBuf,
}

pub fn create_edit_tool(cwd: &Path) -> Box<dyn Tool> {
    Box::new(EditTool {
        cwd: cwd.to_path_buf(),
    })
}

#[async_trait]
impl Tool for EditTool {
    fn name(&self) -> &str {
        "edit"
    }

    fn label(&self) -> &str {
        "edit"
    }

    fn description(&self) -> &str {
        "Edit a workspace file by replacing text"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "old_string": { "type": "string" },
                "new_string": { "type": "string" }
            },
            "required": ["path", "old_string", "new_string"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let path = input
            .get("path")
            .or_else(|| input.get("file_path"))
            .and_then(Value::as_str)
            .ok_or_else(|| Error::validation("edit requires path"))?;
        let old_string = input
            .get("old_string")
            .or_else(|| input.get("oldString"))
            .and_then(Value::as_str)
            .ok_or_else(|| Error::validation("edit requires old_string"))?;
        let new_string = input
            .get("new_string")
            .or_else(|| input.get("newString"))
            .and_then(Value::as_str)
            .ok_or_else(|| Error::validation("edit requires new_string"))?;
        let resolved = resolve_workspace_path(&self.cwd, path)?;
        let content = fs::read_to_string(&resolved).map_err(|error| Error::tool("edit", error))?;
        if !content.contains(old_string) {
            return Err(Error::tool("edit", "old_string was not found"));
        }
        let updated = content.replacen(old_string, new_string, 1);
        fs::write(&resolved, updated).map_err(|error| Error::tool("edit", error))?;
        Ok(text_output(
            format!("Edited {path}"),
            Some(json!({ "path": path })),
        ))
    }
}

#[derive(Clone)]
struct GrepTool {
    cwd: PathBuf,
}

pub fn create_grep_tool(cwd: &Path) -> Box<dyn Tool> {
    Box::new(GrepTool {
        cwd: cwd.to_path_buf(),
    })
}

#[async_trait]
impl Tool for GrepTool {
    fn name(&self) -> &str {
        "grep"
    }

    fn label(&self) -> &str {
        "grep"
    }

    fn description(&self) -> &str {
        "Search workspace text files"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string" },
                "path": { "type": "string" }
            },
            "required": ["pattern"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let pattern = input
            .get("pattern")
            .or_else(|| input.get("query"))
            .and_then(Value::as_str)
            .ok_or_else(|| Error::validation("grep requires pattern"))?;
        let root = input
            .get("path")
            .and_then(Value::as_str)
            .map(|path| resolve_workspace_path(&self.cwd, path))
            .transpose()?
            .unwrap_or_else(|| self.cwd.clone());
        let mut matches = Vec::new();
        collect_grep_matches(&root, &self.cwd, pattern, &mut matches)?;
        Ok(text_output(
            if matches.is_empty() {
                "No matches".to_string()
            } else {
                matches.join("\n")
            },
            Some(json!({ "matches": matches.len() })),
        ))
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

fn collect_grep_matches(
    path: &Path,
    cwd: &Path,
    pattern: &str,
    matches: &mut Vec<String>,
) -> Result<()> {
    if matches.len() >= 100 {
        return Ok(());
    }
    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(|error| Error::tool("grep", error))? {
            collect_grep_matches(
                &entry.map_err(|error| Error::tool("grep", error))?.path(),
                cwd,
                pattern,
                matches,
            )?;
        }
        return Ok(());
    }
    if !path.is_file() {
        return Ok(());
    }
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(());
    };
    for (index, line) in content.lines().enumerate() {
        if line.contains(pattern) {
            let relative = path.strip_prefix(cwd).unwrap_or(path);
            matches.push(format!("{}:{}:{line}", relative.display(), index + 1));
            if matches.len() >= 100 {
                break;
            }
        }
    }
    Ok(())
}

#[derive(Clone)]
struct FindTool {
    cwd: PathBuf,
}

pub fn create_find_tool(cwd: &Path) -> Box<dyn Tool> {
    Box::new(FindTool {
        cwd: cwd.to_path_buf(),
    })
}

#[async_trait]
impl Tool for FindTool {
    fn name(&self) -> &str {
        "find"
    }

    fn label(&self) -> &str {
        "find"
    }

    fn description(&self) -> &str {
        "Find workspace files by name"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string" },
                "path": { "type": "string" }
            }
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let pattern = input
            .get("pattern")
            .or_else(|| input.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let root = input
            .get("path")
            .and_then(Value::as_str)
            .map(|path| resolve_workspace_path(&self.cwd, path))
            .transpose()?
            .unwrap_or_else(|| self.cwd.clone());
        let mut files = Vec::new();
        collect_find_matches(&root, &self.cwd, pattern, &mut files)?;
        Ok(text_output(
            if files.is_empty() {
                "No files found".to_string()
            } else {
                files.join("\n")
            },
            Some(json!({ "matches": files.len() })),
        ))
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

fn collect_find_matches(
    path: &Path,
    cwd: &Path,
    pattern: &str,
    matches: &mut Vec<String>,
) -> Result<()> {
    if matches.len() >= 1000 {
        return Ok(());
    }
    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(|error| Error::tool("find", error))? {
            collect_find_matches(
                &entry.map_err(|error| Error::tool("find", error))?.path(),
                cwd,
                pattern,
                matches,
            )?;
        }
        return Ok(());
    }
    if path.is_file() {
        let relative = path.strip_prefix(cwd).unwrap_or(path);
        let display = relative.display().to_string();
        if pattern.is_empty() || display.contains(pattern) {
            matches.push(display);
        }
    }
    Ok(())
}

#[derive(Clone)]
struct LsTool {
    cwd: PathBuf,
}

pub fn create_ls_tool(cwd: &Path) -> Box<dyn Tool> {
    Box::new(LsTool {
        cwd: cwd.to_path_buf(),
    })
}

#[async_trait]
impl Tool for LsTool {
    fn name(&self) -> &str {
        "ls"
    }

    fn label(&self) -> &str {
        "ls"
    }

    fn description(&self) -> &str {
        "List workspace directory entries"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            }
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let root = input
            .get("path")
            .and_then(Value::as_str)
            .map(|path| resolve_workspace_path(&self.cwd, path))
            .transpose()?
            .unwrap_or_else(|| self.cwd.clone());
        let mut entries = fs::read_dir(&root)
            .map_err(|error| Error::tool("ls", error))?
            .map(|entry| {
                let entry = entry.map_err(|error| Error::tool("ls", error))?;
                let mut name = entry.file_name().to_string_lossy().to_string();
                if entry.path().is_dir() {
                    name.push('/');
                }
                Ok(name)
            })
            .collect::<Result<Vec<_>>>()?;
        entries.sort();
        Ok(text_output(
            entries.join("\n"),
            Some(json!({ "entries": entries.len() })),
        ))
    }

    fn is_read_only(&self) -> bool {
        true
    }
}
