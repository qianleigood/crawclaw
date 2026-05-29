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

fn require_media_tool_keys(
    input: &Value,
    allowed_keys: &[&str],
    tool_name: &str,
) -> Result<(), String> {
    let Some(object) = input.as_object() else {
        return Err(format!("{tool_name} input must be an object"));
    };
    for key in object.keys() {
        if !allowed_keys.contains(&key.as_str()) {
            return Err(format!("{tool_name} input contains unknown field: {key}"));
        }
    }
    Ok(())
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
        .or_else(|| input.get("attachments"))
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

fn user_message_attachment_paths(input: &Value) -> Vec<String> {
    input
        .get("attachments")
        .or_else(|| input.get("files"))
        .or_else(|| input.get("paths"))
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .or_else(|| {
            string_param(input, &["path", "file"]).map(|path| {
                let path = path.trim().to_string();
                if path.is_empty() {
                    Vec::new()
                } else {
                    vec![path]
                }
            })
        })
        .unwrap_or_default()
}

fn resolve_user_message_attachment(runtime_root: &Path, raw: &str) -> Result<Value, String> {
    let path = Path::new(raw);
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        runtime_root.join(path)
    };
    let metadata = fs::metadata(&path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => format!(
            "Attachment \"{raw}\" does not exist. Current working directory: {}.",
            runtime_root.display()
        ),
        std::io::ErrorKind::PermissionDenied => {
            format!("Attachment \"{raw}\" is not accessible (permission denied).")
        }
        _ => format!("Attachment \"{raw}\" cannot be read: {error}"),
    })?;
    if !metadata.is_file() {
        return Err(format!("Attachment \"{raw}\" is not a regular file."));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let is_image = matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "tif" | "heic" | "heif"
    );
    Ok(json!({
        "path": path.to_string_lossy(),
        "size": metadata.len(),
        "isImage": is_image
    }))
}

pub(super) fn run_user_message_tool(
    runtime_root: &Path,
    tool_name: &str,
    input: Value,
) -> Result<Value, String> {
    if matches!(tool_name, "SendUserMessage" | "Brief") {
        require_user_message_keys(&input, &["message", "attachments", "status"], tool_name)?;
    }
    let message = required_param_string(tool_name, &input, &["message"])?;
    let status = required_param_string(tool_name, &input, &["status"])?;
    if !matches!(status.as_str(), "normal" | "proactive") {
        return Err("status must be normal or proactive".to_string());
    }
    let attachments = user_message_attachment_paths(&input)
        .iter()
        .map(|path| resolve_user_message_attachment(runtime_root, path))
        .collect::<Result<Vec<_>, _>>()?;
    let sent_at = chrono::Utc::now().to_rfc3339();
    let now = now_millis();
    let request = ChannelOutboundRequest {
        request_id: string_param(&input, &["idempotencyKey", "runId", "requestId"])
            .unwrap_or_else(|| format!("user-message-{now}")),
        channel: string_param(&input, &["channel"]).unwrap_or_else(|| "desktop".to_string()),
        account_id: Some(
            string_param(&input, &["accountId"]).unwrap_or_else(|| "default".to_string()),
        ),
        action: ChannelOutboundAction::Send,
        to: string_param(&input, &["to", "target", "recipient"])
            .unwrap_or_else(|| "user".to_string()),
        text: Some(message.clone()),
        media_urls: attachments
            .iter()
            .filter_map(|attachment| attachment.get("path").and_then(Value::as_str))
            .map(ToOwned::to_owned)
            .collect(),
        reply_to_id: string_param(&input, &["replyToId", "replyTo", "messageId"]),
        thread_id: string_param(&input, &["threadId"]),
        params: BTreeMap::new(),
    };
    let delivery = dispatch_native_channel_outbound(
        &request,
        NativeChannelDispatchContext {
            connected: crate::is_local_native_delivery_channel(&request.channel),
            now_ms: now,
        },
    );
    let sent = delivery.sent;
    let details = json!({
        "message": message,
        "status": status,
        "attachments": attachments,
        "sentAt": sent_at,
        "delivery": delivery
    });
    let file = if sent {
        runtime_root.join("channels").join("deliveries.jsonl")
    } else {
        runtime_root.join("channels").join("outbox.jsonl")
    };
    append_tool_jsonl(&file, &details)?;
    let attachment_count = details
        .get("attachments")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let suffix = if attachment_count == 0 {
        String::new()
    } else if attachment_count == 1 {
        " (1 attachment included)".to_string()
    } else {
        format!(" ({attachment_count} attachments included)")
    };
    Ok(tool_envelope(
        format!("Message delivered to user.{suffix}"),
        details,
        false,
    ))
}

