use super::*;

pub(super) fn usage_status(state: &GatewayState) -> Value {
    let config = read_config_value(&config_path(state)).unwrap_or_else(|_| json!({}));
    json!({
        "updatedAt": now_millis(),
        "providers": usage_provider_snapshots(state, &config)
    })
}

pub(super) fn usage_provider_snapshots(state: &GatewayState, config: &Value) -> Vec<Value> {
    crawclaw_providers::bundled_provider_usage_descriptors()
        .into_iter()
        .filter(|descriptor| {
            usage_provider_configured(
                state,
                config,
                descriptor.provider,
                descriptor.auth_provider,
                descriptor.aliases,
                descriptor.extra_env_keys,
            )
        })
        .map(|descriptor| {
            json!({
                "provider": descriptor.provider,
                "displayName": descriptor.display_name,
                "windows": [],
                "plan": "configured"
            })
        })
        .collect()
}

pub(super) fn usage_provider_configured(
    state: &GatewayState,
    config: &Value,
    provider: &str,
    auth_provider: &str,
    aliases: &[&str],
    extra_env_keys: &[&'static str],
) -> bool {
    let env_keys = usage_provider_env_keys(auth_provider, extra_env_keys);
    if env_keys.iter().any(|key| env_secret_present(key)) {
        return true;
    }
    if aliases
        .iter()
        .any(|alias| config_provider_has_api_key(config, alias))
    {
        return true;
    }
    auth_profiles_has_provider(&state.state_dir.join("agents/main/agent"), aliases)
        || auth_profiles_has_provider(&state.state_dir.join("agent"), aliases)
        || config_provider_has_api_key(config, provider)
}

pub(super) fn usage_provider_env_keys(
    auth_provider: &str,
    extra_env_keys: &[&'static str],
) -> Vec<&'static str> {
    let mut keys = crawclaw_providers::bundled_provider_auth_env_vars_for(auth_provider)
        .map(|keys| keys.to_vec())
        .unwrap_or_default();
    for key in extra_env_keys {
        if !keys.contains(key) {
            keys.push(*key);
        }
    }
    keys
}

pub(super) fn env_secret_present(key: &str) -> bool {
    env::var(key)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

pub(super) fn config_provider_has_api_key(config: &Value, provider: &str) -> bool {
    let path = format!("models.providers.{provider}.apiKey");
    get_json_path(config, &path)
        .map(|value| match value {
            Value::String(raw) => !raw.trim().is_empty(),
            Value::Object(object) => !object.is_empty(),
            _ => false,
        })
        .unwrap_or(false)
}

pub(super) fn auth_profiles_has_provider(agent_dir: &std::path::Path, aliases: &[&str]) -> bool {
    let path = agent_dir.join("auth-profiles.json");
    let Ok(store) = read_config_value(&path) else {
        return false;
    };
    let Some(profiles) = store.get("profiles").and_then(Value::as_object) else {
        return false;
    };
    profiles.values().any(|profile| {
        let Some(provider) = profile
            .get("provider")
            .and_then(Value::as_str)
            .map(|value| value.trim().to_lowercase())
        else {
            return false;
        };
        aliases.iter().any(|alias| provider == *alias)
            && ["key", "apiKey", "token", "accessToken", "refreshToken"]
                .iter()
                .any(|field| {
                    profile
                        .get(*field)
                        .and_then(Value::as_str)
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or(false)
                })
    })
}

pub(super) fn agent_observations_list(
    state: &GatewayState,
    params: Value,
) -> Result<Value, String> {
    if !params.is_object() {
        return Err("invalid agent.observations.list params".to_string());
    }
    if let Some(status) = string_param(&params, &["status"]) {
        if !["running", "ok", "error", "timeout", "archived", "unknown"].contains(&status.as_str())
        {
            return Err("invalid agent.observations.list params: invalid status".to_string());
        }
    }
    if let Some(source) = string_param(&params, &["source"]) {
        if ![
            "lifecycle",
            "diagnostic",
            "action",
            "archive",
            "trajectory",
            "log",
            "otel",
        ]
        .contains(&source.as_str())
        {
            return Err("invalid agent.observations.list params: invalid source".to_string());
        }
    }
    for field in ["limit", "from", "to"] {
        if params.get(field).is_some() && !params.get(field).and_then(Value::as_u64).is_some() {
            return Err(format!(
                "invalid agent.observations.list params: {field} must be a positive integer"
            ));
        }
    }
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value.clamp(1, 200))
        .unwrap_or(50);
    let Some(db_path) = observation_runtime_store_path(state) else {
        return Ok(empty_observation_list(limit));
    };
    let Ok(connection) = rusqlite::Connection::open(db_path) else {
        return Ok(empty_observation_list(limit));
    };
    if !sqlite_table_exists(&connection, "gm_observation_runs") {
        return Ok(empty_observation_list(limit));
    }
    let (items, next_cursor) = query_observation_runs(&connection, &params, limit as usize)?;
    let mut response = json!({
        "items": items,
        "generatedAt": now_millis()
    });
    if let Some(next_cursor) = next_cursor {
        response["nextCursor"] = Value::String(next_cursor);
    }
    Ok(response)
}

pub(super) fn empty_observation_list(_limit: u64) -> Value {
    json!({
        "items": Vec::<Value>::new(),
        "generatedAt": now_millis()
    })
}

pub(super) fn observation_runtime_store_path(state: &GatewayState) -> Option<PathBuf> {
    if let Some(path) = env::var("RUNTIME_DB_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Some(expand_user_path(&path));
    }
    let config = read_config_value(&config_path(state)).ok()?;
    let path = get_json_path(&config, "memory.runtimeStore.dbPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("~/.crawclaw/memory-runtime.db");
    Some(expand_user_path(path))
}

pub(super) fn sqlite_table_exists(connection: &rusqlite::Connection, table: &str) -> bool {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
            [table],
            |_| Ok(()),
        )
        .is_ok()
}

pub(super) fn query_observation_runs(
    connection: &rusqlite::Connection,
    params: &Value,
    limit: usize,
) -> Result<(Vec<Value>, Option<String>), String> {
    let mut conditions = Vec::<String>::new();
    let mut args = Vec::<rusqlite::types::Value>::new();
    if let Some(query) = string_param(params, &["query"]) {
        let like = format!("%{query}%");
        conditions.push(
            "(trace_id LIKE ? OR run_id LIKE ? OR task_id LIKE ? OR session_id LIKE ? OR session_key LIKE ? OR agent_id LIKE ?)"
                .to_string(),
        );
        for _ in 0..6 {
            args.push(rusqlite::types::Value::Text(like.clone()));
        }
    }
    if let Some(status) = string_param(params, &["status"]) {
        conditions.push("status = ?".to_string());
        args.push(rusqlite::types::Value::Text(status));
    }
    if let Some(source) = string_param(params, &["source"]) {
        conditions.push("sources_json LIKE ?".to_string());
        args.push(rusqlite::types::Value::Text(format!("%\"{source}\"%")));
    }
    if let Some(from) = params.get("from").and_then(Value::as_u64) {
        conditions.push("COALESCE(last_event_at, started_at, created_at, 0) >= ?".to_string());
        args.push(rusqlite::types::Value::Integer(from as i64));
    }
    if let Some(to) = params.get("to").and_then(Value::as_u64) {
        conditions.push("COALESCE(last_event_at, started_at, created_at, 0) <= ?".to_string());
        args.push(rusqlite::types::Value::Integer(to as i64));
    }
    if let Some((last_event_at, trace_id)) =
        string_param(params, &["cursor"]).and_then(|cursor| decode_observation_cursor(&cursor))
    {
        conditions.push(
            "(COALESCE(last_event_at, started_at, created_at, 0) < ? OR (COALESCE(last_event_at, started_at, created_at, 0) = ? AND trace_id < ?))"
                .to_string(),
        );
        args.push(rusqlite::types::Value::Integer(last_event_at as i64));
        args.push(rusqlite::types::Value::Integer(last_event_at as i64));
        args.push(rusqlite::types::Value::Text(trace_id));
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };
    let sql = format!(
        "SELECT * FROM gm_observation_runs {where_clause}
         ORDER BY COALESCE(last_event_at, started_at, created_at, 0) DESC, trace_id DESC
         LIMIT ?"
    );
    args.push(rusqlite::types::Value::Integer((limit + 1) as i64));
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("failed to query observation runs: {error}"))?;
    let rows = statement
        .query_map(
            rusqlite::params_from_iter(args.iter()),
            observation_run_summary_from_row,
        )
        .map_err(|error| format!("failed to query observation runs: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to map observation runs: {error}"))?;
    let mut items = rows;
    let next_cursor = if items.len() > limit {
        let cursor = items
            .get(limit.saturating_sub(1))
            .and_then(encode_observation_cursor);
        items.truncate(limit);
        cursor
    } else {
        None
    };
    Ok((items, next_cursor))
}

