# Dev Assistant Bot

Personal Telegram devops assistant for managing, deploying, and monitoring services across VPS, Vercel, and Render.

## Language

**Deployment Target**:
The infrastructure platform where a project is deployed and executed (`vps`, `vercel`, or `render`).
_Avoid_: Hosting environment, cloud provider.

**Deployment Source**:
The origin package or repository containing project code (`zip_upload` staged on GCP or `github_public` pinned to a commit). A ZIP is not a cloud deployment source in v1.
_Avoid_: Artifact, code source.

**Deployment Candidate**:
An inspected public GitHub repository at a resolved branch, commit SHA, and application root, with a proposed target and domain; it is not a deployment until the operator confirms it.
_Avoid_: Automatic deployment, detected app.

**Subdomain Routing**:
The DNS resolution strategy directing traffic for `<project>.thienhn.io.vn` through a deployment-owned Cloudflare `A` record for VPS or `CNAME` record for Vercel/Render.
_Avoid_: URL redirect, domain mapping.

**Owned DNS Record**:
A Cloudflare DNS record whose exact ID, hostname, and type are recorded in the Deployment Registry for one deployment.
_Avoid_: Any record with the same hostname.

**Deployment Registry**:
The persistent store recording each deployment's source revision, target platform, subdomain, provider resource IDs, owned DNS record, lifecycle status, and backend-only internal port when applicable.
_Avoid_: App list, deployment database.

**Deployment Readiness**:
The observed condition that a real origin deployment, custom domain, DNS, TLS, and HTTP health check have all succeeded. Provider project creation alone is not readiness.
_Avoid_: Project created, DNS exists.

**Redeploy**:
A separately confirmed replacement of an existing deployment that preserves the previous working release until the candidate is verified and can roll back if verification fails.
_Avoid_: Duplicate deploy, overwrite.

**Dashboard**:
A lightweight Vue 3 single-page application providing a visual overview and control panel for all deployments and server health.
_Avoid_: Admin panel, control web.

**Dashboard Secret**:
A shared token configured in environment variables to authorize management actions performed on the Dashboard.
_Avoid_: Admin password, login key.

**Feature Flag**:
A dynamic capability switch determined at runtime based on the availability of target provider credentials.
_Avoid_: Configuration toggle, option switch.
