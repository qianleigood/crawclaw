use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;
use serde_json::Value;

use crate::package_build::{list_bundled_plugin_pack_artifacts, list_static_package_asset_outputs};

const PREPACK_PREPARED_ENV: &str = "CRAWCLAW_PREPACK_PREPARED";
const REQUIRED_NATIVE_PATH_GROUPS: &[&[&str]] = &[
    &[
        "dist/native/crawclaw-runtime",
        "dist/native/crawclaw-runtime.exe",
    ],
    &[
        "dist/native/crawclaw-gateway",
        "dist/native/crawclaw-gateway.exe",
    ],
    &[
        "dist/native/crawclaw-native-plugins",
        "dist/native/crawclaw-native-plugins.exe",
    ],
];
const REQUIRED_STATIC_PACK_PATHS: &[&str] = &[
    "docs/reference/templates/AGENTS.md",
    "skills/coding-agent/SKILL.md",
    "dist/build-info.json",
];
const FORBIDDEN_PACK_PREFIXES: &[&str] = &["dist-runtime/"];
const NPM_PACK_UNPACKED_SIZE_BUDGET_BYTES: u64 = 191 * 1024 * 1024;
const MIN_HOST_VERSION_FORMAT: &str =
    "crawclaw.install.minHostVersion must use a semver floor in the form \">=x.y.z\"";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PackagePrepackOutcome {
    UsedPreparedArtifacts,
    RanBuild,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PackageReleaseCheckErrors {
    pub manifest_errors: Vec<String>,
    pub missing: Vec<String>,
    pub forbidden: Vec<String>,
    pub size_errors: Vec<String>,
}

impl PackageReleaseCheckErrors {
    pub fn is_empty(&self) -> bool {
        self.manifest_errors.is_empty()
            && self.missing.is_empty()
            && self.forbidden.is_empty()
            && self.size_errors.is_empty()
    }
}

#[derive(Clone, Debug)]
enum RequiredPackPath {
    AnyOf(Vec<String>),
    Single(String),
}

#[derive(Clone, Debug)]
struct BundledExtension {
    id: String,
    package_json: Value,
}

#[derive(Clone, Debug, Deserialize)]
struct PackFile {
    path: String,
}

#[derive(Clone, Debug, Deserialize)]
struct PackResult {
    files: Option<Vec<PackFile>>,
    filename: Option<String>,
    #[serde(rename = "unpackedSize")]
    unpacked_size: Option<u64>,
}

pub fn run_package_prepack(root_dir: impl AsRef<Path>) -> Result<PackagePrepackOutcome, String> {
    let root_dir = normalize_root(root_dir.as_ref());
    if should_skip_prepack() {
        let errors = collect_prepared_prepack_errors(&root_dir);
        if errors.is_empty() {
            eprintln!(
                "prepack: using prepared artifacts from {PREPACK_PREPARED_ENV}; skipping rebuild."
            );
            return Ok(PackagePrepackOutcome::UsedPreparedArtifacts);
        }
        for error in errors {
            eprintln!("prepack: {error}");
        }
        return Err(format!(
            "prepack: {PREPACK_PREPARED_ENV}=1 requires an existing build. Run `pnpm build` first or unset {PREPACK_PREPARED_ENV}."
        ));
    }

    let pnpm_command = if cfg!(windows) { "pnpm.cmd" } else { "pnpm" };
    let status = Command::new(pnpm_command)
        .arg("build")
        .current_dir(&root_dir)
        .status()
        .map_err(|error| format!("prepack: failed to run pnpm build: {error}"))?;
    if status.success() {
        Ok(PackagePrepackOutcome::RanBuild)
    } else {
        Err(format!(
            "prepack: pnpm build failed with status {}",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "?".to_string())
        ))
    }
}

