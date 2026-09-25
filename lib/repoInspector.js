const axios = require('axios');

const GITHUB_API_BASE = 'https://api.github.com';

const FRONTEND_DEPS = {
  react: 'React',
  'react-dom': 'React',
  vue: 'Vue',
  next: 'Next.js',
  nuxt: 'Nuxt.js',
  svelte: 'Svelte',
  '@angular/core': 'Angular',
  vite: 'Vite',
  astro: 'Astro',
  gatsby: 'Gatsby',
};

const BACKEND_DEPS = {
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  '@nestjs/core': 'NestJS',
  nest: 'NestJS',
  hono: 'Hono',
  socketio: 'Socket.IO',
};

function parseGithubUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid GitHub repository URL');
  }
  const clean = url.trim();
  const match = clean.match(/^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/i);
  if (!match) {
    throw new Error('Invalid GitHub repository URL: Must be https://github.com/owner/repo');
  }
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  return { owner, repo };
}

async function getRepoContents(owner, repo, subpath = '', client = axios) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${subpath}`;
  const res = await client.get(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'assistant-bot-inspector',
    },
    timeout: 10000,
  });
  return res.data;
}

async function readPackageJson(owner, repo, subpath = 'package.json', client = axios) {
  try {
    const data = await getRepoContents(owner, repo, subpath, client);
    if (!data || !data.content) return null;
    const contentStr = Buffer.from(data.content, data.encoding || 'base64').toString('utf8');
    return JSON.parse(contentStr);
  } catch {
    return null;
  }
}

function detectFrameworksFromPkg(pkg) {
  if (!pkg) return [];
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const frameworks = new Set();
  for (const [dep, label] of Object.entries(FRONTEND_DEPS)) {
    if (allDeps[dep]) frameworks.add(label);
  }
  for (const [dep, label] of Object.entries(BACKEND_DEPS)) {
    if (allDeps[dep]) frameworks.add(label);
  }
  return Array.from(frameworks);
}

function isFrontendPkg(pkg) {
  if (!pkg) return false;
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return Object.keys(FRONTEND_DEPS).some((dep) => Boolean(allDeps[dep]));
}

function isBackendPkg(pkg) {
  if (!pkg) return false;
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return Object.keys(BACKEND_DEPS).some((dep) => Boolean(allDeps[dep]));
}

async function inspectRepo(urlOrTarget, options = {}) {
  const client = options.client || axios;
  const { owner, repo } = typeof urlOrTarget === 'string'
    ? parseGithubUrl(urlOrTarget)
    : urlOrTarget;

  let contents;
  try {
    contents = await getRepoContents(owner, repo, '', client);
  } catch (err) {
    if (err.response?.status === 404) {
      throw new Error(`Kho lưu trữ https://github.com/${owner}/${repo} không tồn tại hoặc đang ở chế độ private.`);
    }
    if (err.response?.status === 403) {
      throw new Error('Vượt quá giới hạn gọi GitHub API (Rate Limit). Vui lòng thử lại sau.');
    }
    throw new Error(`Không thể kiểm tra GitHub repo: ${err.message}`);
  }

  if (!Array.isArray(contents)) {
    throw new Error('Không thể đọc danh mục tệp tin từ GitHub repository.');
  }

  const fileNames = contents.map((c) => c.name.toLowerCase());
  const dirNames = contents.filter((c) => c.type === 'dir').map((c) => c.name.toLowerCase());

  // 1. Kiểm tra cấu trúc Monorepo
  const feDirs = ['frontend', 'client', 'web', 'ui'].filter((d) => dirNames.includes(d));
  const beDirs = ['backend', 'server', 'api'].filter((d) => dirNames.includes(d));

  if (feDirs.length > 0 && beDirs.length > 0) {
    const feDir = feDirs[0];
    const beDir = beDirs[0];
    const fePkg = await readPackageJson(owner, repo, `${feDir}/package.json`, client);
    const bePkg = await readPackageJson(owner, repo, `${beDir}/package.json`, client);
    const feFrameworks = detectFrameworksFromPkg(fePkg);
    const beFrameworks = detectFrameworksFromPkg(bePkg);

    return {
      ok: true,
      owner,
      repo,
      repoUrl: `https://github.com/${owner}/${repo}`,
      type: 'monorepo',
      title: 'Monorepo (Frontend + Backend)',
      summary: `Phát hiện Monorepo gồm Frontend (${feDir}/: ${feFrameworks.join(', ') || 'Static'}) và Backend (${beDir}/: ${beFrameworks.join(', ') || 'Node'})`,
      frontend: {
        dir: feDir,
        frameworks: feFrameworks.length > 0 ? feFrameworks : ['Static HTML'],
        target: 'vercel',
      },
      backend: {
        dir: beDir,
        frameworks: beFrameworks.length > 0 ? beFrameworks : ['Node.js'],
        target: 'render',
      },
      targets: ['vercel', 'render', 'both'],
      defaultTarget: 'both',
    };
  }

  // 2. Kiểm tra package.json ở root
  const rootPkg = await readPackageJson(owner, repo, 'package.json', client);
  if (rootPkg) {
    const frameworks = detectFrameworksFromPkg(rootPkg);
    const hasFrontend = isFrontendPkg(rootPkg);
    const hasBackend = isBackendPkg(rootPkg);

    if (hasFrontend && !hasBackend) {
      return {
        ok: true,
        owner,
        repo,
        repoUrl: `https://github.com/${owner}/${repo}`,
        type: 'frontend_spa',
        title: `Frontend SPA (${frameworks.join(', ')})`,
        summary: `Ứng dụng Frontend độc lập xây dựng bằng ${frameworks.join(', ')}`,
        frameworks,
        targets: ['vercel'],
        defaultTarget: 'vercel',
      };
    }

    if (hasBackend && !hasFrontend) {
      return {
        ok: true,
        owner,
        repo,
        repoUrl: `https://github.com/${owner}/${repo}`,
        type: 'backend_api',
        title: `Backend Web API (${frameworks.join(', ')})`,
        summary: `Dịch vụ Backend xây dựng bằng ${frameworks.join(', ')}`,
        frameworks,
        targets: ['render'],
        defaultTarget: 'render',
      };
    }
  }

  // 3. Kiểm tra Web tĩnh thuần (HTML/CSS/JS không build)
  if (fileNames.includes('index.html')) {
    return {
      ok: true,
      owner,
      repo,
      repoUrl: `https://github.com/${owner}/${repo}`,
      type: 'static_pure',
      title: 'Web tĩnh thuần (HTML/CSS/JS)',
      summary: 'Trang web tĩnh có tệp index.html tại thư mục gốc, không yêu cầu build',
      frameworks: ['HTML5', 'CSS3', 'JavaScript'],
      targets: ['vps', 'vercel'],
      defaultTarget: 'vps',
    };
  }

  // 4. Mặc định fallback
  return {
    ok: true,
    owner,
    repo,
    repoUrl: `https://github.com/${owner}/${repo}`,
    type: 'unknown',
    title: 'Kho lưu trữ thông thường',
    summary: 'Không nhận diện được framework cụ thể, khuyến nghị kiểm tra thủ công',
    frameworks: [],
    targets: ['vps', 'vercel', 'render'],
    defaultTarget: 'vps',
  };
}

module.exports = {
  parseGithubUrl,
  inspectRepo,
  detectFrameworksFromPkg,
};
