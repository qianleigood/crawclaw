use serde_json::Value;

const GATEWAY_PROTOCOL_SCHEMA_JSON: &str =
    include_str!("protocol_contract/protocol.schema.stable.json");

pub fn gateway_protocol_schema_json() -> &'static str {
    GATEWAY_PROTOCOL_SCHEMA_JSON
}

pub fn gateway_protocol_schema_value() -> Result<Value, String> {
    serde_json::from_str(GATEWAY_PROTOCOL_SCHEMA_JSON)
        .map_err(|error| format!("invalid embedded gateway protocol schema: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path<'a>(value: &'a Value, keys: &[&str]) -> &'a Value {
        let mut current = value;
        for key in keys {
            current = current
                .get(*key)
                .unwrap_or_else(|| panic!("missing JSON path segment: {key}"));
        }
        current
    }

    #[test]
    fn protocol_schema_exposes_gateway_frame_contract() {
        let schema = gateway_protocol_schema_value().expect("protocol schema");
        assert_eq!(schema["title"], "CrawClaw Gateway Protocol");
        assert_eq!(path(&schema, &["discriminator", "propertyName"]), "type");
        let one_of = schema["oneOf"].as_array().expect("oneOf schemas");
        assert!(one_of
            .iter()
            .any(|entry| entry["$ref"] == "#/definitions/RequestFrame"));
        assert!(one_of
            .iter()
            .any(|entry| entry["$ref"] == "#/definitions/ResponseFrame"));
        assert!(one_of
            .iter()
            .any(|entry| entry["$ref"] == "#/definitions/EventFrame"));
    }

    #[test]
    fn protocol_schema_covers_core_methods_and_secret_refs() {
        let schema = gateway_protocol_schema_value().expect("protocol schema");
        let definitions = path(&schema, &["definitions"])
            .as_object()
            .expect("schema definitions");
        assert!(definitions.contains_key("ConnectParams"));
        assert!(definitions.contains_key("ConfigPatchParams"));
        assert!(definitions.contains_key("ConfigApplyParams"));
        assert!(definitions.contains_key("SecretsResolveParams"));

        let config_patch = definitions
            .get("ConfigPatchParams")
            .expect("ConfigPatchParams definition");
        assert_eq!(
            path(config_patch, &["properties", "restartDelayMs", "type"]),
            "integer"
        );
        let secrets_resolve = definitions
            .get("SecretsResolveParams")
            .expect("SecretsResolveParams definition");
        assert_eq!(
            path(secrets_resolve, &["properties", "targetIds", "type"]),
            "array"
        );
    }
}
