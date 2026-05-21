use super::*;

pub(super) fn approvals_snapshot(state: &GatewayState, kind: &str) -> Result<Value, String> {
    let path = approvals_file_path(state, kind);
    let Some((raw, file)) = read_approvals_file(&path)? else {
        return Ok(json!({
            "path": path.to_string_lossy(),
            "exists": false,
            "hash": stable_text_hash(""),
            "file": default_approvals_file()
        }));
    };
    Ok(json!({
        "path": path.to_string_lossy(),
        "exists": true,
        "hash": stable_text_hash(&raw),
        "file": redact_approvals_file(file)
    }))
}

pub(super) fn approvals_set(
    state: &GatewayState,
    params: Value,
    kind: &str,
) -> Result<Value, String> {
    let path = approvals_file_path(state, kind);
    let current = read_approvals_file(&path)?;
    if let Some((raw, _)) = current.as_ref() {
        let base_hash = string_param(&params, &["baseHash", "base_hash", "hash"])
            .ok_or_else(|| format!("{kind} approvals base hash required; re-run get and retry"))?;
        if base_hash != stable_text_hash(raw) {
            return Err(format!(
                "{kind} approvals changed since last load; re-run get and retry"
            ));
        }
    }
    let mut file = params
        .get("file")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| format!("{kind} approvals file is required"))?;
    normalize_approvals_file(&mut file);
    preserve_approval_socket_token(current.as_ref().map(|(_, file)| file), &mut file);
    write_json_file(&path, &file)?;
    approvals_snapshot(state, kind)
}

pub(super) fn approvals_file_path(state: &GatewayState, kind: &str) -> PathBuf {
    state.state_dir.join(format!("{kind}-approvals.json"))
}

pub(super) fn read_approvals_file(path: &Path) -> Result<Option<(String, Value)>, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "failed to read approvals file {}: {error}",
                path.display()
            ));
        }
    };
    let file = serde_json::from_str(&raw)
        .map_err(|error| format!("invalid approvals file {}: {error}", path.display()))?;
    Ok(Some((raw, file)))
}

pub(super) fn default_approvals_file() -> Value {
    json!({
        "version": 1,
        "defaults": {},
        "agents": {}
    })
}

pub(super) fn normalize_approvals_file(file: &mut Value) {
    if file.get("version").is_none() {
        file["version"] = json!(1);
    }
    if !file.get("defaults").map(Value::is_object).unwrap_or(false) {
        file["defaults"] = json!({});
    }
    if !file.get("agents").map(Value::is_object).unwrap_or(false) {
        file["agents"] = json!({});
    }
}

