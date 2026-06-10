use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const TS_TEST_SUFFIXES: &[&str] = &[
    ".test.ts",
    ".test-utils.ts",
    ".test-harness.ts",
    ".e2e-harness.ts",
];

const SKIPPED_SCAN_DIRS: &[&str] = &[
    ".artifacts",
    ".git",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CheckReport {
    pub stdout: String,
    pub stderr: String,
    pub ok: bool,
}

impl CheckReport {
    fn ok(stdout: impl Into<String>) -> Self {
        Self {
            stdout: stdout.into(),
            stderr: String::new(),
            ok: true,
        }
    }

    fn fail(stdout: impl Into<String>, stderr: impl Into<String>) -> Self {
        Self {
            stdout: stdout.into(),
            stderr: stderr.into(),
            ok: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct RuntimeBoundaryEntry {
    boundary: String,
    file: String,
    line: usize,
    kind: String,
    specifier: String,
    #[serde(rename = "resolvedPath")]
    resolved_path: String,
    reason: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct PluginBoundaryEntry {
    file: String,
    line: usize,
    kind: String,
    specifier: String,
    #[serde(rename = "resolvedPath")]
    resolved_path: String,
    reason: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
struct ProviderBoundaryEntry {
    provider: String,
    file: String,
    line: usize,
    reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ModuleSpecifier {
    line: usize,
    kind: String,
    specifier: String,
}

pub fn run_no_conflict_markers(root: impl AsRef<Path>) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let mut violations = Vec::new();
    for rel_path in list_git_tracked_files(&root)? {
        let absolute = root.join(&rel_path);
        let Ok(bytes) = fs::read(&absolute) else {
            continue;
        };
        if bytes.contains(&0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        let lines = find_conflict_marker_lines(&content);
        if !lines.is_empty() {
            violations.push((rel_path, lines));
        }
    }

    if violations.is_empty() {
        return Ok(CheckReport::ok(""));
    }

    let mut stderr = String::from("Found unresolved merge conflict markers:\n");
    for (file, lines) in violations {
        let rendered = lines
            .into_iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join(",");
        stderr.push_str(&format!("- {file}:{rendered}\n"));
    }
    Ok(CheckReport::fail("", stderr))
}

pub fn run_runtime_module_boundaries(
    root: impl AsRef<Path>,
    json: bool,
) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let inventory = collect_runtime_module_boundary_inventory(&root)?;
    let stdout = if json {
        format_json(&inventory)?
    } else {
        format_runtime_module_boundary_inventory(&inventory)
    };

    if inventory.is_empty() {
        return Ok(CheckReport::ok(stdout));
    }

    let mut stderr = String::from("Unexpected entries:\n");
    for entry in &inventory {
        stderr.push_str(&format!("- {}\n", format_runtime_entry(entry)));
    }
    Ok(CheckReport::fail(stdout, stderr))
}

pub fn run_plugin_extension_import_boundary(
    root: impl AsRef<Path>,
    json: bool,
) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let inventory = collect_plugin_extension_import_boundary_inventory(&root)?;
    let stdout = if json {
        format_json(&inventory)?
    } else {
        let mut out = format_plugin_extension_import_boundary_inventory(&inventory);
        out.push('\n');
        out.push_str(if inventory.is_empty() {
            "Baseline matches (0 entries)."
        } else {
            "Baseline mismatch (unexpected entries)."
        });
        out
    };

    if inventory.is_empty() {
        return Ok(CheckReport::ok(stdout));
    }

    let mut stderr = String::from("Unexpected entries:\n");
    for entry in &inventory {
        stderr.push_str(&format!("- {}\n", format_plugin_entry(entry)));
    }
    Ok(CheckReport::fail(stdout, stderr))
}

pub fn run_no_extension_src_imports(root: impl AsRef<Path>) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let files = collect_extension_source_files(&root)?;
    let mut offenders = Vec::new();
    for file in &files {
        let content = fs::read_to_string(root.join(file))
            .map_err(|error| format!("failed to read {file}: {error}"))?;
        if contains_forbidden_repo_src_import(&content) {
            offenders.push(file.clone());
        }
    }
    offenders.sort();

    if offenders.is_empty() {
        return Ok(CheckReport::ok(format!(
            "OK: production extension files avoid direct repo src/ imports ({} checked).",
            files.len()
        )));
    }

    let mut stderr =
        String::from("Production extension files must not import the repo src/ tree directly.\n");
    for offender in offenders {
        stderr.push_str(&format!("- {offender}\n"));
    }
    stderr.push_str(
        "Use the Rust plugin SDK, the extension's own public barrel, or a reviewed private helper boundary instead.\n",
    );
    Ok(CheckReport::fail("", stderr))
}

pub fn run_no_register_http_handler(root: impl AsRef<Path>) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let mut violations = Vec::new();
    for file in collect_typescript_files_from_roots(&root, &["src", "extensions"], &[])? {
        let content = fs::read_to_string(root.join(&file))
            .map_err(|error| format!("failed to read {file}: {error}"))?;
        for (index, line) in content.lines().enumerate() {
            if line.contains(".registerHttpHandler(") || line.contains(".registerHttpHandler?.(") {
                violations.push(format!("{file}:{}", index + 1));
            }
        }
    }

    if violations.is_empty() {
        return Ok(CheckReport::ok(""));
    }

    violations.sort();
    let mut stderr = String::from("Found deprecated plugin API call registerHttpHandler(...):\n");
    for violation in violations {
        stderr.push_str(&format!("- {violation}\n"));
    }
    stderr.push_str(
        "TypeScript plugins cannot register HTTP handlers; move production routes to Rust Gateway/native runtime.\n",
    );
    Ok(CheckReport::fail("", stderr))
}

pub fn run_webhook_auth_body_order(root: impl AsRef<Path>) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let enforced = "extensions/feishu/src/monitor.transport.ts";
    let allowed = "extensions/feishu/src/monitor.transport.ts:199";
    let path = root.join(enforced);
    if !path.exists() {
        return Ok(CheckReport::ok(""));
    }
    let content =
        fs::read_to_string(&path).map_err(|error| format!("failed to read {enforced}: {error}"))?;
    let mut violations = Vec::new();
    for (index, line) in content.lines().enumerate() {
        if line.contains("readJsonBodyWithLimit(") || line.contains("readRequestBodyWithLimit(") {
            let callsite = format!("{enforced}:{}", index + 1);
            if callsite != allowed {
                violations.push(callsite);
            }
        }
    }

    if violations.is_empty() {
        return Ok(CheckReport::ok(""));
    }

    violations.sort();
    let mut stderr =
        String::from("Found forbidden low-level body reads in auth-sensitive webhook handlers:\n");
    for violation in violations {
        stderr.push_str(&format!("- {violation}\n"));
    }
    stderr.push_str(
        "Use the shared webhook guards (`readJsonWebhookBodyOrReject` / `readWebhookBodyOrReject`) with explicit pre-auth/post-auth profiles.\n",
    );
    Ok(CheckReport::fail("", stderr))
}

pub fn run_web_fetch_provider_boundaries(
    root: impl AsRef<Path>,
    json: bool,
) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let inventory = collect_web_fetch_provider_boundary_inventory(&root)?;
    provider_boundary_report(
        &inventory,
        json,
        "No web fetch provider boundary inventory entries found.",
        "Web fetch provider boundary inventory:",
    )
}

pub fn run_web_search_provider_boundaries(
    root: impl AsRef<Path>,
    json: bool,
) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let inventory = collect_web_search_provider_boundary_inventory(&root)?;
    provider_boundary_report(
        &inventory,
        json,
        "No web search provider boundary inventory entries found.",
        "Web search provider boundary inventory:",
    )
}

