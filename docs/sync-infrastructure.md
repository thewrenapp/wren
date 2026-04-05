# Wren Sync Infrastructure Setup

## Architecture Overview

Wren uses two cloud services for sharing (personal multi-device sync uses zero cloud — just your own iCloud/Dropbox):

| Service | Role | Cost (10K users) |
|---------|------|-----------------|
| **Firebase** | Auth (accounts) + Firestore (sharing coordination) | ~$7/month |
| **Cloudflare R2** | Transient file relay for sharing ($0 egress) | ~$0.57/month |
| **Total** | | **~$8/month** |

Personal multi-device sync is free — it works by writing `entry.json` files to your library folder, which syncs via iCloud/Dropbox/Google Drive.

---

## Cloudflare R2 Setup

R2 is S3-compatible object storage with **$0 egress**. Used as the sole file relay for sharing between users.

### 1. Create Cloudflare Account + R2 Bucket

```
https://dash.cloudflare.com
  → R2 Object Storage
  → Create bucket
  → Bucket name: "wren-relay"
  → Region: Auto (or pick closest to your user base)
```

### 2. Create API Token

```
Dashboard → R2 → Manage R2 API Tokens → Create API Token
  Permissions: Object Read & Write
  Scope: Apply to bucket "wren-relay"
  → Save the Access Key ID and Secret Access Key
```

### 3. Set Lifecycle Rule (auto-cleanup)

```
Dashboard → R2 → wren-relay → Settings → Object lifecycle rules
  Add rule:
    Prefix: relay/
    Action: Delete after 7 days
```

This ensures relay files are cleaned up even if the app doesn't delete them explicitly.

### 4. Configure CORS

Required for presigned URL downloads from desktop app:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply via Dashboard → R2 → wren-relay → Settings → CORS policy.

### 5. Credentials

```env
R2_ACCOUNT_ID=<your-cloudflare-account-id>
R2_ACCESS_KEY_ID=<from-step-2>
R2_SECRET_ACCESS_KEY=<from-step-2>
R2_BUCKET_NAME=wren-relay
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

These are compiled into the app binary or fetched from a config endpoint at startup.

### How the Relay Works

1. User A shares entries with User B
2. User A's device uploads `entry.json` + PDFs to `relay/{shareId}/{changeId}/` in R2
3. User A writes a presigned download URL to a Firestore change document
4. User B's device downloads directly from R2 using the presigned URL (no R2 credentials needed)
5. After User B confirms receipt, the relay files are deleted (or auto-expire after 7 days)

### R2 Pricing

| Resource | Price | 500 active sharers/month |
|----------|-------|--------------------------|
| Storage | $0.015/GB/month | 20 GB peak = $0.30 |
| Class A ops (write) | $4.50/million | ~50K = $0.23 |
| Class B ops (read) | $0.36/million | ~100K = $0.04 |
| Egress | **$0** | **$0** |
| **Total** | | **~$0.57/month** |

---

## Firebase Setup

Firebase handles user authentication and Firestore (sharing coordination). No Firebase Storage is used.

### 1. Create Project

```
https://console.firebase.google.com
  → Create project: "wren-sync"
  → Disable Google Analytics (not needed)
```

**Get API keys:**
```
Firebase Console → Project Settings (gear icon, top-left) → General
  → Scroll down to "Your apps" → Add app → Web (</> icon)
  → App nickname: "Wren"
  → Register app
  → Copy from the config block:
      apiKey       → FIREBASE_API_KEY in .env
      projectId    → FIREBASE_PROJECT_ID in .env
      authDomain   → FIREBASE_AUTH_DOMAIN in .env
```

### 2. Enable Authentication

```
Firebase Console → Authentication → Sign-in method
Enable: Email/Password, Google, Apple
```

#### Google Sign-In

```
Firebase Console → Authentication → Sign-in method → Google → Enable
  - Set a project support email
  - This auto-creates an OAuth consent screen in GCP
