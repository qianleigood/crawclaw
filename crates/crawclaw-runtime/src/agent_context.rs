use super::*;

const ALWAYS_LOAD_TOOLS: &[&str] = &[
    "tool_search",
    "ToolSearch",
    "discover_skills",
    "Skill",
    "load_skill",
    "StructuredOutput",
];
const MAX_SURFACED_SKILLS: usize = 5;
const MAX_MEMORY_SNIPPETS: usize = 3;
const MAX_MEMORY_SNIPPET_CHARS: usize = 360;
const MAX_LOADED_SKILL_CHARS: usize = 12_000;
const DEFAULT_CONTEXT_WINDOW_TOKENS: usize = 128_000;
const DEFAULT_OUTPUT_RESERVE_TOKENS: usize = 16_384;
const CONTEXT_NEAR_LIMIT_PERCENT: usize = 85;

#[derive(Clone, Debug)]
pub(crate) struct SkillCandidate {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) content: String,
    pub(crate) score: usize,
}

pub(crate) fn build_runtime_model_context(
    runtime_root: &Path,
    thread_id: &str,
    user_text: &str,
    history: &[AgentRuntimeMessage],
    options: &AgentRuntimeSendOptions,
    profile: &AgentRunProfile,
) -> RuntimeModelContext {
    let tool_descriptors = tool_descriptors_for_context(runtime_root, options, profile);
    let selected_deferred_tools = read_tool_activation_state(runtime_root);
    let mut included_tool_schemas = Vec::new();
    let mut deferred_tool_names = Vec::new();

    for descriptor in tool_descriptors {
        let always_load = ALWAYS_LOAD_TOOLS.contains(&descriptor.name.as_str());
        let selected = selected_deferred_tools.contains(&descriptor.name);
        let profile_required = matches!(profile.tool_policy, ToolPolicy::AllowList(_));
        if always_load || selected || profile_required {
            included_tool_schemas.push(descriptor);
        } else {
            deferred_tool_names.push(descriptor.name);
        }
    }

    included_tool_schemas.sort_by_key(|descriptor| {
        ALWAYS_LOAD_TOOLS
            .iter()
            .position(|tool| *tool == descriptor.name)
            .unwrap_or(ALWAYS_LOAD_TOOLS.len())
    });
    deferred_tool_names.sort();

    let surfaced_skills = match profile.skill_policy {
        SkillPolicy::Default => ranked_skill_summaries(runtime_root, user_text, options),
        SkillPolicy::Disabled => Vec::new(),
    };
    let loaded_skills = match profile.skill_policy {
        SkillPolicy::Default => loaded_skill_contents(runtime_root),
        SkillPolicy::Disabled => Vec::new(),
    };
    let loaded_skill_names = loaded_skills
        .iter()
        .map(|skill| skill.name.clone())
        .collect::<Vec<_>>();
    let loaded_skill_contents = loaded_skills
        .iter()
        .map(|skill| skill.content.clone())
        .collect::<Vec<_>>();
    let memory_snippets = if profile.memory_policy.recall {
        ranked_memory_snippets(runtime_root, user_text)
    } else {
        Vec::new()
    };
    let compaction = compaction_summary(runtime_root, thread_id, history, profile);
    let projected_history =
        project_compacted_history(runtime_root, thread_id, history, &compaction);
    let parent_messages = parent_context_messages(runtime_root, profile);
    let parent_message_count = parent_messages.len();
    let projected_history_message_count = projected_history.len();
    let mut messages = parent_messages;
    messages.extend(projected_history);
    messages.push(AgentRuntimeMessage::text(
        AgentRuntimeMessageRole::User,
        user_text,
    ));
    let messages = ensure_tool_result_pairing(messages);
    let mut system_sections = Vec::new();
    if let Some(system_prompt) = options
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        system_sections.push(system_prompt.to_string());
    }
    if let Some(system_prompt) = agent_prompts::render_agent_prompt(profile) {
        let system_prompt = system_prompt.trim();
        if !system_prompt.is_empty() {
            system_sections.push(system_prompt.to_string());
        }
    }
    if let Some(section) = compaction_system_section(runtime_root, thread_id) {
        system_sections.push(section);
    }
    if !loaded_skill_contents.is_empty() {
        system_sections.push(format!(
            "Loaded skill instructions:\n\n{}",
            loaded_skill_contents.join("\n\n---\n\n")
        ));
    }
    if included_tool_schemas
        .iter()
        .any(|descriptor| descriptor.name == "StructuredOutput")
    {
        system_sections.push(
            "Use this tool to return your final response in the requested structured format. You MUST call this tool exactly once at the end of your response to provide the structured output."
                .to_string(),
        );
    }
    system_sections.push(context_system_section(
        &included_tool_schemas,
        &deferred_tool_names,
        &surfaced_skills,
        &memory_snippets,
    ));

    let max_prompt_tokens = max_prompt_tokens_for_runtime(runtime_root);
    let (messages, overflow_projection_applied) = project_messages_for_context_budget(
        system_sections.as_slice(),
        messages,
        &surfaced_skills,
        &memory_snippets,
        max_prompt_tokens,
    );
    let estimated_tokens = estimate_context_tokens(
        &system_sections,
        &messages,
        &surfaced_skills,
        &memory_snippets,
    );
    let projection = ContextProjection {
        profile_kind: profile.kind.as_summary_str().to_string(),
        parent_context_policy: profile.parent_context_policy.as_summary_str().to_string(),
        history_message_count: history.len(),
        parent_message_count,
        projected_history_message_count,
        projected_message_count: messages.len(),
        retained_tail_message_count: compaction.retained_message_count,
        compaction_active: compaction.active,
        collapse_state: if overflow_projection_applied {
            "overflow-tail".to_string()
        } else if compaction.active {
            "summary-plus-tail".to_string()
        } else {
            "none".to_string()
        },
    };
    let budget = ContextBudgetReport {
        estimated_tokens,
        max_prompt_tokens,
        state: context_budget_state(
            estimated_tokens,
            max_prompt_tokens,
            overflow_projection_applied,
        )
        .to_string(),
        overflow_retry_enabled: overflow_projection_applied
            || estimated_tokens >= near_limit_tokens(max_prompt_tokens),
    };
    let mut warnings = profile.warnings.clone();
    if overflow_projection_applied {
        warnings.push(
            "Context exceeded the estimated prompt budget; older messages were projected out for this turn."
                .to_string(),
        );
    }
    let context_summary = AgentRuntimeContextSummary {
        profile_kind: profile.kind.as_summary_str().to_string(),
        parent_context_policy: profile.parent_context_policy.as_summary_str().to_string(),
        agent_definition: Some(agent_definition_id(profile)),
        projection,
        budget,
        included_tools: included_tool_schemas
            .iter()
            .map(|descriptor| descriptor.name.clone())
            .collect(),
        deferred_tools: deferred_tool_names.clone(),
        activated_tools: selected_deferred_tools.iter().cloned().collect(),
        surfaced_skills: surfaced_skills.clone(),
        loaded_skills: loaded_skill_names,
        memory_snippets,
        compaction,
        warnings,
        message_count: messages.len(),
        estimated_tokens,
    };

    RuntimeModelContext {
        system_sections,
        messages,
        included_tool_schemas,
        deferred_tool_names,
        surfaced_skills,
        loaded_skill_contents,
        context_summary,
    }
}