pub fn run_docs_i18n_glossary(
    root: impl AsRef<Path>,
    explicit_base: Option<&str>,
    head: Option<&str>,
) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let Some(base) = resolve_docs_i18n_base(&root, explicit_base)? else {
        return Ok(CheckReport {
            stdout: String::new(),
            stderr:
                "docs:check-i18n-glossary: no merge base found; skipping glossary coverage check.\n"
                    .to_string(),
            ok: true,
        });
    };

    let changed_docs = list_changed_english_docs(&root, &base, head)?;
    if changed_docs.is_empty() {
        return Ok(CheckReport::ok(""));
    }

    let glossary = load_glossary_sources(&root)?;
    let mut missing = Vec::new();
    for rel_path in changed_docs {
        let absolute = root.join(&rel_path);
        if !absolute.exists() {
            continue;
        }
        let current_text = fs::read_to_string(&absolute)
            .map_err(|error| format!("failed to read {rel_path}: {error}"))?;
        let current_terms = extract_glossary_terms(&rel_path, &current_text);
        let base_text = git_show_file(&root, &base, &rel_path).unwrap_or_default();
        let base_terms = extract_glossary_terms(&rel_path, &base_text);
        for (term, term_match) in current_terms {
            if base_terms.contains_key(&term) || glossary.contains(&term) {
                continue;
            }
            missing.push(term_match);
        }
    }

    if missing.is_empty() {
        return Ok(CheckReport::ok(""));
    }

    missing.sort_by(|left, right| {
        left.file
            .cmp(&right.file)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.term.cmp(&right.term))
    });
    let mut stderr = String::from(
        "docs:check-i18n-glossary: missing zh-CN glossary entries for changed doc labels:\n",
    );
    for item in missing {
        stderr.push_str(&format!(
            "- {}:{} {} \"{}\"\n",
            item.file, item.line, item.kind, item.term
        ));
    }
    stderr.push('\n');
    stderr.push_str(
        "Add exact source terms to docs/.i18n/glossary.zh-CN.json before rerunning docs-i18n.\n",
    );
    stderr.push_str(&format!(
        "Checked changed English docs relative to {base}.\n"
    ));
    Ok(CheckReport::fail("", stderr))
}

pub fn run_docs_i18n_source_hash(root: impl AsRef<Path>) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let zh_dir = root.join("docs/zh-CN");
    if !zh_dir.is_dir() {
        return Ok(CheckReport::ok(""));
    }

    let mut mismatches = Vec::new();
    for rel_path in walk_all_files(&zh_dir, &root)? {
        if !(rel_path.ends_with(".md") || rel_path.ends_with(".mdx")) {
            continue;
        }
        let content = fs::read_to_string(root.join(&rel_path))
            .map_err(|error| format!("failed to read {rel_path}: {error}"))?;
        let Some(metadata) = extract_i18n_source_metadata(&content) else {
            continue;
        };
        if i18n_source_path_escapes_docs(&metadata.source_path) {
            mismatches.push(format!(
                "- {rel_path}: source_path {} escapes docs/",
                metadata.source_path
            ));
            continue;
        }
        let source_rel_path = normalize_i18n_source_path(&metadata.source_path);
        let source_display_path = format!("docs/{source_rel_path}");
        let source_path = root.join(&source_display_path);
        if !source_path.is_file() {
            mismatches.push(format!(
                "- {rel_path}: source file {source_display_path} is missing"
            ));
            continue;
        }
        let source = fs::read(&source_path)
            .map_err(|error| format!("failed to read {source_display_path}: {error}"))?;
        let actual = sha256_hex(&source);
        if actual != metadata.source_hash {
            mismatches.push(format!(
                "- {rel_path}: source_hash {} does not match {source_display_path} ({actual})",
                metadata.source_hash
            ));
        }
    }

    if mismatches.is_empty() {
        return Ok(CheckReport::ok(""));
    }

    let mut stderr = String::from("docs:i18n-source-hash: zh-CN source hash drift detected:\n");
    for mismatch in mismatches {
        stderr.push_str(&mismatch);
        stderr.push('\n');
    }
    stderr.push_str(
        "\nUpdate the translated page or refresh x-i18n.source_hash after syncing it with the English source.\n",
    );
    Ok(CheckReport::fail("", stderr))
}

pub fn run_docs_link_audit(root: impl AsRef<Path>) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let docs_dir = root.join("docs");
    let docs_json_path = docs_dir.join("docs.json");
    if !docs_dir.is_dir() {
        return Ok(CheckReport::fail(
            "",
            "docs:check-links: missing docs directory; run from repo root.\n",
        ));
    }
    if !docs_json_path.exists() {
        return Ok(CheckReport::fail(
            "",
            "docs:check-links: missing docs/docs.json.\n",
        ));
    }

    let audit = DocsLinkAudit::load(&docs_dir)?;
    let result = audit.audit_links()?;
    let mut stdout = format!(
        "checked_internal_links={}\nbroken_links={}\n",
        result.checked,
        result.broken.len()
    );
    for item in &result.broken {
        stdout.push_str(&format!(
            "{}:{} :: {} :: {}\n",
            item.file, item.line, item.link, item.reason
        ));
    }
    Ok(CheckReport {
        stdout,
        stderr: String::new(),
        ok: result.broken.is_empty(),
    })
}

pub fn run_docs_anchor_audit(root: impl AsRef<Path>) -> Result<CheckReport, String> {
    let root = normalize_root(root.as_ref());
    let docs_dir = root.join("docs");
    if !docs_dir.is_dir() {
        return Ok(CheckReport::fail(
            "",
            "docs:check-links: missing docs directory; run from repo root.\n",
        ));
    }

    let temp_dir = prepare_anchor_audit_docs_dir(&docs_dir)?;
    let status = crate::node_tooling::run_pnpm_dlx_with_node_major(
        &temp_dir,
        22,
        &["mint", "broken-links", "--check-anchors"],
    );
    let _ = fs::remove_dir_all(&temp_dir);
    let status = status?;
    Ok(CheckReport {
        stdout: String::new(),
        stderr: String::new(),
        ok: status == 0,
    })
}

fn collect_runtime_module_boundary_inventory(
    root: &Path,
) -> Result<Vec<RuntimeBoundaryEntry>, String> {
    let allowed = BTreeSet::from([
        "src/gateway/agent-list.js",
        "src/gateway/call.js",
        "src/gateway/credentials.js",
        "src/gateway/method-scopes.js",
        "src/gateway/protocol/client-info.js",
        "src/gateway/session-utils.fs.js",
        "src/gateway/session-utils.js",
    ]);
    let mut entries = Vec::new();
    let files = collect_typescript_files_from_roots(root, &["src/agents"], &[".spec.ts"])?;
    for file in files {
        if should_skip_runtime_boundary_file(&file) {
            continue;
        }
        let content = fs::read_to_string(root.join(&file))
            .map_err(|error| format!("failed to read {file}: {error}"))?;
        for specifier in collect_module_specifiers(&content) {
            let Some(resolved_path) = resolve_repo_specifier(root, &file, &specifier.specifier)
            else {
                continue;
            };
            if file.starts_with("src/agents/")
                && resolved_path.starts_with("src/gateway/")
                && !allowed.contains(resolved_path.as_str())
            {
                entries.push(RuntimeBoundaryEntry {
                    boundary: "agents->gateway".to_string(),
                    file: file.clone(),
                    line: specifier.line,
                    kind: specifier.kind,
                    specifier: specifier.specifier,
                    resolved_path: resolved_path.clone(),
                    reason: format!(
                        "imports gateway internal \"{resolved_path}\" outside the approved agent runtime seam"
                    ),
                });
            }
        }
    }
    entries.sort_by(|left, right| {
        left.boundary
            .cmp(&right.boundary)
            .then_with(|| left.file.cmp(&right.file))
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.kind.cmp(&right.kind))
            .then_with(|| left.specifier.cmp(&right.specifier))
            .then_with(|| left.resolved_path.cmp(&right.resolved_path))
            .then_with(|| left.reason.cmp(&right.reason))
    });
    Ok(entries)
}

