use anyhow::Result;
use serde::{Deserialize, Serialize};

const IDENTITY_TOOLKIT_URL: &str = "https://identitytoolkit.googleapis.com/v1";
const SECURE_TOKEN_URL: &str = "https://securetoken.googleapis.com/v1";

#[derive(Debug, Clone)]
pub struct FirebaseAuth {
    api_key: String,
    client: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub uid: String,
    pub email: String,
    pub display_name: Option<String>,
    pub id_token: String,
    pub refresh_token: String,
    pub expires_in: String,
}

#[derive(Debug, Serialize)]
struct SignInRequest {
    email: String,
    password: String,
    #[serde(rename = "returnSecureToken")]
    return_secure_token: bool,
}

#[derive(Debug, Deserialize)]
struct SignInResponse {
    #[serde(rename = "localId")]
    local_id: String,
    email: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "idToken")]
    id_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: String,
    #[serde(rename = "expiresIn")]
    expires_in: String,
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    id_token: String,
    refresh_token: String,
    expires_in: String,
    user_id: String,
}

#[derive(Debug, Deserialize)]
struct FirebaseError {
    error: FirebaseErrorDetail,
}

#[derive(Debug, Deserialize)]
struct FirebaseErrorDetail {
    message: String,
}

impl FirebaseAuth {
    pub fn new(api_key: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            client: reqwest::Client::new(),
        }
    }

    /// Sign in with email and password.
    pub async fn sign_in_email(&self, email: &str, password: &str) -> Result<AuthUser> {
        let url = format!(
            "{}/accounts:signInWithPassword?key={}",
            IDENTITY_TOOLKIT_URL, self.api_key
        );

        let resp = self
            .client
            .post(&url)
            .json(&SignInRequest {
                email: email.to_string(),
                password: password.to_string(),
                return_secure_token: true,
            })
            .send()
            .await?;

        if !resp.status().is_success() {
            let err: FirebaseError = resp.json().await?;
            return Err(anyhow::anyhow!("Firebase auth error: {}", err.error.message));
        }

        let data: SignInResponse = resp.json().await?;
        Ok(AuthUser {
            uid: data.local_id,
            email: data.email,
            display_name: data.display_name,
            id_token: data.id_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in,
        })
    }

    /// Sign up with email and password.
    pub async fn sign_up_email(&self, email: &str, password: &str) -> Result<AuthUser> {
        let url = format!(
            "{}/accounts:signUp?key={}",
            IDENTITY_TOOLKIT_URL, self.api_key
        );

        let resp = self
            .client
            .post(&url)
            .json(&SignInRequest {
                email: email.to_string(),
                password: password.to_string(),
                return_secure_token: true,
            })
            .send()
            .await?;

        if !resp.status().is_success() {
            let err: FirebaseError = resp.json().await?;
            return Err(anyhow::anyhow!("Firebase signup error: {}", err.error.message));
        }

        let data: SignInResponse = resp.json().await?;
        Ok(AuthUser {
            uid: data.local_id,
            email: data.email,
            display_name: data.display_name,
            id_token: data.id_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in,
        })
    }

    /// Refresh an expired ID token using a refresh token.
    pub async fn refresh_token(&self, refresh_token: &str) -> Result<AuthUser> {
        let url = format!("{}/token?key={}", SECURE_TOKEN_URL, self.api_key);

        let resp = self
            .client
            .post(&url)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await?;

        if !resp.status().is_success() {
            let err: FirebaseError = resp.json().await?;
            return Err(anyhow::anyhow!("Token refresh error: {}", err.error.message));
        }

        let data: RefreshResponse = resp.json().await?;
        Ok(AuthUser {
            uid: data.user_id,
            email: String::new(),
            display_name: None,
            id_token: data.id_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in,
        })
    }

    /// Exchange an OAuth credential (from Google/Apple sign-in) for a Firebase user.
    pub async fn sign_in_with_credential(
        &self,
        provider_id: &str,
        id_token: &str,
    ) -> Result<AuthUser> {
        let url = format!(
            "{}/accounts:signInWithIdp?key={}",
            IDENTITY_TOOLKIT_URL, self.api_key
        );

        let post_body = match provider_id {
            "google.com" => format!("id_token={}&providerId=google.com", id_token),
            "apple.com" => format!("id_token={}&providerId=apple.com", id_token),
            _ => return Err(anyhow::anyhow!("Unsupported provider: {}", provider_id)),
        };

        let resp = self
            .client
            .post(&url)
            .json(&serde_json::json!({
                "postBody": post_body,
                "requestUri": "https://localhost",
                "returnSecureToken": true,
                "returnIdpCredential": true,
            }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let err: FirebaseError = resp.json().await?;
            return Err(anyhow::anyhow!("OAuth sign-in error: {}", err.error.message));
        }

        let data: SignInResponse = resp.json().await?;
        Ok(AuthUser {
            uid: data.local_id,
            email: data.email,
            display_name: data.display_name,
            id_token: data.id_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in,
        })
    }

    /// Build the Google OAuth URL for desktop sign-in.
    /// Uses Google's OAuth 2.0 endpoint directly with a loopback redirect.
    pub fn google_oauth_url(client_id: &str, redirect_port: u16) -> String {
        let redirect_uri = format!("http://localhost:{}", redirect_port);
        format!(
            "https://accounts.google.com/o/oauth2/v2/auth?\
             client_id={}&redirect_uri={}&response_type=code&scope=openid%20email%20profile&\
             access_type=offline&prompt=consent",
            client_id,
            urlencoding::encode(&redirect_uri),
        )
    }

    /// Exchange a Google auth code for tokens, then sign into Firebase.
    pub async fn exchange_google_code(
        &self,
        code: &str,
        client_id: &str,
        client_secret: &str,
        redirect_uri: &str,
    ) -> Result<AuthUser> {
        // Step 1: Exchange code for Google tokens
        let token_resp = self
            .client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("code", code),
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("redirect_uri", redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?;

        if !token_resp.status().is_success() {
            let body = token_resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Google token exchange failed: {}", body));
        }

        let google_tokens: serde_json::Value = token_resp.json().await?;
        let google_id_token = google_tokens["id_token"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("No id_token in Google response"))?;

        // Step 2: Sign into Firebase with the Google ID token
        self.sign_in_with_credential("google.com", google_id_token).await
    }

    /// Send a password reset email.
    pub async fn send_password_reset(&self, email: &str) -> Result<()> {
        let url = format!(
            "{}/accounts:sendOobCode?key={}",
            IDENTITY_TOOLKIT_URL, self.api_key
        );

        let resp = self
            .client
            .post(&url)
            .json(&serde_json::json!({
                "requestType": "PASSWORD_RESET",
                "email": email,
            }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let err: FirebaseError = resp.json().await?;
            return Err(anyhow::anyhow!("Password reset error: {}", err.error.message));
        }

        Ok(())
    }
}
