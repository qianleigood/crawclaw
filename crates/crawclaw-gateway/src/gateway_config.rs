use super::*;

pub(super) fn config_path(state: &GatewayState) -> PathBuf {
    if let Some(value) = env::var_os("CRAWCLAW_CONFIG_PATH").filter(|value| !value.is_empty()) {
        return PathBuf::from(value);
    }
    state.state_dir.join("crawclaw.json")
}

pub(super) fn config_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let path = config_path(state);
    let exists = path.exists();
    let config = read_config_value(&path)?;
    if let Some(key) = string_param(&params, &["key", "path"]) {
        return Ok(json!({
            "exists": exists,
            "path": path.to_string_lossy(),
            "key": key,
            "value": get_json_path(&config, &key).cloned()
        }));
    }
    Ok(json!({
        "exists": exists,
        "path": path.to_string_lossy(),
        "config": config
    }))
}

pub(super) fn config_set(state: &GatewayState, params: Value) -> Result<Value, String> {
    let key = required_param(&params, &["key", "path"])?;
    let value = params.get("value").cloned().unwrap_or(Value::Null);
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(&mut config, &key, value)?;
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "config": config }))
}

pub(super) fn config_apply(state: &GatewayState, params: Value) -> Result<Value, String> {
    let config = params
        .get("config")
        .or_else(|| params.get("value"))
        .cloned()
        .unwrap_or(params);
    if !config.is_object() {
        return Err("config.apply requires an object config".to_string());
    }
    let path = config_path(state);
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "config": config }))
}

pub(super) fn config_patch(state: &GatewayState, params: Value) -> Result<Value, String> {
    let patch = if let Some(raw) = string_param(&params, &["raw"]) {
        serde_json::from_str::<Value>(&raw)
            .map_err(|error| format!("invalid config.patch raw JSON: {error}"))?
    } else {
        params.get("patch").cloned().unwrap_or(params)
    };
    if !patch.is_object() {
        return Err("config.patch requires an object patch".to_string());
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    merge_json(&mut config, patch);
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "path": path.to_string_lossy(), "config": config }))
}

pub(super) fn config_schema() -> Result<Value, String> {
    let mut payload = crawclaw_providers::provider_config_schema();
    let properties = payload
        .pointer_mut("/schema/properties")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "provider config schema is missing schema.properties".to_string())?;
    properties.insert(
        "gateway".to_string(),
        json!({
            "type": "object",
            "properties": {
                "port": { "type": "integer" },
                "bind": { "type": "string" }
            }
        }),
    );
    properties.insert(
        "tools".to_string(),
        json!({
            "type": "object",
            "properties": {
                "deny": { "type": "array", "items": { "type": "string" } }
            }
        }),
    );

    let ui_hints = payload
        .get_mut("uiHints")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "provider config schema is missing uiHints".to_string())?;
    ui_hints.insert("gateway".to_string(), json!({ "label": "Gateway" }));
    ui_hints.insert("gateway.port".to_string(), json!({ "label": "Port" }));
    ui_hints.insert("tools".to_string(), json!({ "label": "Tools" }));
    ui_hints.insert("tools.deny".to_string(), json!({ "label": "Deny" }));
    Ok(payload)
}

pub(super) fn config_schema_lookup(params: Value) -> Result<Value, String> {
    let path = string_param(&params, &["path"]).unwrap_or_default();
    let children = match path.as_str() {
        "" => vec![
            json!({ "key": "gateway", "path": "gateway", "label": "Gateway" }),
            json!({ "key": "tools", "path": "tools", "label": "Tools" }),
            json!({ "key": "models", "path": "models", "label": "Model Providers" }),
        ],
        "gateway" => vec![
            json!({ "key": "port", "path": "gateway.port", "label": "Port" }),
            json!({ "key": "bind", "path": "gateway.bind", "label": "Bind" }),
        ],
        "tools" => vec![json!({ "key": "deny", "path": "tools.deny", "label": "Deny" })],
        _ => {
            return Ok(crawclaw_providers::provider_config_schema_lookup(&path));
        }
    };
    Ok(json!({ "path": path, "children": children }))
}

pub(super) fn secrets_reload(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let mut refs = Vec::<(String, Value)>::new();
    collect_config_secret_refs(&config, "", &mut refs);
    let mut diagnostics = Vec::new();
    let mut inactive_ref_paths = Vec::new();
    for (path, value) in &refs {
        match resolve_secret_value(state, path, value) {
            Ok(Some(_)) => {}
            Ok(None) => inactive_ref_paths.push(path.clone()),
            Err(message) => {
                inactive_ref_paths.push(path.clone());
                diagnostics.push(message);
            }
        }
    }
    Ok(json!({
        "ok": true,
        "warningCount": diagnostics.len(),
        "checkedRefCount": refs.len(),
        "diagnostics": diagnostics,
        "inactiveRefPaths": inactive_ref_paths
    }))
}

