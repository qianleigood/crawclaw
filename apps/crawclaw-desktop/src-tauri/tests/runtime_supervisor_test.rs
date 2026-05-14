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

#[tokio::test]
async fn runtime_supervisor_reports_native_runtime_ready_without_cli_probe() {
    let layout = create_runtime_fixture("success");

    let supervisor = RuntimeSupervisor::probe(layout.clone()).await;
    let status = supervisor.status();

    assert_eq!(status.status, RuntimeStatusValue::Ready);
    assert_eq!(status.binary_path, layout.binary_path.to_string_lossy());
    assert_eq!(status.node_path, "");
    assert_eq!(status.entrypoint_path, "");
}

#[tokio::test]
async fn runtime_supervisor_reports_missing_gateway_binary_without_cli_probe() {
    let layout = create_runtime_fixture_without_gateway("missing-gateway");

    let supervisor = RuntimeSupervisor::probe(layout).await;
    let status = supervisor.status();

    assert_eq!(status.status, RuntimeStatusValue::Missing);
    assert!(status.detail.contains("crawclaw-gateway"));
}

#[cfg(unix)]
#[tokio::test]
async fn runtime_supervisor_reports_non_executable_runtime_binary_as_runtime_error() {
    let layout = create_runtime_fixture_without_chmod("not-executable");

    let supervisor = RuntimeSupervisor::probe(layout).await;
    let status = supervisor.status();

    assert_eq!(status.status, RuntimeStatusValue::Error);
    assert!(status
        .detail
        .contains("Embedded Rust runtime binary is not executable"));
}

#[cfg(unix)]
fn create_runtime_fixture(name: &str) -> RuntimeLayout {
    let layout = create_runtime_fixture_without_chmod(name);

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
fn create_runtime_fixture_without_chmod(name: &str) -> RuntimeLayout {
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
    fs::write(&layout.binary_path, "#!/bin/sh\nexit 0\n").expect("runtime binary");
    fs::write(layout.gateway_binary_path(), "#!/bin/sh\nexit 0\n").expect("gateway binary");
    fs::write(layout.native_plugins_binary_path(), "#!/bin/sh\nexit 0\n")
        .expect("native plugins binary");

    layout
}

fn create_runtime_fixture_without_gateway(name: &str) -> RuntimeLayout {
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
    fs::write(&layout.binary_path, "#!/bin/sh\nexit 0\n").expect("runtime binary");
    fs::write(layout.native_plugins_binary_path(), "#!/bin/sh\nexit 0\n")
        .expect("native plugins binary");
    layout
}

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

fn temp_runtime_root(name: &str) -> PathBuf {
    temp_root()
        .join("runtime-supervisor")
        .join(format!("{name}-{}", Uuid::new_v4().simple()))
}

fn temp_root() -> &'static Path {
    Path::new(env!("CARGO_TARGET_TMPDIR"))
}
