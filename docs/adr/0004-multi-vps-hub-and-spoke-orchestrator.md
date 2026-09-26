---
status: accepted
supersedes: partial ADR-0001; complements ADR-0002, ADR-0003
---

# Multi-VPS Hub-and-Spoke Orchestrator with Lightweight Worker Agents

## Context
The bot originally managed and deployed applications to a single host VPS (GCP e2-micro, 1 vCPU, 1 GB RAM). The operator has expanded infrastructure to include an Oracle Cloud VM (1 vCPU, 1 GB RAM) and plans to add further VPS instances in the future.
Running full independent Telegram bot instances on every server introduces Telegram polling conflicts (`409 Conflict: terminated by other getUpdates request`), fragments management, and wastes 150-200 MB RAM per host on bot runtimes. An agentless SSH model would require storing privileged private SSH keys in the bot's environment and incurs substantial command latency.

## Decision
1. **Hub & Spoke Architecture**:
   - The primary VPS (GCP) acts as the **Master Controller**, hosting the single Telegram Bot instance (`@AssistantBot`), Web Dashboard (`bot.thienhn.io.vn`), and Cloudflare DNS management adapter.
   - Secondary and future VPS instances act as **Worker Nodes**, running a standalone, ultra-lightweight REST daemon (`assistant-node-agent` in `agent/`).
   - The worker agent consumes < 25 MB RAM, exposing authenticated REST endpoints for telemetry (`GET /api/metrics`), sandbox lifecycle (`POST /api/deploy`, `POST /api/undeploy`), and remote maintenance (`POST /api/update`).

2. **Pre-Shared Secret Authentication (`X-Agent-Secret`)**:
   - Inter-node communication between Master and Worker Nodes is secured using a configured pre-shared token passed in HTTP/HTTPS headers (`X-Agent-Secret`).
   - Requests without a valid matching secret or non-whitelisted IP/loopback are immediately rejected with HTTP 401/403.

3. **Dynamic Node Registry with Zero-Leakage Hygiene**:
   - Master maintains node topology in `data/nodes.json` (strictly ignored by Git; sample template in `data/nodes.example.json`). Nodes can also be supplied via `NODES_CONFIG` environment variable or dynamically via the authenticated Dashboard / Telegram commands.
   - Public IP addresses of worker nodes are masked on public interfaces (e.g. `Node #2 (Oracle VM)` or `140.***.***.45`) to prevent accidental infrastructure exposure on public repositories.

4. **Dynamic Target Selection and Automated Cloudflare DNS Provisioning**:
   - Deployments allow selecting a specific node target (e.g. `target: 'vps'`, `nodeId: 'oracle-worker'`).
   - The deployment coordinator directs the artifact/payload to the designated node (local sandbox if Master, remote `POST /api/deploy` if Worker).
   - Upon origin confirmation from the selected node, Cloudflare DNS automates creation/update of a proxied `A` record pointing `<subdomain>.thienhn.io.vn` directly to the public IP of that selected node.

5. **Shared Origin CA Wildcard SSL**:
   - All managed VPS nodes reuse the existing Cloudflare Origin CA certificate and private key (`/etc/ssl/certs/cloudflare_cert.pem` and `/etc/ssl/private/cloudflare_key.key`) issued for wildcard `*.thienhn.io.vn`.
   - Nginx configurations generated across any worker node reference this standard path, enabling instant HTTPS without per-host certificate issuance.

6. **Centralized Remote Update (`/update all`)**:
   - Worker agents support safe self-updating via `POST /api/update`. The Master orchestrates updates across all connected nodes, running `git pull origin main` and graceful PM2 reload without requiring SSH sessions.

## Consequences
- Single unified control pane for $N$ servers via Telegram and Web Dashboard.
- Worker nodes conserve RAM (~15-20 MB overhead vs 200 MB), maximizing headroom for deployed static sites and web services.
- Adding a new VPS requires only installing `agent/`, placing SSL certs, and registering the node endpoint with the Master.
- Failure of a single worker node does not impair the Telegram bot or deployments on other nodes.