fn agent_definition_id(profile: &AgentRunProfile) -> String {
    agent_prompts::default_agent_definition(profile).id
}

fn tool_descriptors_for_context(
    runtime_root: &Path,
    options: &AgentRuntimeSendOptions,
    profile: &AgentRunProfile,
) -> Vec<RustAgentToolDescriptor> {
    let mut descriptors = match &options.tool_selection {
        AgentRuntimeToolSelection::Disabled => Vec::new(),
        AgentRuntimeToolSelection::Default => {
            pi_agent_rust_tool_descriptors_for_runtime_root(runtime_root)
        }
        AgentRuntimeToolSelection::AllowList(allowlist) => {
            let allowlist = allowlist
                .iter()
                .map(|tool| tool.trim())
                .filter(|tool| !tool.is_empty())
                .collect::<BTreeSet<_>>();
            pi_agent_rust_tool_descriptors_for_runtime_root(runtime_root)
                .into_iter()
                .filter(|descriptor| {
                    allowlist.iter().any(|rule| {
                        crate::core_tools::tool_name_matches_rule(&descriptor.name, rule)
                    })
                })
                .collect()
        }
    };

    descriptors = match &profile.tool_policy {
        ToolPolicy::Disabled => Vec::new(),
        ToolPolicy::AllowList(allowlist) => {
            let allowlist = allowlist
                .iter()
                .map(|tool| tool.trim())
                .filter(|tool| !tool.is_empty())
                .collect::<BTreeSet<_>>();
            descriptors
                .into_iter()
                .filter(|descriptor| {
                    allowlist.iter().any(|rule| {
                        crate::core_tools::tool_name_matches_rule(&descriptor.name, rule)
                    })
                })
                .collect()
        }
        ToolPolicy::Default => descriptors
            .into_iter()
            .filter(|descriptor| !is_special_agent_only_tool(descriptor.name.as_str()))
            .collect(),
    };

    if options
        .permission_policy
        .as_ref()
        .is_some_and(|policy| policy.mode == AgentRuntimePermissionMode::ReadOnly)
    {
        descriptors.retain(|descriptor| descriptor.read_only);
    }
    descriptors
}

