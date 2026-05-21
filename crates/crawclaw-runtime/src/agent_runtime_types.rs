use super::*;

#[derive(Clone)]
pub struct AgentRuntime {
    pub(super) runtime_root: PathBuf,
    pub(super) pi_agent_backend: Arc<dyn AgentRuntimeBackend>,
    pub(super) native_provider_backend: Arc<dyn AgentRuntimeBackend>,
}

pub struct AgentRuntimeRequest<'a> {
    pub runtime_root: &'a Path,
    pub thread_id: &'a str,
    pub user_text: &'a str,
    pub history: Vec<AgentRuntimeMessage>,
    pub provider_config: NativeProviderConfig,
    pub reasoning_level: Option<String>,
    pub enabled_tools: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRuntimeMessage {
    pub role: AgentRuntimeMessageRole,
    pub content: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentRuntimeMessageRole {
    User,
    Assistant,
}
