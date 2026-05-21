use super::*;
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

const REMOVED_TS_GATEWAY_RUNTIME_FILES: &[&str] = &[
    "src/gateway/server.ts",
    "src/gateway/server.impl.ts",
    "src/gateway/server-runtime-state.ts",
    "src/gateway/server-http.ts",
    "src/gateway/server-broadcast.ts",
    "src/gateway/server-chat.ts",
    "src/gateway/server-maintenance.ts",
    "src/gateway/server-plugin-bootstrap.ts",
    "src/gateway/server-plugins.ts",
    "src/gateway/server-reload-handlers.ts",
    "src/gateway/server-close.ts",
    "src/gateway/server-cron.ts",
    "src/gateway/server-discovery-runtime.ts",
    "src/gateway/server-discovery.ts",
    "src/gateway/server-lanes.ts",
    "src/gateway/server-model-catalog.ts",
    "src/gateway/server-methods/config.ts",
    "src/gateway/server-methods/send.ts",
    "src/gateway/server-methods/skills.ts",
    "src/gateway/server-methods/talk.ts",
    "src/gateway/server-methods/web.ts",
    "src/gateway/server-methods/wizard.ts",
    "src/gateway/server-restart-sentinel.ts",
    "src/gateway/server-runtime-config.ts",
    "src/gateway/server-session-key.ts",
    "src/gateway/server-startup-log.ts",
    "src/gateway/server-startup-session-migration.ts",
    "src/gateway/server-startup.ts",
    "src/gateway/server-tailscale.ts",
    "src/gateway/server-utils.ts",
    "src/gateway/server-wizard-sessions.ts",
    "src/gateway/server/hooks.ts",
    "src/gateway/server/http-auth.ts",
    "src/gateway/server/http-listen.ts",
    "src/gateway/server/plugins-http.ts",
    "src/gateway/server/preauth-connection-budget.ts",
    "src/gateway/server/readiness.ts",
    "src/gateway/server/tls.ts",
    "src/gateway/server/ws-types.ts",
];

const REMOVED_TS_GATEWAY_BRIDGE_FILES: &[&str] = &[
    "src/agents/agent-command.ts",
    "src/agents/command/attempt-execution.ts",
    "src/agents/command/prepare.ts",
    "src/agents/command/run-context.ts",
    "src/agents/command/session.ts",
    "src/agents/command/types.ts",
    "src/agents/runtime/agent-ops-summary.ts",
    "src/chat/abort-primitives.ts",
    "src/gateway/boot.ts",
    "src/gateway/chat-abort.ts",
    "src/gateway/events.ts",
    "src/gateway/protocol/connect-error-details.ts",
    "src/gateway/protocol/schema.ts",
    "src/gateway/request-types.ts",
    "src/gateway/session-reset-entry.ts",
    "src/gateway/session-reset-service.ts",
    "src/gateway/session-subagent-reactivation.runtime.ts",
    "src/gateway/session-subagent-reactivation.ts",
    "src/gateway/sessions-patch.ts",
    "src/gateway/sessions-resolve.ts",
    "src/plugins/runtime/gateway-request-scope.ts",
    "src/generated/gateway/protocol-schema.generated.ts",
];

const REMOVED_PUBLIC_NODE_SURFACE_GUARD_FILES: &[&str] =
    &["src/infra/public-node-surface.guard.test.ts"];

const REMOVED_PUBLIC_NODE_SOURCE_FILES: &[&str] =
    &["src/index.ts", "src/entry.ts", "src/library.ts"];

const REMOVED_TS_GATEWAY_TEST_SUPPORT_FILES: &[&str] = &["src/gateway/live-tool-probe-utils.ts"];

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("repo root")
        .to_path_buf()
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}

fn collect_type_script_files(root: &Path, files: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(root).expect("read source directory") {
        let entry = entry.expect("source directory entry");
        let path = entry.path();
        if path.is_dir() {
            collect_type_script_files(&path, files);
        } else if path.is_file() && path.extension().is_some_and(|ext| ext == "ts") {
            files.push(path);
        }
    }
}

fn is_test_or_declaration_ts(relative: &str) -> bool {
    relative.ends_with(".test.ts")
        || relative.ends_with(".suite.ts")
        || relative.ends_with(".live.test.ts")
        || relative.ends_with(".e2e.test.ts")
        || relative.ends_with(".d.ts")
}

fn is_gateway_ts_test_surface(relative: &str) -> bool {
    relative.starts_with("src/gateway/")
        && (relative.ends_with(".test.ts")
            || relative.ends_with(".live.test.ts")
            || relative.ends_with(".e2e.test.ts")
            || relative.ends_with(".test-helpers.ts")
            || relative.ends_with(".test-mocks.ts"))
}

fn quoted_specifier_after(source: &str, marker: &str, offset: usize) -> Option<(String, usize)> {
    let marker_index = source[offset..].find(marker)? + offset;
    let after_marker = marker_index + marker.len();
    let quoted = source[after_marker..].find(['"', '\''])? + after_marker;
    let quote = source.as_bytes()[quoted] as char;
    let end = source[quoted + 1..].find(quote)? + quoted + 1;
    Some((source[quoted + 1..end].to_string(), end + 1))
}

fn imported_module_specifiers(source: &str) -> Vec<String> {
    let mut specifiers = Vec::new();
    for marker in ["from ", "import("] {
        let mut offset = 0;
        while let Some((specifier, next_offset)) = quoted_specifier_after(source, marker, offset) {
            specifiers.push(specifier);
            offset = next_offset;
        }
    }
    specifiers
}

fn resolve_ts_import(from_file: &Path, specifier: &str) -> Option<PathBuf> {
    if !specifier.starts_with('.') {
        return None;
    }
    let parent = from_file.parent()?;
    let resolved = parent.join(specifier);
    if specifier.ends_with(".js") {
        return Some(resolved.with_extension("ts"));
    }
    Some(resolved.with_extension("ts"))
}

fn contains_gateway_client_constructor(source: &str) -> bool {
    source
        .split_whitespace()
        .collect::<String>()
        .contains("newGatewayClient(")
}

#[test]
fn rust_gateway_method_table_covers_removed_node_core_gateway_methods() {
    let legacy_methods = legacy_node_core_gateway_methods();
    let rust_methods = gateway_methods().into_iter().collect::<BTreeSet<_>>();
    let missing = legacy_methods
        .iter()
        .filter(|method| !rust_methods.contains(**method))
        .copied()
        .collect::<Vec<_>>();

    assert!(
        missing.is_empty(),
        "Rust Gateway is missing removed Node core Gateway methods: {missing:?}"
    );
}

#[test]
fn rust_gateway_repo_guardrails_keep_removed_ts_gateway_surfaces_absent() {
    let root = repo_root();
    let existing = REMOVED_TS_GATEWAY_RUNTIME_FILES
        .iter()
        .chain(REMOVED_TS_GATEWAY_BRIDGE_FILES.iter())
        .chain(REMOVED_PUBLIC_NODE_SURFACE_GUARD_FILES.iter())
        .chain(REMOVED_PUBLIC_NODE_SOURCE_FILES.iter())
        .chain(REMOVED_TS_GATEWAY_TEST_SUPPORT_FILES.iter())
        .filter(|relative| root.join(relative).exists())
        .copied()
        .collect::<Vec<_>>();

    assert!(
        existing.is_empty(),
        "removed TypeScript Gateway or public Node guard surfaces came back: {existing:?}"
    );
}

#[test]
fn rust_gateway_repo_guardrails_keep_gateway_ts_tests_absent() {
    let root = repo_root();
    let mut files = Vec::new();
    collect_type_script_files(&root.join("src").join("gateway"), &mut files);
    let existing = files
        .into_iter()
        .map(|file| slash_path(file.strip_prefix(&root).expect("relative source path")))
        .filter(|relative| is_gateway_ts_test_surface(relative))
        .collect::<Vec<_>>();

    assert!(
        existing.is_empty(),
        "removed TypeScript Gateway tests came back: {existing:?}"
    );
}

#[test]
fn rust_gateway_repo_guardrails_keep_http_routes_off_desktop_namespace() {
    let source = include_str!("lib.rs");
    let needle = [".route(\"", "/api/desktop/"].concat();
    let route_lines = source
        .lines()
        .filter(|line| line.contains(&needle))
        .collect::<Vec<_>>();

    assert!(
        route_lines.is_empty(),
        "generic Rust Gateway must not claim desktop-local API routes: {route_lines:?}"
    );
}

#[test]
fn rust_gateway_repo_guardrails_keep_production_ts_off_old_gateway_runtime() {
    let root = repo_root();
    let mut files = Vec::new();
    collect_type_script_files(&root.join("src"), &mut files);

    let removed_server = root.join("src/gateway/server.ts");
    let removed_public_node_sources = REMOVED_PUBLIC_NODE_SOURCE_FILES
        .iter()
        .map(|relative| root.join(relative))
        .collect::<BTreeSet<_>>();
    let mut server_imports = Vec::new();
    let mut public_node_imports = Vec::new();
    let mut handler_imports = Vec::new();
    let mut gateway_client_callsites = Vec::new();

    for file in files {
        let relative = slash_path(file.strip_prefix(&root).expect("relative source path"));
        if is_test_or_declaration_ts(&relative)
            || relative.starts_with("src/gateway/test-")
            || relative.starts_with("src/gateway/server.e2e-ws-harness")
        {
            continue;
        }

        let source = std::fs::read_to_string(&file).expect("read TS source");
        if contains_gateway_client_constructor(&source) {
            gateway_client_callsites.push(relative.clone());
        }
        if source.contains("legacy-ts-gateway-handlers") {
            handler_imports.push(relative.clone());
        }
        if imported_module_specifiers(&source).iter().any(|specifier| {
            resolve_ts_import(&file, specifier).as_deref() == Some(&removed_server)
        }) {
            server_imports.push(relative.clone());
        }
        if imported_module_specifiers(&source).iter().any(|specifier| {
            resolve_ts_import(&file, specifier)
                .is_some_and(|path| removed_public_node_sources.contains(&path))
        }) {
            public_node_imports.push(relative);
        }
    }

    assert!(
        server_imports.is_empty(),
        "production TS imports the removed TS Gateway server: {server_imports:?}"
    );
    assert!(
        public_node_imports.is_empty(),
        "production TS imports removed public Node entries: {public_node_imports:?}"
    );
    assert!(
        handler_imports.is_empty(),
        "production TS imports removed TS Gateway handlers: {handler_imports:?}"
    );
    assert!(
        gateway_client_callsites.is_empty(),
        "production TS constructs the old GatewayClient directly: {gateway_client_callsites:?}"
    );
}

#[test]
fn rust_gateway_method_table_has_no_duplicates() {
    let methods = gateway_methods();
    let unique_methods = methods.iter().copied().collect::<BTreeSet<_>>();
    assert_eq!(
        unique_methods.len(),
        methods.len(),
        "Rust Gateway method table contains duplicates"
    );
}

