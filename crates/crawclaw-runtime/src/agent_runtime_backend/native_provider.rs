use super::*;

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use crate::agent_tool_result_projection::{
    project_tool_result_content, project_tool_result_content_with_persistence,
    ToolResultProjectionBudget, ToolResultProjectionPersistence,
};
use crawclaw_providers::{
    NativeProviderAssistantResponse, NativeProviderContentBlock, NativeProviderMessage,
    NativeProviderMessageRole, NativeProviderRequestOptions, NativeProviderTool,
};
use serde_json::{json, Value};

#[derive(Clone, Default)]
pub struct NativeProviderRuntimeBackend;

impl AgentRuntimeBackend for NativeProviderRuntimeBackend {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentBackendResult, AgentRuntimeError>> + Send + 'a>>
    {
        Box::pin(async move {
            let mut messages =
                agent_messages_to_native_provider_messages(&request.runtime_context.messages);
            let tools = build_native_runtime_tool_registry_for_selection(
                request.runtime_root,
                &request.tool_selection,
                request.permission_policy.clone(),
                request.tool_hook_policy.clone(),
            );
            let provider_tools = request
                .runtime_context
                .included_tool_schemas
                .iter()
                .map(|tool| NativeProviderTool {
                    name: tool.name.clone(),
                    description: Some(tool.description.clone()),
                    input_schema: tool.parameters.clone(),
                })
                .collect::<Vec<_>>();
            let options = NativeProviderRequestOptions {
                stream: !provider_tools.is_empty()
                    && request
                        .runtime_context
                        .context_summary
                        .budget
                        .supports_streaming,
                reasoning_level: request.reasoning_level.clone(),
                system_prompt: request.runtime_context.system_prompt(),
                tools: provider_tools,
                max_output_tokens: Some(
                    request
                        .runtime_context
                        .context_summary
                        .budget
                        .output_reserve_tokens,
                ),
            };
            let max_tool_iterations = request.max_tool_iterations.max(1);
            let tool_result_projection_budget =
                ToolResultProjectionBudget::from_prompt_budget_tokens(
                    request
                        .runtime_context
                        .context_summary
                        .budget
                        .max_prompt_tokens,
                );
            let mut loop_events = Vec::new();

            for tool_iteration in 0..=max_tool_iterations {
                let response = send_native_provider_conversation_response_with_retry(
                    &request.provider_config,
                    &messages,
                    &options,
                )
                .await
                .map_err(map_provider_error)?;
                if response.tool_calls.is_empty() {
                    if response.text.trim().is_empty() {
                        return Err(AgentRuntimeError::ProviderFailed(
                            "NativeProvider runtime did not produce assistant text.".to_string(),
                        ));
                    }
                    return Ok(AgentBackendResult {
                        assistant_text: response.text,
                        loop_events,
                    });
                }

                if !response.text.trim().is_empty() {
                    loop_events.push(AgentLoopEvent::ProviderBlock {
                        block_type: "text_delta".to_string(),
                        text: Some(response.text.clone()),
                        metadata: json!({ "source": "native-provider" }),
                    });
                }
                if tool_iteration == max_tool_iterations {
                    return Err(AgentRuntimeError::ProviderFailed(format!(
                        "NativeProvider runtime exceeded max tool iterations ({max_tool_iterations})."
                    )));
                }
                messages.push(native_provider_assistant_tool_call_message(&response));
                messages.extend(
                    execute_native_provider_tool_calls(
                        &tools,
                        &response.tool_calls,
                        &mut loop_events,
                        tool_result_projection_budget,
                        Some((
                            request.runtime_root.to_path_buf(),
                            request.thread_id.to_string(),
                        )),
                    )
                    .await,
                );
            }

            Err(AgentRuntimeError::ProviderFailed(format!(
                "NativeProvider runtime exceeded max tool iterations ({max_tool_iterations})."
            )))
        })
    }
}

fn native_provider_assistant_tool_call_message(
    response: &NativeProviderAssistantResponse,
) -> NativeProviderMessage {
    let mut blocks = Vec::new();
    if !response.text.trim().is_empty() {
        blocks.push(NativeProviderContentBlock::text(response.text.clone()));
    }
    blocks.extend(response.tool_calls.iter().map(|tool_call| {
        NativeProviderContentBlock::tool_call(
            tool_call.id.clone(),
            tool_call.name.clone(),
            tool_call.arguments.clone(),
        )
    }));
    NativeProviderMessage {
        role: NativeProviderMessageRole::Assistant,
        content: response.text.clone(),
        blocks,
    }
}

