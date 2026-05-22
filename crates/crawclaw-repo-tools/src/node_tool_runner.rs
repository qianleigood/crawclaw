use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};

use crate::node_tooling::{
    current_env, node_program, resolve_node_modules_bin, run_tool_invocation, ToolInvocation,
};

const DEFAULT_LOCAL_GO_GC: &str = "30";
const DEFAULT_LOCAL_GO_MEMORY_LIMIT: &str = "3GiB";
const DEFAULT_LOCK_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const DEFAULT_LOCK_POLL_MS: u64 = 500;
const DEFAULT_STALE_LOCK_MS: u64 = 30 * 1000;
const DEFAULT_TSGO_PROJECT: &str = "apps/crawclaw-desktop/tsconfig.json";

pub fn build_tsgo_invocation(args: &[String], env_vars: &[(String, String)]) -> ToolInvocation {
    let mut next_args = args.to_vec();
    let mut next_env = env_vars.to_vec();

    if !has_project_arg(&next_args) && !has_help_arg(&next_args) {
        insert_before_separator(&mut next_args, &["--project", DEFAULT_TSGO_PROJECT]);
    }

    if is_local_check_enabled(env_vars) {
        insert_before_separator(&mut next_args, &["--singleThreaded"]);
        insert_before_separator(&mut next_args, &["--checkers", "1"]);
        ensure_env(&mut next_env, "GOGC", DEFAULT_LOCAL_GO_GC);
        ensure_env(&mut next_env, "GOMEMLIMIT", DEFAULT_LOCAL_GO_MEMORY_LIMIT);
        if let Some(pprof_dir) =
            env_value(env_vars, "CRAWCLAW_TSGO_PPROF_DIR").filter(|value| !value.trim().is_empty())
        {
            if !has_flag(&next_args, "--pprofDir") {
                insert_before_separator(&mut next_args, &["--pprofDir", pprof_dir]);
            }
        }
    }

    ToolInvocation {
        program: resolve_node_modules_bin("tsgo"),
        args: next_args,
        env: next_env,
    }
}

pub fn build_oxlint_invocation(args: &[String], env_vars: &[(String, String)]) -> ToolInvocation {
    let mut next_args = args.to_vec();
    insert_before_separator(&mut next_args, &["--type-aware"]);
    insert_before_separator(&mut next_args, &["--tsconfig", "tsconfig.oxlint.json"]);
    if is_local_check_enabled(env_vars) {
        insert_before_separator(&mut next_args, &["--threads=1"]);
    }

    ToolInvocation {
        program: resolve_node_modules_bin("oxlint"),
        args: next_args,
        env: env_vars.to_vec(),
    }
}

pub fn build_typecheck_invocation(
    args: &[String],
    env_vars: &[(String, String)],
) -> ToolInvocation {
    let max_old_space_size = env_value(env_vars, "CRAWCLAW_TSC_MAX_OLD_SPACE_SIZE")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("8192")
        .to_string();
    let mut final_args = vec![
        format!("--max-old-space-size={max_old_space_size}"),
        "./node_modules/typescript/bin/tsc".to_string(),
        "--noEmit".to_string(),
    ];
    final_args.extend(args.iter().cloned());

    ToolInvocation {
        program: node_program(),
        args: final_args,
        env: env_vars.to_vec(),
    }
}

pub fn run_tsgo(args: &[String]) -> Result<i32, String> {
    run_with_optional_lock("tsgo", build_tsgo_invocation(args, &current_env()))
}

pub fn run_oxlint(args: &[String]) -> Result<i32, String> {
    run_with_optional_lock("oxlint", build_oxlint_invocation(args, &current_env()))
}

pub fn run_typecheck(args: &[String]) -> Result<i32, String> {
    run_tool_invocation(build_typecheck_invocation(args, &current_env()))
}

fn run_with_optional_lock(tool_name: &str, invocation: ToolInvocation) -> Result<i32, String> {
    let _lock = if is_local_check_enabled(&invocation.env) {
        Some(acquire_local_heavy_check_lock(
            &env::current_dir().map_err(|error| format!("failed to resolve cwd: {error}"))?,
            tool_name,
            &invocation.env,
        )?)
    } else {
        None
    };
    run_tool_invocation(invocation)
}

fn is_local_check_enabled(env_vars: &[(String, String)]) -> bool {
    env_value(env_vars, "CRAWCLAW_LOCAL_CHECK")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized != "0" && normalized != "false"
        })
        .unwrap_or(true)
}

