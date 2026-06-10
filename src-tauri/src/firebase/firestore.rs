use anyhow::Result;
use serde_json::Value;

const FIRESTORE_BASE: &str = "https://firestore.googleapis.com/v1";

#[derive(Debug, Clone)]
pub struct FirestoreClient {
    project_id: String,
    client: reqwest::Client,
}

impl FirestoreClient {
    pub fn new(project_id: &str) -> Self {
        Self {
            project_id: project_id.to_string(),
            client: reqwest::Client::new(),
        }
    }

    fn base_url(&self) -> String {
        format!(
            "{}/projects/{}/databases/(default)/documents",
            FIRESTORE_BASE, self.project_id
        )
    }

    /// Get a document by path (e.g., "shares/abc123").
    pub async fn get_document(&self, path: &str, id_token: &str) -> Result<Value> {
        let url = format!("{}/{}", self.base_url(), path);
        let resp = self
            .client
            .get(&url)
            .bearer_auth(id_token)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Firestore GET {} failed ({}): {}", path, status, body));
        }

        Ok(resp.json().await?)
    }

    /// Create or overwrite a document.
    pub async fn set_document(
        &self,
        collection: &str,
        doc_id: &str,
        fields: &Value,
        id_token: &str,
    ) -> Result<Value> {
        let url = format!("{}/{}/{}", self.base_url(), collection, doc_id);

        let body = serde_json::json!({
            "fields": fields
        });

        let resp = self
            .client
            .patch(&url)
            .bearer_auth(id_token)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Firestore SET {}/{} failed ({}): {}",
                collection, doc_id, status, body
            ));
        }

        Ok(resp.json().await?)
    }

    /// Create a document with auto-generated ID.
    pub async fn add_document(
        &self,
        collection: &str,
        fields: &Value,
        id_token: &str,
    ) -> Result<Value> {
        let url = format!("{}/{}", self.base_url(), collection);

        let body = serde_json::json!({
            "fields": fields
        });

        let resp = self
            .client
            .post(&url)
            .bearer_auth(id_token)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Firestore ADD to {} failed ({}): {}",
                collection, status, body
            ));
        }

        Ok(resp.json().await?)
    }

    /// Delete a document.
    pub async fn delete_document(&self, path: &str, id_token: &str) -> Result<()> {
        let url = format!("{}/{}", self.base_url(), path);
        let resp = self
            .client
            .delete(&url)
            .bearer_auth(id_token)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Firestore DELETE {} failed ({}): {}",
                path, status, body
            ));
        }

        Ok(())
    }

    /// Run a structured query on a collection.
    /// The `structured_query` should be a complete structuredQuery object.
    pub async fn query(
        &self,
        structured_query: &Value,
        id_token: &str,
    ) -> Result<Vec<Value>> {
        let url = format!("{}:runQuery", self.base_url());

        let body = serde_json::json!({
            "structuredQuery": structured_query
        });

        let resp = self
            .client
            .post(&url)
            .bearer_auth(id_token)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Firestore query failed ({}): {}",
                status, body
            ));
        }

        Ok(resp.json().await?)
    }
}

/// Helper to convert a Rust value to Firestore field format.
pub fn to_firestore_string(s: &str) -> Value {
    serde_json::json!({ "stringValue": s })
}

pub fn to_firestore_int(n: i64) -> Value {
    serde_json::json!({ "integerValue": n.to_string() })
}

pub fn to_firestore_bool(b: bool) -> Value {
    serde_json::json!({ "booleanValue": b })
}

pub fn to_firestore_timestamp(ts: &str) -> Value {
    serde_json::json!({ "timestampValue": ts })
}

pub fn to_firestore_map(fields: &Value) -> Value {
    serde_json::json!({ "mapValue": { "fields": fields } })
}