pub(super) fn observation_run_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let trace_id: String = row.get("trace_id")?;
    let run_id: Option<String> = row.get("run_id")?;
    let task_id: Option<String> = row.get("task_id")?;
    let session_id: Option<String> = row.get("session_id")?;
    let session_key: Option<String> = row.get("session_key")?;
    let agent_id: Option<String> = row.get("agent_id")?;
    let status: String = row.get("status")?;
    let started_at: Option<i64> = row.get("started_at")?;
    let ended_at: Option<i64> = row.get("ended_at")?;
    let last_event_at: Option<i64> = row.get("last_event_at")?;
    let event_count: i64 = row.get("event_count")?;
    let error_count: i64 = row.get("error_count")?;
    let sources_json: String = row.get("sources_json")?;
    let summary: String = row.get("summary")?;
    let mut object = Map::new();
    insert_optional_string(&mut object, "runId", run_id);
    insert_optional_string(&mut object, "taskId", task_id);
    object.insert("traceId".to_string(), Value::String(trace_id));
    insert_optional_string(&mut object, "sessionId", session_id);
    insert_optional_string(&mut object, "sessionKey", session_key);
    insert_optional_string(&mut object, "agentId", agent_id);
    object.insert("status".to_string(), Value::String(status));
    insert_optional_i64(&mut object, "startedAt", started_at);
    insert_optional_i64(&mut object, "endedAt", ended_at);
    insert_optional_i64(&mut object, "lastEventAt", last_event_at);
    object.insert("eventCount".to_string(), json!(event_count));
    object.insert("errorCount".to_string(), json!(error_count));
    object.insert(
        "sources".to_string(),
        parse_observation_sources(&sources_json),
    );
    object.insert("summary".to_string(), Value::String(summary));
    Ok(Value::Object(object))
}

