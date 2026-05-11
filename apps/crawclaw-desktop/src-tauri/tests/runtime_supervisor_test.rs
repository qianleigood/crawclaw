use std::fs;
use std::path::{Path, PathBuf};

use crawclaw_desktop::gateway::runtime_supervisor::RuntimeSupervisor;
use crawclaw_desktop::models::RuntimeStatusValue;
use crawclaw_desktop::runtime_engine::RuntimeLayout;
use uuid::Uuid;

#[tokio::test]
async fn runtime_supervisor_reports_missing_layout_without_running_node() {
    let layout = runtime_layout(temp_runtime_root("missing"));

    let supervisor = RuntimeSupervisor::probe(layout).await;
    let status = supervisor.status();

    assert_eq!(status.status, RuntimeStatusValue::Missing);
    assert!(status.detail.contains("Missing embedded runtime file"));
}

#[cfg(unix)]
#[tokio::test]
async fn runtime_supervisor_reports_native_runtime_ready_without_node_bridge() {
    let layout = create_runtime_fixture(
        "success",
        r#"#!/bin/sh
case "$*" in
  *"desktop-runtime status --json"*) echo '{"ok":true,"runtime":"ready"}'; exit 0 ;;
  *) echo "unexpected args: $*" >&2; exit 9 ;;
esac
"#,
    );

    let supervisor = RuntimeSupervisor::probe(layout.clone()).await;
    let status = supervisor.status();

    assert_eq!(status.status, RuntimeStatusValue::Ready);
    assert_eq!(status.binary_path, layout.binary_path.to_string_lossy());
    assert_eq!(status.node_path, "");
    assert_eq!(status.entrypoint_path, "");
}

#[cfg(unix)]
#[tokio::test]
async fn runtime_supervisor_reports_native_runtime_failure_as_runtime_error() {
    let layout = create_runtime_fixture(
        "failure",
        r#"#!/bin/sh
echo "runtime status exploded" >&2
exit 7
"#,
    );

    let supervisor = RuntimeSupervisor::probe(layout).await;
    let status = supervisor.status();

    assert_eq!(status.status, RuntimeStatusValue::Error);
    assert!(status.detail.contains("desktop-runtime status failed"));
    assert!(status.detail.contains("runtime status exploded"));
}

#[cfg(unix)]
#[tokio::test]
async fn runtime_supervisor_reports_non_executable_runtime_binary_as_runtime_error() {
    let layout = create_runtime_fixture_without_chmod(
        "not-executable",
        r#"#!/bin/sh
echo "should not run"
exit 0
"#,
    );

    let supervisor = RuntimeSupervisor::probe(layout).await;
    let status = supervisor.status();

    assert_eq!(status.status, RuntimeStatusValue::Error);
    assert!(status
        .detail
        .contains("Failed to execute embedded Rust runtime"));
}

#[cfg(unix)]
fn create_runtime_fixture(name: &str, runtime_script: &str) -> RuntimeLayout {
    let layout = create_runtime_fixture_without_chmod(name, runtime_script);

    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(&layout.binary_path)
        .expect("runtime metadata")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&layout.binary_path, permissions).expect("runtime chmod");

    layout
}

#[cfg(unix)]
fn create_runtime_fixture_without_chmod(name: &str, runtime_script: &str) -> RuntimeLayout {
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

    layout
}

fn runtime_layout(runtime_root: PathBuf) -> RuntimeLayout {
    RuntimeLayout {
        binary_path: runtime_root.join("bin").join(if cfg!(windows) {
            "crawclaw.exe"
        } else {
            "crawclaw"
        }),
        channel_manifest_path: runtime_root.join("channels").join("manifest.json"),
        manifest_path: runtime_root.join("runtimes").join("manifest.json"),
        runtime_root,
    }
}

fn temp_runtime_root(name: &str) -> PathBuf {
    temp_root()
        .join("runtime-supervisor")
        .join(format!("{name}-{}", Uuid::new_v4().simple()))
}

fn temp_root() -> &'static Path {
    Path::new(env!("CARGO_TARGET_TMPDIR"))
}