fn collect_plugin_extension_import_boundary_inventory(
    root: &Path,
) -> Result<Vec<PluginBoundaryEntry>, String> {
    let mut entries = Vec::new();
    let files = collect_typescript_files_from_roots(root, &["src/plugins"], &[])?;
    for file in files {
        if should_skip_plugin_boundary_file(&file) {
            continue;
        }
        let content = fs::read_to_string(root.join(&file))
            .map_err(|error| format!("failed to read {file}: {error}"))?;
        for specifier in collect_module_specifiers(&content) {
            let Some(resolved_path) = resolve_repo_specifier(root, &file, &specifier.specifier)
            else {
                continue;
            };
            if resolved_path.starts_with("extensions/") {
                entries.push(PluginBoundaryEntry {
                    file: file.clone(),
                    line: specifier.line,
                    kind: specifier.kind.clone(),
                    specifier: specifier.specifier,
                    reason: classify_resolved_extension_reason(&specifier.kind, &resolved_path),
                    resolved_path,
                });
            }
        }
        if file == "src/plugins/web-search-providers.ts" {
            scan_web_search_registry_smells(&file, &content, &mut entries);
        }
    }
    entries.sort_by(|left, right| {
        left.file
            .cmp(&right.file)
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.kind.cmp(&right.kind))
            .then_with(|| left.specifier.cmp(&right.specifier))
            .then_with(|| left.reason.cmp(&right.reason))
    });
    Ok(entries)
}

fn collect_web_fetch_provider_boundary_inventory(
    root: &Path,
) -> Result<Vec<ProviderBoundaryEntry>, String> {
    let mut entries = Vec::new();
    let files = walk_code_files(root, &["src"], &[".ts", ".js", ".mjs", ".cjs"], true)?;
    for file in files {
        if file.contains(".test.") {
            continue;
        }
        let content = fs::read_to_string(root.join(&file))
            .map_err(|error| format!("failed to read {file}: {error}"))?;
        if file == "src/plugins/web-fetch-providers.ts" {
            for (index, line) in content.lines().enumerate() {
                let line_number = index + 1;
                if line.contains("pluginId: \"spider-fetch\"") {
                    entries.push(ProviderBoundaryEntry {
                        provider: "spider".to_string(),
                        file: file.clone(),
                        line: line_number,
                        reason: "hardcodes bundled web fetch plugin ownership in core registry"
                            .to_string(),
                    });
                }
                if line.contains("id: \"spider\"") {
                    entries.push(ProviderBoundaryEntry {
                        provider: "spider".to_string(),
                        file: file.clone(),
                        line: line_number,
                        reason: "hardcodes bundled web fetch provider id in core registry"
                            .to_string(),
                    });
                }
            }
            continue;
        }
        if file == "src/secrets/runtime-web-tools.ts" {
            continue;
        }
        for (index, line) in content.lines().enumerate() {
            if line.contains("web-fetch-providers.js") {
                entries.push(ProviderBoundaryEntry {
                    provider: "shared".to_string(),
                    file: file.clone(),
                    line: index + 1,
                    reason: "imports bundled web fetch registry outside allowed generic plumbing"
                        .to_string(),
                });
            }
        }
    }
    sort_provider_entries(&mut entries);
    Ok(entries)
}

fn collect_web_search_provider_boundary_inventory(
    root: &Path,
) -> Result<Vec<ProviderBoundaryEntry>, String> {
    let mut entries = Vec::new();
    let files = walk_code_files(root, &["src"], &[".ts", ".js", ".mjs", ".cjs"], true)?;
    for file in files {
        if file.contains(".test.") {
            continue;
        }
        let content = fs::read_to_string(root.join(&file))
            .map_err(|error| format!("failed to read {file}: {error}"))?;
        if file == "src/plugins/web-search-providers.ts" {
            for (index, line) in content.lines().enumerate() {
                let line_number = index + 1;
                if line.contains("pluginId: \"") {
                    entries.push(ProviderBoundaryEntry {
                        provider: "shared".to_string(),
                        file: file.clone(),
                        line: line_number,
                        reason: "hardcodes bundled web search plugin ownership in core registry"
                            .to_string(),
                    });
                }
                if line.contains("id: \"") {
                    entries.push(ProviderBoundaryEntry {
                        provider: "shared".to_string(),
                        file: file.clone(),
                        line: line_number,
                        reason: "hardcodes bundled web search provider id in core registry"
                            .to_string(),
                    });
                }
            }
            continue;
        }
        if file == "src/plugins/bundled-web-search-registry.ts"
            || file == "src/secrets/runtime-web-tools.ts"
        {
            continue;
        }
        for (index, line) in content.lines().enumerate() {
            if line.contains("web-search-providers.js") {
                entries.push(ProviderBoundaryEntry {
                    provider: "shared".to_string(),
                    file: file.clone(),
                    line: index + 1,
                    reason: "imports bundled web search registry outside allowed generic plumbing"
                        .to_string(),
                });
            }
        }
    }
    sort_provider_entries(&mut entries);
    Ok(entries)
}

fn provider_boundary_report(
    inventory: &[ProviderBoundaryEntry],
    json: bool,
    empty_message: &str,
    header: &str,
) -> Result<CheckReport, String> {
    let stdout = if json {
        format_json(inventory)?
    } else if inventory.is_empty() {
        let mut out = empty_message.to_string();
        out.push('\n');
        out.push_str("Baseline matches (0 entries).");
        out
    } else {
        let mut out = format_provider_boundary_inventory(inventory, header);
        out.push('\n');
        out.push_str("Baseline mismatch (unexpected entries).");
        out
    };

    if inventory.is_empty() {
        return Ok(CheckReport::ok(stdout));
    }

    let mut stderr = String::from("Unexpected entries:\n");
    for entry in inventory {
        stderr.push_str(&format!(
            "- {} {}:{} {}\n",
            entry.provider, entry.file, entry.line, entry.reason
        ));
    }
    Ok(CheckReport::fail(stdout, stderr))
}

fn find_conflict_marker_lines(content: &str) -> Vec<usize> {
    content
        .split('\n')
        .enumerate()
        .filter_map(|(index, line)| {
            let line = line.trim_end_matches('\r');
            if line.starts_with("<<<<<<< ")
                || line.starts_with("||||||| ")
                || line == "======="
                || line.starts_with(">>>>>>> ")
            {
                Some(index + 1)
            } else {
                None
            }
        })
        .collect()
}

fn collect_module_specifiers(content: &str) -> Vec<ModuleSpecifier> {
    let mut specifiers = Vec::new();
    for (index, line) in content.lines().enumerate() {
        let line_number = index + 1;
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") {
            continue;
        }
        let kind = if trimmed.starts_with("export") {
            "export"
        } else {
            "import"
        };
        if let Some(specifier) = extract_from_specifier(line) {
            specifiers.push(ModuleSpecifier {
                line: line_number,
                kind: kind.to_string(),
                specifier,
            });
        } else if let Some(specifier) = extract_side_effect_import_specifier(trimmed) {
            specifiers.push(ModuleSpecifier {
                line: line_number,
                kind: "import".to_string(),
                specifier,
            });
        }
        for specifier in extract_dynamic_import_specifiers(line) {
            specifiers.push(ModuleSpecifier {
                line: line_number,
                kind: "dynamic-import".to_string(),
                specifier,
            });
        }
    }
    specifiers
}

