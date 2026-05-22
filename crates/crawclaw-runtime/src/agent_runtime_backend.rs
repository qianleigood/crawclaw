use super::*;

pub trait AgentRuntimeBackend: Send + Sync {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<String, AgentRuntimeError>> + Send + 'a>>;
}

#[derive(Clone, Default)]
pub struct PiAgentRuntimeBackend;

#[derive(Clone, Default)]
pub struct NativeProviderRuntimeBackend;

#[derive(Clone, Default)]
pub struct ProviderResolver;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentSendResult {
    pub thread_id: String,
    pub user_text: String,
    pub assistant_text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub run_id: String,
    pub session_key: String,
    pub assistant_text: String,
    pub events: Vec<AgentRunEvent>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AgentRuntimeError {
    ProviderUnavailable(String),
    UnsupportedProvider(String),
    ProviderFailed(String),
    TranscriptFailed(String),
}

impl AgentRuntimeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ProviderUnavailable(_) => "provider_unavailable",
            Self::UnsupportedProvider(_) => "unsupported",
            Self::ProviderFailed(_) => "provider_failed",
            Self::TranscriptFailed(_) => "transcript_failed",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::ProviderUnavailable(message)
            | Self::UnsupportedProvider(message)
            | Self::ProviderFailed(message)
            | Self::TranscriptFailed(message) => message,
        }
    }
}

