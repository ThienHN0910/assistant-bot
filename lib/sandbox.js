const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { formatFileSize } = require('../config/utils');

const execFileAsync = promisify(execFile);

async function runCmd(cmd, args = [], opts = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 60000, maxBuffer: 1024 * 1024, ...opts });
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

function requireOk(result, operation) {
  if (!result.ok) throw new Error(`${operation} failed: ${result.stderr || result.code}`);
}

async function waitForBackendListener(port, commandRunner = runCmd, attempts = 30, delayMs = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await commandRunner('ss', ['-ltnH'], { timeout: 3000 });
    requireOk(result, 'Backend listener inspection');
    const listeners = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.trim().split(/\s+/)[3]);
    const onPort = listeners.filter((address) => address?.endsWith(`:${port}`));
    if (onPort.some((address) => address !== `127.0.0.1:${port}`)) {
      throw new Error(`Backend port ${port} is listening on a public interface`);
    }
    if (onPort.length) return;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Backend did not start listening on localhost:${port}`);
}

async function listUploadZipFiles(uploadDir) {
  try {
    await fs.mkdir(uploadDir, { recursive: true }).catch(() => {});

    // Quét cả uploadDir lẫn thư mục cha (ví dụ /home/hnt/uploads và /home/hnt)
    const dirsToScan = [uploadDir];
    const parentDir = path.dirname(uploadDir);
    if (parentDir && parentDir !== uploadDir && !dirsToScan.includes(parentDir)) {
      dirsToScan.push(parentDir);
    }

    const zips = [];
    const seenNames = new Set();

    for (const dir of dirsToScan) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (!file.toLowerCase().endsWith('.zip')) continue;
          if (seenNames.has(file)) continue;

          const fullPath = path.join(dir, file);
          try {
            const stat = await fs.stat(fullPath);
            if (stat.isFile()) {
              seenNames.add(file);
              zips.push({
                name: file,
                fullPath,
                sizeBytes: stat.size,
                sizeFormatted: formatFileSize(stat.size),
                mtime: stat.mtime,
              });
            }
          } catch {}
        }
      } catch {}
    }

    return zips.sort((a, b) => b.mtime - a.mtime);
  } catch (error) {
    console.error('[SANDBOX_LIST_ZIPS_ERROR]', error.message || error);
    return [];
  }
}

async function getDirSize(dirPath) {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await getDirSize(full);
      } else if (entry.isFile()) {
        const s = await fs.stat(full);
        total += s.size;
      }
    }
  } catch {}
  return total;
}

async function listDeployments(webDeployDir) {
  try {
    await fs.mkdir(webDeployDir, { recursive: true });
    const items = await fs.readdir(webDeployDir, { withFileTypes: true });
    const deployments = [];

    for (const item of items) {
      if (!item.isDirectory()) continue;
      const projectDir = path.join(webDeployDir, item.name);
      const metaPath = path.join(projectDir, 'meta.json');

      let meta = null;
      try {
        const raw = await fs.readFile(metaPath, 'utf8');
        meta = JSON.parse(raw);
      } catch {}

      const sizeBytes = await getDirSize(projectDir);

      deployments.push({
        name: item.name,
        port: meta?.port || null,
        type: meta?.type || 'unknown',
        domain: meta?.domain || null,
        url: meta?.url || (meta?.domain ? `https://${meta.domain}` : null),
        target: meta?.target || 'vps',
        source: meta?.source || 'zip_upload',
        deployedAt: meta?.deployedAt || null,
        dir: projectDir,
        sizeBytes,
        sizeFormatted: formatFileSize(sizeBytes),
      });
    }

    return deployments.sort((a, b) => (a.port || 0) - (b.port || 0));
  } catch (error) {
    console.error('[SANDBOX_LIST_DEPLOYMENTS_ERROR]', error.message || error);
    return [];
  }
}

