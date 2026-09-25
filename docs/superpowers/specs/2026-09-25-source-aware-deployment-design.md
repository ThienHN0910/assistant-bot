# Source-aware deployment across GCP, Vercel, and Render

Status: amended design accepted on 2026-09-25 after the operator confirmed static-only GCP and dashboard parity; cloud deployment remains subject to provider feasibility gate #39. Tracks #38. **Implementation and live infrastructure changes remain deferred until an implementation plan is reviewed.**

## Goal and boundaries

Every managed website has one explicit `https://<name>.thienhn.io.vn` address, one Deployment Source, one Deployment Target, and a retryable lifecycle recorded in the Deployment Registry. The bot must never say a website is online merely because a provider project, service, or DNS record was created.

The GCP VM is the existing VPS (1 vCPU, 1 GB RAM). It receives ZIP archives built by the operator and sent via SCP before the bot is invoked. New GCP deployments in v1 are **prebuilt static sites only**: no package install, build, or application process is run from a ZIP on the VM. Existing Node backend sites remain legacy inventory for safe listing/removal and separate migration, not an option for new deploys. Vercel and Render receive public GitHub repositories, not ZIP uploads. Private repositories, automatic redeploy on push, paid-resource provisioning, arbitrary external domains, and browser ZIP upload are out of scope for v1.

| Source | Target | v1 eligibility | DNS |
| --- | --- | --- | --- |
| Operator-built ZIP already on GCP | GCP/VPS | Prebuilt static site with no executable package install, build, or backend process | One proxied Cloudflare A record per website |
| Public GitHub URL | Vercel | Supported frontend project after manifest inspection and explicit confirmation | One DNS-only Cloudflare CNAME per website |
| Public GitHub URL | Render | Supported service; .NET requires a repository Dockerfile and explicit runtime configuration | One DNS-only Cloudflare CNAME per website |

The current `bot` hostname and any other manually owned DNS are excluded. A collision with an existing registry name or Cloudflare A/AAAA/CNAME record fails; the bot does not overwrite it or silently invent a suffixed name. A user may choose another available name and confirm again. The existing wildcard-DNS and ZIP-to-Vercel decisions in ADR-0001, and the automatic collision suffix proposal in the 2026-09-24 design, are superseded by this design once its ADR is accepted.

## Candidate inspection and confirmation

Telegram and the dashboard expose the same coordinator operations and status contract. For GCP, both present ZIPs already in the configured import directory; neither accepts a browser upload or an arbitrary filesystem path. For cloud, both accept a pasted public GitHub URL and present the same candidate facts and explicit confirmation. Dashboard deploy/redeploy controls require the same authorization, collision checks, cost guard, and failure reporting as Telegram; a UI-only success message is forbidden.

For a public GitHub URL, inspect repository metadata and manifests at a **resolved immutable commit SHA**. Show repository owner/name, branch, SHA, selected application root, detected framework/runtime, proposed target, domain, and any configuration or cost warning. Detection is a suggestion, never authorization to deploy. The confirmation must bind to the SHA and candidate settings; a changed branch head or expired confirmation requires a fresh proposal.

Use deterministic evidence such as package manifests, lockfiles, framework configuration, solution/project files, and Dockerfile. Vue/React frontend generally suggests Vercel, but SSR, server functions, mixed repositories, and unsupported frameworks require explicit review. .NET suggests Render only with a Dockerfile. A monorepo without a selected application root and branch, or an ambiguous/unsupported project, stops with actionable requirements instead of guessing or generating a Dockerfile. The bot must not pass its own environment secrets to deployed applications.

Cloud deployment must create a real build/deployment for that SHA, then wait for provider readiness. It must not treat “project created” or “custom domain attached” as deployment success. The precise API capability for arbitrary public GitHub repositories at a pinned SHA is a **feasibility gate**: if a provider cannot honor it with the available integration/permissions, that target is disabled with an honest explanation. Never silently deploy a different commit.

Official provider documentation already reveals a material limit: Vercel Git import requires appropriate repository ownership or organization access; a public URL alone is insufficient. Its non-Git file-upload API may provide an alternative, but that path and manual-only behavior remain untested. Render documents public Git URLs and a manual `commitId` deploy separately, but creating a service can first build the branch head. The bot must not attach the custom domain until it verifies the intended commit. See [provider feasibility research](../../research/2026-09-25-cloud-provider-feasibility.md) and the prerequisite spike #39. If the spike cannot meet the agreed arbitrary-public-repo and manual-only semantics, the product choice must return to the operator; implementation must not silently narrow scope.

## Lifecycle and ownership