pub(super) fn agent_run_option_string(
    options: &BTreeMap<String, Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| options.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn agent_run_option_is(
    options: &BTreeMap<String, Value>,
    key: &str,
    expected: &str,
) -> bool {
    options
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

pub(super) fn build_btw_question_prompt(question: &str) -> String {
    [
        "You are answering an ephemeral /btw side question about the current conversation.",
        "Use the conversation only as background context.",
        "Answer only the side question below.",
        "Do not continue, resume, or complete any unfinished task from the conversation.",
        "Do not emit tool calls, pseudo-tool calls, shell commands, file writes, patches, or code unless the side question explicitly asks for them.",
        "Do not say you will continue the main task after answering.",
        "If the question can be answered briefly, answer briefly.",
        "",
        "<btw_side_question>",
        question.trim(),
        "</btw_side_question>",
    ]
    .join("\n")
}

impl AgentRuntime {
    pub fn new(runtime_root: PathBuf) -> Self {
        Self {
            runtime_root,
            pi_agent_backend: Arc::new(PiAgentRuntimeBackend),
            native_provider_backend: Arc::new(NativeProviderRuntimeBackend),
        }
    }

    pub fn with_pi_agent_backend(
        runtime_root: PathBuf,
        pi_agent_backend: Arc<dyn AgentRuntimeBackend>,
    ) -> Self {
        Self {
            runtime_root,
            pi_agent_backend,
            native_provider_backend: Arc::new(NativeProviderRuntimeBackend),
        }
    }

    pub async fn run_turn(
        &self,
        request: AgentRunRequest,
    ) -> Result<AgentRunResult, AgentRuntimeError> {
        let run_id = request.run_id;
        let agent_id = request.agent_id;
        let session_key = request.session_key;
        let user_text = request.inbound.body;
        let inbound_metadata = request.inbound.metadata;
        let model = request.model;
        let options = request.options;
        if agent_run_option_is(&options, "mode", "btw") {
            let question = agent_run_option_string(&options, &["btwQuestion"]).or_else(|| {
                inbound_metadata
                    .get("btw")
                    .and_then(Value::as_object)
                    .and_then(|btw| btw.get("question"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
            let question = question
                .or_else(|| (!user_text.trim().is_empty()).then(|| user_text.clone()))
                .ok_or_else(|| {
                    AgentRuntimeError::ProviderFailed("No BTW question provided.".to_string())
                })?;
            return self
                .run_btw_turn(run_id, agent_id, session_key, question, model)
                .await;
        }
        let result = self
            .send_message_with_model(
                session_key.clone(),
                user_text.clone(),
                Some(&model),
                &request.enabled_tools,
            )
            .await?;
        let assistant_text = result.assistant_text;
        let mut events = vec![
            AgentRunEvent::RunStarted {
                run_id: run_id.clone(),
                agent_id,
                session_key: session_key.clone(),
            },
            AgentRunEvent::ReplyPayload {
                run_id: run_id.clone(),
                payload: ReplyPayload {
                    text: Some(assistant_text.clone()),
                    media_urls: Vec::new(),
                    metadata: BTreeMap::new(),
                },
            },
            AgentRunEvent::TranscriptAppended {
                run_id: run_id.clone(),
                session_key: session_key.clone(),
                role: TranscriptRole::Assistant,
                message_id: format!("{run_id}:assistant"),
            },
        ];
        match self.record_memory_after_turn(
            &result.thread_id,
            &session_key,
            &run_id,
            &user_text,
            &assistant_text,
        ) {
            Ok(memory_result) => events.push(AgentRunEvent::ToolResult {
                run_id: run_id.clone(),
                call_id: format!("{run_id}:memory-after-turn"),
                tool_name: "memory.afterTurn".to_string(),
                result: memory_result,
                is_error: None,
            }),
            Err(error) => events.push(AgentRunEvent::ToolResult {
                run_id: run_id.clone(),
                call_id: format!("{run_id}:memory-after-turn"),
                tool_name: "memory.afterTurn".to_string(),
                result: json!({ "error": error }),
                is_error: Some(true),
            }),
        }
        events.push(AgentRunEvent::RunCompleted {
            run_id: run_id.clone(),
        });
        Ok(AgentRunResult {
            run_id,
            session_key: result.thread_id,
            assistant_text,
            events,
        })
    }

    async fn run_btw_turn(
        &self,
        run_id: String,
        agent_id: String,
        session_key: String,
        question: String,
        model: AgentModelSelection,
    ) -> Result<AgentRunResult, AgentRuntimeError> {
        let result = self
            .send_ephemeral_message_with_model(
                session_key.clone(),
                build_btw_question_prompt(&question),
                Some(&model),
                &[],
            )
            .await?;
        let assistant_text = result.assistant_text;
        let mut metadata = BTreeMap::new();
        metadata.insert("btw".to_string(), json!({ "question": question }));
        let events = vec![
            AgentRunEvent::RunStarted {
                run_id: run_id.clone(),
                agent_id,
                session_key: session_key.clone(),
            },
            AgentRunEvent::ReplyPayload {
                run_id: run_id.clone(),
                payload: ReplyPayload {
                    text: Some(assistant_text.clone()),
                    media_urls: Vec::new(),
                    metadata,
                },
            },
            AgentRunEvent::RunCompleted {
                run_id: run_id.clone(),
            },
        ];
        Ok(AgentRunResult {
            run_id,
            session_key,
            assistant_text,
            events,
        })
    }

    pub async fn send_message(
        &self,
        thread_id: String,
        user_text: String,
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        self.send_message_with_model(thread_id, user_text, None, &[])
            .await
    }

    pub async fn send_message_with_model_selection(
        &self,
        thread_id: String,
        user_text: String,
        model_selection: AgentModelSelection,
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        self.send_message_with_model(thread_id, user_text, Some(&model_selection), &[])
            .await
    }

    async fn send_message_with_model(
        &self,
        thread_id: String,
        user_text: String,
        model_selection: Option<&AgentModelSelection>,
        enabled_tools: &[String],
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        let config = self.read_provider_config()?;
        let history = self.load_thread_history(&thread_id)?;
        let assistant_text = match config.runtime_mode() {
            DesktopAgentRuntimeMode::PiAgentRust => {
                let mut provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                apply_agent_model_selection(&mut provider_config, model_selection)?;
                self.pi_agent_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history: history.clone(),
                        provider_config,
                        reasoning_level: model_selection
                            .and_then(|model| model.reasoning_level.clone()),
                        enabled_tools: enabled_tools.to_vec(),
                    })
                    .await?
            }
            DesktopAgentRuntimeMode::NativeProvider => {
                let mut provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                apply_agent_model_selection(&mut provider_config, model_selection)?;
                self.native_provider_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history: history.clone(),
                        provider_config,
                        reasoning_level: model_selection
                            .and_then(|model| model.reasoning_level.clone()),
                        enabled_tools: enabled_tools.to_vec(),
                    })
                    .await?
            }
        };

        self.append_transcript(&thread_id, &user_text, &assistant_text)?;
        Ok(AgentSendResult {
            thread_id,
            user_text,
            assistant_text,
        })
    }

    async fn send_ephemeral_message_with_model(
        &self,
        thread_id: String,
        user_text: String,
        model_selection: Option<&AgentModelSelection>,
        enabled_tools: &[String],
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        let config = self.read_provider_config()?;
        let history = self.load_thread_history(&thread_id)?;
        let assistant_text = match config.runtime_mode() {
            DesktopAgentRuntimeMode::PiAgentRust => {
                let mut provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                apply_agent_model_selection(&mut provider_config, model_selection)?;
                self.pi_agent_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history: history.clone(),
                        provider_config,
                        reasoning_level: model_selection
                            .and_then(|model| model.reasoning_level.clone()),
                        enabled_tools: enabled_tools.to_vec(),
                    })
                    .await?
            }
            DesktopAgentRuntimeMode::NativeProvider => {
                let mut provider_config =
                    ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
                apply_agent_model_selection(&mut provider_config, model_selection)?;
                self.native_provider_backend
                    .send_message(AgentRuntimeRequest {
                        runtime_root: &self.runtime_root,
                        thread_id: &thread_id,
                        user_text: &user_text,
                        history,
                        provider_config,
                        reasoning_level: model_selection
                            .and_then(|model| model.reasoning_level.clone()),
                        enabled_tools: enabled_tools.to_vec(),
                    })
                    .await?
            }
        };

        Ok(AgentSendResult {
            thread_id,
            user_text,
            assistant_text,
        })
    }

    fn read_provider_config(&self) -> Result<DesktopAgentProviderConfig, AgentRuntimeError> {
        let config_path = self
            .runtime_root
            .join("config")
            .join("desktop-agent-provider.json");
        let raw = fs::read_to_string(&config_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AgentRuntimeError::ProviderUnavailable(
                    "No Rust-native desktop agent provider is configured.".to_string(),
                )
            } else {
                AgentRuntimeError::ProviderUnavailable(format!(
                    "Failed to read desktop agent provider config: {error}"
                ))
            }
        })?;
        serde_json::from_str(&raw).map_err(|error| {
            AgentRuntimeError::ProviderUnavailable(format!(
                "Invalid desktop agent provider config: {error}"
            ))
        })
    }

    fn load_thread_history(
        &self,
        thread_id: &str,
    ) -> Result<Vec<AgentRuntimeMessage>, AgentRuntimeError> {
        let transcript_path = self
            .runtime_root
            .join("sessions")
            .join(format!("{thread_id}.jsonl"));
        let raw = match fs::read_to_string(&transcript_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(AgentRuntimeError::TranscriptFailed(format!(
                    "Failed to read Rust session transcript: {error}"
                )));
            }
        };
        parse_agent_runtime_history(&raw, &transcript_path)
    }

    fn append_transcript(
        &self,
        thread_id: &str,
        user_text: &str,
        assistant_text: &str,
    ) -> Result<(), AgentRuntimeError> {
        let store = DesktopSessionStore::new(self.runtime_root.clone());
        store
            .append_message(thread_id, "user", user_text, Some("agent"))
            .map_err(|error| AgentRuntimeError::TranscriptFailed(error.to_string()))?;
        store
            .append_message(thread_id, "assistant", assistant_text, Some("agent"))
            .map_err(|error| AgentRuntimeError::TranscriptFailed(error.to_string()))?;
        Ok(())
    }

    fn record_memory_after_turn(
        &self,
        session_id: &str,
        session_key: &str,
        run_id: &str,
        user_text: &str,
        assistant_text: &str,
    ) -> Result<Value, String> {
        let db_path = self
            .runtime_root
            .join("memory")
            .join("runtime.db")
            .to_string_lossy()
            .to_string();
        let memory_config = crate::memory::MemoryRuntimeConfig::from_value(
            &json!({
                "runtimeStore": {
                    "dbPath": db_path
                }
            }),
            &self.runtime_root,
        );
        let runtime =
            crate::memory::RustMemoryRuntime::with_config(self.runtime_root.clone(), memory_config);
        let messages = vec![
            json!({
                "id": format!("{run_id}:user"),
                "role": "user",
                "content": user_text,
                "source": "agent-runtime"
            }),
            json!({
                "id": format!("{run_id}:assistant"),
                "role": "assistant",
                "content": assistant_text,
                "source": "agent-runtime"
            }),
        ];
        runtime.after_turn(session_id, Some(session_key), &messages, 0)
    }
}

