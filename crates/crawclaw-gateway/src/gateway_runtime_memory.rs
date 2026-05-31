use super::*;

pub(super) fn runtime_status_value(state: &GatewayState) -> Value {
    let native_registry = crawclaw_runtime::native_plugin_registry(&state.runtime_root);
    json!({
        "ok": true,
        "runtime": "ready",
        "implementation": "rust-native",
        "authMode": auth_mode(state),
        "stateDir": state.state_dir.to_string_lossy(),
        "runtimeRoot": state.runtime_root.to_string_lossy(),
        "jsPluginRuntime": "none",
        "providerPlugins": crawclaw_providers::bundled_provider_plugin_metadata(),
        "providerDescriptors": crawclaw_providers::bundled_provider_descriptors(),
        "providerAuthChoices": crawclaw_providers::bundled_provider_auth_choices(),
        "providerSetupOptions": crawclaw_providers::bundled_provider_setup_options(),
        "providerModelPickerEntries": crawclaw_providers::bundled_provider_model_picker_entries(),
        "webProviderBoundaries": crawclaw_providers::bundled_web_provider_boundaries(),
        "nativePluginDescriptors": native_registry.descriptors(),
        "nativeWebSearchProviders": native_registry.web_search_provider_descriptors(),
        "nativeWebFetchProviders": native_registry.web_fetch_provider_descriptors(),
        "nativeSpeechProviders": native_registry.speech_provider_descriptors(),
        "nativePluginRegistryDiagnostics": native_registry.diagnostics,
        "defaultModels": crawclaw_providers::bundled_provider_default_models(),
        "gatewayMethods": gateway_methods(),
        "mcpServers": mcp_servers_snapshot(state),
        "coreTools": crawclaw_runtime::pi_agent_rust_tool_names_for_runtime_root(&state.runtime_root)
    })
}

pub(super) fn gateway_methods() -> Vec<&'static str> {
    GATEWAY_PROTOCOL_METHODS.to_vec()
}

pub(super) fn hello_ok(state: &GatewayState) -> Value {
    json!({
        "type": "hello-ok",
        "protocol": GATEWAY_PROTOCOL_VERSION,
        "server": {
            "version": env!("CARGO_PKG_VERSION"),
            "connId": format!("rust-conn-{}", now_millis())
        },
        "features": {
            "methods": gateway_methods(),
            "events": desktop::SSE_EVENTS
        },
        "snapshot": {
            "presence": system_presence(state).unwrap_or_else(|_| Value::Array(Vec::new())),
            "health": runtime_status_value(state),
            "stateVersion": { "presence": 0, "health": 0 },
            "uptimeMs": now_millis().saturating_sub(state.started_at_ms) as u64,
            "configPath": config_path(state).to_string_lossy(),
            "stateDir": state.state_dir.to_string_lossy(),
            "sessionDefaults": {
                "defaultAgentId": "main",
                "mainKey": "main",
                "mainSessionKey": "agent:main:main"
            },
            "authMode": auth_mode(state)
        },
        "policy": {
            "maxPayload": 26214400,
            "maxBufferedBytes": 26214400,
            "tickIntervalMs": 30000
        }
    })
}

pub(super) fn memory_runtime(state: &GatewayState) -> MemoryRuntime {
    MemoryRuntime::new(state.runtime_root.clone())
}

