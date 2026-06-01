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
            AgentLoopEvent::ToolUseSummary { summary } => {
                Some(tool_use_summary_event_to_run_event(run_id, summary))
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
        ToolExecutionEvent::PermissionDecision {
            request_id,
            tool_name,
            decision,
            mode,
            category,
            reason,
        } => AgentRunEvent::PermissionDecision {
            run_id: run_id.to_string(),
            request_id,
            tool_name,
            decision,
            mode,
            category,
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

fn tool_use_summary_event_to_run_event(
    run_id: &str,
    summary: ToolUseSummaryEvent,
) -> AgentRunEvent {
    AgentRunEvent::ToolUseSummary {
        run_id: run_id.to_string(),
        call_id: summary.call_id,
        tool_name: summary.tool_name,
        status: summary.status,
        is_error: summary.is_error,
        read_only: summary.read_only,
        duration_ms: summary.duration_ms,
        result_projected: summary.result_projected,
        result_persisted: summary.result_persisted,
        omitted_chars: summary.omitted_chars,
        persisted_path: summary.persisted_path,
    }
}
