use crate::config;
use crate::firebase::auth::{AuthUser, FirebaseAuth};
use crate::state::AppState;
use serde::Serialize;
use sqlx::Row;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct AuthState {
    #[serde(rename = "signedIn")]
    pub signed_in: bool,
    pub uid: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
}

#[tauri::command]
pub async fn get_auth_state(state: State<'_, AppState>) -> Result<AuthState, String> {
    let row = sqlx::query("SELECT uid, email, display_name FROM user_account LIMIT 1")
        .fetch_optional(&state.db)
        .await
        .map_err(|e| e.to_string())?;

    match row {
        Some(r) => Ok(AuthState {
            signed_in: true,
            uid: Some(r.get("uid")),
            email: r.get("email"),
            display_name: r.get("display_name"),
        }),
        None => Ok(AuthState {
            signed_in: false,
            uid: None,
            email: None,
            display_name: None,
        }),
    }
}

#[tauri::command]
pub async fn sign_in_email(
    state: State<'_, AppState>,
    email: String,
    password: String,
) -> Result<AuthState, String> {
    let auth = FirebaseAuth::new(config::FIREBASE_API_KEY);
    let user = auth.sign_in_email(&email, &password).await.map_err(|e| e.to_string())?;
    save_auth(&state, &user).await?;
    Ok(auth_state_from(&user))
}

#[tauri::command]
pub async fn sign_up_email(
    state: State<'_, AppState>,
    email: String,
    password: String,
) -> Result<AuthState, String> {
    let auth = FirebaseAuth::new(config::FIREBASE_API_KEY);
    let user = auth.sign_up_email(&email, &password).await.map_err(|e| e.to_string())?;
    save_auth(&state, &user).await?;
    Ok(auth_state_from(&user))
}

/// Start Google OAuth. Spins up a temporary local server to receive the callback.
#[tauri::command]
pub async fn sign_in_google(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AuthState, String> {
    let (code, redirect_uri) = run_oauth_flow(&app_handle, "google").await?;

    let auth = FirebaseAuth::new(config::FIREBASE_API_KEY);
    let user = auth
        .exchange_google_code(
            &code,
            &config::google_client_id(),
            &config::google_client_secret(),
            &redirect_uri,
        )
        .await
        .map_err(|e| e.to_string())?;

    save_auth(&state, &user).await?;
    Ok(auth_state_from(&user))
}

#[tauri::command]
pub async fn reset_password(email: String) -> Result<(), String> {
    let auth = FirebaseAuth::new(config::FIREBASE_API_KEY);
    auth.send_password_reset(&email).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sign_out(state: State<'_, AppState>) -> Result<(), String> {
    sqlx::query("DELETE FROM user_account")
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Handle OAuth callback from deep link (used by sharing flows).
pub async fn handle_oauth_callback(
    state: &AppState,
    app_handle: &tauri::AppHandle,
    provider_id: &str,
    id_token: &str,
) -> Result<(), String> {
    let auth = FirebaseAuth::new(config::FIREBASE_API_KEY);
    let user = auth
        .sign_in_with_credential(provider_id, id_token)
        .await
        .map_err(|e| e.to_string())?;

    save_auth_direct(&state.db, &user).await?;

    use tauri::Emitter;
    let _ = app_handle.emit("auth:signed-in", serde_json::json!({
        "uid": user.uid,
        "email": user.email,
        "displayName": user.display_name,
    }));

    Ok(())
}

// ── OAuth flow with local server ────────────────────────────────────

/// Starts a temporary HTTP server on a random port, opens the browser for OAuth,
/// and waits for the callback with the auth code.
async fn run_oauth_flow(
    app_handle: &tauri::AppHandle,
    provider: &str,
) -> Result<(String, String), String> {
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // Bind to a random available port on localhost
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local server: {}", e))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get port: {}", e))?
        .port();
    let redirect_uri = format!("http://localhost:{}", port);

    // Build the OAuth URL
    let url = match provider {
        "google" => FirebaseAuth::google_oauth_url(&config::google_client_id(), port),
        _ => return Err(format!("Unsupported OAuth provider: {}", provider)),
    };

    // Open browser
    tauri_plugin_opener::OpenerExt::opener(app_handle)
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    // Wait for the callback (with 2 minute timeout)
    let code = tokio::time::timeout(std::time::Duration::from_secs(120), async {
        let (mut stream, _) = listener.accept()
            .await
            .map_err(|e| format!("Failed to accept connection: {}", e))?;

        let mut buf = vec![0u8; 4096];
        let n = stream.read(&mut buf)
            .await
            .map_err(|e| format!("Failed to read request: {}", e))?;
        let request = String::from_utf8_lossy(&buf[..n]);

        // Parse the code from GET /?code=...&scope=...
        let code = request
            .lines()
            .next()
            .and_then(|line| {
                let path = line.split_whitespace().nth(1)?;
                url::Url::parse(&format!("http://localhost{}", path)).ok()
            })
            .and_then(|url| {
                url.query_pairs()
                    .find(|(k, _)| k == "code")
                    .map(|(_, v)| v.to_string())
            })
            .ok_or_else(|| "No auth code in callback".to_string())?;

        // Send a nice response to the browser
        let html = r#"<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5"><div style="text-align:center"><h2>Signed in!</h2><p>You can close this tab and return to Wren.</p></div></body></html>"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(), html
        );
        let _ = stream.write_all(response.as_bytes()).await;

        Ok::<String, String>(code)
    })
    .await
    .map_err(|_| "Sign-in timed out (2 minutes). Please try again.".to_string())??;

    Ok((code, redirect_uri))
}

// ── Helpers ─────────────────────────────────────────────────────────

fn auth_state_from(user: &AuthUser) -> AuthState {
    AuthState {
        signed_in: true,
        uid: Some(user.uid.clone()),
        email: Some(user.email.clone()),
        display_name: user.display_name.clone(),
    }
}

async fn save_auth(state: &State<'_, AppState>, user: &AuthUser) -> Result<(), String> {
    save_auth_direct(&state.db, user).await
}

async fn save_auth_direct(db: &sqlx::SqlitePool, user: &AuthUser) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO user_account (uid, email, display_name, id_token, refresh_token, token_expires_at) \
         VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds')) \
         ON CONFLICT(uid) DO UPDATE SET \
         email = excluded.email, display_name = excluded.display_name, \
         id_token = excluded.id_token, refresh_token = excluded.refresh_token, \
         token_expires_at = excluded.token_expires_at",
    )
    .bind(&user.uid)
    .bind(&user.email)
    .bind(&user.display_name)
    .bind(&user.id_token)
    .bind(&user.refresh_token)
    .bind(&user.expires_in)
    .execute(db)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
