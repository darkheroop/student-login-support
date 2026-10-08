# Student Login Support — Single-Page Workflow Website

> **Authorized Environment Only.** A simple, fast, and production-ready single-page web application for authorized student login diagnostics.

---

## 1. Core User Experience

The application follows an ultra-clean, minimal workflow:

```text
OPEN WEBSITE
     ↓
SIMPLE PAGE
     ↓
ENTER NUMBER
     ↓
CLICK SUBMIT / PROCESS
     ↓
SYSTEM PROCESSES THE NUMBER
     ↓
SHOW THE ACTUAL RESULT
```

---

## 2. Architecture & Design Principles

```
[User Browser]
       │
       │  POST /api/support/login-diagnostics { "mobile": "+91 98765 43210" }
       ▼
[Express Backend API / Proxy Layer]
       │
       ├── Zod Input Validation (7-20 digit phone format)
       ├── Rate Limiting & Helmet Security Headers
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

### Key Highlights
- **Completely Stateless:** No database (no PostgreSQL, SQLite, MySQL, or ORM). Zero storage overhead.
- **No Login / Admin Separation:** Direct single-page interface without confusing auth barriers or separate portals.
- **No Demo / Mock Mode:** Real requests execute against the authorized upstream service defined by `UPSTREAM_BASE_URL`.
- **Deep Redaction:** Passwords, OTPs, PINs, auth tokens, and session secrets are automatically redacted from payloads before reaching the browser.
- **Single Service Production Ready:** Optimized for single-command production serving (Node Express serves Vite static build with SPA fallback).

---

## 3. Project Directory Structure

```
student-login-support/
├── package.json                         # Unified workspace configuration & scripts
├── railway.json                         # Railway deployment configuration (Nixpacks)
├── README.md                            # Operational guide and architecture
├── client/                              # Minimalist React 18 single-page application
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx                     # Entry point
│       ├── App.tsx                      # Single-page wrapper
│       ├── pages/
│       │   └── DashboardPage.tsx        # Focused single-page workflow (Input -> Process -> Result)
│       ├── components/
│       │   ├── DiagnosticTimeline.tsx   # Request/response event timeline
│       │   ├── JsonViewer.tsx           # Searchable, syntax-highlighted opaque JSON inspector
│       │   ├── StatusBadge.tsx          # HTTP status badges
│       │   └── LoadingSpinner.tsx       # CSS SVG loading indicator
│       ├── api/
│       │   ├── client.ts                # Axios instance
│       │   └── diagnostics.ts           # Diagnostic submission client
│       └── styles/
│           └── global.css               # Clean dark-slate single-page styles
│
└── server/                              # Express stateless backend
    ├── package.json
    ├── .env.example                     # Environment template
    └── src/
        ├── server.ts                    # HTTP server entry point & graceful shutdown
        ├── app.ts                       # Express setup & static client hosting
        ├── config.ts                    # Strict typed environment validation
        ├── routes/
        │   ├── health.ts                # GET /api/health
        │   └── support.ts               # POST /api/support/login-diagnostics
        ├── services/
        │   ├── diagnosticsService.ts    # Pure stateless upstream diagnostic coordinator
        │   └── upstreamProxy.ts         # Secure HTTP proxy layer with SSRF checks & retries
        ├── security/
        │   └── redactSecrets.ts         # Deep credential redaction & phone masking
        └── __tests__/
            ├── diagnostics.test.ts      # Comprehensive proxy & integration tests
            └── redactSecrets.test.ts    # Security redaction unit tests
```

---

## 4. Environment Variables

Create or configure `server/.env` (or set environment variables in Railway):

```ini
# Server Configuration
PORT=4000
NODE_ENV=production

# CORS Configuration
CORS_ORIGIN=*

# Authorized Upstream Service (REQUIRED - The application communicates ONLY with this target)
UPSTREAM_BASE_URL=https://authorized-student-portal.internal.edu
UPSTREAM_TIMEOUT_MS=15000
SUPPORT_RETRY_COUNT=3
SUPPORT_RETRY_DELAY_MS=1500

# Rate Limiting Configuration
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
```

> **Strict Upstream Validation:** The server validates `UPSTREAM_BASE_URL` on startup and refuses to start if it is missing or invalid.

---

## 5. Development & Testing Commands

### Install Dependencies
```bash
npm install
npm install --workspace=server
npm install --workspace=client
```

### Run Locally (Development)
```bash
npm run dev
```
Open **http://localhost:5173** to view the application with hot module reloading.

### Run Automated Tests
```bash
npm test
```
Executes Jest for backend tests and Vitest for frontend unit tests.

### Production Build
```bash
npm run build
```

### Production Run
```bash
npm run start
```
Starts the Express server on port `4000`, serving the compiled React frontend statically.

---

## 6. Railway Deployment Guide

1. **Connect GitHub Repository** on [Railway](https://railway.app).
2. **Environment Variables**: Add your `UPSTREAM_BASE_URL` (e.g. `https://your-authorized-upstream.edu`).
3. Railway automatically detects `railway.json`:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start`
4. The deployment will build both server and client, and serve the unified application on the Railway-assigned domain.
