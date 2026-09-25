const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const deployer = require('../lib/deployer');
const vercel = require('../lib/providers/vercel');
const render = require('../lib/providers/render');

async function testDeployer() {
  const testRoot = path.join(__dirname, 'test_deployer_env');
  const registryPath = path.join(testRoot, 'deployments.json');
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });

  try {
    // 1. Test getActiveTargets & Feature Flags
    const emptyConfig = {};
    assert.deepStrictEqual(deployer.getActiveTargets(emptyConfig), ['vps']);

    assert.deepStrictEqual(deployer.getActiveTargets({ vercelToken: 'tok-ver', renderApiKey: 'key', renderOwnerId: 'owner' }), ['vps']);
    const vercelConfig = { vercelToken: 'tok-ver', cloudTargetsReady: true };
    assert.deepStrictEqual(deployer.getActiveTargets(vercelConfig), ['vps', 'vercel']);

    const allConfig = {
      vercelToken: 'tok-ver',
      renderApiKey: 'rnd-key',
      renderOwnerId: 'rnd-own',
      cloudTargetsReady: true,
      deployRegistryPath: registryPath,
      webDeployDir: path.join(testRoot, 'web'),
      baseDomain: 'thienhn.io.vn',
    };
    assert.deepStrictEqual(deployer.getActiveTargets(allConfig), ['vps', 'vercel', 'render']);
    await assert.rejects(
      deployer.deploy({ source: 'zip_upload', sourcePath: 'app.zip', projectName: 'hidden-cloud', target: 'vercel' }, {
        ...allConfig, cloudTargetsReady: false,
      }),
      /temporarily disabled/i
    );
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

    // 4. Test VPS deployment routing with Cloudflare A record
    let vpsDeployed = false;
    let allocatedForStatic = false;
    let cfARecordCreated = false;
    const mockSandbox = {
      getNextAvailablePort: async () => { allocatedForStatic = true; return 8085; },
      deployProject: async (src, name, port, cfg) => {
        vpsDeployed = true;
        return { ok: true, name, port: null, type: 'static', domain: `${name}.thienhn.io.vn`, url: `https://${name}.thienhn.io.vn` };
      },
      removeProject: async () => ({ ok: true }),
      listDeployments: async () => [],
    };

    let dnsDeleted = null;
    const mockCloudflareVps = {
      isEnabled: () => true,
      resolveFullDomain: (sub, base) => `${sub}.${base}`,
      upsertARecord: async ({ subdomain, ip, proxied }) => {
        cfARecordCreated = true;
        assert.strictEqual(subdomain, 'local-app');
        assert.strictEqual(ip, '8.8.4.4');
        assert.strictEqual(proxied, true);
        return { ok: true, recordId: 'rec-a-vps' };
      },
      deleteDnsRecord: async (input) => {
        dnsDeleted = input;
        return { ok: true };
      },
    };

    const vpsConfig = {
      ...allConfig,
      vpsPublicIp: '8.8.4.4',
    };

    const vpsRes = await deployer.deploy(
      { source: 'zip_upload', sourcePath: 'app.zip', projectName: 'local-app', target: 'vps' },
      vpsConfig,
      { sandbox: mockSandbox, cloudflare: mockCloudflareVps }
    );

    assert.strictEqual(vpsRes.ok, true);
    assert.strictEqual(vpsDeployed, true);
    assert.strictEqual(cfARecordCreated, true);
    assert.strictEqual(vpsRes.deployment.target, 'vps');
    assert.strictEqual(vpsRes.deployment.domain, 'local-app.thienhn.io.vn');
    assert.strictEqual(vpsRes.deployment.dnsStatus, 'provisioned');
    assert.strictEqual(vpsRes.deployment.dnsRecordId, 'rec-a-vps');
    assert.strictEqual(vpsRes.deployment.port, null);
    assert.strictEqual(allocatedForStatic, false);

    // Check registry
    let registry = await deployer.loadRegistry(registryPath);
    assert.strictEqual(registry.length, 1);
    assert.strictEqual(registry[0].name, 'local-app');
    console.log('✅ deployer VPS deploy with Cloudflare A record test passed');

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
      deleteDnsRecord: async () => ({ ok: true }),
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
      deleteDnsRecord: async () => ({ ok: true }),
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

    // 7. Test Undeploy (Vercel & VPS)
    const undeployRes = await deployer.undeploy('v-app', allConfig, {
      sandbox: mockSandbox,
      vercel: mockVercel,
      cloudflare: mockCloudflare,
    });
    assert.strictEqual(undeployRes.ok, true);

    registry = await deployer.loadRegistry(registryPath);
    assert.strictEqual(registry.some((d) => d.name === 'vercel-app'), false, 'vercel-app should be removed from registry');

    // Undeploy VPS app
    const undeployVpsRes = await deployer.undeploy('local-app', allConfig, {
      sandbox: mockSandbox,
      cloudflare: mockCloudflareVps,
    });
    assert.strictEqual(undeployVpsRes.ok, true);
    assert.deepStrictEqual(dnsDeleted, { subdomain: 'local-app.thienhn.io.vn', type: 'A', recordId: 'rec-a-vps' });
    registry = await deployer.loadRegistry(registryPath);
    assert.strictEqual(registry.some((d) => d.name === 'local-app'), false, 'local-app should be removed from registry');
    console.log('✅ deployer undeploy cleanup test passed');

    let originAttempts = 0;
    let dnsAttempts = 0;
    const retrySandbox = {
      deployProject: async (src, name) => {
        originAttempts += 1;
        return { ok: true, name, type: 'static', port: null, domain: `${name}.thienhn.io.vn`, url: `https://${name}.thienhn.io.vn` };
      },
      removeProject: async () => ({ ok: true }),
    };
    const retryCloudflare = {
      isEnabled: () => true,
      resolveFullDomain: (sub, base) => `${sub}.${base}`,
      upsertARecord: async () => {
        dnsAttempts += 1;
        if (dnsAttempts === 1) throw new Error('Cloudflare unavailable');
        return { ok: true, recordId: 'retry-a-id' };
      },
      deleteDnsRecord: async () => {
        if (dnsAttempts === 2) throw new Error('Cloudflare delete unavailable');
        return { ok: true, deleted: true };
      },
    };
    const retryInput = { source: 'zip_upload', sourcePath: 'retry.zip', projectName: 'retry-app', target: 'vps' };
    await assert.rejects(deployer.deploy(retryInput, vpsConfig, { sandbox: retrySandbox, cloudflare: retryCloudflare }), /Cloudflare unavailable/);
    registry = await deployer.loadRegistry(registryPath);
    assert.strictEqual(registry.find((d) => d.name === 'retry-app')?.status, 'failed_dns');

    const retryRes = await deployer.deploy(retryInput, vpsConfig, { sandbox: retrySandbox, cloudflare: retryCloudflare });
    assert.strictEqual(retryRes.deployment.status, 'online');
    assert.strictEqual(originAttempts, 1, 'DNS retry must reuse the installed origin');

    let ambiguousRecord = null;
    const ambiguousConfig = { ...vpsConfig, deployRegistryPath: path.join(testRoot, 'ambiguous.json') };
    const ambiguousCloudflare = {
      isEnabled: () => true,
      resolveFullDomain: (sub, base) => `${sub}.${base}`,
      findDnsRecord: async () => ambiguousRecord,
      upsertARecord: async ({ ownershipTag, ownedRecordId }) => {
        assert.match(ownershipTag, /^assistant-bot:/);
        if (!ambiguousRecord) {
          ambiguousRecord = { id: 'ambiguous-id', type: 'A', comment: ownershipTag };
          throw new Error('Response lost after DNS create');
        }
        assert.strictEqual(ownedRecordId, ambiguousRecord.id);
        return { ok: true, recordId: ambiguousRecord.id };
      },
      deleteDnsRecord: async ({ recordId }) => {
        assert.strictEqual(recordId, ambiguousRecord.id);
        ambiguousRecord = null;
        return { ok: true, deleted: true };
      },
    };
    const ambiguousInput = { source: 'zip_upload', sourcePath: 'ambiguous.zip', projectName: 'ambiguous', target: 'vps' };
    await assert.rejects(deployer.deploy(ambiguousInput, ambiguousConfig, {
      sandbox: retrySandbox,
      cloudflare: ambiguousCloudflare,
    }), /Response lost/);
    let ambiguousRegistry = await deployer.loadRegistry(ambiguousConfig.deployRegistryPath);
    assert.strictEqual(ambiguousRegistry[0].dnsOwnershipTag, ambiguousRecord.comment);
    const recovered = await deployer.deploy(ambiguousInput, ambiguousConfig, {
      sandbox: retrySandbox,
      cloudflare: ambiguousCloudflare,
    });
    assert.strictEqual(recovered.deployment.dnsRecordId, ambiguousRecord.id);
    await deployer.undeploy('ambiguous', ambiguousConfig, {
      sandbox: retrySandbox,
      cloudflare: ambiguousCloudflare,
    });
    ambiguousRecord = { id: 'ambiguous-id', type: 'A', comment: 'assistant-bot:orphaned-response' };
    await deployer.saveRegistry(ambiguousConfig.deployRegistryPath, [{
      name: 'ambiguous', id: 'ambiguous', target: 'vps',
      domain: 'ambiguous.thienhn.io.vn', status: 'failed_dns',
      dnsOwnershipTag: ambiguousRecord.comment,
    }]);
    const removedAfterLostResponse = await deployer.undeploy('ambiguous', ambiguousConfig, {
      sandbox: retrySandbox,
      cloudflare: ambiguousCloudflare,
    });
    assert.strictEqual(removedAfterLostResponse.dnsDeleted, true);

    await assert.rejects(deployer.undeploy('retry-app', vpsConfig, { sandbox: retrySandbox, cloudflare: retryCloudflare }), /Cloudflare delete unavailable/);
    registry = await deployer.loadRegistry(registryPath);
    assert.strictEqual(registry.find((d) => d.name === 'retry-app')?.status, 'cleanup_pending');
    dnsAttempts += 1;
    await deployer.undeploy('retry-app', vpsConfig, { sandbox: retrySandbox, cloudflare: retryCloudflare });
    registry = await deployer.loadRegistry(registryPath);
    assert.strictEqual(registry.some((d) => d.name === 'retry-app'), false);

    let collisionOriginCreated = false;
    await assert.rejects(
      deployer.deploy(
        { source: 'zip_upload', sourcePath: 'collision.zip', projectName: 'bot', target: 'vps' },
        vpsConfig,
        {
          sandbox: { deployProject: async () => { collisionOriginCreated = true; return { ok: true }; } },
          cloudflare: {
            isEnabled: () => true,
            resolveFullDomain: (sub, base) => `${sub}.${base}`,
            findDnsRecord: async () => ({ id: 'manual-bot-record', name: 'bot.thienhn.io.vn', type: 'A' }),
          },
        }
      ),
      /collision|already exists/i
    );
    assert.strictEqual(collisionOriginCreated, false);

    let originCleaned = false;
    let originAttempt = 0;
    const failedOriginSandbox = {
      deployProject: async (src, name) => {
        originAttempt += 1;
        if (originAttempt === 1) {
          const failure = new Error('Nginx reload failed');
          failure.originCreated = true;
          throw failure;
        }
        return { ok: true, name, type: 'static', port: null, domain: `${name}.thienhn.io.vn`, url: `https://${name}.thienhn.io.vn` };
      },
      removeProject: async () => { originCleaned = true; return { ok: true }; },
    };
    await assert.rejects(
      deployer.deploy({ source: 'zip_upload', sourcePath: 'origin.zip', projectName: 'origin-app', target: 'vps' }, vpsConfig, {
        sandbox: failedOriginSandbox,
        cloudflare: mockCloudflareVps,
      }),
      /Nginx reload failed/
    );
    registry = await deployer.loadRegistry(registryPath);
    assert.strictEqual(registry.find((d) => d.name === 'origin-app')?.status, 'failed_origin');
    assert.strictEqual(originCleaned, true);
    const originRetry = await deployer.deploy(
      { source: 'zip_upload', sourcePath: 'origin.zip', projectName: 'origin-app', target: 'vps' },
      vpsConfig,
      {
        sandbox: failedOriginSandbox,
        cloudflare: {
          isEnabled: () => true,
          resolveFullDomain: (sub, base) => `${sub}.${base}`,
          upsertARecord: async () => ({ ok: true, recordId: 'origin-a-id' }),
        },
      }
    );
    assert.strictEqual(originRetry.deployment.status, 'online');

    await assert.rejects(
      deployer.getVpsPublicIp({ vpsPublicIp: 'not-an-ip' }),
      /valid public IPv4/i
    );
    await assert.rejects(
      deployer.getVpsPublicIp({}, { get: async () => ({ data: { ip: '127.0.0.1' } }) }),
      /valid public IPv4/i
    );

    const failedOnly = {
      ...vpsConfig,
      deployRegistryPath: path.join(testRoot, 'failed-only.json'),
    };
    let failedOnlyRemoved = false;
    await assert.rejects(
      deployer.deploy({ source: 'zip_upload', sourcePath: 'failed.zip', projectName: 'failed-only', target: 'vps' }, failedOnly, {
        sandbox: {
          deployProject: async () => { throw new Error('Origin refused deployment'); },
          removeProject: async () => ({ ok: true }),
        },
        cloudflare: mockCloudflareVps,
      }),
      /Origin refused deployment/
    );
    await deployer.undeploy('failed-only', failedOnly, {
      sandbox: {
        removeProject: async () => { failedOnlyRemoved = true; return { ok: true }; },
      },
      cloudflare: {
        isEnabled: () => true,
        findDnsRecord: async () => null,
      },
    });
    assert.strictEqual(failedOnlyRemoved, true);
    assert.deepStrictEqual(await deployer.loadRegistry(failedOnly.deployRegistryPath), []);

    let legacyRemoved = false;
    const legacyOnly = { ...vpsConfig, deployRegistryPath: path.join(testRoot, 'legacy-only.json') };
    const legacySandbox = {
      listDeployments: async () => [{ name: 'old-port-web', port: 8081, domain: null }],
      removeProject: async () => { legacyRemoved = true; return { ok: true }; },
    };
    const legacyCloudflare = {
      isEnabled: () => true,
      resolveFullDomain: (sub, base) => `${sub}.${base}`,
      findDnsRecord: async () => null,
    };
    const legacyResult = await deployer.undeploy('old-port-web', legacyOnly, {
      sandbox: legacySandbox,
      cloudflare: legacyCloudflare,
    });
    assert.strictEqual(legacyRemoved, true);
    assert.strictEqual(legacyResult.dnsDeleted, false);

    const legacyDir = path.join(allConfig.webDeployDir, 'old-unregistered');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'meta.json'), JSON.stringify({ name: 'old-unregistered', port: 8081, type: 'static' }));
    const listedLegacy = (await deployer.listAllDeployments(allConfig)).find((item) => item.name === 'old-unregistered');
    assert.strictEqual(listedLegacy.domain, null);
    assert.strictEqual(listedLegacy.url, null);
    assert.strictEqual(listedLegacy.status, 'legacy_unmanaged');
    await assert.rejects(
      deployer.deploy({ source: 'zip_upload', sourcePath: 'old.zip', projectName: 'old-unregistered', target: 'vps' }, allConfig, {
        cloudflare: mockCloudflareVps,
      }),
      /already exists outside the deployment registry/
    );
    assert.strictEqual(await fs.readFile(path.join(legacyDir, 'meta.json'), 'utf8'), JSON.stringify({ name: 'old-unregistered', port: 8081, type: 'static' }));

    await assert.rejects(
      deployer.undeploy('old-port-web', legacyOnly, {
        sandbox: legacySandbox,
        cloudflare: { ...legacyCloudflare, findDnsRecord: async () => ({ id: 'unowned-record' }) },
      }),
      /unowned DNS|reconcile/i
    );

    // 7.1 Test getVpsPublicIp
    const ipFromConfig = await deployer.getVpsPublicIp({ vpsPublicIp: '8.8.4.4' });
    assert.strictEqual(ipFromConfig, '8.8.4.4');

    const mockIpClient = {
      get: async () => ({ data: { ip: '1.2.3.4' } }),
    };
    const ipFromApi = await deployer.getVpsPublicIp({}, mockIpClient);
    assert.strictEqual(ipFromApi, '1.2.3.4');
    console.log('✅ deployer getVpsPublicIp test passed');

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

    // 10. Test resolveAvailableSubdomain collision suffix logic
    const mockListDeployments = async () => [
      { name: 'shop', domain: 'shop.thienhn.io.vn' },
      { name: 'shop0', domain: 'shop0.thienhn.io.vn' },
    ];
    // Free subdomain
    const freeSub = await deployer.resolveAvailableSubdomain('blog', allConfig, { listAllDeployments: mockListDeployments });
    assert.strictEqual(freeSub, 'blog', 'Unused subdomain should return as is');

    // First collision: shop is taken, shop0 is taken -> should return shop1
    const collSub = await deployer.resolveAvailableSubdomain('shop', allConfig, { listAllDeployments: mockListDeployments });
    assert.strictEqual(collSub, 'shop1', 'Should increment suffix from 0 to 1 when collision occurs');

    // Single collision: only base taken -> should return base0
    const mockListSingle = async () => [{ name: 'portal', domain: 'portal.thienhn.io.vn' }];
    const singleColl = await deployer.resolveAvailableSubdomain('portal', allConfig, { listAllDeployments: mockListSingle });
    assert.strictEqual(singleColl, 'portal0', 'Single collision should append 0');

    const concurrentConfig = { ...vpsConfig, deployRegistryPath: path.join(testRoot, 'concurrent.json') };
    const concurrentCloudflare = {
      isEnabled: () => true,
      resolveFullDomain: (sub, base) => `${sub}.${base}`,
      findDnsRecord: async () => null,
      upsertARecord: async ({ subdomain }) => ({ ok: true, recordId: `id-${subdomain}` }),
    };
    await Promise.all(['first', 'second'].map((name) => deployer.deploy({
      source: 'zip_upload', sourcePath: `${name}.zip`, projectName: name, target: 'vps',
    }, concurrentConfig, {
      sandbox: {
        deployProject: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { ok: true, type: 'static', port: null };
        },
      },
      cloudflare: concurrentCloudflare,
    })));
    assert.deepStrictEqual((await deployer.loadRegistry(concurrentConfig.deployRegistryPath)).map((item) => item.name), ['first', 'second']);

    const reservedConfig = { ...vpsConfig, deployRegistryPath: path.join(testRoot, 'reserved.json') };
    let signalEntered;
    let releaseOrigin;
    const enteredOrigin = new Promise((resolve) => { signalEntered = resolve; });
    const originGate = new Promise((resolve) => { releaseOrigin = resolve; });
    const reservedPromise = deployer.deploy({
      source: 'zip_upload', sourcePath: 'reserved.zip', projectName: 'reserved', target: 'vps',
    }, reservedConfig, {
      sandbox: {
        deployProject: async () => {
          signalEntered();
          await originGate;
          return { ok: true, type: 'static', port: null };
        },
      },
      cloudflare: concurrentCloudflare,
    });
    await enteredOrigin;
    let reservationError = null;
    try {
      const duringOrigin = await deployer.loadRegistry(reservedConfig.deployRegistryPath);
      assert.strictEqual(duringOrigin[0]?.status, 'provisioning_origin');
    } catch (error) {
      reservationError = error;
    } finally {
      releaseOrigin();
    }
    await reservedPromise;
    if (reservationError) throw reservationError;
    console.log('✅ deployer resolveAvailableSubdomain collision suffix test passed');
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }
}

testDeployer().catch((err) => {
  console.error('Deployer test failed:', err);
  process.exit(1);
});
