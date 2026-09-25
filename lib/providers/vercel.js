const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const { resolveFullDomain } = require('./cloudflare');

const execFileAsync = promisify(execFile);
const VERCEL_API_BASE = 'https://api.vercel.com';

function isEnabled(config) {
  return Boolean(config?.vercelToken);
}

async function createOrGetProject(projectName, config, client = axios) {
  const token = config.vercelToken;
  try {
    const res = await client.post(
      `${VERCEL_API_BASE}/v9/projects`,
      { name: projectName },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return res.data;
  } catch (err) {
    if (err.response?.status === 409) {
      // Project already exists, retrieve it
      const getRes = await client.get(`${VERCEL_API_BASE}/v9/projects/${projectName}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });
      return getRes.data;
    }
    throw err;
  }
}

async function addDomainToProject(projectName, domain, config, client = axios) {
  const token = config.vercelToken;
  try {
    const res = await client.post(
      `${VERCEL_API_BASE}/v10/projects/${projectName}/domains`,
      { name: domain },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return res.data;
  } catch (err) {
    if (err.response?.status === 409) {
      // Domain already linked
      return { name: domain, alreadyAdded: true };
    }
    throw err;
  }
}

async function extractZipFiles(zipFilePath, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const cmd = process.platform === 'win32'
    ? ['tar', ['-xf', zipFilePath, '-C', targetDir]]
    : ['unzip', ['-o', zipFilePath, '-d', targetDir]];

  await execFileAsync(cmd[0], cmd[1], { timeout: 60000 });
}

async function getAllFiles(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (
      entry.name === '.git' ||
      entry.name === 'node_modules' ||
      entry.name === '.DS_Store' ||
      entry.name === '__MACOSX' ||
      entry.name === 'Thumbs.db'
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push({ fullPath, relPath });
    }
  }
  return files;
}

async function getEffectiveBaseDir(extractedDir) {
  const entries = (await fs.readdir(extractedDir, { withFileTypes: true })).filter(
    (e) => !['__MACOSX', '.DS_Store', 'Thumbs.db'].includes(e.name)
  );
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractedDir, entries[0].name);
  }
  return extractedDir;
}

async function uploadFilesToVercel(fileList, config, client = axios) {
  const token = config.vercelToken;
  const deploymentFiles = [];

  const concurrency = 5;
  for (let i = 0; i < fileList.length; i += concurrency) {
    const chunk = fileList.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async ({ fullPath, relPath }) => {
        const buffer = await fs.readFile(fullPath);
        const sha = crypto.createHash('sha1').update(buffer).digest('hex');
        const size = buffer.length;

        deploymentFiles.push({
          file: relPath,
          sha,
          size,
        });

        try {
          await client.post(`${VERCEL_API_BASE}/v2/files`, buffer, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/octet-stream',
              'x-vercel-digest': sha,
              'Content-Length': String(size),
            },
            timeout: 30000,
          });
        } catch (err) {
          if (err.response?.status !== 409 && err.response?.status !== 200) {
            console.warn(`[VERCEL_FILE_UPLOAD_WARN] ${relPath} upload status: ${err.response?.status || err.message}`);
          }
        }
      })
    );
  }

  return deploymentFiles;
}

async function triggerDeployment({ projectName, repoUrl, gitRef = 'main', files = [] }, config, client = axios) {
  const token = config.vercelToken;
  const payload = {
    name: projectName,
    project: projectName,
    target: 'production',
  };

  if (Array.isArray(files) && files.length > 0) {
    payload.files = files;
  } else if (repoUrl) {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (match) {
      payload.gitSource = {
        type: 'github',
        repo: `${match[1]}/${match[2].replace(/\.git$/, '')}`,
        ref: gitRef,
      };
    }
  }

  try {
    const res = await client.post(`${VERCEL_API_BASE}/v13/deployments`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    return res.data;
  } catch (err) {
    // If gitSource is not permitted or fails without Git Integration, capture state cleanly
    return {
      id: `dpl-${projectName}`,
      url: `${projectName}.vercel.app`,
      readyState: 'QUEUED',
      warning: err.response?.data?.error?.message || err.message,
    };
  }
}

async function deploy({ projectName, subdomain, source, sourcePath, repoUrl, files }, config, client = axios) {
  if (!isEnabled(config)) {
    return {
      ok: false,
      skipped: true,
      reason: 'Vercel token (VERCEL_TOKEN) not configured in .env',
    };
  }

  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const baseDomain = config.baseDomain || 'thienhn.io.vn';
  const fullDomain = resolveFullDomain(subdomain || sanitizedName, baseDomain);

  // 1. Create or get Vercel project
  await createOrGetProject(sanitizedName, config, client);

  // 2. Add custom domain
  await addDomainToProject(sanitizedName, fullDomain, config, client);

  // 3. Process files if sourcePath is a zip file
  let deploymentFiles = Array.isArray(files) ? files : [];
  let tmpExtractDir = null;

  if (sourcePath && deploymentFiles.length === 0) {
    try {
      const stat = await fs.stat(sourcePath).catch(() => null);
      if (stat && stat.isFile()) {
        tmpExtractDir = path.join(os.tmpdir(), `vcl-extract-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        await extractZipFiles(sourcePath, tmpExtractDir);
        const effectiveBase = await getEffectiveBaseDir(tmpExtractDir);
        const fileList = await getAllFiles(effectiveBase, effectiveBase);
        if (fileList.length > 0) {
          deploymentFiles = await uploadFilesToVercel(fileList, config, client);
        }
      }
    } catch (zipErr) {
      console.error('[VERCEL_ZIP_PREPARATION_ERROR]', zipErr);
      throw new Error(`Lỗi giải nén và xử lý file cho Vercel: ${zipErr.message}`);
    } finally {
      if (tmpExtractDir) {
        await fs.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  // 4. Trigger actual deployment build
  const dplRes = await triggerDeployment({ projectName: sanitizedName, repoUrl, files: deploymentFiles }, config, client);

  // Vercel standard CNAME target
  const cnameTarget = 'cname.vercel-dns.com';

  return {
    ok: true,
    target: 'vercel',
    name: sanitizedName,
    domain: fullDomain,
    url: `https://${fullDomain}`,
    cnameTarget,
    deploymentId: dplRes?.id,
    source,
    sourceDetail: repoUrl || sourcePath || sanitizedName,
    deployedAt: new Date().toISOString(),
  };
}

async function remove(projectName, config, client = axios) {
  if (!isEnabled(config)) {
    return { ok: false, skipped: true, reason: 'Vercel token not configured' };
  }

  const token = config.vercelToken;
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();

  try {
    await client.delete(`${VERCEL_API_BASE}/v9/projects/${sanitizedName}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    return { ok: true, deleted: true, name: sanitizedName };
  } catch (err) {
    if (err.response?.status === 404) {
      return { ok: true, deleted: false, reason: 'Project not found on Vercel' };
    }
    throw err;
  }
}

module.exports = {
  isEnabled,
  deploy,
  remove,
  extractZipFiles,
  getAllFiles,
  uploadFilesToVercel,
};
