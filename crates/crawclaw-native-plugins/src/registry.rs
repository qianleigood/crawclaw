use crawclaw_plugin_sdk::{
    NativeApprovalCondition, NativeApprovalPolicy, NativeApprovalSeverity,
    NativeApprovalTimeoutBehavior, NativeGatewayMethodDescriptor, NativeGatewayMethodScope,
    NativeHostCallback, NativeInvocationTarget, NativeMediaUnderstandingProviderDescriptor,
    NativeModelProviderDescriptor, NativePluginDescriptor, NativeServiceDescriptor,
    NativeSpeechProviderDescriptor, NativeToolDescriptor, NativeWebFetchProviderDescriptor,
    NativeWebSearchProviderDescriptor,
};
use serde_json::{json, Value};

use crate::browser::{execute_browser_tool, start_browser_service, stop_browser_service};
use crate::comfyui::handle_comfyui;
use crate::envelope::to_value;
use crate::error::invalid_input;
use crate::llm_task::{complete_llm_task, prepare_llm_task, LlmTaskPrepareInput};
use crate::lobster::execute_lobster;
use crate::media_understanding::describe_openai_media;
use crate::minimax_mcp::handle_minimax_mcp;
use crate::open_prose::describe_open_prose;
use crate::openshell::handle_openshell;
use crate::qwen3_tts::{
    build_synthesis_payload, start_qwen3_tts_service, stop_qwen3_tts_service, synthesize_qwen3_tts,
};
use crate::web::{
    run_searxng_search, run_spider_fetch, start_searxng_service, stop_searxng_service,
};
use crate::NativeResult;

fn target(plugin_id: &str, operation: &str) -> NativeInvocationTarget {
    NativeInvocationTarget::new(plugin_id, operation)
}

fn tool_params(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required
    })
}

fn descriptor(plugin_id: &str, name: &str, description: &str) -> NativePluginDescriptor {
    NativePluginDescriptor::new(plugin_id)
        .name(name)
        .description(description)
}

fn lobster_descriptor() -> NativePluginDescriptor {
    let mut entry = descriptor(
        "lobster",
        "Lobster",
        "Typed workflow tool with resumable approvals.",
    );
    entry.tools.push(NativeToolDescriptor {
        name: "lobster".to_string(),
        label: "Lobster Workflow".to_string(),
        description:
            "Run Lobster pipelines as a local-first workflow runtime (typed JSON envelope + resumable approvals)."
                .to_string(),
        parameters: tool_params(
            json!({
                "action": { "type": "string", "enum": ["run", "resume"] },
                "pipeline": { "type": "string" },
                "argsJson": { "type": "string" },
                "token": { "type": "string" },
                "approve": { "type": "boolean" },
                "cwd": { "type": "string" },
                "timeoutMs": { "type": "number" },
                "maxStdoutBytes": { "type": "number" }
            }),
            &["action"],
        ),
        invocation: target("lobster", "execute"),
        read_only: false,
        default_enabled: false,
        default_profiles: vec!["coding".to_string(), "full".to_string()],
        approval: None,
    });
    entry
}

