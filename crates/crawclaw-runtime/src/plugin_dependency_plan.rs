use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Map, Value};

const GENERATED_BY: &str = "crawclaw-runtime emit-plugin-dependency-plan";
const DEFAULT_JSON_OUTPUT: &str = "docs/.generated/plugin-dependency-plan.json";
const DEFAULT_JSONL_OUTPUT: &str = "docs/.generated/plugin-dependency-plan.jsonl";
const PLUGIN_MANIFEST_FILENAME: &str = "crawclaw.plugin.json";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginDependencyPlanWriteResult {
    pub changed: bool,
    pub json_path: PathBuf,
    pub jsonl_path: PathBuf,
    pub wrote: bool,
}

pub fn write_plugin_dependency_plan_artifacts(
    repo_root: impl AsRef<Path>,
    json_path: Option<PathBuf>,
    jsonl_path: Option<PathBuf>,
    check: bool,
) -> Result<PluginDependencyPlanWriteResult, String> {
    let repo_root = normalize_root(repo_root.as_ref());
    let json_path = resolve_output_path(&repo_root, json_path, DEFAULT_JSON_OUTPUT);
    let jsonl_path = resolve_output_path(&repo_root, jsonl_path, DEFAULT_JSONL_OUTPUT);
    let (json_output, jsonl_output) = render_plugin_dependency_plan(&repo_root)?;
    let current_json = read_text_optional(&json_path)?;
    let current_jsonl = read_text_optional(&jsonl_path)?;
    let changed = current_json.as_deref() != Some(json_output.as_str())
        || current_jsonl.as_deref() != Some(jsonl_output.as_str());

    if check {
        return Ok(PluginDependencyPlanWriteResult {
            changed,
            json_path,
            jsonl_path,
            wrote: false,
        });
    }

    write_text(&json_path, &json_output)?;
    write_text(&jsonl_path, &jsonl_output)?;
    Ok(PluginDependencyPlanWriteResult {
        changed,
        json_path,
        jsonl_path,
        wrote: true,
    })
}

pub fn render_plugin_dependency_plan(repo_root: &Path) -> Result<(String, String), String> {
    let plan = build_plugin_dependency_plan(repo_root)?;
    let json_output = format!(
        "{}\n",
        serde_json::to_string_pretty(&plan)
            .map_err(|error| format!("failed to serialize plugin dependency plan: {error}"))?
    );
    let jsonl_output = render_jsonl(&plan)?;
    Ok((json_output, jsonl_output))
}

pub fn relative_to_repo(repo_root: &Path, path: &Path) -> String {
    slash_path(path.strip_prefix(repo_root).unwrap_or(path))
}

fn build_plugin_dependency_plan(repo_root: &Path) -> Result<Value, String> {
    let bundled_plugins = collect_bundled_plugins(repo_root)?;
    let managed_runtimes = Vec::<Value>::new();
    let root = collect_root_dependency_plan(repo_root)?;
    let summary = build_summary(&bundled_plugins, &root);

    Ok(json_object([
        ("bundledPlugins", Value::Array(bundled_plugins)),
        ("generatedBy", Value::String(GENERATED_BY.to_string())),
        ("managedRuntimes", Value::Array(managed_runtimes)),
        ("root", root),
        ("schemaVersion", json!(1)),
        ("summary", summary),
    ]))
}