pub(super) fn memory_prompt_journal_summary(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    let files = prompt_journal_candidate_files(state, &params);
    let mut events = Vec::new();
    for file in &files {
        events.extend(read_prompt_journal_events(file));
    }

    let mut stage_counts = BTreeMap::<String, u64>::new();
    let mut decision_counts = BTreeMap::<String, u64>::new();
    let mut skip_reason_counts = BTreeMap::<String, u64>::new();
    let mut top_reason_counts = BTreeMap::<String, u64>::new();
    let mut experience_extract_status_counts = BTreeMap::<String, u64>::new();
    let mut experience_extract_decision_counts = BTreeMap::<String, u64>::new();
    let mut experience_status_counts = BTreeMap::<String, u64>::new();
    let mut experience_action_counts = BTreeMap::<String, u64>::new();
    let mut experience_title_counts = BTreeMap::<String, u64>::new();
    let mut sessions = BTreeSet::<String>::new();
    let mut date_buckets = BTreeSet::<String>::new();
    let mut prompt_estimated_tokens = Vec::<f64>::new();
    let mut prompt_chars = Vec::<f64>::new();
    let mut prompt_assembly_count = 0_u64;
    let mut durable_count = 0_u64;
    let mut durable_notes_saved_total = 0_i64;
    let mut durable_non_zero_save_count = 0_u64;
    let mut durable_zero_save_count = 0_u64;
    let mut experience_extract_written_count = 0_i64;
    let mut experience_extract_updated_count = 0_i64;
    let mut experience_extract_deleted_count = 0_i64;

    for event in &events {
        let stage = string_param(event, &["stage"]);
        increment_counter(&mut stage_counts, stage.as_deref());
        if let Some(session) = string_param(event, &["sessionKey", "sessionId"]) {
            sessions.insert(session);
        }
        if let Some(date_bucket) = string_param(event, &["dateBucket"]) {
            date_buckets.insert(date_bucket);
        }
        let payload = event.get("payload").unwrap_or(&Value::Null);

        match stage.as_deref() {
            Some("prompt_assembly") => {
                prompt_assembly_count += 1;
                if let Some(value) = payload.get("estimatedTokens").and_then(Value::as_f64) {
                    prompt_estimated_tokens.push(value);
                }
                if let Some(text) = payload.get("systemContextText").and_then(Value::as_str) {
                    prompt_chars.push(text.chars().count() as f64);
                }
            }
            Some("after_turn_decision") => {
                increment_counter(
                    &mut decision_counts,
                    payload.get("decision").and_then(Value::as_str),
                );
                increment_counter(
                    &mut skip_reason_counts,
                    payload.get("skipReason").and_then(Value::as_str),
                );
            }
            Some("durable_extraction") => {
                durable_count += 1;
                let notes_saved = payload
                    .get("notesSaved")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                durable_notes_saved_total += notes_saved;
                if notes_saved == 0 {
                    durable_zero_save_count += 1;
                } else {
                    durable_non_zero_save_count += 1;
                }
                increment_counter(
                    &mut top_reason_counts,
                    payload.get("reason").and_then(Value::as_str),
                );
            }
            Some("experience_extract") => {
                increment_counter(
                    &mut experience_extract_status_counts,
                    payload.get("status").and_then(Value::as_str),
                );
                increment_counter(
                    &mut experience_extract_decision_counts,
                    payload.get("decision").and_then(Value::as_str),
                );
                experience_extract_written_count += payload
                    .get("writtenCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                experience_extract_updated_count += payload
                    .get("updatedCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                experience_extract_deleted_count += payload
                    .get("deletedCount")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
            }
            Some("experience_write") => {
                increment_counter(
                    &mut experience_status_counts,
                    payload.get("status").and_then(Value::as_str),
                );
                increment_counter(
                    &mut experience_action_counts,
                    payload.get("action").and_then(Value::as_str),
                );
                increment_counter(
                    &mut experience_title_counts,
                    payload.get("title").and_then(Value::as_str),
                );
            }
            _ => {}
        }
    }

    Ok(json!({
        "files": files
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>(),
        "dateBuckets": date_buckets.into_iter().collect::<Vec<_>>(),
        "totalEvents": events.len(),
        "stageCounts": stage_counts,
        "uniqueSessions": sessions.len(),
        "promptAssembly": {
            "count": prompt_assembly_count,
            "avgEstimatedTokens": average_number(&prompt_estimated_tokens, 2),
            "avgSystemPromptChars": average_number(&prompt_chars, 2)
        },
        "afterTurn": {
            "decisionCounts": decision_counts,
            "skipReasonCounts": skip_reason_counts
        },
        "durableExtraction": {
            "count": durable_count,
            "notesSavedTotal": durable_notes_saved_total,
            "nonZeroSaveCount": durable_non_zero_save_count,
            "zeroSaveCount": durable_zero_save_count,
            "saveRate": if durable_count > 0 {
                json!(round_to(durable_non_zero_save_count as f64 / durable_count as f64, 4))
            } else {
                Value::Null
            },
            "topReasons": sorted_counter_entries(top_reason_counts, "reason")
                .into_iter()
                .take(10)
                .collect::<Vec<_>>()
        },
        "experienceExtraction": {
            "statusCounts": experience_extract_status_counts,
            "decisionCounts": experience_extract_decision_counts,
            "writtenCount": experience_extract_written_count,
            "updatedCount": experience_extract_updated_count,
            "deletedCount": experience_extract_deleted_count
        },
        "experienceWrite": {
            "statusCounts": experience_status_counts,
            "actionCounts": experience_action_counts,
            "titles": sorted_counter_entries(experience_title_counts, "title")
                .into_iter()
                .take(10)
                .collect::<Vec<_>>()
        }
    }))
}

pub(super) fn prompt_journal_candidate_files(state: &GatewayState, params: &Value) -> Vec<PathBuf> {
    if let Some(file) = string_param(params, &["file"]) {
        return vec![expand_user_path(&file)];
    }

    let dir = string_param(params, &["dir"])
        .map(|dir| expand_user_path(&dir))
        .unwrap_or_else(|| state.state_dir.join("logs").join("memory-prompt-journal"));
    let mut files = std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("jsonl"))
        .collect::<Vec<_>>();
    files.sort();

    if let Some(date) = string_param(params, &["date"]) {
        let target = format!("{date}.jsonl");
        return files
            .into_iter()
            .filter(|path| {
                path.file_name().and_then(|value| value.to_str()) == Some(target.as_str())
            })
            .collect();
    }

    let days = params
        .get("days")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as usize;
    files
        .into_iter()
        .rev()
        .take(days)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

pub(super) fn read_prompt_journal_events(path: &Path) -> Vec<Value> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect()
}

pub(super) fn increment_counter(target: &mut BTreeMap<String, u64>, key: Option<&str>) {
    let Some(key) = key.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    *target.entry(key.to_string()).or_insert(0) += 1;
}

pub(super) fn average_number(values: &[f64], digits: u32) -> Value {
    if values.is_empty() {
        return Value::Null;
    }
    let total = values.iter().sum::<f64>();
    json!(round_to(total / values.len() as f64, digits))
}

pub(super) fn round_to(value: f64, digits: u32) -> f64 {
    let factor = 10_f64.powi(digits as i32);
    (value * factor).round() / factor
}

pub(super) fn sorted_counter_entries(counts: BTreeMap<String, u64>, key_name: &str) -> Vec<Value> {
    let mut entries = counts.into_iter().collect::<Vec<_>>();
    entries.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    entries
        .into_iter()
        .map(|(key, count)| json!({ key_name: key, "count": count }))
        .collect()
}
