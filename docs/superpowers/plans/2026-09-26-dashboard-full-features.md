# Web Dashboard Full Feature Parity & Metrics Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring complete command & operational feature parity from Telegram bot to the Web Dashboard (`https://bot.thienhn.io.vn/`) with real-time Chart.js CPU/RAM metrics charts, diagnostic viewers (/ps, /logs), operations hub (/restart, /update, /cleancache, /sh), 1-click perf & undeploy, and notes manager with zero UI animation and responsive design.

**Architecture:** Extend `services/dashboardApi.js` with authenticated endpoints backed by Google OAuth session tokens (`/api/processes`, `/api/logs`, `/api/cleancache`, `/api/restart`, `/api/update`, `/api/sh`, `/api/perf`, `/api/notes`). In `dashboard/index.html`, integrate Chart.js (`animation: false`), multi-node metric charts, interactive modals for processes/logs/perf/undeploy, operations control hub with terminal output, and notes manager.

**Tech Stack:** Node.js (http, child_process, crypto, fs), systeminformation, Chart.js (CDN), Vue 3, Tailwind CSS (dark mode), Cloudflare DNS API.

**Spec:** Issue #69 / Architectural Proposal approved by user.

## Global Constraints

- Zero-Leakage Secrets Hygiene: No raw credentials or unmasked IPs in code, logs, or commits.
- Zero Animation Rule: Dashboard charts and UI components must have animations disabled (`animation: false`).
- Performance: Lightweight (< 200MB RAM cap on GCP Master, < 100MB on Oracle Worker).
- Strict Test Gate: 100% test pass rate with unit tests covering all new endpoints (`npm run check:syntax` & `npm test`).
- Multi-VPS Cluster Routing: Support both local GCP Master and remote worker nodes via `lib/nodeManager.js` and `lib/nodeClient.js`.

---

### Task 1: Backend Diagnostic Endpoints (/api/processes and /api/logs)

**Files:**
- Modify: `services/dashboardApi.js`
- Test: `test/dashboard_full_features.test.js`

**Interfaces:**
- Consumes: `nodeManager.getNode`, `nodeClient.getProcesses`, `nodeClient.getLogs`, `si.processes`, `readLastLines`.
- Produces:
  - `GET /api/processes?nodeId=<id>`: returns `{ ok: true, node: { id, name }, processes: [...] }`.
  - `GET /api/logs?nodeId=<id>&lines=<count>`: returns `{ ok: true, node: { id, name }, logs: "..." }`.

- [ ] **Step 1: Write failing test in `test/dashboard_full_features.test.js`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `/api/processes` and `/api/logs` in `services/dashboardApi.js`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit `feat: add processes and logs endpoints to dashboard api (#69)`**

---

### Task 2: Backend Operations Endpoints (/api/cleancache, /api/restart, /api/update, /api/sh)

**Files:**
- Modify: `services/dashboardApi.js`
- Test: `test/dashboard_full_features.test.js`

**Interfaces:**
- Consumes: `nodeManager`, `nodeClient`, `whitelist`, `runner`.
- Produces:
  - `POST /api/cleancache`: body `{ nodeId }` -> triggers cache clean locally or remotely.
  - `POST /api/restart`: body `{ nodeId }` -> restarts PM2 process locally or worker remotely.
  - `POST /api/update`: body `{ nodeId }` -> runs git pull + npm install + restart, returns step outputs.
  - `POST /api/sh`: body `{ command, nodeId }` -> validates against whitelist and executes, returns terminal output.

- [ ] **Step 1: Write failing tests for operations endpoints in `test/dashboard_full_features.test.js`**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement operations routes in `services/dashboardApi.js`**
- [ ] **Step 4: Run test to verify pass**
- [ ] **Step 5: Commit `feat: add operations endpoints to dashboard api (#69)`**

---

### Task 3: Backend Performance & Notes Endpoints (/api/perf and /api/notes)

**Files:**
- Modify: `services/dashboardApi.js`
- Test: `test/dashboard_full_features.test.js`

