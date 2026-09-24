const axios = require('axios');
const { resolveFullDomain } = require('./cloudflare');

const RENDER_API_BASE = 'https://api.render.com/v1';

function isEnabled(config) {
  return Boolean(config?.renderApiKey && config?.renderOwnerId);
}

async function deploy({ projectName, subdomain, repoUrl, branch = 'main', serviceType = 'static_site' }, config, client = axios) {
  if (!isEnabled(config)) {
    return {
      ok: false,
      skipped: true,
      reason: 'Render credentials (RENDER_API_KEY / RENDER_OWNER_ID) not configured in .env',
    };
  }

  if (!repoUrl) {
    throw new Error('Render provider requires a public GitHub repository URL');
  }

  const token = config.renderApiKey;
  const ownerId = config.renderOwnerId;
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const baseDomain = config.baseDomain || 'thienhn.io.vn';
  const fullDomain = resolveFullDomain(subdomain || sanitizedName, baseDomain);

  // 1. Create Service on Render
  const createRes = await client.post(
    `${RENDER_API_BASE}/services`,
    {
      type: serviceType,
      name: sanitizedName,
      ownerId,
      repo: repoUrl,
      branch,
      autoDeploy: 'no',
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  const service = createRes.data?.service || createRes.data;
  const serviceId = service?.id || `srv-${sanitizedName}`;
  const slug = service?.slug || sanitizedName;
  const cnameTarget = `${slug}.onrender.com`;

  // 2. Add custom domain
  try {
    await client.post(
      `${RENDER_API_BASE}/services/${serviceId}/custom-domains`,
      { name: fullDomain },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    console.warn(`[RENDER_CUSTOM_DOMAIN_WARN] Could not attach ${fullDomain}: ${err.message}`);
  }

  return {
    ok: true,
    target: 'render',
    serviceId,
    name: sanitizedName,
    domain: fullDomain,
    url: `https://${fullDomain}`,
    cnameTarget,
    source: 'github_public',
    sourceDetail: repoUrl,
    deployedAt: new Date().toISOString(),
  };
}

async function remove(serviceId, config, client = axios) {
  if (!isEnabled(config)) {
    return { ok: false, skipped: true, reason: 'Render credentials not configured' };
  }

  const token = config.renderApiKey;
  try {
    await client.delete(`${RENDER_API_BASE}/services/${serviceId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    return { ok: true, deleted: true, serviceId };
  } catch (err) {
    if (err.response?.status === 404) {
      return { ok: true, deleted: false, reason: 'Service not found on Render' };
    }
    throw err;
  }
}

module.exports = {
  isEnabled,
  deploy,
  remove,
};
