use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use sqlx::SqlitePool;
use tauri::AppHandle;
use tokio::sync::{Notify, RwLock, Semaphore};

use super::types::{Job, JobType};
use crate::search::SearchIndex;

pub type CancelFlag = Arc<AtomicBool>;

pub struct JobQueue {
    db: SqlitePool,
    app_handle: AppHandle,
    semaphore: Arc<Semaphore>,
    cancel_flags: Arc<RwLock<HashMap<String, CancelFlag>>>,
    /// Jobs that were hard-cancelled (not paused) — checkpoint should be cleared
    force_cancel_ids: Arc<RwLock<HashSet<String>>>,
    notify: Arc<Notify>,
    shutdown_flag: Arc<AtomicBool>,
    pub search_index: Arc<SearchIndex>,
    pub library_path: Arc<tokio::sync::RwLock<PathBuf>>,
    pub pdf_parser: Arc<tokio::sync::OnceCell<ferrules_core::FerrulesParser>>,
}

impl JobQueue {
    pub fn new(
        db: SqlitePool,
        app_handle: AppHandle,
        search_index: Arc<SearchIndex>,
        library_path: Arc<tokio::sync::RwLock<PathBuf>>,
        pdf_parser: Arc<tokio::sync::OnceCell<ferrules_core::FerrulesParser>>,
        max_concurrent: usize,
    ) -> Self {
        Self {
            db,
            app_handle,
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            cancel_flags: Arc::new(RwLock::new(HashMap::new())),
            force_cancel_ids: Arc::new(RwLock::new(HashSet::new())),
            notify: Arc::new(Notify::new()),
            shutdown_flag: Arc::new(AtomicBool::new(false)),
            search_index,
            library_path,
            pdf_parser,
        }
    }

    /// Enqueue a new job. Persists to DB, returns job ID, notifies scheduler.
    pub async fn enqueue(
        &self,
        job_type: JobType,
        title: Option<String>,
        payload: serde_json::Value,
        priority: i32,
    ) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let display_title = title.unwrap_or_else(|| job_type.display_name().to_string());

        sqlx::query(
            r#"INSERT INTO jobs (id, job_type, status, title, payload_json, priority)
               VALUES (?, ?, 'pending', ?, ?, ?)"#,
        )
        .bind(&id)
        .bind(job_type.as_str())
        .bind(&display_title)
        .bind(payload.to_string())
        .bind(priority)
        .execute(&self.db)
        .await
        .map_err(|e| e.to_string())?;

