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

    // 4. Update existing node
    await nodeManager.addNode({
      id: 'oracle-worker',
      name: 'Oracle Cloud VM Renamed',
      ip: '140.238.50.60',
    }, config);
    const updated = await nodeManager.getNode('oracle-worker', config);
    assert.strictEqual(updated.name, 'Oracle Cloud VM Renamed');

    // 5. Remove node
    const removed = await nodeManager.removeNode('oracle-worker', config);
    assert.strictEqual(removed, true);
    const afterRemoval = await nodeManager.getNodes(config);
    assert.strictEqual(afterRemoval.length, 1);

    const removeNonExistent = await nodeManager.removeNode('non-existent', config);
    assert.strictEqual(removeNonExistent, false);

    // 6. maskIp edge cases
    assert.strictEqual(nodeManager.maskIp(''), '');
    assert.strictEqual(nodeManager.maskIp(null), '');
    assert.strictEqual(nodeManager.maskIp('invalid-ip'), 'invalid-ip');

    // 7. nodesConfig env fallback
    const configWithEnv = {
      nodesConfigPath: path.join(tmpDir, 'non-existent.json'),
      nodesConfig: JSON.stringify([{ id: 'env-node', ip: '1.2.3.4' }]),
    };
    const envNodes = await nodeManager.getNodes(configWithEnv);
    assert.strictEqual(envNodes.length, 1);
    assert.strictEqual(envNodes[0].id, 'env-node');

    console.log('✅ nodeManager unit tests passed');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

runTests().catch((err) => {
  console.error('❌ nodeManager test failed:', err);
  process.exit(1);
});
