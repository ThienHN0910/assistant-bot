# Security Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the dashboard authentication and `/sh` command-injection paths before enabling new deployment controls, and remove the baseline timer hang that prevents full-suite verification.

**Architecture:** Dashboard management is fail-closed unless Google audience, verified email, authorized email, and session signing secret are configured. The Telegram shell command exposes only fixed, argument-free maintenance aliases and one validated PM2 app argument; the command runner never invokes a shell. Confirmation-expiry timers do not keep Node alive. This is a standalone PR for #35/#48 and is a release dependency of #41/#46.

**Tech Stack:** Node.js CommonJS, built-in `crypto`/`http`, Axios, existing assertion-based tests.

**Spec:** `docs/superpowers/specs/2026-09-25-source-aware-deployment-design.md`

## Global Constraints

- Branch from latest `origin/main` in a sibling worktree; do not copy the dirty WIP wholesale.
- Never commit `.env`, real tokens, private keys, or sensitive server paths. Sanitized new keys go into `.env.example`.
- Run `npm run check:syntax`, `npm test`, `git diff --check`, and staged secret audit before a Conventional Commit and PR.
- Do not change production VPS, Cloudflare, Vercel, or Render resources in this plan.

## Review Focus

- Missing dashboard auth configuration returns 503 on login and 401 on management, never an anonymous session.
- A Google token with the correct email but missing/wrong `aud` or unverified email is rejected.
- A forged session with missing/invalid `exp` or altered signature is rejected before a management action.
- `/sh` aliases cannot execute `bash -lc` or interpolate user strings into commands.
- An extra `/sh pm2-restart` argument is rejected rather than silently ignored.
- Confirmation-expiry timers still remove stale entries but do not keep the Node process alive.

---

### Task 1: Make confirmation-expiry timers non-blocking (#48)

**Files:** Modify `lib/deployStore.js`, `package.json`; create `test/deploy_store_exit.test.js`.

**Interfaces:** Preserve `setPending(id, data)` and `setAwaitingSubdomain(userId, deployId)` and their existing 15/10-minute expiration; only timer process-liveness changes.

- [ ] **Step 1: Write the failing test** in `test/deploy_store_exit.test.js` and add it to `npm test` immediately after `test/telegram_deploy.test.js`:

  ```js
  const assert = require('assert');
  const { spawnSync } = require('child_process');
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const code = "const store = require('./lib/deployStore'); store.setPending('p', {}); store.setAwaitingSubdomain('u', 'p');";
  const child = spawnSync(process.execPath, ['-e', code], { cwd: root, timeout: 1500, encoding: 'utf8' });
  assert.strictEqual(child.status, 0, `expiry timers kept Node alive: ${child.error?.code || child.stderr}`);
  console.log('deployStore timers allow process exit');
  ```

- [ ] **Step 2: Run** `node test/deploy_store_exit.test.js`; expect `ETIMEDOUT` and non-zero exit because pending timers hold the process open.
- [ ] **Step 3: Implement** `const timer = setTimeout(...); timer.unref();` in both setters. Do not shorten either TTL or remove the expiry callback.
- [ ] **Step 4: Run** `node test/deploy_store_exit.test.js`, `node test/telegram_deploy.test.js`, and `npm test`; expect exit 0 without a 10/15-minute wait.
- [ ] **Step 5: Commit** only these files with `fix: let deployment expiry timers release process (#48)` after checking `git status --short` and `git diff --cached`.

### Task 2: Make dashboard sessions fail closed

**Files:** Modify `services/dashboardApi.js`, `test/dashboard_api.test.js`.

**Interfaces:** Preserve `createSessionToken(email, secret)` and `verifySessionToken(token, secret, authorizedEmail)` exports. Add `isDashboardAuthReady(config): boolean`; `createDashboardServer` uses it before login and protected routes.

- [ ] **Step 1: Write failing tests** in `test/dashboard_api.test.js` for missing configuration, unverified Google email, absent/mismatched audience, and forged/expired sessions. Use the existing local test server and mock `axios`; assert `401` or `503` and no session token. Add these exact unit assertions near existing session tests:

  ```js
  assert.throws(() => createSessionToken(authorizedEmail, ''), /secret/i);
  assert.strictEqual(verifySessionToken(validToken, '', authorizedEmail), null);
  assert.strictEqual(verifySessionToken(validToken, sessionSecret, ''), null);
  assert.strictEqual(verifySessionToken('broken.' + validToken.split('.')[1], sessionSecret, authorizedEmail), null);
  ```

- [ ] **Step 2: Run** `node test/dashboard_api.test.js`; expect an assertion failure on the unconfigured or forged case.
- [ ] **Step 3: Implement** strict prerequisites, timing-safe signature comparison, and required future expiry. Keep the public health endpoint. The core rule is:

  ```js
  function isDashboardAuthReady(config) {
    return Boolean(config?.authorizedGoogleEmail && config?.googleClientId && config?.sessionSecret);
  }
  // Login requires email_verified === true, aud === config.googleClientId,
  // and email === config.authorizedGoogleEmail before createSessionToken.
  // Management returns 401 whenever isDashboardAuthReady(config) is false.
  ```

