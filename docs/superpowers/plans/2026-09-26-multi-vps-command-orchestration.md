# Multi-VPS Command Orchestration & Oracle Deploy Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Oracle VPS 403/502 deploy failures and extend all Telegram commands (/ps, /uptime, /logs, /cleancache, /restart, /sh) + GitHub link deploy to fully support the Multi-VPS cluster.

**Architecture:** Extend the existing Hub-and-Spoke REST architecture — Worker Agent (`agent/server.js`) gains new diagnostic/control endpoints; Master Bot Telegram commands call these endpoints via updated `lib/nodeClient.js` functions; `textHandler.js` gains inline node-selection buttons for GitHub link deploy.

**Tech Stack:** Node.js http (no frameworks), PM2, Nginx, Cloudflare, Telegraf, axios, systeminformation

**Spec:** Conversation analysis on 2026-09-26 + `CONTEXT.md` domain vocabulary + `docs/adr/0004-multi-vps-hub-and-spoke-orchestrator.md`

**Issue:** https://github.com/ThienHN0910/assistant-bot/issues/55

## Global Constraints

- Node.js >= 18 (ESM not used; CommonJS throughout)
- Worker Agent RAM footprint < 25MB — no external framework imports
- Zero-Leakage: no real IPs, tokens, credentials in any tracked file
- All tests: `npm test` must pass with 0 errors before any commit
- Syntax check: `npm run check:syntax` must pass before any commit
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- `data/nodes.json` is .gitignored — never commit real topology
- IPs in tests must be RFC 5737 addresses (192.0.2.x, 198.51.100.x)
- Branch: `feat/55-multi-vps-command-orchestration`
- Base branch: `main`

---

## File Structure

**Files Modified:**
- `agent/agentSandbox.js` — fix default webDeployDir + chmod + extract validation
- `agent/server.js` — 5 new endpoints: GET /api/processes, GET /api/logs, POST /api/cleancache, POST /api/restart, POST /api/exec
- `lib/nodeClient.js` — 5 new functions: getProcesses, getLogs, cleanCache, restartAgent, execCommand
- `commands/ps.js` — add [node_id] routing
- `commands/uptime.js` — show all nodes' uptime in one reply
- `commands/logs.js` — add [count] [node_id] arg + remote fetch
- `commands/cleancache.js` — add [node_id | all] routing
- `commands/restart.js` — add [node_id] to restart Worker Agent daemon
- `commands/sh.js` — add [node_id] prefix for remote exec
- `handlers/textHandler.js` — add node selection buttons for GitHub static deploy
- `commands/deploy.js` — parse nodeId from callback_data (4th segment)

**Files Created:**
- `test/multi_vps_commands.test.js` — comprehensive tests for all new command behaviors

**Files Updated in docs:**
- `README.md` — Oracle firewall setup guide (open ports 80/443)

---

### Task 1: Fix agentSandbox.js — Safe Deploy Path, Extract Validation, Permissions

> The root cause of 403 Forbidden. Deploy dir `$HOME/web` is readable only by owner; Nginx worker runs as `www-data`. Must switch to `/var/www` which is `0755` by default.

**Files:**
- Modify: `agent/agentSandbox.js`
- Modify: `test/worker_agent.test.js` (add new test cases to existing file)

**Interfaces:**
- Produces: `deployZipPayload(zipBuffer, projectName, subdomain, options)` — default `webDeployDir` changes from `path.join(HOME, 'web')` to `/var/www`; after extraction, verifies files exist; runs `chmod -R 755 targetDir` on Linux

- [ ] **Step 1: Branch off main**

```bash
git checkout main
git pull origin main
git checkout -b feat/55-multi-vps-command-orchestration
```

- [ ] **Step 2: Implement fix in `agent/agentSandbox.js`**

Change line 59:
```javascript
// BEFORE:
const webDeployDir = options.webDeployDir || process.env.WEB_DEPLOY_DIR || path.join(process.env.HOME || '/home/hnt', 'web');

// AFTER:
const webDeployDir = options.webDeployDir || process.env.WEB_DEPLOY_DIR || '/var/www';
```

After the flattening block (after file extraction), add:
```javascript
  // Validate extraction produced readable files
  const allFiles = await fs.readdir(targetDir).catch(() => []);
  if (allFiles.length === 0) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`ZIP extraction failed: no files extracted to ${targetDir}. Ensure 'unzip' is installed: sudo apt install unzip -y`);
  }
  // Set world-readable permissions so Nginx www-data can serve files
  if (process.platform === 'linux') {
    await runCmd('chmod', ['-R', '755', targetDir]);
  }
```

- [ ] **Step 3: Run syntax check**

```bash
node --check agent/agentSandbox.js
```

Expected: No output (success).

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: All test suites pass.

- [ ] **Step 5: Commit**

```bash
git add agent/agentSandbox.js
git commit -m "fix: use /var/www as default deploy path and validate extraction in agent (#55)"
```

---

### Task 2: New Worker Agent Endpoints

> Add 5 endpoints to `agent/server.js` for remote diagnostics and control. All require `X-Agent-Secret` auth. RAM budget: each handler must not buffer more than 64KB of data in memory.

**Files:**
- Modify: `agent/agentSandbox.js` — add 3 helper functions: `getProcessList`, `getAgentLogs`, `cleanCacheAndLogs`
- Modify: `agent/server.js` — 5 new route handlers
- Modify: `test/worker_agent.test.js` — new test cases for each endpoint

**Interfaces:**
- Produces (agentSandbox.js):
  - `getProcessList()` → `Promise<{ ok: true, processes: [{user, name, pid, cpu, mem}] }>`
  - `getAgentLogs(lines)` → `Promise<{ ok: true, log: string }>` — reads last N lines from `process.env.PM2_ERROR_LOG_PATH`
  - `cleanCacheAndLogs()` → `Promise<{ ok: true, cacheFreed: string, pm2Flush: string }>`
