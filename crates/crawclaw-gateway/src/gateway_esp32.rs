use super::*;

pub(super) const ESP32_PENDING_TTL_MS: u64 = 5 * 60 * 1000;

pub(super) fn esp32_pending_path(state: &GatewayState) -> PathBuf {
    state.state_dir.join("devices").join("pending.json")
}

pub(super) fn esp32_paired_path(state: &GatewayState) -> PathBuf {
    state.state_dir.join("devices").join("paired.json")
}

pub(super) fn read_esp32_device_pairing_state(
    state: &GatewayState,
) -> Result<(Map<String, Value>, Map<String, Value>), String> {
    let mut pending = read_json_object_file(esp32_pending_path(state))?;
    prune_expired_esp32_pairing(&mut pending);
    let paired = read_json_object_file(esp32_paired_path(state))?;
    Ok((pending, paired))
}

pub(super) fn prune_expired_esp32_pairing(pending: &mut Map<String, Value>) {
    let now = now_millis() as u64;
    pending.retain(|_, request| {
        request
            .get("ts")
            .and_then(Value::as_u64)
            .map(|ts| now.saturating_sub(ts) <= ESP32_PENDING_TTL_MS)
            .unwrap_or(true)
    });
}

pub(super) fn build_esp32_paired_device_from_request(request: &Value) -> Value {
    let now = now_millis() as u64;
    let role = request
        .get("role")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|role| !role.is_empty());
    let scopes = request
        .get("scopes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let roles = request
        .get("roles")
        .cloned()
        .or_else(|| role.map(|role| json!([role])))
        .unwrap_or_else(|| json!([]));
    let mut device = Map::new();
    for field in [
        "deviceId",
        "publicKey",
        "displayName",
        "platform",
        "deviceFamily",
        "clientId",
        "clientMode",
        "role",
        "remoteIp",
    ] {
        if let Some(value) = request.get(field) {
            device.insert(field.to_string(), value.clone());
        }
    }
    device.insert("roles".to_string(), roles);
    device.insert("scopes".to_string(), Value::Array(scopes.clone()));
    device.insert("approvedScopes".to_string(), Value::Array(scopes));
    device.insert("createdAtMs".to_string(), json!(now));
    device.insert("approvedAtMs".to_string(), json!(now));
    Value::Object(device)
}

pub(super) fn redact_esp32_paired_device(device: Value) -> Value {
    let mut object = device.as_object().cloned().unwrap_or_default();
    object.remove("approvedScopes");
    object.remove("tokens");
    Value::Object(object)
}

pub(super) const ESP32_DEVICE_ROLE: &str = "esp32";
pub(super) const ESP32_HARDWARE_TARGET: &str = "ESP32-S3-BOX-3";
const ESP32_ONLINE_TTL_MS: u64 = 2 * 60 * 1000;