fn extract_from_specifier(line: &str) -> Option<String> {
    let from_index = line.find(" from ")?;
    let rest = &line[from_index + " from ".len()..];
    extract_leading_quoted(rest)
}

fn extract_side_effect_import_specifier(trimmed: &str) -> Option<String> {
    let rest = trimmed.strip_prefix("import ")?;
    extract_leading_quoted(rest.trim_start())
}

fn extract_dynamic_import_specifiers(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = line;
    while let Some(index) = rest.find("import") {
        rest = &rest[index + "import".len()..];
        let trimmed = rest.trim_start();
        let Some(after_open) = trimmed.strip_prefix('(') else {
            continue;
        };
        if let Some(specifier) = extract_leading_quoted(after_open.trim_start()) {
            out.push(specifier);
        }
        rest = trimmed;
    }
    out
}

fn extract_leading_quoted(text: &str) -> Option<String> {
    let mut chars = text.chars();
    let quote = chars.next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let mut value = String::new();
    let mut escaped = false;
    for ch in chars {
        if escaped {
            value.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == quote {
            return Some(value);
        }
        value.push(ch);
    }
    None
}

fn resolve_repo_specifier(root: &Path, importer_file: &str, specifier: &str) -> Option<String> {
    if specifier.starts_with('.') {
        let importer_dir = root.join(importer_file).parent()?.to_path_buf();
        let resolved = normalize_path(&importer_dir.join(specifier));
        return Some(relative_to_root(root, &resolved));
    }
    if specifier.starts_with('/') {
        let resolved = normalize_path(Path::new(specifier));
        return Some(relative_to_root(root, &resolved));
    }
    None
}

fn classify_resolved_extension_reason(kind: &str, resolved_path: &str) -> String {
    let verb = match kind {
        "export" => "re-exports",
        "dynamic-import" => "dynamically imports",
        _ => "imports",
    };
    if resolved_path_starts_extension_src(resolved_path) {
        format!("{verb} extension implementation from src/plugins")
    } else if resolved_path_is_extension_entrypoint(resolved_path) {
        format!("{verb} extension entrypoint from src/plugins")
    } else {
        format!("{verb} extension-owned file from src/plugins")
    }
}

fn scan_web_search_registry_smells(
    file: &str,
    content: &str,
    entries: &mut Vec<PluginBoundaryEntry>,
) {
    for (index, line) in content.lines().enumerate() {
        let line_number = index + 1;
        if let Some(plugin_id) = extract_object_string_value(line, "pluginId") {
            entries.push(PluginBoundaryEntry {
                file: file.to_string(),
                line: line_number,
                kind: "registry-smell".to_string(),
                specifier: plugin_id,
                resolved_path: file.to_string(),
                reason: "hardcodes bundled web search plugin ownership in core registry"
                    .to_string(),
            });
        }
        if let Some(provider_id) = extract_object_string_value(line, "id") {
            entries.push(PluginBoundaryEntry {
                file: file.to_string(),
                line: line_number,
                kind: "registry-smell".to_string(),
                specifier: provider_id,
                resolved_path: file.to_string(),
                reason: "hardcodes bundled web search provider metadata in core registry"
                    .to_string(),
            });
        }
    }
}

fn extract_object_string_value(line: &str, key: &str) -> Option<String> {
    let needle = format!("{key}:");
    let index = line.find(&needle)?;
    extract_leading_quoted(line[index + needle.len()..].trim_start())
}

fn format_runtime_module_boundary_inventory(entries: &[RuntimeBoundaryEntry]) -> String {
    if entries.is_empty() {
        return [
            "Rule: src/agents/** may only import approved gateway runtime seams",
            "No runtime module boundary violations found.",
        ]
        .join("\n");
    }
    let mut lines = vec![
        "Rule: src/agents/** may only import approved gateway runtime seams".to_string(),
        "Runtime module boundary violations:".to_string(),
    ];
    let mut active_file = "";
    for entry in entries {
        if entry.file != active_file {
            active_file = &entry.file;
            lines.push(active_file.to_string());
        }
        lines.push(format!(
            "  - line {} [{}/{}] {}",
            entry.line, entry.boundary, entry.kind, entry.reason
        ));
        lines.push(format!("    specifier: {}", entry.specifier));
        lines.push(format!("    resolved: {}", entry.resolved_path));
    }
    lines.join("\n")
}

fn format_runtime_entry(entry: &RuntimeBoundaryEntry) -> String {
    format!(
        "{}:{} [{}/{}] {} ({} -> {})",
        entry.file,
        entry.line,
        entry.boundary,
        entry.kind,
        entry.reason,
        entry.specifier,
        entry.resolved_path
    )
}

fn format_plugin_extension_import_boundary_inventory(entries: &[PluginBoundaryEntry]) -> String {
    if entries.is_empty() {
        return [
            "Rule: src/plugins/** must not import bundled plugin files",
            "No plugin import boundary violations found.",
        ]
        .join("\n");
    }
    let mut lines = vec![
        "Rule: src/plugins/** must not import bundled plugin files".to_string(),
        "Plugin extension import boundary inventory:".to_string(),
    ];
    let mut active_file = "";
    for entry in entries {
        if entry.file != active_file {
            active_file = &entry.file;
            lines.push(active_file.to_string());
        }
        lines.push(format!(
            "  - line {} [{}] {}",
            entry.line, entry.kind, entry.reason
        ));
        lines.push(format!("    specifier: {}", entry.specifier));
        lines.push(format!("    resolved: {}", entry.resolved_path));
    }
    lines.join("\n")
}

fn format_plugin_entry(entry: &PluginBoundaryEntry) -> String {
    format!(
        "{}:{} [{}] {} ({} -> {})",
        entry.file, entry.line, entry.kind, entry.reason, entry.specifier, entry.resolved_path
    )
}

fn format_provider_boundary_inventory(entries: &[ProviderBoundaryEntry], header: &str) -> String {
    let mut lines = vec![header.to_string()];
    let mut active_provider = "";
    for entry in entries {
        if entry.provider != active_provider {
            active_provider = &entry.provider;
            lines.push(format!("{active_provider}:"));
        }
        lines.push(format!(
            "  - {}:{} {}",
            entry.file, entry.line, entry.reason
        ));
    }
    lines.join("\n")
}

fn sort_provider_entries(entries: &mut [ProviderBoundaryEntry]) {
    entries.sort_by(|left, right| {
        left.provider
            .cmp(&right.provider)
            .then_with(|| left.file.cmp(&right.file))
            .then_with(|| left.line.cmp(&right.line))
            .then_with(|| left.reason.cmp(&right.reason))
    });
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct GlossaryTermMatch {
    file: String,
    line: usize,
    kind: String,
    term: String,
}

fn resolve_docs_i18n_base(
    root: &Path,
    explicit_base: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(base) = explicit_base.filter(|value| !value.trim().is_empty()) {
        return Ok(Some(base.trim().to_string()));
    }
    if let Ok(env_base) = std::env::var("DOCS_I18N_GLOSSARY_BASE") {
        let trimmed = env_base.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }
    for candidate in ["origin/main", "fork/main", "main"] {
        if let Ok(base) = run_git(root, &["merge-base", candidate, "HEAD"]) {
            let trimmed = base.trim();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed.to_string()));
            }
        }
    }
    Ok(None)
}

