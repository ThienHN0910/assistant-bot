const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function runCmd(cmd, args = [], opts = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 60000, ...opts });
    return { ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout || '').trim(),
      stderr: (error.stderr || error.message || String(error)).trim(),
      code: error.code,
    };
  }
}

function generateNginxVhost({ domain, rootPath, sslCert, sslKey }) {
  return `
server {
    listen 80;
    server_name ${domain};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${domain};

    ssl_certificate ${sslCert};
    ssl_certificate_key ${sslKey};

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root ${rootPath};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
}
`.trim();
}

async function activateNginxConfig(confPath, contents, options = {}) {
  const platform = options.platform || process.platform;
  const command = options.runCommand || runCmd;
  let previous = null;
  try {
    previous = await fs.readFile(confPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  async function changeConfig(value) {
    if (value === null) {
      if (platform === 'linux') {
        const removed = await command('sudo', ['-n', 'rm', '-f', confPath]);
        if (!removed.ok) throw new Error(`Nginx config removal failed: ${removed.stderr}`);
      } else {
        await fs.rm(confPath, { force: true });
      }
      return;
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-nginx-'));
    const tempPath = path.join(tempDir, 'site.conf');
    try {
      await fs.writeFile(tempPath, value, { mode: 0o600 });
      if (platform === 'linux') {
        const installed = await command('sudo', ['-n', 'install', '-m', '644', tempPath, confPath]);
        if (!installed.ok) throw new Error(`Nginx config install failed: ${installed.stderr}`);
      } else {
        await fs.mkdir(path.dirname(confPath), { recursive: true });
        await fs.copyFile(tempPath, confPath);
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  try {
    await changeConfig(contents);
    if (platform === 'linux') {
      const tested = await command('sudo', ['-n', 'nginx', '-t']);
      if (!tested.ok) throw new Error(`nginx -t failed: ${tested.stderr}`);
      const reloaded = await command('sudo', ['-n', 'systemctl', 'reload', 'nginx']);
      if (!reloaded.ok) throw new Error(`nginx reload failed: ${reloaded.stderr}`);
    }
  } catch (err) {
    try {
      await changeConfig(previous);
    } catch (rollbackError) {
      throw new Error(`${err.message}; rollback failed: ${rollbackError.message}`);
    }
    if (platform === 'linux') {
      const restored = await command('sudo', ['-n', 'nginx', '-t']);
      if (!restored.ok) throw new Error(`${err.message}; rollback nginx -t failed: ${restored.stderr}`);
      const reloaded = await command('sudo', ['-n', 'systemctl', 'reload', 'nginx']);
      if (!reloaded.ok) throw new Error(`${err.message}; rollback reload failed: ${reloaded.stderr}`);
    }
    throw err;
  }
}

function resolveWebDeployDir(options = {}) {
  const directory = options.webDeployDir || process.env.WEB_DEPLOY_DIR;
  if (!directory) throw new Error('WEB_DEPLOY_DIR must be configured in worker .env');
  return directory;
}

async function deployZipPayload(zipBuffer, projectName, subdomain, options = {}) {
  if (typeof projectName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(projectName)) {
    throw new Error('Invalid project name');
  }
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const effectiveSub = (subdomain || sanitizedName).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(effectiveSub)) {
    throw new Error('Invalid subdomain');
  }
  const baseDomain = process.env.BASE_DOMAIN || options.baseDomain || 'thienhn.io.vn';
  const domain = `${effectiveSub}.${baseDomain}`;
  const webDeployDir = resolveWebDeployDir(options);
  const targetDir = path.join(webDeployDir, sanitizedName);

  await fs.mkdir(targetDir, { recursive: true });

  // Save temporary zip and extract
  const tempZip = path.join(os.tmpdir(), `agent-deploy-${Date.now()}-${sanitizedName}.zip`);
  await fs.writeFile(tempZip, zipBuffer);

  try {
    const unzipCmd = process.platform === 'win32'
      ? await runCmd('tar', ['-xf', tempZip, '-C', targetDir])
      : await runCmd('unzip', ['-o', tempZip, '-d', targetDir]);

    let extractResult = unzipCmd;
    if (!unzipCmd.ok && process.platform !== 'win32') {
      // Fallback to tar if unzip isn't installed
      extractResult = await runCmd('tar', ['-xf', tempZip, '-C', targetDir]);
    }
    if (!extractResult.ok) {
      await fs.rm(targetDir, { recursive: true, force: true });
      throw new Error('ZIP extraction failed: archive is invalid or extractor is unavailable');
    }

    // Flatten nested single subdirectory if needed
    try {
      const items = (await fs.readdir(targetDir, { withFileTypes: true })).filter(
        (e) => !['__MACOSX', '.DS_Store', 'Thumbs.db'].includes(e.name)
      );
      if (items.length === 1 && items[0].isDirectory()) {
        const nestedDir = path.join(targetDir, items[0].name);
        const subFiles = await fs.readdir(nestedDir);
        for (const file of subFiles) {
          await fs.rename(path.join(nestedDir, file), path.join(targetDir, file));
        }
        await fs.rm(nestedDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch {}
  } finally {
    await fs.rm(tempZip, { force: true }).catch(() => {});
  }

  const extractedFiles = await fs.readdir(targetDir);
  if (extractedFiles.length === 0) {
    await fs.rm(targetDir, { recursive: true, force: true });
    throw new Error('ZIP extraction failed: no files extracted');
  }
  if (process.platform === 'linux') {
    const permissions = await runCmd('chmod', ['-R', '755', targetDir]);
    if (!permissions.ok) throw new Error(`Cannot make deployed files readable: ${permissions.stderr}`);
  }

  // Generate Nginx configuration
  const sslCert = process.env.SSL_CERT_PATH || options.sslCert || '/etc/ssl/certs/cloudflare_cert.pem';
  const sslKey = process.env.SSL_KEY_PATH || options.sslKey || '/etc/ssl/private/cloudflare_key.key';
  const vhostConfig = generateNginxVhost({
    domain,
    rootPath: targetDir,
    sslCert,
    sslKey,
  });

  const confDir = options.nginxConfDir || '/etc/nginx/conf.d';
  const confPath = path.join(confDir, `${sanitizedName}.conf`);

  try {
    await activateNginxConfig(confPath, vhostConfig);
  } catch (err) {
    throw new Error(`Nginx configuration failed: ${err.message}`);
  }

  return {
    ok: true,
    projectName: sanitizedName,
    subdomain: effectiveSub,
    type: 'static',
    domain,
    url: `https://${domain}`,
  };
}

async function removeProject(projectName, options = {}) {
  if (typeof projectName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(projectName)) {
    throw new Error('Invalid project name');
  }
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const webDeployDir = resolveWebDeployDir(options);
  const targetDir = path.join(webDeployDir, sanitizedName);
  const confDir = options.nginxConfDir || '/etc/nginx/conf.d';
  const confPath = path.join(confDir, `${sanitizedName}.conf`);
  await activateNginxConfig(confPath, null, options);

  await fs.rm(targetDir, { recursive: true, force: true });

  return { ok: true, projectName: sanitizedName };
}

async function runSelfUpdate() {
  try {
    const pull = await execFileAsync('git', ['pull', 'origin', 'main'], { timeout: 30000 });
    let npmOut = '';
    try {
      const npmRes = await execFileAsync('npm', ['install', '--omit=dev'], { timeout: 60000 });
      npmOut = (npmRes.stdout || '').trim();
    } catch {}
    return { ok: true, output: `${pull.stdout.trim()}${npmOut ? `\n${npmOut}` : ''}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function restartSelf() {
  execFile('pm2', ['restart', 'assistant-node-agent'], () => {});
}

async function getProcessList() {
  const result = await runCmd('ps', ['aux', '--sort=-%mem'], { timeout: 10000, maxBuffer: 64 * 1024 });
  if (!result.ok) return { ok: false, error: result.stderr };
  const processes = result.stdout.split('\n').slice(1, 6).map((line) => {
    const parts = line.trim().split(/\s+/);
    return { user: parts[0] || '', pid: Number(parts[1]) || 0,
      cpu: Number(parts[2]) || 0, mem: Number(parts[3]) || 0,
      name: parts.slice(10).join(' ').slice(0, 80) };
  });
  return { ok: true, processes };
}

async function getAgentLogs(lines = 20) {
  const logPath = process.env.PM2_ERROR_LOG_PATH;
  if (!logPath) return { ok: true, log: '(PM2_ERROR_LOG_PATH not set)' };
  let handle;
  try {
    handle = await fs.open(logPath, 'r');
    const stat = await handle.stat();
    const size = Math.min(stat.size, 64 * 1024);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, stat.size - size);
    return { ok: true, log: buffer.toString('utf8').split('\n').slice(-Math.max(1, Math.min(lines, 100))).join('\n') };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await handle?.close();
  }
}

async function cleanCacheAndLogs() {
  const pm2 = await runCmd('pm2', ['flush'], { timeout: 30000, maxBuffer: 64 * 1024 });
  let cacheFreed = 'N/A';
  if (process.platform === 'linux') {
    await runCmd('sync', [], { timeout: 10000 });
    const drop = await runCmd('sh', ['-c', 'echo 3 | sudo -n tee /proc/sys/vm/drop_caches'], {
      timeout: 10000, maxBuffer: 64 * 1024,
    });
    cacheFreed = drop.ok ? 'cache cleared' : 'cache clear unavailable';
  }
  return { ok: pm2.ok, cacheFreed, pm2Flush: pm2.ok ? 'OK' : pm2.stderr };
}

module.exports = {
  runCmd,
  generateNginxVhost,
  activateNginxConfig,
  resolveWebDeployDir,
  deployZipPayload,
  removeProject,
  runSelfUpdate,
  restartSelf,
  getProcessList,
  getAgentLogs,
  cleanCacheAndLogs,
};
