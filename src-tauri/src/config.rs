// Cloud service configuration.
// Firebase keys are public (same as any web app — security rules protect data).
// R2 keys are obfuscated at compile time and decoded at runtime.
// ── Firebase (public keys — safe to embed) ──────────────────────────

const FIREBASE_KEY_OBF: [u8; 39] = obfuscate(b"REDACTED");

pub fn firebase_api_key() -> String {
    deobfuscate(&FIREBASE_KEY_OBF)
}

pub const FIREBASE_PROJECT_ID: &str = "wren-sync";
pub const FIREBASE_AUTH_DOMAIN: &str = "wren-sync.firebaseapp.com";

// Google OAuth client credentials (from GCP Console → APIs & Services → Credentials)
const GOOGLE_CLIENT_ID_OBF: [u8; 72] = obfuscate(b"REDACTED");
const GOOGLE_SECRET_OBF: [u8; 35] = obfuscate(b"REDACTED");

pub fn google_client_id() -> String {
    deobfuscate(&GOOGLE_CLIENT_ID_OBF)
}

pub fn google_client_secret() -> String {
    deobfuscate(&GOOGLE_SECRET_OBF)
}

// ── R2 (obfuscated — not plaintext in binary) ──────────────────────

/// Simple XOR obfuscation. Not cryptographically secure, but prevents
/// casual extraction from the binary via `strings`. The keys are scoped
/// to a single R2 bucket with lifecycle rules, so exposure risk is low.
const OBF_KEY: u8 = 0x5A;

const fn obfuscate<const N: usize>(input: &[u8; N]) -> [u8; N] {
    let mut out = [0u8; N];
    let mut i = 0;
    while i < N {
        out[i] = input[i] ^ OBF_KEY;
        i += 1;
    }
    out
}

fn deobfuscate(data: &[u8]) -> String {
    data.iter().map(|b| (b ^ OBF_KEY) as char).collect()
}

// Obfuscated at compile time via const fn
const R2_ACCOUNT_ID_OBF: [u8; 32] = obfuscate(b"REDACTED");
const R2_ACCESS_KEY_OBF: [u8; 32] = obfuscate(b"REDACTED");
const R2_SECRET_KEY_OBF: [u8; 64] = obfuscate(b"REDACTED");
const R2_BUCKET_OBF: [u8; 10] = obfuscate(b"wren-relay");

pub fn r2_account_id() -> String {
    deobfuscate(&R2_ACCOUNT_ID_OBF)
}

pub fn r2_access_key_id() -> String {
    deobfuscate(&R2_ACCESS_KEY_OBF)
}

pub fn r2_secret_access_key() -> String {
    deobfuscate(&R2_SECRET_KEY_OBF)
}

pub fn r2_bucket_name() -> String {
    deobfuscate(&R2_BUCKET_OBF)
}

pub fn r2_endpoint() -> String {
    format!("https://{}.r2.cloudflarestorage.com", r2_account_id())
}