fn list_changed_english_docs(
    root: &Path,
    base: &str,
    head: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut args = vec![
        "diff".to_string(),
        "--name-only".to_string(),
        "--diff-filter=ACMR".to_string(),
        base.to_string(),
    ];
    if let Some(head) = head.filter(|value| !value.trim().is_empty()) {
        args.push(head.trim().to_string());
    }
    args.push("--".to_string());
    args.push("docs".to_string());
    let output = run_git_owned(root, &args)?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| is_english_doc_path(line))
        .map(str::to_string)
        .collect())
}

fn load_glossary_sources(root: &Path) -> Result<BTreeSet<String>, String> {
    let path = root.join("docs/.i18n/glossary.zh-CN.json");
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", slash_path(&path)))?;
    let entries: Value = serde_json::from_str(&content)
        .map_err(|error| format!("invalid glossary JSON: {error}"))?;
    let mut sources = BTreeSet::new();
    if let Value::Array(items) = entries {
        for item in items {
            if let Some(source) = item.get("source").and_then(Value::as_str) {
                let source = source.trim();
                if !source.is_empty() {
                    sources.insert(source.to_string());
                }
            }
        }
    }
    Ok(sources)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct I18nSourceMetadata {
    source_hash: String,
    source_path: String,
}

fn extract_i18n_source_metadata(text: &str) -> Option<I18nSourceMetadata> {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return None;
    }

    let mut in_i18n = false;
    let mut source_hash = None;
    let mut source_path = None;
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if line.trim() == "x-i18n:" {
            in_i18n = true;
            continue;
        }
        if in_i18n && !line.starts_with(' ') && !line.trim().is_empty() {
            in_i18n = false;
        }
        if !in_i18n {
            continue;
        }
        let trimmed = line.trim_start();
        if let Some(value) = trimmed.strip_prefix("source_hash:") {
            source_hash = Some(unquote_scalar(value));
        } else if let Some(value) = trimmed.strip_prefix("source_path:") {
            source_path = Some(unquote_scalar(value));
        }
    }

    match (
        source_hash.filter(|value| !value.trim().is_empty()),
        source_path.filter(|value| !value.trim().is_empty()),
    ) {
        (Some(source_hash), Some(source_path)) => Some(I18nSourceMetadata {
            source_hash: source_hash.trim().to_string(),
            source_path: source_path.trim().to_string(),
        }),
        _ => None,
    }
}

fn normalize_i18n_source_path(path: &str) -> String {
    let trimmed = path.trim().trim_start_matches('/');
    let without_docs_prefix = trimmed.strip_prefix("docs/").unwrap_or(trimmed);
    slash_path(&normalize_path(Path::new(without_docs_prefix)))
}

fn i18n_source_path_escapes_docs(path: &str) -> bool {
    let trimmed = path.trim().trim_start_matches('/');
    let without_docs_prefix = trimmed.strip_prefix("docs/").unwrap_or(trimmed);
    Path::new(without_docs_prefix)
        .components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn extract_glossary_terms(file: &str, text: &str) -> BTreeMap<String, GlossaryTermMatch> {
    let mut terms = BTreeMap::new();
    let lines = text.split('\n').collect::<Vec<_>>();
    if lines.first().map(|line| line.trim()) == Some("---") {
        for (index, line) in lines.iter().enumerate().skip(1) {
            if line.trim() == "---" {
                break;
            }
            let Some(raw_title) = line.trim().strip_prefix("title:") else {
                continue;
            };
            let title = unquote_scalar(raw_title);
            if is_glossary_candidate(&title, 8) {
                terms.insert(
                    title.clone(),
                    GlossaryTermMatch {
                        file: file.to_string(),
                        line: index + 1,
                        kind: "title".to_string(),
                        term: title,
                    },
                );
            }
            break;
        }
    }

    for (index, line) in lines.iter().enumerate() {
        let Some(label) = extract_list_item_root_link_label(line) else {
            continue;
        };
        if !is_glossary_candidate(&label, 6) || terms.contains_key(&label) {
            continue;
        }
        terms.insert(
            label.clone(),
            GlossaryTermMatch {
                file: file.to_string(),
                line: index + 1,
                kind: "link label".to_string(),
                term: label,
            },
        );
    }

    terms
}

fn extract_list_item_root_link_label(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let rest = if let Some(rest) = trimmed.strip_prefix("- ") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("* ") {
        rest
    } else {
        let dot_index = trimmed.find('.')?;
        if !trimmed[..dot_index].chars().all(|ch| ch.is_ascii_digit()) {
            return None;
        }
        trimmed[dot_index + 1..].trim_start()
    };
    let rest = rest.strip_prefix('[')?;
    let end_label = rest.find(']')?;
    let after_label = &rest[end_label + 1..];
    let target = after_label.strip_prefix('(')?;
    if !target.starts_with('/') {
        return None;
    }
    Some(rest[..end_label].trim().to_string())
}

fn is_glossary_candidate(term: &str, max_words: usize) -> bool {
    !term.is_empty()
        && term.chars().any(|ch| ch.is_ascii_alphabetic())
        && !term.contains('`')
        && term.len() <= 80
        && term
            .split_whitespace()
            .filter(|part| !part.is_empty())
            .count()
            <= max_words
}

fn unquote_scalar(raw: &str) -> String {
    let value = raw.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        value[1..value.len() - 1].trim().to_string()
    } else {
        value.to_string()
    }
}

fn is_english_doc_path(path: &str) -> bool {
    path.starts_with("docs/")
        && !path.starts_with("docs/zh-CN/")
        && (path.ends_with(".md") || path.ends_with(".mdx"))
}

#[derive(Clone, Debug)]
struct DocsLinkAudit {
    docs_dir: PathBuf,
    docs_config: Value,
    redirects: BTreeMap<String, String>,
    routes: BTreeSet<String>,
    all_files: BTreeSet<String>,
    markdown_files: Vec<String>,
}

#[derive(Clone, Debug)]
struct DocsLinkAuditResult {
    checked: usize,
    broken: Vec<DocsBrokenLink>,
}

#[derive(Clone, Debug)]
struct DocsBrokenLink {
    file: String,
    line: usize,
    link: String,
    reason: String,
}

impl DocsLinkAudit {
    fn load(docs_dir: &Path) -> Result<Self, String> {
        let docs_config_path = docs_dir.join("docs.json");
        let docs_config_text = fs::read_to_string(&docs_config_path)
            .map_err(|error| format!("failed to read docs/docs.json: {error}"))?;
        let docs_config: Value = serde_json::from_str(&docs_config_text)
            .map_err(|error| format!("invalid docs/docs.json: {error}"))?;
        let all_files = walk_all_files(docs_dir, docs_dir)?;
        let all_files_set = all_files.iter().cloned().collect::<BTreeSet<_>>();
        let markdown_files = all_files
            .iter()
            .filter(|path| {
                (path.ends_with(".md") || path.ends_with(".mdx"))
                    && !is_generated_translated_doc(path)
            })
            .cloned()
            .collect::<Vec<_>>();

        let mut redirects = BTreeMap::new();
        if let Some(items) = docs_config.get("redirects").and_then(Value::as_array) {
            for item in items {
                let source = item
                    .get("source")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let destination = item
                    .get("destination")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                redirects.insert(normalize_route(source), normalize_route(destination));
            }
        }

        let mut routes = BTreeSet::new();
        for rel in &markdown_files {
            let text = fs::read_to_string(docs_dir.join(rel))
                .map_err(|error| format!("failed to read docs/{rel}: {error}"))?;
            let slug = rel
                .trim_end_matches(".mdx")
                .trim_end_matches(".md")
                .to_string();
            routes.insert(normalize_route(&slug));
            if let Some(prefix) = slug.strip_suffix("/index") {
                routes.insert(normalize_route(prefix));
            }
            if let Some(permalink) = extract_permalink(&text) {
                routes.insert(normalize_route(&permalink));
            }
        }

        Ok(Self {
            docs_dir: docs_dir.to_path_buf(),
            docs_config,
            redirects,
            routes,
            all_files: all_files_set,
            markdown_files,
        })
    }

