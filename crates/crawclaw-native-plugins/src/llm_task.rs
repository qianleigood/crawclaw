use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{invalid_input, NativeError, NativeResult};

#[derive(Debug, Clone, Deserialize)]
pub struct LlmTaskPrepareInput {
    pub params: Value,
    #[serde(rename = "pluginConfig", alias = "plugin_config")]
    pub plugin_config: Value,
    #[serde(rename = "defaultModel", alias = "default_model")]
    pub default_model: Option<String>,
    #[serde(rename = "workspaceDir", alias = "workspace_dir")]
    pub workspace_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedLlmTask {
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub think_level: Option<String>,
    pub timeout_ms: u64,
    pub full_prompt: String,
    pub workspace_dir: String,
    pub stream_params: Value,
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
}

fn read_number(value: &Value, key: &str) -> Option<u64> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .filter(|entry| *entry > 0)
}

fn read_model_pair(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim();
    let (provider, model) = trimmed.split_once('/')?;
    if provider.trim().is_empty() || model.trim().is_empty() {
        return None;
    }
    Some((provider.trim().to_string(), model.trim().to_string()))
}

fn normalize_think_level(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "off" => Some("off"),
        "on" => Some("low"),
        "minimal" => Some("minimal"),
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "adaptive" => Some("adaptive"),
        "xhigh" => Some("xhigh"),
        _ => None,
    }
}

fn collect_allowed_models(plugin_config: &Value) -> Vec<String> {
    plugin_config
        .get("allowedModels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .collect()
}

pub fn prepare_llm_task(input: LlmTaskPrepareInput) -> NativeResult<PreparedLlmTask> {
    let prompt =
        read_string(&input.params, "prompt").ok_or_else(|| invalid_input("prompt required"))?;
    let (default_provider, default_model) = input
        .default_model
        .as_deref()
        .and_then(read_model_pair)
        .map(|(provider, model)| (Some(provider), Some(model)))
        .unwrap_or((None, None));

    let provider = read_string(&input.params, "provider")
        .or_else(|| read_string(&input.plugin_config, "defaultProvider"))
        .or(default_provider)
        .ok_or_else(|| invalid_input("provider/model could not be resolved"))?;
    let model = read_string(&input.params, "model")
        .or_else(|| read_string(&input.plugin_config, "defaultModel"))
        .or(default_model)
        .ok_or_else(|| invalid_input("provider/model could not be resolved"))?;
    let model_key = format!("{provider}/{model}");
    let allowed = collect_allowed_models(&input.plugin_config);
    if !allowed.is_empty() && !allowed.iter().any(|entry| entry == &model_key) {
        return Err(invalid_input(format!(
            "Model not allowed by llm-task plugin config: {model_key}. Allowed models: {}",
            allowed.join(", ")
        )));
    }

    let think_level = read_string(&input.params, "thinking")
        .map(|raw| {
            normalize_think_level(&raw)
                .map(ToString::to_string)
                .ok_or_else(|| invalid_input(format!("Invalid thinking level \"{raw}\".")))
        })
        .transpose()?;
    if think_level.as_deref() == Some("xhigh")
        && !(provider.to_ascii_lowercase().contains("openai")
            && (model.contains("gpt-5.4") || model.contains("gpt-5.5")))
    {
        return Err(invalid_input(
            "Thinking level \"xhigh\" is only supported for xhigh-capable OpenAI models.",
        ));
    }
    let timeout_ms = read_number(&input.params, "timeoutMs")
        .or_else(|| read_number(&input.plugin_config, "timeoutMs"))
        .unwrap_or(30_000);
    let auth_profile_id = read_string(&input.params, "authProfileId")
        .or_else(|| read_string(&input.plugin_config, "defaultAuthProfileId"));
    let max_tokens = input
        .params
        .get("maxTokens")
        .cloned()
        .or_else(|| input.plugin_config.get("maxTokens").cloned())
        .unwrap_or(Value::Null);
    let temperature = input
        .params
        .get("temperature")
        .cloned()
        .unwrap_or(Value::Null);
    let input_json =
        serde_json::to_string_pretty(input.params.get("input").unwrap_or(&Value::Null))?;
    let system = [
        "You are a JSON-only function.",
        "Return ONLY a valid JSON value.",
        "Do not wrap in markdown fences.",
        "Do not include commentary.",
        "Do not call tools.",
    ]
    .join("\n");
    let full_prompt = format!("{system}\n\nTASK:\n{prompt}\n\nINPUT_JSON:\n{input_json}\n");

    Ok(PreparedLlmTask {
        provider,
        model,
        auth_profile_id,
        think_level,
        timeout_ms,
        full_prompt,
        workspace_dir: input.workspace_dir,
        stream_params: json!({
            "temperature": temperature,
            "maxTokens": max_tokens,
        }),
    })
}

fn strip_code_fences(text: &str) -> &str {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let Some(end) = rest.strip_suffix("```") else {
        return trimmed;
    };
    let body = end.trim_start();
    if let Some(json_body) = body.strip_prefix("json") {
        json_body.trim()
    } else {
        body.trim()
    }
}

fn collect_text(payloads: Option<&Vec<Value>>) -> String {
    payloads
        .into_iter()
        .flatten()
        .filter(|payload| payload.get("isError").and_then(Value::as_bool) != Some(true))
        .filter_map(|payload| payload.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

pub fn complete_llm_task(input: Value) -> NativeResult<Value> {
    let text = collect_text(input.get("payloads").and_then(Value::as_array));
    if text.is_empty() {
        return Err(invalid_input("LLM returned empty output"));
    }
    let parsed: Value = serde_json::from_str(strip_code_fences(&text))
        .map_err(|_| invalid_input("LLM returned invalid JSON"))?;
    if let Some(schema) = input.get("schema").filter(|value| value.is_object()) {
        let validator = jsonschema::validator_for(schema)
            .map_err(|error| NativeError::Schema(format!("invalid schema: {error}")))?;
        if let Err(error) = validator.validate(&parsed) {
            return Err(NativeError::Schema(format!(
                "LLM JSON did not match schema: {error}"
            )));
        }
    }
    let provider = read_string(&input, "provider");
    let model = read_string(&input, "model");
    Ok(json!({
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&parsed)? }],
        "details": {
            "json": parsed,
            "provider": provider,
            "model": model
        }
    }))
}
