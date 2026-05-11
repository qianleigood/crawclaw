use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeStatusValue {
    Missing,
    Checking,
    Ready,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCompatStatus {
    pub mode: RuntimeCompatMode,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeCompatMode {
    None,
    #[serde(rename = "pi-quickjs")]
    PiQuickJs,
}

impl Default for RuntimeCompatStatus {
    fn default() -> Self {
        Self {
            mode: RuntimeCompatMode::None,
            detail: "Rust native runtime path.".to_string(),
        }
    }
}
