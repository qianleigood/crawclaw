use super::*;

pub(super) fn agent_profile(
    id: String,
    name: String,
    role: String,
    description: String,
    channels: Vec<AgentChannelBinding>,
) -> AgentProfile {
    let avatar_initials = initials(&name);
    AgentProfile {
        id,
        name,
        role,
        description,
        status: "ready".to_string(),
        model: "gpt-5.5".to_string(),
        thinking: "high".to_string(),
        permission_mode: "工作区模式".to_string(),
        emotion: AgentEmotionProfile {
            style: "neutral".to_string(),
            tone: "direct".to_string(),
            boundaries: Vec::new(),
            prompt_md: String::new(),
        },
        voice: AgentVoiceConfig {
            enabled: false,
            input_enabled: false,
            output_enabled: false,
            wake_enabled: false,
            source: "qwen-preset".to_string(),
            preset_voice: "Cherry".to_string(),
            design_prompt: String::new(),
            clone_voice_name: String::new(),
            clone_sample_name: String::new(),
            style: String::new(),
            pace: String::new(),
        },
        channels,
        avatar: AgentAvatarProfile {
            initials: avatar_initials,
            gradient: "cyan".to_string(),
            image_data_url: None,
            source: None,
        },
        tools: Vec::new(),
        skills: Vec::new(),
    }
}

pub(super) fn agent_channels_from_input(input: &Value) -> Result<Vec<AgentChannelBinding>, String> {
    let Some(channels_value) = input.get("channels") else {
        return Ok(Vec::new());
    };
    let mut channels = serde_json::from_value::<Vec<AgentChannelBinding>>(channels_value.clone())
        .map_err(|error| format!("Invalid agent channel payload: {error}"))?;
    for channel in &mut channels {
        if !is_desktop_or_native_channel_id(&channel.id) {
            return Err(format!(
                "Unsupported desktop channel id '{}'; channel must be declared in the Rust native channel catalog.",
                channel.id
            ));
        }
        normalize_agent_channel(channel);
    }
    dedupe_agent_channels(&mut channels);
    Ok(channels)
}

pub(super) fn retain_rust_native_agent_channels(agent: &mut AgentProfile) {
    agent
        .channels
        .retain(|channel| is_desktop_or_native_channel_id(&channel.id));
    for channel in &mut agent.channels {
        normalize_agent_channel(channel);
    }
    dedupe_agent_channels(&mut agent.channels);
}

pub(super) fn normalize_agent_channel(channel: &mut AgentChannelBinding) {
    if channel.id == "desktop" {
        channel.label = "桌面".to_string();
        if channel.config.is_none() {
            channel.config = Some(default_agent_channel_config("desktop"));
        }
        return;
    }
    if let Some(definition) = native_channel(&channel.id) {
        channel.label = definition.label.to_string();
        channel.config = Some(normalize_native_channel_config(
            channel.config.take(),
            definition,
        ));
    }
}

pub(super) fn normalize_native_channel_config(
    existing: Option<AgentChannelConfig>,
    definition: &NativeChannelDefinition,
) -> AgentChannelConfig {
    let fallback = default_agent_channel_config(definition.id);
    let existing = existing.unwrap_or_else(|| fallback.clone());
    AgentChannelConfig {
        account_id: if existing.account_id.trim().is_empty() {
            fallback.account_id
        } else {
            existing.account_id.trim().to_string()
        },
        dm_policy: if existing.dm_policy.trim().is_empty() {
            fallback.dm_policy
        } else {
            existing.dm_policy.trim().to_string()
        },
        fields: normalize_native_channel_fields(&existing.fields, definition),
        group_policy: if existing.group_policy.trim().is_empty() {
            fallback.group_policy
        } else {
            existing.group_policy.trim().to_string()
        },
        target: if existing.target.trim().is_empty() {
            fallback.target
        } else {
            existing.target.trim().to_string()
        },
    }
}

pub(super) fn normalize_native_channel_fields(
    existing_fields: &[AgentChannelConfigField],
    definition: &NativeChannelDefinition,
) -> Vec<AgentChannelConfigField> {
    let mut fields = definition
        .fields
        .iter()
        .map(|field| {
            let existing = existing_fields
                .iter()
                .find(|existing| existing.id == field.id);
            AgentChannelConfigField {
                id: field.id.to_string(),
                label: field.label.to_string(),
                secret: field.secret,
                value: existing
                    .map(|field| field.value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| field.default_value.to_string()),
            }
        })
        .collect::<Vec<_>>();
    for existing in existing_fields {
        if definition
            .fields
            .iter()
            .any(|field| field.id == existing.id)
        {
            continue;
        }
        let id = existing.id.trim();
        if id.is_empty() {
            continue;
        }
        fields.push(AgentChannelConfigField {
            id: id.to_string(),
            label: if existing.label.trim().is_empty() {
                id.to_string()
            } else {
                existing.label.trim().to_string()
            },
            secret: existing.secret,
            value: existing.value.trim().to_string(),
        });
    }
    fields
}

pub(super) fn default_agent_channel_config(channel_id: &str) -> AgentChannelConfig {
    match channel_id {
        "desktop" => AgentChannelConfig {
            account_id: "local".to_string(),
            dm_policy: "open".to_string(),
            fields: Vec::new(),
            group_policy: "open".to_string(),
            target: "desktop".to_string(),
        },
        "esp32" => AgentChannelConfig {
            account_id: "local".to_string(),
            dm_policy: "open".to_string(),
            fields: Vec::new(),
            group_policy: "open".to_string(),
            target: String::new(),
        },
        "feishu" | "ddingtalk" | "qqbot" | "weixin" => AgentChannelConfig {
            account_id: "default".to_string(),
            dm_policy: "pairing".to_string(),
            fields: Vec::new(),
            group_policy: "allowlist".to_string(),
            target: String::new(),
        },
        _ => AgentChannelConfig {
            account_id: "default".to_string(),
            dm_policy: "pairing".to_string(),
            fields: Vec::new(),
            group_policy: "allowlist".to_string(),
            target: String::new(),
        },
    }
}

pub(super) fn dedupe_agent_channels(channels: &mut Vec<AgentChannelBinding>) {
    let mut seen = std::collections::BTreeSet::new();
    channels.retain(|channel| seen.insert(channel.id.clone()));
}

pub(super) fn initials(name: &str) -> String {
    let mut chars = name
        .split_whitespace()
        .filter_map(|part| part.chars().next())
        .take(2)
        .collect::<String>();
    if chars.is_empty() {
        chars = "A".to_string();
    }
    chars.to_uppercase()
}
