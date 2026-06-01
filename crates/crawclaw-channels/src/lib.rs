use std::collections::BTreeMap;
use std::fmt;

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeChannelConfigField {
    pub id: &'static str,
    pub label: &'static str,
    pub secret: bool,
    pub default_value: &'static str,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeChannelDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub icon: &'static str,
    pub fields: &'static [NativeChannelConfigField],
}

const FEISHU_FIELDS: &[NativeChannelConfigField] = &[
    channel_field("appId", "App ID", false, ""),
    channel_field("appSecret", "App Secret", true, ""),
    channel_field("verificationToken", "Verification Token", true, ""),
    channel_field("encryptKey", "Encrypt Key", true, ""),
];

const DDINGTALK_FIELDS: &[NativeChannelConfigField] = &[
    channel_field("clientId", "Client ID", false, ""),
    channel_field("clientSecret", "Client Secret", true, ""),
];

const ESP32_FIELDS: &[NativeChannelConfigField] = &[
    channel_field("brokerMode", "Broker Mode", false, "managed"),
    channel_field("bindHost", "Bind Host", false, "127.0.0.1"),
    channel_field("advertisedHost", "Advertised Host", false, ""),
    channel_field("port", "Port", false, "1883"),
    channel_field("udpPort", "UDP Port", false, "1884"),
    channel_field("otaPath", "OTA Path", false, "/api/esp32/ota"),
    channel_field("wakeWord", "Wake Word", false, "true"),
];

const QQBOT_FIELDS: &[NativeChannelConfigField] = &[
    channel_field("appId", "App ID", false, ""),
    channel_field("clientSecret", "Client Secret", true, ""),
    channel_field("markdownSupport", "Markdown 支持", false, "true"),
];

const NATIVE_CHANNELS: &[NativeChannelDefinition] = &[
    NativeChannelDefinition {
        id: "ddingtalk",
        label: "钉钉",
        description: "Rust-native DingTalk channel control-plane and configuration surface.",
        icon: "messageCircle",
        fields: DDINGTALK_FIELDS,
    },
    NativeChannelDefinition {
        id: "feishu",
        label: "飞书",
        description: "Rust-native Feishu/Lark channel control-plane and configuration surface.",
        icon: "messageCircle",
        fields: FEISHU_FIELDS,
    },
    NativeChannelDefinition {
        id: "esp32",
        label: "ESP32",
        description: "Rust-native ESP32-S3-BOX-3 device channel control-plane and pairing surface.",
        icon: "cpu",
        fields: ESP32_FIELDS,
    },
    NativeChannelDefinition {
        id: "qqbot",
        label: "QQ Bot",
        description: "Rust-native QQ Bot channel control-plane and configuration surface.",
        icon: "messageCircle",
        fields: QQBOT_FIELDS,
    },
    NativeChannelDefinition {
        id: "weixin",
        label: "微信",
        description: "Rust-native Weixin QR-login channel control-plane and configuration surface.",
        icon: "messageCircle",
        fields: &[],
    },
];

const fn channel_field(
    id: &'static str,
    label: &'static str,
    secret: bool,
    default_value: &'static str,
) -> NativeChannelConfigField {
    NativeChannelConfigField {
        id,
        label,
        secret,
        default_value,
    }
}

pub fn native_channels() -> &'static [NativeChannelDefinition] {
    NATIVE_CHANNELS
}

pub fn native_channel_ids() -> Vec<&'static str> {
    NATIVE_CHANNELS.iter().map(|channel| channel.id).collect()
}

pub fn native_channel(id: &str) -> Option<&'static NativeChannelDefinition> {
    NATIVE_CHANNELS.iter().find(|channel| channel.id == id)
}

pub fn is_native_channel_id(id: &str) -> bool {
    native_channel(id).is_some()
}