pub(super) fn esp32_config_from_crawclaw_config(config: &Value) -> Value {
    let raw = get_json_path(config, "plugins.entries.esp32.config")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let mut broker = Map::new();
    broker.insert(
        "mode".to_string(),
        Value::String(esp32_config_string(&raw, "broker.mode", "managed")),
    );
    broker.insert(
        "bindHost".to_string(),
        Value::String(esp32_config_string(&raw, "broker.bindHost", "0.0.0.0")),
    );
    broker.insert(
        "port".to_string(),
        json!(esp32_config_u64(&raw, "broker.port", 1883)),
    );
    if let Some(value) = esp32_optional_config_string(&raw, "broker.advertisedHost") {
        broker.insert("advertisedHost".to_string(), Value::String(value));
    }

    let mut udp = Map::new();
    udp.insert(
        "bindHost".to_string(),
        Value::String(esp32_config_string(&raw, "udp.bindHost", "0.0.0.0")),
    );
    udp.insert(
        "port".to_string(),
        json!(esp32_config_u64(&raw, "udp.port", 1884)),
    );
    if let Some(value) = esp32_optional_config_string(&raw, "udp.advertisedHost") {
        udp.insert("advertisedHost".to_string(), Value::String(value));
    }

    let mut renderer = Map::new();
    if let Some(value) = esp32_optional_config_string(&raw, "renderer.model") {
        renderer.insert("model".to_string(), Value::String(value));
    }
    renderer.insert(
        "timeoutMs".to_string(),
        json!(esp32_config_u64(&raw, "renderer.timeoutMs", 8000)),
    );
    renderer.insert(
        "maxSpokenChars".to_string(),
        json!(esp32_config_u64(&raw, "renderer.maxSpokenChars", 40)),
    );
    renderer.insert(
        "maxDisplayChars".to_string(),
        json!(esp32_config_u64(&raw, "renderer.maxDisplayChars", 72)),
    );

    let tools_allowlist = get_json_path(&raw, "tools.allowlist")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| Value::String(value.to_string()))
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            [
                "display.*",
                "led.*",
                "audio.*",
                "volume.*",
                "mute.*",
                "sensor.*",
            ]
            .into_iter()
            .map(|value| Value::String(value.to_string()))
            .collect()
        });

    json!({
        "broker": Value::Object(broker),
        "udp": Value::Object(udp),
        "renderer": Value::Object(renderer),
        "tts": {
            "provider": esp32_config_string(&raw, "tts.provider", "qwen3-tts"),
            "target": esp32_config_string(&raw, "tts.target", "voice-note")
        },
        "tools": {
            "allowlist": tools_allowlist,
            "highRiskRequiresApproval": get_json_path(&raw, "tools.highRiskRequiresApproval")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        }
    })
}

pub(super) fn esp32_config_string(raw: &Value, path: &str, default: &str) -> String {
    esp32_optional_config_string(raw, path).unwrap_or_else(|| default.to_string())
}

