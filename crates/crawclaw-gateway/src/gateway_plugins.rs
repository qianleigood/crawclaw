use super::*;

pub(super) fn plugins_list(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let native_registry = crawclaw_runtime::native_plugin_registry(&state.runtime_root);
    let native_descriptors = native_registry.descriptors();
    let entry_ids = get_json_path(&config, "plugins.entries")
        .and_then(Value::as_object)
        .map(|entries| entries.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let install_ids = get_json_path(&config, "plugins.installs")
        .and_then(Value::as_object)
        .map(|installs| installs.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let plugin_ids = entry_ids
        .into_iter()
        .chain(install_ids)
        .chain(
            native_descriptors
                .iter()
                .map(|descriptor| descriptor.plugin_id.clone()),
        )
        .collect::<BTreeSet<_>>();
    let plugins = plugin_ids
        .into_iter()
        .map(|id| {
            let entry = get_json_path(&config, &format!("plugins.entries.{id}"));
            let install = get_json_path(&config, &format!("plugins.installs.{id}"));
            let native_descriptor = native_descriptors
                .iter()
                .find(|descriptor| descriptor.plugin_id == id)
                .and_then(|descriptor| serde_json::to_value(descriptor).ok());
            plugin_list_entry(state, &id, entry, install, native_descriptor)
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "workspaceDir": state.runtime_root.join("plugins").to_string_lossy(),
        "plugins": plugins,
        "diagnostics": native_registry.diagnostics
    }))
}

pub(super) fn plugin_list_entry(
    state: &GatewayState,
    id: &str,
    entry: Option<&Value>,
    install: Option<&Value>,
    native_descriptor: Option<Value>,
) -> Value {
    let install_path = install
        .and_then(|record| record.get("installPath").and_then(Value::as_str))
        .map(|value| normalize_plugin_filesystem_path(state, value))
        .unwrap_or_else(|| plugin_install_dir(state, id));
    let manifest_path = install_path.join("crawclaw.plugin.json");
    let manifest = if manifest_path.exists() {
        read_json_file(&manifest_path).ok()
    } else {
        None
    };
    let name = manifest
        .as_ref()
        .and_then(|manifest| manifest.get("name").and_then(Value::as_str))
        .or_else(|| {
            native_descriptor
                .as_ref()
                .and_then(|descriptor| descriptor.get("name").and_then(Value::as_str))
        })
        .unwrap_or(id);
    let version = manifest
        .as_ref()
        .and_then(plugin_manifest_version)
        .or_else(|| {
            install
                .and_then(|record| record.get("version").and_then(Value::as_str))
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            native_descriptor
                .as_ref()
                .and_then(|descriptor| descriptor.get("version").and_then(Value::as_str))
                .map(ToOwned::to_owned)
        });
    let enabled = entry
        .and_then(|entry| entry.get("enabled").and_then(Value::as_bool))
        .unwrap_or(native_descriptor.is_some());
    let config = entry
        .and_then(|entry| entry.get("config").cloned())
        .unwrap_or(Value::Null);
    let source_path = install.and_then(|record| record.get("sourcePath").and_then(Value::as_str));
    let mut snapshot = Map::new();
    snapshot.insert("id".to_string(), Value::String(id.to_string()));
    snapshot.insert("name".to_string(), Value::String(name.to_string()));
    snapshot.insert("enabled".to_string(), Value::Bool(enabled));
    snapshot.insert("configured".to_string(), Value::Bool(!config.is_null()));
    snapshot.insert("config".to_string(), config);
    snapshot.insert(
        "status".to_string(),
        Value::String(
            if install.is_some() {
                if manifest_path.exists() {
                    "installed"
                } else {
                    "missing"
                }
            } else if native_descriptor.is_some() {
                "available"
            } else {
                "configured"
            }
            .to_string(),
        ),
    );
    snapshot.insert(
        "origin".to_string(),
        Value::String(
            if install.is_some() {
                "local"
            } else if native_descriptor.is_some() {
                "bundled-native"
            } else {
                "config"
            }
            .to_string(),
        ),
    );
    snapshot.insert(
        "source".to_string(),
        Value::String(
            source_path
                .unwrap_or(if native_descriptor.is_some() {
                    "rust-native"
                } else {
                    "config"
                })
                .to_string(),
        ),
    );
    if let Some(version) = version {
        snapshot.insert("version".to_string(), Value::String(version));
    }
    if let Some(record) = install {
        snapshot.insert(
            "installSource".to_string(),
            Value::String(
                record
                    .get("source")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string(),
            ),
        );
        if let Some(source_path) = source_path {
            snapshot.insert(
                "sourcePath".to_string(),
                Value::String(source_path.to_string()),
            );
        }
        snapshot.insert(
            "installPath".to_string(),
            Value::String(install_path.to_string_lossy().to_string()),
        );
        snapshot.insert(
            "manifestPath".to_string(),
            Value::String(manifest_path.to_string_lossy().to_string()),
        );
    }
    if let Some(native_descriptor) = native_descriptor {
        snapshot.insert(
            "implementation".to_string(),
            Value::String("rust-native".to_string()),
        );
        snapshot.insert("nativeDescriptor".to_string(), native_descriptor);
    }
    Value::Object(snapshot)
}

pub(super) fn plugins_set_enabled(
    state: &GatewayState,
    params: Value,
    enabled: bool,
) -> Result<Value, String> {
    let id = required_param(&params, &["id", "pluginId"])?;
    if id.contains('.') {
        return Err("plugin id cannot contain dots".to_string());
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("plugins.entries.{id}.enabled"),
        Value::Bool(enabled),
    )?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "id": id,
        "enabled": enabled,
        "config": config
    }))
}

