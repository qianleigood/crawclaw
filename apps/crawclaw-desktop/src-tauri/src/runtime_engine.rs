use std::path::PathBuf;

use crate::models::RuntimeStatus;

pub use crawclaw_runtime::{RuntimeCommand, RuntimeLayout};

pub fn resolve_runtime_layout(resource_dir: PathBuf) -> RuntimeLayout {
    crawclaw_runtime::resolve_runtime_layout(resource_dir)
}

pub fn build_desktop_runtime_status_command(layout: &RuntimeLayout) -> RuntimeCommand {
    crawclaw_runtime::build_desktop_runtime_status_command(layout)
}

pub fn build_gateway_help_command(layout: &RuntimeLayout) -> RuntimeCommand {
    crawclaw_runtime::build_gateway_help_command(layout)
}

pub fn inspect_runtime_layout(layout: &RuntimeLayout) -> RuntimeStatus {
    runtime_status_from_native(crawclaw_runtime::inspect_runtime_layout(layout))
}

pub fn runtime_status_from_native(status: crawclaw_runtime::NativeRuntimeStatus) -> RuntimeStatus {
    RuntimeStatus {
        status: status.status,
        detail: status.detail,
        runtime_root: status.runtime_root,
        binary_path: status.binary_path,
        compat: status.compat,
        node_path: String::new(),
        entrypoint_path: String::new(),
    }
}