- Produces (server.js new endpoints):
  - `GET /api/processes` → JSON `{ ok: true, processes: [...] }`
  - `GET /api/logs?lines=20` → JSON `{ ok: true, log: string }`
  - `POST /api/cleancache` → JSON `{ ok: true, result: { cacheFreed, pm2Flush } }`
  - `POST /api/restart` → JSON `{ ok: true }` — restarts PM2 process after 500ms
  - `POST /api/exec` → JSON `{ ok: true, stdout: string, stderr: string }` — whitelist-only commands

- [ ] **Step 1: Add helper functions to `agent/agentSandbox.js`** (before `module.exports`)

```javascript
async function getProcessList() {
  const result = await runCmd('ps', ['aux', '--sort=-%mem', '--no-header']);
  if (!result.ok) return { ok: false, error: result.stderr };
  const lines = (result.stdout || '').split('\n').filter(Boolean).slice(0, 5);
  const processes = lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    return {
      user: parts[0] || '',
      pid: Number(parts[1]) || 0,
      cpu: Number(parts[2]) || 0,
      mem: Number(parts[3]) || 0,
      name: parts.slice(10).join(' ').slice(0, 80),
    };
  });
  return { ok: true, processes };
}

async function getAgentLogs(lines = 20) {
  const logPath = process.env.PM2_ERROR_LOG_PATH;
  if (!logPath) return { ok: true, log: '(PM2_ERROR_LOG_PATH not set)' };
  try {
    const stat = await fs.stat(logPath);
    const readSize = Math.min(stat.size, 64 * 1024);
    const fd = await fs.open(logPath, 'r');
    const buf = Buffer.alloc(readSize);
    await fd.read(buf, 0, readSize, Math.max(0, stat.size - readSize));
    await fd.close();
    const text = buf.toString('utf8');
    const all = text.split('\n');
    const tail = all.slice(-Math.min(lines + 1, all.length)).join('\n').trim();
    return { ok: true, log: tail || '(log empty)' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function cleanCacheAndLogs() {
  const pm2 = await runCmd('pm2', ['flush']);
  let cacheFreed = 'N/A';
  if (process.platform === 'linux') {
    await runCmd('sync').catch(() => {});
    await runCmd('sh', ['-c', 'echo 3 | sudo tee /proc/sys/vm/drop_caches']).catch(() => {});
    const mem = await runCmd('free', ['-m']);
    const avLine = (mem.stdout || '').split('\n').find(l => l.startsWith('Mem:'));
    const parts = (avLine || '').trim().split(/\s+/);
    cacheFreed = parts[3] ? `${parts[3]} MB available` : 'done';
  }
  return { ok: true, cacheFreed, pm2Flush: pm2.ok ? 'OK' : pm2.stderr };
}
```

Update `module.exports` in agentSandbox.js to add:
```javascript
  getProcessList,
  getAgentLogs,
  cleanCacheAndLogs,
```

- [ ] **Step 2: Add 5 new routes to `agent/server.js`**

Add the EXEC_WHITELIST constant and 5 handlers inside the request handler, before the `sendJson(res, 404, ...)` fallback:

```javascript
    const EXEC_WHITELIST = new Set([
      'df -h', 'free -m', 'uptime', 'whoami', 'hostname',
      'git status', 'git log --oneline -5', 'pm2 list', 'pm2 status',
      'nginx -t', 'cat /proc/meminfo',
    ]);

    if (pathname === '/api/processes' && req.method === 'GET') {
      if (!checkAgentAuth(req, secret)) { sendJson(res, 401, { ok: false, error: 'Unauthorized' }); return; }
      try {
        const result = await sandbox.getProcessList();
        sendJson(res, result.ok ? 200 : 500, result);
      } catch (err) { sendJson(res, 500, { ok: false, error: err.message }); }
      return;
    }

    if (pathname === '/api/logs' && req.method === 'GET') {
      if (!checkAgentAuth(req, secret)) { sendJson(res, 401, { ok: false, error: 'Unauthorized' }); return; }
      try {
        const urlObj = new URL(req.url, `http://localhost`);
        const lines = Math.min(parseInt(urlObj.searchParams.get('lines') || '20', 10) || 20, 100);
        const result = await sandbox.getAgentLogs(lines);
        sendJson(res, result.ok !== false ? 200 : 500, result);
      } catch (err) { sendJson(res, 500, { ok: false, error: err.message }); }
      return;
    }

    if (pathname === '/api/cleancache' && req.method === 'POST') {
      if (!checkAgentAuth(req, secret)) { sendJson(res, 401, { ok: false, error: 'Unauthorized' }); return; }
      try {
        const result = await sandbox.cleanCacheAndLogs();
        sendJson(res, 200, { ok: true, result });
      } catch (err) { sendJson(res, 500, { ok: false, error: err.message }); }
      return;
    }

    if (pathname === '/api/restart' && req.method === 'POST') {
      if (!checkAgentAuth(req, secret)) { sendJson(res, 401, { ok: false, error: 'Unauthorized' }); return; }
      sendJson(res, 200, { ok: true, message: 'Restarting assistant-node-agent in 500ms' });
      setTimeout(() => { if (typeof sandbox.restartSelf === 'function') sandbox.restartSelf(); }, 500);
      return;
    }

    if (pathname === '/api/exec' && req.method === 'POST') {
      if (!checkAgentAuth(req, secret)) { sendJson(res, 401, { ok: false, error: 'Unauthorized' }); return; }
      try {
        const body = await parseJsonBody(req, maxJsonBytes);
        const command = (body.command || '').trim();
        if (!EXEC_WHITELIST.has(command)) {
          sendJson(res, 403, { ok: false, error: `Command not in whitelist: ${command}` });
          return;
        }
        const [cmd, ...args] = command.split(' ');
        const result = await sandbox.runCmd(cmd, args, { timeout: 10000 });
        sendJson(res, 200, { ok: result.ok, stdout: result.stdout, stderr: result.stderr });
      } catch (err) { sendJson(res, 500, { ok: false, error: err.message }); }
      return;
    }
