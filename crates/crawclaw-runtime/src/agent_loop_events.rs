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