pub(super) fn preserve_approval_socket_token(current: Option<&Value>, next: &mut Value) {
    let Some(current_token) = current
        .and_then(|file| file.get("socket"))
        .and_then(|socket| socket.get("token"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    else {
        return;
    };
    let Some(next_socket) = next.get_mut("socket").and_then(Value::as_object_mut) else {
        return;
    };
    if next_socket
        .get("token")
        .and_then(Value::as_str)
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        next_socket.insert(
            "token".to_string(),
            Value::String(current_token.to_string()),
        );
    }
}

pub(super) fn redact_approvals_file(mut file: Value) -> Value {
    if let Some(socket) = file.get_mut("socket").and_then(Value::as_object_mut) {
        socket.remove("token");
        if socket
            .get("path")
            .and_then(Value::as_str)
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
        {
            file.as_object_mut().map(|object| object.remove("socket"));
        }
    }
    file
}

pub(super) fn stable_text_hash(raw: &str) -> String {
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}

pub(super) fn approval_request(
    state: &GatewayState,
    params: Value,
    kind: &str,
) -> Result<Value, String> {
    validate_approval_request(&params, kind)?;
    let id = approval_request_id(&params, kind);
    let now = now_millis() as u64;
    let timeout_ms = params
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(1_800_000)
        .max(1);
    let created_at_ms = now;
    let expires_at_ms = now.saturating_add(timeout_ms);
    let record = ApprovalRecord {
        id: id.clone(),
        kind: kind.to_string(),
        request: params.clone(),
        created_at_ms,
        expires_at_ms,
        decision: None,
        resolved_by: None,
        resolved_at_ms: None,
    };
    {
        let mut approvals = state
            .approvals
            .lock()
            .map_err(|_| "approval store lock poisoned".to_string())?;
        if approvals.contains_key(&id) {
            return Err("approval id already pending".to_string());
        }
        approvals.insert(id.clone(), record);
    }
    let event = json!({
        "id": id,
        "request": params,
        "createdAtMs": created_at_ms,
        "expiresAtMs": expires_at_ms
    });
    emit(state, &format!("{kind}.requested"), event);
    if bool_param(&params, &["twoPhase"]).unwrap_or(false) {
        return Ok(json!({
            "status": "accepted",
            "id": id,
            "createdAtMs": created_at_ms,
            "expiresAtMs": expires_at_ms
        }));
    }
    Ok(json!({
        "id": id,
        "decision": Value::Null,
        "createdAtMs": created_at_ms,
        "expiresAtMs": expires_at_ms
    }))
}

pub(super) fn approval_wait_decision(state: &GatewayState, params: Value) -> Result<Value, String> {
    let id = required_param(&params, &["id"])?;
    let approvals = state
        .approvals
        .lock()
        .map_err(|_| "approval store lock poisoned".to_string())?;
    let Some(record) = approvals.get(&id) else {
        return Err("approval expired or not found".to_string());
    };
    Ok(approval_wait_response(record))
}

pub(super) fn approval_resolve(
    state: &GatewayState,
    params: Value,
    kind: &str,
) -> Result<Value, String> {
    let raw_id = required_param(&params, &["id"])?;
    let decision = required_param(&params, &["decision"])?;
    if !["allow-once", "allow-always", "deny"].contains(&decision.as_str()) {
        return Err("invalid decision".to_string());
    }
    let resolved_by = string_param(&params, &["resolvedBy"]);
    let now = now_millis() as u64;
    let (id, event) = {
        let mut approvals = state
            .approvals
            .lock()
            .map_err(|_| "approval store lock poisoned".to_string())?;
        let id = resolve_pending_approval_id(&approvals, &raw_id, kind)?;
        let record = approvals
            .get_mut(&id)
            .ok_or_else(|| "unknown or expired approval id".to_string())?;
        if record.decision.is_some() {
            return Err("unknown or expired approval id".to_string());
        }
        record.decision = Some(decision.clone());
        record.resolved_by = resolved_by.clone();
        record.resolved_at_ms = Some(now);
        let event = json!({
            "id": id,
            "decision": decision,
            "resolvedBy": resolved_by,
            "ts": now,
            "request": record.request
        });
        (record.id.clone(), event)
    };
    emit(state, &format!("{kind}.resolved"), event);
    Ok(json!({ "ok": true, "id": id }))
}

pub(super) fn validate_approval_request(params: &Value, kind: &str) -> Result<(), String> {
    if kind == "exec.approval" && string_param(params, &["command"]).is_none() {
        return Err("command is required".to_string());
    }
    if kind == "plugin.approval" {
        if string_param(params, &["title"]).is_none() {
            return Err("title is required".to_string());
        }
        if string_param(params, &["description"]).is_none() {
            return Err("description is required".to_string());
        }
    }
    Ok(())
}

pub(super) fn approval_request_id(params: &Value, kind: &str) -> String {
    if kind == "plugin.approval" {
        return format!("plugin:rust-{}", now_millis());
    }
    string_param(params, &["id"]).unwrap_or_else(|| format!("approval-{}", now_millis()))
}

pub(super) fn resolve_pending_approval_id(
    approvals: &BTreeMap<String, ApprovalRecord>,
    raw_id: &str,
    kind: &str,
) -> Result<String, String> {
    let raw_id = raw_id.trim();
    if approvals
        .get(raw_id)
        .map(|record| record.kind == kind && record.decision.is_none())
        .unwrap_or(false)
    {
        return Ok(raw_id.to_string());
    }
    let matches = approvals
        .values()
        .filter(|record| record.kind == kind && record.decision.is_none())
        .filter(|record| record.id.starts_with(raw_id))
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [id] => Ok(id.clone()),
        [] => Err("unknown or expired approval id".to_string()),
        _ => Err(format!(
            "ambiguous approval id prefix; matches: {}. Use the full id.",
            matches.into_iter().take(3).collect::<Vec<_>>().join(", ")
        )),
    }
}

pub(super) fn approval_wait_response(record: &ApprovalRecord) -> Value {
    json!({
        "id": record.id,
        "decision": record
            .decision
            .as_ref()
            .map(|decision| Value::String(decision.clone()))
            .unwrap_or(Value::Null),
        "createdAtMs": record.created_at_ms,
        "expiresAtMs": record.expires_at_ms,
        "resolvedBy": record.resolved_by,
        "resolvedAtMs": record.resolved_at_ms,
        "request": record.request
    })
}