fn env_value<'a>(env_vars: &'a [(String, String)], key: &str) -> Option<&'a str> {
    env_vars
        .iter()
        .find(|(entry_key, _)| entry_key == key)
        .map(|(_, value)| value.as_str())
}

fn ensure_env(env_vars: &mut Vec<(String, String)>, key: &str, value: &str) {
    if env_value(env_vars, key).is_some() {
        return;
    }
    env_vars.push((key.to_string(), value.to_string()));
}

fn has_flag(args: &[String], name: &str) -> bool {
    args.iter()
        .any(|arg| arg == name || arg.starts_with(&format!("{name}=")))
}

fn has_project_arg(args: &[String]) -> bool {
    args.iter()
        .any(|arg| matches!(arg.as_str(), "-p" | "--project") || arg.starts_with("--project="))
}

fn has_help_arg(args: &[String]) -> bool {
    args.iter()
        .any(|arg| matches!(arg.as_str(), "-h" | "--help" | "help"))
}

fn insert_before_separator(args: &mut Vec<String>, items: &[&str]) {
    if items.first().is_some_and(|first| has_flag(args, first)) {
        return;
    }
    let insert_index = args
        .iter()
        .position(|arg| arg == "--")
        .unwrap_or(args.len());
    for (offset, item) in items.iter().enumerate() {
        args.insert(insert_index + offset, (*item).to_string());
    }
}

struct HeavyCheckLock {
    lock_dir: PathBuf,
}

impl Drop for HeavyCheckLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.lock_dir);
    }
}

fn acquire_local_heavy_check_lock(
    cwd: &Path,
    tool_name: &str,
    env_vars: &[(String, String)],
) -> Result<HeavyCheckLock, String> {
    let common_dir = resolve_git_common_dir(cwd);
    let locks_dir = common_dir.join("crawclaw-local-checks");
    let lock_dir = locks_dir.join("heavy-check.lock");
    let owner_path = lock_dir.join("owner.json");
    let timeout = Duration::from_millis(read_positive_int(
        env_vars,
        "CRAWCLAW_HEAVY_CHECK_LOCK_TIMEOUT_MS",
        DEFAULT_LOCK_TIMEOUT_MS,
    ));
    let poll = Duration::from_millis(read_positive_int(
        env_vars,
        "CRAWCLAW_HEAVY_CHECK_LOCK_POLL_MS",
        DEFAULT_LOCK_POLL_MS,
    ));
    let stale_after = Duration::from_millis(read_positive_int(
        env_vars,
        "CRAWCLAW_HEAVY_CHECK_STALE_LOCK_MS",
        DEFAULT_STALE_LOCK_MS,
    ));
    fs::create_dir_all(&locks_dir)
        .map_err(|error| format!("failed to create {}: {error}", locks_dir.display()))?;

    let started = Instant::now();
    let mut waiting_logged = false;
    loop {
        match fs::create_dir(&lock_dir) {
            Ok(()) => {
                let owner = json!({
                    "pid": std::process::id(),
                    "tool": tool_name,
                    "cwd": cwd.display().to_string(),
                    "hostname": hostname(),
                    "createdAt": chrono::Utc::now().to_rfc3339(),
                });
                fs::write(
                    &owner_path,
                    format!(
                        "{}\n",
                        serde_json::to_string_pretty(&owner).unwrap_or_else(|_| "{}".to_string())
                    ),
                )
                .map_err(|error| format!("failed to write {}: {error}", owner_path.display()))?;
                return Ok(HeavyCheckLock { lock_dir });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let owner = read_owner(&owner_path);
                if should_reclaim_lock(&owner, &lock_dir, stale_after) {
                    let _ = fs::remove_dir_all(&lock_dir);
                    continue;
                }
                if started.elapsed() >= timeout {
                    let owner_label = describe_owner(&owner);
                    return Err(format!(
                        "[{tool_name}] timed out waiting for the local heavy-check lock at {}{}. If no local heavy checks are still running, remove the stale lock and retry.",
                        lock_dir.display(),
                        if owner_label.is_empty() {
                            String::new()
                        } else {
                            format!(" ({owner_label})")
                        }
                    ));
                }
                if !waiting_logged {
                    let owner_label = describe_owner(&owner);
                    eprintln!(
                        "[{tool_name}] waiting for the local heavy-check lock{}...",
                        if owner_label.is_empty() {
                            String::new()
                        } else {
                            format!(" held by {owner_label}")
                        }
                    );
                    waiting_logged = true;
                }
                thread::sleep(poll);
            }
            Err(error) => {
                return Err(format!(
                    "failed to acquire local heavy-check lock at {}: {error}",
                    lock_dir.display()
                ));
            }
        }
    }
}

