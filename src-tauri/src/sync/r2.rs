use anyhow::Result;
use s3::bucket::Bucket;
use s3::creds::Credentials;
use s3::region::Region;

/// Cloudflare R2 relay for transient file sharing.
/// Files are uploaded temporarily and auto-deleted after 7 days (via R2 lifecycle rules).
pub struct R2Relay {
    bucket: Box<Bucket>,
}

impl R2Relay {
    pub fn new(
        account_id: &str,
        access_key: &str,
        secret_key: &str,
        bucket_name: &str,
    ) -> Result<Self> {
        let region = Region::Custom {
            region: "auto".to_string(),
            endpoint: format!("https://{}.r2.cloudflarestorage.com", account_id),
        };
        let credentials =
            Credentials::new(Some(access_key), Some(secret_key), None, None, None)
                .map_err(|e| anyhow::anyhow!("R2 credentials error: {}", e))?;
        let bucket = Bucket::new(bucket_name, region, credentials)
            .map_err(|e| anyhow::anyhow!("R2 bucket error: {}", e))?;
        Ok(Self { bucket })
    }

    /// Upload a file to R2 at the given path.
    pub async fn upload(&self, path: &str, data: &[u8], content_type: &str) -> Result<()> {
        self.bucket
            .put_object_with_content_type(path, data, content_type)
            .await
            .map_err(|e| anyhow::anyhow!("R2 upload failed: {}", e))?;
        Ok(())
    }

    /// Download a file from R2.
    pub async fn download(&self, path: &str) -> Result<Vec<u8>> {
        let resp = self
            .bucket
            .get_object(path)
            .await
            .map_err(|e| anyhow::anyhow!("R2 download failed: {}", e))?;
        Ok(resp.bytes().to_vec())
    }

    /// Delete a file from R2.
    pub async fn delete(&self, path: &str) -> Result<()> {
        self.bucket
            .delete_object(path)
            .await
            .map_err(|e| anyhow::anyhow!("R2 delete failed: {}", e))?;
        Ok(())
    }

    /// Generate a presigned download URL (for recipients to download without credentials).
    pub async fn presigned_url(&self, path: &str, expires_secs: u32) -> Result<String> {
        let url = self
            .bucket
            .presign_get(path, expires_secs, None)
            .await
            .map_err(|e| anyhow::anyhow!("R2 presign failed: {}", e))?;
        Ok(url)
    }

    /// Upload an entry.json + associated files for sharing.
    /// Returns the relay path prefix used.
    pub async fn upload_entry_for_share(
        &self,
        share_id: &str,
        change_id: &str,
        entry_json: &[u8],
        files: &[(&str, &[u8])],
    ) -> Result<String> {
        let prefix = format!("relay/{}/{}", share_id, change_id);

        // Upload entry.json
        self.upload(
            &format!("{}/entry.json", prefix),
            entry_json,
            "application/json",
        )
        .await?;

        // Upload associated files
        for (filename, data) in files {
            let content_type = if filename.ends_with(".pdf") {
                "application/pdf"
            } else if filename.ends_with(".md") {
                "text/markdown"
            } else {
                "application/octet-stream"
            };
            self.upload(&format!("{}/{}", prefix, filename), data, content_type)
                .await?;
        }

        Ok(prefix)
    }
}
