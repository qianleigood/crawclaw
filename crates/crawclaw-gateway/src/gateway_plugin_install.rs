use super::*;

#[derive(Debug)]
pub(super) struct PluginInstallSource {
    pub(super) manifest: Value,
    pub(super) source_root: Option<PathBuf>,
    pub(super) source_path: Option<PathBuf>,
    pub(super) install_source: String,
    pub(super) record_fields: Map<String, Value>,
    pub(super) cleanup_roots: Vec<PathBuf>,
}

pub(super) fn plugin_install_source(
    _state: &GatewayState,
    params: &Value,
    mode: &str,
) -> Result<PluginInstallSource, String> {
    if let Some(raw) = string_param(params, &["raw", "source", "path"]) {
        let source = expand_user_path(&raw);
        if source.exists() {
            return plugin_install_source_from_path(&source, "path", Some(source.clone()), None);
        }
        if raw.trim().starts_with("clawhub:") {
            return plugin_install_source_from_clawhub(&raw);
        }
        return plugin_install_source_from_npm_spec(&raw, mode);
    }
    if let Some(manifest) = params.get("manifest") {
        return Ok(PluginInstallSource {
            manifest: manifest.clone(),
            source_root: None,
            source_path: None,
            install_source: "manifest".to_string(),
            record_fields: Map::new(),
            cleanup_roots: Vec::new(),
        });
    }
    if let Some(spec) = string_param(params, &["npmSpec", "spec"]) {
        return plugin_install_source_from_npm_spec(&spec, mode);
    }
    if let Some(spec) = string_param(params, &["clawhubSpec"]) {
        return plugin_install_source_from_clawhub(&spec);
    }
    if let Some(marketplace) = string_param(params, &["marketplace", "marketplaceSource"]) {
        let plugin = required_param(params, &["plugin", "marketplacePlugin", "pluginId", "id"])?;
        return plugin_install_source_from_marketplace(&marketplace, &plugin);
    }
    let id = required_param(params, &["pluginId", "id", "name"])?;
    let safe_id = safe_plugin_id(&id)?;
    if let Some((source_root, manifest_path)) = bundled_plugin_manifest_path(&safe_id) {
        return Ok(PluginInstallSource {
            manifest: read_json_file(&manifest_path)?,
            source_root: Some(source_root.clone()),
            source_path: Some(source_root),
            install_source: "bundled".to_string(),
            record_fields: Map::new(),
            cleanup_roots: Vec::new(),
        });
    }
    plugin_install_source_from_npm_spec(&id, mode).or_else(|_| {
        Ok(PluginInstallSource {
            manifest: json!({
                "id": id,
                "name": id,
                "version": "0.0.0",
                "runtime": "rust-local"
            }),
            source_root: None,
            source_path: None,
            install_source: "generated".to_string(),
            record_fields: Map::new(),
            cleanup_roots: Vec::new(),
        })
    })
}

pub(super) fn resolve_plugin_install_id(
    params: &Value,
    manifest: &Value,
) -> Result<String, String> {
    let requested = string_param(params, &["pluginId", "id", "name"]);
    let manifest_id = manifest
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let raw = requested
        .clone()
        .or_else(|| manifest_id.clone())
        .ok_or_else(|| "plugins.install requires pluginId or manifest.id".to_string())?;
    let id = safe_plugin_id(&raw)?;
    if let (Some(requested), Some(manifest_id)) = (requested, manifest_id) {
        let requested = safe_plugin_id(&requested)?;
        let manifest_id = safe_plugin_id(&manifest_id)?;
        if requested != manifest_id {
            return Err(format!(
                "plugins.install pluginId \"{requested}\" does not match manifest id \"{manifest_id}\""
            ));
        }
    }
    Ok(id)
}

pub(super) fn resolve_plugin_manifest_id(manifest: &Value) -> Result<String, String> {
    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "plugin manifest requires id".to_string())?;
    safe_plugin_id(id)
}

pub(super) fn normalize_plugin_manifest(manifest: &mut Value, id: &str) -> Result<(), String> {
    let Some(object) = manifest.as_object_mut() else {
        return Err("plugins.install manifest must be an object".to_string());
    };
    object
        .entry("id".to_string())
        .or_insert_with(|| Value::String(id.to_string()));
    object
        .entry("name".to_string())
        .or_insert_with(|| Value::String(id.to_string()));
    object
        .entry("version".to_string())
        .or_insert_with(|| Value::String("0.0.0".to_string()));
    Ok(())
}

