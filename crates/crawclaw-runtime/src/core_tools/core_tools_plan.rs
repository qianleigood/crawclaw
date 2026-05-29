use super::*;

#[derive(Clone, Copy)]
pub(super) enum PlanToolKind {
    AskUserQuestion,
    EnterPlanMode,
    ExitPlanMode,
}

pub(super) struct PlanTool {
    runtime_root: PathBuf,
    kind: PlanToolKind,
}

impl PlanTool {
    pub(super) fn new(runtime_root: &Path, kind: PlanToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuestionOption {
    label: String,
    description: String,
    preview: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UserQuestion {
    question: String,
    header: String,
    options: Vec<QuestionOption>,
    multi_select: Option<bool>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuestionAnnotation {
    preview: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AskUserQuestionInput {
    questions: Vec<UserQuestion>,
    answers: Option<BTreeMap<String, String>>,
    annotations: Option<BTreeMap<String, QuestionAnnotation>>,
    metadata: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnterPlanModeInput {}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AllowedPrompt {
    tool: String,
    prompt: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExitPlanModeInput {
    allowed_prompts: Option<Vec<AllowedPrompt>>,
    plan: Option<String>,
    plan_file_path: Option<String>,
}

#[async_trait]
impl pi::sdk::Tool for PlanTool {
    fn name(&self) -> &str {
        match self.kind {
            PlanToolKind::AskUserQuestion => "AskUserQuestion",
            PlanToolKind::EnterPlanMode => "EnterPlanMode",
            PlanToolKind::ExitPlanMode => "ExitPlanMode",
        }
    }

    fn label(&self) -> &str {
        self.name()
    }

    fn description(&self) -> &str {
        match self.kind {
            PlanToolKind::AskUserQuestion => {
                "Asks the user multiple choice questions to gather information, clarify ambiguity, understand preferences, make decisions or offer them choices."
            }
            PlanToolKind::EnterPlanMode => {
                "Requests permission to enter plan mode for complex tasks requiring exploration and design"
            }
            PlanToolKind::ExitPlanMode => "Prompts the user to exit plan mode and start coding",
        }
    }

    fn parameters(&self) -> Value {
        match self.kind {
            PlanToolKind::AskUserQuestion => ask_user_question_parameters(),
            PlanToolKind::EnterPlanMode => json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            PlanToolKind::ExitPlanMode => exit_plan_mode_parameters(),
        }
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let result = match self.kind {
            PlanToolKind::AskUserQuestion => ask_user_question(input)?,
            PlanToolKind::EnterPlanMode => enter_plan_mode(input)?,
            PlanToolKind::ExitPlanMode => exit_plan_mode(&self.runtime_root, input)?,
        };
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        !matches!(self.kind, PlanToolKind::ExitPlanMode)
    }
}

fn ask_user_question_parameters() -> Value {
    json!({
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "description": "Questions to ask the user (1-4 questions)",
                "items": {
                    "type": "object",
                    "properties": {
                        "question": {
                            "type": "string",
                            "description": "The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: \"Which library should we use for date formatting?\" If multiSelect is true, phrase it accordingly, e.g. \"Which features do you want to enable?\""
                        },
                        "header": {
                            "type": "string",
                            "description": "Very short label displayed as a chip/tag (max 12 chars). Examples: \"Auth method\", \"Library\", \"Approach\"."
                        },
                        "options": {
                            "type": "array",
                            "minItems": 2,
                            "maxItems": 4,
                            "description": "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": {
                                        "type": "string",
                                        "description": "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice."
                                    },
                                    "description": {
                                        "type": "string",
                                        "description": "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications."
                                    },
                                    "preview": {
                                        "type": "string",
                                        "description": "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format."
                                    }
                                },
                                "required": ["label", "description"]
                            }
                        },
                        "multiSelect": {
                            "type": "boolean",
                            "description": "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive."
                        }
                    },
                    "required": ["question", "header", "options"]
                }
            },
            "answers": {
                "type": "object",
                "description": "User answers collected by the permission component"
            },
            "annotations": {
                "type": "object",
                "description": "Optional per-question annotations from the user (e.g., notes on preview selections). Keyed by question text."
            },
            "metadata": {
                "type": "object",
                "description": "Optional metadata for tracking and analytics purposes. Not displayed to user."
            }
        },
        "required": ["questions"],
        "additionalProperties": false
    })
}

fn exit_plan_mode_parameters() -> Value {
    json!({
        "type": "object",
        "properties": {
            "allowedPrompts": {
                "type": "array",
                "description": "Prompt-based permissions needed to implement the plan. These describe categories of actions rather than specific commands.",
                "items": {
                    "type": "object",
                    "properties": {
                        "tool": {
                            "type": "string",
                            "enum": ["Bash"],
                            "description": "The tool this prompt applies to"
                        },
                        "prompt": {
                            "type": "string",
                            "description": "Semantic description of the action, e.g. \"run tests\", \"install dependencies\""
                        }
                    },
                    "required": ["tool", "prompt"]
                }
            },
            "plan": {
                "type": "string",
                "description": "The plan content (injected by normalizeToolInput from disk)"
            },
            "planFilePath": {
                "type": "string",
                "description": "The plan file path (injected by normalizeToolInput)"
            }
        }
    })
}

fn ask_user_question(input: Value) -> pi::sdk::Result<Value> {
    let input: AskUserQuestionInput = serde_json::from_value(input)
        .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
    validate_questions(&input.questions, ask_user_question_preview_format(&input))?;
    let answers = input.answers.unwrap_or_default();
    if answers.is_empty() {
        return Ok(tool_envelope(
            "AskUserQuestion requires user answers before execution can continue.",
            json!({
                "questions": input.questions,
                "requiresUserInteraction": true,
                "metadata": input.metadata,
                "source": "rust-native"
            }),
            true,
        ));
    }
    let answer_text = answers
        .iter()
        .map(|(question, answer)| {
            let mut parts = vec![format!("\"{question}\"=\"{answer}\"")];
            if let Some(annotation) = input
                .annotations
                .as_ref()
                .and_then(|annotations| annotations.get(question))
            {
                if let Some(preview) = annotation.preview.as_deref() {
                    parts.push(format!("selected preview:\n{preview}"));
                }
                if let Some(notes) = annotation.notes.as_deref() {
                    parts.push(format!("user notes: {notes}"));
                }
            }
            parts.join(" ")
        })
        .collect::<Vec<_>>()
        .join(", ");
    Ok(tool_envelope(
        format!(
            "User has answered your questions: {answer_text}. You can now continue with the user's answers in mind."
        ),
        json!({
            "questions": input.questions,
            "answers": answers,
            "annotations": input.annotations,
            "metadata": input.metadata,
            "source": "rust-native"
        }),
        false,
    ))
}

fn validate_questions(
    questions: &[UserQuestion],
    preview_format: Option<&str>,
) -> pi::sdk::Result<()> {
    if questions.is_empty() || questions.len() > 4 {
        return Err(pi::sdk::Error::validation(
            "questions must contain 1 to 4 items",
        ));
    }
    let mut question_texts = BTreeSet::new();
    for (index, question) in questions.iter().enumerate() {
        if question.question.trim().is_empty() {
            return Err(pi::sdk::Error::validation(format!(
                "questions[{index}].question cannot be empty"
            )));
        }
        if question.header.trim().is_empty() {
            return Err(pi::sdk::Error::validation(format!(
                "questions[{index}].header cannot be empty"
            )));
        }
        if !question_texts.insert(question.question.clone()) {
            return Err(pi::sdk::Error::validation("Question texts must be unique"));
        }
        if question.options.len() < 2 || question.options.len() > 4 {
            return Err(pi::sdk::Error::validation(format!(
                "questions[{index}].options must contain 2 to 4 items"
            )));
        }
        let mut option_labels = BTreeSet::new();
        for option in &question.options {
            if option.label.trim().is_empty() {
                return Err(pi::sdk::Error::validation(format!(
                    "questions[{index}].options label cannot be empty"
                )));
            }
            if option.description.trim().is_empty() {
                return Err(pi::sdk::Error::validation(format!(
                    "questions[{index}].options description cannot be empty"
                )));
            }
            if !option_labels.insert(option.label.clone()) {
                return Err(pi::sdk::Error::validation(format!(
                    "questions[{index}].options labels must be unique"
                )));
            }
            if preview_format == Some("html") {
                if let Some(error) = validate_html_preview(option.preview.as_deref()) {
                    return Err(pi::sdk::Error::validation(format!(
                        "Option \"{}\" in question \"{}\": {error}",
                        option.label, question.question
                    )));
                }
            }
        }
    }
    Ok(())
}

fn ask_user_question_preview_format(input: &AskUserQuestionInput) -> Option<&str> {
    if input.metadata.as_ref().is_some_and(|metadata| {
        metadata
            .get("previewFormat")
            .or_else(|| metadata.get("preview_format"))
            .and_then(Value::as_str)
            == Some("html")
    }) {
        return Some("html");
    }
    std::env::var("CLAUDE_CODE_QUESTION_PREVIEW_FORMAT")
        .ok()
        .filter(|format| format == "html")
        .map(|_| "html")
}

fn validate_html_preview(preview: Option<&str>) -> Option<&'static str> {
    let preview = preview?;
    if html_has_forbidden_tag(preview, &["html", "body", "!doctype"]) {
        return Some(
            "preview must be an HTML fragment, not a full document (no <html>, <body>, or <!DOCTYPE>)",
        );
    }
    if html_has_forbidden_tag(preview, &["script", "style"]) {
        return Some(
            "preview must not contain <script> or <style> tags. Use inline styles via the style attribute if needed.",
        );
    }
    if !html_has_element_tag(preview) {
        return Some(
            "preview must contain HTML (previewFormat is set to \"html\"). Wrap content in a tag like <div> or <pre>.",
        );
    }
    None
}

fn html_has_forbidden_tag(preview: &str, tags: &[&str]) -> bool {
    let lower = preview.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(offset) = lower[cursor..].find('<') {
        let start = cursor + offset + 1;
        let rest = lower[start..].trim_start();
        if tags.iter().any(|tag| html_rest_starts_with_tag(rest, tag)) {
            return true;
        }
        cursor = start;
    }
    false
}

fn html_rest_starts_with_tag(rest: &str, tag: &str) -> bool {
    let Some(after) = rest.strip_prefix(tag) else {
        return false;
    };
    after
        .chars()
        .next()
        .is_none_or(|ch| ch.is_ascii_whitespace() || matches!(ch, '>' | '/' | '!'))
}

fn html_has_element_tag(preview: &str) -> bool {
    let bytes = preview.as_bytes();
    bytes
        .windows(2)
        .any(|window| window[0] == b'<' && window[1].is_ascii_alphabetic())
}

fn enter_plan_mode(input: Value) -> pi::sdk::Result<Value> {
    let _: EnterPlanModeInput = serde_json::from_value(input)
        .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
    let message =
        "Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.";
    let instructions = format!(
        "{message}\n\nIn plan mode, you should:\n1. Thoroughly explore the codebase to understand existing patterns\n2. Identify similar features and architectural approaches\n3. Consider multiple approaches and their trade-offs\n4. Use AskUserQuestion if you need to clarify the approach\n5. Design a concrete implementation strategy\n6. When ready, use ExitPlanMode to present your plan for approval\n\nRemember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase."
    );
    Ok(tool_envelope(
        instructions,
        json!({
            "message": message,
            "mode": "plan",
            "source": "rust-native"
        }),
        false,
    ))
}

fn exit_plan_mode(runtime_root: &Path, input: Value) -> pi::sdk::Result<Value> {
    let input: ExitPlanModeInput = serde_json::from_value(input)
        .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
    validate_allowed_prompts(input.allowed_prompts.as_deref())?;
    let file_path = input.plan_file_path;
    let plan_was_edited = input.plan.is_some();
    let plan = input
        .plan
        .or_else(|| {
            file_path
                .as_deref()
                .and_then(|path| read_plan_file(runtime_root, path).ok())
        })
        .unwrap_or_default();
    let content = if plan.trim().is_empty() {
        "User has approved exiting plan mode. You can now proceed.".to_string()
    } else {
        let saved = file_path
            .as_deref()
            .map(|path| {
                format!(
                    "\n\nYour plan has been saved to: {path}\nYou can refer back to it if needed during implementation."
                )
            })
            .unwrap_or_default();
        let plan_label = if plan_was_edited {
            "Approved Plan (edited by user)"
        } else {
            "Approved Plan"
        };
        format!(
            "User has approved your plan. You can now start coding. Start with updating your todo list if applicable{saved}\n\n## {plan_label}:\n{plan}"
        )
    };
    Ok(tool_envelope(
        content,
        json!({
            "plan": plan,
            "filePath": file_path,
            "allowedPrompts": input.allowed_prompts,
            "isAgent": false,
            "planWasEdited": plan_was_edited.then_some(true),
            "source": "rust-native"
        }),
        false,
    ))
}

fn validate_allowed_prompts(prompts: Option<&[AllowedPrompt]>) -> pi::sdk::Result<()> {
    for (index, prompt) in prompts.unwrap_or(&[]).iter().enumerate() {
        if prompt.tool != "Bash" {
            return Err(pi::sdk::Error::validation(format!(
                "allowedPrompts[{index}].tool must be Bash"
            )));
        }
        if prompt.prompt.trim().is_empty() {
            return Err(pi::sdk::Error::validation(format!(
                "allowedPrompts[{index}].prompt cannot be empty"
            )));
        }
    }
    Ok(())
}

fn read_plan_file(runtime_root: &Path, raw_path: &str) -> Result<String, String> {
    let root = runtime_root
        .canonicalize()
        .unwrap_or_else(|_| runtime_root.to_path_buf());
    let candidate = Path::new(raw_path);
    let path = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    if !path.starts_with(&root) {
        return Err("plan file path escapes the runtime root".to_string());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}
