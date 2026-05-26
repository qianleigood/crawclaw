use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use crawclaw_native_plugins::llm_task::{complete_llm_task, prepare_llm_task, LlmTaskPrepareInput};
use crawclaw_native_plugins::web::{run_searxng_search, run_spider_fetch};
use crawclaw_plugin_sdk::{
    NativeInvocationTarget, NativeToolContentBlock, NativeToolDescriptor, NativeToolResultEnvelope,
};
use crawclaw_providers::{
    send_native_provider_conversation, NativeProviderConfig, NativeProviderMessage,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::cron::CronTool;
use crate::special_agents::{
    find_special_agent, ExperienceStore, SessionSummaryStore, SpecialAgentMemoryTools,
    SpecialAgentToolGuard,
};
use crate::DesktopSessionStore;
use crate::{
    dispatch_native_channel_outbound, invoke_native_plugin_operation, is_special_agent_only_tool,
    load_skill_candidates, pi_agent_rust_tool_descriptors_for_runtime_root,
    record_loaded_skill_state, record_tool_activation_state, with_native_runtime_context,
    AgentModelSelection, AgentRunProfileKind, AgentRunProfileRequest, AgentRunRequest,
    AgentRuntime, ChannelChatType,
    ChannelInboundEnvelope, ChannelOutboundAction, ChannelOutboundRequest,
    NativeChannelDispatchContext, NativePluginRuntime, NativeToolRegistration,
};

mod core_tools_media;
mod core_tools_native_plugins;
mod core_tools_patch;
mod core_tools_process;
mod core_tools_process_control;
mod core_tools_runtime_dispatch;
mod core_tools_sessions;
mod core_tools_special_agents;
mod core_tools_web;
mod core_tools_workflow;
use self::core_tools_media::*;
use self::core_tools_native_plugins::*;
use self::core_tools_patch::*;
use self::core_tools_process::*;
use self::core_tools_process_control::*;
use self::core_tools_runtime_dispatch::*;
use self::core_tools_sessions::*;
use self::core_tools_special_agents::*;
use self::core_tools_web::*;
use self::core_tools_workflow::*;

pub(crate) fn build_pi_agent_rust_tool_registry(runtime_root: &Path) -> pi::sdk::ToolRegistry {
    let process_registry = process_registry_for_root(runtime_root);
    let mut tools: Vec<Box<dyn pi::sdk::Tool>> = vec![
        pi::sdk::create_read_tool(runtime_root),
        pi::sdk::create_write_tool(runtime_root),
        pi::sdk::create_edit_tool(runtime_root),
        Box::new(ApplyPatchTool::new(runtime_root)),
        Box::new(BashTool::new(runtime_root, Arc::clone(&process_registry))),
        Box::new(ProcessTool::new(process_registry)),
    ];
    tools.extend(
        crate::native_plugin_registry(runtime_root)
            .tool_registrations()
            .into_iter()
            .map(|registration| {
                Box::new(NativePluginTool::new(runtime_root, registration))
                    as Box<dyn pi::sdk::Tool>
            }),
    );
    tools.extend([
        pi::sdk::create_grep_tool(runtime_root),
        pi::sdk::create_find_tool(runtime_root),
        pi::sdk::create_ls_tool(runtime_root),
        Box::new(WebTool::new(WebToolKind::Search)) as Box<dyn pi::sdk::Tool>,
        Box::new(WebTool::new(WebToolKind::Fetch)) as Box<dyn pi::sdk::Tool>,
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Status)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::List)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::History)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Send)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Spawn)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Yield)),
        Box::new(SessionTool::new(runtime_root, SessionToolKind::Subagents)),
        Box::new(CoreRuntimeTool::new(
            runtime_root,
            CoreRuntimeToolKind::Canvas,
        )),
        Box::new(CoreRuntimeTool::new(
            runtime_root,
            CoreRuntimeToolKind::Message,
        )),
        Box::new(CronTool::new(runtime_root)),
        Box::new(CoreRuntimeTool::new(
            runtime_root,
            CoreRuntimeToolKind::Image,
        )),
        Box::new(CoreRuntimeTool::new(runtime_root, CoreRuntimeToolKind::Pdf)),
        Box::new(CoreRuntimeTool::new(runtime_root, CoreRuntimeToolKind::Tts)),
        Box::new(CoreRuntimeTool::new(
            runtime_root,
            CoreRuntimeToolKind::ToolSearch,
        )),
        Box::new(CoreRuntimeTool::new(
            runtime_root,
            CoreRuntimeToolKind::DiscoverSkills,
        )),
        Box::new(CoreRuntimeTool::new(
            runtime_root,
            CoreRuntimeToolKind::LoadSkill,
        )),
        Box::new(CoreRuntimeTool::new(
            runtime_root,
            CoreRuntimeToolKind::Workflow,
        )),
        Box::new(CoreRuntimeTool::new(
            runtime_root,
            CoreRuntimeToolKind::Workflowize,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::ReviewTask,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::WriteExperienceNote,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryManifestRead,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryNoteRead,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryNoteWrite,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryNoteEdit,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::MemoryNoteDelete,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::SessionSummaryFileRead,
        )),
        Box::new(SpecialAgentTool::new(
            runtime_root,
            SpecialAgentToolKind::SessionSummaryFileEdit,
        )),
    ]);
    pi::sdk::ToolRegistry::from_tools(tools)
}

