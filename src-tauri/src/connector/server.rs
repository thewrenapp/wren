use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

use super::api_handlers;
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
        // REST API endpoints
        .route("/api/items", get(api_handlers::list_items))
        .route("/api/items/{key}/cite", get(api_handlers::get_item_cite))
        .route("/api/items/{key}/bibtex", get(api_handlers::get_item_bibtex))
        .route("/api/items/{key}/json", get(api_handlers::get_item_json))
        .route("/api/items/{key}/attachments", get(api_handlers::get_item_attachments))
        .route("/api/search", get(api_handlers::search_items))
        .route("/api/collections", get(api_handlers::list_collections))
        .route("/api/collections/{id}/items", get(api_handlers::list_collection_items))
        .route("/api/tags/{name}/items", get(api_handlers::list_tag_items))
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
