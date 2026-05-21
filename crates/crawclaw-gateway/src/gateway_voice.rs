use super::*;

pub(super) const QWEN3_TTS_PROVIDER_ID: &str = "qwen3-tts";
pub(super) const QWEN3_TTS_PROVIDER_LABEL: &str = "Qwen3-TTS (local)";
pub(super) const QWEN3_TTS_MODELS: &[&str] = &[
    "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
];
pub(super) const QWEN3_TTS_VOICES: &[&str] = &[
    "serena", "vivian", "uncle_fu", "ryan", "aiden", "ono_anna", "sohee", "eric", "dylan",
];

pub(super) fn tts_status(state: &GatewayState) -> Value {
    let config = read_config_value(&config_path(state)).unwrap_or(Value::Object(Map::new()));
    let auto = tts_auto_mode(&config);
    let enabled = auto != "off";
    let provider = active_tts_provider(&config);
    let provider_states = tts_provider_catalog(&config)
        .into_iter()
        .map(|provider| {
            json!({
                "id": provider["id"].clone(),
                "label": provider["name"].clone(),
                "configured": provider["configured"].clone()
            })
        })
        .collect::<Vec<_>>();
    json!({
        "enabled": enabled,
        "auto": auto,
        "provider": provider,
        "fallbackProvider": Value::Null,
        "fallbackProviders": [],
        "providerStates": provider_states,
        "implementation": "rust-native"
    })
}

pub(super) fn tts_providers(state: &GatewayState) -> Value {
    let config = read_config_value(&config_path(state)).unwrap_or(Value::Object(Map::new()));
    json!({
        "providers": tts_provider_catalog(&config),
        "active": active_tts_provider(&config),
        "implementation": "rust-native"
    })
}

pub(super) fn tts_set_enabled(state: &GatewayState, enabled: bool) -> Result<Value, String> {
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(&mut config, "messages.tts.enabled", Value::Bool(enabled))?;
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "enabled": enabled, "config": config }))
}

pub(super) fn tts_set_provider(state: &GatewayState, params: Value) -> Result<Value, String> {
    let requested = required_param(&params, &["provider", "id"])?;
    let provider = canonical_native_tts_provider(&requested)
        .ok_or_else(|| "Invalid provider. Use a registered TTS provider id.".to_string())?
        .to_string();
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(
        &mut config,
        "messages.tts.provider",
        Value::String(provider.clone()),
    )?;
    write_config_value(&path, &config)?;
    Ok(json!({ "ok": true, "provider": provider, "config": config }))
}

pub(super) fn canonical_native_tts_provider(provider: &str) -> Option<&'static str> {
    match provider.trim().to_lowercase().as_str() {
        "qwen3-tts" | "qwen3tts" => Some(QWEN3_TTS_PROVIDER_ID),
        _ => None,
    }
}

pub(super) fn tts_auto_mode(config: &Value) -> &'static str {
    let Some(tts) = get_json_path(config, "messages.tts").and_then(Value::as_object) else {
        return "off";
    };
    match tts.get("auto").and_then(Value::as_str) {
        Some("off") => "off",
        Some("always") => "always",
        Some("inbound") => "inbound",
        Some("tagged") => "tagged",
        _ if tts.get("enabled").and_then(Value::as_bool).unwrap_or(false) => "always",
        _ => "off",
    }
}

pub(super) fn active_tts_provider(config: &Value) -> String {
    if let Some(provider) = get_json_path(config, "messages.tts.provider")
        .and_then(Value::as_str)
        .and_then(canonical_native_tts_provider)
    {
        return provider.to_string();
    }
    tts_provider_catalog(config)
        .into_iter()
        .find(|provider| provider["configured"].as_bool().unwrap_or(false))
        .and_then(|provider| provider["id"].as_str().map(ToOwned::to_owned))
        .unwrap_or_default()
}

