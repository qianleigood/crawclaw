use crawclaw_channels::{
    canonical_agent_run_event_types, channel_contract_version, dispatch_native_channel_outbound,
    find_native_channel_descriptor, list_native_channel_descriptors,
    lookup_native_channel_directory, resolve_native_channel_lifecycle_update, AgentModelSelection,
    AgentRunEvent, AgentRunProfileKind, AgentRunProfileRequest, AgentRunRequest,
    ChannelCapabilityDescriptor, ChannelDirectoryLookupRequest, ChannelInboundCapability,
    ChannelInboundEnvelope, ChannelLifecycleCapability, ChannelOutboundAction,
    ChannelOutboundCapability, ChannelOutboundRequest, ChatType, MessagingTargetKind,
    NativeChannelDispatchContext, NativeChannelLifecycleInput, ReplyPayload, TranscriptRole,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn example_inbound() -> ChannelInboundEnvelope {
    ChannelInboundEnvelope {
        channel: "feishu".to_string(),
        account_id: Some("default".to_string()),
        from: "feishu:123".to_string(),
        to: "feishu:456".to_string(),
        chat_type: ChatType::Direct,
        body: "hello".to_string(),
        raw_body: Some("hello".to_string()),
        message_id: Some("m1".to_string()),
        thread_id: None,
        media_urls: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

#[test]
fn agent_run_request_uses_camel_case_wire_shape() {
    let request = AgentRunRequest {
        run_id: "run-1".to_string(),
        agent_id: "main".to_string(),
        session_key: "agent:main:feishu:direct:123".to_string(),
        inbound: example_inbound(),
        model: AgentModelSelection {
            provider: "openai".to_string(),
            model: "gpt-5.4".to_string(),
            reasoning_level: Some("medium".to_string()),
        },
        enabled_tools: vec!["message".to_string()],
        profile: Some(AgentRunProfileRequest {
            kind: AgentRunProfileKind::Normal,
            special_agent: None,
            memory_after_turn: Some(true),
        }),
        options: BTreeMap::new(),
    };

    let value = serde_json::to_value(request).expect("serialize request");

    assert_eq!(value["runId"], "run-1");
    assert_eq!(value["agentId"], "main");
    assert_eq!(value["sessionKey"], "agent:main:feishu:direct:123");
    assert_eq!(value["inbound"]["accountId"], "default");
    assert_eq!(value["inbound"]["chatType"], "direct");
    assert_eq!(value["model"]["reasoningLevel"], "medium");
    assert_eq!(value["profile"]["kind"], "normal");
    assert_eq!(value["profile"]["memoryAfterTurn"], true);
    assert!(value.get("run_id").is_none());
}

#[test]
fn agent_run_events_cover_required_stream_types() {
    assert_eq!(
        canonical_agent_run_event_types(),
        &[
            "runStarted",
            "modelChunk",
            "toolCall",
            "toolResult",
            "replyPayload",
            "transcriptAppended",
            "deliveryRequested",
            "runCompleted",
            "runFailed",
        ]
    );

    let event = AgentRunEvent::DeliveryRequested {
        run_id: "run-1".to_string(),
        request: ChannelOutboundRequest {
            request_id: "out-1".to_string(),
            channel: "feishu".to_string(),
            account_id: Some("default".to_string()),
            action: ChannelOutboundAction::Send,
            to: "feishu:123".to_string(),
            text: Some("hi".to_string()),
            media_urls: Vec::new(),
            reply_to_id: None,
            thread_id: Some("42".to_string()),
            params: BTreeMap::new(),
        },
    };

    let value = serde_json::to_value(event).expect("serialize event");

    assert_eq!(value["type"], "deliveryRequested");
    assert_eq!(value["runId"], "run-1");
    assert_eq!(value["request"]["requestId"], "out-1");
    assert_eq!(value["request"]["accountId"], "default");
    assert_eq!(value["request"]["action"], "send");
    assert_eq!(value["request"]["threadId"], "42");
}

#[test]
fn agent_run_event_round_trips_reply_and_transcript_shapes() {
    let reply = AgentRunEvent::ReplyPayload {
        run_id: "run-1".to_string(),
        payload: ReplyPayload {
            text: Some("done".to_string()),
            media_urls: vec!["https://example.test/file.png".to_string()],
            metadata: BTreeMap::new(),
        },
    };
    let transcript = AgentRunEvent::TranscriptAppended {
        run_id: "run-1".to_string(),
        session_key: "agent:main:feishu:direct:123".to_string(),
        role: TranscriptRole::Assistant,
        message_id: "msg-1".to_string(),
    };

    assert_eq!(
        serde_json::to_value(reply).expect("reply event"),
        json!({
            "type": "replyPayload",
            "runId": "run-1",
            "payload": {
                "text": "done",
                "mediaUrls": ["https://example.test/file.png"]
            }
        })
    );
    assert_eq!(
        serde_json::to_value(transcript).expect("transcript event"),
        json!({
            "type": "transcriptAppended",
            "runId": "run-1",
            "sessionKey": "agent:main:feishu:direct:123",
            "role": "assistant",
            "messageId": "msg-1"
        })
    );
}

#[test]
fn channel_capability_descriptor_declares_native_adapter_contract() {
    let descriptor = ChannelCapabilityDescriptor {
        channel: "feishu".to_string(),
        label: "Feishu".to_string(),
        runtime_kind: "rust".to_string(),
        adapter_runtime_kind: "rust".to_string(),
        rust_adapter_id: "feishu-native".to_string(),
        chat_types: vec![ChatType::Direct, ChatType::Channel, ChatType::Thread],
        actions: vec![ChannelOutboundAction::Send, ChannelOutboundAction::Reply],
        inbound: ChannelInboundCapability {
            webhook: true,
            polling: true,
            media_download: true,
        },
        outbound: ChannelOutboundCapability {
            text: true,
            media: true,
            poll: true,
            thread_reply: true,
        },
        lifecycle: ChannelLifecycleCapability {
            setup: true,
            status: true,
            start: true,
            stop: true,
            restart: true,
        },
    };

    let value = serde_json::to_value(descriptor).expect("serialize descriptor");

    assert_eq!(channel_contract_version(), "2026-05-agent-channel-rust-v1");
    assert_eq!(value["channel"], "feishu");
    assert_eq!(value["runtimeKind"], "rust");
    assert_eq!(value["adapterRuntimeKind"], "rust");
    assert_eq!(value["rustAdapterId"], "feishu-native");
    assert_eq!(value["chatTypes"], json!(["direct", "channel", "thread"]));
    assert_eq!(value["actions"], json!(["send", "reply"]));
    assert_eq!(value["inbound"]["mediaDownload"], true);
    assert_eq!(value["outbound"]["threadReply"], true);
    assert_eq!(value["lifecycle"]["restart"], true);
}

#[test]
fn event_deserialization_rejects_unknown_required_shapes() {
    let err = serde_json::from_value::<AgentRunEvent>(json!({
        "type": "deliveryRequested",
        "runId": "run-1",
        "request": {
            "requestId": "out-1",
            "channel": "feishu",
            "action": "send",
            "text": "missing to"
        }
    }))
    .expect_err("missing required to should fail");

    assert!(err.to_string().contains("to"));
}

#[test]
fn custom_outbound_action_keeps_explicit_string_payload() {
    let value = serde_json::to_value(ChannelOutboundAction::Custom("pin".to_string()))
        .expect("custom action");

    assert_eq!(value, Value::String("pin".to_string()));
}

#[test]
fn native_channel_catalog_declares_bundled_channel_capabilities() {
    let descriptors = list_native_channel_descriptors();
    let ids = descriptors
        .iter()
        .map(|descriptor| descriptor.channel.as_str())
        .collect::<Vec<_>>();
    let expected_repo_owned_channel_plugins = ["ddingtalk", "feishu", "esp32", "qqbot", "weixin"];

    assert_eq!(ids, expected_repo_owned_channel_plugins);
    for channel in expected_repo_owned_channel_plugins {
        assert!(
            ids.contains(&channel),
            "missing native descriptor for {channel}"
        );
    }
    assert_eq!(
        ids.len(),
        ids.iter().collect::<std::collections::BTreeSet<_>>().len()
    );

    let feishu = find_native_channel_descriptor("FEISHU").expect("feishu descriptor");
    assert_eq!(feishu.rust_adapter_id, "feishu-native");
    assert!(feishu.inbound.webhook);
    assert!(feishu.outbound.thread_reply);
    assert!(feishu.lifecycle.status);

    let esp32 = find_native_channel_descriptor("esp32").expect("esp32 descriptor");
    assert_eq!(esp32.rust_adapter_id, "esp32-native");
    assert_eq!(esp32.label, "ESP32");
    assert_eq!(esp32.chat_types, vec![ChatType::Direct]);
    assert_eq!(
        esp32.actions,
        vec![
            ChannelOutboundAction::Send,
            ChannelOutboundAction::SendAttachment
        ]
    );
    assert!(esp32.inbound.polling);
    assert!(esp32.outbound.media);
    assert!(esp32.lifecycle.status);

    assert!(find_native_channel_descriptor("telegram").is_none());
}

fn example_outbound_request(channel: &str) -> ChannelOutboundRequest {
    ChannelOutboundRequest {
        request_id: "out-1".to_string(),
        channel: channel.to_string(),
        account_id: Some("default".to_string()),
        action: ChannelOutboundAction::Send,
        to: format!("{channel}:target"),
        text: Some("hello".to_string()),
        media_urls: Vec::new(),
        reply_to_id: None,
        thread_id: None,
        params: BTreeMap::new(),
    }
}

#[test]
fn native_channel_dispatcher_delivers_connected_desktop_messages() {
    let mut request = example_outbound_request("desktop");
    request.media_urls = vec!["https://example.test/a.png".to_string()];
    request.reply_to_id = Some("message-1".to_string());
    request.thread_id = Some("thread-1".to_string());
    request
        .params
        .insert("gifPlayback".to_string(), json!(true));
    let record = dispatch_native_channel_outbound(
        &request,
        NativeChannelDispatchContext {
            connected: true,
            now_ms: 123,
        },
    );

    assert!(record.ok);
    assert!(record.sent);
    assert_eq!(record.message_id, "rust-send-123");
    assert_eq!(record.delivery_status, "delivered");
    assert_eq!(record.status, "delivered");
    assert_eq!(record.error_code, None);
    assert_eq!(record.queued_at_ms, None);
    assert_eq!(record.delivered_at_ms, Some(123));

    assert_eq!(
        serde_json::to_value(record).expect("serialize dispatch record"),
        json!({
            "ok": true,
            "requestId": "out-1",
            "action": "send",
            "messageId": "rust-send-123",
            "channel": "desktop",
            "accountId": "default",
            "to": "desktop:target",
            "text": "hello",
            "mediaUrls": ["https://example.test/a.png"],
            "replyToId": "message-1",
            "threadId": "thread-1",
            "params": {
                "gifPlayback": true
            },
            "sent": true,
            "deliveryStatus": "delivered",
            "status": "delivered",
            "errorCode": null,
            "queuedAtMs": null,
            "deliveredAtMs": 123,
            "implementation": "rust-native"
        })
    );
}

#[test]
fn native_channel_dispatcher_blocks_desktop_until_login() {
    let record = dispatch_native_channel_outbound(
        &example_outbound_request("desktop"),
        NativeChannelDispatchContext {
            connected: false,
            now_ms: 456,
        },
    );

    assert!(!record.ok);
    assert!(!record.sent);
    assert_eq!(record.message_id, "rust-send-456");
    assert_eq!(record.delivery_status, "blocked");
    assert_eq!(record.error_code, Some("needs_channel_login".to_string()));
    assert_eq!(record.queued_at_ms, Some(456));
    assert_eq!(record.delivered_at_ms, None);
}

#[test]
fn native_channel_dispatcher_blocks_external_channels_without_native_transport() {
    let record = dispatch_native_channel_outbound(
        &example_outbound_request("custom-channel"),
        NativeChannelDispatchContext {
            connected: true,
            now_ms: 789,
        },
    );

    assert!(!record.ok);
    assert!(!record.sent);
    assert_eq!(record.channel, "custom-channel");
    assert_eq!(
        record.error_code,
        Some("needs_channel_transport".to_string())
    );
    assert_eq!(record.queued_at_ms, Some(789));
    assert_eq!(record.delivered_at_ms, None);
}

#[test]
fn native_channel_lifecycle_policy_runs_local_desktop_natively() {
    let update = resolve_native_channel_lifecycle_update(NativeChannelLifecycleInput {
        channel: "desktop".to_string(),
        method: "channels.account.login.start".to_string(),
        enabled: true,
        configured: true,
        current_linked: false,
        current_connected: false,
    });

    assert!(update.enabled);
    assert!(update.configured);
    assert!(update.linked);
    assert!(update.running);
    assert!(update.connected);
    assert_eq!(update.health_state, "connected");
}

#[test]
fn native_channel_lifecycle_policy_verifies_existing_state_without_login() {
    let update = resolve_native_channel_lifecycle_update(NativeChannelLifecycleInput {
        channel: "desktop".to_string(),
        method: "channels.account.verify".to_string(),
        enabled: true,
        configured: true,
        current_linked: true,
        current_connected: false,
    });

    assert!(update.linked);
    assert!(!update.running);
    assert!(!update.connected);
    assert_eq!(update.health_state, "needs_login");
}

#[test]
fn native_channel_lifecycle_policy_blocks_external_channel_transport() {
    let update = resolve_native_channel_lifecycle_update(NativeChannelLifecycleInput {
        channel: "custom-channel".to_string(),
        method: "channels.account.login.start".to_string(),
        enabled: true,
        configured: true,
        current_linked: false,
        current_connected: false,
    });

    assert!(!update.linked);
    assert!(!update.running);
    assert!(!update.connected);
    assert_eq!(update.health_state, "needs_channel_transport");
}

#[test]
fn native_channel_lifecycle_policy_handles_logout_and_unconfigured_channels() {
    let logout = resolve_native_channel_lifecycle_update(NativeChannelLifecycleInput {
        channel: "desktop".to_string(),
        method: "channels.logout".to_string(),
        enabled: true,
        configured: true,
        current_linked: true,
        current_connected: true,
    });
    assert!(!logout.linked);
    assert!(!logout.running);
    assert!(!logout.connected);
    assert_eq!(logout.health_state, "logged_out");

    let unconfigured = resolve_native_channel_lifecycle_update(NativeChannelLifecycleInput {
        channel: "custom-channel".to_string(),
        method: "channels.account.login.start".to_string(),
        enabled: false,
        configured: false,
        current_linked: false,
        current_connected: false,
    });
    assert_eq!(unconfigured.health_state, "unconfigured");
}

#[test]
fn native_channel_directory_lookup_normalizes_targets() {
    let result = lookup_native_channel_directory(ChannelDirectoryLookupRequest {
        channel: " Feishu ".to_string(),
        account_id: Some("default".to_string()),
        query: Some(" @Alice ".to_string()),
        kind: Some(MessagingTargetKind::User),
        limit: Some(10),
    })
    .expect("directory lookup");

    assert_eq!(result.channel, "feishu");
    assert_eq!(result.account_id, Some("default".to_string()));
    assert_eq!(result.query, Some("@Alice".to_string()));
    assert_eq!(result.descriptor.rust_adapter_id, "feishu-native");
    assert_eq!(result.targets.len(), 1);
    assert_eq!(result.targets[0].kind, MessagingTargetKind::User);
    assert_eq!(result.targets[0].id, "Alice");
    assert_eq!(result.targets[0].raw, "@Alice");
    assert_eq!(result.targets[0].normalized, "user:alice");

    assert_eq!(
        serde_json::to_value(result).expect("directory json"),
        json!({
            "ok": true,
            "channel": "feishu",
            "accountId": "default",
            "query": "@Alice",
            "descriptor": {
                "channel": "feishu",
                "label": "Feishu",
                "runtimeKind": "rust",
                "adapterRuntimeKind": "rust",
                "rustAdapterId": "feishu-native",
                "chatTypes": ["direct", "channel", "thread"],
                "actions": ["send", "reply", "sendAttachment", "threadReply"],
                "inbound": {
                    "webhook": true,
                    "polling": false,
                    "mediaDownload": true
                },
                "outbound": {
                    "text": true,
                    "media": true,
                    "poll": false,
                    "threadReply": true
                },
                "lifecycle": {
                    "setup": true,
                    "status": true,
                    "start": true,
                    "stop": true,
                    "restart": true
                }
            },
            "targets": [{
                "kind": "user",
                "id": "Alice",
                "raw": "@Alice",
                "normalized": "user:alice"
            }],
            "implementation": "rust-native"
        })
    );
}

#[test]
fn native_channel_directory_lookup_respects_explicit_channel_target_prefix() {
    let result = lookup_native_channel_directory(ChannelDirectoryLookupRequest {
        channel: "qqbot".to_string(),
        account_id: None,
        query: Some("channel:Ops".to_string()),
        kind: Some(MessagingTargetKind::User),
        limit: None,
    })
    .expect("directory lookup");

    assert_eq!(result.targets[0].kind, MessagingTargetKind::Channel);
    assert_eq!(result.targets[0].id, "Ops");
    assert_eq!(result.targets[0].normalized, "channel:ops");
}

#[test]
fn native_channel_directory_lookup_rejects_unknown_channels() {
    let error = lookup_native_channel_directory(ChannelDirectoryLookupRequest {
        channel: "missing".to_string(),
        account_id: None,
        query: Some("alice".to_string()),
        kind: None,
        limit: None,
    })
    .expect_err("unknown channel should fail");

    assert!(error.contains("unknown native channel"));
}
