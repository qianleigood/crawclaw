use super::*;

pub(super) fn update_run(state: &GatewayState, _params: Value) -> Result<Value, String> {
    let started = Instant::now();
    let Some(root) = resolve_update_git_root(state) else {
        let result = json!({
            "status": "error",
            "mode": "unknown",
            "reason": "no-git-root",
            "steps": [],
            "durationMs": started.elapsed().as_millis()
        });
        return Ok(json!({
            "ok": false,
            "status": "error",
            "result": result,
            "restart": Value::Null,
            "implementation": "rust-native"
        }));
    };

    let before_sha =
        update_command_stdout(&root, &["git", "-C", path_str(&root), "rev-parse", "HEAD"])
            .unwrap_or_default()
            .trim()
            .to_string();
    let mut steps = Vec::new();

    let clean_check = run_update_step(
        "clean check",
        &["git", "-C", path_str(&root), "status", "--porcelain"],
        &root,
    );
    let dirty = clean_check
        .get("stdoutTail")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    steps.push(clean_check);
    if dirty {
        let result = update_result(
            "skipped",
            "git",
            &root,
            Some("dirty"),
            &before_sha,
            None,
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    }

    let upstream_check = run_update_step(
        "upstream check",
        &[
            "git",
            "-C",
            path_str(&root),
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        &root,
    );
    let has_upstream = update_step_success(&upstream_check);
    steps.push(upstream_check);
    if !has_upstream {
        let result = update_result(
            "skipped",
            "git",
            &root,
            Some("no-upstream"),
            &before_sha,
            None,
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    }

    let fetch = run_update_step(
        "git fetch",
        &[
            "git",
            "-C",
            path_str(&root),
            "fetch",
            "--all",
            "--prune",
            "--tags",
        ],
        &root,
    );
    let fetch_ok = update_step_success(&fetch);
    steps.push(fetch);
    if !fetch_ok {
        let result = update_result(
            "error",
            "git",
            &root,
            Some("fetch-failed"),
            &before_sha,
            None,
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    }

    let upstream_sha_step = run_update_step(
        "git rev-parse @{upstream}",
        &["git", "-C", path_str(&root), "rev-parse", "@{upstream}"],
        &root,
    );
    let upstream_sha = upstream_sha_step
        .get("stdoutTail")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let upstream_ok = update_step_success(&upstream_sha_step);
    steps.push(upstream_sha_step);
    let Some(upstream_sha) = upstream_sha.filter(|_| upstream_ok) else {
        let result = update_result(
            "error",
            "git",
            &root,
            Some("no-upstream-sha"),
            &before_sha,
            None,
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    };

    if upstream_sha == before_sha {
        let result = update_result(
            "skipped",
            "git",
            &root,
            Some("up-to-date"),
            &before_sha,
            Some(&before_sha),
            steps,
            started.elapsed().as_millis(),
        );
        return Ok(update_run_response(result));
    }

    let result = update_result(
        "skipped",
        "git",
        &root,
        Some("update-available"),
        &before_sha,
        Some(&upstream_sha),
        steps,
        started.elapsed().as_millis(),
    );
    Ok(update_run_response(result))
}

pub(super) fn resolve_update_git_root(state: &GatewayState) -> Option<PathBuf> {
    let mut candidates = vec![state.runtime_root.clone()];
    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd);
    }
    for candidate in candidates {
        let Ok(output) = std::process::Command::new("git")
            .args(["-C", path_str(&candidate), "rev-parse", "--show-toplevel"])
            .output()
        else {
            continue;
        };
        if output.status.success() {
            let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !root.is_empty() {
                return Some(PathBuf::from(root));
            }
        }
    }
    None
}

pub(super) fn run_update_step(name: &str, argv: &[&str], cwd: &std::path::Path) -> Value {
    let started = Instant::now();
    let output = std::process::Command::new(argv[0])
        .args(&argv[1..])
        .current_dir(cwd)
        .output();
    let duration_ms = started.elapsed().as_millis();
    match output {
        Ok(output) => json!({
            "name": name,
            "command": argv.join(" "),
            "cwd": cwd.to_string_lossy(),
            "durationMs": duration_ms,
            "exitCode": output.status.code(),
            "stdoutTail": trim_update_log_tail(&String::from_utf8_lossy(&output.stdout)),
            "stderrTail": trim_update_log_tail(&String::from_utf8_lossy(&output.stderr))
        }),
        Err(error) => json!({
            "name": name,
            "command": argv.join(" "),
            "cwd": cwd.to_string_lossy(),
            "durationMs": duration_ms,
            "exitCode": Value::Null,
            "stdoutTail": Value::Null,
            "stderrTail": error.to_string()
        }),
    }
}

pub(super) fn update_step_success(step: &Value) -> bool {
    step.get("exitCode")
        .and_then(Value::as_i64)
        .map(|code| code == 0)
        .unwrap_or(false)
}

pub(super) fn update_command_stdout(cwd: &std::path::Path, argv: &[&str]) -> Option<String> {
    let output = std::process::Command::new(argv[0])
        .args(&argv[1..])
        .current_dir(cwd)
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

pub(super) fn update_result(
    status: &str,
    mode: &str,
    root: &std::path::Path,
    reason: Option<&str>,
    before_sha: &str,
    after_sha: Option<&str>,
    steps: Vec<Value>,
    duration_ms: u128,
) -> Value {
    json!({
        "status": status,
        "mode": mode,
        "root": root.to_string_lossy(),
        "reason": reason,
        "before": {
            "sha": if before_sha.is_empty() { Value::Null } else { Value::String(before_sha.to_string()) }
        },
        "after": after_sha.map(|sha| json!({ "sha": sha })),
        "steps": steps,
        "durationMs": duration_ms
    })
}

pub(super) fn update_run_response(result: Value) -> Value {
    let status = result
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("error")
        .to_string();
    json!({
        "ok": status != "error",
        "status": status,
        "result": result,
        "restart": Value::Null,
        "implementation": "rust-native"
    })
}

pub(super) fn trim_update_log_tail(raw: &str) -> Value {
    const MAX_LOG_CHARS: usize = 8000;
    if raw.is_empty() {
        return Value::Null;
    }
    let chars = raw.chars().collect::<Vec<_>>();
    let start = chars.len().saturating_sub(MAX_LOG_CHARS);
    Value::String(chars[start..].iter().collect())
}

pub(super) fn path_str(path: &std::path::Path) -> &str {
    path.to_str().unwrap_or("")
}
