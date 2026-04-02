use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

use super::handlers;
use super::ConnectorState;

pub async fn start_server(
    state: Arc<ConnectorState>,
    port: u16,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
) -> anyhow::Result<()> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/connector/ping", get(handlers::ping).post(handlers::ping))
        .route("/connector/saveItems", post(handlers::save_items))
        .route("/connector/saveSnapshot", post(handlers::save_snapshot))
        .route("/connector/saveSingleFile", post(handlers::save_single_file))
        .route("/connector/getSelectedCollection", post(handlers::get_selected_collection))
        .route("/connector/saveAttachment", post(handlers::save_attachment))
        .route("/connector/hasAttachmentResolvers", post(handlers::has_attachment_resolvers))
        .route("/connector/sessionProgress", post(handlers::session_progress))
        .route("/connector/updateSession", post(handlers::update_session))
        .route("/connector/delaySync", post(handlers::delay_sync))
        .route("/connector/collections", get(handlers::get_collections))
        .layer(DefaultBodyLimit::max(500 * 1024 * 1024)) // 500MB max upload
        .layer(cors)
        .with_state(state);

    let addr = format!("127.0.0.1:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Connector server listening on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            while !*shutdown_rx.borrow() {
                if shutdown_rx.changed().await.is_err() {
                    break;
                }
            }
        })
        .await?;

    tracing::info!("Connector server shut down");
    Ok(())
}