```

#### Apple Sign-In (full setup)

**Step 1: Apple Developer Portal — Register App ID**
```
developer.apple.com → Certificates, Identifiers & Keys → Identifiers → +
  Select "App IDs" → Continue
  Type: App
  Description: "Wren"
  Bundle ID: Explicit → com.cascade.wren
  Scroll down to Capabilities → check "Sign in with Apple"
  Continue → Register
```

**Step 2: Apple Developer Portal — Create Service ID (for web auth)**
```
developer.apple.com → Certificates, Identifiers & Keys → Identifiers → +
  Select "Services IDs" → Continue
  Description: "Wren Auth"
  Identifier: com.cascade.wren.auth
  Check "Sign in with Apple" → Configure
    Primary App ID: Wren (com.cascade.wren) — the one from Step 1
    Domains: wren-sync.firebaseapp.com
    Return URLs: https://wren-sync.firebaseapp.com/__/auth/handler
  Save → Continue → Register
```

**Step 3: Apple Developer Portal — Create Key**
```
developer.apple.com → Certificates, Identifiers & Keys → Keys → +
  Name: "Wren Firebase Auth"
  Check "Sign in with Apple" → Configure
    Primary App ID: Wren (com.cascade.wren)
  Save → Continue → Register
  → Download the .p8 key file (ONE TIME ONLY — save it safely!)
  → Note the Key ID (10-character string, e.g., ABC1234DEF)
```

**Step 4: Firebase Console — Configure Apple Provider**
```
Firebase Console → Authentication → Sign-in method → Apple → Enable
  Services ID: com.cascade.wren.auth
  Apple team ID: APPLE_TEAM_ID
  Key ID: (the 10-char ID from Step 3)
  Private key: (paste contents of the .p8 file from Step 3)
  Save
```

### 3. Create Firestore Database

```
Firebase Console → Firestore Database → Create database
  Location: nam5 (us-central) or your preferred region
  Start in production mode (we deploy rules next)
```

### 4. Deploy Security Rules

Create a file `firestore.rules` in your project root:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // User profiles
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == uid;
    }

    // Shares
    match /shares/{shareId} {
      allow read: if isMember(shareId);
      allow create: if request.auth != null;
      allow update, delete: if isOwner(shareId);

      // Members
      match /members/{memberId} {
        allow read: if isMember(shareId);
        allow create: if isOwner(shareId);
        allow update: if isOwner(shareId) || request.auth.uid == memberId;
        allow delete: if isOwner(shareId);
      }

      // Manifests (lightweight entry metadata for UI display)
      match /manifest/{entryKey} {
        allow read: if isMember(shareId);
        allow write: if hasRole(shareId, ['owner', 'editor']);
      }

      // Change feed (propagates edits between users)
      match /changes/{changeId} {
        allow read: if isMember(shareId);
        allow create: if hasRole(shareId, ['owner', 'editor', 'commenter']);
        allow update: if request.auth.uid in resource.data.consumed;
      }
    }

    // Invite links
    match /invites/{inviteCode} {
      allow read, create, update: if request.auth != null;
    }

    // Helper functions
    function isMember(shareId) {
      return request.auth != null &&
        exists(/databases/$(database)/documents/shares/$(shareId)/members/$(request.auth.uid));
    }

    function isOwner(shareId) {
      return request.auth != null &&
        get(/databases/$(database)/documents/shares/$(shareId)).data.ownerUid == request.auth.uid;
    }

    function hasRole(shareId, roles) {
      return request.auth != null &&
        get(/databases/$(database)/documents/shares/$(shareId)/members/$(request.auth.uid)).data.role in roles;
    }
  }
}
```

Deploy:

```bash
npm install -g firebase-tools
firebase login
firebase init firestore    # select the wren-sync project
firebase deploy --only firestore:rules
```

### 5. App Configuration

```env
# These are public keys (safe to embed in app binary)
FIREBASE_API_KEY=AIza...
FIREBASE_PROJECT_ID=wren-sync
FIREBASE_AUTH_DOMAIN=wren-sync.firebaseapp.com
```

