const axios = require('axios');

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

function isEnabled(config) {
  return Boolean(config?.cloudflareApiToken && config?.cloudflareZoneId);
}

function resolveFullDomain(subdomain, baseDomain = 'thienhn.io.vn') {
  if (!subdomain || typeof subdomain !== 'string') throw new Error('Subdomain is required');
  const cleanSub = subdomain.trim().toLowerCase();
  const cleanBase = (baseDomain || 'thienhn.io.vn').trim().toLowerCase();
  const label = cleanSub.endsWith(`.${cleanBase}`) ? cleanSub.slice(0, -(cleanBase.length + 1)) : cleanSub;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
    throw new Error('Invalid subdomain label');
  }
  return `${label}.${cleanBase}`;
}

function checkResponse(response, action) {
  if (response?.data?.success !== true) {
    const codes = (response?.data?.errors || []).map((error) => error.code).filter(Boolean).join(', ');
    throw new Error(`Cloudflare ${action} failed${codes ? ` (${codes})` : ''}`);
  }
  return response.data;
}

async function findDnsRecord(fullDomain, type = null, config, client = axios) {
  if (!isEnabled(config)) {
    return null;
  }

  const zoneId = config.cloudflareZoneId;
  const token = config.cloudflareApiToken;

  const records = [];
  for (let page = 1; page <= 100; page += 1) {
    const query = type ? `type=${encodeURIComponent(type)}&` : '';
    const url = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?${query}name=${encodeURIComponent(fullDomain)}&per_page=100&page=${page}`;
    const res = await client.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    const data = checkResponse(res, 'lookup');
    if (!Array.isArray(data.result)) throw new Error('Cloudflare lookup returned malformed records');
    records.push(...data.result.filter((record) => record.name?.toLowerCase() === fullDomain.toLowerCase() && (!type || record.type === type)));
    const totalPages = data.result_info?.total_pages || 1;
    if (!Number.isInteger(totalPages) || totalPages < 1) throw new Error('Cloudflare lookup returned invalid pagination');
    if (page >= totalPages) break;
    if (page === 100) throw new Error('Cloudflare lookup exceeds safe pagination limit');
  }
  if (records.length > 1) throw new Error(`DNS collision: multiple records exist for ${fullDomain}`);
  return records[0] || null;
}

async function findCnameRecord(fullDomain, config, client = axios) {
  return findDnsRecord(fullDomain, 'CNAME', config, client);
}

async function upsertARecord({ subdomain, ip, proxied = true, ownedRecordId, ownershipTag }, config, client = axios) {
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

  const existing = await findDnsRecord(fullDomain, null, config, client);

  if (existing) {
    if (!ownedRecordId || existing.id !== ownedRecordId || (existing.type && existing.type !== 'A')) {
      throw new Error(`DNS collision: ${fullDomain} is not an owned A record`);
    }
    const updateUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${existing.id}`;
    const updateRes = await client.put(
      updateUrl,
      {
        type: 'A',
        name: fullDomain,
        content: ip,
        ttl: 1,
        proxied: Boolean(proxied),
        ...((ownershipTag || existing.comment) ? { comment: ownershipTag || existing.comment } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (checkResponse(updateRes, 'A update')?.result?.id !== existing.id) throw new Error('Cloudflare A update returned invalid record ID');
    return {
      ok: true,
      action: 'updated',
      recordId: updateRes.data?.result?.id || existing.id,
      domain: fullDomain,
      ip,
    };
  }

  if (ownedRecordId) throw new Error(`Owned DNS record ${ownedRecordId} is missing`);
  const createUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`;
  const createRes = await client.post(
    createUrl,
    {
      type: 'A',
      name: fullDomain,
      content: ip,
      ttl: 1,
      proxied: Boolean(proxied),
      ...(ownershipTag ? { comment: ownershipTag } : {}),
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  if (!checkResponse(createRes, 'A create')?.result?.id) throw new Error('Cloudflare A create returned no record ID');
  return {
    ok: true,
    action: 'created',
    recordId: createRes.data?.result?.id,
    domain: fullDomain,
    ip,
  };
}

async function upsertCnameRecord({ subdomain, targetCname, proxied = false, ownedRecordId, ownershipTag }, config, client = axios) {
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

  const existing = await findDnsRecord(fullDomain, null, config, client);

  if (existing) {
    if (!ownedRecordId || existing.id !== ownedRecordId || (existing.type && existing.type !== 'CNAME')) {
      throw new Error(`DNS collision: ${fullDomain} is not an owned CNAME record`);
    }
    const updateUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${existing.id}`;
    const updateRes = await client.put(
      updateUrl,
      {
        type: 'CNAME',
        name: fullDomain,
        content: targetCname,
        ttl: 1,
        proxied: Boolean(proxied),
        ...((ownershipTag || existing.comment) ? { comment: ownershipTag || existing.comment } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (checkResponse(updateRes, 'CNAME update')?.result?.id !== existing.id) throw new Error('Cloudflare CNAME update returned invalid record ID');
    return {
      ok: true,
      action: 'updated',
      recordId: updateRes.data?.result?.id || existing.id,
      domain: fullDomain,
      target: targetCname,
    };
  }

  if (ownedRecordId) throw new Error(`Owned DNS record ${ownedRecordId} is missing`);
  const createUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`;
  const createRes = await client.post(
    createUrl,
    {
      type: 'CNAME',
      name: fullDomain,
      content: targetCname,
      ttl: 1,
      proxied: Boolean(proxied),
      ...(ownershipTag ? { comment: ownershipTag } : {}),
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  if (!checkResponse(createRes, 'CNAME create')?.result?.id) throw new Error('Cloudflare CNAME create returned no record ID');
  return {
    ok: true,
    action: 'created',
    recordId: createRes.data?.result?.id,
    domain: fullDomain,
    target: targetCname,
  };
}

async function deleteDnsRecord({ subdomain, type, recordId }, config, client = axios) {
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

  if (!recordId || !['A', 'CNAME'].includes(type)) {
    throw new Error('DNS ownership requires a record ID and type');
  }
  const recordUrl = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${encodeURIComponent(recordId)}`;
  let record;
  try {
    const res = await client.get(recordUrl, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    record = checkResponse(res, 'record lookup')?.result;
  } catch (error) {
    if (error.response?.status === 404) return { ok: true, deleted: false, recordId, domain: fullDomain };
    throw error;
  }
  if (record?.id !== recordId || record.name?.toLowerCase() !== fullDomain || record.type !== type) {
    throw new Error(`DNS ownership mismatch for ${fullDomain}`);
  }
  const deleteRes = await client.delete(recordUrl, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });
  if (checkResponse(deleteRes, 'record delete')?.result?.id !== recordId) {
    throw new Error('Cloudflare record delete returned invalid record ID');
  }
  return { ok: true, deleted: true, recordId, domain: fullDomain };
}

async function deleteCnameRecord({ subdomain, recordId }, config, client = axios) {
  return deleteDnsRecord({ subdomain, type: 'CNAME', recordId }, config, client);
}

module.exports = {
  isEnabled,
  resolveFullDomain,
  findDnsRecord,
  findCnameRecord,
  upsertARecord,
  upsertCnameRecord,
  deleteDnsRecord,
  deleteCnameRecord,
};