fn comfyui_descriptor() -> NativePluginDescriptor {
    let mut entry = descriptor(
        "comfyui",
        "ComfyUI",
        "Build, validate, run, and download local ComfyUI workflows.",
    );
    entry.tools.push(NativeToolDescriptor {
        name: "comfyui_workflow".to_string(),
        label: "ComfyUI Workflow".to_string(),
        description:
            "Inspect local ComfyUI nodes, create validated image/video workflow IR, run approved prompts, and download outputs."
                .to_string(),
        parameters: tool_params(
            json!({
                "action": { "type": "string" },
                "refresh": { "type": "boolean" },
                "query": { "type": "string" },
                "mediaKind": { "type": "string" },
                "intent": { "type": "string" },
                "limit": { "type": "number" },
                "goal": { "type": "string" },
                "candidateIr": {},
                "inputs": { "type": "object" },
                "save": { "type": "boolean" },
                "workflowId": { "type": "string" },
                "ir": {},
                "diagnostics": { "type": "array" },
                "waitForCompletion": { "type": "boolean" },
                "downloadOutputs": { "type": "boolean" },
                "promptId": { "type": "string" },
                "download": { "type": "boolean" },
                "prompt": {}
            }),
            &["action"],
        ),
        invocation: target("comfyui", "tool"),
        read_only: false,
        default_enabled: false,
        default_profiles: vec!["coding".to_string(), "full".to_string()],
        approval: Some(NativeApprovalPolicy {
            title: "Run ComfyUI workflow".to_string(),
            description:
                "Submit a generated workflow to the local ComfyUI queue. This may use GPU, disk, and time."
                    .to_string(),
            severity: NativeApprovalSeverity::Warning,
            timeout_behavior: NativeApprovalTimeoutBehavior::Deny,
            condition: Some(NativeApprovalCondition {
                param: "action".to_string(),
                equals: json!("run"),
            }),
        }),
    });
    for (method, scope, operation) in [
        (
            "comfyui.status",
            NativeGatewayMethodScope::OperatorRead,
            "status",
        ),
        (
            "comfyui.workflows.list",
            NativeGatewayMethodScope::OperatorRead,
            "workflows-list",
        ),
        (
            "comfyui.workflow.get",
            NativeGatewayMethodScope::OperatorRead,
            "workflow-get",
        ),
        (
            "comfyui.runs.list",
            NativeGatewayMethodScope::OperatorRead,
            "runs-list",
        ),
        (
            "comfyui.outputs.list",
            NativeGatewayMethodScope::OperatorRead,
            "outputs-list",
        ),
        (
            "comfyui.workflow.validate",
            NativeGatewayMethodScope::OperatorRead,
            "tool",
        ),
        (
            "comfyui.workflow.run",
            NativeGatewayMethodScope::OperatorWrite,
            "tool",
        ),
    ] {
        entry.gateway_methods.push(NativeGatewayMethodDescriptor {
            method: method.to_string(),
            scope,
            invocation: target("comfyui", operation),
        });
    }
    entry
}

fn browser_descriptor() -> NativePluginDescriptor {
    let mut entry = descriptor(
        "browser",
        "Browser",
        "Rust-native browser automation backed by the managed agent-browser runtime.",
    );
    entry.tools.push(NativeToolDescriptor {
        name: "browser".to_string(),
        label: "Browser".to_string(),
        description:
            "Open pages, inspect snapshots, capture screenshots, and interact with a managed browser through agent-browser."
                .to_string(),
        parameters: tool_params(
            json!({
                "action": {
                    "type": "string",
                    "enum": [
                        "open",
                        "navigate",
                        "snapshot",
                        "screenshot",
                        "pdf",
                        "cookies",
                        "storage",
                        "network",
                        "console",
                        "download",
                        "upload",
                        "act",
                        "batch",
                        "profiles",
                        "status",
                        "start",
                        "stop",
                        "tabs",
                        "focus",
                        "close"
                    ]
                },
                "target": { "type": "string", "enum": ["host"] },
                "targetUrl": { "type": "string" },
                "url": { "type": "string" },
                "profile": { "type": "string" },
                "agentSessionKey": { "type": "string" },
                "timeoutMs": { "type": "number" },
                "selector": { "type": "string" },
                "ref": { "type": "string" },
                "targetId": { "type": "string" },
                "interactive": { "type": "boolean" },
                "compact": { "type": "boolean" },
                "depth": { "type": "number" },
                "fullPage": { "type": "boolean" },
                "type": { "type": "string", "enum": ["png", "jpeg"] },
                "storageKind": { "type": "string", "enum": ["local", "session"] },
                "paths": { "type": "array", "items": { "type": "string" } },
                "request": { "type": "object" },
                "steps": { "type": "array", "items": { "type": "object" } }
            }),
            &["action"],
        ),
        invocation: target("browser", "tool"),
        read_only: false,
        default_enabled: true,
        default_profiles: vec!["coding".to_string(), "full".to_string()],
        approval: None,
    });
    entry.services.push(NativeServiceDescriptor {
        id: "browser-agent-browser-runtime".to_string(),
        label: "Agent Browser Runtime".to_string(),
        start: target("browser", "service-start"),
        stop: target("browser", "service-stop"),
    });
    entry
}

