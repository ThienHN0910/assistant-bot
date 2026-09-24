const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { formatFileSize } = require('../config/utils');

const execAsync = promisify(exec);

async function runCmd(cmd, opts = {}) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 60000, ...opts });
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
        url: meta?.url || (meta?.domain ? `https://${meta.domain}` : (meta?.port ? `http://localhost:${meta.port}` : null)),
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
      return 'backend';
    }

    if (pkg.scripts && pkg.scripts.start) {
      return 'backend';
    }

    if (hasDist || hasRootIndex) {
      return 'static';
    }

    return 'backend';
  }

  if (hasDist || hasRootIndex) {
    return 'static';
  }

  return 'static';
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

async function deployProject(zipFilePath, projectName, port, config) {
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const targetDir = path.join(config.webDeployDir, sanitizedName);

  // 1. Dọn dẹp thư mục cũ nếu có
  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(targetDir, { recursive: true });

  // 2. Giải nén ZIP
  if (process.platform === 'win32') {
    // Trên Windows PowerShell dùng Expand-Archive
    const unzipCmd = `powershell -Command "Expand-Archive -Path '${zipFilePath}' -DestinationPath '${targetDir}' -Force"`;
    const unzipRes = await runCmd(unzipCmd);
    if (!unzipRes.ok) {
      throw new Error(`Lỗi giải nén ZIP: ${unzipRes.stderr}`);
    }
  } else {
    // Trên Linux dùng unzip
    const unzipCmd = `unzip -o "${zipFilePath}" -d "${targetDir}"`;
    const unzipRes = await runCmd(unzipCmd);
    if (!unzipRes.ok) {
      throw new Error(`Lỗi giải nén ZIP: ${unzipRes.stderr}`);
    }
  }

  // 3. Nhận diện loại dự án
  const projectType = await detectProjectType(targetDir);
  const baseDomain = config?.baseDomain || 'thienhn.io.vn';
  const domain = `${sanitizedName}.${baseDomain}`;
  const url = `https://${domain}`;

  // 4. Thiết lập Nginx & tiến trình
  let nginxConf = '';
  if (projectType === 'backend') {
    // Backend Node.js
    if (process.platform !== 'win32') {
      // Cài đặt thư viện nhẹ nhàng (omit dev)
      await runCmd(`cd "${targetDir}" && npm install --omit=dev --no-audit --no-fund`);

      // Tìm entry file
      let entry = 'index.js';
      if (fsSync.existsSync(path.join(targetDir, 'server.js'))) entry = 'server.js';
      else if (fsSync.existsSync(path.join(targetDir, 'app.js'))) entry = 'app.js';

      // Khởi động bằng PM2
      const pm2Name = `web-${sanitizedName}`;
      await runCmd(`pm2 delete "${pm2Name}"`).catch(() => {});
      await runCmd(`PORT=${port} pm2 start "${entry}" --name "${pm2Name}" --cwd "${targetDir}"`);
    }

    nginxConf = generateNginxConfig({
      name: sanitizedName,
      type: 'backend',
      port,
      domain,
    });
  } else {
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

  await runCmd(`sudo mv "${tmpPath}" "${availablePath}"`);
  await runCmd(`sudo chmod 644 "${availablePath}"`);
  await runCmd(`sudo ln -sf "${availablePath}" "${enabledPath}"`);

  // Kiểm tra syntax và reload
  const testRes = await runCmd('sudo nginx -t');
  if (!testRes.ok) {
    // Rollback symlink nếu lỗi syntax
    await runCmd(`sudo rm -f "${enabledPath}"`);
    throw new Error(`Cấu hình Nginx lỗi: ${testRes.stderr}`);
  }

  await runCmd('sudo systemctl reload nginx');
}

async function removeProject(projectName, config) {
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const webDeployDir = config?.webDeployDir || '/home/hnt/web';
  const targetDir = path.join(webDeployDir, sanitizedName);
  const siteName = `web-${sanitizedName}`;

  // 1. Dừng PM2 nếu có
  if (process.platform !== 'win32') {
    await runCmd(`pm2 delete "${siteName}"`).catch(() => {});
    await runCmd(`sudo rm -f "/etc/nginx/sites-enabled/${siteName}"`).catch(() => {});
    await runCmd(`sudo rm -f "/etc/nginx/sites-available/${siteName}"`).catch(() => {});
    await runCmd('sudo systemctl reload nginx').catch(() => {});
  }

  // 2. Xóa thư mục
  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});

  return { ok: true, name: sanitizedName };
}

module.exports = {
  listUploadZipFiles,
  listDeployments,
  getNextAvailablePort,
  detectProjectType,
  generateNginxConfig,
  deployProject,
  removeProject,
};
