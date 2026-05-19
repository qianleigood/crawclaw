use std::collections::BTreeSet;
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

const CANONICAL_PLUGIN_MANIFEST_FILENAME: &str = "crawclaw.plugin.json";
const GENERATED_BUNDLED_SKILLS_DIR: &str = "bundled-skills";
const OPTIONAL_BUNDLED_BUILD_ENV: &str = "CRAWCLAW_INCLUDE_OPTIONAL_BUNDLED";
const REMOVED_PACKAGE_CRAWCLAW_FIELDS: &[&str] = &["setupEntry", "extensions"];
const NATIVE_BINARY_PACKAGES: &[NativeBinaryPackage] = &[
    NativeBinaryPackage {
        package_name: "crawclaw-native-plugins",
        binary_name: "crawclaw-native-plugins",
    },
    NativeBinaryPackage {
        package_name: "crawclaw-runtime",
        binary_name: "crawclaw-runtime",
    },
    NativeBinaryPackage {
        package_name: "crawclaw-gateway",
        binary_name: "crawclaw-gateway",
    },
];

struct NativeBinaryPackage {
    package_name: &'static str,
    binary_name: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StaticPackageAsset {
    pub src: PathBuf,
    pub dest: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildStamp {
    built_at: u128,
    head: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    version: Option<String>,
    commit: Option<String>,
    built_at: String,
}

pub fn stage_package_postbuild(root_dir: impl AsRef<Path>) -> Result<(), String> {
    let root_dir = normalize_root_dir(root_dir.as_ref());
    prune_retired_core_dist_entries(&root_dir)?;
    copy_bundled_plugin_metadata(&root_dir)?;
    copy_static_package_assets(&root_dir, &list_static_package_assets(&root_dir)?)?;
    Ok(())
}

pub fn stage_native_binary_artifacts(root_dir: impl AsRef<Path>) -> Result<Vec<PathBuf>, String> {
    let root_dir = normalize_root_dir(root_dir.as_ref());
    let dest_dir = root_dir.join("dist").join("native");
    fs::create_dir_all(&dest_dir)
        .map_err(|error| format!("failed to create {}: {error}", dest_dir.display()))?;

    let mut staged = Vec::new();
    for entry in NATIVE_BINARY_PACKAGES {
        let status = Command::new("cargo")
            .args(["build", "-p", entry.package_name, "--release"])
            .current_dir(&root_dir)
            .status()
            .map_err(|error| {
                format!(
                    "failed to run cargo build for {}: {error}",
                    entry.package_name
                )
            })?;
        if !status.success() {
            return Err(format!(
                "cargo build -p {} --release failed with status {}",
                entry.package_name,
                status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "?".to_string())
            ));
        }

        let binary_name = platform_binary_name(entry.binary_name);
        let source = root_dir.join("target").join("release").join(&binary_name);
        let dest = dest_dir.join(&binary_name);
        copy_file(&source, &dest)?;
        set_executable(&dest)?;
        staged.push(dest);
    }
    Ok(staged)
}

pub fn write_package_build_metadata(
    root_dir: impl AsRef<Path>,
    include_build_info: bool,
) -> Result<Vec<PathBuf>, String> {
    let root_dir = normalize_root_dir(root_dir.as_ref());
    let dist_dir = root_dir.join("dist");
    fs::create_dir_all(&dist_dir)
        .map_err(|error| format!("failed to create {}: {error}", dist_dir.display()))?;

    let mut written = Vec::new();
    let stamp_path = dist_dir.join(".buildstamp");
    let stamp = BuildStamp {
        built_at: current_unix_millis()?,
        head: resolve_git_head(&root_dir),
    };
    write_json_line(&stamp_path, &stamp)?;
    written.push(stamp_path);

    if include_build_info {
        let build_info_path = dist_dir.join("build-info.json");
        let build_info = BuildInfo {
            version: read_package_version(&root_dir),
            commit: resolve_build_commit(&root_dir),
            built_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        };
        write_json_pretty(&build_info_path, &build_info)?;
        written.push(build_info_path);
    }

    Ok(written)
}

pub fn list_static_package_asset_outputs(
    root_dir: impl AsRef<Path>,
) -> Result<Vec<String>, String> {
    Ok(
        list_static_package_assets(&normalize_root_dir(root_dir.as_ref()))?
            .into_iter()
            .map(|asset| slash_path(&asset.dest))
            .collect(),
    )
}

pub fn list_bundled_plugin_pack_artifacts(
    root_dir: impl AsRef<Path>,
) -> Result<Vec<String>, String> {
    let root_dir = normalize_root_dir(root_dir.as_ref());
    let extensions_root = root_dir.join("extensions");
    if !extensions_root.exists() {
        return Ok(Vec::new());
    }
    let mut artifacts = Vec::new();
    for entry in sorted_dir_entries(&extensions_root)? {
        if !entry.file_type().map_err(format_io)?.is_dir() {
            continue;
        }
        let plugin_id = entry.file_name().to_string_lossy().to_string();
        let plugin_dir = entry.path();
        let package_json = read_json_optional(&plugin_dir.join("package.json"))?;
        if !plugin_dir.join(CANONICAL_PLUGIN_MANIFEST_FILENAME).exists() {
            continue;
        }
        if !should_build_bundled_cluster(&plugin_id, package_json.as_ref()) {
            continue;
        }
        artifacts.push(format!(
            "dist/extensions/{plugin_id}/{CANONICAL_PLUGIN_MANIFEST_FILENAME}"
        ));
        if package_json.is_some() {
            artifacts.push(format!("dist/extensions/{plugin_id}/package.json"));
        }
    }
    artifacts.sort();
    Ok(artifacts)
}

fn normalize_root_dir(root_dir: &Path) -> PathBuf {
    if root_dir.is_absolute() {
        return root_dir.to_path_buf();
    }
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(root_dir)
}

fn list_static_package_assets(root_dir: &Path) -> Result<Vec<StaticPackageAsset>, String> {
    let mut assets = vec![
        StaticPackageAsset {
            src: PathBuf::from("extensions/qwen3-tts/python/qwen3_tts_sidecar.py"),
            dest: PathBuf::from("dist/extensions/qwen3-tts/python/qwen3_tts_sidecar.py"),
        },
        StaticPackageAsset {
            src: PathBuf::from("extensions/qwen3-tts/python/qwen3_tts_python_sidecar.py"),
            dest: PathBuf::from("dist/extensions/qwen3-tts/python/qwen3_tts_python_sidecar.py"),
        },
        StaticPackageAsset {
            src: PathBuf::from("extensions/searxng/runtime/settings.yml"),
            dest: PathBuf::from("dist/extensions/searxng/runtime/settings.yml"),
        },
        StaticPackageAsset {
            src: PathBuf::from("extensions/searxng/runtime/source.lock.json"),
            dest: PathBuf::from("dist/extensions/searxng/runtime/source.lock.json"),
        },
        StaticPackageAsset {
            src: PathBuf::from("extensions/searxng/runtime/NOTICE.md"),
            dest: PathBuf::from("dist/extensions/searxng/runtime/NOTICE.md"),
        },
        StaticPackageAsset {
            src: PathBuf::from("extensions/searxng/runtime/LICENSE"),
            dest: PathBuf::from("dist/extensions/searxng/runtime/LICENSE"),
        },
    ];
    let migrations_dir = root_dir
        .join("src")
        .join("memory")
        .join("runtime")
        .join("migrations");
    if migrations_dir.exists() {
        for entry in sorted_dir_entries(&migrations_dir)? {
            if !entry.file_type().map_err(format_io)?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if is_runtime_migration_filename(&name) {
                assets.push(StaticPackageAsset {
                    src: PathBuf::from("src/memory/runtime/migrations").join(&name),
                    dest: PathBuf::from("dist/migrations").join(&name),
                });
            }
        }
    }
    assets.sort_by(|left, right| slash_path(&left.dest).cmp(&slash_path(&right.dest)));
    Ok(assets)
}

fn is_runtime_migration_filename(name: &str) -> bool {
    let Some((prefix, suffix)) = name.split_once('_') else {
        return false;
    };
    !prefix.is_empty()
        && prefix.chars().all(|ch| ch.is_ascii_digit())
        && !suffix.is_empty()
        && suffix.ends_with(".sql")
}

fn copy_static_package_assets(
    root_dir: &Path,
    assets: &[StaticPackageAsset],
) -> Result<(), String> {
    for asset in assets {
        let source = root_dir.join(&asset.src);
        let dest = root_dir.join(&asset.dest);
        if !source.exists() {
            eprintln!(
                "[package-postbuild] static asset not found, skipping: {}",
                slash_path(&asset.src)
            );
            continue;
        }
        copy_file(&source, &dest)?;
    }
    Ok(())
}

fn prune_retired_core_dist_entries(root_dir: &Path) -> Result<(), String> {
    remove_path_if_exists(&root_dir.join("dist").join("agents"))?;
    remove_path_if_exists(&root_dir.join("dist-runtime"))?;
    Ok(())
}

fn copy_bundled_plugin_metadata(root_dir: &Path) -> Result<(), String> {
    let extensions_root = root_dir.join("extensions");
    let dist_extensions_root = root_dir.join("dist").join("extensions");
    if !extensions_root.exists() {
        return Ok(());
    }

    let mut source_plugin_dirs = BTreeSet::new();
    for entry in sorted_dir_entries(&extensions_root)? {
        if !entry.file_type().map_err(format_io)?.is_dir() {
            continue;
        }
        let plugin_id = entry.file_name().to_string_lossy().to_string();
        let plugin_dir = entry.path();
        let dist_plugin_dir = dist_extensions_root.join(&plugin_id);
        let package_json_path = plugin_dir.join("package.json");
        let package_json = read_json_optional(&package_json_path)?;

        if !should_build_bundled_cluster(&plugin_id, package_json.as_ref()) {
            remove_path_if_exists(&dist_plugin_dir)?;
            continue;
        }

        source_plugin_dirs.insert(plugin_id);
        let manifest_path = plugin_dir.join(CANONICAL_PLUGIN_MANIFEST_FILENAME);
        if !manifest_path.exists() {
            remove_path_if_exists(&dist_plugin_dir)?;
            continue;
        }

        let manifest = read_json(&manifest_path)?;
        remove_path_if_exists(&dist_plugin_dir.join(GENERATED_BUNDLED_SKILLS_DIR))?;
        remove_path_if_exists(&dist_plugin_dir.join("node_modules"))?;
        let copied_skills =
            copy_declared_plugin_skill_paths(root_dir, &plugin_dir, &dist_plugin_dir, &manifest)?;
        let bundled_manifest = if manifest.get("skills").and_then(Value::as_array).is_some() {
            let mut next = manifest.clone();
            next["skills"] = Value::Array(
                copied_skills
                    .into_iter()
                    .map(Value::String)
                    .collect::<Vec<_>>(),
            );
            next
        } else {
            manifest
        };
        write_json_if_changed(
            &dist_plugin_dir.join(CANONICAL_PLUGIN_MANIFEST_FILENAME),
            &bundled_manifest,
        )?;

        if let Some(mut package_json) = package_json {
            if let Some(crawclaw) = package_json
                .get_mut("crawclaw")
                .and_then(Value::as_object_mut)
            {
                for field in REMOVED_PACKAGE_CRAWCLAW_FIELDS {
                    crawclaw.remove(*field);
                }
            }
            write_json_if_changed(&dist_plugin_dir.join("package.json"), &package_json)?;
        } else {
            remove_file_if_exists(&dist_plugin_dir.join("package.json"))?;
        }
    }

    if dist_extensions_root.exists() {
        for entry in sorted_dir_entries(&dist_extensions_root)? {
            if !entry.file_type().map_err(format_io)?.is_dir() {
                continue;
            }
            let plugin_id = entry.file_name().to_string_lossy().to_string();
            if !source_plugin_dirs.contains(&plugin_id) {
                remove_path_if_exists(&entry.path())?;
            }
        }
    }
    Ok(())
}

fn should_build_bundled_cluster(cluster: &str, package_json: Option<&Value>) -> bool {
    if has_released_bundled_install(package_json) {
        return true;
    }
    should_include_optional_bundled_clusters() || cluster != "ui"
}

fn should_include_optional_bundled_clusters() -> bool {
    env::var(OPTIONAL_BUNDLED_BUILD_ENV).map_or(true, |value| value != "0")
}

fn has_released_bundled_install(package_json: Option<&Value>) -> bool {
    package_json
        .and_then(|value| value.get("crawclaw"))
        .and_then(|value| value.get("install"))
        .and_then(|value| value.get("npmSpec"))
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn copy_declared_plugin_skill_paths(
    repo_root: &Path,
    plugin_dir: &Path,
    dist_plugin_dir: &Path,
    manifest: &Value,
) -> Result<Vec<String>, String> {
    let Some(skills) = manifest.get("skills").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut copied = Vec::new();
    for raw in skills {
        let Some(raw_path) = raw
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let source_path = resolve_declared_skill_source_path(repo_root, plugin_dir, raw_path)?;
        let target = resolve_bundled_skill_target(raw_path)?;
        if !source_path.exists() {
            eprintln!(
                "[bundled-plugin-metadata] skipping missing skill path {} (plugin {})",
                source_path.display(),
                manifest
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| plugin_dir
                        .file_name()
                        .and_then(OsStr::to_str)
                        .unwrap_or(""))
            );
            continue;
        }
        let target_path = ensure_path_inside_root(dist_plugin_dir, &target.output_path)?;
        let exclude_nested_node_modules =
            is_node_modules_path(&normalize_manifest_relative_path(raw_path));
        copy_path_dereference(&source_path, &target_path, exclude_nested_node_modules)?;
        copied.push(target.manifest_path);
    }
    Ok(copied)
}

struct BundledSkillTarget {
    manifest_path: String,
    output_path: String,
}

fn resolve_declared_skill_source_path(
    repo_root: &Path,
    plugin_dir: &Path,
    raw_path: &str,
) -> Result<PathBuf, String> {
    let normalized = normalize_manifest_relative_path(raw_path);
    let plugin_local_path = ensure_path_inside_root(plugin_dir, &normalized)?;
    if plugin_local_path.exists() || !is_node_modules_path(&normalized) {
        return Ok(plugin_local_path);
    }
    ensure_path_inside_root(repo_root, &normalized)
}

fn resolve_bundled_skill_target(raw_path: &str) -> Result<BundledSkillTarget, String> {
    let normalized = normalize_manifest_relative_path(raw_path);
    if is_node_modules_path(&normalized) {
        let trimmed = normalized
            .strip_prefix("node_modules/")
            .or_else(|| normalized.strip_prefix("node_modules"))
            .unwrap_or("")
            .trim_matches('/');
        if trimmed.is_empty() {
            return Err(format!(
                "node_modules skill path must point to a package: {raw_path}"
            ));
        }
        let output_path = format!("{GENERATED_BUNDLED_SKILLS_DIR}/{trimmed}");
        return Ok(BundledSkillTarget {
            manifest_path: format!("./{output_path}"),
            output_path,
        });
    }
    Ok(BundledSkillTarget {
        manifest_path: raw_path.to_string(),
        output_path: normalized,
    })
}

fn normalize_manifest_relative_path(raw_path: &str) -> String {
    raw_path
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string()
}

fn is_node_modules_path(path: &str) -> bool {
    path == "node_modules" || path.starts_with("node_modules/")
}

fn ensure_path_inside_root(root_dir: &Path, raw_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw_path);
    if path.is_absolute() {
        return Err(format!("path escapes plugin root: {raw_path}"));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!("path escapes plugin root: {raw_path}"));
    }
    Ok(root_dir.join(path))
}

