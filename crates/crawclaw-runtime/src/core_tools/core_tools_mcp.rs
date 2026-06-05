use super::*;
use futures::{SinkExt, StreamExt};
use std::collections::BTreeSet;
use std::io::{BufRead, BufReader};
use std::sync::mpsc;
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest,
    http::{HeaderName, HeaderValue},
    Message,
};

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const MCP_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);
const MCP_CALL_TIMEOUT: Duration = Duration::from_secs(60);
const MCP_HEADERS_HELPER_TIMEOUT: Duration = Duration::from_secs(10);
const MCP_NOTIFICATION_GRACE: Duration = Duration::from_millis(200);
const MCP_STREAMABLE_HTTP_ACCEPT: &str = "application/json, text/event-stream";
const MCP_STDIO_MAX_STDERR_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug)]
enum McpTransport {
    Stdio(McpStdioCommand),
    Http(McpHttpEndpoint),
    Sse(McpHttpEndpoint),
    Ws(McpHttpEndpoint),
}

#[derive(Clone, Debug)]
struct McpStdioCommand {
    program: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    env: BTreeMap<String, String>,
}

#[derive(Clone, Debug)]
struct McpHttpEndpoint {
    url: String,
    headers: BTreeMap<String, String>,
}

struct McpHttpResponse {
    value: Value,
    session_id: Option<String>,
}

struct McpSseStream {
    response: reqwest::Response,
    buffer: String,
}

struct McpSseEvent {
    event: Option<String>,
    data: String,
}

#[derive(Debug, Deserialize)]
struct CrawClawMcpConfig {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: Option<BTreeMap<String, McpServerConfig>>,
    #[serde(default, rename = "disabledMcpServers")]
    disabled_mcp_servers: BTreeSet<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpServerConfig {
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    cwd: Option<PathBuf>,
    #[serde(default)]
    working_directory: Option<PathBuf>,
    #[serde(default)]
    env: BTreeMap<String, String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    headers_helper: Option<String>,
    #[serde(default)]
    auth_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct McpToolListResult {
    #[serde(default)]
    tools: Vec<McpToolSchema>,
}

#[derive(Debug, Deserialize)]
struct McpPromptListResult {
    #[serde(default)]
    prompts: Vec<McpPromptSchema>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpPromptSchema {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    arguments: Vec<McpPromptArgumentSchema>,
}

#[derive(Debug, Deserialize)]
struct McpPromptArgumentSchema {
    name: String,
}

#[derive(Debug, Deserialize)]
struct McpResourceListResult {
    #[serde(default)]
    resources: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpToolSchema {
    #[serde(default)]
    annotations: Option<McpToolAnnotations>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpToolAnnotations {
    #[serde(default)]
    read_only_hint: Option<bool>,
}

#[derive(Clone, Copy, Debug)]
pub(super) enum McpResourceToolKind {
    List,
    Read,
}

impl McpResourceToolKind {
    fn name(self) -> &'static str {
        match self {
            Self::List => "ListMcpResourcesTool",
            Self::Read => "ReadMcpResourceTool",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::List => "Lists available resources from configured MCP servers.",
            Self::Read => "Reads a specific resource from an MCP server.",
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::List => json!({
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "description": "Optional server name to filter resources by"
                    }
                },
                "additionalProperties": false
            }),
            Self::Read => json!({
                "type": "object",
                "properties": {
                    "server": {
                        "type": "string",
                        "description": "The MCP server name"
                    },
                    "uri": {
                        "type": "string",
                        "description": "The resource URI to read"
                    }
                },
                "required": ["server", "uri"],
                "additionalProperties": false
            }),
        }
    }
}

fn require_mcp_resource_tool_keys(
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

#[derive(Clone, Debug)]
pub(super) struct McpResourceTool {
    runtime_root: PathBuf,
    kind: McpResourceToolKind,
}

impl McpResourceTool {
    pub(super) fn new(runtime_root: &Path, kind: McpResourceToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

#[async_trait]
impl pi::sdk::Tool for McpResourceTool {
    fn name(&self) -> &str {
        self.kind.name()
    }

    fn label(&self) -> &str {
        self.kind.name()
    }

    fn description(&self) -> &str {
        self.kind.description()
    }

    fn parameters(&self) -> Value {
        self.kind.parameters()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        match self.kind {
            McpResourceToolKind::List => {
                let value = list_mcp_resources(&self.runtime_root, input)
                    .await
                    .map_err(|error| tool_error(self.kind.name(), error))?;
                Ok(mcp_resource_list_output(value))
            }
            McpResourceToolKind::Read => {
                let server_name = string_param(&input, &["server"]).ok_or_else(|| {
                    tool_error(self.kind.name(), "ReadMcpResourceTool requires server")
                })?;
                let value = read_mcp_resource(&self.runtime_root, input)
                    .await
                    .map_err(|error| tool_error(self.kind.name(), error))?;
                Ok(mcp_resource_read_output(
                    &self.runtime_root,
                    &server_name,
                    value,
                ))
            }
        }
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

async fn list_mcp_resources(runtime_root: &Path, input: Value) -> Result<Value, String> {
    require_mcp_resource_tool_keys(&input, &["server"], "ListMcpResourcesTool")?;
    let target_server = string_param(&input, &["server"]);
    let servers = configured_mcp_transports(runtime_root);
    let selected = select_mcp_servers(&servers, target_server.as_deref())?;
    let mut resources = Vec::new();
    for (server_name, transport) in selected {
        let response = match call_mcp_transport(
            &server_name,
            &transport,
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "resources/list",
                "params": {}
            }),
            MCP_CALL_TIMEOUT,
            2,
        )
        .await
        {
            Ok(response) => response,
            Err(_) => continue,
        };
        let result = match response_result(response, &server_name, "resources/list") {
            Ok(result) => result,
            Err(_) => continue,
        };
        let Some(items) = result.get("resources").and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            let mut item = item.clone();
            if let Some(object) = item.as_object_mut() {
                object.insert("server".to_string(), Value::String(server_name.clone()));
                resources.push(Value::Object(object.clone()));
            }
        }
    }
    Ok(Value::Array(resources))
}

async fn read_mcp_resource(runtime_root: &Path, input: Value) -> Result<Value, String> {
    require_mcp_resource_tool_keys(&input, &["server", "uri"], "ReadMcpResourceTool")?;
    let server_name = string_param(&input, &["server"])
        .ok_or_else(|| "ReadMcpResourceTool requires server".to_string())?;
    let uri = string_param(&input, &["uri"])
        .ok_or_else(|| "ReadMcpResourceTool requires uri".to_string())?;
    let servers = configured_mcp_transports(runtime_root);
    let transport = servers
        .get(&server_name)
        .ok_or_else(|| format!("MCP server \"{server_name}\" not found"))?;
    let response = call_mcp_transport(
        &server_name,
        transport,
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "resources/read",
            "params": {
                "uri": uri
            }
        }),
        MCP_CALL_TIMEOUT,
        2,
    )
    .await?;
    response_result(response, &server_name, "resources/read")
}

fn select_mcp_servers(
    servers: &BTreeMap<String, McpTransport>,
    target_server: Option<&str>,
) -> Result<Vec<(String, McpTransport)>, String> {
    if let Some(target_server) = target_server {
        let transport = servers
            .get(target_server)
            .ok_or_else(|| format!("MCP server \"{target_server}\" not found"))?;
        return Ok(vec![(target_server.to_string(), transport.clone())]);
    }
    Ok(servers
        .iter()
        .map(|(server_name, transport)| (server_name.clone(), transport.clone()))
        .collect())
}

fn configured_mcp_transports(runtime_root: &Path) -> BTreeMap<String, McpTransport> {
    let Some(config) = read_mcp_config(runtime_root) else {
        return BTreeMap::new();
    };
    let disabled_mcp_servers = config.disabled_mcp_servers;
    config
        .mcp_servers
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(server_name, server)| {
            if disabled_mcp_servers.contains(&server_name) {
                return None;
            }
            mcp_transport_for_runtime(runtime_root, &server_name, server)
                .map(|transport| (server_name, transport))
        })
        .collect()
}

fn read_mcp_config(runtime_root: &Path) -> Option<CrawClawMcpConfig> {
    let mut merged = CrawClawMcpConfig {
        mcp_servers: None,
        disabled_mcp_servers: BTreeSet::new(),
    };
    let mut saw_config = false;
    for path in [
        runtime_root.join(".mcp.json"),
        runtime_root.join("config").join("crawclaw.json"),
    ] {
        let Some(config) = read_mcp_config_file(&path) else {
            continue;
        };
        saw_config = true;
        merge_mcp_config(&mut merged, config);
    }
    saw_config.then_some(merged)
}

pub fn mcp_prompt_slash_commands(runtime_root: &Path) -> Vec<Value> {
    let Some(config) = read_mcp_config(runtime_root) else {
        return Vec::new();
    };
    let disabled_mcp_servers = config.disabled_mcp_servers;
    config
        .mcp_servers
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(server_name, server)| {
            if disabled_mcp_servers.contains(&server_name) {
                return None;
            }
            let transport = mcp_transport_for_runtime(runtime_root, &server_name, server)?;
            Some((server_name, transport))
        })
        .flat_map(|(server_name, transport)| {
            list_mcp_prompts(&server_name, &transport)
                .map(|result| {
                    result
                        .prompts
                        .into_iter()
                        .filter_map(move |prompt| mcp_prompt_slash_command(&server_name, prompt))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        })
        .collect()
}

fn mcp_prompt_slash_command(server_name: &str, prompt: McpPromptSchema) -> Option<Value> {
    let name = mcp_exposed_tool_name(server_name, &prompt.name);
    if name.is_empty() {
        return None;
    }
    let argument_hint = prompt
        .arguments
        .into_iter()
        .map(|argument| argument.name.trim().to_string())
        .filter(|name| !name.is_empty())
        .map(|name| format!("<{name}>"))
        .collect::<Vec<_>>()
        .join(" ");
    Some(json!({
        "name": name,
        "description": prompt.description.unwrap_or_else(|| {
            format!("Run MCP prompt {} from server {}.", prompt.name, server_name)
        }),
        "argumentHint": argument_hint
    }))
}

pub fn mcp_server_runtime_statuses(runtime_root: &Path) -> Vec<Value> {
    let Some(config) = read_mcp_config(runtime_root) else {
        return Vec::new();
    };
    let disabled_mcp_servers = config.disabled_mcp_servers;
    config
        .mcp_servers
        .unwrap_or_default()
        .into_iter()
        .map(|(server_name, server)| {
            if disabled_mcp_servers.contains(&server_name) {
                return json!({
                    "name": server_name,
                    "status": "disabled",
                    "toolCount": 0,
                    "readOnlyToolCount": 0
                });
            }
            if server.r#type.as_deref() == Some("sdk") {
                return json!({
                    "name": server_name,
                    "status": "pending",
                    "toolCount": 0,
                    "readOnlyToolCount": 0,
                    "promptCount": 0,
                    "resourceCount": 0
                });
            }
            let Some(transport) = mcp_transport_for_runtime(runtime_root, &server_name, server)
            else {
                return json!({
                    "name": server_name,
                    "status": "failed",
                    "toolCount": 0,
                    "readOnlyToolCount": 0,
                    "error": "unsupported or incomplete MCP transport config"
                });
            };
            mcp_runtime_status_for_transport(&server_name, &transport)
        })
        .collect()
}

pub(super) fn pending_mcp_server_names(runtime_root: &Path) -> Vec<String> {
    let Some(config) = read_mcp_config(runtime_root) else {
        return Vec::new();
    };
    let disabled_mcp_servers = config.disabled_mcp_servers;
    let mut names = config
        .mcp_servers
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(server_name, server)| {
            if disabled_mcp_servers.contains(&server_name)
                || server.r#type.as_deref() != Some("sdk")
            {
                None
            } else {
                Some(server_name)
            }
        })
        .collect::<Vec<_>>();
    names.sort();
    names
}

