use std::fs;
use std::path::Path;

use serde_json::Value;

const CRAWCLAW_VERSION_RANGE_PREFIX: &str = ">=";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginVersionSyncSummary {
    pub target_version: String,
    pub updated: Vec<String>,
    pub changelogged: Vec<String>,
    pub skipped: Vec<String>,
}

pub fn sync_plugin_versions(
    root_dir: impl AsRef<Path>,
) -> Result<PluginVersionSyncSummary, String> {
    let root_dir = root_dir.as_ref();
    let root_package_path = root_dir.join("package.json");
    let root_package = read_json_file(&root_package_path)?;
    let target_version = json_string(&root_package, "version")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Root package.json missing version.".to_string())?;
    let extensions_dir = root_dir.join("extensions");
    let entries = fs::read_dir(&extensions_dir)
        .map_err(|error| format!("failed to read {}: {error}", extensions_dir.display()))?;

    let mut updated = Vec::new();
    let mut changelogged = Vec::new();
    let mut skipped = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("failed to read extension entry: {error}"))?;
        if !entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", entry.path().display()))?
            .is_dir()
        {
            continue;
        }
        let extension_id = entry.file_name().to_string_lossy().to_string();
        let extension_dir = entry.path();
        let package_path = extension_dir.join("package.json");
        let Ok(mut package_json) = read_json_file(&package_path) else {
            continue;
        };
        let Some(package_name) =
            json_string(&package_json, "name").filter(|value| !value.trim().is_empty())
        else {
            skipped.push(extension_id);
            continue;
        };

        if ensure_changelog_entry(&extension_dir.join("CHANGELOG.md"), &target_version)? {
            changelogged.push(package_name.clone());
        }

        let version_changed = set_string_field(&mut package_json, "version", &target_version);
        let dev_dependency_changed =
            sync_crawclaw_dependency_range(&mut package_json, "devDependencies", &target_version);
        let peer_dependency_changed =
            sync_crawclaw_dependency_range(&mut package_json, "peerDependencies", &target_version);
        let min_host_version_changed = sync_min_host_version(&mut package_json, &target_version);
        let package_changed = version_changed
            || dev_dependency_changed
            || peer_dependency_changed
            || min_host_version_changed;

        if !package_changed {
            skipped.push(package_name);
            continue;
        }

        let content = serde_json::to_string_pretty(&package_json)
            .map_err(|error| format!("failed to serialize {}: {error}", package_path.display()))?;
        fs::write(&package_path, format!("{content}\n"))
            .map_err(|error| format!("failed to write {}: {error}", package_path.display()))?;
        updated.push(package_name);
    }

    Ok(PluginVersionSyncSummary {
        target_version,
        updated,
        changelogged,
        skipped,
    })
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(|value| value.to_string())
}

fn set_string_field(value: &mut Value, key: &str, target: &str) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    let current = object.get(key).and_then(Value::as_str);
    if current == Some(target) {
        return false;
    }
    object.insert(key.to_string(), Value::String(target.to_string()));
    true
}

fn sync_crawclaw_dependency_range(value: &mut Value, section: &str, target_version: &str) -> bool {
    let Some(deps) = value.get_mut(section).and_then(Value::as_object_mut) else {
        return false;
    };
    let Some(current) = deps.get("crawclaw").and_then(Value::as_str) else {
        return false;
    };
    if current == "workspace:*" || !is_crawclaw_version_range(current) {
        return false;
    }
    let next = format!("{CRAWCLAW_VERSION_RANGE_PREFIX}{target_version}");
    if current == next {
        return false;
    }
    deps.insert("crawclaw".to_string(), Value::String(next));
    true
}

fn sync_min_host_version(value: &mut Value, target_version: &str) -> bool {
    let Some(install_config) = value
        .get_mut("crawclaw")
        .and_then(Value::as_object_mut)
        .and_then(|crawclaw| crawclaw.get_mut("install"))
        .and_then(Value::as_object_mut)
    else {
        return false;
    };
    let Some(current) = install_config.get("minHostVersion").and_then(Value::as_str) else {
        return false;
    };
    if !is_crawclaw_version_range(current) {
        return false;
    }
    let next = format!("{CRAWCLAW_VERSION_RANGE_PREFIX}{target_version}");
    if current == next {
        return false;
    }
    install_config.insert("minHostVersion".to_string(), Value::String(next));
    true
}

