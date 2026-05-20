use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::parse_github_repo_remote;

pub fn run_ghsa_patch(args: &[String]) -> Result<i32, String> {
    let args = parse_key_value_args(args)?;
    if missing_required_args(&args) {
        return Err(ghsa_patch_usage());
    }

    let repo = match args.get("repo") {
        Some(repo) => repo.to_string(),
        None => derive_repo_from_origin()?,
    };
    let ghsa_id = parse_ghsa_id(required_arg(&args, "ghsa")?)?;
    let advisory_path = format!("/repos/{repo}/security-advisories/{ghsa_id}");
    let description_path = resolve_path(required_arg(&args, "description-file")?)?;
    if !description_path.exists() {
        return Err(format!(
            "Description file does not exist: {}",
            description_path.display()
        ));
    }

    let current = run_gh_json(&[
        "api",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
        &advisory_path,
    ])?;
    let restored_cvss = args.get("cvss").cloned().or_else(|| {
        current
            .get("cvss")
            .and_then(|cvss| cvss.get("vector_string"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });

    let vulnerable_range = required_arg(&args, "vulnerable-version-range")?;
    let patched_versions_raw = required_arg(&args, "patched-versions")?;
    let patched_versions = if patched_versions_raw == "null" {
        Value::Null
    } else {
        Value::String(patched_versions_raw.to_string())
    };
    let description = fs::read_to_string(&description_path)
        .map_err(|error| format!("failed to read {}: {error}", description_path.display()))?;

    let payload = build_ghsa_patch_payload(GhsaPatchPayloadInput {
        summary: required_arg(&args, "summary")?,
        severity: required_arg(&args, "severity")?,
        description: &description,
        ecosystem: args.get("ecosystem").map(String::as_str).unwrap_or("npm"),
        package_name: args
            .get("package")
            .map(String::as_str)
            .unwrap_or("crawclaw"),
        vulnerable_range,
        patched_versions,
    });
    let patch_file = write_temp_json(&payload)?;
    run_gh(&[
        "api",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
        "-X",
        "PATCH",
        &advisory_path,
        "--input",
        &patch_file.display().to_string(),
    ])?;

    if let Some(cvss) = restored_cvss {
        run_gh(&[
            "api",
            "-H",
            "X-GitHub-Api-Version: 2022-11-28",
            "-X",
            "PATCH",
            &advisory_path,
            "-f",
            &format!("cvss_vector_string={cvss}"),
        ])?;
    }

    let refreshed = run_gh_json(&[
        "api",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
        &advisory_path,
    ])?;
    let output = json!({
        "html_url": refreshed.get("html_url").cloned().unwrap_or(Value::Null),
        "state": refreshed.get("state").cloned().unwrap_or(Value::Null),
        "severity": refreshed.get("severity").cloned().unwrap_or(Value::Null),
        "summary": refreshed.get("summary").cloned().unwrap_or(Value::Null),
        "vulnerabilities": refreshed.get("vulnerabilities").cloned().unwrap_or(Value::Null),
        "cvss": refreshed.get("cvss").cloned().unwrap_or(Value::Null),
        "updated_at": refreshed.get("updated_at").cloned().unwrap_or(Value::Null),
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&output)
            .unwrap_or_else(|error| format!("{{\"error\":\"{error}\"}}"))
    );
    Ok(0)
}

fn ghsa_patch_usage() -> String {
    [
        "Usage:",
        "  crawclaw-runtime ghsa-patch --ghsa <GHSA-id-or-url> [--repo owner/name]",
        "    --summary <text> --severity <low|medium|high|critical>",
        "    --description-file <path>",
        "    --vulnerable-version-range <range>",
        "    --patched-versions <range-or-null>",
        "    [--package crawclaw] [--ecosystem npm] [--cvss <vector>]",
    ]
    .join("\n")
}

fn parse_key_value_args(args: &[String]) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if !arg.starts_with("--") {
            return Err(format!("Unexpected argument: {arg}"));
        }
        let key = arg.trim_start_matches("--");
        let Some(value) = args.get(index + 1) else {
            return Err(format!("Missing value for --{key}"));
        };
        if value.starts_with("--") {
            return Err(format!("Missing value for --{key}"));
        }
        out.insert(key.to_string(), value.to_string());
        index += 2;
    }
    Ok(out)
}

fn missing_required_args(args: &BTreeMap<String, String>) -> bool {
    !args.contains_key("ghsa")
        || !args.contains_key("summary")
        || !args.contains_key("severity")
        || !args.contains_key("description-file")
        || !args.contains_key("vulnerable-version-range")
        || !args.contains_key("patched-versions")
}

fn required_arg<'a>(args: &'a BTreeMap<String, String>, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .map(String::as_str)
        .ok_or_else(|| format!("Missing --{key}"))
}

fn resolve_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return Ok(path);
    }
    Ok(env::current_dir()
        .map_err(|error| format!("failed to resolve cwd: {error}"))?
        .join(path))
}

