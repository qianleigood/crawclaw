use super::*;

#[derive(Clone, Copy)]
pub(super) enum WebToolKind {
    Search,
    Fetch,
}

impl WebToolKind {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Search => "web_search",
            Self::Fetch => "web_fetch",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Search => "Search the web through the Rust native provider resolver.",
            Self::Fetch => {
                "Fetch and extract readable web content through the Rust native runtime."
            }
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::Search => json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query."
                    },
                    "count": {
                        "type": "number",
                        "description": "Maximum number of results."
                    },
                    "provider": {
                        "type": "string",
                        "enum": ["searxng"],
                        "description": "Optional Rust-owned search provider. web_search only supports SearXNG."
                    },
                    "baseUrl": {
                        "type": "string",
                        "description": "SearXNG base URL."
                    },
                    "engines": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "categories": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "language": { "type": "string" },
                    "safeSearch": { "type": "string", "enum": ["off", "moderate", "strict", "0", "1", "2"] },
                    "timeRange": { "type": "string", "enum": ["day", "month", "year"] },
                    "timeoutSeconds": { "type": "number" }
                },
                "required": ["query"]
            }),
            Self::Fetch => json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "HTTP or HTTPS URL to fetch."
                    },
                    "detail": {
                        "type": "string",
                        "enum": ["brief", "standard", "full"]
                    },
                    "output": {
                        "type": "string",
                        "enum": ["markdown", "text", "html", "structured"]
                    },
                    "render": {
                        "type": "string",
                        "enum": ["auto", "never", "stealth", "dynamic"]
                    },
                    "extractMode": {
                        "type": "string",
                        "enum": ["markdown", "text", "html"]
                    },
                    "extract": {
                        "type": "string",
                        "enum": ["readable", "raw", "links", "metadata"]
                    },
                    "maxChars": { "type": "number" },
                    "timeoutSeconds": { "type": "number" },
                    "mainContentOnly": { "type": "boolean" },
                    "waitUntil": {
                        "type": "string",
                        "enum": ["domcontentloaded", "load", "networkidle"]
                    },
                    "waitFor": { "type": "string" },
                    "sessionId": { "type": "string" }
                },
                "required": ["url"]
            }),
        }
    }
}

#[derive(Clone)]
pub(super) struct WebTool {
    kind: WebToolKind,
}

impl WebTool {
    pub(super) fn new(kind: WebToolKind) -> Self {
        Self { kind }
    }
}

#[async_trait]
impl pi::sdk::Tool for WebTool {
    fn name(&self) -> &str {
        self.kind.name()
    }

    fn label(&self) -> &str {
        self.kind.name()
    }

    fn description(&self) -> &str {
        self.kind.description()
    }

    fn parameters(&self) -> Value {
        self.kind.parameters()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let result = match self.kind {
            WebToolKind::Search => run_web_search(input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error.to_string()))?,
            WebToolKind::Fetch => run_spider_fetch(input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error.to_string()))?,
        };
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        true
    }
}
