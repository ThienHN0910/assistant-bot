# Multi-VPS Hub-and-Spoke Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-VPS orchestrator enabling centralized telemetry, multi-target VPS deployment with automated Cloudflare DNS routing, and cluster maintenance across GCP Master, Oracle Worker, and future VPS instances.

**Architecture:** Hub-and-spoke model where the primary GCP VPS runs the Telegram Bot, Dashboard, and Node Manager, while secondary VPS nodes run an ultra-lightweight Node.js REST daemon (`assistant-node-agent` < 25 MB RAM). Communication is authenticated with pre-shared secrets (`X-Agent-Secret`). Cloudflare DNS assigns proxied A records pointing to the public IP of the targeted node.

**Tech Stack:** Node.js (>= 18), systeminformation, Axios, Telegraf, Cloudflare API v4, Nginx.

**Spec:** `docs/superpowers/specs/2026-09-26-multi-vps-orchestrator-design.md` and `docs/adr/0004-multi-vps-hub-and-spoke-orchestrator.md`.

## Global Constraints
- Target RAM overhead for worker agent: < 25 MB.
- Zero-leakage secrets hygiene: No real IPs or agent secrets in tracked files.
- Backward compatibility: If no worker nodes are configured, system defaults to single-host local execution seamlessly.
- Strict test gate: All syntax checks (`npm run check:syntax`) and tests (`npm test`) must pass before commits.

---

### Task 1: Node Registry & Topology Manager

**Files:**
- Create: `lib/nodeManager.js`
- Modify: `config/env.js`
- Test: `test/node_manager.test.js`

**Interfaces:**
- Consumes: `config.nodesConfigPath`, `config.nodesConfig`, `config.vpsPublicIp`
- Produces: `nodeManager.getNodes(config)`, `nodeManager.getNode(id, config)`, `nodeManager.addNode(node, config)`, `nodeManager.maskIp(ip)`

- [ ] **Step 1: Write the failing test**