pub(super) fn plugin_install_record(
    source: &PluginInstallSource,
    install_path: &std::path::Path,
) -> Value {
    let mut record = source.record_fields.clone();
    record.insert(
        "source".to_string(),
        Value::String(source.install_source.to_string()),
    );
    if let Some(source_path) = &source.source_path {
        record.insert(
            "sourcePath".to_string(),
            Value::String(source_path.to_string_lossy().to_string()),
        );
    }
    record.insert(
        "installPath".to_string(),
        Value::String(install_path.to_string_lossy().to_string()),
    );
    if let Some(version) = plugin_manifest_version(&source.manifest) {
        record.insert("version".to_string(), Value::String(version));
    }
    record.insert(
        "installedAt".to_string(),
        Value::String(now_timestamp_string()),
    );
    Value::Object(record)
}

pub(super) fn merge_plugin_install_record(record: &mut Map<String, Value>, next: Value) {
    if let Some(next) = next.as_object() {
        for field in [
            "source",
            "spec",
            "sourcePath",
            "installPath",
            "version",
            "resolvedName",
            "resolvedVersion",
            "resolvedSpec",
            "integrity",
            "shasum",
            "resolvedAt",
            "installedAt",
            "marketplaceName",
            "marketplaceSource",
            "marketplacePlugin",
            "clawhubUrl",
            "clawhubPackage",
            "clawhubFamily",
            "clawhubChannel",
        ] {
            if let Some(value) = next.get(field) {
                record.insert(field.to_string(), value.clone());
            } else {
                record.remove(field);
            }
        }
    }
}

pub(super) fn resolve_plugin_update_targets(
    config: &Value,
    params: &Value,
) -> Result<Vec<String>, String> {
    if let Some(id) = string_param(params, &["id", "pluginId"]) {
        return Ok(vec![safe_plugin_id(&id)?]);
    }
    if bool_param(params, &["all"]).unwrap_or(false) {
        let ids = get_json_path(config, "plugins.installs")
            .and_then(Value::as_object)
            .map(|installs| installs.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        return Ok(ids);
    }
    Err("Provide a plugin id or set all=true.".to_string())
}

pub(super) fn plugin_manifest_path_from_source(
    source: &std::path::Path,
) -> Result<(PathBuf, PathBuf), String> {
    if source.is_dir() {
        let manifest_path = source.join("crawclaw.plugin.json");
        if manifest_path.exists() {
            return Ok((source.to_path_buf(), manifest_path));
        }
    }
    if source.is_file()
        && source
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name == "crawclaw.plugin.json")
            .unwrap_or(false)
    {
        let Some(parent) = source.parent() else {
            return Err(format!(
                "Plugin manifest {} has no parent directory.",
                source.display()
            ));
        };
        return Ok((parent.to_path_buf(), source.to_path_buf()));
    }
    Err(format!(
        "Rust plugins.install supports local plugin directories or crawclaw.plugin.json files; not found: {}",
        source.display()
    ))
}

pub(super) fn plugin_install_source_from_path(
    source: &std::path::Path,
    install_source: &str,
    source_path: Option<PathBuf>,
    cleanup_root: Option<PathBuf>,
) -> Result<PluginInstallSource, String> {
    if source.is_file() && resolve_archive_kind(source).is_some() {
        let extract = extract_plugin_archive(source)?;
        let root = resolve_extracted_plugin_root(&extract)?;
        let archive_install_source = if install_source == "path" {
            "archive"
        } else {
            install_source
        };
        let mut source = plugin_install_source_from_path(
            &root,
            archive_install_source,
            source_path.or_else(|| Some(source.to_path_buf())),
            Some(extract),
        )?;
        if let Some(cleanup_root) = cleanup_root {
            source.cleanup_roots.push(cleanup_root);
        }
        return Ok(source);
    }
    let (source_root, manifest_path) = match plugin_manifest_path_from_source(source) {
        Ok(value) => value,
        Err(_) => return plugin_install_source_from_package_dir(source),
    };
    Ok(PluginInstallSource {
        manifest: read_json_file(&manifest_path)?,
        source_root: Some(source_root),
        source_path,
        install_source: install_source.to_string(),
        record_fields: Map::new(),
        cleanup_roots: cleanup_root.into_iter().collect(),
    })
}