fn mcp_runtime_status_for_transport(server_name: &str, transport: &McpTransport) -> Value {
    let mut errors = Vec::new();
    let mut saw_auth_required = false;
    let tools = match list_mcp_tools(server_name, transport) {
        Ok(result) => Some(result),
        Err(error) => {
            saw_auth_required |= mcp_error_indicates_auth_required(&error);
            errors.push(error);
            None
        }
    };
    let prompts = match list_mcp_prompts(server_name, transport) {
        Ok(result) => Some(result),
        Err(error) => {
            saw_auth_required |= mcp_error_indicates_auth_required(&error);
            errors.push(error);
            None
        }
    };
    let resources = match list_mcp_resource_items(server_name, transport) {
        Ok(result) => Some(result),
        Err(error) => {
            saw_auth_required |= mcp_error_indicates_auth_required(&error);
            errors.push(error);
            None
        }
    };
    if tools.is_some() || prompts.is_some() || resources.is_some() {
        let tool_count = tools.as_ref().map(|result| result.tools.len()).unwrap_or(0);
        let read_only_tool_count = tools
            .as_ref()
            .map(|result| {
                result
                    .tools
                    .iter()
                    .filter(|tool| {
                        tool.annotations
                            .as_ref()
                            .and_then(|annotations| annotations.read_only_hint)
                            .unwrap_or(false)
                    })
                    .count()
            })
            .unwrap_or(0);
        return json!({
            "name": server_name,
            "status": "connected",
            "toolCount": tool_count,
            "readOnlyToolCount": read_only_tool_count,
            "promptCount": prompts.as_ref().map(|result| result.prompts.len()).unwrap_or(0),
            "resourceCount": resources.as_ref().map(|result| result.resources.len()).unwrap_or(0)
        });
    }
    let error = errors
        .first()
        .map(|error| truncate_mcp_error(error))
        .unwrap_or_else(|| "MCP discovery returned no capabilities".to_string());
    if saw_auth_required {
        return json!({
            "name": server_name,
            "status": "needs-auth",
            "toolCount": 0,
            "readOnlyToolCount": 0,
            "promptCount": 0,
            "resourceCount": 0,
            "error": error
        });
    }
    json!({
        "name": server_name,
        "status": "failed",
        "toolCount": 0,
        "readOnlyToolCount": 0,
        "promptCount": 0,
        "resourceCount": 0,
        "error": error
    })
}

pub async fn send_mcp_jsonrpc_message(
    runtime_root: &Path,
    server_name: &str,
    message: Value,
) -> Result<Option<Value>, String> {
    let config = read_mcp_config(runtime_root)
        .ok_or_else(|| "MCP config not found in runtime config".to_string())?;
    if config.disabled_mcp_servers.contains(server_name) {
        return Err(format!("MCP server \"{server_name}\" is disabled"));
    }
    let server = config
        .mcp_servers
        .unwrap_or_default()
        .remove(server_name)
        .ok_or_else(|| format!("MCP server \"{server_name}\" not found"))?;
    let transport = mcp_transport_for_runtime(runtime_root, server_name, server)
        .ok_or_else(|| format!("MCP server \"{server_name}\" has no supported transport"))?;
    if let Some(response_id) = message.get("id").and_then(Value::as_u64) {
        return call_mcp_transport(
            server_name,
            &transport,
            message,
            MCP_CALL_TIMEOUT,
            response_id,
        )
        .await
        .map(Some);
    }
    send_mcp_transport_notification(server_name, &transport, message).await?;
    Ok(None)
}

