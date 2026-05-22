use std::fs;
use std::path::PathBuf;

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
    assert!(source.contains("kind: 'toolResult'"));
    assert!(source.contains("messages: ConversationMessage[]"));
}