pub(super) fn plugin_install_source_from_package_dir(
    source: &std::path::Path,
) -> Result<PluginInstallSource, String> {
    if !source.is_dir() {
        return Err(format!(
            "plugin source is not a directory: {}",
            source.display()
        ));
    }
    let package_path = source.join("package.json");
    if !package_path.exists() {
        return Err(format!(
            "Rust plugins.install supports plugin directories, archives, npm specs, marketplace specs, or ClawHub specs; not found: {}",
            source.display()
        ));
    }
    Err(format!(
        "plugin package {} is missing crawclaw.plugin.json; native plugin packages must include crawclaw.plugin.json in the package root",
        source.display()
    ))
}

pub(super) fn plugin_install_source_from_npm_spec(
    spec: &str,
    _mode: &str,
) -> Result<PluginInstallSource, String> {
    let packed = pack_npm_spec_to_archive(spec)?;
    let mut source = plugin_install_source_from_path(
        &packed.archive_path,
        "npm",
        None,
        Some(packed.temp_root.clone()),
    )?;
    source
        .record_fields
        .insert("spec".to_string(), Value::String(spec.to_string()));
    if let Some(name) = packed.metadata.get("name").and_then(Value::as_str) {
        source
            .record_fields
            .insert("resolvedName".to_string(), Value::String(name.to_string()));
    }
    if let Some(version) = packed.metadata.get("version").and_then(Value::as_str) {
        source.record_fields.insert(
            "resolvedVersion".to_string(),
            Value::String(version.to_string()),
        );
    }
    if let Some(resolved_spec) = packed.metadata.get("resolvedSpec").and_then(Value::as_str) {
        source.record_fields.insert(
            "resolvedSpec".to_string(),
            Value::String(resolved_spec.to_string()),
        );
    }
    if let Some(integrity) = packed.metadata.get("integrity").and_then(Value::as_str) {
        source.record_fields.insert(
            "integrity".to_string(),
            Value::String(integrity.to_string()),
        );
    }
    if let Some(shasum) = packed.metadata.get("shasum").and_then(Value::as_str) {
        source
            .record_fields
            .insert("shasum".to_string(), Value::String(shasum.to_string()));
    }
    source.record_fields.insert(
        "resolvedAt".to_string(),
        Value::String(now_timestamp_string()),
    );
    Ok(source)
}

pub(super) fn plugin_install_source_from_clawhub(
    spec: &str,
) -> Result<PluginInstallSource, String> {
    let parsed = parse_clawhub_spec(spec)?;
    let base_url =
        env::var("CRAWCLAW_CLAWHUB_URL").unwrap_or_else(|_| "https://clawhub.ai".to_string());
    let version = parsed
        .version
        .clone()
        .unwrap_or_else(|| "latest".to_string());
    let tmp_root = create_plugin_temp_dir("crawclaw-clawhub-package")?;
    let archive_path = tmp_root.join(format!("{}.zip", safe_filename(&parsed.name)));
    let download_url = if version == "latest" {
        format!(
            "{}/api/v1/packages/{}/download",
            base_url.trim_end_matches('/'),
            percent_encode_path_segment(&parsed.name)
        )
    } else {
        format!(
            "{}/api/v1/packages/{}/download?version={}",
            base_url.trim_end_matches('/'),
            percent_encode_path_segment(&parsed.name),
            percent_encode_path_segment(&version)
        )
    };
    download_url_to_file(&download_url, &archive_path)?;
    let integrity = file_sha256_integrity(&archive_path)?;
    let mut source =
        plugin_install_source_from_path(&archive_path, "clawhub", None, Some(tmp_root.clone()))?;
    source
        .record_fields
        .insert("spec".to_string(), Value::String(spec.to_string()));
    source
        .record_fields
        .insert("integrity".to_string(), Value::String(integrity));
    source.record_fields.insert(
        "resolvedAt".to_string(),
        Value::String(now_timestamp_string()),
    );
    source.record_fields.insert(
        "clawhubUrl".to_string(),
        Value::String(base_url.trim_end_matches('/').to_string()),
    );
    source.record_fields.insert(
        "clawhubPackage".to_string(),
        Value::String(parsed.name.clone()),
    );
    source.record_fields.insert(
        "clawhubFamily".to_string(),
        Value::String("code-plugin".to_string()),
    );
    if let Some(version) = parsed.version {
        source
            .record_fields
            .insert("version".to_string(), Value::String(version));
    }
    Ok(source)
}

