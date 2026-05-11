use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use crawclaw_desktop::gateway::desktop_api::{is_loopback_addr, new_gateway_session_token};
use crawclaw_desktop::runtime_engine::{
    build_gateway_help_command, resolve_runtime_layout, RuntimeLayout,
};

#[test]
fn resolves_embedded_runtime_layout_from_resource_dir() {
    let layout = resolve_runtime_layout(PathBuf::from("/app/Contents/Resources"));

    assert_eq!(
        layout.runtime_root,
        PathBuf::from("/app/Contents/Resources/runtime/crawclaw")
    );
    assert_eq!(
        layout.binary_path,
        PathBuf::from("/app/Contents/Resources/runtime/crawclaw/bin/crawclaw"),
    );
    assert_eq!(
        layout.manifest_path,
        PathBuf::from("/app/Contents/Resources/runtime/crawclaw/runtimes/manifest.json"),
    );
    assert_eq!(
        layout.channel_manifest_path,
        PathBuf::from("/app/Contents/Resources/runtime/crawclaw/channels/manifest.json"),
    );
}

#[test]
fn runtime_gateway_help_command_uses_embedded_rust_binary() {
    let layout = RuntimeLayout {
        runtime_root: PathBuf::from("/runtime/crawclaw"),
        binary_path: PathBuf::from("/runtime/crawclaw/bin/crawclaw"),
        channel_manifest_path: PathBuf::from("/runtime/crawclaw/channels/manifest.json"),
        manifest_path: PathBuf::from("/runtime/crawclaw/runtimes/manifest.json"),
    };

    let command = build_gateway_help_command(&layout);

    assert_eq!(
        command.program,
        PathBuf::from("/runtime/crawclaw/bin/crawclaw")
    );
    assert_eq!(
        command.args,
        vec!["gateway".to_string(), "--help".to_string()]
    );
    assert_eq!(command.cwd, PathBuf::from("/runtime/crawclaw"));
}

#[test]
fn gateway_accepts_only_loopback_addresses() {
    assert!(is_loopback_addr(&SocketAddr::new(
        IpAddr::V4(Ipv4Addr::LOCALHOST),
        0
    )));
    assert!(!is_loopback_addr(&SocketAddr::new(
        IpAddr::V4(Ipv4Addr::UNSPECIFIED),
        0
    )));
    assert!(!is_loopback_addr(&SocketAddr::new(
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 5)),
        0
    )));
}

#[test]
fn session_tokens_are_generated_per_launch() {
    let first = new_gateway_session_token();
    let second = new_gateway_session_token();

    assert_ne!(first, second);
    assert!(first.len() >= 32);
    assert!(second.len() >= 32);
}
