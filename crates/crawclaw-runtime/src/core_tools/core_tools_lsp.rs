use super::*;
use std::io::{BufRead, BufReader};
use std::process::ChildStdout;
use std::sync::mpsc;

const LSP_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const LSP_MAX_FILE_SIZE_BYTES: u64 = 10_000_000;

#[derive(Clone, Debug)]
pub(super) struct LspTool {
    runtime_root: PathBuf,
}

#[derive(Clone, Debug)]
struct LspServerCommand {
    name: String,
    command: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    env: BTreeMap<String, String>,
    extensions: Vec<String>,
    language_ids: BTreeMap<String, String>,
    initialization_options: Option<Value>,
    settings: Option<Value>,
}

impl LspTool {
    pub(super) fn new(runtime_root: &Path) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
        }
    }
}

#[async_trait]
impl pi::sdk::Tool for LspTool {
    fn name(&self) -> &str {
        "LSP"
    }

    fn label(&self) -> &str {
        "LSP"
    }

    fn description(&self) -> &str {
        "Interact with Language Server Protocol (LSP) servers to get code intelligence features."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "description": "The LSP operation to perform",
                    "enum": [
                        "goToDefinition",
                        "findReferences",
                        "hover",
                        "documentSymbol",
                        "workspaceSymbol",
                        "goToImplementation",
                        "prepareCallHierarchy",
                        "incomingCalls",
                        "outgoingCalls"
                    ]
                },
                "filePath": {
                    "type": "string",
                    "description": "The absolute or relative path to the file"
                },
                "line": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "The line number (1-based, as shown in editors)"
                },
                "character": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "The character offset (1-based, as shown in editors)"
                }
            },
            "required": ["operation", "filePath", "line", "character"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let runtime_root = self.runtime_root.clone();
        let result = tokio::task::spawn_blocking(move || run_lsp_tool(&runtime_root, input))
            .await
            .map_err(|error| tool_error("LSP", format!("LSP task failed: {error}")))?
            .map_err(|error| tool_error("LSP", error))?;
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

fn run_lsp_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    require_lsp_keys(&input, &["operation", "filePath", "line", "character"])?;
    let operation = required_param_string("LSP", &input, &["operation"])?;
    if !is_lsp_operation(&operation) {
        return Err(format!("unsupported LSP operation: {operation}"));
    }
    let file_path = required_param_string("LSP", &input, &["filePath"])?;
    let line = positive_usize(&input, "line")?;
    let character = positive_usize(&input, "character")?;
    let absolute_path = resolve_lsp_path(runtime_root, &file_path)?;
    let metadata = fs::metadata(&absolute_path)
        .map_err(|error| format!("File does not exist: {file_path}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("Path is not a file: {file_path}"));
    }
    if metadata.len() > LSP_MAX_FILE_SIZE_BYTES {
        return Ok(lsp_output(
            &operation,
            &file_path,
            format!(
                "File too large for LSP analysis ({}MB exceeds 10MB limit)",
                (metadata.len() + 999_999) / 1_000_000
            ),
            0,
            0,
        ));
    }
    let Some(server) = select_lsp_server(runtime_root, &absolute_path) else {
        return Ok(lsp_output(
            &operation,
            &file_path,
            format!(
                "No LSP server available for file type: {}",
                absolute_path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| format!(".{value}"))
                    .unwrap_or_else(|| "<none>".to_string())
            ),
            0,
            0,
        ));
    };
    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("failed to read file for LSP didOpen: {error}"))?;
    call_lsp_server(
        runtime_root,
        &server,
        &operation,
        &absolute_path,
        &file_path,
        line,
        character,
        content,
    )
}

fn positive_usize(input: &Value, key: &str) -> Result<usize, String> {
    let value = input
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("LSP requires positive integer {key}"))?;
    if value == 0 {
        return Err(format!("LSP requires positive integer {key}"));
    }
    usize::try_from(value).map_err(|_| format!("LSP {key} is too large"))
}