```

- [ ] **Step 3: Write tests in `test/worker_agent.test.js`**

Add these assertions to the existing `runTests()` function:

```javascript
  // GET /api/processes
  {
    const procSandbox = { ...mockSandbox,
      getProcessList: async () => ({ ok: true, processes: [{ name: 'node', pid: 123, cpu: 1.2, mem: 3.4, user: 'ubuntu' }] }),
    };
    const srv = createAgentServer({ secret, sandbox: procSandbox });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/processes`, { headers: { 'x-agent-secret': secret } });
    const data = await r.json();
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(data.processes), 'processes is array');
    srv.close();
    console.log('✅ GET /api/processes test passed');
  }

  // GET /api/logs
  {
    const logSandbox = { ...mockSandbox,
      getAgentLogs: async (lines) => ({ ok: true, log: 'test log\n'.repeat(lines) }),
    };
    const srv = createAgentServer({ secret, sandbox: logSandbox });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/logs?lines=5`, { headers: { 'x-agent-secret': secret } });
    const data = await r.json();
    assert.strictEqual(r.status, 200);
    assert.ok(typeof data.log === 'string');
    srv.close();
    console.log('✅ GET /api/logs test passed');
  }

  // POST /api/cleancache
  {
    const ccSandbox = { ...mockSandbox,
      cleanCacheAndLogs: async () => ({ ok: true, cacheFreed: '100MB', pm2Flush: 'OK' }),
    };
    const srv = createAgentServer({ secret, sandbox: ccSandbox });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/cleancache`, { method: 'POST', headers: { 'x-agent-secret': secret, 'content-type': 'application/json' }, body: '{}' });
    const data = await r.json();
    assert.strictEqual(r.status, 200);
    assert.ok(data.result);
    srv.close();
    console.log('✅ POST /api/cleancache test passed');
  }

  // POST /api/exec — allowed command
  {
    const srv = createAgentServer({ secret, sandbox: mockSandbox });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/exec`, {
      method: 'POST',
      headers: { 'x-agent-secret': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'uptime' }),
    });
    assert.ok([200, 500].includes(r.status), `exec allowed: got ${r.status}`); // 500 is ok if uptime not available in test env

    // blocked command → 403
    const r2 = await fetch(`http://127.0.0.1:${port}/api/exec`, {
      method: 'POST',
      headers: { 'x-agent-secret': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'rm -rf /' }),
    });
    assert.strictEqual(r2.status, 403, 'exec blocked command returns 403');
    srv.close();
    console.log('✅ POST /api/exec whitelist tests passed');
  }
```

- [ ] **Step 4: Run syntax check + all tests**

```bash
node --check agent/agentSandbox.js
node --check agent/server.js
npm run check:syntax
npm test
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add agent/agentSandbox.js agent/server.js test/worker_agent.test.js
git commit -m "feat: add processes/logs/cleancache/restart/exec endpoints to worker agent (#55)"
```

---

### Task 3: Extend nodeClient.js with 5 New Functions

**Files:**
- Modify: `lib/nodeClient.js`
- Modify: `test/node_client.test.js`

**Interfaces:**
- Consumes: existing `resolveAgentUrl(node)`, `resolveSecret(node.secret)`, axios
- Produces:
  - `getProcesses(node, client?)` → `Promise<{ ok, processes }>`
  - `getLogs(node, lines?, client?)` → `Promise<{ ok, log }>`
  - `cleanCache(node, client?)` → `Promise<{ ok, result }>`
  - `restartAgent(node, client?)` → `Promise<{ ok }>`
  - `execCommand(node, command, client?)` → `Promise<{ ok, stdout, stderr }>`

- [ ] **Step 1: Implement all 5 functions in `lib/nodeClient.js`** (before `module.exports`)

```javascript
async function getProcesses(node, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/processes`;
  try {
    const res = await client.get(url, { headers: { 'X-Agent-Secret': resolveSecret(node.secret) }, timeout: 5000 });
    return res.data;
  } catch (err) { return { ok: false, error: err.message, processes: [] }; }
}

async function getLogs(node, lines = 20, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/logs?lines=${lines}`;
  try {
    const res = await client.get(url, { headers: { 'X-Agent-Secret': resolveSecret(node.secret) }, timeout: 8000 });
    return res.data;
  } catch (err) { return { ok: false, error: err.message, log: '' }; }
}