pub fn is_desktop_or_native_channel_id(id: &str) -> bool {
    id == "desktop" || is_native_channel_id(id)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRequest {
    pub run_id: String,
    pub agent_id: String,
    pub session_key: String,
    pub inbound: ChannelInboundEnvelope,
    pub model: AgentModelSelection,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_tools: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<AgentRunProfileRequest>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub options: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunProfileRequest {
    pub kind: AgentRunProfileKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub special_agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_after_turn: Option<bool>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunProfileKind {
    Normal,
    Btw,
    Subagent,
    SpecialAgent,
    Compaction,
    MemoryMaintenance,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelSelection {
    pub provider: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_level: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentRunEvent {
    RunStarted {
        run_id: String,
        agent_id: String,
        session_key: String,
    },
    ContextProjected {
        run_id: String,
        projection: Value,
    },
    ProviderBlock {
        run_id: String,
        block_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(default)]
        metadata: Value,
    },
    ModelChunk {
        run_id: String,
        text: String,
    },
    ToolCall {
        run_id: String,
        call_id: String,
        tool_name: String,
        arguments: Value,
    },
    ToolResult {
        run_id: String,
        call_id: String,
        tool_name: String,
        result: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
    ToolProgress {
        run_id: String,
        call_id: String,
        tool_name: String,
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    ToolUseSummary {
        run_id: String,
        call_id: String,
        tool_name: String,
        status: String,
        is_error: bool,
        read_only: bool,
        duration_ms: u64,
        result_projected: bool,
        result_persisted: bool,
        omitted_chars: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        persisted_path: Option<String>,
    },
    PermissionRequested {
        run_id: String,
        request_id: String,
        tool_name: String,
        reason: String,
    },
    PermissionDecision {
        run_id: String,
        request_id: String,
        tool_name: String,
        decision: String,
        mode: String,
        category: String,
        reason: String,
    },
    HookDecision {
        run_id: String,
        hook: String,
        decision: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    SubagentLifecycle {
        run_id: String,
        session_key: String,
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    McpElicitation {
        run_id: String,
        request_id: String,
        server: String,
        prompt: String,
    },
    ReplyPayload {
        run_id: String,
        payload: ReplyPayload,
    },
    TranscriptAppended {
        run_id: String,
        session_key: String,
        role: TranscriptRole,
        message_id: String,
    },
    DeliveryRequested {
        run_id: String,
        request: ChannelOutboundRequest,
    },
    RunCompleted {
        run_id: String,
    },
    RunFailed {
        run_id: String,
        code: String,
        message: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptRole {
    User,
    Assistant,
    Tool,
    System,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatType {
    Direct,
    Group,
    Channel,
    Thread,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInboundEnvelope {
    pub channel: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    pub from: String,
    pub to: String,
    pub chat_type: ChatType,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_urls: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelOutboundRequest {
    pub request_id: String,
    pub channel: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    pub action: ChannelOutboundAction,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChannelOutboundAction {
    Send,
    Poll,
    Reply,
    SendAttachment,
    SendWithEffect,
    ThreadCreate,
    ThreadReply,
    Sticker,
    Custom(String),
}

impl ChannelOutboundAction {
    fn as_str(&self) -> &str {
        match self {
            Self::Send => "send",
            Self::Poll => "poll",
            Self::Reply => "reply",
            Self::SendAttachment => "sendAttachment",
            Self::SendWithEffect => "sendWithEffect",
            Self::ThreadCreate => "threadCreate",
            Self::ThreadReply => "threadReply",
            Self::Sticker => "sticker",
            Self::Custom(value) => value.as_str(),
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "send" => Self::Send,
            "poll" => Self::Poll,
            "reply" => Self::Reply,
            "sendAttachment" => Self::SendAttachment,
            "sendWithEffect" => Self::SendWithEffect,
            "threadCreate" => Self::ThreadCreate,
            "threadReply" => Self::ThreadReply,
            "sticker" => Self::Sticker,
            other => Self::Custom(other.to_string()),
        }
    }
}

impl Serialize for ChannelOutboundAction {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ChannelOutboundAction {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct ActionVisitor;

        impl de::Visitor<'_> for ActionVisitor {
            type Value = ChannelOutboundAction;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a channel outbound action string")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(ChannelOutboundAction::from_str(value))
            }
        }

        deserializer.deserialize_str(ActionVisitor)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelCapabilityDescriptor {
    pub channel: String,
    pub label: String,
    #[serde(default = "default_control_plane_runtime_kind")]
    pub runtime_kind: String,
    #[serde(default = "default_channel_adapter_runtime_kind")]
    pub adapter_runtime_kind: String,
    pub rust_adapter_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chat_types: Vec<ChatType>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<ChannelOutboundAction>,
    #[serde(default)]
    pub inbound: ChannelInboundCapability,
    #[serde(default)]
    pub outbound: ChannelOutboundCapability,
    #[serde(default)]
    pub lifecycle: ChannelLifecycleCapability,
}

fn default_control_plane_runtime_kind() -> String {
    "rust".to_string()
}

fn default_channel_adapter_runtime_kind() -> String {
    "rust".to_string()
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInboundCapability {
    pub webhook: bool,
    pub polling: bool,
    pub media_download: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelOutboundCapability {
    pub text: bool,
    pub media: bool,
    pub poll: bool,
    pub thread_reply: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelLifecycleCapability {
    pub setup: bool,
    pub status: bool,
    pub start: bool,
    pub stop: bool,
    pub restart: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplyPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_urls: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDeliveryResult {
    pub request_id: String,
    pub channel: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeChannelDispatchContext {
    pub connected: bool,
    pub now_ms: u128,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeChannelDeliveryRecord {
    pub ok: bool,
    pub request_id: String,
    pub action: ChannelOutboundAction,
    pub message_id: String,
    pub channel: String,
    pub account_id: String,
    pub to: String,
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, Value>,
    pub sent: bool,
    pub delivery_status: String,
    pub status: String,
    pub error_code: Option<String>,
    pub queued_at_ms: Option<u128>,
    pub delivered_at_ms: Option<u128>,
    pub implementation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeChannelLifecycleInput {
    pub channel: String,
    pub method: String,
    pub enabled: bool,
    pub configured: bool,
    pub current_linked: bool,
    pub current_connected: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeChannelLifecycleUpdate {
    pub enabled: bool,
    pub configured: bool,
    pub linked: bool,
    pub running: bool,
    pub connected: bool,
    pub health_state: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessagingTargetKind {
    User,
    Channel,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessagingTarget {
    pub kind: MessagingTargetKind,
    pub id: String,
    pub raw: String,
    pub normalized: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDirectoryLookupRequest {
    pub channel: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<MessagingTargetKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDirectoryLookupResult {
    pub ok: bool,
    pub channel: String,
    pub account_id: Option<String>,
    pub query: Option<String>,
    pub descriptor: ChannelCapabilityDescriptor,
    pub targets: Vec<MessagingTarget>,
    pub implementation: String,
}

pub fn canonical_agent_run_event_types() -> &'static [&'static str] {
    &[
        "runStarted",
        "modelChunk",
        "toolCall",
        "toolResult",
        "replyPayload",
        "transcriptAppended",
        "deliveryRequested",
        "runCompleted",
        "runFailed",
    ]
}

pub fn channel_contract_version() -> &'static str {
    "2026-05-agent-channel-rust-v1"
}

pub fn list_native_channel_descriptors() -> &'static [ChannelCapabilityDescriptor] {
    &NATIVE_CHANNEL_DESCRIPTORS
}

pub fn find_native_channel_descriptor(
    channel: &str,
) -> Option<&'static ChannelCapabilityDescriptor> {
    let normalized = channel.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    NATIVE_CHANNEL_DESCRIPTORS
        .iter()
        .find(|descriptor| descriptor.channel == normalized)
}

pub fn is_local_native_delivery_channel(channel: &str) -> bool {
    channel.trim().eq_ignore_ascii_case("desktop")
}

pub fn dispatch_native_channel_outbound(
    request: &ChannelOutboundRequest,
    context: NativeChannelDispatchContext,
) -> NativeChannelDeliveryRecord {
    let local_delivery = is_local_native_delivery_channel(&request.channel);
    let sent = local_delivery && context.connected;
    let delivery_status = if sent { "delivered" } else { "blocked" }.to_string();
    let error_code = if sent {
        None
    } else if local_delivery {
        Some("needs_channel_login".to_string())
    } else {
        Some("needs_channel_transport".to_string())
    };

    NativeChannelDeliveryRecord {
        ok: sent,
        request_id: request.request_id.clone(),
        action: request.action.clone(),
        message_id: format!("rust-send-{}", context.now_ms),
        channel: request.channel.clone(),
        account_id: request
            .account_id
            .clone()
            .unwrap_or_else(|| "default".to_string()),
        to: request.to.clone(),
        text: request.text.clone(),
        media_urls: request.media_urls.clone(),
        reply_to_id: request.reply_to_id.clone(),
        thread_id: request.thread_id.clone(),
        params: request.params.clone(),
        sent,
        delivery_status: delivery_status.clone(),
        status: delivery_status,
        error_code,
        queued_at_ms: if sent { None } else { Some(context.now_ms) },
        delivered_at_ms: if sent { Some(context.now_ms) } else { None },
        implementation: "rust-native".to_string(),
    }
}

pub fn resolve_native_channel_lifecycle_update(
    input: NativeChannelLifecycleInput,
) -> NativeChannelLifecycleUpdate {
    let method = input.method.as_str();
    if method.ends_with(".logout") || method == "channels.logout" {
        return NativeChannelLifecycleUpdate {
            enabled: input.enabled,
            configured: input.configured,
            linked: false,
            running: false,
            connected: false,
            health_state: "logged_out".to_string(),
        };
    }

    if method.ends_with(".verify") {
        return NativeChannelLifecycleUpdate {
            enabled: input.enabled,
            configured: input.configured,
            linked: input.current_linked,
            running: input.current_connected,
            connected: input.current_connected,
            health_state: if input.current_connected {
                "connected".to_string()
            } else {
                "needs_login".to_string()
            },
        };
    }

    if is_local_native_delivery_channel(&input.channel) {
        return NativeChannelLifecycleUpdate {
            enabled: input.enabled,
            configured: input.configured,
            linked: true,
            running: true,
            connected: true,
            health_state: "connected".to_string(),
        };
    }

    NativeChannelLifecycleUpdate {
        enabled: input.enabled,
        configured: input.configured,
        linked: false,
        running: false,
        connected: false,
        health_state: if input.configured {
            "needs_channel_transport".to_string()
        } else {
            "unconfigured".to_string()
        },
    }
}

pub fn lookup_native_channel_directory(
    request: ChannelDirectoryLookupRequest,
) -> Result<ChannelDirectoryLookupResult, String> {
    let channel = request.channel.trim().to_lowercase();
    let descriptor = find_native_channel_descriptor(&channel)
        .cloned()
        .ok_or_else(|| format!("unknown native channel: {channel}"))?;
    let query = request
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let mut targets = query
        .as_deref()
        .and_then(|raw| normalize_messaging_target(raw, request.kind.clone()))
        .into_iter()
        .collect::<Vec<_>>();
    if let Some(limit) = request.limit {
        targets.truncate(limit);
    }
    Ok(ChannelDirectoryLookupResult {
        ok: true,
        channel,
        account_id: request
            .account_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        query,
        descriptor,
        targets,
        implementation: "rust-native".to_string(),
    })
}

fn normalize_messaging_target(
    raw: &str,
    default_kind: Option<MessagingTargetKind>,
) -> Option<MessagingTarget> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let (kind, id) = if let Some(rest) = raw.strip_prefix("channel:") {
        (MessagingTargetKind::Channel, rest.trim())
    } else if let Some(rest) = raw.strip_prefix("user:") {
        (MessagingTargetKind::User, rest.trim())
    } else if let Some(rest) = raw.strip_prefix('@') {
        (MessagingTargetKind::User, rest.trim())
    } else {
        (default_kind.unwrap_or(MessagingTargetKind::User), raw)
    };
    if id.is_empty() {
        return None;
    }
    Some(MessagingTarget {
        kind: kind.clone(),
        id: id.to_string(),
        raw: raw.to_string(),
        normalized: format!(
            "{}:{}",
            match kind {
                MessagingTargetKind::User => "user",
                MessagingTargetKind::Channel => "channel",
            },
            id.to_lowercase()
        ),
    })
}

macro_rules! channel_descriptor {
    (
        $channel:literal,
        $label:literal,
        chat_types: [$($chat_type:expr),* $(,)?],
        actions: [$($action:expr),* $(,)?],
        inbound: { webhook: $webhook:expr, polling: $polling:expr, media_download: $media_download:expr },
        outbound: { text: $text:expr, media: $media:expr, poll: $poll:expr, thread_reply: $thread_reply:expr },
        lifecycle: { setup: $setup:expr, status: $status:expr, start: $start:expr, stop: $stop:expr, restart: $restart:expr }
    ) => {
        ChannelCapabilityDescriptor {
            channel: $channel.to_string(),
            label: $label.to_string(),
            runtime_kind: default_control_plane_runtime_kind(),
            adapter_runtime_kind: default_channel_adapter_runtime_kind(),
            rust_adapter_id: concat!($channel, "-native").to_string(),
            chat_types: vec![$($chat_type),*],
            actions: vec![$($action),*],
            inbound: ChannelInboundCapability {
                webhook: $webhook,
                polling: $polling,
                media_download: $media_download,
            },
            outbound: ChannelOutboundCapability {
                text: $text,
                media: $media,
                poll: $poll,
                thread_reply: $thread_reply,
            },
            lifecycle: ChannelLifecycleCapability {
                setup: $setup,
                status: $status,
                start: $start,
                stop: $stop,
                restart: $restart,
            },
        }
    };
}

static NATIVE_CHANNEL_DESCRIPTORS: std::sync::LazyLock<Vec<ChannelCapabilityDescriptor>> =
    std::sync::LazyLock::new(|| {
        use ChannelOutboundAction::*;
        use ChatType::*;

        vec![
            channel_descriptor!(
                "ddingtalk",
                "DingTalk",
                chat_types: [Direct, Group],
                actions: [Send, Reply, SendAttachment],
                inbound: { webhook: true, polling: false, media_download: true },
                outbound: { text: true, media: true, poll: false, thread_reply: false },
                lifecycle: { setup: true, status: true, start: true, stop: true, restart: true }
            ),
            channel_descriptor!(
                "feishu",
                "Feishu",
                chat_types: [Direct, Channel, Thread],
                actions: [Send, Reply, SendAttachment, ThreadReply],
                inbound: { webhook: true, polling: false, media_download: true },
                outbound: { text: true, media: true, poll: false, thread_reply: true },
                lifecycle: { setup: true, status: true, start: true, stop: true, restart: true }
            ),
            channel_descriptor!(
                "esp32",
                "ESP32",
                chat_types: [Direct],
                actions: [Send, SendAttachment],
                inbound: { webhook: false, polling: true, media_download: true },
                outbound: { text: true, media: true, poll: false, thread_reply: false },
                lifecycle: { setup: true, status: true, start: true, stop: true, restart: true }
            ),
            channel_descriptor!(
                "qqbot",
                "QQ Bot",
                chat_types: [Direct, Group, Channel],
                actions: [Send, Reply, SendAttachment],
                inbound: { webhook: true, polling: false, media_download: true },
                outbound: { text: true, media: true, poll: false, thread_reply: false },
                lifecycle: { setup: true, status: true, start: true, stop: true, restart: true }
            ),
            channel_descriptor!(
                "weixin",
                "Weixin",
                chat_types: [Direct, Group],
                actions: [Send, Reply, SendAttachment],
                inbound: { webhook: false, polling: true, media_download: true },
                outbound: { text: true, media: true, poll: false, thread_reply: false },
                lifecycle: { setup: true, status: true, start: true, stop: true, restart: true }
            ),
        ]
    });

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_channel_catalog_covers_bundled_native_channels() {
        assert_eq!(
            native_channel_ids(),
            vec!["ddingtalk", "feishu", "esp32", "qqbot", "weixin"]
        );
        assert!(!is_native_channel_id("dingtalk"));
        assert!(!is_native_channel_id("discord"));
        assert!(!is_native_channel_id("telegram"));
    }

    #[test]
    fn native_channel_catalog_exposes_rust_config_fields() {
        let feishu = native_channel("feishu").expect("feishu channel");
        assert_eq!(feishu.label, "飞书");
        assert_eq!(
            feishu
                .fields
                .iter()
                .map(|field| field.id)
                .collect::<Vec<_>>(),
            vec!["appId", "appSecret", "verificationToken", "encryptKey"]
        );

        let ddingtalk = native_channel("ddingtalk").expect("ddingtalk channel");
        assert_eq!(ddingtalk.label, "钉钉");
        assert_eq!(
            ddingtalk
                .fields
                .iter()
                .map(|field| field.id)
                .collect::<Vec<_>>(),
            vec!["clientId", "clientSecret"]
        );

        let weixin = native_channel("weixin").expect("weixin channel");
        assert_eq!(weixin.label, "微信");
        assert!(weixin.fields.is_empty());

        let esp32 = native_channel("esp32").expect("esp32 channel");
        assert_eq!(esp32.label, "ESP32");
        assert_eq!(esp32.icon, "cpu");
        assert_eq!(
            esp32
                .fields
                .iter()
                .map(|field| field.id)
                .collect::<Vec<_>>(),
            vec![
                "brokerMode",
                "bindHost",
                "advertisedHost",
                "port",
                "udpPort",
                "otaPath",
                "wakeWord"
            ]
        );
    }
}
