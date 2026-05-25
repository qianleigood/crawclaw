use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crawclaw_desktop::gateway::desktop_api::{
    is_loopback_addr, start_gateway_server, GatewayConfig,
};
use crawclaw_desktop::runtime_engine::RuntimeLayout;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const TEST_HTTP_READ_TIMEOUT: Duration = Duration::from_secs(30);
static ADVANCED_SETTINGS_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
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

    let (status, response_body) = request(
        server.addr,
        format!(
            "POST /api/desktop/navigation/select HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&response_body).expect("state json");
    assert_eq!(json["activeNavId"], "plugins");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_bootstrap_exposes_core_skills_without_optional_skills() {
    let runtime_layout = create_runtime_fixture(
        "desktop-core-skills-bootstrap",
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

    let (status, body) = request(
        server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    let skills = json["desktopState"]["pluginsWorkspace"]["skills"]
        .as_array()
        .expect("skills array");
    assert!(
        skills
            .iter()
            .any(|skill| skill["skillKey"] == "coding-agent"
                && skill["source"] == "core"
                && skill["enabled"] == true
                && skill["installStatus"] == "installed"),
        "expected bundled core coding-agent skill in plugin workspace: {skills:?}"
    );
    assert!(
        !skills
            .iter()
            .any(|skill| skill["skillKey"] == "suno-api-client"),
        "optional skills must not be exposed as core skills"
    );
    assert!(runtime_layout
        .runtime_root
        .join("skills/coding-agent/SKILL.md")
        .exists());
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_bootstrap_does_not_overwrite_user_skill_without_core_marker() {
    let runtime_layout = create_runtime_fixture(
        "desktop-core-skills-user-skill",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let skill_path = runtime_layout
        .runtime_root
        .join("skills/coding-agent/SKILL.md");
    fs::create_dir_all(skill_path.parent().expect("skill parent")).expect("skill dir");
    fs::write(
        &skill_path,
        "---\nname: user-coding-agent\ndescription: User owned skill.\n---\n\n# User Skill\n",
    )
    .expect("write user skill");
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
    assert!(
        fs::read_to_string(&skill_path)
            .expect("skill content")
            .contains("User owned skill."),
        "core sync must not overwrite a user-owned skill directory"
    );
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    let skills = json["desktopState"]["pluginsWorkspace"]["skills"]
        .as_array()
        .expect("skills array");
    let skill = skills
        .iter()
        .find(|skill| skill["skillKey"] == "coding-agent")
        .expect("coding-agent skill");
    assert_eq!(skill["source"], "custom");
    assert_eq!(skill["name"], "user-coding-agent");
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
    let tools = json["desktopState"]["pluginsWorkspace"]["tools"]
        .as_array()
        .expect("plugin tools");
    assert!(tools
        .iter()
        .any(|tool| { tool["pluginId"] == "crawclaw-runtime" && tool["id"] == "read" }));
    assert!(tools
        .iter()
        .any(|tool| { tool["pluginId"] == "crawclaw-runtime" && tool["id"] == "bash" }));
    assert!(tools
        .iter()
        .any(|tool| tool["pluginId"] == "browser" && tool["id"] == "browser"));
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

    let body =
        r#"{"confirmed":true,"input":{"action":"config","baseUrl":"http://127.0.0.1:8188"}}"#;
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
async fn gateway_structured_composer_messages_are_rust_backed() {
    let runtime_layout = create_runtime_fixture(
        "desktop-structured-composer-messages",
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

    let requests = [
        (
            "/api/desktop/messages/media",
            r#"{"mediaType":"image","title":"图片消息","items":[{"id":"image-1","label":"design.png","kind":"image","detail":"待上传"}]}"#,
        ),
        (
            "/api/desktop/messages/attachments",
            r#"{"title":"需求文档","fileName":"brief.pdf","mediaType":"application/pdf","detail":"PDF 附件"}"#,
        ),
        (
            "/api/desktop/messages/voice",
            r#"{"direction":"input","title":"语音输入","durationLabel":"00:03","transcript":"帮我整理这段话"}"#,
        ),
        (
            "/api/desktop/messages/workflows",
            r#"{"workflowKind":"n8n","title":"线索同步","status":"running","detail":"CRM 工作流","steps":[{"id":"webhook","label":"Webhook","status":"done"},{"id":"crm","label":"CRM","status":"active"}]}"#,
        ),
        (
            "/api/desktop/messages/skills",
            r#"{"skillId":"plugin-skill-review","title":"代码审查","status":"ready","detail":"@review"}"#,
        ),
    ];

    let mut response_body = String::new();
    for (path, body) in requests {
        let (status, body) = request(
            server.addr,
            format!(
                "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            ),
        )
        .await;
        assert_eq!(status, 200, "{path} should accept structured messages");
        response_body = body;
    }

    let json: serde_json::Value = serde_json::from_str(&response_body).expect("state json");
    let messages = json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages");
    let kinds = messages
        .iter()
        .map(|message| message["kind"].as_str().expect("message kind"))
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        vec!["media", "attachment", "voice", "workflow", "skillCall"]
    );
    assert_eq!(messages[0]["items"][0]["label"], "design.png");
    assert_eq!(messages[1]["fileName"], "brief.pdf");
    assert_eq!(messages[2]["transcript"], "帮我整理这段话");
    assert_eq!(messages[3]["workflowKind"], "n8n");
    assert_eq!(messages[4]["skillId"], "plugin-skill-review");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_structured_conversation_messages_persist_and_bootstrap_restore() {
    let runtime_layout = create_runtime_fixture(
        "desktop-structured-message-restore",
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

    let (status, body) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/attachments",
        r#"{"title":"需求文档","fileName":"brief.pdf","mediaType":"application/pdf","detail":"PDF 附件"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    let thread_id = json["sidebar"]["threads"][0]["id"]
        .as_str()
        .expect("thread id")
        .to_string();

    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/voice",
        r#"{"direction":"input","title":"语音输入","durationLabel":"00:03","transcript":"帮我整理这段话"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/workflows",
        r#"{"workflowKind":"schedule","title":"定时任务","status":"running","detail":"Cron 状态","steps":[{"id":"status","label":"Cron","status":"active"}]}"#,
    )
    .await;
    assert_eq!(status, 200);

    let transcript = fs::read_to_string(
        runtime_layout
            .runtime_root
            .join("sessions")
            .join(format!("{thread_id}.jsonl")),
    )
    .expect("structured transcript");
    assert!(transcript.contains(r#""desktopMessage""#));
    assert!(transcript.contains(r#""kind":"attachment""#));
    assert!(transcript.contains(r#""kind":"voice""#));
    assert!(transcript.contains(r#""kind":"workflow""#));

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("restarted gateway should start");

    let select_body = format!(r#"{{"threadId":"{thread_id}"}}"#);
    let (status, body) = post_desktop_json(
        restarted_server.addr,
        "/api/desktop/threads/select",
        &select_body,
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("selected thread json");
    let kinds = json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .map(|message| message["kind"].as_str().expect("message kind"))
        .collect::<Vec<_>>();
    assert_eq!(kinds, vec!["attachment", "voice", "workflow"]);
    assert_eq!(json["conversation"]["messages"][0]["fileName"], "brief.pdf");
    assert_eq!(
        json["conversation"]["messages"][1]["transcript"],
        "帮我整理这段话"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_attachment_asset_copies_file_and_rejects_traversal() {
    let runtime_layout = create_runtime_fixture(
        "desktop-attachment-assets",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let source_path = runtime_layout.runtime_root.join("input.txt");
    fs::write(&source_path, "desktop attachment body").expect("source attachment");
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = format!(
        r#"{{
          "title":"本地文件",
          "fileName":"input.txt",
          "mediaType":"text/plain",
          "confirm":true,
          "source":{{"kind":"tauriPath","path":{}}}
        }}"#,
        serde_json::to_string(&source_path.to_string_lossy()).expect("source path json")
    );
    let (status, response_body) =
        post_desktop_json(server.addr, "/api/desktop/messages/attachments", &body).await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&response_body).expect("state json");
    let message = json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .last()
        .expect("attachment message");
    assert_eq!(message["kind"], "attachment");
    assert_eq!(message["status"], "done");
    assert_eq!(message["sizeBytes"], 23);
    let asset_id = message["assetId"].as_str().expect("asset id");
    assert!(asset_id.starts_with("asset-"));
    let asset_path = runtime_layout
        .runtime_root
        .join("desktop")
        .join("assets")
        .join(format!("{asset_id}-input.txt"));
    assert_eq!(
        fs::read_to_string(asset_path).expect("copied asset"),
        "desktop attachment body"
    );
    let (status, body) = request(
        server.addr,
        format!(
            "GET /api/desktop/assets/{asset_id}/content HTTP/1.1\r\nHost: 127.0.0.1\r\nx-crawclaw-desktop-session: session\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body, "desktop attachment body");
    let (status, _) = request(
        server.addr,
        "GET /api/desktop/assets/asset-missing/content HTTP/1.1\r\nHost: 127.0.0.1\r\nx-crawclaw-desktop-session: session\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 404);
    let (status, _) =
        post_desktop_json(server.addr, "/api/desktop/assets/asset-..bad/reveal", "{}").await;
    assert_eq!(status, 400);
    let (status, _) =
        post_desktop_json(server.addr, "/api/desktop/assets/asset-missing/open", "{}").await;
    assert_eq!(status, 404);

    let (status, response_body) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/attachments",
        r#"{"title":"浏览器文件","fileName":"browser.txt","mediaType":"text/plain","confirm":true,"source":{"kind":"browserFile","dataBase64":"data:text/plain;base64,YnJvd3NlciBhdHRhY2htZW50"}}"#,
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&response_body).expect("state json");
    let message = json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .last()
        .expect("browser attachment message");
    assert_eq!(message["kind"], "attachment");
    assert_eq!(message["status"], "done");
    assert_eq!(message["sizeBytes"], 18);
    let asset_id = message["assetId"].as_str().expect("asset id");
    let asset_path = runtime_layout
        .runtime_root
        .join("desktop")
        .join("assets")
        .join(format!("{asset_id}-browser.txt"));
    assert_eq!(
        fs::read_to_string(asset_path).expect("copied browser asset"),
        "browser attachment"
    );

    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/attachments",
        r#"{"title":"bad","fileName":"../bad.txt","mediaType":"text/plain","source":{"kind":"browserFile","dataBase64":"YmFk"}}"#,
    )
    .await;
    assert_eq!(status, 400);
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_voice_message_records_audio_and_transcribes_when_provider_available() {
    let runtime_layout = create_runtime_fixture(
        "desktop-voice-transcription",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_media_provider(
        "POST /v1/audio/transcriptions",
        "voice-note.webm",
        r#"{"text":"转写后的桌面语音"}"#,
    )
    .await;
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = format!(
        r#"{{
          "direction":"input",
          "title":"语音输入",
          "durationLabel":"00:03",
          "source":{{"kind":"browserFile","fileName":"voice-note.webm","mimeType":"audio/webm","dataBase64":"data:audio/webm;base64,aGVsbG8="}},
          "providerConfig":{{"baseUrl":{},"apiKey":"test-key","model":"test-transcribe"}}
        }}"#,
        serde_json::to_string(&provider_base_url).expect("provider url json")
    );
    let (status, response_body) =
        post_desktop_json(server.addr, "/api/desktop/messages/voice", &body).await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&response_body).expect("state json");
    let message = json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .last()
        .expect("voice message");
    assert_eq!(message["kind"], "voice");
    assert_eq!(message["status"], "done");
    assert_eq!(message["transcript"], "转写后的桌面语音");
    assert_eq!(message["sizeBytes"], 5);
    let asset_id = message["assetId"].as_str().expect("asset id");
    assert!(runtime_layout
        .runtime_root
        .join("desktop")
        .join("assets")
        .join(format!("{asset_id}-voice-note.webm"))
        .exists());

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
    assert!(json["desktopState"]["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["kind"] == "voice" && message["transcript"] == "转写后的桌面语音"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_media_message_invokes_media_understanding_provider() {
    let runtime_layout = create_runtime_fixture(
        "desktop-media-understanding",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_media_provider(
        "POST /v1/responses",
        "data:image/png;base64,aW1hZ2U=",
        r#"{"output_text":"这是一张桌面测试图片"}"#,
    )
    .await;
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = format!(
        r#"{{
          "mediaType":"image",
          "title":"图片消息",
          "confirm":true,
          "items":[{{"id":"image-1","kind":"image","label":"test.png","detail":"image/png"}}],
          "source":{{"kind":"browserFile","fileName":"test.png","mimeType":"image/png","dataBase64":"data:image/png;base64,aW1hZ2U="}},
          "providerConfig":{{"baseUrl":{},"apiKey":"test-key","model":"test-vision"}}
        }}"#,
        serde_json::to_string(&provider_base_url).expect("provider url json")
    );
    let (status, response_body) =
        post_desktop_json(server.addr, "/api/desktop/messages/media", &body).await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&response_body).expect("state json");
    let message = json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .last()
        .expect("media message");
    assert_eq!(message["kind"], "media");
    assert_eq!(message["status"], "done");
    assert_eq!(message["items"][0]["status"], "done");
    assert_eq!(message["items"][0]["detail"], "这是一张桌面测试图片");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_permission_mode_blocks_high_risk_workflow_runs() {
    let runtime_layout = create_runtime_fixture(
        "desktop-permission-workflow-block",
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

    let preferences_body = r#"{"permissionMode":"只读模式"}"#;
    let (status, _) = request(
        server.addr,
        &format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            preferences_body.len(),
            preferences_body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/workflows",
        r#"{"workflowKind":"comfyui","action":"run","title":"ComfyUI 运行","input":{"prompt":{}}}"#,
    )
    .await;
    assert_eq!(status, 403);
    let (status, body) = request(
        server.addr,
        "GET /api/desktop/state HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["kind"] == "error" && message["code"] == "permission_denied"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_workflow_message_invokes_comfyui_cron_and_n8n_paths() {
    let runtime_layout = create_runtime_fixture(
        "desktop-workflow-message-runtime",
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

    let requests = [
        r#"{"workflowKind":"schedule","action":"cron.status","title":"Cron 状态"}"#,
        r#"{"workflowKind":"n8n","action":"list","title":"Workflow 列表","input":{"limit":5}}"#,
        r#"{"workflowKind":"comfyui","action":"status","title":"ComfyUI 状态","input":{"baseUrl":"http://127.0.0.1:8188"}}"#,
    ];
    let mut response_body = String::new();
    for body in requests {
        let (status, body) =
            post_desktop_json(server.addr, "/api/desktop/messages/workflows", body).await;
        assert_eq!(status, 200, "workflow request should be accepted: {body}");
        response_body = body;
    }

    let json: serde_json::Value = serde_json::from_str(&response_body).expect("state json");
    let messages = json["conversation"]["messages"]
        .as_array()
        .expect("messages");
    assert!(messages.iter().any(|message| {
        message["kind"] == "workflow"
            && message["workflowKind"] == "schedule"
            && message["detail"]
                .as_str()
                .unwrap_or_default()
                .contains("cron")
    }));
    assert!(messages.iter().any(|message| {
        message["kind"] == "workflow"
            && message["workflowKind"] == "n8n"
            && message["detail"]
                .as_str()
                .unwrap_or_default()
                .contains("Workflow")
    }));
    assert!(messages.iter().any(|message| {
        message["kind"] == "workflow"
            && message["workflowKind"] == "comfyui"
            && message["detail"]
                .as_str()
                .unwrap_or_default()
                .contains("comfyui")
    }));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_workflow_failure_respects_automation_failed_notifications() {
    let runtime_layout = create_runtime_fixture(
        "desktop-workflow-failure-notification",
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

    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/workflows",
        r#"{"workflowKind":"unsupported","title":"失败工作流","detail":"fallback"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let notification = read_last_notification(&runtime_layout);
    assert_eq!(notification["kind"], "automationFailed");
    assert_eq!(notification["title"], "工作流执行失败");
    assert!(notification["body"]
        .as_str()
        .expect("notification body")
        .contains("Unsupported workflow kind"));

    let preferences_body = r#"{"notificationDefaults":{"notifyAutomationFailed":false}}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            preferences_body.len(),
            preferences_body
        ),
    )
    .await;
    assert_eq!(status, 200);
    fs::remove_file(last_notification_path(&runtime_layout)).expect("remove notification");

    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/workflows",
        r#"{"workflowKind":"unsupported","title":"失败工作流","detail":"fallback"}"#,
    )
    .await;
    assert_eq!(status, 200);
    assert!(!last_notification_path(&runtime_layout).exists());
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_plugin_install_endpoint_reuses_gateway_install_and_refreshes_workspace() {
    let runtime_layout = create_runtime_fixture(
        "desktop-plugin-install-endpoint",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let source_root = temp_runtime_root("desktop-plugin-install-source");
    fs::create_dir_all(&source_root).expect("plugin source");
    fs::write(
        source_root.join("crawclaw.plugin.json"),
        r#"{"id":"desktop-demo","name":"Desktop Demo","version":"1.0.0"}"#,
    )
    .expect("manifest");
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");
    let body = serde_json::json!({
        "source": source_root.to_string_lossy()
    })
    .to_string();

    let (status, body) =
        post_desktop_json(server.addr, "/api/desktop/plugins/install", &body).await;

    assert_eq!(status, 200);
    assert!(runtime_layout
        .runtime_root
        .join("plugins/desktop-demo/crawclaw.plugin.json")
        .exists());
    let state: serde_json::Value = serde_json::from_str(&body).expect("desktop state");
    let installed = state["pluginsWorkspace"]["installed"]
        .as_array()
        .expect("installed plugins");
    assert!(
        installed.iter().any(|plugin| plugin["id"] == "desktop-demo"
            && plugin["name"] == "Desktop Demo"
            && plugin["installStatus"] == "installed"
            && plugin["enabled"] == true),
        "installed plugin should be reflected in desktop workspace: {installed:?}"
    );

    let disable_body = r#"{"enabled":false}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/plugins/desktop-demo/enabled HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            disable_body.len(),
            disable_body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let state: serde_json::Value = serde_json::from_str(&body).expect("desktop state");
    let installed = state["pluginsWorkspace"]["installed"]
        .as_array()
        .expect("installed plugins");
    assert!(
        installed
            .iter()
            .any(|plugin| plugin["id"] == "desktop-demo" && plugin["enabled"] == false),
        "disabled plugin should be reflected in desktop workspace: {installed:?}"
    );

    let (status, body) = post_desktop_json(
        server.addr,
        "/api/desktop/plugins/desktop-demo/uninstall",
        "{}",
    )
    .await;

    assert_eq!(status, 200);
    assert!(!runtime_layout
        .runtime_root
        .join("plugins/desktop-demo/crawclaw.plugin.json")
        .exists());
    let state: serde_json::Value = serde_json::from_str(&body).expect("desktop state");
    let installed = state["pluginsWorkspace"]["installed"]
        .as_array()
        .expect("installed plugins");
    assert!(
        !installed
            .iter()
            .any(|plugin| plugin["id"] == "desktop-demo"),
        "uninstalled plugin should be removed from desktop workspace: {installed:?}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_plugin_skill_install_writes_runtime_skill_and_config_entry() {
    let runtime_layout = create_runtime_fixture(
        "desktop-plugin-skill-install",
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
    let body = serde_json::json!({
        "name": "Desktop Skill",
        "trigger": "@desktop-skill",
        "description": "Installed from the desktop plugin dialog."
    })
    .to_string();

    let (status, body) = post_desktop_json(server.addr, "/api/desktop/plugins/skills", &body).await;

    assert_eq!(status, 200);
    let skill_path = runtime_layout
        .runtime_root
        .join("skills/desktop-skill/SKILL.md");
    assert!(
        skill_path.exists(),
        "desktop skill should write a runtime SKILL.md"
    );
    let config_path = runtime_layout.runtime_root.join("config/crawclaw.json");
    let config: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(config_path).expect("config"))
            .expect("config json");
    assert_eq!(
        config["skills"]["entries"]["desktop-skill"]["enabled"],
        true
    );
    let state: serde_json::Value = serde_json::from_str(&body).expect("desktop state");
    assert!(state["pluginsWorkspace"]["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .any(|skill| skill["skillKey"] == "desktop-skill"
            && skill["source"] == "custom"
            && skill["enabled"] == true
            && skill["installStatus"] == "installed"));

    let (status, body) = request(
        server.addr,
        "DELETE /api/desktop/plugins/skills/custom-skill-desktop-skill HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
    )
    .await;

    assert_eq!(status, 200);
    assert!(
        !skill_path.exists(),
        "desktop skill removal should delete the runtime SKILL.md"
    );
    let config: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(runtime_layout.runtime_root.join("config/crawclaw.json"))
            .expect("config"),
    )
    .expect("config json");
    assert_eq!(
        config["skills"]["entries"]["desktop-skill"],
        serde_json::Value::Null
    );
    let state: serde_json::Value = serde_json::from_str(&body).expect("desktop state");
    assert!(!state["pluginsWorkspace"]["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .any(|skill| skill["skillKey"] == "desktop-skill"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_preferences_model_options_and_settings_actions_persist() {
    let runtime_layout = create_runtime_fixture(
        "desktop-settings-actions",
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

    let preferences_body = r#"{"modelOptions":["gpt-5.5","MiniMax-M2.7-highspeed"],"selectedModel":"MiniMax-M2.7-highspeed"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            preferences_body.len(),
            preferences_body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let (status, body) =
        post_desktop_json(server.addr, "/api/desktop/settings/diagnostics", "{}").await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("diagnostics state");
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["kind"] == "status" && message["title"] == "诊断信息已生成"));

    let (status, body) =
        post_desktop_json(server.addr, "/api/desktop/settings/export-data", "{}").await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("export state");
    let export_detail = json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .last()
        .and_then(|message| message["detail"].as_str())
        .expect("export detail");
    let export_path = PathBuf::from(export_detail);
    assert!(export_path.is_file(), "export should create a file");

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
    let options = json["desktopState"]["preferences"]["modelOptions"]
        .as_array()
        .expect("model options");
    assert!(options
        .iter()
        .any(|option| option.as_str() == Some("MiniMax-M2.7-highspeed")));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_advanced_diagnostics_writes_sanitized_file_and_respects_log_level() {
    let _advanced_guard = ADVANCED_SETTINGS_TEST_LOCK.lock().await;
    let runtime_layout = create_runtime_fixture(
        "desktop-advanced-diagnostics",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready","detail":"runtime ready for diagnostics"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_privacy_runtime_fixture(&runtime_layout);
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"advancedDefaults":{"logLevel":"错误"}}"#;
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

    let rust_log_path = runtime_layout.runtime_root.join("desktop/logs/rust.log");
    let _ = fs::remove_file(&rust_log_path);
    let (status, body) =
        post_desktop_json(server.addr, "/api/desktop/settings/diagnostics", "{}").await;
    assert_eq!(status, 200);
    let state: serde_json::Value = serde_json::from_str(&body).expect("error diagnostics state");
    let suppressed_diagnostics_path = state["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .rev()
        .find(|message| message["kind"] == "status" && message["title"] == "诊断信息已生成")
        .and_then(|message| message["detail"].as_str())
        .expect("suppressed diagnostics path");
    let error_log = fs::read_to_string(&rust_log_path).unwrap_or_default();
    assert!(
        !error_log.contains(suppressed_diagnostics_path),
        "error log level should suppress its diagnostics event: {error_log}"
    );

    let body = r#"{"advancedDefaults":{"logLevel":"详细"}}"#;
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

    let (status, body) =
        post_desktop_json(server.addr, "/api/desktop/settings/diagnostics", "{}").await;
    assert_eq!(status, 200);
    let state: serde_json::Value = serde_json::from_str(&body).expect("diagnostics state");
    let diagnostics_path = state["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .rev()
        .find(|message| message["kind"] == "status" && message["title"] == "诊断信息已生成")
        .and_then(|message| message["detail"].as_str())
        .map(PathBuf::from)
        .expect("diagnostics path");
    assert!(
        diagnostics_path.is_file(),
        "diagnostics detail should point at generated file"
    );

    let diagnostics_text = fs::read_to_string(&diagnostics_path).expect("diagnostics file");
    let diagnostics: serde_json::Value =
        serde_json::from_str(&diagnostics_text).expect("diagnostics json");
    assert_eq!(diagnostics["runtime"]["status"], "ready");
    assert_eq!(
        diagnostics["runtimeRoot"],
        runtime_layout.runtime_root.to_string_lossy().as_ref()
    );
    assert_eq!(diagnostics["advanced"]["logLevel"], "详细");
    assert_eq!(diagnostics["advanced"]["rustLogFilter"], "debug");
    assert!(
        diagnostics["state"]["threads"]
            .as_u64()
            .expect("thread count")
            >= 1
    );
    assert!(diagnostics["state"]["agents"].is_number());
    assert_eq!(diagnostics["state"]["memoryItems"], 1);
    assert_eq!(diagnostics["state"]["workflows"], 1);
    assert_eq!(
        diagnostics["settingsEffects"]["runtimeLogLevel"]["value"],
        "详细"
    );
    assert!(diagnostics["recentRustLog"]
        .as_array()
        .expect("recent rust log")
        .iter()
        .any(|line| line
            .as_str()
            .is_some_and(|line| line.contains("desktop_diagnostics_generated"))));
    assert!(!diagnostics_text.contains("secret-token"));
    assert!(!diagnostics_text.contains("super-secret"));
    assert!(!diagnostics_text.contains("apiKey"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_advanced_reset_state_clears_ui_state_and_preserves_owned_data() {
    let _advanced_guard = ADVANCED_SETTINGS_TEST_LOCK.lock().await;
    let runtime_layout = create_runtime_fixture(
        "desktop-advanced-reset",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_privacy_runtime_fixture(&runtime_layout);
    write_text_fixture(&runtime_layout, "desktop/diagnostics/old.json", "{}");
    write_text_fixture(&runtime_layout, "desktop/logs/rust.log", "old log");
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"selectedModel":"reset-test-model","advancedDefaults":{"logLevel":"详细"}}"#;
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

    let (status, body) = post_desktop_json(
        server.addr,
        "/api/desktop/settings/reset-state",
        r#"{"confirm":"RESET"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let state: serde_json::Value = serde_json::from_str(&body).expect("reset state");
    assert_eq!(state["preferences"]["selectedModel"], "gpt-5.5");
    assert_eq!(state["preferences"]["advancedDefaults"]["logLevel"], "标准");
    assert_eq!(
        state["preferences"]["privacyDefaults"]["dataLocation"],
        runtime_layout.runtime_root.to_string_lossy().as_ref()
    );
    assert!(state["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .is_empty());
    assert!(state["sidebar"]["threads"]
        .as_array()
        .expect("threads")
        .is_empty());

    for path in [
        "sessions/privacy-thread.jsonl",
        "config/desktop-preferences.json",
        "desktop/diagnostics/old.json",
        "desktop/logs/rust.log",
    ] {
        assert!(
            !runtime_layout.runtime_root.join(path).exists(),
            "reset-state should remove {path}"
        );
    }
    let runtime_log_level = fs::read_to_string(
        runtime_layout
            .runtime_root
            .join("desktop/settings/runtime-log-level"),
    )
    .expect("default runtime log level");
    assert_eq!(runtime_log_level.trim(), "标准");
    for path in [
        "config/desktop-agent-provider.json",
        "config/desktop-model-profiles.json",
        "config/secrets/desktop-models/test.key",
        "memory/runtime.db",
        "memory/desktop-items.json",
        "workflows/privacy-flow.json",
    ] {
        assert!(
            runtime_layout.runtime_root.join(path).exists(),
            "reset-state should preserve {path}"
        );
    }

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
    let state: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert!(state["desktopState"]["sidebar"]["threads"]
        .as_array()
        .expect("threads")
        .is_empty());
    assert!(state["desktopState"]["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .is_empty());
    assert!(state["desktopState"]["preferences"]["modelProfiles"]
        .as_array()
        .expect("model profiles")
        .iter()
        .any(|profile| profile["modelRef"] == "openai-compatible/test-model"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_privacy_data_location_uses_runtime_root() {
    let runtime_layout = create_runtime_fixture(
        "desktop-privacy-data-location",
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

    let body = r#"{"privacyDefaults":{"dataLocation":"本机默认位置"}}"#;
    let (status, body) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert_eq!(
        json["preferences"]["privacyDefaults"]["dataLocation"],
        runtime_layout.runtime_root.to_string_lossy().as_ref()
    );

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
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
        json["desktopState"]["preferences"]["privacyDefaults"]["dataLocation"],
        runtime_layout.runtime_root.to_string_lossy().as_ref()
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_privacy_export_writes_sanitized_runtime_snapshot() {
    let runtime_layout = create_runtime_fixture(
        "desktop-privacy-export",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_privacy_runtime_fixture(&runtime_layout);
    fs::create_dir_all(runtime_layout.runtime_root.join("desktop/exports")).expect("exports dir");
    fs::write(
        runtime_layout
            .runtime_root
            .join("desktop/exports/old-export.json"),
        r#"{"old":true}"#,
    )
    .expect("old export");

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, body) =
        post_desktop_json(server.addr, "/api/desktop/settings/export-data", "{}").await;
    assert_eq!(status, 200);
    let state: serde_json::Value = serde_json::from_str(&body).expect("export state");
    let export_path = PathBuf::from(
        state["conversation"]["messages"]
            .as_array()
            .expect("messages")
            .last()
            .and_then(|message| message["detail"].as_str())
            .expect("export path"),
    );
    let raw = fs::read_to_string(export_path).expect("export json");
    assert!(
        !raw.contains("super-secret"),
        "export must not contain raw API keys"
    );
    assert!(
        !raw.contains("secret-token"),
        "export must not include secret file contents"
    );
    let export: serde_json::Value = serde_json::from_str(&raw).expect("export value");
    assert_eq!(
        export["state"]["preferences"]["privacyDefaults"]["dataLocation"],
        runtime_layout.runtime_root.to_string_lossy().as_ref()
    );
    assert_export_file(&export, "memory/runtime.db");
    assert_export_file(&export, "memory/desktop-items.json");
    assert_export_file(&export, "memory/durable/main/note.md");
    assert_export_file(&export, "memory/experience/outbox.json");
    assert_export_file(&export, "memory/session-summary/main.md");
    assert_export_file(&export, "workflows/privacy-flow.json");
    assert_export_file(&export, "desktop/notifications/policy.json");
    assert_export_file(&export, "config/desktop-agent-provider.json");
    assert_export_file(&export, "config/desktop-memory-policy.json");
    assert_export_file(&export, "config/desktop-model-profiles.json");
    assert_export_skipped(&export, "config/secrets/desktop-models/test.key", "secret");
    assert_export_skipped(&export, "desktop/exports/old-export.json", "export");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_settings_delete_and_reset_require_confirmation() {
    let runtime_layout = create_runtime_fixture(
        "desktop-settings-confirmation",
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

    for dir in ["cache", "downloads", "previews", "tmp"] {
        fs::create_dir_all(runtime_layout.runtime_root.join("desktop").join(dir))
            .expect("cache dir");
        fs::write(
            runtime_layout
                .runtime_root
                .join("desktop")
                .join(dir)
                .join("item.tmp"),
            dir,
        )
        .expect("cache file");
    }
    write_privacy_runtime_fixture(&runtime_layout);

    let (status, _) =
        post_desktop_json(server.addr, "/api/desktop/settings/delete-local-data", "{}").await;
    assert_eq!(status, 400);
    let (status, _) =
        post_desktop_json(server.addr, "/api/desktop/settings/reset-state", "{}").await;
    assert_eq!(status, 400);

    let (status, _) =
        post_desktop_json(server.addr, "/api/desktop/settings/clear-cache", "{}").await;
    assert_eq!(status, 200);
    for dir in ["cache", "downloads", "previews", "tmp"] {
        assert!(
            !runtime_layout
                .runtime_root
                .join("desktop")
                .join(dir)
                .join("item.tmp")
                .exists(),
            "clear-cache should remove {dir} files"
        );
    }
    assert!(
        runtime_layout
            .runtime_root
            .join("memory/runtime.db")
            .exists(),
        "clear-cache must not remove memory runtime data"
    );
    assert!(
        runtime_layout
            .runtime_root
            .join("config/desktop-model-profiles.json")
            .exists(),
        "clear-cache must not remove model profiles"
    );

    let (status, body) = post_desktop_json(
        server.addr,
        "/api/desktop/settings/delete-local-data",
        r#"{"confirm":"DELETE"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("delete state");
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .is_empty());
    for path in [
        "desktop/notifications/policy.json",
        "sessions/privacy-thread.jsonl",
        "workflows/privacy-flow.json",
        "agents/desktop-agents.json",
        "memory/runtime.db",
        "memory/desktop-items.json",
        "memory/durable/main/note.md",
        "memory/experience/outbox.json",
        "memory/session-summary/main.md",
        "config/desktop-preferences.json",
        "config/desktop-memory-policy.json",
        "config/desktop-agent-provider.json",
        "config/desktop-model-profiles.json",
    ] {
        assert!(
            !runtime_layout.runtime_root.join(path).exists(),
            "delete-local-data should remove {path}"
        );
    }
    assert!(
        runtime_layout
            .runtime_root
            .join("config/secrets/desktop-models/test.key")
            .exists(),
        "delete-local-data must preserve desktop API key secret files"
    );

    let restarted_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
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
        json["desktopState"]["preferences"]["privacyDefaults"]["dataLocation"],
        runtime_layout.runtime_root.to_string_lossy().as_ref()
    );
    assert!(json["desktopState"]["sidebar"]["threads"]
        .as_array()
        .expect("threads")
        .is_empty());
    assert!(json["desktopState"]["memoryWorkspace"]["items"]
        .as_array()
        .expect("memory items")
        .is_empty());
    assert!(json["desktopState"]["preferences"]["modelProfiles"]
        .as_array()
        .expect("model profiles")
        .is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_new_chat_clears_active_thread_without_deleting_history() {
    let runtime_layout = create_runtime_fixture(
        "desktop-new-chat-history",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_session_transcript(
        &runtime_layout,
        "thread-saved",
        "hello history",
        "saved reply",
    );
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, body) = post_desktop_json(
        server.addr,
        "/api/desktop/threads/select",
        r#"{"threadId":"thread-saved"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("selected state");
    assert_eq!(
        json["conversation"]["messages"].as_array().unwrap().len(),
        2
    );

    let (status, body) = post_desktop_json(
        server.addr,
        "/api/desktop/navigation/select",
        r#"{"navId":"new-chat"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("new chat state");
    assert_eq!(
        json["conversation"]["messages"].as_array().unwrap().len(),
        0
    );
    assert!(json["sidebar"]["threads"]
        .as_array()
        .expect("threads")
        .iter()
        .any(|thread| thread["id"] == "thread-saved"));

    let (status, body) = post_desktop_json(
        server.addr,
        "/api/desktop/threads/select",
        r#"{"threadId":"thread-saved"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("restored state");
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["kind"] == "assistant" && message["text"] == "saved reply"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_failed_plugin_invocation_emits_structured_tool_result_state() {
    let runtime_layout = create_runtime_fixture(
        "desktop-native-plugin-tool-error-message",
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

    let body = r#"{"input":{}}"#;
    let request_body = format!(
        "POST /api/desktop/plugins/qwen3-tts/tools/missing_tool/invoke HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let (status, _) = request(server.addr, &request_body).await;

    assert_eq!(status, 500);
    let events = read_stream_until(&mut events, "event: stateChanged").await;
    assert!(events.contains(r#""desktopState":"#));
    assert!(!events.contains(r#""desktop_state":"#));
    assert!(events.contains(r#""kind":"toolResult""#));
    assert!(events.contains(r#""toolId":"missing_tool""#));
    assert!(events.contains(r#""ok":false"#));
    assert!(events.contains("does not expose tool"));
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
        r#"{{"confirmed":true,"input":{{"query":"rust native","baseUrl":{},"count":1,"engines":["bing"],"autoStart":false}}}}"#,
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
async fn gateway_create_agent_applies_runtime_configuration() {
    let runtime_layout = create_runtime_fixture(
        "desktop-agent-runtime-config",
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

    let create_body = serde_json::json!({
        "name": "Planner",
        "role": "Planning agent",
        "description": "runtime configured",
        "model": "MiniMax-M2.7-highspeed",
        "thinking": "medium",
        "permissionMode": "只读模式",
        "emotion": {
            "style": "严谨审查",
            "tone": "证据优先",
            "boundaries": ["先列风险"],
            "promptMd": "# 严谨审查\n- 先列风险"
        },
        "voice": {
            "enabled": true,
            "inputEnabled": true,
            "outputEnabled": false,
            "wakeEnabled": false,
            "source": "qwen-preset",
            "presetVoice": "Serena",
            "designPrompt": "",
            "cloneVoiceName": "",
            "cloneSampleName": "",
            "style": "严谨清晰",
            "pace": "慢速"
        },
        "avatar": {
            "initials": "PL",
            "gradient": "linear-gradient(135deg, #111827, #14b8a6)",
            "source": "generated"
        },
        "channels": [{"id": "desktop", "label": "桌面", "enabled": true}],
        "toolIds": ["read"],
        "skillIds": ["plugin-skill-review"]
    })
    .to_string();
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
    let agent = &json["agentWorkspace"]["agents"][0];
    assert_eq!(agent["model"], "MiniMax-M2.7-highspeed");
    assert_eq!(agent["thinking"], "medium");
    assert_eq!(agent["permissionMode"], "只读模式");
    assert_eq!(agent["emotion"]["promptMd"], "# 严谨审查\n- 先列风险");
    assert_eq!(agent["voice"]["presetVoice"], "Serena");
    assert_eq!(agent["avatar"]["initials"], "PL");
    assert_eq!(agent["tools"][0]["id"], "read");
    assert_eq!(agent["skills"][0]["id"], "plugin-skill-review");

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
    let persisted_agent = json["desktopState"]["agentWorkspace"]["agents"]
        .as_array()
        .expect("agents")
        .iter()
        .find(|agent| agent["id"].as_str() == Some(agent_id))
        .expect("persisted agent");
    assert_eq!(persisted_agent["model"], "MiniMax-M2.7-highspeed");
    assert_eq!(persisted_agent["thinking"], "medium");
    assert_eq!(persisted_agent["permissionMode"], "只读模式");
    assert_eq!(persisted_agent["tools"][0]["id"], "read");
    assert_eq!(persisted_agent["skills"][0]["id"], "plugin-skill-review");
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
    let _advanced_guard = ADVANCED_SETTINGS_TEST_LOCK.lock().await;
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

    let expected_data_location = runtime_layout.runtime_root.to_string_lossy().to_string();
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
    assert_eq!(preferences["taskDefaults"]["responseSpeed"], "简洁");
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
        expected_data_location
    );
    assert_eq!(preferences["advancedDefaults"]["logLevel"], "详细");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_model_profile_test_and_save_persists_profile_secret_and_active_config() {
    let runtime_layout = create_runtime_fixture(
        "desktop-model-profile-save",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_compatible_provider_with_model(
        "test connection",
        "profile probe ok",
        "test-model",
    )
    .await;
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let save_body = serde_json::json!({
        "source": "custom",
        "provider": "openai-compatible",
        "baseUrl": provider_base_url,
        "api": "openai-completions",
        "apiKey": "test-key",
        "model": "test-model",
        "label": "Local test model"
    })
    .to_string();
    let (status, body) = request(
        server.addr,
        format!(
            "POST /api/desktop/model-profiles/test-and-save HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            save_body.len(),
            save_body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    let preferences = &json["preferences"];
    assert_eq!(preferences["selectedModel"], "openai-compatible/test-model");
    assert!(preferences["modelOptions"]
        .as_array()
        .expect("model options")
        .iter()
        .any(|option| option == "openai-compatible/test-model"));
    let profiles = preferences["modelProfiles"]
        .as_array()
        .expect("model profiles");
    let profile = profiles
        .iter()
        .find(|profile| profile["modelRef"] == "openai-compatible/test-model")
        .expect("saved model profile");
    assert_eq!(profile["label"], "Local test model");
    assert_eq!(profile["provider"], "openai-compatible");
    assert_eq!(profile["model"], "test-model");
    assert_eq!(profile["baseUrl"], provider_base_url);
    assert_eq!(profile["api"], "openai-completions");
    assert_eq!(profile["authMethod"], "api-key");
    assert_eq!(profile["hasCredential"], true);
    assert!(profile.get("apiKey").is_none());

    let store_path = runtime_layout
        .runtime_root
        .join("config")
        .join("desktop-model-profiles.json");
    let store_text = fs::read_to_string(store_path).expect("model profile store");
    assert!(store_text.contains("openai-compatible/test-model"));
    assert!(
        !store_text.contains("test-key"),
        "profile store must not contain raw credentials"
    );

    let active_config: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(
            runtime_layout
                .runtime_root
                .join("config")
                .join("desktop-agent-provider.json"),
        )
        .expect("active provider config"),
    )
    .expect("active provider json");
    assert_eq!(active_config["runtime"], "native-provider");
    assert_eq!(active_config["provider"], "openai-compatible");
    assert_eq!(active_config["baseUrl"], provider_base_url);
    assert_eq!(active_config["model"], "test-model");
    assert_eq!(active_config["api"], "openai-completions");
    assert_eq!(active_config["apiKey"]["source"], "file");
    let secret_ref = active_config["apiKey"]["id"]
        .as_str()
        .expect("secret file ref");
    assert!(secret_ref.starts_with("config/secrets/desktop-models/"));
    assert_eq!(
        fs::read_to_string(runtime_layout.runtime_root.join(secret_ref))
            .expect("model profile secret"),
        "test-key\n"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_model_profile_failed_test_does_not_persist() {
    let runtime_layout = create_runtime_fixture(
        "desktop-model-profile-failure",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_compatible_provider_failure(401, "bad key").await;
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let save_body = serde_json::json!({
        "source": "custom",
        "provider": "openai-compatible",
        "baseUrl": provider_base_url,
        "api": "openai-completions",
        "apiKey": "test-key",
        "model": "test-model",
        "label": "Broken model"
    })
    .to_string();
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/model-profiles/test-and-save HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            save_body.len(),
            save_body
        ),
    )
    .await;

    assert_eq!(status, 502);
    assert!(!runtime_layout
        .runtime_root
        .join("config")
        .join("desktop-model-profiles.json")
        .exists());
    assert!(!runtime_layout
        .runtime_root
        .join("config")
        .join("desktop-agent-provider.json")
        .exists());
    assert!(!runtime_layout
        .runtime_root
        .join("config")
        .join("secrets")
        .join("desktop-models")
        .exists());
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_selecting_saved_model_profile_applies_active_provider_config() {
    let runtime_layout = create_runtime_fixture(
        "desktop-model-profile-switch",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let first_base_url =
        spawn_openai_compatible_provider_with_model("test connection", "one ok", "model-one").await;
    let second_base_url =
        spawn_openai_compatible_provider_with_model("test connection", "two ok", "model-two").await;
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    for (label, base_url, model) in [
        ("First model", first_base_url.as_str(), "model-one"),
        ("Second model", second_base_url.as_str(), "model-two"),
    ] {
        let save_body = serde_json::json!({
            "source": "custom",
            "provider": "openai-compatible",
            "baseUrl": base_url,
            "apiKey": "test-key",
            "model": model,
            "label": label
        })
        .to_string();
        let (status, _) = request(
            server.addr,
            format!(
                "POST /api/desktop/model-profiles/test-and-save HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                save_body.len(),
                save_body
            ),
        )
        .await;
        assert_eq!(status, 200);
    }

    let preferences_body = r#"{"selectedModel":"openai-compatible/model-one"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            preferences_body.len(),
            preferences_body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let active_config: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(
            runtime_layout
                .runtime_root
                .join("config")
                .join("desktop-agent-provider.json"),
        )
        .expect("active provider config"),
    )
    .expect("active provider json");
    assert_eq!(active_config["provider"], "openai-compatible");
    assert_eq!(active_config["baseUrl"], first_base_url);
    assert_eq!(active_config["model"], "model-one");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_model_profiles_reload_as_sanitized_bootstrap_preferences() {
    let runtime_layout = create_runtime_fixture(
        "desktop-model-profile-bootstrap",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url =
        spawn_openai_compatible_provider_with_model("test connection", "profile ok", "saved-model")
            .await;
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout: runtime_layout.clone(),
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");
    let save_body = serde_json::json!({
        "source": "custom",
        "provider": "openai-compatible",
        "baseUrl": provider_base_url,
        "apiKey": "test-key",
        "model": "saved-model",
        "label": "Saved model"
    })
    .to_string();
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/model-profiles/test-and-save HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            save_body.len(),
            save_body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let reloaded_server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session-2".to_string(),
    })
    .await
    .expect("reloaded gateway should start");
    let (status, body) = request(
        reloaded_server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;

    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    let preferences = &json["desktopState"]["preferences"];
    assert!(preferences["modelOptions"]
        .as_array()
        .expect("model options")
        .iter()
        .any(|option| option == "openai-compatible/saved-model"));
    let profile = preferences["modelProfiles"]
        .as_array()
        .expect("model profiles")
        .iter()
        .find(|profile| profile["modelRef"] == "openai-compatible/saved-model")
        .expect("saved profile");
    assert_eq!(profile["label"], "Saved model");
    assert_eq!(profile["hasCredential"], true);
    assert!(profile.get("apiKey").is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_preferences_apply_hot_settings_effects_without_restart() {
    let _advanced_guard = ADVANCED_SETTINGS_TEST_LOCK.lock().await;
    let runtime_layout = create_runtime_fixture(
        "desktop-hot-settings-effects",
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
      "notificationDefaults":{"notifyTaskDone":false,"notifyConfirmNeeded":true,"notifyDreamDone":false,"notifyAutomationFailed":true,"notificationSound":true},
      "uiDefaults":{"defaultPage":"记忆","language":"English","appearance":"深色","launchAtLogin":true,"showInMenuBar":false},
      "memoryDefaults":{"rememberPreferences":false,"rememberProjectContext":true,"memoryDreamEnabled":false,"memoryDreamFrequency":"手动","memoryCleanupConfirmation":"不自动清理"},
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

    let effective_path = runtime_layout
        .runtime_root
        .join("desktop")
        .join("settings")
        .join("effective-state.json");
    let effective: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(effective_path).expect("effective settings state"),
    )
    .expect("effective settings json");
    assert_eq!(effective["ui"]["launchAtLogin"], true);
    assert_eq!(effective["ui"]["showInMenuBar"], false);
    assert_eq!(effective["ui"]["appearance"], "深色");
    assert_eq!(effective["ui"]["language"], "English");
    assert_eq!(effective["notifications"]["notificationSound"], true);
    assert_eq!(effective["memory"]["memoryDreamEnabled"], false);
    assert_eq!(effective["memory"]["memoryDreamFrequency"], "手动");
    assert_eq!(effective["advanced"]["logLevel"], "详细");
    let notification_policy_path = runtime_layout
        .runtime_root
        .join("desktop")
        .join("notifications")
        .join("policy.json");
    let notification_policy: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(notification_policy_path).expect("notification policy"),
    )
    .expect("notification policy json");
    assert_eq!(notification_policy["enabled"], true);
    assert_eq!(notification_policy["defaults"]["notifyTaskDone"], false);
    assert_eq!(notification_policy["defaults"]["notificationSound"], true);
    let policy_path = runtime_layout
        .runtime_root
        .join("config")
        .join("desktop-memory-policy.json");
    let policy: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(policy_path).expect("memory policy"))
            .expect("memory policy json");
    assert_eq!(policy["rememberPreferences"], false);
    assert_eq!(policy["rememberProjectContext"], true);
    assert_eq!(policy["memoryDreamEnabled"], false);
    assert_eq!(policy["memoryDreamFrequency"], "手动");
    assert_eq!(policy["memoryCleanupConfirmation"], "不自动清理");

    let log_level = fs::read_to_string(
        runtime_layout
            .runtime_root
            .join("desktop")
            .join("settings")
            .join("runtime-log-level"),
    )
    .expect("runtime log level");
    assert_eq!(log_level.trim(), "详细");

    let second_body = r#"{"uiDefaults":{"appearance":"浅色","launchAtLogin":false,"showInMenuBar":true},"advancedDefaults":{"logLevel":"错误"}}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            second_body.len(),
            second_body
        ),
    )
    .await;
    assert_eq!(status, 200);
    let effective: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(
            runtime_layout
                .runtime_root
                .join("desktop")
                .join("settings")
                .join("effective-state.json"),
        )
        .expect("updated effective settings state"),
    )
    .expect("updated effective settings json");
    assert_eq!(effective["ui"]["launchAtLogin"], false);
    assert_eq!(effective["ui"]["showInMenuBar"], true);
    assert_eq!(effective["ui"]["appearance"], "浅色");
    assert_eq!(effective["advanced"]["logLevel"], "错误");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_memory_dream_respects_disabled_hot_preference() {
    let runtime_layout = create_runtime_fixture(
        "desktop-memory-dream-disabled",
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

    let body = r#"{"memoryDefaults":{"memoryDreamEnabled":false,"memoryDreamFrequency":"手动"}}"#;
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

    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/memory/dream/run",
        r#"{"agentId":"agent-general"}"#,
    )
    .await;
    assert_eq!(status, 409);
    let (status, body) = request(
        server.addr,
        "GET /api/desktop/state HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["kind"] == "error" && message["code"] == "memory_dream_disabled"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_archive_memory_item_respects_cleanup_confirmation() {
    let runtime_layout = create_runtime_fixture(
        "desktop-memory-cleanup-confirm",
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

    let item_body = r#"{
      "title":"稳定偏好",
      "summary":"用户偏好",
      "content":"用户喜欢中文回复。",
      "category":"偏好",
      "tags":["重要"]
    }"#;
    let (status, body) =
        post_desktop_json(server.addr, "/api/desktop/memory/items", item_body).await;
    assert_eq!(status, 200);
    let state: serde_json::Value = serde_json::from_str(&body).expect("state json");
    let item_id = state["memoryWorkspace"]["selectedItemId"]
        .as_str()
        .expect("selected memory item");

    let (status, _) = post_desktop_json(
        server.addr,
        &format!("/api/desktop/memory/items/{item_id}/archive"),
        r#"{}"#,
    )
    .await;
    assert_eq!(status, 409);

    let (status, body) = post_desktop_json(
        server.addr,
        &format!("/api/desktop/memory/items/{item_id}/archive"),
        r#"{"confirmed":true}"#,
    )
    .await;
    assert_eq!(status, 200);
    let state: serde_json::Value = serde_json::from_str(&body).expect("state json");
    assert_eq!(
        state["memoryWorkspace"]["items"][0]["archived"], true,
        "confirmed cleanup should archive the item"
    );
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

    let preferences_body = r#"{"notificationDefaults":{"notificationSound":true}}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            preferences_body.len(),
            preferences_body
        ),
    )
    .await;
    assert_eq!(status, 200);

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
    let messages = json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages");
    assert!(messages
        .iter()
        .any(|message| message["kind"] == "user" && message["text"] == "hello from desktop"));
    assert!(messages
        .iter()
        .any(|message| message["kind"] == "assistant" && message["status"] == "running"));
    let thread_id = json["sidebar"]["threads"][0]["id"]
        .as_str()
        .expect("thread id");
    let events = read_stream_until(&mut events, "event: messageFinal").await;
    assert!(events.contains("event: messageDelta"));
    assert!(events.contains("event: messageFinal"));
    let json = wait_for_assistant_text(server.addr, "provider says hello").await;
    assert!(json["conversation"]["resultItems"]
        .as_array()
        .expect("result items")
        .iter()
        .any(|item| item.as_str() == Some("provider says hello")));
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages")
        .iter()
        .any(|message| {
            message["kind"] == "assistant"
                && message["status"] == "done"
                && message["text"] == "provider says hello"
        }));
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
    let memory_messages = crawclaw_runtime::memory::RuntimeStore::new(
        runtime_layout
            .runtime_root
            .join("memory")
            .join("runtime.db"),
    )
    .list_messages(thread_id, 10)
    .expect("memory messages");
    assert_eq!(memory_messages.len(), 2);
    let notification = read_last_notification(&runtime_layout);
    assert_eq!(notification["kind"], "taskDone");
    assert_eq!(notification["title"], "对话已完成");
    assert_eq!(notification["sound"], true);
    assert!(events.contains("event: sessionStarted"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_send_message_returns_running_assistant_before_provider_finishes() {
    let runtime_layout = create_runtime_fixture(
        "desktop-send-message-running",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_compatible_provider_with_delay(
        "hello running",
        "delayed reply",
        Duration::from_secs(1),
    )
    .await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
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

    let body = r#"{"text":"hello running"}"#;
    let started_at = Instant::now();
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
    assert!(
        started_at.elapsed() < Duration::from_millis(500),
        "message route should return before the provider response finishes"
    );
    let json: serde_json::Value = serde_json::from_str(&body).expect("running state json");
    let messages = json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages");
    assert!(messages
        .iter()
        .any(|message| message["kind"] == "user" && message["text"] == "hello running"));
    let assistant = messages
        .iter()
        .find(|message| message["kind"] == "assistant")
        .expect("running assistant message");
    assert_eq!(assistant["status"], "running");
    assert_eq!(assistant["text"], "");
    assert!(assistant["runId"]
        .as_str()
        .is_some_and(|run_id| run_id.starts_with("run-")));

    let events = read_stream_until(&mut events, "event: messageFinal").await;
    assert!(events.contains("event: messageFinal"));
    assert!(events.contains("delayed reply"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_send_message_uses_selected_desktop_model() {
    let runtime_layout = create_runtime_fixture(
        "desktop-send-selected-model",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_compatible_provider_with_model(
        "hello minimax",
        "minimax reply",
        "MiniMax-M2.7-highspeed",
    )
    .await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let preferences_body = r#"{"selectedModel":"MiniMax-M2.7-highspeed"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "PATCH /api/desktop/preferences HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            preferences_body.len(),
            preferences_body
        ),
    )
    .await;
    assert_eq!(status, 200);

    let body = r#"{"text":"hello minimax"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json = wait_for_assistant_text(server.addr, "minimax reply").await;
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages")
        .iter()
        .any(|message| {
            message["kind"] == "assistant"
                && message["status"] == "done"
                && message["text"] == "minimax reply"
        }));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_send_message_uses_selected_agent_context() {
    let runtime_layout = create_runtime_fixture(
        "desktop-send-selected-agent",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_plugin_manifest(&runtime_layout);
    let provider_base_url = spawn_openai_compatible_provider_with_request_checks(
        "agent reply",
        Some("MiniMax-M2.7-highspeed"),
        &[
            "hello selected agent",
            "Planner",
            "只读模式",
            "@review",
            "# 严谨审查",
        ],
        &[],
    )
    .await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");
    let create_body = serde_json::json!({
        "name": "Planner",
        "role": "Planning agent",
        "description": "Plans local work",
        "model": "MiniMax-M2.7-highspeed",
        "thinking": "medium",
        "permissionMode": "只读模式",
        "emotion": {
            "style": "严谨审查",
            "tone": "证据优先",
            "boundaries": ["先列风险"],
            "promptMd": "# 严谨审查\n- 先列风险"
        },
        "channels": [{"id": "desktop", "label": "桌面", "enabled": true}],
        "skillIds": ["plugin-skill-review"]
    })
    .to_string();
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

    let send_body = format!(r#"{{"text":"hello selected agent","agentId":"{agent_id}"}}"#);
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            send_body.len(),
            send_body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json = wait_for_assistant_text(server.addr, "agent reply").await;
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages")
        .iter()
        .any(|message| {
            message["kind"] == "assistant"
                && message["status"] == "done"
                && message["text"] == "agent reply"
        }));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_send_message_rejects_unknown_agent() {
    let runtime_layout = create_runtime_fixture(
        "desktop-send-unknown-agent",
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

    let body = r#"{"text":"hello missing agent","agentId":"missing-agent"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;

    assert_eq!(status, 404);
    assert!(!runtime_layout.runtime_root.join("sessions").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_send_message_agent_without_tools_disables_tools() {
    let runtime_layout = create_runtime_fixture(
        "desktop-send-agent-no-tools",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_compatible_provider_with_request_checks(
        "agent reply without tools",
        Some("MiniMax-M2.7-highspeed"),
        &["hello without tools"],
        &[r#""tools""#],
    )
    .await;
    write_pi_agent_provider_config(&runtime_layout, &provider_base_url);

    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");
    let create_body = serde_json::json!({
        "name": "No Tools Agent",
        "role": "Planning agent",
        "model": "MiniMax-M2.7-highspeed",
        "thinking": "medium",
        "permissionMode": "工作区模式",
        "channels": [{"id": "desktop", "label": "桌面", "enabled": true}],
        "toolIds": []
    })
    .to_string();
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

    let send_body = format!(r#"{{"text":"hello without tools","agentId":"{agent_id}"}}"#);
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            send_body.len(),
            send_body
        ),
    )
    .await;

    assert_eq!(status, 200);
    let json = wait_for_assistant_text(server.addr, "agent reply without tools").await;
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages")
        .iter()
        .any(|message| {
            message["kind"] == "assistant"
                && message["status"] == "done"
                && message["text"] == "agent reply without tools"
        }));
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
    let _ = wait_for_assistant_text(server.addr, "persisted assistant reply").await;

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
        json["desktopState"]["sidebar"]["threads"][0]["active"],
        true
    );
    let result_items = json["desktopState"]["conversation"]["resultItems"]
        .as_array()
        .expect("result items");
    assert!(result_items.iter().any(|item| {
        item.as_str()
            .or_else(|| item["content"].as_str())
            .is_some_and(|content| content.contains("persisted assistant reply"))
    }));
    let messages = json["desktopState"]["conversation"]["messages"]
        .as_array()
        .expect("messages");
    assert!(messages
        .iter()
        .filter_map(|message| message["text"].as_str())
        .any(|text| text.contains("remember this session")));
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
    let _ = wait_for_assistant_text(server.addr, "metadata reply").await;

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

    let body = r#"{"navId":"plugins"}"#;
    let (status, _) = request(
        server.addr,
        format!(
            "POST /api/desktop/navigation/select HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await;
    assert_eq!(status, 200);

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
    assert_eq!(json["activeNavId"], "new-chat");
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
async fn gateway_select_new_chat_clears_active_thread_conversation() {
    let runtime_layout = create_runtime_fixture(
        "desktop-session-new-chat-clears",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    write_session_transcript(&runtime_layout, "thread-a", "first user", "first assistant");
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let body = r#"{"threadId":"thread-a"}"#;
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
    let json: serde_json::Value = serde_json::from_str(&body).expect("thread state json");
    assert_eq!(json["sidebar"]["threads"][0]["active"], true);
    assert_eq!(json["conversation"]["messages"][0]["text"], "first user");

    let body = r#"{"navId":"new-chat"}"#;
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
    let json: serde_json::Value = serde_json::from_str(&body).expect("new chat state json");
    assert_eq!(json["activeNavId"], "new-chat");
    assert_eq!(json["sidebar"]["threads"][0]["active"], false);
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .is_empty());
    assert!(json["conversation"]["resultItems"]
        .as_array()
        .expect("result items")
        .is_empty());
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
    let runtime_layout = create_runtime_fixture(
        "desktop-send-message-no-provider",
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

    assert_eq!(status, 200);
    let events = read_stream_until(&mut events, "event: operationFailed").await;
    assert!(events.contains("event: operationFailed"));
    assert!(events.contains("provider_unavailable"));
    let json = wait_for_assistant_error(server.addr, "provider_unavailable").await;
    let messages = json["conversation"]["messages"]
        .as_array()
        .expect("conversation messages");
    assert!(messages
        .iter()
        .any(|message| message["kind"] == "user" && message["text"] == "hello from desktop"));
    assert!(messages.iter().any(|message| {
        message["kind"] == "assistant"
            && message["status"] == "failed"
            && message["errorCode"] == "provider_unavailable"
    }));
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

    let body = r#"{"text":"prefer shorter","mode":"followUp"}"#;
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
async fn gateway_abort_active_message_marks_running_assistant_cancelled() {
    let runtime_layout = create_runtime_fixture(
        "desktop-message-abort-active",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_compatible_provider_with_delay(
        "abort this run",
        "late reply",
        Duration::from_secs(3),
    )
    .await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, body) = post_desktop_json(
        server.addr,
        "/api/desktop/messages",
        r#"{"text":"abort this run"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("running state json");
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["kind"] == "assistant" && message["status"] == "running"));

    let (status, body) = post_desktop_json(server.addr, "/api/desktop/messages/abort", "{}").await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("cancelled state json");
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["kind"] == "assistant" && message["status"] == "cancelled"));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_steer_restart_cancels_active_run_and_starts_replacement() {
    let runtime_layout = create_runtime_fixture(
        "desktop-message-steer-restart",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_compatible_provider_sequence(vec![
        ProviderResponseFixture {
            delay: Duration::from_secs(3),
            expected_model: None,
            forbidden_substrings: Vec::new(),
            required_substrings: vec![r#""content":"draft long answer""#.to_string()],
            response_text: "late first reply".to_string(),
        },
        ProviderResponseFixture {
            delay: Duration::ZERO,
            expected_model: None,
            forbidden_substrings: Vec::new(),
            required_substrings: vec![
                r#""content":"draft long answer\n\n修正指令：make it shorter""#.to_string(),
            ],
            response_text: "restart reply".to_string(),
        },
    ])
    .await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/messages",
        r#"{"text":"draft long answer"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/steer",
        r#"{"text":"make it shorter","mode":"restart"}"#,
    )
    .await;
    assert_eq!(status, 200);

    let json = wait_for_assistant_text(server.addr, "restart reply").await;
    let messages = json["conversation"]["messages"]
        .as_array()
        .expect("messages");
    assert!(messages
        .iter()
        .any(|message| message["kind"] == "assistant" && message["status"] == "cancelled"));
    assert!(messages.iter().any(|message| {
        message["kind"] == "user"
            && message["text"]
                .as_str()
                .is_some_and(|text| text.contains("修正指令：make it shorter"))
    }));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_steer_follow_up_queues_next_user_message_after_current_run() {
    let runtime_layout = create_runtime_fixture(
        "desktop-message-steer-follow-up",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let provider_base_url = spawn_openai_compatible_provider_sequence(vec![
        ProviderResponseFixture {
            delay: Duration::from_millis(300),
            expected_model: None,
            forbidden_substrings: Vec::new(),
            required_substrings: vec![r#""content":"first question""#.to_string()],
            response_text: "first reply".to_string(),
        },
        ProviderResponseFixture {
            delay: Duration::ZERO,
            expected_model: None,
            forbidden_substrings: Vec::new(),
            required_substrings: vec![r#""content":"queued follow up""#.to_string()],
            response_text: "followup reply".to_string(),
        },
    ])
    .await;
    write_openai_compatible_provider_config(&runtime_layout, &provider_base_url);
    let server = start_gateway_server(GatewayConfig {
        app_name: "CrawClaw Desktop".to_string(),
        app_version: "test".to_string(),
        runtime_layout,
        session_token: "session".to_string(),
    })
    .await
    .expect("gateway should start");

    let (status, _) = post_desktop_json(
        server.addr,
        "/api/desktop/messages",
        r#"{"text":"first question"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let (status, body) = post_desktop_json(
        server.addr,
        "/api/desktop/messages/steer",
        r#"{"text":"queued follow up","mode":"followUp"}"#,
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("queued state json");
    assert!(json["conversation"]["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["kind"] == "status" && message["title"] == "追问已排队"));

    let json = wait_for_assistant_text(server.addr, "followup reply").await;
    let messages = json["conversation"]["messages"]
        .as_array()
        .expect("messages");
    assert!(messages
        .iter()
        .any(|message| message["kind"] == "assistant" && message["text"] == "first reply"));
    assert!(messages
        .iter()
        .any(|message| message["kind"] == "user" && message["text"] == "queued follow up"));
    assert!(messages
        .iter()
        .any(|message| message["kind"] == "assistant" && message["text"] == "followup reply"));
}

#[tokio::test]
async fn gateway_search_indexes_live_memory_items() {
    let runtime_layout = create_runtime_fixture(
        "desktop-search-live-memory",
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

    let item_body = r#"{"title":"Searchable Memory","summary":"needle summary","content":"needle content","category":"项目","tags":["needle"]}"#;
    let (status, state_body) =
        post_desktop_json(server.addr, "/api/desktop/memory/items", item_body).await;
    assert_eq!(status, 200);
    let state: serde_json::Value = serde_json::from_str(&state_body).expect("state json");
    let item_id = state["memoryWorkspace"]["selectedItemId"]
        .as_str()
        .expect("selected memory item")
        .to_string();

    let (status, body) = request(
        server.addr,
        "GET /api/desktop/search?q=needle HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let results: serde_json::Value = serde_json::from_str(&body).expect("search results");
    assert!(results
        .as_array()
        .expect("search result array")
        .iter()
        .any(|result| {
            result["label"] == "Searchable Memory"
                && result["targetNavId"] == "memory"
                && result["targetItemId"] == item_id
        }));
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_memory_workspace_uses_default_scope_without_desktop_agents() {
    let runtime_layout = create_runtime_fixture(
        "desktop-memory-default-scope",
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

    let (status, body) = request(
        server.addr,
        "GET /api/desktop/bootstrap HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    let json: serde_json::Value = serde_json::from_str(&body).expect("bootstrap json");
    assert_eq!(
        json["desktopState"]["agentWorkspace"]["agents"]
            .as_array()
            .expect("desktop agents")
            .len(),
        0
    );
    assert_eq!(
        json["desktopState"]["memoryWorkspace"]["selectedAgentId"],
        "main"
    );

    let create_body =
        r#"{"title":"Default scope","summary":"visible","content":"remember without an agent"}"#;
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
    assert_eq!(json["memoryWorkspace"]["selectedAgentId"], "main");
    assert_eq!(json["memoryWorkspace"]["items"][0]["agentId"], "main");
}

#[cfg(unix)]
#[tokio::test]
async fn gateway_bootstrap_imports_legacy_workspace_memory_markdown() {
    let runtime_layout = create_runtime_fixture(
        "desktop-workspace-memory-import",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *"desktop-api"*|*"crawclaw.mjs"*) echo "node desktop bridge must not run" >&2; exit 9 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );
    let workspace_memory_dir = runtime_layout.runtime_root.join("workspace").join("memory");
    fs::create_dir_all(&workspace_memory_dir).expect("workspace memory dir");
    fs::write(
        workspace_memory_dir.join("user-preference-chinese.md"),
        r#"---
title: "用户语言偏好：中文优先"
description: "用户默认希望用中文回复。"
type: user
created: 2025-12-05
---

# 用户语言偏好：中文优先

用户默认偏好中文回复。
"#,
    )
    .expect("workspace memory note");
    fs::write(
        workspace_memory_dir.join("MEMORY.md"),
        "- user: 用户默认中文回复偏好\n",
    )
    .expect("workspace memory index");

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
    let items = json["desktopState"]["memoryWorkspace"]["items"]
        .as_array()
        .expect("memory items");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], "workspace-memory-user-preference-chinese");
    assert_eq!(items[0]["agentId"], "main");
    assert_eq!(items[0]["category"], "偏好");
    assert_eq!(items[0]["source"], "workspace-memory");
    assert_eq!(items[0]["title"], "用户语言偏好：中文优先");
    assert_eq!(items[0]["summary"], "用户默认希望用中文回复。");
    assert_eq!(
        json["desktopState"]["memoryWorkspace"]["selectedItemId"],
        items[0]["id"]
    );

    let persisted = fs::read_to_string(
        runtime_layout
            .runtime_root
            .join("memory")
            .join("desktop-items.json"),
    )
    .expect("persisted desktop memory");
    assert!(persisted.contains("workspace-memory-user-preference-chinese"));
    assert!(!persisted.contains("MEMORY.md"));
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

    let update_body = r#"{"summary":"updated summary","content":"remember this after update","tags":["desktop","updated"],"source":"Updated source"}"#;
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
            "POST /api/desktop/memory/items/{item_id}/archive HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: 18\r\nConnection: close\r\n\r\n{{\"confirmed\":true}}",
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
    assert_eq!(item["source"], "Updated source");
    assert_eq!(item["tags"], serde_json::json!(["desktop", "updated"]));
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
    let notification = read_last_notification(&runtime_layout);
    assert_eq!(notification["kind"], "dreamDone");
    assert_eq!(notification["title"], "记忆做梦已完成");
    assert_eq!(notification["sound"], false);

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

async fn post_desktop_json(addr: SocketAddr, path: &str, body: &str) -> (u16, String) {
    request(
        addr,
        format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nx-crawclaw-desktop-session: session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        ),
    )
    .await
}

async fn get_desktop_state(addr: SocketAddr) -> serde_json::Value {
    let (status, body) = request(
        addr,
        "GET /api/desktop/state HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 200);
    serde_json::from_str(&body).expect("state json")
}

async fn wait_for_assistant_text(addr: SocketAddr, expected_text: &str) -> serde_json::Value {
    for _ in 0..80 {
        let state = get_desktop_state(addr).await;
        if state["conversation"]["messages"]
            .as_array()
            .expect("conversation messages")
            .iter()
            .any(|message| {
                message["kind"] == "assistant"
                    && message["status"] == "done"
                    && message["text"] == expected_text
            })
        {
            return state;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("timed out waiting for assistant text {expected_text}");
}

async fn wait_for_assistant_error(addr: SocketAddr, expected_code: &str) -> serde_json::Value {
    for _ in 0..80 {
        let state = get_desktop_state(addr).await;
        if state["conversation"]["messages"]
            .as_array()
            .expect("conversation messages")
            .iter()
            .any(|message| {
                message["kind"] == "assistant"
                    && message["status"] == "failed"
                    && message["errorCode"] == expected_code
            })
        {
            return state;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("timed out waiting for assistant error {expected_code}");
}

fn last_notification_path(layout: &RuntimeLayout) -> PathBuf {
    layout
        .runtime_root
        .join("desktop")
        .join("notifications")
        .join("last-notification.json")
}

fn read_last_notification(layout: &RuntimeLayout) -> serde_json::Value {
    serde_json::from_str(
        &fs::read_to_string(last_notification_path(layout)).expect("last notification"),
    )
    .expect("last notification json")
}

#[cfg(unix)]
fn assert_export_file(export: &serde_json::Value, path: &str) {
    let files = export["files"].as_array().expect("export files");
    assert!(
        files.iter().any(|file| file["path"].as_str() == Some(path)),
        "export should include {path}: {files:?}"
    );
}

#[cfg(unix)]
fn assert_export_skipped(export: &serde_json::Value, path: &str, reason: &str) {
    let skipped = export["skipped"].as_array().expect("export skipped");
    assert!(
        skipped.iter().any(|entry| {
            entry["path"].as_str() == Some(path) && entry["reason"].as_str() == Some(reason)
        }),
        "export should skip {path} as {reason}: {skipped:?}"
    );
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
    spawn_openai_compatible_provider_with_optional_model(expected_text, response_text, None).await
}

#[cfg(unix)]
async fn spawn_openai_compatible_provider_with_delay(
    expected_text: &str,
    response_text: &str,
    delay: Duration,
) -> String {
    spawn_openai_compatible_provider_sequence(vec![ProviderResponseFixture {
        delay,
        expected_model: None,
        forbidden_substrings: Vec::new(),
        required_substrings: vec![format!(r#""content":"{expected_text}""#)],
        response_text: response_text.to_string(),
    }])
    .await
}

#[cfg(unix)]
async fn spawn_openai_compatible_provider_with_model(
    expected_text: &str,
    response_text: &str,
    expected_model: &str,
) -> String {
    spawn_openai_compatible_provider_with_optional_model(
        expected_text,
        response_text,
        Some(expected_model),
    )
    .await
}

#[cfg(unix)]
async fn spawn_openai_compatible_provider_with_optional_model(
    expected_text: &str,
    response_text: &str,
    expected_model: Option<&str>,
) -> String {
    spawn_openai_compatible_provider_with_checks(
        response_text,
        expected_model,
        &[&format!(r#""content":"{expected_text}""#)],
        &[],
    )
    .await
}

#[cfg(unix)]
async fn spawn_openai_compatible_provider_with_request_checks(
    response_text: &str,
    expected_model: Option<&str>,
    required_substrings: &[&str],
    forbidden_substrings: &[&str],
) -> String {
    spawn_openai_compatible_provider_with_checks(
        response_text,
        expected_model,
        required_substrings,
        forbidden_substrings,
    )
    .await
}

#[cfg(unix)]
async fn spawn_openai_compatible_provider_with_checks(
    response_text: &str,
    expected_model: Option<&str>,
    required_substrings: &[&str],
    forbidden_substrings: &[&str],
) -> String {
    spawn_openai_compatible_provider_sequence(vec![ProviderResponseFixture {
        delay: Duration::ZERO,
        expected_model: expected_model.map(str::to_string),
        forbidden_substrings: forbidden_substrings
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        required_substrings: required_substrings
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        response_text: response_text.to_string(),
    }])
    .await
}

#[cfg(unix)]
struct ProviderResponseFixture {
    delay: Duration,
    expected_model: Option<String>,
    forbidden_substrings: Vec<String>,
    required_substrings: Vec<String>,
    response_text: String,
}

#[cfg(unix)]
async fn spawn_openai_compatible_provider_sequence(
    responses: Vec<ProviderResponseFixture>,
) -> String {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind provider");
    let addr = listener.local_addr().expect("provider addr");
    tokio::spawn(async move {
        for response_fixture in responses {
            let (mut stream, _) = listener.accept().await.expect("accept provider request");
            tokio::spawn(async move {
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
                for required in &response_fixture.required_substrings {
                    assert!(
                        request.contains(required),
                        "provider request did not contain required substring {required}: {request}"
                    );
                }
                for forbidden in &response_fixture.forbidden_substrings {
                    assert!(
                        !request.contains(forbidden),
                        "provider request contained forbidden substring {forbidden}: {request}"
                    );
                }
                if let Some(expected_model) = response_fixture.expected_model {
                    assert!(request.contains(&format!(r#""model":"{expected_model}""#)));
                }
                assert!(request
                    .to_lowercase()
                    .contains("authorization: bearer test-key"));
                tokio::time::sleep(response_fixture.delay).await;

                let (content_type, body) = if request.contains(r#""stream":true"#) {
                    let chunk = serde_json::to_string(&serde_json::json!({
                        "choices": [
                            {
                                "delta": {
                                    "content": response_fixture.response_text
                                }
                            }
                        ]
                    }))
                    .expect("stream chunk");
                    (
                        "text/event-stream",
                        format!("data: {chunk}\n\ndata: [DONE]\n\n"),
                    )
                } else {
                    (
                        "application/json",
                        format!(
                            r#"{{"choices":[{{"message":{{"content":{}}}}}]}}"#,
                            serde_json::to_string(&response_fixture.response_text)
                                .expect("response text json")
                        ),
                    )
                };
                let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
                stream
                    .write_all(response.as_bytes())
                    .await
                    .expect("write provider response");
            });
        }
    });

    format!("http://{addr}/v1")
}

#[cfg(unix)]
async fn spawn_openai_compatible_provider_failure(status: u16, response_text: &str) -> String {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind provider");
    let addr = listener.local_addr().expect("provider addr");
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
        assert!(request
            .to_lowercase()
            .contains("authorization: bearer test-key"));
        let body = serde_json::json!({
            "error": {
                "message": response_text
            }
        })
        .to_string();
        let response = format!(
            "HTTP/1.1 {status} Error\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
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
async fn spawn_openai_media_provider(
    expected_request_line: &'static str,
    expected_body_fragment: &'static str,
    response_body: &'static str,
) -> String {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind media provider");
    let addr = listener.local_addr().expect("media provider addr");
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept media request");
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = stream.read(&mut buffer).await.expect("read media request");
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);
            if is_complete_http_request(&bytes) {
                break;
            }
        }
        let request = String::from_utf8_lossy(&bytes);
        assert!(
            request.starts_with(expected_request_line),
            "unexpected media request: {request}"
        );
        assert!(
            request.contains("authorization: Bearer test-key")
                || request.contains("Authorization: Bearer test-key"),
            "media request should include bearer auth: {request}"
        );
        assert!(
            request.contains(expected_body_fragment),
            "media request missing expected fragment: {request}"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write media response");
    });

    format!("http://{addr}/v1")
}

#[cfg(unix)]
fn write_pi_agent_provider_config(layout: &RuntimeLayout, base_url: &str) {
    let config_dir = layout.runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("runtime config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        format!(
            r#"{{
  "runtime": "pi-agent-rust",
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
async fn spawn_searxng_provider() -> String {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind searxng provider");
    let addr = listener.local_addr().expect("searxng addr");
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept searxng request");
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = stream
                .read(&mut buffer)
                .await
                .expect("read searxng request");
            assert_ne!(count, 0, "searxng request closed early");
            bytes.extend_from_slice(&buffer[..count]);
            if is_complete_http_request(&bytes) {
                break;
            }
        }
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
fn write_privacy_runtime_fixture(layout: &RuntimeLayout) {
    write_session_transcript(layout, "privacy-thread", "remember this", "stored");
    fs::write(
        layout
            .runtime_root
            .join("sessions/desktop-session-metadata.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "privacy-thread": {
                "title": "Privacy Thread",
                "pinned": false,
                "active": true,
                "resultItems": []
            }
        }))
        .expect("session metadata json"),
    )
    .expect("session metadata");
    write_json_fixture(
        layout,
        "agents/desktop-agents.json",
        serde_json::json!([{"id":"privacy-agent","name":"Privacy Agent"}]),
    );
    write_json_fixture(
        layout,
        "memory/desktop-items.json",
        serde_json::json!([
            {
                "id": "memory-privacy",
                "agentId": "default",
                "title": "Privacy Memory",
                "summary": "summary",
                "content": "content",
                "category": "偏好",
                "tags": ["important"],
                "source": "manual",
                "updatedAt": "刚刚",
                "archived": false
            }
        ]),
    );
    write_text_fixture(layout, "memory/runtime.db", "runtime-memory");
    write_text_fixture(layout, "memory/durable/main/note.md", "# durable");
    write_json_fixture(
        layout,
        "memory/experience/outbox.json",
        serde_json::json!([{"id":"experience-privacy","content":"experience"}]),
    );
    write_text_fixture(layout, "memory/session-summary/main.md", "# summary");
    write_json_fixture(
        layout,
        "workflows/privacy-flow.json",
        serde_json::json!({"id":"privacy-flow","status":"draft"}),
    );
    write_json_fixture(
        layout,
        "desktop/notifications/policy.json",
        serde_json::json!({"enabled":true}),
    );
    write_json_fixture(
        layout,
        "config/desktop-preferences.json",
        serde_json::json!({
            "selectedModel": "gpt-5.5",
            "selectedThinking": "high",
            "permissionMode": "工作区模式",
            "privacyDefaults": {"dataLocation": "stale"}
        }),
    );
    write_json_fixture(
        layout,
        "config/desktop-memory-policy.json",
        serde_json::json!({"rememberPreferences":true,"rememberProjectContext":true}),
    );
    write_json_fixture(
        layout,
        "config/desktop-agent-provider.json",
        serde_json::json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "apiKey": "super-secret",
            "model": "test-model"
        }),
    );
    write_json_fixture(
        layout,
        "config/desktop-model-profiles.json",
        serde_json::json!([
            {
                "id": "test-model",
                "label": "Test Model",
                "modelRef": "openai-compatible/test-model",
                "source": "custom",
                "provider": "openai-compatible",
                "model": "test-model",
                "authMethod": "api-key",
                "apiKeyRef": {"source":"file","id":"config/secrets/desktop-models/test.key"},
                "lastConnectionStatus": "ok"
            }
        ]),
    );
    write_text_fixture(
        layout,
        "config/secrets/desktop-models/test.key",
        "secret-token",
    );
}

#[cfg(unix)]
fn write_json_fixture(layout: &RuntimeLayout, path: &str, value: serde_json::Value) {
    let path = layout.runtime_root.join(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("fixture parent");
    }
    fs::write(
        path,
        serde_json::to_vec_pretty(&value).expect("fixture json"),
    )
    .expect("fixture write");
}

#[cfg(unix)]
fn write_text_fixture(layout: &RuntimeLayout, path: &str, value: &str) {
    let path = layout.runtime_root.join(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("fixture parent");
    }
    fs::write(path, value).expect("fixture write");
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