pub(crate) fn record_tool_activation_state(
    runtime_root: &Path,
    tools: &[String],
) -> Result<(), String> {
    let tools = tools
        .iter()
        .map(|tool| tool.trim())
        .filter(|tool| !tool.is_empty() && !is_special_agent_only_tool(tool))
        .map(ToOwned::to_owned)
        .collect::<BTreeSet<_>>();
    let dir = runtime_root.join("tool-activation");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create tool activation state dir: {error}"))?;
    let body = serde_json::to_vec_pretty(&json!({ "activatedTools": tools }))
        .map_err(|error| format!("failed to encode tool activation state: {error}"))?;
    fs::write(dir.join("next.json"), body)
        .map_err(|error| format!("failed to write tool activation state: {error}"))
}

pub(crate) fn clear_tool_activation_state(runtime_root: &Path) {
    let _ = fs::remove_file(runtime_root.join("tool-activation").join("next.json"));
}

pub(crate) fn record_loaded_skill_state(
    runtime_root: &Path,
    skills: &[String],
) -> Result<(), String> {
    let mut loaded = read_loaded_skill_state(runtime_root);
    loaded.extend(
        skills
            .iter()
            .map(|skill| skill.trim())
            .filter(|skill| !skill.is_empty())
            .map(ToOwned::to_owned),
    );
    let dir = runtime_root.join("skill-activation");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create loaded skill state dir: {error}"))?;
    let body = serde_json::to_vec_pretty(&json!({ "loadedSkills": loaded }))
        .map_err(|error| format!("failed to encode loaded skill state: {error}"))?;
    fs::write(dir.join("loaded.json"), body)
        .map_err(|error| format!("failed to write loaded skill state: {error}"))
}