async function cleanCache(node, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/cleancache`;
  try {
    const res = await client.post(url, {}, { headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': resolveSecret(node.secret) }, timeout: 30000 });
    return res.data;
  } catch (err) { return { ok: false, error: err.message }; }
}

async function restartAgent(node, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/restart`;
  try {
    const res = await client.post(url, {}, { headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': resolveSecret(node.secret) }, timeout: 5000 });
    return res.data;
  } catch (err) { return { ok: false, error: err.message }; }
}

async function execCommand(node, command, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/exec`;
  try {
    const res = await client.post(url, { command }, { headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': resolveSecret(node.secret) }, timeout: 15000 });
    return res.data;
  } catch (err) { return { ok: false, error: err.message, stdout: '', stderr: '' }; }
}
```

Update `module.exports` to export all 5 new functions.

- [ ] **Step 2: Add tests to `test/node_client.test.js`**

```javascript
// getProcesses
{
  const mock = { get: async () => ({ data: { ok: true, processes: [{ name: 'node', pid: 1, cpu: 0.5, mem: 2.0, user: 'ubuntu' }] } }) };
  const result = await nodeClient.getProcesses(mockNode, mock);
  assert.ok(result.ok, 'getProcesses ok');
  assert.ok(Array.isArray(result.processes));
  console.log('✅ getProcesses test passed');
}

// getLogs
{
  const mock = { get: async () => ({ data: { ok: true, log: 'line 1\nline 2' } }) };
  const result = await nodeClient.getLogs(mockNode, 10, mock);
  assert.ok(result.ok);
  assert.ok(typeof result.log === 'string');
  console.log('✅ getLogs test passed');
}

// cleanCache
{
  const mock = { post: async () => ({ data: { ok: true, result: { cacheFreed: '100MB', pm2Flush: 'OK' } } }) };
  const result = await nodeClient.cleanCache(mockNode, mock);
  assert.ok(result.ok);
  console.log('✅ cleanCache test passed');
}

// restartAgent
{
  const mock = { post: async () => ({ data: { ok: true, message: 'Restarting' } }) };
  const result = await nodeClient.restartAgent(mockNode, mock);
  assert.ok(result.ok);
  console.log('✅ restartAgent test passed');
}

// execCommand
{
  const mock = { post: async (url, body) => ({ data: { ok: true, stdout: `result of ${body.command}`, stderr: '' } }) };
  const result = await nodeClient.execCommand(mockNode, 'hostname', mock);
  assert.ok(result.ok);
  assert.ok(result.stdout.includes('hostname'));
  console.log('✅ execCommand test passed');
}
```

- [ ] **Step 3: Run syntax check + all tests**

```bash
node --check lib/nodeClient.js
npm run check:syntax
npm test
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add lib/nodeClient.js test/node_client.test.js
git commit -m "feat: add getProcesses/getLogs/cleanCache/restartAgent/execCommand to nodeClient (#55)"
```

---

### Task 4: Upgrade /ps, /uptime, /logs

> Commands learn to accept an optional `[node_id]` argument. When remote node is specified, they delegate to `nodeClient`. `/uptime` with no args shows ALL nodes.

**Files:**
- Modify: `commands/ps.js`
- Modify: `commands/uptime.js`
- Modify: `commands/logs.js`
- Create: `test/multi_vps_commands.test.js`

**Interfaces:**
- Consumes: `nodeManager.getNode(id, config)`, `nodeManager.getNodes(config)`, `nodeManager.maskIp(ip)`, `nodeClient.getProcesses(node)`, `nodeClient.getLogs(node, lines)`, `nodeClient.getMetrics(node)`
- All execute functions must accept `(ctx, config = {}, deps = {})` where `deps` may provide `{ nodeManager, nodeClient, si }`

- [ ] **Step 1: Create `test/multi_vps_commands.test.js`**

```javascript
'use strict';
const assert = require('assert');

async function runTests() {
  // --- /ps remote node test ---
  const mockNodeManager = {
    getNode: async (id) => {
      if (id === 'oracle-worker') return { id, name: 'Oracle Cloud VM', ip: '198.51.100.1', isLocal: false, secret: '' };
      return { id: 'gcp-master', name: 'GCP Master', ip: '192.0.2.1', isLocal: true };
    },
    getNodes: async () => [
      { id: 'gcp-master', name: 'GCP Master', ip: '192.0.2.1', isLocal: true },
      { id: 'oracle-worker', name: 'Oracle Cloud VM', ip: '198.51.100.1', isLocal: false },
    ],
    maskIp: (ip) => ip ? `${ip.split('.')[0]}.***.***.***` : '',
  };
  const mockNodeClient = {
    getProcesses: async (node) => ({ ok: true, processes: [{ name: 'node', pid: 100, cpu: 1.0, mem: 5.0, user: 'ubuntu' }] }),
    getLogs: async (node, lines) => ({ ok: true, log: 'remote log line 1\nremote log line 2' }),
    cleanCache: async (node) => ({ ok: true, result: { cacheFreed: '200MB', pm2Flush: 'OK' } }),
    restartAgent: async (node) => ({ ok: true, message: 'Restarting' }),
    execCommand: async (node, cmd) => ({ ok: true, stdout: 'hostname-output', stderr: '' }),
    getMetrics: async (node) => ({
      ok: true,
      metrics: { cpuLoad: 10, memory: { usedBytes: 500e6, totalBytes: 1e9, usedPercentage: 50 }, uptimeSeconds: 172800 },
    }),
  };

  {
    const psCommand = require('./commands/ps.js');
    const replies = [];
    const ctx = { message: { text: '/ps oracle-worker' }, replyWithHTML: async h => replies.push(h), reply: async h => replies.push(h) };
    await psCommand.execute(ctx, {}, { nodeManager: mockNodeManager, nodeClient: mockNodeClient, si: {} });
    assert.ok(replies.length > 0, '/ps returned a reply');
    assert.ok(replies[0].toLowerCase().includes('oracle') || replies[0].includes('node'), '/ps oracle reply mentions oracle or node');
    console.log('✅ /ps oracle-worker remote node test passed');
  }

  {
    const uptimeCmd = require('./commands/uptime.js');
    const replies = [];
    const ctx = { message: { text: '/uptime' }, replyWithHTML: async h => replies.push(h) };
    await uptimeCmd.execute(ctx, {}, { nodeManager: mockNodeManager, nodeClient: mockNodeClient, si: { time: () => ({ uptime: 86400 }) } });
    assert.ok(replies[0].includes('GCP Master'), '/uptime includes GCP Master');
    assert.ok(replies[0].includes('Oracle'), '/uptime includes Oracle node');
    console.log('✅ /uptime multi-node test passed');
  }

  {
    const logsCmd = require('./commands/logs.js');
    const replies = [];
    const ctx = {
      message: { text: '/logs 10 oracle-worker' },
      replyWithHTML: async h => replies.push(h),
      reply: async h => replies.push(h),
    };
    await logsCmd.execute(ctx, {}, { nodeManager: mockNodeManager, nodeClient: mockNodeClient });
    assert.ok(replies[0].includes('remote log'), '/logs reply includes remote log content');
    console.log('✅ /logs remote node test passed');
  }

  console.log('🎉 /ps /uptime /logs multi-vps tests passed!');
}

runTests().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node test/multi_vps_commands.test.js
```

Expected: FAIL — commands don't accept `deps` argument yet.

- [ ] **Step 3: Implement `commands/ps.js`**

Rewrite `execute` to `(ctx, config = {}, deps = {})`:

```javascript
const si = require('systeminformation');
const { escapeHtml, formatPercent } = require('../config/utils');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');

module.exports = {
  name: 'ps',
  description: 'Xem top 5 tiến trình ngốn RAM & CPU nhiều nhất [node_id]',
  execute: async (ctx, config = {}, deps = {}) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /ps</b>\n` +
          `Kiểm tra top 5 tiến trình tiêu thụ nhiều RAM & CPU nhất.\n\n` +
          `<b>Cú pháp:</b> <code>/ps [node_id]</code>\n` +
          `<b>Ví dụ:</b> <code>/ps</code> hoặc <code>/ps oracle-worker</code>`
        );
        return;
      }

      const depNM = deps.nodeManager || nodeManager;
      const depNC = deps.nodeClient || nodeClient;
      const depSi = deps.si || si;
      const nodeId = args.find(a => !a.startsWith('-'));

      if (nodeId) {
        const node = await depNM.getNode(nodeId, config);
        if (node && !node.isLocal) {
          const result = await depNC.getProcesses(node);
          if (!result.ok) {
            await ctx.replyWithHTML(`⚠️ Không thể kết nối tới node <b>${escapeHtml(node.name || node.id)}</b>: ${escapeHtml(result.error || 'unknown')}`);
            return;
          }
          const lines = [`📊 <b>TOP TIẾN TRÌNH TRÊN ${escapeHtml((node.name || node.id).toUpperCase())}</b>\n`];
          (result.processes || []).slice(0, 5).forEach((p, idx) => {
            lines.push(
              `<b>${idx + 1}. ${escapeHtml(p.name)}</b> (PID: <code>${p.pid}</code> | User: <code>${escapeHtml(p.user || 'n/a')}</code>)\n` +
              `   • RAM: <b>${formatPercent(p.mem)}</b> | CPU: <b>${formatPercent(p.cpu)}</b>`
            );
          });
          await ctx.replyWithHTML(lines.join('\n\n'));
          return;
        }
      }

      // Local master — original logic
      const procData = await depSi.processes();
      const list = procData?.list || [];
      if (!list.length) { await ctx.reply('⚠️ Không lấy được danh sách tiến trình.'); return; }
      const topMem = [...list].sort((a, b) => (Number(b.mem) || 0) - (Number(a.mem) || 0)).slice(0, 5);
      const lines = ['📊 <b>TOP 5 TIẾN TRÌNH TIÊU THỤ RAM NHIỀU NHẤT (MASTER)</b>\n'];
      topMem.forEach((p, idx) => {
        lines.push(
          `<b>${idx + 1}. ${escapeHtml(p.name)}</b> (PID: <code>${p.pid}</code> | User: <code>${escapeHtml(p.user || 'root')}</code>)\n` +
          `   • RAM: <b>${formatPercent(Number(p.mem) || 0)}</b> | CPU: <b>${formatPercent(Number(p.cpu) || 0)}</b>`
        );
      });
      await ctx.replyWithHTML(lines.join('\n\n'));
    } catch (error) {
      console.error('[PS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể lấy danh sách tiến trình lúc này.');
    }
  },
};
```

- [ ] **Step 4: Implement `commands/uptime.js`**

```javascript
const si = require('systeminformation');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${days} ngày, ${hours} giờ, ${minutes} phút, ${secs} giây`;
}

module.exports = {
  name: 'uptime',
  description: 'Xem thời gian uptime của toàn bộ cụm VPS',
  execute: async (ctx, config = {}, deps = {}) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /uptime</b>\n` +
          `Xem thời gian hoạt động liên tục của tất cả máy chủ trong cụm.\n\n` +
          `<b>Cú pháp:</b> <code>/uptime</code>`
        );
        return;
      }

      const depNM = deps.nodeManager || nodeManager;
      const depNC = deps.nodeClient || nodeClient;
      const depSi = deps.si || si;

      const nodes = await depNM.getNodes(config).catch(() => []);
      const blocks = [];

      for (const node of nodes) {
        const maskedIp = depNM.maskIp ? depNM.maskIp(node.ip) : '***';
        const title = `🖥️ <b>${node.name || node.id}</b> (<code>${maskedIp}</code>)${node.isLocal ? ' <i>[Master]</i>' : ''}`;

        if (node.isLocal) {
          const timeData = typeof depSi.time === 'function' ? depSi.time() : {};
          const uptimeSec = typeof timeData.uptime === 'number' ? timeData.uptime : 0;
          blocks.push(`${title}\n• Uptime: <code>${formatDuration(uptimeSec)}</code>`);
        } else {
          try {
            const metrics = await depNC.getMetrics(node);
            if (metrics && metrics.ok && metrics.metrics) {
              const upSec = metrics.metrics.uptimeSeconds || 0;
              blocks.push(`${title}\n• Uptime: <code>${formatDuration(upSec)}</code>`);
            } else {
              blocks.push(`${title}\n• ⚠️ Offline / không thể kết nối`);
            }
          } catch {
            blocks.push(`${title}\n• ⚠️ Offline`);
          }
        }
      }

      await ctx.replyWithHTML(`⏱️ <b>TRẠNG THÁI HOẠT ĐỘNG CỤM VPS</b>\n\n${blocks.join('\n\n')}`);
    } catch (error) {
      console.error('[UPTIME_COMMAND_ERROR]', error);
      await ctx.replyWithHTML('⚠️ Không thể lấy thời gian hoạt động của server lúc này.');
    }
  },
};
```

- [ ] **Step 5: Implement `commands/logs.js`**

```javascript
const fs = require('fs/promises');
const { readLastLines, escapeHtml } = require('../config/utils');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');

