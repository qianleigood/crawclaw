use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Output, Stdio};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolInvocation {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeVersionPolicy {
    Any,
    MajorRange {
        min_inclusive: u32,
        max_exclusive: u32,
    },
}

pub const ROOT_NODE_POLICY: NodeVersionPolicy = NodeVersionPolicy::MajorRange {
    min_inclusive: 24,
    max_exclusive: 26,
};

pub fn current_env() -> Vec<(String, String)> {
    env::vars().collect()
}

pub fn node_program() -> PathBuf {
    PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" })
}

pub fn npm_program() -> PathBuf {
    PathBuf::from(if cfg!(windows) { "npm.cmd" } else { "npm" })
}

pub fn pnpm_program() -> PathBuf {
    PathBuf::from(if cfg!(windows) { "pnpm.cmd" } else { "pnpm" })
}

pub fn npx_program() -> PathBuf {
    PathBuf::from(if cfg!(windows) { "npx.cmd" } else { "npx" })
}

pub fn resolve_node_modules_bin(name: &str) -> PathBuf {
    let mut path = PathBuf::from("node_modules").join(".bin").join(name);
    if cfg!(windows) {
        path.set_extension("cmd");
    }
    path
}

pub fn assert_node_version(policy: NodeVersionPolicy) -> Result<(), String> {
    let output = Command::new(node_program())
        .arg("--version")
        .output()
        .map_err(|error| format!("node adapter: failed to run node --version: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "node adapter: node --version failed with status {}: {}",
            format_status(output.status),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let version = String::from_utf8_lossy(&output.stdout);
    let major = parse_node_major(&version).ok_or_else(|| {
        format!(
            "node adapter: failed to parse node version from `{}`",
            version.trim()
        )
    })?;
    match policy {
        NodeVersionPolicy::Any => Ok(()),
        NodeVersionPolicy::MajorRange {
            min_inclusive,
            max_exclusive,
        } if major >= min_inclusive && major < max_exclusive => Ok(()),
        NodeVersionPolicy::MajorRange {
            min_inclusive,
            max_exclusive,
        } => Err(format!(
            "node adapter: Node {} is unsupported; expected >= {} and < {} for repository tooling",
            version.trim(),
            min_inclusive,
            max_exclusive
        )),
    }
}

pub fn run_tool_invocation(invocation: ToolInvocation) -> Result<i32, String> {
    let status = command_from_invocation(&invocation)
        .status()
        .map_err(|error| {
            format!(
                "node adapter: failed to run {} {}: {error}",
                invocation.program.display(),
                invocation.args.join(" ")
            )
        })?;
    Ok(exit_code(status))
}

pub fn run_node_bin(
    tool: &str,
    args: &[String],
    env_vars: &[(String, String)],
) -> Result<i32, String> {
    assert_node_version(ROOT_NODE_POLICY)?;
    run_tool_invocation(ToolInvocation {
        program: resolve_node_modules_bin(tool),
        args: args.to_vec(),
        env: env_vars.to_vec(),
    })
}

pub fn run_npm(args: &[&str], cwd: impl AsRef<Path>) -> Result<i32, String> {
    assert_node_version(ROOT_NODE_POLICY)?;
    run_command_status(npm_program(), args, cwd)
}

pub fn run_pnpm(args: &[&str], cwd: impl AsRef<Path>) -> Result<i32, String> {
    assert_node_version(ROOT_NODE_POLICY)?;
    run_command_status(pnpm_program(), args, cwd)
}

pub fn run_npm_prefix(package_dir: impl AsRef<Path>, script: &str) -> Result<i32, String> {
    let package_dir = package_dir.as_ref();
    let prefix = package_dir.to_string_lossy().to_string();
    run_npm(&["--prefix", &prefix, "run", script], ".")
}

pub fn run_pnpm_script(cwd: impl AsRef<Path>, script: &str) -> Result<i32, String> {
    run_pnpm(&[script], cwd)
}

pub fn run_pnpm_dlx_with_node_major(
    cwd: impl AsRef<Path>,
    node_major: u32,
    args: &[&str],
) -> Result<i32, String> {
    let node_package = format!("node@{node_major}");
    let command = format!("pnpm dlx {}", args.join(" "));
    run_command_status(
        npx_program(),
        &["-y", "-p", &node_package, "-c", &command],
        cwd,
    )
}

pub fn run_npm_output(args: &[&str], cwd: impl AsRef<Path>) -> Result<Output, String> {
    assert_node_version(ROOT_NODE_POLICY)?;
    Command::new(npm_program())
        .args(args)
        .current_dir(cwd.as_ref())
        .output()
        .map_err(|error| {
            format!(
                "node adapter: failed to run npm {}: {error}",
                args.join(" ")
            )
        })
}

fn run_command_status(
    program: PathBuf,
    args: &[&str],
    cwd: impl AsRef<Path>,
) -> Result<i32, String> {
    let status = Command::new(&program)
        .args(args)
        .current_dir(cwd.as_ref())
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| {
            format!(
                "node adapter: failed to run {} {}: {error}",
                program.display(),
                args.join(" ")
            )
        })?;
    Ok(exit_code(status))
}

fn command_from_invocation(invocation: &ToolInvocation) -> Command {
    let mut command = Command::new(&invocation.program);
    command.args(&invocation.args);
    command.envs(invocation.env.iter().map(|(key, value)| (key, value)));
    command.stdin(Stdio::inherit());
    command.stdout(Stdio::inherit());
    command.stderr(Stdio::inherit());
    command
}

fn exit_code(status: ExitStatus) -> i32 {
    status.code().unwrap_or(1)
}

fn format_status(status: ExitStatus) -> String {
    status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "?".to_string())
}

fn parse_node_major(raw: &str) -> Option<u32> {
    raw.trim()
        .strip_prefix('v')
        .unwrap_or(raw.trim())
        .split('.')
        .next()
        .and_then(|value| value.parse::<u32>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_node_major_with_v_prefix() {
        assert_eq!(parse_node_major("v25.5.0\n"), Some(25));
    }

    #[test]
    fn parses_node_major_without_v_prefix() {
        assert_eq!(parse_node_major("24.11.1"), Some(24));
    }
}