fn require_lsp_keys(input: &Value, allowed_keys: &[&str]) -> Result<(), String> {
    let Some(object) = input.as_object() else {
        return Err("LSP input must be an object".to_string());
    };
    for key in object.keys() {
        if !allowed_keys.contains(&key.as_str()) {
            return Err(format!("LSP input contains unknown field: {key}"));
        }
    }
    Ok(())
}

fn is_lsp_operation(operation: &str) -> bool {
    matches!(
        operation,
        "goToDefinition"
            | "findReferences"
            | "hover"
            | "documentSymbol"
            | "workspaceSymbol"
            | "goToImplementation"
            | "prepareCallHierarchy"
            | "incomingCalls"
            | "outgoingCalls"
    )
}

fn resolve_lsp_path(runtime_root: &Path, raw_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw_path);
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        runtime_root.join(path)
    };
    path.canonicalize()
        .map_err(|error| format!("failed to resolve LSP path {raw_path}: {error}"))
}

fn select_lsp_server(runtime_root: &Path, file_path: &Path) -> Option<LspServerCommand> {
    let extension = file_path.extension().and_then(|value| value.to_str())?;
    let normalized_extension = extension.trim_start_matches('.').to_ascii_lowercase();
    configured_lsp_servers(runtime_root)
        .into_iter()
        .find(|server| {
            server
                .extensions
                .iter()
                .any(|ext| ext == &normalized_extension)
        })
        .or_else(|| builtin_lsp_server(&normalized_extension))
}

fn configured_lsp_servers(runtime_root: &Path) -> Vec<LspServerCommand> {
    let config_path = runtime_root.join("config").join("crawclaw.json");
    let Ok(raw) = fs::read_to_string(config_path) else {
        return Vec::new();
    };
    let Ok(config) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    let candidates = [
        config.get("lspServers"),
        config.pointer("/claudeCode/lspServers"),
        config.pointer("/tools/lsp/servers"),
    ];
    candidates
        .into_iter()
        .flatten()
        .flat_map(lsp_servers_from_value)
        .collect()
}

fn lsp_servers_from_value(value: &Value) -> Vec<LspServerCommand> {
    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(|item| lsp_server_from_value(None, item))
            .collect(),
        Value::Object(map) => map
            .iter()
            .filter_map(|(name, value)| lsp_server_from_value(Some(name), value))
            .collect(),
        _ => Vec::new(),
    }
}