fn copy_path_dereference(
    source_path: &Path,
    target_path: &Path,
    exclude_nested_node_modules: bool,
) -> Result<(), String> {
    remove_path_if_exists(target_path)?;
    let metadata = fs::metadata(source_path).map_err(|error| {
        format!(
            "failed to read metadata for {}: {error}",
            source_path.display()
        )
    })?;
    if metadata.is_dir() {
        copy_dir_recursive(
            source_path,
            target_path,
            source_path,
            exclude_nested_node_modules,
        )
    } else {
        copy_file(source_path, target_path)
    }
}

fn copy_dir_recursive(
    source_root: &Path,
    target_root: &Path,
    current: &Path,
    exclude_nested_node_modules: bool,
) -> Result<(), String> {
    fs::create_dir_all(target_root)
        .map_err(|error| format!("failed to create {}: {error}", target_root.display()))?;
    for entry in sorted_dir_entries(current)? {
        let source = entry.path();
        let relative = source.strip_prefix(source_root).map_err(|error| {
            format!(
                "failed to compute relative path for {} from {}: {error}",
                source.display(),
                source_root.display()
            )
        })?;
        if exclude_nested_node_modules
            && relative
                .components()
                .any(|component| component.as_os_str() == OsStr::new("node_modules"))
        {
            continue;
        }
        let target = target_root.join(relative);
        let metadata = fs::metadata(&source).map_err(|error| {
            format!("failed to read metadata for {}: {error}", source.display())
        })?;
        if metadata.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|error| format!("failed to create {}: {error}", target.display()))?;
            copy_dir_recursive(
                source_root,
                target_root,
                &source,
                exclude_nested_node_modules,
            )?;
        } else {
            copy_file(&source, &target)?;
        }
    }
    Ok(())
}