pub(super) fn insert_optional_string(
    object: &mut Map<String, Value>,
    key: &str,
    value: Option<String>,
) {
    if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
        object.insert(key.to_string(), Value::String(value));
    }
}

pub(super) fn insert_optional_i64(object: &mut Map<String, Value>, key: &str, value: Option<i64>) {
    if let Some(value) = value {
        object.insert(key.to_string(), json!(value));
    }
}

pub(super) fn parse_observation_sources(raw: &str) -> Value {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| {
            let values = value
                .as_array()?
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            Some(json!(values))
        })
        .unwrap_or_else(|| json!([]))
}

pub(super) fn encode_observation_cursor(item: &Value) -> Option<String> {
    let last_event_at = item.get("lastEventAt").and_then(Value::as_i64).unwrap_or(0);
    let trace_id = item.get("traceId").and_then(Value::as_str)?;
    Some(base64url_encode(
        serde_json::to_string(&json!({
            "lastEventAt": last_event_at,
            "traceId": trace_id
        }))
        .ok()?
        .as_bytes(),
    ))
}

pub(super) fn decode_observation_cursor(cursor: &str) -> Option<(u64, String)> {
    let bytes = URL_SAFE_NO_PAD.decode(cursor).ok()?;
    let value = serde_json::from_slice::<Value>(&bytes).ok()?;
    let last_event_at = value.get("lastEventAt").and_then(Value::as_u64)?;
    let trace_id = value
        .get("traceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    Some((last_event_at, trace_id))
}

pub(super) fn usage_cost(state: &GatewayState, params: Value) -> Result<Value, String> {
    let range = usage_date_range(&params)?;
    let mut totals = UsageCostTotals::default();
    let mut daily = BTreeMap::<String, UsageCostTotals>::new();
    for path in usage_session_transcript_files(&state.runtime_root.join("sessions"))? {
        scan_usage_transcript(&path, &range, &mut totals, &mut daily)?;
    }
    let daily = daily
        .into_iter()
        .map(|(date, bucket)| {
            let mut value = bucket.to_value();
            if let Some(object) = value.as_object_mut() {
                object.insert("date".to_string(), Value::String(date));
            }
            value
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "updatedAt": now_millis(),
        "days": range.days,
        "daily": daily,
        "totals": totals.to_value()
    }))
}

#[derive(Clone, Debug)]
pub(super) struct UsageDateRange {
    start_ms: i64,
    end_ms: i64,
    days: u64,
}

#[derive(Clone, Debug, Default)]
pub(super) struct UsageTokenCounts {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    total: u64,
}

#[derive(Clone, Debug, Default)]
pub(super) struct UsageCostTotals {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    total_tokens: u64,
    total_cost: f64,
    input_cost: f64,
    output_cost: f64,
    cache_read_cost: f64,
    cache_write_cost: f64,
    missing_cost_entries: u64,
}