pub(super) fn is_configured_model_marker(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty() || trimmed == "configured"
}

pub(super) fn apply_agent_model_selection(
    config: &mut NativeProviderConfig,
    model_selection: Option<&AgentModelSelection>,
) -> Result<(), AgentRuntimeError> {
    let Some(selection) = model_selection else {
        return Ok(());
    };
    if !is_configured_model_marker(&selection.provider) {
        let provider = selection.provider.trim();
        ensure_native_chat_provider(provider)?;
        config.provider = provider.to_string();
    }
    if !is_configured_model_marker(&selection.model) {
        config.model = Some(selection.model.trim().to_string());
    }
    Ok(())
}

pub(super) fn ensure_native_chat_provider(provider: &str) -> Result<(), AgentRuntimeError> {
    let descriptor = crawclaw_providers::bundled_provider_descriptors()
        .into_iter()
        .find(|entry| entry.provider == provider);
    if descriptor
        .as_ref()
        .map(|entry| entry.transport.is_none())
        .unwrap_or(false)
    {
        return Err(AgentRuntimeError::UnsupportedProvider(format!(
            "Desktop agent provider {provider} does not expose a Rust-native chat transport."
        )));
    }
    Ok(())
}

pub(super) fn map_provider_error(error: ProviderTransportError) -> AgentRuntimeError {
    match error {
        ProviderTransportError::Unavailable(message) => {
            AgentRuntimeError::ProviderUnavailable(message)
        }
        ProviderTransportError::InvalidResponse(message) => {
            AgentRuntimeError::ProviderFailed(message)
        }
        ProviderTransportError::Unsupported(message) => {
            AgentRuntimeError::UnsupportedProvider(message)
        }
    }
}

