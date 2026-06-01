use super::*;

mod native_provider;
pub use native_provider::NativeProviderRuntimeBackend;

#[cfg(test)]
use native_provider::execute_native_provider_tool_calls;

pub trait AgentRuntimeBackend: Send + Sync {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentBackendResult, AgentRuntimeError>> + Send + 'a>>;
}

#[derive(Clone, Default)]
pub struct ProviderResolver;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentSendResult {
    pub thread_id: String,
    pub user_text: String,
    pub assistant_text: String,
    pub loop_events: Vec<AgentLoopEvent>,
    pub context_summary: AgentRuntimeContextSummary,
    pub memory_result: Option<Result<Value, String>>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct AgentBackendResult {
    pub assistant_text: String,
    pub loop_events: Vec<AgentLoopEvent>,
}

impl AgentBackendResult {
    pub fn text(assistant_text: impl Into<String>) -> Self {
        Self {
            assistant_text: assistant_text.into(),
            loop_events: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub run_id: String,
    pub session_key: String,
    pub assistant_text: String,
    pub context_summary: AgentRuntimeContextSummary,
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

fn runtime_now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
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

pub(super) fn tool_selection_from_enabled_tools(
    enabled_tools: Vec<String>,
) -> AgentRuntimeToolSelection {
    if enabled_tools.is_empty() {
        AgentRuntimeToolSelection::Default
    } else {
        AgentRuntimeToolSelection::AllowList(enabled_tools)
    }
}

fn tool_selection_from_profile(
    profile: &AgentRunProfile,
    enabled_tools: Vec<String>,
) -> AgentRuntimeToolSelection {
    match &profile.tool_policy {
        ToolPolicy::Default => tool_selection_from_enabled_tools(enabled_tools),
        ToolPolicy::Disabled => AgentRuntimeToolSelection::Disabled,
        ToolPolicy::AllowList(tools) => AgentRuntimeToolSelection::AllowList(tools.clone()),
    }
}

fn special_execution_mode(mode: special_agents::SpecialAgentExecutionMode) -> AgentExecutionMode {
    match mode {
        special_agents::SpecialAgentExecutionMode::SpawnedSession => {
            AgentExecutionMode::SpawnedSession
        }
        special_agents::SpecialAgentExecutionMode::EmbeddedFork => AgentExecutionMode::EmbeddedFork,
    }
}

fn special_transcript_policy(
    policy: special_agents::SpecialAgentTranscriptPolicy,
) -> TranscriptPolicy {
    match policy {
        special_agents::SpecialAgentTranscriptPolicy::Isolated => TranscriptPolicy::Isolated,
        special_agents::SpecialAgentTranscriptPolicy::ThreadBound => TranscriptPolicy::ThreadBound,
    }
}

fn special_parent_context_policy(
    policy: special_agents::SpecialAgentParentContextPolicy,
) -> ParentContextPolicy {
    match policy {
        special_agents::SpecialAgentParentContextPolicy::None => ParentContextPolicy::None,
        special_agents::SpecialAgentParentContextPolicy::ForkMessagesOnly => {
            ParentContextPolicy::ForkMessagesOnly
        }
        special_agents::SpecialAgentParentContextPolicy::FullEnvelope => {
            ParentContextPolicy::FullEnvelope
        }
    }
}

fn special_profile(
    kind: AgentRunKind,
    selector: &str,
    memory_after_turn: Option<bool>,
) -> Result<AgentRunProfile, AgentRuntimeError> {
    let definition = special_agents::find_special_agent(selector).ok_or_else(|| {
        AgentRuntimeError::ProviderFailed(format!("unknown special agent profile: {selector}"))
    })?;
    let memory_after_turn = memory_after_turn.unwrap_or(
        definition.guard != Some(special_agents::SpecialAgentToolGuard::MemoryMaintenance),
    );
    let memory_maintenance =
        definition.guard == Some(special_agents::SpecialAgentToolGuard::MemoryMaintenance);
    let result_policy = match kind {
        AgentRunKind::Compaction => AgentResultPolicy::PersistCompaction,
        AgentRunKind::MemoryMaintenance => AgentResultPolicy::PersistSpecialAgent,
        _ => AgentResultPolicy::PersistSpecialAgent,
    };
    Ok(AgentRunProfile {
        kind,
        execution_mode: special_execution_mode(definition.execution_mode),
        transcript_policy: special_transcript_policy(definition.transcript_policy),
        parent_context_policy: special_parent_context_policy(definition.parent_context_policy),
        parent_session_key: None,
        tool_policy: ToolPolicy::AllowList(
            definition
                .tool_allowlist
                .iter()
                .map(|tool| (*tool).to_string())
                .collect(),
        ),
        skill_policy: SkillPolicy::Disabled,
        memory_policy: MemoryPolicy {
            recall: !memory_maintenance && kind != AgentRunKind::Compaction,
            after_turn: memory_after_turn,
            maintenance_write: memory_maintenance,
        },
        compaction_policy: if kind == AgentRunKind::Compaction {
            CompactionPolicy::SummaryPlusTail
        } else {
            CompactionPolicy::Disabled
        },
        limits: AgentRunLimits {
            timeout_seconds: definition.timeout_seconds,
            max_turns: definition.max_turns,
        },
        result_policy,
        special_agent_id: Some(definition.id.to_string()),
        system_prompt: Some(special_agents::render_special_agent_prompt(definition)),
        warnings: Vec::new(),
    })
}

fn resolve_agent_run_profile(
    request: &AgentRunRequest,
) -> Result<AgentRunProfile, AgentRuntimeError> {
    let Some(profile) = request.profile.as_ref() else {
        return Ok(AgentRunProfile::default());
    };
    let mut resolved = match profile.kind {
        AgentRunProfileKind::Normal => {
            let mut resolved = AgentRunProfile::default();
            if let Some(memory_after_turn) = profile.memory_after_turn {
                resolved.memory_policy.after_turn = memory_after_turn;
            }
            resolved
        }
        AgentRunProfileKind::Btw => AgentRunProfile {
            kind: AgentRunKind::Btw,
            execution_mode: AgentExecutionMode::Ephemeral,
            transcript_policy: TranscriptPolicy::None,
            parent_context_policy: ParentContextPolicy::CurrentSession,
            parent_session_key: None,
            tool_policy: ToolPolicy::Disabled,
            skill_policy: SkillPolicy::Disabled,
            memory_policy: MemoryPolicy {
                recall: false,
                after_turn: false,
                maintenance_write: false,
            },
            compaction_policy: CompactionPolicy::Disabled,
            limits: AgentRunLimits {
                timeout_seconds: 0,
                max_turns: 1,
            },
            result_policy: AgentResultPolicy::Reply,
            special_agent_id: None,
            system_prompt: None,
            warnings: Vec::new(),
        },
        AgentRunProfileKind::Subagent => AgentRunProfile {
            kind: AgentRunKind::Subagent,
            execution_mode: AgentExecutionMode::SpawnedSession,
            transcript_policy: TranscriptPolicy::Isolated,
            parent_context_policy: subagent_parent_context_policy(request),
            parent_session_key: None,
            tool_policy: ToolPolicy::Default,
            skill_policy: SkillPolicy::Default,
            memory_policy: MemoryPolicy {
                recall: true,
                after_turn: true,
                maintenance_write: false,
            },
            compaction_policy: CompactionPolicy::Disabled,
            limits: AgentRunLimits {
                timeout_seconds: 300,
                max_turns: 8,
            },
            result_policy: AgentResultPolicy::Reply,
            special_agent_id: None,
            system_prompt: None,
            warnings: Vec::new(),
        },
        AgentRunProfileKind::SpecialAgent => special_profile(
            AgentRunKind::SpecialAgent,
            profile
                .special_agent
                .as_deref()
                .unwrap_or(&request.agent_id),
            profile.memory_after_turn,
        )?,
        AgentRunProfileKind::Compaction => special_profile(
            AgentRunKind::Compaction,
            profile
                .special_agent
                .as_deref()
                .unwrap_or("session-summary"),
            profile.memory_after_turn,
        )?,
        AgentRunProfileKind::MemoryMaintenance => special_profile(
            AgentRunKind::MemoryMaintenance,
            profile
                .special_agent
                .as_deref()
                .unwrap_or(&request.agent_id),
            profile.memory_after_turn,
        )?,
    };
    if matches!(
        resolved.parent_context_policy,
        ParentContextPolicy::ForkMessagesOnly | ParentContextPolicy::FullEnvelope
    ) {
        let metadata_parent = request
            .inbound
            .metadata
            .get("parentSessionKey")
            .or_else(|| request.inbound.metadata.get("parent"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let inbound_parent = request.inbound.from.trim().to_string();
        resolved.parent_session_key = metadata_parent.map(ToOwned::to_owned).or_else(|| {
            (!inbound_parent.is_empty() && inbound_parent != request.session_key)
                .then_some(inbound_parent)
        });
    }
    if let Some(system_prompt) =
        agent_run_option_string(&request.options, &["systemPrompt", "system_prompt"])
    {
        resolved.system_prompt = Some(system_prompt);
    }
    Ok(resolved)
}

fn subagent_parent_context_policy(request: &AgentRunRequest) -> ParentContextPolicy {
    let selector = request
        .inbound
        .metadata
        .get("parentContextPolicy")
        .or_else(|| request.options.get("parentContextPolicy"))
        .and_then(Value::as_str)
        .map(str::trim)
        .map(str::to_lowercase);
    match selector.as_deref() {
        Some("fork") | Some("fork_messages_only") | Some("fork-messages-only") => {
            ParentContextPolicy::ForkMessagesOnly
        }
        Some("full") | Some("full_envelope") | Some("full-envelope") => {
            ParentContextPolicy::FullEnvelope
        }
        _ => ParentContextPolicy::None,
    }
}

impl AgentRuntime {
    pub fn new(runtime_root: PathBuf) -> Self {
        Self {
            runtime_root,
            native_provider_backend: Arc::new(NativeProviderRuntimeBackend),
        }
    }

    pub fn with_native_provider_backend(
        runtime_root: PathBuf,
        native_provider_backend: Arc<dyn AgentRuntimeBackend>,
    ) -> Self {
        Self {
            runtime_root,
            native_provider_backend,
        }
    }

    pub async fn run_turn(
        &self,
        request: AgentRunRequest,
    ) -> Result<AgentRunResult, AgentRuntimeError> {
        self.run_turn_with_tool_hook_policy(request, None).await
    }

    pub async fn run_turn_with_tool_hook_policy(
        &self,
        request: AgentRunRequest,
        tool_hook_policy: Option<AgentRuntimeToolHookPolicy>,
    ) -> Result<AgentRunResult, AgentRuntimeError> {
        let profile = resolve_agent_run_profile(&request)?;
        let run_id = request.run_id;
        let agent_id = request.agent_id;
        let session_key = request.session_key;
        let user_text = request.inbound.body;
        let inbound_metadata = request.inbound.metadata;
        let model = request.model;
        let options = request.options;
        if profile.kind == AgentRunKind::Btw {
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
        let memory_after_turn = profile.memory_policy.after_turn;
        let result = self
            .send_message_with_options_inner(
                session_key.clone(),
                user_text.clone(),
                AgentRuntimeSendOptions {
                    model_selection: Some(model.clone()),
                    tool_selection: tool_selection_from_profile(&profile, request.enabled_tools),
                    permission_policy: None,
                    tool_hook_policy,
                    system_prompt: None,
                },
                memory_after_turn,
                profile,
            )
            .await?;
        let assistant_text = result.assistant_text;
        let mut events = vec![
            AgentRunEvent::RunStarted {
                run_id: run_id.clone(),
                agent_id,
                session_key: session_key.clone(),
            },
            AgentRunEvent::ContextProjected {
                run_id: run_id.clone(),
                projection: serde_json::to_value(&result.context_summary.projection)
                    .map_err(|error| AgentRuntimeError::ProviderFailed(error.to_string()))?,
            },
        ];
        events.extend(agent_loop_events_to_run_events(&run_id, result.loop_events));
        events.push(AgentRunEvent::ProviderBlock {
            run_id: run_id.clone(),
            block_type: "text".to_string(),
            text: Some(assistant_text.clone()),
            metadata: json!({
                "profileKind": result.context_summary.profile_kind,
                "budgetState": result.context_summary.budget.state
            }),
        });
        events.extend([
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
        ]);
        match result.memory_result {
            Some(Ok(memory_result)) => events.push(AgentRunEvent::ToolResult {
                run_id: run_id.clone(),
                call_id: format!("{run_id}:memory-after-turn"),
                tool_name: "memory.afterTurn".to_string(),
                result: memory_result,
                is_error: None,
            }),
            Some(Err(error)) => events.push(AgentRunEvent::ToolResult {
                run_id: run_id.clone(),
                call_id: format!("{run_id}:memory-after-turn"),
                tool_name: "memory.afterTurn".to_string(),
                result: json!({ "error": error }),
                is_error: Some(true),
            }),
            None => {}
        }
        events.push(AgentRunEvent::RunCompleted {
            run_id: run_id.clone(),
        });
        Ok(AgentRunResult {
            run_id,
            session_key: result.thread_id,
            assistant_text,
            context_summary: result.context_summary,
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
            .send_ephemeral_message_with_options(
                session_key.clone(),
                build_btw_question_prompt(&question),
                AgentRuntimeSendOptions {
                    model_selection: Some(model),
                    tool_selection: AgentRuntimeToolSelection::Disabled,
                    permission_policy: None,
                    tool_hook_policy: None,
                    system_prompt: None,
                },
            )
            .await?;
        let assistant_text = result.assistant_text;
        let mut metadata = BTreeMap::new();
        metadata.insert("btw".to_string(), json!({ "question": question }));
        let mut events = vec![
            AgentRunEvent::RunStarted {
                run_id: run_id.clone(),
                agent_id,
                session_key: session_key.clone(),
            },
            AgentRunEvent::ContextProjected {
                run_id: run_id.clone(),
                projection: serde_json::to_value(&result.context_summary.projection)
                    .map_err(|error| AgentRuntimeError::ProviderFailed(error.to_string()))?,
            },
            AgentRunEvent::ProviderBlock {
                run_id: run_id.clone(),
                block_type: "text".to_string(),
                text: Some(assistant_text.clone()),
                metadata: json!({
                    "profileKind": result.context_summary.profile_kind,
                    "budgetState": result.context_summary.budget.state
                }),
            },
        ];
        events.extend(agent_loop_events_to_run_events(&run_id, result.loop_events));
        events.extend([
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
        ]);
        Ok(AgentRunResult {
            run_id,
            session_key,
            assistant_text,
            context_summary: result.context_summary,
            events,
        })
    }

    pub async fn send_message(
        &self,
        thread_id: String,
        user_text: String,
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        self.send_message_with_options(
            thread_id,
            user_text,
            AgentRuntimeSendOptions {
                model_selection: None,
                tool_selection: AgentRuntimeToolSelection::Default,
                permission_policy: None,
                tool_hook_policy: None,
                system_prompt: None,
            },
        )
        .await
    }

    pub async fn send_message_with_model_selection(
        &self,
        thread_id: String,
        user_text: String,
        model_selection: AgentModelSelection,
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        self.send_message_with_options(
            thread_id,
            user_text,
            AgentRuntimeSendOptions {
                model_selection: Some(model_selection),
                tool_selection: AgentRuntimeToolSelection::Default,
                permission_policy: None,
                tool_hook_policy: None,
                system_prompt: None,
            },
        )
        .await
    }

    pub async fn send_message_with_options(
        &self,
        thread_id: String,
        user_text: String,
        options: AgentRuntimeSendOptions,
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        self.send_message_with_options_inner(
            thread_id,
            user_text,
            options,
            true,
            AgentRunProfile::default(),
        )
        .await
    }

    pub fn preview_message_context(
        &self,
        thread_id: &str,
        user_text: &str,
        options: &AgentRuntimeSendOptions,
    ) -> Result<AgentRuntimeContextSummary, AgentRuntimeError> {
        let history = self.load_thread_history(thread_id)?;
        let profile = AgentRunProfile::default();
        Ok(build_runtime_model_context(
            &self.runtime_root,
            thread_id,
            user_text,
            &history,
            options,
            &profile,
        )
        .context_summary)
    }

    async fn send_message_with_options_inner(
        &self,
        thread_id: String,
        user_text: String,
        options: AgentRuntimeSendOptions,
        memory_after_turn: bool,
        profile: AgentRunProfile,
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        tracing::info!(
            runtime_root = %self.runtime_root.display(),
            thread_id = %thread_id,
            memory_after_turn,
            "agent_runtime_send_message_started"
        );
        let config = self.read_provider_config()?;
        let history = self.load_thread_history(&thread_id)?;
        let timeout_seconds = profile.limits.timeout_seconds;
        let max_tool_iterations = if profile.limits.max_turns == 0 {
            8
        } else {
            profile.limits.max_turns as usize
        };
        let runtime_context = build_runtime_model_context(
            &self.runtime_root,
            &thread_id,
            &user_text,
            &history,
            &options,
            &profile,
        );
        let model_selection = options.model_selection.as_ref();
        let provider_send = async {
            let mut provider_config =
                ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
            apply_agent_model_selection(&mut provider_config, model_selection)?;
            let backend_result = self
                .native_provider_backend
                .send_message(AgentRuntimeRequest {
                    runtime_root: &self.runtime_root,
                    thread_id: &thread_id,
                    user_text: &user_text,
                    history: history.clone(),
                    runtime_context: runtime_context.clone(),
                    provider_config,
                    reasoning_level: model_selection
                        .and_then(|model| model.reasoning_level.clone()),
                    timeout_seconds,
                    max_tool_iterations,
                    tool_selection: options.tool_selection.clone(),
                    permission_policy: options.permission_policy.clone(),
                    tool_hook_policy: options.tool_hook_policy.clone(),
                    system_prompt: options.system_prompt.clone(),
                })
                .await?;
            Ok::<AgentBackendResult, AgentRuntimeError>(backend_result)
        };
        let backend_result = if timeout_seconds == 0 {
            provider_send.await
        } else {
            match tokio::time::timeout(
                std::time::Duration::from_secs(timeout_seconds),
                provider_send,
            )
            .await
            {
                Ok(result) => result,
                Err(_) => Err(AgentRuntimeError::ProviderFailed(format!(
                    "agent runtime profile timed out after {timeout_seconds}s"
                ))),
            }
        }?;
        let assistant_text = backend_result.assistant_text;
        let loop_events = backend_result.loop_events;
        clear_tool_activation_state(&self.runtime_root);

        if profile.transcript_policy != TranscriptPolicy::None {
            self.append_transcript(&thread_id, &user_text, &assistant_text, &loop_events)?;
        }
        let memory_result = memory_after_turn.then(|| {
            tracing::debug!(
                runtime_root = %self.runtime_root.display(),
                thread_id = %thread_id,
                "agent_runtime_memory_after_turn_started"
            );
            self.record_memory_after_turn(
                &thread_id,
                &thread_id,
                &format!("send-{}", runtime_now_millis()),
                &user_text,
                &assistant_text,
            )
        });
        tracing::info!(
            runtime_root = %self.runtime_root.display(),
            thread_id = %thread_id,
            assistant_len = assistant_text.len(),
            "agent_runtime_send_message_completed"
        );
        Ok(AgentSendResult {
            thread_id,
            user_text,
            assistant_text,
            loop_events,
            context_summary: runtime_context.context_summary,
            memory_result,
        })
    }

    async fn send_ephemeral_message_with_options(
        &self,
        thread_id: String,
        user_text: String,
        options: AgentRuntimeSendOptions,
    ) -> Result<AgentSendResult, AgentRuntimeError> {
        let config = self.read_provider_config()?;
        let history = self.load_thread_history(&thread_id)?;
        let profile = AgentRunProfile {
            kind: AgentRunKind::Btw,
            execution_mode: AgentExecutionMode::Ephemeral,
            transcript_policy: TranscriptPolicy::None,
            parent_context_policy: ParentContextPolicy::CurrentSession,
            parent_session_key: None,
            tool_policy: ToolPolicy::Disabled,
            skill_policy: SkillPolicy::Disabled,
            memory_policy: MemoryPolicy {
                recall: false,
                after_turn: false,
                maintenance_write: false,
            },
            compaction_policy: CompactionPolicy::Disabled,
            limits: AgentRunLimits {
                timeout_seconds: 0,
                max_turns: 1,
            },
            result_policy: AgentResultPolicy::Reply,
            special_agent_id: None,
            system_prompt: None,
            warnings: Vec::new(),
        };
        let timeout_seconds = profile.limits.timeout_seconds;
        let max_tool_iterations = profile.limits.max_turns.max(1) as usize;
        let runtime_context = build_runtime_model_context(
            &self.runtime_root,
            &thread_id,
            &user_text,
            &history,
            &options,
            &profile,
        );
        let model_selection = options.model_selection.as_ref();
        let mut provider_config =
            ProviderResolver::resolve_desktop_config(&config, &self.runtime_root)?;
        apply_agent_model_selection(&mut provider_config, model_selection)?;
        let backend_result = self
            .native_provider_backend
            .send_message(AgentRuntimeRequest {
                runtime_root: &self.runtime_root,
                thread_id: &thread_id,
                user_text: &user_text,
                history,
                runtime_context: runtime_context.clone(),
                provider_config,
                reasoning_level: model_selection.and_then(|model| model.reasoning_level.clone()),
                timeout_seconds,
                max_tool_iterations,
                tool_selection: options.tool_selection.clone(),
                permission_policy: options.permission_policy.clone(),
                tool_hook_policy: options.tool_hook_policy.clone(),
                system_prompt: options.system_prompt.clone(),
            })
            .await?;

        Ok(AgentSendResult {
            thread_id,
            user_text,
            assistant_text: backend_result.assistant_text,
            loop_events: backend_result.loop_events,
            context_summary: runtime_context.context_summary,
            memory_result: None,
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
        loop_events: &[AgentLoopEvent],
    ) -> Result<(), AgentRuntimeError> {
        let store = DesktopSessionStore::new(self.runtime_root.clone());
        for message in model_visible_turn_messages(user_text, assistant_text, loop_events) {
            let role = match message.role {
                AgentRuntimeMessageRole::User => "user",
                AgentRuntimeMessageRole::Assistant => "assistant",
            };
            let content = message.content.clone();
            store
                .append_model_message(thread_id, role, &content, Some("agent"), message)
                .map_err(|error| AgentRuntimeError::TranscriptFailed(error.to_string()))?;
        }
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
        let mut memory_config = crate::memory::MemoryRuntimeConfig::load(&self.runtime_root);
        memory_config.runtime_store.db_path = self
            .runtime_root
            .join("memory")
            .join("runtime.db")
            .to_string_lossy()
            .to_string();
        let runtime =
            crate::memory::MemoryRuntime::with_config(self.runtime_root.clone(), memory_config);
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
        let result = runtime.after_turn(session_id, Some(session_key), &messages, 0);
        tracing::debug!(
            runtime_root = %self.runtime_root.display(),
            session_id,
            session_key,
            ok = result.is_ok(),
            "agent_runtime_memory_after_turn_completed"
        );
        result
    }
}

fn model_visible_turn_messages(
    user_text: &str,
    assistant_text: &str,
    loop_events: &[AgentLoopEvent],
) -> Vec<AgentRuntimeMessage> {
    let mut messages = vec![AgentRuntimeMessage::text(
        AgentRuntimeMessageRole::User,
        user_text,
    )];
    let mut tool_use_blocks = Vec::new();
    let mut tool_names_by_call_id = BTreeMap::new();
    let mut last_progress_by_call_id = BTreeMap::new();
    let mut completed_tools = Vec::new();

    for loop_event in loop_events {
        let AgentLoopEvent::ToolExecution { event } = loop_event else {
            continue;
        };
        match event {
            ToolExecutionEvent::Started {
                call_id,
                tool_name,
                arguments,
            } => {
                tool_names_by_call_id.insert(call_id.clone(), tool_name.clone());
                tool_use_blocks.push(AgentRuntimeMessageBlock::ToolUse {
                    id: call_id.clone(),
                    name: tool_name.clone(),
                    input: arguments.clone(),
                });
            }
            ToolExecutionEvent::Progress {
                call_id, message, ..
            } => {
                if let Some(message) = message.as_ref().filter(|value| !value.trim().is_empty()) {
                    last_progress_by_call_id.insert(call_id.clone(), message.clone());
                }
            }
            ToolExecutionEvent::Completed {
                call_id,
                tool_name,
                output,
                is_error,
            } => {
                let output = output
                    .clone()
                    .or_else(|| last_progress_by_call_id.get(call_id).cloned())
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| {
                        if *is_error {
                            "Tool failed without output.".to_string()
                        } else {
                            "Tool completed without output.".to_string()
                        }
                    });
                completed_tools.push((call_id.clone(), tool_name.clone(), output, *is_error));
            }
            ToolExecutionEvent::PermissionRequested { .. } => {}
        }
    }

    if !tool_use_blocks.is_empty() {
        let names = tool_use_blocks
            .iter()
            .filter_map(|block| match block {
                AgentRuntimeMessageBlock::ToolUse { name, .. } => Some(name.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(", ");
        messages.push(AgentRuntimeMessage {
            role: AgentRuntimeMessageRole::Assistant,
            content: format!("Tool calls: {names}"),
            blocks: tool_use_blocks,
        });
    }

    if !completed_tools.is_empty() {
        let mut content = Vec::new();
        let blocks = completed_tools
            .into_iter()
            .map(|(tool_use_id, tool_name, output, is_error)| {
                let display_name = tool_names_by_call_id
                    .get(&tool_use_id)
                    .map(String::as_str)
                    .unwrap_or(tool_name.as_str());
                content.push(format!("{display_name}: {output}"));
                AgentRuntimeMessageBlock::ToolResult {
                    tool_use_id,
                    content: output,
                    is_error,
                }
            })
            .collect();
        messages.push(AgentRuntimeMessage {
            role: AgentRuntimeMessageRole::User,
            content: content.join("\n\n"),
            blocks,
        });
    }

    messages.push(AgentRuntimeMessage::text(
        AgentRuntimeMessageRole::Assistant,
        assistant_text,
    ));
    messages
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

#[cfg(test)]
mod native_provider_backend_tests {
    use super::*;

    struct BackendRecordingPermissionRequester {
        decision: AgentRuntimePermissionDecision,
        requests: std::sync::Mutex<Vec<AgentRuntimePermissionRequest>>,
    }

    impl BackendRecordingPermissionRequester {
        fn new(decision: AgentRuntimePermissionDecision) -> Self {
            Self {
                decision,
                requests: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn requests(&self) -> Vec<AgentRuntimePermissionRequest> {
            self.requests.lock().expect("requests").clone()
        }
    }

    impl AgentRuntimePermissionRequester for BackendRecordingPermissionRequester {
        fn request_permission<'a>(
            &'a self,
            request: AgentRuntimePermissionRequest,
        ) -> Pin<Box<dyn Future<Output = AgentRuntimePermissionDecision> + Send + 'a>> {
            Box::pin(async move {
                self.requests.lock().expect("requests").push(request);
                self.decision
            })
        }
    }

    struct PermissionedCommandTool;

    #[async_trait::async_trait]
    impl pi::sdk::Tool for PermissionedCommandTool {
        fn name(&self) -> &str {
            "bash"
        }

        fn label(&self) -> &str {
            "bash"
        }

        fn description(&self) -> &str {
            "Runs a command"
        }

        fn parameters(&self) -> Value {
            json!({ "type": "object" })
        }

        async fn execute(
            &self,
            _tool_call_id: &str,
            _input: Value,
            _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
        ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
            Ok(pi::sdk::ToolOutput {
                content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                    "command output",
                ))],
                details: None,
                is_error: false,
            })
        }
    }

    struct HookedTool;

    #[async_trait::async_trait]
    impl pi::sdk::Tool for HookedTool {
        fn name(&self) -> &str {
            "hooked_tool"
        }

        fn label(&self) -> &str {
            "hooked_tool"
        }

        fn description(&self) -> &str {
            "Runs with hooks"
        }

        fn parameters(&self) -> Value {
            json!({ "type": "object" })
        }

        async fn execute(
            &self,
            _tool_call_id: &str,
            _input: Value,
            _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
        ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
            Ok(pi::sdk::ToolOutput {
                content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                    "hooked output",
                ))],
                details: None,
                is_error: false,
            })
        }
    }

    struct ContinuePreHook;

    impl AgentRuntimePreToolUseHook for ContinuePreHook {
        fn pre_tool_use<'a>(
            &'a self,
            request: AgentRuntimePreToolUseRequest,
        ) -> Pin<Box<dyn Future<Output = AgentRuntimePreToolUseDecision> + Send + 'a>> {
            Box::pin(async move {
                AgentRuntimePreToolUseDecision::Continue {
                    input: request.input,
                    additional_context: vec!["pre hook context".to_string()],
                }
            })
        }
    }

    struct ContinuePostHook;

    impl AgentRuntimePostToolUseHook for ContinuePostHook {
        fn post_tool_use<'a>(
            &'a self,
            _request: AgentRuntimePostToolUseRequest,
        ) -> Pin<Box<dyn Future<Output = AgentRuntimePostToolUseDecision> + Send + 'a>> {
            Box::pin(async move {
                AgentRuntimePostToolUseDecision::Continue {
                    updated_mcp_tool_output: None,
                    additional_context: vec!["post hook context".to_string()],
                }
            })
        }
    }

    struct ProgressTool;

    #[async_trait::async_trait]
    impl pi::sdk::Tool for ProgressTool {
        fn name(&self) -> &str {
            "progress_tool"
        }

        fn label(&self) -> &str {
            "progress_tool"
        }

        fn description(&self) -> &str {
            "Reports progress before completing"
        }

        fn parameters(&self) -> Value {
            json!({ "type": "object" })
        }

        async fn execute(
            &self,
            _tool_call_id: &str,
            _input: Value,
            on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
        ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
            if let Some(on_update) = on_update {
                on_update(pi::sdk::ToolUpdate {
                    content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                        "partial progress",
                    ))],
                    details: Some(json!({ "phase": "running" })),
                });
            }
            Ok(pi::sdk::ToolOutput {
                content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                    "final output",
                ))],
                details: None,
                is_error: false,
            })
        }
    }

    struct LargeOutputTool;

    #[async_trait::async_trait]
    impl pi::sdk::Tool for LargeOutputTool {
        fn name(&self) -> &str {
            "large_output"
        }

        fn label(&self) -> &str {
            "large_output"
        }

        fn description(&self) -> &str {
            "Returns a large tool result"
        }

        fn parameters(&self) -> Value {
            json!({ "type": "object" })
        }

        async fn execute(
            &self,
            _tool_call_id: &str,
            _input: Value,
            _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
        ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
            Ok(pi::sdk::ToolOutput {
                content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                    format!("{}tail-marker", "large-tool-output ".repeat(900)),
                ))],
                details: None,
                is_error: false,
            })
        }
    }

    #[tokio::test]
    async fn native_provider_tool_execution_surfaces_tool_updates() {
        let registry = pi::sdk::ToolRegistry::from_tools(vec![Box::new(ProgressTool)]);
        let tool_calls = vec![crawclaw_providers::NativeProviderToolCall {
            id: "call_progress".to_string(),
            name: "progress_tool".to_string(),
            arguments: json!({}),
        }];
        let mut loop_events = Vec::new();

        let messages =
            execute_native_provider_tool_calls(&registry, &tool_calls, &mut loop_events).await;

        assert_eq!(messages.len(), 1);
        let progress_index = loop_events
            .iter()
            .position(|event| {
                matches!(
                    event,
                    AgentLoopEvent::ToolExecution {
                        event: ToolExecutionEvent::Progress {
                            call_id,
                            tool_name,
                            status,
                            message: Some(message)
                        }
                    } if call_id == "call_progress"
                        && tool_name == "progress_tool"
                        && status == "running"
                        && message == "partial progress"
                )
            })
            .expect("progress event");
        let completed_index = loop_events
            .iter()
            .position(|event| {
                matches!(
                    event,
                    AgentLoopEvent::ToolExecution {
                        event: ToolExecutionEvent::Completed {
                            call_id,
                            output: Some(output),
                            ..
                        }
                    } if call_id == "call_progress" && output == "final output"
                )
            })
            .expect("completed event");
        assert!(
            progress_index < completed_index,
            "tool progress should be surfaced before completion"
        );
    }

    #[tokio::test]
    async fn native_provider_tool_execution_projects_large_results_for_next_loop() {
        let registry = pi::sdk::ToolRegistry::from_tools(vec![Box::new(LargeOutputTool)]);
        let tool_calls = vec![crawclaw_providers::NativeProviderToolCall {
            id: "call_large".to_string(),
            name: "large_output".to_string(),
            arguments: json!({}),
        }];
        let mut loop_events = Vec::new();

        let messages =
            execute_native_provider_tool_calls(&registry, &tool_calls, &mut loop_events).await;

        assert_eq!(messages.len(), 1);
        let content = &messages[0].content;
        assert!(content.contains("projected for context budget"));
        assert!(!content.contains("tail-marker"));
        assert!(loop_events.iter().any(|event| {
            matches!(
                event,
                AgentLoopEvent::ToolExecution {
                    event: ToolExecutionEvent::Completed {
                        call_id,
                        output: Some(output),
                        ..
                    }
                } if call_id == "call_large"
                    && output.contains("projected for context budget")
                    && !output.contains("tail-marker")
            )
        }));
    }

    #[tokio::test]
    async fn native_provider_tool_execution_surfaces_permission_requests() {
        let requester = Arc::new(BackendRecordingPermissionRequester::new(
            AgentRuntimePermissionDecision::Approved,
        ));
        let registry = apply_permission_policy_to_registry(
            pi::sdk::ToolRegistry::from_tools(vec![Box::new(PermissionedCommandTool)]),
            Some(
                AgentRuntimePermissionPolicy::workspace()
                    .with_confirm_commands(true)
                    .with_requester(requester.clone()),
            ),
        );
        let tool_calls = vec![crawclaw_providers::NativeProviderToolCall {
            id: "call_bash".to_string(),
            name: "bash".to_string(),
            arguments: json!({ "command": "printf hi" }),
        }];
        let mut loop_events = Vec::new();

        let messages =
            execute_native_provider_tool_calls(&registry, &tool_calls, &mut loop_events).await;

        assert_eq!(messages.len(), 1);
        assert_eq!(requester.requests().len(), 1);
        let permission_index = loop_events
            .iter()
            .position(|event| {
                matches!(
                    event,
                    AgentLoopEvent::ToolExecution {
                        event: ToolExecutionEvent::PermissionRequested {
                            request_id,
                            tool_name,
                            reason,
                        }
                    } if request_id == "call_bash"
                        && tool_name == "bash"
                        && reason.contains("printf hi")
                )
            })
            .expect("permission requested event");
        let completed_index = loop_events
            .iter()
            .position(|event| {
                matches!(
                    event,
                    AgentLoopEvent::ToolExecution {
                        event: ToolExecutionEvent::Completed {
                            call_id,
                            is_error: false,
                            ..
                        }
                    } if call_id == "call_bash"
                )
            })
            .expect("completed event");
        assert!(
            permission_index < completed_index,
            "permission request should be surfaced before tool completion"
        );
    }

    #[tokio::test]
    async fn native_provider_tool_execution_surfaces_hook_decisions() {
        let registry = apply_tool_hook_policy_to_registry(
            pi::sdk::ToolRegistry::from_tools(vec![Box::new(HookedTool)]),
            Some(AgentRuntimeToolHookPolicy::with_tool_hooks(
                Some(Arc::new(ContinuePreHook)),
                Some(Arc::new(ContinuePostHook)),
            )),
        );
        let tool_calls = vec![crawclaw_providers::NativeProviderToolCall {
            id: "call_hooked".to_string(),
            name: "hooked_tool".to_string(),
            arguments: json!({}),
        }];
        let mut loop_events = Vec::new();

        let messages =
            execute_native_provider_tool_calls(&registry, &tool_calls, &mut loop_events).await;

        assert_eq!(messages.len(), 1);
        let pre_hook_index = loop_events
            .iter()
            .position(|event| {
                matches!(
                    event,
                    AgentLoopEvent::Hook {
                        event: HookEvent {
                            hook,
                            decision,
                            message: Some(message),
                        }
                    } if hook == "PreToolUse"
                        && decision == "continue"
                        && message.contains("pre hook context")
                )
            })
            .expect("pre hook decision event");
        let post_hook_index = loop_events
            .iter()
            .position(|event| {
                matches!(
                    event,
                    AgentLoopEvent::Hook {
                        event: HookEvent {
                            hook,
                            decision,
                            message: Some(message),
                        }
                    } if hook == "PostToolUse"
                        && decision == "continue"
                        && message.contains("post hook context")
                )
            })
            .expect("post hook decision event");
        let completed_index = loop_events
            .iter()
            .position(|event| {
                matches!(
                    event,
                    AgentLoopEvent::ToolExecution {
                        event: ToolExecutionEvent::Completed {
                            call_id,
                            is_error: false,
                            ..
                        }
                    } if call_id == "call_hooked"
                )
            })
            .expect("completed event");
        assert!(pre_hook_index < completed_index);
        assert!(post_hook_index < completed_index);
    }
}