fn copy_file(source: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    fs::copy(source, dest).map_err(|error| {
        format!(
            "failed to copy {} to {}: {error}",
            source.display(),
            dest.display()
        )
    })?;
    Ok(())
}

fn platform_binary_name(binary_name: &str) -> String {
    if cfg!(windows) {
        format!("{binary_name}.exe")
    } else {
        binary_name.to_string()
    }
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)
        .map_err(|error| format!("failed to read metadata for {}: {error}", path.display()))?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .map_err(|error| format!("failed to chmod {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn current_unix_millis() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| format!("failed to read system time: {error}"))
}

fn resolve_git_head(root_dir: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(root_dir)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let head = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if head.is_empty() {
        None
    } else {
        Some(head)
    }
}

fn resolve_build_commit(root_dir: &Path) -> Option<String> {
    for name in ["GIT_COMMIT", "GIT_SHA"] {
        if let Ok(value) = env::var(name) {
            let value = value.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    resolve_git_head(root_dir)
}

fn read_package_version(root_dir: &Path) -> Option<String> {
    read_json(&root_dir.join("package.json"))
        .ok()
        .and_then(|value| {
            value
                .get("version")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn write_json_line<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let contents = format!(
        "{}\n",
        serde_json::to_string(value)
            .map_err(|error| format!("failed to serialize {}: {error}", path.display()))?
    );
    write_file_if_changed(path, &contents)
}

fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let contents = format!(
        "{}\n",
        serde_json::to_string_pretty(value)
            .map_err(|error| format!("failed to serialize {}: {error}", path.display()))?
    );
    write_file_if_changed(path, &contents)
}

fn write_file_if_changed(path: &Path, contents: &str) -> Result<(), String> {
    if fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    fs::write(path, contents)
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn read_json_optional(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    read_json(path).map(Some)
}

fn write_json_if_changed(path: &Path, value: &Value) -> Result<(), String> {
    let contents = format!(
        "{}\n",
        serde_json::to_string_pretty(value)
            .map_err(|error| format!("failed to serialize {}: {error}", path.display()))?
    );
    if fs::read_to_string(path).ok().as_deref() == Some(contents.as_str()) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    fs::write(path, contents)
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    fs::remove_dir_all(path)
        .map_err(|error| format!("failed to remove {}: {error}", path.display()))
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(path).map_err(|error| format!("failed to remove {}: {error}", path.display()))
}

fn sorted_dir_entries(dir: &Path) -> Result<Vec<fs::DirEntry>, String> {
    let mut entries = fs::read_dir(dir)
        .map_err(|error| format!("failed to read {}: {error}", dir.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(format_io)?;
    entries.sort_by_key(|entry| entry.file_name());
    Ok(entries)
}

fn format_io(error: std::io::Error) -> String {
    error.to_string()
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repo root")
            .to_path_buf()
    }

    fn collect_ts_files(root: &Path, files: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(root).expect("read source directory") {
            let entry = entry.expect("source directory entry");
            let path = entry.path();
            if path.is_dir() {
                collect_ts_files(&path, files);
            } else if path.is_file() && path.extension().is_some_and(|ext| ext == "ts") {
                files.push(path);
            }
        }
    }

    fn is_plugin_ts_test_surface(relative: &str) -> bool {
        relative.starts_with("src/plugins/")
            && (relative.ends_with(".test.ts")
                || relative.ends_with(".test-support.ts")
                || relative.ends_with(".test-helpers.ts")
                || relative.starts_with("src/plugins/test-helpers/")
                || relative == "src/plugins/contracts/testkit.ts")
    }

    #[test]
    fn keeps_plugin_runtime_cleanup_out_of_ts_tests() {
        let root = repo_root();
        let mut files = Vec::new();
        collect_ts_files(&root.join("src").join("plugins"), &mut files);
        let existing = files
            .into_iter()
            .map(|file| slash_path(file.strip_prefix(&root).expect("relative source path")))
            .filter(|relative| is_plugin_ts_test_surface(relative))
            .collect::<Vec<_>>();

        assert!(
            existing.is_empty(),
            "removed TypeScript plugin runtime tests came back: {existing:?}"
        );
    }

    #[test]
    fn lists_static_package_asset_outputs_without_legacy_migrations() {
        let temp = tempfile::tempdir().expect("tempdir");
        let outputs = list_static_package_asset_outputs(temp.path()).expect("outputs");
        assert!(
            outputs.contains(&"dist/extensions/qwen3-tts/python/qwen3_tts_sidecar.py".to_string())
        );
        assert!(outputs.contains(&"dist/extensions/searxng/runtime/settings.yml".to_string()));
        assert!(!outputs.contains(&"dist/migrations/001_init_runtime.sql".to_string()));
    }

    #[test]
    fn copies_manifest_and_local_skill_metadata() {
        let temp = tempfile::tempdir().expect("tempdir");
        let plugin_dir = temp.path().join("extensions").join("acpx");
        fs::create_dir_all(plugin_dir.join("skills/acp-router")).expect("skills");
        fs::write(
            plugin_dir.join("skills/acp-router/SKILL.md"),
            "# ACP Router\n",
        )
        .expect("skill");
        write_json_if_changed(
            &plugin_dir.join(CANONICAL_PLUGIN_MANIFEST_FILENAME),
            &json!({ "id": "acpx", "configSchema": { "type": "object" }, "skills": ["./skills"] }),
        )
        .expect("manifest");
        write_json_if_changed(
            &plugin_dir.join("package.json"),
            &json!({ "name": "@crawclaw/acpx", "crawclaw": { "extensions": ["./index.ts"] } }),
        )
        .expect("package");

        copy_bundled_plugin_metadata(temp.path()).expect("copy");

        let dist_dir = temp.path().join("dist/extensions/acpx");
        assert!(dist_dir.join(CANONICAL_PLUGIN_MANIFEST_FILENAME).exists());
        assert!(dist_dir.join("skills/acp-router/SKILL.md").exists());
        let package = read_json(&dist_dir.join("package.json")).expect("package");
        assert!(package
            .get("crawclaw")
            .and_then(Value::as_object)
            .is_some_and(|crawclaw| !crawclaw.contains_key("extensions")));
    }

    #[test]
    fn relocates_node_modules_skill_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        let plugin_dir = temp.path().join("extensions").join("feishu");
        let skill_dir = temp.path().join("node_modules/@feishucorp/feishu-skill");
        fs::create_dir_all(skill_dir.join("node_modules/.bin")).expect("skill dirs");
        fs::write(skill_dir.join("SKILL.md"), "# Feishu\n").expect("skill");
        fs::write(skill_dir.join("node_modules/.bin/feishu"), "#!/bin/sh\n").expect("bin");
        fs::create_dir_all(&plugin_dir).expect("plugin");
        write_json_if_changed(
            &plugin_dir.join(CANONICAL_PLUGIN_MANIFEST_FILENAME),
            &json!({ "id": "feishu", "configSchema": { "type": "object" }, "skills": ["node_modules/@feishucorp/feishu-skill"] }),
        )
        .expect("manifest");
        write_json_if_changed(
            &plugin_dir.join("package.json"),
            &json!({ "name": "@crawclaw/feishu" }),
        )
        .expect("package");

        copy_bundled_plugin_metadata(temp.path()).expect("copy");

        let dist_dir = temp.path().join("dist/extensions/feishu");
        let copied = dist_dir.join("bundled-skills/@feishucorp/feishu-skill");
        assert!(copied.join("SKILL.md").exists());
        assert!(!copied.join("node_modules").exists());
        let manifest =
            read_json(&dist_dir.join(CANONICAL_PLUGIN_MANIFEST_FILENAME)).expect("manifest");
        assert_eq!(
            manifest.get("skills").and_then(Value::as_array).cloned(),
            Some(vec![Value::String(
                "./bundled-skills/@feishucorp/feishu-skill".to_string()
            )])
        );
    }

    #[test]
    fn removes_manifestless_runtime_support_outputs() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(temp.path().join("extensions/speech-core")).expect("source");
        write_json_if_changed(
            &temp.path().join("extensions/speech-core/package.json"),
            &json!({ "name": "@crawclaw/speech-core" }),
        )
        .expect("package");
        let stale = temp.path().join("dist/extensions/speech-core");
        fs::create_dir_all(&stale).expect("stale");
        fs::write(stale.join("runtime-api.js"), "export {};\n").expect("stale file");

        copy_bundled_plugin_metadata(temp.path()).expect("copy");

        assert!(!stale.exists());
    }

    #[test]
    fn writes_build_metadata_artifacts() {
        let temp = tempfile::tempdir().expect("tempdir");
        write_json_if_changed(
            &temp.path().join("package.json"),
            &json!({ "version": "2026.5.3" }),
        )
        .expect("package");

        let written = write_package_build_metadata(temp.path(), true).expect("metadata");

        assert_eq!(written.len(), 2);
        let stamp = read_json(&temp.path().join("dist/.buildstamp")).expect("stamp");
        assert!(stamp.get("builtAt").and_then(Value::as_u64).is_some());
        assert!(stamp.get("head").is_some());
        let build_info = read_json(&temp.path().join("dist/build-info.json")).expect("build info");
        assert_eq!(build_info["version"], "2026.5.3");
        assert!(build_info.get("commit").is_some());
        assert!(build_info.get("builtAt").and_then(Value::as_str).is_some());
    }
}
