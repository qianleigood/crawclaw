use tokio::process::Command;

use crate::models::{RuntimeStatus, RuntimeStatusValue};
use crate::runtime_engine::{
    build_desktop_runtime_status_command, inspect_runtime_layout, RuntimeLayout,
};

#[derive(Clone)]
pub struct RuntimeSupervisor {
    status: RuntimeStatus,
}

impl RuntimeSupervisor {
    pub fn new(status: RuntimeStatus) -> Self {
        Self { status }
    }

    pub async fn probe(layout: RuntimeLayout) -> Self {
        let inspected = inspect_runtime_layout(&layout);
        if inspected.status != RuntimeStatusValue::Ready {
            return Self::new(inspected);
        }

        match probe_desktop_runtime_status(&layout).await {
            Ok(output) => Self::new(RuntimeStatus {
                status: RuntimeStatusValue::Ready,
                detail: format!(
                    "Embedded Rust runtime status succeeded. {}",
                    summarize_probe_output(&output.stdout, &output.stderr)
                )
                .trim()
                .to_string(),
                runtime_root: inspected.runtime_root,
                binary_path: inspected.binary_path,
                compat: inspected.compat,
                node_path: String::new(),
                entrypoint_path: String::new(),
            }),
            Err(error) => Self::new(RuntimeStatus {
                status: RuntimeStatusValue::Error,
                detail: error,
                runtime_root: inspected.runtime_root,
                binary_path: inspected.binary_path,
                compat: inspected.compat,
                node_path: String::new(),
                entrypoint_path: String::new(),
            }),
        }
    }

    pub fn status(&self) -> RuntimeStatus {
        self.status.clone()
    }
}

struct ProbeOutput {
    stdout: String,
    stderr: String,
}

async fn probe_desktop_runtime_status(layout: &RuntimeLayout) -> Result<ProbeOutput, String> {
    let command = build_desktop_runtime_status_command(layout);
    let output = Command::new(&command.program)
        .args(&command.args)
        .current_dir(&command.cwd)
        .output()
        .await
        .map_err(|error| format!("Failed to execute embedded Rust runtime: {error}"))?;

    let stdout = output_text(&output.stdout);
    let stderr = output_text(&output.stderr);
    if !output.status.success() {
        let suffix = output
            .status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(format!(
            "desktop-runtime status failed with exit code {suffix}{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    Ok(ProbeOutput { stdout, stderr })
}

fn output_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

fn summarize_probe_output(stdout: &str, stderr: &str) -> String {
    let stdout = stdout.trim();
    if !stdout.is_empty() {
        return stdout.lines().next().unwrap_or(stdout).to_string();
    }

    let stderr = stderr.trim();
    if !stderr.is_empty() {
        return stderr.lines().next().unwrap_or(stderr).to_string();
    }

    String::new()
}
