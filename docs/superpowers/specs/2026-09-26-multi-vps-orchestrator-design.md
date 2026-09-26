# Multi-VPS Hub-and-Spoke Orchestrator Design

Status: accepted on 2026-09-26. Tracks #51. Complements ADR-0004.

## 1. Goal and Overview

Enable centralized management, telemetry monitoring, and application deployment across multiple VPS instances (GCP Master, Oracle Worker, and future cloud VPSs) through a single Telegram Bot handle and a unified Web Dashboard.

Key guarantees:
1. **Low Overhead**: Worker nodes run a micro-service agent consuming < 25 MB RAM.
2. **Dynamic Topology**: New VPS nodes can be added or removed without restarting Master or redeploying existing services.
3. **Targeted Deployment**: Operators can select any registered VPS node as the deployment target; Cloudflare DNS automatically points the project's subdomain to that specific node's public IP.
4. **Zero-Leakage Security**: Node credentials, IP addresses, and private configuration are isolated from Git tracking and masked on public UI interfaces.
5. **Centralized Maintenance**: Centralized status aggregation and one-touch cluster updates (`/update all`).

---

## 2. Component Architecture

```
                  ┌────────────────────────────────────────┐
                  │          OPERATOR INTERFACES           │
                  │   Telegram Bot    │    Web Dashboard   │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │       MASTER CONTROLLER (GCP VM)       │
                  │  - Telegram Command Dispatcher         │
                  │  - Dashboard API & Static Host         │
                  │  - Node Manager & Registry Store       │
                  │  - Deployment Coordinator              │
                  │  - Cloudflare DNS Adapter              │
                  └───────┬────────────────────────┬───────┘
                          │                        │
         REST / HMAC-Token│       REST / HMAC-Token│
                          ▼                        ▼
     ┌──────────────────────────────┐    ┌──────────────────────────────┐
     │   WORKER NODE 1 (Oracle)     │    │   WORKER NODE N (Future)     │
     │  - assistant-node-agent      │    │  - assistant-node-agent      │
     │  - Nginx Virtual Hosts       │    │  - Nginx Virtual Hosts       │
     │  - Local Sandbox Storage     │    │  - Local Sandbox Storage     │
     │  - Cloudflare Wildcard SSL   │    │  - Cloudflare Wildcard SSL   │
     └──────────────────────────────┘    └──────────────────────────────┘
```

### 2.1 Master Controller (Host: GCP e2-micro)
- Hosts the Telegram Bot polling daemon, Web Dashboard API, and Cloudflare DNS coordinator.
- Manages the Node Registry (`data/nodes.json` / `NODES_CONFIG`).
- Dispatches deploy/undeploy/update operations to appropriate target nodes.

### 2.2 Worker Agent (`agent/server.js`)
- Runs as a lightweight Node.js daemon managed by PM2 (`assistant-node-agent`).
- Operates on a dedicated port (default `3001`).
- Endpoints:
  - `GET /api/health`: Basic liveness check.
  - `GET /api/metrics`: Real-time CPU, RAM, Disk, and Uptime via `systeminformation`.
  - `POST /api/deploy`: Receives zip archive (multipart/octets), extracts to local web directory, creates Nginx virtual host with Cloudflare SSL, reloads Nginx.
  - `POST /api/undeploy`: Removes local project files, deletes Nginx configuration, reloads Nginx.
  - `GET /api/deployments`: Returns list of local deployments.
  - `POST /api/update`: Runs `git pull origin main`, updates dependencies, and schedules graceful PM2 restart.

---

## 3. Security & Authentication

### 3.1 Pre-Shared Secret Authentication
- Every request from Master to Worker must include the HTTP header:
  `X-Agent-Secret: <NODE_AGENT_SECRET>`
- Worker agents reject any request with missing or incorrect secrets using HTTP 401 Unauthorized.
- Timed requests or replay-safe tokens can optionally include timestamp validation.

### 3.2 Secrets Hygiene & IP Masking
- The file `data/nodes.json` is added to `.gitignore`.
- Only `data/nodes.example.json` with RFC-5737 dummy addresses (`192.0.2.1`) is committed to the repository.
- Public views on Web Dashboard (Showcase/Guest mode) mask raw IP addresses and show server aliases (`Node 1 (Master)`, `Node 2 (Oracle Worker)`).
- Authenticated admin views mask the middle octets (e.g., `140.***.***.45`) with a toggle to reveal.

---

## 4. Node Registry Schema

Stored in `data/nodes.json` (or parsed from `NODES_CONFIG`):

```json
[
  {
    "id": "gcp-master",
    "name": "GCP e2-micro (Master)",
    "ip": "104.198.x.x",
    "isLocal": true,
    "status": "online"
  },
  {
    "id": "oracle-worker",
    "name": "Oracle Cloud VM",
    "ip": "140.238.x.x",
    "agentUrl": "http://140.238.x.x:3001",
    "secret": "env:ORACLE_AGENT_SECRET",
    "isLocal": false,
    "status": "online"
  }
]
```

---

## 5. Deployment & DNS Workflow

When an operator deploys a static project:
1. **Target Selection**:
   - The user selects the target node from Telegram inline buttons or Dashboard dropdown.
   - Target options include: `GCP (Local)`, `Oracle Cloud`, `Vercel Cloud`, `Render Cloud`.
2. **Origin Provisioning**:
   - If Master (`gcp-master`): Local `sandbox.deployProject` executes.
   - If Worker (`oracle-worker`): Master streams the zipball to `POST /api/deploy` on the Worker Agent.
   - The worker deploys files to `/home/hnt/web/<project>` (or `/var/www/<project>`), configures Nginx pointing to `/etc/ssl/certs/cloudflare_cert.pem` and `/etc/ssl/private/cloudflare_key.key`, and reloads Nginx.
3. **Cloudflare DNS A-Record Assignment**:
   - Master receives origin confirmation with `{ ok: true, domain: "<project>.thienhn.io.vn" }`.
   - Master invokes Cloudflare API to upsert a proxied `A` record pointing `<project>.thienhn.io.vn` directly to the `ip` of the targeted node.
4. **Registry Recording**:
   - Master records the deployment in `data/deployments.json` with `nodeId: "oracle-worker"` and `dnsRecordId`.

---

## 6. Centralized Telemetry & Maintenance

1. **`/status` Command**:
   - Master queries local metrics and parallel queries `GET /api/metrics` across all registered nodes.
   - Renders a multi-node status report:
     ```
     🖥️ BÁO CÁO CỤM MÁY CHỦ (MULTI-VPS)

     • Node 1: GCP Master (104.***)
       CPU: 12% | RAM: 450 MB / 980 MB (45%) | Disk: 14 GB trống

     • Node 2: Oracle Cloud (140.***)
       CPU: 4% | RAM: 320 MB / 980 MB (32%) | Disk: 38 GB trống
     ```
2. **`/update all` Command**:
   - Triggers local update on Master and fans out `POST /api/update` to all worker nodes.
   - Consolidates output and reports commit status per node to the operator.
