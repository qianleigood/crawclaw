use crawclaw_native_plugins::comfyui::{
    collect_output_artifacts, compile_graph_ir_to_prompt, resolve_comfyui_config, ComfyGraphIr,
    ComfyGraphIrEdge, ComfyGraphIrNode, ComfyGraphIrOutput,
};
use crawclaw_native_plugins::llm_task::{complete_llm_task, prepare_llm_task, LlmTaskPrepareInput};
use crawclaw_native_plugins::lobster::parse_lobster_envelope;
use crawclaw_native_plugins::open_prose::describe_open_prose;
use crawclaw_native_plugins::openshell::{build_remote_command, shell_escape};
use crawclaw_native_plugins::qwen3_tts::build_synthesis_payload;
use serde_json::json;

#[test]
fn llm_task_prepare_resolves_defaults_and_builds_json_only_prompt() {
    let prepared = prepare_llm_task(LlmTaskPrepareInput {
        params: json!({ "prompt": "Summarize", "input": { "a": 1 } }),
        plugin_config: json!({ "allowedModels": ["openai-codex/gpt-5.4"] }),
        default_model: Some("openai-codex/gpt-5.4".to_string()),
        workspace_dir: "/tmp/workspace".to_string(),
    })
    .expect("prepare should succeed");

    assert_eq!(prepared.provider, "openai-codex");
    assert_eq!(prepared.model, "gpt-5.4");
    assert!(prepared
        .full_prompt
        .contains("Return ONLY a valid JSON value."));
    assert!(prepared.full_prompt.contains("\"a\": 1"));
    assert_eq!(prepared.workspace_dir, "/tmp/workspace");
}

#[test]
fn llm_task_complete_strips_fences_and_validates_schema() {
    let completed = complete_llm_task(json!({
        "payloads": [{ "text": "```json\n{\"ok\":true}\n```" }],
        "schema": {
            "type": "object",
            "required": ["ok"],
            "properties": { "ok": { "type": "boolean" } }
        },
        "provider": "openai-codex",
        "model": "gpt-5.4"
    }))
    .expect("completion should parse");

    assert_eq!(completed["details"]["json"], json!({ "ok": true }));
    assert_eq!(completed["details"]["provider"], "openai-codex");
}

#[test]
fn lobster_parses_last_json_envelope_after_noisy_stdout() {
    let envelope = parse_lobster_envelope(
        "warning before json\n{\"ok\":true,\"status\":\"needs_approval\",\"output\":[],\"requiresApproval\":{\"type\":\"approval_request\",\"prompt\":\"Approve?\",\"items\":[],\"resumeToken\":\"tok\"}}\n",
    )
    .expect("envelope should parse");

    assert_eq!(envelope["status"], "needs_approval");
    assert_eq!(envelope["requiresApproval"]["resumeToken"], "tok");
}

#[test]
fn openshell_quotes_remote_commands_for_posix_shells() {
    assert_eq!(shell_escape("plain"), "plain");
    assert_eq!(shell_escape("hello world"), "'hello world'");
    assert_eq!(shell_escape("a'b"), "'a'\\''b'");
    assert_eq!(
        build_remote_command(&[
            "echo".to_string(),
            "hello world".to_string(),
            "a'b".to_string()
        ]),
        "echo 'hello world' 'a'\\''b'"
    );
}

#[test]
fn open_prose_reports_skills_only_native_runtime() {
    let description = describe_open_prose();
    assert_eq!(description["id"], "open-prose");
    assert_eq!(description["runtime"], "rust");
    assert_eq!(description["mode"], "skills-only");
}

#[test]
fn qwen3_tts_builds_preset_synthesis_payload() {
    let payload = build_synthesis_payload(&json!({
        "text": "今天先验证普通回复。",
        "target": "audio-file",
        "providerConfig": {
            "runtime": "mlx-audio",
            "defaultProfile": "assistant",
            "profiles": {
                "assistant": {
                    "source": "preset",
                    "quality": "balanced",
                    "voice": "vivian",
                    "language": "Auto",
                    "instructions": "natural, warm, expressive"
                }
            }
        }
    }))
    .expect("payload should build");

    assert_eq!(payload["task"], "preset");
    assert_eq!(payload["text"], "今天先验证普通回复。");
    assert_eq!(payload["model"], "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice");
    assert_eq!(payload["voice"], "vivian");
    assert_eq!(payload["responseFormat"], "wav");
    assert_eq!(payload["runtime"], "mlx-audio");
}