fn is_crawclaw_version_range(value: &str) -> bool {
    let Some(version) = value.strip_prefix(CRAWCLAW_VERSION_RANGE_PREFIX) else {
        return false;
    };
    let version = version.trim();
    let mut parts = version.splitn(3, '.');
    let year = parts.next().unwrap_or_default();
    let month = parts.next().unwrap_or_default();
    let day_and_suffix = parts.next().unwrap_or_default();
    if year.len() != 4
        || !year.chars().all(|ch| ch.is_ascii_digit())
        || month.is_empty()
        || month.len() > 2
        || !month.chars().all(|ch| ch.is_ascii_digit())
        || day_and_suffix.is_empty()
    {
        return false;
    }
    let day_digits = day_and_suffix
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if day_digits.is_empty() || day_digits.len() > 2 {
        return false;
    }
    let suffix = &day_and_suffix[day_digits.len()..];
    suffix.is_empty()
        || ((suffix.starts_with('-') || suffix.starts_with('.'))
            && suffix[1..]
                .chars()
                .all(|ch| !ch.is_whitespace() && ch != '"'))
}

fn ensure_changelog_entry(changelog_path: &Path, version: &str) -> Result<bool, String> {
    if !changelog_path.exists() {
        return Ok(false);
    }
    let content = fs::read_to_string(changelog_path)
        .map_err(|error| format!("failed to read {}: {error}", changelog_path.display()))?;
    if content.contains(&format!("## {version}")) {
        return Ok(false);
    }
    let entry = format!(
        "## {version}\n\n### Changes\n- Version alignment with core CrawClaw release numbers.\n\n"
    );
    let next = if content.starts_with("# Changelog\n\n") {
        content.replacen("# Changelog\n\n", &format!("# Changelog\n\n{entry}"), 1)
    } else {
        format!("# Changelog\n\n{entry}{}\n", content.trim_start())
    };
    fs::write(changelog_path, next)
        .map_err(|error| format!("failed to write {}: {error}", changelog_path.display()))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_crawclaw_version_ranges() {
        assert!(is_crawclaw_version_range(">=2026.5.20"));
        assert!(is_crawclaw_version_range(">=2026.5.20-beta.1"));
        assert!(is_crawclaw_version_range(">=2026.5.20-1"));
        assert!(!is_crawclaw_version_range("workspace:*"));
        assert!(!is_crawclaw_version_range("^2026.5.20"));
    }

    #[test]
    fn syncs_package_json_fields() {
        let mut value = serde_json::json!({
            "name": "@crawclaw/example",
            "version": "2026.5.1",
            "devDependencies": {
                "crawclaw": ">=2026.5.1"
            },
            "peerDependencies": {
                "crawclaw": "workspace:*"
            },
            "crawclaw": {
                "install": {
                    "minHostVersion": ">=2026.5.1"
                }
            }
        });

        assert!(set_string_field(&mut value, "version", "2026.5.20"));
        assert!(sync_crawclaw_dependency_range(
            &mut value,
            "devDependencies",
            "2026.5.20"
        ));
        assert!(!sync_crawclaw_dependency_range(
            &mut value,
            "peerDependencies",
            "2026.5.20"
        ));
        assert!(sync_min_host_version(&mut value, "2026.5.20"));
        assert_eq!(value["version"], "2026.5.20");
        assert_eq!(value["devDependencies"]["crawclaw"], ">=2026.5.20");
        assert_eq!(value["peerDependencies"]["crawclaw"], "workspace:*");
        assert_eq!(
            value["crawclaw"]["install"]["minHostVersion"],
            ">=2026.5.20"
        );
    }

    #[test]
    fn inserts_changelog_entry() {
        let dir = tempfile::tempdir().expect("temp dir");
        let changelog = dir.path().join("CHANGELOG.md");
        fs::write(
            &changelog,
            "# Changelog\n\n## 2026.5.1\n\n### Changes\n- Old.\n",
        )
        .expect("write changelog");

        assert!(ensure_changelog_entry(&changelog, "2026.5.20").unwrap());
        let content = fs::read_to_string(&changelog).expect("read changelog");
        assert!(content.contains("## 2026.5.20"));
        assert!(content.find("## 2026.5.20").unwrap() < content.find("## 2026.5.1").unwrap());
        assert!(!ensure_changelog_entry(&changelog, "2026.5.20").unwrap());
    }
}