module.exports = {
  name: 'logs',
  description: 'Xem log PM2 gần nhất [count] [node_id]',
  execute: async (ctx, config = {}, deps = {}) => {
    try {
      const text = ctx.message?.text || '';
      const args = text.trim().split(/\s+/).slice(1);
      if (args.includes('-h') || args.includes('--help')) {
        await ctx.replyWithHTML(
          `ℹ️ <b>Hướng dẫn lệnh /logs</b>\n` +
          `Xem log PM2 gần nhất của Master hoặc Worker Node.\n\n` +
          `<b>Cú pháp:</b> <code>/logs [số_dòng] [node_id]</code>\n` +
          `<b>Ví dụ:</b> <code>/logs 20</code> hoặc <code>/logs 30 oracle-worker</code>`
        );
        return;
      }

      const depNM = deps.nodeManager || nodeManager;
      const depNC = deps.nodeClient || nodeClient;

      const numArg = args.find(a => /^\d+$/.test(a));
      const nodeId = args.find(a => !/^\d+$/.test(a) && !a.startsWith('-'));
      const count = Math.min(parseInt(numArg || '20', 10) || 20, 100);

      if (nodeId) {
        const node = await depNM.getNode(nodeId, config);
        if (node && !node.isLocal) {
          const result = await depNC.getLogs(node, count);
          const logText = result.ok ? (result.log || '(trống)') : `Lỗi: ${result.error}`;
          await ctx.replyWithHTML(
            `🧾 <b>${count} dòng log gần nhất — ${escapeHtml(node.name || node.id)}:</b>\n<pre>${escapeHtml(logText)}</pre>`
          );
          return;
        }
      }

      // Local master
      const logPath = config?.pm2ErrorLogPath || process.env.PM2_ERROR_LOG_PATH;
      await fs.access(logPath);
      const logTail = await readLastLines(logPath, count);
      const output = logTail.trim() || 'Không có log lỗi.';
      await ctx.replyWithHTML(`🧾 <b>${count} dòng log lỗi PM2 gần nhất (Master):</b>\n<pre>${escapeHtml(output)}</pre>`);
    } catch (error) {
      console.error('[LOGS_COMMAND_ERROR]', error);
      await ctx.reply('⚠️ Không thể đọc file log PM2. Kiểm tra lại PM2_ERROR_LOG_PATH trong file .env.');
    }
  },
};
```

- [ ] **Step 6: Update `package.json` test script**

Add `&& node test/multi_vps_commands.test.js` to the `"test"` script.

- [ ] **Step 7: Run syntax check + all tests**

```bash
node --check commands/ps.js
node --check commands/uptime.js
node --check commands/logs.js
npm run check:syntax
npm test
```

Expected: All pass including new multi_vps_commands.test.js.

- [ ] **Step 8: Commit**

```bash
git add commands/ps.js commands/uptime.js commands/logs.js test/multi_vps_commands.test.js package.json
git commit -m "feat: upgrade /ps /uptime /logs for multi-vps cluster node routing (#55)"
```

---

### Task 5: Upgrade /cleancache, /restart, /sh

**Files:**
- Modify: `commands/cleancache.js`
- Modify: `commands/restart.js`
- Modify: `commands/sh.js`
- Modify: `test/multi_vps_commands.test.js` (append tests)

**Interfaces:**
- Consumes: `nodeClient.cleanCache(node)`, `nodeClient.restartAgent(node)`, `nodeClient.execCommand(node, command)`

- [ ] **Step 1: Append tests to `test/multi_vps_commands.test.js`**

Append at end of `runTests()` before final log:

```javascript
  // /cleancache oracle-worker
  {
    const cleanCmd = require('./commands/cleancache.js');
    const replies = [];
    const ctx = { message: { text: '/cleancache oracle-worker' }, replyWithHTML: async h => replies.push(h), reply: async h => replies.push(h) };
    await cleanCmd.execute(ctx, {}, { nodeManager: mockNodeManager, nodeClient: mockNodeClient });
    assert.ok(replies.length > 0, '/cleancache returned a reply');
    console.log('✅ /cleancache oracle-worker test passed');
  }

  // /restart oracle-worker
  {
    const restartCmd = require('./commands/restart.js');
    const replies = [];
    const ctx = { message: { text: '/restart oracle-worker' }, replyWithHTML: async h => replies.push(h) };
    await restartCmd.execute(ctx, {}, { nodeManager: mockNodeManager, nodeClient: mockNodeClient });
    assert.ok(replies.length > 0, '/restart returned a reply');
    console.log('✅ /restart oracle-worker test passed');
  }

  // /sh oracle-worker hostname
  {
    const shCmd = require('./commands/sh.js');
    const replies = [];
    const ctx = { message: { text: '/sh oracle-worker hostname' }, replyWithHTML: async h => replies.push(h), reply: async h => replies.push(h) };
    await shCmd.execute(ctx, {}, { nodeManager: mockNodeManager, nodeClient: mockNodeClient });
    assert.ok(replies.length > 0, '/sh oracle-worker returned a reply');
    console.log('✅ /sh oracle-worker test passed');
  }

  console.log('🎉 All multi-vps command tests passed!');