fn read_tool_activation_state(runtime_root: &Path) -> BTreeSet<String> {
    let Ok(raw) = fs::read_to_string(runtime_root.join("tool-activation").join("next.json")) else {
        return BTreeSet::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return BTreeSet::new();
    };
    value
        .get("activatedTools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|tool| !tool.is_empty() && !is_special_agent_only_tool(tool))
        .map(ToOwned::to_owned)
        .collect()
}

fn read_loaded_skill_state(runtime_root: &Path) -> BTreeSet<String> {
    let Ok(raw) = fs::read_to_string(runtime_root.join("skill-activation").join("loaded.json"))
    else {
        return BTreeSet::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return BTreeSet::new();
    };
    value
        .get("loadedSkills")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|skill| !skill.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn loaded_skill_contents(runtime_root: &Path) -> Vec<SkillCandidate> {
    let loaded = read_loaded_skill_state(runtime_root)
        .into_iter()
        .map(|skill| skill.to_lowercase())
        .collect::<BTreeSet<_>>();
    if loaded.is_empty() {
        return Vec::new();
    }
    let mut skills = load_skill_candidates(runtime_root, "");
    skills.retain(|skill| loaded.contains(&skill.name.to_lowercase()));
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
        .into_iter()
        .map(|mut skill| {
            skill.content = skill
                .content
                .chars()
                .take(MAX_LOADED_SKILL_CHARS)
                .collect::<String>();
            skill
        })
        .collect()
}

fn ranked_skill_summaries(
    runtime_root: &Path,
    user_text: &str,
    options: &AgentRuntimeSendOptions,
) -> Vec<AgentRuntimeSkillSummary> {
    let mut query = user_text.to_string();
    if let Some(system_prompt) = options.system_prompt.as_deref() {
        query.push('\n');
        query.push_str(system_prompt);
    }
    let mut skills = load_skill_candidates(runtime_root, &query);
    skills.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
    skills
        .into_iter()
        .filter(|skill| skill.score > 0)
        .take(MAX_SURFACED_SKILLS)
        .map(|skill| AgentRuntimeSkillSummary {
            name: skill.name,
            description: skill.description,
        })
        .collect()
}

pub(crate) fn load_skill_candidates(runtime_root: &Path, query: &str) -> Vec<SkillCandidate> {
    let terms = query_terms(query);
    let mut skills = Vec::new();
    let skills_root = runtime_root.join("skills");
    let Ok(entries) = fs::read_dir(&skills_root) else {
        return skills;
    };
    for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
        let path = entry.path().join("SKILL.md");
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let name = frontmatter_field(&raw, "name")
            .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
        let description = frontmatter_field(&raw, "description").unwrap_or_default();
        let haystack = format!("{name} {description} {raw}").to_lowercase();
        let score = terms
            .iter()
            .filter(|term| haystack.contains(term.as_str()))
            .count();
        skills.push(SkillCandidate {
            name,
            description,
            content: raw,
            score,
        });
    }
    skills
}

fn ranked_memory_snippets(runtime_root: &Path, user_text: &str) -> Vec<String> {
    use crate::memory::{MemoryRuntime, recall_pipeline};

    let runtime = MemoryRuntime::new(runtime_root);
    let config = runtime.config();

    if !config.hindsight.enabled {
        return Vec::new();
    }

    let Some(client) = runtime.hindsight() else {
        return Vec::new();
    };

    if !client.is_configured() {
        return Vec::new();
    }

    let ctx = runtime.bank_context("main");
    let recall_config = recall_pipeline::RecallConfig::from(&config.hindsight);
    let query = recall_pipeline::compose_recall_query(user_text, &[], &recall_config);

    let items = recall_pipeline::parallel_recall(
        client,
        &crate::memory::bank_resolver::BankResolverConfig::from_hindsight_config(&config.hindsight),
        &ctx,
        &query,
        &recall_config,
    );

    items
        .into_iter()
        .take(MAX_MEMORY_SNIPPETS)
        .map(|item| {
            let text = item.text;
            text.chars()
                .take(MAX_MEMORY_SNIPPET_CHARS)
                .collect::<String>()
        })
        .collect()
}

fn compaction_summary(
    runtime_root: &Path,
    thread_id: &str,
    history: &[AgentRuntimeMessage],
    profile: &AgentRunProfile,
) -> AgentRuntimeCompactionSummary {
    let summary_path = runtime_root
        .join("memory")
        .join("session-summary")
        .join(format!("{thread_id}.md"));
    let active =
        profile.compaction_policy == CompactionPolicy::SummaryPlusTail || summary_path.exists();
    let state = read_compaction_state(runtime_root, thread_id);
    let retained_message_count = if active {
        state
            .tail_start_message_index
            .map(|tail_start| {
                history
                    .len()
                    .saturating_sub(safe_tail_start_index(history, tail_start))
            })
            .unwrap_or(0)
    } else {
        history.len()
    };
    AgentRuntimeCompactionSummary {
        active,
        compacted_through: state.compacted_through_message_id,
        first_kept_message_id: state.first_kept_message_id,
        tail_start_message_id: state.tail_start_message_id,
        retained_message_count,
    }
}

fn compaction_system_section(runtime_root: &Path, thread_id: &str) -> Option<String> {
    let path = runtime_root
        .join("memory")
        .join("session-summary")
        .join(format!("{thread_id}.md"));
    let Ok(summary) = fs::read_to_string(path) else {
        return None;
    };
    let summary = summary.trim();
    (!summary.is_empty()).then(|| format!("Compacted session summary:\n{summary}"))
}

fn project_compacted_history(
    runtime_root: &Path,
    thread_id: &str,
    history: &[AgentRuntimeMessage],
    compaction: &AgentRuntimeCompactionSummary,
) -> Vec<AgentRuntimeMessage> {
    if !compaction.active {
        return history.to_vec();
    }
    let Some(tail_start) = read_compaction_state(runtime_root, thread_id).tail_start_message_index
    else {
        return Vec::new();
    };
    let tail_start = safe_tail_start_index(history, tail_start);
    history
        .iter()
        .skip(tail_start.min(history.len()))
        .cloned()
        .collect()
}

fn project_messages_for_context_budget(
    system_sections: &[String],
    messages: Vec<AgentRuntimeMessage>,
    surfaced_skills: &[AgentRuntimeSkillSummary],
    memory_snippets: &[String],
    max_prompt_tokens: usize,
) -> (Vec<AgentRuntimeMessage>, bool) {
    if estimate_context_tokens(system_sections, &messages, surfaced_skills, memory_snippets)
        <= max_prompt_tokens
    {
        return (messages, false);
    }
    let mut desired_start = 1;
    while desired_start < messages.len() {
        let tail_start = safe_tail_start_index(&messages, desired_start);
        let candidate = messages
            .iter()
            .skip(tail_start.min(messages.len()))
            .cloned()
            .collect::<Vec<_>>();
        if estimate_context_tokens(
            system_sections,
            &candidate,
            surfaced_skills,
            memory_snippets,
        ) <= max_prompt_tokens
        {
            return (candidate, true);
        }
        desired_start = tail_start.max(desired_start).saturating_add(1);
    }
    (
        messages
            .last()
            .cloned()
            .map(|message| vec![message])
            .unwrap_or_default(),
        true,
    )
}

fn ensure_tool_result_pairing(messages: Vec<AgentRuntimeMessage>) -> Vec<AgentRuntimeMessage> {
    let mut repaired = Vec::with_capacity(messages.len());
    for (index, message) in messages.iter().enumerate() {
        let missing_results = missing_tool_results_after_message(&messages, index);
        repaired.push(message.clone());
        if !missing_results.is_empty() {
            let blocks = missing_results
                .iter()
                .map(|(tool_use_id, _)| AgentRuntimeMessageBlock::ToolResult {
                    tool_use_id: tool_use_id.clone(),
                    content: "Synthetic error: tool result was missing from session history."
                        .to_string(),
                    is_error: true,
                })
                .collect::<Vec<_>>();
            let content = missing_results
                .into_iter()
                .map(|(_, tool_name)| {
                    format!("{tool_name}: Synthetic error: tool result was missing from session history.")
                })
                .collect::<Vec<_>>()
                .join("\n");
            repaired.push(AgentRuntimeMessage {
                role: AgentRuntimeMessageRole::User,
                content,
                blocks,
            });
        }
    }
    repaired
}

fn missing_tool_results_after_message(
    messages: &[AgentRuntimeMessage],
    index: usize,
) -> Vec<(String, String)> {
    let message = &messages[index];
    if message.role != AgentRuntimeMessageRole::Assistant {
        return Vec::new();
    }
    let tool_uses = message
        .blocks
        .iter()
        .filter_map(|block| match block {
            AgentRuntimeMessageBlock::ToolUse { id, name, .. } => Some((id.clone(), name.clone())),
            _ => None,
        })
        .collect::<Vec<_>>();
    if tool_uses.is_empty() {
        return Vec::new();
    }
    let next_result_ids = messages
        .get(index + 1)
        .filter(|message| message.role == AgentRuntimeMessageRole::User)
        .map(|message| tool_result_ids(std::slice::from_ref(message)))
        .unwrap_or_default();
    tool_uses
        .into_iter()
        .filter(|(tool_use_id, _)| !next_result_ids.contains(tool_use_id))
        .collect()
}

fn max_prompt_tokens_for_runtime(runtime_root: &Path) -> usize {
    let settings = context_budget_settings(runtime_root);
    settings
        .context_window_tokens
        .saturating_sub(settings.reserve_tokens)
        .max(1)
}

#[derive(Clone, Copy)]
struct ContextBudgetSettings {
    context_window_tokens: usize,
    reserve_tokens: usize,
}

fn context_budget_settings(runtime_root: &Path) -> ContextBudgetSettings {
    let mut settings = ContextBudgetSettings {
        context_window_tokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
        reserve_tokens: DEFAULT_OUTPUT_RESERVE_TOKENS,
    };
    let path = runtime_root.join("config").join("crawclaw.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return settings;
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return settings;
    };
    if let Some(context_tokens) = positive_usize_at(&value, "/agents/defaults/contextTokens") {
        settings.context_window_tokens = context_tokens;
    }
    if let Some(reserve_tokens) =
        positive_usize_at(&value, "/agents/defaults/compaction/reserveTokens")
    {
        settings.reserve_tokens = reserve_tokens;
    }
    settings
}

fn positive_usize_at(value: &Value, pointer: &str) -> Option<usize> {
    value
        .pointer(pointer)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
}

fn near_limit_tokens(max_prompt_tokens: usize) -> usize {
    max_prompt_tokens.saturating_mul(CONTEXT_NEAR_LIMIT_PERCENT) / 100
}

fn context_budget_state(
    estimated_tokens: usize,
    max_prompt_tokens: usize,
    overflow_projection_applied: bool,
) -> &'static str {
    if overflow_projection_applied {
        "reduced"
    } else if estimated_tokens > max_prompt_tokens {
        "over-budget"
    } else if estimated_tokens >= near_limit_tokens(max_prompt_tokens) {
        "near-limit"
    } else {
        "within-budget"
    }
}