fn read_mcp_config_file(path: &Path) -> Option<CrawClawMcpConfig> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<CrawClawMcpConfig>(&raw).ok()
}

fn merge_mcp_config(target: &mut CrawClawMcpConfig, source: CrawClawMcpConfig) {
    target
        .disabled_mcp_servers
        .extend(source.disabled_mcp_servers);
    let Some(source_servers) = source.mcp_servers else {
        return;
    };
    target
        .mcp_servers
        .get_or_insert_with(BTreeMap::new)
        .extend(source_servers);
}

fn mcp_transport_for_runtime(
    runtime_root: &Path,
    server_name: &str,
    server: McpServerConfig,
) -> Option<McpTransport> {
    let mut transport = mcp_transport(server_name, server)?;
    if let McpTransport::Stdio(command) = &mut transport {
        if command.cwd.is_none() {
            command.cwd = Some(runtime_root.to_path_buf());
        }
    }
    apply_stored_mcp_oauth_headers(runtime_root, server_name, &mut transport);
    Some(transport)
}

fn mcp_transport(server_name: &str, server: McpServerConfig) -> Option<McpTransport> {
    if let Some(url) = server.url {
        let kind = server.r#type.as_deref().unwrap_or("http");
        let url = expand_mcp_env_vars(&url).trim().to_string();
        if url.is_empty() {
            return None;
        }
        let mut endpoint = McpHttpEndpoint {
            headers: mcp_http_headers(
                server_name,
                &url,
                server.headers,
                server.headers_helper.as_deref(),
            ),
            url,
        };
        if kind == "ws-ide" {
            if let Some(auth_token) = server.auth_token {
                endpoint.headers.insert(
                    "X-Claude-Code-Ide-Authorization".to_string(),
                    expand_mcp_env_vars(&auth_token),
                );
            }
        }
        return match kind {
            "http" => Some(McpTransport::Http(endpoint)),
            "sse" | "sse-ide" => Some(McpTransport::Sse(endpoint)),
            "ws" | "ws-ide" => Some(McpTransport::Ws(endpoint)),
            _ => None,
        };
    }
    if server.r#type.as_deref().is_some_and(|kind| kind != "stdio") {
        return None;
    }
    let program = expand_mcp_env_vars(server.command?.trim())
        .trim()
        .to_string();
    if program.is_empty() {
        return None;
    }
    Some(McpTransport::Stdio(McpStdioCommand {
        program,
        args: server
            .args
            .into_iter()
            .map(|arg| expand_mcp_env_vars(&arg))
            .collect(),
        cwd: server.cwd.or(server.working_directory),
        env: expand_mcp_env_map(server.env),
    }))
}

fn mcp_http_headers(
    server_name: &str,
    url: &str,
    static_headers: BTreeMap<String, String>,
    headers_helper: Option<&str>,
) -> BTreeMap<String, String> {
    let mut headers = expand_mcp_env_map(static_headers);
    if let Some(helper_headers) = mcp_headers_from_helper(server_name, url, headers_helper) {
        headers.extend(helper_headers);
    }
    headers
}

fn apply_stored_mcp_oauth_headers(
    runtime_root: &Path,
    server_name: &str,
    transport: &mut McpTransport,
) {
    let endpoint = match transport {
        McpTransport::Http(endpoint) | McpTransport::Sse(endpoint) => endpoint,
        McpTransport::Stdio(_) | McpTransport::Ws(_) => return,
    };
    if endpoint
        .headers
        .keys()
        .any(|name| name.eq_ignore_ascii_case("authorization"))
    {
        return;
    }
    let Some(header) = stored_mcp_oauth_authorization_header(runtime_root, server_name) else {
        return;
    };
    endpoint.headers.insert("Authorization".to_string(), header);
}

fn stored_mcp_oauth_authorization_header(runtime_root: &Path, server_name: &str) -> Option<String> {
    let path = mcp_oauth_tokens_path(runtime_root, server_name);
    let raw = fs::read_to_string(&path).ok()?;
    let mut value = serde_json::from_str::<Value>(&raw).ok()?;
    if mcp_oauth_token_is_expired(&value) {
        value = refresh_stored_mcp_oauth_token(&path, value)?;
        if mcp_oauth_token_is_expired(&value) {
            return None;
        }
    }
    mcp_oauth_authorization_header_from_value(&value)
}

fn mcp_oauth_authorization_header_from_value(value: &Value) -> Option<String> {
    let access_token = value.get("accessToken").and_then(Value::as_str)?.trim();
    if access_token.is_empty() {
        return None;
    }
    let token_type = value
        .get("tokenType")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Bearer");
    Some(format!("{token_type} {access_token}"))
}

fn refresh_stored_mcp_oauth_token(path: &Path, stored: Value) -> Option<Value> {
    let refresh_token = stored.get("refreshToken").and_then(Value::as_str)?.trim();
    let token_endpoint = stored.get("tokenEndpoint").and_then(Value::as_str)?.trim();
    let client_id = stored.get("clientId").and_then(Value::as_str)?.trim();
    if refresh_token.is_empty() || token_endpoint.is_empty() || client_id.is_empty() {
        return None;
    }
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .ok()?
        .post(token_endpoint)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ])
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let tokens = response.json::<Value>().ok()?;
    let access_token = tokens.get("access_token").and_then(Value::as_str)?.trim();
    if access_token.is_empty() {
        return None;
    }
    let mut next = stored.as_object()?.clone();
    next.insert(
        "accessToken".to_string(),
        Value::String(access_token.to_string()),
    );
    let token_type = tokens
        .get("token_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Bearer");
    next.insert(
        "tokenType".to_string(),
        Value::String(token_type.to_string()),
    );
    if let Some(refresh_token) = tokens
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        next.insert(
            "refreshToken".to_string(),
            Value::String(refresh_token.to_string()),
        );
    }
    let now = chrono::Utc::now();
    if let Some(expires_at) = tokens
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|seconds| *seconds > 0)
        .map(|seconds| (now + chrono::Duration::seconds(seconds)).to_rfc3339())
    {
        next.insert("expiresAt".to_string(), Value::String(expires_at));
    } else {
        next.remove("expiresAt");
    }
    if let Some(scope) = tokens
        .get("scope")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        next.insert("scope".to_string(), Value::String(scope.to_string()));
    }
    next.insert("updatedAt".to_string(), Value::String(now.to_rfc3339()));
    let refreshed = Value::Object(next);
    write_mcp_oauth_json_file(path, &refreshed).ok()?;
    Some(refreshed)
}

fn mcp_oauth_token_is_expired(value: &Value) -> bool {
    let Some(expires_at) = value.get("expiresAt").and_then(Value::as_str) else {
        return false;
    };
    let Ok(expires_at) = chrono::DateTime::parse_from_rfc3339(expires_at) else {
        return false;
    };
    expires_at.with_timezone(&chrono::Utc) <= chrono::Utc::now() + chrono::Duration::seconds(30)
}

fn mcp_headers_from_helper(
    server_name: &str,
    url: &str,
    headers_helper: Option<&str>,
) -> Option<BTreeMap<String, String>> {
    let helper = headers_helper
        .map(str::trim)
        .filter(|helper| !helper.is_empty())?;
    let helper = expand_mcp_env_vars(helper);
    let mut command = shell_command(&helper);
    command
        .env("CLAUDE_CODE_MCP_SERVER_NAME", server_name)
        .env("CLAUDE_CODE_MCP_SERVER_URL", url);
    let stdout = run_mcp_headers_helper(command, MCP_HEADERS_HELPER_TIMEOUT)?;
    let value = serde_json::from_slice::<Value>(&stdout).ok()?;
    let object = value.as_object()?;
    let mut headers = BTreeMap::new();
    for (key, value) in object {
        headers.insert(key.clone(), value.as_str()?.to_string());
    }
    Some(headers)
}

