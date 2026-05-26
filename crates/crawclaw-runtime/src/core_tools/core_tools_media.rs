use super::*;

pub(super) fn tool_envelope(text: impl Into<String>, details: Value, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text.into() }],
        "details": details,
        "isError": is_error
    })
}

pub(super) fn required_param_string(
    tool_name: &str,
    input: &Value,
    keys: &[&str],
) -> Result<String, String> {
    required_tool_param(tool_name, input, keys).map_err(|error| error.to_string())
}

pub(super) fn canvas_state_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join("canvas").join("state.json")
}

pub(super) fn load_canvas_state(runtime_root: &Path) -> Result<Value, String> {
    let path = canvas_state_path(runtime_root);
    if !path.exists() {
        return Ok(json!({
            "visible": false,
            "current": Value::Null,
            "history": []
        }));
    }
    fs::read_to_string(&path)
        .map_err(|error| error.to_string())
        .and_then(|raw| serde_json::from_str(&raw).map_err(|error| error.to_string()))
}

pub(super) fn save_canvas_state(runtime_root: &Path, state: &Value) -> Result<(), String> {
    let path = canvas_state_path(runtime_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub(super) fn run_canvas_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let action = string_param(&input, &["action"]).unwrap_or_else(|| "snapshot".to_string());
    let now = now_millis();
    let mut state = load_canvas_state(runtime_root)?;
    if !state.is_object() {
        state = json!({});
    }
    match action.as_str() {
        "present" => {
            let artifact_id = string_param(&input, &["artifactId", "id"])
                .unwrap_or_else(|| format!("canvas-{now}"));
            let content = input
                .get("content")
                .or_else(|| input.get("html"))
                .or_else(|| input.get("markdown"))
                .cloned()
                .unwrap_or(Value::Null);
            let current = json!({
                "artifactId": artifact_id,
                "title": string_param(&input, &["title"]),
                "mimeType": string_param(&input, &["mimeType"]).unwrap_or_else(|| "text/html".to_string()),
                "url": string_param(&input, &["url", "targetUrl"]),
                "content": content,
                "updatedAt": now
            });
            state["visible"] = Value::Bool(true);
            state["current"] = current.clone();
            state["updatedAt"] = json!(now);
            if !state.get("history").map(Value::is_array).unwrap_or(false) {
                state["history"] = json!([]);
            }
            if let Some(history) = state.get_mut("history").and_then(Value::as_array_mut) {
                history.push(current);
            }
            save_canvas_state(runtime_root, &state)?;
            Ok(tool_envelope(
                "Canvas artifact presented.",
                json!({ "status": "presented", "state": state, "implementation": "rust-native" }),
                false,
            ))
        }
        "hide" => {
            state["visible"] = Value::Bool(false);
            state["updatedAt"] = json!(now);
            save_canvas_state(runtime_root, &state)?;
            Ok(tool_envelope(
                "Canvas hidden.",
                json!({ "status": "hidden", "state": state, "implementation": "rust-native" }),
                false,
            ))
        }
        "navigate" => {
            let target = required_param_string("canvas", &input, &["url", "targetUrl", "path"])?;
            if state.get("current").is_none() || state.get("current") == Some(&Value::Null) {
                state["current"] = json!({});
            }
            if let Some(current) = state.get_mut("current").and_then(Value::as_object_mut) {
                current.insert("url".to_string(), Value::String(target));
                current.insert("updatedAt".to_string(), json!(now));
            }
            state["visible"] = Value::Bool(true);
            state["updatedAt"] = json!(now);
            save_canvas_state(runtime_root, &state)?;
            Ok(tool_envelope(
                "Canvas navigation recorded.",
                json!({ "status": "navigated", "state": state, "implementation": "rust-native" }),
                false,
            ))
        }
        "snapshot" => Ok(tool_envelope(
            "Canvas snapshot loaded.",
            json!({ "status": "ok", "state": state, "implementation": "rust-native" }),
            false,
        )),
        "eval" => Ok(tool_envelope(
            "Canvas eval is recorded but not executed by the Rust canvas runtime.",
            json!({
                "status": "not_executed",
                "script": string_param(&input, &["script", "code"]),
                "state": state,
                "implementation": "rust-native"
            }),
            false,
        )),
        other => Err(format!("unsupported canvas action: {other}")),
    }
}

pub(super) fn media_urls_param(input: &Value) -> Vec<String> {
    input
        .get("mediaUrls")
        .or_else(|| input.get("media"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn append_tool_jsonl(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, value).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

pub(super) fn run_message_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let action = string_param(&input, &["action"]).unwrap_or_else(|| "send".to_string());
    let channel = string_param(&input, &["channel"]).unwrap_or_else(|| "desktop".to_string());
    let account_id = string_param(&input, &["accountId"]).unwrap_or_else(|| "default".to_string());
    let to =
        string_param(&input, &["to", "target", "recipient"]).unwrap_or_else(|| "user".to_string());
    let text = string_param(&input, &["text", "message", "body"]);
    let media_urls = media_urls_param(&input);
    if text.is_none() && media_urls.is_empty() && action != "action" {
        return Err("message requires text or media".to_string());
    }
    let now = now_millis();
    let request_id = string_param(&input, &["idempotencyKey", "runId", "requestId"])
        .unwrap_or_else(|| format!("message-{now}"));
    let outbound_action = match action.as_str() {
        "send" => ChannelOutboundAction::Send,
        "poll" => ChannelOutboundAction::Poll,
        "action" => {
            let raw = string_param(&input, &["outboundAction", "channelAction"])
                .unwrap_or_else(|| "threadReply".to_string());
            serde_json::from_value(Value::String(raw))
                .map_err(|error| format!("invalid message outbound action: {error}"))?
        }
        other => return Err(format!("unsupported message action: {other}")),
    };
    let request = ChannelOutboundRequest {
        request_id,
        channel: channel.clone(),
        account_id: Some(account_id),
        action: outbound_action,
        to,
        text,
        media_urls,
        reply_to_id: string_param(&input, &["replyToId", "replyTo", "messageId"]),
        thread_id: string_param(&input, &["threadId"]),
        params: BTreeMap::new(),
    };
    let record = dispatch_native_channel_outbound(
        &request,
        NativeChannelDispatchContext {
            connected: crate::is_local_native_delivery_channel(&channel),
            now_ms: now,
        },
    );
    let details = serde_json::to_value(&record).map_err(|error| error.to_string())?;
    let file = if record.sent {
        runtime_root.join("channels").join("deliveries.jsonl")
    } else {
        runtime_root.join("channels").join("outbox.jsonl")
    };
    append_tool_jsonl(&file, &details)?;
    Ok(tool_envelope(
        if record.sent {
            "Message delivered."
        } else {
            "Message queued or blocked."
        },
        details,
        false,
    ))
}

pub(super) async fn run_tts_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let text = required_param_string("tts", &input, &["text"])?;
    let mut provider_config = input
        .get("providerConfig")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    provider_config
        .entry("runtime".to_string())
        .or_insert_with(|| Value::String("qwen-tts".to_string()));
    provider_config
        .entry("baseUrl".to_string())
        .or_insert_with(|| {
            Value::String(
                string_param(&input, &["baseUrl"])
                    .unwrap_or_else(|| "http://127.0.0.1:8013".to_string()),
            )
        });
    provider_config
        .entry("defaultProfile".to_string())
        .or_insert_with(|| Value::String("assistant".to_string()));
    provider_config.entry("profiles".to_string()).or_insert_with(|| {
        json!({
            "assistant": {
                "source": "preset",
                "voice": string_param(&input, &["voice"]).unwrap_or_else(|| "serena".to_string()),
                "quality": "fast"
            }
        })
    });
    let request = json!({
        "text": text,
        "target": string_param(&input, &["channel"]).unwrap_or_else(|| "voice-note".to_string()),
        "providerConfig": provider_config,
        "providerOverrides": input.get("providerOverrides").cloned().unwrap_or_else(|| json!({})),
        "responseFormat": string_param(&input, &["outputFormat"]).unwrap_or_else(|| "wav".to_string()),
    });
    let result = invoke_native_plugin_operation(
        NativePluginRuntime::Builtin,
        NativeInvocationTarget {
            plugin_id: "qwen3-tts".to_string(),
            operation: "synthesize".to_string(),
        },
        with_native_runtime_context(runtime_root, request),
    )
    .await
    .map_err(|error| error.to_string())?;
    Ok(tool_envelope(
        "Generated audio reply.",
        json!({
            "provider": "qwen3-tts",
            "media": {
                "audioBase64": result.get("audioBase64").cloned().unwrap_or(Value::Null),
                "outputFormat": result.get("outputFormat").cloned().unwrap_or(Value::Null),
                "audioAsVoice": true
            },
            "result": result
        }),
        false,
    ))
}

pub(super) fn media_attachment_from_value(value: &str, index: usize, default_name: &str) -> Value {
    if let Some((mime, data)) = parse_data_url(value) {
        json!({ "index": index, "fileName": default_name, "mimeType": mime, "base64": data })
    } else {
        json!({ "index": index, "path": value })
    }
}

pub(super) fn parse_data_url(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim();
    let rest = trimmed.strip_prefix("data:")?;
    let (mime, data) = rest.split_once(";base64,")?;
    Some((mime.to_string(), data.to_string()))
}

pub(super) async fn run_image_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let mut attachments = Vec::new();
    if let Some(image) = string_param(&input, &["image"]) {
        attachments.push(media_attachment_from_value(&image, 0, "image-0"));
    }
    if let Some(images) = input.get("images").and_then(Value::as_array) {
        for (index, image) in images.iter().filter_map(Value::as_str).enumerate() {
            attachments.push(media_attachment_from_value(image, index, "image"));
        }
    }
    if attachments.is_empty() {
        return Err("image requires image or images".to_string());
    }
    let request = json!({
        "capability": "image",
        "prompt": string_param(&input, &["prompt"]).unwrap_or_else(|| "Describe the image.".to_string()),
        "model": string_param(&input, &["model"]).unwrap_or_else(|| "gpt-5.4-mini".to_string()),
        "provider": string_param(&input, &["provider"]).unwrap_or_else(|| "openai".to_string()),
        "apiKey": string_param(&input, &["apiKey"]),
        "baseUrl": string_param(&input, &["baseUrl"]),
        "attachments": attachments
    });
    let result = invoke_native_plugin_operation(
        NativePluginRuntime::Builtin,
        NativeInvocationTarget {
            plugin_id: "openai".to_string(),
            operation: "media-understanding".to_string(),
        },
        with_native_runtime_context(runtime_root, request),
    )
    .await
    .map_err(|error| error.to_string())?;
    Ok(tool_envelope("Image analysis complete.", result, false))
}

pub(super) async fn load_pdf_bytes(input: &str) -> Result<Vec<u8>, String> {
    if input.starts_with("http://") || input.starts_with("https://") {
        let response = reqwest::get(input)
            .await
            .map_err(|error| error.to_string())?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("PDF fetch failed with HTTP {status}"));
        }
        return response
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|error| error.to_string());
    }
    fs::read(input).map_err(|error| error.to_string())
}

