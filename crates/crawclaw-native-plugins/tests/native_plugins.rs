use std::process::{Command, Stdio};

use crawclaw_native_plugins::comfyui::{
    collect_output_artifacts, compile_graph_ir_to_prompt, resolve_comfyui_config, ComfyGraphIr,
    ComfyGraphIrEdge, ComfyGraphIrNode, ComfyGraphIrOutput,
};
use crawclaw_native_plugins::llm_task::{complete_llm_task, prepare_llm_task, LlmTaskPrepareInput};
use crawclaw_native_plugins::lobster::parse_lobster_envelope;
use crawclaw_native_plugins::open_prose::describe_open_prose;
use crawclaw_native_plugins::openshell::{build_remote_command, shell_escape};
use crawclaw_native_plugins::qwen3_tts::build_synthesis_payload;
use crawclaw_native_plugins::registry::{
    builtin_native_plugin_descriptors, builtin_native_tool_descriptors,
    dispatch_builtin_native_plugin_operation, find_builtin_native_plugin_descriptor,
    native_media_understanding_provider_descriptors, native_speech_provider_descriptors,
    native_web_fetch_provider_descriptors, native_web_search_provider_descriptors,
};
use crawclaw_native_plugins::spider_fetch::{
    shape_spider_dynamic_fetch_payload, SpiderFetchRequest, SpiderFetchSnapshot,
};
use crawclaw_native_plugins::web::{
    build_searxng_search_url, decode_html_entities, parse_searxng_response_text,
    searxng_runtime_python_candidates, strip_html, SearxngSearchRequest,
};
use serde_json::json;
use std::io::Write;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[test]
fn native_plugin_descriptors_cover_target_plugins() {
    let descriptors = builtin_native_plugin_descriptors();
    let ids = descriptors
        .iter()
        .map(|descriptor| descriptor.plugin_id.as_str())
        .collect::<Vec<_>>();
    for expected in [
        "browser",
        "lobster",
        "comfyui",
        "searxng",
        "spider-fetch",
        "llm-task",
        "qwen3-tts",
        "openai",
    ] {
        assert!(ids.contains(&expected), "missing descriptor for {expected}");
    }

    let browser = find_builtin_native_plugin_descriptor("browser").expect("browser descriptor");
    assert!(browser
        .tools
        .iter()
        .any(|tool| tool.name == "browser" && tool.default_enabled));
    assert!(browser
        .services
        .iter()
        .any(|service| service.id == "browser-agent-browser-runtime"));

    let comfyui = find_builtin_native_plugin_descriptor("comfyui").expect("comfyui descriptor");
    assert!(comfyui
        .tools
        .iter()
        .any(|tool| tool.name == "comfyui_workflow" && tool.approval.is_some()));
    assert!(comfyui
        .gateway_methods
        .iter()
        .any(|method| method.method == "comfyui.workflow.run"));

    let llm_task = find_builtin_native_plugin_descriptor("llm-task").expect("llm-task descriptor");
    assert!(!llm_task.host_callbacks.is_empty());
}

#[test]
fn native_capability_views_expose_provider_like_descriptors() {
    assert!(native_web_search_provider_descriptors()
        .iter()
        .any(|provider| provider.id == "searxng"));
    assert!(native_web_fetch_provider_descriptors()
        .iter()
        .any(|provider| provider.id == "spider"));
    assert!(native_speech_provider_descriptors()
        .iter()
        .any(|provider| provider.id == "qwen3-tts"));
    assert!(native_media_understanding_provider_descriptors()
        .iter()
        .any(|provider| provider.id == "openai"));
    assert!(builtin_native_tool_descriptors()
        .iter()
        .any(|(_, tool)| tool.name == "lobster"));
    assert!(builtin_native_tool_descriptors()
        .iter()
        .any(|(_, tool)| tool.name == "browser"));
}

#[tokio::test]
async fn native_dispatch_uses_registry_and_reports_unknown_operations() {
    let described = dispatch_builtin_native_plugin_operation("open-prose", "describe", json!({}))
        .await
        .expect("open-prose describe");
    assert_eq!(described["id"], "open-prose");

    let error = dispatch_builtin_native_plugin_operation("missing", "noop", json!({}))
        .await
        .expect_err("unknown operation should fail");
    assert_eq!(error.code(), "invalid_input");
}

