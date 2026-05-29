use super::*;

#[derive(Clone)]
pub(super) struct NotebookEditTool {
    runtime_root: PathBuf,
}

impl NotebookEditTool {
    pub(super) fn new(runtime_root: &Path) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
struct NotebookEditInput {
    notebook_path: String,
    cell_id: Option<String>,
    new_source: String,
    cell_type: Option<String>,
    edit_mode: Option<String>,
}

#[async_trait]
impl pi::sdk::Tool for NotebookEditTool {
    fn name(&self) -> &str {
        "NotebookEdit"
    }

    fn label(&self) -> &str {
        "NotebookEdit"
    }

    fn description(&self) -> &str {
        "Edit Jupyter notebook cells by replacing, inserting, or deleting cells in a .ipynb file."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "notebook_path": {
                    "type": "string",
                    "description": "Path to the Jupyter notebook file to edit."
                },
                "cell_id": {
                    "type": "string",
                    "description": "Cell id to edit, or a cell-N positional id. Insert mode inserts after this cell, or at the beginning when omitted."
                },
                "new_source": {
                    "type": "string",
                    "description": "The new source for the cell."
                },
                "cell_type": {
                    "type": "string",
                    "enum": ["code", "markdown"],
                    "description": "Cell type for insert mode or optional conversion during replace."
                },
                "edit_mode": {
                    "type": "string",
                    "enum": ["replace", "insert", "delete"],
                    "description": "Edit mode. Defaults to replace."
                }
            },
            "required": ["notebook_path", "new_source"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: NotebookEditInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        let output = edit_notebook(&self.runtime_root, input).map_err(|error| {
            pi::sdk::Error::tool("NotebookEdit", format!("Notebook edit failed: {error}"))
        })?;
        Ok(native_tool_output(output))
    }
}

fn edit_notebook(runtime_root: &Path, input: NotebookEditInput) -> Result<Value, String> {
    let edit_mode = input.edit_mode.as_deref().unwrap_or("replace");
    if !matches!(edit_mode, "replace" | "insert" | "delete") {
        return Err("edit_mode must be replace, insert, or delete".to_string());
    }
    let cell_type = input.cell_type.as_deref();
    if let Some(cell_type) = cell_type {
        if !matches!(cell_type, "code" | "markdown") {
            return Err("cell_type must be code or markdown".to_string());
        }
    }
    if edit_mode == "insert" && cell_type.is_none() {
        return Err("cell_type is required when using edit_mode=insert".to_string());
    }

    let path = resolve_notebook_path(runtime_root, &input.notebook_path)?;
    if path.extension().and_then(|value| value.to_str()) != Some("ipynb") {
        return Err("File must be a Jupyter notebook (.ipynb file)".to_string());
    }
    let original_file =
        fs::read_to_string(&path).map_err(|error| format!("failed to read notebook: {error}"))?;
    let mut notebook = serde_json::from_str::<Value>(&original_file)
        .map_err(|error| format!("Notebook is not valid JSON: {error}"))?;
    let language = notebook_language(&notebook);
    let uses_cell_ids = notebook_uses_cell_ids(&notebook);
    let cells = notebook
        .get_mut("cells")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Notebook JSON must contain a cells array".to_string())?;

    let mut cell_index = notebook_cell_index(cells, input.cell_id.as_deref())?;
    if input.cell_id.is_none() && edit_mode != "insert" {
        return Err("cell_id must be specified when not inserting a new cell".to_string());
    }
    if edit_mode == "insert" && input.cell_id.is_some() {
        cell_index += 1;
    }
    let mut effective_mode = edit_mode.to_string();
    if effective_mode == "replace" && cell_index == cells.len() {
        effective_mode = "insert".to_string();
    }
    if cell_index > cells.len() || (effective_mode != "insert" && cell_index >= cells.len()) {
        return Err(format!(
            "Cell index {cell_index} does not exist in notebook"
        ));
    }

    let (edited_cell_id, edited_cell_type) = match effective_mode.as_str() {
        "delete" => {
            let removed = cells.remove(cell_index);
            let removed_cell_type = removed
                .get("cell_type")
                .and_then(Value::as_str)
                .unwrap_or("code")
                .to_string();
            let removed_cell_id = removed
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(input.cell_id.clone());
            (removed_cell_id, removed_cell_type)
        }
        "insert" => {
            let new_cell_id = uses_cell_ids.then(|| notebook_cell_id(cells));
            let new_cell_type = cell_type.unwrap_or("code").to_string();
            let new_cell =
                new_notebook_cell(&new_cell_type, &input.new_source, new_cell_id.as_deref());
            cells.insert(cell_index, new_cell);
            (new_cell_id, new_cell_type)
        }
        "replace" => {
            let target = cells
                .get_mut(cell_index)
                .and_then(Value::as_object_mut)
                .ok_or_else(|| format!("Cell index {cell_index} is not an object"))?;
            target.insert(
                "source".to_string(),
                Value::String(input.new_source.clone()),
            );
            if target.get("cell_type").and_then(Value::as_str) == Some("code") {
                target.insert("execution_count".to_string(), Value::Null);
                target.insert("outputs".to_string(), Value::Array(Vec::new()));
            }
            if let Some(cell_type) = cell_type {
                target.insert(
                    "cell_type".to_string(),
                    Value::String(cell_type.to_string()),
                );
                if cell_type == "code" {
                    target
                        .entry("execution_count".to_string())
                        .or_insert(Value::Null);
                    target
                        .entry("outputs".to_string())
                        .or_insert_with(|| Value::Array(Vec::new()));
                }
            }
            let edited_cell_id = target
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .or(input.cell_id.clone());
            let edited_cell_type = target
                .get("cell_type")
                .and_then(Value::as_str)
                .unwrap_or("code")
                .to_string();
            (edited_cell_id, edited_cell_type)
        }
        _ => return Err("unsupported edit mode".to_string()),
    };

    let updated_file = format!(
        "{}\n",
        serde_json::to_string_pretty(&notebook)
            .map_err(|error| format!("failed to serialize notebook: {error}"))?
    );
    fs::write(&path, &updated_file)
        .map_err(|error| format!("failed to write notebook: {error}"))?;
    let text = match effective_mode.as_str() {
        "replace" => format!(
            "Updated cell {} with {}",
            edited_cell_id.as_deref().unwrap_or(""),
            input.new_source
        ),
        "insert" => format!(
            "Inserted cell {} with {}",
            edited_cell_id.as_deref().unwrap_or(""),
            input.new_source
        ),
        "delete" => format!("Deleted cell {}", edited_cell_id.as_deref().unwrap_or("")),
        _ => "Notebook edited".to_string(),
    };
    Ok(tool_envelope(
        text,
        json!({
            "new_source": input.new_source,
            "cell_id": edited_cell_id,
            "cell_type": edited_cell_type,
            "language": language,
            "edit_mode": effective_mode,
            "notebook_path": path.to_string_lossy(),
            "original_file": original_file,
            "updated_file": updated_file,
            "source": "rust-native"
        }),
        false,
    ))
}

fn resolve_notebook_path(runtime_root: &Path, raw_path: &str) -> Result<PathBuf, String> {
    let raw_path = raw_path.trim();
    if raw_path.is_empty() {
        return Err("notebook_path is required".to_string());
    }
    let root = runtime_root
        .canonicalize()
        .unwrap_or_else(|_| runtime_root.to_path_buf());
    let candidate = Path::new(raw_path);
    let path = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    if let Ok(canonical) = path.canonicalize() {
        if !canonical.starts_with(&root) {
            return Err("notebook_path escapes the runtime root".to_string());
        }
        return Ok(canonical);
    }
    if !path.starts_with(&root) {
        return Err("notebook_path escapes the runtime root".to_string());
    }
    Ok(path)
}

fn notebook_cell_index(cells: &[Value], cell_id: Option<&str>) -> Result<usize, String> {
    let Some(cell_id) = cell_id else {
        return Ok(0);
    };
    if let Some(index) = cells
        .iter()
        .position(|cell| cell.get("id").and_then(Value::as_str) == Some(cell_id))
    {
        return Ok(index);
    }
    if let Some(index) = parse_cell_index(cell_id) {
        return Ok(index);
    }
    Err(format!("Cell with ID \"{cell_id}\" not found in notebook"))
}

fn parse_cell_index(cell_id: &str) -> Option<usize> {
    cell_id.strip_prefix("cell-")?.parse::<usize>().ok()
}

fn notebook_language(notebook: &Value) -> String {
    notebook
        .get("metadata")
        .and_then(|metadata| metadata.get("language_info"))
        .and_then(|language_info| language_info.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("python")
        .to_string()
}

fn notebook_uses_cell_ids(notebook: &Value) -> bool {
    let nbformat = notebook
        .get("nbformat")
        .and_then(Value::as_u64)
        .unwrap_or(4);
    let nbformat_minor = notebook
        .get("nbformat_minor")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    nbformat > 4 || (nbformat == 4 && nbformat_minor >= 5)
}

fn notebook_cell_id(cells: &[Value]) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("crawclaw-{millis}-{}", cells.len())
}

fn new_notebook_cell(cell_type: &str, new_source: &str, cell_id: Option<&str>) -> Value {
    let mut object = serde_json::Map::new();
    object.insert(
        "cell_type".to_string(),
        Value::String(cell_type.to_string()),
    );
    if let Some(cell_id) = cell_id {
        object.insert("id".to_string(), Value::String(cell_id.to_string()));
    }
    object.insert(
        "metadata".to_string(),
        Value::Object(serde_json::Map::new()),
    );
    object.insert("source".to_string(), Value::String(new_source.to_string()));
    if cell_type == "code" {
        object.insert("execution_count".to_string(), Value::Null);
        object.insert("outputs".to_string(), Value::Array(Vec::new()));
    }
    Value::Object(object)
}