The coordinator owns a durable operation ID and states such as `proposed`, `deploying`, `awaiting_dns`, `verifying`, `online`, `failed_retryable`, `deleting`, and `cleanup_pending`. Provider adapters return actual resource IDs and observed state; they do not decide final success. Registry writes are atomic and lock a project name while an operation runs. A retry resumes or compensates from recorded steps rather than recreating unknown resources.

New deployment sequence:

1. Authorize the Telegram/dashboard actor, validate name and source, check registry and exact DNS collision, then reserve the name.
2. For GCP ZIP: accept only an operator-built archive from a configured import directory; reject traversal, symlinks/unsafe entries, oversized archives, and unsafe filenames; extract to staging without executing package scripts or starting an app process. Require a prebuilt static entry point, then configure Nginx with HTTPS. New static sites have no application port. Legacy Node backends may still have a localhost-only port until they are migrated or removed.
3. For cloud: create an actual deployment at the confirmed SHA, record the provider project/service/deployment IDs, attach the custom domain, and observe provider readiness. Respect free-plan/quota limits; any charge or unsupported quota blocks the operation pending separate approval.
4. Create only a deployment-owned DNS record after an exact collision check. Store its Cloudflare ID, name, type, target, and ownership marker. GCP A is proxied; cloud CNAME is DNS-only and uses the target required by that provider for this domain, not an unverified hard-coded default.
5. Wait for domain verification/certificate and public HTTPS availability. Require an HTTP health-check path returning 2xx/3xx before `online`; default path `/`, configurable for an API. A timeout or partial failure retains a truthful retryable state and reports the failed step. Where safe, compensate resources created by a new attempt; if compensation fails, retain their IDs for cleanup.

`/deploy` rejects a duplicate name. `/deploy_web` remains as a GCP ZIP entry point into the same coordinator and no longer accepts an arbitrary server/domain argument. A separate `/redeploy` for a GCP ZIP validates and stages a new release, swaps it only after prechecks, verifies HTTPS, and restores the previous release on failure. Cloud updates are manual, use a newly inspected/confirmed SHA, and retain the previous deployment until the replacement is healthy. No Git push automatically updates a managed website.

`/web_remove` marks the deployment as deleting, removes only its recorded/verified DNS record and provider domain/origin resources, and clears registry ownership only after cleanup is proven. Every step is idempotent. A missing resource may be treated as already removed only after exact ID verification; any failed step leaves `cleanup_pending` and resource IDs visible for retry. Legacy sites without recorded ownership require an audited reconciliation and are never deleted by hostname inference alone.

## Security, cost, and operational gates

- Only authorized identities can inspect candidate repositories, confirm deployment, redeploy, remove, or use dashboard controls. Existing dashboard authentication and `/sh` injection findings remain a separate release blocker (#35).
- A public repository may be proposed regardless of owner, but its code is untrusted. Do not execute it on the 1 GB VM for cloud detection. Restrict fetched files, size and depth; do not print repository tokens, provider tokens, or server paths in logs or docs. GCP ZIPs are operator-built but still require safe extraction; no child process serving a site may inherit the bot's credentials.
- No automatic paid plan, add-on, domain quota expansion, or background service upgrade. Surface Render/Vercel plan limits and account eligibility; Vercel Hobby has personal/non-commercial restrictions, and Render custom-domain quota can incur charges. Require a distinct user decision if free eligible capacity is unavailable.
- DNS propagation and certificate issuance are asynchronous: show a pending state and a bounded retry/timeout, not an immediate success or an infinite chat wait.
- WIP code on the current branch is not a validated implementation. No live Cloudflare, provider, or GCP cutover is included in this design phase.

## Verification and release gates

Tests must cover matrix rejection (including backend ZIP refusal and ZIP-to-cloud refusal), framework ambiguity, SHA-bound confirmation, Telegram/dashboard parity, duplicate-name and foreign-DNS rejection, ZIP extraction safety, staging rollback, no site process receiving bot secrets, provider API false-success, delayed/failed custom-domain verification, health-check non-2xx, cost/quota refusal, idempotent removal, and cleanup retry without deleting foreign records. Contract tests use provider response fixtures; a separate sandbox/integration environment verifies actual Git deployment, DNS, TLS, and GCP Nginx before production cutover.

Implementation is gated by the pinned-SHA provider feasibility ticket (#39) and this written design's review. The candidate inspector (#40), shared lifecycle (#41), Vercel adapter (#42), Render adapter (#43), GCP redeploy (#44), end-to-end cutover (#45), dashboard parity (#46), and static-only admission and secret isolation (#47) are separately tracked; the earlier VPS DNS/security/legacy work remains #34/#35/#37. Each implementation ticket must pass `npm run check:syntax`, `npm test`, secret audit, code review, and a production cutover checklist. The old port-based websites remain untouched until their inventory and migration are approved (#37).