pub(super) fn parse_pdf_page_filter(value: Option<&str>) -> Result<Option<Vec<usize>>, String> {
    let Some(raw) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let mut pages = Vec::new();
    for part in raw
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        if let Some((start, end)) = part.split_once('-') {
            let start = start
                .trim()
                .parse::<usize>()
                .map_err(|_| format!("invalid PDF page range: {part}"))?;
            let end = end
                .trim()
                .parse::<usize>()
                .map_err(|_| format!("invalid PDF page range: {part}"))?;
            if start == 0 || end == 0 || end < start {
                return Err(format!("invalid PDF page range: {part}"));
            }
            pages.extend(start..=end);
        } else {
            let page = part
                .parse::<usize>()
                .map_err(|_| format!("invalid PDF page: {part}"))?;
            if page == 0 {
                return Err(format!("invalid PDF page: {part}"));
            }
            pages.push(page);
        }
    }
    pages.sort_unstable();
    pages.dedup();
    Ok(Some(pages))
}

pub(super) async fn run_pdf_tool(_runtime_root: &Path, input: Value) -> Result<Value, String> {
    let mut pdfs = Vec::new();
    if let Some(pdf) = string_param(&input, &["pdf"]) {
        pdfs.push(pdf);
    }
    if let Some(items) = input.get("pdfs").and_then(Value::as_array) {
        pdfs.extend(
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned),
        );
    }
    if pdfs.is_empty() {
        return Err("pdf requires pdf or pdfs".to_string());
    }
    let max_bytes = input
        .get("maxBytesMb")
        .and_then(Value::as_u64)
        .unwrap_or(25)
        .saturating_mul(1024 * 1024);
    let max_chars = input
        .get("maxChars")
        .and_then(Value::as_u64)
        .unwrap_or(80_000) as usize;
    let page_filter = parse_pdf_page_filter(string_param(&input, &["pages"]).as_deref())?;
    let mut documents = Vec::new();
    for (index, pdf) in pdfs.iter().enumerate() {
        let bytes = load_pdf_bytes(pdf).await?;
        if bytes.len() as u64 > max_bytes {
            return Err(format!("PDF input exceeds maxBytesMb: {pdf}"));
        }
        let extracted_pages = pdf_extract::extract_text_from_mem_by_pages(&bytes)
            .map_err(|error| format!("PDF text extraction failed for {pdf}: {error}"))?;
        let selected_pages = extracted_pages
            .iter()
            .enumerate()
            .filter_map(|(page_index, text)| {
                let page_number = page_index + 1;
                if page_filter
                    .as_ref()
                    .map(|pages| pages.binary_search(&page_number).is_ok())
                    .unwrap_or(true)
                {
                    Some(json!({
                        "page": page_number,
                        "text": text
                    }))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let mut text = selected_pages
            .iter()
            .filter_map(|page| page.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n\n");
        let original_chars = text.chars().count();
        let truncated = original_chars > max_chars;
        if truncated {
            text = text.chars().take(max_chars).collect();
        }
        let text_preview = text.chars().take(2000).collect::<String>();
        documents.push(json!({
            "index": index,
            "source": pdf,
            "bytes": bytes.len(),
            "pageCount": extracted_pages.len(),
            "selectedPageCount": selected_pages.len(),
            "pages": selected_pages,
            "text": text,
            "textPreview": text_preview,
            "textChars": original_chars,
            "truncated": truncated
        }));
    }
    Ok(tool_envelope(
        "PDF analysis complete.",
        json!({
            "status": "ok",
            "implementation": "rust-native",
            "prompt": string_param(&input, &["prompt"]).unwrap_or_default(),
            "documents": documents,
            "providerAnalysis": Value::Null,
            "fallback": "rust-pdf-extract"
        }),
        false,
    ))
}

pub(super) fn run_discover_skills_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(5) as usize;
    let task = required_param_string("discover_skills", &input, &["taskDescription", "task"])?;
    let mut candidates = load_skill_candidates(runtime_root, &task);
    candidates.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
    let skills = candidates
        .into_iter()
        .take(limit.max(1))
        .map(|skill| {
            json!({
                "name": skill.name,
                "description": skill.description,
                "score": skill.score
            })
        })
        .collect::<Vec<_>>();
    Ok(tool_envelope(
        "Skill discovery complete.",
        json!({
            "status": "ok",
            "skills": skills,
            "reason": "rust-runtime-scan",
            "source": "rust-native",
            "reminder": "Use a discovered skill when it directly matches the next task."
        }),
        false,
    ))
}

pub(super) fn run_tool_search_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let query =
        required_param_string("tool_search", &input, &["query", "task", "taskDescription"])?;
    let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(8) as usize;
    let terms = query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| !term.is_empty())
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    let mut matches = pi_agent_rust_tool_descriptors_for_runtime_root(runtime_root)
        .into_iter()
        .filter(|descriptor| {
            !matches!(
                descriptor.name.as_str(),
                "tool_search" | "discover_skills" | "load_skill"
            ) && !is_special_agent_only_tool(descriptor.name.as_str())
        })
        .map(|descriptor| {
            let haystack = format!(
                "{} {} {}",
                descriptor.name, descriptor.label, descriptor.description
            )
            .to_lowercase();
            let score = terms
                .iter()
                .filter(|term| haystack.contains(term.as_str()))
                .count();
            (score, descriptor)
        })
        .filter(|(score, _)| *score > 0)
        .collect::<Vec<_>>();
    matches.sort_by(|(score_a, tool_a), (score_b, tool_b)| {
        score_b
            .cmp(score_a)
            .then_with(|| tool_a.name.cmp(&tool_b.name))
    });
    matches.truncate(limit.max(1));
    let activated_tools = matches
        .iter()
        .map(|(_, descriptor)| descriptor.name.clone())
        .collect::<Vec<_>>();
    let result_matches = matches
        .into_iter()
        .map(|(score, descriptor)| {
            json!({
                "name": descriptor.name,
                "description": descriptor.description,
                "readOnly": descriptor.read_only,
                "schemaActivated": true,
                "score": score
            })
        })
        .collect::<Vec<_>>();
    record_tool_activation_state(runtime_root, &activated_tools)?;
    Ok(tool_envelope(
        "Deferred tool search complete.",
        json!({
            "status": "ok",
            "matches": result_matches,
            "activatedTools": activated_tools,
            "activationScope": "next-provider-request",
            "source": "rust-native"
        }),
        false,
    ))
}

pub(super) fn run_load_skill_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let skill = required_param_string("load_skill", &input, &["skill", "name", "id"])?;
    let normalized = skill.trim().to_lowercase();
    let mut candidates = load_skill_candidates(runtime_root, &skill);
    candidates.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
    let candidate = candidates
        .into_iter()
        .find(|candidate| {
            candidate.name.eq_ignore_ascii_case(&normalized)
                || candidate.name.to_lowercase() == normalized
        })
        .or_else(|| {
            load_skill_candidates(runtime_root, "")
                .into_iter()
                .find(|candidate| candidate.name.to_lowercase() == normalized)
        })
        .ok_or_else(|| format!("load_skill could not find skill: {skill}"))?;
    record_loaded_skill_state(runtime_root, std::slice::from_ref(&candidate.name))?;
    Ok(tool_envelope(
        format!("Loaded skill {}.", candidate.name),
        json!({
            "status": "ok",
            "skill": {
                "name": candidate.name,
                "description": candidate.description,
                "content": candidate.content
            },
            "source": "rust-native"
        }),
        false,
    ))
}