pub(super) async fn execute_native_provider_tool_calls(
    tools: &pi::sdk::ToolRegistry,
    tool_calls: &[crawclaw_providers::NativeProviderToolCall],
    loop_events: &mut Vec<AgentLoopEvent>,
    projection_budget: ToolResultProjectionBudget,
    persistence: Option<(PathBuf, String)>,
) -> Vec<NativeProviderMessage> {
    let mut messages = Vec::with_capacity(tool_calls.len());
    let mut index = 0;
    while index < tool_calls.len() {
        let batch_len = native_provider_tool_call_batch_len(tools, tool_calls, index);
        let batch = &tool_calls[index..index + batch_len];
        messages.extend(
            execute_native_provider_tool_call_batch(
                tools,
                batch,
                loop_events,
                projection_budget,
                persistence.clone(),
            )
            .await,
        );
        index += batch_len;
    }
    messages
}

fn native_provider_tool_call_batch_len(
    tools: &pi::sdk::ToolRegistry,
    tool_calls: &[crawclaw_providers::NativeProviderToolCall],
    start: usize,
) -> usize {
    let Some(first) = tool_calls.get(start) else {
        return 0;
    };
    if !native_provider_tool_call_is_read_only(tools, first) {
        return 1;
    }
    tool_calls[start..]
        .iter()
        .take_while(|tool_call| native_provider_tool_call_is_read_only(tools, tool_call))
        .count()
        .max(1)
}

fn native_provider_tool_call_is_read_only(
    tools: &pi::sdk::ToolRegistry,
    tool_call: &crawclaw_providers::NativeProviderToolCall,
) -> bool {
    tools
        .get(&tool_call.name)
        .is_some_and(|tool| tool.is_read_only())
}

async fn execute_native_provider_tool_call_batch(
    tools: &pi::sdk::ToolRegistry,
    tool_calls: &[crawclaw_providers::NativeProviderToolCall],
    loop_events: &mut Vec<AgentLoopEvent>,
    projection_budget: ToolResultProjectionBudget,
    persistence: Option<(PathBuf, String)>,
) -> Vec<NativeProviderMessage> {
    for tool_call in tool_calls {
        loop_events.push(AgentLoopEvent::ToolExecution {
            event: ToolExecutionEvent::Started {
                call_id: tool_call.id.clone(),
                tool_name: tool_call.name.clone(),
                arguments: tool_call.arguments.clone(),
            },
        });
    }

    let results = futures::future::join_all(tool_calls.iter().map(|tool_call| {
        execute_native_provider_tool_call(tools, tool_call, projection_budget, persistence.clone())
    }))
    .await;

    for result in &results {
        loop_events.extend(result.progress_events.clone());
    }
    for result in &results {
        loop_events.push(AgentLoopEvent::ToolExecution {
            event: ToolExecutionEvent::Completed {
                call_id: result.call_id.clone(),
                tool_name: result.tool_name.clone(),
                output: Some(result.content.clone()),
                is_error: result.is_error,
            },
        });
    }

    results
        .into_iter()
        .map(NativeProviderToolExecutionResult::into_message)
        .collect()
}

struct NativeProviderToolExecutionResult {
    call_id: String,
    tool_name: String,
    content: String,
    is_error: bool,
    progress_events: Vec<AgentLoopEvent>,
}

impl NativeProviderToolExecutionResult {
    fn into_message(self) -> NativeProviderMessage {
        NativeProviderMessage::tool_result(
            self.call_id,
            Some(self.tool_name),
            self.content,
            self.is_error,
        )
    }
}