pub(super) fn plugin_install_source_from_marketplace(
    marketplace: &str,
    plugin: &str,
) -> Result<PluginInstallSource, String> {
    let loaded = load_marketplace(marketplace)?;
    let entries = loaded
        .manifest
        .get("plugins")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("invalid marketplace JSON at {marketplace}: missing plugins[]"))?;
    let entry = entries
        .iter()
        .find(|entry| entry.get("name").and_then(Value::as_str) == Some(plugin))
        .ok_or_else(|| format!("plugin \"{plugin}\" not found in marketplace {marketplace}"))?;
    let source_value = entry
        .get("source")
        .ok_or_else(|| format!("marketplace plugin \"{plugin}\" missing source"))?;
    let resolved = resolve_marketplace_plugin_source(source_value, &loaded.root_dir)?;
    let cleanup_root = resolved
        .cleanup_root
        .clone()
        .or_else(|| loaded.cleanup_root.clone());
    let mut source =
        plugin_install_source_from_path(&resolved.source_path, "marketplace", None, cleanup_root)?;
    source.record_fields.insert(
        "marketplaceSource".to_string(),
        Value::String(marketplace.to_string()),
    );
    source.record_fields.insert(
        "marketplacePlugin".to_string(),
        Value::String(plugin.to_string()),
    );
    if let Some(name) = loaded.manifest.get("name").and_then(Value::as_str) {
        source.record_fields.insert(
            "marketplaceName".to_string(),
            Value::String(name.to_string()),
        );
    }
    if let Some(version) = entry.get("version").and_then(Value::as_str) {
        source
            .record_fields
            .insert("version".to_string(), Value::String(version.to_string()));
    }
    Ok(source)
}