#[derive(Default)]
struct CompactionState {
    compacted_through_message_id: Option<String>,
    first_kept_message_id: Option<String>,
    tail_start_message_id: Option<String>,
    tail_start_message_index: Option<usize>,
}

fn read_compaction_state(runtime_root: &Path, thread_id: &str) -> CompactionState {
    let path = runtime_root
        .join("memory")
        .join("session-summary")
        .join(format!("{thread_id}.state.json"));
    let Ok(raw) = fs::read_to_string(path) else {
        return CompactionState::default();
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return CompactionState::default();
    };
    CompactionState {
        compacted_through_message_id: value
            .get("compactedThroughMessageId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        first_kept_message_id: value
            .get("firstKeptMessageId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        tail_start_message_id: value
            .get("tailStartMessageId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        tail_start_message_index: value
            .get("tailStartMessageIndex")
            .or_else(|| value.get("preservedTailStartTurn"))
            .and_then(Value::as_u64)
            .map(|value| value as usize),
    }
}

fn safe_tail_start_index(history: &[AgentRuntimeMessage], desired_start: usize) -> usize {
    let mut start = desired_start.min(history.len());
    loop {
        let tail_tool_uses = tool_use_ids(&history[start..]);
        let missing_results = tool_result_ids(&history[start..])
            .into_iter()
            .filter(|tool_use_id| !tail_tool_uses.contains(tool_use_id))
            .collect::<BTreeSet<_>>();
        if missing_results.is_empty() {
            return start;
        }
        let mut adjusted_start = start;
        for (index, message) in history[..start].iter().enumerate().rev() {
            if message.blocks.iter().any(|block| {
                matches!(
                    block,
                    AgentRuntimeMessageBlock::ToolUse { id, .. }
                        if missing_results.contains(id)
                )
            }) {
                adjusted_start = adjusted_start.min(index);
            }
        }
        if adjusted_start == start {
            return start;
        }
        start = adjusted_start;
    }
}

fn tool_use_ids(messages: &[AgentRuntimeMessage]) -> BTreeSet<String> {
    messages
        .iter()
        .flat_map(|message| message.blocks.iter())
        .filter_map(|block| match block {
            AgentRuntimeMessageBlock::ToolUse { id, .. } => Some(id.clone()),
            _ => None,
        })
        .collect()
}

fn tool_result_ids(messages: &[AgentRuntimeMessage]) -> BTreeSet<String> {
    messages
        .iter()
        .flat_map(|message| message.blocks.iter())
        .filter_map(|block| match block {
            AgentRuntimeMessageBlock::ToolResult { tool_use_id, .. } => Some(tool_use_id.clone()),
            _ => None,
        })
        .collect()
}

fn parent_context_messages(
    runtime_root: &Path,
    profile: &AgentRunProfile,
) -> Vec<AgentRuntimeMessage> {
    if !matches!(
        profile.parent_context_policy,
        ParentContextPolicy::ForkMessagesOnly | ParentContextPolicy::FullEnvelope
    ) {
        return Vec::new();
    }
    let Some(parent_session_key) = profile.parent_session_key.as_deref() else {
        return Vec::new();
    };
    load_session_history(runtime_root, parent_session_key).unwrap_or_default()
}

fn load_session_history(
    runtime_root: &Path,
    thread_id: &str,
) -> Result<Vec<AgentRuntimeMessage>, AgentRuntimeError> {
    let path = runtime_root
        .join("sessions")
        .join(format!("{thread_id}.jsonl"));
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(AgentRuntimeError::TranscriptFailed(format!(
                "Failed to read parent session transcript: {error}"
            )));
        }
    };
    parse_agent_runtime_history(&raw, &path)
}

fn query_terms(query: &str) -> BTreeSet<String> {
    query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 2)
        .map(str::to_lowercase)
        .collect()
}

