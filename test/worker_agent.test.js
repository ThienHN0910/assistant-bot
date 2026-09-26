const assert = require('assert');
const http = require('http');
const { EventEmitter } = require('events');
const {
  createAgentServer,
  checkAgentAuth,
  parseJsonBody,
  parseBufferBody,
} = require('../agent/server');

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
  let restartCalled = false;

  const mockSandbox = {
    deployZipPayload: async (buf, projectName, subdomain) => ({
      ok: true,
      projectName,
      subdomain,
      size: buf.length,
      domain: `${subdomain}.thienhn.io.vn`,
    }),
    removeProject: async (projectName) => ({ ok: true, projectName }),
    runSelfUpdate: async () => ({ ok: true, output: 'Already up to date.' }),
    restartSelf: () => { restartCalled = true; },
  };

  const server = createAgentServer({
    secret,
    sandbox: mockSandbox,
    autoRestart: false,
    maxJsonBytes: 100,
    maxZipBytes: 200,
    metricsProvider: async () => ({
      cpuLoad: 15,
      memory: { usedBytes: 300000000, totalBytes: 1000000000, usedPercentage: 30 },
      uptimeSeconds: 12345,
    }),
  });

  await new Promise((resolve) => server.listen(0, resolve));

  try {
    // 1. Health check without auth -> 200
    const healthRes = await makeRequest(server, { path: '/api/health', method: 'GET' });
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.data.ok, true);
    assert.strictEqual(healthRes.data.status, 'healthy');

    // 2. Metrics without auth -> 401
    const unauthMetrics = await makeRequest(server, { path: '/api/metrics', method: 'GET' });
    assert.strictEqual(unauthMetrics.status, 401);
    assert.strictEqual(unauthMetrics.data.ok, false);

    // 3. Metrics with wrong auth -> 401
    const wrongAuthMetrics = await makeRequest(server, {
      path: '/api/metrics',
      method: 'GET',
      headers: { 'X-Agent-Secret': 'wrong-secret' },
    });
    assert.strictEqual(wrongAuthMetrics.status, 401);

    // 4. Metrics with valid auth -> 200
    const authMetrics = await makeRequest(server, {
      path: '/api/metrics',
      method: 'GET',
      headers: { 'X-Agent-Secret': secret },
    });
    assert.strictEqual(authMetrics.status, 200);
    assert.strictEqual(authMetrics.data.ok, true);
    assert.strictEqual(authMetrics.data.metrics.cpuLoad, 15);
    assert.strictEqual(authMetrics.data.metrics.uptimeSeconds, 12345);

    // 5. Deploy without project name header -> 400
    const deployNoProj = await makeRequest(server, {
      path: '/api/deploy',
      method: 'POST',
      headers: { 'X-Agent-Secret': secret },
    }, Buffer.from('dummy zip content'));
    assert.strictEqual(deployNoProj.status, 400);

    // 6. Deploy with empty payload -> 400
    const deployEmpty = await makeRequest(server, {
      path: '/api/deploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'X-Project-Name': 'demo-site',
      },
    }, Buffer.alloc(0));
    assert.strictEqual(deployEmpty.status, 400);

    // 7. Deploy successful -> 200
    const dummyZip = Buffer.from('fake zip archive data');
    const deploySuccess = await makeRequest(server, {
      path: '/api/deploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'X-Project-Name': 'demo-site',
        'X-Subdomain': 'demo',
      },
    }, dummyZip);
    assert.strictEqual(deploySuccess.status, 200);
    assert.strictEqual(deploySuccess.data.ok, true);
    assert.strictEqual(deploySuccess.data.deployment.projectName, 'demo-site');
    assert.strictEqual(deploySuccess.data.deployment.subdomain, 'demo');

    // 8. Undeploy without project name -> 400
    const undeployNoProj = await makeRequest(server, {
      path: '/api/undeploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'Content-Type': 'application/json',
      },
    }, JSON.stringify({}));
    assert.strictEqual(undeployNoProj.status, 400);

    // 9. Undeploy success -> 200
    const undeploySuccess = await makeRequest(server, {
      path: '/api/undeploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'Content-Type': 'application/json',
      },
    }, JSON.stringify({ projectName: 'demo-site' }));
    assert.strictEqual(undeploySuccess.status, 200);
    assert.strictEqual(undeploySuccess.data.ok, true);
    assert.strictEqual(undeploySuccess.data.removed.projectName, 'demo-site');

    // 10. Self-update -> 200
    const updateRes = await makeRequest(server, {
      path: '/api/update',
      method: 'POST',
      headers: { 'X-Agent-Secret': secret },
    });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.data.ok, true);
    assert.strictEqual(updateRes.data.update.output, 'Already up to date.');

    // 11. Unknown endpoint -> 404
    const notFound = await makeRequest(server, {
      path: '/api/unknown',
      method: 'GET',
      headers: { 'X-Agent-Secret': secret },
    });
    assert.strictEqual(notFound.status, 404);

    // 12. Max payload size guard for JSON (exceeds maxJsonBytes=100) -> 413
    const oversizedJson = JSON.stringify({ projectName: 'a'.repeat(150) });
    const jsonOverflow = await makeRequest(server, {
      path: '/api/undeploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'Content-Type': 'application/json',
      },
    }, oversizedJson);
    assert.strictEqual(jsonOverflow.status, 413);

    // 13. Max payload size guard for ZIP binary (exceeds maxZipBytes=200) -> 413
    const oversizedZip = Buffer.alloc(250, 'Z');
    const zipOverflow = await makeRequest(server, {
      path: '/api/deploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'X-Project-Name': 'large-project',
      },
    }, oversizedZip);
    assert.strictEqual(zipOverflow.status, 413);

    console.log('✅ worker agent server standard & size tests passed');
  } finally {
    server.close();
  }

  // 14. Fail-closed auth test when NODE_AGENT_SECRET is unset
  const unconfiguredServer = createAgentServer({
    secret: '',
    metricsProvider: async () => ({ cpuLoad: 5 }),
  });
  await new Promise((resolve) => unconfiguredServer.listen(0, resolve));
  try {
    // Health is public
    const hRes = await makeRequest(unconfiguredServer, { path: '/api/health', method: 'GET' });
    assert.strictEqual(hRes.status, 200);

    // Protected endpoints MUST fail closed (401) even if client sends header
    const mRes = await makeRequest(unconfiguredServer, {
      path: '/api/metrics',
      method: 'GET',
      headers: { 'X-Agent-Secret': 'some-guess' },
    });
    assert.strictEqual(mRes.status, 401);

    const mResEmpty = await makeRequest(unconfiguredServer, {
      path: '/api/metrics',
      method: 'GET',
      headers: { 'X-Agent-Secret': '' },
    });
    assert.strictEqual(mResEmpty.status, 401);
  } finally {
    unconfiguredServer.close();
  }

  // 15. Unit tests for checkAgentAuth (constant-time & fail-closed)
  assert.strictEqual(checkAgentAuth({ headers: {} }, ''), false);
  assert.strictEqual(checkAgentAuth({ headers: {} }, null), false);
  assert.strictEqual(checkAgentAuth({ headers: { 'x-agent-secret': 'foo' } }, ''), false);
  assert.strictEqual(checkAgentAuth({ headers: {} }, 'my-secret'), false);
  assert.strictEqual(checkAgentAuth({ headers: { 'x-agent-secret': 'wrong' } }, 'my-secret'), false);
  assert.strictEqual(checkAgentAuth({ headers: { 'x-agent-secret': 'my-secret' } }, 'my-secret'), true);

  // 16. Socket error handling in parseJsonBody and parseBufferBody
  const fakeJsonReq = new EventEmitter();
  const jsonPromise = parseJsonBody(fakeJsonReq);
  fakeJsonReq.emit('error', new Error('ECONNRESET in json stream'));
  await assert.rejects(jsonPromise, /ECONNRESET in json stream/);

  const fakeBufReq = new EventEmitter();
  const bufPromise = parseBufferBody(fakeBufReq);
  fakeBufReq.emit('error', new Error('ECONNRESET in buf stream'));
  await assert.rejects(bufPromise, /ECONNRESET in buf stream/);

  console.log('✅ worker agent hardening tests passed');
}

runTests().catch((err) => {
  console.error('❌ worker agent test failed:', err);
  process.exit(1);
});