impl UsageCostTotals {
    fn apply(&mut self, usage: &UsageTokenCounts, cost: Option<UsageCostBreakdown>) {
        self.input = self.input.saturating_add(usage.input);
        self.output = self.output.saturating_add(usage.output);
        self.cache_read = self.cache_read.saturating_add(usage.cache_read);
        self.cache_write = self.cache_write.saturating_add(usage.cache_write);
        self.total_tokens = self.total_tokens.saturating_add(usage.total);
        if let Some(cost) = cost {
            self.total_cost += cost.total;
            self.input_cost += cost.input;
            self.output_cost += cost.output;
            self.cache_read_cost += cost.cache_read;
            self.cache_write_cost += cost.cache_write;
        } else {
            self.missing_cost_entries = self.missing_cost_entries.saturating_add(1);
        }
    }

    fn to_value(&self) -> Value {
        json!({
            "input": self.input,
            "output": self.output,
            "cacheRead": self.cache_read,
            "cacheWrite": self.cache_write,
            "totalTokens": self.total_tokens,
            "totalCost": self.total_cost,
            "inputCost": self.input_cost,
            "outputCost": self.output_cost,
            "cacheReadCost": self.cache_read_cost,
            "cacheWriteCost": self.cache_write_cost,
            "missingCostEntries": self.missing_cost_entries
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct UsageCostBreakdown {
    total: f64,
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
}

pub(super) fn usage_date_range(params: &Value) -> Result<UsageDateRange, String> {
    const DAY_MS: i64 = 24 * 60 * 60 * 1000;
    let today = chrono::Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| "failed to resolve current UTC day".to_string())?
        .and_utc()
        .timestamp_millis();
    let today_end = today + DAY_MS - 1;
    let start =
        string_param(params, &["startDate"]).and_then(|date| usage_date_start_ms(&date).ok());
    let end = string_param(params, &["endDate"]).and_then(|date| usage_date_start_ms(&date).ok());
    if let (Some(start_ms), Some(end_ms)) = (start, end) {
        let end_ms = end_ms + DAY_MS - 1;
        let days = ((end_ms - start_ms).max(0) / DAY_MS + 1) as u64;
        return Ok(UsageDateRange {
            start_ms,
            end_ms,
            days,
        });
    }
    let days = usage_days_param(params).unwrap_or(30).max(1);
    let start_ms = today - (days.saturating_sub(1) as i64 * DAY_MS);
    Ok(UsageDateRange {
        start_ms,
        end_ms: today_end,
        days,
    })
}

pub(super) fn usage_date_start_ms(raw: &str) -> Result<i64, String> {
    let timestamp_ms = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|error| format!("invalid usage date {raw}: {error}"))?
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| format!("invalid usage date {raw}"))?
        .and_utc()
        .timestamp_millis();
    Ok(timestamp_ms)
}

pub(super) fn usage_days_param(params: &Value) -> Option<u64> {
    let value = params.get("days")?;
    value.as_u64().or_else(|| {
        value
            .as_str()
            .and_then(|raw| raw.trim().parse::<u64>().ok())
    })
}

pub(super) fn usage_session_transcript_files(sessions_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = match std::fs::read_dir(sessions_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "failed to read usage sessions directory {}: {error}",
                sessions_dir.display()
            ));
        }
    };
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "failed to read usage sessions directory {}: {error}",
                sessions_dir.display()
            )
        })?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if is_usage_counted_session_transcript_name(name) {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

pub(super) fn is_usage_counted_session_transcript_name(name: &str) -> bool {
    if name == "sessions.json" {
        return false;
    }
    name.ends_with(".jsonl") || name.contains(".jsonl.reset.") || name.contains(".jsonl.deleted.")
}

pub(super) fn scan_usage_transcript(
    path: &Path,
    range: &UsageDateRange,
    totals: &mut UsageCostTotals,
    daily: &mut BTreeMap<String, UsageCostTotals>,
) -> Result<(), String> {
    let raw = std::fs::read_to_string(path).map_err(|error| {
        format!(
            "failed to read usage transcript {}: {error}",
            path.display()
        )
    })?;
    for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(parsed) = parse_usage_transcript_entry(&entry) else {
            continue;
        };
        if parsed.timestamp_ms < range.start_ms || parsed.timestamp_ms > range.end_ms {
            continue;
        }
        let Some(day) = usage_day_key(parsed.timestamp_ms) else {
            continue;
        };
        totals.apply(&parsed.usage, parsed.cost);
        daily
            .entry(day)
            .or_default()
            .apply(&parsed.usage, parsed.cost);
    }
    Ok(())
}

