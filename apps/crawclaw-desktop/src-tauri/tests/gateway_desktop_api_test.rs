use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crawclaw_desktop::gateway::desktop_api::{
    is_loopback_addr, start_gateway_server, GatewayConfig,
};
use crawclaw_desktop::runtime_engine::RuntimeLayout;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const TEST_HTTP_READ_TIMEOUT: Duration = Duration::from_secs(30);
use uuid::Uuid;

#[tokio::test]
async fn gateway_bootstrap_returns_loopback_api_and_empty_desktop_state() {
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: missing_runtime_layout(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    assert!(is_loopback_addr(&server.addr));

    let (status, body) = request(
        server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    assert!(!body.contains("默认使用简洁桌面界面"));

    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert_eq!(json["api"]["baseUrl"], server.base_url);
    assert_eq!(json["api"]["sessionToken"], "session");
    assert_eq!(json["runtime"]["status"], "missing");
    assert_eq!(
        json["desktopState"]["agentWorkspace"]["agents"]
            .as_array()
            .expect("agents array")
            .len(),
        0,
    );
    assert_eq!(
        json["desktopState"]["memoryWorkspace"]["items"]
            .as_array()
            .expect("memory items array")
            .len(),
        0,
    );
}

#[tokio::test]
async fn gateway_mutations_require_session_header() {
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: missing_runtime_layout(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"navId":"plugins"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/navigation/select HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 401);

    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/navigation/select HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert_eq!(json["activeNavId"], "plugins");
}

#[tokio::test]
async fn gateway_events_require_session_query() {
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: missing_runtime_layout(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, _) = request(
        server.addr,
        "GET /api/desktop/events HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 401);
}

#[tokio::test]
async fn gateway_events_accept_authorized_session_and_emit_runtime_status() {
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: missing_runtime_layout(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = request_stream_prefix(
        server.addr,
        "GET /api/desktop/events?sessionToken=session HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert!(body.contains("event: runtime"));
    assert!(body.contains("\"status\":\"missing\""));
}

#[tokio::test]
async fn gateway_permission_decision_unknown_request_returns_404() {
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: missing_runtime_layout(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"decision":"approved"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/permissions/not-current/decision HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 404);
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_bootstrap_uses_rust_native_runtime_state_when_runtime_is_ready() {
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: create_runtime_fixture(
            "native-runtime",
            r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
        ),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, body) = request(
        server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert_eq!(json["runtime"]["status"], "ready");
    assert!(json["runtime"].get("nodePath").is_none());
    assert_eq!(json["desktopState"]["activeNavId"], "new-chat");
    assert_eq!(
        json["desktopState"]["agentWorkspace"]["agents"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_bootstrap_reads_rust_plugin_manifest() {
    let runtime_layout = create_runtime_fixture(
        "desktop-plugin-manifest",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_plugin_manifest(&runtime_layout);
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, body) = request(
        server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert_eq!(
        json["desktopState"]["pluginsWorkspace"]["tools"][0]["id"],
        "plugin-tool-files"
    );
    assert_eq!(
        json["desktopState"]["pluginsWorkspace"]["tools"][0]["name"],
        "File tools"
    );
    assert_eq!(
        json["desktopState"]["pluginsWorkspace"]["skills"][0]["id"],
        "plugin-skill-review"
    );
    assert_eq!(
        json["desktopState"]["pluginsWorkspace"]["skills"][0]["trigger"],
        "@review"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_plugin_toggle_state_persists_through_rust_plugin_host() {
    let runtime_layout = create_runtime_fixture(
        "desktop-plugin-toggle-state",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_plugin_manifest(&runtime_layout);
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, body) = request(
        server.addr,
        "POST /api/desktop/plugins/tools/plugin-tool-files/toggle HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert_eq!(json["pluginsWorkspace"]["tools"][0]["open"], true);

    let (status, body) = request(
        server.addr,
        "POST /api/desktop/plugins/skills/plugin-skill-review/toggle HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert_eq!(json["pluginsWorkspace"]["skills"][0]["open"], true);

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert_eq!(
        json["desktopState"]["pluginsWorkspace"]["tools"][0]["open"],
        true
    );
    assert_eq!(
        json["desktopState"]["pluginsWorkspace"]["skills"][0]["open"],
        true
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_rejects_node_plugin_tool_after_rust_hard_cut() {
    let runtime_layout = create_runtime_fixture(
        "desktop-node-plugin",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_plugin_manifest(&runtime_layout);
    let plugin_dir = runtime_layout.runtime_root.join("plugins").join("test-js");
    fs::create_dir_all(&plugin_dir).expect("plugin dir");
    fs::write(
        plugin_dir.join("crawclaw.plugin.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "id": "test-js",
            "runtime": {
                "kind": "node",
                "language": "js",
                "entrypoint": "index.mjs"
            }
        }))
        .expect("plugin manifest json"),
    )
    .expect("plugin manifest");
    fs::write(
        plugin_dir.join("index.mjs"),
        r#"
        export default {
          async register(api) {
            api.registerTool({
              name: "echo",
              description: "Echo a desktop test message",
              parameters: {
                type: "object",
                properties: { message: { type: "string" } }
              },
              execute: async (_callId, input) => {
                return { output: `${api.source}:${api.runtime.version}:${input.message}` };
              }
            });
          }
        };
        "#,
    )
    .expect("plugin entry");

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"input":{"message":"hi"}}"#;
    let request_body = format!(
        "POST /api/desktop/plugins/test-js/tools/echo/invoke HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let (status, body) = request(server.addr, &request_body).await;

    assert_eq!(status, 500);
    assert!(!body.contains("node:node:hi"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_blocks_legacy_js_plugin_fallback_without_node_runtime() {
    let runtime_layout = create_runtime_fixture(
        "desktop-legacy-js-fallback-denied",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_plugin_manifest(&runtime_layout);
    let plugin_dir = runtime_layout.runtime_root.join("plugins").join("test-js");
    fs::create_dir_all(&plugin_dir).expect("plugin dir");
    fs::write(
        plugin_dir.join("crawclaw.plugin.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "id": "test-js",
            "entrypoint": "index.mjs",
            "allowJsPluginFallback": true
        }))
        .expect("plugin manifest json"),
    )
    .expect("plugin manifest");
    fs::write(
        plugin_dir.join("index.mjs"),
        "export default { async register(api) { api.registerTool({ name: 'echo', execute: async () => ({ ok: true }) }); } };",
    )
    .expect("plugin entry");

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"input":{"message":"hi"}}"#;
    let request_body = format!(
        "POST /api/desktop/plugins/test-js/tools/echo/invoke HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let (status, _) = request(server.addr, &request_body).await;

    assert_eq!(status, 500);
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_blocks_js_fallback_for_native_owned_plugins() {
    let runtime_layout = create_runtime_fixture(
        "desktop-native-owned-js-fallback-denied",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_plugin_manifest(&runtime_layout);
    let plugin_dir = runtime_layout.runtime_root.join("plugins").join("comfyui");
    fs::create_dir_all(&plugin_dir).expect("plugin dir");
    fs::write(
        plugin_dir.join("crawclaw.plugin.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "id": "comfyui",
            "runtime": {
                "kind": "node",
                "language": "js",
                "entrypoint": "index.mjs"
            }
        }))
        .expect("plugin manifest json"),
    )
    .expect("plugin manifest");
    fs::write(
        plugin_dir.join("index.mjs"),
        "export default { async register(api) { api.registerTool({ name: 'legacy_echo', execute: async () => ({ ok: true }) }); } };",
    )
    .expect("plugin entry");

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"input":{"message":"hi"}}"#;
    let request_body = format!(
        "POST /api/desktop/plugins/comfyui/tools/legacy_echo/invoke HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let (status, _) = request(server.addr, &request_body).await;

    assert_eq!(status, 500);
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_invokes_comfyui_tool_through_rust_native_plugin() {
    let runtime_layout = create_runtime_fixture(
        "desktop-native-comfyui-plugin",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"input":{"action":"config","baseUrl":"http://127.0.0.1:8188"}}"#;
    let request_body = format!(
        "POST /api/desktop/plugins/comfyui/tools/comfyui_workflow/invoke HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let (status, body) = request(server.addr, &request_body).await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert!(json["conversation"]["resultItems"]
        .as_array()
        .expect("result items")
        .iter()
        .any(|item| item
            .as_str()
            .unwrap_or_default()
            .contains(r#""baseUrl":"http://127.0.0.1:8188""#)));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_invokes_qwen3_tts_through_rust_native_plugin() {
    let runtime_layout = create_runtime_fixture(
        "desktop-native-qwen3-tts-plugin",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"input":{"text":"hello local speech","target":"voice-note","providerConfig":{"runtime":"qwen-tts","defaultProfile":"assistant","profiles":{"assistant":{"source":"preset","quality":"fast","voice":"vivian"}}}}}"#;
    let request_body = format!(
        "POST /api/desktop/plugins/qwen3-tts/tools/qwen3_tts_build_payload/invoke HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let (status, body) = request(server.addr, &request_body).await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    let result_items = json["conversation"]["resultItems"]
        .as_array()
        .expect("result items");
    assert!(result_items.iter().any(|item| {
        let text = item.as_str().unwrap_or_default();
        text.contains("qwen3-tts/qwen3_tts_build_payload")
            && text.contains(r#""runtime":"qwen-tts""#)
            && text.contains(r#""voice":"vivian""#)
    }));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_plugin_invocation_records_tool_messages() {
    let runtime_layout = create_runtime_fixture(
        "desktop-native-qwen3-tts-tool-messages",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"input":{"text":"hello structured tool output","providerConfig":{"runtime":"qwen-tts","profiles":{"assistant":{"source":"preset","voice":"vivian"}}}}}"#;
    let request_body = format!(
        "POST /api/desktop/plugins/qwen3-tts/tools/qwen3_tts_build_payload/invoke HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let (status, body) = request(server.addr, &request_body).await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    let messages = json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages");
    assert!(messages.iter().any(|message| {
        message["kind"] == "toolCall"
            && message["toolId"] == "qwen3_tts_build_payload"
            && message["title"]
                .as_str()
                .unwrap_or_default()
                .contains("qwen3-tts/qwen3_tts_build_payload")
    }));
    assert!(messages.iter().any(|message| {
        message["kind"] == "toolResult"
            && message["toolId"] == "qwen3_tts_build_payload"
            && message["ok"] == true
            && message["text"]
                .as_str()
                .unwrap_or_default()
                .contains(r#""voice":"vivian""#)
    }));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_invokes_searxng_tool_through_rust_native_plugin() {
    let runtime_layout = create_runtime_fixture(
        "desktop-native-searxng-plugin",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let base_url = spawn_searxng_provider().await;

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = format!(
        r#"{{"input":{{"query":"rust native","baseUrl":{},"count":1,"engines":["bing"],"autoStart":false}}}}"#,
        serde_json::to_string(&base_url).expect("base url json")
    );
    let request_body = format!(
        "POST /api/desktop/plugins/searxng/tools/searxng_search/invoke HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let (status, body) = request(server.addr, &request_body).await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    let result_items = json["conversation"]["resultItems"]
        .as_array()
        .expect("result items");
    assert!(result_items.iter().any(|item| {
        let text = item.as_str().unwrap_or_default();
        text.contains("searxng/searxng_search")
            && text.contains(r#""provider":"searxng""#)
            && text.contains("SearXNG Result")
    }));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_create_agent_rejects_non_retained_channel_ids() {
    let runtime_layout = create_runtime_fixture(
        "desktop-create-agent-rejects-legacy-channel",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");
    let body = serde_json::json!({
        "name": "Legacy channel agent",
        "role": "channel test",
        "channels": [
            {"id": "desktop", "label": "桌面", "enabled": true},
            {"id": "dingtalk", "label": "钉钉", "enabled": false},
            {"id": "discord", "label": "Discord", "enabled": false}
        ]
    })
    .to_string();

    let (status, _body) = request(
        server.addr,
        &format!(
            "POST /api/desktop/agents HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 400);
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_create_agent_keeps_only_rust_native_channels() {
    let runtime_layout = create_runtime_fixture(
        "desktop-create-agent-native-channels",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");
    let body = serde_json::json!({
        "name": "Native channel agent",
        "role": "channel test",
        "channels": [
            {"id": "desktop", "label": "桌面", "enabled": true},
            {"id": "ddingtalk", "label": "钉钉", "enabled": false},
            {
                "id": "feishu",
                "label": "Stale label",
                "enabled": true,
                "config": {
                    "accountId": " team-a ",
                    "fields": [
                        {"id": "appId", "label": "old", "secret": false, "value": " cli_a "},
                        {"id": "extra", "label": "Extra", "secret": false, "value": " keep "}
                    ]
                }
            },
            {"id": "esp32", "label": "ESP32", "enabled": false},
            {"id": "qqbot", "label": "QQ Bot", "enabled": false},
            {"id": "weixin", "label": "微信", "enabled": false}
        ]
    })
    .to_string();

    let (status, body) = request(
        server.addr,
        &format!(
            "POST /api/desktop/agents HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("desktop state json");
    let channels = json["agentWorkspace"]["agents"][0]["channels"]
        .as_array()
        .expect("agent channels");
    let ids = channels
        .iter()
        .map(|channel| channel["id"].as_str().expect("channel id"))
        .collect::<Vec<_>>();
    assert_eq!(
        ids,
        vec!["desktop", "ddingtalk", "feishu", "esp32", "qqbot", "weixin"]
    );
    let feishu = channels
        .iter()
        .find(|channel| channel["id"] == "feishu")
        .expect("feishu channel");
    assert_eq!(feishu["label"], "飞书");
    assert_eq!(feishu["config"]["accountId"], "team-a");
    let feishu_fields = feishu["config"]["fields"]
        .as_array()
        .expect("feishu fields");
    assert_eq!(
        feishu_fields
            .iter()
            .map(|field| field["id"].as_str().expect("field id"))
            .collect::<Vec<_>>(),
        vec![
            "appId",
            "appSecret",
            "verificationToken",
            "encryptKey",
            "extra"
        ]
    );
    assert_eq!(feishu_fields[0]["label"], "App ID");
    assert_eq!(feishu_fields[0]["value"], "cli_a");
    assert_eq!(feishu_fields[1]["secret"], true);
    assert_eq!(feishu_fields[4]["value"], "keep");

    let esp32 = channels
        .iter()
        .find(|channel| channel["id"] == "esp32")
        .expect("esp32 channel");
    let esp32_fields = esp32["config"]["fields"].as_array().expect("esp32 fields");
    assert_eq!(
        esp32_fields
            .iter()
            .map(|field| field["id"].as_str().expect("field id"))
            .collect::<Vec<_>>(),
        vec![
            "brokerMode",
            "bindHost",
            "advertisedHost",
            "port",
            "udpPort",
            "otaPath",
            "wakeWord"
        ]
    );
    assert_eq!(esp32_fields[4]["value"], "1884");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_custom_plugin_skill_persists_through_rust_plugin_host() {
    let runtime_layout = create_runtime_fixture(
        "desktop-custom-plugin-skill",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"name":"Triage","trigger":"@triage","description":"Sort local work"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/plugins/skills HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert!(json["pluginsWorkspace"]["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .any(|skill| skill["trigger"].as_str() == Some("@triage")));

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert!(json["desktopState"]["pluginsWorkspace"]["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .any(|skill| skill["trigger"].as_str() == Some("@triage")));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_rejects_unknown_desktop_mutation_without_running_node_bridge() {
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: create_runtime_fixture(
            "desktop-unsupported",
            r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
        ),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"enabled":true}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/config/reload HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 404);
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_agent_mutations_persist_through_rust_runtime_store() {
    let runtime_layout = create_runtime_fixture(
        "desktop-agent-store",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let create_body = r#"{"name":"Planner","role":"Planning agent","description":"first draft"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/agents HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            create_body.len(),
            create_body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("create state json");
    let agent_id = json["agentWorkspace"]["selectedAgentId"]
        .as_str()
        .expect("created agent id");

    let update_body =
        r#"{"name":"Planner Prime","role":"Runtime planner","description":"persisted update"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/agents/{agent_id} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            update_body.len(),
            update_body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    let agent = json["desktopState"]["agentWorkspace"]["agents"]
        .as_array()
        .expect("agents")
        .iter()
        .find(|agent| agent["id"].as_str() == Some(agent_id))
        .expect("persisted agent");
    assert_eq!(
        json["desktopState"]["agentWorkspace"]["selectedAgentId"],
        agent_id
    );
    assert_eq!(agent["name"], "Planner Prime");
    assert_eq!(agent["role"], "Runtime planner");
    assert_eq!(agent["description"], "persisted update");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_agent_skill_mutations_persist_through_rust_runtime_store() {
    let runtime_layout = create_runtime_fixture(
        "desktop-agent-skill-store",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let create_body = r#"{"name":"Planner","role":"Planning agent"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/agents HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            create_body.len(),
            create_body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("create state json");
    let agent_id = json["agentWorkspace"]["selectedAgentId"]
        .as_str()
        .expect("created agent id");

    let skill_body = r#"{"name":"Review","trigger":"@review","description":"Review local work"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/agents/{agent_id}/skills HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            skill_body.len(),
            skill_body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("skill state json");
    let skill_id = json["agentWorkspace"]["agents"][0]["skills"][0]["id"]
        .as_str()
        .expect("skill id")
        .to_string();
    assert_eq!(
        json["agentWorkspace"]["agents"][0]["skills"][0]["trigger"],
        "@review"
    );

    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/agents/{agent_id}/skills/{skill_id}/toggle HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
        ),
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("toggle state json");
    assert_eq!(
        json["agentWorkspace"]["agents"][0]["skills"][0]["enabled"],
        false
    );

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    let persisted_skill = &json["desktopState"]["agentWorkspace"]["agents"][0]["skills"][0];
    assert_eq!(persisted_skill["trigger"], "@review");
    assert_eq!(persisted_skill["enabled"], false);
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_preferences_persist_through_rust_runtime_store() {
    let runtime_layout = create_runtime_fixture(
        "desktop-preferences-store",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body =
        r#"{"selectedModel":"ollama/local","selectedThinking":"low","permissionMode":"只读模式"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert_eq!(
        json["desktopState"]["preferences"]["selectedModel"],
        "ollama/local"
    );
    assert_eq!(
        json["desktopState"]["preferences"]["selectedThinking"],
        "low"
    );
    assert_eq!(
        json["desktopState"]["preferences"]["permissionMode"],
        "只读模式"
    );
    assert!(json["desktopState"]["preferences"]["providerDescriptors"]
        .as_array()
        .expect("provider descriptors")
        .iter()
        .any(|entry| entry["provider"] == "openai" && entry["transport"] == "openai-responses"));
    assert!(json["desktopState"]["preferences"]["providerSetupOptions"]
        .as_array()
        .expect("provider setup options")
        .iter()
        .any(|entry| entry["provider"] == "openai" && entry["value"] == "openai-api-key"));
    assert!(
        json["desktopState"]["preferences"]["providerModelPickerEntries"]
            .as_array()
            .expect("provider model picker entries")
            .iter()
            .any(|entry| entry["provider"] == "ollama"
                && entry["value"] == "provider-plugin:ollama:local")
    );
    assert!(json["desktopState"]["preferences"]["webProviderBoundaries"]
        .as_array()
        .expect("web provider boundaries")
        .iter()
        .any(|entry| entry["surface"] == "web-search"
            && entry["provider"] == "searxng"
            && entry["productBoundary"] == "rust-native-plugin"
            && entry["executionRuntime"] == "python-sidecar"
            && entry["runtimeMajor"].is_null()));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_expanded_preferences_persist_through_rust_runtime_store() {
    let runtime_layout = create_runtime_fixture(
        "desktop-expanded-preferences-store",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{
      "taskDefaults":{"selectedModel":"ollama/local","selectedThinking":"low","permissionMode":"只读模式","responseSpeed":"更快","allowTools":false,"showReasoningSummary":true},
      "confirmationDefaults":{"confirmFileChanges":false,"confirmCommands":false,"confirmExternalApps":true,"confirmHighRisk":true},
      "notificationDefaults":{"notifyTaskDone":true,"notifyConfirmNeeded":true,"notifyDreamDone":false,"notifyAutomationFailed":true,"notificationSound":true},
      "uiDefaults":{"defaultPage":"记忆","language":"中文","appearance":"深色","launchAtLogin":true,"showInMenuBar":false},
      "memoryDefaults":{"rememberPreferences":true,"rememberProjectContext":false,"memoryDreamEnabled":true,"memoryDreamFrequency":"每天","memoryCleanupConfirmation":"仅重要记忆"},
      "privacyDefaults":{"dataLocation":"本机默认位置"},
      "advancedDefaults":{"logLevel":"详细"}
    }"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    let preferences = &json["desktopState"]["preferences"];
    assert_eq!(preferences["selectedModel"], "ollama/local");
    assert_eq!(preferences["selectedThinking"], "low");
    assert_eq!(preferences["permissionMode"], "只读模式");
    assert_eq!(preferences["taskDefaults"]["selectedModel"], "ollama/local");
    assert_eq!(preferences["taskDefaults"]["selectedThinking"], "low");
    assert_eq!(preferences["taskDefaults"]["permissionMode"], "只读模式");
    assert_eq!(preferences["taskDefaults"]["allowTools"], false);
    assert_eq!(
        preferences["confirmationDefaults"]["confirmCommands"],
        false
    );
    assert_eq!(
        preferences["notificationDefaults"]["notificationSound"],
        true
    );
    assert_eq!(preferences["uiDefaults"]["defaultPage"], "记忆");
    assert_eq!(
        preferences["memoryDefaults"]["memoryDreamFrequency"],
        "每天"
    );
    assert_eq!(
        preferences["privacyDefaults"]["dataLocation"],
        "本机默认位置"
    );
    assert_eq!(preferences["advancedDefaults"]["logLevel"], "详细");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_send_message_is_rust_backed_and_streams_session_events() {
    let runtime_layout = create_runtime_fixture(
        "desktop-send-message",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url =
        spawn_openai_compatible_provider("hello from desktop", "provider says hello").await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let mut events = tokio::net::TcpStream::connect(server.addr)
        .await
        .expect("connect events");
    events
        .write_all(
            b"GET /api/desktop/events?sessionToken=session HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
        )
        .await
        .expect("write events request");
    let _ = read_stream_until(&mut events, "event: runtime").await;

    let body = r#"{"text":"hello from desktop"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert!(json["conversation"]["resultItems"]
        .as_array()
        .expect("result items")
        .iter()
        .any(|item| item.as_str() == Some("provider says hello")));
    let messages = json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages");
    assert!(messages
        .iter()
        .any(|message| message["kind"] == "user" && message["text"] == "hello from desktop"));
    assert!(messages.iter().any(|message| {
        message["kind"] == "assistant" && message["text"] == "provider says hello"
    }));
    let thread_id = json["sidebar"]["threads"][0]["id"]
        .as_str()
        .expect("thread id");
    let transcript = fs::read_to_string(
        runtime_layout
            .runtime_root
            .join("sessions")
            .join(format!("{thread_id}.jsonl")),
    )
    .expect("transcript should be persisted");
    assert!(transcript.contains(r#""role":"user""#));
    assert!(transcript.contains(r#""content":"hello from desktop""#));
    assert!(transcript.contains(r#""role":"assistant""#));
    assert!(transcript.contains(r#""content":"provider says hello""#));

    let events = read_stream_until(&mut events, "event: stateChanged").await;
    assert!(events.contains("event: sessionStarted"));
    assert!(events.contains("event: messageDelta"));
    assert!(events.contains("event: messageFinal"));
    assert!(events.contains("event: stateChanged"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_session_subagent_routes_are_rust_backed() {
    let runtime_layout = create_runtime_fixture(
        "desktop-session-subagents",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let spawn_body =
        r#"{"task":"inspect Rust gateway","label":"gateway worker","parentSessionKey":"main"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/sessions/spawn HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            spawn_body.len(),
            spawn_body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let spawned: serde_json::Value = serde_json::from_str(&body).expect("spawn json");
    let child_key = spawned["session"]["key"]
        .as_str()
        .expect("child key")
        .to_string();
    assert_eq!(spawned["session"]["spawnedBy"], "main");

    let send_body = format!(
        r#"{{"sessionKey":{},"message":"follow up"}}"#,
        serde_json::to_string(&child_key).expect("child key json")
    );
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/sessions/send HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            send_body.len(),
            send_body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let yield_body = format!(
        r#"{{"sessionKey":{}}}"#,
        serde_json::to_string(&child_key).expect("child key json")
    );
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/sessions/yield HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            yield_body.len(),
            yield_body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let yielded: serde_json::Value = serde_json::from_str(&body).expect("yield json");
    assert_eq!(yielded["session"]["yielded"], true);

    let (status, body) = request(
        server.addr,
        format!(
            "GET /api/desktop/sessions/{}/history HTTP/1.1\r\nHost: 127.0.0.1\r\nx-crawclaw-desktop-session: session\r\nConnection: close\r\n\r\n",
            child_key
        ),
    )
    .await;
    assert_eq!(status, 200);
    let history: serde_json::Value = serde_json::from_str(&body).expect("history json");
    assert!(history["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["content"] == "follow up"));

    let (status, body) = request(
        server.addr,
        "GET /api/desktop/subagents?parentSessionKey=main HTTP/1.1\r\nHost: 127.0.0.1\r\nx-crawclaw-desktop-session: session\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let subagents: serde_json::Value = serde_json::from_str(&body).expect("subagents json");
    assert_eq!(subagents["subagents"][0]["title"], "gateway worker");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_bootstrap_reads_persisted_rust_session_transcripts() {
    let runtime_layout = create_runtime_fixture(
        "desktop-session-transcript-read-model",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url =
        spawn_openai_compatible_provider("remember this session", "persisted assistant reply")
            .await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"text":"remember this session"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    let thread_id = json["sidebar"]["threads"][0]["id"]
        .as_str()
        .expect("thread id");

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert_eq!(
        json["desktopState"]["sidebar"]["threads"][0]["id"],
        thread_id
    );
    assert_eq!(
        json["desktopState"]["sidebar"]["threads"][0]["title"],
        "remember this session"
    );
    assert_eq!(
        json["desktopState"]["conversation"]["resultItems"][0],
        "用户: remember this session"
    );
    assert_eq!(
        json["desktopState"]["conversation"]["resultItems"][1],
        "persisted assistant reply"
    );
    assert_eq!(
        json["desktopState"]["conversation"]["messages"][0]["kind"],
        "user"
    );
    assert_eq!(
        json["desktopState"]["conversation"]["messages"][0]["text"],
        "remember this session"
    );
    assert_eq!(
        json["desktopState"]["conversation"]["messages"][1]["kind"],
        "assistant"
    );
    assert_eq!(
        json["desktopState"]["conversation"]["messages"][1]["text"],
        "persisted assistant reply"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_thread_metadata_persists_through_rust_session_store() {
    let runtime_layout = create_runtime_fixture(
        "desktop-session-thread-metadata",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url =
        spawn_openai_compatible_provider("thread metadata", "metadata reply").await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"text":"thread metadata"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    let thread_id = json["sidebar"]["threads"][0]["id"]
        .as_str()
        .expect("thread id");

    let rename_body = r#"{"title":"Renamed Rust session"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/threads/{thread_id}/rename HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            rename_body.len(),
            rename_body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/threads/{thread_id}/pin HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}",
        ),
    )
    .await;
    assert_eq!(status, 200);

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert_eq!(
        json["desktopState"]["sidebar"]["pinnedThreads"][0]["id"],
        thread_id
    );
    assert_eq!(
        json["desktopState"]["sidebar"]["pinnedThreads"][0]["title"],
        "Renamed Rust session"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_select_thread_loads_persisted_rust_session_transcript() {
    let runtime_layout = create_runtime_fixture(
        "desktop-session-select-read-model",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_session_transcript(&runtime_layout, "thread-a", "first user", "first assistant");
    write_session_transcript(
        &runtime_layout,
        "thread-b",
        "second user",
        "second assistant",
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"threadId":"thread-b"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/threads/select HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert_eq!(json["sidebar"]["threads"][1]["id"], "thread-b");
    assert_eq!(json["sidebar"]["threads"][1]["active"], true);
    assert_eq!(json["conversation"]["resultItems"][0], "用户: second user");
    assert_eq!(json["conversation"]["resultItems"][1], "second assistant");
    assert_eq!(json["conversation"]["messages"][0]["kind"], "user");
    assert_eq!(json["conversation"]["messages"][0]["text"], "second user");
    assert_eq!(json["conversation"]["messages"][1]["kind"], "assistant");
    assert_eq!(
        json["conversation"]["messages"][1]["text"],
        "second assistant"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_archive_active_thread_selects_next_persisted_session() {
    let runtime_layout = create_runtime_fixture(
        "desktop-session-archive-select-next",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_session_transcript(&runtime_layout, "thread-a", "first user", "first assistant");
    write_session_transcript(
        &runtime_layout,
        "thread-b",
        "second user",
        "second assistant",
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, body) = request(
        server.addr,
        "POST /api/desktop/threads/thread-a/archive HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert_eq!(
        json["sidebar"]["threads"]
            .as_array()
            .expect("threads")
            .len(),
        1
    );
    assert_eq!(json["sidebar"]["threads"][0]["id"], "thread-b");
    assert_eq!(json["sidebar"]["threads"][0]["active"], true);
    assert_eq!(json["conversation"]["resultItems"][0], "用户: second user");
    assert_eq!(json["conversation"]["resultItems"][1], "second assistant");
    assert_eq!(json["conversation"]["messages"][0]["kind"], "user");
    assert_eq!(json["conversation"]["messages"][0]["text"], "second user");
    assert_eq!(json["conversation"]["messages"][1]["kind"], "assistant");
    assert_eq!(
        json["conversation"]["messages"][1]["text"],
        "second assistant"
    );

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert_eq!(
        json["desktopState"]["sidebar"]["threads"][0]["id"],
        "thread-b"
    );
    assert_eq!(
        json["desktopState"]["conversation"]["resultItems"][0],
        "用户: second user"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_pin_active_thread_keeps_it_active() {
    let runtime_layout = create_runtime_fixture(
        "desktop-session-pin-active",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_session_transcript(&runtime_layout, "thread-a", "first user", "first assistant");
    write_session_transcript(
        &runtime_layout,
        "thread-b",
        "second user",
        "second assistant",
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, body) = request(
        server.addr,
        "POST /api/desktop/threads/thread-a/pin HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert_eq!(json["sidebar"]["pinnedThreads"][0]["id"], "thread-a");
    assert_eq!(json["sidebar"]["pinnedThreads"][0]["active"], true);
    assert_eq!(json["conversation"]["resultItems"][0], "用户: first user");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_send_message_provider_failure_returns_typed_failure() {
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: create_runtime_fixture(
            "desktop-send-message-no-provider",
            r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
        ),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let mut events = tokio::net::TcpStream::connect(server.addr)
        .await
        .expect("connect events");
    events
        .write_all(
            b"GET /api/desktop/events?sessionToken=session HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
        )
        .await
        .expect("write events request");
    let _ = read_stream_until(&mut events, "event: runtime").await;

    let body = r#"{"text":"hello from desktop"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 503);
    let (status, body) = request(
        server.addr,
        "GET /api/desktop/state HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages")
        .iter()
        .any(|message| message["kind"] == "error" && message["code"] == "provider_unavailable"));
    let events = read_stream_until(&mut events, "event: operationFailed").await;
    assert!(events.contains("event: operationFailed"));
    assert!(events.contains("provider_unavailable"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_abort_and_steer_without_active_message_return_typed_failure() {
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: create_runtime_fixture(
            "desktop-session-control",
            r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
        ),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let mut events = tokio::net::TcpStream::connect(server.addr)
        .await
        .expect("connect events");
    events
        .write_all(
            b"GET /api/desktop/events?sessionToken=session HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
        )
        .await
        .expect("write events request");
    let _ = read_stream_until(&mut events, "event: runtime").await;

    let (status, _) = request(
        server.addr,
        "POST /api/desktop/messages/abort HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
    )
    .await;
    assert_eq!(status, 409);
    let abort_events = read_stream_until(&mut events, "event: operationFailed").await;
    assert!(abort_events.contains("no_active_message"));

    let body = r#"{"text":"prefer shorter"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/messages/steer HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;
    assert_eq!(status, 409);
    let steer_events = read_stream_until(&mut events, "event: operationFailed").await;
    assert!(steer_events.contains("no_active_message"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_memory_mutations_persist_through_rust_runtime_store() {
    let runtime_layout = create_runtime_fixture(
        "desktop-memory-store",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let create_body = r#"{"agentId":"agent-alpha","title":"Persisted fact","summary":"initial summary","content":"remember this","category":"Project","tags":["desktop"],"source":"Desktop test"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/memory/items HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            create_body.len(),
            create_body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("create state json");
    let item_id = json["memoryWorkspace"]["selectedItemId"]
        .as_str()
        .expect("created memory item id");

    let update_body = r#"{"summary":"updated summary","content":"remember this after update"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/memory/items/{item_id} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            update_body.len(),
            update_body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/memory/items/{item_id}/archive HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}",
        ),
    )
    .await;
    assert_eq!(status, 200);

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");
    let (status, body) = request(
        restarted_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    let item = json["desktopState"]["memoryWorkspace"]["items"]
        .as_array()
        .expect("memory items")
        .iter()
        .find(|item| item["id"].as_str() == Some(item_id))
        .expect("persisted memory item");
    assert_eq!(item["agentId"], "agent-alpha");
    assert_eq!(item["title"], "Persisted fact");
    assert_eq!(item["summary"], "updated summary");
    assert_eq!(item["content"], "remember this after update");
    assert_eq!(item["archived"], true);
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_memory_dream_run_is_rust_backed_and_emits_state() {
    let runtime_layout = create_runtime_fixture(
        "desktop-memory-dream",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let create_body = r#"{"name":"Memory Agent","role":"Memory"}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/agents HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            create_body.len(),
            create_body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("create state json");
    let agent_id = json["agentWorkspace"]["selectedAgentId"]
        .as_str()
        .expect("agent id");
    let provider_base_url = spawn_openai_compatible_provider(
        &format!("Run memory dream for agent {agent_id}"),
        "desktop dream complete",
    )
    .await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);

    let mut events = tokio::net::TcpStream::connect(server.addr)
        .await
        .expect("connect events");
    events
        .write_all(
            b"GET /api/desktop/events?sessionToken=session HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
        )
        .await
        .expect("write events request");
    let _ = read_stream_until(&mut events, "event: runtime").await;

    let body = format!(r#"{{"agentId":"{agent_id}"}}"#);
    let (status, response_body) = request(
        server.addr,
        format!(
            "POST /api/desktop/memory/dream/run HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&response_body).expect("dream state json");
    assert_eq!(json["activeNavId"], "memory");
    assert_eq!(json["memoryWorkspace"]["dream"]["status"], "completed");
    assert_eq!(json["memoryWorkspace"]["dream"]["agentId"], agent_id);
    assert!(json["memoryWorkspace"]["dream"]["message"]
        .as_str()
        .expect("dream message")
        .contains("Memory Agent"));

    let events = read_stream_until(&mut events, "event: stateChanged").await;
    assert!(events.contains("event: stateChanged"));
}

async fn request(addr: SocketAddr, request: impl Into<String>) -> (u16, String) {
    let request = request.into();
    let mut stream = tokio::net::TcpStream::connect(addr)
        .await
        .expect("connect gateway");
    stream
        .write_all(request.as_bytes())
        .await
        .expect("write request");

    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        match tokio::time::timeout(TEST_HTTP_READ_TIMEOUT, stream.read(&mut buffer)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(count)) => {
                bytes.extend_from_slice(&buffer[..count]);
                if is_complete_http_response(&bytes) {
                    break;
                }
            }
            Ok(Err(error)) => panic!("read response: {error}"),
            Err(_) if !bytes.is_empty() => break,
            Err(_) => panic!("read response: timed out"),
        }
    }

    let response = String::from_utf8(bytes).expect("utf8 response");

    let status = response
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .expect("response status");
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.to_string())
        .unwrap_or_default();
    (status, body)
}

async fn request_stream_prefix(addr: SocketAddr, request: impl Into<String>) -> String {
    let request = request.into();
    let mut stream = tokio::net::TcpStream::connect(addr)
        .await
        .expect("connect gateway");
    stream
        .write_all(request.as_bytes())
        .await
        .expect("write request");

    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        match tokio::time::timeout(TEST_HTTP_READ_TIMEOUT, stream.read(&mut buffer)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(count)) => {
                bytes.extend_from_slice(&buffer[..count]);
                let response = String::from_utf8_lossy(&bytes);
                if response.contains("event: runtime") {
                    return response
                        .split_once("\r\n\r\n")
                        .map(|(_, body)| body.to_string())
                        .unwrap_or_else(|| response.to_string());
                }
            }
            Ok(Err(error)) => panic!("read response: {error}"),
            Err(_) if !bytes.is_empty() => break,
            Err(_) => panic!("read response: timed out"),
        }
    }

    String::from_utf8(bytes).expect("utf8 response")
}

async fn read_stream_until(stream: &mut tokio::net::TcpStream, pattern: &str) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        match tokio::time::timeout(TEST_HTTP_READ_TIMEOUT, stream.read(&mut buffer)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(count)) => {
                bytes.extend_from_slice(&buffer[..count]);
                let response = String::from_utf8_lossy(&bytes);
                if response.contains(pattern) {
                    return response.to_string();
                }
            }
            Ok(Err(error)) => panic!("read stream: {error}"),
            Err(_) if !bytes.is_empty() => break,
            Err(_) => panic!("read stream: timed out waiting for {pattern}"),
        }
    }

    String::from_utf8(bytes).expect("utf8 stream")
}

fn is_complete_http_response(bytes: &[u8]) -> bool {
    let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    let header = String::from_utf8_lossy(&bytes[..header_end]);
    let Some(content_length) = header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            value.trim().parse::<usize>().ok()
        } else {
            None
        }
    }) else {
        return false;
    };

    bytes.len() >= header_end + 4 + content_length
}

#[cfg(unix)]
fn is_complete_http_request(bytes: &[u8]) -> bool {
    let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    let header = String::from_utf8_lossy(&bytes[..header_end]);
    if header.lines().any(|line| {
        let Some((name, value)) = line.split_once(':') else {
            return false;
        };
        name.eq_ignore_ascii_case("transfer-encoding")
            && value
                .split(',')
                .any(|encoding| encoding.trim().eq_ignore_ascii_case("chunked"))
    }) {
        return bytes[header_end + 4..]
            .windows(5)
            .any(|window| window == b"0\r\n\r\n");
    }
    let Some(content_length) = header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            value.trim().parse::<usize>().ok()
        } else {
            None
        }
    }) else {
        return true;
    };

    bytes.len() >= header_end + 4 + content_length
}

#[cfg(unix)]
async fn spawn_openai_compatible_provider(expected_text: &str, response_text: &str) -> String {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind provider");
    let addr = listener.local_addr().expect("provider addr");
    let expected_text = expected_text.to_string();
    let response_text = response_text.to_string();
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept provider request");
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = stream
                .read(&mut buffer)
                .await
                .expect("read provider request");
            assert_ne!(count, 0, "provider request closed early");
            bytes.extend_from_slice(&buffer[..count]);
            if is_complete_http_request(&bytes) {
                break;
            }
        }
        let request = String::from_utf8_lossy(&bytes);
        assert!(request.starts_with("POST /v1/chat/completions "));
        assert!(request.contains(&format!(r#""content":"{expected_text}""#)));
        assert!(request
            .to_lowercase()
            .contains("authorization: bearer test-key"));

        let body = format!(
            r#"{{"choices":[{{"message":{{"content":{}}}}}]}}"#,
            serde_json::to_string(&response_text).expect("response text json")
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write provider response");
    });

    format!("http://{addr}/v1")
}

#[cfg(unix)]
async fn spawn_searxng_provider() -> String {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind searxng provider");
    let addr = listener.local_addr().expect("searxng addr");
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept searxng request");
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        let count = stream
            .read(&mut buffer)
            .await
            .expect("read searxng request");
        assert_ne!(count, 0, "searxng request closed early");
        bytes.extend_from_slice(&buffer[..count]);
        let request = String::from_utf8_lossy(&bytes);
        assert!(request.starts_with("GET /open/search?"));
        assert!(request.contains("q=rust+native"));
        assert!(request.contains("format=json"));
        assert!(request.contains("engines=bing"));

        let body = r#"{"results":[{"title":"SearXNG Result","url":"https://example.com/open","content":"Desktop runtime SearXNG search","engine":"bing"}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write searxng response");
    });

    format!("http://{addr}/open")
}

#[cfg(unix)]
fn write_openai_compatible_provider_config(layout: &RuntimeLayout, base_url: &str) {
    let config_dir = layout.runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("runtime config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        format!(
            r#"{{
  "runtime": "native-provider",
  "provider": "openai-compatible",
  "baseUrl": "{}",
  "apiKey": "test-key",
  "model": "test-model"
}}
"#,
            base_url
        ),
    )
    .expect("provider config");
}

#[cfg(unix)]
fn write_session_transcript(layout: &RuntimeLayout, thread_id: &str, user: &str, assistant: &str) {
    let sessions_dir = layout.runtime_root.join("sessions");
    fs::create_dir_all(&sessions_dir).expect("sessions dir");
    let transcript = format!(
        "{}\n{}\n",
        serde_json::json!({ "role": "user", "content": user }),
        serde_json::json!({ "role": "assistant", "content": assistant })
    );
    fs::write(sessions_dir.join(format!("{thread_id}.jsonl")), transcript)
        .expect("session transcript");
}

#[cfg(unix)]
fn write_plugin_manifest(layout: &RuntimeLayout) {
    let plugins_dir = layout.runtime_root.join("plugins");
    fs::create_dir_all(&plugins_dir).expect("plugins dir");
    fs::write(
        plugins_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "tools": [
                {
                    "id": "plugin-tool-files",
                    "name": "File tools",
                    "description": "Read local workspace files.",
                    "status": "available",
                    "permission": "workspace",
                    "icon": "fileText"
                }
            ],
            "skills": [
                {
                    "id": "plugin-skill-review",
                    "name": "Review",
                    "trigger": "@review",
                    "description": "Review local changes.",
                    "status": "enabled",
                    "source": "plugin",
                    "icon": "sparkles"
                }
            ]
        }))
        .expect("plugin manifest json"),
    )
    .expect("plugin manifest");
}

fn missing_runtime_layout() -> RuntimeLayout {
    RuntimeLayout {
        runtime_root: "/runtime/crawclaw".into(),
        binary_path: "/runtime/crawclaw/bin/crawclaw-runtime".into(),
        channel_manifest_path: "/runtime/crawclaw/channels/manifest.json".into(),
        manifest_path: "/runtime/crawclaw/runtimes/manifest.json".into(),
    }
}

#[cfg(unix)]
fn create_runtime_fixture(name: &str, runtime_script: &str) -> RuntimeLayout {
    let layout = runtime_layout(temp_runtime_root(name));
    fs::create_dir_all(layout.binary_path.parent().expect("binary parent")).expect("bin dir");
    fs::create_dir_all(layout.manifest_path.parent().expect("manifest parent"))
        .expect("manifest dir");
    fs::create_dir_all(
        layout
            .channel_manifest_path
            .parent()
            .expect("channel manifest parent"),
    )
    .expect("channel manifest dir");
    fs::write(&layout.manifest_path, "{}\n").expect("manifest");
    fs::write(&layout.channel_manifest_path, "{}\n").expect("channel manifest");
    fs::write(&layout.binary_path, runtime_script).expect("runtime script");
    fs::write(layout.gateway_binary_path(), "#!/bin/sh\nexit 0\n").expect("gateway binary");
    fs::write(layout.native_plugins_binary_path(), "#!/bin/sh\nexit 0\n")
        .expect("native plugins binary");

    use std::os::unix::fs::PermissionsExt;
    for executable_path in [
        layout.binary_path.clone(),
        layout.gateway_binary_path(),
        layout.native_plugins_binary_path(),
    ] {
        let mut permissions = fs::metadata(&executable_path)
            .expect("runtime metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable_path, permissions).expect("runtime chmod");
    }

    layout
}

#[cfg(unix)]
fn runtime_layout(runtime_root: PathBuf) -> RuntimeLayout {
    RuntimeLayout {
        binary_path: runtime_root.join("bin").join(if cfg!(windows) {
            "crawclaw-runtime.exe"
        } else {
            "crawclaw-runtime"
        }),
        channel_manifest_path: runtime_root.join("channels").join("manifest.json"),
        manifest_path: runtime_root.join("runtimes").join("manifest.json"),
        runtime_root,
    }
}

#[cfg(unix)]
fn temp_runtime_root(name: &str) -> PathBuf {
    Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("gateway-desktop-api")
        .join(format!("{name}-{}", Uuid::new_v4().simple()))
}