fn run_mcp_headers_helper(mut command: Command, timeout: Duration) -> Option<Vec<u8>> {
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().ok()? {
            if !status.success() {
                return None;
            }
            let mut stdout = Vec::new();
            child.stdout.take()?.read_to_end(&mut stdout).ok()?;
            return Some(stdout);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut shell = Command::new("cmd");
        shell.arg("/C").arg(command);
        shell
    }
    #[cfg(not(windows))]
    {
        let mut shell = Command::new("sh");
        shell.arg("-c").arg(command);
        shell
    }
}

fn expand_mcp_env_map(values: BTreeMap<String, String>) -> BTreeMap<String, String> {
    values
        .into_iter()
        .map(|(key, value)| (key, expand_mcp_env_vars(&value)))
        .collect()
}

fn expand_mcp_env_vars(value: &str) -> String {
    let mut output = String::new();
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        output.push_str(&rest[..start]);
        let after_open = &rest[start + 2..];
        let Some(end) = after_open.find('}') else {
            output.push_str(&rest[start..]);
            return output;
        };
        let variable = &after_open[..end];
        let replacement = if let Some((name, default_value)) = variable.split_once(":-") {
            std::env::var(name).unwrap_or_else(|_| default_value.to_string())
        } else {
            std::env::var(variable).unwrap_or_else(|_| format!("${{{variable}}}"))
        };
        output.push_str(&replacement);
        rest = &after_open[end + 1..];
    }
    output.push_str(rest);
    output
}

fn list_mcp_tools(
    server_name: &str,
    transport: &McpTransport,
) -> Result<McpToolListResult, String> {
    let call = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    });
    let response = call_mcp_transport_sync(server_name, transport, call, MCP_DISCOVERY_TIMEOUT, 2)?;
    let Some(result) = response.get("result") else {
        return Err(format!(
            "MCP server {server_name} tools/list response missing result"
        ));
    };
    serde_json::from_value(result.clone())
        .map_err(|error| format!("invalid MCP tools/list response from {server_name}: {error}"))
}

fn call_mcp_transport_sync(
    server_name: &str,
    transport: &McpTransport,
    call: Value,
    timeout: Duration,
    response_id: u64,
) -> Result<Value, String> {
    match transport {
        McpTransport::Stdio(command) => call_mcp_stdio(
            server_name,
            command,
            mcp_stdio_messages(call),
            timeout,
            response_id,
        ),
        McpTransport::Http(endpoint) => {
            call_mcp_http_sync(server_name, endpoint, call, timeout, response_id)
        }
        McpTransport::Sse(endpoint) => {
            call_mcp_sse_sync(server_name, endpoint, call, timeout, response_id)
        }
        McpTransport::Ws(endpoint) => {
            call_mcp_ws_sync(server_name, endpoint, call, timeout, response_id)
        }
    }
}

fn list_mcp_prompts(
    server_name: &str,
    transport: &McpTransport,
) -> Result<McpPromptListResult, String> {
    let call = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "prompts/list",
        "params": {}
    });
    let response = call_mcp_transport_sync(server_name, transport, call, MCP_DISCOVERY_TIMEOUT, 2)?;
    let Some(result) = response.get("result") else {
        return Err(format!(
            "MCP server {server_name} prompts/list response missing result"
        ));
    };
    serde_json::from_value(result.clone())
        .map_err(|error| format!("invalid MCP prompts/list response from {server_name}: {error}"))
}

fn list_mcp_resource_items(
    server_name: &str,
    transport: &McpTransport,
) -> Result<McpResourceListResult, String> {
    let call = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "resources/list",
        "params": {}
    });
    let response = call_mcp_transport_sync(server_name, transport, call, MCP_DISCOVERY_TIMEOUT, 2)?;
    let Some(result) = response.get("result") else {
        return Err(format!(
            "MCP server {server_name} resources/list response missing result"
        ));
    };
    serde_json::from_value(result.clone())
        .map_err(|error| format!("invalid MCP resources/list response from {server_name}: {error}"))
}

fn mcp_error_indicates_auth_required(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("401")
        || lower.contains("unauthorized")
        || lower.contains("authentication required")
        || lower.contains("needs-auth")
}

fn write_mcp_oauth_json_file(path: &Path, value: &Value) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&path, raw).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn mcp_oauth_tokens_path(runtime_root: &Path, server_name: &str) -> PathBuf {
    runtime_root
        .join("mcp")
        .join("oauth")
        .join(format!("{}.tokens.json", safe_filename(server_name)))
}

fn safe_filename(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

async fn call_mcp_transport(
    server_name: &str,
    transport: &McpTransport,
    call: Value,
    timeout: Duration,
    response_id: u64,
) -> Result<Value, String> {
    match transport {
        McpTransport::Stdio(command) => {
            let command = command.clone();
            let server_name = server_name.to_string();
            tokio::task::spawn_blocking({
                let messages = mcp_stdio_messages(call);
                move || call_mcp_stdio(&server_name, &command, messages, timeout, response_id)
            })
            .await
            .map_err(|error| format!("MCP resource task failed: {error}"))?
        }
        McpTransport::Http(endpoint) => {
            call_mcp_http(server_name, endpoint, call, timeout, response_id).await
        }
        McpTransport::Sse(endpoint) => {
            call_mcp_sse(server_name, endpoint, call, timeout, response_id).await
        }
        McpTransport::Ws(endpoint) => {
            call_mcp_ws(server_name, endpoint, call, timeout, response_id).await
        }
    }
}

async fn send_mcp_transport_notification(
    server_name: &str,
    transport: &McpTransport,
    notification: Value,
) -> Result<(), String> {
    match transport {
        McpTransport::Stdio(command) => {
            let command = command.clone();
            let server_name = server_name.to_string();
            tokio::task::spawn_blocking({
                let messages = mcp_stdio_messages(notification);
                move || send_mcp_stdio_notification(&server_name, &command, messages)
            })
            .await
            .map_err(|error| format!("MCP notification task failed: {error}"))?
        }
        McpTransport::Http(endpoint) => {
            send_mcp_http_notification(server_name, endpoint, notification).await
        }
        McpTransport::Sse(endpoint) => {
            send_mcp_sse_notification(server_name, endpoint, notification).await
        }
        McpTransport::Ws(endpoint) => {
            send_mcp_ws_notification(server_name, endpoint, notification).await
        }
    }
}

fn response_result(response: Value, server_name: &str, method: &str) -> Result<Value, String> {
    if let Some(error) = response.get("error") {
        return Err(format!(
            "MCP server {server_name} {method} failed: {}",
            truncate_mcp_error(&error.to_string())
        ));
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| format!("MCP server {server_name} {method} response missing result"))
}

fn mcp_stdio_messages(call: Value) -> String {
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "crawclaw-desktop",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    });
    let initialized = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    });
    format!("{initialize}\n{initialized}\n{call}\n")
}

fn call_mcp_http_sync(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    payload: Value,
    timeout: Duration,
    response_id: u64,
) -> Result<Value, String> {
    let server_name = server_name.to_string();
    let panic_server_name = server_name.clone();
    let endpoint = endpoint.clone();
    thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("failed to start MCP HTTP runtime: {error}"))?;
        runtime.block_on(call_mcp_http(
            &server_name,
            &endpoint,
            payload,
            timeout,
            response_id,
        ))
    })
    .join()
    .map_err(|_| format!("MCP HTTP discovery task panicked for {panic_server_name}"))?
}

