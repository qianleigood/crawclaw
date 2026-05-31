use serde_json::Value;

const MEMORY_TAGS: &[&str] = &[
    "hindsight_memories",
    "durable_recall",
    "experience_recall",
    "resource_recall",
    "mental_model_recall",
];

pub fn strip_memory_tags(message: &Value) -> Value {
    let mut cleaned = message.clone();
    if let Some(content) = cleaned.get("content").and_then(Value::as_str) {
        let mut result = content.to_string();
        for tag in MEMORY_TAGS {
            result = strip_tag(&result, tag);
        }
        cleaned["content"] = Value::String(result);
    }
    cleaned
}

fn strip_tag(content: &str, tag: &str) -> String {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let mut result = content.to_string();
    while let Some(start) = result.find(&open) {
        if let Some(end) = result[start..].find(&close) {
            let end = start + end + close.len();
            result = format!("{}{}", &result[..start], &result[end..]);
        } else {
            break;
        }
    }
    result
}

pub fn extract_text_content(message: &Value) -> String {
    if let Some(content) = message.get("content").and_then(Value::as_str) {
        return content.to_string();
    }
    if let Some(parts) = message.get("content").and_then(Value::as_array) {
        let texts: Vec<String> = parts
            .iter()
            .filter_map(|part| {
                if part.get("type").and_then(Value::as_str) == Some("text") {
                    part.get("text").and_then(Value::as_str).map(String::from)
                } else {
                    None
                }
            })
            .collect();
        return texts.join("\n");
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strips_hindsight_memories_tag() {
        let msg = json!({"content": "Before <hindsight_memories>injected memory</hindsight_memories> After"});
        let result = strip_memory_tags(&msg);
        assert_eq!(result["content"].as_str().unwrap(), "Before  After");
    }

    #[test]
    fn strips_multiple_tags() {
        let msg = json!({"content": "<durable_recall>old</durable_recall> real <experience_recall>exp</experience_recall>"});
        let result = strip_memory_tags(&msg);
        assert_eq!(result["content"].as_str().unwrap(), " real ");
    }

    #[test]
    fn preserves_non_memory_content() {
        let msg = json!({"content": "Normal message without any tags"});
        let result = strip_memory_tags(&msg);
        assert_eq!(
            result["content"].as_str().unwrap(),
            "Normal message without any tags"
        );
    }

    #[test]
    fn handles_malformed_tags() {
        let msg = json!({"content": "<hindsight_memories>unclosed tag"});
        let result = strip_memory_tags(&msg);
        assert_eq!(
            result["content"].as_str().unwrap(),
            "<hindsight_memories>unclosed tag"
        );
    }
}