#[tokio::test]
async fn rust_gateway_invokes_message_policy_and_core_tools() {
    let runtime_root = unique_test_runtime_root("gateway-runtime-invoke");
    std::fs::create_dir_all(&runtime_root).expect("runtime root");
    std::fs::write(runtime_root.join("note.txt"), "hello from rust tools\n")
        .expect("write fixture");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let policy = handle_gateway_method(
        &state,
        "message.policy",
        json!({
            "operation": "outbound.resolveTypingPolicy",
            "payload": {
                "isHeartbeat": true,
                "requestedPolicy": "user_message"
            }
        }),
    )
    .await
    .expect("message policy");
    assert_eq!(policy["typingPolicy"], "heartbeat");

    let listed = handle_gateway_method(
        &state,
        "tools.invoke",
        json!({
            "tool": "ls",
            "input": {
                "root": runtime_root.to_string_lossy(),
                "path": "."
            }
        }),
    )
    .await
    .expect("tools invoke");
    assert!(listed["text"]
        .as_str()
        .expect("ls text")
        .contains("note.txt"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_rpc_manages_sessions_and_subagents() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-rpc-sessions");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let spawned = handle_gateway_method(
        &state,
        "sessions.spawn",
        json!({
            "task": "inspect gateway",
            "label": "gateway worker",
            "parentSessionKey": "main"
        }),
    )
    .await
    .expect("spawn");
    let child_key = spawned["session"]["key"]
        .as_str()
        .expect("child key")
        .to_string();

    handle_gateway_method(
        &state,
        "sessions.send",
        json!({
            "sessionKey": child_key.clone(),
            "message": "follow up"
        }),
    )
    .await
    .expect("send");
    let yielded = handle_gateway_method(
        &state,
        "sessions.yield",
        json!({
            "sessionKey": child_key.clone()
        }),
    )
    .await
    .expect("yield");

    assert_eq!(yielded["session"]["yielded"], true);
    let history = handle_gateway_method(
        &state,
        "sessions.history",
        json!({
            "sessionKey": child_key.clone()
        }),
    )
    .await
    .expect("history");
    assert!(history["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .any(|message| message["content"] == "follow up"));
    let subscribed = handle_gateway_method(&state, "sessions.subscribe", json!({}))
        .await
        .expect("sessions subscribe");
    assert_eq!(subscribed["subscribed"], true);
    let message_subscribed = handle_gateway_method(
        &state,
        "sessions.messages.subscribe",
        json!({ "key": child_key.clone() }),
    )
    .await
    .expect("session messages subscribe");
    assert_eq!(message_subscribed["subscribed"], true);
    assert_eq!(
        message_subscribed["key"],
        normalize_session_key(&child_key).expect("normalized child key")
    );
    let missing_message_key =
        handle_gateway_method(&state, "sessions.messages.subscribe", json!({})).await;
    assert!(missing_message_key
        .expect_err("message subscribe requires key")
        .contains("session key required"));
    let subagents = handle_gateway_method(
        &state,
        "subagents",
        json!({
            "parentSessionKey": "main"
        }),
    )
    .await
    .expect("subagents");
    assert_eq!(subagents["subagents"][0]["title"], "gateway worker");

    let native_spawned = handle_gateway_method(
        &state,
        "subagents.spawnRun",
        json!({
            "task": "native subagent",
            "label": "native worker",
            "parentSessionKey": "main",
            "run": false
        }),
    )
    .await
    .expect("native subagent spawn");
    assert_eq!(native_spawned["implementation"], "rust-native");
    assert_eq!(native_spawned["status"], "spawned");
    let native_key = native_spawned["sessionKey"]
        .as_str()
        .expect("native key")
        .to_string();

    let native_list = handle_gateway_method(
        &state,
        "subagents.control",
        json!({
            "action": "list",
            "parentSessionKey": "main"
        }),
    )
    .await
    .expect("native subagent list");
    assert!(native_list["subagents"]
        .as_array()
        .expect("native subagents")
        .iter()
        .any(|entry| entry["key"] == native_key));

    let killed = handle_gateway_method(
        &state,
        "subagents.control",
        json!({
            "action": "kill",
            "sessionKey": native_key
        }),
    )
    .await
    .expect("native subagent kill");
    assert_eq!(killed["status"], "killed");

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_rpc_handles_auto_reply_and_acp_control() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-rpc-acp-auto-reply");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let auto_status = handle_gateway_method(
        &state,
        "autoReply.command",
        json!({
            "command": "status",
            "sessionKey": "main"
        }),
    )
    .await
    .expect("auto reply status");
    assert_eq!(auto_status["implementation"], "rust-native");
    assert_eq!(auto_status["runtime"], "autoReply");

    let acp_new = handle_gateway_method(
        &state,
        "acp.session.new",
        json!({
            "sessionKey": "acp-test",
            "label": "ACP test"
        }),
    )
    .await
    .expect("acp session new");
    assert_eq!(acp_new["implementation"], "rust-native");
    assert_eq!(acp_new["sessionKey"], "agent:main:acp-test");

    let acp_loaded = handle_gateway_method(
        &state,
        "acp.session.load",
        json!({
            "sessionKey": "acp-test"
        }),
    )
    .await
    .expect("acp session load");
    assert_eq!(acp_loaded["session"]["title"], "ACP test");

    let acp_patched = handle_gateway_method(
        &state,
        "acp.session.patch",
        json!({
            "sessionKey": "acp-test",
            "status": "running"
        }),
    )
    .await
    .expect("acp session patch");
    assert_eq!(acp_patched["session"]["status"], "running");

    let acp_cancelled = handle_gateway_method(
        &state,
        "acp.session.cancel",
        json!({
            "sessionKey": "acp-test"
        }),
    )
    .await
    .expect("acp session cancel");
    assert_eq!(acp_cancelled["status"], "cancelled");

    let listed = handle_gateway_method(&state, "acp.session.list", json!({ "limit": 10 }))
        .await
        .expect("acp session list");
    assert!(listed["sessions"]
        .as_array()
        .expect("acp sessions")
        .iter()
        .any(|entry| entry["key"] == "agent:main:acp-test"));

    let closed = handle_gateway_method(
        &state,
        "acp.session.close",
        json!({
            "sessionKey": "acp-test",
            "delete": true
        }),
    )
    .await
    .expect("acp session close");
    assert_eq!(closed["status"], "closed");
    assert_eq!(closed["deleted"], true);

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_rpc_manages_cron_jobs() {
    let _guard = env_lock().lock().expect("env lock");
    let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
    let runtime_root = unique_test_runtime_root("gateway-rpc-cron-runtime");
    let state_dir = unique_test_runtime_root("gateway-rpc-cron-state");
    env::set_var("CRAWCLAW_STATE_DIR", &state_dir);

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let status = runtime_status_value(&state);
    assert!(status["gatewayMethods"]
        .as_array()
        .expect("gateway methods")
        .iter()
        .any(|method| method == "cron.add"));
    assert!(status["coreTools"]
        .as_array()
        .expect("core tools")
        .iter()
        .any(|tool| tool == "cron"));

    let added = handle_gateway_method(
        &state,
        "cron.add",
        json!({
            "id": "gateway-job",
            "name": "Gateway reminder",
            "schedule": { "kind": "at", "at": "2999-01-01T00:00:00Z" },
            "sessionTarget": "main",
            "payload": { "kind": "systemEvent", "text": "gateway wake" }
        }),
    )
    .await
    .expect("add cron job");
    assert_eq!(added["id"], "gateway-job");
    assert!(added["state"]["nextRunAtMs"].is_number());

    let listed = handle_gateway_method(
        &state,
        "cron.list",
        json!({
            "includeDisabled": true
        }),
    )
    .await
    .expect("list cron jobs");
    assert_eq!(listed["jobs"][0]["id"], "gateway-job");

    let run = handle_gateway_method(
        &state,
        "cron.run",
        json!({
            "id": "gateway-job",
            "mode": "force"
        }),
    )
    .await
    .expect("run cron job");
    assert_eq!(run["ok"], true);
    assert_eq!(run["enqueued"], true);

    for _ in 0..20 {
        let history = state
            .session_store
            .session_history("main")
            .expect("main history");
        if history
            .iter()
            .any(|message| message.role == "system" && message.content == "gateway wake")
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let history = state
        .session_store
        .session_history("main")
        .expect("main history");
    assert!(history
        .iter()
        .any(|message| message.role == "system" && message.content == "gateway wake"));

    match previous_state_dir {
        Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
        None => env::remove_var("CRAWCLAW_STATE_DIR"),
    }
    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(state_dir);
}

#[tokio::test]
async fn rust_gateway_main_session_wake_tracks_last_event() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-main-session-wake");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let initial = handle_gateway_method(&state, "system.mainSessionWake.last", json!({}))
        .await
        .expect("initial wake");
    assert!(initial.is_null());

    let wake = handle_gateway_method(&state, "wake", json!({ "text": "wake main" }))
        .await
        .expect("wake");
    assert_eq!(wake["status"], "ok");

    let last = handle_gateway_method(&state, "last-main-session-wake", json!({}))
        .await
        .expect("last wake");
    assert_eq!(last["status"], "sent");
    assert_eq!(last["preview"], "wake main");
    assert_eq!(last["reason"], "manual");
    assert_eq!(last["channel"], "local");
    assert_eq!(last["silent"], false);
    assert!(last["ts"].as_u64().is_some());

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_rpc_manages_special_agents_and_memory() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-rpc-special-agents");
    let (provider_base_url, _request_rx) = serve_openai_compatible_n(
        r#"{"choices":[{"message":{"content":"durable memory inspected"}}]}"#,
        2,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let listed = handle_gateway_method(&state, "special_agents.list", json!({}))
        .await
        .expect("list special agents");
    assert_eq!(listed["status"], "ok");
    assert_eq!(listed["agents"].as_array().expect("agents").len(), 6);

    let run = handle_gateway_method(
        &state,
        "special_agents.run",
        json!({
            "kind": "durable-memory",
            "scope": "main",
            "task": "inspect memory"
        }),
    )
    .await
    .expect("run special agent");
    assert_eq!(run["status"], "completed");
    assert_eq!(run["kind"], "durable-memory");

    let dream = handle_gateway_method(
        &state,
        "memory.dream.run",
        json!({
            "scope": "main",
            "task": "compact notes"
        }),
    )
    .await
    .expect("run dream");
    assert_eq!(dream["status"], "completed");

    let history = handle_gateway_method(&state, "memory.dream.history", json!({}))
        .await
        .expect("dream history");
    assert_eq!(history["history"].as_array().expect("history").len(), 1);

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_special_agent_run_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-special-agent-runtime");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"reviewed by rust special agent"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let run = handle_gateway_method(
        &state,
        "special_agents.run",
        json!({
            "kind": "review-spec",
            "task": "check this plan",
            "parentSessionKey": "agent:main:parent"
        }),
    )
    .await
    .expect("run special agent");

    assert_eq!(run["status"], "completed");
    assert_eq!(run["kind"], "review-spec");
    assert_eq!(
        run["result"]["assistantText"],
        "reviewed by rust special agent"
    );
    assert_eq!(
        run["result"]["payloads"][0]["text"],
        "reviewed by rust special agent"
    );

    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured special agent request");
    assert!(request.contains("check this plan"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_openai_models_compat_lists_agent_models() {
    let runtime_root = unique_test_runtime_root("gateway-openai-models");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let response = openai_models_response(&state, None).await;

    assert_eq!(response["object"], "list");
    assert!(response["data"]
        .as_array()
        .expect("model data")
        .iter()
        .any(|model| model["id"] == "crawclaw"));
    assert!(response["data"]
        .as_array()
        .expect("model data")
        .iter()
        .any(|model| model["id"] == "crawclaw/default"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_openai_chat_completions_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-openai-chat-compat");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"chat completion from rust gateway"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let response = openai_chat_completions_response_with_headers(
        &state,
        json!({
            "model": "crawclaw",
            "messages": [
                { "role": "system", "content": "Be concise." },
                { "role": "user", "content": "Say hello from chat compat" }
            ]
        }),
        None,
    )
    .await
    .expect("chat completion response");

    assert_eq!(response["object"], "chat.completion");
    assert_eq!(
        response["choices"][0]["message"]["content"],
        "chat completion from rust gateway"
    );
    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured provider request");
    assert!(request.contains("Say hello from chat compat"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_openai_chat_completions_honors_compat_headers() {
    let runtime_root = unique_test_runtime_root("gateway-openai-chat-compat-headers");
    let (provider_base_url, _request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"chat completion with headers"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let mut headers = HeaderMap::new();
    headers.insert(OPENAI_COMPAT_AGENT_ID_HEADER, "research".parse().unwrap());
    headers.insert(
        OPENAI_COMPAT_SESSION_KEY_HEADER,
        "agent:research:openai-custom".parse().unwrap(),
    );
    headers.insert(
        OPENAI_COMPAT_MESSAGE_CHANNEL_HEADER,
        "webchat".parse().unwrap(),
    );

    let response = openai_chat_completions_response_with_headers(
        &state,
        json!({
            "model": "crawclaw",
            "messages": [{ "role": "user", "content": "Say hello with headers" }]
        }),
        Some(&headers),
    )
    .await
    .expect("chat completion response");

    let run_id = response["id"].as_str().expect("run id");
    let runs = state.agent_run_events.lock().expect("agent run events");
    let events = runs.get(run_id).expect("recorded run events");
    let started = events
        .iter()
        .find(|event| event["type"] == "runStarted")
        .expect("runStarted event");
    assert_eq!(started["agentId"], "research");
    assert_eq!(started["sessionKey"], "agent:research:openai-custom");

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_openresponses_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-openresponses-compat");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"response from rust gateway"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let response = openresponses_response_with_headers(
        &state,
        json!({
            "model": "crawclaw",
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        { "type": "input_text", "text": "Say hello from responses compat" }
                    ]
                }
            ]
        }),
        None,
    )
    .await
    .expect("openresponses response");

    assert_eq!(response["object"], "response");
    assert_eq!(
        response["output"][0]["content"][0]["text"],
        "response from rust gateway"
    );
    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured provider request");
    assert!(request.contains("Say hello from responses compat"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[test]
fn rust_gateway_http_auth_accepts_password_bearer() {
    let runtime_root = unique_test_runtime_root("gateway-http-password-auth");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        auth_token: None,
        auth_password: Some("secret-password".to_string()),
        ..GatewayRunConfig::default()
    });
    let mut headers = HeaderMap::new();
    headers.insert(
        "authorization",
        "Bearer secret-password".parse().expect("header value"),
    );

    assert_eq!(authorize_headers(&headers, &state), Ok(()));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_review_task_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-review-task-runtime");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"gateway review used rust agent runtime"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let run = handle_gateway_method(
        &state,
        "review_task",
        json!({
            "stage": "spec",
            "task": "review gateway task path"
        }),
    )
    .await
    .expect("run review task");

    assert_eq!(run["status"], "completed");
    assert_eq!(run["kind"], "review-spec");
    assert_eq!(
        run["result"]["assistantText"],
        "gateway review used rust agent runtime"
    );
    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured review task request");
    assert!(request.contains("review gateway task path"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_memory_special_agent_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-memory-special-agent-runtime");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"dreamed by rust agent runtime"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let run = handle_gateway_method(
        &state,
        "special_agents.run",
        json!({
            "kind": "dream",
            "scope": "main",
            "task": "consolidate memory"
        }),
    )
    .await
    .expect("run dream special agent");

    assert_eq!(run["status"], "completed");
    assert_eq!(run["kind"], "dream");
    assert_eq!(
        run["result"]["assistantText"],
        "dreamed by rust agent runtime"
    );
    assert_eq!(
        run["result"]["memory"]["summary"],
        "dreamed by rust agent runtime"
    );

    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured dream special agent request");
    assert!(request.contains("consolidate memory"));

    let history = handle_gateway_method(&state, "memory.dream.history", json!({}))
        .await
        .expect("dream history");
    assert_eq!(
        history["history"][0]["summary"],
        "dreamed by rust agent runtime"
    );

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_memory_dream_run_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-memory-dream-runtime");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"dream rpc used rust agent runtime"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let dream = handle_gateway_method(
        &state,
        "memory.dream.run",
        json!({
            "scope": "main",
            "task": "consolidate from memory RPC"
        }),
    )
    .await
    .expect("run dream");

    assert_eq!(dream["status"], "completed");
    assert_eq!(
        dream["result"]["assistantText"],
        "dream rpc used rust agent runtime"
    );
    assert_eq!(
        dream["result"]["memory"]["summary"],
        "dream rpc used rust agent runtime"
    );
    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured memory dream request");
    assert!(request.contains("consolidate from memory RPC"));

    let history = handle_gateway_method(&state, "memory.dream.history", json!({}))
        .await
        .expect("dream history");
    assert_eq!(
        history["history"][0]["summary"],
        "dream rpc used rust agent runtime"
    );

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_memory_session_summary_refresh_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-memory-session-summary-runtime");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"summary generated by rust agent runtime"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let summary = handle_gateway_method(
        &state,
        "memory.session_summary.refresh",
        json!({
            "scope": "main",
            "content": "summarize this session transcript"
        }),
    )
    .await
    .expect("refresh session summary");

    assert_eq!(summary["status"], "completed");
    assert_eq!(summary["kind"], "session-summary");
    assert_eq!(
        summary["result"]["assistantText"],
        "summary generated by rust agent runtime"
    );
    assert!(
        summary["result"]["memory"]["bytesWritten"]
            .as_u64()
            .unwrap_or_default()
            > 0
    );
    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured session summary request");
    assert!(request.contains("summarize this session transcript"));

    let summary_body = std::fs::read_to_string(runtime_root.join("memory/session-summary/main.md"))
        .expect("read session summary file");
    assert!(summary_body.contains("summary generated by rust agent runtime"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_memory_compact_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-memory-compact-runtime");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"compact summary from rust agent runtime"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    handle_gateway_method(
        &state,
        "memory.ingestBatch",
        json!({
            "sessionId": "session-compact",
            "messages": [
                { "id": "m1", "role": "user", "content": "remember the deployment decision" },
                { "id": "m2", "role": "assistant", "content": "deployment decision acknowledged" }
            ]
        }),
    )
    .await
    .expect("ingest messages");

    let compact = handle_gateway_method(
        &state,
        "memory.compact",
        json!({
            "sessionId": "session-compact",
            "force": true
        }),
    )
    .await
    .expect("compact memory");

    assert_eq!(compact["ok"], true);
    assert_eq!(compact["compacted"], true);
    assert_eq!(
        compact["result"]["summary"],
        "compact summary from rust agent runtime"
    );
    assert_eq!(
        compact["result"]["implementation"],
        "rust-native-agent-runtime"
    );
    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured compact request");
    assert!(request.contains("remember the deployment decision"));

    let summary_body =
        std::fs::read_to_string(runtime_root.join("memory/session-summary/session-compact.md"))
            .expect("read compact summary file");
    assert!(summary_body.contains("compact summary from rust agent runtime"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_experience_special_agent_writes_agent_runtime_result() {
    let runtime_root = unique_test_runtime_root("gateway-memory-experience-runtime");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"experience captured by rust agent runtime"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let run = handle_gateway_method(
        &state,
        "special_agents.run",
        json!({
            "kind": "experience",
            "scope": "main",
            "task": "extract an experience note"
        }),
    )
    .await
    .expect("run experience special agent");

    assert_eq!(run["status"], "completed");
    assert_eq!(run["kind"], "experience");
    assert_eq!(
        run["result"]["assistantText"],
        "experience captured by rust agent runtime"
    );
    assert_eq!(
        run["result"]["memory"]["entry"]["body"],
        "experience captured by rust agent runtime"
    );
    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured experience request");
    assert!(request.contains("extract an experience note"));

    let entries = handle_gateway_method(&state, "memory.experience.outbox.list", json!({}))
        .await
        .expect("list experience outbox");
    assert_eq!(
        entries["entries"][0]["body"],
        "experience captured by rust agent runtime"
    );

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_memory_prompt_journal_summary_reads_jsonl() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-prompt-journal-summary");
    let journal_dir = runtime_root.join("journal");
    std::fs::create_dir_all(&journal_dir).expect("create journal dir");
    std::fs::write(
        journal_dir.join("2026-05-10.jsonl"),
        [
            serde_json::to_string(&json!({
                "stage": "prompt_assembly",
                "sessionKey": "s1",
                "dateBucket": "2026-05-10",
                "payload": {
                    "estimatedTokens": 100,
                    "systemContextText": "abcd"
                }
            }))
            .expect("prompt assembly"),
            serde_json::to_string(&json!({
                "stage": "after_turn_decision",
                "sessionId": "s2",
                "dateBucket": "2026-05-10",
                "payload": {
                    "decision": "save",
                    "skipReason": "none"
                }
            }))
            .expect("after turn"),
            serde_json::to_string(&json!({
                "stage": "durable_extraction",
                "sessionKey": "s1",
                "dateBucket": "2026-05-10",
                "payload": {
                    "notesSaved": 2,
                    "reason": "important"
                }
            }))
            .expect("durable saved"),
            serde_json::to_string(&json!({
                "stage": "durable_extraction",
                "sessionKey": "s3",
                "dateBucket": "2026-05-10",
                "payload": {
                    "notesSaved": 0,
                    "reason": "low-signal"
                }
            }))
            .expect("durable skipped"),
            serde_json::to_string(&json!({
                "stage": "experience_extract",
                "sessionKey": "s4",
                "dateBucket": "2026-05-10",
                "payload": {
                    "status": "ok",
                    "decision": "write",
                    "writtenCount": 1,
                    "updatedCount": 2,
                    "deletedCount": 1
                }
            }))
            .expect("experience extract"),
            serde_json::to_string(&json!({
                "stage": "experience_write",
                "sessionKey": "s5",
                "dateBucket": "2026-05-10",
                "payload": {
                    "status": "ok",
                    "action": "updated",
                    "title": "Useful note"
                }
            }))
            .expect("experience write"),
            String::new(),
        ]
        .join("\n"),
    )
    .expect("write journal");
    std::fs::write(
        journal_dir.join("2026-05-09.jsonl"),
        format!(
            "{}\n",
            serde_json::to_string(&json!({
                "stage": "prompt_assembly",
                "sessionKey": "old",
                "dateBucket": "2026-05-09",
                "payload": { "estimatedTokens": 999 }
            }))
            .expect("old journal")
        ),
    )
    .expect("write old journal");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let summary = handle_gateway_method(
        &state,
        "memory.promptJournal.summary",
        json!({ "dir": journal_dir.to_string_lossy(), "days": 1 }),
    )
    .await
    .expect("prompt journal summary");

    assert_eq!(summary["files"].as_array().expect("files").len(), 1);
    assert_eq!(summary["dateBuckets"], json!(["2026-05-10"]));
    assert_eq!(summary["totalEvents"], 6);
    assert_eq!(summary["stageCounts"]["prompt_assembly"], 1);
    assert_eq!(summary["uniqueSessions"], 5);
    assert_eq!(summary["promptAssembly"]["count"], 1);
    assert_eq!(summary["promptAssembly"]["avgEstimatedTokens"], 100.0);
    assert_eq!(summary["promptAssembly"]["avgSystemPromptChars"], 4.0);
    assert_eq!(summary["afterTurn"]["decisionCounts"]["save"], 1);
    assert_eq!(summary["afterTurn"]["skipReasonCounts"]["none"], 1);
    assert_eq!(summary["durableExtraction"]["count"], 2);
    assert_eq!(summary["durableExtraction"]["notesSavedTotal"], 2);
    assert_eq!(summary["durableExtraction"]["nonZeroSaveCount"], 1);
    assert_eq!(summary["durableExtraction"]["zeroSaveCount"], 1);
    assert_eq!(summary["durableExtraction"]["saveRate"], 0.5);
    assert_eq!(
        summary["durableExtraction"]["topReasons"][0],
        json!({ "reason": "important", "count": 1 })
    );
    assert_eq!(summary["experienceExtraction"]["statusCounts"]["ok"], 1);
    assert_eq!(
        summary["experienceExtraction"]["decisionCounts"]["write"],
        1
    );
    assert_eq!(summary["experienceExtraction"]["writtenCount"], 1);
    assert_eq!(summary["experienceExtraction"]["updatedCount"], 2);
    assert_eq!(summary["experienceExtraction"]["deletedCount"], 1);
    assert_eq!(summary["experienceWrite"]["statusCounts"]["ok"], 1);
    assert_eq!(summary["experienceWrite"]["actionCounts"]["updated"], 1);
    assert_eq!(
        summary["experienceWrite"]["titles"][0],
        json!({ "title": "Useful note", "count": 1 })
    );

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_memory_after_turn_ingests_from_native_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-memory-after-turn");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let result = handle_gateway_method(
        &state,
        "memory.afterTurn",
        json!({
            "sessionId": "session-after-turn",
            "sessionKey": "agent:main:after-turn",
            "prePromptMessageCount": 1,
            "messages": [
                { "role": "system", "content": "old context" },
                { "role": "user", "content": "remember this" },
                { "role": "assistant", "content": "stored" }
            ]
        }),
    )
    .await
    .expect("memory after turn");

    assert_eq!(result["status"], "ok");
    assert_eq!(result["ingest"]["ingestedCount"], 2);
    assert_eq!(result["durableExtraction"], true);
    assert_eq!(result["experienceExtraction"], true);

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[test]
fn runtime_status_advertises_rust_core_gateway_methods() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-runtime-status");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let status = runtime_status_value(&state);

    assert_eq!(status["implementation"], "rust-native");
    assert_eq!(status["jsPluginRuntime"], "none");
    assert!(status["gatewayMethods"]
        .as_array()
        .expect("gateway methods")
        .iter()
        .any(|method| method == "sessions.spawn"));
    assert!(status["gatewayMethods"]
        .as_array()
        .expect("gateway methods")
        .iter()
        .any(|method| method == "special_agents.run"));
    assert!(status["gatewayMethods"]
        .as_array()
        .expect("gateway methods")
        .iter()
        .any(|method| method == "plugins.update"));
    assert!(status["gatewayMethods"]
        .as_array()
        .expect("gateway methods")
        .iter()
        .any(|method| method == "plugins.uninstall"));
    assert!(status["coreTools"]
        .as_array()
        .expect("core tools")
        .iter()
        .any(|tool| tool == "sessions_spawn"));
    assert!(status["coreTools"]
        .as_array()
        .expect("core tools")
        .iter()
        .any(|tool| tool == "review_task"));
    for tool_id in [
        "canvas",
        "message",
        "image",
        "pdf",
        "tts",
        "discover_skills",
        "workflow",
        "workflowize",
    ] {
        assert!(
            status["coreTools"]
                .as_array()
                .expect("core tools")
                .iter()
                .any(|tool| tool == tool_id),
            "missing Rust core tool {tool_id}"
        );
    }
    assert!(status["coreTools"]
        .as_array()
        .expect("core tools")
        .iter()
        .any(|tool| tool == "browser"));
    assert!(status["coreTools"]
        .as_array()
        .expect("core tools")
        .iter()
        .any(|tool| tool == "comfyui_workflow"));
    assert!(status["nativePluginDescriptors"]
        .as_array()
        .expect("native plugin descriptors")
        .iter()
        .any(|plugin| plugin["pluginId"] == "browser"));
    assert!(status["nativePluginDescriptors"]
        .as_array()
        .expect("native plugin descriptors")
        .iter()
        .any(|plugin| plugin["pluginId"] == "lobster"));
    assert!(status["nativeWebSearchProviders"]
        .as_array()
        .expect("native web search providers")
        .iter()
        .any(|provider| provider["id"] == "searxng"));
    let tools = tools_catalog(&state, json!({}));
    assert!(tools["groups"]
        .as_array()
        .expect("tool groups")
        .iter()
        .any(|group| group["id"] == "native-plugins"
            && group["tools"]
                .as_array()
                .expect("native tools")
                .iter()
                .any(|tool| tool["id"] == "browser" && tool["pluginId"] == "browser")));
    assert!(tools["groups"]
        .as_array()
        .expect("tool groups")
        .iter()
        .any(|group| group["id"] == "native-plugins"
            && group["tools"]
                .as_array()
                .expect("native tools")
                .iter()
                .any(|tool| tool["id"] == "comfyui_workflow"
                    && tool["approval"]["condition"]["equals"] == "run")));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_plugins_install_update_uninstall_local_path() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-plugin-lifecycle-runtime");
    let source_root = unique_test_runtime_root("gateway-plugin-lifecycle-source");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    std::fs::create_dir_all(&source_root).expect("create plugin source");
    write_json_file(
        &source_root.join("crawclaw.plugin.json"),
        &json!({
            "id": "node-demo",
            "name": "Node Demo",
            "version": "1.0.0",
            "main": "index.mjs"
        }),
    )
    .expect("write source manifest");
    std::fs::write(source_root.join("index.mjs"), "export default {};\n")
        .expect("write source entrypoint");

    let installed = handle_gateway_method(
        &state,
        "plugins.install",
        json!({ "raw": source_root.to_string_lossy() }),
    )
    .await
    .expect("install local plugin");
    assert_eq!(installed["ok"], true);
    assert_eq!(installed["pluginId"], "node-demo");
    assert_eq!(installed["installSource"], "path");
    assert_eq!(installed["requiresRestart"], true);
    let installed_root = runtime_root.join("plugins/node-demo");
    assert!(installed_root.join("crawclaw.plugin.json").exists());
    assert!(installed_root.join("index.mjs").exists());

    let config = read_config_value(&config_path(&state)).expect("read config");
    assert_eq!(
        get_json_path(&config, "plugins.entries.node-demo.enabled"),
        Some(&Value::Bool(true))
    );
    assert!(get_json_path(&config, "plugins.entries.node-demo.source").is_none());
    assert_eq!(
        get_json_path(&config, "plugins.installs.node-demo.source").and_then(Value::as_str),
        Some("path")
    );
    assert_eq!(
        get_json_path(&config, "plugins.installs.node-demo.sourcePath").and_then(Value::as_str),
        Some(source_root.to_string_lossy().as_ref())
    );
    let listed = handle_gateway_method(&state, "plugins.list", json!({}))
        .await
        .expect("list plugins");
    let listed_plugin = listed["plugins"]
        .as_array()
        .expect("plugins")
        .iter()
        .find(|plugin| plugin["id"] == "node-demo")
        .expect("installed plugin in list");
    assert_eq!(listed_plugin["name"], "Node Demo");
    assert_eq!(listed_plugin["version"], "1.0.0");
    assert_eq!(listed_plugin["status"], "installed");
    assert_eq!(listed_plugin["origin"], "local");
    assert_eq!(listed_plugin["installSource"], "path");
    assert_eq!(
        listed_plugin["sourcePath"],
        source_root.to_string_lossy().as_ref()
    );
    assert_eq!(
        listed_plugin["manifestPath"],
        installed_root
            .join("crawclaw.plugin.json")
            .to_string_lossy()
            .as_ref()
    );

    write_json_file(
        &source_root.join("crawclaw.plugin.json"),
        &json!({
            "id": "node-demo",
            "name": "Node Demo",
            "version": "1.1.0",
            "main": "index.mjs"
        }),
    )
    .expect("update source manifest");
    let updated = handle_gateway_method(&state, "plugins.update", json!({ "id": "node-demo" }))
        .await
        .expect("update local plugin");
    assert_eq!(updated["ok"], true);
    assert_eq!(updated["changed"], true);
    assert_eq!(updated["requiresRestart"], true);
    assert_eq!(updated["outcomes"][0]["status"], "updated");
    assert_eq!(updated["outcomes"][0]["currentVersion"], "1.0.0");
    assert_eq!(updated["outcomes"][0]["nextVersion"], "1.1.0");
    let installed_manifest =
        read_json_file(&installed_root.join("crawclaw.plugin.json")).expect("manifest");
    assert_eq!(installed_manifest["version"], "1.1.0");

    let uninstalled =
        handle_gateway_method(&state, "plugins.uninstall", json!({ "id": "node-demo" }))
            .await
            .expect("uninstall local plugin");
    assert_eq!(uninstalled["ok"], true);
    assert_eq!(uninstalled["pluginId"], "node-demo");
    assert!(!installed_root.exists());
    let config = read_config_value(&config_path(&state)).expect("read config");
    assert!(get_json_path(&config, "plugins.entries.node-demo").is_none());
    assert!(get_json_path(&config, "plugins.installs.node-demo").is_none());

    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(source_root);
}

#[tokio::test]
async fn rust_gateway_plugins_list_includes_native_descriptors() {
    let runtime_root = unique_test_runtime_root("gateway-native-plugin-list");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let listed = handle_gateway_method(&state, "plugins.list", json!({}))
        .await
        .expect("plugins list");
    let browser = listed["plugins"]
        .as_array()
        .expect("plugins")
        .iter()
        .find(|plugin| plugin["id"] == "browser")
        .expect("browser native plugin");
    assert_eq!(browser["status"], "available");
    assert_eq!(browser["origin"], "bundled-native");
    assert_eq!(browser["source"], "rust-native");
    assert_eq!(browser["implementation"], "rust-native");
    assert_eq!(browser["nativeDescriptor"]["pluginId"], "browser");

    let lobster = listed["plugins"]
        .as_array()
        .expect("plugins")
        .iter()
        .find(|plugin| plugin["id"] == "lobster")
        .expect("lobster native plugin");
    assert_eq!(lobster["status"], "available");
    assert_eq!(lobster["origin"], "bundled-native");
    assert_eq!(lobster["source"], "rust-native");
    assert_eq!(lobster["implementation"], "rust-native");
    assert_eq!(lobster["nativeDescriptor"]["pluginId"], "lobster");

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[cfg(unix)]
#[tokio::test]
async fn rust_gateway_catalogs_merge_installed_native_sidecar_descriptors() {
    use std::os::unix::fs::PermissionsExt;

    let runtime_root = unique_test_runtime_root("gateway-native-sidecar-registry");
    let plugin_dir = runtime_root.join("plugins").join("acme-native");
    std::fs::create_dir_all(&plugin_dir).expect("plugin dir");
    let sidecar = plugin_dir.join("sidecar.sh");
    std::fs::write(
            &sidecar,
            r#"#!/bin/sh
read line
printf '%s\n' '{"jsonrpc":"2.0","id":"describe","result":{"descriptors":[{"schemaVersion":1,"pluginId":"acme-native","name":"Acme Native","tools":[{"name":"acme_tool","label":"Acme Tool","description":"Runs native work.","parameters":{"type":"object"},"invocation":{"pluginId":"acme-native","operation":"run"},"readOnly":true}],"webSearchProviders":[{"id":"acme-search","label":"Acme Search","invocation":{"pluginId":"acme-native","operation":"search"}}]}]}}'
"#,
        )
        .expect("sidecar");
    let mut permissions = std::fs::metadata(&sidecar).expect("metadata").permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&sidecar, permissions).expect("permissions");
    write_json_file(
        &plugin_dir.join("crawclaw.plugin.json"),
        &json!({
            "id": "acme-native",
            "native": {
                "protocol": "crawclaw-native-plugin-jsonrpc",
                "schemaVersion": 1,
                "bin": "sidecar.sh"
            }
        }),
    )
    .expect("manifest");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let listed = handle_gateway_method(&state, "plugins.list", json!({}))
        .await
        .expect("plugins list");
    assert!(listed["plugins"]
        .as_array()
        .expect("plugins")
        .iter()
        .any(|plugin| plugin["id"] == "acme-native" && plugin["implementation"] == "rust-native"));

    let tools = handle_gateway_method(&state, "tools.catalog", json!({}))
        .await
        .expect("tools catalog");
    assert!(tools["groups"]
        .as_array()
        .expect("groups")
        .iter()
        .any(|group| group["id"] == "native-plugins"
            && group["tools"]
                .as_array()
                .expect("native tools")
                .iter()
                .any(|tool| tool["id"] == "acme_tool" && tool["pluginId"] == "acme-native")));

    let models = handle_gateway_method(&state, "models.list", json!({}))
        .await
        .expect("models list");
    assert!(models["nativeWebSearchProviders"]
        .as_array()
        .expect("native web search providers")
        .iter()
        .any(|provider| provider["id"] == "acme-search"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_plugins_install_resolves_bundled_plugin_id() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-plugin-bundled-install-runtime");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let installed = handle_gateway_method(&state, "plugins.install", json!({ "pluginId": "fal" }))
        .await
        .expect("install bundled plugin");
    assert_eq!(installed["ok"], true);
    assert_eq!(installed["pluginId"], "fal");
    assert_eq!(installed["installSource"], "bundled");
    assert_eq!(
        installed["manifest"]["providerAuthEnvVars"]["fal"],
        json!(["FAL_KEY"])
    );
    assert!(runtime_root
        .join("plugins/fal/crawclaw.plugin.json")
        .exists());
    assert!(!runtime_root.join("plugins/fal/index.ts").exists());

    let config = read_config_value(&config_path(&state)).expect("read config");
    assert_eq!(
        get_json_path(&config, "plugins.installs.fal.source").and_then(Value::as_str),
        Some("bundled")
    );
    assert!(get_json_path(&config, "plugins.installs.fal.sourcePath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .ends_with("extensions/fal"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_plugins_install_update_npm_file_spec() {
    let _guard = env_lock().lock().expect("env lock");
    if Command::new("npm").arg("--version").output().is_err() {
        return;
    }
    let runtime_root = unique_test_runtime_root("gateway-plugin-npm-runtime");
    let source_root = unique_test_runtime_root("gateway-plugin-npm-source");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    std::fs::create_dir_all(&source_root).expect("create npm package source");
    write_json_file(
        &source_root.join("package.json"),
        &json!({
            "name": "npm-demo",
            "version": "1.0.0",
            "dependencies": {
                "local-dep": "file:dep"
            }
        }),
    )
    .expect("write package");
    let dep_root = source_root.join("dep");
    std::fs::create_dir_all(&dep_root).expect("create local dependency");
    write_json_file(
        &dep_root.join("package.json"),
        &json!({
            "name": "local-dep",
            "version": "1.0.0"
        }),
    )
    .expect("write dependency package");
    write_json_file(
        &source_root.join("crawclaw.plugin.json"),
        &json!({
            "id": "npm-demo",
            "name": "NPM Demo",
            "version": "1.0.0",
            "native": {
                "protocol": "crawclaw-native-plugin-jsonrpc",
                "schemaVersion": 1,
                "bin": "sidecar"
            }
        }),
    )
    .expect("write manifest");
    std::fs::write(source_root.join("index.mjs"), "export default {};\n")
        .expect("write source entrypoint");
    let spec = format!("file:{}", source_root.to_string_lossy());

    let installed = handle_gateway_method(&state, "plugins.install", json!({ "raw": spec }))
        .await
        .expect("install npm file spec");
    assert_eq!(installed["ok"], true);
    assert_eq!(installed["pluginId"], "npm-demo");
    assert_eq!(installed["installSource"], "npm");
    let installed_root = runtime_root.join("plugins/npm-demo");
    assert!(installed_root.join("package.json").exists());
    assert!(installed_root.join("crawclaw.plugin.json").exists());
    assert!(
        !installed_root.join("node_modules").exists(),
        "native plugin install must not run npm install for package dependencies"
    );

    let config = read_config_value(&config_path(&state)).expect("read config");
    assert_eq!(
        get_json_path(&config, "plugins.installs.npm-demo.source").and_then(Value::as_str),
        Some("npm")
    );
    assert_eq!(
        get_json_path(&config, "plugins.installs.npm-demo.resolvedName").and_then(Value::as_str),
        Some("npm-demo")
    );
    assert!(get_json_path(&config, "plugins.installs.npm-demo.integrity").is_some());

    write_json_file(
        &source_root.join("package.json"),
        &json!({
            "name": "npm-demo",
            "version": "1.1.0",
            "dependencies": {
                "local-dep": "file:dep"
            }
        }),
    )
    .expect("update package");
    write_json_file(
        &source_root.join("crawclaw.plugin.json"),
        &json!({
            "id": "npm-demo",
            "name": "NPM Demo",
            "version": "1.1.0",
            "native": {
                "protocol": "crawclaw-native-plugin-jsonrpc",
                "schemaVersion": 1,
                "bin": "sidecar"
            }
        }),
    )
    .expect("update manifest");
    let updated = handle_gateway_method(
        &state,
        "plugins.update",
        json!({ "id": "npm-demo", "force": true }),
    )
    .await
    .expect("update npm file spec");
    assert_eq!(updated["ok"], true);
    assert_eq!(updated["changed"], true);
    assert_eq!(updated["outcomes"][0]["status"], "updated");
    assert_eq!(updated["outcomes"][0]["currentVersion"], "1.0.0");
    assert_eq!(updated["outcomes"][0]["nextVersion"], "1.1.0");
    let installed_manifest =
        read_json_file(&installed_root.join("crawclaw.plugin.json")).expect("manifest");
    assert_eq!(installed_manifest["version"], "1.1.0");
    assert!(
        !installed_root.join("node_modules").exists(),
        "native plugin update must not run npm install for package dependencies"
    );

    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(source_root);
}

#[tokio::test]
async fn rust_gateway_plugins_install_rejects_package_only_plugin() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-package-only-plugin-runtime");
    let source_root = unique_test_runtime_root("gateway-package-only-plugin-source");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    std::fs::create_dir_all(&source_root).expect("create package source");
    write_json_file(
        &source_root.join("package.json"),
        &json!({
            "name": "package-only-demo",
            "version": "1.0.0"
        }),
    )
    .expect("write package");

    let error = handle_gateway_method(
        &state,
        "plugins.install",
        json!({ "raw": source_root.to_string_lossy() }),
    )
    .await
    .expect_err("package-only plugin should fail");
    assert!(error.contains("missing crawclaw.plugin.json"));

    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(source_root);
}

#[tokio::test]
async fn rust_gateway_plugins_install_local_marketplace() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-plugin-marketplace-runtime");
    let marketplace_root = unique_test_runtime_root("gateway-plugin-marketplace-source");
    let plugin_root = marketplace_root.join("plugins/market-demo");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    std::fs::create_dir_all(&plugin_root).expect("create marketplace plugin");
    write_json_file(
        &marketplace_root.join("marketplace.json"),
        &json!({
            "name": "Local Marketplace",
            "plugins": [
                {
                    "name": "market-demo",
                    "version": "2.0.0",
                    "source": "plugins/market-demo"
                }
            ]
        }),
    )
    .expect("write marketplace");
    write_json_file(
        &plugin_root.join("crawclaw.plugin.json"),
        &json!({
            "id": "market-demo",
            "name": "Market Demo",
            "version": "2.0.0"
        }),
    )
    .expect("write plugin manifest");

    let installed = handle_gateway_method(
        &state,
        "plugins.install",
        json!({
            "marketplaceSource": marketplace_root.to_string_lossy(),
            "marketplacePlugin": "market-demo"
        }),
    )
    .await
    .expect("install marketplace plugin");
    assert_eq!(installed["ok"], true);
    assert_eq!(installed["pluginId"], "market-demo");
    assert_eq!(installed["installSource"], "marketplace");

    let config = read_config_value(&config_path(&state)).expect("read config");
    assert_eq!(
        get_json_path(&config, "plugins.installs.market-demo.source").and_then(Value::as_str),
        Some("marketplace")
    );
    assert_eq!(
        get_json_path(&config, "plugins.installs.market-demo.marketplacePlugin")
            .and_then(Value::as_str),
        Some("market-demo")
    );

    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(marketplace_root);
}

#[tokio::test]
async fn rust_gateway_approval_methods_track_pending_decisions() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-approvals");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let requested = handle_gateway_method(
        &state,
        "exec.approval.request",
        json!({
            "id": "approval-1",
            "command": "pnpm test",
            "twoPhase": true
        }),
    )
    .await
    .expect("exec approval request");
    assert_eq!(requested["status"], "accepted");
    assert_eq!(requested["id"], "approval-1");
    assert!(requested["createdAtMs"].as_u64().is_some());
    assert!(requested["expiresAtMs"].as_u64().is_some());

    let resolved = handle_gateway_method(
        &state,
        "exec.approval.resolve",
        json!({ "id": "approval-1", "decision": "allow-once" }),
    )
    .await
    .expect("exec approval resolve");
    assert_eq!(resolved["ok"], true);

    let waited = handle_gateway_method(
        &state,
        "exec.approval.waitDecision",
        json!({ "id": "approval-1" }),
    )
    .await
    .expect("exec approval wait");
    assert_eq!(waited["id"], "approval-1");
    assert_eq!(waited["decision"], "allow-once");
    assert!(waited["createdAtMs"].as_u64().is_some());
    assert!(waited["expiresAtMs"].as_u64().is_some());

    let plugin_requested = handle_gateway_method(
        &state,
        "plugin.approval.request",
        json!({
            "pluginId": "local-plugin",
            "title": "Run plugin tool",
            "description": "Plugin wants to call a write tool.",
            "twoPhase": true
        }),
    )
    .await
    .expect("plugin approval request");
    assert_eq!(plugin_requested["status"], "accepted");
    let plugin_id = plugin_requested["id"]
        .as_str()
        .expect("plugin approval id")
        .to_string();
    assert!(plugin_id.starts_with("plugin:"));

    handle_gateway_method(
        &state,
        "plugin.approval.resolve",
        json!({ "id": plugin_id, "decision": "deny" }),
    )
    .await
    .expect("plugin approval resolve");
    let plugin_waited = handle_gateway_method(
        &state,
        "plugin.approval.waitDecision",
        json!({ "id": plugin_requested["id"] }),
    )
    .await
    .expect("plugin approval wait");
    assert_eq!(plugin_waited["decision"], "deny");

    let missing = handle_gateway_method(
        &state,
        "exec.approval.waitDecision",
        json!({ "id": "missing-approval" }),
    )
    .await;
    assert!(missing
        .expect_err("missing approval should fail")
        .contains("approval expired or not found"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_identity_get_reads_and_repairs_device_identity() {
    let _guard = env_lock().lock().expect("env lock");
    let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
    let runtime_root = unique_test_runtime_root("gateway-identity-runtime");
    let state_dir = unique_test_runtime_root("gateway-identity-state");
    env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
    std::fs::create_dir_all(state_dir.join("identity")).expect("create identity dir");
    let public_key_pem = [
        "-----BEGIN PUBLIC KEY-----",
        "MCowBQYDK2VwAyEAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        "-----END PUBLIC KEY-----",
        "",
    ]
    .join("\n");
    write_json_file(
        &state_dir.join("identity/device.json"),
        &json!({
            "version": 1,
            "deviceId": "stale-device-id",
            "publicKeyPem": public_key_pem,
            "privateKeyPem": "test-private-key",
            "createdAtMs": 1
        }),
    )
    .expect("write identity");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let identity = handle_gateway_method(&state, "gateway.identity.get", json!({}))
        .await
        .expect("gateway identity");

    assert_eq!(
        identity["deviceId"],
        "72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793"
    );
    assert_eq!(
        identity["publicKey"],
        "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"
    );
    let stored = read_config_value(&state_dir.join("identity/device.json")).expect("read identity");
    assert_eq!(stored["deviceId"], identity["deviceId"]);

    match previous_state_dir {
        Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
        None => env::remove_var("CRAWCLAW_STATE_DIR"),
    }
    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(state_dir);
}

#[tokio::test]
async fn rust_gateway_agent_runtime_reports_session_store_state() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-agent-runtime-state");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    handle_gateway_method(
        &state,
        "sessions.create",
        json!({ "key": "main", "label": "Main Agent" }),
    )
    .await
    .expect("create main session");
    handle_gateway_method(
        &state,
        "sessions.patch",
        json!({ "key": "agent:main:main", "status": "running" }),
    )
    .await
    .expect("mark main running");
    let spawned = handle_gateway_method(
        &state,
        "sessions.spawn",
        json!({
            "parentSessionKey": "agent:main:main",
            "label": "Review worker",
            "task": "review the gateway state"
        }),
    )
    .await
    .expect("spawn subagent session");
    let spawned_key = spawned["session"]["key"].as_str().expect("spawned key");

    let summary = handle_gateway_method(&state, "agentRuntime.summary", json!({}))
        .await
        .expect("runtime summary");
    assert_eq!(summary["running"], 1);
    assert_eq!(summary["waiting"], 1);
    assert_eq!(summary["completed"], 0);
    assert_eq!(summary["byCategory"]["cli"], 1);
    assert_eq!(summary["byCategory"]["subagents"], 1);

    let list = handle_gateway_method(&state, "agentRuntime.list", json!({ "limit": 10 }))
        .await
        .expect("runtime list");
    assert_eq!(list["count"], 2);
    assert!(list["runs"]
        .as_array()
        .expect("runs")
        .iter()
        .any(|run| run["taskId"] == spawned_key && run["category"] == "subagents"));

    let detail =
        handle_gateway_method(&state, "agentRuntime.get", json!({ "taskId": spawned_key }))
            .await
            .expect("runtime get");
    assert_eq!(detail["run"]["taskId"], spawned_key);
    assert_eq!(detail["run"]["status"], "spawned");
    assert_eq!(detail["availableActions"]["openSession"], true);
    assert_eq!(detail["availableActions"]["cancel"], true);

    let inspection =
        handle_gateway_method(&state, "agent.inspect", json!({ "runId": spawned_key }))
            .await
            .expect("agent inspect");
    assert_eq!(inspection["runId"], spawned_key);
    assert_eq!(inspection["taskId"], spawned_key);
    assert_eq!(inspection["run"]["category"], "subagents");
    assert_eq!(inspection["refs"]["transcriptRef"], spawned_key);

    let waited = handle_gateway_method(&state, "agent.wait", json!({ "runId": spawned_key }))
        .await
        .expect("agent wait");
    assert_eq!(waited["runId"], spawned_key);
    assert_eq!(waited["status"], "running");

    let missing = handle_gateway_method(
        &state,
        "agentRuntime.get",
        json!({ "taskId": "missing-runtime-task" }),
    )
    .await;
    assert!(missing
        .expect_err("missing runtime task should fail")
        .contains("Task not found: missing-runtime-task"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_chat_send_uses_native_provider_runtime() {
    let runtime_root = unique_test_runtime_root("gateway-chat-native-provider");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"hello from rust provider"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    let session_key = "agent:main:main";
    let sessions_dir = runtime_root.join("sessions");
    std::fs::create_dir_all(&sessions_dir).expect("sessions dir");
    std::fs::write(
        sessions_dir.join(format!("{session_key}.jsonl")),
        [
            r#"{"role":"user","content":"previous user"}"#,
            r#"{"role":"assistant","content":"previous assistant"}"#,
        ]
        .join("\n"),
    )
    .expect("seed transcript");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let result = handle_gateway_method(
        &state,
        "chat.send",
        json!({
            "sessionKey": session_key,
            "message": "hello gateway",
            "idempotencyKey": "native-provider-run"
        }),
    )
    .await
    .expect("chat send");

    assert_eq!(result["status"], "completed");
    assert_eq!(result["message"]["content"], "hello from rust provider");
    assert_eq!(result["events"][0]["type"], "runStarted");
    assert_eq!(result["events"][1]["type"], "replyPayload");
    assert_eq!(
        result["events"][1]["payload"]["text"],
        "hello from rust provider"
    );
    assert_eq!(result["events"][3]["type"], "toolResult");
    assert_eq!(result["events"][3]["toolName"], "memory.afterTurn");
    assert_eq!(result["events"][4]["type"], "runCompleted");
    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured native provider request");
    assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
    assert!(request.contains("authorization: Bearer test-key"));
    assert!(request.contains(r#""model":"test-model""#));
    assert!(request.contains("previous user"));
    assert!(request.contains("previous assistant"));
    assert!(request.contains("hello gateway"));

    let transcript = std::fs::read_to_string(sessions_dir.join(format!("{session_key}.jsonl")))
        .expect("updated transcript");
    assert!(transcript.contains("hello gateway"));
    assert!(transcript.contains("hello from rust provider"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_agent_run_turn_returns_native_event_contract() {
    let runtime_root = unique_test_runtime_root("gateway-agent-run-turn");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"hello from agent run turn"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let result = handle_gateway_method(
        &state,
        "agent.runTurn",
        json!({
            "runId": "agent-run-turn-1",
            "agentId": "main",
            "sessionKey": "agent:main:turn",
            "inbound": {
                "channel": "gateway",
                "accountId": "local",
                "from": "user",
                "to": "agent:main",
                "chatType": "direct",
                "body": "hello run turn",
                "rawBody": "hello run turn",
                "messageId": "in-1",
                "threadId": "agent:main:turn"
            }
        }),
    )
    .await
    .expect("agent run turn");

    assert_eq!(result["ok"], true);
    assert_eq!(result["runId"], "agent-run-turn-1");
    assert_eq!(result["sessionKey"], "agent:main:turn");
    assert_eq!(result["assistantText"], "hello from agent run turn");
    assert_eq!(result["events"][0]["type"], "runStarted");
    assert_eq!(result["events"][1]["type"], "replyPayload");
    assert_eq!(
        result["events"][1]["payload"]["text"],
        "hello from agent run turn"
    );
    assert_eq!(result["events"][3]["type"], "toolResult");
    assert_eq!(result["events"][3]["toolName"], "memory.afterTurn");
    assert_eq!(result["events"][4]["type"], "runCompleted");

    let streamed = handle_gateway_method(
        &state,
        "agent.streamEvents",
        json!({ "runId": "agent-run-turn-1" }),
    )
    .await
    .expect("stream agent events");
    assert_eq!(streamed["ok"], true);
    assert_eq!(streamed["runId"], "agent-run-turn-1");
    assert_eq!(streamed["events"], result["events"]);

    let cancelled = handle_gateway_method(
        &state,
        "agent.cancel",
        json!({ "sessionKey": "agent:main:turn", "runId": "agent-run-turn-1" }),
    )
    .await
    .expect("cancel completed agent run");
    assert_eq!(cancelled["ok"], true);
    assert_eq!(cancelled["aborted"], false);
    assert_eq!(cancelled["runIds"], json!(["agent-run-turn-1"]));

    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured native provider request");
    assert!(request.contains("hello run turn"));

    let transcript =
        std::fs::read_to_string(runtime_root.join("sessions").join("agent:main:turn.jsonl"))
            .expect("updated transcript");
    assert!(transcript.contains("hello run turn"));
    assert!(transcript.contains("hello from agent run turn"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_channel_inbound_handle_runs_native_agent_turn() {
    let runtime_root = unique_test_runtime_root("gateway-channel-inbound-handle");
    let (provider_base_url, request_rx) = serve_openai_compatible_once(
        r#"{"choices":[{"message":{"content":"hello from inbound handler"}}]}"#,
    );
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let result = handle_gateway_method(
        &state,
        "channel.inbound.handle",
        json!({
            "runId": "inbound-run-1",
            "agentId": "main",
            "inbound": {
                "channel": "feishu",
                "accountId": "default",
                "from": "feishu:123",
                "to": "agent:main",
                "chatType": "direct",
                "body": "hello inbound",
                "rawBody": "hello inbound",
                "messageId": "fs-1",
                "threadId": "agent:main:feishu:123"
            }
        }),
    )
    .await
    .expect("channel inbound handle");

    assert_eq!(result["ok"], true);
    assert_eq!(result["runId"], "inbound-run-1");
    assert_eq!(result["sessionKey"], "agent:main:feishu:123");
    assert_eq!(result["assistantText"], "hello from inbound handler");
    assert_eq!(result["events"][0]["type"], "runStarted");
    assert_eq!(result["events"][1]["type"], "replyPayload");
    assert_eq!(result["events"][3]["type"], "toolResult");
    assert_eq!(result["events"][3]["toolName"], "memory.afterTurn");
    assert_eq!(result["events"][4]["type"], "runCompleted");

    let streamed = handle_gateway_method(
        &state,
        "agent.streamEvents",
        json!({ "runId": "inbound-run-1" }),
    )
    .await
    .expect("stream inbound events");
    assert_eq!(streamed["events"], result["events"]);

    let request = request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured native provider request");
    assert!(request.contains("hello inbound"));

    let transcript = std::fs::read_to_string(
        runtime_root
            .join("sessions")
            .join("agent:main:feishu:123.jsonl"),
    )
    .expect("updated transcript");
    assert!(transcript.contains("hello inbound"));
    assert!(transcript.contains("hello from inbound handler"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_models_list_uses_provider_descriptors() {
    let runtime_root = unique_test_runtime_root("gateway-model-descriptors");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let models = handle_gateway_method(&state, "models.list", json!({}))
        .await
        .expect("models list");
    assert!(models["models"]
        .as_array()
        .expect("models")
        .iter()
        .any(|model| model["id"] == "gpt-5.4"
            && model["provider"] == "openai"
            && model["source"] == "rust-native"));
    assert!(models["models"]
        .as_array()
        .expect("models")
        .iter()
        .any(
            |model| model["provider"] == "anthropic" && model["transport"] == "anthropic-messages"
        ));
    assert!(models["providerDescriptors"]
        .as_array()
        .expect("provider descriptors")
        .iter()
        .any(|provider| provider["provider"] == "openai"
            && provider["transport"] == "openai-responses"));
    assert!(models["providerDescriptors"]
        .as_array()
        .expect("provider descriptors")
        .iter()
        .any(|provider| provider["provider"] == "fal"
            && provider["kind"] == "image-generation"
            && provider["transport"].is_null()));
    assert!(models["providerSetupOptions"]
        .as_array()
        .expect("provider setup options")
        .iter()
        .any(|choice| choice["provider"] == "openai"
            && choice["method"] == "api-key"
            && choice["value"] == "openai-api-key"));
    assert!(models["providerModelPickerEntries"]
        .as_array()
        .expect("provider model picker entries")
        .iter()
        .any(|entry| entry["provider"] == "ollama"
            && entry["value"] == "provider-plugin:ollama:local"));
    assert!(models["webProviderBoundaries"]
        .as_array()
        .expect("web provider boundaries")
        .iter()
        .any(|entry| entry["surface"] == "web-search"
            && entry["provider"] == "searxng"
            && entry["productBoundary"] == "rust-native-plugin"
            && entry["executionRuntime"] == "python-sidecar"
            && entry["runtimeMajor"].is_null()));
    assert!(models["nativeWebFetchProviders"]
        .as_array()
        .expect("native web fetch providers")
        .iter()
        .any(|provider| provider["id"] == "spider"));
    assert!(models["nativeSpeechProviders"]
        .as_array()
        .expect("native speech providers")
        .iter()
        .any(|provider| provider["id"] == "qwen3-tts"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_config_schema_uses_provider_registry() {
    let runtime_root = unique_test_runtime_root("gateway-provider-config-schema");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let schema = handle_gateway_method(&state, "config.schema", json!({}))
        .await
        .expect("config schema");
    assert_eq!(schema["version"], "rust-provider-config-v1");
    assert_eq!(
        schema["schema"]["properties"]["models"]["properties"]["providers"]["additionalProperties"]
            ["properties"]["api"]["enum"],
        json!([
            "openai-completions",
            "openai-responses",
            "openai-codex-responses",
            "anthropic-messages",
            "google-generative-ai",
            "github-copilot",
            "bedrock-converse-stream",
            "ollama",
            "azure-openai-responses"
        ])
    );
    assert_eq!(
        schema["uiHints"]["models.providers.*.apiKey"]["sensitive"],
        true
    );
    assert!(schema["uiHints"].get("plugins.entries.*.hooks").is_none());

    let lookup = handle_gateway_method(
        &state,
        "config.schema.lookup",
        json!({ "path": "models.providers.*" }),
    )
    .await
    .expect("provider lookup");
    assert!(lookup["children"]
        .as_array()
        .expect("children")
        .iter()
        .any(|child| child["path"] == "models.providers.*.models"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_update_run_reports_git_state_instead_of_noop() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-update-run-state");
    std::fs::create_dir_all(&runtime_root).expect("create update root");
    run_git_test_command(&runtime_root, &["init", "-q"]);
    run_git_test_command(&runtime_root, &["config", "user.email", "test@example.com"]);
    run_git_test_command(&runtime_root, &["config", "user.name", "Test User"]);
    std::fs::write(
        runtime_root.join("package.json"),
        "{\"name\":\"crawclaw\",\"version\":\"0.0.0\"}\n",
    )
    .expect("write package");
    run_git_test_command(&runtime_root, &["add", "package.json"]);
    run_git_test_command(&runtime_root, &["commit", "-q", "-m", "init"]);

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let update = handle_gateway_method(&state, "update.run", json!({}))
        .await
        .expect("update run");

    assert_eq!(update["ok"], true);
    assert_ne!(update["status"], "noop");
    assert_eq!(update["result"]["status"], "skipped");
    assert_eq!(update["result"]["mode"], "git");
    assert_eq!(update["result"]["reason"], "no-upstream");
    assert!(update["result"]["steps"]
        .as_array()
        .expect("steps")
        .iter()
        .any(|step| step["name"] == "clean check"));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_replaces_high_priority_placeholders_with_local_results() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-high-priority-placeholders");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    handle_gateway_method(
        &state,
        "sessions.create",
        json!({ "key": "main", "label": "Rust Main" }),
    )
    .await
    .expect("create runtime session");
    let runtime_task =
        handle_gateway_method(&state, "agentRuntime.get", json!({ "taskId": "main" }))
            .await
            .expect("agent runtime get");
    assert_eq!(runtime_task["run"]["taskId"], "agent:main:main");
    assert_eq!(runtime_task["run"]["runtime"], "desktop-session");
    assert_eq!(runtime_task["availableActions"]["openSession"], true);

    let installed_skill = handle_gateway_method(
        &state,
        "skills.install",
        json!({
            "skillKey": "local-skill",
            "content": "---\nname: local-skill\n---\n# Local Skill\n"
        }),
    )
    .await
    .expect("install skill");
    assert_eq!(installed_skill["ok"], true);
    assert!(runtime_root.join("skills/local-skill/SKILL.md").exists());
    let skills = handle_gateway_method(&state, "skills.status", json!({}))
        .await
        .expect("skills status");
    assert!(skills["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .any(|skill| skill["skillKey"] == "local-skill"));

    let installed_plugin = handle_gateway_method(
        &state,
        "plugins.install",
        json!({
            "pluginId": "local-plugin",
            "manifest": {
                "id": "local-plugin",
                "name": "Local Plugin",
                "version": "0.0.0"
            }
        }),
    )
    .await
    .expect("install plugin");
    assert_eq!(installed_plugin["ok"], true);
    assert!(runtime_root
        .join("plugins/local-plugin/crawclaw.plugin.json")
        .exists());

    let (tts_base_url, tts_request_rx) = serve_qwen3_tts_sidecar(2);
    handle_gateway_method(
        &state,
        "config.patch",
        json!({
            "patch": {
                "messages": {
                    "tts": {
                        "provider": "qwen3-tts",
                        "providers": {
                            "qwen3-tts": {
                                "enabled": true,
                                "baseUrl": tts_base_url,
                                "autoStart": false,
                                "defaultProfile": "assistant",
                                "profiles": {
                                    "assistant": {
                                        "source": "preset",
                                        "voice": "vivian"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }),
    )
    .await
    .expect("configure qwen3 tts");
    let tts = handle_gateway_method(&state, "tts.convert", json!({ "text": "hello" }))
        .await
        .expect("tts convert");
    assert_eq!(tts["status"], "generated");
    assert_eq!(tts["outputFormat"], "wav");
    assert_eq!(tts["audio"]["base64"], "aGVsbG8=");

    let talk = handle_gateway_method(&state, "talk.speak", json!({ "text": "hello" }))
        .await
        .expect("talk speak");
    assert_eq!(talk["ok"], true);
    assert_eq!(talk["status"], "generated");
    let tts_request = tts_request_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("captured tts request");
    assert!(tts_request.contains("\"text\":\"hello\""));

    let send = handle_gateway_method(
        &state,
        "send",
        json!({ "channel": "weixin", "to": "filehelper", "text": "hello" }),
    )
    .await
    .expect("send");
    assert_eq!(send["deliveryStatus"], "blocked");
    assert_eq!(send["sent"], false);

    let esp32 = handle_gateway_method(
        &state,
        "esp32.devices.get",
        json!({ "deviceId": "esp32-1" }),
    )
    .await
    .expect("esp32 get");
    assert_eq!(esp32["status"], "not_found");

    let esp32_command = handle_gateway_method(
        &state,
        "esp32.devices.command.send",
        json!({ "deviceId": "esp32-1", "command": "ping" }),
    )
    .await
    .expect("esp32 command");
    assert_eq!(esp32_command["status"], "queued");

    let workflow_root = runtime_root.join("workflows");
    std::fs::create_dir_all(workflow_root.join("specs")).expect("create workflow root");
    write_json_file(
        &workflow_root.join("registry.json"),
        &json!({
            "version": 1,
            "workflows": [{
                "workflowId": "daily-check",
                "name": "Daily Check",
                "enabled": true,
                "deploymentState": "deployed",
                "safeForAutoRun": true,
                "createdAt": 1,
                "updatedAt": 1
            }]
        }),
    )
    .expect("write workflow registry");
    write_json_file(
        &workflow_root.join("specs/daily-check.json"),
        &json!({
            "workflowId": "daily-check",
            "name": "Daily Check",
            "goal": "summarize local state",
            "steps": [{"id": "draft", "kind": "crawclaw_agent"}]
        }),
    )
    .expect("write workflow spec");
    write_json_file(
        &workflow_root.join("executions.json"),
        &json!({
            "version": 1,
            "executions": [{
                "executionId": "exec-daily-check",
                "workflowId": "daily-check",
                "workflowName": "Daily Check",
                "status": "running",
                "steps": [{
                    "stepId": "draft",
                    "status": "running",
                    "executor": "crawclaw_agent"
                }]
            }]
        }),
    )
    .expect("write workflow executions");

    let workflow =
        handle_gateway_method(&state, "workflow.get", json!({ "workflow": "daily-check" }))
            .await
            .expect("workflow get");
    assert_eq!(workflow["workflow"]["workflowId"], "daily-check");

    let workflow_agent = handle_gateway_method(
        &state,
        "workflow.agent.run",
        json!({
            "workflow": "daily-check",
            "executionId": "exec-daily-check",
            "stepId": "draft",
            "goal": "summarize local state"
        }),
    )
    .await
    .expect("workflow agent run");
    assert_eq!(workflow_agent["status"], "running");
    assert!(workflow_agent["session"]["key"].is_string());

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_tts_methods_report_native_provider_catalog() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-tts-provider-catalog");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    handle_gateway_method(
        &state,
        "config.patch",
        json!({
            "patch": {
                "messages": {
                    "tts": {
                        "providers": {
                            "qwen3-tts": { "enabled": true }
                        }
                    }
                }
            }
        }),
    )
    .await
    .expect("enable qwen3 tts");

    let providers = handle_gateway_method(&state, "tts.providers", json!({}))
        .await
        .expect("tts providers");
    let qwen = providers["providers"]
        .as_array()
        .expect("providers")
        .iter()
        .find(|provider| provider["id"] == "qwen3-tts")
        .expect("qwen3 provider");
    assert_eq!(qwen["name"], "Qwen3-TTS (local)");
    assert_eq!(qwen["configured"], true);
    assert!(qwen["models"]
        .as_array()
        .expect("models")
        .iter()
        .any(|model| model == "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"));
    assert!(qwen["voices"]
        .as_array()
        .expect("voices")
        .iter()
        .any(|voice| voice == "serena"));

    let invalid = handle_gateway_method(
        &state,
        "tts.setProvider",
        json!({ "provider": "missing-provider" }),
    )
    .await;
    assert!(invalid
        .expect_err("invalid provider should fail")
        .contains("Invalid provider"));

    let selected = handle_gateway_method(
        &state,
        "tts.setProvider",
        json!({ "provider": "qwen3-tts" }),
    )
    .await
    .expect("set provider");
    assert_eq!(selected["provider"], "qwen3-tts");

    let status = handle_gateway_method(&state, "tts.status", json!({}))
        .await
        .expect("tts status");
    assert_eq!(status["provider"], "qwen3-tts");
    assert!(status["providerStates"]
        .as_array()
        .expect("provider states")
        .iter()
        .any(|provider| provider["id"] == "qwen3-tts" && provider["configured"] == true));

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_system_event_updates_presence_snapshot() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-system-presence");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let initial_presence = handle_gateway_method(&state, "system-presence", json!({}))
        .await
        .expect("initial system presence");
    assert!(initial_presence
        .as_array()
        .expect("initial presence array")
        .iter()
        .any(|entry| entry["mode"] == "gateway" && entry["reason"] == "self"));
    assert!(hello_ok(&state)["snapshot"]["presence"]
        .as_array()
        .expect("hello presence array")
        .iter()
        .any(|entry| entry["mode"] == "gateway" && entry["reason"] == "self"));

    let missing = handle_gateway_method(&state, "system-event", json!({})).await;
    assert!(missing
        .expect_err("empty system-event should fail")
        .contains("text required"));

    let event = handle_gateway_method(
        &state,
        "system-event",
        json!({
            "text": "desktop awake",
            "deviceId": "device-1",
            "host": "macbook",
            "ip": "100.64.0.2",
            "version": "2026.5.3",
            "mode": "desktop",
            "reason": "active",
            "lastInputSeconds": 4,
            "roles": ["desktop"],
            "scopes": ["operator.admin"]
        }),
    )
    .await
    .expect("system event");
    assert_eq!(event["ok"], true);

    let presence = handle_gateway_method(&state, "system-presence", json!({}))
        .await
        .expect("system presence");
    let entries = presence.as_array().expect("presence array");
    let entry = entries
        .iter()
        .find(|entry| entry["deviceId"] == "device-1")
        .expect("device presence");
    assert_eq!(entry["host"], "macbook");
    assert_eq!(entry["ip"], "100.64.0.2");
    assert_eq!(entry["mode"], "desktop");
    assert_eq!(entry["lastInputSeconds"], 4);
    assert_eq!(entry["roles"][0], "desktop");

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_esp32_methods_track_local_state_files() {
    let _guard = env_lock().lock().expect("env lock");
    let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
    let runtime_root = unique_test_runtime_root("gateway-esp32-runtime");
    let state_dir = unique_test_runtime_root("gateway-esp32-state");
    env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
    std::fs::create_dir_all(state_dir.join("devices")).expect("create devices dir");
    std::fs::create_dir_all(state_dir.join("esp32")).expect("create esp32 dir");
    let now = now_millis() as u64;
    write_json_file(
        &state_dir.join("crawclaw.json"),
        &json!({
            "plugins": {
                "entries": {
                    "esp32": {
                        "enabled": true,
                        "config": {
                            "broker": {
                                "bindHost": "0.0.0.0",
                                "port": 1883,
                                "advertisedHost": "127.0.0.1"
                            },
                            "udp": {
                                "bindHost": "0.0.0.0",
                                "port": 1884,
                                "advertisedHost": "127.0.0.1"
                            },
                            "renderer": { "model": "openai/gpt-5.4-mini" },
                            "tools": { "allowlist": ["display.*"] }
                        }
                    }
                }
            }
        }),
    )
    .expect("write config");
    write_json_file(
        &state_dir.join("devices/pending.json"),
        &json!({
            "req-esp32": {
                "requestId": "req-esp32",
                "deviceId": "esp32-2",
                "publicKey": "fingerprint-2",
                "displayName": "Desk Pending",
                "role": "esp32",
                "roles": ["esp32"],
                "scopes": ["device.esp32"],
                "deviceFamily": "ESP32-S3-BOX-3",
                "clientMode": "mqtt-udp",
                "ts": now
            },
            "req-other": {
                "requestId": "req-other",
                "deviceId": "other-1",
                "publicKey": "other-key",
                "deviceFamily": "other",
                "clientMode": "other",
                "ts": now - 1
            }
        }),
    )
    .expect("write pending");
    write_json_file(
        &state_dir.join("devices/paired.json"),
        &json!({
            "esp32-1": {
                "deviceId": "esp32-1",
                "publicKey": "fingerprint-1",
                "displayName": "Desk",
                "role": "esp32",
                "roles": ["esp32"],
                "scopes": ["device.esp32"],
                "approvedScopes": ["device.esp32"],
                "tokens": {
                    "esp32": {
                        "token": "secret-token",
                        "role": "esp32",
                        "scopes": ["device.esp32"],
                        "createdAtMs": 123
                    }
                },
                "deviceFamily": "ESP32-S3-BOX-3",
                "clientMode": "mqtt-udp",
                "createdAtMs": now - 2,
                "approvedAtMs": now - 1
            }
        }),
    )
    .expect("write paired");
    write_json_file(
        &state_dir.join("esp32/devices.json"),
        &json!({
            "devices": {
                "esp32-1": {
                    "deviceId": "esp32-1",
                    "name": "Stored Desk",
                    "fingerprint": "stored-fingerprint",
                    "activeAgentId": "old-agent",
                    "capabilities": {
                        "hardwareTarget": "ESP32-S3-BOX-3",
                        "audio": { "input": "i2s", "output": "i2s", "codec": "opus" },
                        "display": { "width": 320, "height": 240, "color": true }
                    },
                    "lastSeenAtMs": now
                }
            }
        }),
    )
    .expect("write esp32 devices");
    write_json_file(
        &state_dir.join("esp32/pairing-sessions.json"),
        &json!({
            "pair-1": {
                "pairId": "pair-1",
                "password": "secret-pair-code",
                "name": "desk",
                "hardwareTarget": "ESP32-S3-BOX-3",
                "issuedAtMs": now - 10,
                "expiresAtMs": now + 60_000
            },
            "expired": {
                "pairId": "expired",
                "password": "expired-code",
                "hardwareTarget": "ESP32-S3-BOX-3",
                "issuedAtMs": now - 20,
                "expiresAtMs": now - 1
            }
        }),
    )
    .expect("write sessions");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let status = handle_gateway_method(&state, "esp32.status.get", json!({}))
        .await
        .expect("esp32 status");
    assert_eq!(status["enabled"], true);
    assert_eq!(status["serviceRunning"], true);
    assert_eq!(status["broker"]["advertisedHost"], "127.0.0.1");
    assert_eq!(status["counts"]["activePairingSessions"], 1);
    assert_eq!(status["counts"]["pendingRequests"], 1);
    assert_eq!(status["counts"]["pairedDevices"], 1);
    assert_eq!(status["counts"]["onlineDevices"], 1);
    assert_eq!(
        status["activePairingSessions"][0]["username"],
        "pair:pair-1"
    );
    assert!(status["activePairingSessions"][0].get("password").is_none());

    let ota = esp32_ota_payload(&state, &HeaderMap::new());
    assert_eq!(ota["mqtt"]["endpoint"], "127.0.0.1:1883");
    assert_eq!(ota["mqtt"]["publish_topic"], "crawclaw/esp32/unknown/event");
    assert_eq!(
        ota["mqtt"]["subscribe_topic"],
        "crawclaw/esp32/unknown/command"
    );
    assert_eq!(ota["crawclaw"]["protocolVersion"], 1);
    assert_eq!(ota["crawclaw"]["transport"], "mqtt-udp");
    assert_eq!(ota["crawclaw"]["udp"]["port"], 1884);

    let requests = handle_gateway_method(&state, "esp32.pairing.requests.list", json!({}))
        .await
        .expect("esp32 requests");
    assert_eq!(requests["items"].as_array().expect("items").len(), 1);
    assert_eq!(requests["items"][0]["requestId"], "req-esp32");

    let devices = handle_gateway_method(&state, "esp32.devices.list", json!({}))
        .await
        .expect("esp32 devices");
    assert_eq!(devices["items"].as_array().expect("items").len(), 1);
    assert_eq!(devices["items"][0]["deviceId"], "esp32-1");
    assert_eq!(devices["items"][0]["online"], true);
    assert_eq!(devices["items"][0]["activeAgentId"], "old-agent");
    assert_eq!(devices["items"][0]["activeAgentName"], "old-agent");
    assert_eq!(devices["items"][0]["lastSeenAtMs"], now);

    let device = handle_gateway_method(
        &state,
        "esp32.devices.get",
        json!({ "deviceId": "esp32-1" }),
    )
    .await
    .expect("esp32 get");
    assert_eq!(device["status"], "found");
    assert_eq!(device["paired"]["deviceId"], "esp32-1");
    assert!(device["paired"]["tokens"][0].get("token").is_none());
    assert_eq!(device["device"]["online"], true);
    assert_eq!(device["device"]["capabilities"]["audio"]["codec"], "opus");

    let switched = handle_gateway_method(
        &state,
        "esp32.devices.command.send",
        json!({
            "deviceId": "esp32-1",
            "command": "agent.switch",
            "params": { "agentId": "main" }
        }),
    )
    .await
    .expect("switch esp32 active agent");
    assert_eq!(switched["status"], "queued");
    assert_eq!(switched["activeAgentId"], "main");
    assert_eq!(switched["activeAgentName"], "Main");
    let switched_device = handle_gateway_method(
        &state,
        "esp32.devices.get",
        json!({ "deviceId": "esp32-1" }),
    )
    .await
    .expect("esp32 get switched");
    assert_eq!(switched_device["device"]["activeAgentId"], "main");
    assert_eq!(switched_device["device"]["activeAgentName"], "Main");

    let started = handle_gateway_method(
        &state,
        "esp32.pairing.start",
        json!({ "name": "new desk", "ttlMs": 60000 }),
    )
    .await
    .expect("start pairing");
    assert_eq!(
        started["username"],
        format!("pair:{}", started["pairId"].as_str().unwrap())
    );
    assert!(started["pairCode"]
        .as_str()
        .unwrap_or_default()
        .starts_with("rust-pair-code-"));
    assert_eq!(started["broker"]["host"], "127.0.0.1");
    let pair_id = started["pairId"].as_str().expect("pair id").to_string();

    let revoked = handle_gateway_method(
        &state,
        "esp32.pairing.session.revoke",
        json!({ "pairId": pair_id }),
    )
    .await
    .expect("revoke pairing session");
    assert_eq!(revoked["pairId"], started["pairId"]);

    let approved = handle_gateway_method(
        &state,
        "esp32.pairing.request.approve",
        json!({ "requestId": "req-esp32" }),
    )
    .await
    .expect("approve esp32 request");
    assert_eq!(approved["deviceId"], "esp32-2");

    write_json_file(
        &state_dir.join("devices/pending.json"),
        &json!({
            "req-esp32-reject": {
                "requestId": "req-esp32-reject",
                "deviceId": "esp32-3",
                "publicKey": "fingerprint-3",
                "displayName": "Desk Rejected",
                "role": "esp32",
                "roles": ["esp32"],
                "scopes": ["device.esp32"],
                "deviceFamily": "ESP32-S3-BOX-3",
                "clientMode": "mqtt-udp",
                "ts": now
            }
        }),
    )
    .expect("write reject pending");
    let rejected = handle_gateway_method(
        &state,
        "esp32.pairing.request.reject",
        json!({ "requestId": "req-esp32-reject" }),
    )
    .await
    .expect("reject esp32 request");
    assert_eq!(rejected["requestId"], "req-esp32-reject");

    let removed = handle_gateway_method(
        &state,
        "esp32.devices.revoke",
        json!({ "deviceId": "esp32-1" }),
    )
    .await
    .expect("revoke esp32 device");
    assert_eq!(removed["deviceId"], "esp32-1");

    match previous_state_dir {
        Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
        None => env::remove_var("CRAWCLAW_STATE_DIR"),
    }
    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(state_dir);
}

#[tokio::test]
async fn rust_gateway_workflow_methods_track_local_registry() {
    let _guard = env_lock().lock().expect("env lock");
    let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
    let previous_n8n_base_url = env::var_os("CRAWCLAW_N8N_BASE_URL");
    let previous_n8n_api_key = env::var_os("CRAWCLAW_N8N_API_KEY");
    let runtime_root = unique_test_runtime_root("gateway-workflow-runtime");
    let workspace_dir = unique_test_runtime_root("gateway-workflow-workspace");
    let state_dir = unique_test_runtime_root("gateway-workflow-state");
    env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
    env::remove_var("CRAWCLAW_N8N_BASE_URL");
    env::remove_var("CRAWCLAW_N8N_API_KEY");
    let root = workspace_dir.join(".crawclaw/workflows");
    std::fs::create_dir_all(root.join("specs")).expect("create workflow store");
    write_json_file(
        &root.join("registry.json"),
        &json!({
            "version": 1,
            "updatedAt": 200,
            "workflows": [
                {
                    "workflowId": "daily-check",
                    "name": "Daily Check",
                    "description": "Daily ops check",
                    "scope": "workspace",
                    "target": "n8n",
                    "enabled": true,
                    "safeForAutoRun": true,
                    "requiresApproval": false,
                    "tags": ["ops"],
                    "specVersion": 1,
                    "deploymentVersion": 1,
                    "deploymentState": "deployed",
                    "n8nWorkflowId": "wf_remote",
                    "createdAt": 100,
                    "updatedAt": 200
                },
                {
                    "workflowId": "disabled-check",
                    "name": "Disabled Check",
                    "scope": "workspace",
                    "target": "n8n",
                    "enabled": false,
                    "safeForAutoRun": false,
                    "requiresApproval": false,
                    "tags": [],
                    "specVersion": 1,
                    "deploymentVersion": 0,
                    "deploymentState": "draft",
                    "createdAt": 100,
                    "updatedAt": 150
                }
            ]
        }),
    )
    .expect("write registry");
    write_json_file(
        &root.join("specs/daily-check.json"),
        &json!({
            "workflowId": "daily-check",
            "name": "Daily Check",
            "goal": "Check daily ops",
            "steps": []
        }),
    )
    .expect("write spec");
    write_json_file(
        &root.join("executions.json"),
        &json!({
            "version": 1,
            "updatedAt": 300,
            "executions": [
                {
                    "executionId": "exec-1",
                    "workflowId": "daily-check",
                    "workflowName": "Daily Check",
                    "status": "running",
                    "currentStepId": "draft",
                    "currentExecutor": "crawclaw_agent",
                    "steps": [
                        {
                            "stepId": "draft",
                            "title": "Draft content",
                            "status": "running",
                            "executor": "crawclaw_agent",
                            "startedAt": 250,
                            "updatedAt": 250
                        },
                        {
                            "stepId": "publish",
                            "title": "Publish",
                            "status": "pending",
                            "executor": "n8n",
                            "updatedAt": 250
                        }
                    ],
                    "startedAt": 250,
                    "updatedAt": 300
                }
            ]
        }),
    )
    .expect("write executions");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let workspace = workspace_dir.to_string_lossy().to_string();

    let listed = handle_gateway_method(
        &state,
        "workflow.list",
        json!({ "workspaceDir": workspace }),
    )
    .await
    .expect("workflow list");
    assert_eq!(listed["count"], 1);
    assert_eq!(listed["workflows"][0]["workflowId"], "daily-check");
    assert_eq!(listed["workflows"][0]["runCount"], 1);
    assert_eq!(
        listed["workflows"][0]["invocation"]["recommendedAction"],
        "run"
    );

    let listed_all = handle_gateway_method(
        &state,
        "workflow.list",
        json!({ "workspaceDir": workspace, "includeDisabled": true }),
    )
    .await
    .expect("workflow list all");
    assert_eq!(listed_all["count"], 2);

    let details = handle_gateway_method(
        &state,
        "workflow.get",
        json!({ "workspaceDir": workspace, "workflow": "Daily Check" }),
    )
    .await
    .expect("workflow get");
    assert_eq!(details["workflow"]["workflowId"], "daily-check");
    assert_eq!(details["spec"]["goal"], "Check daily ops");
    assert_eq!(details["recentExecutions"][0]["executionId"], "exec-1");

    let missing_runtime = handle_gateway_method(
        &state,
        "workflow.run",
        json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
    )
    .await;
    assert!(missing_runtime
        .expect_err("workflow.run should require n8n config")
        .contains("n8n is not configured"));

    env::set_var("CRAWCLAW_N8N_BASE_URL", "https://n8n.example.com/");
    env::set_var("CRAWCLAW_N8N_API_KEY", "test-n8n-key");

    for method in [
        "workflow.get",
        "workflow.run",
        "workflow.enable",
        "workflow.archive",
        "workflow.delete",
    ] {
        let missing = handle_gateway_method(
            &state,
            method,
            json!({ "workspaceDir": workspace, "workflow": "missing-workflow" }),
        )
        .await;
        assert!(missing
            .expect_err("missing workflow should fail")
            .contains("Workflow \"missing-workflow\" not found."));
    }

    let matched = handle_gateway_method(
        &state,
        "workflow.match",
        json!({ "workspaceDir": workspace, "query": "daily" }),
    )
    .await
    .expect("workflow match");
    assert_eq!(matched["count"], 1);
    assert_eq!(matched["matches"][0]["workflowId"], "daily-check");

    let disabled_run = handle_gateway_method(
        &state,
        "workflow.run",
        json!({ "workspaceDir": workspace, "workflow": "disabled-check" }),
    )
    .await;
    assert!(disabled_run
        .expect_err("disabled workflow should not run")
        .contains("disabled and cannot run"));

    let run = handle_gateway_method(
        &state,
        "workflow.run",
        json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
    )
    .await
    .expect("workflow run");
    assert_eq!(run["execution"]["status"], "running");
    assert_eq!(run["execution"]["n8nWorkflowId"], "wf_remote");
    assert_eq!(run["execution"]["n8nBaseUrl"], "https://n8n.example.com");
    let execution_id = run["execution"]["executionId"]
        .as_str()
        .expect("execution id")
        .to_string();

    let status = handle_gateway_method(
        &state,
        "workflow.status",
        json!({ "workspaceDir": workspace, "executionId": execution_id }),
    )
    .await
    .expect("workflow status");
    assert_eq!(status["execution"]["status"], "running");
    assert_eq!(status["execution"]["n8nWorkflowId"], "wf_remote");

    let agent_run = handle_gateway_method(
        &state,
        "workflow.agent.run",
        json!({
            "workspaceDir": workspace,
            "workflowId": "daily-check",
            "executionId": "exec-1",
            "stepId": "draft",
            "goal": "Draft content"
        }),
    )
    .await
    .expect("workflow agent run");
    assert_eq!(agent_run["ok"], true);
    assert_eq!(agent_run["status"], "running");
    assert_eq!(agent_run["workflow"]["workflowId"], "daily-check");
    assert_eq!(agent_run["execution"]["executionId"], "exec-1");
    assert_eq!(agent_run["execution"]["steps"][0]["stepId"], "draft");
    assert_eq!(agent_run["execution"]["steps"][0]["status"], "running");
    assert_eq!(
        agent_run["execution"]["steps"][0]["sessionKey"],
        agent_run["session"]["key"]
    );

    let cancelled = handle_gateway_method(
        &state,
        "workflow.cancel",
        json!({ "workspaceDir": workspace, "executionId": execution_id }),
    )
    .await
    .expect("workflow cancel");
    assert_eq!(cancelled["execution"]["status"], "cancelled");
    assert_eq!(
        cancelled["execution"]["n8nBaseUrl"],
        "https://n8n.example.com"
    );

    let disabled = handle_gateway_method(
        &state,
        "workflow.disable",
        json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
    )
    .await
    .expect("workflow disable");
    assert_eq!(disabled["workflow"]["enabled"], false);

    let archived = handle_gateway_method(
        &state,
        "workflow.archive",
        json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
    )
    .await
    .expect("workflow archive");
    assert!(archived["workflow"].get("archivedAt").is_some());

    let removed = handle_gateway_method(
        &state,
        "workflow.delete",
        json!({ "workspaceDir": workspace, "workflow": "daily-check" }),
    )
    .await
    .expect("workflow delete");
    assert_eq!(removed["deleted"], true);
    assert_eq!(removed["workflowId"], "daily-check");
    assert_eq!(removed["removedExecutions"], 2);

    match previous_n8n_base_url {
        Some(value) => env::set_var("CRAWCLAW_N8N_BASE_URL", value),
        None => env::remove_var("CRAWCLAW_N8N_BASE_URL"),
    }
    match previous_n8n_api_key {
        Some(value) => env::set_var("CRAWCLAW_N8N_API_KEY", value),
        None => env::remove_var("CRAWCLAW_N8N_API_KEY"),
    }
    match previous_state_dir {
        Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
        None => env::remove_var("CRAWCLAW_STATE_DIR"),
    }
    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(workspace_dir);
    let _ = std::fs::remove_dir_all(state_dir);
}

#[tokio::test]
async fn rust_gateway_usage_and_observation_methods_use_protocol_shapes() {
    let _guard = env_lock().lock().expect("env lock");
    let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
    let previous_minimax = env::var_os("MINIMAX_API_KEY");
    let runtime_root = unique_test_runtime_root("gateway-usage-runtime");
    let state_dir = unique_test_runtime_root("gateway-usage-state");
    env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
    env::set_var("MINIMAX_API_KEY", "test-minimax-key");
    let db_path = state_dir.join("memory-runtime.sqlite");
    write_json_file(
        &state_dir.join("crawclaw.json"),
        &json!({
            "memory": {
                "runtimeStore": {
                    "type": "sqlite",
                    "dbPath": db_path.to_string_lossy()
                }
            }
        }),
    )
    .expect("write memory config");
    let db = rusqlite::Connection::open(&db_path).expect("open observation db");
    db.execute_batch(
            r#"
            CREATE TABLE gm_observation_runs (
              trace_id TEXT PRIMARY KEY,
              root_span_id TEXT,
              run_id TEXT,
              task_id TEXT,
              session_id TEXT,
              session_key TEXT,
              agent_id TEXT,
              parent_agent_id TEXT,
              workflow_run_id TEXT,
              status TEXT NOT NULL DEFAULT 'unknown',
              started_at INTEGER,
              ended_at INTEGER,
              last_event_at INTEGER,
              event_count INTEGER NOT NULL DEFAULT 0,
              error_count INTEGER NOT NULL DEFAULT 0,
              sources_json TEXT NOT NULL DEFAULT '[]',
              refs_json TEXT,
              summary TEXT NOT NULL DEFAULT '',
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            INSERT INTO gm_observation_runs
              (trace_id, root_span_id, run_id, task_id, session_id, session_key, agent_id, status, started_at, last_event_at, event_count, error_count, sources_json, summary, created_at, updated_at)
            VALUES
              ('trace-a', 'span-a', 'run-a', 'task-a', 'session-a', 'agent:main:main', 'main', 'running', 100, 120, 1, 0, '["lifecycle"]', 'running main observation', 100, 120),
              ('trace-b', 'span-b', 'run-b', 'task-b', 'session-b', 'agent:worker:main', 'worker', 'error', 200, 240, 2, 1, '["lifecycle","trajectory"]', 'failed worker observation', 200, 240);
            "#,
        )
        .expect("seed observation db");
    drop(db);
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let usage = handle_gateway_method(&state, "usage.status", json!({}))
        .await
        .expect("usage status");
    assert!(usage["providers"]
        .as_array()
        .expect("providers")
        .iter()
        .any(|provider| {
            provider["provider"] == "minimax"
                && provider["displayName"] == "MiniMax"
                && provider["windows"].as_array().is_some()
        }));

    let observations = handle_gateway_method(
        &state,
        "agent.observations.list",
        json!({ "query": "task-a", "status": "running", "source": "lifecycle", "limit": 500 }),
    )
    .await
    .expect("observation list");
    assert_eq!(observations["items"][0]["traceId"], "trace-a");
    assert_eq!(observations["items"][0]["runId"], "run-a");
    assert_eq!(observations["items"][0]["taskId"], "task-a");
    assert_eq!(observations["items"][0]["eventCount"], 1);
    assert_eq!(observations["items"][0]["errorCount"], 0);
    assert_eq!(observations["items"][0]["sources"], json!(["lifecycle"]));
    assert_eq!(
        observations["items"][0]["summary"],
        "running main observation"
    );
    assert!(observations["generatedAt"].as_u64().is_some());
    assert!(observations.get("observations").is_none());
    assert!(observations.get("limit").is_none());
    assert!(observations.get("implementation").is_none());

    let invalid = handle_gateway_method(
        &state,
        "agent.observations.list",
        json!({ "status": "done" }),
    )
    .await;
    assert!(invalid
        .expect_err("invalid status")
        .contains("invalid status"));

    match previous_minimax {
        Some(value) => env::set_var("MINIMAX_API_KEY", value),
        None => env::remove_var("MINIMAX_API_KEY"),
    }
    match previous_state_dir {
        Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
        None => env::remove_var("CRAWCLAW_STATE_DIR"),
    }
    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(state_dir);
}

#[tokio::test]
async fn rust_gateway_usage_status_reads_provider_auth_env_catalog() {
    let _guard = env_lock().lock().expect("env lock");
    let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
    let previous_anthropic_oauth = env::var_os("ANTHROPIC_OAUTH_TOKEN");
    let previous_copilot = env::var_os("GH_COPILOT_TOKEN");
    let runtime_root = unique_test_runtime_root("gateway-usage-provider-auth-catalog");
    let state_dir = unique_test_runtime_root("gateway-usage-provider-auth-state");
    env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
    env::set_var("ANTHROPIC_OAUTH_TOKEN", "test-anthropic-oauth");
    env::set_var("GH_COPILOT_TOKEN", "test-copilot-token");

    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let usage = handle_gateway_method(&state, "usage.status", json!({}))
        .await
        .expect("usage status");

    assert!(usage["providers"]
        .as_array()
        .expect("providers")
        .iter()
        .any(|provider| provider["provider"] == "anthropic"));
    assert!(usage["providers"]
        .as_array()
        .expect("providers")
        .iter()
        .any(|provider| provider["provider"] == "github-copilot"));

    match previous_anthropic_oauth {
        Some(value) => env::set_var("ANTHROPIC_OAUTH_TOKEN", value),
        None => env::remove_var("ANTHROPIC_OAUTH_TOKEN"),
    }
    match previous_copilot {
        Some(value) => env::set_var("GH_COPILOT_TOKEN", value),
        None => env::remove_var("GH_COPILOT_TOKEN"),
    }
    match previous_state_dir {
        Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
        None => env::remove_var("CRAWCLAW_STATE_DIR"),
    }
    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(state_dir);
}

#[tokio::test]
async fn rust_gateway_secrets_reload_reports_unresolved_secret_refs() {
    let _guard = env_lock().lock().expect("env lock");
    let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
    let previous_secret = env::var_os("CRAWCLAW_SECRET_OK");
    let runtime_root = unique_test_runtime_root("gateway-secrets-runtime");
    let state_dir = unique_test_runtime_root("gateway-secrets-state");
    env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
    env::set_var("CRAWCLAW_SECRET_OK", "secret-value");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    write_json_file(
        &state_dir.join("crawclaw.json"),
        &json!({
            "gateway": {
                "auth": {
                    "token": { "source": "env", "id": "CRAWCLAW_SECRET_OK" },
                    "password": { "source": "file", "id": "missing-secret.txt" }
                }
            }
        }),
    )
    .expect("write config");

    let reloaded = handle_gateway_method(&state, "secrets.reload", json!({}))
        .await
        .expect("secrets reload");
    assert_eq!(reloaded["ok"], true);
    assert_eq!(reloaded["checkedRefCount"], 2);
    assert_eq!(reloaded["warningCount"], 1);
    assert!(reloaded["diagnostics"][0]
        .as_str()
        .unwrap_or_default()
        .contains("missing-secret.txt"));

    match previous_secret {
        Some(value) => env::set_var("CRAWCLAW_SECRET_OK", value),
        None => env::remove_var("CRAWCLAW_SECRET_OK"),
    }
    match previous_state_dir {
        Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
        None => env::remove_var("CRAWCLAW_STATE_DIR"),
    }
    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(state_dir);
}

#[tokio::test]
async fn rust_gateway_usage_cost_aggregates_local_session_transcripts() {
    let _guard = env_lock().lock().expect("env lock");
    let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
    let runtime_root = unique_test_runtime_root("gateway-usage-cost-runtime");
    let state_dir = unique_test_runtime_root("gateway-usage-cost-state");
    env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });
    let key = "usage-cost";
    let transcript_path = state
        .session_store
        .session_transcript_path(key)
        .expect("transcript path");
    append_jsonl(
        &transcript_path,
        &json!({
            "timestamp": "2026-05-11T00:00:00.000Z",
            "message": {
                "role": "assistant",
                "usage": {
                    "input": 10,
                    "output": 5,
                    "cacheRead": 2,
                    "cacheWrite": 1,
                    "totalTokens": 18,
                    "cost": {
                        "total": 0.018,
                        "input": 0.010,
                        "output": 0.005,
                        "cacheRead": 0.002,
                        "cacheWrite": 0.001
                    }
                }
            }
        }),
    )
    .expect("append transcript entry");
    append_jsonl(
        &transcript_path,
        &json!({
            "timestamp": "2026-05-11T01:00:00.000Z",
            "message": {
                "role": "assistant",
                "usage": {
                    "input": 3,
                    "output": 4,
                    "total": 7
                }
            }
        }),
    )
    .expect("append transcript entry");

    let cost = handle_gateway_method(&state, "usage.cost", json!({ "days": 30 }))
        .await
        .expect("usage cost");
    assert_eq!(cost["days"], 30);
    assert_eq!(cost["daily"].as_array().expect("daily").len(), 1);
    assert_eq!(cost["daily"][0]["date"], "2026-05-11");
    assert_eq!(cost["totals"]["input"], 13);
    assert_eq!(cost["totals"]["output"], 9);
    assert_eq!(cost["totals"]["cacheRead"], 2);
    assert_eq!(cost["totals"]["cacheWrite"], 1);
    assert_eq!(cost["totals"]["totalTokens"], 25);
    assert_eq!(cost["totals"]["totalCost"], 0.018);
    assert_eq!(cost["totals"]["inputCost"], 0.01);
    assert_eq!(cost["totals"]["outputCost"], 0.005);
    assert_eq!(cost["totals"]["cacheReadCost"], 0.002);
    assert_eq!(cost["totals"]["cacheWriteCost"], 0.001);
    assert_eq!(cost["totals"]["missingCostEntries"], 1);
    assert_eq!(cost["daily"][0]["totalTokens"], 25);
    assert_eq!(cost["daily"][0]["missingCostEntries"], 1);

    match previous_state_dir {
        Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
        None => env::remove_var("CRAWCLAW_STATE_DIR"),
    }
    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(state_dir);
}

#[tokio::test]
async fn rust_gateway_exec_approvals_set_persists_local_file() {
    let _guard = env_lock().lock().expect("env lock");
    let previous_state_dir = env::var_os("CRAWCLAW_STATE_DIR");
    let runtime_root = unique_test_runtime_root("gateway-exec-approvals-runtime");
    let state_dir = unique_test_runtime_root("gateway-exec-approvals-state");
    env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let before = handle_gateway_method(&state, "exec.approvals.get", json!({}))
        .await
        .expect("exec approvals get");
    assert_eq!(before["exists"], false);

    let updated = handle_gateway_method(
        &state,
        "exec.approvals.set",
        json!({
            "file": {
                "version": 1,
                "defaults": { "security": "full", "ask": "off" },
                "agents": {
                    "main": {
                        "ask": "on-request"
                    }
                }
            }
        }),
    )
    .await
    .expect("exec approvals set");
    assert_eq!(updated["exists"], true);
    assert_eq!(updated["file"]["defaults"]["security"], "full");
    assert_eq!(updated["file"]["agents"]["main"]["ask"], "on-request");
    assert!(state_dir.join("exec-approvals.json").exists());

    let changed = handle_gateway_method(
        &state,
        "exec.approvals.set",
        json!({
            "baseHash": updated["hash"],
            "file": {
                "version": 1,
                "defaults": { "security": "restricted" },
                "agents": {}
            }
        }),
    )
    .await
    .expect("exec approvals set with base hash");
    assert_eq!(changed["file"]["defaults"]["security"], "restricted");

    let stale = handle_gateway_method(
        &state,
        "exec.approvals.set",
        json!({
            "baseHash": updated["hash"],
            "file": {
                "version": 1,
                "defaults": {},
                "agents": {}
            }
        }),
    )
    .await;
    assert!(stale
        .expect_err("stale base hash should fail")
        .contains("exec approvals changed since last load"));

    match previous_state_dir {
        Some(value) => env::set_var("CRAWCLAW_STATE_DIR", value),
        None => env::remove_var("CRAWCLAW_STATE_DIR"),
    }
    let _ = std::fs::remove_dir_all(runtime_root);
    let _ = std::fs::remove_dir_all(state_dir);
}

#[tokio::test]
async fn rust_gateway_channel_lifecycle_tracks_native_local_delivery() {
    let _guard = env_lock().lock().expect("env lock");
    let runtime_root = unique_test_runtime_root("gateway-channel-lifecycle");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    handle_gateway_method(
        &state,
        "channels.config.apply",
        json!({
            "channel": "desktop",
            "config": { "enabled": true }
        }),
    )
    .await
    .expect("apply desktop config");

    let login = handle_gateway_method(
        &state,
        "channels.account.login.start",
        json!({
            "channel": "desktop",
            "accountId": "local"
        }),
    )
    .await
    .expect("desktop login");
    assert_eq!(login["connected"], true);
    assert_eq!(login["linked"], true);
    assert_eq!(login["healthState"], "connected");

    let verify = handle_gateway_method(
        &state,
        "channels.account.verify",
        json!({
            "channel": "desktop",
            "accountId": "local"
        }),
    )
    .await
    .expect("desktop verify");
    assert_eq!(verify["connected"], true);
    assert_eq!(verify["linked"], true);

    let local_send = handle_gateway_method(
        &state,
        "send",
        json!({
            "channel": "desktop",
            "accountId": "local",
            "to": "agent:main",
            "text": "hello local"
        }),
    )
    .await
    .expect("desktop send");
    assert_eq!(local_send["sent"], true);
    assert_eq!(local_send["deliveryStatus"], "delivered");
    assert!(local_send["deliveredAtMs"].is_number());

    let contract_send = handle_gateway_method(
        &state,
        "channel.outbound.send",
        json!({
            "channel": "desktop",
            "accountId": "local",
            "to": "agent:main",
            "message": "hello contract",
            "mediaUrl": "https://example.test/a.png",
            "mediaUrls": ["https://example.test/b.png"],
            "threadId": "thread-1",
            "replyToId": "message-1",
            "gifPlayback": true,
            "idempotencyKey": "send-contract-1"
        }),
    )
    .await
    .expect("desktop contract send");
    assert_eq!(contract_send["runId"], "send-contract-1");
    assert_eq!(contract_send["sent"], true);
    assert_eq!(contract_send["deliveryStatus"], "delivered");
    assert_eq!(contract_send["threadId"], "thread-1");
    assert_eq!(contract_send["replyToId"], "message-1");
    assert_eq!(contract_send["mediaUrls"][0], "https://example.test/a.png");
    assert_eq!(contract_send["mediaUrls"][1], "https://example.test/b.png");
    assert_eq!(contract_send["params"]["gifPlayback"], true);

    let esp32_send = handle_gateway_method(
        &state,
        "channel.outbound.send",
        json!({
            "channel": "esp32",
            "to": "esp32-1",
            "text": "short device reply",
            "idempotencyKey": "esp32-send-1"
        }),
    )
    .await
    .expect("esp32 contract send");
    assert_eq!(esp32_send["runId"], "esp32-send-1");
    assert_eq!(esp32_send["channel"], "esp32");
    assert_eq!(esp32_send["deliveryStatus"], "queued");
    assert_eq!(esp32_send["sent"], false);
    assert_eq!(esp32_send["params"]["text"], "short device reply");
    assert_eq!(esp32_send["implementation"], "rust-native");
    let esp32_commands =
        std::fs::read_to_string(runtime_root.join("esp32/commands.jsonl")).expect("esp32 commands");
    assert!(esp32_commands.contains("\"command\":\"display.reply\""));
    assert!(esp32_commands.contains("\"deviceId\":\"esp32-1\""));

    let local_poll = handle_gateway_method(
        &state,
        "poll",
        json!({
            "channel": "desktop",
            "accountId": "local",
            "to": "agent:main",
            "question": "Lunch?",
            "options": ["Pizza", "Sushi"],
            "maxSelections": 1,
            "durationSeconds": 60,
            "idempotencyKey": "poll-local-1"
        }),
    )
    .await
    .expect("desktop poll");
    assert_eq!(local_poll["runId"], "poll-local-1");
    assert_eq!(local_poll["sent"], true);
    assert_eq!(local_poll["deliveryStatus"], "delivered");
    assert_eq!(local_poll["poll"]["question"], "Lunch?");
    assert_eq!(local_poll["poll"]["options"][0], "Pizza");

    let contract_poll = handle_gateway_method(
        &state,
        "channel.outbound.poll",
        json!({
            "channel": "desktop",
            "accountId": "local",
            "to": "agent:main",
            "question": "Dinner?",
            "options": ["Noodles", "Rice"]
        }),
    )
    .await
    .expect("desktop contract poll");
    assert_eq!(contract_poll["sent"], true);
    assert_eq!(contract_poll["deliveryStatus"], "delivered");

    let action_delivery = handle_gateway_method(
        &state,
        "channel.outbound.action",
        json!({
            "channel": "desktop",
            "accountId": "local",
            "action": "threadReply",
            "to": "agent:main",
            "message": "thread reply",
            "threadId": "thread-2",
            "params": { "effect": "confetti" },
            "idempotencyKey": "action-local-1"
        }),
    )
    .await
    .expect("desktop outbound action");
    assert_eq!(action_delivery["runId"], "action-local-1");
    assert_eq!(action_delivery["action"], "threadReply");
    assert_eq!(action_delivery["threadId"], "thread-2");
    assert_eq!(action_delivery["params"]["effect"], "confetti");
    assert_eq!(action_delivery["sent"], true);

    let lifecycle_status = handle_gateway_method(
        &state,
        "channel.lifecycle.status",
        json!({ "channel": "desktop" }),
    )
    .await
    .expect("channel lifecycle status");
    assert_eq!(lifecycle_status["ok"], true);
    assert_eq!(
        lifecycle_status["snapshot"]["channels"]["desktop"]["connected"],
        true
    );

    let lifecycle_stop = handle_gateway_method(
        &state,
        "channel.lifecycle.stop",
        json!({ "channel": "desktop", "accountId": "local" }),
    )
    .await
    .expect("channel lifecycle stop");
    assert_eq!(lifecycle_stop["connected"], false);
    assert_eq!(lifecycle_stop["healthState"], "logged_out");

    let lifecycle_restart = handle_gateway_method(
        &state,
        "channel.lifecycle.restart",
        json!({ "channel": "desktop", "accountId": "local" }),
    )
    .await
    .expect("channel lifecycle restart");
    assert_eq!(lifecycle_restart["connected"], true);
    assert_eq!(lifecycle_restart["healthState"], "connected");

    let blocked_external = handle_gateway_method(
        &state,
        "send",
        json!({
            "channel": "weixin",
            "to": "filehelper",
            "text": "hello external"
        }),
    )
    .await
    .expect("weixin send");
    assert_eq!(blocked_external["sent"], false);
    assert_eq!(blocked_external["deliveryStatus"], "blocked");
    assert_eq!(blocked_external["errorCode"], "needs_channel_transport");

    let blocked_poll = handle_gateway_method(
        &state,
        "channel.outbound.poll",
        json!({
            "channel": "qqbot",
            "to": "chat:123",
            "question": "Lunch?",
            "options": ["Pizza", "Sushi"]
        }),
    )
    .await
    .expect("qqbot poll");
    assert_eq!(blocked_poll["sent"], false);
    assert_eq!(blocked_poll["deliveryStatus"], "blocked");
    assert_eq!(blocked_poll["errorCode"], "needs_channel_transport");

    let blocked_action = handle_gateway_method(
        &state,
        "channel.outbound.action",
        json!({
            "channel": "feishu",
            "action": "threadReply",
            "to": "channel:C123",
            "text": "blocked action",
            "threadId": "thread-3"
        }),
    )
    .await
    .expect("feishu outbound action");
    assert_eq!(blocked_action["sent"], false);
    assert_eq!(blocked_action["deliveryStatus"], "blocked");
    assert_eq!(blocked_action["errorCode"], "needs_channel_transport");

    let status = handle_gateway_method(&state, "channels.status", json!({}))
        .await
        .expect("channels status");
    assert_eq!(status["channels"]["desktop"]["connected"], true);
    assert_eq!(status["channels"]["desktop"]["running"], true);
    assert_eq!(
        status["channelAccounts"]["desktop"][0]["healthState"],
        "connected"
    );

    let _ = std::fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_gateway_channels_status_uses_native_channel_catalog() {
    let runtime_root = unique_test_runtime_root("gateway-native-channel-catalog");
    let state = GatewayState::new(GatewayRunConfig {
        runtime_root: Some(runtime_root.clone()),
        ..GatewayRunConfig::default()
    });

    let status = handle_gateway_method(&state, "channels.status", json!({}))
        .await
        .expect("channels status");

    assert_eq!(status["channelOrder"][0], "ddingtalk");
    let channel_order = status["channelOrder"]
        .as_array()
        .expect("channelOrder array");
    assert!(channel_order.iter().any(|channel| channel == "feishu"));
    assert!(channel_order.iter().any(|channel| channel == "esp32"));
    assert_eq!(
        status["channels"]["feishu"]["nativeAdapterId"],
        "feishu-native"
    );
    assert_eq!(
        status["channels"]["feishu"]["capabilities"]["outbound"]["poll"],
        false
    );
    assert_eq!(status["channels"]["esp32"]["configured"], false);

    let setup = handle_gateway_method(
        &state,
        "channels.setup.surface",
        json!({ "channel": "feishu" }),
    )
    .await
    .expect("feishu setup");
    assert_eq!(setup["label"], "Feishu");
    assert_eq!(setup["nativeAdapterId"], "feishu-native");
    assert_eq!(setup["capabilities"]["outbound"]["threadReply"], true);

    let capabilities = handle_gateway_method(
        &state,
        "channels.capabilities",
        json!({ "channel": "feishu" }),
    )
    .await
    .expect("feishu capabilities");
    assert_eq!(capabilities["version"], channel_contract_version());
    assert_eq!(capabilities["channels"][0]["channel"], "feishu");
    assert_eq!(capabilities["channels"][0]["outbound"]["threadReply"], true);

    let directory = handle_gateway_method(
        &state,
        "channel.directory.lookup",
        json!({
            "channel": "feishu",
            "accountId": "default",
            "query": "@Alice",
            "kind": "user"
        }),
    )
    .await
    .expect("channel directory lookup");
    assert_eq!(directory["ok"], true);
    assert_eq!(directory["channel"], "feishu");
    assert_eq!(directory["descriptor"]["rustAdapterId"], "feishu-native");
    assert_eq!(directory["targets"][0]["normalized"], "user:alice");

    let _ = std::fs::remove_dir_all(runtime_root);
}

fn unique_test_runtime_root(name: &str) -> PathBuf {
    env::temp_dir().join(format!("{name}-{}", now_millis()))
}

fn legacy_node_core_gateway_methods() -> &'static [&'static str] {
    &[
        "health",
        "system.health",
        "doctor.memory.status",
        "logs.tail",
        "status",
        "system.status",
        "usage.status",
        "usage.cost",
        "tts.status",
        "tts.providers",
        "tts.enable",
        "tts.disable",
        "tts.convert",
        "tts.setProvider",
        "config.get",
        "config.set",
        "config.apply",
        "config.patch",
        "config.schema",
        "config.schema.lookup",
        "exec.approvals.get",
        "exec.approvals.set",
        "exec.approval.request",
        "exec.approval.waitDecision",
        "exec.approval.resolve",
        "plugin.approval.request",
        "plugin.approval.waitDecision",
        "plugin.approval.resolve",
        "talk.config",
        "talk.speak",
        "talk.mode",
        "voice.getOverview",
        "voice.qwen3Tts.preview",
        "voice.qwen3Tts.uploadReferenceAudio",
        "models.list",
        "plugins.list",
        "plugins.enable",
        "plugins.disable",
        "plugins.install",
        "tools.catalog",
        "tools.effective",
        "tools.invoke",
        "message.policy",
        "nativePlugin.invoke",
        "nativePlugin.service.start",
        "nativePlugin.service.stop",
        "agents.list",
        "memory.admin.overview",
        "memory.status",
        "memory.refresh",
        "memory.login",
        "memory.durable.index.list",
        "memory.durable.index.get",
        "memory.dream.status",
        "memory.dream.history",
        "memory.dream.run",
        "memory.sessionSummary.status",
        "memory.sessionSummary.refresh",
        "memory.experience.outbox.list",
        "memory.experience.outbox.updateStatus",
        "memory.experience.outbox.prune",
        "memory.experience.sync.flush",
        "memory.promptJournal.summary",
        "memory.bootstrap",
        "memory.ingestBatch",
        "memory.assemble",
        "memory.compact",
        "memory.afterTurn",
        "memory.prepareSubagentSpawn",
        "memory.onSubagentEnded",
        "agentRuntime.summary",
        "agentRuntime.list",
        "agentRuntime.get",
        "agentRuntime.cancel",
        "agents.create",
        "agents.update",
        "agents.delete",
        "agents.files.list",
        "agents.files.get",
        "agents.files.set",
        "skills.status",
        "skills.bins",
        "skills.install",
        "skills.update",
        "update.run",
        "voicewake.get",
        "voicewake.set",
        "secrets.reload",
        "secrets.resolve",
        "sessions.list",
        "sessions.subscribe",
        "sessions.unsubscribe",
        "sessions.messages.subscribe",
        "sessions.messages.unsubscribe",
        "sessions.preview",
        "sessions.create",
        "sessions.send",
        "sessions.abort",
        "sessions.patch",
        "sessions.reset",
        "sessions.delete",
        "sessions.compact",
        "last-main-session-wake",
        "system.mainSessionWake.last",
        "wake",
        "cron.list",
        "cron.start",
        "cron.stop",
        "cron.status",
        "cron.add",
        "cron.update",
        "cron.remove",
        "cron.run",
        "cron.runs",
        "gateway.identity.get",
        "system-presence",
        "system-event",
        "send",
        "poll",
        "workflow.list",
        "workflow.get",
        "workflow.n8n.get",
        "workflow.match",
        "workflow.runs",
        "workflow.enable",
        "workflow.disable",
        "workflow.archive",
        "workflow.unarchive",
        "workflow.delete",
        "workflow.deploy",
        "workflow.run",
        "workflow.status",
        "workflow.cancel",
        "workflow.resume",
        "agent.identity.get",
        "agent.inspect",
        "agent.observations.list",
        "agent.wait",
        "workflow.agent.run",
        "agent.runTurn",
        "agent.command.run",
        "agent.streamEvents",
        "agent.cancel",
        "chat.history",
        "chat.abort",
        "chat.send",
    ]
}

fn run_git_test_command(cwd: &std::path::Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed\nstdout: {}\nstderr: {}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn serve_openai_compatible_once(response_body: &'static str) -> (String, mpsc::Receiver<String>) {
    serve_openai_compatible_n(response_body, 1)
}

fn serve_openai_compatible_n(
    response_body: &'static str,
    request_count: usize,
) -> (String, mpsc::Receiver<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind mock provider");
    let addr = listener.local_addr().expect("mock provider addr");
    let (request_tx, request_rx) = mpsc::channel();
    thread::spawn(move || {
        for _ in 0..request_count {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let mut buffer = [0; 8192];
            let count = stream.read(&mut buffer).expect("read provider request");
            request_tx
                .send(String::from_utf8_lossy(&buffer[..count]).to_string())
                .expect("send captured request");
            let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
            stream
                .write_all(response.as_bytes())
                .expect("write provider response");
        }
    });
    (format!("http://{addr}"), request_rx)
}

fn serve_qwen3_tts_sidecar(request_count: usize) -> (String, mpsc::Receiver<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind mock tts sidecar");
    let addr = listener.local_addr().expect("mock tts sidecar addr");
    let (request_tx, request_rx) = mpsc::channel();
    thread::spawn(move || {
        for _ in 0..request_count {
            let (mut stream, _) = listener.accept().expect("accept tts request");
            let mut buffer = [0; 8192];
            let count = stream.read(&mut buffer).expect("read tts request");
            request_tx
                .send(String::from_utf8_lossy(&buffer[..count]).to_string())
                .expect("send captured tts request");
            let response_body = r#"{"audioBase64":"aGVsbG8=","outputFormat":"wav"}"#;
            let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
            stream
                .write_all(response.as_bytes())
                .expect("write tts response");
        }
    });
    (format!("http://{addr}"), request_rx)
}
