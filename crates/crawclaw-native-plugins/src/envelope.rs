use serde::Serialize;
use serde_json::{json, Value};

use crate::NativeError;

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum NativeEnvelope {
    Ok {
        ok: bool,
        result: Value,
    },
    Err {
        ok: bool,
        code: &'static str,
        message: String,
    },
}

impl NativeEnvelope {
    pub fn ok(result: Value) -> Self {
        Self::Ok { ok: true, result }
    }

    pub fn err(error: NativeError) -> Self {
        Self::Err {
            ok: false,
            code: error.code(),
            message: error.to_string(),
        }
    }
}

pub fn to_value<T: Serialize>(value: T) -> Result<Value, serde_json::Error> {
    serde_json::to_value(value)
}

pub fn tool_result(details: Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&details).unwrap_or_else(|_| "null".to_string()) }],
        "details": details
    })
}
