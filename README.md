# Student Login Support — Admin Diagnostic Web Application

> **Authorized Environment Only.** Production-quality administrative diagnostics web application designed for authorized educational login-support staff. Allows support personnel to enter a student's mobile number and observe the authorized upstream application's full request/response diagnostics flow through a secure backend proxy layer.

---

## 1. System Architecture & Workflow

```
[Support Staff Web Browser]
         │ (HTTP-only session cookie 'ssid')
         ▼
[React 18 + TypeScript + Vite Dashboard]
         │ POST /api/support/login-diagnostics { "mobile": "+91 98765 43210" }
         ▼
[Express Security Middleware]
  - Helmet (Strict Security Headers)
  - CORS (Configured Origin Only)
  - Rate Limiting (General & Auth-specific)
  - RequireAuth (Database Session Verification)
  - Zod Request Schema Validation
         │
         ▼
[Diagnostics Service & Proxy Layer]
  - Isolates Upstream Integration (No Browser-Supplied URLs / SSRF Prevention)
  - Enforces Configured Timeouts
  - Captures Request Metadata & Timestamps
  - Executes Authorized Upstream Steps:
      1. POST /authorized/login-support
      2. POST /authorized/verification-state
      3. GET  /authorized/status/:mobile
  - Bounded Empty-Response Retries (SUPPORT_RETRY_COUNT, SUPPORT_RETRY_DELAY_MS)
  - Preserves Upstream JSON/Text as Opaque Data (Never Crashes on Schema Variations)
  - Redacts Sensitive Credentials (Passwords, OTPs, PINs, Tokens, Secrets)
         │
         ├──► [SQLite Database (Built-in node:sqlite)]
         │      - admins (bcrypt hashed)
         │      - sessions (TTL expiration)
         │      - diagnostic_runs
         │      - diagnostic_events (opaque bodies)
         │      - audit_logs (masked student mobile numbers)
         │
         ▼
[Authorized Upstream Service] (Configured via UPSTREAM_BASE_URL)
```

---

## 2. Project Directory Structure

```
student-login-support/
├── package.json                         # Root workspace configuration & unified scripts
├── README.md                            # Complete architecture and operational guide
├── client/                              # Frontend React application
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx                     # React 18 bootstrap
│       ├── App.tsx                      # App router & authenticated route guards
│       ├── api/
│       │   ├── client.ts                # Axios instance with credentials & 401 handling
│       │   ├── auth.ts                  # Login, logout, session verification
│       │   └── diagnostics.ts           # Diagnostic submission client
│       ├── contexts/
│       │   └── AuthContext.tsx          # Authentication state provider
│       ├── pages/
│       │   ├── LoginPage.tsx            # Admin login interface
│       │   └── DashboardPage.tsx        # Main student login support dashboard
│       ├── components/
│       │   ├── DiagnosticTimeline.tsx   # Request/response timeline with stages
│       │   ├── JsonViewer.tsx           # Searchable, syntax-highlighted, redacted JSON tree
│       │   ├── StatusBadge.tsx          # HTTP status pill badges
│       │   └── LoadingSpinner.tsx       # CSS SVG loading indicator
│       ├── hooks/
│       │   └── useDiagnostics.ts        # Diagnostics execution & session history
│       ├── types/
│       │   └── index.ts                 # Frontend TypeScript contracts
│       └── styles/
│           └── global.css               # Clean administrative dark-slate styling
│
└── server/                              # Backend Express application
    ├── package.json
    ├── tsconfig.json
    ├── .env.example                     # Environment template
    ├── .env                             # Active environment configuration
    ├── data/
    │   └── support.db                   # SQLite database (auto-initialized)
    └── src/
        ├── server.ts                    # HTTP server entry point & graceful shutdown
        ├── app.ts                       # Express application wiring & middleware
        ├── config.ts                    # Typed env validation (strict upstream target)
        ├── database/
        │   └── db.ts                    # SQLite initialization via built-in node:sqlite
        ├── routes/
        │   ├── health.ts                # GET /api/health
        │   ├── auth.ts                  # POST /login, POST /logout, GET /me
        │   └── support.ts               # POST /login-diagnostics
        ├── services/
        │   ├── diagnosticsService.ts    # Multi-step authorized diagnostic workflow
        │   └── upstreamProxy.ts         # Secure proxy layer, SSRF checks, retries
        ├── middleware/
        │   ├── auth.ts                  # Session cookie authentication guard
        │   ├── rateLimit.ts             # API and login rate limiters
        │   └── errorHandler.ts          # Safe error formatting without stack traces
        ├── security/
        │   └── redactSecrets.ts         # Deep credential redaction & mobile masking
        ├── types/
        │   └── diagnostics.ts           # Backend TypeScript models
        ├── utils/
        │   └── logger.ts                # Structured Pino logging
        └── __tests__/
            ├── setup.ts                 # Test harness (nock loopback allowance)
            ├── diagnostics.test.ts      # 21 integration & proxy tests
            └── redactSecrets.test.ts    # Security redaction & mobile masking tests
```