pub(super) fn bundled_plugin_manifest_path(id: &str) -> Option<(PathBuf, PathBuf)> {
    let repo_root = env::var_os("CRAWCLAW_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    let source_root = repo_root.join("extensions").join(id);
    let manifest_path = source_root.join("crawclaw.plugin.json");
    manifest_path
        .exists()
        .then_some((source_root, manifest_path))
}

#[derive(Debug)]
pub(super) struct PackedNpmArchive {
    archive_path: PathBuf,
    metadata: Value,
    temp_root: PathBuf,
}

#[derive(Debug)]
pub(super) struct ParsedClawHubSpec {
    name: String,
    version: Option<String>,
}

#[derive(Debug)]
pub(super) struct LoadedMarketplace {
    manifest: Value,
    root_dir: PathBuf,
    cleanup_root: Option<PathBuf>,
}

#[derive(Debug)]
pub(super) struct MarketplacePluginSource {
    source_path: PathBuf,
    cleanup_root: Option<PathBuf>,
}

pub(super) fn plugin_install_dir(state: &GatewayState, id: &str) -> PathBuf {
    state
        .runtime_root
        .join("plugins")
        .join(encode_plugin_install_dir_name(id))
}

pub(super) fn normalize_plugin_filesystem_path(state: &GatewayState, raw: &str) -> PathBuf {
    let path = expand_user_path(raw);
    if path.is_absolute() {
        path
    } else {
        state.runtime_root.join(path)
    }
}

pub(super) fn plugin_manifest_version(manifest: &Value) -> Option<String> {
    manifest
        .get("version")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

pub(super) fn safe_plugin_id(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('\\')
        || value.contains("..")
    {
        return Err("plugin id must be a safe local identifier".to_string());
    }
    if value.contains('.') {
        return Err("plugin id cannot contain dots".to_string());
    }
    let segments = value.split('/').collect::<Vec<_>>();
    match segments.as_slice() {
        [single] if !single.starts_with('@') && !single.is_empty() => Ok(value.to_string()),
        [scope, name]
            if scope.starts_with('@')
                && scope.len() > 1
                && !name.is_empty()
                && *name != "."
                && *name != ".." =>
        {
            Ok(value.to_string())
        }
        _ => Err("invalid plugin id: scoped ids must use @scope/name format".to_string()),
    }
}

pub(super) fn safe_filename(raw: &str) -> String {
    let mut result = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    if result.is_empty() || result == "." || result == ".." {
        result = "plugin".to_string();
    }
    result
}

pub(super) fn encode_plugin_install_dir_name(id: &str) -> String {
    if !id.contains('/') {
        return safe_filename(id);
    }
    let hash = Sha256::digest(id.as_bytes())
        .iter()
        .take(5)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("@{}-{hash}", safe_filename(&id.replace('/', "-")))
}

pub(super) fn install_plugin_source(
    source: &PluginInstallSource,
    plugin_dir: &Path,
    dry_run: bool,
) -> Result<PathBuf, String> {
    let manifest_path = plugin_dir.join("crawclaw.plugin.json");
    if dry_run {
        return Ok(manifest_path);
    }
    if let Some(source_root) = &source.source_root {
        if !same_filesystem_path(source_root, plugin_dir) {
            copy_plugin_directory(source_root, plugin_dir)?;
        } else {
            std::fs::create_dir_all(plugin_dir).map_err(|error| {
                format!(
                    "failed to create plugin directory {}: {error}",
                    plugin_dir.display()
                )
            })?;
        }
    } else {
        std::fs::create_dir_all(plugin_dir)
            .map_err(|error| format!("failed to create plugin directory: {error}"))?;
    }
    write_json_file(&manifest_path, &source.manifest)?;
    Ok(manifest_path)
}

pub(super) fn cleanup_plugin_temp_dir(source: &PluginInstallSource) {
    for path in &source.cleanup_roots {
        let _ = std::fs::remove_dir_all(path);
    }
}

pub(super) fn resolve_archive_kind(path: &Path) -> Option<&'static str> {
    let name = path.file_name()?.to_str()?.to_ascii_lowercase();
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        return Some("tgz");
    }
    if name.ends_with(".tar") {
        return Some("tar");
    }
    if name.ends_with(".zip") {
        return Some("zip");
    }
    None
}

pub(super) fn create_plugin_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let root = env::temp_dir().join(format!("{prefix}-{}", now_millis()));
    std::fs::create_dir_all(&root).map_err(|error| {
        format!(
            "failed to create temp directory {}: {error}",
            root.display()
        )
    })?;
    Ok(root)
}

pub(super) fn extract_plugin_archive(archive_path: &Path) -> Result<PathBuf, String> {
    let kind = resolve_archive_kind(archive_path)
        .ok_or_else(|| format!("unsupported archive: {}", archive_path.display()))?;
    let extract_root = create_plugin_temp_dir("crawclaw-plugin-archive")?;
    let mut command = if kind == "zip" {
        let mut command = Command::new("unzip");
        command
            .arg("-q")
            .arg(archive_path)
            .arg("-d")
            .arg(&extract_root);
        command
    } else {
        let mut command = Command::new("tar");
        if kind == "tgz" {
            command.arg("-xzf");
        } else {
            command.arg("-xf");
        }
        command.arg(archive_path).arg("-C").arg(&extract_root);
        command
    };
    let output = command
        .output()
        .map_err(|error| format!("failed to extract archive: {error}"))?;
    if output.status.success() {
        return Ok(extract_root);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let _ = std::fs::remove_dir_all(&extract_root);
    Err(format!(
        "failed to extract archive: {}",
        if stderr.is_empty() { stdout } else { stderr }
    ))
}

pub(super) fn has_plugin_root_marker(path: &Path) -> bool {
    path.join("package.json").exists()
        || path.join("crawclaw.plugin.json").exists()
        || path.join(".codex-plugin/plugin.json").exists()
        || path.join(".claude-plugin/plugin.json").exists()
        || path.join(".cursor-plugin/plugin.json").exists()
}

pub(super) fn resolve_extracted_plugin_root(extract_root: &Path) -> Result<PathBuf, String> {
    if has_plugin_root_marker(extract_root) {
        return Ok(extract_root.to_path_buf());
    }
    let mut candidates = Vec::new();
    for entry in std::fs::read_dir(extract_root)
        .map_err(|error| format!("failed to read extracted archive root: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to inspect extracted entry: {error}"))?;
        if entry
            .file_type()
            .map_err(|error| format!("failed to inspect extracted file type: {error}"))?
            .is_dir()
            && has_plugin_root_marker(&entry.path())
        {
            candidates.push(entry.path());
        }
    }
    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        0 => Err("archive did not contain a plugin package root".to_string()),
        _ => Err("archive contained multiple plugin package roots".to_string()),
    }
}

