use std::path::Path;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use crawclaw_providers::{
    send_native_provider_conversation_with_options, NativeProviderConfig, NativeProviderMessage,
    NativeProviderRequestOptions,
};
use crawclaw_runtime::{
    DesktopModelProfileRecord, DesktopModelProfileStore, DesktopModelProfileStoreError,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::models::{DesktopModelProfileSummary, DesktopState, RuntimeCheck};

use super::{
    authorize_headers, emit_operation_failed, emit_state_changed, persist_desktop_preferences,
    GatewayState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModelProfileSetupRequest {
    source: Option<String>,
    provider: String,
    model: String,
    label: Option<String>,
    base_url: Option<String>,
    api: Option<String>,
    api_version: Option<String>,
    api_key: Option<String>,
    auth_method: Option<String>,
}

struct ModelProfileDraft {
    id: String,
    label: String,
    model_ref: String,
    source: String,
    provider: String,
    model: String,
    auth_method: String,
    base_url: Option<String>,
    api: Option<String>,
    api_version: Option<String>,
    api_key: Option<String>,
}

pub(super) async fn test_and_save_model_profile(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    Json(payload): Json<ModelProfileSetupRequest>,
) -> Result<Json<DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    let draft = normalize_model_profile_request(payload).map_err(|message| {
        emit_operation_failed(&state, "model_profile_invalid", message);
        StatusCode::BAD_REQUEST
    })?;

    probe_model_profile(&draft).await.map_err(|message| {
        emit_operation_failed(&state, "model_profile_probe_failed", message);
        StatusCode::BAD_GATEWAY
    })?;

    let api_key_ref =
        write_model_profile_api_key(&state.runtime_root, &draft).map_err(|message| {
            emit_operation_failed(&state, "model_profile_store_failed", message);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let profile = DesktopModelProfileRecord {
        id: draft.id,
        label: draft.label,
        model_ref: draft.model_ref,
        source: draft.source,
        provider: draft.provider,
        model: draft.model,
        auth_method: draft.auth_method,
        base_url: draft.base_url,
        api: draft.api,
        api_version: draft.api_version,
        api_key_ref,
        last_connection_status: "connected".to_string(),
        last_connection_detail: None,
        last_connected_at: Some("刚刚".to_string()),
    };

    state
        .model_profile_store
        .upsert_profile(profile.clone())
        .map_err(|error| model_profile_store_status(&state, error))?;
    write_active_model_profile_config(&state.runtime_root, &profile).map_err(|message| {
        emit_operation_failed(&state, "model_profile_apply_failed", message);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let updated_preferences = {
        let desktop_state = state.desktop_state.read().await;
        let mut preferences = desktop_state.preferences.clone();
        preferences.selected_model = profile.model_ref.clone();
        preferences.task_defaults.selected_model = profile.model_ref.clone();
        if !preferences
            .model_options
            .iter()
            .any(|option| option == &profile.model_ref)
        {
            preferences.model_options.push(profile.model_ref.clone());
        }
        preferences.model_profiles = load_model_profile_summaries(&state.model_profile_store)
            .map_err(|error| model_profile_store_status(&state, error))?;
        preferences
    };

    persist_desktop_preferences(&state, &updated_preferences)?;
    {
        let mut desktop_state = state.desktop_state.write().await;
        desktop_state.preferences = updated_preferences;
    }
    emit_state_changed(&state).await
}

pub(super) fn merge_persisted_model_profiles(
    desktop_state: &mut DesktopState,
    model_profile_store: &DesktopModelProfileStore,
) {
    match load_model_profile_summaries(model_profile_store) {
        Ok(profiles) => {
            for profile in &profiles {
                if !desktop_state
                    .preferences
                    .model_options
                    .iter()
                    .any(|option| option == &profile.model_ref)
                {
                    desktop_state
                        .preferences
                        .model_options
                        .push(profile.model_ref.clone());
                }
            }
            desktop_state.preferences.model_profiles = profiles;
        }
        Err(error) => desktop_state
            .conversation
            .runtime_checks
            .push(RuntimeCheck {
                label: "Desktop model profiles".to_string(),
                value: error.to_string(),
                tone: "error".to_string(),
            }),
    }
}

pub(super) fn apply_active_model_profile_for_selection(
    runtime_root: &Path,
    model_profile_store: &DesktopModelProfileStore,
    selected_model: &str,
) -> Result<bool, DesktopModelProfileStoreError> {
    let profiles = model_profile_store.load_profiles()?;
    let Some(profile) = profiles
        .iter()
        .find(|profile| profile.model_ref == selected_model)
    else {
        return Ok(false);
    };
    write_active_model_profile_config(runtime_root, profile)
        .map_err(DesktopModelProfileStoreError::Io)?;
    Ok(true)
}

fn normalize_model_profile_request(
    payload: ModelProfileSetupRequest,
) -> Result<ModelProfileDraft, String> {
    let provider = required_trimmed(payload.provider, "provider")?;
    let model = required_trimmed(payload.model, "model")?;
    let source = optional_trimmed(payload.source).unwrap_or_else(|| "custom".to_string());
    if source != "builtin" && source != "custom" {
        return Err("Model profile source must be builtin or custom.".to_string());
    }
    let model_ref = format!("{provider}/{model}");
    let label = optional_trimmed(payload.label).unwrap_or_else(|| model_ref.clone());
    let api_key = optional_trimmed(payload.api_key);
    let auth_method = optional_trimmed(payload.auth_method).unwrap_or_else(|| {
        if api_key.is_some() {
            "api-key".to_string()
        } else {
            "local".to_string()
        }
    });
    if !matches!(auth_method.as_str(), "api-key" | "local" | "custom") {
        return Err("Model profile authMethod must be api-key, local, or custom.".to_string());
    }
    let id = slugify_model_profile_id(&model_ref);
    Ok(ModelProfileDraft {
        id,
        label,
        model_ref,
        source,
        provider,
        model,
        auth_method,
        base_url: optional_trimmed(payload.base_url),
        api: optional_trimmed(payload.api),
        api_version: optional_trimmed(payload.api_version),
        api_key,
    })
}

async fn probe_model_profile(draft: &ModelProfileDraft) -> Result<(), String> {
    let config = NativeProviderConfig {
        provider: draft.provider.clone(),
        base_url: draft.base_url.clone(),
        api_key: draft.api_key.clone(),
        model: Some(draft.model.clone()),
        api: draft.api.clone(),
        api_version: draft.api_version.clone(),
    };
    send_native_provider_conversation_with_options(
        &config,
        &[NativeProviderMessage::user("test connection")],
        &NativeProviderRequestOptions::default(),
    )
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn write_model_profile_api_key(
    runtime_root: &Path,
    draft: &ModelProfileDraft,
) -> Result<Option<Value>, String> {
    let Some(api_key) = draft.api_key.as_deref() else {
        return Ok(None);
    };
    let relative_path = format!("config/secrets/desktop-models/{}.key", draft.id);
    let path = runtime_root.join(&relative_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!("Failed to create model profile credential directory: {error}")
        })?;
    }
    std::fs::write(&path, format!("{api_key}\n"))
        .map_err(|error| format!("Failed to write model profile credential: {error}"))?;
    Ok(Some(json!({
        "source": "file",
        "id": relative_path
    })))
}

fn write_active_model_profile_config(
    runtime_root: &Path,
    profile: &DesktopModelProfileRecord,
) -> Result<(), String> {
    let config_dir = runtime_root.join("config");
    std::fs::create_dir_all(&config_dir)
        .map_err(|error| format!("Failed to create desktop provider config directory: {error}"))?;
    let mut object = Map::new();
    object.insert("runtime".to_string(), json!("native-provider"));
    object.insert("provider".to_string(), json!(&profile.provider));
    if let Some(base_url) = &profile.base_url {
        object.insert("baseUrl".to_string(), json!(base_url));
    }
    if let Some(api_key_ref) = &profile.api_key_ref {
        object.insert("apiKey".to_string(), api_key_ref.clone());
    }
    object.insert("model".to_string(), json!(&profile.model));
    if let Some(api) = &profile.api {
        object.insert("api".to_string(), json!(api));
    }
    if let Some(api_version) = &profile.api_version {
        object.insert("apiVersion".to_string(), json!(api_version));
    }
    std::fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&Value::Object(object))
            .map_err(|error| format!("Failed to serialize desktop provider config: {error}"))?,
    )
    .map_err(|error| format!("Failed to write desktop provider config: {error}"))
}

fn load_model_profile_summaries(
    model_profile_store: &DesktopModelProfileStore,
) -> Result<Vec<DesktopModelProfileSummary>, DesktopModelProfileStoreError> {
    model_profile_store
        .load_profiles()
        .map(|profiles| profiles.into_iter().map(model_profile_summary).collect())
}

fn model_profile_summary(profile: DesktopModelProfileRecord) -> DesktopModelProfileSummary {
    DesktopModelProfileSummary {
        id: profile.id,
        label: profile.label,
        model_ref: profile.model_ref,
        source: profile.source,
        provider: profile.provider,
        model: profile.model,
        auth_method: profile.auth_method,
        has_credential: profile.api_key_ref.is_some(),
        base_url: profile.base_url,
        api: profile.api,
        api_version: profile.api_version,
        last_connection_status: profile.last_connection_status,
        last_connection_detail: profile.last_connection_detail,
        last_connected_at: profile.last_connected_at,
    }
}

fn model_profile_store_status(
    state: &GatewayState,
    error: DesktopModelProfileStoreError,
) -> StatusCode {
    emit_operation_failed(state, "model_profile_store_failed", error.to_string());
    StatusCode::INTERNAL_SERVER_ERROR
}

fn required_trimmed(value: String, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        Err(format!("Model profile {field} is required."))
    } else {
        Ok(value.to_string())
    }
}

fn optional_trimmed(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

fn slugify_model_profile_id(model_ref: &str) -> String {
    let mut id = String::new();
    let mut previous_separator = false;
    for character in model_ref.chars() {
        if character.is_ascii_alphanumeric() {
            id.push(character.to_ascii_lowercase());
            previous_separator = false;
        } else if !previous_separator {
            id.push('-');
            previous_separator = true;
        }
    }
    let id = id.trim_matches('-');
    if id.is_empty() {
        "model-profile".to_string()
    } else {
        id.to_string()
    }
}