        self.emit_job_update(&id).await;
        self.notify.notify_one();
        Ok(id)
    }

    /// Start the background scheduler loop.
    ///
    /// For I/O-bound jobs (DB queries, file reads, network), the executor runs
    /// on the normal tokio async pool via `tokio::spawn`.
    ///
    /// For CPU-bound jobs (LLM inference, heavy computation), the executor is
    /// wrapped in `tokio::task::spawn_blocking` so it doesn't starve the async
    /// runtime. The executor still uses async internally via `Handle::block_on`.
    pub fn start_scheduler(self: &Arc<Self>) {
        let queue = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                // Check if we should shut down
                if queue.shutdown_flag.load(Ordering::Relaxed) {
                    tracing::info!("Job scheduler shutting down");
                    break;
                }

                // Wait for notification or poll every 5 seconds
                tokio::select! {
                    _ = queue.notify.notified() => {},
                    _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {},
                }

                if queue.shutdown_flag.load(Ordering::Relaxed) {
                    break;
                }

                // Fetch pending jobs ordered by priority DESC, created_at ASC
                let pending_jobs: Vec<(String, String, String)> = sqlx::query_as(
                    "SELECT id, job_type, payload_json FROM jobs
                     WHERE status = 'pending'
                     ORDER BY priority DESC, created_at ASC",
                )
                .fetch_all(&queue.db)
                .await
                .unwrap_or_default();

                for (job_id, job_type_str, payload_json) in pending_jobs {
                    if queue.shutdown_flag.load(Ordering::Relaxed) {
                        break;
                    }

                    // Try to acquire semaphore permit (non-blocking)
                    let permit = match queue.semaphore.clone().try_acquire_owned() {
                        Ok(p) => p,
                        Err(_) => break, // All slots full
                    };

                    // Mark as running
                    if let Err(e) = sqlx::query(
                        "UPDATE jobs SET status = 'running', started_at = datetime('now') WHERE id = ?",
                    )
                    .bind(&job_id)
                    .execute(&queue.db)
                    .await
                    {
                        tracing::warn!("Failed to mark job {} as running: {}", job_id, e);
                    }

                    // Create cancel flag
                    let cancel_flag = Arc::new(AtomicBool::new(false));
                    {
                        let mut flags = queue.cancel_flags.write().await;
                        flags.insert(job_id.clone(), cancel_flag.clone());
                    }

                    queue.emit_job_update(&job_id).await;

                    // Determine if this job type is CPU-bound
                    let is_cpu_bound = job_type_str.parse::<JobType>()
                        .is_ok_and(|jt| jt.is_cpu_bound());

                    // Spawn the job execution
                    let q = Arc::clone(&queue);
                    let jid = job_id.clone();
                    tokio::spawn(async move {
                        let result = if is_cpu_bound {
                            // CPU-bound jobs run on the blocking thread pool so they
                            // don't starve the async runtime. The executor can still
                            // call async code via Handle::block_on() internally.
                            let q2 = Arc::clone(&q);
                            let jid2 = jid.clone();
                            let jts = job_type_str.clone();
                            let pj = payload_json.clone();
                            let cf = cancel_flag.clone();
                            let handle = tokio::runtime::Handle::current();
                            tokio::task::spawn_blocking(move || {
                                let ctx = super::executor::JobContext {
                                    db: &q2.db,
                                    app_handle: &q2.app_handle,
                                    search_index: &q2.search_index,
                                    library_path: &q2.library_path,
                                    pdf_parser: &q2.pdf_parser,
                                };
                                handle.block_on(super::executor::run_job(
                                    &ctx,
                                    &jid2,
                                    &jts,
                                    &pj,
                                    cf,
                                ))
                            })
                            .await
                            .unwrap_or_else(|e| Err(format!("Job task panicked: {}", e)))
                        } else {
                            // I/O-bound jobs run directly on the async pool
                            let ctx = super::executor::JobContext {
                                db: &q.db,
                                app_handle: &q.app_handle,
                                search_index: &q.search_index,
                                library_path: &q.library_path,
                                pdf_parser: &q.pdf_parser,
                            };
                            super::executor::run_job(
                                &ctx,
                                &jid,
                                &job_type_str,
                                &payload_json,
                                cancel_flag.clone(),
                            )
                            .await
                        };

                        // Update final status
                        match result {
                            Ok(result_json) => {
                                if let Err(e) = sqlx::query(
                                    "UPDATE jobs SET status = 'completed', result_json = ?, completed_at = datetime('now'), progress_message = 'Done' WHERE id = ?",
                                )
                                .bind(&result_json)
                                .bind(&jid)
                                .execute(&q.db)
                                .await
                                {
                                    tracing::warn!("Failed to mark job {} as completed: {}", jid, e);
                                }
                            }
                            Err(err) => {
                                if cancel_flag.load(Ordering::Relaxed) {
                                    // Check if this was a hard cancel (vs pause)
                                    let was_force = {
                                        let mut fids = q.force_cancel_ids.write().await;
                                        fids.remove(&jid)
                                    };

                                    if was_force {
                                        // Hard cancel: clear checkpoint so job can't be resumed
                                        if job_type_str == "llm_parse"
                                            && let Ok(payload) = serde_json::from_str::<super::types::LlmParsePayload>(&payload_json) {
                                                let att_id = payload.attachment_id;
                                                if let Err(e) = sqlx::query(
                                                    "UPDATE parsed_content SET status = 'failed', checkpoint_json = NULL WHERE attachment_id = ?",
                                                )
                                                .bind(att_id)
                                                .execute(&q.db)
                                                .await
                                                {
                                                    tracing::warn!("Failed to clear checkpoint for attachment {}: {}", att_id, e);
                                                }
                                            }
                                    }

                                    let msg = if was_force { "Cancelled" } else { "Paused" };
                                    if let Err(e) = sqlx::query(
                                        "UPDATE jobs SET status = 'cancelled', completed_at = datetime('now'), progress_message = ? WHERE id = ?",
                                    )
                                    .bind(msg)
                                    .bind(&jid)
                                    .execute(&q.db)
                                    .await
                                    {
                                        tracing::warn!("Failed to mark job {} as cancelled: {}", jid, e);
                                    }
                                } else {
                                    if let Err(e) = sqlx::query(
                                        "UPDATE jobs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?",
                                    )
                                    .bind(&err)
                                    .bind(&jid)
                                    .execute(&q.db)
                                    .await
                                    {
                                        tracing::warn!("Failed to mark job {} as failed: {}", jid, e);
                                    }
                                }
                            }
                        }

                        // Cleanup cancel flag
                        {
                            let mut flags = q.cancel_flags.write().await;
                            flags.remove(&jid);
                        }

                        q.emit_job_update(&jid).await;
                        drop(permit); // Release semaphore slot
                        q.notify.notify_one(); // Wake scheduler for pending jobs
                    });
                }
            }
        });
    }

    /// Cancel a job (running or pending).
    ///
    /// When `force` is true, this is a hard cancel — checkpoint/resume data is
    /// cleared immediately (not deferred) to prevent a new job on another
    /// concurrency slot from reading stale checkpoint data.
    /// When false (pause), checkpoints are preserved for resume.
    pub async fn cancel(&self, job_id: &str, force: bool) -> Result<(), String> {
        // Track force cancellations so the scheduler can clean up checkpoints
        if force {
            let mut fids = self.force_cancel_ids.write().await;
            fids.insert(job_id.to_string());
        }

        // Hold the cancel_flags lock for the entire read-check-update to prevent
        // another thread from modifying the flag between our check and DB update.
        let flags = self.cancel_flags.read().await;
        let is_running = if let Some(flag) = flags.get(job_id) {
            flag.store(true, Ordering::Relaxed);
            true
        } else {
            false
        };
        // Drop the read lock before doing async DB work
        drop(flags);

        if is_running {
            // Use a transaction so the progress update and checkpoint clear are atomic
            let mut tx = self.db.begin().await.map_err(|e| e.to_string())?;

            // Update progress message immediately so frontend shows feedback
            if let Err(e) = sqlx::query(
                "UPDATE jobs SET progress_message = 'Cancelling...' WHERE id = ?",
            )
            .bind(job_id)
            .execute(&mut *tx)
            .await
            {
                tracing::warn!("Failed to update cancelling message for job {}: {}", job_id, e);
            }

            // Force cancel on a running job: clear checkpoint immediately so a new
            // job on a different concurrency slot can't read stale resume data.
            if force
                && let Ok(job) = self.get_job(job_id).await
                    && job.job_type == "llm_parse"
                        && let Ok(payload) = serde_json::from_str::<super::types::LlmParsePayload>(&job.payload_json) {
                            let att_id = payload.attachment_id;
                            if let Err(e) = sqlx::query(
                                "UPDATE parsed_content SET status = 'failed', checkpoint_json = NULL WHERE attachment_id = ?",
                            )
                            .bind(att_id)
                            .execute(&mut *tx)
                            .await
                            {
                                tracing::warn!("Failed to clear checkpoint for attachment {} on cancel: {}", att_id, e);
                            }
                        }

            tx.commit().await.map_err(|e| e.to_string())?;

            self.emit_job_update(job_id).await;
            return Ok(());
        }

        // Not running — cancel pending job directly
        sqlx::query(
            "UPDATE jobs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status = 'pending'",
        )
        .bind(job_id)
        .execute(&self.db)
        .await
        .map_err(|e| e.to_string())?;

        // Force-cancel a paused job: clear checkpoint so it can't be resumed.
        // Use a transaction so the job read + checkpoint clear + message clear
        // are atomic and cannot interleave with other operations.
        if force
            && let Ok(job) = self.get_job(job_id).await
                && job.status == "cancelled" && job.job_type == "llm_parse" {
                    let mut tx = self.db.begin().await.map_err(|e| e.to_string())?;
                    if let Ok(payload) = serde_json::from_str::<super::types::LlmParsePayload>(&job.payload_json) {
                        let att_id = payload.attachment_id;
                        if let Err(e) = sqlx::query(
                            "UPDATE parsed_content SET status = 'failed', checkpoint_json = NULL WHERE attachment_id = ?",
                        )
                        .bind(att_id)
                        .execute(&mut *tx)
                        .await
                        {
                            tracing::warn!("Failed to clear checkpoint for attachment {} on force-cancel: {}", att_id, e);
                        }
                    }
                    // Clear the "Paused" message
                    if let Err(e) = sqlx::query(
                        "UPDATE jobs SET progress_message = NULL WHERE id = ?",
                    )
                    .bind(job_id)
                    .execute(&mut *tx)
                    .await
                    {
                        tracing::warn!("Failed to clear paused message for job {}: {}", job_id, e);
                    }
                    if let Err(e) = tx.commit().await {
                        tracing::warn!("Failed to commit force-cancel transaction for job {}: {}", job_id, e);
                    }
                }

        self.emit_job_update(job_id).await;
        Ok(())
    }

    /// Check if a job was force-cancelled (vs paused).
    pub async fn is_force_cancelled(&self, job_id: &str) -> bool {
        let fids = self.force_cancel_ids.read().await;
        fids.contains(job_id)
    }

    /// Retry a failed or cancelled job. Always allowed — no retry limit for user-initiated retries.
    pub async fn retry(&self, job_id: &str) -> Result<String, String> {
        let job = self.get_job(job_id).await?;

        if job.status != "failed" && job.status != "cancelled" {
            return Err("Job is not in a retryable state".to_string());
        }

        sqlx::query(
            "UPDATE jobs SET status = 'pending', retry_count = retry_count + 1, error_message = NULL, started_at = NULL, completed_at = NULL, progress_current = 0, progress_total = 0, progress_message = NULL WHERE id = ?",
        )
        .bind(job_id)
        .execute(&self.db)
        .await
        .map_err(|e| e.to_string())?;

        self.emit_job_update(job_id).await;
        self.notify.notify_one();
        Ok(job_id.to_string())
    }

    /// Recover jobs that were running when app closed
    pub async fn recover_interrupted_jobs(&self) -> Result<usize, String> {
        let result = sqlx::query(
            "UPDATE jobs SET status = 'pending', started_at = NULL, progress_message = 'Recovering...' WHERE status = 'running'",
        )
        .execute(&self.db)
        .await
        .map_err(|e| e.to_string())?;

        let count = result.rows_affected() as usize;
        if count > 0 {
            tracing::info!("Recovered {} interrupted jobs", count);
            self.notify.notify_one();
        }
        Ok(count)
    }

    /// Update progress for a running job (called from executors)
    pub async fn update_progress(
        &self,
        job_id: &str,
        current: i64,
        total: i64,
        message: Option<String>,
    ) {
        if let Err(e) = sqlx::query(
            "UPDATE jobs SET progress_current = ?, progress_total = ?, progress_message = ? WHERE id = ?",
        )
        .bind(current)
        .bind(total)
        .bind(&message)
        .bind(job_id)
        .execute(&self.db)
        .await
        {
            tracing::warn!("Failed to update progress for job {}: {}", job_id, e);
        }

        self.emit_job_update(job_id).await;
    }

    /// Get a single job
    pub async fn get_job(&self, job_id: &str) -> Result<Job, String> {
        sqlx::query_as::<_, Job>(
            "SELECT id, job_type, status, title, payload_json, result_json, error_message, progress_current, progress_total, progress_message, priority, max_retries, retry_count, created_at, started_at, completed_at FROM jobs WHERE id = ?",
        )
        .bind(job_id)
        .fetch_one(&self.db)
        .await
        .map_err(|e| e.to_string())
    }

    /// Get all jobs, optionally filtered by status
    pub async fn get_jobs(
        &self,
        status: Option<&str>,
        limit: i64,
    ) -> Result<Vec<Job>, String> {
        if let Some(status) = status {
            sqlx::query_as::<_, Job>(
                "SELECT id, job_type, status, title, payload_json, result_json, error_message, progress_current, progress_total, progress_message, priority, max_retries, retry_count, created_at, started_at, completed_at FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            )
            .bind(status)
            .bind(limit)
            .fetch_all(&self.db)
            .await
            .map_err(|e| e.to_string())
        } else {
            sqlx::query_as::<_, Job>(
                "SELECT id, job_type, status, title, payload_json, result_json, error_message, progress_current, progress_total, progress_message, priority, max_retries, retry_count, created_at, started_at, completed_at FROM jobs ORDER BY created_at DESC LIMIT ?",
            )
            .bind(limit)
            .fetch_all(&self.db)
            .await
            .map_err(|e| e.to_string())
        }
    }

    /// Clear completed/failed/cancelled jobs
    pub async fn clear_finished_jobs(&self) -> Result<u64, String> {
        let result =
            sqlx::query("DELETE FROM jobs WHERE status IN ('completed', 'failed', 'cancelled')")
                .execute(&self.db)
                .await
                .map_err(|e| e.to_string())?;
        Ok(result.rows_affected())
    }

    /// Graceful shutdown: cancel all running jobs and stop the scheduler.
    ///
    /// Running jobs that are restartable will be left as 'running' in the DB
    /// so `recover_interrupted_jobs()` picks them up on next launch.
    /// Non-restartable running jobs are marked as 'failed'.
    pub async fn shutdown(&self) {
        tracing::info!("Shutting down job queue...");

        // Signal the scheduler loop to exit
        self.shutdown_flag.store(true, Ordering::Relaxed);
        self.notify.notify_one();

        // Set cancel flags for all running jobs
        let flags = self.cancel_flags.read().await;
        for (job_id, flag) in flags.iter() {
            tracing::info!("Cancelling running job {} for shutdown", job_id);
            flag.store(true, Ordering::Relaxed);
        }
        drop(flags);

        // Mark non-restartable running jobs as failed (restartable ones stay
        // as 'running' and will be recovered on next startup)
        let running_jobs: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, job_type FROM jobs WHERE status = 'running'",
        )
        .fetch_all(&self.db)
        .await
        .unwrap_or_default();

        for (job_id, job_type_str) in &running_jobs {
            let is_restartable = job_type_str.parse::<JobType>()
                .is_ok_and(|jt| jt.is_restartable());

            if !is_restartable
                && let Err(e) = sqlx::query(
                    "UPDATE jobs SET status = 'failed', error_message = 'App shutdown', completed_at = datetime('now') WHERE id = ?",
                )
                .bind(job_id)
                .execute(&self.db)
                .await
                {
                    tracing::warn!("Failed to mark non-restartable job {} as failed during shutdown: {}", job_id, e);
                }
            // Restartable jobs: left as 'running' → recover_interrupted_jobs()
            // will reset them to 'pending' on next startup
        }

        tracing::info!("Job queue shutdown complete ({} running jobs handled)", running_jobs.len());
    }

    /// Emit a job update event to the frontend
    async fn emit_job_update(&self, job_id: &str) {
        use tauri::Emitter;
        if let Ok(job) = self.get_job(job_id).await
            && let Err(e) = self.app_handle.emit("job:updated", &job) {
                tracing::warn!("Failed to emit job:updated event for {}: {}", job_id, e);
            }
    }
}