fn collect_bundled_plugins(repo_root: &Path) -> Result<Vec<Value>, String> {
    let mut plugins = Vec::new();
    for manifest_path in list_plugin_manifest_paths(repo_root)? {
        let manifest = read_json_required(&repo_root.join(&manifest_path))?;
        let Some(plugin_id) = manifest.get("id").and_then(Value::as_str) else {
            continue;
        };
        let dir = Path::new(&manifest_path)
            .parent()
            .map(slash_path)
            .unwrap_or_default();
        let package_json_path = format!("{dir}/package.json");
        let package_json = read_json_optional(&repo_root.join(&package_json_path))?;
        let mut install = Map::new();
        install.insert("entryPoints".to_string(), Value::Array(Vec::new()));
        if let Some(npm_spec) = package_json
            .as_ref()
            .and_then(|value| value.get("crawclaw"))
            .and_then(|value| value.get("install"))
            .and_then(|value| value.get("npmSpec"))
            .and_then(Value::as_str)
        {
            install.insert("npmSpec".to_string(), Value::String(npm_spec.to_string()));
        }

        let mut entry = Map::new();
        entry.insert(
            "capabilities".to_string(),
            string_array(collect_manifest_capabilities(&manifest)),
        );
        entry.insert(
            "contractKeys".to_string(),
            string_array(collect_manifest_contract_keys(&manifest)),
        );
        entry.insert(
            "dependencies".to_string(),
            sort_string_object(
                package_json
                    .as_ref()
                    .and_then(|value| value.get("dependencies")),
            ),
        );
        entry.insert(
            "devDependencies".to_string(),
            sort_string_object(
                package_json
                    .as_ref()
                    .and_then(|value| value.get("devDependencies")),
            ),
        );
        entry.insert("dir".to_string(), Value::String(dir));
        entry.insert(
            "enabledByDefault".to_string(),
            Value::Bool(
                manifest
                    .get("enabledByDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            ),
        );
        entry.insert("id".to_string(), Value::String(plugin_id.to_string()));
        entry.insert("install".to_string(), Value::Object(install));
        entry.insert(
            "manifestPath".to_string(),
            Value::String(slash_path(&manifest_path)),
        );
        entry.insert(
            "optionalDependencies".to_string(),
            sort_string_object(
                package_json
                    .as_ref()
                    .and_then(|value| value.get("optionalDependencies")),
            ),
        );
        if package_json.is_some() {
            entry.insert(
                "packageJsonPath".to_string(),
                Value::String(package_json_path),
            );
        }
        if let Some(package_name) = package_json
            .as_ref()
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str)
        {
            entry.insert(
                "packageName".to_string(),
                Value::String(package_name.to_string()),
            );
        }
        entry.insert(
            "peerDependencies".to_string(),
            sort_string_object(
                package_json
                    .as_ref()
                    .and_then(|value| value.get("peerDependencies")),
            ),
        );
        entry.insert(
            "private".to_string(),
            Value::Bool(
                package_json
                    .as_ref()
                    .and_then(|value| value.get("private"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            ),
        );
        entry.insert(
            "providerIds".to_string(),
            string_array(collect_manifest_provider_ids(&manifest)),
        );
        if let Some(version) = package_json
            .as_ref()
            .and_then(|value| value.get("version"))
            .and_then(Value::as_str)
        {
            entry.insert("version".to_string(), Value::String(version.to_string()));
        }
        plugins.push(Value::Object(entry));
    }
    plugins.sort_by(|left, right| value_string(left, "id").cmp(&value_string(right, "id")));
    Ok(plugins)
}

fn collect_root_dependency_plan(repo_root: &Path) -> Result<Value, String> {
    let root_package = read_json_required(&repo_root.join("package.json"))?;
    let workspace = read_workspace_yaml(&repo_root.join("pnpm-workspace.yaml"))?;
    let pnpm = root_package.get("pnpm");
    let mut pnpm_object = Map::new();
    pnpm_object.insert(
        "ignoredBuiltDependencies".to_string(),
        sort_string_array_value(pnpm.and_then(|value| value.get("ignoredBuiltDependencies"))),
    );
    pnpm_object.insert(
        "overrides".to_string(),
        sort_string_object(pnpm.and_then(|value| value.get("overrides"))),
    );
    pnpm_object.insert(
        "packageJsonOnlyBuiltDependencies".to_string(),
        sort_string_array_value(pnpm.and_then(|value| value.get("onlyBuiltDependencies"))),
    );
    pnpm_object.insert(
        "workspaceIgnoredBuiltDependencies".to_string(),
        string_array(workspace.ignored_built_dependencies),
    );
    if let Some(minimum_release_age) = workspace.minimum_release_age {
        pnpm_object.insert(
            "workspaceMinimumReleaseAge".to_string(),
            json!(minimum_release_age),
        );
    }
    pnpm_object.insert(
        "workspaceOnlyBuiltDependencies".to_string(),
        string_array(workspace.only_built_dependencies),
    );
    pnpm_object.insert(
        "workspacePackages".to_string(),
        string_array(workspace.packages),
    );

    let mut root = Map::new();
    root.insert(
        "dependencies".to_string(),
        sort_string_object(root_package.get("dependencies")),
    );
    root.insert(
        "devDependencies".to_string(),
        sort_string_object(root_package.get("devDependencies")),
    );
    root.insert(
        "engines".to_string(),
        sort_string_object(root_package.get("engines")),
    );
    root.insert(
        "optionalDependencies".to_string(),
        sort_string_object(root_package.get("optionalDependencies")),
    );
    if let Some(package_manager) = root_package.get("packageManager").and_then(Value::as_str) {
        root.insert(
            "packageManager".to_string(),
            Value::String(package_manager.to_string()),
        );
    }
    root.insert(
        "peerDependencies".to_string(),
        sort_string_object(root_package.get("peerDependencies")),
    );
    root.insert("pnpm".to_string(), Value::Object(pnpm_object));
    Ok(Value::Object(root))
}

fn build_summary(plugins: &[Value], root: &Value) -> Value {
    let mut runtime_dependency_names = BTreeSet::new();
    for plugin in plugins {
        for section in ["dependencies", "optionalDependencies"] {
            if let Some(object) = plugin.get(section).and_then(Value::as_object) {
                runtime_dependency_names.extend(object.keys().cloned());
            }
        }
    }

    let mut summary = Map::new();
    summary.insert("bundledPluginCount".to_string(), json!(plugins.len()));
    summary.insert(
        "capabilityCounts".to_string(),
        collect_capability_counts(plugins),
    );
    summary.insert(
        "disabledByDefaultCount".to_string(),
        json!(plugins
            .iter()
            .filter(|plugin| !plugin
                .get("enabledByDefault")
                .and_then(Value::as_bool)
                .unwrap_or(false))
            .count()),
    );
    summary.insert(
        "enabledByDefaultCount".to_string(),
        json!(plugins
            .iter()
            .filter(|plugin| plugin
                .get("enabledByDefault")
                .and_then(Value::as_bool)
                .unwrap_or(false))
            .count()),
    );
    summary.insert(
        "pluginRuntimeDependencyVersionSplits".to_string(),
        Value::Array(collect_version_splits(plugins)),
    );
    summary.insert(
        "releasedNpmSpecPluginIds".to_string(),
        string_array(
            plugins
                .iter()
                .filter(|plugin| {
                    plugin
                        .get("install")
                        .and_then(|value| value.get("npmSpec"))
                        .and_then(Value::as_str)
                        .is_some()
                })
                .filter_map(|plugin| value_string_optional(plugin, "id"))
                .collect::<Vec<_>>(),
        ),
    );
    summary.insert(
        "rootDependencyCounts".to_string(),
        json_object([
            (
                "dependencies",
                json!(count_object_entries(root.get("dependencies"))),
            ),
            (
                "devDependencies",
                json!(count_object_entries(root.get("devDependencies"))),
            ),
            (
                "optionalDependencies",
                json!(count_object_entries(root.get("optionalDependencies"))),
            ),
            (
                "peerDependencies",
                json!(count_object_entries(root.get("peerDependencies"))),
            ),
        ]),
    );
    summary.insert(
        "uniquePluginRuntimeDependencyCount".to_string(),
        json!(runtime_dependency_names.len()),
    );
    Value::Object(summary)
}

fn render_jsonl(plan: &Value) -> Result<String, String> {
    let mut lines = Vec::new();
    lines.push(json_object([
        ("kind", Value::String("root".to_string())),
        (
            "root",
            plan.get("root")
                .cloned()
                .unwrap_or(Value::Object(Map::new())),
        ),
    ]));
    lines.push(json_object([
        ("kind", Value::String("summary".to_string())),
        (
            "summary",
            plan.get("summary")
                .cloned()
                .unwrap_or(Value::Object(Map::new())),
        ),
    ]));
    for plugin in plan
        .get("bundledPlugins")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        lines.push(json_object([
            ("kind", Value::String("bundled-plugin".to_string())),
            ("plugin", plugin.clone()),
        ]));
    }
    for runtime in plan
        .get("managedRuntimes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        lines.push(json_object([
            ("kind", Value::String("managed-runtime".to_string())),
            ("runtime", runtime.clone()),
        ]));
    }
    lines
        .into_iter()
        .map(|line| {
            serde_json::to_string(&line)
                .map_err(|error| format!("failed to serialize plugin dependency JSONL: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|lines| format!("{}\n", lines.join("\n")))
}

fn list_plugin_manifest_paths(repo_root: &Path) -> Result<Vec<PathBuf>, String> {
    let tracked = list_tracked_plugin_manifest_paths(repo_root);
    if !tracked.is_empty() {
        return Ok(tracked);
    }
    list_filesystem_plugin_manifest_paths(repo_root)
}

fn list_tracked_plugin_manifest_paths(repo_root: &Path) -> Vec<PathBuf> {
    let output = Command::new("git")
        .args(["ls-files", "extensions/*/crawclaw.plugin.json"])
        .current_dir(repo_root)
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let Ok(stdout) = String::from_utf8(output.stdout) else {
        return Vec::new();
    };
    let mut paths = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| slash_path(path));
    paths
}

fn list_filesystem_plugin_manifest_paths(repo_root: &Path) -> Result<Vec<PathBuf>, String> {
    let extensions_root = repo_root.join("extensions");
    if !extensions_root.exists() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(&extensions_root)
        .map_err(|error| format!("failed to read {}: {error}", extensions_root.display()))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        let manifest_path = PathBuf::from("extensions")
            .join(entry.file_name())
            .join(PLUGIN_MANIFEST_FILENAME);
        if repo_root.join(&manifest_path).exists() {
            paths.push(manifest_path);
        }
    }
    paths.sort_by_key(|path| slash_path(path));
    Ok(paths)
}

fn collect_manifest_capabilities(manifest: &Value) -> Vec<String> {
    let mut capabilities = Vec::new();
    if manifest
        .get("providers")
        .and_then(Value::as_array)
        .is_some_and(|providers| !providers.is_empty())
    {
        capabilities.push("provider".to_string());
    }
    if manifest
        .get("skills")
        .and_then(Value::as_array)
        .is_some_and(|skills| !skills.is_empty())
    {
        capabilities.push("skill".to_string());
    }
    if manifest.get("cli").and_then(Value::as_object).is_some() {
        capabilities.push("cli".to_string());
    }
    if manifest
        .get("contracts")
        .and_then(Value::as_object)
        .is_some()
    {
        capabilities.push("contract".to_string());
    }
    if capabilities.is_empty() {
        capabilities.push("support".to_string());
    }
    capabilities
}

fn collect_manifest_contract_keys(manifest: &Value) -> Vec<String> {
    sorted_object_keys(manifest.get("contracts"))
}

fn collect_manifest_provider_ids(manifest: &Value) -> Vec<String> {
    let mut ids = manifest
        .get("providers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            if let Some(id) = entry.as_str() {
                return Some(id.to_string());
            }
            entry.get("id").and_then(Value::as_str).map(str::to_string)
        })
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

