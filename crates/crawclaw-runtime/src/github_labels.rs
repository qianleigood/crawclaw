use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct RepoLabel {
    name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LabelMetadata {
    pub color: String,
    pub description: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct GithubLabelsOptions {
    root: PathBuf,
    check_only: bool,
}

const EXTRA_LABELS: &[&str] = &[
    "bad-barnacle",
    "bug",
    "bug:behavior",
    "bug:crash",
    "size: XS",
    "size: S",
    "size: M",
    "size: L",
    "size: XL",
    "beta-blocker",
    "dirty",
    "documentation",
    "duplicate",
    "enhancement",
    "invalid",
    "maintainer",
    "no-stale",
    "pinned",
    "question",
    "r: moltbook",
    "r: no-ci-pr",
    "r: skill",
    "r: spam",
    "r: support",
    "r: testflight",
    "r: third-party-extension",
    "r: too-many-prs",
    "r: too-many-prs-override",
    "regression",
    "security",
    "stale",
    "trigger-response",
];

pub fn run_github_labels_sync(args: &[String]) -> Result<i32, String> {
    let options = parse_args(args)?;
    let labeler_path = options.root.join(".github").join("labeler.yml");
    let contents = fs::read_to_string(&labeler_path)
        .map_err(|error| format!("failed to read {}: {error}", labeler_path.display()))?;
    let label_names = collect_configured_label_names(&contents);
    if label_names.is_empty() {
        return Err("labeler.yml must declare at least one label.".to_string());
    }

    let repo = resolve_repo(&options.root)?;
    let existing = fetch_existing_labels(&repo)?;
    let missing = label_names
        .into_iter()
        .filter(|label| !existing.contains(label))
        .collect::<Vec<_>>();

    if missing.is_empty() {
        println!("All labeler labels already exist.");
        return Ok(0);
    }

    if options.check_only {
        eprintln!("Missing GitHub labels:");
        for label in missing {
            eprintln!("- {label}");
        }
        return Ok(1);
    }

    for label in missing {
        let metadata = resolve_label_metadata(&label);
        create_label(&repo, &label, &metadata)?;
        println!("Created label: {label}");
    }

    Ok(0)
}

pub fn collect_configured_label_names(contents: &str) -> BTreeSet<String> {
    let mut labels = extract_label_names(contents)
        .into_iter()
        .collect::<BTreeSet<_>>();
    labels.extend(EXTRA_LABELS.iter().map(|label| (*label).to_string()));
    labels
}

fn parse_args(args: &[String]) -> Result<GithubLabelsOptions, String> {
    let mut root = PathBuf::from(".");
    let mut check_only = false;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--check" {
            check_only = true;
            index += 1;
            continue;
        }
        if arg == "--help" || arg == "-h" {
            return Err(github_labels_usage());
        }
        if arg == "--root" {
            let Some(value) = args.get(index + 1) else {
                return Err("--root requires a value".to_string());
            };
            root = PathBuf::from(value);
            index += 2;
            continue;
        }
        if let Some(value) = arg.strip_prefix("--root=") {
            root = PathBuf::from(value);
            index += 1;
            continue;
        }
        return Err(format!("unsupported github-labels-sync option: {arg}"));
    }
    Ok(GithubLabelsOptions { root, check_only })
}

fn github_labels_usage() -> String {
    "usage: crawclaw-runtime github-labels-sync [--root <repo-root>] [--check]".to_string()
}

fn extract_label_names(contents: &str) -> Vec<String> {
    let mut labels = Vec::new();
    for line in contents.lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if line.starts_with(char::is_whitespace) {
            continue;
        }
        if let Some(label) = extract_top_level_yaml_key(line) {
            labels.push(label);
        }
    }
    labels
}

fn extract_top_level_yaml_key(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let first = trimmed.chars().next()?;
    if first == '"' || first == '\'' {
        let rest = &trimmed[first.len_utf8()..];
        let close = rest.find(first)?;
        let key = &rest[..close];
        let after_key = rest[close + first.len_utf8()..].trim_start();
        return after_key.starts_with(':').then(|| key.trim().to_string());
    }
    let (key, _) = trimmed.split_once(':')?;
    let key = key.trim();
    (!key.is_empty()).then(|| key.to_string())
}

pub fn resolve_label_metadata(label: &str) -> LabelMetadata {
    if let Some((color, description)) = extra_label_metadata(label) {
        return LabelMetadata {
            color: color.to_string(),
            description: description.map(str::to_string),
        };
    }
    let prefix = label
        .split_once(':')
        .map(|(prefix, _)| prefix.trim())
        .unwrap_or_else(|| label.trim());
    LabelMetadata {
        color: color_by_prefix(prefix).unwrap_or("ededed").to_string(),
        description: None,
    }
}

fn color_by_prefix(prefix: &str) -> Option<&'static str> {
    Some(match prefix {
        "bug" => "d73a4a",
        "channel" => "1d76db",
        "app" => "6f42c1",
        "extensions" => "0e8a16",
        "docs" => "0075ca",
        "cli" => "f9d0c4",
        "gateway" => "d4c5f9",
        "r" => "B60205",
        "size" => "fbca04",
        _ => return None,
    })
}