fn call_mcp_sse_sync(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    payload: Value,
    timeout: Duration,
    response_id: u64,
) -> Result<Value, String> {
    let server_name = server_name.to_string();
    let panic_server_name = server_name.clone();
    let endpoint = endpoint.clone();
    thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("failed to start MCP SSE runtime: {error}"))?;
        runtime.block_on(call_mcp_sse(
            &server_name,
            &endpoint,
            payload,
            timeout,
            response_id,
        ))
    })
    .join()
    .map_err(|_| format!("MCP SSE discovery task panicked for {panic_server_name}"))?
}

fn call_mcp_ws_sync(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    payload: Value,
    timeout: Duration,
    response_id: u64,
) -> Result<Value, String> {
    let server_name = server_name.to_string();
    let panic_server_name = server_name.clone();
    let endpoint = endpoint.clone();
    thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("failed to start MCP WS runtime: {error}"))?;
        runtime.block_on(call_mcp_ws(
            &server_name,
            &endpoint,
            payload,
            timeout,
            response_id,
        ))
    })
    .join()
    .map_err(|_| format!("MCP WS discovery task panicked for {panic_server_name}"))?
}

async fn call_mcp_http(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    payload: Value,
    timeout: Duration,
    response_id: u64,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .no_proxy()
        .build()
        .map_err(|error| format!("failed to create MCP HTTP client for {server_name}: {error}"))?;
    let initialize = post_mcp_http(
        &client,
        server_name,
        endpoint,
        mcp_http_initialize_payload(),
        None,
        1,
    )
    .await?;
    post_mcp_http_notification(
        &client,
        server_name,
        endpoint,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }),
        initialize.session_id.as_deref(),
    )
    .await?;
    let response = post_mcp_http(
        &client,
        server_name,
        endpoint,
        payload,
        initialize.session_id.as_deref(),
        response_id,
    )
    .await?;
    Ok(response.value)
}

async fn send_mcp_http_notification(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    notification: Value,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(MCP_CALL_TIMEOUT)
        .no_proxy()
        .build()
        .map_err(|error| format!("failed to create MCP HTTP client for {server_name}: {error}"))?;
    let initialize = post_mcp_http(
        &client,
        server_name,
        endpoint,
        mcp_http_initialize_payload(),
        None,
        1,
    )
    .await?;
    post_mcp_http_notification(
        &client,
        server_name,
        endpoint,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }),
        initialize.session_id.as_deref(),
    )
    .await?;
    post_mcp_http_notification(
        &client,
        server_name,
        endpoint,
        notification,
        initialize.session_id.as_deref(),
    )
    .await
}

async fn call_mcp_sse(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    payload: Value,
    timeout: Duration,
    response_id: u64,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .no_proxy()
        .build()
        .map_err(|error| format!("failed to create MCP SSE client for {server_name}: {error}"))?;
    let mut stream = open_mcp_sse_stream(&client, server_name, endpoint).await?;
    let endpoint_event = read_mcp_sse_event(&mut stream, server_name).await?;
    if endpoint_event
        .event
        .as_deref()
        .is_some_and(|event| event != "endpoint")
    {
        return Err(format!(
            "MCP SSE server {server_name} returned unexpected first event {:?}",
            endpoint_event.event
        ));
    }
    let message_url = resolve_mcp_sse_message_url(endpoint, &endpoint_event.data)?;
    post_mcp_sse_message(
        &client,
        server_name,
        endpoint,
        &message_url,
        mcp_http_initialize_payload(),
    )
    .await?;
    let _initialize = read_mcp_sse_response(&mut stream, server_name, 1).await?;
    post_mcp_sse_message(
        &client,
        server_name,
        endpoint,
        &message_url,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }),
    )
    .await?;
    post_mcp_sse_message(&client, server_name, endpoint, &message_url, payload).await?;
    read_mcp_sse_response(&mut stream, server_name, response_id).await
}

async fn send_mcp_sse_notification(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    notification: Value,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(MCP_CALL_TIMEOUT)
        .no_proxy()
        .build()
        .map_err(|error| format!("failed to create MCP SSE client for {server_name}: {error}"))?;
    let mut stream = open_mcp_sse_stream(&client, server_name, endpoint).await?;
    let endpoint_event = read_mcp_sse_event(&mut stream, server_name).await?;
    if endpoint_event
        .event
        .as_deref()
        .is_some_and(|event| event != "endpoint")
    {
        return Err(format!(
            "MCP SSE server {server_name} returned unexpected first event {:?}",
            endpoint_event.event
        ));
    }
    let message_url = resolve_mcp_sse_message_url(endpoint, &endpoint_event.data)?;
    post_mcp_sse_message(
        &client,
        server_name,
        endpoint,
        &message_url,
        mcp_http_initialize_payload(),
    )
    .await?;
    let _initialize = read_mcp_sse_response(&mut stream, server_name, 1).await?;
    post_mcp_sse_message(
        &client,
        server_name,
        endpoint,
        &message_url,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }),
    )
    .await?;
    post_mcp_sse_message(&client, server_name, endpoint, &message_url, notification).await
}

async fn call_mcp_ws(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    payload: Value,
    timeout: Duration,
    response_id: u64,
) -> Result<Value, String> {
    tokio::time::timeout(
        timeout,
        call_mcp_ws_inner(server_name, endpoint, payload, response_id),
    )
    .await
    .map_err(|_| {
        format!(
            "MCP WS server {server_name} timed out after {} seconds",
            timeout.as_secs()
        )
    })?
}

async fn call_mcp_ws_inner(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    payload: Value,
    response_id: u64,
) -> Result<Value, String> {
    let request = mcp_ws_request(server_name, endpoint)?;
    let (mut websocket, _response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|error| format!("MCP WS connect to {server_name} failed: {error}"))?;
    send_mcp_ws_message(&mut websocket, server_name, mcp_http_initialize_payload()).await?;
    let _initialize = read_mcp_ws_response(&mut websocket, server_name, 1).await?;
    send_mcp_ws_message(
        &mut websocket,
        server_name,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }),
    )
    .await?;
    send_mcp_ws_message(&mut websocket, server_name, payload).await?;
    let response = read_mcp_ws_response(&mut websocket, server_name, response_id).await;
    let _ = websocket.close(None).await;
    response
}

async fn send_mcp_ws_notification(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    notification: Value,
) -> Result<(), String> {
    tokio::time::timeout(
        MCP_CALL_TIMEOUT,
        send_mcp_ws_notification_inner(server_name, endpoint, notification),
    )
    .await
    .map_err(|_| {
        format!(
            "MCP WS server {server_name} timed out after {} seconds",
            MCP_CALL_TIMEOUT.as_secs()
        )
    })?
}

async fn send_mcp_ws_notification_inner(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    notification: Value,
) -> Result<(), String> {
    let request = mcp_ws_request(server_name, endpoint)?;
    let (mut websocket, _response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|error| format!("MCP WS connect to {server_name} failed: {error}"))?;
    send_mcp_ws_message(&mut websocket, server_name, mcp_http_initialize_payload()).await?;
    let _initialize = read_mcp_ws_response(&mut websocket, server_name, 1).await?;
    send_mcp_ws_message(
        &mut websocket,
        server_name,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }),
    )
    .await?;
    send_mcp_ws_message(&mut websocket, server_name, notification).await?;
    let _ = websocket.close(None).await;
    Ok(())
}

fn mcp_ws_request(
    server_name: &str,
    endpoint: &McpHttpEndpoint,
) -> Result<tokio_tungstenite::tungstenite::handshake::client::Request, String> {
    let mut request = endpoint
        .url
        .as_str()
        .into_client_request()
        .map_err(|error| format!("invalid MCP WS URL for {server_name}: {error}"))?;
    request
        .headers_mut()
        .insert("sec-websocket-protocol", HeaderValue::from_static("mcp"));
    request.headers_mut().insert(
        "user-agent",
        HeaderValue::from_str(&format!("crawclaw-runtime/{}", env!("CARGO_PKG_VERSION")))
            .map_err(|error| format!("invalid MCP WS user agent for {server_name}: {error}"))?,
    );
    for (name, value) in &endpoint.headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("invalid MCP WS header {name}: {error}"))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|error| format!("invalid MCP WS header value for {name}: {error}"))?;
        request.headers_mut().insert(header_name, header_value);
    }
    Ok(request)
}