fn llm_task_descriptor() -> NativePluginDescriptor {
    let mut entry = descriptor(
        "llm-task",
        "LLM Task",
        "Generic JSON-only LLM tool for structured tasks callable from workflows.",
    );
    entry.tools.push(NativeToolDescriptor {
        name: "llm-task".to_string(),
        label: "LLM Task".to_string(),
        description:
            "Run a generic JSON-only LLM task and return schema-validated JSON through a host agent callback."
                .to_string(),
        parameters: tool_params(
            json!({
                "prompt": { "type": "string" },
                "input": {},
                "schema": {},
                "provider": { "type": "string" },
                "model": { "type": "string" },
                "thinking": { "type": "string" },
                "authProfileId": { "type": "string" },
                "temperature": { "type": "number" },
                "maxTokens": { "type": "number" },
                "timeoutMs": { "type": "number" }
            }),
            &["prompt"],
        ),
        invocation: target("llm-task", "execute"),
        read_only: false,
        default_enabled: false,
        default_profiles: vec!["coding".to_string(), "full".to_string()],
        approval: None,
    });
    entry.host_callbacks.push(NativeHostCallback::AgentRun);
    entry.host_callbacks.push(NativeHostCallback::TempdirCreate);
    entry
}

fn searxng_descriptor() -> NativePluginDescriptor {
    let mut entry = descriptor(
        "searxng",
        "SearXNG",
        "Bundled native provider for managed local SearXNG web search.",
    );
    entry
        .web_search_providers
        .push(NativeWebSearchProviderDescriptor {
            id: "searxng".to_string(),
            label: "SearXNG".to_string(),
            invocation: target("searxng", "search"),
        });
    entry.services.push(NativeServiceDescriptor {
        id: "searxng-daemon".to_string(),
        label: "SearXNG Daemon".to_string(),
        start: target("searxng", "service-start"),
        stop: target("searxng", "service-stop"),
    });
    entry
}

fn spider_fetch_descriptor() -> NativePluginDescriptor {
    let mut entry = descriptor(
        "spider-fetch",
        "Spider Fetch",
        "Bundled native provider for static HTTP fetch and Spider browser-rendered fetch.",
    );
    entry
        .web_fetch_providers
        .push(NativeWebFetchProviderDescriptor {
            id: "spider".to_string(),
            label: "Spider".to_string(),
            invocation: target("spider-fetch", "fetch"),
        });
    entry
}

fn qwen3_tts_descriptor() -> NativePluginDescriptor {
    let mut entry = descriptor(
        "qwen3-tts",
        "Qwen3-TTS",
        "Bundled local Qwen3-TTS speech provider.",
    );
    entry.speech_providers.push(NativeSpeechProviderDescriptor {
        id: "qwen3-tts".to_string(),
        label: "Qwen3-TTS (local)".to_string(),
        voices: vec!["assistant".to_string()],
        synthesize: target("qwen3-tts", "synthesize"),
    });
    entry.services.push(NativeServiceDescriptor {
        id: "qwen3-tts-daemon".to_string(),
        label: "Qwen3-TTS Daemon".to_string(),
        start: target("qwen3-tts", "service-start"),
        stop: target("qwen3-tts", "service-stop"),
    });
    entry
}

fn open_prose_descriptor() -> NativePluginDescriptor {
    descriptor(
        "open-prose",
        "OpenProse",
        "Plugin-shipped prose skills bundle.",
    )
}

fn openai_descriptor() -> NativePluginDescriptor {
    let mut entry = descriptor(
        "openai",
        "OpenAI",
        "Rust-native OpenAI model and media-understanding provider.",
    );
    entry
        .media_understanding_providers
        .push(NativeMediaUnderstandingProviderDescriptor {
            id: "openai".to_string(),
            label: "OpenAI media understanding".to_string(),
            invocation: target("openai", "media-understanding"),
        });
    entry
        .media_understanding_providers
        .push(NativeMediaUnderstandingProviderDescriptor {
            id: "openai-codex".to_string(),
            label: "OpenAI Codex media understanding".to_string(),
            invocation: target("openai", "media-understanding"),
        });
    entry
}