pub(super) fn plugins_install(state: &GatewayState, params: Value) -> Result<Value, String> {
    let mut source = plugin_install_source(state, &params, "install")?;
    let id = resolve_plugin_install_id(&params, &source.manifest)?;
    normalize_plugin_manifest(&mut source.manifest, &id)?;
    let link = bool_param(&params, &["link"]).unwrap_or(false);
    let plugin_dir = if link {
        source
            .source_root
            .clone()
            .ok_or_else(|| "plugins.install link requires a local plugin directory".to_string())?
    } else {
        plugin_install_dir(state, &id)
    };
    let manifest_path = if link {
        plugin_dir.join("crawclaw.plugin.json")
    } else {
        install_plugin_source(&source, &plugin_dir, false)?
    };

    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        &format!("plugins.entries.{id}.enabled"),
        Value::Bool(true),
    )?;
    delete_json_path(&mut config, &format!("plugins.entries.{id}.source"));
    if link {
        add_string_to_json_array(
            &mut config,
            "plugins.load.paths",
            &plugin_dir.to_string_lossy(),
        )?;
    }
    let mut install_record = plugin_install_record(&source, &plugin_dir);
    if bool_param(&params, &["pin"]).unwrap_or(false) && source.install_source == "npm" {
        if let Some(resolved_spec) = install_record
            .get("resolvedSpec")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
        {
            if let Some(record) = install_record.as_object_mut() {
                record.insert("spec".to_string(), Value::String(resolved_spec));
            }
        }
    }
    set_json_path(
        &mut config,
        &format!("plugins.installs.{id}"),
        install_record,
    )?;
    write_config_value(&path, &config)?;
    cleanup_plugin_temp_dir(&source);
    Ok(json!({
        "ok": true,
        "pluginId": id,
        "id": id,
        "installSource": source.install_source,
        "requiresRestart": true,
        "warnings": [],
        "manifestPath": manifest_path.to_string_lossy(),
        "manifest": source.manifest,
        "implementation": "rust-native"
    }))
}

pub(super) fn plugins_update(state: &GatewayState, params: Value) -> Result<Value, String> {
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let dry_run = bool_param(&params, &["dryRun", "dry_run"]).unwrap_or(false);
    let force = bool_param(&params, &["force"]).unwrap_or(false);
    let target_ids = resolve_plugin_update_targets(&config, &params)?;
    let mut changed = false;
    let mut outcomes = Vec::new();

    for id in target_ids {
        let Some(record) = get_json_path(&config, &format!("plugins.installs.{id}")).cloned()
        else {
            outcomes.push(json!({
                "pluginId": id,
                "status": "skipped",
                "message": format!("No install record for \"{id}\".")
            }));
            continue;
        };
        let source = record
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !matches!(
            source,
            "path" | "bundled" | "archive" | "npm" | "clawhub" | "marketplace"
        ) {
            outcomes.push(json!({
                "pluginId": id,
                "status": "skipped",
                "message": format!("Skipping \"{id}\" (source: {source}).")
            }));
            continue;
        }
        let install_path = record
            .get("installPath")
            .and_then(Value::as_str)
            .map(|value| normalize_plugin_filesystem_path(state, value))
            .unwrap_or_else(|| plugin_install_dir(state, &id));
        let source_params = match plugin_update_source_params(state, &id, &record, &params) {
            Ok(params) => params,
            Err(message) => {
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "skipped",
                    "message": message
                }));
                continue;
            }
        };
        let mut source = match plugin_install_source(state, &source_params, "update") {
            Ok(source) => source,
            Err(message) => {
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "error",
                    "message": message
                }));
                continue;
            }
        };
        normalize_plugin_manifest(&mut source.manifest, &id)?;
        if source.install_source == "npm" {
            let expected_integrity = record.get("integrity").and_then(Value::as_str).filter(|_| {
                record.get("spec").and_then(Value::as_str)
                    == source.record_fields.get("spec").and_then(Value::as_str)
            });
            let actual_integrity = source
                .record_fields
                .get("integrity")
                .and_then(Value::as_str);
            if expected_integrity.is_some()
                && actual_integrity.is_some()
                && expected_integrity != actual_integrity
                && !force
            {
                cleanup_plugin_temp_dir(&source);
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "error",
                    "message": format!(
                        "Integrity drift detected for \"{id}\"; pass force=true to update."
                    ),
                    "expectedIntegrity": expected_integrity,
                    "actualIntegrity": actual_integrity
                }));
                continue;
            }
        }
        let next_manifest = source.manifest.clone();
        let next_id = match resolve_plugin_manifest_id(&next_manifest) {
            Ok(next_id) => next_id,
            Err(message) => {
                cleanup_plugin_temp_dir(&source);
                outcomes.push(json!({
                    "pluginId": id,
                    "status": "error",
                    "message": message
                }));
                continue;
            }
        };
        if next_id != id {
            cleanup_plugin_temp_dir(&source);
            outcomes.push(json!({
                "pluginId": id,
                "status": "error",
                "message": format!("Source manifest id \"{next_id}\" does not match installed plugin \"{id}\".")
            }));
            continue;
        }

        let installed_manifest_path = install_path.join("crawclaw.plugin.json");
        let current_manifest = if installed_manifest_path.exists() {
            read_json_file(&installed_manifest_path).ok()
        } else {
            None
        };
        let current_version = current_manifest
            .as_ref()
            .and_then(plugin_manifest_version)
            .or_else(|| {
                record
                    .get("version")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            });
        let next_version = plugin_manifest_version(&next_manifest);
        let should_update = force || current_manifest.is_none() || current_version != next_version;

        if should_update && !dry_run {
            let mut next_record = record.as_object().cloned().unwrap_or_default();
            install_plugin_source(&source, &install_path, false)?;
            merge_plugin_install_record(
                &mut next_record,
                plugin_install_record(&source, &install_path),
            );
            set_json_path(
                &mut config,
                &format!("plugins.installs.{id}"),
                Value::Object(next_record),
            )?;
            changed = true;
        }

        outcomes.push(json!({
            "pluginId": id,
            "status": if should_update { "updated" } else { "unchanged" },
            "message": if should_update {
                format!("Updated \"{id}\" from local path.")
            } else {
                format!("\"{id}\" is already up to date.")
            },
            "currentVersion": current_version,
            "nextVersion": next_version
        }));
        cleanup_plugin_temp_dir(&source);
    }

    if changed && !dry_run {
        write_config_value(&path, &config)?;
    }
    Ok(json!({
        "ok": true,
        "changed": changed,
        "dryRun": dry_run,
        "requiresRestart": changed && !dry_run,
        "outcomes": outcomes,
        "implementation": "rust-native"
    }))
}

