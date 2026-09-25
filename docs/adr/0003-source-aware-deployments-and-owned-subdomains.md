---
status: accepted
supersedes: ADR-0001 decisions 1-3; complements ADR-0002
---

# Route each deployment through its source and owned subdomain

## Context

ADR-0001 proposed wildcard DNS, ZIP-to-Vercel, and GitHub-to-cloud deployment. The current GCP VM has only 1 vCPU and 1 GB RAM; the operator can SCP prebuilt ZIPs to it. Existing cloud adapters can report success without creating or verifying a working website. Removing a website must remove its own subdomain without affecting a manually managed DNS record.

## Decision

The GCP/VPS path accepts only an operator-built, locally staged **static ZIP** in v1, executes no package code on the 1 GB VM, and uses a deployment-owned, proxied Cloudflare A record. Legacy Node backends may be listed and safely removed but cannot be newly deployed in v1. Vercel and Render paths accept a public GitHub repository at an explicitly confirmed commit SHA and use a deployment-owned, DNS-only CNAME. Telegram and dashboard share the same deploy/redeploy/remove coordinator; dashboard selects an already-SCPed ZIP or accepts a GitHub URL, without browser ZIP upload. Framework inspection proposes a target; the operator confirms. Unclear projects stop for configuration. A new deployment becomes `online` only after real origin deployment, provider/domain readiness, DNS, TLS, and an HTTP 2xx/3xx health check. A duplicate name is rejected; updates use separate rollback-capable redeploy. Deletion removes only recorded, verified provider resources and DNS IDs, retaining retry state on partial failure. Automatic paid resources and automatic Git-push redeploy are excluded.

## Consequences

The bot needs a shared durable lifecycle coordinator, exact DNS ownership, provider-specific deployment and readiness adapters, safe ZIP staging, and a confirmation flow bound to a Git commit. Public-repository pinned-SHA API support is a feasibility gate, not an assumption: Vercel Git import has repository-access requirements and Render's initial service creation can build branch head before a pinned manual deploy. If those limits prevent the agreed behavior, the product choice must be revisited. This supersedes ADR-0001's wildcard and ZIP-to-Vercel choices and the earlier automatic collision-suffix proposal. The pending ADR-0002 remains the detailed VPS DNS ownership rule. Existing port-only sites require explicit migration; this ADR does not authorize live DNS changes.