- [ ] **Step 4: Run** `node test/dashboard_api.test.js` and `npm run check:syntax`; expect exit 0.
- [ ] **Step 5: Commit** only these files with `fix: fail closed dashboard authentication (#35)` after checking `git status --short` and `git diff --cached`.

### Task 3: Remove shell-interpolated aliases and reject extra arguments

**Files:** Modify `config/whitelist.js`, `lib/whitelist.js`, `test/whitelist.test.js`, `docs/commands-guide.md`.

**Interfaces:** `getCommands(alias, providedArgs)` still returns `{cmd,args}` steps, but rejects unknown aliases, extra arguments, and any step using a shell interpreter. Keep `pm2-restart` only for `allowedApps`.

- [ ] **Step 1: Write failing tests** in `test/whitelist.test.js` for dangerous aliases and surplus arguments:

  ```js
  for (const alias of ['ls', 'cd', 'cat', 'extract-deploy', 'nginx-create', 'deploy-web']) {
    assert.throws(() => whitelist.getCommands(alias, ['x']), /Unknown alias/);
  }
  assert.throws(() => whitelist.getCommands('pm2-restart', ['assistant-bot', 'extra']), /argument/i);
  assert.throws(() => whitelist.getCommands('pm2-restart', ['app;id']), /App not allowed/);
  ```

- [ ] **Step 2: Run** `node test/whitelist.test.js`; expect failures on unsafe aliases/extra arguments.
- [ ] **Step 3: Implement** a fixed alias table of `git-status`, `nginx-test`, `nginx-status`, `pm2-list`, and validated `pm2-restart`; remove `git-pull`, `npm-install`, `npm-build`, `update`, file-read/write and legacy deploy aliases from `/sh` (dedicated commands remain separate). Reject any requested argument count other than the entry's declared count before replacement:

  ```js
  const expected = entry.argName ? 1 : 0;
  if (providedArgs.length !== expected) throw new Error(`Expected ${expected} argument(s)`);
  if (entry.argName === 'app' && !cfg.allowedApps.includes(providedArgs[0])) {
    throw new Error(`App not allowed: ${providedArgs[0]}`);
  }
  ```

- [ ] **Step 4: Run** `node test/whitelist.test.js`, `node test/telegram_deploy.test.js`, and `npm run check:syntax`; expect exit 0. Update command docs to show only the remaining aliases.
- [ ] **Step 5: Commit** only these files with `fix: restrict shell aliases to fixed operations (#35)` after the staged secret audit.

### Task 4: Gate dashboard write requests and finish the security PR

**Files:** Modify `services/dashboardApi.js`, `config/env.js`, `.env.example`, `test/dashboard_api.test.js`.

**Interfaces:** `config.dashboardAllowedOrigin` is an optional exact HTTPS origin. When set, CORS echoes only that origin; mutating dashboard routes reject a mismatched `Origin`. Without it, same-origin requests remain valid and cross-origin requests receive no CORS permission.

- [ ] **Step 1: Write failing tests** using the existing local HTTP client:

  ```js
  const denied = await client.post('/api/deployments/undeploy', { name: 'x' }, {
    headers: { Origin: 'https://foreign.example' },
  });
  assert.strictEqual(denied.status, 403);
  assert.notStrictEqual(denied.headers['access-control-allow-origin'], '*');
  ```

- [ ] **Step 2: Run** `node test/dashboard_api.test.js`; expect the foreign-origin assertion to fail.
- [ ] **Step 3: Implement** exact-origin CORS and reject mismatched-origin `POST` before body parsing; ensure authenticated bearer tokens are still required. Add sanitized `DASHBOARD_ALLOWED_ORIGIN=https://dashboard.example.invalid` to `.env.example`, and map it in `config/env.js`:

  ```js
  const origin = req.headers.origin;
  if (req.method === 'POST' && origin && origin !== config.dashboardAllowedOrigin) {
    sendJson(res, 403, { ok: false, error: 'Origin not allowed' });
    return;
  }
  if (origin && origin === config.dashboardAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  ```

- [ ] **Step 4: Run** `node test/dashboard_api.test.js`, `npm run check:syntax`, `npm test`, and `git diff --check`; expect all exit 0 and no warnings. Review `git status --short` and `git diff --cached` for secrets.
- [ ] **Step 5: Commit** `fix: reject foreign dashboard write origins (#35)`, push `fix/35-dashboard-shell-security`, open a PR closing #35, inspect `gh pr diff` and CI, then squash-merge only if all checks pass. Pull latest main in the worktree after merge.