fn lsp_server_from_value(name: Option<&str>, value: &Value) -> Option<LspServerCommand> {
    let command = value.get("command")?.as_str()?.trim();
    if command.is_empty() {
        return None;
    }
    if value
        .get("transport")
        .and_then(Value::as_str)
        .is_some_and(|transport| transport != "stdio")
    {
        return None;
    }
    let language_ids = lsp_extension_to_language(value);
    let mut extensions = value
        .get("extensions")
        .or_else(|| value.get("fileExtensions"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|value| value.trim().trim_start_matches('.').to_ascii_lowercase())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if extensions.is_empty() {
        extensions.extend(language_ids.keys().cloned());
    }
    if extensions.is_empty() {
        return None;
    }
    Some(LspServerCommand {
        name: name
            .map(ToOwned::to_owned)
            .or_else(|| string_param(value, &["name", "id"]))
            .unwrap_or_else(|| command.to_string()),
        command: command.to_string(),
        args: string_array_param(value, "args"),
        cwd: string_param(value, &["cwd", "workingDirectory", "workspaceFolder"])
            .map(PathBuf::from),
        env: string_map_param(value, "env"),
        extensions,
        language_ids,
        initialization_options: value.get("initializationOptions").cloned(),
        settings: value.get("settings").cloned(),
    })
}

fn lsp_extension_to_language(value: &Value) -> BTreeMap<String, String> {
    value
        .get("extensionToLanguage")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(extension, language)| {
                    let extension = extension
                        .trim()
                        .trim_start_matches('.')
                        .to_ascii_lowercase();
                    let language = language.as_str()?.trim().to_string();
                    (!extension.is_empty() && !language.is_empty()).then_some((extension, language))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn builtin_lsp_server(extension: &str) -> Option<LspServerCommand> {
    let (command, args, extensions) = match extension {
        "rs" if program_available("rust-analyzer") => ("rust-analyzer", Vec::new(), vec!["rs"]),
        "ts" | "tsx" | "js" | "jsx" if program_available("typescript-language-server") => (
            "typescript-language-server",
            vec!["--stdio"],
            vec!["ts", "tsx", "js", "jsx"],
        ),
        "py" if program_available("pyright-langserver") => {
            ("pyright-langserver", vec!["--stdio"], vec!["py"])
        }
        _ => return None,
    };
    Some(LspServerCommand {
        name: command.to_string(),
        command: command.to_string(),
        args: args.into_iter().map(ToOwned::to_owned).collect(),
        cwd: None,
        env: BTreeMap::new(),
        extensions: extensions.into_iter().map(ToOwned::to_owned).collect(),
        language_ids: BTreeMap::new(),
        initialization_options: None,
        settings: None,
    })
}

fn program_available(program: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|dir| dir.join(program).is_file())
}

fn string_array_param(input: &Value, key: &str) -> Vec<String> {
    input
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn string_map_param(input: &Value, key: &str) -> BTreeMap<String, String> {
    input
        .get(key)
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .map(|value| (key.clone(), value))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn call_lsp_server(
    runtime_root: &Path,
    server: &LspServerCommand,
    operation: &str,
    absolute_path: &Path,
    display_path: &str,
    line: usize,
    character: usize,
    content: String,
) -> Result<Value, String> {
    let root = server.cwd.as_deref().unwrap_or(runtime_root);
    let mut command = Command::new(&server.command);
    command
        .args(&server.args)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for (key, value) in &server.env {
        command.env(key, value);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start LSP server {}: {error}", server.name))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open LSP stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open LSP stdout".to_string())?;
    let receiver = spawn_lsp_reader(stdout);
    let document_uri = file_uri(absolute_path);
    let result = (|| {
        let mut initialize_params = json!({
            "processId": Value::Null,
            "rootUri": file_uri(root),
            "capabilities": {},
            "workspaceFolders": [{
                "uri": file_uri(root),
                "name": root.file_name().and_then(|value| value.to_str()).unwrap_or("workspace")
            }]
        });
        if let Some(options) = &server.initialization_options {
            initialize_params["initializationOptions"] = options.clone();
        }
        send_lsp_message(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": initialize_params
            }),
        )?;
        let _ = wait_for_lsp_response(&receiver, 1)?;
        send_lsp_message(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "method": "initialized",
                "params": {}
            }),
        )?;
        if let Some(settings) = &server.settings {
            send_lsp_message(
                &mut stdin,
                json!({
                    "jsonrpc": "2.0",
                    "method": "workspace/didChangeConfiguration",
                    "params": { "settings": settings }
                }),
            )?;
        }
        send_lsp_message(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": {
                    "textDocument": {
                        "uri": document_uri,
                        "languageId": language_id_for_server_path(server, absolute_path),
                        "version": 1,
                        "text": content
                    }
                }
            }),
        )?;
        let (method, params) = lsp_method_and_params(operation, &document_uri, line, character)?;
        send_lsp_message(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": method,
                "params": params
            }),
        )?;
        let mut result = lsp_result_from_response(wait_for_lsp_response(&receiver, 2)?)?;
        if matches!(operation, "incomingCalls" | "outgoingCalls") {
            let item = result
                .as_array()
                .and_then(|items| items.first())
                .cloned()
                .ok_or_else(|| "No call hierarchy item found at this position".to_string())?;
            let call_method = if operation == "incomingCalls" {
                "callHierarchy/incomingCalls"
            } else {
                "callHierarchy/outgoingCalls"
            };
            send_lsp_message(
                &mut stdin,
                json!({
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": call_method,
                    "params": { "item": item }
                }),
            )?;
            result = lsp_result_from_response(wait_for_lsp_response(&receiver, 3)?)?;
        }
        let formatted = format_lsp_result(operation, &result, root);
        let _ = send_lsp_message(
            &mut stdin,
            json!({ "jsonrpc": "2.0", "id": 4, "method": "shutdown", "params": Value::Null }),
        );
        let _ = send_lsp_message(
            &mut stdin,
            json!({ "jsonrpc": "2.0", "method": "exit", "params": Value::Null }),
        );
        Ok(lsp_output(
            operation,
            display_path,
            formatted.result,
            formatted.result_count,
            formatted.file_count,
        ))
    })();
    let _ = child.kill();
    result
}