fn context_system_section(
    included_tool_schemas: &[RustAgentToolDescriptor],
    deferred_tool_names: &[String],
    surfaced_skills: &[AgentRuntimeSkillSummary],
    memory_snippets: &[String],
) -> String {
    let included_tools = included_tool_schemas
        .iter()
        .map(|descriptor| descriptor.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let surfaced = surfaced_skills
        .iter()
        .map(|skill| format!("{}: {}", skill.name, skill.description))
        .collect::<Vec<_>>()
        .join("\n");
    let memory = memory_snippets.join("\n");
    format!(
        "Context disclosure:\n- Included tools: {included_tools}\n- Deferred tool count: {}\n- Use tool_search to activate deferred tools before using them.\n- Skill summaries surfaced this turn:\n{}\n- Relevant memory snippets:\n{}",
        deferred_tool_names.len(),
        if surfaced.is_empty() { "(none)" } else { &surfaced },
        if memory.is_empty() { "(none)" } else { &memory },
    )
}

fn estimate_context_tokens(
    system_sections: &[String],
    messages: &[AgentRuntimeMessage],
    surfaced_skills: &[AgentRuntimeSkillSummary],
    memory_snippets: &[String],
) -> usize {
    let chars = system_sections.iter().map(String::len).sum::<usize>()
        + messages
            .iter()
            .map(|message| message.content.len())
            .sum::<usize>()
        + surfaced_skills
            .iter()
            .map(|skill| skill.name.len() + skill.description.len())
            .sum::<usize>()
        + memory_snippets.iter().map(String::len).sum::<usize>();
    chars.div_ceil(4).max(1)
}

fn frontmatter_field(raw: &str, key: &str) -> Option<String> {
    let mut lines = raw.lines();
    if lines.next()? != "---" {
        return None;
    }
    for line in lines {
        if line == "---" {
            break;
        }
        let (field, value) = line.split_once(':')?;
        if field.trim() == key {
            return Some(value.trim().trim_matches('"').to_string());
        }
    }
    None
}
