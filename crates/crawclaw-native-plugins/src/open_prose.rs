use serde_json::{json, Value};

pub fn describe_open_prose() -> Value {
    json!({
        "id": "open-prose",
        "runtime": "rust",
        "mode": "skills-only"
    })
}