pub fn collect_package_release_check_errors(
    root_dir: impl AsRef<Path>,
) -> Result<PackageReleaseCheckErrors, String> {
    let root_dir = normalize_root(root_dir.as_ref());
    let extensions = collect_bundled_extensions(&root_dir)?;
    let manifest_errors = collect_bundled_extension_manifest_errors(&root_dir, &extensions)?;
    if !manifest_errors.is_empty() {
        return Ok(PackageReleaseCheckErrors {
            manifest_errors,
            ..PackageReleaseCheckErrors::default()
        });
    }

    let pack_results = run_npm_pack_dry(&root_dir)?;
    let paths = pack_results
        .iter()
        .flat_map(|entry| entry.files.as_deref().unwrap_or_default())
        .map(|file| file.path.clone())
        .collect::<BTreeSet<_>>();
    let required_paths = collect_required_pack_paths(&root_dir)?;
    Ok(PackageReleaseCheckErrors {
        manifest_errors,
        missing: collect_missing_pack_paths(&required_paths, &paths),
        forbidden: collect_forbidden_pack_paths(&paths),
        size_errors: collect_pack_unpacked_size_errors(&pack_results),
    })
}

pub fn format_package_release_check_errors(errors: &PackageReleaseCheckErrors) -> Vec<String> {
    let mut lines = Vec::new();
    if !errors.manifest_errors.is_empty() {
        lines.push("release-check: bundled extension manifest validation failed:".to_string());
        lines.extend(
            errors
                .manifest_errors
                .iter()
                .map(|error| format!("  - {error}")),
        );
        return lines;
    }
    if !errors.missing.is_empty() {
        lines.push("release-check: missing files in npm pack:".to_string());
        lines.extend(errors.missing.iter().map(|path| format!("  - {path}")));
        if errors
            .missing
            .iter()
            .any(|path| path == "dist/build-info.json" || path.starts_with("dist/"))
        {
            lines.push(
                "release-check: build artifacts are missing. Run `pnpm build` before `pnpm release:check`."
                    .to_string(),
            );
        }
    }
    if !errors.forbidden.is_empty() {
        lines.push("release-check: forbidden files in npm pack:".to_string());
        lines.extend(errors.forbidden.iter().map(|path| format!("  - {path}")));
    }
    if !errors.size_errors.is_empty() {
        lines.push("release-check: npm pack unpacked size budget exceeded:".to_string());
        lines.extend(
            errors
                .size_errors
                .iter()
                .map(|error| format!("  - {error}")),
        );
    }
    lines
}

fn should_skip_prepack() -> bool {
    let Ok(raw) = env::var(PREPACK_PREPARED_ENV) else {
        return false;
    };
    !raw.is_empty() && !matches!(raw.to_ascii_lowercase().as_str(), "0" | "false")
}

fn collect_prepared_prepack_errors(root_dir: &Path) -> Vec<String> {
    REQUIRED_NATIVE_PATH_GROUPS
        .iter()
        .filter(|group| !group.iter().any(|path| root_dir.join(path).exists()))
        .map(|group| format!("missing required prepared artifact: {}", group.join(" or ")))
        .collect()
}

fn collect_required_pack_paths(root_dir: &Path) -> Result<Vec<RequiredPackPath>, String> {
    let mut required = REQUIRED_NATIVE_PATH_GROUPS
        .iter()
        .map(|group| {
            RequiredPackPath::AnyOf(group.iter().map(|path| (*path).to_string()).collect())
        })
        .collect::<Vec<_>>();
    required.extend(
        list_bundled_plugin_pack_artifacts(root_dir)?
            .into_iter()
            .map(RequiredPackPath::Single),
    );
    required.extend(
        list_static_package_asset_outputs(root_dir)?
            .into_iter()
            .map(RequiredPackPath::Single),
    );
    required.extend(
        REQUIRED_STATIC_PACK_PATHS
            .iter()
            .map(|path| RequiredPackPath::Single((*path).to_string())),
    );
    Ok(required)
}

fn collect_missing_pack_paths(
    required: &[RequiredPackPath],
    available: &BTreeSet<String>,
) -> Vec<String> {
    let mut missing = required
        .iter()
        .filter_map(|entry| match entry {
            RequiredPackPath::AnyOf(paths) => {
                if paths.iter().any(|path| available.contains(path)) {
                    None
                } else {
                    Some(paths.join(" or "))
                }
            }
            RequiredPackPath::Single(path) => {
                if available.contains(path) {
                    None
                } else {
                    Some(path.clone())
                }
            }
        })
        .collect::<Vec<_>>();
    missing.sort();
    missing
}

fn collect_forbidden_pack_paths(paths: &BTreeSet<String>) -> Vec<String> {
    paths
        .iter()
        .filter(|path| {
            FORBIDDEN_PACK_PREFIXES
                .iter()
                .any(|prefix| path.starts_with(prefix))
                || path.contains("node_modules/")
        })
        .cloned()
        .collect()
}