fn language_id_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
    {
        "rs" => "rust",
        "ts" => "typescript",
        "tsx" => "typescriptreact",
        "js" => "javascript",
        "jsx" => "javascriptreact",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "rb" => "ruby",
        _ => "plaintext",
    }
}

fn language_id_for_server_path(server: &LspServerCommand, path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
        .unwrap_or_default();
    server
        .language_ids
        .get(&extension)
        .cloned()
        .unwrap_or_else(|| language_id_for_path(path).to_string())
}

fn lsp_method_and_params(
    operation: &str,
    uri: &str,
    line: usize,
    character: usize,
) -> Result<(&'static str, Value), String> {
    let position = json!({
        "line": line.saturating_sub(1),
        "character": character.saturating_sub(1)
    });
    let text_document = json!({ "uri": uri });
    let params = match operation {
        "goToDefinition" => json!({ "textDocument": text_document, "position": position }),
        "findReferences" => {
            json!({ "textDocument": text_document, "position": position, "context": { "includeDeclaration": true } })
        }
        "hover" => json!({ "textDocument": text_document, "position": position }),
        "documentSymbol" => json!({ "textDocument": text_document }),
        "workspaceSymbol" => json!({ "query": "" }),
        "goToImplementation" => json!({ "textDocument": text_document, "position": position }),
        "prepareCallHierarchy" | "incomingCalls" | "outgoingCalls" => {
            json!({ "textDocument": text_document, "position": position })
        }
        other => return Err(format!("unsupported LSP operation: {other}")),
    };
    let method = match operation {
        "goToDefinition" => "textDocument/definition",
        "findReferences" => "textDocument/references",
        "hover" => "textDocument/hover",
        "documentSymbol" => "textDocument/documentSymbol",
        "workspaceSymbol" => "workspace/symbol",
        "goToImplementation" => "textDocument/implementation",
        "prepareCallHierarchy" | "incomingCalls" | "outgoingCalls" => {
            "textDocument/prepareCallHierarchy"
        }
        _ => unreachable!("validated LSP operation"),
    };
    Ok((method, params))
}

fn send_lsp_message(stdin: &mut std::process::ChildStdin, message: Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(&message).map_err(|error| error.to_string())?;
    write!(stdin, "Content-Length: {}\r\n\r\n", bytes.len()).map_err(|error| error.to_string())?;
    stdin.write_all(&bytes).map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

fn spawn_lsp_reader(stdout: ChildStdout) -> mpsc::Receiver<Result<Value, String>> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let message = read_lsp_message(&mut reader);
            let done = message.is_err();
            if sender.send(message).is_err() || done {
                break;
            }
        }
    });
    receiver
}

fn read_lsp_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("LSP server closed stdout".to_string());
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("Content-Length") {
                content_length = value.trim().parse::<usize>().ok();
            }
        }
    }
    let length = content_length.ok_or_else(|| "LSP response missing Content-Length".to_string())?;
    let mut body = vec![0_u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&body).map_err(|error| format!("invalid LSP JSON: {error}"))
}

fn wait_for_lsp_response(
    receiver: &mpsc::Receiver<Result<Value, String>>,
    id: i64,
) -> Result<Value, String> {
    let deadline = Instant::now() + LSP_REQUEST_TIMEOUT;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(format!("LSP request {id} timed out"));
        }
        let timeout = deadline.saturating_duration_since(now);
        let message = receiver
            .recv_timeout(timeout)
            .map_err(|_| format!("LSP request {id} timed out"))??;
        if message.get("id").and_then(Value::as_i64) == Some(id) {
            return Ok(message);
        }
    }
}