pub(super) fn run_command_capture(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
) -> Result<String, String> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let output = command
        .env("COREPACK_ENABLE_DOWNLOAD_PROMPT", "0")
        .env("NPM_CONFIG_IGNORE_SCRIPTS", "true")
        .output()
        .map_err(|error| format!("failed to run {program}: {error}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!(
        "{program} failed: {}",
        if stderr.is_empty() { stdout } else { stderr }
    ))
}

pub(super) fn parse_npm_pack_json_output(raw: &str) -> Option<(String, Value)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidates = if let Some(start) = trimmed.find('[') {
        vec![trimmed, &trimmed[start..]]
    } else {
        vec![trimmed]
    };
    for candidate in candidates {
        let parsed = serde_json::from_str::<Value>(candidate).ok()?;
        let entries = if let Some(array) = parsed.as_array() {
            array.clone()
        } else {
            vec![parsed]
        };
        for entry in entries.into_iter().rev() {
            let Some(filename) = entry.get("filename").and_then(Value::as_str) else {
                continue;
            };
            let name = entry.get("name").and_then(Value::as_str);
            let version = entry.get("version").and_then(Value::as_str);
            let resolved_spec = name
                .zip(version)
                .map(|(name, version)| format!("{name}@{version}"));
            let metadata = json!({
                "name": name,
                "version": version,
                "resolvedSpec": resolved_spec,
                "integrity": entry.get("integrity").and_then(Value::as_str),
                "shasum": entry.get("shasum").and_then(Value::as_str)
            });
            return Some((filename.to_string(), metadata));
        }
    }
    None
}

pub(super) fn pack_npm_spec_to_archive(spec: &str) -> Result<PackedNpmArchive, String> {
    let tmp_root = create_plugin_temp_dir("crawclaw-npm-pack")?;
    let stdout = match run_command_capture(
        "npm",
        &["pack", spec, "--ignore-scripts", "--json"],
        Some(&tmp_root),
    ) {
        Ok(stdout) => stdout,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&tmp_root);
            if error.contains("E404") || error.contains("not in this registry") {
                return Err(format!("Package not found on npm: {spec}."));
            }
            return Err(error);
        }
    };
    let (filename, metadata) = parse_npm_pack_json_output(&stdout)
        .ok_or_else(|| "npm pack produced no archive".to_string())?;
    let archive_path = if Path::new(&filename).is_absolute() {
        PathBuf::from(&filename)
    } else {
        tmp_root.join(&filename)
    };
    if !archive_path.exists() {
        let _ = std::fs::remove_dir_all(&tmp_root);
        return Err("npm pack produced no archive".to_string());
    }
    Ok(PackedNpmArchive {
        archive_path,
        metadata,
        temp_root: tmp_root,
    })
}

pub(super) fn parse_clawhub_spec(raw: &str) -> Result<ParsedClawHubSpec, String> {
    let spec = raw
        .trim()
        .strip_prefix("clawhub:")
        .ok_or_else(|| format!("invalid ClawHub plugin spec: {raw}"))?
        .trim();
    if spec.is_empty() {
        return Err(format!("invalid ClawHub plugin spec: {raw}"));
    }
    if let Some(index) = spec
        .rfind('@')
        .filter(|index| *index > 0 && *index < spec.len() - 1)
    {
        return Ok(ParsedClawHubSpec {
            name: spec[..index].trim().to_string(),
            version: Some(spec[index + 1..].trim().to_string()),
        });
    }
    Ok(ParsedClawHubSpec {
        name: spec.to_string(),
        version: None,
    })
}

pub(super) fn percent_encode_path_segment(raw: &str) -> String {
    raw.bytes()
        .flat_map(|byte| {
            let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
            if keep {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect::<Vec<_>>()
            }
        })
        .collect()
}