pub(super) fn plugins_uninstall(state: &GatewayState, params: Value) -> Result<Value, String> {
    let id = safe_plugin_id(&required_param(&params, &["id", "pluginId"])?)?;
    let keep_files = bool_param(&params, &["keepFiles", "keep_files"]).unwrap_or(false);
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let install_record = get_json_path(&config, &format!("plugins.installs.{id}")).cloned();
    let has_entry = get_json_path(&config, &format!("plugins.entries.{id}")).is_some();
    let has_install = install_record.is_some();
    let install_dir = plugin_install_dir(state, &id);

    if !has_entry && !has_install && !install_dir.exists() {
        return Err(format!("Plugin not found: {id}"));
    }

    let mut actions = Map::new();
    actions.insert(
        "entry".to_string(),
        Value::Bool(delete_json_path(
            &mut config,
            &format!("plugins.entries.{id}"),
        )),
    );
    actions.insert(
        "install".to_string(),
        Value::Bool(delete_json_path(
            &mut config,
            &format!("plugins.installs.{id}"),
        )),
    );
    actions.insert(
        "allowlist".to_string(),
        Value::Bool(remove_string_from_json_array(
            &mut config,
            "plugins.allow",
            &id,
        )),
    );
    let removed_load_path = install_record
        .as_ref()
        .and_then(|record| record.get("sourcePath").and_then(Value::as_str))
        .map(|source_path| {
            remove_string_from_json_array(&mut config, "plugins.load.paths", source_path)
        })
        .unwrap_or(false);
    actions.insert("loadPath".to_string(), Value::Bool(removed_load_path));
    let memory_slot = get_json_path(&config, "plugins.slots.memory")
        .and_then(Value::as_str)
        .map(|slot| slot == id)
        .unwrap_or(false);
    if memory_slot {
        set_json_path(
            &mut config,
            "plugins.slots.memory",
            Value::String("none".to_string()),
        )?;
    }
    actions.insert("memorySlot".to_string(), Value::Bool(memory_slot));
    actions.insert(
        "channelConfig".to_string(),
        Value::Bool(if has_install {
            delete_json_path(&mut config, &format!("channels.{id}"))
        } else {
            false
        }),
    );

    let mut warnings = Vec::new();
    let mut directory_removed = false;
    if !keep_files {
        if install_dir.exists() {
            match std::fs::remove_dir_all(&install_dir) {
                Ok(()) => directory_removed = true,
                Err(error) => warnings.push(format!(
                    "Failed to remove plugin directory {}: {error}",
                    install_dir.display()
                )),
            }
        }
    }
    actions.insert("directory".to_string(), Value::Bool(directory_removed));

    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "pluginId": id,
        "id": id,
        "requiresRestart": true,
        "warnings": warnings,
        "actions": Value::Object(actions),
        "implementation": "rust-native"
    }))
}