fn require_user_message_keys(
    input: &Value,
    allowed_keys: &[&str],
    tool_name: &str,
) -> Result<(), String> {
    let Some(object) = input.as_object() else {
        return Err(format!("{tool_name} input must be an object"));
    };
    for key in object.keys() {
        if !allowed_keys.contains(&key.as_str()) {
            return Err(format!("{tool_name} input contains unknown field: {key}"));
        }
    }
    Ok(())
}

pub(super) fn run_send_user_file_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let attachments = user_message_attachment_paths(&input);
    if attachments.is_empty() {
        return Err("SendUserFile requires at least one file path".to_string());
    }
    let mut normalized = input.as_object().cloned().unwrap_or_default();
    normalized.insert(
        "message".to_string(),
        Value::String(string_param(&input, &["message"]).unwrap_or_else(|| {
            if attachments.len() == 1 {
                "Sending 1 file.".to_string()
            } else {
                format!("Sending {} files.", attachments.len())
            }
        })),
    );
    normalized.insert(
        "status".to_string(),
        Value::String(string_param(&input, &["status"]).unwrap_or_else(|| "normal".to_string())),
    );
    normalized.insert(
        "attachments".to_string(),
        Value::Array(attachments.into_iter().map(Value::String).collect()),
    );
    run_user_message_tool(runtime_root, "SendUserFile", Value::Object(normalized))
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

