# Owned Subdomain Deployment

Status: approved in conversation on 2026-09-25. Tracks issue #34.

## Outcome

`/deploy` and `/deploy_web` use one deployment coordinator. A VPS ZIP named or explicitly assigned `test` is reachable at `https://test.thienhn.io.vn`; `/web_remove test` removes its origin and its owned DNS record. No user-facing URL or command needs an application port. Existing Vercel and Render deployments keep their CNAME routing.

## Decisions

- Every VPS web has an explicit proxied Cloudflare A record. No wildcard DNS fallback is used. The zone currently has no wildcard record.
- Nginx listens on 80 and 443 using the existing Cloudflare Origin certificate. A static web uses no port. A Node backend uses an automatically allocated localhost port behind Nginx.
- `/deploy_web <project> <zip>` remains available as an alias into the same coordinator; its previous arbitrary domain/IP argument is retired. `/deploy <zip>` derives the project name from the ZIP.
- A pre-existing DNS name is a collision unless the registry proves ownership by record ID. The `bot` hostname and other manually managed records must remain untouched.
- A deployment is `online` only after its local origin and DNS succeed. On failure, expose the failed step and preserve a retryable registry state; for a new deployment, clean up resources created by that attempt when safe.
- Undeploy is retryable. A failed Nginx, PM2, filesystem, or DNS step is reported and the registry remains until cleanup completes. DNS deletion uses the stored record ID and verifies name/type before removal.
- Imported legacy sites without ownership metadata need explicit reconciliation before DNS deletion. Do not guess ownership from the hostname alone.
- Authentication and command execution findings from the broader audit are a separate issue because they have their own review and release gate.

## Components and data flow

`lib/deployer.js` validates a project name and subdomain, checks DNS collision/ownership, reserves registry state, calls the VPS sandbox or cloud provider, provisions DNS, then records `online` and the DNS record ID. `lib/providers/cloudflare.js` handles exact lookup, Cloudflare API response validation, ownership-safe upsert and deletion. `lib/sandbox.js` extracts the ZIP, configures Nginx and optional backend PM2, and checks every system command result. Telegram and dashboard call the coordinator and report its actual status.

The registry records `name`, `target`, `domain`, `status`, `dnsRecordId`, and `dnsRecordType`; backend-only `port` remains internal. A failed operation retains its last successful steps to support retry. Writes must be atomic to avoid corrupting the registry.

## Verification

Tests cover new static and backend deployments, failed DNS creation, same-name DNS collision, exact owned-record deletion, failed deletion with retry, `/deploy_web` using the coordinator, and no port in static metadata or user messages. A full `npm run check:syntax` and terminating `npm test` run are required. Live DNS and VPS changes are checked separately after the branch is reviewable.