**Interfaces:**
- Consumes: `lib/perf.js` (`measureHttpLatency`, `fetchPageSpeedScore`), `notesFilePath`, `commands/perf.js` (`resolveTargetUrl`).
- Produces:
  - `POST /api/perf`: body `{ target }` -> returns `{ ok: true, result: { targetUrl, latency, pageSpeed } }`.
  - `GET /api/notes`: returns `{ ok: true, notes: [...] }`.
  - `POST /api/notes`: body `{ text }` -> appends note and returns `{ ok: true }`.
  - `DELETE /api/notes`: clears `notes.txt` and returns `{ ok: true }`.

- [ ] **Step 1: Write failing tests for perf and notes in `test/dashboard_full_features.test.js`**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement `/api/perf` and `/api/notes` routes in `services/dashboardApi.js`**
- [ ] **Step 4: Run test to verify pass**
- [ ] **Step 5: Commit `feat: add perf and notes endpoints to dashboard api (#69)`**

---

### Task 4: Frontend UI - Real-time Metrics Charts (Chart.js) & Diagnostic Modals

**Files:**
- Modify: `dashboard/index.html`

**Interfaces:**
- Consumes: Chart.js CDN, `/api/status`, `/api/processes`, `/api/logs`.
- Produces:
  - Real-time CPU & RAM line charts per node in Telemetry tab (`animation: false`).
  - Processes viewer modal (`/ps`) with node switcher.
  - PM2 logs viewer modal (`/logs`) with line count selector (20, 50, 100).

- [ ] **Step 1: Include Chart.js script tag in `dashboard/index.html`**
- [ ] **Step 2: Add Chart.js state, canvas elements, and rendering logic with `animation: false`**
- [ ] **Step 3: Build Processes Modal with reactive table and refresh button**
- [ ] **Step 4: Build PM2 Logs Modal with dark terminal styled box and line filter**
- [ ] **Step 5: Verify syntax and formatting**
- [ ] **Step 6: Commit `feat: add real-time metrics charts and diagnostic modals to dashboard (#69)`**

---

### Task 5: Frontend UI - Operations Hub, 1-Click Perf & Undeploy, Notes Manager

**Files:**
- Modify: `dashboard/index.html`

**Interfaces:**
- Consumes: `/api/cleancache`, `/api/restart`, `/api/update`, `/api/sh`, `/api/perf`, `/api/notes`, `/api/deployments/undeploy`.
- Produces:
  - 1-Click Perf test modal in Deployments tab with detailed latency & Google PageSpeed scores.
  - 1-Click Undeploy confirmation modal with project name validation.
  - Operations tab in Dashboard:
    - Quick Action cards: Restart PM2, Clean Cache, Git Update with live terminal log box.
    - Web Whitelisted Shell Terminal (`/sh`): alias selector, custom args, target node dropdown, interactive console output.
  - Notes Manager tab: interactive notes list, add note form, clear notes button with confirmation.

- [ ] **Step 1: Implement 1-Click Perf modal and Undeploy confirmation in Deployments view**
- [ ] **Step 2: Implement Operations Hub tab (Restart, Update, Cleancache, Web Terminal /sh)**
- [ ] **Step 3: Implement Notes Manager tab in Dashboard**
- [ ] **Step 4: Update `package.json` syntax & test scripts to include all new tests**
- [ ] **Step 5: Verify all verification commands pass (`npm run check:syntax`, `npm test`)**
- [ ] **Step 6: Commit `feat: add operations hub, 1-click actions and notes manager to dashboard UI (#69)`**

---

### Task 6: End-to-End Verification & Production Deployment

**Files:**
- Local verification
- Remote verification on GCP Master (`34.10.66.133`)

- [ ] **Step 1: Run full test suite and check:syntax locally**
- [ ] **Step 2: Push branch `feat/69-dashboard-full-features` and open PR**
- [ ] **Step 3: Squash & merge PR into `main`**
- [ ] **Step 4: Pull `main` on GCP Master and restart PM2**
- [ ] **Step 5: Smoke test `https://bot.thienhn.io.vn/` live**
