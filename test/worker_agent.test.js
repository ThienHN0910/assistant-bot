const assert = require('assert');
const http = require('http');
const { EventEmitter } = require('events');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const agentSandbox = require('../agent/agentSandbox');
const {
  createAgentServer,
  checkAgentAuth,
  parseJsonBody,
  parseBufferBody,
  validateWorkerConfig,
} = require('../agent/server');

async function makeRequest(server, options, bodyData = null) {
  const addr = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      ...options,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function runTests() {
  const secret = 'test-worker-secret-123';
  let restartCalled = false;

  const mockSandbox = {
    deployZipPayload: async (buf, projectName, subdomain) => ({
      ok: true,
      projectName,
      subdomain,
      size: buf.length,
      domain: `${subdomain}.thienhn.io.vn`,
    }),
    removeProject: async (projectName) => ({ ok: true, projectName }),
    runSelfUpdate: async () => ({ ok: true, output: 'Already up to date.' }),
    restartSelf: () => { restartCalled = true; },
    getProcessList: async () => ({ ok: true, processes: [{ pid: 7, name: 'node' }] }),
    getAgentLogs: async (lines) => ({ ok: true, log: `last ${lines} lines` }),
    cleanCacheAndLogs: async () => ({ ok: true, cacheFreed: '20 MB', pm2Flush: 'OK' }),
    runCmd: async (cmd, args) => ({ ok: true, stdout: `${cmd} ${args.join(' ')}`, stderr: '' }),
  };

  const server = createAgentServer({
    secret,
    sandbox: mockSandbox,
    autoRestart: false,
    maxJsonBytes: 100,
    maxZipBytes: 200,
    metricsProvider: async () => ({
      cpuLoad: 15,
      memory: { usedBytes: 300000000, totalBytes: 1000000000, usedPercentage: 30 },
      uptimeSeconds: 12345,
    }),
  });

  await new Promise((resolve) => server.listen(0, resolve));

  try {
    // 1. Health check without auth -> 200
    const healthRes = await makeRequest(server, { path: '/api/health', method: 'GET' });
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.data.ok, true);
    assert.strictEqual(healthRes.data.status, 'healthy');

    // 2. Metrics without auth -> 401
    const unauthMetrics = await makeRequest(server, { path: '/api/metrics', method: 'GET' });
    assert.strictEqual(unauthMetrics.status, 401);
    assert.strictEqual(unauthMetrics.data.ok, false);

    // 3. Metrics with wrong auth -> 401
    const wrongAuthMetrics = await makeRequest(server, {
      path: '/api/metrics',
      method: 'GET',
      headers: { 'X-Agent-Secret': 'wrong-secret' },
    });
    assert.strictEqual(wrongAuthMetrics.status, 401);

    // 4. Metrics with valid auth -> 200
    const authMetrics = await makeRequest(server, {
      path: '/api/metrics',
      method: 'GET',
      headers: { 'X-Agent-Secret': secret },
    });
    assert.strictEqual(authMetrics.status, 200);
    assert.strictEqual(authMetrics.data.ok, true);
    assert.strictEqual(authMetrics.data.metrics.cpuLoad, 15);
    assert.strictEqual(authMetrics.data.metrics.uptimeSeconds, 12345);

    // 5. Deploy without project name header -> 400
    const deployNoProj = await makeRequest(server, {
      path: '/api/deploy',
      method: 'POST',
      headers: { 'X-Agent-Secret': secret },
    }, Buffer.from('dummy zip content'));
    assert.strictEqual(deployNoProj.status, 400);

    // 6. Deploy with empty payload -> 400
    const deployEmpty = await makeRequest(server, {
      path: '/api/deploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'X-Project-Name': 'demo-site',
      },
    }, Buffer.alloc(0));
    assert.strictEqual(deployEmpty.status, 400);

    // 7. Deploy successful -> 200
    const dummyZip = Buffer.from('fake zip archive data');
    const deploySuccess = await makeRequest(server, {
      path: '/api/deploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'X-Project-Name': 'demo-site',
        'X-Subdomain': 'demo',
      },
    }, dummyZip);
    assert.strictEqual(deploySuccess.status, 200);
    assert.strictEqual(deploySuccess.data.ok, true);
    assert.strictEqual(deploySuccess.data.deployment.projectName, 'demo-site');
    assert.strictEqual(deploySuccess.data.deployment.subdomain, 'demo');

    // 8. Undeploy without project name -> 400
    const undeployNoProj = await makeRequest(server, {
      path: '/api/undeploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'Content-Type': 'application/json',
      },
    }, JSON.stringify({}));
    assert.strictEqual(undeployNoProj.status, 400);

    // 9. Undeploy success -> 200
    const undeploySuccess = await makeRequest(server, {
      path: '/api/undeploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'Content-Type': 'application/json',
      },
    }, JSON.stringify({ projectName: 'demo-site' }));
    assert.strictEqual(undeploySuccess.status, 200);
    assert.strictEqual(undeploySuccess.data.ok, true);
    assert.strictEqual(undeploySuccess.data.removed.projectName, 'demo-site');

    // 10. Self-update -> 200
    const updateRes = await makeRequest(server, {
      path: '/api/update',
      method: 'POST',
      headers: { 'X-Agent-Secret': secret },
    });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.data.ok, true);
    assert.strictEqual(updateRes.data.update.output, 'Already up to date.');

    // 11. Unknown endpoint -> 404
    const notFound = await makeRequest(server, {
      path: '/api/unknown',
      method: 'GET',
      headers: { 'X-Agent-Secret': secret },
    });
    assert.strictEqual(notFound.status, 404);

    // 12. Max payload size guard for JSON (exceeds maxJsonBytes=100) -> 413
    const oversizedJson = JSON.stringify({ projectName: 'a'.repeat(150) });
    const jsonOverflow = await makeRequest(server, {
      path: '/api/undeploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'Content-Type': 'application/json',
      },
    }, oversizedJson);
    assert.strictEqual(jsonOverflow.status, 413);

    // 13. Max payload size guard for ZIP binary (exceeds maxZipBytes=200) -> 413
    const oversizedZip = Buffer.alloc(250, 'Z');
    const zipOverflow = await makeRequest(server, {
      path: '/api/deploy',
      method: 'POST',
      headers: {
        'X-Agent-Secret': secret,
        'X-Project-Name': 'large-project',
      },
    }, oversizedZip);
    assert.strictEqual(zipOverflow.status, 413);

    for (const endpoint of ['/api/processes', '/api/logs?lines=5', '/api/cleancache', '/api/restart', '/api/exec']) {
      const method = endpoint.includes('processes') || endpoint.includes('logs') ? 'GET' : 'POST';
      const unauthorized = await makeRequest(server, { path: endpoint, method });
      assert.strictEqual(unauthorized.status, 401, `${endpoint} requires authentication`);
    }
    const headers = { 'X-Agent-Secret': secret };
    const processes = await makeRequest(server, { path: '/api/processes', method: 'GET', headers });
    assert.strictEqual(processes.status, 200);
    assert.strictEqual(processes.data.processes[0].pid, 7);
    const logs = await makeRequest(server, { path: '/api/logs?lines=5', method: 'GET', headers });
    assert.strictEqual(logs.data.log, 'last 5 lines');
    const clean = await makeRequest(server, { path: '/api/cleancache', method: 'POST', headers });
    assert.strictEqual(clean.data.result.pm2Flush, 'OK');
    const restart = await makeRequest(server, { path: '/api/restart', method: 'POST', headers });
    assert.strictEqual(restart.status, 200);
    const allowed = await makeRequest(server, { path: '/api/exec', method: 'POST', headers }, JSON.stringify({ command: 'hostname' }));
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual(allowed.data.stdout, 'hostname ');
    const blocked = await makeRequest(server, { path: '/api/exec', method: 'POST', headers }, JSON.stringify({ command: 'rm -rf /' }));
    assert.strictEqual(blocked.status, 403);

    console.log('✅ worker agent server standard & size tests passed');
  } finally {
    server.close();
  }

  // 14. Fail-closed auth test when NODE_AGENT_SECRET is unset
  const unconfiguredServer = createAgentServer({
    secret: '',
    metricsProvider: async () => ({ cpuLoad: 5 }),
  });
  await new Promise((resolve) => unconfiguredServer.listen(0, resolve));
  try {
    // Health is public
    const hRes = await makeRequest(unconfiguredServer, { path: '/api/health', method: 'GET' });
    assert.strictEqual(hRes.status, 200);

    // Protected endpoints MUST fail closed (401) even if client sends header
    const mRes = await makeRequest(unconfiguredServer, {
      path: '/api/metrics',
      method: 'GET',
      headers: { 'X-Agent-Secret': 'some-guess' },
    });
    assert.strictEqual(mRes.status, 401);

    const mResEmpty = await makeRequest(unconfiguredServer, {
      path: '/api/metrics',
      method: 'GET',
      headers: { 'X-Agent-Secret': '' },
    });
    assert.strictEqual(mResEmpty.status, 401);
  } finally {
    unconfiguredServer.close();
  }

  // 15. Unit tests for checkAgentAuth (constant-time & fail-closed)
  assert.strictEqual(checkAgentAuth({ headers: {} }, ''), false);
  assert.strictEqual(checkAgentAuth({ headers: {} }, null), false);
  assert.strictEqual(checkAgentAuth({ headers: { 'x-agent-secret': 'foo' } }, ''), false);
  assert.strictEqual(checkAgentAuth({ headers: {} }, 'my-secret'), false);
  assert.strictEqual(checkAgentAuth({ headers: { 'x-agent-secret': 'wrong' } }, 'my-secret'), false);
  assert.strictEqual(checkAgentAuth({ headers: { 'x-agent-secret': 'my-secret' } }, 'my-secret'), true);
  assert.throws(() => validateWorkerConfig({ NODE_AGENT_SECRET: '', WEB_DEPLOY_DIR: '/tmp/web' }), /NODE_AGENT_SECRET/);
  assert.throws(() => validateWorkerConfig({ NODE_AGENT_SECRET: 'dummy-secret', WEB_DEPLOY_DIR: '' }), /WEB_DEPLOY_DIR/);

  const failedUpdateServer = createAgentServer({
    secret,
    sandbox: { ...mockSandbox, runSelfUpdate: async () => ({ ok: false, error: 'npm ci failed' }) },
    autoRestart: false,
  });
  await new Promise((resolve) => failedUpdateServer.listen(0, resolve));
  try {
    const failedUpdate = await makeRequest(failedUpdateServer, {
      path: '/api/update', method: 'POST', headers: { 'X-Agent-Secret': secret },
    });
    assert.strictEqual(failedUpdate.status, 500);
    assert.match(failedUpdate.data.update.error, /npm ci failed/);
  } finally {
    failedUpdateServer.close();
  }

  // 16. Socket error handling in parseJsonBody and parseBufferBody
  const fakeJsonReq = new EventEmitter();
  const jsonPromise = parseJsonBody(fakeJsonReq);
  fakeJsonReq.emit('error', new Error('ECONNRESET in json stream'));
  await assert.rejects(jsonPromise, /ECONNRESET in json stream/);

  const fakeBufReq = new EventEmitter();
  const bufPromise = parseBufferBody(fakeBufReq);
  fakeBufReq.emit('error', new Error('ECONNRESET in buf stream'));
  await assert.rejects(bufPromise, /ECONNRESET in buf stream/);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sandbox-test-'));
  try {
    const oldCwd = process.cwd();
    process.chdir(temp);
    try {
      const updateCalls = [];
      const updateResult = await agentSandbox.runSelfUpdate({
        execFile: async (cmd, args, opts) => {
          updateCalls.push({ cmd, args, cwd: opts.cwd });
          return { stdout: 'updated' };
        },
      });
      assert.strictEqual(updateResult.ok, true);
      assert.deepStrictEqual(updateCalls.map((call) => call.cmd), ['git', 'npm']);
      assert.strictEqual(updateCalls[1].cwd, path.resolve(__dirname, '../agent'));
      const failedInstall = await agentSandbox.runSelfUpdate({
        execFile: async (cmd) => {
          if (cmd === 'npm') throw new Error('npm ci failed');
          return { stdout: 'updated' };
        },
      });
      assert.strictEqual(failedInstall.ok, false);
      assert.match(failedInstall.error, /npm ci failed/);
    } finally {
      process.chdir(oldCwd);
    }
    const oldDeployDir = process.env.WEB_DEPLOY_DIR;
    delete process.env.WEB_DEPLOY_DIR;
    try {
      assert.throws(() => agentSandbox.resolveWebDeployDir({}), /WEB_DEPLOY_DIR/);
      assert.strictEqual(agentSandbox.resolveWebDeployDir({ webDeployDir: temp }), temp);
    } finally {
      if (oldDeployDir === undefined) delete process.env.WEB_DEPLOY_DIR;
      else process.env.WEB_DEPLOY_DIR = oldDeployDir;
    }
    const oldLogPath = process.env.PM2_ERROR_LOG_PATH;
    delete process.env.PM2_ERROR_LOG_PATH;
    try {
      assert.deepStrictEqual(await agentSandbox.getAgentLogs(5), { ok: true, log: '(PM2_ERROR_LOG_PATH not set)' });
    } finally {
      if (oldLogPath === undefined) delete process.env.PM2_ERROR_LOG_PATH;
      else process.env.PM2_ERROR_LOG_PATH = oldLogPath;
    }
    const confPath = path.join(temp, 'site.conf');
    await fs.writeFile(confPath, 'working config');
    const sudoCommands = [];
    await assert.rejects(
      agentSandbox.activateNginxConfig(confPath, 'broken config', {
        platform: 'linux',
        runCommand: async (command, args) => {
          sudoCommands.push([command, ...args]);
          assert.strictEqual(command, 'sudo');
          assert.strictEqual(args[0], '-n');
          if (args[1] === 'install') {
            await fs.copyFile(args[4], args[5]);
            return { ok: true };
          }
          if (args[1] === 'nginx') {
            return { ok: (await fs.readFile(confPath, 'utf8')) === 'working config', stderr: 'bad config' };
          }
          return { ok: true };
        },
      }),
      /nginx -t failed/
    );
    assert.strictEqual(await fs.readFile(confPath, 'utf8'), 'working config', 'failed activation restores prior config');
    assert.ok(sudoCommands.some((args) => args[2] === 'install'), 'site config installed with sudo');
    assert.ok(sudoCommands.some((args) => args[2] === 'nginx'), 'Nginx checked with sudo');
    let firstInstall = true;
    await assert.rejects(
      agentSandbox.activateNginxConfig(confPath, 'new config', {
        platform: 'linux',
        runCommand: async (_command, args) => {
          if (args[1] === 'install') {
            await fs.copyFile(args[4], args[5]);
            if (firstInstall) {
              firstInstall = false;
              return { ok: false, stderr: 'partial install failed' };
            }
          }
          return { ok: true };
        },
      }),
      /partial install failed/
    );
    assert.strictEqual(await fs.readFile(confPath, 'utf8'), 'working config', 'failed install restores prior config');
    await assert.rejects(
      agentSandbox.activateNginxConfig(confPath, 'new config', {
        platform: 'linux',
        runCommand: async (_command, args) => {
          if (args[1] === 'install') await fs.copyFile(args[4], args[5]);
          if (args[1] === 'systemctl') return { ok: false, stderr: 'reload unavailable' };
          return { ok: true };
        },
      }),
      /rollback reload failed: reload unavailable/
    );
    assert.strictEqual(await fs.readFile(confPath, 'utf8'), 'working config');
    const projectDir = path.join(temp, 'remove-me');
    const nginxDir = path.join(temp, 'nginx');
    await fs.mkdir(projectDir);
    await fs.mkdir(nginxDir);
    const removableConf = path.join(nginxDir, 'remove-me.conf');
    await fs.writeFile(removableConf, 'site config');
    const removeCommands = [];
    await agentSandbox.removeProject('remove-me', {
      webDeployDir: temp,
      nginxConfDir: nginxDir,
      platform: 'linux',
      runCommand: async (command, args) => {
        removeCommands.push([command, ...args]);
        if (command !== 'sudo' || args[0] !== '-n') return { ok: false, stderr: 'sudo required' };
        if (args[1] === 'rm') await fs.rm(args[3], { force: true });
        return { ok: true };
      },
    });
    await assert.rejects(fs.access(removableConf), /ENOENT/);
    await assert.rejects(fs.access(projectDir), /ENOENT/);
    assert.ok(removeCommands.some((args) => args[2] === 'systemctl'), 'Nginx reloaded through sudo on undeploy');
    await fs.mkdir(projectDir);
    await fs.writeFile(removableConf, 'live site config');
    let firstReload = true;
    await assert.rejects(
      agentSandbox.removeProject('remove-me', {
        webDeployDir: temp,
        nginxConfDir: nginxDir,
        platform: 'linux',
        runCommand: async (_command, args) => {
          if (args[1] === 'rm') await fs.rm(args[3], { force: true });
          if (args[1] === 'install') await fs.copyFile(args[4], args[5]);
          if (args[1] === 'systemctl' && firstReload) {
            firstReload = false;
            return { ok: false, stderr: 'reload denied' };
          }
          return { ok: true };
        },
      }),
      /reload denied/
    );
    assert.strictEqual(await fs.readFile(removableConf, 'utf8'), 'live site config', 'failed undeploy restores config');
    await fs.access(projectDir);
    await assert.rejects(
      agentSandbox.deployZipPayload(Buffer.from('x'), 'safe-name', 'bad;server_name injected', { webDeployDir: temp }),
      /Invalid subdomain/
    );
    await assert.rejects(agentSandbox.removeProject('!!!', { webDeployDir: temp }), /Invalid project name/);
    await assert.rejects(
      agentSandbox.deployZipPayload(Buffer.from('invalid archive'), 'bad-site', 'bad-site', {
        webDeployDir: temp,
        nginxConfDir: path.join(temp, 'nginx'),
      }),
      /ZIP extraction failed/
    );

    // Test resolveNginxPaths & resolveUploadDir
    const defaultPaths = agentSandbox.resolveNginxPaths('app');
    assert.strictEqual(defaultPaths.availablePath, path.join('/etc/nginx/sites-available', 'web-app'));
    assert.strictEqual(defaultPaths.enabledPath, path.join('/etc/nginx/sites-enabled', 'web-app'));

    const legacyPaths = agentSandbox.resolveNginxPaths('app', { nginxConfDir: '/custom/conf' });
    assert.strictEqual(legacyPaths.availablePath, path.join('/custom/conf', 'app.conf'));
    assert.strictEqual(legacyPaths.enabledPath, null);

    const customDirs = agentSandbox.resolveNginxPaths('app', {
      nginxAvailableDir: '/opt/nginx/sites-available',
      nginxEnabledDir: '/opt/nginx/sites-enabled',
    });
    assert.strictEqual(customDirs.availablePath, path.join('/opt/nginx/sites-available', 'web-app'));
    assert.strictEqual(customDirs.enabledPath, path.join('/opt/nginx/sites-enabled', 'web-app'));

    const uploadDir = agentSandbox.resolveUploadDir({ uploadDir: '/custom/uploads' });
    assert.strictEqual(uploadDir, '/custom/uploads');

    // Test sites-available / sites-enabled Linux activation & symlinking
    const testAvailPath = path.join(temp, 'web-demo');
    const testEnabledPath = path.join(temp, 'symlink-web-demo');
    const symlinkCommands = [];
    await agentSandbox.activateNginxConfig(testAvailPath, 'demo site config', {
      platform: 'linux',
      enabledPath: testEnabledPath,
      runCommand: async (command, args) => {
        symlinkCommands.push([command, ...args]);
        if (args[1] === 'install') await fs.copyFile(args[4], args[5]);
        return { ok: true };
      },
    });
    assert.ok(symlinkCommands.some((c) => c[2] === 'ln' && c[3] === '-sf' && c[4] === testAvailPath && c[5] === testEnabledPath), 'Symlink created in sites-enabled');

    // Test deletion of sites-available and symlink
    const removeSymlinkCommands = [];
    await agentSandbox.activateNginxConfig(testAvailPath, null, {
      platform: 'linux',
      enabledPath: testEnabledPath,
      runCommand: async (command, args) => {
        removeSymlinkCommands.push([command, ...args]);
        return { ok: true };
      },
    });
    assert.ok(removeSymlinkCommands.some((c) => c[2] === 'rm' && c[4] === testEnabledPath), 'Symlink removed from sites-enabled');
    assert.ok(removeSymlinkCommands.some((c) => c[2] === 'rm' && c[4] === testAvailPath), 'Config removed from sites-available');

    // Test restartSelf passes 100M limit and update-env
    let restartArgs = null;
    agentSandbox.restartSelf({
      execFile: (cmd, args) => {
        restartArgs = { cmd, args };
      },
    });
    assert.strictEqual(restartArgs.cmd, 'pm2');
    assert.deepStrictEqual(restartArgs.args, [
      'restart',
      'assistant-node-agent',
      '--update-env',
      '--max-memory-restart',
      '100M',
    ]);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }

  console.log('✅ worker agent hardening tests passed');
}

runTests().catch((err) => {
  console.error('❌ worker agent test failed:', err);
  process.exit(1);
});
