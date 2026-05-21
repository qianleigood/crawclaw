use super::*;

pub(super) fn channels_status(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let runtime_state = read_channel_runtime_state(state)?;
    let channel_ids = native_channel_catalog_ids(&config, &runtime_state);
    let mut labels = Map::new();
    let mut detail_labels = Map::new();
    let mut channels = Map::new();
    let mut accounts = Map::new();
    let mut defaults = Map::new();
    let mut controls = Map::new();

    for channel_id in &channel_ids {
        let descriptor = find_native_channel_descriptor(channel_id);
        let label = descriptor
            .map(|descriptor| descriptor.label.clone())
            .unwrap_or_else(|| channel_label(channel_id));
        labels.insert(channel_id.clone(), Value::String(label.clone()));
        detail_labels.insert(
            channel_id.clone(),
            Value::String(format!("{label} channel")),
        );
        let channel_config = get_json_path(&config, &format!("channels.{channel_id}"))
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let enabled = channel_config
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let configured = channel_config
            .as_object()
            .is_some_and(|object| !object.is_empty());
        let default_account_id = channel_runtime_default_account(&runtime_state, channel_id)
            .unwrap_or_else(|| "default".to_string());
        defaults.insert(
            channel_id.clone(),
            Value::String(default_account_id.clone()),
        );
        let account_runtime =
            channel_runtime_account(&runtime_state, channel_id, &default_account_id);
        let linked = account_runtime
            .and_then(|account| account.get("linked"))
            .and_then(Value::as_bool)
            .unwrap_or(configured);
        let running = account_runtime
            .and_then(|account| account.get("running"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let connected = account_runtime
            .and_then(|account| account.get("connected"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let health_state = account_runtime
            .and_then(|account| account.get("healthState"))
            .and_then(Value::as_str)
            .unwrap_or(if configured {
                "stopped"
            } else {
                "unconfigured"
            });
        channels.insert(
            channel_id.clone(),
            with_native_channel_descriptor(
                json!({
                "enabled": enabled,
                "configured": configured,
                "running": running,
                "connected": connected,
                "healthState": health_state,
                "implementation": if descriptor.is_some() { "rust-native" } else { "external" }
                }),
                descriptor,
            ),
        );
        accounts.insert(
            channel_id.clone(),
            json!([{
                "accountId": default_account_id,
                "enabled": enabled,
                "configured": configured,
                "linked": linked,
                "running": running,
                "connected": connected,
                "healthState": health_state
            }]),
        );
        controls.insert(
            channel_id.clone(),
            with_native_channel_descriptor(
                json!({
                "loginMode": if is_local_delivery_channel(channel_id) { "native" } else if configured { "transport" } else { "none" },
                "actions": if is_local_delivery_channel(channel_id) || linked { json!(["verify", "reconnect", "logout"]) } else { json!([]) },
                "canReconnect": is_local_delivery_channel(channel_id) || linked,
                "canVerify": is_local_delivery_channel(channel_id) || linked,
                "canLogout": linked,
                "canEdit": true,
                "canSetup": true,
                "multiAccount": false
                }),
                descriptor,
            ),
        );
    }

    Ok(json!({
        "ts": now_millis(),
        "channelOrder": channel_ids,
        "channelLabels": labels,
        "channelDetailLabels": detail_labels,
        "channels": channels,
        "channelControls": controls,
        "channelAccounts": accounts,
        "channelDefaultAccountId": defaults
    }))
}

pub(super) fn channels_capabilities(params: Value) -> Result<Value, String> {
    let requested = string_param(&params, &["channel"]).map(|value| value.trim().to_lowercase());
    let descriptors = list_native_channel_descriptors()
        .iter()
        .filter(|descriptor| {
            requested
                .as_deref()
                .is_none_or(|channel| channel == "all" || descriptor.channel == channel)
        })
        .map(|descriptor| serde_json::to_value(descriptor).unwrap_or(Value::Null))
        .collect::<Vec<_>>();
    if requested
        .as_deref()
        .is_some_and(|channel| channel != "all" && descriptors.is_empty())
    {
        return Err(format!(
            "unknown native channel: {}",
            requested.unwrap_or_default()
        ));
    }
    Ok(json!({
        "version": channel_contract_version(),
        "channels": descriptors
    }))
}

pub(super) fn native_channel_catalog_ids(config: &Value, runtime_state: &Value) -> Vec<String> {
    let mut ids = list_native_channel_descriptors()
        .iter()
        .map(|descriptor| descriptor.channel.clone())
        .collect::<Vec<_>>();
    let mut extras = configured_channel_ids(config);
    extras.extend(channel_runtime_channel_ids(runtime_state));
    extras.sort();
    extras.dedup();
    for id in extras {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

pub(super) fn with_native_channel_descriptor(
    mut value: Value,
    descriptor: Option<&ChannelCapabilityDescriptor>,
) -> Value {
    let Some(descriptor) = descriptor else {
        return value;
    };
    let object = ensure_json_object(&mut value);
    object.insert(
        "nativeAdapterId".to_string(),
        Value::String(descriptor.rust_adapter_id.clone()),
    );
    object.insert(
        "capabilities".to_string(),
        serde_json::to_value(descriptor).unwrap_or(Value::Null),
    );
    value
}

pub(super) fn configured_channel_ids(config: &Value) -> Vec<String> {
    let mut ids = get_json_path(config, "channels")
        .and_then(Value::as_object)
        .map(|channels| channels.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    ids.sort();
    ids
}

pub(super) struct ChannelRuntimeUpdate<'a> {
    enabled: bool,
    configured: bool,
    linked: bool,
    running: bool,
    connected: bool,
    health_state: &'a str,
    last_action: &'a str,
}

pub(super) fn channel_runtime_state_path(state: &GatewayState) -> PathBuf {
    state
        .runtime_root
        .join("channels")
        .join("runtime-state.json")
}

pub(super) fn read_channel_runtime_state(state: &GatewayState) -> Result<Value, String> {
    read_config_value(&channel_runtime_state_path(state))
}

pub(super) fn channel_runtime_channel_ids(runtime_state: &Value) -> Vec<String> {
    runtime_state
        .get("channels")
        .and_then(Value::as_object)
        .map(|channels| channels.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default()
}

pub(super) fn channel_runtime_default_account(
    runtime_state: &Value,
    channel: &str,
) -> Option<String> {
    runtime_state
        .get("channels")?
        .get(channel)?
        .get("defaultAccountId")?
        .as_str()
        .map(ToOwned::to_owned)
}

pub(super) fn channel_runtime_account<'a>(
    runtime_state: &'a Value,
    channel: &str,
    account_id: &str,
) -> Option<&'a Value> {
    runtime_state
        .get("channels")?
        .get(channel)?
        .get("accounts")?
        .get(account_id)
}

pub(super) fn channel_is_configured(config: &Value, channel: &str) -> bool {
    get_json_path(config, &format!("channels.{channel}"))
        .and_then(Value::as_object)
        .is_some_and(|object| !object.is_empty())
}

pub(super) fn channel_is_enabled(config: &Value, channel: &str) -> bool {
    get_json_path(config, &format!("channels.{channel}"))
        .and_then(|channel| channel.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(super) fn is_local_delivery_channel(channel: &str) -> bool {
    is_local_native_delivery_channel(channel)
}

pub(super) fn upsert_channel_runtime_account(
    state: &GatewayState,
    channel: &str,
    account_id: &str,
    update: ChannelRuntimeUpdate<'_>,
) -> Result<Value, String> {
    let mut runtime_state = read_channel_runtime_state(state)?;
    let updated_at_ms = now_millis();
    let entry = json!({
        "channel": channel,
        "accountId": account_id,
        "enabled": update.enabled,
        "configured": update.configured,
        "linked": update.linked,
        "running": update.running,
        "connected": update.connected,
        "healthState": update.health_state,
        "lastAction": update.last_action,
        "transport": if is_local_delivery_channel(channel) { "local" } else { "external" },
        "updatedAtMs": updated_at_ms,
        "implementation": "rust-native"
    });

    let root = ensure_json_object(&mut runtime_state);
    let channels_value = root
        .entry("channels".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let channels = ensure_json_object(channels_value);
    let channel_value = channels
        .entry(channel.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let channel_object = ensure_json_object(channel_value);
    channel_object.insert("channel".to_string(), Value::String(channel.to_string()));
    channel_object.insert(
        "defaultAccountId".to_string(),
        Value::String(account_id.to_string()),
    );
    channel_object.insert("running".to_string(), Value::Bool(update.running));
    channel_object.insert("connected".to_string(), Value::Bool(update.connected));
    channel_object.insert(
        "healthState".to_string(),
        Value::String(update.health_state.to_string()),
    );
    channel_object.insert("updatedAtMs".to_string(), json!(updated_at_ms));
    let accounts_value = channel_object
        .entry("accounts".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    ensure_json_object(accounts_value).insert(account_id.to_string(), entry.clone());

    write_json_file(&channel_runtime_state_path(state), &runtime_state)?;
    Ok(entry)
}

pub(super) fn channel_label(channel_id: &str) -> String {
    channel_id
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn channels_setup_surface(state: &GatewayState, params: Value) -> Result<Value, String> {
    let channel = required_param(&params, &["channel"])?;
    let config = read_config_value(&config_path(state))?;
    let configured = get_json_path(&config, &format!("channels.{channel}"))
        .and_then(Value::as_object)
        .is_some_and(|object| !object.is_empty());
    let descriptor = find_native_channel_descriptor(&channel);
    let label = descriptor
        .map(|descriptor| descriptor.label.clone())
        .unwrap_or_else(|| channel_label(&channel));
    Ok(json!({
        "channel": channel,
        "label": label,
        "detailLabel": format!("{label} channel"),
        "configured": configured,
        "mode": "config",
        "statusLines": [],
        "accountIds": ["default"],
        "defaultAccountId": "default",
        "canSetup": true,
        "canEdit": true,
        "multiAccount": false,
        "loginMode": "none",
        "commands": [],
        "nativeAdapterId": descriptor.map(|descriptor| descriptor.rust_adapter_id.clone()),
        "capabilities": descriptor.and_then(|descriptor| serde_json::to_value(descriptor).ok())
    }))
}

pub(super) fn channels_config_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    if let Some(channel) = string_param(&params, &["channel"]) {
        return Ok(json!({
            "channel": channel,
            "config": get_json_path(&config, &format!("channels.{channel}")).cloned().unwrap_or(Value::Null)
        }));
    }
    Ok(json!({
        "config": get_json_path(&config, "channels").cloned().unwrap_or_else(|| Value::Object(Map::new()))
    }))
}

pub(super) fn channels_config_schema() -> Value {
    json!({
        "schema": {
            "type": "object",
            "additionalProperties": true
        },
        "uiHints": {},
        "version": "rust-channels-config-v1"
    })
}

pub(super) fn channels_config_patch(state: &GatewayState, params: Value) -> Result<Value, String> {
    let channel = required_param(&params, &["channel"])?;
    let patch = config_patch_value(&params)?;
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let target_path = format!("channels.{channel}");
    let mut current = get_json_path(&config, &target_path)
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    merge_json(&mut current, patch);
    set_json_path(&mut config, &target_path, current.clone())?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "channel": channel,
        "config": current
    }))
}

pub(super) fn channels_config_apply(state: &GatewayState, params: Value) -> Result<Value, String> {
    let channel = required_param(&params, &["channel"])?;
    let next = config_patch_value(&params)?;
    if !next.is_object() {
        return Err("channels.config.apply requires an object config".to_string());
    }
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(&mut config, &format!("channels.{channel}"), next.clone())?;
    write_config_value(&path, &config)?;
    Ok(json!({
        "ok": true,
        "channel": channel,
        "config": next
    }))
}

pub(super) fn config_patch_value(params: &Value) -> Result<Value, String> {
    if let Some(raw) = string_param(params, &["raw"]) {
        serde_json::from_str::<Value>(&raw).map_err(|error| format!("invalid raw JSON: {error}"))
    } else {
        Ok(params
            .get("patch")
            .or_else(|| params.get("config"))
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new())))
    }
}

pub(super) fn channel_action(
    state: &GatewayState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let channel = safe_config_component_id(
        &string_param(&params, &["channel"]).unwrap_or_else(|| "web".to_string()),
        "channel",
    )?;
    let account_id = safe_runtime_component_id(
        &string_param(&params, &["accountId"]).unwrap_or_else(|| "default".to_string()),
        "account id",
    )?;
    let config = read_config_value(&config_path(state))?;
    let configured = channel_is_configured(&config, &channel);
    let enabled = channel_is_enabled(&config, &channel);
    let runtime_state = read_channel_runtime_state(state)?;
    let current = channel_runtime_account(&runtime_state, &channel, &account_id);
    let current_connected = current
        .and_then(|account| account.get("connected"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let current_linked = current
        .and_then(|account| account.get("linked"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let lifecycle = resolve_native_channel_lifecycle_update(NativeChannelLifecycleInput {
        channel: channel.clone(),
        method: method.to_string(),
        enabled,
        configured,
        current_linked,
        current_connected,
    });
    let entry = upsert_channel_runtime_account(
        state,
        &channel,
        &account_id,
        ChannelRuntimeUpdate {
            enabled: lifecycle.enabled,
            configured: lifecycle.configured,
            linked: lifecycle.linked,
            running: lifecycle.running,
            connected: lifecycle.connected,
            health_state: lifecycle.health_state.as_str(),
            last_action: method,
        },
    )?;
    let connected = entry
        .get("connected")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let linked = entry
        .get("linked")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    emit(state, "channel.lifecycle", entry.clone());
    Ok(json!({
        "ok": connected || linked || method.ends_with(".logout") || method == "channels.logout",
        "method": method,
        "channel": channel,
        "accountId": account_id,
        "linked": linked,
        "running": entry.get("running").cloned().unwrap_or(Value::Bool(false)),
        "connected": connected,
        "healthState": entry.get("healthState").cloned().unwrap_or_else(|| Value::String("unknown".to_string())),
        "snapshot": channels_status(state)?
    }))
}

pub(super) fn channel_lifecycle_status(state: &GatewayState) -> Result<Value, String> {
    Ok(json!({
        "ok": true,
        "implementation": "rust-native",
        "snapshot": channels_status(state)?
    }))
}

pub(super) fn channel_lifecycle_action(
    state: &GatewayState,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let legacy_method = match method {
        "channel.lifecycle.start" => "channels.account.login.start",
        "channel.lifecycle.stop" => "channels.logout",
        "channel.lifecycle.restart" => "channels.account.reconnect",
        _ => method,
    };
    channel_action(state, legacy_method, params)
}

pub(super) fn channel_directory_lookup(params: Value) -> Result<Value, String> {
    let request = serde_json::from_value::<ChannelDirectoryLookupRequest>(params)
        .map_err(|error| format!("invalid channel.directory.lookup request: {error}"))?;
    let result = lookup_native_channel_directory(request)?;
    serde_json::to_value(result)
        .map_err(|error| format!("failed to serialize channel directory lookup: {error}"))
}

pub(super) fn channel_send(state: &GatewayState, params: Value) -> Result<Value, String> {
    let channel = safe_config_component_id(
        &string_param(&params, &["channel"]).unwrap_or_else(|| "desktop".to_string()),
        "channel",
    )?;
    let account_id = string_param(&params, &["accountId"]).unwrap_or_else(|| "default".to_string());
    let to = required_param(&params, &["to", "target", "recipient"])?;
    let text = string_param(&params, &["text", "message", "body"]);
    let media_urls = media_urls_param(&params);
    if text.is_none() && media_urls.is_empty() {
        return Err("text or media is required".to_string());
    }
    let thread_id = string_param(&params, &["threadId"]);
    let reply_to_id = string_param(&params, &["replyToId", "replyTo", "messageId"]);
    let now = now_millis();
    let request_id = string_param(&params, &["idempotencyKey", "runId", "requestId"])
        .unwrap_or_else(|| format!("rust-send-{now}"));
    let mut request_params = BTreeMap::new();
    if let Some(value) = bool_param(&params, &["gifPlayback"]) {
        request_params.insert("gifPlayback".to_string(), Value::Bool(value));
    }
    for field in ["agentId", "sessionKey"] {
        if let Some(value) = string_param(&params, &[field]) {
            request_params.insert(field.to_string(), Value::String(value));
        }
    }
    let runtime_state = read_channel_runtime_state(state)?;
    let account_runtime = channel_runtime_account(&runtime_state, &channel, &account_id);
    let connected = account_runtime
        .and_then(|account| account.get("connected"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let request = ChannelOutboundRequest {
        request_id: request_id.clone(),
        channel,
        account_id: Some(account_id),
        action: ChannelOutboundAction::Send,
        to,
        text,
        media_urls,
        reply_to_id,
        thread_id,
        params: request_params,
    };
    if request.channel == ESP32_DEVICE_ROLE {
        return queue_esp32_channel_send(state, &request, now);
    }
    let mut entry = serde_json::to_value(dispatch_native_channel_outbound(
        &request,
        NativeChannelDispatchContext {
            connected,
            now_ms: now,
        },
    ))
    .map_err(|error| format!("failed to serialize channel delivery record: {error}"))?;
    if let Some(object) = entry.as_object_mut() {
        object.insert("runId".to_string(), Value::String(request_id));
    }
    let sent = entry.get("sent").and_then(Value::as_bool).unwrap_or(false);
    let delivery_file = if sent {
        state.runtime_root.join("channels").join("deliveries.jsonl")
    } else {
        state.runtime_root.join("channels").join("outbox.jsonl")
    };
    append_jsonl(&delivery_file, &entry)?;
    emit(state, "channel.send", entry.clone());
    Ok(entry)
}

pub(super) fn channel_poll(state: &GatewayState, params: Value) -> Result<Value, String> {
    let channel = safe_config_component_id(
        &string_param(&params, &["channel"]).unwrap_or_else(|| "desktop".to_string()),
        "channel",
    )?;
    let account_id = string_param(&params, &["accountId"]).unwrap_or_else(|| "default".to_string());
    let to = required_param(&params, &["to", "target", "recipient"])?;
    let question = required_param(&params, &["question"])?;
    let options = string_array_param(&params, "options")
        .ok_or_else(|| "poll options require at least two values".to_string())?;
    if options.len() < 2 {
        return Err("poll options require at least two values".to_string());
    }

    let max_selections = positive_integer_param(&params, "maxSelections")?.unwrap_or(1);
    if max_selections > options.len() as u64 {
        return Err("maxSelections cannot exceed option count".to_string());
    }
    let duration_seconds = positive_integer_param(&params, "durationSeconds")?;
    let duration_hours = positive_integer_param(&params, "durationHours")?;
    if duration_seconds.is_some() && duration_hours.is_some() {
        return Err("durationSeconds and durationHours are mutually exclusive".to_string());
    }
    let silent = bool_param(&params, &["silent"]);
    let is_anonymous = bool_param(&params, &["isAnonymous"]);
    let thread_id = string_param(&params, &["threadId"]);

    let now = now_millis();
    let run_id = string_param(&params, &["idempotencyKey", "runId", "requestId"])
        .unwrap_or_else(|| format!("rust-poll-{now}"));
    let mut poll = Map::new();
    poll.insert("question".to_string(), Value::String(question.clone()));
    poll.insert("options".to_string(), json!(options));
    poll.insert("maxSelections".to_string(), json!(max_selections));
    if let Some(value) = duration_seconds {
        poll.insert("durationSeconds".to_string(), json!(value));
    }
    if let Some(value) = duration_hours {
        poll.insert("durationHours".to_string(), json!(value));
    }

    let mut request_params = BTreeMap::new();
    request_params.insert("poll".to_string(), Value::Object(poll.clone()));
    if let Some(value) = silent {
        request_params.insert("silent".to_string(), Value::Bool(value));
    }
    if let Some(value) = is_anonymous {
        request_params.insert("isAnonymous".to_string(), Value::Bool(value));
    }

    let runtime_state = read_channel_runtime_state(state)?;
    let account_runtime = channel_runtime_account(&runtime_state, &channel, &account_id);
    let connected = account_runtime
        .and_then(|account| account.get("connected"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let request = ChannelOutboundRequest {
        request_id: run_id.clone(),
        channel,
        account_id: Some(account_id),
        action: ChannelOutboundAction::Poll,
        to,
        text: Some(question),
        media_urls: Vec::new(),
        reply_to_id: None,
        thread_id,
        params: request_params,
    };
    let mut entry = serde_json::to_value(dispatch_native_channel_outbound(
        &request,
        NativeChannelDispatchContext {
            connected,
            now_ms: now,
        },
    ))
    .map_err(|error| format!("failed to serialize channel poll delivery record: {error}"))?;
    if let Some(object) = entry.as_object_mut() {
        object.insert("runId".to_string(), Value::String(run_id));
        object.insert("poll".to_string(), Value::Object(poll));
        if object.get("sent").and_then(Value::as_bool).unwrap_or(false) {
            if let Some(message_id) = object.get("messageId").cloned() {
                object.insert("pollId".to_string(), message_id);
            }
        }
    }
    let sent = entry.get("sent").and_then(Value::as_bool).unwrap_or(false);
    let delivery_file = if sent {
        state.runtime_root.join("channels").join("deliveries.jsonl")
    } else {
        state.runtime_root.join("channels").join("outbox.jsonl")
    };
    append_jsonl(&delivery_file, &entry)?;
    emit(state, "channel.send", entry.clone());
    Ok(entry)
}

pub(super) fn channel_outbound_action(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let channel = safe_config_component_id(
        &string_param(&params, &["channel"]).unwrap_or_else(|| "desktop".to_string()),
        "channel",
    )?;
    let account_id = string_param(&params, &["accountId"]).unwrap_or_else(|| "default".to_string());
    let action_name = required_param(&params, &["action"])?;
    let action = serde_json::from_value::<ChannelOutboundAction>(Value::String(action_name))
        .map_err(|error| format!("invalid channel outbound action: {error}"))?;
    let to = required_param(&params, &["to", "target", "recipient"])?;
    let text = string_param(&params, &["text", "message", "body"]);
    let media_urls = media_urls_param(&params);
    if text.is_none() && media_urls.is_empty() && params.get("payload").is_none() {
        return Err("text, media, or payload is required".to_string());
    }
    let thread_id = string_param(&params, &["threadId"]);
    let reply_to_id = string_param(&params, &["replyToId", "replyTo", "messageId"]);
    let now = now_millis();
    let request_id = string_param(&params, &["idempotencyKey", "runId", "requestId"])
        .unwrap_or_else(|| format!("rust-action-{now}"));
    let mut request_params = object_param(&params, "params");
    if let Some(payload) = params.get("payload").cloned() {
        request_params.insert("payload".to_string(), payload);
    }

    let runtime_state = read_channel_runtime_state(state)?;
    let account_runtime = channel_runtime_account(&runtime_state, &channel, &account_id);
    let connected = account_runtime
        .and_then(|account| account.get("connected"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let request = ChannelOutboundRequest {
        request_id: request_id.clone(),
        channel,
        account_id: Some(account_id),
        action,
        to,
        text,
        media_urls,
        reply_to_id,
        thread_id,
        params: request_params,
    };
    let mut entry = serde_json::to_value(dispatch_native_channel_outbound(
        &request,
        NativeChannelDispatchContext {
            connected,
            now_ms: now,
        },
    ))
    .map_err(|error| format!("failed to serialize channel action delivery record: {error}"))?;
    if let Some(object) = entry.as_object_mut() {
        object.insert("runId".to_string(), Value::String(request_id));
    }
    let sent = entry.get("sent").and_then(Value::as_bool).unwrap_or(false);
    let delivery_file = if sent {
        state.runtime_root.join("channels").join("deliveries.jsonl")
    } else {
        state.runtime_root.join("channels").join("outbox.jsonl")
    };
    append_jsonl(&delivery_file, &entry)?;
    emit(state, "channel.send", entry.clone());
    Ok(entry)
}
