use anyhow::Result;
use serde_json::Value;

const FIRESTORE_BASE: &str = "https://firestore.googleapis.com/v1";

/// A Firestore real-time listener using Server-Sent Events (SSE).
/// Listens for changes to documents matching a target specification.
pub struct FirestoreListener {
    project_id: String,
    client: reqwest::Client,
}

#[derive(Debug, Clone)]
pub enum ListenEvent {
    DocumentChanged { path: String, fields: Value },
    DocumentDeleted { path: String },
    DocumentRemoved { path: String },
}

impl FirestoreListener {
    pub fn new(project_id: &str) -> Self {
        Self {
            project_id: project_id.to_string(),
            client: reqwest::Client::new(),
        }
    }

    /// Listen for changes on a collection path.
    /// Returns a channel receiver that emits ListenEvents.
    /// The listener runs until the returned handle is dropped.
    pub async fn listen_collection(
        &self,
        collection_path: &str,
        id_token: &str,
    ) -> Result<tokio::sync::mpsc::Receiver<ListenEvent>> {
        let url = format!(
            "{}/projects/{}/databases/(default)/documents:listen",
            FIRESTORE_BASE, self.project_id
        );

        let parent = format!(
            "projects/{}/databases/(default)/documents",
            self.project_id
        );

        let body = serde_json::json!({
            "addTarget": {
                "query": {
                    "parent": parent,
                    "structuredQuery": {
                        "from": [{ "collectionId": collection_path }]
                    }
                },
                "targetId": 1
            }
        });

        let (tx, rx) = tokio::sync::mpsc::channel(100);

        let resp = self
            .client
            .post(&url)
            .bearer_auth(id_token)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Firestore listen failed ({}): {}",
                status, text
            ));
        }

        // Spawn a task to read the SSE stream
        tokio::spawn(async move {
            use futures::StreamExt;

            let mut stream = resp.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(bytes) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));

                        // Process complete JSON objects in the buffer
                        while let Some(event) = extract_listen_event(&mut buffer) {
                            if tx.send(event).await.is_err() {
                                return; // Receiver dropped
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Firestore listener stream error: {}", e);
                        break;
                    }
                }
            }
        });

        Ok(rx)
    }
}

fn extract_listen_event(buffer: &mut String) -> Option<ListenEvent> {
    // Firestore listen API returns newline-delimited JSON objects
    if let Some(newline_pos) = buffer.find('\n') {
        let line = buffer[..newline_pos].trim().to_string();
        *buffer = buffer[newline_pos + 1..].to_string();

        if line.is_empty() {
            return None;
        }

        if let Ok(json) = serde_json::from_str::<Value>(&line) {
            if let Some(doc_change) = json.get("documentChange") {
                if let Some(doc) = doc_change.get("document") {
                    let path = doc
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string();
                    let fields = doc
                        .get("fields")
                        .cloned()
                        .unwrap_or(Value::Null);
                    return Some(ListenEvent::DocumentChanged { path, fields });
                }
            }

            if let Some(doc_delete) = json.get("documentDelete") {
                let path = doc_delete
                    .get("document")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                return Some(ListenEvent::DocumentDeleted { path });
            }

            if let Some(doc_remove) = json.get("documentRemove") {
                let path = doc_remove
                    .get("document")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                return Some(ListenEvent::DocumentRemoved { path });
            }
        }
    }

    None
}