fn derive_repo_from_origin() -> Result<String, String> {
    let output = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .output()
        .map_err(|error| format!("failed to run git remote get-url origin: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .trim()
            .to_string()
            .if_empty("Could not read origin remote"));
    }
    parse_github_repo_remote(&String::from_utf8_lossy(&output.stdout))
        .map_err(|error| format!("Could not parse origin remote: {error}"))
}

pub fn parse_ghsa_id(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    if bytes.len() < 19 {
        return Err(format!("Could not parse GHSA id from: {value}"));
    }
    for start in 0..=(bytes.len() - 19) {
        let Ok(candidate) = std::str::from_utf8(&bytes[start..start + 19]) else {
            continue;
        };
        if is_ghsa_id(candidate) {
            return Ok(candidate.to_string());
        }
    }
    Err(format!("Could not parse GHSA id from: {value}"))
}

fn is_ghsa_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 19
        && value[..4].eq_ignore_ascii_case("GHSA")
        && bytes[4] == b'-'
        && bytes[9] == b'-'
        && bytes[14] == b'-'
        && bytes[5..9].iter().all(u8::is_ascii_alphanumeric)
        && bytes[10..14].iter().all(u8::is_ascii_alphanumeric)
        && bytes[15..19].iter().all(u8::is_ascii_alphanumeric)
}

struct GhsaPatchPayloadInput<'a> {
    summary: &'a str,
    severity: &'a str,
    description: &'a str,
    ecosystem: &'a str,
    package_name: &'a str,
    vulnerable_range: &'a str,
    patched_versions: Value,
}

fn build_ghsa_patch_payload(input: GhsaPatchPayloadInput<'_>) -> Value {
    json!({
        "summary": input.summary,
        "severity": input.severity,
        "description": input.description,
        "vulnerabilities": [
            {
                "package": {
                    "ecosystem": input.ecosystem,
                    "name": input.package_name,
                },
                "vulnerable_version_range": input.vulnerable_range,
                "patched_versions": input.patched_versions,
                "vulnerable_functions": [],
            },
        ],
    })
}

fn write_temp_json(data: &Value) -> Result<PathBuf, String> {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("failed to read system time: {error}"))?
        .as_nanos();
    let file = env::temp_dir().join(format!("ghsa-patch-{}-{suffix}.json", std::process::id()));
    fs::write(
        &file,
        format!(
            "{}\n",
            serde_json::to_string_pretty(data)
                .map_err(|error| format!("failed to serialize GHSA payload: {error}"))?
        ),
    )
    .map_err(|error| format!("failed to write {}: {error}", file.display()))?;
    Ok(file)
}

fn run_gh(args: &[&str]) -> Result<String, String> {
    let output = Command::new("gh")
        .args(args)
        .output()
        .map_err(|error| format!("failed to run gh {}: {error}", args.join(" ")))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return Err(stderr);
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return Err(stdout);
    }
    Err(format!("gh {} failed", args.join(" ")))
}

fn run_gh_json(args: &[&str]) -> Result<Value, String> {
    let raw = run_gh(args)?;
    serde_json::from_str(&raw).map_err(|error| format!("failed to parse gh JSON response: {error}"))
}

trait EmptyStringFallback {
    fn if_empty(self, fallback: &str) -> String;
}

impl EmptyStringFallback for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ghsa_ids_from_plain_ids_and_urls() {
        assert_eq!(
            parse_ghsa_id("GHSA-abcd-1234-wxyz").unwrap(),
            "GHSA-abcd-1234-wxyz"
        );
        assert_eq!(
            parse_ghsa_id("https://github.com/org/repo/security/advisories/GHSA-ABCD-1234-WXYZ")
                .unwrap(),
            "GHSA-ABCD-1234-WXYZ"
        );
        assert!(parse_ghsa_id("not-an-advisory").is_err());
    }

    #[test]
    fn builds_payload_with_null_patched_versions() {
        let payload = build_ghsa_patch_payload(GhsaPatchPayloadInput {
            summary: "summary",
            severity: "high",
            description: "body",
            ecosystem: "npm",
            package_name: "crawclaw",
            vulnerable_range: "<1.0.0",
            patched_versions: Value::Null,
        });
        assert_eq!(payload["summary"], "summary");
        assert!(payload["vulnerabilities"][0]["patched_versions"].is_null());
    }

    #[test]
    fn parses_key_value_args_like_the_old_script() {
        let parsed = parse_key_value_args(&[
            "--ghsa".to_string(),
            "GHSA-abcd-1234-wxyz".to_string(),
            "--severity".to_string(),
            "high".to_string(),
        ])
        .unwrap();
        assert_eq!(parsed.get("severity").map(String::as_str), Some("high"));
        assert!(parse_key_value_args(&["--ghsa".to_string()]).is_err());
        assert!(parse_key_value_args(&["value".to_string()]).is_err());
    }
}