pub(super) fn secrets_resolve(state: &GatewayState, params: Value) -> Result<Value, String> {
    let target_ids = params
        .get("targetIds")
        .and_then(Value::as_array)
        .ok_or_else(|| "secrets.resolve requires targetIds".to_string())?;
    let config = read_config_value(&config_path(state))?;
    let mut assignments = Vec::new();
    let mut diagnostics = Vec::new();
    let mut inactive_ref_paths = Vec::new();

    for target_id in target_ids {
        let Some(target_id) = target_id.as_str().filter(|value| !value.trim().is_empty()) else {
            return Err("secrets.resolve targetIds must be non-empty strings".to_string());
        };
        let path_segments = target_id
            .split('.')
            .filter(|segment| !segment.trim().is_empty())
            .collect::<Vec<_>>();
        if path_segments.is_empty() {
            return Err("secrets.resolve targetId cannot be empty".to_string());
        }
        let Some(value) = get_json_path(&config, target_id) else {
            inactive_ref_paths.push(target_id.to_string());
            diagnostics.push(format!("No configured secret value found at {target_id}."));
            continue;
        };

        match resolve_secret_value(state, target_id, value) {
            Ok(Some(secret_value)) => assignments.push(json!({
                "path": target_id,
                "pathSegments": path_segments,
                "value": secret_value
            })),
            Ok(None) => {
                inactive_ref_paths.push(target_id.to_string());
            }
            Err(message) => {
                inactive_ref_paths.push(target_id.to_string());
                diagnostics.push(message);
            }
        }
    }

    Ok(json!({
        "ok": true,
        "assignments": assignments,
        "diagnostics": diagnostics,
        "inactiveRefPaths": inactive_ref_paths
    }))
}

pub(super) fn collect_config_secret_refs(
    value: &Value,
    path: &str,
    refs: &mut Vec<(String, Value)>,
) {
    match value {
        Value::Object(object) => {
            if is_secret_ref_object(object) {
                refs.push((path.to_string(), value.clone()));
                return;
            }
            for (key, child) in object {
                let child_path = if path.is_empty() {
                    key.to_string()
                } else {
                    format!("{path}.{key}")
                };
                collect_config_secret_refs(child, &child_path, refs);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                let child_path = if path.is_empty() {
                    format!("[{index}]")
                } else {
                    format!("{path}[{index}]")
                };
                collect_config_secret_refs(child, &child_path, refs);
            }
        }
        _ => {}
    }
}

pub(super) fn is_secret_ref_object(object: &Map<String, Value>) -> bool {
    let source = object
        .get("source")
        .or_else(|| object.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    matches!(source, "env" | "file" | "exec")
        && object
            .get("id")
            .or_else(|| object.get("name"))
            .or_else(|| object.get("path"))
            .and_then(Value::as_str)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
}

pub(super) fn resolve_secret_value(
    state: &GatewayState,
    target_id: &str,
    value: &Value,
) -> Result<Option<Value>, String> {
    if let Some(raw) = value.as_str() {
        return Ok(Some(Value::String(raw.to_string())));
    }
    let Some(object) = value.as_object() else {
        return Ok(Some(value.clone()));
    };
    let source = object
        .get("source")
        .or_else(|| object.get("type"))
        .or_else(|| object.get("provider"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = object
        .get("id")
        .or_else(|| object.get("name"))
        .or_else(|| object.get("path"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    match source {
        "env" => match env::var(id) {
            Ok(secret) => Ok(Some(Value::String(secret))),
            Err(_) => Err(format!(
                "Environment variable {id} for {target_id} is not set."
            )),
        },
        "file" => {
            let path = expand_user_path(id);
            let path = if path.is_absolute() {
                path
            } else {
                state.state_dir.join(path)
            };
            match std::fs::read_to_string(&path) {
                Ok(secret) => Ok(Some(Value::String(secret.trim_end().to_string()))),
                Err(error) => Err(format!(
                    "Failed to read file secret {} for {target_id}: {error}",
                    path.display()
                )),
            }
        }
        "exec" => Err(format!(
            "Exec SecretRef resolution for {target_id} is not enabled in the Rust Gateway."
        )),
        "" => Ok(Some(value.clone())),
        other => Err(format!(
            "Unsupported SecretRef source {other} for {target_id}."
        )),
    }
}