pub(super) fn tts_provider_catalog(config: &Value) -> Vec<Value> {
    vec![json!({
        "id": QWEN3_TTS_PROVIDER_ID,
        "name": QWEN3_TTS_PROVIDER_LABEL,
        "configured": qwen3_tts_configured(config),
        "models": QWEN3_TTS_MODELS,
        "voices": QWEN3_TTS_VOICES,
        "runtime": qwen3_tts_runtime(config),
        "baseUrl": qwen3_tts_base_url(config),
        "supported": qwen3_tts_supported(config)
    })]
}

pub(super) fn qwen3_tts_config(config: &Value) -> Option<&Map<String, Value>> {
    get_json_path(config, "messages.tts.providers.qwen3-tts").and_then(Value::as_object)
}

pub(super) fn qwen3_tts_enabled(config: &Value) -> bool {
    qwen3_tts_config(config)
        .and_then(|config| config.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(super) fn qwen3_tts_configured(config: &Value) -> bool {
    qwen3_tts_enabled(config) && qwen3_tts_supported(config)
}

pub(super) fn qwen3_tts_runtime(config: &Value) -> &'static str {
    qwen3_tts_runtime_defaults(qwen3_tts_raw_runtime(config)).0
}

pub(super) fn qwen3_tts_base_url(config: &Value) -> String {
    qwen3_tts_config(config)
        .and_then(|config| config.get("baseUrl"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
        .unwrap_or_else(|| {
            qwen3_tts_runtime_defaults(qwen3_tts_raw_runtime(config))
                .1
                .to_string()
        })
}

pub(super) fn qwen3_tts_supported(config: &Value) -> bool {
    let experimental = qwen3_tts_config(config)
        .and_then(|config| config.get("experimental"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    qwen3_tts_runtime_defaults(qwen3_tts_raw_runtime(config)).2 || experimental
}

pub(super) fn qwen3_tts_raw_runtime(config: &Value) -> &str {
    qwen3_tts_config(config)
        .and_then(|config| config.get("runtime"))
        .and_then(Value::as_str)
        .unwrap_or("auto")
}

pub(super) fn qwen3_tts_runtime_defaults(raw_runtime: &str) -> (&'static str, &'static str, bool) {
    match raw_runtime {
        "mlx-audio" => (
            "mlx-audio",
            "http://127.0.0.1:8011",
            cfg!(target_os = "macos") && cfg!(target_arch = "aarch64"),
        ),
        "vllm-omni" => (
            "vllm-omni",
            "http://127.0.0.1:8010",
            cfg!(target_os = "linux"),
        ),
        "qwen3-tts.cpp" => ("qwen3-tts.cpp", "http://127.0.0.1:8012", false),
        "qwen-tts" => (
            "qwen-tts",
            "http://127.0.0.1:8013",
            qwen3_tts_platform_supported(),
        ),
        "cpu" => (
            "cpu",
            "http://127.0.0.1:8013",
            qwen3_tts_platform_supported(),
        ),
        _ if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") => {
            ("mlx-audio", "http://127.0.0.1:8011", true)
        }
        _ if cfg!(target_os = "linux") || cfg!(target_os = "windows") => {
            ("qwen-tts", "http://127.0.0.1:8013", true)
        }
        _ => (
            "qwen-tts",
            "http://127.0.0.1:8013",
            qwen3_tts_platform_supported(),
        ),
    }
}

pub(super) fn qwen3_tts_platform_supported() -> bool {
    cfg!(target_os = "macos") || cfg!(target_os = "linux") || cfg!(target_os = "windows")
}

pub(super) fn qwen3_tts_default_profile() -> Value {
    json!({
        "source": "preset",
        "quality": "balanced",
        "voice": "vivian",
        "language": "Auto",
        "instructions": "natural, warm, expressive"
    })
}

pub(super) fn qwen3_tts_provider_config(config: &Value) -> Map<String, Value> {
    let mut provider_config = qwen3_tts_config(config).cloned().unwrap_or_default();
    provider_config
        .entry("runtime".to_string())
        .or_insert_with(|| Value::String(qwen3_tts_runtime(config).to_string()));
    provider_config
        .entry("baseUrl".to_string())
        .or_insert_with(|| Value::String(qwen3_tts_base_url(config)));
    provider_config
        .entry("defaultProfile".to_string())
        .or_insert_with(|| Value::String("assistant".to_string()));
    let profiles = provider_config
        .entry("profiles".to_string())
        .or_insert_with(|| json!({ "assistant": qwen3_tts_default_profile() }));
    if profiles.as_object().map(Map::is_empty).unwrap_or(true) {
        *profiles = json!({ "assistant": qwen3_tts_default_profile() });
    }
    provider_config
}

pub(super) fn qwen3_tts_provider_overrides(params: &Value, voice: Option<&str>) -> Value {
    let mut overrides = Map::new();
    if let Some(voice) = voice {
        overrides.insert("voice".to_string(), Value::String(voice.to_string()));
    }
    for (source_key, target_key) in [
        ("profile", "profile"),
        ("model", "model"),
        ("language", "language"),
        ("instructions", "instructions"),
    ] {
        if let Some(value) = string_param(params, &[source_key]) {
            overrides.insert(target_key.to_string(), Value::String(value));
        }
    }
    Value::Object(overrides)
}

pub(super) fn qwen3_tts_audio_mime_type(output_format: &str) -> String {
    match output_format {
        "opus" => "audio/opus",
        "pcm" => "audio/L16",
        "mp3" => "audio/mpeg",
        "wav" | "wave" => "audio/wav",
        other => return format!("audio/{other}"),
    }
    .to_string()
}

pub(super) async fn tts_convert(state: &GatewayState, params: Value) -> Result<Value, String> {
    let text = required_param(&params, &["text", "message"])?;
    let config = read_config_value(&config_path(state)).unwrap_or(Value::Object(Map::new()));
    let provider = string_param(&params, &["provider"])
        .or_else(|| {
            get_json_path(&config, "messages.tts.provider")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "qwen3-tts".to_string());
    let provider = canonical_native_tts_provider(&provider)
        .ok_or_else(|| format!("Rust TTS provider is not implemented: {provider}"))?
        .to_string();
    let voice = string_param(&params, &["voice", "voiceId"]).or_else(|| {
        get_json_path(
            &config,
            &format!("messages.tts.providers.{provider}.voiceId"),
        )
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    });
    if !qwen3_tts_supported(&config) {
        return Err(format!("{provider} is not supported on this platform"));
    }
    if let Some(max_length) = get_json_path(&config, "messages.tts.maxTextLength")
        .and_then(Value::as_u64)
        .or_else(|| params.get("maxTextLength").and_then(Value::as_u64))
    {
        if text.chars().count() as u64 > max_length {
            return Err(format!(
                "TTS input exceeds messages.tts.maxTextLength ({max_length})"
            ));
        }
    }
    let provider_config = qwen3_tts_provider_config(&config);
    let target = string_param(&params, &["target"]).unwrap_or_else(|| "audio-file".to_string());
    let mut input = json!({
        "text": text,
        "target": target,
        "provider": provider,
        "providerConfig": provider_config.clone(),
        "providerOverrides": qwen3_tts_provider_overrides(&params, voice.as_deref())
    });
    if let Some(agent_id) = string_param(&params, &["agentId"]) {
        input["agentId"] = Value::String(agent_id);
    }
    if let Some(timeout_ms) = params.get("timeoutMs").and_then(Value::as_u64) {
        input["timeoutMs"] = Value::Number(timeout_ms.into());
    } else if let Some(timeout_ms) =
        get_json_path(&config, "messages.tts.timeoutMs").and_then(Value::as_u64)
    {
        input["timeoutMs"] = Value::Number(timeout_ms.into());
    }
    if provider_config
        .get("autoStart")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        crawclaw_native_plugins::registry::dispatch_builtin_native_plugin_operation(
            "qwen3-tts",
            "service-start",
            json!({ "providerConfig": provider_config.clone() }),
        )
        .await
        .map_err(|error| error.to_string())?;
    }
    let native = crawclaw_native_plugins::registry::dispatch_builtin_native_plugin_operation(
        "qwen3-tts",
        "synthesize",
        input,
    )
    .await
    .map_err(|error| error.to_string())?;
    let audio_base64 = native
        .get("audioBase64")
        .and_then(Value::as_str)
        .ok_or_else(|| "Qwen3-TTS did not return audioBase64".to_string())?
        .to_string();
    let output_format = native
        .get("outputFormat")
        .and_then(Value::as_str)
        .unwrap_or("wav")
        .to_string();
    let result = json!({
        "ok": true,
        "status": "generated",
        "provider": provider,
        "voice": voice,
        "text": text,
        "audio": {
            "base64": audio_base64,
            "mimeType": qwen3_tts_audio_mime_type(&output_format),
            "format": output_format
        },
        "audioBase64": audio_base64,
        "outputFormat": output_format,
        "artifact": Value::Null,
        "native": native,
        "implementation": "rust-native"
    });
    append_jsonl(
        &state.runtime_root.join("tts").join("requests.jsonl"),
        &result,
    )?;
    Ok(result)
}

pub(super) fn talk_config(state: &GatewayState) -> Result<Value, String> {
    let config = read_config_value(&config_path(state))?;
    Ok(json!({
        "config": {
            "talk": get_json_path(&config, "talk").cloned(),
            "session": {
                "mainKey": "agent:main:main"
            },
            "ui": get_json_path(&config, "ui").cloned()
        }
    }))
}

pub(super) fn talk_mode(state: &GatewayState, params: Value) -> Result<Value, String> {
    let enabled = params
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(|| "talk.mode requires enabled".to_string())?;
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    set_json_path(&mut config, "talk.enabled", Value::Bool(enabled))?;
    write_config_value(&path, &config)?;
    emit(state, "talk.mode", json!({ "enabled": enabled }));
    Ok(json!({ "ok": true, "enabled": enabled }))
}

pub(super) async fn talk_speak(state: &GatewayState, params: Value) -> Result<Value, String> {
    let speech = tts_convert(state, params.clone()).await?;
    let payload = json!({
        "ok": true,
        "status": speech.get("status").cloned().unwrap_or_else(|| Value::String("generated".to_string())),
        "speech": speech,
        "implementation": "rust-native"
    });
    emit(state, "talk.speak", payload.clone());
    Ok(payload)
}

pub(super) async fn voice_qwen3_tts(
    state: &GatewayState,
    method: &str,
    mut params: Value,
) -> Result<Value, String> {
    let operation = method.rsplit('.').next().unwrap_or("preview").to_string();
    if operation == "uploadReferenceAudio" {
        return Err(
            "voice.qwen3Tts.uploadReferenceAudio is not implemented in Rust yet".to_string(),
        );
    }
    let Some(object) = params.as_object_mut() else {
        return Err("voice.qwen3Tts.preview requires an object payload".to_string());
    };
    object.insert(
        "provider".to_string(),
        Value::String(QWEN3_TTS_PROVIDER_ID.to_string()),
    );
    let mut result = tts_convert(state, params).await?;
    if let Some(object) = result.as_object_mut() {
        object.insert("operation".to_string(), Value::String(operation));
    }
    append_jsonl(
        &state.runtime_root.join("tts").join("qwen3-tts.jsonl"),
        &result,
    )?;
    Ok(result)
}

pub(super) fn voice_overview(state: &GatewayState) -> Value {
    json!({
        "tts": tts_status(state),
        "voicewake": voicewake_get(state),
        "implementation": "rust-native"
    })
}

pub(super) fn voicewake_get(state: &GatewayState) -> Value {
    let config = read_config_value(&config_path(state)).unwrap_or(Value::Object(Map::new()));
    json!({
        "config": get_json_path(&config, "voicewake").cloned().unwrap_or(Value::Null),
        "implementation": "rust-native"
    })
}

pub(super) fn voicewake_set(state: &GatewayState, params: Value) -> Result<Value, String> {
    let patch = config_patch_value(&params)?;
    let path = config_path(state);
    let mut config = read_config_value(&path)?;
    let mut current = get_json_path(&config, "voicewake")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    merge_json(&mut current, patch);
    set_json_path(&mut config, "voicewake", current.clone())?;
    write_config_value(&path, &config)?;
    emit(state, "voicewake.changed", json!({ "config": current }));
    Ok(json!({ "ok": true, "config": current }))
}
