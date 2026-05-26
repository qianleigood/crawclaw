use super::*;

const ALWAYS_LOAD_TOOLS: &[&str] = &["tool_search", "discover_skills", "load_skill"];
const MAX_SURFACED_SKILLS: usize = 5;
const MAX_MEMORY_SNIPPETS: usize = 3;
const MAX_MEMORY_SNIPPET_CHARS: usize = 360;

#[derive(Clone, Debug)]
pub(crate) struct SkillCandidate {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) content: String,
    pub(crate) score: usize,
}

pub(crate) fn build_runtime_model_context(
    runtime_root: &Path,
    user_text: &str,
    history: &[AgentRuntimeMessage],
    options: &AgentRuntimeSendOptions,
) -> RuntimeModelContext {
    let tool_descriptors = tool_descriptors_for_context(runtime_root, options);
    let selected_deferred_tools = selected_deferred_tools_from_history(history);
    let mut included_tool_schemas = Vec::new();
    let mut deferred_tool_names = Vec::new();

    for descriptor in tool_descriptors {
        let always_load = ALWAYS_LOAD_TOOLS.contains(&descriptor.name.as_str());
        let selected = selected_deferred_tools.contains(&descriptor.name);
        if always_load || selected {
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

    let surfaced_skills = ranked_skill_summaries(runtime_root, user_text, options);
    let memory_snippets = ranked_memory_snippets(runtime_root, user_text);
    let mut system_sections = Vec::new();
    if let Some(system_prompt) = options
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        system_sections.push(system_prompt.to_string());
    }
    system_sections.push(context_system_section(
        &included_tool_schemas,
        &deferred_tool_names,
        &surfaced_skills,
        &memory_snippets,
    ));

    let estimated_tokens = estimate_context_tokens(
        &system_sections,
        history,
        user_text,
        &surfaced_skills,
        &memory_snippets,
    );
    let context_summary = AgentRuntimeContextSummary {
        included_tools: included_tool_schemas
            .iter()
            .map(|descriptor| descriptor.name.clone())
            .collect(),
        deferred_tools: deferred_tool_names.clone(),
        surfaced_skills: surfaced_skills.clone(),
        loaded_skills: Vec::new(),
        memory_snippets,
        message_count: history.len() + 1,
        estimated_tokens,
    };

    let mut messages = history.to_vec();
    messages.push(AgentRuntimeMessage::text(
        AgentRuntimeMessageRole::User,
        user_text,
    ));

    RuntimeModelContext {
        system_sections,
        messages,
        included_tool_schemas,
        deferred_tool_names,
        surfaced_skills,
        loaded_skill_contents: Vec::new(),
        context_summary,
    }
}

fn tool_descriptors_for_context(
    runtime_root: &Path,
    options: &AgentRuntimeSendOptions,
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
                .filter(|descriptor| allowlist.contains(descriptor.name.as_str()))
                .collect()
        }
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

fn selected_deferred_tools_from_history(history: &[AgentRuntimeMessage]) -> BTreeSet<String> {
    let mut selected = BTreeSet::new();
    for message in history {
        collect_selected_tool_names_from_text(&message.content, &mut selected);
        for block in &message.blocks {
            match block {
                AgentRuntimeMessageBlock::ToolResult { content, .. }
                | AgentRuntimeMessageBlock::Text { text: content } => {
                    collect_selected_tool_names_from_text(content, &mut selected)
                }
                AgentRuntimeMessageBlock::Meta { data }
                | AgentRuntimeMessageBlock::ToolUse { input: data, .. } => {
                    collect_selected_tool_names_from_value(data, &mut selected)
                }
                AgentRuntimeMessageBlock::Image { .. } => {}
            }
        }
    }
    selected
}

fn collect_selected_tool_names_from_text(text: &str, selected: &mut BTreeSet<String>) {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return;
    };
    collect_selected_tool_names_from_value(&value, selected);
}

fn collect_selected_tool_names_from_value(value: &Value, selected: &mut BTreeSet<String>) {
    match value {
        Value::Object(object) => {
            for key in ["activatedTools", "includedTools", "selectedTools"] {
                if let Some(values) = object.get(key).and_then(Value::as_array) {
                    for value in values {
                        if let Some(tool) = value
                            .as_str()
                            .map(str::trim)
                            .filter(|tool| !tool.is_empty())
                        {
                            selected.insert(tool.to_string());
                        }
                    }
                }
            }
            if let Some(matches) = object.get("matches").and_then(Value::as_array) {
                for value in matches {
                    if let Some(tool) = value
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|tool| !tool.is_empty())
                    {
                        selected.insert(tool.to_string());
                    }
                }
            }
            for value in object.values() {
                collect_selected_tool_names_from_value(value, selected);
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_selected_tool_names_from_value(value, selected);
            }
        }
        _ => {}
    }
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
    let terms = query_terms(user_text);
    if terms.is_empty() {
        return Vec::new();
    }
    let store = DesktopMemoryStore::new(runtime_root.to_path_buf());
    let Ok(items) = store.load_items() else {
        return Vec::new();
    };
    let mut scored = items
        .into_iter()
        .filter(|item| !item.archived)
        .map(|item| {
            let haystack = format!(
                "{} {} {} {} {}",
                item.title,
                item.summary,
                item.content,
                item.source,
                item.tags.join(" ")
            )
            .to_lowercase();
            let score = terms
                .iter()
                .filter(|term| haystack.contains(term.as_str()))
                .count();
            (score, item)
        })
        .filter(|(score, _)| *score > 0)
        .collect::<Vec<_>>();
    scored.sort_by(|(score_a, item_a), (score_b, item_b)| {
        score_b
            .cmp(score_a)
            .then_with(|| item_a.title.cmp(&item_b.title))
    });
    scored
        .into_iter()
        .take(MAX_MEMORY_SNIPPETS)
        .map(|(_, item)| {
            let text = if item.summary.trim().is_empty() {
                item.content
            } else {
                item.summary
            };
            format!(
                "{}: {}",
                item.title,
                text.chars()
                    .take(MAX_MEMORY_SNIPPET_CHARS)
                    .collect::<String>()
            )
        })
        .collect()
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
    history: &[AgentRuntimeMessage],
    user_text: &str,
    surfaced_skills: &[AgentRuntimeSkillSummary],
    memory_snippets: &[String],
) -> usize {
    let chars = system_sections.iter().map(String::len).sum::<usize>()
        + history
            .iter()
            .map(|message| message.content.len())
            .sum::<usize>()
        + user_text.len()
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