async fn execute_native_provider_tool_call(
    tools: &pi::sdk::ToolRegistry,
    tool_call: &crawclaw_providers::NativeProviderToolCall,
    projection_budget: ToolResultProjectionBudget,
    persistence: Option<(PathBuf, String)>,
) -> NativeProviderToolExecutionResult {
    let progress_events = Arc::new(std::sync::Mutex::new(Vec::<AgentLoopEvent>::new()));
    let result = match tools.get(&tool_call.name) {
        Some(tool) => {
            let call_id = tool_call.id.clone();
            let tool_name = tool_call.name.clone();
            let update_sink = Arc::clone(&progress_events);
            let on_update = Box::new(move |update: pi::sdk::ToolUpdate| {
                let event = native_tool_update_loop_event(&call_id, &tool_name, &update);
                let mut events = update_sink
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                events.push(event);
            });
            tool.execute(&tool_call.id, tool_call.arguments.clone(), Some(on_update))
                .await
                .map(|output| {
                    let content = native_tool_output_summary(&output)
                        .unwrap_or_else(|| "Tool completed without output.".to_string());
                    let content = if let Some((runtime_root, thread_id)) = persistence.as_ref() {
                        project_tool_result_content_with_persistence(
                            &content,
                            projection_budget,
                            ToolResultProjectionPersistence {
                                runtime_root,
                                thread_id,
                                tool_use_id: &tool_call.id,
                            },
                        )
                        .content
                    } else {
                        project_tool_result_content(&content, projection_budget).content
                    };
                    (content, output.is_error)
                })
                .map_err(|error| error.to_string())
        }
        None => Err(format!(
            "Tool {} is not available in the current NativeProvider runtime context.",
            tool_call.name
        )),
    };

    let (content, is_error) = match result {
        Ok((content, is_error)) => (content, is_error),
        Err(error) => (error, true),
    };
    let progress_events = progress_events
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();

    NativeProviderToolExecutionResult {
        call_id: tool_call.id.clone(),
        tool_name: tool_call.name.clone(),
        content,
        is_error,
        progress_events,
    }
}

fn native_tool_output_summary(output: &pi::sdk::ToolOutput) -> Option<String> {
    native_tool_content_summary(&output.content).or_else(|| {
        output
            .details
            .as_ref()
            .and_then(|details| serde_json::to_string(details).ok())
    })
}

fn native_tool_update_summary(update: &pi::sdk::ToolUpdate) -> Option<String> {
    native_tool_content_summary(&update.content).or_else(|| {
        update
            .details
            .as_ref()
            .and_then(|details| serde_json::to_string(details).ok())
    })
}

fn native_tool_update_loop_event(
    call_id: &str,
    tool_name: &str,
    update: &pi::sdk::ToolUpdate,
) -> AgentLoopEvent {
    if let Some(event) = native_tool_hook_event(update) {
        return AgentLoopEvent::Hook { event };
    }
    if let Some(event) = native_tool_permission_requested_event(call_id, tool_name, update) {
        return AgentLoopEvent::ToolExecution { event };
    }
    AgentLoopEvent::ToolExecution {
        event: ToolExecutionEvent::Progress {
            call_id: call_id.to_string(),
            tool_name: tool_name.to_string(),
            status: "running".to_string(),
            message: native_tool_update_summary(update),
        },
    }
}

fn native_tool_hook_event(update: &pi::sdk::ToolUpdate) -> Option<HookEvent> {
    let details = update.details.as_ref()?.as_object()?;
    if details.get(HOOK_UPDATE_EVENT_KEY).and_then(Value::as_str)
        != Some(HOOK_UPDATE_EVENT_DECISION)
    {
        return None;
    }
    let hook = details
        .get(HOOK_UPDATE_HOOK_KEY)
        .and_then(Value::as_str)?
        .to_string();
    let decision = details
        .get(HOOK_UPDATE_DECISION_KEY)
        .and_then(Value::as_str)?
        .to_string();
    let message = details
        .get(HOOK_UPDATE_MESSAGE_KEY)
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| native_tool_update_summary(update));
    Some(HookEvent {
        hook,
        decision,
        message,
    })
}

fn native_tool_permission_requested_event(
    call_id: &str,
    tool_name: &str,
    update: &pi::sdk::ToolUpdate,
) -> Option<ToolExecutionEvent> {
    let details = update.details.as_ref()?.as_object()?;
    if details
        .get(PERMISSION_UPDATE_EVENT_KEY)
        .and_then(Value::as_str)
        != Some(PERMISSION_UPDATE_EVENT_REQUESTED)
    {
        return None;
    }
    let request_id = details
        .get(PERMISSION_UPDATE_REQUEST_ID_KEY)
        .and_then(Value::as_str)
        .unwrap_or(call_id)
        .to_string();
    let tool_name = details
        .get(PERMISSION_UPDATE_TOOL_NAME_KEY)
        .and_then(Value::as_str)
        .unwrap_or(tool_name)
        .to_string();
    let reason = details
        .get(PERMISSION_UPDATE_REASON_KEY)
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| native_tool_update_summary(update))
        .unwrap_or_else(|| "permission requested".to_string());
    Some(ToolExecutionEvent::PermissionRequested {
        request_id,
        tool_name,
        reason,
    })
}

fn native_tool_content_summary(content: &[pi::sdk::ContentBlock]) -> Option<String> {
    let text = content
        .iter()
        .filter_map(|block| match block {
            pi::sdk::ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    if !text.trim().is_empty() {
        return Some(text);
    }
    None
}