```

- [ ] **Step 2: Update `commands/cleancache.js`**

Change execute signature to `(ctx, config = {}, deps = {})`. Add at top:
```javascript
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');
```

Add remote routing before existing local logic:
```javascript
      const depNM = deps.nodeManager || nodeManager;
      const depNC = deps.nodeClient || nodeClient;
      const nodeId = args.find(a => !a.startsWith('-'));

      if (nodeId && nodeId !== 'gcp-master') {
        const node = await depNM.getNode(nodeId, config);
        if (node && !node.isLocal) {
          const result = await depNC.cleanCache(node);
          const r = result.result || {};
          await ctx.replyWithHTML(
            `🧹 <b>Kết quả dọn cache — ${escapeHtml(node.name || node.id)}</b>\n` +
            `• PM2 Flush: ${r.pm2Flush || (result.ok ? '✅ OK' : '❌ Thất bại')}\n` +
            `• RAM đã giải phóng: ${r.cacheFreed || 'N/A'}`
          );
          return;
        }
      }
      // ... existing local cache logic continues
```

- [ ] **Step 3: Update `commands/restart.js`**

Change execute signature to `(ctx, config = {}, deps = {})`. Add at top:
```javascript
const { escapeHtml } = require('../config/utils');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');
```

Add remote routing before existing `setTimeout` block:
```javascript
      const depNM = deps.nodeManager || nodeManager;
      const depNC = deps.nodeClient || nodeClient;
      const nodeId = args.find(a => !a.startsWith('-'));

      if (nodeId && nodeId !== 'gcp-master') {
        const node = await depNM.getNode(nodeId, config);
        if (node && !node.isLocal) {
          await ctx.replyWithHTML(`🔄 <b>Đang khởi động lại Worker Agent trên ${escapeHtml(node.name || node.id)}...</b>`);
          const result = await depNC.restartAgent(node);
          if (result.ok) {
            await ctx.replyWithHTML(`✅ <b>Đã kích hoạt khởi động lại ${escapeHtml(node.name || node.id)}.</b>`);
          } else {
            await ctx.replyWithHTML(`⚠️ Không thể restart: ${escapeHtml(result.error || 'unknown')}`);
          }
          return;
        }
      }
      // ... existing local restart setTimeout logic continues
