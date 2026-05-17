use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

const BASE_CONFIG_SCHEMA_STABLE_JSON: &str =
    include_str!("config_contract/base_config_schema.stable.json");
const CONFIG_DOC_BASELINE_JSON: &str = include_str!("config_contract/config_doc_baseline.json");
const CONFIG_DOC_BASELINE_JSONL: &str = include_str!("config_contract/config_doc_baseline.jsonl");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigDocBaselineWriteResult {
    pub changed: bool,
    pub wrote: bool,
    pub json_path: PathBuf,
    pub jsonl_path: PathBuf,
}

pub fn base_config_schema_payload(generated_at: &str) -> Result<Value, String> {
    serde_json::from_str(&base_config_schema_payload_json(generated_at)?)
        .map_err(|error| format!("invalid rendered base config schema payload: {error}"))
}

pub fn base_config_schema_payload_json(generated_at: &str) -> Result<String, String> {
    let stable = serde_json::from_str::<Value>(BASE_CONFIG_SCHEMA_STABLE_JSON)
        .map_err(|error| format!("invalid embedded base config schema: {error}"))?;
    let object = stable
        .as_object()
        .ok_or_else(|| "embedded base config schema must be a JSON object".to_string())?;
    object
        .get("schema")
        .ok_or_else(|| "embedded base config schema is missing schema".to_string())?;
    object
        .get("uiHints")
        .ok_or_else(|| "embedded base config schema is missing uiHints".to_string())?;
    let schema = extract_top_level_json_field(BASE_CONFIG_SCHEMA_STABLE_JSON, "schema")?;
    let ui_hints = extract_top_level_json_field(BASE_CONFIG_SCHEMA_STABLE_JSON, "uiHints")?;
    Ok(format!(
        "{{\n  \"schema\": {schema},\n  \"uiHints\": {ui_hints},\n  \"version\": {},\n  \"generatedAt\": {}\n}}",
        serde_json::to_string(env!("CARGO_PKG_VERSION"))
            .expect("cargo package version encodes as JSON"),
        serde_json::to_string(generated_at).expect("generated timestamp encodes as JSON")
    ))
}

pub fn config_doc_baseline_json() -> &'static str {
    CONFIG_DOC_BASELINE_JSON
}

pub fn config_doc_baseline_jsonl() -> &'static str {
    CONFIG_DOC_BASELINE_JSONL
}

pub fn write_config_doc_baseline_artifacts(
    json_path: impl AsRef<Path>,
    jsonl_path: impl AsRef<Path>,
    check: bool,
) -> Result<ConfigDocBaselineWriteResult, String> {
    let json_path = json_path.as_ref().to_path_buf();
    let jsonl_path = jsonl_path.as_ref().to_path_buf();
    let current_json = read_optional_utf8(&json_path)?;
    let current_jsonl = read_optional_utf8(&jsonl_path)?;
    let changed = current_json.as_deref() != Some(CONFIG_DOC_BASELINE_JSON)
        || current_jsonl.as_deref() != Some(CONFIG_DOC_BASELINE_JSONL);

    if check {
        return Ok(ConfigDocBaselineWriteResult {
            changed,
            wrote: false,
            json_path,
            jsonl_path,
        });
    }

    if changed {
        write_utf8(&json_path, CONFIG_DOC_BASELINE_JSON)?;
        write_utf8(&jsonl_path, CONFIG_DOC_BASELINE_JSONL)?;
    }
    Ok(ConfigDocBaselineWriteResult {
        changed,
        wrote: changed,
        json_path,
        jsonl_path,
    })
}

fn read_optional_utf8(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("failed to read {}: {error}", path.display())),
    }
}

fn write_utf8(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    fs::write(path, content).map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn extract_top_level_json_field<'a>(raw: &'a str, field: &str) -> Result<&'a str, String> {
    let needle = serde_json::to_string(field)
        .map_err(|error| format!("invalid JSON field name: {error}"))?;
    let field_start = raw
        .find(&needle)
        .ok_or_else(|| format!("embedded base config schema is missing {field}"))?;
    let after_field = field_start + needle.len();
    let colon_offset = raw[after_field..]
        .find(':')
        .ok_or_else(|| format!("embedded base config schema field {field} is missing ':'"))?;
    let value_start = after_field
        + colon_offset
        + 1
        + raw[(after_field + colon_offset + 1)..]
            .chars()
            .take_while(|ch| ch.is_whitespace())
            .map(char::len_utf8)
            .sum::<usize>();
    let value_end = find_json_value_end(raw, value_start)?;
    Ok(raw[value_start..value_end].trim_end())
}

