const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const vercel = require('../lib/providers/vercel');

const execFileAsync = promisify(execFile);

async function testVercelFileDeploy() {
  const tmpDir = path.join(os.tmpdir(), `vcl-test-${Date.now()}`);
  const sourceFolder = path.join(tmpDir, 'source');
  const zipPath = path.join(tmpDir, 'portfolio.zip');

  await fs.mkdir(sourceFolder, { recursive: true });
  await fs.writeFile(path.join(sourceFolder, 'index.html'), '<!DOCTYPE html><html><body><h1>Portfolio</h1></body></html>', 'utf8');
  await fs.writeFile(path.join(sourceFolder, 'style.css'), 'body { background: #000; color: #fff; }', 'utf8');

  // Create zip file
  if (process.platform === 'win32') {
    await execFileAsync('tar', ['-cf', zipPath, '-C', sourceFolder, '.']);
  } else {
    await execFileAsync('zip', ['-r', zipPath, '.'], { cwd: sourceFolder });
  }

  const postedFiles = [];
  let deploymentPayload = null;
  let projectCreated = false;
  let domainLinked = false;

  const mockHttpClient = {
    post: async (url, body, opts = {}) => {
      if (url.includes('/v9/projects')) {
        projectCreated = true;
        return { data: { id: 'prj_test_123', name: body.name } };
      }
      if (url.includes('/domains')) {
        domainLinked = true;
        return { data: { name: body.name } };
      }
      if (url.includes('/v2/files')) {
        const digest = opts.headers?.['x-vercel-digest'];
        postedFiles.push({ digest, size: opts.headers?.['Content-Length'] });
        return { data: { id: `file_${digest}` } };
      }
      if (url.includes('/v13/deployments')) {
        deploymentPayload = body;
        return {
          data: {
            id: 'dpl_test_999',
            url: 'portfolio-test.vercel.app',
            readyState: 'READY',
          },
        };
      }
      throw new Error(`Unexpected POST url: ${url}`);
    },
    get: async () => ({ data: {} }),
  };

  const config = {
    vercelToken: 'test-vercel-token-xyz',
    baseDomain: 'thienhn.io.vn',
  };

  try {
    const res = await vercel.deploy(
      {
        projectName: 'portfolio',
        subdomain: 'portfolio',
        source: 'zip_upload',
        sourcePath: zipPath,
      },
      config,
      mockHttpClient
    );

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.name, 'portfolio');
    assert.strictEqual(res.domain, 'portfolio.thienhn.io.vn');
    assert.strictEqual(res.deploymentId, 'dpl_test_999');
    assert.strictEqual(projectCreated, true, 'Vercel project must be created');
    assert.strictEqual(domainLinked, true, 'Domain must be linked to project');
    assert.strictEqual(postedFiles.length >= 2, true, 'At least 2 files (index.html, style.css) must be uploaded to /v2/files');
    assert(deploymentPayload, 'Deployment payload must be sent');
    assert(Array.isArray(deploymentPayload.files), 'Payload files must be an array');
    const fileNames = deploymentPayload.files.map((f) => f.file);
    assert(fileNames.includes('index.html'), 'Payload must include index.html');
    assert(fileNames.includes('style.css'), 'Payload must include style.css');
    console.log('✅ vercel direct file deploy from zip test passed');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

testVercelFileDeploy().catch((err) => {
  console.error('Vercel file deploy test failed:', err);
  process.exit(1);
});
