use std::time::Duration;

use reqwest::StatusCode;
use serde_json::{json, Map, Value};

use crate::{NativeError, NativeResult};

const DEFAULT_PRESET_INSTRUCTIONS: &str = "natural, warm, expressive";
const PRESET_FAST_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice";
const PRESET_BALANCED_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice";
const CLONE_FAST_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-0.6B-Base";
const CLONE_BALANCED_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-1.7B-Base";
const VOICE_DESIGN_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign";

fn invalid(message: impl Into<String>) -> NativeError {
    NativeError::InvalidInput(message.into())
}

fn as_object<'a>(value: &'a Value, label: &str) -> NativeResult<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("Qwen3-TTS {label} must be an object")))
}

fn object_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> NativeResult<&'a Map<String, Value>> {
    object
        .get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(format!("Qwen3-TTS input missing {key} object")))
}

fn string_field<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn required_string(object: &Map<String, Value>, key: &str) -> NativeResult<String> {
    string_field(object, key)
        .map(ToOwned::to_owned)
        .ok_or_else(|| invalid(format!("Qwen3-TTS input missing {key}")))
}

fn trailing_slash_trimmed(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}

fn response_format(input: &Map<String, Value>) -> String {
    if let Some(value) = string_field(input, "responseFormat") {
        return value.to_string();
    }
    match string_field(input, "target") {
        Some("telephony") => "pcm".to_string(),
        Some("voice-note") => "opus".to_string(),
        _ => "wav".to_string(),
    }
}

fn profile_id<'a>(
    input: &'a Map<String, Value>,
    provider_config: &'a Map<String, Value>,
    overrides: &'a Map<String, Value>,
) -> &'a str {
    if let Some(profile) = string_field(overrides, "profile") {
        return profile;
    }
    if let Some(agent_id) = string_field(input, "agentId") {
        if let Some(agent_profile) = provider_config
            .get("agentProfiles")
            .and_then(Value::as_object)
            .and_then(|profiles| profiles.get(agent_id))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return agent_profile;
        }
    }
    string_field(provider_config, "defaultProfile").unwrap_or("assistant")
}

fn resolve_profile<'a>(
    input: &'a Map<String, Value>,
    provider_config: &'a Map<String, Value>,
    overrides: &'a Map<String, Value>,
) -> NativeResult<&'a Map<String, Value>> {
    let selected_profile_id = profile_id(input, provider_config, overrides);
    provider_config
        .get("profiles")
        .and_then(Value::as_object)
        .and_then(|profiles| profiles.get(selected_profile_id))
        .and_then(Value::as_object)
        .ok_or_else(|| {
            invalid(format!(
                "Qwen3-TTS profile \"{selected_profile_id}\" is not defined"
            ))
        })
}

fn preset_model(profile: &Map<String, Value>, overrides: &Map<String, Value>) -> String {
    if let Some(model) = string_field(overrides, "model") {
        return model.to_string();
    }
    match string_field(profile, "quality") {
        Some("fast") => PRESET_FAST_MODEL.to_string(),
        _ => PRESET_BALANCED_MODEL.to_string(),
    }
}

fn clone_model(profile: &Map<String, Value>, overrides: &Map<String, Value>) -> String {
    if let Some(model) = string_field(overrides, "model") {
        return model.to_string();
    }
    match string_field(profile, "quality") {
        Some("clone-fast") => CLONE_FAST_MODEL.to_string(),
        _ => CLONE_BALANCED_MODEL.to_string(),
    }
}

fn set_optional_string(payload: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        payload.insert(key.to_string(), Value::String(value));
    }
}