fn collect_pack_unpacked_size_errors(results: &[PackResult]) -> Vec<String> {
    let mut errors = Vec::new();
    let mut checked_count = 0;
    for (index, entry) in results.iter().enumerate() {
        let Some(unpacked_size) = entry.unpacked_size else {
            continue;
        };
        checked_count += 1;
        if unpacked_size <= NPM_PACK_UNPACKED_SIZE_BUDGET_BYTES {
            continue;
        }
        let label = entry
            .filename
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("pack result #{}", index + 1));
        errors.push(format!(
            "{} unpackedSize {} bytes ({}) exceeds budget {} bytes ({}). Investigate duplicate channel shims, copied extension trees, or other accidental pack bloat before release.",
            label,
            unpacked_size,
            format_mib(unpacked_size),
            NPM_PACK_UNPACKED_SIZE_BUDGET_BYTES,
            format_mib(NPM_PACK_UNPACKED_SIZE_BUDGET_BYTES)
        ));
    }
    if !results.is_empty() && checked_count == 0 {
        errors.push(
            "npm pack --dry-run produced no unpackedSize data; pack size budget was not verified."
                .to_string(),
        );
    }
    errors
}

fn format_mib(bytes: u64) -> String {
    format!("{:.1} MiB", bytes as f64 / (1024.0 * 1024.0))
}

fn collect_bundled_extensions(root_dir: &Path) -> Result<Vec<BundledExtension>, String> {
    let extensions_dir = root_dir.join("extensions");
    let mut extensions = Vec::new();
    if !extensions_dir.exists() {
        return Ok(extensions);
    }
    for entry in fs::read_dir(&extensions_dir)
        .map_err(|error| format!("failed to read {}: {error}", extensions_dir.display()))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let package_path = extensions_dir.join(&id).join("package.json");
        let Ok(raw) = fs::read_to_string(&package_path) else {
            continue;
        };
        let Ok(package_json) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        extensions.push(BundledExtension { id, package_json });
    }
    extensions.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(extensions)
}

fn collect_bundled_extension_manifest_errors(
    root_dir: &Path,
    extensions: &[BundledExtension],
) -> Result<Vec<String>, String> {
    let root_package = read_json(&root_dir.join("package.json")).ok();
    let root_runtime_deps = root_package
        .as_ref()
        .map(collect_runtime_dependency_specs)
        .unwrap_or_default();
    let mut errors = Vec::new();

    for extension in extensions {
        let crawclaw = extension
            .package_json
            .get("crawclaw")
            .and_then(Value::as_object);
        let install = crawclaw.and_then(|value| value.get("install"));
        if install.is_some_and(|value| !value.is_object()) {
            errors.push(format!(
                "bundled extension '{}' manifest invalid | crawclaw.install must be an object",
                extension.id
            ));
            continue;
        }
        if let Some(install_object) = install.and_then(Value::as_object) {
            if install_object.contains_key("npmSpec")
                && !install_object
                    .get("npmSpec")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty())
            {
                errors.push(format!(
                    "bundled extension '{}' manifest invalid | crawclaw.install.npmSpec must be a non-empty string",
                    extension.id
                ));
            }
            if let Some(error) = validate_min_host_version(install_object.get("minHostVersion")) {
                errors.push(format!(
                    "bundled extension '{}' manifest invalid | {error}",
                    extension.id
                ));
            }
        }
        errors.extend(collect_root_dependency_mirror_errors(
            extension,
            &root_runtime_deps,
        ));
    }
    Ok(errors)
}