    fn audit_links(&self) -> Result<DocsLinkAuditResult, String> {
        let mut broken = Vec::new();
        let mut checked = 0usize;
        for rel in &self.markdown_files {
            let base_dir = slash_path(Path::new(rel).parent().unwrap_or_else(|| Path::new("")));
            let text = fs::read_to_string(self.docs_dir.join(rel))
                .map_err(|error| format!("failed to read docs/{rel}: {error}"))?;
            let mut in_code_fence = false;
            for (index, raw_line) in text.split('\n').enumerate() {
                let line_number = index + 1;
                if raw_line.trim().starts_with("```") {
                    in_code_fence = !in_code_fence;
                    continue;
                }
                if in_code_fence {
                    continue;
                }
                let line = strip_inline_code(raw_line);
                for raw in extract_markdown_links(&line) {
                    if raw.is_empty()
                        || starts_with_any_ignore_ascii_case(
                            &raw,
                            &["http:", "https:", "mailto:", "tel:", "data:", "#"],
                        )
                    {
                        continue;
                    }
                    let path_part = raw.split('#').next().unwrap_or_default();
                    let clean = path_part.split('?').next().unwrap_or_default();
                    if clean.is_empty() {
                        continue;
                    }
                    checked += 1;
                    if clean.starts_with('/') {
                        let route = normalize_route(clean);
                        let resolved = self.resolve_route(&route);
                        if !resolved.ok {
                            let static_rel = route.trim_start_matches('/');
                            if !self.all_files.contains(static_rel) {
                                broken.push(DocsBrokenLink {
                                    file: rel.clone(),
                                    line: line_number,
                                    link: raw,
                                    reason: format!(
                                        "route/file not found (terminal: {})",
                                        resolved.terminal
                                    ),
                                });
                            }
                        }
                        continue;
                    }
                    if !clean.starts_with('.') && !clean.contains('/') {
                        continue;
                    }
                    let normalized_rel = normalize_relative_doc_path(&base_dir, clean);
                    if has_file_extension(&normalized_rel) {
                        if !self.all_files.contains(&normalized_rel) {
                            broken.push(DocsBrokenLink {
                                file: rel.clone(),
                                line: line_number,
                                link: raw,
                                reason: "relative file not found".to_string(),
                            });
                        }
                        continue;
                    }
                    let candidates = [
                        normalized_rel.clone(),
                        format!("{normalized_rel}.md"),
                        format!("{normalized_rel}.mdx"),
                        format!("{normalized_rel}/index.md"),
                        format!("{normalized_rel}/index.mdx"),
                    ];
                    if !candidates
                        .iter()
                        .any(|candidate| self.all_files.contains(candidate))
                    {
                        broken.push(DocsBrokenLink {
                            file: rel.clone(),
                            line: line_number,
                            link: raw,
                            reason: "relative doc target not found".to_string(),
                        });
                    }
                }
            }
        }

        for page in
            collect_nav_page_entries(self.docs_config.get("navigation").unwrap_or(&Value::Null))
        {
            if is_generated_translated_doc(&page) {
                continue;
            }
            checked += 1;
            let route = normalize_route(&page);
            let resolved = self.resolve_route(&route);
            if !resolved.ok {
                broken.push(DocsBrokenLink {
                    file: "docs.json".to_string(),
                    line: 0,
                    link: page,
                    reason: format!(
                        "navigation page not published (terminal: {})",
                        resolved.terminal
                    ),
                });
            }
        }

        Ok(DocsLinkAuditResult { checked, broken })
    }

    fn resolve_route(&self, route: &str) -> ResolvedRoute {
        let mut current = normalize_route(route);
        if current == "/" {
            return ResolvedRoute {
                ok: true,
                terminal: "/".to_string(),
            };
        }
        let mut seen = BTreeSet::from([current.clone()]);
        while let Some(destination) = self.redirects.get(&current) {
            current = normalize_route(destination);
            if seen.contains(&current) {
                return ResolvedRoute {
                    ok: false,
                    terminal: current,
                };
            }
            seen.insert(current.clone());
        }
        ResolvedRoute {
            ok: self.routes.contains(&current),
            terminal: current,
        }
    }
}

#[derive(Clone, Debug)]
struct ResolvedRoute {
    ok: bool,
    terminal: String,
}

fn prepare_anchor_audit_docs_dir(docs_dir: &Path) -> Result<PathBuf, String> {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let temp_dir = std::env::temp_dir().join(format!(
        "crawclaw-docs-anchor-audit-{}-{suffix}",
        std::process::id()
    ));
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|error| format!("failed to remove stale temp dir: {error}"))?;
    }
    copy_dir_recursive(docs_dir, &temp_dir)?;
    for entry in fs::read_dir(&temp_dir).map_err(|error| {
        format!(
            "failed to read temp docs dir {}: {error}",
            slash_path(&temp_dir)
        )
    })? {
        let entry = entry.map_err(|error| format!("failed to read temp docs entry: {error}"))?;
        if !entry
            .file_type()
            .map_err(|error| format!("failed to inspect temp docs entry: {error}"))?
            .is_dir()
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_generated_translated_doc(&format!("{name}/")) {
            fs::remove_dir_all(entry.path())
                .map_err(|error| format!("failed to remove translated docs copy: {error}"))?;
        }
    }
    let docs_json_path = temp_dir.join("docs.json");
    let config_text = fs::read_to_string(&docs_json_path)
        .map_err(|error| format!("failed to read copied docs.json: {error}"))?;
    let config: Value = serde_json::from_str(&config_text)
        .map_err(|error| format!("invalid docs.json: {error}"))?;
    let sanitized = sanitize_docs_config_for_english_only(&config).unwrap_or(Value::Null);
    let rendered = serde_json::to_string_pretty(&sanitized)
        .map_err(|error| format!("failed to render sanitized docs.json: {error}"))?;
    fs::write(&docs_json_path, format!("{rendered}\n"))
        .map_err(|error| format!("failed to write sanitized docs.json: {error}"))?;
    Ok(temp_dir)
}

fn sanitize_docs_config_for_english_only(value: &Value) -> Option<Value> {
    match value {
        Value::Array(items) => {
            let next = items
                .iter()
                .filter_map(sanitize_docs_config_for_english_only)
                .collect::<Vec<_>>();
            if next.is_empty() {
                None
            } else {
                Some(Value::Array(next))
            }
        }
        Value::Object(record) => {
            if record
                .get("language")
                .and_then(Value::as_str)
                .is_some_and(|language| language != "en")
            {
                return None;
            }
            let mut sanitized = serde_json::Map::new();
            for (key, child) in record {
                if let Some(next) = sanitize_docs_config_for_english_only(child) {
                    match &next {
                        Value::Array(items) if items.is_empty() => continue,
                        Value::Object(object) if object.is_empty() => continue,
                        _ => {}
                    }
                    sanitized.insert(key.clone(), next);
                }
            }
            for key in ["pages", "groups", "tabs"] {
                if record.contains_key(key) && !sanitized.get(key).is_some_and(Value::is_array) {
                    return None;
                }
            }
            for key in ["source", "destination"] {
                if record.get(key).is_some_and(Value::is_string)
                    && !sanitized.get(key).is_some_and(Value::is_string)
                {
                    return None;
                }
            }
            if sanitized.is_empty() {
                None
            } else {
                Some(Value::Object(sanitized))
            }
        }
        Value::String(value) if is_generated_translated_doc(value) => None,
        value => Some(value.clone()),
    }
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("failed to create {}: {error}", slash_path(destination)))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read {}: {error}", slash_path(source)))?
    {
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", slash_path(&source_path)))?;
        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "failed to copy {} to {}: {error}",
                    slash_path(&source_path),
                    slash_path(&destination_path)
                )
            })?;
        }
    }
    Ok(())
}