async fn send_mcp_ws_message(
    websocket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    server_name: &str,
    payload: Value,
) -> Result<(), String> {
    websocket
        .send(Message::Text(payload.to_string().into()))
        .await
        .map_err(|error| format!("failed to write MCP WS request to {server_name}: {error}"))
}

async fn read_mcp_ws_response(
    websocket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    server_name: &str,
    response_id: u64,
) -> Result<Value, String> {
    while let Some(message) = websocket.next().await {
        let message = message.map_err(|error| {
            format!("failed to read MCP WS response from {server_name}: {error}")
        })?;
        let body = match message {
            Message::Text(text) => text.to_string(),
            Message::Binary(bytes) => String::from_utf8(bytes.to_vec()).map_err(|error| {
                format!("MCP WS server {server_name} returned non-UTF8 binary: {error}")
            })?,
            Message::Close(_) => {
                return Err(format!(
                    "MCP WS server {server_name} closed before response id {response_id}"
                ));
            }
            _ => continue,
        };
        if let Ok(value) = serde_json::from_str::<Value>(&body) {
            if value.get("id").and_then(Value::as_u64) == Some(response_id) {
                return Ok(value);
            }
        }
    }
    Err(format!(
        "MCP WS server {server_name} did not return response id {response_id}"
    ))
}

fn mcp_http_initialize_payload() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "crawclaw-desktop",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    })
}

async fn open_mcp_sse_stream(
    client: &reqwest::Client,
    server_name: &str,
    endpoint: &McpHttpEndpoint,
) -> Result<McpSseStream, String> {
    let request = client
        .get(&endpoint.url)
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .header(
            reqwest::header::USER_AGENT,
            format!("crawclaw-runtime/{}", env!("CARGO_PKG_VERSION")),
        );
    let request = apply_mcp_headers(request, &endpoint.headers)?;
    let response = request
        .send()
        .await
        .map_err(|error| format!("MCP SSE request to {server_name} failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.map_err(|error| {
            format!("failed to read MCP SSE response from {server_name}: {error}")
        })?;
        return Err(format!(
            "MCP SSE server {server_name} returned {status}: {}",
            truncate_mcp_error(body.trim())
        ));
    }
    Ok(McpSseStream {
        response,
        buffer: String::new(),
    })
}

fn resolve_mcp_sse_message_url(
    endpoint: &McpHttpEndpoint,
    message_endpoint: &str,
) -> Result<String, String> {
    reqwest::Url::parse(&endpoint.url)
        .map_err(|error| format!("invalid MCP SSE URL {}: {error}", endpoint.url))?
        .join(message_endpoint)
        .map(|url| url.to_string())
        .map_err(|error| format!("invalid MCP SSE message endpoint {message_endpoint}: {error}"))
}

async fn post_mcp_sse_message(
    client: &reqwest::Client,
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    message_url: &str,
    payload: Value,
) -> Result<(), String> {
    let request = client
        .post(message_url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "application/json")
        .header(
            reqwest::header::USER_AGENT,
            format!("crawclaw-runtime/{}", env!("CARGO_PKG_VERSION")),
        );
    let request = apply_mcp_headers(request, &endpoint.headers)?;
    let response = request
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("MCP SSE POST to {server_name} failed: {error}"))?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.map_err(|error| {
        format!("failed to read MCP SSE POST response from {server_name}: {error}")
    })?;
    Err(format!(
        "MCP SSE server {server_name} returned {status}: {}",
        truncate_mcp_error(body.trim())
    ))
}

async fn read_mcp_sse_response(
    stream: &mut McpSseStream,
    server_name: &str,
    response_id: u64,
) -> Result<Value, String> {
    loop {
        let event = read_mcp_sse_event(stream, server_name).await?;
        if event.data == "[DONE]" {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&event.data) {
            if value.get("id").and_then(Value::as_u64) == Some(response_id) {
                return Ok(value);
            }
        }
    }
}

async fn read_mcp_sse_event(
    stream: &mut McpSseStream,
    server_name: &str,
) -> Result<McpSseEvent, String> {
    loop {
        if let Some(event) = take_mcp_sse_event(&mut stream.buffer) {
            if !event.data.is_empty() {
                return Ok(event);
            }
        }
        let Some(chunk) = stream.response.chunk().await.map_err(|error| {
            format!("failed to read MCP SSE stream from {server_name}: {error}")
        })?
        else {
            return Err(format!(
                "MCP SSE server {server_name} closed the event stream"
            ));
        };
        stream.buffer.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn take_mcp_sse_event(buffer: &mut String) -> Option<McpSseEvent> {
    let delimiter = buffer
        .find("\n\n")
        .map(|index| (index, 2))
        .or_else(|| buffer.find("\r\n\r\n").map(|index| (index, 4)))?;
    let raw = buffer[..delimiter.0].to_string();
    buffer.drain(..delimiter.0 + delimiter.1);
    let mut event = None;
    let mut data = Vec::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(value) = line.strip_prefix("event:") {
            event = Some(value.trim().to_string());
        } else if let Some(value) = line.strip_prefix("data:") {
            data.push(value.trim().to_string());
        }
    }
    Some(McpSseEvent {
        event,
        data: data.join("\n"),
    })
}

async fn post_mcp_http(
    client: &reqwest::Client,
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    payload: Value,
    session_id: Option<&str>,
    response_id: u64,
) -> Result<McpHttpResponse, String> {
    let mut request = client
        .post(&endpoint.url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, MCP_STREAMABLE_HTTP_ACCEPT)
        .header(
            reqwest::header::USER_AGENT,
            format!("crawclaw-runtime/{}", env!("CARGO_PKG_VERSION")),
        );
    if let Some(session_id) = session_id {
        request = request.header("Mcp-Session-Id", session_id);
    }
    request = apply_mcp_headers(request, &endpoint.headers)?;
    let response = request
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("MCP HTTP request to {server_name} failed: {error}"))?;
    let status = response.status();
    let session_id = response
        .headers()
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let body = response
        .text()
        .await
        .map_err(|error| format!("failed to read MCP HTTP response from {server_name}: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "MCP HTTP server {server_name} returned {status}: {}",
            truncate_mcp_error(body.trim())
        ));
    }
    let value = parse_mcp_http_response(&body, server_name, response_id)?;
    Ok(McpHttpResponse { value, session_id })
}

async fn post_mcp_http_notification(
    client: &reqwest::Client,
    server_name: &str,
    endpoint: &McpHttpEndpoint,
    payload: Value,
    session_id: Option<&str>,
) -> Result<(), String> {
    let mut request = client
        .post(&endpoint.url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, MCP_STREAMABLE_HTTP_ACCEPT)
        .header(
            reqwest::header::USER_AGENT,
            format!("crawclaw-runtime/{}", env!("CARGO_PKG_VERSION")),
        );
    if let Some(session_id) = session_id {
        request = request.header("Mcp-Session-Id", session_id);
    }
    request = apply_mcp_headers(request, &endpoint.headers)?;
    let response = request
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("MCP HTTP notification to {server_name} failed: {error}"))?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.map_err(|error| {
        format!("failed to read MCP HTTP notification response from {server_name}: {error}")
    })?;
    Err(format!(
        "MCP HTTP server {server_name} returned {status}: {}",
        truncate_mcp_error(body.trim())
    ))
}