### 6. Firestore Data Model

```
/users/{uid}
  displayName, email, photoUrl, createdAt
  deviceTokens: { deviceId: fcmToken }

/shares/{shareId}
  ownerUid, type ("collection"|"entries"), entryKeys[], createdAt, updatedAt

/shares/{shareId}/members/{uid}
  role ("viewer"|"commenter"|"editor"), status ("pending"|"accepted"|"left"), addedAt, addedBy

/shares/{shareId}/manifest/{entryKey}
  title, itemType, creatorsDisplay, updatedAt, updatedBy

/shares/{shareId}/changes/{changeId}
  entryKey, authorUid, deviceId, changeType, delta, fileRelayPath, consumed, ttl

/invites/{inviteCode}
  shareId, createdBy, expiresAt, maxUses, useCount
```

### 7. REST API Reference

Wren uses Firebase REST APIs directly (no SDK):

```
Auth:
  Sign in:   POST identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={API_KEY}
  Sign up:   POST identitytoolkit.googleapis.com/v1/accounts:signUp?key={API_KEY}
  Refresh:   POST securetoken.googleapis.com/v1/token?key={API_KEY}
  OAuth:     Browser flow → wren://auth-callback deep link

Firestore:
  Base URL:  firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents
  Get doc:   GET /{collection}/{docId}
  Set doc:   PATCH /{collection}/{docId}
  Add doc:   POST /{collection}
  Delete:    DELETE /{collection}/{docId}
  Query:     POST :runQuery
  Batch:     POST :batchWrite
  Listen:    POST :listen → Server-Sent Events stream
```

### Firebase Pricing

| Resource | Free tier | Price beyond free | Wren estimate (10K users) |
|----------|-----------|-------------------|--------------------------|
| **Auth** | Unlimited | $0 | **$0** |
| **Firestore reads** | 50K/day | $0.06/100K | 3.5M/mo = **$2.10** |
| **Firestore writes** | 20K/day | $0.18/100K | 2.5M/mo = **$4.50** |
| **Firestore deletes** | 20K/day | $0.02/100K | 2M/mo = **$0.40** |
| **Firestore storage** | 1 GB | $0.18/GB | < 1 GB = **$0** |

---

## Infrastructure Checklist

Before shipping sharing features:

- [ ] Create Firebase project (`wren-sync`)
- [ ] Enable Firebase Auth (email, Google, Apple)
- [ ] Create Firestore database
- [ ] Deploy Firestore security rules
- [ ] Create Cloudflare account
- [ ] Create R2 bucket (`wren-relay`)
- [ ] Set R2 lifecycle rule (7-day auto-delete on `relay/` prefix)
- [ ] Set R2 CORS policy
- [ ] Create R2 API token (read/write, scoped to bucket)
- [ ] Embed R2 + Firebase credentials in app build config
- [ ] Test auth flow end-to-end (email + Google + Apple sign-in)
- [ ] Test R2 upload → presigned URL → download flow
- [ ] Load test: simulate 100 concurrent shares

---

## What Lives Where

| Data | Location | Syncs? |
|------|----------|--------|
| Entry metadata (entry.json) | User's cloud folder (`~/.wren/files/`) | Yes, via iCloud/Dropbox |
| PDFs, markdown, thumbnails | User's cloud folder (`~/.wren/files/`) | Yes, via iCloud/Dropbox |
| SQLite database | `~/.wren/.local.nosync/wren.db` | Never (local cache) |
| Tantivy search index | `~/.wren/.local.nosync/tantivy_index/` | Never (rebuilt per device) |
| LanceDB vector embeddings | `~/.wren/.local.nosync/rag_vectors/` | Never (rebuilt per device, model-dependent) |
| Global metadata | `~/.wren/.sync/collections.json`, etc. | Yes, via iCloud/Dropbox |
| User accounts, sharing | Firebase Firestore | Firebase real-time listeners |
| Shared files in transit | Cloudflare R2 | Temporary, auto-deleted after 7 days |