fn extract_permalink(text: &str) -> Option<String> {
    if !text.starts_with("---") {
        return None;
    }
    let end = text[3..].find("\n---")?;
    let front_matter = &text[3..3 + end];
    for line in front_matter.lines() {
        let Some(value) = line.trim().strip_prefix("permalink:") else {
            continue;
        };
        return Some(unquote_scalar(value));
    }
    None
}

fn collect_nav_page_entries(value: &Value) -> Vec<String> {
    let mut entries = Vec::new();
    match value {
        Value::Array(items) => {
            for item in items {
                entries.extend(collect_nav_page_entries(item));
            }
        }
        Value::Object(record) => {
            if let Some(Value::Array(pages)) = record.get("pages") {
                for page in pages {
                    match page {
                        Value::String(page) => entries.push(page.clone()),
                        _ => entries.extend(collect_nav_page_entries(page)),
                    }
                }
            }
            for (key, child) in record {
                if key == "pages" {
                    continue;
                }
                entries.extend(collect_nav_page_entries(child));
            }
        }
        _ => {}
    }
    entries
}

fn normalize_route(route: &str) -> String {
    let without_fragment = route.split('#').next().unwrap_or_default();
    let without_query = without_fragment.split('?').next().unwrap_or_default();
    let stripped = without_query.trim_matches('/');
    if stripped.is_empty() {
        "/".to_string()
    } else {
        format!("/{stripped}")
    }
}

fn strip_inline_code(text: &str) -> String {
    let mut out = String::new();
    let mut in_code = false;
    for ch in text.chars() {
        if ch == '`' {
            in_code = !in_code;
            continue;
        }
        if !in_code {
            out.push(ch);
        }
    }
    out
}

fn extract_markdown_links(line: &str) -> Vec<String> {
    let bytes = line.as_bytes();
    let mut index = 0usize;
    let mut links = Vec::new();
    while index + 1 < bytes.len() {
        if bytes[index] == b']' && bytes[index + 1] == b'(' {
            let start = index + 2;
            if let Some(end) = line[start..].find(')') {
                links.push(line[start..start + end].trim().to_string());
                index = start + end + 1;
                continue;
            }
        }
        index += 1;
    }
    links
}

fn starts_with_any_ignore_ascii_case(value: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| {
        value.len() >= prefix.len() && value[..prefix.len()].eq_ignore_ascii_case(prefix)
    })
}

fn normalize_relative_doc_path(base_dir: &str, target: &str) -> String {
    let joined = if base_dir.is_empty() || base_dir == "." {
        PathBuf::from(target)
    } else {
        Path::new(base_dir).join(target)
    };
    slash_path(&normalize_path(&joined))
}

fn has_file_extension(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(OsStr::to_str)
        .is_some()
}

fn is_generated_translated_doc(path: &str) -> bool {
    let trimmed = path.trim_start_matches('/');
    let Some(first_segment) = trimmed.split('/').next() else {
        return false;
    };
    let mut parts = first_segment.split('-');
    let Some(language) = parts.next() else {
        return false;
    };
    if language.len() != 2 || !language.chars().all(|ch| ch.is_ascii_lowercase()) {
        return false;
    }
    let mut has_region = false;
    for part in parts {
        if part.len() < 2 || part.len() > 8 || !part.chars().all(|ch| ch.is_ascii_alphabetic()) {
            return false;
        }
        has_region = true;
    }
    has_region
}

fn walk_all_files(dir: &Path, base: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut entries = fs::read_dir(dir)
        .map_err(|error| format!("failed to read {}: {error}", slash_path(dir)))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read {}: {error}", slash_path(dir)))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", slash_path(&path)))?;
        if file_type.is_dir() {
            out.extend(walk_all_files(&path, base)?);
        } else if file_type.is_file() {
            out.push(slash_path(path.strip_prefix(base).unwrap_or(&path)));
        }
    }
    Ok(out)
}

fn collect_extension_source_files(root: &Path) -> Result<Vec<String>, String> {
    let mut files = walk_code_files(
        root,
        &["extensions"],
        &[".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"],
        false,
    )?;
    files.retain(|file| {
        !file.ends_with("/runtime-api.ts")
            && !file.contains(".test.")
            && !file.contains(".spec.")
            && !file.contains(".fixture.")
            && !file.contains(".snap")
            && !file.contains("/coverage/")
            && !file.contains("/dist/")
            && !file.contains("/node_modules/")
    });
    Ok(files)
}

fn contains_forbidden_repo_src_import(content: &str) -> bool {
    for quote in ['"', '\''] {
        let mut rest = content;
        while let Some(index) = rest.find(quote) {
            rest = &rest[index + quote.len_utf8()..];
            let Some(end) = rest.find(quote) else {
                break;
            };
            let quoted = &rest[..end];
            if quoted.starts_with("../") && quoted.contains("src/") {
                let mut tail = quoted;
                while let Some(next) = tail.strip_prefix("../") {
                    tail = next;
                }
                if tail.starts_with("src/") {
                    return true;
                }
            }
            rest = &rest[end + quote.len_utf8()..];
        }
    }
    false
}

fn collect_typescript_files_from_roots(
    root: &Path,
    roots: &[&str],
    extra_test_suffixes: &[&str],
) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    for rel_root in roots {
        let dir = root.join(rel_root);
        if !dir.exists() {
            continue;
        }
        files.extend(walk_typescript_files(root, &dir, extra_test_suffixes)?);
    }
    files.sort();
    Ok(files)
}

fn walk_typescript_files(
    root: &Path,
    dir: &Path,
    extra_test_suffixes: &[&str],
) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut entries = fs::read_dir(dir)
        .map_err(|error| format!("failed to read {}: {error}", slash_path(dir)))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read {}: {error}", slash_path(dir)))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", slash_path(&path)))?;
        if file_type.is_dir() {
            if name == "node_modules" {
                continue;
            }
            out.extend(walk_typescript_files(root, &path, extra_test_suffixes)?);
        } else if file_type.is_file() && name.ends_with(".ts") {
            let rel = slash_path(path.strip_prefix(root).unwrap_or(&path));
            if !is_test_like_typescript_file(&rel, extra_test_suffixes) {
                out.push(rel);
            }
        }
    }
    Ok(out)
}

fn walk_code_files(
    root: &Path,
    roots: &[&str],
    extensions: &[&str],
    skip_extensions_dir: bool,
) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    for rel_root in roots {
        let dir = root.join(rel_root);
        if dir.exists() {
            files.extend(walk_code_files_inner(
                root,
                &dir,
                extensions,
                skip_extensions_dir,
            )?);
        }
    }
    files.sort();
    Ok(files)
}

fn walk_code_files_inner(
    root: &Path,
    dir: &Path,
    extensions: &[&str],
    skip_extensions_dir: bool,
) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut entries = fs::read_dir(dir)
        .map_err(|error| format!("failed to read {}: {error}", slash_path(dir)))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read {}: {error}", slash_path(dir)))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", slash_path(&path)))?;
        if file_type.is_dir() {
            if SKIPPED_SCAN_DIRS.contains(&name.as_str())
                || (skip_extensions_dir && name == "extensions")
            {
                continue;
            }
            out.extend(walk_code_files_inner(
                root,
                &path,
                extensions,
                skip_extensions_dir,
            )?);
        } else if file_type.is_file()
            && extensions.iter().any(|extension| name.ends_with(extension))
            && !name.ends_with(".d.ts")
        {
            out.push(slash_path(path.strip_prefix(root).unwrap_or(&path)));
        }
    }
    Ok(out)
}