#[test]
fn qwen3_tts_agent_profile_overrides_default_profile() {
    let payload = build_synthesis_payload(&json!({
        "text": "这个销售智能体应该使用绑定音色。",
        "target": "audio-file",
        "agentId": "sales",
        "providerConfig": {
            "runtime": "qwen-tts",
            "defaultProfile": "assistant",
            "agentProfiles": {
                "sales": "owner"
            },
            "profiles": {
                "assistant": {
                    "source": "preset",
                    "quality": "balanced",
                    "voice": "vivian"
                },
                "owner": {
                    "source": "clone",
                    "quality": "clone",
                    "refAudio": "/tmp/voices/owner.wav",
                    "refText": "owner reference transcript",
                    "language": "zh"
                }
            }
        }
    }))
    .expect("payload should build");

    assert_eq!(payload["task"], "clone");
    assert_eq!(payload["model"], "Qwen/Qwen3-TTS-12Hz-1.7B-Base");
    assert_eq!(payload["refAudio"], "/tmp/voices/owner.wav");
    assert_eq!(payload["refText"], "owner reference transcript");
    assert_eq!(payload["language"], "zh");
    assert_eq!(payload["runtime"], "qwen-tts");
}

#[test]
fn comfyui_resolves_loopback_config_and_rejects_remote_by_default() {
    let cfg = resolve_comfyui_config(
        Some("/tmp/workspace"),
        json!({ "baseUrl": "http://127.0.0.1:8188/", "requestTimeoutMs": 1234 }),
    )
    .expect("config should resolve");

    assert_eq!(cfg.base_url, "http://127.0.0.1:8188");
    assert_eq!(cfg.request_timeout_ms, 1234);
    assert!(cfg.workflows_dir.ends_with(".crawclaw/comfyui/workflows"));

    let err = resolve_comfyui_config(
        Some("/tmp/workspace"),
        json!({ "baseUrl": "https://example.com" }),
    )
    .expect_err("remote should be rejected");
    assert!(err.to_string().contains("allowRemote"));
}

#[test]
fn comfyui_compiles_graph_ir_edges_to_prompt_links() {
    let ir = ComfyGraphIr {
        id: "draft".to_string(),
        goal: "make image".to_string(),
        media_kind: "image".to_string(),
        intent: "text-to-image".to_string(),
        nodes: vec![
            ComfyGraphIrNode {
                id: "loader".to_string(),
                class_type: "CheckpointLoaderSimple".to_string(),
                purpose: "load".to_string(),
                inputs: json!({ "ckpt_name": "model.safetensors" }),
            },
            ComfyGraphIrNode {
                id: "save".to_string(),
                class_type: "SaveImage".to_string(),
                purpose: "save".to_string(),
                inputs: json!({}),
            },
        ],
        edges: vec![ComfyGraphIrEdge {
            from: "loader".to_string(),
            from_output: 0,
            to: "save".to_string(),
            to_input: "images".to_string(),
        }],
        outputs: vec![ComfyGraphIrOutput {
            node_id: "save".to_string(),
            kind: "image".to_string(),
        }],
        notes: None,
    };

    let prompt = compile_graph_ir_to_prompt(&ir);
    assert_eq!(prompt["1"]["class_type"], "CheckpointLoaderSimple");
    assert_eq!(prompt["2"]["inputs"]["images"], json!(["1", 0]));
}

#[test]
fn comfyui_collects_animated_image_outputs_as_video_artifacts() {
    let artifacts = collect_output_artifacts(
        "prompt-1",
        &json!({
            "prompt-1": {
                "outputs": {
                    "9": {
                        "animated": [true],
                        "images": [{ "filename": "clip.webp", "subfolder": "", "type": "output" }]
                    }
                }
            }
        }),
    );

    assert_eq!(artifacts.len(), 1);
    assert_eq!(artifacts[0].kind, "video");
    assert_eq!(artifacts[0].filename, "clip.webp");
}
