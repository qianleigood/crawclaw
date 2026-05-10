use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use chrono::Utc;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::time::sleep;

use crate::error::{invalid_input, runtime_error, NativeResult};

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8188";
const DEFAULT_OUTPUT_DIR: &str = ".crawclaw/comfyui/outputs";
const DEFAULT_WORKFLOWS_DIR: &str = ".crawclaw/comfyui/workflows";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComfyUiResolvedConfig {
    pub base_url: String,
    pub output_dir: String,
    pub workflows_dir: String,
    pub allowed_input_dirs: Vec<String>,
    pub max_plan_repair_attempts: u64,
    pub request_timeout_ms: u64,
    pub run_timeout_ms: u64,
    pub run_poll_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComfyGraphIrNode {
    pub id: String,
    #[serde(rename = "classType", alias = "class_type")]
    pub class_type: String,
    pub purpose: String,
    pub inputs: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComfyGraphIrEdge {
    pub from: String,
    #[serde(rename = "fromOutput", alias = "from_output")]
    pub from_output: usize,
    pub to: String,
    #[serde(rename = "toInput", alias = "to_input")]
    pub to_input: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComfyGraphIrOutput {
    #[serde(rename = "nodeId", alias = "node_id")]
    pub node_id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComfyGraphIr {
    pub id: String,
    pub goal: String,
    #[serde(rename = "mediaKind", alias = "media_kind")]
    pub media_kind: String,
    pub intent: String,
    pub nodes: Vec<ComfyGraphIrNode>,
    pub edges: Vec<ComfyGraphIrEdge>,
    pub outputs: Vec<ComfyGraphIrOutput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComfyOutputArtifact {
    pub kind: String,
    #[serde(rename = "nodeId", alias = "node_id")]
    pub node_id: String,
    pub filename: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subfolder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    #[serde(rename = "localPath", default, skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyGraphDiagnostic {
    pub code: String,
    pub severity: String,
    #[serde(rename = "nodeId", default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(rename = "classType", default, skip_serializing_if = "Option::is_none")]
    pub class_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub message: String,
    #[serde(
        rename = "repairHint",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub repair_hint: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ComfyInputSpec {
    pub name: String,
    pub input_type: Option<String>,
    pub default_value: Option<Value>,
    pub choices: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ComfyNodeSpec {
    pub class_type: String,
    pub display_name: Option<String>,
    pub category: Option<String>,
    pub required_inputs: Vec<ComfyInputSpec>,
    pub optional_inputs: Vec<ComfyInputSpec>,
    pub outputs: Vec<String>,
    pub output_names: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ComfyNodeCatalog {
    pub fingerprint: String,
    pub nodes: Vec<ComfyNodeSpec>,
    by_class: HashMap<String, ComfyNodeSpec>,
}

impl ComfyNodeCatalog {
    pub fn get_node(&self, class_type: &str) -> Option<&ComfyNodeSpec> {
        self.by_class.get(class_type)
    }

    pub fn find_video_output_nodes(&self) -> Vec<&ComfyNodeSpec> {
        self.nodes
            .iter()
            .filter(|node| {
                let signal = node_signal(node).to_ascii_lowercase();
                (signal.contains("video")
                    || signal.contains("vhs")
                    || signal.contains("animate")
                    || signal.contains("wan")
                    || signal.contains("hunyuan")
                    || signal.contains("svd")
                    || signal.contains("frame")
                    || signal.contains("temporal"))
                    && (node.outputs.is_empty()
                        || signal.contains("file")
                        || signal.contains("image")
                        || signal.contains("video"))
            })
            .collect()
    }

    pub fn find_image_output_nodes(&self) -> Vec<&ComfyNodeSpec> {
        self.nodes
            .iter()
            .filter(|node| {
                let signal = node_signal(node).to_ascii_lowercase();
                (signal.contains("saveimage")
                    || signal.contains("save image")
                    || signal.contains("image"))
                    && (node.outputs.is_empty() || signal.contains("image"))
            })
            .collect()
    }
}

fn value_as_object(value: &Value) -> Option<&Map<String, Value>> {
    value.as_object()
}

fn read_string(config: &Value, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
}

fn read_u64(config: &Value, key: &str, fallback: u64) -> u64 {
    config
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn read_string_array(config: &Value, key: &str) -> Vec<String> {
    config
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn is_loopback_host(hostname: &str) -> bool {
    matches!(
        hostname.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn resolve_workspace_dir(workspace_dir: Option<&str>) -> NativeResult<PathBuf> {
    Ok(match workspace_dir {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(value)),
        _ => std::env::current_dir()?,
    })
}

fn resolve_config_path(workspace_dir: &Path, value: &str) -> String {
    let path = PathBuf::from(value);
    let resolved = if path.is_absolute() {
        path
    } else {
        workspace_dir.join(path)
    };
    path_to_string(resolved)
}

fn normalize_base_url(raw: &str, allow_remote: bool) -> NativeResult<String> {
    let mut url = Url::parse(raw)
        .map_err(|error| invalid_input(format!("Invalid ComfyUI baseUrl: {error}")))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(invalid_input(format!(
            "Invalid ComfyUI baseUrl protocol: {}",
            url.scheme()
        )));
    }
    if !allow_remote && !is_loopback_host(url.host_str().unwrap_or_default()) {
        return Err(invalid_input(
            "ComfyUI non-loopback baseUrl requires allowRemote: true.",
        ));
    }
    url.set_query(None);
    url.set_fragment(None);
    let normalized_path = url.path().trim_end_matches('/').to_string();
    url.set_path(&normalized_path);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub fn assert_path_inside(root: &str, candidate: &str) -> NativeResult<()> {
    let root = PathBuf::from(root);
    let candidate = PathBuf::from(candidate);
    if candidate.starts_with(&root) {
        Ok(())
    } else {
        Err(invalid_input(format!(
            "Path is outside allowed root: {}",
            candidate.display()
        )))
    }
}

pub fn resolve_comfyui_config(
    workspace_dir: Option<&str>,
    plugin_config: Value,
) -> NativeResult<ComfyUiResolvedConfig> {
    let workspace = resolve_workspace_dir(workspace_dir)?;
    let allow_remote = plugin_config
        .get("allowRemote")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let base_url = normalize_base_url(
        read_string(&plugin_config, "baseUrl")
            .as_deref()
            .unwrap_or(DEFAULT_BASE_URL),
        allow_remote,
    )?;
    let output_dir = resolve_config_path(
        &workspace,
        read_string(&plugin_config, "outputDir")
            .as_deref()
            .unwrap_or(DEFAULT_OUTPUT_DIR),
    );
    let workflows_dir = resolve_config_path(
        &workspace,
        read_string(&plugin_config, "workflowsDir")
            .as_deref()
            .unwrap_or(DEFAULT_WORKFLOWS_DIR),
    );
    let allowed_input_dirs = std::iter::once(path_to_string(workspace.clone()))
        .chain(
            read_string_array(&plugin_config, "allowedInputDirs")
                .into_iter()
                .map(|entry| resolve_config_path(&workspace, &entry)),
        )
        .collect();
    Ok(ComfyUiResolvedConfig {
        base_url,
        output_dir,
        workflows_dir,
        allowed_input_dirs,
        max_plan_repair_attempts: read_u64(&plugin_config, "maxPlanRepairAttempts", 3),
        request_timeout_ms: read_u64(&plugin_config, "requestTimeoutMs", 30_000),
        run_timeout_ms: read_u64(&plugin_config, "runTimeoutMs", 900_000),
        run_poll_interval_ms: read_u64(&plugin_config, "runPollIntervalMs", 1_000),
    })
}

pub fn compile_graph_ir_to_prompt(ir: &ComfyGraphIr) -> Value {
    let mut id_map = HashMap::new();
    for (index, node) in ir.nodes.iter().enumerate() {
        id_map.insert(node.id.clone(), (index + 1).to_string());
    }
    let mut prompt = Map::new();
    for node in &ir.nodes {
        if let Some(prompt_id) = id_map.get(&node.id) {
            prompt.insert(
                prompt_id.clone(),
                json!({
                    "class_type": node.class_type,
                    "inputs": node.inputs.as_object().cloned().unwrap_or_default()
                }),
            );
        }
    }
    for edge in &ir.edges {
        let Some(from) = id_map.get(&edge.from) else {
            continue;
        };
        let Some(to) = id_map.get(&edge.to) else {
            continue;
        };
        if let Some(inputs) = prompt
            .get_mut(to)
            .and_then(Value::as_object_mut)
            .and_then(|node| node.get_mut("inputs"))
            .and_then(Value::as_object_mut)
        {
            inputs.insert(edge.to_input.clone(), json!([from, edge.from_output]));
        }
    }
    Value::Object(prompt)
}

fn normalize_output(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|entry| {
            entry
                .as_str()
                .map(ToString::to_string)
                .unwrap_or_else(|| entry.to_string())
        })
        .collect()
}

fn parse_input_tuple(value: &Value) -> (Option<String>, Vec<String>, Option<Value>) {
    let Some(entries) = value.as_array() else {
        return (None, vec![], None);
    };
    let mut input_type = None;
    let mut choices = vec![];
    if let Some(first) = entries.first() {
        if let Some(array) = first.as_array() {
            choices = array
                .iter()
                .map(|entry| {
                    entry
                        .as_str()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| entry.to_string())
                })
                .collect();
            input_type = Some("ENUM".to_string());
        } else if let Some(raw) = first.as_str() {
            input_type = Some(raw.to_string());
        }
    }
    let default_value = entries
        .get(1)
        .and_then(Value::as_object)
        .and_then(|record| record.get("default"))
        .cloned();
    (input_type, choices, default_value)
}

fn normalize_inputs(value: Option<&Value>) -> Vec<ComfyInputSpec> {
    value
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|record| record.iter())
        .map(|(name, raw)| {
            let (input_type, choices, default_value) = parse_input_tuple(raw);
            ComfyInputSpec {
                name: name.clone(),
                input_type,
                default_value,
                choices,
            }
        })
        .collect()
}

fn normalize_node(class_type: &str, value: &Value) -> ComfyNodeSpec {
    let record = value_as_object(value);
    let input = record
        .and_then(|entry| entry.get("input"))
        .and_then(Value::as_object);
    ComfyNodeSpec {
        class_type: class_type.to_string(),
        display_name: record
            .and_then(|entry| entry.get("display_name"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        category: record
            .and_then(|entry| entry.get("category"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        required_inputs: normalize_inputs(input.and_then(|entry| entry.get("required"))),
        optional_inputs: normalize_inputs(input.and_then(|entry| entry.get("optional"))),
        outputs: normalize_output(record.and_then(|entry| entry.get("output"))),
        output_names: normalize_output(record.and_then(|entry| entry.get("output_name"))),
    }
}

fn node_signal(node: &ComfyNodeSpec) -> String {
    [
        Some(node.class_type.as_str()),
        node.display_name.as_deref(),
        node.category.as_deref(),
    ]
    .into_iter()
    .flatten()
    .chain(node.outputs.iter().map(String::as_str))
    .chain(node.output_names.iter().map(String::as_str))
    .collect::<Vec<_>>()
    .join(" ")
}

pub fn normalize_node_catalog(object_info: &Value) -> ComfyNodeCatalog {
    let mut nodes = object_info
        .as_object()
        .into_iter()
        .flat_map(|record| record.iter())
        .map(|(class_type, value)| normalize_node(class_type, value))
        .collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.class_type.cmp(&right.class_type));
    let mut hash_input = vec![];
    for node in &nodes {
        hash_input.push(json!({
            "c": node.class_type,
            "i": node.required_inputs.iter().map(|input| json!({
                "name": input.name,
                "type": input.input_type,
                "choices": input.choices,
                "defaultValue": input.default_value,
            })).collect::<Vec<_>>(),
            "o": node.outputs
        }));
    }
    let digest = Sha256::digest(serde_json::to_vec(&hash_input).unwrap_or_default());
    let fingerprint = format!("{digest:x}").chars().take(16).collect();
    let by_class = nodes
        .iter()
        .cloned()
        .map(|node| (node.class_type.clone(), node))
        .collect();
    ComfyNodeCatalog {
        fingerprint,
        nodes,
        by_class,
    }
}

fn has_input(ir: &ComfyGraphIr, node_id: &str, input_name: &str) -> bool {
    ir.nodes
        .iter()
        .find(|node| node.id == node_id)
        .and_then(|node| node.inputs.as_object())
        .is_some_and(|inputs| inputs.contains_key(input_name))
        || ir
            .edges
            .iter()
            .any(|edge| edge.to == node_id && edge.to_input == input_name)
}

fn input_type(node: Option<&ComfyNodeSpec>, input_name: &str) -> Option<String> {
    node.into_iter()
        .flat_map(|entry| {
            entry
                .required_inputs
                .iter()
                .chain(entry.optional_inputs.iter())
        })
        .find(|input| input.name == input_name)
        .and_then(|input| input.input_type.clone())
}

fn is_compatible_type(from: Option<&String>, to: Option<&String>) -> bool {
    match (from, to) {
        (_, None) | (None, _) => true,
        (_, Some(value)) if value == "ENUM" => true,
        (Some(left), Some(right)) => left == right,
    }
}

pub fn validate_graph_ir(
    ir: &ComfyGraphIr,
    catalog: &ComfyNodeCatalog,
) -> (bool, Vec<ComfyGraphDiagnostic>) {
    let mut diagnostics = vec![];
    let by_id = ir
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    for node in &ir.nodes {
        let Some(catalog_node) = catalog.get_node(&node.class_type) else {
            diagnostics.push(ComfyGraphDiagnostic {
                code: "missing_node_class".to_string(),
                severity: "error".to_string(),
                node_id: Some(node.id.clone()),
                class_type: Some(node.class_type.clone()),
                field: None,
                message: format!(
                    "ComfyUI node class \"{}\" is not available locally.",
                    node.class_type
                ),
                repair_hint: None,
            });
            continue;
        };
        for input in &catalog_node.required_inputs {
            if !has_input(ir, &node.id, &input.name) {
                diagnostics.push(ComfyGraphDiagnostic {
                    code: "missing_required_input".to_string(),
                    severity: "error".to_string(),
                    node_id: Some(node.id.clone()),
                    class_type: Some(node.class_type.clone()),
                    field: Some(input.name.clone()),
                    message: format!(
                        "Missing required input \"{}\" for {}.",
                        input.name, node.class_type
                    ),
                    repair_hint: input
                        .default_value
                        .as_ref()
                        .map(|_| "Fill the ComfyUI default value.".to_string()),
                });
            }
        }
        if let Some(inputs) = node.inputs.as_object() {
            for input in catalog_node
                .required_inputs
                .iter()
                .chain(catalog_node.optional_inputs.iter())
            {
                if input.choices.is_empty() {
                    continue;
                }
                let Some(value) = inputs.get(&input.name).and_then(Value::as_str) else {
                    continue;
                };
                if !input.choices.iter().any(|choice| choice == value) {
                    diagnostics.push(ComfyGraphDiagnostic {
                        code: "invalid_choice".to_string(),
                        severity: "error".to_string(),
                        node_id: Some(node.id.clone()),
                        class_type: Some(node.class_type.clone()),
                        field: Some(input.name.clone()),
                        message: format!(
                            "Invalid value \"{value}\" for {}.{}.",
                            node.class_type, input.name
                        ),
                        repair_hint: Some(format!("Choose one of: {}", input.choices.join(", "))),
                    });
                }
            }
        }
    }
    for edge in &ir.edges {
        let from = by_id.get(edge.from.as_str());
        let to = by_id.get(edge.to.as_str());
        let (Some(from), Some(to)) = (from, to) else {
            diagnostics.push(ComfyGraphDiagnostic {
                code: "missing_reference".to_string(),
                severity: "error".to_string(),
                node_id: to.map(|node| node.id.clone()),
                class_type: None,
                field: Some(edge.to_input.clone()),
                message: format!(
                    "Invalid edge reference {} -> {}.{}.",
                    edge.from, edge.to, edge.to_input
                ),
                repair_hint: None,
            });
            continue;
        };
        let from_type = catalog
            .get_node(&from.class_type)
            .and_then(|node| node.outputs.get(edge.from_output));
        let to_type = input_type(catalog.get_node(&to.class_type), &edge.to_input);
        if !is_compatible_type(from_type, to_type.as_ref()) {
            diagnostics.push(ComfyGraphDiagnostic {
                code: "type_mismatch".to_string(),
                severity: "warning".to_string(),
                node_id: Some(to.id.clone()),
                class_type: None,
                field: Some(edge.to_input.clone()),
                message: format!(
                    "Edge {} output {} ({}) may not match {}.{} ({}).",
                    edge.from,
                    edge.from_output,
                    from_type.cloned().unwrap_or_default(),
                    to.class_type,
                    edge.to_input,
                    to_type.unwrap_or_default()
                ),
                repair_hint: None,
            });
        }
    }
    if ir.media_kind == "video" && catalog.find_video_output_nodes().is_empty() {
        diagnostics.push(ComfyGraphDiagnostic {
            code: "missing_video_output_node".to_string(),
            severity: "error".to_string(),
            node_id: None,
            class_type: None,
            field: None,
            message: "The local ComfyUI catalog does not expose a video output/combine node."
                .to_string(),
            repair_hint: Some(
                "Install or enable a local video output node pack, then refresh the catalog."
                    .to_string(),
            ),
        });
    }
    if ir.media_kind == "image" && catalog.find_image_output_nodes().is_empty() {
        diagnostics.push(ComfyGraphDiagnostic {
            code: "missing_image_output_node".to_string(),
            severity: "error".to_string(),
            node_id: None,
            class_type: None,
            field: None,
            message: "The local ComfyUI catalog does not expose an image output node.".to_string(),
            repair_hint: None,
        });
    }
    let ok = diagnostics.iter().all(|diag| diag.severity != "error");
    (ok, diagnostics)
}

fn file_kind(key: &str, filename: &str) -> String {
    let normalized = format!("{key} {filename}").to_ascii_lowercase();
    if normalized.ends_with(".png")
        || normalized.ends_with(".jpg")
        || normalized.ends_with(".jpeg")
        || normalized.ends_with(".webp")
        || normalized.ends_with(".gif")
        || normalized.contains("image")
    {
        "image".to_string()
    } else if normalized.ends_with(".mp4")
        || normalized.ends_with(".webm")
        || normalized.ends_with(".mov")
        || normalized.ends_with(".mkv")
        || normalized.contains("video")
    {
        "video".to_string()
    } else if normalized.ends_with(".wav")
        || normalized.ends_with(".mp3")
        || normalized.ends_with(".flac")
        || normalized.ends_with(".ogg")
        || normalized.contains("audio")
    {
        "audio".to_string()
    } else {
        "unknown".to_string()
    }
}

fn history_entry<'a>(prompt_id: &str, history: &'a Value) -> &'a Value {
    history
        .as_object()
        .and_then(|record| record.get(prompt_id))
        .unwrap_or(history)
}

pub fn collect_output_artifacts(prompt_id: &str, history: &Value) -> Vec<ComfyOutputArtifact> {
    let outputs = history_entry(prompt_id, history)
        .get("outputs")
        .and_then(Value::as_object);
    let mut artifacts = vec![];
    let Some(outputs) = outputs else {
        return artifacts;
    };
    for (node_id, node_output) in outputs {
        let Some(node_record) = node_output.as_object() else {
            continue;
        };
        let animated = node_record
            .get("animated")
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().any(|value| value.as_bool() == Some(true)));
        for (key, value) in node_record {
            let Some(items) = value.as_array() else {
                continue;
            };
            for item in items {
                let Some(filename) = item.get("filename").and_then(Value::as_str) else {
                    continue;
                };
                artifacts.push(ComfyOutputArtifact {
                    kind: if animated && key == "images" {
                        "video".to_string()
                    } else {
                        file_kind(key, filename)
                    },
                    node_id: node_id.clone(),
                    filename: filename.to_string(),
                    subfolder: item
                        .get("subfolder")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    r#type: item
                        .get("type")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    mime: None,
                    local_path: None,
                });
            }
        }
    }
    artifacts
}

fn infer_media_kind(goal: &str, media_kind: Option<&str>) -> String {
    match media_kind {
        Some(value) if value != "auto" => value.to_string(),
        _ if goal.to_ascii_lowercase().contains("video")
            || goal.contains("动画")
            || goal.contains("视频") =>
        {
            "video".to_string()
        }
        _ => "image".to_string(),
    }
}

fn first_image_checkpoint(catalog: &ComfyNodeCatalog) -> String {
    let choices = catalog
        .get_node("CheckpointLoaderSimple")
        .into_iter()
        .flat_map(|node| {
            node.required_inputs
                .iter()
                .chain(node.optional_inputs.iter())
        })
        .find(|input| input.name == "ckpt_name")
        .map(|input| input.choices.clone())
        .unwrap_or_default();
    choices
        .iter()
        .find(|choice| {
            let lower = choice.to_ascii_lowercase();
            ![
                "svd",
                "video",
                "img2vid",
                "i2v",
                "animatediff",
                "wan",
                "hunyuan",
                "ltxv",
                "mochi",
            ]
            .iter()
            .any(|needle| lower.contains(needle))
        })
        .or_else(|| choices.first())
        .cloned()
        .unwrap_or_else(|| "model.safetensors".to_string())
}

fn has_common_image_path(catalog: &ComfyNodeCatalog) -> bool {
    [
        "CheckpointLoaderSimple",
        "CLIPTextEncode",
        "EmptyLatentImage",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    ]
    .iter()
    .all(|class_type| catalog.get_node(class_type).is_some())
}

fn image_graph(goal: &str, catalog: &ComfyNodeCatalog) -> ComfyGraphIr {
    ComfyGraphIr {
        id: "draft".to_string(),
        goal: goal.to_string(),
        media_kind: "image".to_string(),
        intent: "text-to-image".to_string(),
        nodes: vec![
            ComfyGraphIrNode {
                id: "loader".to_string(),
                class_type: "CheckpointLoaderSimple".to_string(),
                purpose: "load checkpoint".to_string(),
                inputs: json!({ "ckpt_name": first_image_checkpoint(catalog) }),
            },
            ComfyGraphIrNode {
                id: "positive".to_string(),
                class_type: "CLIPTextEncode".to_string(),
                purpose: "positive prompt".to_string(),
                inputs: json!({ "text": goal }),
            },
            ComfyGraphIrNode {
                id: "negative".to_string(),
                class_type: "CLIPTextEncode".to_string(),
                purpose: "negative prompt".to_string(),
                inputs: json!({ "text": "" }),
            },
            ComfyGraphIrNode {
                id: "latent".to_string(),
                class_type: "EmptyLatentImage".to_string(),
                purpose: "latent image".to_string(),
                inputs: json!({ "width": 512, "height": 512, "batch_size": 1 }),
            },
            ComfyGraphIrNode {
                id: "sampler".to_string(),
                class_type: "KSampler".to_string(),
                purpose: "sample image".to_string(),
                inputs: json!({
                    "seed": 1,
                    "steps": 20,
                    "cfg": 7,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1
                }),
            },
            ComfyGraphIrNode {
                id: "decode".to_string(),
                class_type: "VAEDecode".to_string(),
                purpose: "decode image".to_string(),
                inputs: json!({}),
            },
            ComfyGraphIrNode {
                id: "save".to_string(),
                class_type: "SaveImage".to_string(),
                purpose: "save image".to_string(),
                inputs: json!({ "filename_prefix": "crawclaw" }),
            },
        ],
        edges: vec![
            edge("loader", 1, "positive", "clip"),
            edge("loader", 1, "negative", "clip"),
            edge("loader", 0, "sampler", "model"),
            edge("positive", 0, "sampler", "positive"),
            edge("negative", 0, "sampler", "negative"),
            edge("latent", 0, "sampler", "latent_image"),
            edge("sampler", 0, "decode", "samples"),
            edge("loader", 2, "decode", "vae"),
            edge("decode", 0, "save", "images"),
        ],
        outputs: vec![ComfyGraphIrOutput {
            node_id: "save".to_string(),
            kind: "image".to_string(),
        }],
        notes: None,
    }
}

fn edge(from: &str, from_output: usize, to: &str, to_input: &str) -> ComfyGraphIrEdge {
    ComfyGraphIrEdge {
        from: from.to_string(),
        from_output,
        to: to.to_string(),
        to_input: to_input.to_string(),
    }
}

fn create_graph_plan(params: &Value, catalog: &ComfyNodeCatalog) -> NativeResult<Value> {
    if let Some(candidate) = params.get("candidateIr") {
        if let Ok(ir) = serde_json::from_value::<ComfyGraphIr>(candidate.clone()) {
            let (ok, diagnostics) = validate_graph_ir(&ir, catalog);
            return Ok(if ok {
                json!({ "ok": true, "ir": ir, "diagnostics": diagnostics })
            } else {
                json!({ "ok": false, "diagnostics": diagnostics })
            });
        }
    }
    let goal = params
        .get("goal")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid_input("goal required"))?;
    let media_kind = infer_media_kind(goal, params.get("mediaKind").and_then(Value::as_str));
    if media_kind == "video" {
        return Ok(json!({
            "ok": false,
            "diagnostics": [{
                "code": "planner_unavailable",
                "severity": "error",
                "message": "Video planning needs a candidate IR for this local node set."
            }]
        }));
    }
    if !has_common_image_path(catalog) {
        return Ok(json!({
            "ok": false,
            "diagnostics": [{
                "code": "planner_unavailable",
                "severity": "error",
                "message": "The local ComfyUI catalog is missing common image generation nodes."
            }]
        }));
    }
    let ir = image_graph(goal, catalog);
    let (ok, diagnostics) = validate_graph_ir(&ir, catalog);
    Ok(if ok {
        json!({ "ok": true, "ir": ir, "diagnostics": diagnostics })
    } else {
        json!({ "ok": false, "diagnostics": diagnostics })
    })
}

fn slugify(input: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in input.to_ascii_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
        if slug.len() >= 80 {
            break;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "comfyui-workflow".to_string()
    } else {
        slug
    }
}

fn validate_workflow_id(workflow_id: &str) -> NativeResult<()> {
    let valid = !workflow_id.is_empty()
        && workflow_id.len() <= 80
        && workflow_id.bytes().enumerate().all(|(index, b)| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || (index > 0 && b == b'-')
        });
    if valid {
        Ok(())
    } else {
        Err(invalid_input(format!(
            "Invalid ComfyUI workflow id: {workflow_id}"
        )))
    }
}

fn workflow_paths(
    workflows_dir: &str,
    workflow_id: &str,
) -> NativeResult<(PathBuf, PathBuf, PathBuf)> {
    validate_workflow_id(workflow_id)?;
    let prefix = Path::new(workflows_dir).join(workflow_id);
    Ok((
        prefix.with_extension("ir.json"),
        prefix.with_extension("prompt.json"),
        prefix.with_extension("meta.json"),
    ))
}

async fn write_json(path: &Path, value: &Value) -> NativeResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(path, format!("{}\n", serde_json::to_string_pretty(value)?)).await?;
    Ok(())
}

async fn save_workflow_artifacts(
    config: &ComfyUiResolvedConfig,
    ir: &ComfyGraphIr,
    prompt: &Value,
    meta: Value,
) -> NativeResult<Value> {
    let workflow_id = slugify(&ir.goal);
    let (ir_path, prompt_path, meta_path) = workflow_paths(&config.workflows_dir, &workflow_id)?;
    write_json(&ir_path, &serde_json::to_value(ir)?).await?;
    write_json(&prompt_path, prompt).await?;
    let mut meta = meta;
    if let Some(record) = meta.as_object_mut() {
        record
            .entry("createdAt".to_string())
            .or_insert_with(|| json!(Utc::now().to_rfc3339()));
    }
    write_json(&meta_path, &meta).await?;
    Ok(json!({
        "workflowId": workflow_id,
        "irPath": ir_path,
        "promptPath": prompt_path,
        "metaPath": meta_path
    }))
}

async fn load_workflow_artifacts(
    config: &ComfyUiResolvedConfig,
    workflow_id: &str,
) -> NativeResult<(ComfyGraphIr, Value, Value)> {
    let (ir_path, prompt_path, meta_path) = workflow_paths(&config.workflows_dir, workflow_id)?;
    let ir = serde_json::from_slice::<ComfyGraphIr>(&fs::read(ir_path).await?)?;
    let prompt = serde_json::from_slice::<Value>(&fs::read(prompt_path).await?)?;
    let meta = serde_json::from_slice::<Value>(&fs::read(meta_path).await?)?;
    Ok((ir, prompt, meta))
}

async fn read_run_records(
    config: &ComfyUiResolvedConfig,
    workflow_id: Option<&str>,
    limit: usize,
) -> NativeResult<Vec<Value>> {
    if limit == 0 {
        return Ok(vec![]);
    }
    let mut files = vec![];
    if let Some(workflow_id) = workflow_id {
        validate_workflow_id(workflow_id)?;
        files.push(Path::new(&config.workflows_dir).join(format!("{workflow_id}.runs.jsonl")));
    } else {
        let mut entries = match fs::read_dir(&config.workflows_dir).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.into()),
        };
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".runs.jsonl") {
                files.push(entry.path());
            }
        }
    }
    let mut records = vec![];
    for file in files {
        let text = match fs::read_to_string(file).await {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                if workflow_id.is_none()
                    || value.get("workflowId").and_then(Value::as_str) == workflow_id
                {
                    records.push(value);
                }
            }
        }
    }
    records.sort_by(|left, right| {
        let left_time = left
            .get("startedAt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_time = right
            .get("startedAt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        right_time.cmp(left_time)
    });
    records.truncate(limit);
    Ok(records)
}

async fn list_workflow_artifacts(
    config: &ComfyUiResolvedConfig,
    limit: usize,
) -> NativeResult<Vec<Value>> {
    if limit == 0 {
        return Ok(vec![]);
    }
    let mut entries = match fs::read_dir(&config.workflows_dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => return Err(error.into()),
    };
    let mut summaries = vec![];
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(workflow_id) = name.strip_suffix(".meta.json") else {
            continue;
        };
        let Ok((_, _, meta)) = load_workflow_artifacts(config, workflow_id).await else {
            continue;
        };
        let last_run = read_run_records(config, Some(workflow_id), 1)
            .await?
            .into_iter()
            .next();
        summaries.push(json!({
            "workflowId": workflow_id,
            "goal": meta.get("goal").cloned().unwrap_or(Value::Null),
            "baseUrl": meta.get("baseUrl").cloned().unwrap_or(Value::Null),
            "catalogFingerprint": meta.get("catalogFingerprint").cloned().unwrap_or(Value::Null),
            "mediaKind": meta.get("mediaKind").cloned().unwrap_or(Value::Null),
            "diagnosticsCount": meta.get("diagnostics").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
            "createdAt": meta.get("createdAt").cloned().unwrap_or(Value::Null),
            "updatedAt": meta.get("updatedAt").cloned().unwrap_or(Value::Null),
            "promptId": last_run.as_ref().and_then(|run| run.get("promptId")).or_else(|| meta.get("promptId")).cloned().unwrap_or(Value::Null),
            "outputCount": last_run.as_ref().and_then(|run| run.get("outputs")).and_then(Value::as_array).map(Vec::len)
                .or_else(|| meta.get("outputs").and_then(Value::as_array).map(Vec::len)).unwrap_or(0),
            "lastRun": last_run,
            "paths": {
                "irPath": Path::new(&config.workflows_dir).join(format!("{workflow_id}.ir.json")),
                "promptPath": Path::new(&config.workflows_dir).join(format!("{workflow_id}.prompt.json")),
                "metaPath": Path::new(&config.workflows_dir).join(format!("{workflow_id}.meta.json"))
            }
        }));
    }
    summaries.sort_by(|left, right| {
        let left_time = left
            .get("lastRun")
            .and_then(|run| run.get("startedAt"))
            .or_else(|| left.get("updatedAt"))
            .or_else(|| left.get("createdAt"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_time = right
            .get("lastRun")
            .and_then(|run| run.get("startedAt"))
            .or_else(|| right.get("updatedAt"))
            .or_else(|| right.get("createdAt"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        right_time.cmp(left_time)
    });
    summaries.truncate(limit);
    Ok(summaries)
}

async fn list_output_summaries(
    config: &ComfyUiResolvedConfig,
    workflow_id: Option<&str>,
    limit: usize,
) -> NativeResult<Vec<Value>> {
    let runs = read_run_records(config, workflow_id, usize::MAX).await?;
    let mut outputs = vec![];
    for run in runs {
        let workflow_id = run
            .get("workflowId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let prompt_id = run
            .get("promptId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let status = run.get("status").cloned().unwrap_or(Value::Null);
        let created_at = run.get("startedAt").cloned().unwrap_or(Value::Null);
        for output in run
            .get("outputs")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let mut summary = output.clone();
            if let Some(object) = summary.as_object_mut() {
                object.insert("workflowId".to_string(), json!(workflow_id));
                object.insert("promptId".to_string(), json!(prompt_id));
                object.insert("status".to_string(), status.clone());
                object.insert("createdAt".to_string(), created_at.clone());
            }
            outputs.push(summary);
            if outputs.len() >= limit {
                return Ok(outputs);
            }
        }
    }
    Ok(outputs)
}

async fn append_run_record(
    config: &ComfyUiResolvedConfig,
    workflow_id: &str,
    record: Value,
) -> NativeResult<()> {
    validate_workflow_id(workflow_id)?;
    fs::create_dir_all(&config.workflows_dir).await?;
    let path = Path::new(&config.workflows_dir).join(format!("{workflow_id}.runs.jsonl"));
    let mut record = record;
    if let Some(object) = record.as_object_mut() {
        object.insert("workflowId".to_string(), json!(workflow_id));
    }
    let line = format!("{}\n", serde_json::to_string(&record)?);
    use tokio::io::AsyncWriteExt;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(line.as_bytes()).await?;
    Ok(())
}

pub struct ComfyUiClient {
    base_url: String,
    client: reqwest::Client,
}

impl ComfyUiClient {
    pub fn new(config: &ComfyUiResolvedConfig) -> NativeResult<Self> {
        Ok(Self {
            base_url: config.base_url.trim_end_matches('/').to_string(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_millis(config.request_timeout_ms))
                .build()?,
        })
    }

    async fn json_request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> NativeResult<Value> {
        let url = format!(
            "{}{}",
            self.base_url,
            if path.starts_with('/') {
                path.to_string()
            } else {
                format!("/{path}")
            }
        );
        let mut request = self.client.request(method, url);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await?;
        let status = response.status();
        let text = response.text().await?;
        let body = if text.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&text)?
        };
        if !status.is_success() {
            return Err(runtime_error(format!(
                "ComfyUI request failed with status {status}: {body}"
            )));
        }
        Ok(body)
    }

    async fn get_object_info(&self) -> NativeResult<Value> {
        self.json_request(reqwest::Method::GET, "/object_info", None)
            .await
    }

    async fn get_system_stats(&self) -> NativeResult<Value> {
        self.json_request(reqwest::Method::GET, "/system_stats", None)
            .await
    }

    async fn submit_prompt(&self, prompt: Value) -> NativeResult<Value> {
        self.json_request(
            reqwest::Method::POST,
            "/prompt",
            Some(json!({ "prompt": prompt })),
        )
        .await
    }

    async fn get_history(&self, prompt_id: &str) -> NativeResult<Value> {
        self.json_request(reqwest::Method::GET, &format!("/history/{prompt_id}"), None)
            .await
    }

    async fn download_view(&self, artifact: &ComfyOutputArtifact) -> NativeResult<Vec<u8>> {
        let mut url = Url::parse(&format!("{}/view", self.base_url))
            .map_err(|error| invalid_input(format!("Invalid ComfyUI view URL: {error}")))?;
        url.query_pairs_mut()
            .append_pair("filename", &artifact.filename);
        if let Some(subfolder) = artifact.subfolder.as_ref() {
            url.query_pairs_mut().append_pair("subfolder", subfolder);
        }
        if let Some(kind) = artifact.r#type.as_ref() {
            url.query_pairs_mut().append_pair("type", kind);
        }
        let response = self.client.get(url).send().await?;
        let status = response.status();
        if !status.is_success() {
            return Err(runtime_error(format!(
                "ComfyUI output download failed with status {status}"
            )));
        }
        Ok(response.bytes().await?.to_vec())
    }
}

async fn wait_for_prompt_history(
    client: &ComfyUiClient,
    prompt_id: &str,
    config: &ComfyUiResolvedConfig,
) -> NativeResult<Value> {
    let deadline = Instant::now() + Duration::from_millis(config.run_timeout_ms);
    loop {
        let history = client.get_history(prompt_id).await?;
        let status = history_entry(prompt_id, &history)
            .get("status")
            .and_then(|value| value.get("status_str"))
            .and_then(Value::as_str);
        match status {
            Some("success") => return Ok(history),
            Some(value) if value != "running" => {
                return Err(runtime_error(format!(
                    "ComfyUI prompt {prompt_id} failed with status: {value}"
                )));
            }
            _ if Instant::now() >= deadline => {
                return Err(runtime_error(format!(
                    "Timed out waiting for ComfyUI prompt {prompt_id}"
                )));
            }
            _ => sleep(Duration::from_millis(config.run_poll_interval_ms)).await,
        }
    }
}

async fn download_output_artifacts(
    client: &ComfyUiClient,
    config: &ComfyUiResolvedConfig,
    prompt_id: &str,
    artifacts: Vec<ComfyOutputArtifact>,
) -> NativeResult<Vec<ComfyOutputArtifact>> {
    let prompt_dir = Path::new(&config.output_dir).join(prompt_id);
    fs::create_dir_all(&prompt_dir).await?;
    let mut downloaded = vec![];
    for artifact in artifacts {
        let filename = Path::new(&artifact.filename)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("output.bin")
            .to_string();
        let local_path = prompt_dir.join(&filename);
        assert_path_inside(
            prompt_dir.to_string_lossy().as_ref(),
            local_path.to_string_lossy().as_ref(),
        )?;
        let bytes = client.download_view(&artifact).await?;
        fs::write(&local_path, bytes).await?;
        downloaded.push(ComfyOutputArtifact {
            filename,
            local_path: Some(path_to_string(local_path)),
            ..artifact
        });
    }
    Ok(downloaded)
}

fn read_tool_config(input: &Value) -> NativeResult<(ComfyUiResolvedConfig, Value)> {
    let params = input
        .get("params")
        .cloned()
        .unwrap_or_else(|| input.clone());
    let workspace_dir = input
        .get("workspaceDir")
        .or_else(|| input.get("workspace_dir"))
        .and_then(Value::as_str);
    let plugin_config = input
        .get("pluginConfig")
        .or_else(|| input.get("plugin_config"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let config = resolve_comfyui_config(workspace_dir, plugin_config)?;
    Ok((config, params))
}

pub async fn handle_comfyui(operation: &str, input: Value) -> NativeResult<Value> {
    match operation {
        "config" | "status" => {
            let (config, _) = read_tool_config(&input)?;
            Ok(serde_json::to_value(config)?)
        }
        "workflows-list" => {
            let (config, params) = read_tool_config(&input)?;
            let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize;
            Ok(json!({ "workflows": list_workflow_artifacts(&config, limit).await? }))
        }
        "workflow-get" => {
            let (config, params) = read_tool_config(&input)?;
            let workflow_id = params
                .get("workflowId")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid_input("workflowId required"))?;
            let (ir, prompt, meta) = load_workflow_artifacts(&config, workflow_id).await?;
            Ok(json!({
                "workflow": {
                    "workflowId": workflow_id,
                    "ir": ir,
                    "prompt": prompt,
                    "meta": meta,
                    "paths": {
                        "irPath": Path::new(&config.workflows_dir).join(format!("{workflow_id}.ir.json")),
                        "promptPath": Path::new(&config.workflows_dir).join(format!("{workflow_id}.prompt.json")),
                        "metaPath": Path::new(&config.workflows_dir).join(format!("{workflow_id}.meta.json"))
                    }
                }
            }))
        }
        "runs-list" => {
            let (config, params) = read_tool_config(&input)?;
            let workflow_id = params.get("workflowId").and_then(Value::as_str);
            let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            Ok(json!({ "runs": read_run_records(&config, workflow_id, limit).await? }))
        }
        "outputs-list" => {
            let (config, params) = read_tool_config(&input)?;
            let workflow_id = params.get("workflowId").and_then(Value::as_str);
            let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            Ok(json!({ "outputs": list_output_summaries(&config, workflow_id, limit).await? }))
        }
        "tool" => execute_comfyui_tool(input).await,
        other => Err(invalid_input(format!(
            "Unsupported comfyui operation: {other}"
        ))),
    }
}

pub async fn execute_comfyui_tool(input: Value) -> NativeResult<Value> {
    let (config, params) = read_tool_config(&input)?;
    let action = params
        .get("action")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid_input("action required"))?;
    let client = ComfyUiClient::new(&config)?;
    match action {
        "inspect" => {
            let object_info = client.get_object_info().await?;
            let catalog = normalize_node_catalog(&object_info);
            let query = params
                .get("query")
                .and_then(Value::as_str)
                .map(str::to_ascii_lowercase);
            let limit = params
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(20)
                .max(1) as usize;
            let nodes = catalog
                .nodes
                .iter()
                .filter(|node| {
                    query
                        .as_ref()
                        .is_none_or(|query| node.class_type.to_ascii_lowercase().contains(query))
                })
                .take(limit)
                .map(|node| {
                    json!({
                        "classType": node.class_type,
                        "category": node.category,
                        "outputs": node.outputs
                    })
                })
                .collect::<Vec<_>>();
            let system_stats = client.get_system_stats().await.ok();
            Ok(json!({
                "ok": true,
                "action": action,
                "baseUrl": config.base_url,
                "fingerprint": catalog.fingerprint,
                "nodeCount": catalog.nodes.len(),
                "videoOutputNodes": catalog.find_video_output_nodes().iter().map(|node| node.class_type.clone()).collect::<Vec<_>>(),
                "nodes": nodes,
                "systemStats": system_stats
            }))
        }
        "create" => {
            let catalog = normalize_node_catalog(&client.get_object_info().await?);
            let plan = create_graph_plan(&params, &catalog)?;
            if plan.get("ok").and_then(Value::as_bool) != Some(true) {
                return Ok(
                    json!({ "ok": false, "action": action, "diagnostics": plan.get("diagnostics").cloned().unwrap_or_else(|| json!([])) }),
                );
            }
            let ir: ComfyGraphIr =
                serde_json::from_value(plan.get("ir").cloned().unwrap_or(Value::Null))?;
            let prompt = compile_graph_ir_to_prompt(&ir);
            let saved = if params.get("save").and_then(Value::as_bool) == Some(true) {
                Some(save_workflow_artifacts(&config, &ir, &prompt, json!({
                    "goal": ir.goal,
                    "baseUrl": config.base_url,
                    "catalogFingerprint": catalog.fingerprint,
                    "mediaKind": ir.media_kind,
                    "diagnostics": plan.get("diagnostics").cloned().unwrap_or_else(|| json!([]))
                })).await?)
            } else {
                None
            };
            Ok(json!({
                "ok": true,
                "action": action,
                "workflowId": saved.as_ref().and_then(|value| value.get("workflowId")).cloned(),
                "ir": ir,
                "prompt": prompt,
                "diagnostics": plan.get("diagnostics").cloned().unwrap_or_else(|| json!([]))
            }))
        }
        "validate" => {
            let catalog = normalize_node_catalog(&client.get_object_info().await?);
            let ir = if let Some(workflow_id) = params.get("workflowId").and_then(Value::as_str) {
                load_workflow_artifacts(&config, workflow_id).await?.0
            } else {
                serde_json::from_value(
                    params
                        .get("ir")
                        .cloned()
                        .ok_or_else(|| invalid_input("Valid ComfyUI graph IR required."))?,
                )?
            };
            let (ok, diagnostics) = validate_graph_ir(&ir, &catalog);
            Ok(json!({ "ok": ok, "action": action, "diagnostics": diagnostics }))
        }
        "run" => {
            let (ir, workflow_id) = if let Some(workflow_id) =
                params.get("workflowId").and_then(Value::as_str)
            {
                (
                    load_workflow_artifacts(&config, workflow_id).await?.0,
                    Some(workflow_id.to_string()),
                )
            } else if params.get("prompt").is_some() {
                return Err(invalid_input("Raw prompt JSON is not accepted for run; use workflowId or validated graph IR."));
            } else {
                (
                    serde_json::from_value(
                        params
                            .get("ir")
                            .cloned()
                            .ok_or_else(|| invalid_input("Valid ComfyUI graph IR required."))?,
                    )?,
                    None,
                )
            };
            let catalog = normalize_node_catalog(&client.get_object_info().await?);
            let (ok, diagnostics) = validate_graph_ir(&ir, &catalog);
            if !ok {
                return Ok(json!({ "ok": false, "action": action, "diagnostics": diagnostics }));
            }
            let started_at_instant = Instant::now();
            let started_at = Utc::now().to_rfc3339();
            let started = client
                .submit_prompt(compile_graph_ir_to_prompt(&ir))
                .await?;
            let prompt_id = started
                .get("prompt_id")
                .and_then(Value::as_str)
                .ok_or_else(|| runtime_error("ComfyUI submit prompt returned no prompt_id"))?
                .to_string();
            let mut outputs = Value::Null;
            if params.get("waitForCompletion").and_then(Value::as_bool) == Some(true)
                || params.get("downloadOutputs").and_then(Value::as_bool) == Some(true)
            {
                let history = wait_for_prompt_history(&client, &prompt_id, &config).await?;
                let mut artifacts = collect_output_artifacts(&prompt_id, &history);
                if params.get("downloadOutputs").and_then(Value::as_bool) == Some(true) {
                    artifacts =
                        download_output_artifacts(&client, &config, &prompt_id, artifacts).await?;
                }
                outputs = serde_json::to_value(&artifacts)?;
                if let Some(workflow_id) = workflow_id.as_ref() {
                    append_run_record(
                        &config,
                        workflow_id,
                        json!({
                            "workflowId": workflow_id,
                            "promptId": prompt_id,
                            "status": "success",
                            "startedAt": started_at,
                            "completedAt": Utc::now().to_rfc3339(),
                            "durationMs": started_at_instant.elapsed().as_millis(),
                            "outputs": outputs
                        }),
                    )
                    .await
                    .ok();
                }
            } else if let Some(workflow_id) = workflow_id.as_ref() {
                append_run_record(
                    &config,
                    workflow_id,
                    json!({
                        "workflowId": workflow_id,
                        "promptId": prompt_id,
                        "status": "queued",
                        "startedAt": started_at
                    }),
                )
                .await
                .ok();
            }
            Ok(json!({
                "ok": true,
                "action": action,
                "promptId": prompt_id,
                "queueNumber": started.get("number").cloned(),
                "outputs": outputs
            }))
        }
        "status" => {
            let prompt_id = params
                .get("promptId")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid_input("promptId required"))?;
            Ok(json!({
                "ok": true,
                "action": action,
                "promptId": prompt_id,
                "history": client.get_history(prompt_id).await?
            }))
        }
        "outputs" => {
            let prompt_id = params
                .get("promptId")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid_input("promptId required"))?;
            let artifacts =
                collect_output_artifacts(prompt_id, &client.get_history(prompt_id).await?);
            let outputs = if params.get("download").and_then(Value::as_bool) == Some(true) {
                download_output_artifacts(&client, &config, prompt_id, artifacts).await?
            } else {
                artifacts
            };
            Ok(json!({ "ok": true, "action": action, "promptId": prompt_id, "outputs": outputs }))
        }
        other => Err(invalid_input(format!(
            "Unsupported comfyui_workflow action: {other}"
        ))),
    }
}