pub(super) async fn run_sleep_tool(input: Value) -> Result<Value, String> {
    let duration_ms = input
        .get("durationMs")
        .or_else(|| input.get("duration_ms"))
        .or_else(|| input.get("milliseconds"))
        .and_then(Value::as_u64)
        .or_else(|| {
            input
                .get("seconds")
                .or_else(|| input.get("duration"))
                .and_then(Value::as_f64)
                .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
                .map(|seconds| (seconds * 1000.0).round() as u64)
        })
        .unwrap_or(1000);
    let duration_ms = duration_ms.min(5 * 60 * 1000);
    let started_at = now_millis();
    tokio::time::sleep(Duration::from_millis(duration_ms)).await;
    let ended_at = now_millis();
    Ok(tool_envelope(
        format!("Slept for {duration_ms}ms."),
        json!({
            "status": "completed",
            "durationMs": duration_ms,
            "startedAtMs": started_at,
            "endedAtMs": ended_at,
            "source": "rust-native"
        }),
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
    require_media_tool_keys(&input, &["query", "max_results"], "tool_search")?;
    let query = required_param_string("tool_search", &input, &["query"])?;
    let limit = tool_search_max_results(&input)?;
    let descriptors = pi_agent_rust_tool_descriptors_for_runtime_root(runtime_root)
        .into_iter()
        .filter(|descriptor| {
            !matches!(
                descriptor.name.as_str(),
                "tool_search" | "ToolSearch" | "discover_skills" | "Skill" | "load_skill"
            ) && !is_special_agent_only_tool(descriptor.name.as_str())
        })
        .collect::<Vec<_>>();
    let trimmed_query = query.trim();
    if trimmed_query
        .get(.."select:".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("select:"))
    {
        let selected = trimmed_query["select:".len()..].trim();
        if selected.is_empty() {
            let total_deferred_tools = descriptors.len();
            let pending_mcp_servers = pending_mcp_server_names(runtime_root);
            let text = tool_search_result_text(&[], &pending_mcp_servers);
            return Ok(tool_envelope(
                text,
                json!({
                    "status": "ok",
                    "query": query,
                    "matches": [],
                    "matchDetails": [],
                    "pending_mcp_servers": pending_mcp_servers,
                    "total_deferred_tools": total_deferred_tools,
                    "activatedTools": [],
                    "activationScope": "next-provider-request",
                    "source": "rust-native"
                }),
                false,
            ));
        }
        let requested = selected
            .split(',')
            .map(str::trim)
            .filter(|tool_name| !tool_name.is_empty())
            .collect::<Vec<_>>();
        let total_deferred_tools = descriptors.len();
        let mut matches = Vec::new();
        for tool_name in requested {
            let Some(descriptor) = descriptors
                .iter()
                .find(|descriptor| descriptor.name.eq_ignore_ascii_case(tool_name))
            else {
                continue;
            };
            if matches.iter().any(|entry: &Value| {
                entry
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.eq_ignore_ascii_case(&descriptor.name))
            }) {
                continue;
            }
            matches.push(json!({
                "name": descriptor.name,
                "description": descriptor.description,
                "readOnly": descriptor.read_only,
                "schemaActivated": true,
                "score": 1
            }));
        }
        let activated_tools = matches
            .iter()
            .filter_map(|value| {
                value
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect::<Vec<_>>();
        record_tool_activation_state(runtime_root, &activated_tools)?;
        let pending_mcp_servers = if activated_tools.is_empty() {
            pending_mcp_server_names(runtime_root)
        } else {
            Vec::new()
        };
        let text = tool_search_result_text(&activated_tools, &pending_mcp_servers);
        return Ok(tool_envelope(
            text,
            json!({
                "status": "ok",
                "query": query,
                "matches": activated_tools.clone(),
                "matchDetails": matches,
                "pending_mcp_servers": pending_mcp_servers,
                "total_deferred_tools": total_deferred_tools,
                "activatedTools": activated_tools,
                "activationScope": "next-provider-request",
                "source": "rust-native"
            }),
            false,
        ));
    }
    let total_deferred_tools = descriptors.len();
    let query_lower = query.to_lowercase();
    if let Some(descriptor) = descriptors
        .iter()
        .find(|descriptor| descriptor.name.eq_ignore_ascii_case(query.trim()))
    {
        let activated_tools = vec![descriptor.name.clone()];
        record_tool_activation_state(runtime_root, &activated_tools)?;
        let text = tool_search_result_text(&activated_tools, &[]);
        return Ok(tool_envelope(
            text,
            json!({
                "status": "ok",
                "query": query,
                "matches": activated_tools.clone(),
                "total_deferred_tools": total_deferred_tools,
                "activatedTools": activated_tools,
                "activationScope": "next-provider-request",
                "source": "rust-native"
            }),
            false,
        ));
    }
    if query_lower.starts_with("mcp__") && query_lower.len() > "mcp__".len() {
        let activated_tools = descriptors
            .iter()
            .filter(|descriptor| descriptor.name.to_lowercase().starts_with(&query_lower))
            .take(limit)
            .map(|descriptor| descriptor.name.clone())
            .collect::<Vec<_>>();
        if !activated_tools.is_empty() {
            record_tool_activation_state(runtime_root, &activated_tools)?;
            let text = tool_search_result_text(&activated_tools, &[]);
            return Ok(tool_envelope(
                text,
                json!({
                    "status": "ok",
                    "query": query,
                    "matches": activated_tools.clone(),
                    "pending_mcp_servers": [],
                    "total_deferred_tools": total_deferred_tools,
                    "activatedTools": activated_tools,
                    "activationScope": "next-provider-request",
                    "source": "rust-native"
                }),
                false,
            ));
        }
    }
    let (required_terms, optional_terms) = tool_search_terms(&query);
    let scoring_terms = if required_terms.is_empty() {
        optional_terms.clone()
    } else {
        required_terms
            .iter()
            .chain(optional_terms.iter())
            .cloned()
            .collect::<Vec<_>>()
    };
    let mut matches = descriptors
        .into_iter()
        .map(|descriptor| {
            let parsed = parsed_tool_search_name(&descriptor.name);
            let description = descriptor.description.to_lowercase();
            let label = descriptor.label.to_lowercase();
            let matches_required = required_terms
                .iter()
                .all(|term| tool_search_term_matches(&parsed, &label, &description, term));
            let score = if matches_required {
                scoring_terms
                    .iter()
                    .map(|term| tool_search_term_score(&parsed, &label, &description, term))
                    .sum()
            } else {
                0
            };
            (score, descriptor)
        })
        .filter(|(score, _)| *score > 0)
        .collect::<Vec<_>>();
    matches.sort_by(|(score_a, tool_a), (score_b, tool_b)| {
        score_b
            .cmp(score_a)
            .then_with(|| tool_a.name.cmp(&tool_b.name))
    });
    matches.truncate(limit);
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
    let pending_mcp_servers = if activated_tools.is_empty() {
        pending_mcp_server_names(runtime_root)
    } else {
        Vec::new()
    };
    let text = tool_search_result_text(&activated_tools, &pending_mcp_servers);
    Ok(tool_envelope(
        text,
        json!({
            "status": "ok",
            "query": query,
            "matches": activated_tools.clone(),
            "matchDetails": result_matches,
            "pending_mcp_servers": pending_mcp_servers,
            "total_deferred_tools": total_deferred_tools,
            "activatedTools": activated_tools,
            "activationScope": "next-provider-request",
            "source": "rust-native"
        }),
        false,
    ))
}

fn tool_search_max_results(input: &Value) -> Result<usize, String> {
    let Some(value) = input.get("max_results") else {
        return Ok(5);
    };
    if let Some(number) = value.as_u64() {
        return usize::try_from(number)
            .map_err(|_| "max_results is too large for this platform.".to_string());
    }
    if let Some(number) = value.as_f64() {
        if number.is_finite() && number >= 0.0 {
            return Ok(number.trunc() as usize);
        }
    }
    Err("max_results must be a number.".to_string())
}

#[derive(Clone)]
struct ParsedToolSearchName {
    parts: Vec<String>,
    full: String,
    is_mcp: bool,
}

fn tool_search_terms(query: &str) -> (Vec<String>, Vec<String>) {
    let mut required = Vec::new();
    let mut optional = Vec::new();
    for token in query.to_lowercase().split_whitespace() {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        if let Some(term) = token.strip_prefix('+').filter(|term| !term.is_empty()) {
            required.push(tool_search_clean_term(term));
        } else {
            optional.push(tool_search_clean_term(token));
        }
    }
    required.retain(|term| !term.is_empty());
    optional.retain(|term| !term.is_empty());
    (required, optional)
}

fn tool_search_clean_term(term: &str) -> String {
    term.trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-')
        .to_string()
}

fn parsed_tool_search_name(name: &str) -> ParsedToolSearchName {
    if let Some(without_prefix) = name.strip_prefix("mcp__") {
        let parts = without_prefix
            .to_lowercase()
            .split("__")
            .flat_map(|part| part.split('_'))
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        return ParsedToolSearchName {
            full: parts.join(" "),
            parts,
            is_mcp: true,
        };
    }
    let mut normalized = String::new();
    for (index, ch) in name.chars().enumerate() {
        if index > 0 && ch.is_ascii_uppercase() {
            normalized.push(' ');
        }
        if ch == '_' || ch == '-' {
            normalized.push(' ');
        } else {
            normalized.push(ch.to_ascii_lowercase());
        }
    }
    let parts = normalized
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    ParsedToolSearchName {
        full: parts.join(" "),
        parts,
        is_mcp: false,
    }
}

fn tool_search_term_matches(
    parsed: &ParsedToolSearchName,
    label: &str,
    description: &str,
    term: &str,
) -> bool {
    parsed.parts.iter().any(|part| part.contains(term))
        || parsed.full.contains(term)
        || label.contains(term)
        || description.contains(term)
}

fn tool_search_term_score(
    parsed: &ParsedToolSearchName,
    label: &str,
    description: &str,
    term: &str,
) -> usize {
    let mut score = 0;
    if parsed.parts.iter().any(|part| part == term) {
        score += if parsed.is_mcp { 12 } else { 10 };
    } else if parsed.parts.iter().any(|part| part.contains(term)) {
        score += if parsed.is_mcp { 6 } else { 5 };
    }
    if parsed.full.contains(term) && score == 0 {
        score += 3;
    }
    if label.contains(term) {
        score += 4;
    }
    if description.contains(term) {
        score += 2;
    }
    score
}

fn tool_search_result_text(matches: &[String], pending_mcp_servers: &[String]) -> String {
    if matches.is_empty() {
        let mut text = "No matching deferred tools found".to_string();
        if !pending_mcp_servers.is_empty() {
            text.push_str(&format!(
                ". Some MCP servers are still connecting: {}. Their tools will become available shortly — try searching again.",
                pending_mcp_servers.join(", ")
            ));
        }
        text
    } else {
        matches.join("\n")
    }
}

pub(super) fn run_load_skill_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    let skill = required_param_string("load_skill", &input, &["skill", "name", "id"])?;
    let candidate = resolve_skill_candidate(runtime_root, &skill, "load_skill")?;
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

pub(super) fn run_skill_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    require_media_tool_keys(&input, &["skill", "args"], "Skill")?;
    let skill = required_param_string("Skill", &input, &["skill"])?;
    let args = input
        .get("args")
        .and_then(Value::as_str)
        .map(str::to_string);
    let candidate = resolve_skill_candidate(runtime_root, &skill, "Skill")?;
    record_loaded_skill_state(runtime_root, std::slice::from_ref(&candidate.name))?;
    Ok(tool_envelope(
        format!("Launching skill: {}", candidate.name),
        json!({
            "success": true,
            "commandName": candidate.name,
            "status": "inline",
            "args": args,
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

fn resolve_skill_candidate(
    runtime_root: &Path,
    skill: &str,
    tool_name: &str,
) -> Result<crate::SkillCandidate, String> {
    let normalized = skill.trim().trim_start_matches('/').to_lowercase();
    if normalized.is_empty() {
        return Err(format!("{tool_name} requires a non-empty skill name"));
    }
    let mut candidates = load_skill_candidates(runtime_root, &normalized);
    candidates.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
    candidates
        .into_iter()
        .find(|candidate| candidate.name.to_lowercase() == normalized)
        .or_else(|| {
            load_skill_candidates(runtime_root, "")
                .into_iter()
                .find(|candidate| candidate.name.to_lowercase() == normalized)
        })
        .ok_or_else(|| format!("{tool_name} could not find skill: {skill}"))
}
