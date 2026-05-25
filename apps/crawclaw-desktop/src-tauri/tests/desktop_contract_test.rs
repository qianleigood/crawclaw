use std::fs;
use std::path::PathBuf;

use crawclaw_desktop::models::ConversationMessage;

#[test]
fn desktop_api_contract_generated_types_are_current() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let contract_path = manifest_dir
        .join("..")
        .join("src")
        .join("generated")
        .join("desktop-api-contract.generated.ts");
    let actual = fs::read_to_string(&contract_path).expect("read generated desktop API contract");
    let expected = crawclaw_desktop::desktop_contract::desktop_api_contract_source();

    assert_eq!(
        actual, expected,
        "desktop API contract is stale; run `cargo run --manifest-path apps/crawclaw-desktop/src-tauri/Cargo.toml -- emit-desktop-api-contract --output apps/crawclaw-desktop/src/generated/desktop-api-contract.generated.ts`"
    );
}

#[test]
fn desktop_api_contract_exposes_structured_conversation_messages() {
    let source = crawclaw_desktop::desktop_contract::desktop_api_contract_source();

    assert!(source.contains("export type ConversationMessage ="));
    assert!(source.contains("status?: 'running' | 'done' | 'cancelled' | 'failed'"));
    assert!(source.contains("runId?: string"));
    assert!(source.contains("kind: 'toolResult'"));
    assert!(source.contains("messages: ConversationMessage[]"));
}

#[test]
fn desktop_api_contract_conversation_message_wire_shape_is_camel_case() {
    let message = ConversationMessage::ToolResult {
        id: "message-1".to_string(),
        tool_id: "tool-1".to_string(),
        title: "Tool finished".to_string(),
        ok: true,
        text: "done".to_string(),
        created_at: "刚刚".to_string(),
    };

    let json = serde_json::to_value(message).expect("serialize conversation message");
    assert_eq!(json["kind"], "toolResult");
    assert_eq!(json["toolId"], "tool-1");
    assert_eq!(json["createdAt"], "刚刚");
    assert!(json.get("tool_id").is_none());
    assert!(json.get("created_at").is_none());
}
