use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const EXPECTED_REPOSITORY_URL: &str = "https://github.com/qianleigood/crawclaw";
const INSTALL_TIME_NODE_HELPER_FILES: &[&str] = &[
    "scripts/npm-runner.mjs",
    "scripts/postinstall-bundled-plugins.mjs",
];
const MAX_CALVER_DISTANCE_DAYS: i64 = 2;
const SKIP_PACK_VALIDATION_ENV: &str = "CRAWCLAW_NPM_RELEASE_SKIP_PACK_CHECK";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedReleaseVersion {
    pub version: String,
    pub base_version: String,
    pub channel: ReleaseChannel,
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub beta_number: Option<u32>,
    pub correction_number: Option<u32>,
    pub date: NaiveDate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReleaseChannel {
    Stable,
    Beta,
}

impl ReleaseChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            ReleaseChannel::Stable => "stable",
            ReleaseChannel::Beta => "beta",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NpmPublishPlan {
    pub channel: ReleaseChannel,
    pub publish_tag: String,
    pub mirror_dist_tags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NpmDistTagMirrorAuth {
    pub has_auth: bool,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RootNpmReleaseCheckResult {
    pub version: String,
    pub channel: ReleaseChannel,
    pub day_distance: i64,
    pub metadata_only: bool,
    pub release_tag_validated: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishablePluginPackage {
    pub extension_id: String,
    pub package_dir: String,
    pub package_name: String,
    pub version: String,
    pub channel: ReleaseChannel,
    pub publish_tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_npm_spec: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginReleasePlanItem {
    #[serde(flatten)]
    pub plugin: PublishablePluginPackage,
    pub already_published: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginReleasePlan {
    pub all: Vec<PluginReleasePlanItem>,
    pub candidates: Vec<PluginReleasePlanItem>,
    pub skipped_published: Vec<PluginReleasePlanItem>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedPluginReleaseArgs {
    pub selection: Vec<String>,
    pub selection_mode: Option<PluginReleaseSelectionMode>,
    pub base_ref: Option<String>,
    pub head_ref: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginReleaseSelectionMode {
    Selected,
    AllPublishable,
}

#[derive(Clone, Debug)]
struct RootPackageJson {
    value: Value,
}

#[derive(Clone, Debug)]
struct PluginPackageCandidate {
    extension_id: String,
    package_dir: String,
    absolute_package_dir: PathBuf,
    package_json: Value,
}

#[derive(Clone, Debug, Deserialize)]
struct NpmPackResult {
    files: Option<Vec<Value>>,
}

pub fn parse_release_version(version: &str) -> Option<ParsedReleaseVersion> {
    let trimmed = version.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some((base, beta)) = trimmed.split_once("-beta.") {
        let beta_number = beta.parse::<u32>().ok()?;
        if beta_number == 0 {
            return None;
        }
        return parse_release_date(base, trimmed, ReleaseChannel::Beta).map(|mut parsed| {
            parsed.beta_number = Some(beta_number);
            parsed
        });
    }

    if let Some((base, correction)) = trimmed.rsplit_once('-') {
        if correction.contains('.') {
            return None;
        }
        let correction_number = correction.parse::<u32>().ok()?;
        if correction_number == 0 {
            return None;
        }
        return parse_release_date(base, trimmed, ReleaseChannel::Stable).map(|mut parsed| {
            parsed.correction_number = Some(correction_number);
            parsed
        });
    }

    parse_release_date(trimmed, trimmed, ReleaseChannel::Stable)
}

pub fn compare_release_versions(left: &str, right: &str) -> Option<Ordering> {
    let left = parse_release_version(left)?;
    let right = parse_release_version(right)?;

    let date_order = left.date.cmp(&right.date);
    if date_order != Ordering::Equal {
        return Some(date_order);
    }

    if left.channel != right.channel {
        return Some(match left.channel {
            ReleaseChannel::Stable => Ordering::Greater,
            ReleaseChannel::Beta => Ordering::Less,
        });
    }

    if left.channel == ReleaseChannel::Beta {
        return Some(
            left.beta_number
                .unwrap_or(0)
                .cmp(&right.beta_number.unwrap_or(0)),
        );
    }

    Some(
        left.correction_number
            .unwrap_or(0)
            .cmp(&right.correction_number.unwrap_or(0)),
    )
}

pub fn resolve_root_npm_publish_plan(
    version: &str,
    requested_publish_tag: Option<&str>,
) -> Result<NpmPublishPlan, String> {
    let parsed = parse_release_version(version)
        .ok_or_else(|| format!("Unsupported release version \"{version}\"."))?;
    let publish_tag = if requested_publish_tag == Some("latest") {
        "latest"
    } else {
        "beta"
    };

    if parsed.channel == ReleaseChannel::Beta && publish_tag != "beta" {
        return Err("Beta prereleases must publish to the beta dist-tag.".to_string());
    }

    Ok(NpmPublishPlan {
        channel: parsed.channel,
        publish_tag: publish_tag.to_string(),
        mirror_dist_tags: Vec::new(),
    })
}

pub fn resolve_plugin_npm_publish_plan(
    version: &str,
    current_beta_version: Option<&str>,
) -> Result<NpmPublishPlan, String> {
    let parsed = parse_release_version(version)
        .ok_or_else(|| format!("Unsupported release version \"{version}\"."))?;
    if parsed.channel == ReleaseChannel::Beta {
        return Ok(NpmPublishPlan {
            channel: ReleaseChannel::Beta,
            publish_tag: "beta".to_string(),
            mirror_dist_tags: Vec::new(),
        });
    }

    if let Some(current_beta_version) = current_beta_version
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        if compare_release_versions(current_beta_version, version)
            .is_some_and(|ordering| ordering == Ordering::Greater)
        {
            return Ok(NpmPublishPlan {
                channel: ReleaseChannel::Stable,
                publish_tag: "latest".to_string(),
                mirror_dist_tags: Vec::new(),
            });
        }
    }

    Ok(NpmPublishPlan {
        channel: ReleaseChannel::Stable,
        publish_tag: "latest".to_string(),
        mirror_dist_tags: vec!["beta".to_string()],
    })
}

pub fn resolve_npm_dist_tag_mirror_auth(
    node_auth_token: Option<&str>,
    npm_token: Option<&str>,
) -> NpmDistTagMirrorAuth {
    if node_auth_token.is_some_and(|value| !value.trim().is_empty()) {
        return NpmDistTagMirrorAuth {
            has_auth: true,
            source: "node-auth-token".to_string(),
        };
    }
    if npm_token.is_some_and(|value| !value.trim().is_empty()) {
        return NpmDistTagMirrorAuth {
            has_auth: true,
            source: "npm-token".to_string(),
        };
    }
    NpmDistTagMirrorAuth {
        has_auth: false,
        source: "none".to_string(),
    }
}

pub fn should_require_npm_dist_tag_mirror_auth(
    publish_mode: &str,
    mirror_dist_tags: &[String],
    has_auth: bool,
) -> bool {
    publish_mode == "--publish"
        && mirror_dist_tags
            .iter()
            .any(|dist_tag| !dist_tag.trim().is_empty())
        && !has_auth
}

pub fn run_root_npm_release_check(
    root_dir: impl AsRef<Path>,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<RootNpmReleaseCheckResult, Vec<String>> {
    let root_dir = normalize_root(root_dir.as_ref());
    let pkg = match load_root_package_json(&root_dir) {
        Ok(pkg) => pkg,
        Err(error) => return Err(vec![error]),
    };
    let package_version = pkg.string("version").unwrap_or_default();
    let now = Utc::now().date_naive();
    let skip_pack_validation = should_skip_pack_validation(env);
    let validate_release_tag = should_validate_release_tag(env);

    let mut errors = collect_release_package_metadata_errors(&pkg);
    if validate_release_tag {
        errors.extend(collect_release_tag_errors(ReleaseTagCheck {
            package_version: &package_version,
            release_tag: env("RELEASE_TAG").unwrap_or_default().as_str(),
            release_sha: env("RELEASE_SHA").as_deref(),
            release_main_ref: env("RELEASE_MAIN_REF").as_deref(),
            now,
            root_dir: &root_dir,
        }));
    }
    if !skip_pack_validation {
        errors.extend(collect_packed_tarball_errors(&root_dir));
    }

    if !errors.is_empty() {
        return Err(errors);
    }

    let parsed = parse_release_version(&package_version).ok_or_else(|| {
        vec![format!(
            "package.json version must match YYYY.M.D, YYYY.M.D-N, or YYYY.M.D-beta.N; found \"{}\".",
            package_version
        )]
    })?;

    Ok(RootNpmReleaseCheckResult {
        version: package_version,
        channel: parsed.channel,
        day_distance: utc_calendar_day_distance(parsed.date, now),
        metadata_only: skip_pack_validation,
        release_tag_validated: validate_release_tag,
    })
}

pub fn verify_published_npm_install(version: &str) -> Result<Vec<String>, String> {
    let scenarios = build_published_install_scenarios(version)?;
    let mut lines = Vec::new();
    for scenario in scenarios {
        verify_published_install_scenario(version, &scenario)?;
        lines.push(format!(
            "crawclaw-npm-postpublish-verify: {} OK ({version})",
            scenario.name
        ));
    }
    lines.push(format!(
        "crawclaw-npm-postpublish-verify: verified published npm install paths for {version}."
    ));
    Ok(lines)
}

pub fn parse_plugin_release_args(args: &[String]) -> Result<ParsedPluginReleaseArgs, String> {
    let mut selection = Vec::new();
    let mut selection_mode = None;
    let mut plugins_flag_provided = false;
    let mut base_ref = None;
    let mut head_ref = None;

    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--" => {
                index += 1;
            }
            "--plugins" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "--plugins requires a value".to_string())?;
                selection = parse_plugin_release_selection(value);
                plugins_flag_provided = true;
                index += 2;
            }
            "--selection-mode" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "--selection-mode requires a value".to_string())?;
                selection_mode = Some(parse_plugin_release_selection_mode(value)?);
                index += 2;
            }
            "--base-ref" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "--base-ref requires a value".to_string())?;
                base_ref = Some(value.clone());
                index += 2;
            }
            "--head-ref" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "--head-ref requires a value".to_string())?;
                head_ref = Some(value.clone());
                index += 2;
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
    }

    if plugins_flag_provided && selection.is_empty() {
        return Err("`--plugins` must include at least one package name.".to_string());
    }
    if selection_mode == Some(PluginReleaseSelectionMode::Selected) && !plugins_flag_provided {
        return Err("`--selection-mode selected` requires `--plugins`.".to_string());
    }
    if selection_mode == Some(PluginReleaseSelectionMode::AllPublishable) && plugins_flag_provided {
        return Err(
            "`--selection-mode all-publishable` must not be combined with `--plugins`.".to_string(),
        );
    }
    if !selection.is_empty() && (base_ref.is_some() || head_ref.is_some()) {
        return Err("Use either --plugins or --base-ref/--head-ref, not both.".to_string());
    }
    if selection_mode.is_some() && (base_ref.is_some() || head_ref.is_some()) {
        return Err("Use either --selection-mode or --base-ref/--head-ref, not both.".to_string());
    }
    if (base_ref.is_some() && head_ref.is_none()) || (base_ref.is_none() && head_ref.is_some()) {
        return Err("Both --base-ref and --head-ref are required together.".to_string());
    }

    Ok(ParsedPluginReleaseArgs {
        selection,
        selection_mode,
        base_ref,
        head_ref,
    })
}

