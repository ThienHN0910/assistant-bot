const assert = require('assert');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const {
  createSessionToken,
  createDashboardServer,
} = require('../services/dashboardApi');

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: json, raw: data });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      if (Buffer.isBuffer(postData)) {
        req.write(postData);
      } else if (typeof postData === 'object') {
        req.write(JSON.stringify(postData));
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

async function runTests() {
  const secret = 'super-secret-key-for-test-suite';
  const authorizedEmail = 'hnt.vn.vn@gmail.com';
  const validToken = createSessionToken(authorizedEmail, secret);

  const mockConfig = {
    authorizedGoogleEmail: authorizedEmail,
    googleClientId: 'mock-google-client-id.apps.googleusercontent.com',
    sessionSecret: secret,
    vpsPublicIp: '140.238.100.60',
    pm2ErrorLogPath: path.resolve(__dirname, 'mock_pm2_error.log'),
    notesFilePath: path.resolve(__dirname, 'mock_notes.txt'),
  };

  // Mock PM2 log file
  await fs.writeFile(mockConfig.pm2ErrorLogPath, 'Error: line 1\nError: line 2\nError: line 3\n', 'utf8');
  // Mock notes file
  await fs.writeFile(mockConfig.notesFilePath, '2026-09-26 Note 1\n2026-09-26 Note 2\n', 'utf8');

  const mockNodeManager = {
    getNode: async (id) => {
      if (id === 'oracle-worker') {
        return { id: 'oracle-worker', name: 'Oracle Worker', ip: '168.107.83.235', isLocal: false };
      }
      return { id: 'gcp-master', name: 'GCP Master', ip: '34.10.66.133', isLocal: true };
    },
    getNodes: async () => [
      { id: 'gcp-master', name: 'GCP Master', ip: '34.10.66.133', isLocal: true },
      { id: 'oracle-worker', name: 'Oracle Worker', ip: '168.107.83.235', isLocal: false },
    ],
    maskIp: (ip) => `${ip.split('.')[0]}.***.***.${ip.split('.')[3]}`,
  };

  const mockNodeClient = {
    getProcesses: async (node) => ({
      ok: true,
      processes: [
        { pid: 101, name: 'node-worker', mem: 15.2, cpu: 2.1, user: 'ubuntu' },
      ],
    }),
    getLogs: async (node, count) => ({
      ok: true,
      log: `Worker log tail of ${count} lines from ${node.name}`,
    }),
    cleanCache: async (node) => ({
      ok: true,
      result: { pm2Flush: 'flushed', cacheFreed: 'freed' },
    }),
    restartAgent: async (node) => ({
      ok: true,
      message: `Worker ${node.name} restarting`,
    }),
    update: async (node) => ({
      ok: true,
      output: `Updated ${node.name} successfully`,
    }),
    execCommand: async (node, command) => ({
      ok: true,
      stdout: `Worker output for: ${command}`,
      stderr: '',
    }),
  };

  const mockSi = {
    processes: async () => ({
      list: [
        { pid: 1, name: 'systemd', mem: 1.0, cpu: 0.1, user: 'root' },
        { pid: 200, name: 'assistant-bot', mem: 8.5, cpu: 1.2, user: 'hnt' },
      ],
    }),
  };

  const mockWhitelist = {
    getCommands: (alias, args) => {
      if (alias === 'pm2-list') return [{ cmd: 'pm2', args: ['list'] }];
      throw new Error(`Alias không hợp lệ: ${alias}`);
    },
    listAliases: () => ['pm2-list', 'git-status'],
  };

  const mockRunner = {
    runSequence: async (commands) => [
      { ok: true, stdout: 'Mock runner success\n', stderr: '', code: 0 },
    ],
  };

  const server = createDashboardServer(mockConfig, {
    nodeManager: mockNodeManager,
    nodeClient: mockNodeClient,
    si: mockSi,
    whitelist: mockWhitelist,
    runner: mockRunner,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    console.log('--- Testing /api/processes ---');
    // 1. Unauthorized
    let res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/processes',
      method: 'GET',
    });
    assert.strictEqual(res.status, 401, 'Should require authentication');

    // 2. Local node processes
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/processes',
      method: 'GET',
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.node.id, 'gcp-master');
    assert.strictEqual(Array.isArray(res.data.processes), true);
    assert.strictEqual(res.data.processes.length, 2);
    assert.strictEqual(res.data.processes[0].name, 'assistant-bot'); // sorted by mem

    // 3. Remote node processes
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/processes?nodeId=oracle-worker',
      method: 'GET',
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.node.id, 'oracle-worker');
    assert.strictEqual(res.data.processes[0].name, 'node-worker');

    console.log('--- Testing /api/logs ---');
    // 4. Local logs
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/logs?lines=2',
      method: 'GET',
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.node.id, 'gcp-master');
    assert.ok(res.data.logs.includes('Error: line 3'));

    // 5. Remote logs
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/logs?nodeId=oracle-worker&lines=50',
      method: 'GET',
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.node.id, 'oracle-worker');
    assert.ok(res.data.logs.includes('Worker log tail of 50 lines'));
    console.log('✅ Task 1 diagnostic tests passed!');

    console.log('--- Testing /api/cleancache ---');
    // Local cleancache
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/cleancache',
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    }, { nodeId: 'gcp-master' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);

    // Remote cleancache
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/cleancache',
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    }, { nodeId: 'oracle-worker' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.result.pm2Flush, 'flushed');

    console.log('--- Testing /api/restart ---');
    // Remote restart
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/restart',
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    }, { nodeId: 'oracle-worker' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);

    // Local restart
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/restart',
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    }, { nodeId: 'gcp-master' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);

    console.log('--- Testing /api/update ---');
    // Remote update
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/update',
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    }, { nodeId: 'oracle-worker' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);

    // Local update
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/update',
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    }, { nodeId: 'gcp-master' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);

    console.log('--- Testing /api/sh ---');
    // Remote sh
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/sh',
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    }, { nodeId: 'oracle-worker', command: 'uptime' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.ok(res.data.output.includes('Worker output for: uptime'));

    // Local sh with whitelist alias
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/sh',
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    }, { nodeId: 'gcp-master', command: '/pm2-list' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.ok(res.data.output.includes('Mock runner success'));

    // Local sh with illegal command (not whitelisted)
    res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/sh',
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}`, 'Content-Type': 'application/json' },
    }, { nodeId: 'gcp-master', command: 'rm -rf /' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.ok, false);

    console.log('✅ Task 2 operations tests passed!');
  } finally {
    server.close();
    await fs.unlink(mockConfig.pm2ErrorLogPath).catch(() => {});
    await fs.unlink(mockConfig.notesFilePath).catch(() => {});
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
