const axios = require('axios');

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

function isEnabled(config) {
  return Boolean(config?.cloudflareApiToken && config?.cloudflareZoneId);
}

function resolveFullDomain(subdomain, baseDomain = 'thienhn.io.vn') {
  if (!subdomain) return baseDomain;
  const cleanSub = subdomain.trim().toLowerCase();
  const cleanBase = (baseDomain || 'thienhn.io.vn').trim().toLowerCase();
  if (cleanSub === cleanBase || cleanSub.endsWith(`.${cleanBase}`)) {
    return cleanSub;
  }
  return `${cleanSub}.${cleanBase}`;
}

async function findCnameRecord(fullDomain, config, client = axios) {
  if (!isEnabled(config)) {
    return null;
  }

  const zoneId = config.cloudflareZoneId;
  const token = config.cloudflareApiToken;

  const url = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(fullDomain)}`;
  const res = await client.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  const records = res.data?.result || [];
  return records.length > 0 ? records[0] : null;
}

async function upsertCnameRecord({ subdomain, targetCname, proxied = false }, config, client = axios) {
  if (!isEnabled(config)) {
    return {
      ok: false,
      skipped: true,
      reason: 'Cloudflare credentials (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID) not configured',
    };
  }

  const baseDomain = config.baseDomain || 'thienhn.io.vn';
  const fullDomain = resolveFullDomain(subdomain, baseDomain);
  const zoneId = config.cloudflareZoneId;
  const token = config.cloudflareApiToken;

  const existing = await findCnameRecord(fullDomain, config, client);

  if (existing) {
    // Update existing CNAME record
    const updateUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${existing.id}`;
    const updateRes = await client.put(
      updateUrl,
      {
        type: 'CNAME',
        name: fullDomain,
        content: targetCname,
        ttl: 1,
        proxied: Boolean(proxied),
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    return {
      ok: true,
      action: 'updated',
      recordId: updateRes.data?.result?.id || existing.id,
      domain: fullDomain,
      target: targetCname,
    };
  }

  // Create new CNAME record
  const createUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`;
  const createRes = await client.post(
    createUrl,
    {
      type: 'CNAME',
      name: fullDomain,
      content: targetCname,
      ttl: 1,
      proxied: Boolean(proxied),
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  return {
    ok: true,
    action: 'created',
    recordId: createRes.data?.result?.id,
    domain: fullDomain,
    target: targetCname,
  };
}

async function deleteCnameRecord({ subdomain, recordId }, config, client = axios) {
  if (!isEnabled(config)) {
    return {
      ok: false,
      skipped: true,
      reason: 'Cloudflare credentials not configured',
    };
  }

  const baseDomain = config.baseDomain || 'thienhn.io.vn';
  const fullDomain = resolveFullDomain(subdomain, baseDomain);
  const zoneId = config.cloudflareZoneId;
  const token = config.cloudflareApiToken;

  let targetId = recordId;
  if (!targetId) {
    const existing = await findCnameRecord(fullDomain, config, client);
    if (!existing) {
      return { ok: true, deleted: false, reason: 'Record not found' };
    }
    targetId = existing.id;
  }

  const deleteUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${targetId}`;
  await client.delete(deleteUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: 10000,
  });

  return { ok: true, deleted: true, recordId: targetId, domain: fullDomain };
}

module.exports = {
  isEnabled,
  resolveFullDomain,
  findCnameRecord,
  upsertCnameRecord,
  deleteCnameRecord,
};