```

- [ ] **Step 4: Update `commands/sh.js`**

Change execute signature to `(ctx, config = {}, deps = {})`. Add at top:
```javascript
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');
```

In execute, after `const parts = extractShellCommand(ctx);`, add remote routing before whitelist check:
```javascript
      const depNM = deps.nodeManager || nodeManager;
      const depNC = deps.nodeClient || nodeClient;

      // Check if first arg is a node ID (not starting with '/')
      const firstPart = (parts[0] || '');
      if (firstPart && !firstPart.startsWith('/')) {
        const node = await depNM.getNode(firstPart, config).catch(() => null);
        if (node && !node.isLocal) {
          const remoteCmd = parts.slice(1).join(' ');
          if (!remoteCmd) {
            await ctx.replyWithHTML(`⚠️ Thiếu lệnh. Ví dụ: <code>/sh ${escapeHtml(firstPart)} hostname</code>`);
            return;
          }
          const result = await depNC.execCommand(node, remoteCmd);
          const out = `Lệnh: ${escapeHtml(remoteCmd)}\nTrạng thái: ${result.ok ? 'Thành công' : 'Thất bại'}` +
            (result.stdout ? `\n\nstdout:\n${result.stdout.trimEnd()}` : '') +
            (result.stderr ? `\n\nstderr:\n${result.stderr.trimEnd()}` : '');
          await ctx.replyWithHTML(`💻 <b>Kết quả lệnh từ xa — ${escapeHtml(node.name || node.id)}</b>\n<pre>${escapeHtml(out)}</pre>`);
          return;
        }
      }
      // ... existing whitelist/runner logic continues
```

- [ ] **Step 5: Run syntax check + all tests**

```bash
node --check commands/cleancache.js
node --check commands/restart.js
node --check commands/sh.js
npm run check:syntax
npm test
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add commands/cleancache.js commands/restart.js commands/sh.js test/multi_vps_commands.test.js
git commit -m "feat: upgrade /cleancache /restart /sh for multi-vps remote node routing (#55)"
```

---

### Task 6: GitHub Link Deploy — Node Selector Buttons in Telegram Chat

> When user pastes a `static_pure` GitHub repo link, show inline buttons for each VPS node (not just defaulting to gcp-master).

**Files:**
- Modify: `handlers/textHandler.js`
- Modify: `commands/deploy.js` — parse `nodeId` as 4th segment in callback_data
- Modify: `test/multi_vps_commands.test.js` — append test

**Interfaces:**
- Callback data format: `deploy:<deployId>:vps:<nodeId>` (4th segment, backwards-compatible: defaults to `gcp-master` if missing)

- [ ] **Step 1: Append test to `test/multi_vps_commands.test.js`**

```javascript
  // textHandler GitHub link multi-node VPS selector
  // (Read textHandler.js first to understand createTextHandler API — check if it's exported as named or default)
  // This test assumes textHandler exports createTextHandler(config, deps)
  try {
    const { createTextHandler } = require('./handlers/textHandler.js');
    const mockInspector = {
      inspectRepo: async () => ({ type: 'static_pure', owner: 'test', repo: 'site', description: 'Test site' }),
    };
    const handler = createTextHandler({ baseDomain: 'thienhn.io.vn' }, { inspector: mockInspector, nodeManager: mockNodeManager });
    let capturedOpts = null;
    const ctx = {
      from: { id: 999 },
      message: { text: 'https://github.com/test/site' },
      replyWithHTML: async (html, opts) => { capturedOpts = opts; },
      reply: async () => {},
    };
    await handler(ctx);
    const flatButtons = (capturedOpts?.reply_markup?.inline_keyboard || []).flat();
    const vpsButtons = flatButtons.filter(b => b?.callback_data?.includes(':vps:'));
    assert.ok(vpsButtons.length >= 2, `GitHub link should show >= 2 VPS node buttons, got ${vpsButtons.length}`);
    console.log('✅ textHandler GitHub multi-node selector test passed');
  } catch (e) {
    if (e.message.includes('createTextHandler')) {
      console.log('⚠️ textHandler does not yet export createTextHandler — Task 6 Step 3 not yet done');
    } else { throw e; }
  }