fn apply_mcp_headers(
    mut request: reqwest::RequestBuilder,
    headers: &BTreeMap<String, String>,
) -> Result<reqwest::RequestBuilder, String> {
    for (name, value) in headers {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("invalid MCP HTTP header {name}: {error}"))?;
        let header_value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|error| format!("invalid MCP HTTP header value for {name}: {error}"))?;
        request = request.header(header_name, header_value);
    }
    Ok(request)
}

fn parse_mcp_http_response(
    body: &str,
    server_name: &str,
    response_id: u64,
) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if value.get("id").and_then(Value::as_u64) == Some(response_id) {
            return Ok(value);
        }
    }
    for event in body.split("\n\n") {
        let data = event
            .lines()
            .filter_map(|line| line.trim().strip_prefix("data:"))
            .map(str::trim)
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&data) {
            if value.get("id").and_then(Value::as_u64) == Some(response_id) {
                return Ok(value);
            }
        }
    }
    Err(format!(
        "MCP HTTP server {server_name} did not return response id {response_id}: {}",
        truncate_mcp_error(body.trim())
    ))
}

fn call_mcp_stdio(
    server_name: &str,
    command: &McpStdioCommand,
    payload: String,
    timeout: Duration,
    response_id: u64,
) -> Result<Value, String> {
    let mut child = Command::new(&command.program);
    child.args(&command.args);
    if let Some(cwd) = &command.cwd {
        child.current_dir(cwd);
    }
    for (key, value) in &command.env {
        child.env(key, value);
    }
    child
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = child
        .spawn()
        .map_err(|error| format!("failed to start MCP server {server_name}: {error}"))?;
    let Some(mut stdin) = child.stdin.take() else {
        return Err(format!("MCP server {server_name} stdin is unavailable"));
    };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("MCP server {server_name} stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("MCP server {server_name} stderr is unavailable"))?;
    let (sender, receiver) = mpsc::channel();
    spawn_mcp_stdio_reader(server_name, "stdout", stdout, sender.clone());
    spawn_mcp_stdio_reader(server_name, "stderr", stderr, sender);
    stdin
        .write_all(payload.as_bytes())
        .map_err(|error| format!("failed to write MCP request to {server_name}: {error}"))?;
    drop(stdin);

    let started = Instant::now();
    let mut stderr_output = String::new();
    let mut last_json_error = None;
    loop {
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "MCP server {server_name} timed out after {} seconds",
                timeout.as_secs()
            ));
        }
        match receiver.recv_timeout(Duration::from_millis(20)) {
            Ok(McpStdioEvent::Stdout(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() || !trimmed.starts_with('{') {
                    continue;
                }
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(value) if value.get("id").and_then(Value::as_u64) == Some(response_id) => {
                        terminate_mcp_stdio_child(&mut child);
                        return Ok(value);
                    }
                    Ok(_) => {}
                    Err(error) => last_json_error = Some(error.to_string()),
                }
            }
            Ok(McpStdioEvent::Stderr(line)) => {
                append_mcp_stderr(&mut stderr_output, &line);
            }
            Ok(McpStdioEvent::ReadError { label, error }) => {
                append_mcp_stderr(
                    &mut stderr_output,
                    &format!("failed to read {label}: {error}"),
                );
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(status) = child.try_wait().map_err(|error| {
                    format!("failed to wait for MCP server {server_name}: {error}")
                })? {
                    drain_mcp_stdio_events(&receiver, &mut stderr_output, &mut last_json_error);
                    return Err(mcp_missing_response_error(
                        server_name,
                        response_id,
                        status.to_string(),
                        &stderr_output,
                        last_json_error,
                    ));
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let status = child
                    .try_wait()
                    .map_err(|error| {
                        format!("failed to wait for MCP server {server_name}: {error}")
                    })?
                    .map(|status| status.to_string())
                    .unwrap_or_else(|| {
                        terminate_mcp_stdio_child(&mut child);
                        "running with closed stdout/stderr".to_string()
                    });
                return Err(mcp_missing_response_error(
                    server_name,
                    response_id,
                    status,
                    &stderr_output,
                    last_json_error,
                ));
            }
        }
    }
}

fn send_mcp_stdio_notification(
    server_name: &str,
    command: &McpStdioCommand,
    payload: String,
) -> Result<(), String> {
    let mut child = Command::new(&command.program);
    child.args(&command.args);
    if let Some(cwd) = &command.cwd {
        child.current_dir(cwd);
    }
    for (key, value) in &command.env {
        child.env(key, value);
    }
    child
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = child
        .spawn()
        .map_err(|error| format!("failed to start MCP server {server_name}: {error}"))?;
    let Some(mut stdin) = child.stdin.take() else {
        return Err(format!("MCP server {server_name} stdin is unavailable"));
    };
    stdin
        .write_all(payload.as_bytes())
        .map_err(|error| format!("failed to write MCP notification to {server_name}: {error}"))?;
    drop(stdin);

    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("failed to wait for MCP server {server_name}: {error}"))?
        {
            if status.success() {
                return Ok(());
            }
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            return Err(format!(
                "MCP server {server_name} exited after notification with {status}: {}",
                truncate_mcp_error(stderr.trim())
            ));
        }
        if started.elapsed() >= MCP_NOTIFICATION_GRACE {
            terminate_mcp_stdio_child(&mut child);
            return Ok(());
        }
        thread::sleep(Duration::from_millis(20));
    }
}

enum McpStdioEvent {
    Stdout(String),
    Stderr(String),
    ReadError { label: &'static str, error: String },
}

fn spawn_mcp_stdio_reader<R>(
    server_name: &str,
    label: &'static str,
    pipe: R,
    sender: mpsc::Sender<McpStdioEvent>,
) where
    R: Read + Send + 'static,
{
    let server_name = server_name.to_string();
    thread::spawn(move || {
        let reader = BufReader::new(pipe);
        for line in reader.lines() {
            let event = match line {
                Ok(line) if label == "stdout" => McpStdioEvent::Stdout(line),
                Ok(line) => McpStdioEvent::Stderr(line),
                Err(error) => McpStdioEvent::ReadError {
                    label,
                    error: error.to_string(),
                },
            };
            if sender.send(event).is_err() {
                break;
            }
        }
        tracing::debug!("MCP server {server_name} {label} reader ended");
    });
}

fn drain_mcp_stdio_events(
    receiver: &mpsc::Receiver<McpStdioEvent>,
    stderr_output: &mut String,
    last_json_error: &mut Option<String>,
) {
    while let Ok(event) = receiver.try_recv() {
        match event {
            McpStdioEvent::Stdout(line) => {
                let trimmed = line.trim();
                if !trimmed.is_empty() && trimmed.starts_with('{') {
                    if let Err(error) = serde_json::from_str::<Value>(trimmed) {
                        *last_json_error = Some(error.to_string());
                    }
                }
            }
            McpStdioEvent::Stderr(line) => append_mcp_stderr(stderr_output, &line),
            McpStdioEvent::ReadError { label, error } => {
                append_mcp_stderr(stderr_output, &format!("failed to read {label}: {error}"))
            }
        }
    }
}

fn terminate_mcp_stdio_child(child: &mut std::process::Child) {
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn append_mcp_stderr(stderr_output: &mut String, line: &str) {
    if stderr_output.len() >= MCP_STDIO_MAX_STDERR_BYTES {
        return;
    }
    if !stderr_output.is_empty() {
        stderr_output.push('\n');
    }
    let remaining = MCP_STDIO_MAX_STDERR_BYTES.saturating_sub(stderr_output.len());
    stderr_output.push_str(&line.chars().take(remaining).collect::<String>());
}

fn mcp_missing_response_error(
    server_name: &str,
    response_id: u64,
    status: String,
    stderr: &str,
    last_json_error: Option<String>,
) -> String {
    format!(
        "MCP server {server_name} did not return response id {response_id}; status: {status}; stderr: {}{}",
        truncate_mcp_error(stderr.trim()),
        last_json_error
            .map(|error| format!("; parse error: {error}"))
            .unwrap_or_default()
    )
}

fn mcp_resource_read_output(
    runtime_root: &Path,
    server_name: &str,
    result: Value,
) -> pi::sdk::ToolOutput {
    let details = mcp_resource_read_details(runtime_root, server_name, &result);
    let text = serde_json::to_string(&details).unwrap_or_else(|_| details.to_string());
    pi::sdk::ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(text))],
        details: Some(details),
        is_error: false,
    }
}