---

## 3. Environment Configuration

Create or update `server/.env` with the following variables:

```ini
# Server Configuration
PORT=4000
NODE_ENV=development

# Session Configuration (Must be at least 32 characters in production)
SESSION_SECRET=change-me-to-a-random-secret-at-least-32-chars
COOKIE_MAX_AGE_MS=3600000

# CORS Configuration (Allowed frontend origin)
CORS_ORIGIN=http://localhost:5173

# Authorized Upstream Service (REQUIRED - The application communicates ONLY with this target)
UPSTREAM_BASE_URL=https://authorized-student-portal.internal.edu
UPSTREAM_TIMEOUT_MS=15000
SUPPORT_RETRY_COUNT=3
SUPPORT_RETRY_DELAY_MS=1500

# Rate Limiting Configuration
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30
LOGIN_RATE_LIMIT_MAX=10
```

> **Strict Upstream Validation:** The server will refuse to start if `UPSTREAM_BASE_URL` is empty, invalid, or specifies a protocol other than `http:` or `https:`. No demo mode or fallback mock server is permitted in production or development.

---

## 4. Default Admin Credentials

Upon initial startup, the database automatically initializes tables and seeds the default administrator account:

- **Username:** `admin`
- **Password:** `Admin@123!`
- **Role:** `admin`

---

## 5. Exact Installation Commands

From the root project directory (`student-login-support`):

```bash
# Install root, server, and client dependencies
npm install
npm install --workspace=server
npm install --workspace=client
```

---

## 6. Exact Development Commands

To run both backend and frontend concurrently in a single terminal:

```bash
npm run dev
```

Or run each service in separate terminals:

```bash
# Terminal 1: Backend API (Port 4000)
npm run dev:server

# Terminal 2: Frontend Dashboard (Port 5173)
npm run dev:client
```

Open **http://localhost:5173** in your web browser.

---

## 7. Exact Production Build Commands

To compile TypeScript and bundle both client and server:

```bash
# Build both services
npm run build
```

To run the compiled production server:

```bash
npm run start
```

---

## 8. Exact Automated Testing Commands

To run the complete automated test suite (Jest + Supertest + Nock):

```bash
npm run test
```

Or with test coverage reporting:

```bash
cd server && npm run test:coverage
```

### What the Test Suite Verifies:
1. **Valid mobile numbers:** Validates format and executes diagnostic flow.
2. **Invalid mobile numbers:** Rejects invalid formats with HTTP 400.
3. **Authentication:** Rejects unauthenticated requests with HTTP 401.
4. **Session verification:** Validates active session cookies against the database.
5. **Request forwarding & response capture:** All 3 workflow steps executed.
6. **Bounded empty-response retries:** Retries when body is empty up to `SUPPORT_RETRY_COUNT`.
7. **Retry exhaustion:** Returns HTTP 502 with `EMPTY_UPSTREAM_RESPONSE` after configured limit.
8. **Malformed JSON handling:** Plain-text and HTML error bodies captured safely without crashing.
9. **Upstream HTTP 5xx responses:** Handled gracefully as opaque diagnostic events.
10. **Upstream timeouts:** Captured cleanly as `UPSTREAM_TIMEOUT` events.
11. **SSRF protection:** Rejects non-allowlisted HTTP methods and upstream paths.
12. **Credential redaction:** Redacts passwords, OTPs, PINs, tokens, and secrets deeply in objects/arrays.
13. **Mobile number masking:** Masks all but the last 4 digits in audit logs (`******3210`).
14. **Database persistence:** Verifies records in `diagnostic_runs`, `diagnostic_events`, and `audit_logs`.
15. **Health check:** Verifies `GET /api/health` returns `{ status: 'ok', service: 'student-support' }`.

---

## 9. Security Implementation Details

- **No SSRF / No Open Proxy:** The client cannot supply arbitrary target URLs. The backend forwards requests exclusively to allowlisted endpoints on the server-configured `UPSTREAM_BASE_URL`.
- **Zero Credentials to Browser:** Upstream credentials, authorization tokens, and API secrets are never transmitted to or accessible by the client application.
- **Deep Redaction:** The response payload returned to the browser has all sensitive fields (passwords, tokens, OTPs, PINs) redacted as `[REDACTED]` while preserving arbitrary JSON structures intact.
- **Audit Logging:** Every diagnostic run writes an immutable audit record with masked student phone numbers (`******9932`). Plaintext student numbers and credentials are never written to audit logs.
- **HTTP-Only Cookies:** Sessions are maintained via secure, HTTP-only, SameSite=Strict cookies with server-side database backing and configurable TTL expiration.
- **Node.js Built-in SQLite:** Uses native `node:sqlite` (`DatabaseSync`), requiring zero external native C++ compilers, python, or node-gyp build dependencies.
