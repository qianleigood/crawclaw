use std::sync::OnceLock;

use crawclaw_runtime::cron::{CronService, CronServiceOptions};
use crawclaw_runtime::DesktopSessionStore;
use serde_json::json;
use serde_json::Value;
use tempfile::tempdir;
use tokio::sync::Mutex;

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

async fn wait_for_system_message(runtime_root: &std::path::Path, text: &str) {
    for _ in 0..20 {
        let history = DesktopSessionStore::new(runtime_root.to_path_buf())
            .session_history("main")
            .expect("main session history");
        if history
            .iter()
            .any(|message| message.role == "system" && message.content == text)
        {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    panic!("system message was not written: {text}");
}

#[tokio::test]
async fn cron_service_records_run_logs_and_rejects_traversal_ids() {
    let temp = tempdir().expect("tempdir");
    let runtime_root = temp.path().join("runtime");
    let service = CronService::new(CronServiceOptions {
        runtime_root,
        store_path: Some(temp.path().join("cron").join("jobs.json")),
        enabled: true,
        start_scheduler: false,
        ..CronServiceOptions::default()
    })
    .expect("cron service");

    service
        .handle_action(json!({
            "action": "add",
            "job": {
                "id": "logged-job",
                "name": "Logged job",
                "schedule": { "kind": "every", "everyMs": 60000 },
                "sessionTarget": "main",
                "payload": { "kind": "systemEvent", "text": "write log" }
            }
        }))
        .await
        .expect("add logged job");
    service
        .handle_action(json!({
            "action": "run",
            "id": "logged-job",
            "mode": "force"
        }))
        .await
        .expect("run logged job");

    let runs = service
        .handle_action(json!({
            "action": "runs",
            "id": "logged-job",
            "limit": 10
        }))
        .await
        .expect("read runs");
    assert_eq!(runs["runs"].as_array().expect("runs").len(), 1);
    assert_eq!(runs["runs"][0]["status"], "ok");

    let rejected = service
        .handle_action(json!({
            "action": "runs",
            "id": "../logged-job"
        }))
        .await
        .expect_err("path traversal id should be rejected");
    assert!(rejected.contains("path separators"));
}

#[tokio::test]
async fn cron_service_respects_disabled_jobs() {
    let temp = tempdir().expect("tempdir");
    let service = CronService::new(CronServiceOptions {
        runtime_root: temp.path().join("runtime"),
        store_path: Some(temp.path().join("cron").join("jobs.json")),
        enabled: true,
        start_scheduler: false,
        ..CronServiceOptions::default()
    })
    .expect("cron service");

    service
        .handle_action(json!({
            "action": "add",
            "job": {
                "id": "disabled-job",
                "name": "Disabled job",
                "schedule": { "kind": "every", "everyMs": 1 },
                "sessionTarget": "main",
                "payload": { "kind": "systemEvent", "text": "should not run" },
                "enabled": false
            }
        }))
        .await
        .expect("add disabled job");

    let active_list = service
        .handle_action(json!({ "action": "list" }))
        .await
        .expect("list active jobs");
    assert_eq!(active_list["jobs"].as_array().expect("jobs").len(), 0);

    let skipped = service
        .handle_action(json!({
            "action": "run",
            "id": "disabled-job",
            "mode": "force"
        }))
        .await
        .expect("run disabled job");
    assert_eq!(skipped["status"], "skipped");
    assert_eq!(skipped["reason"], "disabled");
}

#[tokio::test]
async fn cron_gateway_methods_keep_legacy_shapes_and_store_schema() {
    let temp = tempdir().expect("tempdir");
    let runtime_root = temp.path().join("runtime");
    let store_path = temp.path().join("cron").join("jobs.json");
    let service = CronService::new(CronServiceOptions {
        runtime_root: runtime_root.clone(),
        store_path: Some(store_path.clone()),
        enabled: true,
        start_scheduler: false,
        ..CronServiceOptions::default()
    })
    .expect("cron service");

    let added = service
        .handle_method(
            "cron.add",
            json!({
                "name": "Gateway shape",
                "schedule": { "at": "2999-01-01T00:00:00Z" },
                "sessionTarget": "main",
                "wakeMode": "now",
                "payload": { "kind": "systemEvent", "text": "legacy gateway shape" }
            }),
        )
        .await
        .expect("cron.add");
    let job_id = added["id"].as_str().expect("job id").to_string();
    assert_eq!(added["wakeMode"], "now");
    assert_eq!(added["deleteAfterRun"], true);
    assert!(added.get("nextRunAtMs").is_none());
    assert!(added["state"]["nextRunAtMs"].is_number());

    let raw_store: Value =
        serde_json::from_slice(&std::fs::read(&store_path).expect("read cron store"))
            .expect("store json");
    assert_eq!(raw_store["version"], 1);
    assert!(raw_store["jobs"][0].get("nextRunAtMs").is_none());
    assert!(raw_store["jobs"][0]["state"]["nextRunAtMs"].is_number());

    let listed = service
        .handle_method("cron.list", json!({ "includeDisabled": true }))
        .await
        .expect("cron.list");
    assert_eq!(listed["total"], 1);
    assert_eq!(listed["jobs"][0]["id"], job_id);

    let run = service
        .handle_method("cron.run", json!({ "id": job_id, "mode": "force" }))
        .await
        .expect("cron.run");
    assert_eq!(run["ok"], true);
    assert_eq!(run["enqueued"], true);
    assert!(run["runId"]
        .as_str()
        .expect("run id")
        .starts_with("manual:"));
    wait_for_system_message(&runtime_root, "legacy gateway shape").await;

    let runs = service
        .handle_method("cron.runs", json!({ "id": job_id, "limit": 10 }))
        .await
        .expect("cron.runs");
    assert_eq!(runs["total"], 1);
    assert_eq!(runs["entries"][0]["action"], "finished");
    assert_eq!(runs["entries"][0]["status"], "ok");
    assert_eq!(runs["entries"][0]["deliveryStatus"], "not-requested");

    let invalid_webhook = service
        .handle_method(
            "cron.add",
            json!({
                "name": "Bad webhook",
                "schedule": { "kind": "every", "everyMs": 60000 },
                "sessionTarget": "main",
                "wakeMode": "now",
                "payload": { "kind": "systemEvent", "text": "bad webhook" },
                "delivery": { "mode": "webhook", "to": "file:///tmp/nope" }
            }),
        )
        .await
        .expect_err("invalid webhook should be rejected");
    assert!(invalid_webhook.contains("valid http(s) URL"));
}

#[tokio::test]
async fn cron_service_uses_configured_store_path() {
    let _guard = env_lock().lock().await;
    let previous_state_dir = std::env::var_os("CRAWCLAW_STATE_DIR");
    let temp = tempdir().expect("tempdir");
    let state_dir = temp.path().join("state");
    let configured_store = temp.path().join("custom").join("jobs.json");
    std::fs::create_dir_all(&state_dir).expect("state dir");
    std::fs::write(
        state_dir.join("crawclaw.json"),
        serde_json::to_vec(&json!({
            "cron": {
                "store": configured_store.to_string_lossy()
            }
        }))
        .expect("config json"),
    )
    .expect("write config");
    std::env::set_var("CRAWCLAW_STATE_DIR", &state_dir);

    let service = CronService::new(CronServiceOptions {
        runtime_root: temp.path().join("runtime"),
        enabled: true,
        start_scheduler: false,
        ..CronServiceOptions::default()
    })
    .expect("cron service");

    assert_eq!(service.store_path(), configured_store.as_path());

    match previous_state_dir {
        Some(value) => std::env::set_var("CRAWCLAW_STATE_DIR", value),
        None => std::env::remove_var("CRAWCLAW_STATE_DIR"),
    }
}

#[tokio::test]
async fn cron_service_adds_lists_and_runs_main_jobs() {
    let temp = tempdir().expect("tempdir");
    let runtime_root = temp.path().join("runtime");
    let store_path = temp.path().join("cron").join("jobs.json");
    let service = CronService::new(CronServiceOptions {
        runtime_root: runtime_root.clone(),
        store_path: Some(store_path.clone()),
        enabled: true,
        start_scheduler: false,
        ..CronServiceOptions::default()
    })
    .expect("cron service");

    let added = service
        .handle_action(json!({
            "action": "add",
            "job": {
                "id": "job-main",
                "name": "Main reminder",
                "schedule": { "kind": "at", "at": "2999-01-01T00:00:00Z" },
                "sessionTarget": "main",
                "payload": { "kind": "systemEvent", "text": "wake up main session" },
                "enabled": true
            }
        }))
        .await
        .expect("add cron job");

    assert_eq!(added["job"]["id"], "job-main");
    assert!(store_path.exists());

    let listed = service
        .handle_action(json!({
            "action": "list",
            "includeDisabled": true
        }))
        .await
        .expect("list cron jobs");
    assert_eq!(listed["jobs"][0]["id"], "job-main");

    let run = service
        .handle_action(json!({
            "action": "run",
            "id": "job-main",
            "mode": "force"
        }))
        .await
        .expect("run cron job");
    assert_eq!(run["status"], "ok");
    assert_eq!(run["jobId"], "job-main");

    let history = DesktopSessionStore::new(runtime_root)
        .session_history("main")
        .expect("main session history");
    assert!(history
        .iter()
        .any(|message| message.role == "system" && message.content == "wake up main session"));
}

#[tokio::test]
async fn cron_tool_is_registered_and_uses_state_dir_store() {
    let _guard = env_lock().lock().await;
    let previous_state_dir = std::env::var_os("CRAWCLAW_STATE_DIR");
    let temp = tempdir().expect("tempdir");
    std::env::set_var("CRAWCLAW_STATE_DIR", temp.path());

    let runtime_root = temp.path().join("runtime");
    let registry = crawclaw_runtime::build_native_runtime_tool_registry_for_test(&runtime_root);
    let cron = registry.get("cron").expect("cron tool");
    assert!(!cron.is_read_only());

    let output = cron
        .execute(
            "cron-add",
            json!({
                "action": "add",
                "job": {
                    "id": "tool-job",
                    "name": "Tool reminder",
                    "schedule": { "kind": "every", "everyMs": 60000 },
                    "sessionTarget": "main",
                    "payload": { "kind": "systemEvent", "text": "tool reminder" }
                }
            }),
            None,
        )
        .await
        .expect("cron add through tool");

    assert_eq!(
        output
            .details
            .as_ref()
            .and_then(|details| details.get("job"))
            .and_then(|job| job.get("id")),
        Some(&json!("tool-job"))
    );
    assert!(temp.path().join("cron").join("jobs.json").exists());

    match previous_state_dir {
        Some(value) => std::env::set_var("CRAWCLAW_STATE_DIR", value),
        None => std::env::remove_var("CRAWCLAW_STATE_DIR"),
    }
}
