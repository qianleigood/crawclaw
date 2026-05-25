use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::prelude::*;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::Registry;

static LOG_STATE: OnceLock<DesktopLogState> = OnceLock::new();

struct DesktopLogState {
    levels: Mutex<BTreeMap<PathBuf, DesktopLogLevel>>,
}

impl DesktopLogState {
    fn new() -> Self {
        Self {
            levels: Mutex::new(BTreeMap::new()),
        }
    }

    fn set_level(&self, runtime_root: &Path, log_level: &str) -> Result<(), String> {
        let mut levels = self
            .levels
            .lock()
            .map_err(|_| "Desktop log level lock poisoned".to_string())?;
        levels.insert(
            runtime_root.to_path_buf(),
            DesktopLogLevel::from_setting(log_level),
        );
        Ok(())
    }

    fn targets_for_event(&self, runtime_root: Option<&str>) -> Vec<(PathBuf, DesktopLogLevel)> {
        let Ok(levels) = self.levels.lock() else {
            return Vec::new();
        };
        if let Some(runtime_root) = runtime_root {
            let runtime_root = PathBuf::from(runtime_root);
            let level = levels
                .get(&runtime_root)
                .copied()
                .unwrap_or(DesktopLogLevel::Info);
            return vec![(runtime_root, level)];
        }
        if levels.len() == 1 {
            levels
                .iter()
                .map(|(root, level)| (root.clone(), *level))
                .collect()
        } else {
            Vec::new()
        }
    }
}

#[derive(Clone, Copy)]
enum DesktopLogLevel {
    Error,
    Info,
    Debug,
}

impl DesktopLogLevel {
    fn from_setting(log_level: &str) -> Self {
        match log_level {
            "错误" | "error" | "Error" => Self::Error,
            "详细" | "debug" | "Debug" => Self::Debug,
            _ => Self::Info,
        }
    }

    fn as_filter(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Info => "info",
            Self::Debug => "debug",
        }
    }

    fn allows(self, level: &Level) -> bool {
        match self {
            Self::Error => matches!(*level, Level::ERROR),
            Self::Info => matches!(*level, Level::ERROR | Level::WARN | Level::INFO),
            Self::Debug => {
                matches!(
                    *level,
                    Level::ERROR | Level::WARN | Level::INFO | Level::DEBUG
                )
            }
        }
    }
}

struct DesktopLogLayer;

impl<S> Layer<S> for DesktopLogLayer
where
    S: Subscriber + for<'span> LookupSpan<'span>,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let Some(state) = LOG_STATE.get() else {
            return;
        };
        let mut visitor = DesktopLogVisitor::default();
        event.record(&mut visitor);
        let targets = state.targets_for_event(visitor.runtime_root.as_deref());
        if targets.is_empty() {
            return;
        }
        let line = format_log_line(event, &visitor);
        for (runtime_root, configured_level) in targets {
            if configured_level.allows(event.metadata().level()) {
                let _ = append_log_line(&desktop_rust_log_path(&runtime_root), &line);
            }
        }
    }
}

#[derive(Default)]
struct DesktopLogVisitor {
    message: Option<String>,
    runtime_root: Option<String>,
    fields: BTreeMap<String, String>,
}

impl DesktopLogVisitor {
    fn record_value(&mut self, field: &Field, value: String) {
        match field.name() {
            "message" => self.message = Some(value),
            "runtime_root" => self.runtime_root = Some(value),
            name => {
                self.fields.insert(name.to_string(), value);
            }
        }
    }
}

impl Visit for DesktopLogVisitor {
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.record_value(field, value.to_string());
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.record_value(field, value.to_string());
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.record_value(field, value.to_string());
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.record_value(field, value.to_string());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.record_value(field, format!("{value:?}").trim_matches('"').to_string());
    }
}

pub(super) fn configure_desktop_rust_logging(
    runtime_root: &Path,
    log_level: &str,
) -> Result<(), String> {
    let state = LOG_STATE.get_or_init(DesktopLogState::new);
    state.set_level(runtime_root, log_level)?;
    if let Some(parent) = desktop_rust_log_path(runtime_root).parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create desktop log directory: {error}"))?;
    }
    ensure_global_subscriber()?;
    Ok(())
}

pub(super) fn desktop_rust_log_filter(log_level: &str) -> &'static str {
    DesktopLogLevel::from_setting(log_level).as_filter()
}

pub(super) fn desktop_rust_log_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join("desktop").join("logs").join("rust.log")
}

pub(super) fn recent_desktop_rust_log_lines(runtime_root: &Path, max_lines: usize) -> Vec<String> {
    let path = desktop_rust_log_path(runtime_root);
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut lines = text
        .lines()
        .rev()
        .take(max_lines)
        .map(str::to_string)
        .collect::<Vec<_>>();
    lines.reverse();
    lines
}

fn ensure_global_subscriber() -> Result<(), String> {
    let subscriber = Registry::default().with(DesktopLogLayer);
    let _ = tracing::subscriber::set_global_default(subscriber);
    Ok(())
}

fn append_log_line(path: &Path, line: &str) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())
}

fn format_log_line(event: &Event<'_>, visitor: &DesktopLogVisitor) -> String {
    let message = visitor
        .message
        .as_deref()
        .unwrap_or_else(|| event.metadata().name());
    let mut fields = visitor
        .fields
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>();
    if let Some(runtime_root) = &visitor.runtime_root {
        fields.push(format!("runtime_root={runtime_root}"));
    }
    let field_suffix = if fields.is_empty() {
        String::new()
    } else {
        format!(" {}", fields.join(" "))
    };
    format!(
        "{} {} {}: {}{}\n",
        now_unix_ms(),
        event.metadata().level(),
        event.metadata().target(),
        message,
        field_suffix
    )
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
