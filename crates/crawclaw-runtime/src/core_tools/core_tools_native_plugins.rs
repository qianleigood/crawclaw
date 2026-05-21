use super::*;

pub(super) struct NativePluginTool {
    runtime_root: PathBuf,
    plugin_id: String,
    descriptor: NativeToolDescriptor,
    runtime: NativePluginRuntime,
}

impl NativePluginTool {
    pub(super) fn new(runtime_root: &Path, registration: NativeToolRegistration) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            plugin_id: registration.plugin_id,
            descriptor: registration.descriptor,
            runtime: registration.runtime,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopProviderConfigFile {
    provider: String,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    api_key: Option<Value>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    api: Option<String>,
    #[serde(default)]
    api_version: Option<String>,
}

pub(super) fn optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn resolve_secret_string(
    runtime_root: &Path,
    value: Option<&Value>,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if let Some(raw) = value.as_str() {
        return Ok(optional_string(Some(raw)));
    }
    let Some(object) = value.as_object() else {
        return Err("desktop provider apiKey must be a string or SecretRef".to_string());
    };
    let source = object
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = object.get("id").and_then(Value::as_str).unwrap_or_default();
    match source {
        "env" => std::env::var(id)
            .map(|secret| optional_string(Some(&secret)))
            .map_err(|_| format!("environment variable {id} is not set")),
        "file" => {
            let path = PathBuf::from(id);
            let path = if path.is_absolute() {
                path
            } else {
                runtime_root.join(path)
            };
            fs::read_to_string(&path)
                .map(|secret| optional_string(Some(secret.trim_end())))
                .map_err(|error| {
                    format!("failed to read file SecretRef {}: {error}", path.display())
                })
        }
        "exec" => {
            Err("exec SecretRef is not enabled in the Rust llm-task host callback".to_string())
        }
        _ => Err(format!("unsupported SecretRef source {source}")),
    }
}

pub(super) fn read_desktop_provider_config(
    runtime_root: &Path,
) -> Result<NativeProviderConfig, String> {
    let path = runtime_root
        .join("config")
        .join("desktop-agent-provider.json");
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read desktop provider config {}: {error}",
            path.display()
        )
    })?;
    let config: DesktopProviderConfigFile = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "invalid desktop provider config {}: {error}",
            path.display()
        )
    })?;
    let provider = optional_string(Some(&config.provider))
        .ok_or_else(|| "desktop provider config is missing provider".to_string())?;
    let model = optional_string(config.model.as_deref()).or_else(|| {
        crawclaw_providers::bundled_provider_default_model_for(&provider)
            .map(|entry| entry.model.to_string())
    });
    Ok(NativeProviderConfig {
        provider,
        base_url: optional_string(config.base_url.as_deref()),
        api_key: resolve_secret_string(runtime_root, config.api_key.as_ref())?,
        model,
        api: optional_string(config.api.as_deref()),
        api_version: optional_string(config.api_version.as_deref()),
    })
}

pub(super) async fn execute_llm_task_with_host_agent(
    runtime_root: &Path,
    input: Value,
) -> pi::sdk::Result<Value> {
    let provider_config = read_desktop_provider_config(runtime_root)
        .map_err(|error| tool_error("llm-task", error))?;
    let default_model = provider_config
        .model
        .as_ref()
        .map(|model| format!("{}/{}", provider_config.provider, model));
    let prepared = prepare_llm_task(LlmTaskPrepareInput {
        params: input.clone(),
        plugin_config: json!({}),
        default_model,
        workspace_dir: runtime_root.to_string_lossy().to_string(),
    })
    .map_err(|error| tool_error("llm-task", error.to_string()))?;
    let mut task_provider_config = provider_config;
    task_provider_config.provider = prepared.provider.clone();
    task_provider_config.model = Some(prepared.model.clone());
    let assistant_text = send_native_provider_conversation(
        &task_provider_config,
        &[NativeProviderMessage::user(prepared.full_prompt)],
    )
    .await
    .map_err(|error| tool_error("llm-task", error.to_string()))?;
    complete_llm_task(json!({
        "payloads": [{ "text": assistant_text }],
        "schema": input.get("schema").cloned().unwrap_or(Value::Null),
        "provider": prepared.provider,
        "model": prepared.model
    }))
    .map_err(|error| tool_error("llm-task", error.to_string()))
}

#[async_trait]
impl pi::sdk::Tool for NativePluginTool {
    fn name(&self) -> &str {
        &self.descriptor.name
    }

    fn label(&self) -> &str {
        &self.descriptor.label
    }

    fn description(&self) -> &str {
        &self.descriptor.description
    }

    fn parameters(&self) -> Value {
        self.descriptor.parameters.clone()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let result = if matches!(&self.runtime, NativePluginRuntime::Builtin)
            && self.plugin_id == "llm-task"
            && self.descriptor.invocation.operation == "execute"
        {
            execute_llm_task_with_host_agent(&self.runtime_root, input).await?
        } else {
            invoke_native_plugin_operation(
                self.runtime.clone(),
                self.descriptor.invocation.clone(),
                if matches!(&self.runtime, NativePluginRuntime::Builtin) {
                    with_native_runtime_context(&self.runtime_root, input)
                } else {
                    input
                },
            )
            .await
            .map_err(|error| tool_error(&self.descriptor.name, error.to_string()))?
        };
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        self.descriptor.read_only
    }
}

pub(super) async fn run_web_search(input: Value) -> crawclaw_native_plugins::NativeResult<Value> {
    match string_param(tool_input_params(&input), &["provider"])
        .unwrap_or_else(|| "searxng".to_string())
        .as_str()
    {
        "searxng" | "" => run_searxng_search(input).await,
        provider => Err(crawclaw_native_plugins::NativeError::InvalidInput(format!(
            "web_search only supports searxng provider; got {provider}"
        ))),
    }
}

pub(super) fn tool_input_params(input: &Value) -> &Value {
    input.get("params").unwrap_or(input)
}
