# Student Login Support & EduNova Diagnostic Relay

> Production Deployment: [https://student-login-support.vercel.app](https://student-login-support.vercel.app)  
> Admin Console: [https://student-login-support.vercel.app/admin](https://student-login-support.vercel.app/admin)

A unified Node.js/TypeScript service providing authorized student login diagnostics alongside a production-ready **Admin Dashboard with API Key Management**.

---

## 1. Key Features

- **Public Student Diagnostics**: Single-page tool at `/` for student credential lookup and upstream health checks.
- **Admin Dashboard**: Dedicated console at `/admin` for administrators to generate, manage, revoke, and monitor API keys.
- **Secure API Key Lifecycle**:
  - Format: `sk_support_<cryptographically_random_secret>` (256-bit entropy via `crypto.randomBytes`).
  - Stored strictly as **SHA-256 one-way hashes**; secrets are **never** stored in plaintext or logged.
  - One-time reveal upon generation/rotation with one-click clipboard copying.
  - Full lifecycle states: `active`, `disabled`, `revoked` (permanent), `expired`.
  - Configurable optional expiration and per-key rate limits.
- **Durable Database Persistence**:
  - PostgreSQL support (`pg`) via `DATABASE_URL` or `POSTGRES_URL` (compatible with Vercel Postgres, Supabase, Neon, Railway).
  - Automated, idempotent schema initialization (`api_keys` and `api_key_usage`).
  - Seamless in-memory fallback for local development and offline unit tests.
- **Security & Session Management**:
  - Server-validated admin authentication with constant-time password comparisons.
  - Tamper-proof HMAC-SHA256 signed session tokens with CSRF protection on mutating actions.
  - Secure HTTP-only cookies (`SameSite: Lax`, `Secure` in production).
  - Dedicated brute-force rate limiter on `/api/admin/login`.
- **Relay Integration & Usage Accounting**:
  - All diagnostic calls via `POST /api/support/login-diagnostics` validate keys against the database.
  - Per-request latency, HTTP status codes, and timestamps recorded for administrative audit trails.

---

## 2. Architecture Overview

```
[Browser Client / Admin]
       │
       ├── GET  /admin                            -> Admin Dashboard UI
       ├── POST /api/admin/login                  -> Server-validated admin login
       ├── GET  /api/admin/dashboard              -> Aggregate usage & key metrics
       ├── POST /api/admin/keys                   -> Cryptographic key generation
       ├── POST /api/admin/keys/:id/revoke        -> Permanent revocation
       └── POST /api/admin/keys/:id/rotate        -> Atomic rotation
       
[External Applications / Bots]
       │
       │  POST /api/support/login-diagnostics
       │  Headers: x-api-key: sk_support_...
       ▼
[apiKeyAuth Middleware]
       │
       ├── Computes SHA-256 hash of provided key
       ├── Queries PostgreSQL (or in-memory cache)
       ├── Enforces active status, expiration date & rate limits
       └── Asynchronously logs request duration & status to `api_key_usage`
       │
       ▼
[Upstream EduNova / College API]
       │
       └── GET /sims-services/digitalsims/?r=api/v1/App/AppLogin
```

---

## 3. Environment Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Local server port | `4000` |
| `NODE_ENV` | Environment mode (`development`, `production`, `test`) | `development` |
| `UPSTREAM_BASE_URL` | Target college portal URL | `https://edunova.abes.ac.in` |
| `ADMIN_PASSWORD` | **Required in production.** Administrator login password | — |
| `ADMIN_USERNAME` | Administrator username | `admin` |
| `ADMIN_SESSION_SECRET` | 32+ char secret for HMAC session signing | auto-generated in dev |
| `DATABASE_URL` | PostgreSQL connection URI for durable persistence | (in-memory if unset) |
| `REQUIRE_API_KEY` | Set to `true` to require an API key on diagnostic calls | `false` (open in dev) |
| `MD5DECRYPT_API_KEY` | MD5Decrypt API key for plaintext recovery | — |

---

## 4. Admin Dashboard Guide

### 4.1 Logging In
1. Visit `https://student-login-support.vercel.app/admin` (or `http://localhost:4000/admin` locally).
2. Enter the configured `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
3. Upon success, a secure HTTP-only session cookie is set and you are directed to the dashboard.

### 4.2 Generating an API Key
1. Navigate to the **API Keys** tab and click **+ Generate API Key**.
2. Enter the client application or project name (e.g. `Next.js Mobile App`, `Telegram Bot`).
3. Optionally set an expiration window and per-key rate limit.
4. Click **Generate Key**.
5. **Copy your secret key immediately**: The full key (`sk_support_...`) is displayed once in the modal.

### 4.3 Key Management Operations
- **Details**: View key metadata, creation time, expiration, total requests, and recent request logs.
- **Disable / Enable**: Temporarily prohibit or re-allow API requests without invalidating the key.
- **Rotate**: Permanently revokes the existing key and generates a fresh replacement key.
- **Revoke**: Irreversibly marks the key as revoked. External clients will immediately receive HTTP 403 Forbidden.

---

## 5. Client Integration Guide

External clients can call the diagnostic endpoint using either `x-api-key` or `Authorization: Bearer <key>`.

### cURL
```bash
curl -X POST https://student-login-support.vercel.app/api/support/login-diagnostics \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk_support_your_generated_secret_here" \
  -d '{"studentNumber": "9599099932"}'
```

### Node.js / JavaScript (Fetch)
```javascript
const response = await fetch('https://student-login-support.vercel.app/api/support/login-diagnostics', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'sk_support_your_generated_secret_here',
  },
  body: JSON.stringify({ studentNumber: '9599099932' }),
});

const data = await response.json();
console.log(data);
```

### Python (requests)
```python
import requests

url = "https://student-login-support.vercel.app/api/support/login-diagnostics"
headers = {
    "x-api-key": "sk_support_your_generated_secret_here",
    "Content-Type": "application/json"
}
payload = {"studentNumber": "9599099932"}

response = requests.post(url, json=payload, headers=headers)
print(response.json())
```

---

## 6. Vercel Deployment with PostgreSQL

### 1. Add Vercel Postgres / Neon / Supabase
In your Vercel project dashboard:
1. Go to the **Storage** tab and attach a **Postgres** store (or create a free Neon/Supabase DB).
2. Vercel will automatically populate `DATABASE_URL` (or `POSTGRES_URL`).

### 2. Set Environment Variables
In **Project Settings** > **Environment Variables**, set:
- `ADMIN_PASSWORD`: A strong administrator password.
- `ADMIN_SESSION_SECRET`: A 32+ character random string.
- `REQUIRE_API_KEY`: `true` (enforces API key authentication).
- `UPSTREAM_BASE_URL`: `https://edunova.abes.ac.in`

### 3. Deploy
Push to GitHub `darkheroop/student-login-support` on branch `main`. Vercel builds via `npm run build` and deploys seamlessly.

---

## 7. Running Locally & Testing

```bash
# Install dependencies
npm install

# Run tests (76 passing tests covering diagnostics, auth, key lifecycle, rate limiting)
npm test

# Build production bundle
npm run build

# Start local server on port 4000
npm start
```
