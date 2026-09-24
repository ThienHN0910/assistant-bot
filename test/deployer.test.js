const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const deployer = require('../lib/deployer');
const vercel = require('../lib/providers/vercel');
const render = require('../lib/providers/render');

async function testDeployer() {
  const testRoot = path.join(__dirname, 'test_deployer_env');
  const registryPath = path.join(testRoot, 'deployments.json');
  await fs.mkdir(testRoot, { recursive: true });

  try {
    // 1. Test getActiveTargets & Feature Flags
    const emptyConfig = {};
    assert.deepStrictEqual(deployer.getActiveTargets(emptyConfig), ['vps']);

    const vercelConfig = { vercelToken: 'tok-ver' };
    assert.deepStrictEqual(deployer.getActiveTargets(vercelConfig), ['vps', 'vercel']);

    const allConfig = {
      vercelToken: 'tok-ver',
      renderApiKey: 'rnd-key',
      renderOwnerId: 'rnd-own',
      deployRegistryPath: registryPath,
      webDeployDir: path.join(testRoot, 'web'),
      baseDomain: 'thienhn.io.vn',
    };
    assert.deepStrictEqual(deployer.getActiveTargets(allConfig), ['vps', 'vercel', 'render']);
    console.log('✅ deployer getActiveTargets feature flag test passed');

    // 2. Test getValidTargetsForSource rules
    const gitTargets = deployer.getValidTargetsForSource('github_public', allConfig);
    assert.deepStrictEqual(gitTargets, ['vercel', 'render'], 'GitHub public source should only allow vercel and render');
    assert.strictEqual(gitTargets.includes('vps'), false, 'GitHub public source must NOT allow VPS');

    const zipTargets = deployer.getValidTargetsForSource('zip_upload', allConfig);
    assert.deepStrictEqual(zipTargets, ['vps', 'vercel']);
    console.log('✅ deployer getValidTargetsForSource matrix test passed');

    // 3. Test input validation: GitHub public directly to VPS must throw
    await assert.rejects(
      async () => {
        await deployer.deploy(
          { source: 'github_public', repoUrl: 'https://github.com/user/repo', projectName: 'my-app', target: 'vps' },
          allConfig
        );
      },
      /Không hỗ trợ deploy link GitHub public trực tiếp lên VPS/,
      'Should reject github_public to vps'
    );
    console.log('✅ deployer rejection of github_public on vps test passed');

    // 4. Test VPS deployment routing
    let vpsDeployed = false;
    const mockSandbox = {
      getNextAvailablePort: async () => 8085,
      deployProject: async (src, name, port, cfg) => {
        vpsDeployed = true;
        return { ok: true, name, port, type: 'static', domain: `${name}.thienhn.io.vn`, url: `https://${name}.thienhn.io.vn` };
      },
      removeProject: async () => ({ ok: true }),
      listDeployments: async () => [],
    };

    const vpsRes = await deployer.deploy(
      { source: 'zip_upload', sourcePath: 'app.zip', projectName: 'local-app', target: 'vps' },
      allConfig,
      { sandbox: mockSandbox }
    );

    assert.strictEqual(vpsRes.ok, true);
    assert.strictEqual(vpsDeployed, true);
    assert.strictEqual(vpsRes.deployment.target, 'vps');
    assert.strictEqual(vpsRes.deployment.domain, 'local-app.thienhn.io.vn');

    // Check registry
    let registry = await deployer.loadRegistry(registryPath);
    assert.strictEqual(registry.length, 1);
    assert.strictEqual(registry[0].name, 'local-app');
    console.log('✅ deployer VPS deploy and registry persistence test passed');

    // 5. Test Vercel deployment routing with Cloudflare CNAME
    let vercelDeployed = false;
    let cfCnameCreated = false;
    const mockVercel = {
      isEnabled: () => true,
      deploy: async (params, cfg) => {
        vercelDeployed = true;
        return {
          ok: true,
          target: 'vercel',
          name: params.projectName,
          domain: `${params.subdomain}.thienhn.io.vn`,
          url: `https://${params.subdomain}.thienhn.io.vn`,
          cnameTarget: 'cname.vercel-dns.com',
          deployedAt: new Date().toISOString(),
        };
      },
      remove: async () => ({ ok: true }),
    };

    const mockCloudflare = {
      isEnabled: () => true,
      resolveFullDomain: (sub, base) => `${sub}.${base}`,
      upsertCnameRecord: async ({ subdomain, targetCname }) => {
        cfCnameCreated = true;
        assert.strictEqual(targetCname, 'cname.vercel-dns.com');
        return { ok: true, recordId: 'rec-vercel-1' };
      },
      deleteCnameRecord: async () => ({ ok: true }),
    };

    const vercelRes = await deployer.deploy(
      {
        source: 'github_public',
        repoUrl: 'https://github.com/org/repo',
        projectName: 'vercel-app',
        target: 'vercel',
        subdomain: 'v-app',
      },
      allConfig,
      { vercel: mockVercel, cloudflare: mockCloudflare }
    );

    assert.strictEqual(vercelRes.ok, true);
    assert.strictEqual(vercelDeployed, true);
    assert.strictEqual(cfCnameCreated, true);
    assert.strictEqual(vercelRes.deployment.target, 'vercel');
    assert.strictEqual(vercelRes.deployment.domain, 'v-app.thienhn.io.vn');
    console.log('✅ deployer Vercel deploy with Cloudflare CNAME test passed');

    // 6. Test Render deployment routing
    let renderDeployed = false;
    let renderCnameTarget = '';
    const mockRender = {
      isEnabled: () => true,
      deploy: async (params, cfg) => {
        renderDeployed = true;
        return {
          ok: true,
          target: 'render',
          serviceId: 'srv-123',
          name: params.projectName,
          domain: `${params.subdomain}.thienhn.io.vn`,
          url: `https://${params.subdomain}.thienhn.io.vn`,
          cnameTarget: 'render-slug.onrender.com',
          deployedAt: new Date().toISOString(),
        };
      },
      remove: async () => ({ ok: true }),
    };

    const mockCloudflareRender = {
      isEnabled: () => true,
      resolveFullDomain: (sub, base) => `${sub}.${base}`,
      upsertCnameRecord: async ({ subdomain, targetCname }) => {
        renderCnameTarget = targetCname;
        return { ok: true, recordId: 'rec-render-1' };
      },
      deleteCnameRecord: async () => ({ ok: true }),
    };

    const renderRes = await deployer.deploy(
      {
        source: 'github_public',
        repoUrl: 'https://github.com/org/render-repo',
        projectName: 'render-app',
        target: 'render',
        subdomain: 'r-app',
      },
      allConfig,
      { render: mockRender, cloudflare: mockCloudflareRender }
    );

    assert.strictEqual(renderRes.ok, true);
    assert.strictEqual(renderDeployed, true);
    assert.strictEqual(renderCnameTarget, 'render-slug.onrender.com');
    assert.strictEqual(renderRes.deployment.target, 'render');
    console.log('✅ deployer Render deploy with Cloudflare CNAME test passed');

    // 7. Test Undeploy
    const undeployRes = await deployer.undeploy('v-app', allConfig, {
      sandbox: mockSandbox,
      vercel: mockVercel,
      cloudflare: mockCloudflare,
    });
    assert.strictEqual(undeployRes.ok, true);

    registry = await deployer.loadRegistry(registryPath);
    assert.strictEqual(registry.some((d) => d.name === 'vercel-app'), false, 'vercel-app should be removed from registry');
    console.log('✅ deployer undeploy cleanup test passed');

    // 8. Test Vercel provider unit with mocks
    const vercelCalls = [];
    const mockVercelHttp = {
      post: async (url, body) => {
        vercelCalls.push({ url, body });
        return { data: { id: 'prj-1' } };
      },
      delete: async (url) => {
        vercelCalls.push({ method: 'DELETE', url });
        return { data: { success: true } };
      },
    };
    const vRes = await vercel.deploy(
      { projectName: 'prj1', subdomain: 'prj1', source: 'zip_upload' },
      { vercelToken: 'mock-tok', baseDomain: 'thienhn.io.vn' },
      mockVercelHttp
    );
    assert.strictEqual(vRes.ok, true);
    assert.strictEqual(vRes.cnameTarget, 'cname.vercel-dns.com');
    console.log('✅ vercel provider unit test passed');

    // 9. Test Render provider unit with mocks
    const renderCalls = [];
    const mockRenderHttp = {
      post: async (url, body) => {
        renderCalls.push({ url, body });
        return { data: { service: { id: 'srv-99', slug: 'my-service' } } };
      },
      delete: async (url) => {
        renderCalls.push({ method: 'DELETE', url });
        return { data: { success: true } };
      },
    };
    const rRes = await render.deploy(
      { projectName: 'rnd1', subdomain: 'rnd1', repoUrl: 'https://github.com/my/app' },
      { renderApiKey: 'key', renderOwnerId: 'own', baseDomain: 'thienhn.io.vn' },
      mockRenderHttp
    );
    assert.strictEqual(rRes.ok, true);
    assert.strictEqual(rRes.cnameTarget, 'my-service.onrender.com');
    console.log('✅ render provider unit test passed');
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }
}

testDeployer().catch((err) => {
  console.error('Deployer test failed:', err);
  process.exit(1);
});
