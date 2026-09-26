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
  let remoteUndeployCalled = false;
  let dnsDeleted = null;

  const mockDeps = {
    cloudflare: {
      isEnabled: () => true,
      resolveFullDomain: (sub) => `${sub}.thienhn.io.vn`,
      findDnsRecord: async () => null,
      upsertARecord: async (params) => {
        passedDns = params;
        return { ok: true, recordId: 'dns-rec-oracle-123' };
      },
      deleteDnsRecord: async (params) => {
        dnsDeleted = params;
        return { ok: true, deleted: true };
      },
    },
    nodeClient: {
      deploy: async (node, opts) => {
        remoteDeployCalled = true;
        return { ok: true, deployment: { domain: `${opts.projectName}.thienhn.io.vn` } };
      },
      undeploy: async (node, projectName) => {
        remoteUndeployCalled = true;
        assert.strictEqual(node.id, 'oracle-worker');
        assert.strictEqual(projectName, 'test-oracle-app');
        return { ok: true, removed: true };
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

  // Test 1: Deploy to remote node
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

  // Verify registry file has nodeId
  const registryContent = await deployer.loadRegistry(registryPath);
  assert.strictEqual(registryContent.length, 1);
  assert.strictEqual(registryContent[0].nodeId, 'oracle-worker');

  // Test 2: Undeploy remote node
  const undeployRes = await deployer.undeploy('test-oracle-app', config, mockDeps);
  assert.strictEqual(undeployRes.ok, true);
  assert.strictEqual(remoteUndeployCalled, true);
  assert.strictEqual(undeployRes.dnsDeleted, true);
  assert.strictEqual(dnsDeleted.recordId, 'dns-rec-oracle-123');

  const afterUndeploy = await deployer.loadRegistry(registryPath);
  assert.strictEqual(afterUndeploy.length, 0);

  // Test 3: Deploy default local node (nodeId omitted)
  let localDeployCalled = false;
  let localPassedDns = null;
  const localMockDeps = {
    ...mockDeps,
    sandbox: {
      deployProject: async (src, name, port, cfg, sub) => {
        localDeployCalled = true;
        return { ok: true, name, type: 'static', domain: `${name}.thienhn.io.vn`, url: `https://${name}.thienhn.io.vn` };
      },
      removeProject: async () => ({ ok: true }),
    },
    cloudflare: {
      ...mockDeps.cloudflare,
      upsertARecord: async (params) => {
        localPassedDns = params;
        return { ok: true, recordId: 'dns-rec-local-456' };
      },
    },
  };

  const localResult = await deployer.deploy(
    {
      source: 'zip_upload',
      sourcePath: dummyZip,
      projectName: 'test-local-app',
      target: 'vps',
    },
    config,
    localMockDeps
  );

  assert.strictEqual(localDeployCalled, true);
  assert.strictEqual(localPassedDns.ip, '104.198.1.1');
  assert.strictEqual(localResult.deployment.nodeId, 'gcp-master');

  console.log('✅ multi-vps deployer tests passed');
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}

runTests().catch((err) => {
  console.error('❌ multi-vps deployer test failed:', err);
  process.exit(1);
});