pub fn collect_publishable_plugin_packages(
    root_dir: impl AsRef<Path>,
) -> Result<Vec<PublishablePluginPackage>, String> {
    let root_dir = normalize_root(root_dir.as_ref());
    let extensions_dir = root_dir.join("extensions");
    let entries = fs::read_dir(&extensions_dir)
        .map_err(|error| format!("failed to read {}: {error}", extensions_dir.display()))?;
    let mut publishable = Vec::new();
    let mut validation_errors = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("failed to read extension entry: {error}"))?;
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "failed to inspect extension entry {}: {error}",
                entry.path().display()
            )
        })?;
        if !file_type.is_dir() {
            continue;
        }
        let extension_id = entry.file_name().to_string_lossy().to_string();
        let absolute_package_dir = entry.path();
        let package_json_path = absolute_package_dir.join("package.json");
        let Ok(package_json) = read_json_file(&package_json_path) else {
            continue;
        };
        if json_bool_at(&package_json, &["crawclaw", "release", "publishToNpm"]) != Some(true) {
            continue;
        }

        let candidate = PluginPackageCandidate {
            extension_id: extension_id.clone(),
            package_dir: format!("extensions/{extension_id}"),
            absolute_package_dir,
            package_json,
        };
        let errors = collect_publishable_plugin_package_errors(&candidate);
        if !errors.is_empty() {
            validation_errors.extend(
                errors
                    .into_iter()
                    .map(|error| format!("{}: {error}", candidate.extension_id)),
            );
            continue;
        }

        let version = json_string(&candidate.package_json, "version").unwrap_or_default();
        let parsed = parse_release_version(&version).ok_or_else(|| {
            format!(
                "{}: package.json version must match YYYY.M.D, YYYY.M.D-N, or YYYY.M.D-beta.N; found \"{}\".",
                candidate.extension_id, version
            )
        })?;
        let publish_tag = resolve_plugin_npm_publish_plan(&version, None)?.publish_tag;
        publishable.push(PublishablePluginPackage {
            extension_id: candidate.extension_id,
            package_dir: candidate.package_dir,
            package_name: json_string(&candidate.package_json, "name").unwrap_or_default(),
            version,
            channel: parsed.channel,
            publish_tag,
            install_npm_spec: json_string_at(
                &candidate.package_json,
                &["crawclaw", "install", "npmSpec"],
            )
            .filter(|value| !value.trim().is_empty()),
        });
    }

    if !validation_errors.is_empty() {
        return Err(format!(
            "Publishable plugin metadata validation failed:\n{}",
            validation_errors
                .iter()
                .map(|error| format!("- {error}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }

    publishable.sort_by(|left, right| left.package_name.cmp(&right.package_name));
    Ok(publishable)
}

pub fn resolve_selected_publishable_plugin_packages(
    plugins: &[PublishablePluginPackage],
    selection: &[String],
) -> Result<Vec<PublishablePluginPackage>, String> {
    if selection.is_empty() {
        return Ok(plugins.to_vec());
    }

    let mut selected = Vec::new();
    let mut missing = Vec::new();
    for package_name in selection {
        if let Some(plugin) = plugins
            .iter()
            .find(|plugin| plugin.package_name == *package_name)
        {
            selected.push(plugin.clone());
        } else {
            missing.push(package_name.clone());
        }
    }

    if !missing.is_empty() {
        return Err(format!(
            "Unknown or non-publishable plugin package selection: {}.",
            missing.join(", ")
        ));
    }
    Ok(selected)
}

pub fn collect_changed_extension_ids_from_paths(paths: &[String]) -> Vec<String> {
    let mut ids = BTreeSet::new();
    for path in paths {
        let normalized = path.trim().replace('\\', "/");
        let Some(rest) = normalized.strip_prefix("extensions/") else {
            continue;
        };
        let Some((id, _)) = rest.split_once('/') else {
            continue;
        };
        if !id.is_empty() {
            ids.insert(id.to_string());
        }
    }
    ids.into_iter().collect()
}

pub fn collect_changed_extension_ids_from_git_range(
    root_dir: impl AsRef<Path>,
    base_ref: &str,
    head_ref: &str,
) -> Result<Vec<String>, String> {
    if is_null_git_ref(base_ref) || is_null_git_ref(head_ref) {
        return Ok(Vec::new());
    }
    let output = Command::new("git")
        .args([
            "diff",
            "--name-only",
            "--diff-filter=ACMR",
            base_ref,
            head_ref,
            "--",
            "extensions",
        ])
        .current_dir(root_dir.as_ref())
        .output()
        .map_err(|error| format!("failed to run git diff for plugin selection: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "git diff for plugin selection failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let paths = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    Ok(collect_changed_extension_ids_from_paths(&paths))
}

pub fn select_publishable_plugin_packages(
    root_dir: impl AsRef<Path>,
    parsed_args: &ParsedPluginReleaseArgs,
) -> Result<Vec<PublishablePluginPackage>, String> {
    let root_dir = normalize_root(root_dir.as_ref());
    let publishable = collect_publishable_plugin_packages(&root_dir)?;
    if parsed_args.selection_mode == Some(PluginReleaseSelectionMode::AllPublishable) {
        return Ok(publishable);
    }
    if !parsed_args.selection.is_empty() {
        return resolve_selected_publishable_plugin_packages(&publishable, &parsed_args.selection);
    }
    if let (Some(base_ref), Some(head_ref)) = (&parsed_args.base_ref, &parsed_args.head_ref) {
        let changed = collect_changed_extension_ids_from_git_range(&root_dir, base_ref, head_ref)?;
        if changed.is_empty() {
            return Ok(Vec::new());
        }
        let changed = changed.into_iter().collect::<BTreeSet<_>>();
        return Ok(publishable
            .into_iter()
            .filter(|plugin| changed.contains(&plugin.extension_id))
            .collect());
    }
    Ok(publishable)
}

pub fn collect_plugin_release_plan(
    root_dir: impl AsRef<Path>,
    parsed_args: &ParsedPluginReleaseArgs,
) -> Result<PluginReleasePlan, String> {
    let selected = select_publishable_plugin_packages(root_dir, parsed_args)?;
    let all = selected
        .into_iter()
        .map(|plugin| {
            let already_published =
                is_plugin_version_published(&plugin.package_name, &plugin.version);
            PluginReleasePlanItem {
                plugin,
                already_published,
            }
        })
        .collect::<Vec<_>>();
    let candidates = all
        .iter()
        .filter(|item| !item.already_published)
        .cloned()
        .collect::<Vec<_>>();
    let skipped_published = all
        .iter()
        .filter(|item| item.already_published)
        .cloned()
        .collect::<Vec<_>>();
    Ok(PluginReleasePlan {
        all,
        candidates,
        skipped_published,
    })
}

pub fn is_plugin_version_published(package_name: &str, version: &str) -> bool {
    let temp_dir = match create_temp_dir("crawclaw-plugin-npm-view-") {
        Ok(path) => path,
        Err(_) => return false,
    };
    let userconfig_path = temp_dir.join("npmrc");
    let _ = fs::write(&userconfig_path, "");
    let status = Command::new(npm_command())
        .args([
            "view",
            &format!("{package_name}@{version}"),
            "version",
            "--userconfig",
        ])
        .arg(&userconfig_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = fs::remove_dir_all(&temp_dir);
    status.is_ok_and(|status| status.success())
}

pub fn read_package_metadata(package_dir: impl AsRef<Path>) -> Result<(String, String), String> {
    let path = package_dir.as_ref().join("package.json");
    let value = read_json_file(&path)?;
    Ok((
        json_string(&value, "name").unwrap_or_default(),
        json_string(&value, "version").unwrap_or_default(),
    ))
}

fn parse_release_date(
    base: &str,
    version: &str,
    channel: ReleaseChannel,
) -> Option<ParsedReleaseVersion> {
    let mut parts = base.split('.');
    let year = parts.next()?.parse::<i32>().ok()?;
    let month = parts.next()?.parse::<u32>().ok()?;
    let day = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    let date = NaiveDate::from_ymd_opt(year, month, day)?;
    Some(ParsedReleaseVersion {
        version: version.to_string(),
        base_version: format!("{year}.{month}.{day}"),
        channel,
        year,
        month,
        day,
        beta_number: None,
        correction_number: None,
        date,
    })
}

fn normalize_root(root_dir: &Path) -> PathBuf {
    if root_dir.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        root_dir.to_path_buf()
    }
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn load_root_package_json(root_dir: &Path) -> Result<RootPackageJson, String> {
    Ok(RootPackageJson {
        value: read_json_file(&root_dir.join("package.json"))?,
    })
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(|value| value.to_string())
}

fn json_string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_str().map(|value| value.to_string())
}

fn json_bool_at(value: &Value, path: &[&str]) -> Option<bool> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_bool()
}

impl RootPackageJson {
    fn string(&self, key: &str) -> Option<String> {
        json_string(&self.value, key)
    }

    fn object(&self, key: &str) -> Option<&serde_json::Map<String, Value>> {
        self.value.get(key)?.as_object()
    }

    fn array(&self, key: &str) -> Option<&Vec<Value>> {
        self.value.get(key)?.as_array()
    }
}

fn normalize_repo_url(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .strip_prefix("git+")
        .unwrap_or_else(|| value.and_then(Value::as_str).unwrap_or_default().trim())
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_string()
}

fn collect_release_package_metadata_errors(pkg: &RootPackageJson) -> Vec<String> {
    let mut errors = Vec::new();
    let repository_url = pkg.value.get("repository").and_then(|repository| {
        if repository.is_string() {
            Some(repository)
        } else {
            repository.get("url")
        }
    });
    let actual_repository_url = normalize_repo_url(repository_url);

    if pkg.string("name").as_deref() != Some("crawclaw") {
        errors.push(format!(
            "package.json name must be \"crawclaw\"; found \"{}\".",
            pkg.string("name").unwrap_or_default()
        ));
    }
    if pkg
        .string("description")
        .is_none_or(|description| description.trim().is_empty())
    {
        errors.push("package.json description must be non-empty.".to_string());
    }
    if pkg.string("license").as_deref() != Some("MIT") {
        errors.push(format!(
            "package.json license must be \"MIT\"; found \"{}\".",
            pkg.string("license").unwrap_or_default()
        ));
    }
    if actual_repository_url != EXPECTED_REPOSITORY_URL {
        errors.push(format!(
            "package.json repository.url must resolve to {EXPECTED_REPOSITORY_URL}; found {}.",
            if actual_repository_url.is_empty() {
                "<missing>".to_string()
            } else {
                actual_repository_url
            }
        ));
    }
    if pkg
        .object("bin")
        .is_some_and(|bin| bin.contains_key("crawclaw"))
    {
        errors.push("package.json must not expose public crawclaw CLI bin.".to_string());
    }
    if pkg
        .string("main")
        .is_some_and(|main| !main.trim().is_empty())
    {
        errors.push("package.json must not expose a root Node main entry.".to_string());
    }
    if pkg
        .object("exports")
        .is_some_and(|exports| exports.contains_key("."))
    {
        errors
            .push("package.json exports must not expose root JS library entry \".\".".to_string());
    }
    if pkg
        .object("exports")
        .is_some_and(|exports| exports.contains_key("./cli-entry"))
    {
        errors.push("package.json exports must not expose legacy \"./cli-entry\".".to_string());
    }
    if pkg.array("files").is_some_and(|files| {
        files
            .iter()
            .any(|file| file.as_str() == Some("crawclaw.mjs"))
    }) {
        errors.push("package.json files must not include the legacy Node entry file.".to_string());
    }
    if pkg
        .array("files")
        .is_some_and(|files| files.iter().any(|file| file.as_str() == Some("dist/")))
    {
        errors.push(
            "package.json files must not include the legacy dist JS runtime tree.".to_string(),
        );
    }
    if pkg.array("files").is_some_and(|files| {
        files.iter().any(|file| {
            file.as_str()
                .is_some_and(|path| INSTALL_TIME_NODE_HELPER_FILES.contains(&path))
        })
    }) {
        errors.push(
            "package.json files must not include install-time Node helper scripts.".to_string(),
        );
    }
    if pkg
        .object("scripts")
        .and_then(|scripts| scripts.get("postinstall"))
        .and_then(Value::as_str)
        .is_some_and(|postinstall| !postinstall.trim().is_empty())
    {
        errors.push("package.json must not run a postinstall script.".to_string());
    }
    if pkg
        .object("peerDependencies")
        .and_then(|deps| deps.get("node-llama-cpp"))
        .and_then(Value::as_str)
        != Some("3.18.1")
    {
        errors.push(format!(
            "package.json peerDependencies[\"node-llama-cpp\"] must be \"3.18.1\"; found \"{}\".",
            pkg.object("peerDependencies")
                .and_then(|deps| deps.get("node-llama-cpp"))
                .and_then(Value::as_str)
                .unwrap_or_default()
        ));
    }
    if pkg
        .object("peerDependenciesMeta")
        .and_then(|meta| meta.get("node-llama-cpp"))
        .and_then(|entry| entry.get("optional"))
        .and_then(Value::as_bool)
        != Some(true)
    {
        errors.push(
            "package.json peerDependenciesMeta[\"node-llama-cpp\"].optional must be true."
                .to_string(),
        );
    }

    errors
}

struct ReleaseTagCheck<'a> {
    package_version: &'a str,
    release_tag: &'a str,
    release_sha: Option<&'a str>,
    release_main_ref: Option<&'a str>,
    now: NaiveDate,
    root_dir: &'a Path,
}

fn collect_release_tag_errors(params: ReleaseTagCheck<'_>) -> Vec<String> {
    let mut errors = Vec::new();
    let release_tag = params.release_tag.trim();
    let package_version = params.package_version.trim();
    let parsed_version = parse_release_version(package_version);
    if parsed_version.is_none() {
        errors.push(format!(
            "package.json version must match YYYY.M.D, YYYY.M.D-N, or YYYY.M.D-beta.N; found \"{}\".",
            if package_version.is_empty() { "<missing>" } else { package_version }
        ));
    }

    if !release_tag.starts_with('v') {
        errors.push(format!(
            "Release tag must start with \"v\"; found \"{}\".",
            if release_tag.is_empty() {
                "<missing>"
            } else {
                release_tag
            }
        ));
    }

    let tag_version = release_tag.strip_prefix('v').unwrap_or(release_tag);
    let parsed_tag = parse_release_version(tag_version);
    if parsed_tag.is_none() {
        errors.push(format!(
            "Release tag must match vYYYY.M.D, vYYYY.M.D-beta.N, or fallback correction tag vYYYY.M.D-N; found \"{}\".",
            if release_tag.is_empty() { "<missing>" } else { release_tag }
        ));
    }

    let matches_expected_tag = match (&parsed_tag, &parsed_version) {
        (Some(parsed_tag), Some(parsed_version)) => {
            parsed_tag.channel == parsed_version.channel
                && (parsed_tag.version == parsed_version.version
                    || (parsed_version.channel == ReleaseChannel::Stable
                        && parsed_version.correction_number.is_none()
                        && parsed_tag.correction_number.is_some()
                        && parsed_tag.base_version == parsed_version.base_version))
        }
        _ => false,
    };
    if !matches_expected_tag {
        let expected_tag = if package_version.is_empty() {
            "<missing>".to_string()
        } else {
            format!("v{package_version}")
        };
        let expected = if parsed_version.as_ref().is_some_and(|version| {
            version.channel == ReleaseChannel::Stable && version.correction_number.is_none()
        }) {
            format!("{expected_tag} or {expected_tag}-N")
        } else {
            expected_tag
        };
        errors.push(format!(
            "Release tag {} does not match package.json version {}; expected {expected}.",
            if release_tag.is_empty() {
                "<missing>"
            } else {
                release_tag
            },
            if package_version.is_empty() {
                "<missing>"
            } else {
                package_version
            }
        ));
    }

    if let Some(parsed_version) = parsed_version {
        let day_distance = utc_calendar_day_distance(parsed_version.date, params.now);
        if day_distance > MAX_CALVER_DISTANCE_DAYS {
            errors.push(format!(
                "Release version {package_version} is {day_distance} days away from current UTC date {}; release CalVer date {} must be within {MAX_CALVER_DISTANCE_DAYS} days.",
                params.now,
                parsed_version.date
            ));
        }
    }

    if let (Some(release_sha), Some(release_main_ref)) = (
        params
            .release_sha
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        params
            .release_main_ref
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    ) {
        let status = Command::new("git")
            .args(["merge-base", "--is-ancestor", release_sha, release_main_ref])
            .current_dir(params.root_dir)
            .status();
        if !status.is_ok_and(|status| status.success()) {
            errors.push(format!(
                "Tagged commit {release_sha} is not contained in {release_main_ref}."
            ));
        }
    }

    errors
}

fn utc_calendar_day_distance(left: NaiveDate, right: NaiveDate) -> i64 {
    (left.signed_duration_since(right).num_days()).abs()
}

fn should_skip_pack_validation(env: &dyn Fn(&str) -> Option<String>) -> bool {
    env(SKIP_PACK_VALIDATION_ENV).is_some_and(|raw| {
        !raw.is_empty() && !matches!(raw.to_ascii_lowercase().as_str(), "0" | "false")
    })
}

fn should_validate_release_tag(env: &dyn Fn(&str) -> Option<String>) -> bool {
    ["RELEASE_TAG", "RELEASE_SHA", "RELEASE_MAIN_REF"]
        .iter()
        .any(|key| env(key).is_some_and(|value| !value.trim().is_empty()))
        || env("GITHUB_ACTIONS").as_deref() == Some("true")
}

fn npm_command() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn collect_packed_tarball_errors(root_dir: &Path) -> Vec<String> {
    let output = Command::new(npm_command())
        .args(["pack", "--json", "--dry-run", "--ignore-scripts"])
        .current_dir(root_dir)
        .output();
    let output = match output {
        Ok(output) => output,
        Err(error) => {
            return vec![format!(
                "Failed to inspect npm tarball contents via `npm pack --json --dry-run --ignore-scripts`: {error}"
            )];
        }
    };
    if !output.status.success() {
        return vec![format!(
            "Failed to inspect npm tarball contents via `npm pack --json --dry-run --ignore-scripts`: stderr: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )];
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(pack_results) = parse_npm_pack_json_output(&stdout) else {
        return vec![
            "Failed to parse JSON output from `npm pack --json --dry-run --ignore-scripts`."
                .to_string(),
        ];
    };
    let Some(first_result) = pack_results.first() else {
        return vec![
            "`npm pack --json --dry-run --ignore-scripts` did not return a files list to validate."
                .to_string(),
        ];
    };
    if first_result.files.is_none() {
        return vec![
            "`npm pack --json --dry-run --ignore-scripts` did not return a files list to validate."
                .to_string(),
        ];
    }
    Vec::new()
}

fn parse_npm_pack_json_output(stdout: &str) -> Option<Vec<NpmPackResult>> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut candidates = vec![trimmed.to_string()];
    if let Some(index) = trimmed.rfind("\n[") {
        candidates.push(trimmed[index + 1..].trim().to_string());
    }
    for candidate in candidates {
        if let Ok(parsed) = serde_json::from_str::<Vec<NpmPackResult>>(&candidate) {
            return Some(parsed);
        }
    }
    None
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PublishedInstallScenario {
    name: String,
    install_specs: Vec<String>,
    expected_version: String,
}

fn build_published_install_scenarios(
    version: &str,
) -> Result<Vec<PublishedInstallScenario>, String> {
    let parsed = parse_release_version(version)
        .ok_or_else(|| format!("Unsupported release version \"{version}\"."))?;
    let exact_spec = format!("crawclaw@{version}");
    let mut scenarios = vec![PublishedInstallScenario {
        name: "fresh-exact".to_string(),
        install_specs: vec![exact_spec.clone()],
        expected_version: version.to_string(),
    }];
    if parsed.channel == ReleaseChannel::Stable && parsed.correction_number.is_some() {
        scenarios.push(PublishedInstallScenario {
            name: "upgrade-from-base-stable".to_string(),
            install_specs: vec![format!("crawclaw@{}", parsed.base_version), exact_spec],
            expected_version: version.to_string(),
        });
    }
    Ok(scenarios)
}

fn verify_published_install_scenario(
    _version: &str,
    scenario: &PublishedInstallScenario,
) -> Result<(), String> {
    let working_dir = create_temp_dir(&format!("crawclaw-postpublish-{}.", scenario.name))?;
    let prefix_dir = working_dir.join("prefix");
    let result = (|| {
        for spec in &scenario.install_specs {
            run_npm_in_dir(
                &[
                    "install",
                    "-g",
                    "--prefix",
                    prefix_dir.to_string_lossy().as_ref(),
                    spec,
                    "--no-fund",
                    "--no-audit",
                ],
                &working_dir,
            )?;
        }
        let global_root = run_npm_in_dir(
            &[
                "root",
                "-g",
                "--prefix",
                prefix_dir.to_string_lossy().as_ref(),
            ],
            &working_dir,
        )?;
        let package_root = PathBuf::from(global_root.trim()).join("crawclaw");
        let package_json = read_json_file(&package_root.join("package.json"))?;
        let installed_version = json_string(&package_json, "version").unwrap_or_default();
        if installed_version != scenario.expected_version {
            return Err(format!(
                "{} failed:\n- installed package version mismatch: expected {}, found {}.",
                scenario.name,
                scenario.expected_version,
                if installed_version.is_empty() {
                    "<missing>"
                } else {
                    &installed_version
                }
            ));
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&working_dir);
    result
}

fn run_npm_in_dir(args: &[&str], cwd: &Path) -> Result<String, String> {
    let output = Command::new(npm_command())
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("failed to run npm {}: {error}", args.join(" ")))?;
    if !output.status.success() {
        return Err(format!(
            "npm {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn parse_plugin_release_selection(value: &str) -> Vec<String> {
    value
        .split(|ch: char| ch == ',' || ch.is_whitespace())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(str::to_string)
        .collect()
}

fn parse_plugin_release_selection_mode(value: &str) -> Result<PluginReleaseSelectionMode, String> {
    match value {
        "selected" => Ok(PluginReleaseSelectionMode::Selected),
        "all-publishable" => Ok(PluginReleaseSelectionMode::AllPublishable),
        _ => Err(format!(
            "Unknown selection mode: {value}. Expected \"selected\" or \"all-publishable\"."
        )),
    }
}

fn collect_publishable_plugin_package_errors(candidate: &PluginPackageCandidate) -> Vec<String> {
    let mut errors = Vec::new();
    let package_name = json_string(&candidate.package_json, "name").unwrap_or_default();
    let package_version = json_string(&candidate.package_json, "version").unwrap_or_default();
    if !package_name.starts_with("@crawclaw/") {
        errors.push(format!(
            "package name must start with \"@crawclaw/\"; found \"{}\".",
            if package_name.is_empty() {
                "<missing>"
            } else {
                &package_name
            }
        ));
    }
    if candidate
        .package_json
        .get("private")
        .and_then(Value::as_bool)
        == Some(true)
    {
        errors.push("package.json private must not be true.".to_string());
    }
    if package_version.is_empty() {
        errors.push("package.json version must be non-empty.".to_string());
    } else if parse_release_version(&package_version).is_none() {
        errors.push(format!(
            "package.json version must match YYYY.M.D, YYYY.M.D-N, or YYYY.M.D-beta.N; found \"{package_version}\"."
        ));
    }
    if !plugin_manifest_has_native(&candidate.absolute_package_dir) {
        errors.push("crawclaw.plugin.json must include a native plugin descriptor.".to_string());
    }
    errors
}

fn plugin_manifest_has_native(package_dir: &Path) -> bool {
    let Ok(manifest) = read_json_file(&package_dir.join("crawclaw.plugin.json")) else {
        return false;
    };
    let native = manifest.get("native").and_then(Value::as_object);
    native
        .and_then(|native| native.get("protocol"))
        .and_then(Value::as_str)
        == Some("crawclaw-native-plugin-jsonrpc")
        && native
            .and_then(|native| native.get("schemaVersion"))
            .and_then(Value::as_i64)
            == Some(1)
        && native.is_some_and(|native| {
            native.get("bin").and_then(Value::as_str).is_some()
                || native.get("command").and_then(Value::as_array).is_some()
        })
}

fn is_null_git_ref(ref_name: &str) -> bool {
    ref_name.is_empty() || ref_name.chars().all(|ch| ch == '0')
}

fn create_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let mut path = env::temp_dir();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock before UNIX_EPOCH: {error}"))?
        .as_nanos();
    path.push(format!("{prefix}{}-{now}", std::process::id()));
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create temp dir {}: {error}", path.display()))?;
    Ok(path)
}

pub fn format_npm_publish_plan_lines(
    plan: &NpmPublishPlan,
    auth: &NpmDistTagMirrorAuth,
    mirror_auth_required: bool,
) -> Vec<String> {
    vec![
        plan.channel.as_str().to_string(),
        plan.publish_tag.clone(),
        plan.mirror_dist_tags.join(","),
        auth.source.clone(),
        if mirror_auth_required {
            "required".to_string()
        } else {
            "optional".to_string()
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    #[test]
    fn parses_stable_beta_and_correction_versions() {
        let stable = parse_release_version("2026.5.20").expect("stable version");
        assert_eq!(stable.channel, ReleaseChannel::Stable);
        assert_eq!(stable.base_version, "2026.5.20");
        assert_eq!(stable.date.year(), 2026);
        assert_eq!(stable.date.month(), 5);
        assert_eq!(stable.date.day(), 20);

        let beta = parse_release_version("2026.5.20-beta.3").expect("beta version");
        assert_eq!(beta.channel, ReleaseChannel::Beta);
        assert_eq!(beta.beta_number, Some(3));

        let correction = parse_release_version("2026.5.20-2").expect("correction version");
        assert_eq!(correction.channel, ReleaseChannel::Stable);
        assert_eq!(correction.correction_number, Some(2));

        assert!(parse_release_version("2026.2.31").is_none());
        assert!(parse_release_version("2026.5.20-beta.0").is_none());
    }

    #[test]
    fn resolves_root_and_plugin_publish_plan_semantics() {
        let root_default = resolve_root_npm_publish_plan("2026.5.20", None).unwrap();
        assert_eq!(root_default.publish_tag, "beta");
        assert!(root_default.mirror_dist_tags.is_empty());

        let root_latest = resolve_root_npm_publish_plan("2026.5.20", Some("latest")).unwrap();
        assert_eq!(root_latest.publish_tag, "latest");

        assert!(resolve_root_npm_publish_plan("2026.5.20-beta.1", Some("latest")).is_err());

        let plugin_stable = resolve_plugin_npm_publish_plan("2026.5.20", None).unwrap();
        assert_eq!(plugin_stable.publish_tag, "latest");
        assert_eq!(plugin_stable.mirror_dist_tags, vec!["beta".to_string()]);

        let plugin_beta_ahead =
            resolve_plugin_npm_publish_plan("2026.5.20", Some("2026.5.21-beta.1")).unwrap();
        assert!(plugin_beta_ahead.mirror_dist_tags.is_empty());
    }

    #[test]
    fn parses_plugin_release_args_and_changed_paths() {
        let args = vec![
            "--plugins".to_string(),
            "@crawclaw/a @crawclaw/b,@crawclaw/a".to_string(),
            "--selection-mode".to_string(),
            "selected".to_string(),
        ];
        let parsed = parse_plugin_release_args(&args).unwrap();
        assert_eq!(
            parsed.selection,
            vec!["@crawclaw/a".to_string(), "@crawclaw/b".to_string()]
        );
        assert_eq!(
            parsed.selection_mode,
            Some(PluginReleaseSelectionMode::Selected)
        );

        let changed = collect_changed_extension_ids_from_paths(&[
            "extensions/foo/package.json".to_string(),
            "docs/x.md".to_string(),
            "extensions/bar/src/lib.rs".to_string(),
        ]);
        assert_eq!(changed, vec!["bar".to_string(), "foo".to_string()]);
    }

    #[test]
    fn detects_mirror_auth_requirement() {
        let auth = resolve_npm_dist_tag_mirror_auth(Some(""), Some("token"));
        assert!(auth.has_auth);
        assert_eq!(auth.source, "npm-token");
        assert!(should_require_npm_dist_tag_mirror_auth(
            "--publish",
            &["beta".to_string()],
            false
        ));
        assert!(!should_require_npm_dist_tag_mirror_auth(
            "--dry-run",
            &["beta".to_string()],
            false
        ));
    }
}