fn minimax_mcp_descriptor() -> NativePluginDescriptor {
    let mut entry = descriptor(
        "minimax-mcp",
        "MiniMax MCP",
        "Official MiniMax MCP tools for image generation, video generation, and image understanding.",
    );
    for (name, label, description, properties, required) in [
        (
            "text_to_image",
            "MiniMax text to image",
            "Generate images through the official MiniMax MCP server.",
            json!({
                "prompt": { "type": "string" },
                "model": { "type": "string" },
                "aspectRatio": { "type": "string" },
                "n": { "type": "number" },
                "promptOptimizer": { "type": "boolean" },
                "outputDirectory": { "type": "string" },
                "outputFile": { "type": "string" },
                "timeoutSeconds": { "type": "number" }
            }),
            vec!["prompt"],
        ),
        (
            "generate_video",
            "MiniMax text to video",
            "Generate videos through the official MiniMax MCP server.",
            json!({
                "prompt": { "type": "string" },
                "model": { "type": "string" },
                "firstFrameImage": { "type": "string" },
                "duration": { "type": "number" },
                "resolution": { "type": "string" },
                "outputDirectory": { "type": "string" },
                "outputFile": { "type": "string" },
                "async_mode": { "type": "boolean" },
                "timeoutSeconds": { "type": "number" }
            }),
            vec!["prompt"],
        ),
        (
            "image_to_video",
            "MiniMax image to video",
            "Generate videos from a first frame image through the official MiniMax MCP server.",
            json!({
                "prompt": { "type": "string" },
                "firstFrameImage": { "type": "string" },
                "model": { "type": "string" },
                "outputDirectory": { "type": "string" },
                "outputFile": { "type": "string" },
                "async_mode": { "type": "boolean" },
                "timeoutSeconds": { "type": "number" }
            }),
            vec!["prompt", "firstFrameImage"],
        ),
        (
            "understand_image",
            "MiniMax image understanding",
            "Analyze an image through the official MiniMax Token Plan MCP server.",
            json!({
                "prompt": { "type": "string" },
                "image_source": { "type": "string" },
                "timeoutSeconds": { "type": "number" }
            }),
            vec!["prompt", "image_source"],
        ),
    ] {
        entry.tools.push(NativeToolDescriptor {
            name: name.to_string(),
            label: label.to_string(),
            description: description.to_string(),
            parameters: tool_params(properties, &required),
            invocation: target("minimax-mcp", name),
            read_only: false,
            default_enabled: true,
            default_profiles: vec!["coding".to_string(), "full".to_string()],
            approval: Some(NativeApprovalPolicy {
                title: "Run MiniMax MCP tool".to_string(),
                description: "Call MiniMax MCP. This can send prompts or local image paths to MiniMax and may incur provider costs.".to_string(),
                severity: NativeApprovalSeverity::Warning,
                timeout_behavior: NativeApprovalTimeoutBehavior::Deny,
                condition: None,
            }),
        });
    }
    entry
}

fn openshell_descriptor() -> NativePluginDescriptor {
    descriptor(
        "openshell",
        "OpenShell",
        "Native shell-adjacent helper operations.",
    )
}

pub fn builtin_native_plugin_descriptors() -> Vec<NativePluginDescriptor> {
    vec![
        browser_descriptor(),
        lobster_descriptor(),
        comfyui_descriptor(),
        searxng_descriptor(),
        spider_fetch_descriptor(),
        llm_task_descriptor(),
        qwen3_tts_descriptor(),
        openai_descriptor(),
        minimax_mcp_descriptor(),
        open_prose_descriptor(),
        openshell_descriptor(),
    ]
}

pub fn find_builtin_native_plugin_descriptor(plugin_id: &str) -> Option<NativePluginDescriptor> {
    builtin_native_plugin_descriptors()
        .into_iter()
        .find(|entry| entry.plugin_id == plugin_id)
}

pub fn builtin_native_tool_descriptors() -> Vec<(String, NativeToolDescriptor)> {
    builtin_native_plugin_descriptors()
        .into_iter()
        .flat_map(|plugin| {
            plugin
                .tools
                .into_iter()
                .map(move |tool| (plugin.plugin_id.clone(), tool))
        })
        .collect()
}

