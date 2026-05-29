use std::path::PathBuf;

use serde_json::Value;

pub fn normalize_scope(scope: &str) -> Result<String, String> {
    let scope = scope.trim();
    if scope.is_empty() {
        return Err("scope cannot be empty".to_string());
    }
    let normalized: String = scope
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    Ok(normalized)
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn expand_user_path(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(&path[2..]);
        }
    }
    PathBuf::from(path)
}

pub fn read_json_array(path: &std::path::Path) -> Result<Vec<Value>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&text)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

pub fn write_json_array(path: &std::path::Path, entries: &[Value]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create dir {}: {e}", parent.display()))?;
    }
    let body = serde_json::to_vec_pretty(entries)
        .map_err(|e| format!("failed to serialize entries: {e}"))?;
    std::fs::write(path, &body)
        .map_err(|e| format!("failed to write {}: {e}", path.display()))
}

pub fn estimate_text_tokens(text: &str) -> u32 {
    (text.chars().count() as u32 / 4).max(1)
}

pub fn estimate_json_tokens(value: &Value) -> u32 {
    estimate_text_tokens(&serde_json::to_string(value).unwrap_or_default())
}

pub fn string_value(object: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = object.get(key).and_then(Value::as_str) {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

pub fn bool_value(object: Option<&Value>, key: &str, default: bool) -> bool {
    object
        .and_then(|o| o.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(default)
}