pub(super) fn download_url_to_file(url: &str, target: &Path) -> Result<(), String> {
    let output = Command::new("curl")
        .args(["-fsSL", url, "-o"])
        .arg(target)
        .output()
        .map_err(|error| format!("failed to run curl: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!("failed to download {url}: {stderr}"))
}

pub(super) fn file_sha256_integrity(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    Ok(format!(
        "sha256-{}",
        STANDARD.encode(Sha256::digest(&bytes))
    ))
}

pub(super) fn load_marketplace(source: &str) -> Result<LoadedMarketplace, String> {
    let path = expand_user_path(source);
    if path.exists() {
        return load_marketplace_from_path(&path, None);
    }
    let tmp_root = create_plugin_temp_dir("crawclaw-marketplace")?;
    let repo_dir = tmp_root.join("repo");
    let repo = if source.starts_with("http://")
        || source.starts_with("https://")
        || source.starts_with("git@")
        || source.starts_with("ssh://")
    {
        source.to_string()
    } else if source.split('/').count() == 2 {
        format!("https://github.com/{source}.git")
    } else {
        let _ = std::fs::remove_dir_all(&tmp_root);
        return Err(format!("unsupported marketplace source: {source}"));
    };
    if let Err(error) = run_command_capture(
        "git",
        &[
            "clone",
            "--depth",
            "1",
            &repo,
            repo_dir.to_string_lossy().as_ref(),
        ],
        None,
    ) {
        let _ = std::fs::remove_dir_all(&tmp_root);
        return Err(error);
    }
    load_marketplace_from_path(&repo_dir, Some(tmp_root))
}

pub(super) fn load_marketplace_from_path(
    path: &Path,
    cleanup_root: Option<PathBuf>,
) -> Result<LoadedMarketplace, String> {
    let root = if path.is_file() {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("marketplace manifest {} has no parent", path.display()))?
    } else if path.file_name().and_then(|name| name.to_str()) == Some(".claude-plugin") {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("marketplace path {} has no parent", path.display()))?
    } else {
        path.to_path_buf()
    };
    let manifest_path = if path.is_file() {
        path.to_path_buf()
    } else {
        [
            root.join(".claude-plugin/marketplace.json"),
            root.join("marketplace.json"),
        ]
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| format!("marketplace manifest not found under {}", root.display()))?
    };
    Ok(LoadedMarketplace {
        manifest: read_json_file(&manifest_path)?,
        root_dir: root,
        cleanup_root,
    })
}

pub(super) fn resolve_marketplace_plugin_source(
    raw: &Value,
    marketplace_root: &Path,
) -> Result<MarketplacePluginSource, String> {
    if let Some(source) = raw.as_str() {
        return resolve_marketplace_source_string(source, marketplace_root);
    }
    let Some(object) = raw.as_object() else {
        return Err("marketplace plugin source must be a string or object".to_string());
    };
    let kind = object
        .get("type")
        .or_else(|| object.get("source"))
        .and_then(Value::as_str)
        .unwrap_or("path");
    match kind {
        "path" => resolve_marketplace_source_string(
            object
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "path source missing path".to_string())?,
            marketplace_root,
        ),
        "url" => resolve_marketplace_source_string(
            object
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "url source missing url".to_string())?,
            marketplace_root,
        ),
        other => Err(format!(
            "unsupported marketplace plugin source kind: {other}"
        )),
    }
}

pub(super) fn resolve_marketplace_source_string(
    source: &str,
    marketplace_root: &Path,
) -> Result<MarketplacePluginSource, String> {
    if source.starts_with("http://") || source.starts_with("https://") {
        if resolve_archive_kind(Path::new(source)).is_none() {
            return Err(format!("unsupported remote plugin path source: {source}"));
        }
        let tmp_root = create_plugin_temp_dir("crawclaw-marketplace-download")?;
        let target = tmp_root.join(
            Path::new(source)
                .file_name()
                .and_then(|name| name.to_str())
                .map(safe_filename)
                .unwrap_or_else(|| "plugin.tgz".to_string()),
        );
        download_url_to_file(source, &target)?;
        return Ok(MarketplacePluginSource {
            source_path: target,
            cleanup_root: Some(tmp_root),
        });
    }
    let resolved = if Path::new(source).is_absolute() {
        PathBuf::from(source)
    } else {
        marketplace_root.join(source)
    };
    let canonical_source = resolved.canonicalize().map_err(|error| {
        format!(
            "failed to resolve marketplace source {}: {error}",
            resolved.display()
        )
    })?;
    if !Path::new(source).is_absolute() {
        let canonical_root = marketplace_root
            .canonicalize()
            .map_err(|error| format!("failed to resolve marketplace root: {error}"))?;
        if !canonical_source.starts_with(canonical_root) {
            return Err(format!("plugin source escapes marketplace root: {source}"));
        }
    }
    Ok(MarketplacePluginSource {
        source_path: canonical_source,
        cleanup_root: None,
    })
}