pub(super) fn esp32_optional_config_string(raw: &Value, path: &str) -> Option<String> {
    get_json_path(raw, path)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn esp32_config_u64(raw: &Value, path: &str, default: u64) -> u64 {
    get_json_path(raw, path)
        .and_then(Value::as_u64)
        .unwrap_or(default)
}

pub(super) fn esp32_plugin_enabled(config: &Value) -> bool {
    get_json_path(config, "plugins.entries.esp32.enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

pub(super) fn esp32_pairing_sessions_path(state: &GatewayState) -> PathBuf {
    state.state_dir.join("esp32").join("pairing-sessions.json")
}

pub(super) fn read_esp32_pairing_session_state(
    state: &GatewayState,
) -> Result<Map<String, Value>, String> {
    let mut sessions = read_json_object_file(esp32_pairing_sessions_path(state))?;
    let now = now_millis() as u64;
    sessions.retain(|_, session| {
        session
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .map(|expires| expires > now)
            .unwrap_or(true)
    });
    Ok(sessions)
}

pub(super) fn esp32_pairing_sessions(state: &GatewayState) -> Result<Vec<Value>, String> {
    let sessions = read_esp32_pairing_session_state(state)?;
    write_json_file(
        &esp32_pairing_sessions_path(state),
        &Value::Object(sessions.clone()),
    )?;
    let mut sessions = sessions
        .into_values()
        .map(|session| {
            let mut object = session.as_object().cloned().unwrap_or_default();
            if let Some(pair_id) = object.get("pairId").and_then(Value::as_str) {
                object.insert(
                    "username".to_string(),
                    Value::String(format!("pair:{pair_id}")),
                );
            }
            object.remove("password");
            Value::Object(object)
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        let left_ts = left.get("issuedAtMs").and_then(Value::as_u64).unwrap_or(0);
        let right_ts = right.get("issuedAtMs").and_then(Value::as_u64).unwrap_or(0);
        right_ts.cmp(&left_ts)
    });
    Ok(sessions)
}

pub(super) fn read_esp32_stored_devices(
    state: &GatewayState,
) -> Result<Map<String, Value>, String> {
    let store = read_config_value(&state.state_dir.join("esp32").join("devices.json"))?;
    Ok(store
        .get("devices")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default())
}

pub(super) fn write_esp32_stored_devices(
    state: &GatewayState,
    devices: Map<String, Value>,
) -> Result<(), String> {
    write_json_file(
        &state.state_dir.join("esp32").join("devices.json"),
        &json!({ "devices": devices }),
    )
}

pub(super) async fn esp32_ota(
    State(state): State<GatewayState>,
    headers: HeaderMap,
) -> Json<Value> {
    Json(esp32_ota_payload(&state, &headers))
}

pub(super) fn esp32_ota_payload(state: &GatewayState, headers: &HeaderMap) -> Value {
    let config =
        read_config_value(&config_path(state)).unwrap_or_else(|_| Value::Object(Map::new()));
    let esp32_config = esp32_config_from_crawclaw_config(&config);
    let device_id = esp32_topic_component(
        header_string(headers, "Device-Id")
            .or_else(|| header_string(headers, "Client-Id"))
            .as_deref(),
    );
    let broker = &esp32_config["broker"];
    let udp = &esp32_config["udp"];
    let broker_host = esp32_advertised_host(broker);
    let broker_port = broker.get("port").and_then(Value::as_u64).unwrap_or(1883);
    let udp_host = esp32_advertised_host(udp);
    let udp_port = udp.get("port").and_then(Value::as_u64).unwrap_or(1884);
    let topics = esp32_mqtt_topics(&device_id);
    json!({
        "mqtt": {
            "endpoint": format!("{broker_host}:{broker_port}"),
            "client_id": format!("crawclaw-esp32-{device_id}"),
            "username": format!("device:{device_id}"),
            "password": "",
            "publish_topic": topics["event"].clone(),
            "subscribe_topic": topics["command"].clone(),
            "keepalive": 240
        },
        "server_time": {
            "timestamp": now_millis() as u64,
            "timezone_offset": 8 * 60
        },
        "crawclaw": {
            "protocolVersion": 1,
            "transport": "mqtt-udp",
            "hardwareTarget": ESP32_HARDWARE_TARGET,
            "pairingRequired": true,
            "deviceId": device_id,
            "mqtt": { "topics": topics },
            "udp": {
                "server": udp_host,
                "port": udp_port,
                "codec": "opus"
            }
        }
    })
}

pub(super) fn header_string(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn esp32_topic_component(raw: Option<&str>) -> String {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return "unknown".to_string();
    };
    let value = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if value.is_empty() {
        "unknown".to_string()
    } else {
        value
    }
}

pub(super) fn esp32_advertised_host(config: &Value) -> String {
    config
        .get("advertisedHost")
        .or_else(|| config.get("bindHost"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "0.0.0.0")
        .unwrap_or("127.0.0.1")
        .to_string()
}

pub(super) fn esp32_mqtt_topics(device_id: &str) -> Value {
    json!({
        "hello": format!("crawclaw/esp32/{device_id}/hello"),
        "event": format!("crawclaw/esp32/{device_id}/event"),
        "state": format!("crawclaw/esp32/{device_id}/state"),
        "command": format!("crawclaw/esp32/{device_id}/command")
    })
}

pub(super) fn esp32_mqtt_topic_templates() -> Value {
    json!({
        "hello": "crawclaw/esp32/{deviceId}/hello",
        "event": "crawclaw/esp32/{deviceId}/event",
        "state": "crawclaw/esp32/{deviceId}/state",
        "command": "crawclaw/esp32/{deviceId}/command"
    })
}

pub(super) fn esp32_service_running(config: &Value, esp32_config: &Value) -> bool {
    esp32_plugin_enabled(config)
        && esp32_config
            .get("broker")
            .and_then(|broker| broker.get("mode"))
            .and_then(Value::as_str)
            .map(|mode| mode == "managed")
            .unwrap_or(true)
}

pub(super) fn esp32_pending_request(request: &Value) -> bool {
    string_array_param(request, "roles")
        .unwrap_or_default()
        .into_iter()
        .chain(
            request
                .get("role")
                .and_then(Value::as_str)
                .map(|role| role.to_string()),
        )
        .any(|role| role == ESP32_DEVICE_ROLE)
        || request.get("deviceFamily").and_then(Value::as_str) == Some(ESP32_HARDWARE_TARGET)
        || request.get("clientMode").and_then(Value::as_str) == Some("mqtt-udp")
}

pub(super) fn esp32_paired_device(device: &Value) -> bool {
    esp32_effective_roles(device)
        .iter()
        .any(|role| role == ESP32_DEVICE_ROLE)
        || device.get("deviceFamily").and_then(Value::as_str) == Some(ESP32_HARDWARE_TARGET)
        || device.get("clientMode").and_then(Value::as_str) == Some("mqtt-udp")
}

pub(super) fn esp32_effective_roles(device: &Value) -> Vec<String> {
    if let Some(tokens) = device.get("tokens").and_then(Value::as_object) {
        let active_roles = tokens
            .values()
            .filter(|token| token.get("revokedAtMs").is_none())
            .filter_map(|token| token.get("role").and_then(Value::as_str))
            .map(str::trim)
            .filter(|role| !role.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if !active_roles.is_empty() {
            return active_roles;
        }
        if !tokens.is_empty() {
            return Vec::new();
        }
    }

    let mut roles = string_array_param(device, "roles").unwrap_or_default();
    if let Some(role) = device
        .get("role")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|role| !role.is_empty())
    {
        roles.push(role.to_string());
    }
    roles.sort();
    roles.dedup();
    roles
}

pub(super) fn esp32_default_capabilities() -> Value {
    json!({
        "hardwareTarget": ESP32_HARDWARE_TARGET,
        "audio": { "input": "i2s", "output": "i2s", "codec": "opus" },
        "display": { "width": 320, "height": 240, "color": true },
        "wakeWord": true
    })
}

pub(super) fn esp32_device_online(stored: Option<&Value>) -> bool {
    let Some(last_seen_at_ms) = stored
        .and_then(|stored| stored.get("lastSeenAtMs"))
        .and_then(Value::as_u64)
    else {
        return false;
    };
    let now = now_millis() as u64;
    now.saturating_sub(last_seen_at_ms) <= ESP32_ONLINE_TTL_MS
}

pub(super) fn esp32_agent_name(state: &GatewayState, agent_id: &str) -> String {
    agents_list(state)
        .get("agents")
        .and_then(Value::as_array)
        .and_then(|agents| {
            agents
                .iter()
                .find(|agent| agent.get("id").and_then(Value::as_str) == Some(agent_id))
        })
        .and_then(|agent| agent.get("name"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| agent_id.to_string())
}

pub(super) fn esp32_active_agent_fields(
    state: &GatewayState,
    stored: Option<&Value>,
) -> (Value, Value) {
    let active_agent_id = stored
        .and_then(|stored| stored.get("activeAgentId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|agent_id| !agent_id.is_empty())
        .unwrap_or("main");
    (
        Value::String(active_agent_id.to_string()),
        Value::String(esp32_agent_name(state, active_agent_id)),
    )
}

pub(super) fn esp32_device_summary(
    state: &GatewayState,
    device: Value,
    stored: Option<&Value>,
) -> Value {
    let device_id = device.get("deviceId").cloned().unwrap_or(Value::Null);
    let name = device
        .get("displayName")
        .cloned()
        .or_else(|| stored.and_then(|stored| stored.get("name").cloned()))
        .unwrap_or(Value::Null);
    let fingerprint = device
        .get("publicKey")
        .cloned()
        .or_else(|| stored.and_then(|stored| stored.get("fingerprint").cloned()))
        .unwrap_or(Value::Null);
    let capabilities = stored
        .and_then(|stored| stored.get("capabilities").cloned())
        .unwrap_or_else(esp32_default_capabilities);
    let last_seen_at_ms = stored
        .and_then(|stored| stored.get("lastSeenAtMs").cloned())
        .unwrap_or(Value::Null);
    let (active_agent_id, active_agent_name) = esp32_active_agent_fields(state, stored);
    let online = esp32_device_online(stored);
    json!({
        "deviceId": device_id,
        "name": name,
        "fingerprint": fingerprint,
        "hardwareTarget": device
            .get("deviceFamily")
            .cloned()
            .or_else(|| get_json_path(stored.unwrap_or(&Value::Null), "capabilities.hardwareTarget").cloned())
            .unwrap_or_else(|| Value::String(ESP32_HARDWARE_TARGET.to_string())),
        "clientMode": device
            .get("clientMode")
            .cloned()
            .unwrap_or_else(|| Value::String("mqtt-udp".to_string())),
        "online": online,
        "activeAgentId": active_agent_id,
        "activeAgentName": active_agent_name,
        "lastSeenAtMs": last_seen_at_ms,
        "approvedAtMs": device.get("approvedAtMs").cloned().unwrap_or(Value::Null),
        "capabilities": capabilities
    })
}

pub(super) fn esp32_pending_summary(request: Value, stored: Option<&Value>) -> Value {
    json!({
        "requestId": request.get("requestId").cloned().unwrap_or(Value::Null),
        "deviceId": request.get("deviceId").cloned().unwrap_or(Value::Null),
        "name": request
            .get("displayName")
            .cloned()
            .or_else(|| stored.and_then(|stored| stored.get("name").cloned()))
            .unwrap_or(Value::Null),
        "fingerprint": request
            .get("publicKey")
            .cloned()
            .or_else(|| stored.and_then(|stored| stored.get("fingerprint").cloned()))
            .unwrap_or(Value::Null),
        "hardwareTarget": request
            .get("deviceFamily")
            .cloned()
            .or_else(|| get_json_path(stored.unwrap_or(&Value::Null), "capabilities.hardwareTarget").cloned())
            .unwrap_or_else(|| Value::String(ESP32_HARDWARE_TARGET.to_string())),
        "clientMode": request
            .get("clientMode")
            .cloned()
            .unwrap_or_else(|| Value::String("mqtt-udp".to_string())),
        "requestedAtMs": request.get("ts").cloned().unwrap_or(Value::Null),
        "capabilities": stored
            .and_then(|stored| stored.get("capabilities").cloned())
            .unwrap_or_else(|| json!({}))
    })
}

pub(super) fn esp32_overview(state: &GatewayState) -> Result<(Vec<Value>, Vec<Value>), String> {
    let (pending, paired) = read_esp32_device_pairing_state(state)?;
    let stored = read_esp32_stored_devices(state)?;
    let mut pending = pending
        .into_values()
        .filter(esp32_pending_request)
        .map(|request| {
            let device_id = request
                .get("deviceId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            esp32_pending_summary(request, device_id.as_deref().and_then(|id| stored.get(id)))
        })
        .collect::<Vec<_>>();
    pending.sort_by(|left, right| {
        let left_ts = left
            .get("requestedAtMs")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let right_ts = right
            .get("requestedAtMs")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        right_ts.cmp(&left_ts)
    });

    let mut paired = paired
        .into_values()
        .filter(esp32_paired_device)
        .map(|device| {
            let device_id = device
                .get("deviceId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            esp32_device_summary(
                state,
                device,
                device_id.as_deref().and_then(|id| stored.get(id)),
            )
        })
        .collect::<Vec<_>>();
    paired.sort_by(|left, right| {
        let left_id = left
            .get("deviceId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_id = right
            .get("deviceId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        left_id.cmp(right_id)
    });
    Ok((pending, paired))
}

pub(super) fn esp32_status_get(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    let esp32_config = esp32_config_from_crawclaw_config(&config);
    let sessions = esp32_pairing_sessions(state)?;
    let (pending, paired) = esp32_overview(state)?;
    Ok(json!({
        "enabled": esp32_plugin_enabled(&config),
        "serviceRunning": esp32_service_running(&config, &esp32_config),
        "protocolVersion": 1,
        "broker": esp32_config["broker"].clone(),
        "udp": esp32_config["udp"].clone(),
        "renderer": esp32_config["renderer"].clone(),
        "tts": esp32_config["tts"].clone(),
        "tools": esp32_config["tools"].clone(),
        "counts": {
            "activePairingSessions": sessions.len(),
            "pendingRequests": pending.len(),
            "pairedDevices": paired.len(),
            "onlineDevices": paired
                .iter()
                .filter(|device| device.get("online").and_then(Value::as_bool).unwrap_or(false))
                .count()
        },
        "activePairingSessions": sessions
    }))
}

pub(super) fn esp32_pairing_start(state: &GatewayState, params: Value) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    if !esp32_plugin_enabled(&config) {
        return Err("ESP32 plugin is disabled".to_string());
    }
    let esp32_config = esp32_config_from_crawclaw_config(&config);
    let now = now_millis() as u64;
    let ttl_ms = params
        .get("ttlMs")
        .and_then(Value::as_u64)
        .unwrap_or(5 * 60 * 1000);
    let pair_id = format!("rust-esp32-{now}");
    let password = format!("rust-pair-code-{now}");
    let name = string_param(&params, &["name"]);
    let mut sessions = read_esp32_pairing_session_state(state)?;
    let mut record = Map::new();
    record.insert("pairId".to_string(), Value::String(pair_id.clone()));
    record.insert("password".to_string(), Value::String(password.clone()));
    if let Some(name) = name.clone() {
        record.insert("name".to_string(), Value::String(name));
    }
    record.insert(
        "hardwareTarget".to_string(),
        Value::String(ESP32_HARDWARE_TARGET.to_string()),
    );
    record.insert("issuedAtMs".to_string(), json!(now));
    record.insert("expiresAtMs".to_string(), json!(now.saturating_add(ttl_ms)));
    sessions.insert(pair_id.clone(), Value::Object(record));
    write_json_file(
        &esp32_pairing_sessions_path(state),
        &Value::Object(sessions),
    )?;

    let broker = &esp32_config["broker"];
    let udp = &esp32_config["udp"];
    Ok(json!({
        "pairId": pair_id,
        "username": format!("pair:{pair_id}"),
        "pairCode": password,
        "name": name,
        "hardwareTarget": ESP32_HARDWARE_TARGET,
        "issuedAtMs": now,
        "expiresAtMs": now.saturating_add(ttl_ms),
        "broker": {
            "host": broker
                .get("advertisedHost")
                .or_else(|| broker.get("bindHost"))
                .cloned()
                .unwrap_or_else(|| Value::String("0.0.0.0".to_string())),
            "port": broker.get("port").cloned().unwrap_or_else(|| json!(1883))
        },
        "udp": {
            "host": udp
                .get("advertisedHost")
                .or_else(|| udp.get("bindHost"))
                .cloned()
                .unwrap_or_else(|| Value::String("0.0.0.0".to_string())),
            "port": udp.get("port").cloned().unwrap_or_else(|| json!(1884))
        },
        "profile": {
            "hardwareTarget": ESP32_HARDWARE_TARGET,
            "audio": { "input": "i2s", "output": "i2s", "codec": "opus" },
            "display": { "width": 320, "height": 240, "color": true }
        },
        "mqtt": {
            "topics": esp32_mqtt_topic_templates()
        }
    }))
}

pub(super) fn esp32_pairing_requests_list(state: &GatewayState) -> Result<Value, String> {
    let (pending, _) = esp32_overview(state)?;
    Ok(json!({ "items": pending }))
}

pub(super) fn esp32_pairing_request_approve(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let request_id = required_param(&params, &["requestId", "id"])?;
    let (mut pending, mut paired) = read_esp32_device_pairing_state(state)?;
    let request = pending
        .remove(&request_id)
        .ok_or_else(|| "unknown requestId".to_string())?;
    if !esp32_pending_request(&request) {
        return Err("request is not an ESP32 pairing request".to_string());
    }
    let device = build_esp32_paired_device_from_request(&request);
    let device_id = device
        .get("deviceId")
        .and_then(Value::as_str)
        .ok_or_else(|| "ESP32 pairing request missing deviceId".to_string())?
        .to_string();
    paired.insert(device_id.clone(), device);
    write_json_file(&esp32_pending_path(state), &Value::Object(pending))?;
    write_json_file(&esp32_paired_path(state), &Value::Object(paired))?;
    Ok(json!({
        "requestId": request_id,
        "deviceId": device_id
    }))
}

pub(super) fn esp32_pairing_request_reject(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let request_id = required_param(&params, &["requestId", "id"])?;
    let (mut pending, _) = read_esp32_device_pairing_state(state)?;
    let request = pending
        .remove(&request_id)
        .ok_or_else(|| "unknown requestId".to_string())?;
    if !esp32_pending_request(&request) {
        return Err("request is not an ESP32 pairing request".to_string());
    }
    write_json_file(&esp32_pending_path(state), &Value::Object(pending))?;
    Ok(json!({
        "requestId": request_id,
        "deviceId": request.get("deviceId").cloned().unwrap_or(Value::Null)
    }))
}

pub(super) fn esp32_pairing_session_revoke(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let pair_id = required_param(&params, &["pairId", "id"])?;
    let mut sessions = read_esp32_pairing_session_state(state)?;
    if sessions.remove(&pair_id).is_none() {
        return Err("unknown pairId".to_string());
    }
    write_json_file(
        &esp32_pairing_sessions_path(state),
        &Value::Object(sessions),
    )?;
    Ok(json!({ "pairId": pair_id }))
}

pub(super) fn esp32_devices_list(state: &GatewayState) -> Result<Value, String> {
    let (_, paired) = esp32_overview(state)?;
    Ok(json!({ "items": paired }))
}

pub(super) fn esp32_device_get(state: &GatewayState, params: Value) -> Result<Value, String> {
    let device_id =
        safe_config_component_id(&required_param(&params, &["deviceId", "id"])?, "device id")?;
    let (_, paired) = read_esp32_device_pairing_state(state)?;
    let stored = read_esp32_stored_devices(state)?;
    let device = paired.get(&device_id).cloned().filter(esp32_paired_device);
    let summary = device
        .clone()
        .map(|device| esp32_device_summary(state, device.clone(), stored.get(&device_id)));
    Ok(json!({
        "ok": device.is_some(),
        "status": if device.is_some() { "found" } else { "not_found" },
        "deviceId": device_id,
        "device": summary.clone().unwrap_or(Value::Null),
        "paired": device.map(redact_esp32_paired_device).unwrap_or(Value::Null),
        "implementation": "rust-native"
    }))
}

pub(super) fn esp32_devices_revoke(state: &GatewayState, params: Value) -> Result<Value, String> {
    let device_id = required_param(&params, &["deviceId", "id"])?;
    let (_, mut paired) = read_esp32_device_pairing_state(state)?;
    let removed = paired
        .remove(&device_id)
        .filter(esp32_paired_device)
        .ok_or_else(|| "unknown deviceId".to_string())?;
    write_json_file(&esp32_paired_path(state), &Value::Object(paired))?;
    Ok(json!({
        "deviceId": removed.get("deviceId").cloned().unwrap_or_else(|| json!(device_id))
    }))
}

pub(super) fn esp32_device_command_send(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let device_id =
        safe_runtime_component_id(&required_param(&params, &["deviceId", "id"])?, "device id")?;
    let command = required_param(&params, &["command", "action"])?;
    let mut command_metadata = Map::new();
    if command == "agent.switch" {
        let active_agent_id = string_param(
            params.get("params").unwrap_or(&Value::Null),
            &["agentId", "agent", "id"],
        )
        .or_else(|| string_param(&params, &["agentId", "agent"]))
        .unwrap_or_else(|| "main".to_string());
        let active_agent_name = esp32_agent_name(state, &active_agent_id);
        upsert_esp32_device_active_agent(state, &device_id, &active_agent_id, &active_agent_name)?;
        command_metadata.insert(
            "activeAgentId".to_string(),
            Value::String(active_agent_id.clone()),
        );
        command_metadata.insert(
            "activeAgentName".to_string(),
            Value::String(active_agent_name),
        );
    }
    let command_id = format!("rust-esp32-command-{}", now_millis());
    let mut entry = json!({
        "ok": true,
        "status": "queued",
        "commandId": command_id,
        "deviceId": device_id,
        "command": command,
        "params": params.get("params").cloned().unwrap_or(Value::Null),
        "queuedAtMs": now_millis(),
        "implementation": "rust-native"
    });
    if let Some(object) = entry.as_object_mut() {
        object.extend(command_metadata);
    }
    append_jsonl(
        &state.runtime_root.join("esp32").join("commands.jsonl"),
        &entry,
    )?;
    emit(state, "esp32.command", entry.clone());
    Ok(entry)
}

pub(super) fn upsert_esp32_device_active_agent(
    state: &GatewayState,
    device_id: &str,
    active_agent_id: &str,
    active_agent_name: &str,
) -> Result<(), String> {
    let mut devices = read_esp32_stored_devices(state)?;
    let device = devices
        .entry(device_id.to_string())
        .or_insert_with(|| json!({ "deviceId": device_id }));
    let object = ensure_json_object(device);
    object.insert("deviceId".to_string(), Value::String(device_id.to_string()));
    object.insert(
        "activeAgentId".to_string(),
        Value::String(active_agent_id.to_string()),
    );
    object.insert(
        "activeAgentName".to_string(),
        Value::String(active_agent_name.to_string()),
    );
    object.insert("lastSeenAtMs".to_string(), json!(now_millis() as u64));
    write_esp32_stored_devices(state, devices)
}

pub(super) fn queue_esp32_channel_send(
    state: &GatewayState,
    request: &ChannelOutboundRequest,
    now: u128,
) -> Result<Value, String> {
    let command_id = format!("rust-esp32-command-{now}");
    let mut command_params = Map::new();
    if let Some(text) = &request.text {
        command_params.insert("text".to_string(), Value::String(text.clone()));
    }
    if !request.media_urls.is_empty() {
        command_params.insert(
            "mediaUrls".to_string(),
            Value::Array(
                request
                    .media_urls
                    .iter()
                    .map(|url| Value::String(url.clone()))
                    .collect(),
            ),
        );
    }
    if let Some(reply_to_id) = &request.reply_to_id {
        command_params.insert("replyToId".to_string(), Value::String(reply_to_id.clone()));
    }
    if let Some(thread_id) = &request.thread_id {
        command_params.insert("threadId".to_string(), Value::String(thread_id.clone()));
    }
    for (key, value) in &request.params {
        command_params.insert(key.clone(), value.clone());
    }

    let command_entry = json!({
        "ok": true,
        "status": "queued",
        "commandId": command_id,
        "requestId": request.request_id.clone(),
        "deviceId": request.to.clone(),
        "command": "display.reply",
        "params": Value::Object(command_params.clone()),
        "queuedAtMs": now,
        "implementation": "rust-native"
    });
    append_jsonl(
        &state.runtime_root.join("esp32").join("commands.jsonl"),
        &command_entry,
    )?;

    let entry = json!({
        "ok": true,
        "requestId": request.request_id.clone(),
        "runId": request.request_id.clone(),
        "action": "send",
        "messageId": format!("rust-esp32-send-{now}"),
        "channel": request.channel.clone(),
        "accountId": request.account_id.as_deref().unwrap_or("default"),
        "to": request.to.clone(),
        "text": request.text.clone(),
        "mediaUrls": request.media_urls.clone(),
        "replyToId": request.reply_to_id.clone(),
        "threadId": request.thread_id.clone(),
        "params": Value::Object(command_params),
        "sent": false,
        "deliveryStatus": "queued",
        "status": "queued",
        "errorCode": Value::Null,
        "commandId": command_entry["commandId"].clone(),
        "queuedAtMs": now,
        "deliveredAtMs": Value::Null,
        "implementation": "rust-native"
    });
    append_jsonl(
        &state.runtime_root.join("channels").join("outbox.jsonl"),
        &entry,
    )?;
    emit(state, "esp32.command", command_entry);
    emit(state, "channel.send", entry.clone());
    Ok(entry)
}