pub fn build_synthesis_payload(input_value: &Value) -> NativeResult<Value> {
    let input = as_object(input_value, "input")?;
    let text = required_string(input, "text")?;
    let provider_config = object_field(input, "providerConfig")?;
    let empty_overrides = Map::new();
    let overrides = input
        .get("providerOverrides")
        .and_then(Value::as_object)
        .unwrap_or(&empty_overrides);
    let profile = resolve_profile(input, provider_config, overrides)?;
    let runtime = string_field(provider_config, "runtime")
        .unwrap_or("qwen-tts")
        .to_string();
    let response_format = response_format(input);
    let source = string_field(profile, "source").unwrap_or("preset");

    let mut payload = Map::new();
    payload.insert("text".to_string(), Value::String(text));
    payload.insert("responseFormat".to_string(), Value::String(response_format));
    payload.insert("runtime".to_string(), Value::String(runtime));

    match source {
        "clone" => {
            let ref_text = required_string(profile, "refText")?;
            payload.insert("task".to_string(), Value::String("clone".to_string()));
            payload.insert(
                "model".to_string(),
                Value::String(clone_model(profile, overrides)),
            );
            payload.insert(
                "refAudio".to_string(),
                Value::String(required_string(profile, "refAudio")?),
            );
            payload.insert("refText".to_string(), Value::String(ref_text));
            set_optional_string(
                &mut payload,
                "language",
                string_field(overrides, "language")
                    .or_else(|| string_field(profile, "language"))
                    .map(ToOwned::to_owned),
            );
            set_optional_string(
                &mut payload,
                "instructions",
                string_field(overrides, "instructions")
                    .or_else(|| string_field(profile, "instructions"))
                    .map(ToOwned::to_owned),
            );
        }
        "design" => {
            payload.insert("task".to_string(), Value::String("design".to_string()));
            payload.insert(
                "model".to_string(),
                Value::String(
                    string_field(overrides, "model")
                        .unwrap_or(VOICE_DESIGN_MODEL)
                        .to_string(),
                ),
            );
            payload.insert(
                "prompt".to_string(),
                Value::String(required_string(profile, "prompt")?),
            );
            set_optional_string(
                &mut payload,
                "language",
                string_field(overrides, "language")
                    .or_else(|| string_field(profile, "language"))
                    .map(ToOwned::to_owned),
            );
        }
        _ => {
            payload.insert("task".to_string(), Value::String("preset".to_string()));
            payload.insert(
                "model".to_string(),
                Value::String(preset_model(profile, overrides)),
            );
            payload.insert(
                "voice".to_string(),
                Value::String(
                    string_field(overrides, "voice")
                        .or_else(|| string_field(profile, "voice"))
                        .unwrap_or("vivian")
                        .to_string(),
                ),
            );
            payload.insert(
                "language".to_string(),
                Value::String(
                    string_field(overrides, "language")
                        .or_else(|| string_field(profile, "language"))
                        .unwrap_or("Auto")
                        .to_string(),
                ),
            );
            payload.insert(
                "instructions".to_string(),
                Value::String(
                    string_field(overrides, "instructions")
                        .or_else(|| string_field(profile, "instructions"))
                        .unwrap_or(DEFAULT_PRESET_INSTRUCTIONS)
                        .to_string(),
                ),
            );
        }
    }

    Ok(Value::Object(payload))
}

fn sidecar_url(input: &Value) -> NativeResult<String> {
    let input = as_object(input, "input")?;
    let provider_config = object_field(input, "providerConfig")?;
    let base_url = string_field(provider_config, "baseUrl")
        .ok_or_else(|| invalid("Qwen3-TTS input missing providerConfig.baseUrl"))?;
    let path = if string_field(input, "target") == Some("telephony") {
        "synthesize-telephony"
    } else {
        "synthesize"
    };
    Ok(format!("{}/{}", trailing_slash_trimmed(base_url), path))
}

fn timeout(input: &Value) -> Duration {
    let timeout_ms = input
        .as_object()
        .and_then(|object| object.get("timeoutMs"))
        .and_then(Value::as_u64)
        .unwrap_or(30_000);
    Duration::from_millis(timeout_ms)
}

fn validate_sidecar_response(status: StatusCode, payload: Value) -> NativeResult<Value> {
    if !status.is_success() {
        return Err(NativeError::Message(format!(
            "Qwen3-TTS sidecar error ({}): {}",
            status.as_u16(),
            payload
        )));
    }
    let object = as_object(&payload, "sidecar response")?;
    let audio_base64 = string_field(object, "audioBase64");
    let output_format = string_field(object, "outputFormat");
    if audio_base64.is_none() || output_format.is_none() {
        return Err(invalid("Qwen3-TTS sidecar returned an incomplete response"));
    }
    Ok(json!(object))
}

pub async fn synthesize_qwen3_tts(input: Value) -> NativeResult<Value> {
    let payload = build_synthesis_payload(&input)?;
    let url = sidecar_url(&input)?;
    let client = reqwest::Client::builder()
        .timeout(timeout(&input))
        .build()?;
    let response = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&payload)
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    let parsed = serde_json::from_str(&body).unwrap_or_else(|_| json!({ "message": body }));
    validate_sidecar_response(status, parsed)
}