fn process_registry_for_root(runtime_root: &Path) -> Arc<ProcessRegistry> {
    static REGISTRIES: OnceLock<Mutex<HashMap<PathBuf, Arc<ProcessRegistry>>>> = OnceLock::new();
    let key = runtime_root
        .canonicalize()
        .unwrap_or_else(|_| runtime_root.to_path_buf());
    let registries = REGISTRIES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut registries = registries.lock().expect("process registry map");
    Arc::clone(
        registries
            .entry(key)
            .or_insert_with(|| Arc::new(ProcessRegistry::default())),
    )
}

fn text_output(
    text: impl Into<String>,
    details: Option<Value>,
    is_error: bool,
) -> pi::sdk::ToolOutput {
    pi::sdk::ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            text.into(),
        ))],
        details,
        is_error,
    }
}

fn native_tool_output(result: Value) -> pi::sdk::ToolOutput {
    let envelope = result
        .as_object()
        .and_then(|object| object.get("content"))
        .and_then(Value::as_array)
        .and_then(|content| {
            if content.iter().all(|entry| {
                matches!(
                    entry.get("type").and_then(Value::as_str),
                    Some("text" | "image")
                )
            }) {
                serde_json::from_value::<NativeToolResultEnvelope>(result.clone()).ok()
            } else {
                None
            }
        });
    let Some(envelope) = envelope else {
        return text_output(
            serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string()),
            Some(result),
            false,
        );
    };

    let content = envelope
        .content
        .into_iter()
        .map(|block| match block {
            NativeToolContentBlock::Text { text } => {
                pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(text))
            }
            NativeToolContentBlock::Image { data, mime_type } => {
                pi::sdk::ContentBlock::Image(pi::sdk::ImageContent { data, mime_type })
            }
        })
        .collect::<Vec<_>>();

    pi::sdk::ToolOutput {
        content,
        details: envelope.details,
        is_error: envelope.is_error,
    }
}

fn tool_error(tool: &str, message: impl Into<String>) -> pi::sdk::Error {
    pi::sdk::Error::tool(tool, message.into())
}

fn session_tool_error(kind: SessionToolKind, error: impl std::fmt::Display) -> pi::sdk::Error {
    tool_error(kind.name(), error.to_string())
}

fn session_key_param(input: &Value) -> Option<String> {
    string_param(input, &["sessionKey", "key", "threadId"])
}

fn required_param(kind: SessionToolKind, input: &Value, keys: &[&str]) -> pi::sdk::Result<String> {
    string_param(input, keys)
        .ok_or_else(|| pi::sdk::Error::validation(format!("{} requires {}", kind.name(), keys[0])))
}

fn required_tool_param(tool: &str, input: &Value, keys: &[&str]) -> pi::sdk::Result<String> {
    string_param(input, keys)
        .ok_or_else(|| pi::sdk::Error::validation(format!("{tool} requires {}", keys[0])))
}

fn scope_param(input: &Value) -> String {
    string_param(input, &["scope", "agentId", "sessionKey"]).unwrap_or_else(|| "main".to_string())
}

fn string_param(input: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| input.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_tool_output_maps_text_and_image_blocks() {
        let output = native_tool_output(json!({
            "content": [
                { "type": "text", "text": "snapshot" },
                { "type": "image", "data": "aW1n", "mimeType": "image/png" }
            ],
            "details": { "ok": true }
        }));

        assert!(!output.is_error);
        assert_eq!(output.details, Some(json!({ "ok": true })));
        assert_eq!(output.content.len(), 2);
        match &output.content[0] {
            pi::sdk::ContentBlock::Text(text) => assert_eq!(text.text, "snapshot"),
            other => panic!("expected text block, got {other:?}"),
        }
        match &output.content[1] {
            pi::sdk::ContentBlock::Image(image) => {
                assert_eq!(image.data, "aW1n");
                assert_eq!(image.mime_type, "image/png");
            }
            other => panic!("expected image block, got {other:?}"),
        }
    }

    #[test]
    fn pdf_page_filter_parses_pages_and_ranges() {
        assert_eq!(
            parse_pdf_page_filter(Some("1, 3-5, 5")).expect("page filter"),
            Some(vec![1, 3, 4, 5])
        );
        assert!(parse_pdf_page_filter(Some("0")).is_err());
        assert!(parse_pdf_page_filter(Some("4-2")).is_err());
    }
}