#[tokio::test]
async fn openai_media_understanding_posts_images_to_responses() {
    let base_url = spawn_openai_responses_sidecar().await;
    let result = dispatch_builtin_native_plugin_operation(
        "openai",
        "media-understanding",
        json!({
            "apiKey": "test-key",
            "baseUrl": base_url,
            "capability": "image",
            "model": "gpt-test",
            "attachments": [{
                "index": 2,
                "mimeType": "image/png",
                "dataBase64": "aGVsbG8="
            }]
        }),
    )
    .await
    .expect("openai media understanding");

    assert_eq!(result["provider"], "openai");
    assert_eq!(result["model"], "gpt-test");
    assert_eq!(result["outputs"][0]["kind"], "image.description");
    assert_eq!(result["outputs"][0]["attachmentIndex"], 2);
    assert_eq!(result["outputs"][0]["text"], "mock image description");
}

#[tokio::test]
async fn browser_native_dispatch_reports_missing_managed_runtime() {
    let error = dispatch_builtin_native_plugin_operation(
        "browser",
        "tool",
        json!({
            "action": "status",
            "pluginConfig": {
                "binPath": "/tmp/crawclaw-missing-agent-browser-for-test"
            }
        }),
    )
    .await
    .expect_err("missing browser runtime should fail");

    assert_eq!(error.code(), "runtime_error");
    assert!(error
        .to_string()
        .contains("agent-browser runtime is not installed"));
}

#[test]
fn native_jsonrpc_sidecar_describes_and_invokes() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_crawclaw-native-plugins"))
        .arg("--jsonrpc")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn native jsonrpc sidecar");

    {
        let stdin = child.stdin.as_mut().expect("sidecar stdin");
        writeln!(
            stdin,
            "{}",
            json!({
                "jsonrpc": "2.0",
                "id": "describe",
                "method": "plugin.describe",
                "params": { "pluginId": "open-prose" }
            })
        )
        .expect("write describe request");
        writeln!(
            stdin,
            "{}",
            json!({
                "jsonrpc": "2.0",
                "id": "invoke",
                "method": "plugin.invoke",
                "params": {
                    "target": { "pluginId": "open-prose", "operation": "describe" },
                    "input": {}
                }
            })
        )
        .expect("write invoke request");
    }
    drop(child.stdin.take());

    let output = child.wait_with_output().expect("sidecar output");
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("utf8 sidecar stdout");
    let lines = stdout.lines().collect::<Vec<_>>();
    assert_eq!(lines.len(), 2);

    let describe = serde_json::from_str::<serde_json::Value>(lines[0]).expect("describe response");
    assert_eq!(describe["jsonrpc"], "2.0");
    assert_eq!(
        describe["result"]["descriptors"][0]["pluginId"],
        "open-prose"
    );

    let invoke = serde_json::from_str::<serde_json::Value>(lines[1]).expect("invoke response");
    assert_eq!(invoke["jsonrpc"], "2.0");
    assert_eq!(invoke["result"]["output"]["id"], "open-prose");
}

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

#[tokio::test]
async fn qwen3_tts_service_start_returns_external_without_autostart() {
    let result = dispatch_builtin_native_plugin_operation(
        "qwen3-tts",
        "service-start",
        json!({
            "providerConfig": {
                "runtime": "qwen-tts",
                "baseUrl": "https://tts.example.test",
                "autoStart": false
            }
        }),
    )
    .await
    .expect("service start");

    assert_eq!(result["status"], "external");
    assert_eq!(result["provider"], "qwen3-tts");
    assert_eq!(result["runtime"], "qwen-tts");
    assert_eq!(result["baseUrl"], "https://tts.example.test");
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

#[test]
fn web_native_builds_search_urls_and_decodes_content() {
    let searxng = build_searxng_search_url(
        "http://127.0.0.1:3210/base/",
        &SearxngSearchRequest {
            query: "rust search".to_string(),
            engines: vec!["bing".to_string(), "duckduckgo".to_string()],
            categories: vec!["general".to_string()],
            language: Some("en-US".to_string()),
            safe_search: Some("1".to_string()),
            time_range: Some("day".to_string()),
        },
    )
    .expect("searxng url");
    assert_eq!(
        searxng.as_str(),
        "http://127.0.0.1:3210/base/search?q=rust+search&format=json&engines=bing%2Cduckduckgo&categories=general&language=en-US&safesearch=1&time_range=day"
    );
    assert_eq!(decode_html_entities("A &amp; B &#x2F; C"), "A & B / C");
    assert_eq!(strip_html("<p>Hello <b>Rust</b></p>"), "Hello Rust");
}

#[test]
fn web_native_parses_searxng_json_results() {
    let results = parse_searxng_response_text(
        r#"{
          "results": [
            {
              "title": "SearXNG Result",
              "url": "https://example.com/search",
              "content": "Description",
              "engines": ["bing"],
              "category": "general",
              "publishedDate": "2026-05-16"
            }
          ]
        }"#,
        5,
    )
    .expect("searxng results");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "SearXNG Result");
    assert_eq!(results[0].snippet, "Description");
    assert_eq!(results[0].engine.as_deref(), Some("bing"));
    assert_eq!(results[0].category.as_deref(), Some("general"));
    assert_eq!(results[0].published_at.as_deref(), Some("2026-05-16"));
}

