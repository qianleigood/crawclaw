use std::time::Duration;

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::config::HindsightConfig;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallItem {
    pub id: String,
    pub text: String,
    pub memory_type: String,
    pub score: f64,
    pub metadata: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallResponse {
    pub items: Vec<RecallItem>,
    pub provider: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectResponse {
    pub text: String,
    pub based_on: Value,
    pub provider: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentalModel {
    pub id: String,
    pub name: String,
    pub source_query: String,
    pub content: Option<String>,
    pub tags: Vec<String>,
    pub trigger_refresh_after_consolidation: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetainResponse {
    pub status: String,
    pub provider: String,
    pub bank: String,
}

#[derive(Clone, Debug)]
pub struct RetainMemoryItem {
    pub content: String,
    pub context: String,
    pub metadata: Value,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct HindsightClient {
    base_url: String,
    api_key: String,
    client: Client,
}

impl HindsightClient {
    pub fn new(config: &HindsightConfig) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_millis(config.timeout_ms))
            .no_proxy()
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

        Ok(Self {
            base_url: config.base_url.trim_end_matches('/').to_string(),
            api_key: config.api_key.clone(),
            client,
        })
    }

    pub fn is_configured(&self) -> bool {
        !self.base_url.is_empty()
    }

    fn auth_request(
        &self,
        method: reqwest::Method,
        url: &str,
    ) -> reqwest::blocking::RequestBuilder {
        let mut req = self.client.request(method, url);
        if !self.api_key.is_empty() {
            req = req.bearer_auth(&self.api_key);
        }
        req
    }

    pub fn retain(
        &self,
        bank_id: &str,
        content: &str,
        context: &str,
        metadata: Value,
        tags: &[&str],
    ) -> Result<RetainResponse, String> {
        let item = RetainMemoryItem {
            content: content.to_string(),
            context: context.to_string(),
            metadata,
            tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
        };
        self.retain_items(bank_id, &[item])
    }

    pub fn retain_items(
        &self,
        bank_id: &str,
        items: &[RetainMemoryItem],
    ) -> Result<RetainResponse, String> {
        if items.is_empty() {
            return Err("Retain requires at least one item".to_string());
        }
        let url = format!("{}/v1/default/banks/{bank_id}/memories", self.base_url);
        let items = items
            .iter()
            .map(|item| {
                json!({
                    "content": item.content,
                    "context": item.context,
                    "metadata": item.metadata.clone(),
                    "tags": item.tags.clone(),
                })
            })
            .collect::<Vec<_>>();
        let payload = json!({
            "items": items,
            "async": false,
        });

        let response = self
            .auth_request(reqwest::Method::POST, &url)
            .json(&payload)
            .send()
            .map_err(|e| format!("Retain request failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!(
                "Retain failed with HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }

        Ok(RetainResponse {
            status: "ok".to_string(),
            provider: "hindsight".to_string(),
            bank: bank_id.to_string(),
        })
    }

    pub fn recall(
        &self,
        bank_id: &str,
        query: &str,
        types: &[&str],
        budget: &str,
        max_tokens: u32,
        tags: &[&str],
        tags_match: &str,
    ) -> Result<RecallResponse, String> {
        let url = format!("{}/v1/default/banks/{bank_id}/recall", self.base_url);
        let payload = json!({
            "query": query,
            "types": types,
            "budget": budget,
            "max_tokens": max_tokens,
            "tags": tags,
            "tags_match": tags_match,
            "include": {
                "entities": { "max_tokens": 500 },
                "chunks": { "max_tokens": 1000 },
                "source_facts": { "max_tokens": 2048 }
            }
        });

        let response = self
            .auth_request(reqwest::Method::POST, &url)
            .json(&payload)
            .send()
            .map_err(|e| format!("Recall request failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!(
                "Recall failed with HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }

        let payload: Value = response
            .json()
            .map_err(|e| format!("Failed to parse recall response: {e}"))?;

        let items = extract_recall_items(&payload);
        Ok(RecallResponse {
            items,
            provider: "hindsight".to_string(),
            status: "ok".to_string(),
        })
    }

    pub fn reflect(
        &self,
        bank_id: &str,
        query: &str,
        budget: &str,
        max_tokens: u32,
    ) -> Result<ReflectResponse, String> {
        let url = format!("{}/v1/default/banks/{bank_id}/reflect", self.base_url);
        let payload = json!({
            "query": query,
            "budget": budget,
            "max_tokens": max_tokens,
        });

        let response = self
            .auth_request(reqwest::Method::POST, &url)
            .json(&payload)
            .send()
            .map_err(|e| format!("Reflect request failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!(
                "Reflect failed with HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }

        let payload: Value = response
            .json()
            .map_err(|e| format!("Failed to parse reflect response: {e}"))?;

        let text = payload
            .get("text")
            .or_else(|| payload.get("response"))
            .or_else(|| payload.get("answer"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        Ok(ReflectResponse {
            text,
            based_on: payload.get("based_on").cloned().unwrap_or(Value::Null),
            provider: "hindsight".to_string(),
        })
    }

    pub fn create_bank(
        &self,
        bank_id: &str,
        name: &str,
        mission: &str,
        disposition: (i32, i32, i32),
    ) -> Result<(), String> {
        let url = format!("{}/v1/default/banks/{bank_id}", self.base_url);
        let payload = json!({
            "name": name,
            "mission": mission,
            "disposition": {
                "skepticism": disposition.0,
                "literalism": disposition.1,
                "empathy": disposition.2,
            }
        });

        let response = self
            .auth_request(reqwest::Method::PUT, &url)
            .json(&payload)
            .send()
            .map_err(|e| format!("Create bank request failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!(
                "Create bank failed with HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }

        Ok(())
    }

    pub fn ensure_bank(&self, bank_id: &str, layer: &str, language: &str) -> Result<(), String> {
        let (name, mission) = super::bank_resolver::bank_mission(layer, language);
        let disposition = super::bank_resolver::bank_disposition(layer);
        self.create_bank(bank_id, name, mission, disposition)
    }

    pub fn list_mental_models(&self, bank_id: &str) -> Result<Vec<MentalModel>, String> {
        let url = format!("{}/v1/default/banks/{bank_id}/mental-models", self.base_url);
        let response = self
            .auth_request(reqwest::Method::GET, &url)
            .send()
            .map_err(|e| format!("List mental models request failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!(
                "List mental models failed with HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }

        let payload: Value = response
            .json()
            .map_err(|e| format!("Failed to parse mental models response: {e}"))?;

        let models = payload
            .as_array()
            .or_else(|| payload.get("models").and_then(Value::as_array))
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect();

        Ok(models)
    }

    pub fn create_mental_model(
        &self,
        bank_id: &str,
        name: &str,
        source_query: &str,
        tags: Vec<String>,
        max_tokens: u32,
    ) -> Result<(), String> {
        let url = format!("{}/v1/default/banks/{bank_id}/mental-models", self.base_url);
        let payload = json!({
            "name": name,
            "source_query": source_query,
            "tags": tags,
            "max_tokens": max_tokens,
            "trigger_refresh_after_consolidation": true,
        });

        let response = self
            .auth_request(reqwest::Method::POST, &url)
            .json(&payload)
            .send()
            .map_err(|e| format!("Create mental model request failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!(
                "Create mental model failed with HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }

        Ok(())
    }

    pub fn refresh_mental_model(&self, bank_id: &str, model_id: &str) -> Result<(), String> {
        let url = format!(
            "{}/v1/default/banks/{bank_id}/mental-models/{model_id}/refresh",
            self.base_url
        );
        let response = self
            .auth_request(reqwest::Method::POST, &url)
            .send()
            .map_err(|e| format!("Refresh mental model request failed: {e}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!(
                "Refresh mental model failed with HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }

        Ok(())
    }

    pub fn health_check(&self) -> bool {
        let url = format!("{}/health", self.base_url);
        self.client
            .get(&url)
            .timeout(Duration::from_secs(1))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

fn extract_recall_items(payload: &Value) -> Vec<RecallItem> {
    let array = payload
        .as_array()
        .or_else(|| payload.get("results").and_then(Value::as_array))
        .or_else(|| payload.get("items").and_then(Value::as_array))
        .or_else(|| payload.get("hits").and_then(Value::as_array))
        .or_else(|| {
            payload
                .get("data")
                .and_then(|d| d.get("results"))
                .and_then(Value::as_array)
        })
        .cloned()
        .unwrap_or_default();

    array
        .into_iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let obj = entry.as_object()?;
            let text = obj
                .get("text")
                .or_else(|| obj.get("summary"))
                .or_else(|| obj.get("content"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if text.is_empty() {
                return None;
            }
            let id = obj
                .get("id")
                .or_else(|| obj.get("memory_id"))
                .or_else(|| obj.get("document_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let memory_type = obj
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let score = obj
                .get("score")
                .or_else(|| obj.get("relevance"))
                .or_else(|| obj.get("rank_score"))
                .and_then(Value::as_f64)
                .unwrap_or(1.0 - index as f64 * 0.04);

            Some(RecallItem {
                id,
                text,
                memory_type,
                score,
                metadata: entry,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::config::HindsightConfig;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn create_bank_uses_hindsight_put_bank_endpoint() {
        let (base_url, request_rx) = start_single_request_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
        );
        let mut config = HindsightConfig::default();
        config.base_url = base_url;
        let client = HindsightClient::new(&config).expect("hindsight client");

        client
            .create_bank("crawclaw:main:durable", "Durable", "Mission", (2, 4, 3))
            .expect("create bank");

        let request = request_rx.recv().expect("request");
        assert!(request.starts_with("PUT /v1/default/banks/crawclaw:main:durable "));
        let body = http_request_body_json(&request);
        assert_eq!(body["name"], "Durable");
        assert_eq!(body["mission"], "Mission");
        assert_eq!(body["disposition"]["skepticism"], 2);
        assert_eq!(body["disposition"]["literalism"], 4);
        assert_eq!(body["disposition"]["empathy"], 3);
    }

    #[test]
    fn extract_recall_items_from_results_format() {
        let payload = json!({
            "results": [
                {"id": "1", "text": "User prefers Python", "type": "observation", "score": 0.95},
                {"id": "2", "text": "User likes dark themes", "type": "world", "score": 0.85},
            ]
        });
        let items = extract_recall_items(&payload);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].text, "User prefers Python");
        assert_eq!(items[0].memory_type, "observation");
    }

    #[test]
    fn extract_recall_items_from_array_format() {
        let payload = json!([
            {"id": "1", "text": "Fact one", "type": "world"},
            {"id": "2", "text": "Fact two", "type": "experience"},
        ]);
        let items = extract_recall_items(&payload);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn extract_recall_items_skips_empty() {
        let payload = json!({
            "results": [
                {"id": "1", "text": "", "type": "world"},
                {"id": "2", "text": "Valid", "type": "world"},
            ]
        });
        let items = extract_recall_items(&payload);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].text, "Valid");
    }

    fn start_single_request_server(
        response: &'static str,
    ) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("hindsight listener");
        let addr = listener.local_addr().expect("hindsight addr");
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("hindsight request");
            stream
                .set_read_timeout(Some(Duration::from_millis(500)))
                .expect("set read timeout");
            let request = read_http_request(&mut stream);
            request_tx
                .send(String::from_utf8_lossy(&request).to_string())
                .expect("send hindsight request");
            stream
                .write_all(response.as_bytes())
                .expect("write hindsight response");
        });
        (format!("http://{addr}"), request_rx)
    }

    fn http_request_body_json(request: &str) -> Value {
        let body = request.split("\r\n\r\n").nth(1).expect("HTTP request body");
        serde_json::from_str(body).expect("JSON request body")
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    request.extend_from_slice(&buffer[..n]);
                    if request_body_complete(&request) {
                        break;
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    break;
                }
                Err(error) => panic!("read hindsight request: {error}"),
            }
        }
        request
    }

    fn request_body_complete(request: &[u8]) -> bool {
        let text = String::from_utf8_lossy(request);
        let Some((headers, body)) = text.split_once("\r\n\r\n") else {
            return false;
        };
        let content_length = headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        });
        match content_length {
            Some(length) => body.as_bytes().len() >= length,
            None => true,
        }
    }
}
