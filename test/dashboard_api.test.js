const assert = require('assert');
const axios = require('axios');
const path = require('path');
const fs = require('fs/promises');
const { createDashboardServer } = require('../services/dashboardApi');

async function testDashboardApi() {
  const testRoot = path.join(__dirname, 'test_dashboard_env');
  const registryPath = path.join(testRoot, 'deployments.json');
  await fs.mkdir(testRoot, { recursive: true });

  await fs.writeFile(
    registryPath,
    JSON.stringify([
      { name: 'app-test', target: 'vps', domain: 'app-test.thienhn.io.vn', url: 'https://app-test.thienhn.io.vn', status: 'online' },
    ]),
    'utf8'
  );

  const testPort = 3899;
  const config = {
    dashboardPort: testPort,
    dashboardSecretKey: 'super-secret-pin',
    deployRegistryPath: registryPath,
    baseDomain: 'thienhn.io.vn',
  };

  const server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(testPort, '127.0.0.1', resolve));

  const client = axios.create({
    baseURL: `http://127.0.0.1:${testPort}`,
    validateStatus: () => true, // Don't throw on 4xx/5xx
  });

  try {
    // 1. Health check (unauthenticated)
    const healthRes = await client.get('/api/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.data.ok, true);
    console.log('✅ dashboardApi /api/health test passed');

    // 2. Auth verify - wrong pin
    const failAuthRes = await client.post('/api/auth/verify', { key: 'wrong-key' });
    assert.strictEqual(failAuthRes.status, 401);
    assert.strictEqual(failAuthRes.data.ok, false);
    console.log('✅ dashboardApi /api/auth/verify rejection test passed');

    // 3. Auth verify - correct pin
    const passAuthRes = await client.post('/api/auth/verify', { key: 'super-secret-pin' });
    assert.strictEqual(passAuthRes.status, 200);
    assert.strictEqual(passAuthRes.data.authenticated, true);
    console.log('✅ dashboardApi /api/auth/verify success test passed');

    // 4. Access protected endpoint without auth
    const unauthRes = await client.get('/api/deployments');
    assert.strictEqual(unauthRes.status, 401);
    console.log('✅ dashboardApi protected endpoint unauthorized test passed');

    // 5. Access protected endpoint with Bearer token
    const authHeaders = { Authorization: 'Bearer super-secret-pin' };
    const depRes = await client.get('/api/deployments', { headers: authHeaders });
    assert.strictEqual(depRes.status, 200);
    assert.strictEqual(depRes.data.ok, true);
    assert(Array.isArray(depRes.data.deployments));
    assert.strictEqual(depRes.data.deployments[0].name, 'app-test');
    console.log('✅ dashboardApi /api/deployments with Bearer token test passed');

    // 6. Access /api/status telemetry with query param ?key=
    const statusRes = await client.get('/api/status?key=super-secret-pin');
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.data.ok, true);
    assert(typeof statusRes.data.system.cpuLoad === 'number');
    assert(statusRes.data.system.memory);
    console.log('✅ dashboardApi /api/status telemetry test passed');

    // 7. Undeploy endpoint
    const undeployRes = await client.post('/api/deployments/undeploy', { name: 'app-test' }, { headers: authHeaders });
    assert.strictEqual(undeployRes.status, 200);
    assert.strictEqual(undeployRes.data.ok, true);

    const afterRes = await client.get('/api/deployments', { headers: authHeaders });
    assert.strictEqual(afterRes.data.deployments.some((d) => d.name === 'app-test'), false);
    console.log('✅ dashboardApi /api/deployments/undeploy test passed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }
}

testDashboardApi().catch((err) => {
  console.error('Dashboard API test failed:', err);
  process.exit(1);
});