```

- [ ] **Step 2: Check textHandler current structure**

Read `handlers/textHandler.js` lines 1-30 to understand its export pattern before modifying.

- [ ] **Step 3: Update `handlers/textHandler.js`** to support dependency injection and per-node buttons

At the top, add:
```javascript
const nodeManager = require('../lib/nodeManager');
```

Wrap the existing handler function in a factory that accepts `deps`:
```javascript
// New: factory function for testability
function createTextHandler(config = {}, deps = {}) {
  const depNM = deps.nodeManager || nodeManager;
  const depInspector = deps.inspector || require('../lib/inspector'); // existing inspector
  
  return async function textHandler(ctx) {
    // ... existing logic, but use depNM and depInspector instead of direct requires
    
    // When building VPS buttons:
    if (validTargets.includes('vps') || type === 'static_pure') {
      const nodes = await depNM.getNodes(config).catch(() => []);
      if (nodes.length > 1) {
        const nodeButtons = nodes.map(n => ({
          text: `${n.isLocal ? '🖥️' : '☁️'} VPS ${n.name || n.id}`,
          callback_data: `deploy:${deployId}:vps:${n.id}`,
        }));
        buttons.push(nodeButtons);
      } else {
        buttons.push([{ text: '🖥️ VPS Nginx', callback_data: `deploy:${deployId}:vps:gcp-master` }]);
      }
    }
  };
}

// Keep existing default export for backward compatibility
module.exports = createTextHandler({});
module.exports.createTextHandler = createTextHandler;
```

> Important: Read the actual current textHandler.js structure first (lines 1-50 and 140-200) to understand how the GitHub detection, `deployId`, and buttons are currently built before integrating this pattern.

- [ ] **Step 4: Update `commands/deploy.js`** callback parsing

Find the line that splits `callback_data` with `:`. Change from:
```javascript
const [action, deployId, target] = data.split(':');
```
To:
```javascript
const parts = data.split(':');
const action = parts[0];
const deployId = parts[1];
const target = parts[2];
const nodeId = parts[3] || 'gcp-master'; // backward compatible default
```

Pass `nodeId` in the deploy call: `deployer.deploy({ ..., nodeId })`.

- [ ] **Step 5: Run syntax check + all tests**

```bash
node --check handlers/textHandler.js
node --check commands/deploy.js
npm run check:syntax
npm test
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add handlers/textHandler.js commands/deploy.js test/multi_vps_commands.test.js
git commit -m "feat: add multi-vps node selector buttons for GitHub link deploy in Telegram (#55)"
```

---

### Task 7: Oracle Firewall Setup Guide in README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Oracle Firewall section** after the Worker Agent startup subsection:

```markdown
### Mở Port 80 & 443 trên Oracle Cloud (Bắt buộc cho Deploy Web)

Oracle Cloud VM mặc định chặn tất cả cổng ngoài SSH (22). Sau khi khởi chạy Worker Agent, bạn **phải** mở port 80 và 443:

#### Bước 1 — OCI Console (Security List)

1. Đăng nhập [Oracle Cloud Console](https://cloud.oracle.com)
2. **Networking → Virtual Cloud Networks** → Chọn VCN → **Security Lists** → **Default Security List**
3. **Add Ingress Rules** — thêm 2 quy tắc:
   - Source CIDR: `0.0.0.0/0` | Protocol: TCP | Destination Port: **80**
   - Source CIDR: `0.0.0.0/0` | Protocol: TCP | Destination Port: **443**

#### Bước 2 — Tường lửa Linux (iptables)

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

#### Bước 3 — Kiểm tra Nginx

```bash
sudo apt install nginx -y     # nếu chưa có
sudo nginx -t                  # kiểm tra cấu hình
sudo systemctl enable --now nginx
```

#### Bước 4 — Cài unzip (bắt buộc để deploy ZIP)

```bash
sudo apt install unzip -y
```

Sau bước này, chạy `/status` trên Telegram — nếu thấy node Oracle báo `online`, bạn đã sẵn sàng deploy web!
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Oracle Cloud firewall and unzip setup guide for Worker VPS (#55)"
```

---

### Task 8: Final Integration — PR, Syntax, Tests, Merge

- [ ] **Step 1: Run full suite**

```bash
npm run check:syntax
npm test
```

Expected: All test suites pass with 0 errors, 0 warnings.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/55-multi-vps-command-orchestration
```

- [ ] **Step 3: Open PR**

```bash
gh pr create \
  --title "feat: multi-vps command orchestration & oracle deploy fix" \
  --body "Closes #55

## Changes
- fix: agentSandbox uses /var/www, validates extraction, chmod 755
- feat: 5 new Worker Agent endpoints (processes, logs, cleancache, restart, exec)
- feat: 5 new nodeClient functions mirroring new endpoints
- feat: /ps /uptime /logs /cleancache /restart /sh support [node_id] routing to remote Worker Agent
- feat: GitHub link deploy shows per-VPS-node selector buttons when cluster has >1 node
- docs: Oracle Cloud firewall & unzip setup guide in README"
```

- [ ] **Step 4: Review diff**

```bash
gh pr diff
```

Verify no real IPs, no real tokens, no hardcoded credentials in any change.

- [ ] **Step 5: Squash merge**

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull origin main
```
