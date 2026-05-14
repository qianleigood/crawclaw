use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const NATIVE_PLUGIN_SCHEMA_VERSION: u32 = 1;
pub const NATIVE_PLUGIN_JSONRPC_PROTOCOL: &str = "crawclaw-native-plugin-jsonrpc";
pub const NATIVE_PLUGIN_JSONRPC_VERSION: &str = "2.0";

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativePluginDescriptor {
    pub schema_version: u32,
    pub plugin_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<NativeToolDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub gateway_methods: Vec<NativeGatewayMethodDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub services: Vec<NativeServiceDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_providers: Vec<NativeModelProviderDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub web_search_providers: Vec<NativeWebSearchProviderDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub web_fetch_providers: Vec<NativeWebFetchProviderDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub speech_providers: Vec<NativeSpeechProviderDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media_understanding_providers: Vec<NativeMediaUnderstandingProviderDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub host_callbacks: Vec<NativeHostCallback>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolDescriptor {
    pub name: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub parameters: Value,
    pub invocation: NativeInvocationTarget,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub default_enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub default_profiles: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<NativeApprovalPolicy>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeInvocationTarget {
    pub plugin_id: String,
    pub operation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDescribeRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDescribeResponse {
    pub descriptors: Vec<NativePluginDescriptor>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeInvocationRequest {
    pub target: NativeInvocationTarget,
    #[serde(default)]
    pub input: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeInvocationResponse {
    #[serde(default)]
    pub output: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolResultEnvelope {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<NativeToolContentBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_error: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NativeToolContentBlock {
    Text {
        text: String,
    },
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeServiceLifecycleRequest {
    pub plugin_id: String,
    pub service_id: String,
    #[serde(default)]
    pub input: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeApprovalPolicy {
    pub title: String,
    pub description: String,
    pub severity: NativeApprovalSeverity,
    pub timeout_behavior: NativeApprovalTimeoutBehavior,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<NativeApprovalCondition>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeApprovalCondition {
    pub param: String,
    pub equals: Value,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NativeApprovalSeverity {
    Info,
    Warning,
    Critical,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NativeApprovalTimeoutBehavior {
    Allow,
    Deny,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeGatewayMethodDescriptor {
    pub method: String,
    pub scope: NativeGatewayMethodScope,
    pub invocation: NativeInvocationTarget,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeGatewayMethodScope {
    OperatorRead,
    OperatorWrite,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeServiceDescriptor {
    pub id: String,
    pub label: String,
    pub start: NativeInvocationTarget,
    pub stop: NativeInvocationTarget,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeModelProviderDescriptor {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeWebSearchProviderDescriptor {
    pub id: String,
    pub label: String,
    pub invocation: NativeInvocationTarget,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeWebFetchProviderDescriptor {
    pub id: String,
    pub label: String,
    pub invocation: NativeInvocationTarget,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeSpeechProviderDescriptor {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub voices: Vec<String>,
    pub synthesize: NativeInvocationTarget,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaUnderstandingProviderDescriptor {
    pub id: String,
    pub label: String,
    pub invocation: NativeInvocationTarget,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeHostCallback {
    AgentRun,
    ApprovalRequest,
    SecretsResolve,
    Log,
    TempdirCreate,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativePluginDiscovery {
    pub protocol: String,
    pub schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bin: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub command: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NativeJsonRpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NativeJsonRpcResponse {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<NativePluginError>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativePluginError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn descriptor_round_trips_with_all_capability_families() {
        let descriptor = NativePluginDescriptor {
            schema_version: NATIVE_PLUGIN_SCHEMA_VERSION,
            plugin_id: "demo".to_string(),
            name: Some("Demo".to_string()),
            description: Some("Demo native plugin".to_string()),
            version: Some("1.0.0".to_string()),
            tools: vec![NativeToolDescriptor {
                name: "demo_tool".to_string(),
                label: "Demo Tool".to_string(),
                description: "Runs demo work.".to_string(),
                parameters: json!({ "type": "object" }),
                invocation: NativeInvocationTarget {
                    plugin_id: "demo".to_string(),
                    operation: "tool".to_string(),
                },
                read_only: true,
                default_enabled: true,
                default_profiles: vec!["coding".to_string()],
                approval: Some(NativeApprovalPolicy {
                    title: "Run demo".to_string(),
                    description: "Approve demo run.".to_string(),
                    severity: NativeApprovalSeverity::Warning,
                    timeout_behavior: NativeApprovalTimeoutBehavior::Deny,
                    condition: Some(NativeApprovalCondition {
                        param: "action".to_string(),
                        equals: json!("run"),
                    }),
                }),
            }],
            gateway_methods: vec![NativeGatewayMethodDescriptor {
                method: "demo.status".to_string(),
                scope: NativeGatewayMethodScope::OperatorRead,
                invocation: NativeInvocationTarget {
                    plugin_id: "demo".to_string(),
                    operation: "status".to_string(),
                },
            }],
            services: vec![NativeServiceDescriptor {
                id: "demo-service".to_string(),
                label: "Demo Service".to_string(),
                start: NativeInvocationTarget {
                    plugin_id: "demo".to_string(),
                    operation: "service-start".to_string(),
                },
                stop: NativeInvocationTarget {
                    plugin_id: "demo".to_string(),
                    operation: "service-stop".to_string(),
                },
            }],
            model_providers: vec![NativeModelProviderDescriptor {
                id: "demo-model".to_string(),
                label: "Demo Model".to_string(),
                transport: Some("demo-transport".to_string()),
            }],
            web_search_providers: vec![NativeWebSearchProviderDescriptor {
                id: "demo-search".to_string(),
                label: "Demo Search".to_string(),
                invocation: NativeInvocationTarget {
                    plugin_id: "demo".to_string(),
                    operation: "search".to_string(),
                },
            }],
            web_fetch_providers: vec![NativeWebFetchProviderDescriptor {
                id: "demo-fetch".to_string(),
                label: "Demo Fetch".to_string(),
                invocation: NativeInvocationTarget {
                    plugin_id: "demo".to_string(),
                    operation: "fetch".to_string(),
                },
            }],
            speech_providers: vec![NativeSpeechProviderDescriptor {
                id: "demo-speech".to_string(),
                label: "Demo Speech".to_string(),
                voices: vec!["demo".to_string()],
                synthesize: NativeInvocationTarget {
                    plugin_id: "demo".to_string(),
                    operation: "synthesize".to_string(),
                },
            }],
            media_understanding_providers: vec![NativeMediaUnderstandingProviderDescriptor {
                id: "demo-media".to_string(),
                label: "Demo Media".to_string(),
                invocation: NativeInvocationTarget {
                    plugin_id: "demo".to_string(),
                    operation: "understand".to_string(),
                },
            }],
            host_callbacks: vec![
                NativeHostCallback::AgentRun,
                NativeHostCallback::ApprovalRequest,
            ],
        };

        let encoded = serde_json::to_string(&descriptor).expect("encode descriptor");
        assert!(encoded.contains("\"schemaVersion\":1"));
        assert!(encoded.contains("\"hostCallbacks\""));
        let decoded: NativePluginDescriptor =
            serde_json::from_str(&encoded).expect("decode descriptor");
        assert_eq!(decoded, descriptor);
    }

    #[test]
    fn invocation_request_round_trips_with_camel_case_target() {
        let request = NativeInvocationRequest {
            target: NativeInvocationTarget {
                plugin_id: "demo".to_string(),
                operation: "run".to_string(),
            },
            input: json!({ "value": 1 }),
        };

        let encoded = serde_json::to_string(&request).expect("encode invocation request");
        assert!(encoded.contains("\"pluginId\":\"demo\""));
        let decoded: NativeInvocationRequest =
            serde_json::from_str(&encoded).expect("decode invocation request");
        assert_eq!(decoded, request);
    }

    #[test]
    fn native_tool_result_envelope_round_trips_text_and_images() {
        let envelope = NativeToolResultEnvelope {
            content: vec![
                NativeToolContentBlock::Text {
                    text: "hello".to_string(),
                },
                NativeToolContentBlock::Image {
                    data: "iVBORw0KGgo=".to_string(),
                    mime_type: "image/png".to_string(),
                },
            ],
            details: Some(json!({ "ok": true })),
            is_error: false,
        };

        let encoded = serde_json::to_value(&envelope).expect("encode envelope");
        assert_eq!(encoded["content"][1]["mimeType"], "image/png");
        let decoded: NativeToolResultEnvelope =
            serde_json::from_value(encoded).expect("decode envelope");
        assert_eq!(decoded, envelope);
    }

    #[test]
    fn json_rpc_response_round_trips_plugin_error() {
        let response = NativeJsonRpcResponse {
            jsonrpc: NATIVE_PLUGIN_JSONRPC_VERSION.to_string(),
            id: json!("req-1"),
            result: None,
            error: Some(NativePluginError {
                code: "invalid_input".to_string(),
                message: "missing field".to_string(),
                details: Some(json!({ "field": "url" })),
            }),
        };

        let encoded = serde_json::to_string(&response).expect("encode response");
        let decoded: NativeJsonRpcResponse =
            serde_json::from_str(&encoded).expect("decode response");
        assert_eq!(decoded, response);
    }
}