fn collect_capability_counts(plugins: &[Value]) -> Value {
    let mut counts = BTreeMap::<String, usize>::new();
    for plugin in plugins {
        for capability in plugin
            .get("capabilities")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            *counts.entry(capability.to_string()).or_default() += 1;
        }
    }
    Value::Object(
        counts
            .into_iter()
            .map(|(key, count)| (key, json!(count)))
            .collect(),
    )
}

fn collect_version_splits(plugins: &[Value]) -> Vec<Value> {
    let mut sources_by_name = BTreeMap::<String, Vec<DependencySource>>::new();
    for plugin in plugins {
        let Some(plugin_id) = value_string_optional(plugin, "id") else {
            continue;
        };
        for section in ["dependencies", "optionalDependencies"] {
            if let Some(object) = plugin.get(section).and_then(Value::as_object) {
                for (name, version) in object {
                    if let Some(version) = version.as_str() {
                        sources_by_name.entry(name.to_string()).or_default().push(
                            DependencySource {
                                plugin_id: plugin_id.clone(),
                                section: section.to_string(),
                                version: version.to_string(),
                            },
                        );
                    }
                }
            }
        }
    }

    sources_by_name
        .into_iter()
        .filter_map(|(name, mut sources)| {
            let versions = sources
                .iter()
                .map(|source| source.version.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            if versions.len() <= 1 {
                return None;
            }
            sources.sort_by(|left, right| {
                format!("{}:{}", left.version, left.plugin_id)
                    .cmp(&format!("{}:{}", right.version, right.plugin_id))
            });
            Some(json_object([
                ("name", Value::String(name)),
                (
                    "sources",
                    Value::Array(sources.into_iter().map(Value::from).collect()),
                ),
                ("versions", string_array(versions)),
            ]))
        })
        .collect()
}

#[derive(Clone, Debug)]
struct DependencySource {
    plugin_id: String,
    section: String,
    version: String,
}

impl From<DependencySource> for Value {
    fn from(source: DependencySource) -> Self {
        json_object([
            ("pluginId", Value::String(source.plugin_id)),
            ("section", Value::String(source.section)),
            ("version", Value::String(source.version)),
        ])
    }
}

#[derive(Default)]
struct WorkspaceDependencyPlan {
    packages: Vec<String>,
    minimum_release_age: Option<u64>,
    only_built_dependencies: Vec<String>,
    ignored_built_dependencies: Vec<String>,
}

fn read_workspace_yaml(path: &Path) -> Result<WorkspaceDependencyPlan, String> {
    let Some(raw) = read_text_optional(path)? else {
        return Ok(WorkspaceDependencyPlan::default());
    };
    let mut plan = WorkspaceDependencyPlan::default();
    let mut current_list: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !line.starts_with(' ') && trimmed.ends_with(':') {
            current_list = Some(trimmed.trim_end_matches(':').to_string());
            continue;
        }
        if !line.starts_with(' ') {
            current_list = None;
            if let Some((key, value)) = trimmed.split_once(':') {
                if key.trim() == "minimumReleaseAge" {
                    plan.minimum_release_age = value.trim().parse::<u64>().ok();
                }
            }
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            let item = unquote_yaml_string(item.trim()).to_string();
            match current_list.as_deref() {
                Some("packages") => plan.packages.push(item),
                Some("onlyBuiltDependencies") => plan.only_built_dependencies.push(item),
                Some("ignoredBuiltDependencies") => plan.ignored_built_dependencies.push(item),
                _ => {}
            }
        }
    }
    plan.packages.sort();
    plan.packages.dedup();
    plan.only_built_dependencies.sort();
    plan.only_built_dependencies.dedup();
    plan.ignored_built_dependencies.sort();
    plan.ignored_built_dependencies.dedup();
    Ok(plan)
}