fn resolve_git_common_dir(cwd: &Path) -> PathBuf {
    let output = Command::new("git")
        .args(["rev-parse", "--git-common-dir"])
        .current_dir(cwd)
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !raw.is_empty() {
                return cwd.join(raw);
            }
        }
    }
    cwd.join(".git")
}

fn read_positive_int(env_vars: &[(String, String)], key: &str, fallback: u64) -> u64 {
    env_value(env_vars, key)
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn read_owner(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn should_reclaim_lock(owner: &Option<Value>, lock_dir: &Path, stale_after: Duration) -> bool {
    if let Some(pid) = owner
        .as_ref()
        .and_then(|value| value.get("pid"))
        .and_then(Value::as_u64)
    {
        return !is_process_alive(pid);
    }
    let Ok(metadata) = fs::metadata(lock_dir) else {
        return true;
    };
    metadata
        .modified()
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|elapsed| elapsed >= stale_after)
}

fn is_process_alive(pid: u64) -> bool {
    if cfg!(unix) {
        return Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success());
    }
    true
}

fn describe_owner(owner: &Option<Value>) -> String {
    let Some(owner) = owner.as_ref().and_then(Value::as_object) else {
        return String::new();
    };
    let tool = owner
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or("unknown-tool");
    let pid = owner
        .get("pid")
        .and_then(Value::as_u64)
        .map(|pid| format!("pid {pid}"))
        .unwrap_or_else(|| "unknown pid".to_string());
    let cwd = owner
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or("unknown cwd");
    format!("{tool}, {pid}, cwd {cwd}")
}

fn hostname() -> String {
    env::var("HOSTNAME")
        .or_else(|_| env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_fixture(entries: &[(&str, &str)]) -> Vec<(String, String)> {
        entries
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    #[test]
    fn tsgo_policy_adds_local_defaults_before_separator() {
        let invocation = build_tsgo_invocation(
            &["--foo".to_string(), "--".to_string(), "rest".to_string()],
            &env_fixture(&[]),
        );
        assert_eq!(
            invocation.args,
            vec![
                "--foo",
                "--project",
                DEFAULT_TSGO_PROJECT,
                "--singleThreaded",
                "--checkers",
                "1",
                "--",
                "rest"
            ]
        );
        assert!(invocation
            .env
            .iter()
            .any(|(key, value)| key == "GOGC" && value == DEFAULT_LOCAL_GO_GC));
    }

    #[test]
    fn oxlint_policy_keeps_existing_flags() {
        let invocation = build_oxlint_invocation(
            &[
                "--type-aware".to_string(),
                "--tsconfig=custom.json".to_string(),
                "--threads=4".to_string(),
            ],
            &env_fixture(&[]),
        );
        assert_eq!(
            invocation.args,
            vec![
                "--type-aware",
                "--tsconfig=custom.json",
                "--threads=4",
                "--threads=1"
            ]
        );
    }

    #[test]
    fn typecheck_uses_configured_memory_limit() {
        let invocation = build_typecheck_invocation(
            &["--project".to_string(), "tsconfig.json".to_string()],
            &env_fixture(&[("CRAWCLAW_TSC_MAX_OLD_SPACE_SIZE", "4096")]),
        );
        assert_eq!(invocation.args[0], "--max-old-space-size=4096");
        assert!(invocation.args.contains(&"--noEmit".to_string()));
    }

    #[test]
    fn local_check_can_be_disabled() {
        assert!(!is_local_check_enabled(&env_fixture(&[(
            "CRAWCLAW_LOCAL_CHECK",
            "false"
        )])));
        let invocation = build_tsgo_invocation(&[], &env_fixture(&[("CRAWCLAW_LOCAL_CHECK", "0")]));
        assert_eq!(
            invocation.args,
            vec!["--project".to_string(), DEFAULT_TSGO_PROJECT.to_string()]
        );
    }

    #[test]
    fn tsgo_policy_keeps_existing_project_arg() {
        let invocation = build_tsgo_invocation(
            &["--project".to_string(), "custom.json".to_string()],
            &env_fixture(&[]),
        );
        assert_eq!(
            invocation.args,
            vec![
                "--project",
                "custom.json",
                "--singleThreaded",
                "--checkers",
                "1"
            ]
        );
    }
}