impl AgentRuntimeBackend for NativeProviderRuntimeBackend {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<String, AgentRuntimeError>> + Send + 'a>> {
        Box::pin(async move {
            let messages = agent_history_with_user(&request.history, request.user_text);
            send_native_provider_conversation_with_options(
                &request.provider_config,
                &messages,
                &NativeProviderRequestOptions {
                    reasoning_level: request.reasoning_level.clone(),
                    ..NativeProviderRequestOptions::default()
                },
            )
            .await
            .map_err(map_provider_error)
        })
    }
}

impl AgentRuntimeBackend for PiAgentRuntimeBackend {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<String, AgentRuntimeError>> + Send + 'a>> {
        Box::pin(async move {
            let provider = Arc::new(CrawClawPiProvider {
                config: request.provider_config.clone(),
                reasoning_level: request.reasoning_level.clone(),
            });
            let tools = build_filtered_pi_agent_rust_tool_registry(
                request.runtime_root,
                &request.enabled_tools,
            );
            let agent_config = pi::sdk::AgentConfig {
                system_prompt: None,
                max_tool_iterations: 8,
                stream_options: pi::sdk::StreamOptions::default(),
                block_images: false,
                fail_closed_hooks: false,
            };
            let session = Arc::new(asupersync::sync::Mutex::new(pi_session_from_history(
                &request.history,
            )));
            let agent = pi::sdk::Agent::new(provider, tools, agent_config);
            let agent_session = pi::sdk::AgentSession::new(
                agent,
                session,
                false,
                pi::compaction::ResolvedCompactionSettings::default(),
            );
            let mut handle = pi::sdk::AgentSessionHandle::from_session_with_listeners(
                agent_session,
                pi::sdk::EventListeners::default(),
            );
            let assistant = handle
                .prompt(request.user_text.to_string(), |_| {})
                .await
                .map_err(map_pi_agent_error)?;
            pi_agent_assistant_text(&assistant)
        })
    }
}