fn find_json_value_end(raw: &str, start: usize) -> Result<usize, String> {
    let mut stack = Vec::new();
    let mut in_string = false;
    let mut escaped = false;

    for (offset, ch) in raw[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => stack.push('}'),
            '[' => stack.push(']'),
            '}' | ']' => {
                if stack.pop() != Some(ch) {
                    return Err("embedded base config schema has mismatched JSON delimiters".into());
                }
                if stack.is_empty() {
                    return Ok(start + offset + ch.len_utf8());
                }
            }
            ',' if stack.is_empty() => return Ok(start + offset),
            _ => {}
        }
    }
    Err("embedded base config schema contains an unterminated JSON value".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path<'a>(value: &'a Value, keys: &[&str]) -> &'a Value {
        let mut current = value;
        for key in keys {
            current = current
                .get(*key)
                .unwrap_or_else(|| panic!("missing JSON path segment: {key}"));
        }
        current
    }

    fn string_array_contains(value: &Value, expected: &str) -> bool {
        value
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(expected)))
    }

    fn collect_const_strings(value: &Value, output: &mut Vec<String>) {
        match value {
            Value::Array(items) => {
                for item in items {
                    collect_const_strings(item, output);
                }
            }
            Value::Object(object) => {
                if let Some(raw) = object.get("const").and_then(Value::as_str) {
                    output.push(raw.to_string());
                }
                for item in object.values() {
                    collect_const_strings(item, output);
                }
            }
            _ => {}
        }
    }

    #[test]
    fn base_config_schema_payload_keeps_core_desktop_schema_bounds() {
        let payload = base_config_schema_payload("2026-01-02T03:04:05.000Z")
            .expect("base config schema payload");
        assert_eq!(payload["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(payload["generatedAt"], "2026-01-02T03:04:05.000Z");

        let root_properties = path(&payload, &["schema", "properties"])
            .as_object()
            .expect("root properties");
        assert!(root_properties.contains_key("gateway"));
        assert!(root_properties.contains_key("models"));
        assert!(root_properties.contains_key("plugins"));
        assert!(!root_properties.contains_key("channels"));
    }

    #[test]
    fn base_config_schema_payload_covers_secretref_provider_fields() {
        let payload = base_config_schema_payload("2026-01-02T03:04:05.000Z")
            .expect("base config schema payload");
        let api_key = path(
            &payload,
            &[
                "schema",
                "properties",
                "models",
                "properties",
                "providers",
                "additionalProperties",
                "properties",
                "apiKey",
            ],
        );
        let mut const_values = Vec::new();
        collect_const_strings(api_key, &mut const_values);
        assert!(const_values.iter().any(|value| value == "env"));
        assert!(const_values.iter().any(|value| value == "file"));
        assert!(const_values.iter().any(|value| value == "exec"));
    }

    #[test]
    fn base_config_schema_payload_marks_sensitive_urls() {
        let payload = base_config_schema_payload("2026-01-02T03:04:05.000Z")
            .expect("base config schema payload");
        assert!(string_array_contains(
            path(&payload, &["uiHints", "mcp.servers.*.url", "tags"]),
            "url-secret"
        ));
        assert!(string_array_contains(
            path(&payload, &["uiHints", "models.providers.*.baseUrl", "tags"]),
            "url-secret"
        ));
    }

    #[test]
    fn config_doc_baseline_artifacts_cover_runtime_config_docs() {
        let baseline: Value =
            serde_json::from_str(config_doc_baseline_json()).expect("config baseline JSON");
        assert_eq!(
            baseline["generatedBy"],
            "crawclaw-runtime emit-config-doc-baseline"
        );
        let entries = baseline["entries"].as_array().expect("baseline entries");
        assert!(entries.iter().any(|entry| {
            entry["path"] == "models.providers.*.apiKey"
                && entry["sensitive"].as_bool() == Some(true)
        }));
        assert!(entries.iter().any(|entry| {
            entry["path"] == "talk.silenceTimeoutMs"
                && entry["help"]
                    .as_str()
                    .is_some_and(|help| help.contains("platform default pause window"))
        }));

        let mut lines = config_doc_baseline_jsonl().lines();
        let meta: Value =
            serde_json::from_str(lines.next().expect("meta line")).expect("meta JSON");
        assert_eq!(
            meta["generatedBy"],
            "crawclaw-runtime emit-config-doc-baseline"
        );
        assert_eq!(meta["totalPaths"], entries.len());
    }
}