fn unquote_yaml_string(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(value)
}

fn sort_string_object(value: Option<&Value>) -> Value {
    let entries = value
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), Value::String(value.to_string())))
        })
        .collect::<Map<_, _>>();
    Value::Object(entries)
}

fn sort_string_array_value(value: Option<&Value>) -> Value {
    string_array(
        value
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>(),
    )
}

fn string_array(values: Vec<String>) -> Value {
    Value::Array(
        values
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(Value::String)
            .collect(),
    )
}

fn sorted_object_keys(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_object)
        .map(|object| object.keys().cloned().collect())
        .unwrap_or_default()
}

fn count_object_entries(value: Option<&Value>) -> usize {
    value.and_then(Value::as_object).map_or(0, Map::len)
}

fn value_string(value: &Value, key: &str) -> String {
    value_string_optional(value, key).unwrap_or_default()
}

fn value_string_optional(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn json_object<const N: usize>(entries: [(&str, Value); N]) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect(),
    )
}

fn read_json_required(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn read_json_optional(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    read_json_required(path).map(Some)
}

fn read_text_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("failed to read {}: {error}", path.display())),
    }
}

fn write_text(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    fs::write(path, contents)
        .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn normalize_root(root: &Path) -> PathBuf {
    if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(root)
    }
}

fn resolve_output_path(root: &Path, path: Option<PathBuf>, fallback: &str) -> PathBuf {
    let path = path.unwrap_or_else(|| PathBuf::from(fallback));
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repo root")
            .to_path_buf()
    }

    #[test]
    fn plugin_dependency_plan_artifacts_are_current() {
        let root = repo_root();
        let (json_output, jsonl_output) = render_plugin_dependency_plan(&root).expect("render");

        assert_eq!(
            fs::read_to_string(root.join(DEFAULT_JSON_OUTPUT)).expect("json baseline"),
            json_output
        );
        assert_eq!(
            fs::read_to_string(root.join(DEFAULT_JSONL_OUTPUT)).expect("jsonl baseline"),
            jsonl_output
        );
    }
}