pub(super) fn plugin_update_source_params(
    state: &GatewayState,
    id: &str,
    record: &Value,
    params: &Value,
) -> Result<Value, String> {
    let source = record
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match source {
        "path" | "bundled" | "archive" => {
            let Some(source_path_raw) = record.get("sourcePath").and_then(Value::as_str) else {
                return Err(format!("Skipping \"{id}\" (missing sourcePath)."));
            };
            Ok(json!({
                "raw": normalize_plugin_filesystem_path(state, source_path_raw).to_string_lossy(),
                "pluginId": id
            }))
        }
        "npm" => {
            let spec = params
                .get("specOverrides")
                .and_then(|value| value.get(id))
                .and_then(Value::as_str)
                .or_else(|| record.get("spec").and_then(Value::as_str))
                .ok_or_else(|| format!("Skipping \"{id}\" (missing npm spec)."))?;
            Ok(json!({ "npmSpec": spec, "pluginId": id }))
        }
        "clawhub" => {
            let spec = record
                .get("spec")
                .and_then(Value::as_str)
                .or_else(|| record.get("clawhubPackage").and_then(Value::as_str))
                .map(|value| {
                    if value.starts_with("clawhub:") {
                        value.to_string()
                    } else {
                        format!("clawhub:{value}")
                    }
                })
                .ok_or_else(|| format!("Skipping \"{id}\" (missing ClawHub package metadata)."))?;
            Ok(json!({ "clawhubSpec": spec, "pluginId": id }))
        }
        "marketplace" => {
            let marketplace = record
                .get("marketplaceSource")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    format!("Skipping \"{id}\" (missing marketplace source metadata).")
                })?;
            let plugin = record
                .get("marketplacePlugin")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    format!("Skipping \"{id}\" (missing marketplace plugin metadata).")
                })?;
            Ok(json!({
                "marketplaceSource": marketplace,
                "marketplacePlugin": plugin,
                "pluginId": id
            }))
        }
        _ => Err(format!("Skipping \"{id}\" (source: {source}).")),
    }
}

pub(super) fn same_filesystem_path(left: &std::path::Path, right: &std::path::Path) -> bool {
    if left == right {
        return true;
    }
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

pub(super) fn copy_plugin_directory(
    source: &std::path::Path,
    target: &std::path::Path,
) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!(
            "plugin source is not a directory: {}",
            source.display()
        ));
    }
    if target.exists() {
        std::fs::remove_dir_all(target).map_err(|error| {
            format!(
                "failed to replace plugin directory {}: {error}",
                target.display()
            )
        })?;
    }
    std::fs::create_dir_all(target).map_err(|error| {
        format!(
            "failed to create plugin directory {}: {error}",
            target.display()
        )
    })?;
    copy_plugin_directory_contents(source, target)
}

pub(super) fn copy_plugin_directory_contents(
    source: &std::path::Path,
    target: &std::path::Path,
) -> Result<(), String> {
    for entry in std::fs::read_dir(source)
        .map_err(|error| format!("failed to read plugin source {}: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read plugin source entry: {error}"))?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".git" || name_str == "node_modules" {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect plugin source entry: {error}"))?;
        let target_path = target.join(&name);
        if file_type.is_dir() {
            std::fs::create_dir_all(&target_path).map_err(|error| {
                format!(
                    "failed to create plugin directory {}: {error}",
                    target_path.display()
                )
            })?;
            copy_plugin_directory_contents(&entry.path(), &target_path)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target_path).map_err(|error| {
                format!(
                    "failed to copy plugin file {}: {error}",
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}
