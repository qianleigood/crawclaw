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
}

impl Default for RuntimeCompatStatus {
    fn default() -> Self {
        Self {
            mode: RuntimeCompatMode::None,
            detail: "Rust native runtime path.".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn runtime_status_value_uses_lowercase_json() {
        assert_eq!(
            serde_json::to_value(RuntimeStatusValue::Ready).unwrap(),
            json!("ready")
        );
        assert_eq!(
            serde_json::from_value::<RuntimeStatusValue>(json!("missing")).unwrap(),
            RuntimeStatusValue::Missing
        );
    }

    #[test]
    fn runtime_compat_status_default_matches_desktop_contract() {
        let value = serde_json::to_value(RuntimeCompatStatus::default()).unwrap();

        assert_eq!(
            value,
            json!({
                "mode": "none",
                "detail": "Rust native runtime path."
            })
        );
    }
}