async function getNextAvailablePort(webDeployDir, startPort = 8081) {
  const deployments = await listDeployments(webDeployDir);
  const usedPorts = new Set(deployments.map((d) => d.port).filter(Boolean));

  let candidate = Number(startPort) || 8081;
  while (usedPorts.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

async function detectProjectType(projectDir) {
  const distIndex = path.join(projectDir, 'dist', 'index.html');
  const rootIndex = path.join(projectDir, 'index.html');
  const hasDist = fsSync.existsSync(distIndex);
  const hasRootIndex = fsSync.existsSync(rootIndex);
  const pkgPath = path.join(projectDir, 'package.json');
  const hasPackageJson = fsSync.existsSync(pkgPath);

  if (hasPackageJson) {
    let pkg = {};
    try {
      pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    } catch {}

    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    const frontendFrameworks = [
      'vite',
      '@vitejs/plugin-react',
      '@vitejs/plugin-vue',
      'react-scripts',
      '@vue/cli-service',
      '@angular/core',
      'svelte',
      'astro',
    ];

    const backendFrameworks = [
      'express',
      'fastify',
      'koa',
      'nest',
      '@nestjs/core',
      'hono',
      'hapi',
      '@hapi/hapi',
      'socket.io',
      'ws',
    ];

    const hasFrontendFramework = frontendFrameworks.some((f) => allDeps[f]);
    const hasBackendFramework = backendFrameworks.some((b) => allDeps[b]);
    const hasServerJs = fsSync.existsSync(path.join(projectDir, 'server.js'));
    const hasAppJs = fsSync.existsSync(path.join(projectDir, 'app.js'));
    const hasIndexJs = fsSync.existsSync(path.join(projectDir, 'index.js'));

    // Reject unbuilt frontend source code on VPS due to 1GB RAM constraint
    if (hasFrontendFramework && !hasBackendFramework && !hasServerJs && !hasAppJs) {
      if (hasDist) {
        return 'static';
      }
      throw new Error(
        'Dự án là Frontend chưa build (chưa có dist/). Máy chủ VPS (1GB RAM) không hỗ trợ chạy build. Vui lòng build local trước khi nén ZIP, hoặc triển khai qua Vercel/Render.'
      );
    }

    if (hasBackendFramework || hasServerJs || hasAppJs || (hasIndexJs && !hasFrontendFramework)) {
      if (!hasServerJs && !hasAppJs && !hasIndexJs && !pkg.scripts?.start) {
        throw new Error('Backend needs a server.js/app.js/index.js entry point or npm start script');
      }
      return 'backend';
    }

    if (pkg.scripts && pkg.scripts.start) {
      return 'backend';
    }

    if (hasDist || hasRootIndex) {
      return 'static';
    }

    throw new Error('Project has no runnable entry point or index.html');
  }

  if (hasDist || hasRootIndex) {
    return 'static';
  }

  throw new Error('Static website needs an index.html entry point');
}

function generateNginxConfig({ name, type, rootPath, port, domain }) {
  const serverName = domain || '_';
  const sslCert = '/etc/ssl/certs/cloudflare_cert.pem';
  const sslKey = '/etc/ssl/private/cloudflare_key.key';

  const redirectBlock = `
# 1. Chuyển hướng toàn bộ HTTP (cổng 80) sang HTTPS (cổng 443)
server {
    listen 80;
    server_name ${serverName};
    return 301 https://$host$request_uri;
}
`.trim();

  let httpsContent = '';
  if (type === 'backend') {
    httpsContent = `
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
`.trim();
  } else {
    httpsContent = `
    root ${rootPath};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
`.trim();
  }

  const sslBlock = `
# 2. Xử lý HTTPS chính thức với chứng chỉ Cloudflare
server {
    listen 443 ssl;
    server_name ${serverName};

    ssl_certificate ${sslCert};
    ssl_certificate_key ${sslKey};

    # Cấu hình giao thức TLS an toàn
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    ${httpsContent}

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
}
`.trim();

  return `${redirectBlock}\n\n${sslBlock}`;
}

async function deployProject(zipFilePath, projectName, port, config, subdomain = projectName) {
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const targetDir = path.join(config.webDeployDir, sanitizedName);

  const archive = await fs.stat(zipFilePath);
  if (!archive.isFile()) throw new Error('ZIP archive must be a regular file');
  await fs.mkdir(config.webDeployDir, { recursive: true });
  try {
    await fs.mkdir(targetDir);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const collision = new Error(`Deployment directory already exists: ${sanitizedName}`);
      collision.code = 'ORIGIN_EXISTS';
      throw collision;
    }
    throw error;
  }

  try {

  // 2. Giải nén ZIP
  const unzipRes = process.platform === 'win32'
    ? await runCmd('tar', ['-xf', zipFilePath, '-C', targetDir])
    : await runCmd('unzip', ['-o', zipFilePath, '-d', targetDir]);
  requireOk(unzipRes, 'ZIP extraction');

  // Chuẩn hóa cấu trúc thư mục nếu ZIP đóng gói lồng 1 thư mục cha (như GitHub zipball hoặc user zips)
  while (true) {
    const extractedItems = (await fs.readdir(targetDir, { withFileTypes: true })).filter(
      (e) => !['__MACOSX', '.DS_Store', 'Thumbs.db'].includes(e.name)
    );
    if (extractedItems.length === 1 && extractedItems[0].isDirectory()) {
      const subDir = path.join(targetDir, extractedItems[0].name);
      const subFiles = await fs.readdir(subDir);
      for (const f of subFiles) {
        await fs.rename(path.join(subDir, f), path.join(targetDir, f));
      }
      await fs.rm(subDir, { recursive: true, force: true }).catch(() => {});
    } else {
      break;
    }
  }

  // 3. Nhận diện loại dự án
  const projectType = await detectProjectType(targetDir);
  const baseDomain = config?.baseDomain || 'thienhn.io.vn';
  const domain = `${subdomain}.${baseDomain}`;
  const url = `https://${domain}`;

  // 4. Thiết lập Nginx & tiến trình
  let nginxConf = '';
  if (projectType === 'backend') {
    port = port || await getNextAvailablePort(config.webDeployDir, config.webPortStart);
    // Backend Node.js
    if (process.platform !== 'win32') {
      const beforeStart = await runCmd('ss', ['-ltnH'], { timeout: 3000 });
      requireOk(beforeStart, 'Backend port availability check');
      if (beforeStart.stdout.split(/\r?\n/).some((line) => line.trim().split(/\s+/)[3]?.endsWith(`:${port}`))) {
        throw new Error(`Backend port ${port} is already in use`);
      }
      // Cài đặt thư viện nhẹ nhàng (omit dev)
      requireOk(await runCmd('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: targetDir }), 'npm install');

      // Tìm entry file
      let entry = 'index.js';
      if (fsSync.existsSync(path.join(targetDir, 'server.js'))) entry = 'server.js';
      else if (fsSync.existsSync(path.join(targetDir, 'app.js'))) entry = 'app.js';
      else if (!fsSync.existsSync(path.join(targetDir, 'index.js'))) entry = 'npm';

      // Khởi động bằng PM2
      const pm2Name = `web-${sanitizedName}`;
      const pm2Args = ['start', entry, '--name', pm2Name, '--cwd', targetDir];
      if (entry === 'npm') pm2Args.push('--', 'start');
      requireOk(await runCmd('pm2', pm2Args, {
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
      }), 'PM2 start');
      await waitForBackendListener(port);
    }

    nginxConf = generateNginxConfig({
      name: sanitizedName,
      type: 'backend',
      port,
      domain,
    });
  } else {
    port = null;
    // Web tĩnh / Single Page Application
    let rootPath = targetDir;
    if (fsSync.existsSync(path.join(targetDir, 'dist', 'index.html'))) {
      rootPath = path.join(targetDir, 'dist');
    }

    nginxConf = generateNginxConfig({
      name: sanitizedName,
      type: 'static',
      rootPath,
      domain,
    });
  }

  await applyNginxConfig(sanitizedName, nginxConf);

  // 5. Ghi nhận metadata
  const meta = {
    name: sanitizedName,
    port,
    type: projectType,
    domain,
    url,
    target: 'vps',
    source: 'zip_upload',
    deployedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(targetDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  return { ok: true, name: sanitizedName, port, type: projectType, domain, url };
  } catch (error) {
    error.originCreated = true;
    throw error;
  }
}

async function applyNginxConfig(name, configContent) {
  if (process.platform === 'win32') {
    // Trên Windows (local dev/test), bỏ qua áp dụng Nginx
    return;
  }

  const siteName = `web-${name}`;
  const availablePath = `/etc/nginx/sites-available/${siteName}`;
  const enabledPath = `/etc/nginx/sites-enabled/${siteName}`;

  // Ghi file cấu hình tạm
  const tmpPath = `/tmp/${siteName}.conf`;
  await fs.writeFile(tmpPath, configContent.trim(), 'utf8');

  requireOk(await runCmd('sudo', ['mv', tmpPath, availablePath]), 'Nginx config install');
  requireOk(await runCmd('sudo', ['chmod', '644', availablePath]), 'Nginx config permissions');
  requireOk(await runCmd('sudo', ['ln', '-sf', availablePath, enabledPath]), 'Nginx site enable');

  // Kiểm tra syntax và reload
  const testRes = await runCmd('sudo', ['nginx', '-t']);
  if (!testRes.ok) {
    // Rollback symlink nếu lỗi syntax
    await runCmd('sudo', ['rm', '-f', enabledPath]);
    throw new Error(`Cấu hình Nginx lỗi: ${testRes.stderr}`);
  }

  requireOk(await runCmd('sudo', ['systemctl', 'reload', 'nginx']), 'Nginx reload');
}

async function removeProject(projectName, config) {
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const webDeployDir = config?.webDeployDir || '/home/hnt/web';
  const targetDir = path.join(webDeployDir, sanitizedName);
  const siteName = `web-${sanitizedName}`;
  let meta = null;
  try {
    meta = JSON.parse(await fs.readFile(path.join(targetDir, 'meta.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // 1. Dừng PM2 nếu có
  if (process.platform !== 'win32') {
    if (meta?.type === 'backend' || !meta) {
      const pm2Res = await runCmd('pm2', ['delete', siteName]);
      if (!pm2Res.ok && pm2Res.code !== 'ENOENT' && !/not found|does not exist/i.test(`${pm2Res.stderr} ${pm2Res.stdout}`)) {
        requireOk(pm2Res, 'PM2 delete');
      }
    }
    requireOk(await runCmd('sudo', ['rm', '-f', `/etc/nginx/sites-enabled/${siteName}`]), 'Nginx site disable');
    requireOk(await runCmd('sudo', ['rm', '-f', `/etc/nginx/sites-available/${siteName}`]), 'Nginx config delete');
    requireOk(await runCmd('sudo', ['nginx', '-t']), 'Nginx syntax check');
    requireOk(await runCmd('sudo', ['systemctl', 'reload', 'nginx']), 'Nginx reload');
  }

  // 2. Xóa thư mục
  await fs.rm(targetDir, { recursive: true, force: true });

  return { ok: true, name: sanitizedName };
}

module.exports = {
  listUploadZipFiles,
  listDeployments,
  getNextAvailablePort,
  detectProjectType,
  waitForBackendListener,
  generateNginxConfig,
  deployProject,
  removeProject,
};