fn collect_root_dependency_mirror_errors(
    extension: &BundledExtension,
    root_runtime_deps: &BTreeMap<String, String>,
) -> Vec<String> {
    let allowlist = extension
        .package_json
        .get("crawclaw")
        .and_then(|value| value.get("releaseChecks"))
        .and_then(|value| value.get("rootDependencyMirrorAllowlist"));
    let Some(allowlist) = allowlist else {
        return Vec::new();
    };
    let mut errors = Vec::new();
    let Some(allowlist) = allowlist.as_array() else {
        errors.push(format!(
            "bundled extension '{}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist must be an array",
            extension.id
        ));
        return errors;
    };
    let extension_runtime_deps = collect_runtime_dependency_specs(&extension.package_json);
    for entry in allowlist {
        let Some(name) = entry
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            errors.push(format!(
                "bundled extension '{}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entries must be non-empty strings",
                extension.id
            ));
            continue;
        };
        let extension_spec = extension_runtime_deps.get(name);
        if extension_spec.is_none() {
            errors.push(format!(
                "bundled extension '{}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '{name}' must be declared in extension runtime dependencies",
                extension.id
            ));
        }
        let root_spec = root_runtime_deps.get(name);
        if root_spec.is_none() {
            errors.push(format!(
                "bundled extension '{}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '{name}' must be mirrored in root runtime dependencies",
                extension.id
            ));
        }
        let (Some(extension_spec), Some(root_spec)) = (extension_spec, root_spec) else {
            continue;
        };
        if extension_spec != root_spec {
            errors.push(format!(
                "bundled extension '{}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '{name}' must match root runtime dependency version (extension '{extension_spec}', root '{root_spec}')",
                extension.id
            ));
        }
    }
    errors
}

fn collect_runtime_dependency_specs(package_json: &Value) -> BTreeMap<String, String> {
    ["dependencies", "optionalDependencies"]
        .into_iter()
        .flat_map(|section| {
            package_json
                .get(section)
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
        })
        .collect()
}

fn validate_min_host_version(raw: Option<&Value>) -> Option<&'static str> {
    let Some(raw) = raw else {
        return None;
    };
    let Some(raw) = raw
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Some(MIN_HOST_VERSION_FORMAT);
    };
    let Some(version) = raw.strip_prefix(">=") else {
        return Some(MIN_HOST_VERSION_FORMAT);
    };
    let parts = version.split('.').collect::<Vec<_>>();
    if parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
    {
        None
    } else {
        Some(MIN_HOST_VERSION_FORMAT)
    }
}

fn run_npm_pack_dry(root_dir: &Path) -> Result<Vec<PackResult>, String> {
    let output = Command::new("npm")
        .args(["pack", "--dry-run", "--json", "--ignore-scripts"])
        .current_dir(root_dir)
        .output()
        .map_err(|error| format!("release-check: failed to run npm pack: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "release-check: npm pack failed with status {}: {}",
            output
                .status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "?".to_string()),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("release-check: failed to parse npm pack output: {error}"))
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn normalize_root(root_dir: &Path) -> PathBuf {
    if root_dir.is_absolute() {
        root_dir.to_path_buf()
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(root_dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepared_prepack_requires_native_artifact_group() {
        let temp = tempfile::tempdir().expect("tempdir");
        let errors = collect_prepared_prepack_errors(temp.path());

        assert_eq!(errors.len(), 3);
        assert!(errors[0].contains("dist/native/crawclaw-runtime"));
    }

    #[test]
    fn missing_pack_paths_accept_one_path_per_native_group() {
        let required = vec![
            RequiredPackPath::AnyOf(vec![
                "dist/native/crawclaw-runtime".to_string(),
                "dist/native/crawclaw-runtime.exe".to_string(),
            ]),
            RequiredPackPath::Single("dist/build-info.json".to_string()),
        ];
        let available = ["dist/native/crawclaw-runtime.exe"]
            .into_iter()
            .map(str::to_string)
            .collect::<BTreeSet<_>>();

        assert_eq!(
            collect_missing_pack_paths(&required, &available),
            vec!["dist/build-info.json".to_string()]
        );
    }

    #[test]
    fn validates_bundled_extension_root_dependency_mirror() {
        let extension = BundledExtension {
            id: "example".to_string(),
            package_json: serde_json::json!({
                "dependencies": { "sharp": "1.0.0" },
                "crawclaw": {
                    "releaseChecks": {
                        "rootDependencyMirrorAllowlist": ["sharp", "missing"]
                    }
                }
            }),
        };
        let root_runtime_deps = BTreeMap::from([("sharp".to_string(), "2.0.0".to_string())]);

        let errors = collect_root_dependency_mirror_errors(&extension, &root_runtime_deps);

        assert_eq!(errors.len(), 3);
        assert!(errors[0].contains("must match root runtime dependency version"));
        assert!(errors[1].contains("must be declared in extension runtime dependencies"));
        assert!(errors[2].contains("must be mirrored in root runtime dependencies"));
    }
}