fn mcp_resource_read_details(runtime_root: &Path, server_name: &str, result: &Value) -> Value {
    let contents = result
        .get("contents")
        .and_then(Value::as_array)
        .map(|contents| {
            contents
                .iter()
                .enumerate()
                .map(|(index, resource)| {
                    mcp_resource_read_detail(runtime_root, server_name, resource, index)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({ "contents": contents })
}

fn mcp_resource_read_detail(
    runtime_root: &Path,
    server_name: &str,
    resource: &Value,
    index: usize,
) -> Value {
    let uri = resource
        .get("uri")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let mime_type = mcp_mime_type(resource, "application/octet-stream");
    let mut detail = Map::new();
    detail.insert("uri".to_string(), Value::String(uri.to_string()));
    if resource
        .get("mimeType")
        .or_else(|| resource.get("mime_type"))
        .is_some()
    {
        detail.insert("mimeType".to_string(), Value::String(mime_type.clone()));
    }
    if let Some(text) = resource.get("text").and_then(Value::as_str) {
        detail.insert("text".to_string(), Value::String(text.to_string()));
    } else if let Some(blob) = resource.get("blob").and_then(Value::as_str) {
        match persist_mcp_resource_blob(runtime_root, server_name, uri, &mime_type, blob, index) {
            Ok((path, bytes)) => {
                detail.insert(
                    "blobSavedTo".to_string(),
                    Value::String(path.to_string_lossy().into_owned()),
                );
                detail.insert(
                    "text".to_string(),
                    Value::String(format!(
                        "[Resource from {server_name} at {uri}] Binary content saved to {} ({mime_type}, {bytes} bytes)",
                        path.display()
                    )),
                );
            }
            Err(error) => {
                detail.insert(
                    "text".to_string(),
                    Value::String(format!(
                        "[Resource from {server_name} at {uri}] Binary content could not be saved to disk: {error}"
                    )),
                );
            }
        }
    }
    Value::Object(detail)
}

fn persist_mcp_resource_blob(
    runtime_root: &Path,
    server_name: &str,
    uri: &str,
    mime_type: &str,
    blob: &str,
    index: usize,
) -> Result<(PathBuf, usize), String> {
    let bytes = decode_mcp_resource_base64(blob)?;
    let output_dir = runtime_root.join(".crawclaw").join("tool-results");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("failed to create {}: {error}", output_dir.to_string_lossy()))?;
    let extension = mcp_blob_file_extension(mime_type);
    let file_name = format!(
        "mcp-resource-{}-{}-{}.{extension}",
        mcp_blob_file_component(server_name, "server"),
        now_millis(),
        mcp_blob_file_component(uri, &format!("resource-{index}"))
    );
    let path = output_dir.join(file_name);
    fs::write(&path, &bytes)
        .map_err(|error| format!("failed to write {}: {error}", path.to_string_lossy()))?;
    Ok((path, bytes.len()))
}

fn decode_mcp_resource_base64(input: &str) -> Result<Vec<u8>, String> {
    // MCP blobs are base64 strings; tolerate URL-safe alphabet and omitted padding.
    let mut encoded = input
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect::<Vec<_>>();
    if encoded.is_empty() {
        return Ok(Vec::new());
    }
    let padding = match encoded.len() % 4 {
        0 => 0,
        2 => 2,
        3 => 1,
        _ => return Err("invalid base64 length".to_string()),
    };
    encoded.extend(std::iter::repeat(b'=').take(padding));

    let mut output = Vec::with_capacity((encoded.len() / 4) * 3);
    let mut reached_padding = false;
    for chunk in encoded.chunks_exact(4) {
        let mut values = [0u8; 4];
        let mut chunk_padding = 0;
        for (index, byte) in chunk.iter().enumerate() {
            values[index] = match *byte {
                b'A'..=b'Z' => *byte - b'A',
                b'a'..=b'z' => *byte - b'a' + 26,
                b'0'..=b'9' => *byte - b'0' + 52,
                b'+' | b'-' => 62,
                b'/' | b'_' => 63,
                b'=' => {
                    if index < 2 {
                        return Err("invalid base64 padding".to_string());
                    }
                    reached_padding = true;
                    chunk_padding += 1;
                    0
                }
                _ => return Err("invalid base64 character".to_string()),
            };
            if reached_padding && *byte != b'=' {
                return Err("invalid base64 padding".to_string());
            }
        }
        if chunk_padding > 2 {
            return Err("invalid base64 padding".to_string());
        }
        output.push((values[0] << 2) | (values[1] >> 4));
        if chunk_padding < 2 {
            output.push((values[1] << 4) | (values[2] >> 2));
        }
        if chunk_padding == 0 {
            output.push((values[2] << 6) | values[3]);
        }
    }
    Ok(output)
}

fn mcp_blob_file_component(value: &str, fallback: &str) -> String {
    let mut component = safe_filename(value);
    if component.is_empty() {
        component = fallback.to_string();
    }
    if component.len() > 96 {
        component.truncate(96);
    }
    component
}

fn mcp_blob_file_extension(mime_type: &str) -> &'static str {
    match mime_type
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "application/json" => "json",
        "application/pdf" => "pdf",
        "application/xml" | "text/xml" => "xml",
        "image/gif" => "gif",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/svg+xml" => "svg",
        "image/webp" => "webp",
        "text/csv" => "csv",
        "text/html" => "html",
        "text/markdown" => "md",
        "text/plain" => "txt",
        _ => "bin",
    }
}

fn mcp_mime_type(value: &Value, default: &str) -> String {
    value
        .get("mimeType")
        .or_else(|| value.get("mime_type"))
        .and_then(Value::as_str)
        .unwrap_or(default)
        .to_string()
}

fn mcp_resource_list_output(value: Value) -> pi::sdk::ToolOutput {
    let text = if value.as_array().is_some_and(Vec::is_empty) {
        "No resources found. MCP servers may still provide tools even if they have no resources."
            .to_string()
    } else {
        serde_json::to_string(&value).unwrap_or_else(|_| value.to_string())
    };
    text_output(text, Some(value), false)
}

fn mcp_exposed_tool_name(server_name: &str, tool_name: &str) -> String {
    let server_name = mcp_name_component(server_name);
    let tool_name = mcp_name_component(tool_name);
    if server_name.is_empty() || tool_name.is_empty() {
        return String::new();
    }
    format!("mcp__{server_name}__{tool_name}")
}

fn mcp_name_component(value: &str) -> String {
    let mut normalized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if value.starts_with("claude.ai ") {
        let mut collapsed = String::new();
        let mut previous_underscore = false;
        for character in normalized.chars() {
            if character == '_' {
                if !previous_underscore {
                    collapsed.push(character);
                }
                previous_underscore = true;
            } else {
                collapsed.push(character);
                previous_underscore = false;
            }
        }
        normalized = collapsed.trim_matches('_').to_string();
    }
    normalized
}

fn truncate_mcp_error(value: &str) -> String {
    const MAX_ERROR_BYTES: usize = 500;
    if value.len() <= MAX_ERROR_BYTES {
        value.to_string()
    } else {
        format!(
            "{}...",
            value.chars().take(MAX_ERROR_BYTES).collect::<String>()
        )
    }
}