pub(super) struct ParsedUsageTranscriptEntry {
    timestamp_ms: i64,
    usage: UsageTokenCounts,
    cost: Option<UsageCostBreakdown>,
}

pub(super) fn parse_usage_transcript_entry(entry: &Value) -> Option<ParsedUsageTranscriptEntry> {
    let message = entry.get("message")?.as_object()?;
    let role = message.get("role")?.as_str()?;
    if role != "user" && role != "assistant" {
        return None;
    }
    let usage_raw = message.get("usage").or_else(|| entry.get("usage"))?;
    let usage = normalize_usage_tokens(usage_raw)?;
    let timestamp_ms = usage_timestamp_ms(entry)?;
    let cost = usage_cost_breakdown(usage_raw);
    Some(ParsedUsageTranscriptEntry {
        timestamp_ms,
        usage,
        cost,
    })
}

pub(super) fn normalize_usage_tokens(usage: &Value) -> Option<UsageTokenCounts> {
    let input = usage_token_number(
        usage,
        &[
            "input",
            "inputTokens",
            "input_tokens",
            "promptTokens",
            "prompt_tokens",
        ],
    );
    let output = usage_token_number(
        usage,
        &[
            "output",
            "outputTokens",
            "output_tokens",
            "completionTokens",
            "completion_tokens",
        ],
    );
    let cache_read = usage_token_number(
        usage,
        &[
            "cacheRead",
            "cache_read",
            "cache_read_input_tokens",
            "cached_tokens",
        ],
    )
    .or_else(|| {
        usage
            .get("prompt_tokens_details")
            .and_then(|details| usage_token_number(details, &["cached_tokens"]))
    });
    let cache_write = usage_token_number(
        usage,
        &["cacheWrite", "cache_write", "cache_creation_input_tokens"],
    );
    let total = usage_token_number(usage, &["total", "totalTokens", "total_tokens"]);
    if input.is_none()
        && output.is_none()
        && cache_read.is_none()
        && cache_write.is_none()
        && total.is_none()
    {
        return None;
    }
    let input = input.unwrap_or(0);
    let output = output.unwrap_or(0);
    let cache_read = cache_read.unwrap_or(0);
    let cache_write = cache_write.unwrap_or(0);
    let total = total.unwrap_or_else(|| {
        input
            .saturating_add(output)
            .saturating_add(cache_read)
            .saturating_add(cache_write)
    });
    Some(UsageTokenCounts {
        input,
        output,
        cache_read,
        cache_write,
        total,
    })
}

pub(super) fn usage_token_number(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| {
                    value
                        .as_i64()
                        .filter(|value| *value >= 0)
                        .map(|value| value as u64)
                })
                .or_else(|| {
                    value
                        .as_f64()
                        .filter(|value| value.is_finite() && *value >= 0.0)
                        .map(|value| value.floor() as u64)
                })
        })
    })
}

pub(super) fn usage_timestamp_ms(entry: &Value) -> Option<i64> {
    if let Some(raw) = entry.get("timestamp").and_then(Value::as_str) {
        if let Ok(timestamp) = chrono::DateTime::parse_from_rfc3339(raw) {
            return Some(timestamp.timestamp_millis());
        }
    }
    entry
        .get("message")
        .and_then(|message| message.get("timestamp"))
        .and_then(json_millis_value)
}

pub(super) fn json_millis_value(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(|value| value as i64)
    })
}

pub(super) fn usage_day_key(timestamp_ms: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(timestamp_ms)
        .map(|timestamp| timestamp.date_naive().format("%Y-%m-%d").to_string())
}

pub(super) fn usage_cost_breakdown(usage: &Value) -> Option<UsageCostBreakdown> {
    let cost = usage.get("cost")?;
    let total = usage_cost_number(cost, "total")?;
    if total < 0.0 {
        return None;
    }
    Some(UsageCostBreakdown {
        total,
        input: usage_cost_number(cost, "input").unwrap_or(0.0),
        output: usage_cost_number(cost, "output").unwrap_or(0.0),
        cache_read: usage_cost_number(cost, "cacheRead").unwrap_or(0.0),
        cache_write: usage_cost_number(cost, "cacheWrite").unwrap_or(0.0),
    })
}

pub(super) fn usage_cost_number(value: &Value, key: &str) -> Option<f64> {
    value.get(key)?.as_f64().filter(|value| value.is_finite())
}

pub(super) fn doctor_memory_status(state: &GatewayState) -> Result<Value, String> {
    Ok(json!({
        "ok": true,
        "implementation": "rust-native",
        "memory": memory_runtime(state).status()?
    }))
}
