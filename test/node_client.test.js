const assert = require('assert');
const nodeClient = require('../lib/nodeClient');

async function runTests() {
  // 1. resolveAgentUrl tests
  assert.strictEqual(
    nodeClient.resolveAgentUrl({ agentUrl: 'http://127.0.0.1:3001/' }),
    'http://127.0.0.1:3001'
  );
  assert.strictEqual(
    nodeClient.resolveAgentUrl({ agentUrl: 'https://worker.internal:8443' }),
    'https://worker.internal:8443'
  );
  assert.strictEqual(
    nodeClient.resolveAgentUrl({ ip: '127.0.0.1' }),
    'http://127.0.0.1:3001'
  );
  assert.strictEqual(
    nodeClient.resolveAgentUrl({ ip: '127.0.0.1', port: 4000 }),
    'http://127.0.0.1:4000'
  );

  // 2. Mock HTTP client for API tests
  const requests = [];
  const fakeClient = {
    async get(url, opts) {
      requests.push({ method: 'GET', url, opts });
      if (url.includes('/api/metrics')) {
        assert.strictEqual(opts.headers['X-Agent-Secret'], 'test-secret');
        assert.strictEqual(opts.timeout, 5000);
        return { data: { ok: true, metrics: { cpuLoad: 22 } } };
      }
      throw new Error(`Unexpected GET ${url}`);
    },
    async post(url, body, opts) {
      requests.push({ method: 'POST', url, body, opts });
      if (url.includes('/api/deploy')) {
        assert.strictEqual(opts.headers['x-project-name'], 'demo-app');
        assert.strictEqual(opts.headers['X-Agent-Secret'], 'test-secret');
        assert.strictEqual(opts.headers['Content-Type'], 'application/octet-stream');
        assert.strictEqual(opts.timeout, 60000);
        return { data: { ok: true, deployment: { domain: 'demo-app.thienhn.io.vn' } } };
      }
      if (url.includes('/api/undeploy')) {
        assert.strictEqual(opts.headers['X-Agent-Secret'], 'test-secret');
        assert.strictEqual(opts.headers['Content-Type'], 'application/json');
        assert.strictEqual(opts.timeout, 15000);
        assert.deepStrictEqual(body, { projectName: 'demo-app' });
        return { data: { ok: true, removed: true } };
      }
      if (url.includes('/api/update')) {
        assert.strictEqual(opts.headers['X-Agent-Secret'], 'test-secret');
        assert.strictEqual(opts.headers['Content-Type'], 'application/json');
        assert.strictEqual(opts.timeout, 30000);
        assert.deepStrictEqual(body, {});
        return { data: { ok: true, output: 'Updated successfully' } };
      }
      throw new Error(`Unexpected POST ${url}`);
    },
  };

  const node = {
    id: 'worker-node-1',
    agentUrl: 'http://127.0.0.1:3001',
    secret: 'test-secret',
  };

  // 3. getMetrics - success
  const metrics = await nodeClient.getMetrics(node, fakeClient);
  assert.strictEqual(metrics.ok, true);
  assert.strictEqual(metrics.metrics.cpuLoad, 22);

  // 4. getMetrics - failure / offline node
  const failingClient = {
    async get() {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3001');
    },
  };
  const offlineResult = await nodeClient.getMetrics(node, failingClient);
  assert.strictEqual(offlineResult.ok, false);
  assert.strictEqual(offlineResult.status, 'offline');
  assert.ok(offlineResult.error.includes('ECONNREFUSED'));

  // 5. deploy - with default subdomain fallback
  const zipBuffer = Buffer.from('mock-zip-binary');
  const deployed = await nodeClient.deploy(node, { projectName: 'demo-app', zipBuffer }, fakeClient);
  assert.strictEqual(deployed.ok, true);
  assert.strictEqual(deployed.deployment.domain, 'demo-app.thienhn.io.vn');
  const lastDeployReq = requests.find((r) => r.url.includes('/api/deploy'));
  assert.strictEqual(lastDeployReq.opts.headers['x-subdomain'], 'demo-app');

  // 6. deploy - with explicit custom subdomain
  await nodeClient.deploy(node, { projectName: 'demo-app', subdomain: 'custom-sub', zipBuffer }, fakeClient);
  const customSubDeployReq = requests[requests.length - 1];
  assert.strictEqual(customSubDeployReq.opts.headers['x-subdomain'], 'custom-sub');

  // 7. undeploy
  const undeployed = await nodeClient.undeploy(node, 'demo-app', fakeClient);
  assert.strictEqual(undeployed.ok, true);
  assert.strictEqual(undeployed.removed, true);

  // 8. update
  const updated = await nodeClient.update(node, fakeClient);
  assert.strictEqual(updated.ok, true);
  assert.strictEqual(updated.output, 'Updated successfully');

  console.log('✅ nodeClient unit tests passed');
}

runTests().catch((err) => {
  console.error('❌ nodeClient test failed:', err);
  process.exit(1);
});