fn extra_label_metadata(label: &str) -> Option<(&'static str, Option<&'static str>)> {
    Some(match label {
        "beta-blocker" => (
            "D93F0B",
            Some("Plugin beta-release blocker pending stable cutoff triage"),
        ),
        "bad-barnacle" => ("7057ff", Some("Exempts a PR from dirty-branch auto-close")),
        "bug" => ("d73a4a", Some("Something is not working")),
        "bug:behavior" => ("D73A4A", Some("Incorrect behavior without a crash")),
        "bug:crash" => ("B60205", Some("Process/app exits unexpectedly or hangs")),
        "dirty" => (
            "5319e7",
            Some("PR appears to include unrelated or unexpected changes"),
        ),
        "documentation" => ("0075ca", Some("Improvements or additions to documentation")),
        "duplicate" => ("cfd3d7", Some("This issue or pull request already exists")),
        "enhancement" => ("a2eeef", Some("New feature or request")),
        "invalid" => ("e4e669", Some("This does not seem right")),
        "maintainer" => ("0e8a16", Some("Opened by a maintainer or repo admin")),
        "no-stale" => ("0052cc", Some("Exempt from stale automation")),
        "pinned" => ("0052cc", Some("Pinned issue or pull request")),
        "question" => ("d876e3", Some("Further information is requested")),
        "r: moltbook" => ("B60205", Some("Auto-response for Moltbook-related issues")),
        "r: no-ci-pr" => (
            "B60205",
            Some("Auto-response for PRs that only fix main CI failures"),
        ),
        "r: skill" => ("B60205", Some("Auto-response for core skill submissions")),
        "r: spam" => ("B60205", Some("Spam auto-close and lock trigger")),
        "r: support" => ("B60205", Some("Auto-response for support requests")),
        "r: testflight" => ("B60205", Some("Auto-response for TestFlight requests")),
        "r: third-party-extension" => (
            "B60205",
            Some("Auto-response for bundled third-party plugin requests"),
        ),
        "r: too-many-prs" => (
            "B60205",
            Some("Author has more than 10 active PRs in this repo"),
        ),
        "r: too-many-prs-override" => ("0e8a16", Some("Exempts a PR from the active PR limit")),
        "regression" => (
            "D93F0B",
            Some("Behavior that previously worked and now fails"),
        ),
        "security" => ("B60205", Some("Security-sensitive issue or change")),
        "stale" => (
            "ededed",
            Some("Inactive issue or pull request pending closure"),
        ),
        "trigger-response" => ("fbca04", Some("Manual trigger for auto-response rules")),
        _ => return None,
    })
}

pub fn parse_github_repo_remote(remote: &str) -> Result<String, String> {
    let remote = remote.trim();
    if let Some(path) = remote.strip_prefix("git@github.com:") {
        return Ok(path.trim_end_matches(".git").to_string());
    }
    if let Some(path) = remote.strip_prefix("https://github.com/") {
        return Ok(path.trim_end_matches(".git").to_string());
    }
    Err(format!("Unsupported GitHub remote: {remote}"))
}

fn resolve_repo(root: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(root)
        .output()
        .map_err(|error| format!("failed to run git config: {error}"))?;
    if !output.status.success() {
        return Err("Unable to determine repository from git remote.".to_string());
    }
    let remote = String::from_utf8_lossy(&output.stdout);
    parse_github_repo_remote(&remote)
}

fn fetch_existing_labels(repo: &str) -> Result<BTreeSet<String>, String> {
    let output = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repo}/labels?per_page=100"),
            "--paginate",
            "--slurp",
        ])
        .output()
        .map_err(|error| format!("failed to run gh api: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "gh api failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let labels = serde_json::from_slice::<Vec<Vec<RepoLabel>>>(&output.stdout)
        .map_err(|error| format!("failed to parse gh label response: {error}"))?;
    Ok(labels
        .into_iter()
        .flatten()
        .map(|label| label.name)
        .collect())
}

fn create_label(repo: &str, label: &str, metadata: &LabelMetadata) -> Result<(), String> {
    let mut args = vec![
        "api".to_string(),
        "-X".to_string(),
        "POST".to_string(),
        format!("repos/{repo}/labels"),
        "-f".to_string(),
        format!("name={label}"),
        "-f".to_string(),
        format!("color={}", metadata.color),
    ];
    if let Some(description) = &metadata.description {
        args.push("-f".to_string());
        args.push(format!("description={description}"));
    }
    let status = Command::new("gh")
        .args(args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| format!("failed to run gh api: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("failed to create GitHub label: {label}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_top_level_labeler_keys() {
        let names = extract_label_names(
            r#"
"channel: qqbot":
  - changed-files:
      - any-glob-to-any-file:
"docs":
  - changed-files:
plain:
  - ignored
  nested:
"#,
        );
        assert_eq!(names, vec!["channel: qqbot", "docs", "plain"]);
    }

    #[test]
    fn includes_extra_labels_and_sorts_uniquely() {
        let names = collect_configured_label_names("\"docs\":\n\"docs\":\n");
        assert!(names.contains("docs"));
        assert!(names.contains("security"));
        assert_eq!(
            names
                .iter()
                .filter(|label| label.as_str() == "docs")
                .count(),
            1
        );
    }

    #[test]
    fn resolves_metadata_from_exact_label_before_prefix() {
        assert_eq!(
            resolve_label_metadata("bug:crash"),
            LabelMetadata {
                color: "B60205".to_string(),
                description: Some("Process/app exits unexpectedly or hangs".to_string()),
            }
        );
        assert_eq!(
            resolve_label_metadata("channel: qqbot"),
            LabelMetadata {
                color: "1d76db".to_string(),
                description: None,
            }
        );
    }

    #[test]
    fn parses_supported_github_remotes() {
        assert_eq!(
            parse_github_repo_remote("git@github.com:qianleigood/crawclaw.git").unwrap(),
            "qianleigood/crawclaw"
        );
        assert_eq!(
            parse_github_repo_remote("https://github.com/qianleigood/crawclaw.git").unwrap(),
            "qianleigood/crawclaw"
        );
        assert!(parse_github_repo_remote("https://example.com/repo.git").is_err());
    }
}