fn is_test_like_typescript_file(path: &str, extra_suffixes: &[&str]) -> bool {
    TS_TEST_SUFFIXES
        .iter()
        .chain(extra_suffixes.iter())
        .any(|suffix| path.ends_with(suffix))
}

fn should_skip_runtime_boundary_file(path: &str) -> bool {
    path.contains("/test-helpers/")
        || path.contains("/fixtures/")
        || path.contains("/__tests__/")
        || path.ends_with(".spec.ts")
        || path.contains(".fixture.")
        || path.contains(".snap.")
}

fn should_skip_plugin_boundary_file(path: &str) -> bool {
    path == "src/plugins/bundled-web-search-registry.ts"
        || path.starts_with("src/plugins/contracts/")
        || (path.starts_with("src/plugins/runtime/runtime-")
            && (path.ends_with("-contract.ts")
                || path.ends_with("-contract.cts")
                || path.ends_with("-contract.mts")
                || path.ends_with("-contract.js")
                || path.ends_with("-contract.cjs")
                || path.ends_with("-contract.mjs")))
}

fn resolved_path_starts_extension_src(path: &str) -> bool {
    let mut parts = path.split('/');
    matches!(parts.next(), Some("extensions"))
        && parts.next().is_some()
        && parts.next() == Some("src")
}

fn resolved_path_is_extension_entrypoint(path: &str) -> bool {
    let parts = path.split('/').collect::<Vec<_>>();
    parts.len() == 3 && parts[0] == "extensions" && parts[2].starts_with("index.")
}

fn list_git_tracked_files(root: &Path) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .args(["ls-files", "-z"])
        .current_dir(root)
        .output()
        .map_err(|error| format!("failed to list git files: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "git ls-files failed with status {}: {}",
            output
                .status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "?".to_string()),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|chunk| !chunk.is_empty())
        .map(|chunk| String::from_utf8_lossy(chunk).to_string())
        .collect())
}

fn git_show_file(root: &Path, base: &str, rel_path: &str) -> Result<String, String> {
    run_git(root, &["show", &format!("{base}:{rel_path}")])
}

fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| format!("failed to run git {}: {error}", args.join(" ")))?;
    if !output.status.success() {
        return Err(format!(
            "git {} failed with status {}: {}",
            args.join(" "),
            output
                .status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "?".to_string()),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_git_owned(root: &Path, args: &[String]) -> Result<String, String> {
    let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_git(root, &borrowed)
}

fn format_json<T: Serialize + ?Sized>(value: &T) -> Result<String, String> {
    serde_json::to_string_pretty(value).map_err(|error| format!("failed to render JSON: {error}"))
}

fn normalize_root(root: &Path) -> PathBuf {
    if root.is_absolute() {
        normalize_path(root)
    } else {
        normalize_path(
            &std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(root),
        )
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(component.as_os_str()),
            Component::Normal(part) => out.push(part),
        }
    }
    out
}

fn relative_to_root(root: &Path, path: &Path) -> String {
    slash_path(path.strip_prefix(root).unwrap_or(path))
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_conflict_markers() {
        assert_eq!(
            find_conflict_marker_lines("ok\n<<<<<<< HEAD\n=======\n>>>>>>> branch\n"),
            vec![2, 3, 4]
        );
    }

    #[test]
    fn extracts_module_specifiers_from_common_imports() {
        let specifiers = collect_module_specifiers(
            "import x from \"./a.js\";\nexport * from '../b.js';\nconst y = import(\"./c.js\");\n",
        );
        assert_eq!(
            specifiers
                .into_iter()
                .map(|item| (item.kind, item.specifier, item.line))
                .collect::<Vec<_>>(),
            vec![
                ("import".to_string(), "./a.js".to_string(), 1),
                ("export".to_string(), "../b.js".to_string(), 2),
                ("dynamic-import".to_string(), "./c.js".to_string(), 3),
            ]
        );
    }

    #[test]
    fn detects_extension_src_import_pattern() {
        assert!(contains_forbidden_repo_src_import(
            "import x from \"../../src/foo.js\";"
        ));
        assert!(!contains_forbidden_repo_src_import(
            "import x from \"./src/foo.js\";"
        ));
    }

    #[test]
    fn normalizes_docs_routes() {
        assert_eq!(normalize_route("/foo/bar#x"), "/foo/bar");
        assert_eq!(normalize_route("foo/bar?x=1"), "/foo/bar");
        assert_eq!(normalize_route("/"), "/");
    }

    #[test]
    fn identifies_localized_doc_paths() {
        assert!(is_generated_translated_doc("zh-CN/start/index.md"));
        assert!(!is_generated_translated_doc("start/index.md"));
    }

    #[test]
    fn docs_i18n_source_hash_detects_stale_translation_metadata() {
        let root = unique_test_dir("docs-i18n-source-hash-drift");
        fs::create_dir_all(root.join("docs/zh-CN/start")).expect("create docs dirs");
        fs::write(root.join("docs/start.md"), "# Getting started\n").expect("write source doc");
        fs::write(
            root.join("docs/zh-CN/start/index.md"),
            "---\ntitle: 入门\nx-i18n:\n  source_path: start.md\n  source_hash: stale\n---\n# 入门\n",
        )
        .expect("write translated doc");

        let report = run_docs_i18n_source_hash(&root).expect("run source hash check");

        let _ = fs::remove_dir_all(&root);
        assert!(!report.ok);
        assert!(report.stderr.contains("docs/zh-CN/start/index.md"));
        assert!(report.stderr.contains("source_hash stale"));
        assert!(report.stderr.contains("docs/start.md"));
    }

    #[test]
    fn docs_i18n_source_hash_accepts_current_translation_metadata() {
        let root = unique_test_dir("docs-i18n-source-hash-ok");
        fs::create_dir_all(root.join("docs/zh-CN/start")).expect("create docs dirs");
        let source = "# Getting started\n";
        fs::write(root.join("docs/start.md"), source).expect("write source doc");
        fs::write(
            root.join("docs/zh-CN/start/index.md"),
            format!(
                "---\ntitle: 入门\nx-i18n:\n  source_path: docs/start.md\n  source_hash: {}\n---\n# 入门\n",
                sha256_hex(source.as_bytes())
            ),
        )
        .expect("write translated doc");

        let report = run_docs_i18n_source_hash(&root).expect("run source hash check");

        let _ = fs::remove_dir_all(&root);
        assert!(report.ok);
        assert!(report.stderr.is_empty());
    }

    #[test]
    fn docs_i18n_source_hash_rejects_source_paths_outside_docs() {
        let root = unique_test_dir("docs-i18n-source-hash-escape");
        fs::create_dir_all(root.join("docs/zh-CN/start")).expect("create docs dirs");
        fs::write(root.join("start.md"), "# Outside docs\n").expect("write outside doc");
        fs::write(
            root.join("docs/zh-CN/start/index.md"),
            "---\ntitle: 入门\nx-i18n:\n  source_path: ../start.md\n  source_hash: stale\n---\n# 入门\n",
        )
        .expect("write translated doc");

        let report = run_docs_i18n_source_hash(&root).expect("run source hash check");

        let _ = fs::remove_dir_all(&root);
        assert!(!report.ok);
        assert!(report
            .stderr
            .contains("source_path ../start.md escapes docs/"));
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time after epoch")
            .as_nanos();
        path.push(format!("crawclaw-repo-tools-{name}-{suffix}"));
        path
    }
}
