use serde_json::{json, Value};

use super::config::HindsightQualityConfig;

#[derive(Clone, Debug, PartialEq)]
pub struct MemoryQualityProfile {
    pub language: String,
    pub retain_chunk_max_chars: usize,
    pub retain_chunk_overlap_chars: usize,
    pub recall_min_score: f64,
    pub recall_rerank_top_k: usize,
    pub rewrite_query: bool,
}

impl MemoryQualityProfile {
    pub fn for_text(text: &str, primary_language: &str) -> Self {
        let language = detect_language(text, primary_language);
        let chinese_heavy = matches!(language.as_str(), "zh-CN" | "mixed");
        Self {
            language,
            retain_chunk_max_chars: if chinese_heavy { 1_200 } else { 1_800 },
            retain_chunk_overlap_chars: 120,
            recall_min_score: if chinese_heavy { 0.15 } else { 0.20 },
            recall_rerank_top_k: if chinese_heavy { 12 } else { 10 },
            rewrite_query: chinese_heavy,
        }
    }

    pub fn for_text_with_config(
        text: &str,
        primary_language: &str,
        quality: &HindsightQualityConfig,
    ) -> Self {
        let mut profile = Self::for_text(text, primary_language);
        if let Some(value) = quality.retain_chunk_max_chars {
            profile.retain_chunk_max_chars = value;
        }
        if let Some(value) = quality.retain_chunk_overlap_chars {
            profile.retain_chunk_overlap_chars = value.min(profile.retain_chunk_max_chars / 2);
        }
        if let Some(value) = quality.recall_min_score {
            profile.recall_min_score = value;
        }
        if let Some(value) = quality.recall_rerank_top_k {
            profile.recall_rerank_top_k = value;
        }
        if let Some(value) = quality.query_rewrite {
            profile.rewrite_query = value;
        }
        profile
    }

    pub fn for_language_hint(primary_language: &str) -> Self {
        Self::for_text("", primary_language)
    }

    pub fn for_language_hint_with_config(
        primary_language: &str,
        quality: &HindsightQualityConfig,
    ) -> Self {
        Self::for_text_with_config("", primary_language, quality)
    }

    pub fn diagnostics(&self) -> Value {
        json!({
            "language": self.language,
            "retainChunkMaxChars": self.retain_chunk_max_chars,
            "retainChunkOverlapChars": self.retain_chunk_overlap_chars,
            "recallMinScore": self.recall_min_score,
            "recallRerankTopK": self.recall_rerank_top_k,
            "rewriteQuery": self.rewrite_query,
        })
    }
}

pub fn rewrite_recall_query(query: &str, primary_language: &str, bilingual_terms: bool) -> String {
    let profile = MemoryQualityProfile::for_text(query, primary_language);
    if !profile.rewrite_query {
        return query.to_string();
    }
    rewrite_chinese_recall_query(query, &profile, bilingual_terms)
}

pub fn rewrite_recall_query_with_config(
    query: &str,
    primary_language: &str,
    bilingual_terms: bool,
    quality: &HindsightQualityConfig,
) -> String {
    let profile = MemoryQualityProfile::for_text_with_config(query, primary_language, quality);
    if !profile.rewrite_query {
        return query.to_string();
    }
    rewrite_chinese_recall_query(query, &profile, bilingual_terms)
}

pub fn chunk_text_for_retain(
    content: &str,
    primary_language: &str,
) -> (MemoryQualityProfile, Vec<String>) {
    let profile = MemoryQualityProfile::for_text(content, primary_language);
    let chunks = chunk_text(
        content,
        profile.retain_chunk_max_chars,
        profile.retain_chunk_overlap_chars,
    );
    (profile, chunks)
}

pub fn chunk_text_for_retain_with_config(
    content: &str,
    primary_language: &str,
    quality: &HindsightQualityConfig,
) -> (MemoryQualityProfile, Vec<String>) {
    let profile = MemoryQualityProfile::for_text_with_config(content, primary_language, quality);
    let chunks = chunk_text(
        content,
        profile.retain_chunk_max_chars,
        profile.retain_chunk_overlap_chars,
    );
    (profile, chunks)
}

pub fn chunk_metadata(profile: &MemoryQualityProfile, index: usize, total: usize) -> Value {
    json!({
        "language": profile.language,
        "chunkIndex": index,
        "chunkTotal": total,
        "chunkMaxChars": profile.retain_chunk_max_chars,
        "chunkOverlapChars": profile.retain_chunk_overlap_chars,
    })
}

fn detect_language(text: &str, primary_language: &str) -> String {
    let hint = primary_language.trim().to_ascii_lowercase();
    let cjk_count = text.chars().filter(|ch| is_cjk(*ch)).count();
    let latin_count = text.chars().filter(|ch| ch.is_ascii_alphabetic()).count();
    if cjk_count > 0 && latin_count > 0 && !(hint.starts_with("zh") && latin_count * 2 < cjk_count)
    {
        return "mixed".to_string();
    }
    if cjk_count > 0 || hint.starts_with("zh") {
        return "zh-CN".to_string();
    }
    if latin_count > 0 || hint.starts_with("en") {
        return "en".to_string();
    }
    "auto".to_string()
}

