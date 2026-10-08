# Student Login Support — Single-Page Workflow Application

> **Authorized Environment Only.** A simple, unified single-service web application for authorized student login diagnostics.

---

## 1. Single Workflow & Single Service

The entire application runs as **one combined Node.js service** with zero separate client/server split:

```text
OPEN WEBSITE
     ↓
ENTER STUDENT NUMBER
     ↓
CLICK "CHECK LOGIN STATUS"
     ↓
BACKEND EXECUTES 3-STEP UPSTREAM WORKFLOW
     ↓
DISPLAY ACTUAL DIAGNOSTIC RESULTS
```

---

## 2. Combined Architecture

```
[Browser Client]
       │
       │  POST /api/support/login-diagnostics { "mobile": "+91 98765 43210" }
       ▼
[Unified Express Application (Single Process / Single Port)]
       │
       ├── Static File Serving (`public/` -> index.html, style.css, app.js)
       ├── Zod Mobile Validation (7–20 digits)
       ├── Helmet & CORS Security Headers
       ├── Rate Limiting
       ├── SSRF Prevention (Strict allowlist of authorized paths)
       ├── Configured Timeouts & Bounded Retries
       │
       ▼
[Authorized Upstream Service] (Configured via UPSTREAM_BASE_URL)
       │
       ├── 1. POST /authorized/login-support
       ├── 2. POST /authorized/verification-state
       └── 3. GET  /authorized/status/:mobile
       │
       ▼
[Opaque Payload Capture & Deep Redaction]
       │  (Preserves arbitrary JSON/Text; redacts passwords/OTPs/tokens)
       ▼
[Single-Page Frontend Update]
       │  (Real-time results card with expandable timeline & JSON inspector)
       ▼
[Actual Diagnostic Result Displayed]
```

### Key Architectural Highlights
- **Single Combined Project**: No separate `client` and `server` folders, no npm workspaces. Only ONE service is detected and deployed by Railway.
- **Pure Stateless Execution**: No database (no SQLite, Postgres, MySQL, or ORM). Zero storage overhead.
- **No Login / Admin Separation**: Direct single-page interface without confusing auth barriers or separate portals.
- **No Demo / Mock Mode**: Real requests execute against the authorized upstream service defined by `UPSTREAM_BASE_URL`.
- **Deep Redaction**: Passwords, OTPs, PINs, auth tokens, and session secrets are automatically redacted from payloads before reaching the browser.

---

## 3. Repository Structure

```
student-login-support/
├── package.json               # Single root package.json (build & start scripts)
├── railway.json               # Railway single-service deployment configuration
├── tsconfig.json              # TypeScript compilation configuration
├── README.md                  # Complete architecture and operational guide
├── public/                    # Single-page frontend assets (served statically by Express)
│   ├── index.html             # Clean, minimal single-page HTML layout
│   ├── style.css              # Modern responsive dark-slate styling
│   └── app.js                 # Interactive diagnostic controller & JSON tree viewer
└── src/                       # Backend TypeScript source
    ├── server.ts              # Express application entry point & static file hosting
    ├── config.ts              # Strict typed environment validation
    ├── types/                 # TypeScript interfaces
    ├── middleware/            # Rate limiting & error handling
    ├── security/              # Deep credential redaction & mobile masking
    ├── services/              # Upstream proxy layer & diagnostic coordinator
    └── __tests__/             # Comprehensive integration and security test suites
```

---

## 4. Environment Variables

Configure these in Railway (or in local `.env`):

```ini
PORT=4000
NODE_ENV=production
CORS_ORIGIN=*

# Authorized Upstream Service (REQUIRED)
UPSTREAM_BASE_URL=https://authorized-student-portal.internal.edu
UPSTREAM_TIMEOUT_MS=15000
SUPPORT_RETRY_COUNT=3
SUPPORT_RETRY_DELAY_MS=1500

# Rate Limiting Configuration
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
```

---

## 5. Development & Testing Commands

### Install Dependencies
```bash
npm install
```

### Run Locally (Development)
```bash
npm run dev
```
Open **http://localhost:4000** in your browser.

### Run Automated Tests
```bash
npm test
```

### Production Build & Run
```bash
npm run build
npm run start
```

---

## 6. Railway Deployment

1. On [Railway](https://railway.app), open your project connected to GitHub: `darkheroop/student-login-support`.
2. Delete any extra/crashed client service if Railway previously created one.
3. Railway will detect the single root `package.json` and build:
   - **Build Command**: `npm run build` (`tsc`)
   - **Start Command**: `npm run start` (`node dist/server.js`)
4. Add the `UPSTREAM_BASE_URL` environment variable under the service Settings.
5. Exactly **ONE** service will build and deploy successfully without crashing.
