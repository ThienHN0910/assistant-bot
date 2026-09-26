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

async function deployZipPayload(zipBuffer, projectName, subdomain, options = {}) {
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const effectiveSub = (subdomain || sanitizedName).toLowerCase();
  const baseDomain = process.env.BASE_DOMAIN || options.baseDomain || 'thienhn.io.vn';
  const domain = `${effectiveSub}.${baseDomain}`;
  const webDeployDir = options.webDeployDir || process.env.WEB_DEPLOY_DIR || path.join(process.env.HOME || '/home/hnt', 'web');
  const targetDir = path.join(webDeployDir, sanitizedName);

  await fs.mkdir(webDeployDir, { recursive: true }).catch(() => {});
  await fs.mkdir(targetDir, { recursive: true }).catch(() => {});

  // Save temporary zip and extract
  const tempZip = path.join(os.tmpdir(), `agent-deploy-${Date.now()}-${sanitizedName}.zip`);
  await fs.writeFile(tempZip, zipBuffer);

  try {
    const unzipCmd = process.platform === 'win32'
      ? await runCmd('tar', ['-xf', tempZip, '-C', targetDir])
      : await runCmd('unzip', ['-o', tempZip, '-d', targetDir]);

    if (!unzipCmd.ok && process.platform !== 'win32') {
      // Fallback to tar if unzip isn't installed
      await runCmd('tar', ['-xf', tempZip, '-C', targetDir]);
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
    await fs.mkdir(confDir, { recursive: true });
    await fs.writeFile(confPath, vhostConfig, 'utf8');

    // Test and reload Nginx if on Linux
    if (process.platform === 'linux') {
      const testRes = await runCmd('nginx', ['-t']);
      if (testRes.ok) {
        await runCmd('systemctl', ['reload', 'nginx']);
      }
    }
  } catch (err) {
    // If not running as root or directory not writable, log warning
    console.warn(`[AGENT_SANDBOX] Nginx conf write skipped/failed: ${err.message}`);
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
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const webDeployDir = options.webDeployDir || process.env.WEB_DEPLOY_DIR || path.join(process.env.HOME || '/home/hnt', 'web');
  const targetDir = path.join(webDeployDir, sanitizedName);

  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});

  const confDir = options.nginxConfDir || '/etc/nginx/conf.d';
  const confPath = path.join(confDir, `${sanitizedName}.conf`);
  await fs.rm(confPath, { force: true }).catch(() => {});

  if (process.platform === 'linux') {
    const testRes = await runCmd('nginx', ['-t']);
    if (testRes.ok) {
      await runCmd('systemctl', ['reload', 'nginx']);
    }
  }

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

module.exports = {
  runCmd,
  generateNginxVhost,
  deployZipPayload,
  removeProject,
  runSelfUpdate,
  restartSelf,
};
