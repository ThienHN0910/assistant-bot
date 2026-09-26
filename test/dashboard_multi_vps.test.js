const assert = require('assert');
const http = require('http');
const { createDashboardServer, createSessionToken } = require('../services/dashboardApi');

async function makeRequest(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  const sessionSecret = 'test-session-secret-multi-vps';
  const authorizedEmail = 'test@example.com';
  const googleClientId = 'test-google-client-id';

  const mockNodeManager = {
    getNodes: async () => [
      { id: 'gcp-master', name: 'GCP Master', ip: '104.1.2.3', isLocal: true },
      { id: 'oracle-worker', name: 'Oracle VM', ip: '140.4.5.6', isLocal: false },
    ],
    maskIp: (ip) => `${ip.split('.')[0]}.***`,
  };

  const mockNodeClient = {
    getMetrics: async (node) => {
      if (node.id === 'oracle-worker') {
        return {
          ok: true,
          metrics: {
            cpuLoad: 25,
            memory: {
              totalBytes: 1024 * 1024 * 1024,
              usedBytes: 512 * 1024 * 1024,
              usedPercentage: 50,
            },
            uptimeSeconds: 7200,
          },
        };
      }
      return { ok: false, error: 'Node offline', status: 'offline' };
    },
  };

  let capturedDeployArgs = null;
  const mockDeployer = {
    deploy: async (params, config) => {
      capturedDeployArgs = params;
      return {
        ok: true,
        deployment: {
          id: params.projectName,
          name: params.projectName,
          target: params.target,
          nodeId: params.nodeId,
          domain: `${params.subdomain}.example.com`,
          url: `https://${params.subdomain}.example.com`,
        },
      };
    },
    listAllDeployments: async () => [],
  };

  const server = createDashboardServer(
    {
      authorizedGoogleEmail: authorizedEmail,
      sessionSecret,
      googleClientId,
    },
    {
      nodeManager: mockNodeManager,
      nodeClient: mockNodeClient,
      deployer: mockDeployer,
    }
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const validToken = createSessionToken(authorizedEmail, sessionSecret);
  const authHeaders = {
    'Authorization': `Bearer ${validToken}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. GET /api/nodes - public endpoint returning masked node list
    const nodesRes = await makeRequest(port, '/api/nodes');
    assert.strictEqual(nodesRes.status, 200, 'GET /api/nodes should return 200');
    assert.strictEqual(nodesRes.data.ok, true, 'GET /api/nodes should return ok: true');
    assert.strictEqual(nodesRes.data.nodes.length, 2, 'Should return 2 nodes');
    assert.strictEqual(nodesRes.data.nodes[0].id, 'gcp-master');
    assert.strictEqual(nodesRes.data.nodes[1].id, 'oracle-worker');
    assert.strictEqual(nodesRes.data.nodes[1].ipMasked, '140.***', 'Remote node IP must be masked');
    console.log('✅ GET /api/nodes test passed');

    // 2. GET /api/status - telemetry includes cluster nodes
    const statusRes = await makeRequest(port, '/api/status', {
      headers: authHeaders,
    });
    assert.strictEqual(statusRes.status, 200, 'GET /api/status should return 200');
    assert.strictEqual(statusRes.data.ok, true);
    assert(statusRes.data.system, 'Should have system metrics');
    assert(Array.isArray(statusRes.data.nodes), 'Should have nodes telemetry array');
    assert.strictEqual(statusRes.data.nodes.length, 2, 'Telemetry should cover 2 nodes');

    const masterNode = statusRes.data.nodes.find((n) => n.id === 'gcp-master');
    assert(masterNode, 'Master node should be in telemetry');
    assert.strictEqual(masterNode.isLocal, true);
    assert(typeof masterNode.cpuLoad === 'number');

    const workerNode = statusRes.data.nodes.find((n) => n.id === 'oracle-worker');
    assert(workerNode, 'Worker node should be in telemetry');
    assert.strictEqual(workerNode.isLocal, false);
    assert.strictEqual(workerNode.status, 'online');
    assert.strictEqual(workerNode.cpuLoad, 25);
    assert.strictEqual(workerNode.memory.usedPercentage, 50);
    console.log('✅ GET /api/status cluster telemetry test passed');

    // 3. POST /api/deployments/deploy-git with nodeId
    const deployRes = await makeRequest(port, '/api/deployments/deploy-git', {
      method: 'POST',
      headers: authHeaders,
      body: {
        repoUrl: 'https://github.com/example/test-repo',
        target: 'vps',
        subdomain: 'test-node-app',
        projectName: 'test-node-app',
        nodeId: 'oracle-worker',
      },
    });
    assert.strictEqual(deployRes.status, 200, 'POST /api/deployments/deploy-git should return 200');
    assert.strictEqual(deployRes.data.ok, true);
    assert.strictEqual(capturedDeployArgs?.nodeId, 'oracle-worker', 'Deployer should receive selected nodeId');
    assert.strictEqual(deployRes.data.deployment?.nodeId, 'oracle-worker');
    console.log('✅ POST /api/deployments/deploy-git with nodeId test passed');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('❌ dashboard multi-vps test failed:', err);
  process.exit(1);
});
