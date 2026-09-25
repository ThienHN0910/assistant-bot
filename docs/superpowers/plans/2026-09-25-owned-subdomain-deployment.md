# Owned Subdomain Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deploy and undeploy of VPS websites use owned Cloudflare subdomains with truthful, retryable outcomes.

**Architecture:** The deployment coordinator owns lifecycle state and delegates exact DNS operations to the Cloudflare provider and origin operations to the VPS sandbox. Telegram commands and the dashboard consume one result contract.

**Tech Stack:** Node.js CommonJS, Cloudflare DNS API, Nginx, PM2, Node `assert` tests.

**Spec:** `docs/superpowers/specs/2026-09-25-owned-subdomain-deployment-design.md`

## Global Constraints

- Preserve existing uncommitted work on branch `feat/34-cloudflare-a-records-perf-https`.
- Do not print or commit `.env` values. `.env.example` uses documentation-only IPs.
- Never overwrite or delete a DNS record unless the registry owns its record ID.
- No public application port; backend ports are localhost-only and static sites have no port.
- All shell execution has a timeout and every result is checked.

## Review Focus

- An existing manual A or CNAME record named `bot` is never modified by a web deployment.
- Cloudflare `success: false` with HTTP 200 is treated as failure.
- A DNS delete failure retains enough registry state for another `/web_remove` attempt.
- Nginx syntax/reload failure cannot produce `online` status.
- Repeated deployment of the same project cannot destroy its current working version before the replacement is ready.

---

### Task 1: Cloudflare ownership boundary

**Files:** Modify `lib/providers/cloudflare.js`; test `test/cloudflare.test.js`.

**Interfaces:** `findDnsRecord(domain, type, config, client)` returns an exact record or null; `upsertARecord` refuses unowned collisions; `deleteDnsRecord` requires record ID, name and type confirmation.

- [ ] Add failing tests for `success:false`, a foreign A/CNAME collision, and a mismatched record ID. Run `node test/cloudflare.test.js`; expect assertion failures.
- [ ] Implement API response validation, exact lookup and ownership checks. Run the same test; expect exit 0.
- [ ] Run `npm run check:syntax` and `npm test` after Task 2 fixes the existing timer hang.

### Task 2: Terminating test gate

**Files:** Modify `lib/deployStore.js`; test `test/telegram_deploy.test.js` or a focused child-process test.

**Interfaces:** Timed expiry remains 10/15 minutes while timer handles do not keep Node alive.

- [ ] Reproduce `node test/telegram_deploy.test.js` remaining alive after its final assertion.
- [ ] Add a focused test of normal process termination; verify it fails before the fix.
- [ ] Unref expiry timers, rerun the focused test and full `npm test`; expect exit 0.

### Task 3: VPS origin reliability and internal port

**Files:** Modify `lib/sandbox.js`, `lib/deployer.js`; test `test/sandbox.test.js`, `test/deployer.test.js`.

**Interfaces:** `deployProject(sourcePath, name, internalPort, config)` returns type, domain and backend-only port. Origin and Nginx failures throw; `removeProject` reports failure instead of silently succeeding.

- [ ] Add failing tests for static web with no port, failed Nginx operation, failed backend start and safe removal. Run focused tests and see expected failures.
- [ ] Replace shell-string execution with argument-based execution for ZIP, npm, PM2 and Nginx operations; check each result. Allocate a port only when backend is detected and bind it to localhost.
- [ ] Run focused tests and syntax check; expect exit 0.

### Task 4: Retryable deployment lifecycle

**Files:** Modify `lib/deployer.js`; test `test/deployer.test.js`; update `CONTEXT.md` and ADR if status names change.

**Interfaces:** `deploy` and `undeploy` persist `status`, `dnsRecordId`, `dnsRecordType` and return actual outcome. Failed steps retain retry state; successful removal clears registry.

- [ ] Add failing tests for DNS failure, DNS collision, origin failure, owned DNS deletion, failed deletion retry and legacy registry entries.
- [ ] Implement atomic registry writes and lifecycle transitions; ensure only owned IDs are deleted.
- [ ] Run focused tests, `npm run check:syntax` and `npm test`; expect exit 0.

### Task 5: One user-facing command path

**Files:** Modify `commands/deploy_web.js`, `commands/deploy.js`, `commands/web_remove.js`, `commands/web_list.js`, `commands/perf.js`, `config/whitelist.js`, `docs/commands-guide.md`, `README.md`; test `test/telegram_deploy.test.js`, `test/perf.test.js`.

**Interfaces:** `/deploy_web <project> <zip>` invokes `deployer.deploy`; both deploy commands and removal report the coordinator result and domain, never raw application ports.

- [ ] Add failing command tests for success URL, missing ZIP, DNS failure, removal failure and no visible port.
- [ ] Route both commands through the coordinator; remove the legacy Bash deployment alias and update user documentation.
- [ ] Run both required verification commands and inspect `git diff --check`, `git status`, and staged diff before committing.
