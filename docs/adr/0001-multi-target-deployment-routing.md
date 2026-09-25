# Multi-Target Deployment and Subdomain Routing Strategy

> Superseded by ADR-0003 for deployment sources, targets, and DNS routing. Do not use the wildcard or ZIP-to-Vercel rules below for new work.

## Context
The bot originally deployed applications only to the local VPS using incremental port numbers (`http://<ip>:<port>`), lacking SSL and requiring manual firewall management. The user requested automatic subdomain provisioning using their domain `thienhn.io.vn` managed on Cloudflare, along with support for external deployment targets (Vercel and Render), multi-source inputs (ZIP archives and public GitHub repositories), and a unified Vue 3 web dashboard.

## Decision
1. **VPS Subdomain Routing via Wildcard DNS**: 
   A single Wildcard `A` record (`*.thienhn.io.vn`) points to the VPS IP. Local deployments automatically receive subdomains (`<project>.thienhn.io.vn`) served through Nginx Virtual Hosts on port 80/443 without invoking Cloudflare APIs.
2. **External Target Routing via Cloudflare CNAME API**: 
   Deployments to Vercel or Render dynamically register explicit CNAME records in Cloudflare DNS pointing to `cname.vercel-dns.com` or `<service>.onrender.com`. In accordance with DNS standards (RFC 1034), these explicit CNAMEs override the VPS wildcard for that specific subdomain.
3. **Deployment Matrix by Source**: 
   - Uploaded ZIP files can deploy to either **VPS** or **Vercel**.
   - Public GitHub URLs can deploy to **Vercel** or **Render**, but explicitly cannot deploy directly to VPS.
4. **Dynamic Feature Flags**: 
   Provider tokens (`CLOUDFLARE_API_TOKEN`, `VERCEL_TOKEN`, `RENDER_API_KEY`) are optional; the bot inspects environment variables on startup and enables only targets whose credentials are provided.
5. **Dashboard Architecture & Security**: 
   A lightweight Vue 3 SPA served under `dashboard.thienhn.io.vn` communicates with an authenticated local API guarded by a configured `DASHBOARD_SECRET_KEY`.

## Consequences
- Requires Cloudflare API credentials only when provisioning or tearing down external (Vercel/Render) deployments.
- Avoids external API calls and token dependencies for standard VPS deployments.
- Centralizes application lifecycle in a unified deployment registry.