```javascript
// test/node_manager.test.js
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const nodeManager = require('../lib/nodeManager');

async function runTests() {
  const tmpDir = path.join(os.tmpdir(), `node-mgr-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const testNodesPath = path.join(tmpDir, 'nodes.json');

  try {
    const config = {
      nodesConfigPath: testNodesPath,
      vpsPublicIp: '104.198.10.20',
    };

    // 1. Default local node fallback
    const initialNodes = await nodeManager.getNodes(config);
    assert.strictEqual(Array.isArray(initialNodes), true);
    assert.strictEqual(initialNodes.length, 1);
    assert.strictEqual(initialNodes[0].id, 'gcp-master');
    assert.strictEqual(initialNodes[0].isLocal, true);
    assert.strictEqual(initialNodes[0].ip, '104.198.10.20');

    // 2. Add remote worker node
    const newNode = {
      id: 'oracle-worker',
      name: 'Oracle Cloud VM',
      ip: '140.238.50.60',
      agentUrl: 'http://140.238.50.60:3001',
      secret: 'secret-test-token',
      isLocal: false,
    };
    await nodeManager.addNode(newNode, config);

    const updatedNodes = await nodeManager.getNodes(config);
    assert.strictEqual(updatedNodes.length, 2);

    const fetched = await nodeManager.getNode('oracle-worker', config);
    assert.strictEqual(fetched.name, 'Oracle Cloud VM');
    assert.strictEqual(fetched.ip, '140.238.50.60');

    // 3. Mask IP
    const masked = nodeManager.maskIp('140.238.50.60');
    assert.strictEqual(masked, '140.***.***.60');

    console.log('✅ nodeManager unit tests passed');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

runTests().catch((err) => {
  console.error('❌ nodeManager test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/node_manager.test.js`
Expected: FAIL with "Cannot find module '../lib/nodeManager'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/nodeManager.js
const fs = require('fs/promises');
const path = require('path');

function maskIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  const parts = ip.trim().split('.');
  if (parts.length === 4) {
    return `${parts[0]}.***.***.${parts[3]}`;
  }
  return ip;
}

function getDefaultLocalNode(config = {}) {
  return {
    id: 'gcp-master',
    name: 'GCP e2-micro (Master)',
    ip: config.vpsPublicIp || '127.0.0.1',
    isLocal: true,
    status: 'online',
  };
}

async function getNodes(config = {}) {
  const filePath = config.nodesConfigPath || path.resolve(process.cwd(), 'data/nodes.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[NODE_MANAGER] Failed reading nodes.json: ${err.message}`);
    }
  }

  if (config.nodesConfig) {
    try {
      const parsedEnv = typeof config.nodesConfig === 'string' ? JSON.parse(config.nodesConfig) : config.nodesConfig;
      if (Array.isArray(parsedEnv) && parsedEnv.length > 0) return parsedEnv;
    } catch {}
  }

  return [getDefaultLocalNode(config)];
}

async function saveNodes(nodes, config = {}) {
  const filePath = config.nodesConfigPath || path.resolve(process.cwd(), 'data/nodes.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(nodes, null, 2), 'utf8');
}

async function getNode(id, config = {}) {
  const nodes = await getNodes(config);
  return nodes.find((n) => n.id === id) || null;
}

async function addNode(node, config = {}) {
  if (!node || !node.id || !node.ip) {
    throw new Error('Node must specify id and ip');
  }
  const nodes = await getNodes(config);
  const existingIdx = nodes.findIndex((n) => n.id === node.id);
  const cleanNode = {
    ...node,
    isLocal: Boolean(node.isLocal),
    status: node.status || 'online',
  };

  if (existingIdx >= 0) {
    nodes[existingIdx] = cleanNode;
  } else {
    nodes.push(cleanNode);
  }
  await saveNodes(nodes, config);
  return cleanNode;
}

async function removeNode(id, config = {}) {
  const nodes = await getNodes(config);
  const filtered = nodes.filter((n) => n.id !== id);
  if (filtered.length === nodes.length) return false;
  await saveNodes(filtered, config);
  return true;
}

module.exports = {
  maskIp,
  getDefaultLocalNode,
  getNodes,
  saveNodes,
  getNode,
  addNode,
  removeNode,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/node_manager.test.js`
Expected: PASS with "✅ nodeManager unit tests passed"

- [ ] **Step 5: Commit**

```bash
git add lib/nodeManager.js test/node_manager.test.js
git commit -m "feat: add cluster node topology manager (#51)"
```

---

### Task 2: Worker Agent Micro-Service Daemon

**Files:**
- Create: `agent/server.js`, `agent/agentSandbox.js`, `agent/package.json`
- Test: `test/worker_agent.test.js`

**Interfaces:**
- Consumes: Node.js `http`, `systeminformation`, `X-Agent-Secret`
- Produces: REST endpoints `GET /api/health`, `GET /api/metrics`, `POST /api/deploy`, `POST /api/undeploy`, `POST /api/update`

- [ ] **Step 1: Write the failing test**

```javascript
// test/worker_agent.test.js
const assert = require('assert');
const http = require('http');
const { createAgentServer } = require('../agent/server');

async function makeRequest(server, options, bodyData = null) {
  const addr = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      ...options,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function runTests() {
  const secret = 'test-worker-secret-123';
  const server = createAgentServer({
    secret,
    metricsProvider: async () => ({
      cpuLoad: 15,
      memory: { usedBytes: 300000000, totalBytes: 1000000000 },
      uptimeSeconds: 12345,
    }),
  });

  await new Promise((resolve) => server.listen(0, resolve));

  try {
    // 1. Health check without auth
    const healthRes = await makeRequest(server, { path: '/api/health', method: 'GET' });
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.data.ok, true);

    // 2. Metrics without auth -> 401
    const unauthMetrics = await makeRequest(server, { path: '/api/metrics', method: 'GET' });
    assert.strictEqual(unauthMetrics.status, 401);

    // 3. Metrics with auth -> 200
    const authMetrics = await makeRequest(server, {
      path: '/api/metrics',
      method: 'GET',
      headers: { 'X-Agent-Secret': secret },
    });
    assert.strictEqual(authMetrics.status, 200);
    assert.strictEqual(authMetrics.data.ok, true);
    assert.strictEqual(authMetrics.data.metrics.cpuLoad, 15);

    console.log('✅ worker agent server tests passed');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('❌ worker agent test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/worker_agent.test.js`
Expected: FAIL with "Cannot find module '../agent/server'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// agent/server.js
const http = require('http');
const si = require('systeminformation');
const agentSandbox = require('./agentSandbox');

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function parseBufferBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function checkAgentAuth(req, expectedSecret) {
  if (!expectedSecret) return true;
  const provided = req.headers['x-agent-secret'];
  return Boolean(provided && provided === expectedSecret);
}

function createAgentServer(options = {}) {
  const secret = options.secret || process.env.NODE_AGENT_SECRET || '';
  const sandbox = options.sandbox || agentSandbox;
  const metricsProvider = options.metricsProvider || (async () => {
    const [cpu, mem, time] = await Promise.all([
      si.currentLoad().catch(() => ({ currentLoad: 0 })),
      si.mem().catch(() => ({ total: 1, used: 0 })),
      si.time(),
    ]);
    return {
      cpuLoad: Math.round(cpu.currentLoad || 0),
      memory: {
        totalBytes: mem.total,
        usedBytes: mem.used,
        usedPercentage: Math.round((mem.used / (mem.total || 1)) * 100),
      },
      uptimeSeconds: time?.uptime || process.uptime(),
    };
  });

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://localhost');
    const pathname = urlObj.pathname;

    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, status: 'healthy', version: '2.0.0' });
      return;
    }

    if (!checkAgentAuth(req, secret)) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized: Invalid X-Agent-Secret' });
      return;
    }

    if (pathname === '/api/metrics' && req.method === 'GET') {
      try {
        const metrics = await metricsProvider();
        sendJson(res, 200, { ok: true, metrics });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/deploy' && req.method === 'POST') {
      try {
        const projectName = req.headers['x-project-name'] || urlObj.searchParams.get('project');
        const subdomain = req.headers['x-subdomain'] || projectName;
        if (!projectName) {
          sendJson(res, 400, { ok: false, error: 'x-project-name header is required' });
          return;
        }
        const zipBuffer = await parseBufferBody(req);
        if (!zipBuffer || zipBuffer.length === 0) {
          sendJson(res, 400, { ok: false, error: 'ZIP binary payload is empty' });
          return;
        }
        const deployRes = await sandbox.deployZipPayload(zipBuffer, projectName, subdomain);
        sendJson(res, 200, { ok: true, deployment: deployRes });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/undeploy' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const projectName = body.projectName || urlObj.searchParams.get('project');
        if (!projectName) {
          sendJson(res, 400, { ok: false, error: 'projectName is required' });
          return;
        }
        const result = await sandbox.removeProject(projectName);
        sendJson(res, 200, { ok: true, removed: result });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/update' && req.method === 'POST') {
      try {
        const result = await sandbox.runSelfUpdate();
        sendJson(res, 200, { ok: true, update: result });
        if (options.autoRestart !== false) {
          setTimeout(() => {
            if (typeof sandbox.restartSelf === 'function') sandbox.restartSelf();
          }, 500);
        }
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not Found' });
  });

  return server;
}

if (require.main === module) {
  const port = process.env.AGENT_PORT || 3001;
  const server = createAgentServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`[ASSISTANT_NODE_AGENT] Listening on port ${port}`);
  });
}

module.exports = {
  createAgentServer,
};
```

Create minimal `agent/agentSandbox.js`:
```javascript
// agent/agentSandbox.js
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function deployZipPayload(zipBuffer, projectName, subdomain) {
  return {
    ok: true,
    projectName,
    subdomain,
    type: 'static',
    domain: `${subdomain}.thienhn.io.vn`,
  };
}

async function removeProject(projectName) {
  return { ok: true, projectName };
}

async function runSelfUpdate() {
  try {
    const { stdout } = await execFileAsync('git', ['pull', 'origin', 'main'], { timeout: 30000 });
    return { ok: true, output: stdout.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function restartSelf() {
  execFile('pm2', ['restart', 'assistant-node-agent'], () => {});
}

module.exports = {
  deployZipPayload,
  removeProject,
  runSelfUpdate,
  restartSelf,
};
```

Create `agent/package.json`:
```json
{
  "name": "assistant-node-agent",
  "version": "2.0.0",
  "description": "Ultra-lightweight REST daemon for assistant-bot worker nodes",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "systeminformation": "^5.23.5"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/worker_agent.test.js`
Expected: PASS with "✅ worker agent server tests passed"

- [ ] **Step 5: Commit**

```bash
git add agent/ test/worker_agent.test.js
git commit -m "feat: add lightweight worker node agent daemon (#51)"
```

---

### Task 3: Master-to-Worker REST Client

**Files:**
- Create: `lib/nodeClient.js`
- Test: `test/node_client.test.js`

**Interfaces:**
- Consumes: Axios/HTTP client, Node Registry nodes
- Produces: `nodeClient.getMetrics(node, client)`, `nodeClient.deploy(node, options, client)`, `nodeClient.undeploy(node, projectName, client)`, `nodeClient.update(node, client)`

- [ ] **Step 1: Write the failing test**

```javascript
// test/node_client.test.js
const assert = require('assert');
const nodeClient = require('../lib/nodeClient');

async function runTests() {
  const fakeClient = {
    async get(url, opts) {
      if (url.includes('/api/metrics')) {
        assert.strictEqual(opts.headers['X-Agent-Secret'], 'test-secret');
        return { data: { ok: true, metrics: { cpuLoad: 22 } } };
      }
      throw new Error(`Unexpected GET ${url}`);
    },
    async post(url, body, opts) {
      if (url.includes('/api/deploy')) {
        assert.strictEqual(opts.headers['x-project-name'], 'demo-app');
        return { data: { ok: true, deployment: { domain: 'demo-app.thienhn.io.vn' } } };
      }
      if (url.includes('/api/undeploy')) {
        return { data: { ok: true, removed: true } };
      }
      throw new Error(`Unexpected POST ${url}`);
    },
  };

  const node = {
    id: 'oracle-node',
    agentUrl: 'http://140.238.50.60:3001',
    secret: 'test-secret',
  };

  const metrics = await nodeClient.getMetrics(node, fakeClient);
  assert.strictEqual(metrics.ok, true);
  assert.strictEqual(metrics.metrics.cpuLoad, 22);

  const deployed = await nodeClient.deploy(node, { projectName: 'demo-app', zipBuffer: Buffer.from('pk') }, fakeClient);
  assert.strictEqual(deployed.ok, true);
  assert.strictEqual(deployed.deployment.domain, 'demo-app.thienhn.io.vn');

  console.log('✅ nodeClient unit tests passed');
}

runTests().catch((err) => {
  console.error('❌ nodeClient test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/node_client.test.js`
Expected: FAIL with "Cannot find module '../lib/nodeClient'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/nodeClient.js
const axios = require('axios');

function resolveAgentUrl(node) {
  if (node.agentUrl) return node.agentUrl.replace(/\/+$/, '');
  const port = node.port || 3001;
  return `http://${node.ip}:${port}`;
}

async function getMetrics(node, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/metrics`;
  try {
    const res = await client.get(url, {
      headers: { 'X-Agent-Secret': node.secret || '' },
      timeout: 5000,
    });
    return res.data;
  } catch (err) {
    return { ok: false, error: err.message, status: 'offline' };
  }
}

async function deploy(node, { projectName, subdomain, zipBuffer }, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/deploy`;
  const res = await client.post(url, zipBuffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Agent-Secret': node.secret || '',
      'x-project-name': projectName,
      'x-subdomain': subdomain || projectName,
    },
    timeout: 60000,
  });
  return res.data;
}

async function undeploy(node, projectName, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/undeploy`;
  const res = await client.post(url, { projectName }, {
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Secret': node.secret || '',
    },
    timeout: 15000,
  });
  return res.data;
}

async function update(node, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/update`;
  const res = await client.post(url, {}, {
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Secret': node.secret || '',
    },
    timeout: 30000,
  });
  return res.data;
}

module.exports = {
  resolveAgentUrl,
  getMetrics,
  deploy,
  undeploy,
  update,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/node_client.test.js`
Expected: PASS with "✅ nodeClient unit tests passed"

- [ ] **Step 5: Commit**

```bash
git add lib/nodeClient.js test/node_client.test.js
git commit -m "feat: add remote node agent HTTP client (#51)"
```

---

### Task 4: Multi-Target VPS Routing in Deployer

**Files:**
- Modify: `lib/deployer.js`
- Test: `test/multi_vps_deployer.test.js`

**Interfaces:**
- Consumes: `lib/nodeManager`, `lib/nodeClient`, `lib/providers/cloudflare`
- Produces: `deployer.deploy` supports `nodeId`, attaches DNS A record to chosen node's IP, records `nodeId` in `data/deployments.json`

- [ ] **Step 1: Write the failing test**

```javascript
// test/multi_vps_deployer.test.js
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const deployer = require('../lib/deployer');

async function runTests() {
  const tmpDir = path.join(os.tmpdir(), `multi-deploy-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const registryPath = path.join(tmpDir, 'deployments.json');
  const dummyZip = path.join(tmpDir, 'testapp.zip');
  await fs.writeFile(dummyZip, 'dummy');

  let passedDns = null;
  let remoteDeployCalled = false;

  const mockDeps = {
    cloudflare: {
      isEnabled: () => true,
      resolveFullDomain: (sub) => `${sub}.thienhn.io.vn`,
      findDnsRecord: async () => null,
      upsertARecord: async (params) => {
        passedDns = params;
        return { ok: true, recordId: 'dns-rec-oracle-123' };
      },
    },
    nodeClient: {
      deploy: async (node, opts) => {
        remoteDeployCalled = true;
        return { ok: true, deployment: { domain: `${opts.projectName}.thienhn.io.vn` } };
      },
    },
    nodeManager: {
      getNode: async (id) => {
        if (id === 'oracle-worker') {
          return {
            id: 'oracle-worker',
            name: 'Oracle Cloud VM',
            ip: '140.238.100.200',
            isLocal: false,
          };
        }
        return { id: 'gcp-master', ip: '104.198.1.1', isLocal: true };
      },
    },
  };

  const config = {
    deployRegistryPath: registryPath,
    cloudflareApiToken: 'token',
    cloudflareZoneId: 'zone',
    baseDomain: 'thienhn.io.vn',
  };

  const result = await deployer.deploy(
    {
      source: 'zip_upload',
      sourcePath: dummyZip,
      projectName: 'test-oracle-app',
      target: 'vps',
      nodeId: 'oracle-worker',
    },
    config,
    mockDeps
  );

  assert.strictEqual(remoteDeployCalled, true);
  assert.strictEqual(passedDns.ip, '140.238.100.200');
  assert.strictEqual(result.deployment.nodeId, 'oracle-worker');
  assert.strictEqual(result.deployment.dnsRecordId, 'dns-rec-oracle-123');

  console.log('✅ multi-vps deployer tests passed');
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}

runTests().catch((err) => {
  console.error('❌ multi-vps deployer test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/multi_vps_deployer.test.js`
Expected: FAIL because `nodeId` is not yet routed in `lib/deployer.js`

- [ ] **Step 3: Update `lib/deployer.js` to route remote nodes**

In `lib/deployer.js`:
- Import `nodeManager` and `nodeClient`.
- In `deployUnlocked`, read `nodeId` from params.
- If `target === 'vps'`: fetch `selectedNode = await depNodeManager.getNode(nodeId || 'gcp-master', config)`.
- Use `selectedNode.ip` as `vpsIp`.
- If `!selectedNode.isLocal`: stream `zipBuffer` to `depNodeClient.deploy(selectedNode, ...)`.
- Save `nodeId: selectedNode.id` in `deployResult`.
- In `undeploy`, check `item.nodeId`. If remote, call `depNodeClient.undeploy(node, item.name)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/multi_vps_deployer.test.js`
Expected: PASS with "✅ multi-vps deployer tests passed"

- [ ] **Step 5: Commit**

```bash
git add lib/deployer.js test/multi_vps_deployer.test.js
git commit -m "feat: route VPS deployments to selected cluster nodes (#51)"
```

---

### Task 5: Centralized Multi-VPS Telegram Commands

**Files:**
- Modify: `commands/status.js`, `commands/update.js`, `commands/deploy.js`
- Create: `commands/nodes.js`
- Test: `test/multi_vps_telegram.test.js`

**Interfaces:**
- Consumes: `lib/nodeManager`, `lib/nodeClient`
- Produces: `/status` multi-node report, `/nodes` management, `/update all` fanout

- [ ] **Step 1: Write the failing test**

```javascript
// test/multi_vps_telegram.test.js
const assert = require('assert');
const statusCmd = require('../commands/status');

async function runTests() {
  let repliedText = '';
  const fakeCtx = {
    message: { text: '/status' },
    replyWithHTML: async (text) => { repliedText = text; },
  };

  const mockNodeManager = {
    getNodes: async () => [
      { id: 'gcp-master', name: 'GCP Master', ip: '104.1.2.3', isLocal: true },
      { id: 'oracle-worker', name: 'Oracle VM', ip: '140.4.5.6', isLocal: false },
    ],
    maskIp: (ip) => `${ip.split('.')[0]}.***.***`,
  };

  const mockNodeClient = {
    getMetrics: async (node) => ({
      ok: true,
      metrics: {
        cpuLoad: 8,
        memory: { usedBytes: 400000000, totalBytes: 1000000000 },
      },
    }),
  };

  await statusCmd.execute(fakeCtx, {
    nodeManager: mockNodeManager,
    nodeClient: mockNodeClient,
  });

  assert(repliedText.includes('GCP Master'));
  assert(repliedText.includes('Oracle VM'));
  console.log('✅ multi-vps telegram status test passed');
}

runTests().catch((err) => {
  console.error('❌ multi-vps telegram test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/multi_vps_telegram.test.js`
Expected: FAIL because `/status` does not yet accept multi-node dependencies

- [ ] **Step 3: Update `commands/status.js`, `commands/update.js`, `commands/nodes.js`**

Implement multi-node polling in `/status` and fan-out in `/update all`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/multi_vps_telegram.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/status.js commands/update.js commands/nodes.js test/multi_vps_telegram.test.js
git commit -m "feat: add multi-vps telemetry and update commands (#51)"
```

---

### Task 6: Multi-Node Telemetry & Target Selection in Dashboard

**Files:**
- Modify: `services/dashboardApi.js`, `dashboard/index.html`
- Test: `test/dashboard_multi_vps.test.js`

**Interfaces:**
- Consumes: `services/dashboardApi.js`
- Produces: `GET /api/status` returns `nodes: [...]`, `POST /api/deployments/deploy-git` accepts `nodeId`

- [ ] **Step 1: Write the failing test**

```javascript
// test/dashboard_multi_vps.test.js
const assert = require('assert');
const { createDashboardServer } = require('../services/dashboardApi');
const http = require('http');

async function runTests() {
  const mockNodeManager = {
    getNodes: async () => [
      { id: 'gcp-master', name: 'GCP Master', ip: '104.1.2.3', isLocal: true },
      { id: 'oracle-worker', name: 'Oracle VM', ip: '140.4.5.6', isLocal: false },
    ],
    maskIp: (ip) => `${ip.split('.')[0]}.***`,
  };

  const server = createDashboardServer(
    { authorizedGoogleEmail: 'test@example.com', sessionSecret: 'secret' },
    { nodeManager: mockNodeManager }
  );

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/api/nodes`, (r) => {
        let d = '';
        r.on('data', (c) => { d += c; });
        r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(d) }));
      }).on('error', reject);
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.nodes.length, 2);
    assert.strictEqual(res.data.nodes[1].ipMasked, '140.***');
    console.log('✅ dashboard multi-vps API test passed');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('❌ dashboard multi-vps test failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/dashboard_multi_vps.test.js`
Expected: FAIL with 404 or missing `/api/nodes`

- [ ] **Step 3: Update `services/dashboardApi.js` and `dashboard/index.html`**

- Add `GET /api/nodes` returning masked cluster nodes.
- Update `/api/status` to include cluster summary.
- Add node picker in `dashboard/index.html` deploy modal.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/dashboard_multi_vps.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/dashboardApi.js dashboard/index.html test/dashboard_multi_vps.test.js
git commit -m "feat: add multi-node cluster view and target selector to dashboard (#51)"
```

---

### Task 7: Full Verification Gate & Secret Audit

**Files:**
- Modify: `package.json` (add new tests to test script)

- [ ] **Step 1: Update `package.json` test scripts**
- [ ] **Step 2: Run `npm run check:syntax`**
- [ ] **Step 3: Run `npm test`**
- [ ] **Step 4: Verify zero secret leaks via `git diff`**
- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: include multi-vps test suites in verification gate (#51)"
```
