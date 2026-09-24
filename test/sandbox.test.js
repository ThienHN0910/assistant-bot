const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const sandbox = require('../lib/sandbox');

async function testSandbox() {
  const testRoot = path.join(__dirname, 'test_sandbox_env');
  const uploadDir = path.join(testRoot, 'uploads');
  const webDir = path.join(testRoot, 'web');

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.mkdir(webDir, { recursive: true });

  try {
    // 1. Test listUploadZipFiles
    await fs.writeFile(path.join(uploadDir, 'app1.zip'), 'dummy zip content', 'utf8');
    await fs.writeFile(path.join(uploadDir, 'not-zip.txt'), 'not zip', 'utf8');

    const zips = await sandbox.listUploadZipFiles(uploadDir);
    assert.strictEqual(zips.length, 1, 'Should find exactly 1 zip file');
    assert.strictEqual(zips[0].name, 'app1.zip', 'Zip name should match');
    console.log('✅ sandbox listUploadZipFiles test passed');

    // 2. Test getNextAvailablePort
    const port1 = await sandbox.getNextAvailablePort(webDir, 8081);
    assert.strictEqual(port1, 8081, 'First available port should be 8081');

    // Mock an existing deployment
    const project1Dir = path.join(webDir, 'app1');
    await fs.mkdir(project1Dir, { recursive: true });
    await fs.writeFile(
      path.join(project1Dir, 'meta.json'),
      JSON.stringify({ name: 'app1', port: 8081, type: 'static' }),
      'utf8'
    );

    const port2 = await sandbox.getNextAvailablePort(webDir, 8081);
    assert.strictEqual(port2, 8082, 'Next available port should be 8082');
    console.log('✅ sandbox getNextAvailablePort test passed');

    // 3. Test listDeployments
    await fs.writeFile(
      path.join(project1Dir, 'meta.json'),
      JSON.stringify({
        name: 'app1',
        port: 8081,
        type: 'static',
        domain: 'app1.thienhn.io.vn',
        url: 'https://app1.thienhn.io.vn',
        target: 'vps',
        source: 'zip_upload',
      }),
      'utf8'
    );
    const deployments = await sandbox.listDeployments(webDir);
    assert.strictEqual(deployments.length, 1, 'Should list 1 deployment');
    assert.strictEqual(deployments[0].name, 'app1');
    assert.strictEqual(deployments[0].port, 8081);
    assert.strictEqual(deployments[0].domain, 'app1.thienhn.io.vn');
    assert.strictEqual(deployments[0].url, 'https://app1.thienhn.io.vn');
    assert.strictEqual(deployments[0].target, 'vps');
    assert.strictEqual(deployments[0].source, 'zip_upload');
    console.log('✅ sandbox listDeployments with subdomain metadata test passed');

    // 4. Test generateNginxConfig
    const staticConf = sandbox.generateNginxConfig({
      name: 'app1',
      type: 'static',
      rootPath: '/home/hnt/web/app1/dist',
      domain: 'app1.thienhn.io.vn',
    });
    assert(staticConf.includes('server_name app1.thienhn.io.vn;'), 'Static conf should include server_name');
    assert(staticConf.includes('root /home/hnt/web/app1/dist;'), 'Static conf should include root path');
    assert(staticConf.includes('listen 80;'), 'Static conf should listen on 80');

    const backendConf = sandbox.generateNginxConfig({
      name: 'api1',
      type: 'backend',
      port: 8082,
      domain: 'api1.thienhn.io.vn',
    });
    assert(backendConf.includes('server_name api1.thienhn.io.vn;'), 'Backend conf should include server_name');
    assert(backendConf.includes('proxy_pass http://127.0.0.1:8082;'), 'Backend conf should proxy to local port');
    console.log('✅ sandbox generateNginxConfig static and backend test passed');

    // 5. Test detectProjectType
    const staticType = await sandbox.detectProjectType(project1Dir);
    assert.strictEqual(staticType, 'static', 'Should detect static');

    const backendDir = path.join(testRoot, 'backend_app');
    await fs.mkdir(backendDir, { recursive: true });
    await fs.writeFile(path.join(backendDir, 'package.json'), '{"name":"api"}', 'utf8');
    const backendType = await sandbox.detectProjectType(backendDir);
    assert.strictEqual(backendType, 'backend', 'Should detect backend');
    console.log('✅ sandbox detectProjectType test passed');

    // 6. Test removeProject
    await sandbox.removeProject('app1', { webDeployDir: webDir });
    const remaining = await sandbox.listDeployments(webDir);
    assert.strictEqual(remaining.length, 0, 'Deployments should be empty after removal');
    console.log('✅ sandbox removeProject test passed');
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }
}

testSandbox().catch((err) => {
  console.error('Sandbox test failed:', err);
  process.exit(1);
});