pub async fn dispatch_builtin_native_plugin_operation(
    plugin: &str,
    operation: &str,
    input: Value,
) -> NativeResult<Value> {
    match (plugin, operation) {
        ("open-prose", "describe") => Ok(describe_open_prose()),
        ("llm-task", "prepare") => {
            let prepared = prepare_llm_task(serde_json::from_value::<LlmTaskPrepareInput>(input)?)?;
            Ok(to_value(prepared)?)
        }
        ("llm-task", "complete") => complete_llm_task(input),
        ("llm-task", "execute") => Err(invalid_input(
            "llm-task execute requires the host.agent.run callback and cannot run in the standalone native plugin binary.",
        )),
        ("lobster", "execute") => execute_lobster(input).await,
        ("browser", "tool") => execute_browser_tool(input).await,
        ("browser", "service-start") => start_browser_service(input).await,
        ("browser", "service-stop") => Ok(stop_browser_service()),
        ("openshell", operation) => handle_openshell(operation, input).await,
        ("comfyui", operation) => handle_comfyui(operation, input).await,
        ("qwen3-tts", "build-synthesis-payload") => build_synthesis_payload(&input),
        ("qwen3-tts", "synthesize") => synthesize_qwen3_tts(input).await,
        ("qwen3-tts", "service-start") => start_qwen3_tts_service(input).await,
        ("qwen3-tts", "service-stop") => Ok(stop_qwen3_tts_service()),
        ("searxng", "search") => run_searxng_search(input).await,
        ("searxng", "service-start") => start_searxng_service(input).await,
        ("searxng", "service-stop") => Ok(stop_searxng_service()),
        ("spider-fetch", "fetch") => run_spider_fetch(input).await,
        ("openai", "media-understanding") => describe_openai_media(input).await,
        ("minimax-mcp", operation) => handle_minimax_mcp(operation, input).await,
        (plugin, operation) => Err(invalid_input(format!(
            "Unsupported native plugin operation: {plugin} {operation}"
        ))),
    }
}

pub async fn dispatch_builtin_native_service_lifecycle(
    plugin: &str,
    service: &str,
    start: bool,
    input: Value,
) -> NativeResult<Value> {
    let descriptor = find_builtin_native_plugin_descriptor(plugin)
        .ok_or_else(|| invalid_input(format!("Unknown native plugin: {plugin}")))?;
    let service_descriptor = descriptor
        .services
        .into_iter()
        .find(|entry| entry.id == service)
        .ok_or_else(|| {
            invalid_input(format!("Unknown native plugin service: {plugin}/{service}"))
        })?;
    let target = if start {
        service_descriptor.start
    } else {
        service_descriptor.stop
    };
    dispatch_builtin_native_plugin_operation(&target.plugin_id, &target.operation, input).await
}

pub fn native_model_provider_descriptors() -> Vec<NativeModelProviderDescriptor> {
    builtin_native_plugin_descriptors()
        .into_iter()
        .flat_map(|entry| entry.model_providers)
        .collect()
}

pub fn native_web_search_provider_descriptors() -> Vec<NativeWebSearchProviderDescriptor> {
    builtin_native_plugin_descriptors()
        .into_iter()
        .flat_map(|entry| entry.web_search_providers)
        .collect()
}

pub fn native_web_fetch_provider_descriptors() -> Vec<NativeWebFetchProviderDescriptor> {
    builtin_native_plugin_descriptors()
        .into_iter()
        .flat_map(|entry| entry.web_fetch_providers)
        .collect()
}

pub fn native_speech_provider_descriptors() -> Vec<NativeSpeechProviderDescriptor> {
    builtin_native_plugin_descriptors()
        .into_iter()
        .flat_map(|entry| entry.speech_providers)
        .collect()
}

pub fn native_media_understanding_provider_descriptors(
) -> Vec<NativeMediaUnderstandingProviderDescriptor> {
    builtin_native_plugin_descriptors()
        .into_iter()
        .flat_map(|entry| entry.media_understanding_providers)
        .collect()
}