fn lsp_result_from_response(response: Value) -> Result<Value, String> {
    if let Some(error) = response.get("error") {
        return Err(format!("LSP server returned error: {error}"));
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

struct FormattedLspResult {
    result: String,
    result_count: usize,
    file_count: usize,
}

fn format_lsp_result(operation: &str, result: &Value, root: &Path) -> FormattedLspResult {
    match operation {
        "goToDefinition" | "goToImplementation" => format_definition_like(result, root),
        "findReferences" => format_references(result, root),
        "hover" => format_hover(result),
        "documentSymbol" => format_document_symbols(result, root),
        "workspaceSymbol" => format_workspace_symbols(result, root),
        "prepareCallHierarchy" => format_call_hierarchy_items(result, root),
        "incomingCalls" => format_calls(result, root, "incoming"),
        "outgoingCalls" => format_calls(result, root, "outgoing"),
        _ => FormattedLspResult {
            result: serde_json::to_string_pretty(result).unwrap_or_else(|_| "null".to_string()),
            result_count: 0,
            file_count: 0,
        },
    }
}

fn format_definition_like(result: &Value, root: &Path) -> FormattedLspResult {
    let locations = locations_from_value(result);
    if locations.is_empty() {
        return FormattedLspResult {
            result: "No definition found. This may occur if the cursor is not on a symbol, or if the definition is in an external library not indexed by the LSP server.".to_string(),
            result_count: 0,
            file_count: 0,
        };
    }
    let lines = locations
        .iter()
        .map(|location| format!("  {}", format_location(location, root)))
        .collect::<Vec<_>>();
    let result = if lines.len() == 1 {
        format!("Defined in {}", lines[0].trim())
    } else {
        format!("Found {} definitions:\n{}", lines.len(), lines.join("\n"))
    };
    FormattedLspResult {
        result,
        result_count: locations.len(),
        file_count: unique_location_files(&locations),
    }
}

fn format_references(result: &Value, root: &Path) -> FormattedLspResult {
    let locations = locations_from_value(result);
    if locations.is_empty() {
        return FormattedLspResult {
            result: "No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.".to_string(),
            result_count: 0,
            file_count: 0,
        };
    }
    if locations.len() == 1 {
        return FormattedLspResult {
            result: format!(
                "Found 1 reference:\n  {}",
                format_location(&locations[0], root)
            ),
            result_count: 1,
            file_count: 1,
        };
    }
    let mut by_file: BTreeMap<String, Vec<&LspLocation>> = BTreeMap::new();
    for location in &locations {
        by_file
            .entry(display_uri(&location.uri, root))
            .or_default()
            .push(location);
    }
    let mut lines = vec![format!(
        "Found {} references across {} files:",
        locations.len(),
        by_file.len()
    )];
    for (file, file_locations) in &by_file {
        lines.push(format!("\n{file}:"));
        for location in file_locations {
            lines.push(format!(
                "  Line {}:{}",
                location.line + 1,
                location.character + 1
            ));
        }
    }
    FormattedLspResult {
        result: lines.join("\n"),
        result_count: locations.len(),
        file_count: by_file.len(),
    }
}

fn format_hover(result: &Value) -> FormattedLspResult {
    let Some(contents) = result.get("contents") else {
        return FormattedLspResult {
            result: "No hover information available. This may occur if the cursor is not on a symbol, or if the LSP server has not fully indexed the file.".to_string(),
            result_count: 0,
            file_count: 0,
        };
    };
    let content = markup_text(contents);
    let result = result
        .get("range")
        .and_then(|range| range_start(range))
        .map(|(line, character)| {
            format!("Hover info at {}:{}:\n\n{content}", line + 1, character + 1)
        })
        .unwrap_or(content);
    FormattedLspResult {
        result,
        result_count: 1,
        file_count: 1,
    }
}

fn format_document_symbols(result: &Value, root: &Path) -> FormattedLspResult {
    let Some(symbols) = result.as_array() else {
        return FormattedLspResult {
            result: "No symbols found in document. This may occur if the file is empty, not supported by the LSP server, or if the server has not fully indexed the file.".to_string(),
            result_count: 0,
            file_count: 0,
        };
    };
    if symbols.is_empty() {
        return FormattedLspResult {
            result: "No symbols found in document. This may occur if the file is empty, not supported by the LSP server, or if the server has not fully indexed the file.".to_string(),
            result_count: 0,
            file_count: 0,
        };
    }
    if symbols
        .first()
        .and_then(|symbol| symbol.get("location"))
        .is_some()
    {
        return format_workspace_symbols(result, root);
    }
    let mut lines = vec!["Document symbols:".to_string()];
    let mut count = 0;
    for symbol in symbols {
        count += push_document_symbol_lines(symbol, 0, &mut lines);
    }
    FormattedLspResult {
        result: lines.join("\n"),
        result_count: count,
        file_count: 1,
    }
}

fn push_document_symbol_lines(symbol: &Value, indent: usize, lines: &mut Vec<String>) -> usize {
    let name = symbol
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("<unnamed>");
    let kind = symbol
        .get("kind")
        .and_then(Value::as_u64)
        .map(symbol_kind)
        .unwrap_or("Unknown");
    let line = symbol
        .get("range")
        .or_else(|| symbol.pointer("/location/range"))
        .and_then(range_start)
        .map(|(line, _)| line + 1)
        .unwrap_or(0);
    let detail = symbol
        .get("detail")
        .and_then(Value::as_str)
        .filter(|detail| !detail.is_empty())
        .map(|detail| format!(" {detail}"))
        .unwrap_or_default();
    lines.push(format!(
        "{}{} ({}){} - Line {}",
        "  ".repeat(indent),
        name,
        kind,
        detail,
        line
    ));
    let mut count = 1;
    if let Some(children) = symbol.get("children").and_then(Value::as_array) {
        for child in children {
            count += push_document_symbol_lines(child, indent + 1, lines);
        }
    }
    count
}

fn format_workspace_symbols(result: &Value, root: &Path) -> FormattedLspResult {
    let symbols = result.as_array().cloned().unwrap_or_default();
    let symbols = symbols
        .into_iter()
        .filter(|symbol| {
            symbol
                .pointer("/location/uri")
                .and_then(Value::as_str)
                .is_some()
        })
        .collect::<Vec<_>>();
    if symbols.is_empty() {
        return FormattedLspResult {
            result: "No symbols found in workspace. This may occur if the workspace is empty, or if the LSP server has not finished indexing the project.".to_string(),
            result_count: 0,
            file_count: 0,
        };
    }
    let mut by_file: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for symbol in symbols {
        let uri = symbol
            .pointer("/location/uri")
            .and_then(Value::as_str)
            .unwrap_or("");
        by_file
            .entry(display_uri(uri, root))
            .or_default()
            .push(symbol);
    }
    let total = by_file.values().map(Vec::len).sum::<usize>();
    let mut lines = vec![format!(
        "Found {total} {} in workspace:",
        lsp_plural_word(total, "symbol")
    )];
    for (file, symbols) in &by_file {
        lines.push(format!("\n{file}:"));
        for symbol in symbols {
            let name = symbol
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("<unnamed>");
            let kind = symbol
                .get("kind")
                .and_then(Value::as_u64)
                .map(symbol_kind)
                .unwrap_or("Unknown");
            let line = symbol
                .pointer("/location/range")
                .and_then(range_start)
                .map(|(line, _)| line + 1)
                .unwrap_or(0);
            let container = symbol
                .get("containerName")
                .and_then(Value::as_str)
                .filter(|container| !container.is_empty())
                .map(|container| format!(" in {container}"))
                .unwrap_or_default();
            lines.push(format!("  {name} ({kind}) - Line {line}{container}"));
        }
    }
    FormattedLspResult {
        result: lines.join("\n"),
        result_count: total,
        file_count: by_file.len(),
    }
}

fn format_call_hierarchy_items(result: &Value, root: &Path) -> FormattedLspResult {
    let items = result.as_array().cloned().unwrap_or_default();
    if items.is_empty() {
        return FormattedLspResult {
            result: "No call hierarchy item found at this position".to_string(),
            result_count: 0,
            file_count: 0,
        };
    }
    let lines = items
        .iter()
        .map(|item| format!("  {}", format_call_item(item, root)))
        .collect::<Vec<_>>();
    let result = if lines.len() == 1 {
        format!("Call hierarchy item: {}", lines[0].trim())
    } else {
        format!(
            "Found {} call hierarchy items:\n{}",
            lines.len(),
            lines.join("\n")
        )
    };
    let file_count = unique_uris(
        items
            .iter()
            .filter_map(|item| item.get("uri").and_then(Value::as_str)),
    );
    FormattedLspResult {
        result,
        result_count: items.len(),
        file_count,
    }
}

fn format_calls(result: &Value, root: &Path, direction: &str) -> FormattedLspResult {
    let calls = result.as_array().cloned().unwrap_or_default();
    if calls.is_empty() {
        let result = if direction == "incoming" {
            "No incoming calls found (nothing calls this function)"
        } else {
            "No outgoing calls found (this function calls nothing)"
        };
        return FormattedLspResult {
            result: result.to_string(),
            result_count: 0,
            file_count: 0,
        };
    }
    let key = if direction == "incoming" {
        "from"
    } else {
        "to"
    };
    let mut lines = vec![format!(
        "Found {} {direction} {}:",
        calls.len(),
        lsp_plural_word(calls.len(), "call")
    )];
    let mut by_file: BTreeMap<String, Vec<&Value>> = BTreeMap::new();
    for call in &calls {
        if let Some(item) = call.get(key) {
            let uri = item.get("uri").and_then(Value::as_str).unwrap_or("");
            by_file
                .entry(display_uri(uri, root))
                .or_default()
                .push(call);
        }
    }
    for (file, file_calls) in &by_file {
        lines.push(format!("\n{file}:"));
        for call in file_calls {
            if let Some(item) = call.get(key) {
                lines.push(format_call_line(item, call, direction));
            }
        }
    }
    let file_count = by_file.len();
    FormattedLspResult {
        result: lines.join("\n"),
        result_count: calls.len(),
        file_count,
    }
}

fn lsp_plural_word(count: usize, singular: &str) -> String {
    if count == 1 {
        singular.to_string()
    } else {
        format!("{singular}s")
    }
}

fn format_call_line(item: &Value, call: &Value, direction: &str) -> String {
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("<unnamed>");
    let kind = item
        .get("kind")
        .and_then(Value::as_u64)
        .map(symbol_kind)
        .unwrap_or("Unknown");
    let line = item
        .get("range")
        .and_then(range_start)
        .map(|(line, _)| line + 1)
        .unwrap_or(0);
    let mut line = format!("  {name} ({kind}) - Line {line}");
    let call_sites = call_sites_text(call);
    if !call_sites.is_empty() {
        let label = if direction == "incoming" {
            "calls at"
        } else {
            "called from"
        };
        line.push_str(&format!(" [{label}: {call_sites}]"));
    }
    line
}

fn call_sites_text(call: &Value) -> String {
    call.get("fromRanges")
        .and_then(Value::as_array)
        .map(|ranges| {
            ranges
                .iter()
                .filter_map(range_start)
                .map(|(line, character)| format!("{}:{}", line + 1, character + 1))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}

fn format_call_item(item: &Value, root: &Path) -> String {
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("<unnamed>");
    let kind = item
        .get("kind")
        .and_then(Value::as_u64)
        .map(symbol_kind)
        .unwrap_or("Unknown");
    let Some(uri) = item.get("uri").and_then(Value::as_str) else {
        return format!("{name} ({kind}) - <unknown location>");
    };
    let line = item
        .get("range")
        .and_then(range_start)
        .map(|(line, _)| line + 1)
        .unwrap_or(0);
    let mut result = format!("{name} ({kind}) - {}:{line}", display_uri(uri, root));
    if let Some(detail) = item
        .get("detail")
        .and_then(Value::as_str)
        .filter(|detail| !detail.is_empty())
    {
        result.push_str(&format!(" [{detail}]"));
    }
    result
}

#[derive(Clone)]
struct LspLocation {
    uri: String,
    line: usize,
    character: usize,
}

fn locations_from_value(value: &Value) -> Vec<LspLocation> {
    let values = value.as_array().cloned().unwrap_or_else(|| {
        if value.is_null() {
            Vec::new()
        } else {
            vec![value.clone()]
        }
    });
    values
        .into_iter()
        .filter_map(|value| {
            if let Some(uri) = value.get("uri").and_then(Value::as_str) {
                let (line, character) = value.get("range").and_then(range_start).unwrap_or((0, 0));
                return Some(LspLocation {
                    uri: uri.to_string(),
                    line,
                    character,
                });
            }
            let uri = value.get("targetUri").and_then(Value::as_str)?;
            let (line, character) = value
                .get("targetSelectionRange")
                .or_else(|| value.get("targetRange"))
                .and_then(range_start)
                .unwrap_or((0, 0));
            Some(LspLocation {
                uri: uri.to_string(),
                line,
                character,
            })
        })
        .collect()
}

fn range_start(range: &Value) -> Option<(usize, usize)> {
    let line = usize::try_from(range.pointer("/start/line")?.as_u64()?).ok()?;
    let character = usize::try_from(range.pointer("/start/character")?.as_u64()?).ok()?;
    Some((line, character))
}

fn format_location(location: &LspLocation, root: &Path) -> String {
    format!(
        "{}:{}:{}",
        display_uri(&location.uri, root),
        location.line + 1,
        location.character + 1
    )
}

fn unique_location_files(locations: &[LspLocation]) -> usize {
    locations
        .iter()
        .map(|location| location.uri.as_str())
        .collect::<BTreeSet<_>>()
        .len()
}

fn unique_uris<'a>(uris: impl Iterator<Item = &'a str>) -> usize {
    uris.collect::<BTreeSet<_>>().len()
}

fn markup_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(markup_text)
            .collect::<Vec<_>>()
            .join("\n\n"),
        Value::Object(object) => object
            .get("value")
            .and_then(Value::as_str)
            .or_else(|| object.get("language").and_then(Value::as_str))
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

fn symbol_kind(kind: u64) -> &'static str {
    match kind {
        1 => "File",
        2 => "Module",
        3 => "Namespace",
        4 => "Package",
        5 => "Class",
        6 => "Method",
        7 => "Property",
        8 => "Field",
        9 => "Constructor",
        10 => "Enum",
        11 => "Interface",
        12 => "Function",
        13 => "Variable",
        14 => "Constant",
        15 => "String",
        16 => "Number",
        17 => "Boolean",
        18 => "Array",
        19 => "Object",
        20 => "Key",
        21 => "Null",
        22 => "EnumMember",
        23 => "Struct",
        24 => "Event",
        25 => "Operator",
        26 => "TypeParameter",
        _ => "Unknown",
    }
}

fn lsp_output(
    operation: &str,
    file_path: &str,
    result: String,
    result_count: usize,
    file_count: usize,
) -> Value {
    tool_envelope(
        result.clone(),
        json!({
            "operation": operation,
            "result": result,
            "filePath": file_path,
            "resultCount": result_count,
            "fileCount": file_count
        }),
        false,
    )
}

fn file_uri(path: &Path) -> String {
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    format!("file://{}", percent_encode_path(&path.to_string_lossy()))
}

fn display_uri(uri: &str, root: &Path) -> String {
    let path = uri.strip_prefix("file://").unwrap_or(uri);
    let decoded = percent_decode(path);
    let path = PathBuf::from(decoded);
    if let Ok(relative) = path.strip_prefix(root) {
        let relative = relative.to_string_lossy().replace('\\', "/");
        if !relative.is_empty() {
            return relative;
        }
    }
    path.to_string_lossy().replace('\\', "/")
}

fn percent_encode_path(path: &str) -> String {
    let mut out = String::new();
    for byte in path.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '/' | '-' | '_' | '.' | '~' | ':') {
            out.push(ch);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| value.to_string())
}