fn is_cjk(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&ch)
        || ('\u{3400}'..='\u{4dbf}').contains(&ch)
        || ('\u{f900}'..='\u{faff}').contains(&ch)
}

fn first_non_empty_line(text: &str) -> Option<&str> {
    text.lines().find(|line| !line.trim().is_empty())
}

fn extract_bilingual_terms(text: &str) -> Vec<String> {
    let pairs = [
        ("微服务", "microservice"),
        ("网关", "gateway"),
        ("插件", "plugin"),
        ("记忆", "memory"),
        ("会话", "session"),
        ("配置", "config"),
        ("部署", "deploy"),
        ("测试", "test"),
        ("数据库", "database"),
        ("缓存", "cache"),
        ("容器", "container"),
        ("集群", "cluster"),
        ("监控", "monitor"),
        ("日志", "log"),
        ("消息队列", "message queue"),
        ("负载均衡", "load balancer"),
    ];
    let lower = text.to_ascii_lowercase();
    let mut terms = Vec::new();
    for (zh, en) in pairs {
        let en_lower = en.to_ascii_lowercase();
        if text.contains(zh) || lower.contains(&en_lower) {
            push_unique(&mut terms, zh);
            push_unique(&mut terms, en);
        }
    }
    terms
}

fn rewrite_chinese_recall_query(
    query: &str,
    profile: &MemoryQualityProfile,
    bilingual_terms: bool,
) -> String {
    let terms = if bilingual_terms {
        extract_bilingual_terms(query)
    } else {
        Vec::new()
    };
    let mut lines = vec![
        format!("检索语言: {}", profile.language),
        format!(
            "检索问题: {}",
            first_non_empty_line(query).unwrap_or(query).trim()
        ),
    ];
    if !terms.is_empty() {
        lines.push(format!("关键术语: {}", terms.join(", ")));
    }
    lines.push("检索上下文:".to_string());
    lines.push(query.trim().to_string());
    lines.join("\n")
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|item| item == value) {
        values.push(value.to_string());
    }
}

fn chunk_text(content: &str, max_chars: usize, overlap_chars: usize) -> Vec<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if trimmed.chars().count() <= max_chars {
        return vec![trimmed.to_string()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    for unit in sentence_units(trimmed) {
        let unit_len = unit.chars().count();
        if unit_len > max_chars {
            flush_chunk(&mut chunks, &mut current);
            chunks.extend(split_long_unit(&unit, max_chars, overlap_chars));
            continue;
        }
        let separator = if current.is_empty() { "" } else { "\n" };
        let next_len = current.chars().count() + separator.chars().count() + unit_len;
        if next_len > max_chars && !current.is_empty() {
            let overlap = sentence_overlap_tail(&current, overlap_chars);
            flush_chunk(&mut chunks, &mut current);
            current = overlap;
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(unit.trim());
    }
    flush_chunk(&mut chunks, &mut current);
    chunks
}

fn sentence_units(text: &str) -> Vec<String> {
    let mut units = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '.' | '!' | '?' | '\n' | '\r') {
            let unit = current.trim();
            if !unit.is_empty() {
                units.push(unit.to_string());
            }
            current.clear();
        }
    }
    let unit = current.trim();
    if !unit.is_empty() {
        units.push(unit.to_string());
    }
    units
}

fn sentence_overlap_tail(chunk: &str, overlap_chars: usize) -> String {
    if overlap_chars == 0 {
        return String::new();
    }
    let units = sentence_units(chunk);
    let mut selected = Vec::new();
    let mut total = 0;
    for unit in units.into_iter().rev() {
        let len = unit.chars().count();
        if total + len > overlap_chars && !selected.is_empty() {
            break;
        }
        total += len;
        selected.push(unit);
    }
    selected.reverse();
    selected.join("\n")
}

fn split_long_unit(unit: &str, max_chars: usize, overlap_chars: usize) -> Vec<String> {
    let chars: Vec<char> = unit.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let end = (start + max_chars).min(chars.len());
        chunks.push(chars[start..end].iter().collect::<String>());
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(overlap_chars.min(max_chars / 3));
    }
    chunks
}

fn flush_chunk(chunks: &mut Vec<String>, current: &mut String) {
    let value = current.trim();
    if !value.is_empty() {
        chunks.push(value.to_string());
    }
    current.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_text_keeps_chinese_sentence_boundaries() {
        let text = "第一句话说明网关问题。第二句话说明缓存问题。".repeat(80);
        let (_profile, chunks) = chunk_text_for_retain(&text, "zh-CN");
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| chunk.ends_with('。')));
    }

    #[test]
    fn rewrite_recall_query_adds_mixed_language_terms() {
        let query = rewrite_recall_query("如何排查网关 cache 问题？", "zh-CN", true);
        assert!(query.contains("检索问题"));
        assert!(query.contains("网关"));
        assert!(query.contains("gateway"));
        assert!(query.contains("缓存"));
        assert!(query.contains("cache"));
    }
}
