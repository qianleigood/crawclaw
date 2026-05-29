use super::*;

#[derive(Clone)]
pub(super) struct TodoWriteTool {
    runtime_root: PathBuf,
}

#[derive(Clone, Copy)]
pub(super) enum RuntimeTaskToolKind {
    Create,
    Get,
    Update,
    List,
}

#[derive(Clone)]
pub(super) struct RuntimeTaskTool {
    runtime_root: PathBuf,
    kind: RuntimeTaskToolKind,
}

impl RuntimeTaskTool {
    pub(super) fn new(runtime_root: &Path, kind: RuntimeTaskToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

impl TodoWriteTool {
    pub(super) fn new(runtime_root: &Path) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoItem {
    content: String,
    status: String,
    active_form: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TodoWriteInput {
    todos: Vec<TodoItem>,
}

fn todo_state_key(runtime_root: &Path) -> PathBuf {
    runtime_root
        .canonicalize()
        .unwrap_or_else(|_| runtime_root.to_path_buf())
}

fn todo_states() -> &'static Mutex<HashMap<PathBuf, Vec<TodoItem>>> {
    static TODOS: OnceLock<Mutex<HashMap<PathBuf, Vec<TodoItem>>>> = OnceLock::new();
    TODOS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn todo_state_for_root(runtime_root: &Path) -> Vec<TodoItem> {
    todo_states()
        .lock()
        .expect("todo state map")
        .get(&todo_state_key(runtime_root))
        .cloned()
        .unwrap_or_default()
}

fn set_todo_state_for_root(runtime_root: &Path, todos: Vec<TodoItem>) {
    let key = todo_state_key(runtime_root);
    let mut state = todo_states().lock().expect("todo state map");
    if todos.is_empty() {
        state.remove(&key);
    } else {
        state.insert(key, todos);
    }
}

fn validate_todos(todos: &[TodoItem]) -> pi::sdk::Result<()> {
    for (index, todo) in todos.iter().enumerate() {
        if todo.content.is_empty() {
            return Err(pi::sdk::Error::validation(format!(
                "todos[{index}].content cannot be empty"
            )));
        }
        if todo.active_form.is_empty() {
            return Err(pi::sdk::Error::validation(format!(
                "todos[{index}].activeForm cannot be empty"
            )));
        }
        if !matches!(
            todo.status.as_str(),
            "pending" | "in_progress" | "completed"
        ) {
            return Err(pi::sdk::Error::validation(format!(
                "todos[{index}].status must be pending, in_progress, or completed"
            )));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTask {
    id: String,
    subject: String,
    description: String,
    status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_form: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
    #[serde(default)]
    blocks: Vec<String>,
    #[serde(default)]
    blocked_by: Vec<String>,
    #[serde(default)]
    metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTaskState {
    #[serde(default)]
    next_id: u64,
    #[serde(default)]
    tasks: Vec<RuntimeTask>,
}

fn task_state_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join("tasks").join("tasks.json")
}

fn load_task_state(runtime_root: &Path) -> Result<RuntimeTaskState, String> {
    let path = task_state_path(runtime_root);
    if !path.exists() {
        return Ok(RuntimeTaskState {
            next_id: 1,
            tasks: Vec::new(),
        });
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read task state {}: {error}", path.display()))?;
    let mut state = serde_json::from_str::<RuntimeTaskState>(&raw)
        .map_err(|error| format!("invalid task state {}: {error}", path.display()))?;
    if state.next_id == 0 {
        state.next_id = state
            .tasks
            .iter()
            .filter_map(|task| task.id.parse::<u64>().ok())
            .max()
            .unwrap_or(0)
            + 1;
    }
    Ok(state)
}

fn save_task_state(runtime_root: &Path, state: &RuntimeTaskState) -> Result<(), String> {
    let path = task_state_path(runtime_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        &path,
        serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("failed to write task state {}: {error}", path.display()))
}

fn runtime_task_projection(task: &RuntimeTask) -> Value {
    json!({
        "id": task.id,
        "subject": task.subject,
        "description": task.description,
        "status": task.status,
        "activeForm": task.active_form,
        "owner": task.owner,
        "blocks": task.blocks,
        "blockedBy": task.blocked_by,
        "metadata": task.metadata
    })
}

fn runtime_task_id_list(ids: &[String]) -> String {
    ids.iter()
        .map(|id| format!("#{id}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn runtime_task_get_result_text(task: &RuntimeTask) -> String {
    let mut lines = vec![
        format!("Task #{}: {}", task.id, task.subject),
        format!("Status: {}", task.status),
        format!("Description: {}", task.description),
    ];
    if !task.blocked_by.is_empty() {
        lines.push(format!(
            "Blocked by: {}",
            runtime_task_id_list(&task.blocked_by)
        ));
    }
    if !task.blocks.is_empty() {
        lines.push(format!("Blocks: {}", runtime_task_id_list(&task.blocks)));
    }
    lines.join("\n")
}

fn runtime_task_list_result_text(tasks: &[Value]) -> String {
    if tasks.is_empty() {
        return "No tasks found".to_string();
    }
    tasks
        .iter()
        .map(|task| {
            let id = task.get("id").and_then(Value::as_str).unwrap_or("");
            let status = task.get("status").and_then(Value::as_str).unwrap_or("");
            let subject = task.get("subject").and_then(Value::as_str).unwrap_or("");
            let owner = task
                .get("owner")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(|value| format!(" ({value})"))
                .unwrap_or_default();
            let blocked = task
                .get("blockedBy")
                .and_then(Value::as_array)
                .map(|blocked_by| {
                    blocked_by
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|id| format!("#{id}"))
                        .collect::<Vec<_>>()
                })
                .filter(|blocked_by| !blocked_by.is_empty())
                .map(|blocked_by| format!(" [blocked by {}]", blocked_by.join(", ")))
                .unwrap_or_default();
            format!("#{id} [{status}] {subject}{owner}{blocked}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn runtime_task_update_result_text(task_id: &str, updated_fields: &[String]) -> String {
    format!("Updated task #{task_id} {}", updated_fields.join(", "))
}

fn required_runtime_task_id(input: &Value) -> Result<String, String> {
    required_param_string("Task", input, &["taskId", "id"])
}

fn require_runtime_task_keys(
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

fn validate_task_status(status: &str, allow_deleted: bool) -> Result<(), String> {
    if matches!(status, "pending" | "in_progress" | "completed")
        || (allow_deleted && status == "deleted")
    {
        return Ok(());
    }
    Err(if allow_deleted {
        "status must be pending, in_progress, completed, or deleted".to_string()
    } else {
        "status must be pending, in_progress, or completed".to_string()
    })
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

fn ensure_task_block_relation(
    state: &mut RuntimeTaskState,
    from_task_id: &str,
    to_task_id: &str,
) -> (bool, bool) {
    let Some(from_position) = state.tasks.iter().position(|task| task.id == from_task_id) else {
        return (false, false);
    };
    let Some(to_position) = state.tasks.iter().position(|task| task.id == to_task_id) else {
        return (false, false);
    };

    let mut from_changed = false;
    if !state.tasks[from_position]
        .blocks
        .iter()
        .any(|id| id == to_task_id)
    {
        state.tasks[from_position]
            .blocks
            .push(to_task_id.to_string());
        from_changed = true;
    }

    let mut to_changed = false;
    if !state.tasks[to_position]
        .blocked_by
        .iter()
        .any(|id| id == from_task_id)
    {
        state.tasks[to_position]
            .blocked_by
            .push(from_task_id.to_string());
        to_changed = true;
    }

    (from_changed, to_changed)
}

fn metadata_from_input(input: &Value) -> BTreeMap<String, Value> {
    input
        .get("metadata")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default()
}

impl RuntimeTaskToolKind {
    fn name(self) -> &'static str {
        match self {
            Self::Create => "TaskCreate",
            Self::Get => "TaskGet",
            Self::Update => "TaskUpdate",
            Self::List => "TaskList",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Create => "Create a new task in the task list",
            Self::Get => "Get a task by ID from the task list",
            Self::Update => "Update a task in the task list",
            Self::List => "List all tasks in the task list",
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::Create => json!({
                "type": "object",
                "properties": {
                    "subject": {
                        "type": "string",
                        "description": "A brief title for the task"
                    },
                    "description": {
                        "type": "string",
                        "description": "What needs to be done"
                    },
                    "activeForm": {
                        "type": "string",
                        "description": "Present continuous form shown in spinner when in_progress (e.g., \"Running tests\")"
                    },
                    "metadata": {
                        "type": "object",
                        "description": "Arbitrary metadata to attach to the task"
                    }
                },
                "required": ["subject", "description"],
                "additionalProperties": false
            }),
            Self::Get => json!({
                "type": "object",
                "properties": {
                    "taskId": {
                        "type": "string",
                        "description": "The ID of the task to retrieve"
                    }
                },
                "required": ["taskId"],
                "additionalProperties": false
            }),
            Self::Update => json!({
                "type": "object",
                "properties": {
                    "taskId": {
                        "type": "string",
                        "description": "The ID of the task to update"
                    },
                    "subject": {
                        "type": "string",
                        "description": "New subject for the task"
                    },
                    "description": {
                        "type": "string",
                        "description": "New description for the task"
                    },
                    "activeForm": {
                        "type": "string",
                        "description": "Present continuous form shown in spinner when in_progress (e.g., \"Running tests\")"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "completed", "deleted"],
                        "description": "New status for the task"
                    },
                    "addBlocks": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Task IDs that this task blocks"
                    },
                    "addBlockedBy": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Task IDs that block this task"
                    },
                    "owner": {
                        "type": "string",
                        "description": "New owner for the task"
                    },
                    "metadata": {
                        "type": "object",
                        "description": "Metadata keys to merge into the task. Set a key to null to delete it."
                    }
                },
                "required": ["taskId"],
                "additionalProperties": false
            }),
            Self::List => json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        }
    }
}

#[async_trait]
impl pi::sdk::Tool for RuntimeTaskTool {
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
        let result = match self.kind {
            RuntimeTaskToolKind::Create => self.create_task(input),
            RuntimeTaskToolKind::Get => self.get_task(input),
            RuntimeTaskToolKind::Update => self.update_task(input),
            RuntimeTaskToolKind::List => self.list_tasks(input),
        }
        .map_err(|error| pi::sdk::Error::tool(self.kind.name(), error))?;
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        matches!(
            self.kind,
            RuntimeTaskToolKind::Get | RuntimeTaskToolKind::List
        )
    }
}

impl RuntimeTaskTool {
    fn create_task(&self, input: Value) -> Result<Value, String> {
        require_runtime_task_keys(
            &input,
            &["subject", "description", "activeForm", "metadata"],
            "TaskCreate",
        )?;
        let subject = required_param_string("TaskCreate", &input, &["subject"])?;
        let description = required_param_string("TaskCreate", &input, &["description"])?;
        let mut state = load_task_state(&self.runtime_root)?;
        let id = state.next_id.max(1).to_string();
        state.next_id = state.next_id.max(1) + 1;
        let task = RuntimeTask {
            id: id.clone(),
            subject: subject.clone(),
            description,
            status: "pending".to_string(),
            active_form: string_param(&input, &["activeForm"]),
            owner: None,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: metadata_from_input(&input),
        };
        state.tasks.push(task);
        save_task_state(&self.runtime_root, &state)?;
        Ok(tool_envelope(
            format!("Task #{id} created successfully: {subject}"),
            json!({
                "task": {
                    "id": id,
                    "subject": subject
                },
                "source": "rust-native"
            }),
            false,
        ))
    }

    fn get_task(&self, input: Value) -> Result<Value, String> {
        require_runtime_task_keys(&input, &["taskId"], "TaskGet")?;
        let task_id = required_runtime_task_id(&input)?;
        let state = load_task_state(&self.runtime_root)?;
        let task = state.tasks.iter().find(|task| task.id == task_id);
        let text = task.map_or_else(
            || "Task not found".to_string(),
            runtime_task_get_result_text,
        );
        let task = task.map(runtime_task_projection).unwrap_or(Value::Null);
        Ok(tool_envelope(
            text,
            json!({
                "task": task,
                "source": "rust-native"
            }),
            false,
        ))
    }

    fn update_task(&self, input: Value) -> Result<Value, String> {
        require_runtime_task_keys(
            &input,
            &[
                "taskId",
                "subject",
                "description",
                "activeForm",
                "status",
                "addBlocks",
                "addBlockedBy",
                "owner",
                "metadata",
            ],
            "TaskUpdate",
        )?;
        let task_id = required_runtime_task_id(&input)?;
        let mut state = load_task_state(&self.runtime_root)?;
        let Some(position) = state.tasks.iter().position(|task| task.id == task_id) else {
            return Ok(tool_envelope(
                "Task not found",
                json!({
                    "success": false,
                    "taskId": task_id,
                    "updatedFields": [],
                    "error": "Task not found",
                    "source": "rust-native"
                }),
                false,
            ));
        };

        if input
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| status == "deleted")
        {
            let old_status = state.tasks[position].status.clone();
            state.tasks.remove(position);
            save_task_state(&self.runtime_root, &state)?;
            let updated_fields = vec!["deleted".to_string()];
            return Ok(tool_envelope(
                runtime_task_update_result_text(&task_id, &updated_fields),
                json!({
                    "success": true,
                    "taskId": task_id,
                    "updatedFields": updated_fields,
                    "statusChange": {
                        "from": old_status,
                        "to": "deleted"
                    },
                    "source": "rust-native"
                }),
                false,
            ));
        }

        let mut updated_fields = Vec::<String>::new();
        let old_status = state.tasks[position].status.clone();
        {
            let task = &mut state.tasks[position];
            if let Some(value) = string_param(&input, &["subject"]) {
                if value != task.subject {
                    task.subject = value;
                    updated_fields.push("subject".to_string());
                }
            }
            if let Some(value) = string_param(&input, &["description"]) {
                if value != task.description {
                    task.description = value;
                    updated_fields.push("description".to_string());
                }
            }
            if let Some(value) = string_param(&input, &["activeForm"]) {
                if task.active_form.as_deref() != Some(value.as_str()) {
                    task.active_form = Some(value);
                    updated_fields.push("activeForm".to_string());
                }
            }
            if let Some(value) = string_param(&input, &["owner"]) {
                if task.owner.as_deref() != Some(value.as_str()) {
                    task.owner = Some(value);
                    updated_fields.push("owner".to_string());
                }
            }
            if let Some(status) = string_param(&input, &["status"]) {
                validate_task_status(&status, true)?;
                if status != task.status {
                    task.status = status;
                    updated_fields.push("status".to_string());
                }
            }
            if let Some(metadata) = input.get("metadata").and_then(Value::as_object) {
                for (key, value) in metadata {
                    if value.is_null() {
                        task.metadata.remove(key);
                    } else {
                        task.metadata.insert(key.clone(), value.clone());
                    }
                }
                updated_fields.push("metadata".to_string());
            }
        }
        let blocks = string_array_param(&input, "addBlocks");
        let mut blocks_changed = false;
        for block_id in blocks {
            let (from_changed, _) = ensure_task_block_relation(&mut state, &task_id, &block_id);
            blocks_changed |= from_changed;
        }
        if blocks_changed {
            if !updated_fields.iter().any(|field| field == "blocks") {
                updated_fields.push("blocks".to_string());
            }
        }
        let blocked_by = string_array_param(&input, "addBlockedBy");
        let mut blocked_by_changed = false;
        for blocker_id in blocked_by {
            let (_, to_changed) = ensure_task_block_relation(&mut state, &blocker_id, &task_id);
            blocked_by_changed |= to_changed;
        }
        if blocked_by_changed {
            if !updated_fields.iter().any(|field| field == "blockedBy") {
                updated_fields.push("blockedBy".to_string());
            }
        }
        let task = &state.tasks[position];
        let status_change = (old_status != task.status).then(|| {
            json!({
                "from": old_status,
                "to": task.status
            })
        });
        let task_projection = runtime_task_projection(task);
        save_task_state(&self.runtime_root, &state)?;
        Ok(tool_envelope(
            runtime_task_update_result_text(&task_id, &updated_fields),
            json!({
                "success": true,
                "taskId": task_id,
                "updatedFields": updated_fields,
                "statusChange": status_change,
                "task": task_projection,
                "source": "rust-native"
            }),
            false,
        ))
    }

    fn list_tasks(&self, input: Value) -> Result<Value, String> {
        let Some(input) = input.as_object() else {
            return Err("TaskList input must be an object".to_string());
        };
        if !input.is_empty() {
            return Err("TaskList does not accept parameters".to_string());
        }
        let state = load_task_state(&self.runtime_root)?;
        let resolved = state
            .tasks
            .iter()
            .filter(|task| task.status == "completed")
            .map(|task| task.id.as_str())
            .collect::<BTreeSet<_>>();
        let tasks = state
            .tasks
            .iter()
            .filter(|task| {
                !task
                    .metadata
                    .get("_internal")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .map(|task| {
                json!({
                    "id": task.id,
                    "subject": task.subject,
                    "status": task.status,
                    "owner": task.owner,
                    "blockedBy": task.blocked_by
                        .iter()
                        .filter(|id| !resolved.contains(id.as_str()))
                        .cloned()
                        .collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>();
        Ok(tool_envelope(
            runtime_task_list_result_text(&tasks),
            json!({
                "tasks": tasks,
                "source": "rust-native"
            }),
            false,
        ))
    }
}

#[async_trait]
impl pi::sdk::Tool for TodoWriteTool {
    fn name(&self) -> &str {
        "TodoWrite"
    }

    fn label(&self) -> &str {
        "TodoWrite"
    }

    fn description(&self) -> &str {
        "Update the todo list for the current session. To be used proactively and often to track progress and pending tasks. Make sure that at least one task is in_progress at all times. Always provide both content (imperative) and activeForm (present continuous) for each task."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "description": "The updated todo list",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "Imperative task text, for example \"Fix authentication bug\"."
                            },
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed"]
                            },
                            "activeForm": {
                                "type": "string",
                                "description": "Present continuous form shown while the task is active, for example \"Fixing authentication bug\"."
                            }
                        },
                        "required": ["content", "status", "activeForm"]
                    }
                }
            },
            "required": ["todos"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let input: TodoWriteInput = serde_json::from_value(input)
            .map_err(|error| pi::sdk::Error::validation(error.to_string()))?;
        validate_todos(&input.todos)?;
        let old_todos = todo_state_for_root(&self.runtime_root);
        let all_done = input.todos.iter().all(|todo| todo.status == "completed");
        let stored_todos = if all_done {
            Vec::new()
        } else {
            input.todos.clone()
        };
        set_todo_state_for_root(&self.runtime_root, stored_todos);
        Ok(native_tool_output(tool_envelope(
            "Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable",
            json!({
                "oldTodos": old_todos,
                "newTodos": input.todos
            }),
            false,
        )))
    }

    fn is_read_only(&self) -> bool {
        false
    }
}
