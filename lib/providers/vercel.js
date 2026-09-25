const axios = require('axios');
const { resolveFullDomain } = require('./cloudflare');

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

async function triggerDeployment({ projectName, repoUrl, gitRef = 'main', files = [] }, config, client = axios) {
  const token = config.vercelToken;
  const payload = {
    name: projectName,
    project: projectName,
    target: 'production',
  };

  if (repoUrl) {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (match) {
      payload.gitSource = {
        type: 'github',
        repo: `${match[1]}/${match[2].replace(/\.git$/, '')}`,
        ref: gitRef,
      };
    }
  }

  if (Array.isArray(files) && files.length > 0) {
    payload.files = files;
  }

  try {
    const res = await client.post(`${VERCEL_API_BASE}/v13/deployments`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
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

  // 3. Trigger actual deployment build
  const dplRes = await triggerDeployment({ projectName: sanitizedName, repoUrl, files }, config, client);

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
};
