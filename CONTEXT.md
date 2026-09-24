# Dev Assistant Bot

Personal Telegram devops assistant for managing, deploying, and monitoring services across VPS, Vercel, and Render.

## Language

**Deployment Target**:
The infrastructure platform where a project is deployed and executed (`vps`, `vercel`, or `render`).
_Avoid_: Hosting environment, cloud provider.

**Deployment Source**:
The origin package or repository containing project code (`zip_upload` or `github_public`).
_Avoid_: Artifact, code source.

**Subdomain Routing**:
The DNS resolution strategy directing traffic for `<project>.thienhn.io.vn` through Cloudflare to the matching target (Wildcard `A` record for VPS, dynamic `CNAME` for Vercel/Render).
_Avoid_: URL redirect, domain mapping.

**Deployment Registry**:
The persistent store recording all deployed services, their target platform, assigned port/subdomain, and lifecycle status.
_Avoid_: App list, deployment database.

**Dashboard**:
A lightweight Vue 3 single-page application providing a visual overview and control panel for all deployments and server health.
_Avoid_: Admin panel, control web.

**Dashboard Secret**:
A shared token configured in environment variables to authorize management actions performed on the Dashboard.
_Avoid_: Admin password, login key.

**Feature Flag**:
A dynamic capability switch determined at runtime based on the availability of target provider credentials.
_Avoid_: Configuration toggle, option switch.
