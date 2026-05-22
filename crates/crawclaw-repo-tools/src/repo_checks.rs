use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

const DOCS_LIST_REMINDER: &str = "Reminder: keep docs up to date as behavior changes. When your task matches any \"Read when\" hint above (React hooks, cache directives, database work, tests, etc.), read that doc before coding, and suggest new coverage when it is missing.";
const DOCS_LIST_EXCLUDED_DIRS: &[&str] = &["archive", "research"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TsLocOffender {
    pub file_path: String,
    pub lines: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DocMetadata {
    summary: Option<String>,
    read_when: Vec<String>,
    error: Option<String>,
}

pub fn collect_ts_loc_offenders(
    repo_root: impl AsRef<Path>,
    max_lines: usize,
) -> Result<Vec<TsLocOffender>, String> {
    let repo_root = normalize_root(repo_root.as_ref());
    let mut offenders = Vec::new();
    for file_path in list_git_files(&repo_root)? {
        if !is_typescript_file(&file_path) {
            continue;
        }
        let absolute_path = repo_root.join(&file_path);
        if !absolute_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&absolute_path)
            .map_err(|error| format!("failed to read {}: {error}", absolute_path.display()))?;
        let lines = count_physical_lines(&content);
        if lines > max_lines {
            offenders.push(TsLocOffender { file_path, lines });
        }
    }
    offenders.sort_by(|left, right| {
        right
            .lines
            .cmp(&left.lines)
            .then_with(|| left.file_path.cmp(&right.file_path))
    });
    Ok(offenders)
}

pub fn render_docs_list(repo_root: impl AsRef<Path>) -> Result<String, String> {
    let repo_root = normalize_root(repo_root.as_ref());
    let docs_dir = repo_root.join("docs");
    if !docs_dir.exists() {
        return Err("docs:list: missing docs directory. Run from repo root.".to_string());
    }
    if !docs_dir.is_dir() {
        return Err("docs:list: docs path is not a directory.".to_string());
    }

    let mut output = String::from("Listing all markdown files in docs folder:\n");
    for relative_path in walk_markdown_files(&docs_dir, &docs_dir)? {
        let metadata = extract_doc_metadata(&docs_dir.join(&relative_path))?;
        if let Some(summary) = metadata.summary {
            output.push_str(&format!("{relative_path} - {summary}\n"));
            if !metadata.read_when.is_empty() {
                output.push_str(&format!("  Read when: {}\n", metadata.read_when.join("; ")));
            }
        } else {
            let reason = metadata
                .error
                .map(|error| format!(" - [{error}]"))
                .unwrap_or_default();
            output.push_str(&format!("{relative_path}{reason}\n"));
        }
    }
    output.push('\n');
    output.push_str(DOCS_LIST_REMINDER);
    output.push('\n');
    Ok(output)
}

fn list_git_files(repo_root: &Path) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .args(["ls-files", "--cached", "--others", "--exclude-standard"])
        .current_dir(repo_root)
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
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn is_typescript_file(file_path: &str) -> bool {
    file_path.ends_with(".ts") || file_path.ends_with(".tsx")
}

fn count_physical_lines(content: &str) -> usize {
    content.split('\n').count()
}

fn walk_markdown_files(dir: &Path, base: &Path) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let mut entries = fs::read_dir(dir)
        .map_err(|error| format!("failed to read docs directory {}: {error}", dir.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read docs directory {}: {error}", dir.display()))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;
        if file_type.is_dir() {
            if DOCS_LIST_EXCLUDED_DIRS.contains(&name.as_str()) {
                continue;
            }
            files.extend(walk_markdown_files(&path, base)?);
        } else if file_type.is_file() && name.ends_with(".md") {
            files.push(slash_path(path.strip_prefix(base).unwrap_or(&path)));
        }
    }
    files.sort_by_cached_key(|path| docs_locale_sort_key(path));
    Ok(files)
}

fn extract_doc_metadata(path: &Path) -> Result<DocMetadata, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    if !content.starts_with("---") {
        return Ok(DocMetadata {
            summary: None,
            read_when: Vec::new(),
            error: Some("missing front matter".to_string()),
        });
    }
    let Some(end_offset) = content[3..].find("\n---") else {
        return Ok(DocMetadata {
            summary: None,
            read_when: Vec::new(),
            error: Some("unterminated front matter".to_string()),
        });
    };
    let front_matter = content[3..3 + end_offset].trim();
    let mut summary_line: Option<String> = None;
    let mut read_when = Vec::new();
    let mut collecting_read_when = false;

    for raw_line in front_matter.lines() {
        let line = raw_line.trim();
        if line.starts_with("summary:") {
            summary_line = Some(line.to_string());
            collecting_read_when = false;
            continue;
        }
        if let Some(inline) = line.strip_prefix("read_when:") {
            collecting_read_when = true;
            let inline = inline.trim();
            if inline.starts_with('[') && inline.ends_with(']') {
                read_when.extend(compact_json_strings(inline));
            }
            continue;
        }
        if collecting_read_when {
            if let Some(hint) = line.strip_prefix("- ") {
                let hint = hint.trim();
                if !hint.is_empty() {
                    read_when.push(hint.to_string());
                }
            } else if line.is_empty() {
                continue;
            } else {
                collecting_read_when = false;
            }
        }
    }

    let Some(summary_line) = summary_line else {
        return Ok(DocMetadata {
            summary: None,
            read_when,
            error: Some("summary key missing".to_string()),
        });
    };
    let summary = summary_line["summary:".len()..]
        .trim()
        .trim_matches(|ch| ch == '"' || ch == '\'')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if summary.is_empty() {
        return Ok(DocMetadata {
            summary: None,
            read_when,
            error: Some("summary is empty".to_string()),
        });
    }
    Ok(DocMetadata {
        summary: Some(summary),
        read_when,
        error: None,
    })
}

