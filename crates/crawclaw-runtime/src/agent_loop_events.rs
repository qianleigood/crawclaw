use super::*;

pub(super) fn agent_loop_events_to_run_events(
    run_id: &str,
    loop_events: Vec<AgentLoopEvent>,
) -> Vec<AgentRunEvent> {
    loop_events
        .into_iter()
        .filter_map(|event| match event {
            AgentLoopEvent::ContextProjected { .. } => None,
            AgentLoopEvent::ProviderBlock {
                block_type,
                text,
                metadata,
            } => Some(AgentRunEvent::ProviderBlock {
                run_id: run_id.to_string(),
                block_type,
                text,
                metadata,
            }),
            AgentLoopEvent::ToolExecution { event } => {
                Some(tool_execution_event_to_run_event(run_id, event))
            }
            AgentLoopEvent::Hook { event } => Some(AgentRunEvent::HookDecision {
                run_id: run_id.to_string(),
                hook: event.hook,
                decision: event.decision,
                message: event.message,
            }),
        })
        .collect()
}

fn tool_execution_event_to_run_event(run_id: &str, event: ToolExecutionEvent) -> AgentRunEvent {
    match event {
        ToolExecutionEvent::Started {
            call_id,
            tool_name,
            arguments,
        } => AgentRunEvent::ToolCall {
            run_id: run_id.to_string(),
            call_id,
            tool_name,
            arguments,
        },
        ToolExecutionEvent::PermissionRequested {
            request_id,
            tool_name,
            reason,
        } => AgentRunEvent::PermissionRequested {
            run_id: run_id.to_string(),
            request_id,
            tool_name,
            reason,
        },
        ToolExecutionEvent::Progress {
            call_id,
            tool_name,
            status,
            message,
        } => AgentRunEvent::ToolProgress {
            run_id: run_id.to_string(),
            call_id,
            tool_name,
            status,
            message,
        },
        ToolExecutionEvent::Completed {
            call_id,
            tool_name,
            output,
            is_error,
        } => AgentRunEvent::ToolProgress {
            run_id: run_id.to_string(),
            call_id,
            tool_name,
            status: if is_error { "failed" } else { "completed" }.to_string(),
            message: output,
        },
    }
}

pub(super) fn pi_agent_event_to_loop_event(event: pi::sdk::AgentEvent) -> Option<AgentLoopEvent> {
    match event {
        pi::sdk::AgentEvent::ToolExecutionStart {
            tool_call_id,
            tool_name,
            args,
        } => Some(AgentLoopEvent::ToolExecution {
            event: ToolExecutionEvent::Started {
                call_id: tool_call_id,
                tool_name,
                arguments: args,
            },
        }),
        pi::sdk::AgentEvent::ToolExecutionUpdate {
            tool_call_id,
            tool_name,
            partial_result,
            ..
        } => Some(AgentLoopEvent::ToolExecution {
            event: ToolExecutionEvent::Progress {
                call_id: tool_call_id,
                tool_name,
                status: "running".to_string(),
                message: pi_tool_output_summary(&partial_result),
            },
        }),
        pi::sdk::AgentEvent::ToolExecutionEnd {
            tool_call_id,
            tool_name,
            result,
            is_error,
            ..
        } => Some(AgentLoopEvent::ToolExecution {
            event: ToolExecutionEvent::Completed {
                call_id: tool_call_id,
                tool_name,
                output: pi_tool_output_summary(&result),
                is_error,
            },
        }),
        pi::sdk::AgentEvent::MessageUpdate {
            assistant_message_event,
            ..
        } => provider_block_from_pi_message_event(&assistant_message_event),
        _ => None,
    }
}

fn provider_block_from_pi_message_event(event: &impl Serialize) -> Option<AgentLoopEvent> {
    let value = serde_json::to_value(event).ok()?;
    let event_type = value.get("type").and_then(Value::as_str)?;
    let text = value
        .get("delta")
        .or_else(|| value.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string);
    match event_type {
        "text_delta" | "text_end" => Some(AgentLoopEvent::ProviderBlock {
            block_type: event_type.to_string(),
            text,
            metadata: json!({ "source": "pi-agent" }),
        }),
        "thinking_delta" | "thinking_end" => Some(AgentLoopEvent::ProviderBlock {
            block_type: event_type.to_string(),
            text,
            metadata: json!({ "source": "pi-agent" }),
        }),
        "toolcall_delta" | "toolcall_end" => Some(AgentLoopEvent::ProviderBlock {
            block_type: event_type.to_string(),
            text,
            metadata: json!({
                "source": "pi-agent",
                "event": value
            }),
        }),
        _ => None,
    }
}

fn pi_tool_output_summary(output: &pi::sdk::ToolOutput) -> Option<String> {
    let text = output
        .content
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
    output
        .details
        .as_ref()
        .and_then(|details| serde_json::to_string(details).ok())
}
