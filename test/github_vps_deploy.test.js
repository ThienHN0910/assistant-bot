const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const deployer = require('../lib/deployer');

async function testGithubVpsDeploy() {
  const testRoot = path.join(__dirname, 'test_gh_vps_env');
  const registryPath = path.join(testRoot, 'deployments.json');
  const webDeployDir = path.join(testRoot, 'web');
  const uploadDir = path.join(testRoot, 'uploads');

  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  await fs.mkdir(webDeployDir, { recursive: true });
  await fs.mkdir(uploadDir, { recursive: true });

  const config = {
    vpsPublicIp: '1.2.3.4',
    baseDomain: 'thienhn.io.vn',
    deployRegistryPath: registryPath,
    webDeployDir,
    uploadDir,
    cloudflareApiToken: 'cf-tok',
    cloudflareZoneId: 'cf-zone',
  };

  let cfRecordCreated = false;
  const mockCloudflare = {
    isEnabled: () => true,
    resolveFullDomain: (sub, base) => `${sub}.${base}`,
    upsertARecord: async ({ subdomain, ip, proxied }) => {
      cfRecordCreated = true;
      assert.strictEqual(subdomain, 'landing');
      assert.strictEqual(ip, '1.2.3.4');
      return { ok: true, recordId: 'rec-a-landing' };
    },
    deleteDnsRecord: async () => ({ ok: true }),
  };

  let sandboxDeployed = false;
  const mockSandbox = {
    deployProject: async (src, name, port, cfg) => {
      sandboxDeployed = true;
      assert.strictEqual(name, 'landing');
      return {
        ok: true,
        name,
        type: 'static',
        port: null,
        domain: 'landing.thienhn.io.vn',
        url: 'https://landing.thienhn.io.vn',
      };
    },
    removeProject: async () => ({ ok: true }),
  };

  // Mock Inspector to say it's static_pure
  const mockInspector = {
    inspectRepo: async (url) => ({
      ok: true,
      type: 'static_pure',
      title: 'Web tĩnh thuần (HTML/CSS/JS)',
    }),
  };

  // Mock GitHub archive downloader: creates a zip file with index.html
  const mockDownloader = async (owner, repo, destPath) => {
    await fs.writeFile(destPath, 'PK mock zip content with index.html', 'utf8');
    return destPath;
  };

  // 1. Deploy static GitHub repo to VPS should succeed
  const result = await deployer.deploy(
    {
      source: 'github_public',
      repoUrl: 'https://github.com/my-user/landing',
      projectName: 'landing',
      target: 'vps',
    },
    config,
    {
      cloudflare: mockCloudflare,
      sandbox: mockSandbox,
      inspector: mockInspector,
      downloadGithubZip: mockDownloader,
    }
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(sandboxDeployed, true);
  assert.strictEqual(cfRecordCreated, true);
  assert.strictEqual(result.deployment.target, 'vps');
  assert.strictEqual(result.deployment.domain, 'landing.thienhn.io.vn');
  assert.strictEqual(result.deployment.dnsRecordId, 'rec-a-landing');
  console.log('✅ GitHub static pure to VPS deploy test passed');

  // 2. Deploy non-static GitHub repo to VPS should be rejected
  const mockNonStaticInspector = {
    inspectRepo: async () => ({
      ok: true,
      type: 'frontend_spa',
      title: 'React App',
    }),
  };

  await assert.rejects(
    () => deployer.deploy(
      {
        source: 'github_public',
        repoUrl: 'https://github.com/my-user/react-shop',
        projectName: 'react-shop',
        target: 'vps',
      },
      config,
      {
        cloudflare: mockCloudflare,
        sandbox: mockSandbox,
        inspector: mockNonStaticInspector,
      }
    ),
    /chỉ hỗ trợ web tĩnh thuần.*không hỗ trợ build trực tiếp trên VPS/i
  );
  console.log('✅ Non-static GitHub repo rejected on VPS test passed');

  await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
}

testGithubVpsDeploy().catch((err) => {
  console.error('Github VPS deploy test failed:', err);
  process.exit(1);
});