fn compact_json_strings(inline: &str) -> Vec<String> {
    let normalized = inline.replace('\'', "\"");
    let Ok(Value::Array(values)) = serde_json::from_str::<Value>(&normalized) else {
        return Vec::new();
    };
    values
        .into_iter()
        .filter_map(|value| match value {
            Value::String(value) => Some(value.trim().to_string()),
            Value::Number(value) => Some(value.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
        .collect()
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn docs_locale_sort_key(path: &str) -> String {
    path.chars()
        .flat_map(char::to_lowercase)
        .map(|ch| if ch == '.' { '`' } else { ch })
        .collect()
}

fn normalize_root(root: &Path) -> PathBuf {
    if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(root)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_physical_lines_like_node_split() {
        assert_eq!(count_physical_lines(""), 1);
        assert_eq!(count_physical_lines("one"), 1);
        assert_eq!(count_physical_lines("one\n"), 2);
        assert_eq!(count_physical_lines("one\ntwo"), 2);
    }

    #[test]
    fn sorts_loc_offenders_by_line_count_descending() {
        let mut offenders = vec![
            TsLocOffender {
                file_path: "b.ts".to_string(),
                lines: 12,
            },
            TsLocOffender {
                file_path: "a.ts".to_string(),
                lines: 12,
            },
            TsLocOffender {
                file_path: "c.tsx".to_string(),
                lines: 20,
            },
        ];

        offenders.sort_by(|left, right| {
            right
                .lines
                .cmp(&left.lines)
                .then_with(|| left.file_path.cmp(&right.file_path))
        });

        assert_eq!(
            offenders
                .into_iter()
                .map(|offender| offender.file_path)
                .collect::<Vec<_>>(),
            vec!["c.tsx", "a.ts", "b.ts"]
        );
    }

    #[test]
    fn extracts_docs_metadata_from_front_matter() {
        let temp = tempfile::tempdir().expect("tempdir");
        let doc_path = temp.path().join("guide.md");
        fs::write(
            &doc_path,
            "---\nsummary: '  Keep   this compact  '\nread_when:\n  - touching docs\n  - changing metadata\n---\n# Guide\n",
        )
        .expect("write doc");

        let metadata = extract_doc_metadata(&doc_path).expect("metadata");

        assert_eq!(metadata.summary, Some("Keep this compact".to_string()));
        assert_eq!(
            metadata.read_when,
            vec!["touching docs".to_string(), "changing metadata".to_string()]
        );
        assert_eq!(metadata.error, None);
    }

    #[test]
    fn renders_docs_list_with_errors_and_read_when_hints() {
        let temp = tempfile::tempdir().expect("tempdir");
        let docs = temp.path().join("docs");
        fs::create_dir_all(docs.join("nested")).expect("docs");
        fs::write(
            docs.join("index.md"),
            "---\nsummary: Home page\nread_when: ['docs home', true, 7]\n---\n# Home\n",
        )
        .expect("index");
        fs::write(docs.join("nested").join("missing.md"), "# Missing\n").expect("missing");

        let rendered = render_docs_list(temp.path()).expect("docs list");

        assert!(rendered.contains("index.md - Home page"));
        assert!(rendered.contains("  Read when: docs home; true; 7"));
        assert!(rendered.contains("nested/missing.md - [missing front matter]"));
        assert!(rendered.contains(DOCS_LIST_REMINDER));
    }

    #[test]
    fn docs_sort_key_matches_node_locale_compare_ordering_cases() {
        let mut paths = vec![
            "reference/rpc.md",
            "reference/RELEASING.md",
            "providers/qwen.md",
            "providers/qwen_modelstudio.md",
            "security/THREAT-MODEL-ATLAS.md",
            "security/formal-verification.md",
        ];

        paths.sort_by_cached_key(|path| docs_locale_sort_key(path));

        assert_eq!(
            paths,
            vec![
                "providers/qwen_modelstudio.md",
                "providers/qwen.md",
                "reference/RELEASING.md",
                "reference/rpc.md",
                "security/formal-verification.md",
                "security/THREAT-MODEL-ATLAS.md",
            ]
        );
    }
}