#[tokio::test]
async fn web_native_reports_searxng_json_disabled_403() {
    let base_url = spawn_searxng_403_sidecar().await;
    let error = dispatch_builtin_native_plugin_operation(
        "searxng",
        "search",
        json!({
            "query": "crawclaw",
            "baseUrl": base_url,
            "autoStart": false
        }),
    )
    .await
    .expect_err("403 response should fail");

    assert_eq!(error.code(), "runtime_error");
    assert!(error
        .to_string()
        .contains("SearXNG JSON format is disabled"));
}

#[test]
fn web_native_resolves_searxng_runtime_from_workspace() {
    let workspace = tempfile::tempdir().expect("workspace");
    let candidates = searxng_runtime_python_candidates(
        Some(workspace.path()),
        Some(workspace.path().join("state").as_path()),
    );

    assert_eq!(
        candidates[0],
        workspace
            .path()
            .join("runtimes/searxng/venv")
            .join(if cfg!(windows) {
                "Scripts/python.exe"
            } else {
                "bin/python"
            })
    );
    assert!(candidates
        .iter()
        .any(|candidate| candidate.ends_with(if cfg!(windows) {
            "state/runtimes/searxng/venv/Scripts/python.exe"
        } else {
            "state/runtimes/searxng/venv/bin/python"
        })));
}

#[test]
fn web_native_dynamic_spider_fetch_shapes_payload() {
    let result = shape_spider_dynamic_fetch_payload(
        SpiderFetchSnapshot {
            url: "https://example.com/dynamic".to_string(),
            final_url: "https://example.com/dynamic".to_string(),
            status_code: 200,
            content_type: "text/html".to_string(),
            html: "<html><title>Dynamic</title><body>Dynamic Browser HTML</body></html>"
                .to_string(),
            text: "Dynamic Browser Text".to_string(),
            title: Some("Dynamic".to_string()),
        },
        SpiderFetchRequest {
            url: "https://example.com/dynamic".to_string(),
            output: "html".to_string(),
            render: "dynamic".to_string(),
            timeout_seconds: 10,
            max_chars: 2_000,
            wait_for: Some("#app".to_string()),
            wait_until: Some("networkidle".to_string()),
        },
        std::time::Instant::now(),
    );

    assert_eq!(result["status"], "ok");
    assert_eq!(result["provider"], "spider");
    assert_eq!(result["fetcher"], "spider:dynamic");
    assert_eq!(result["rendered"], true);
    assert_eq!(result["usedFallback"], false);
    assert!(result.get("warning").is_none() || result["warning"].is_null());
    assert!(result["html"]
        .as_str()
        .expect("wrapped html")
        .contains("Dynamic Browser HTML"));
}

async fn spawn_openai_responses_sidecar() -> String {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind openai sidecar");
    let addr = listener.local_addr().expect("openai sidecar addr");
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept openai request");
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = stream.read(&mut buffer).await.expect("read openai request");
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        if name.eq_ignore_ascii_case("content-length") {
                            value.trim().parse::<usize>().ok()
                        } else {
                            None
                        }
                    })
                    .unwrap_or(0);
                if bytes.len() >= header_end + 4 + content_length {
                    break;
                }
            }
        }
        let request = String::from_utf8_lossy(&bytes);
        assert!(request.starts_with("POST /responses "));
        assert!(request.contains("authorization: Bearer test-key"));
        assert!(request.contains("data:image/png;base64,aGVsbG8="));
        let body = r#"{"output_text":"mock image description"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write openai response");
    });
    format!("http://{addr}")
}

async fn spawn_searxng_403_sidecar() -> String {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind searxng sidecar");
    let addr = listener.local_addr().expect("searxng sidecar addr");
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept searxng request");
        let mut buffer = [0; 4096];
        let count = stream
            .read(&mut buffer)
            .await
            .expect("read searxng request");
        assert_ne!(count, 0, "searxng request closed early");
        let request = String::from_utf8_lossy(&buffer[..count]);
        assert!(request.starts_with("GET /search?"));
        assert!(request.contains("format=json"));
        let body = "json disabled";
        let response = format!(
            "HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write searxng response");
    });
    format!("http://{addr}")
}
