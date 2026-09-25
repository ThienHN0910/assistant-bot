const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const net = require('net');
const crypto = require('crypto');
const cloudflare = require('./providers/cloudflare');
const vercel = require('./providers/vercel');
const render = require('./providers/render');
const sandbox = require('./sandbox');

let cachedVpsIp = null;
const registryLocks = new Map();

async function withRegistryLock(registryPath, action) {
  const key = path.resolve(registryPath);
  const previous = registryLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  registryLocks.set(key, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (registryLocks.get(key) === queued) registryLocks.delete(key);
  }
}

function isPublicIpv4(value) {
  if (net.isIP(value) !== 4) return false;
  const [a, b, c] = value.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113);
}

function requirePublicIpv4(value) {
  const ip = String(value || '').trim();
  if (!isPublicIpv4(ip)) throw new Error('VPS_PUBLIC_IP must be a valid public IPv4 address');
  return ip;
}

async function getVpsPublicIp(config, client = axios) {
  if (config?.vpsPublicIp) {
    return requirePublicIpv4(config.vpsPublicIp);
  }
  if (cachedVpsIp) {
    return cachedVpsIp;
  }
  try {
    const res = await client.get('https://api.ipify.org?format=json', { timeout: 4000 });
    if (res.data?.ip) {
      cachedVpsIp = requirePublicIpv4(res.data.ip);
      return cachedVpsIp;
    }
  } catch {}

  try {
    const res2 = await client.get('https://ifconfig.me/ip', { timeout: 4000 });
    if (res2.data) {
      cachedVpsIp = requirePublicIpv4(res2.data);
      return cachedVpsIp;
    }
  } catch {}

  throw new Error('Unable to determine a valid public IPv4 address for this VPS');
}

function getActiveTargets(config) {
  const targets = ['vps'];
  // Cloud targets stay hidden until their providers can prove a real deployment is ready.
  if (config?.cloudTargetsReady && vercel.isEnabled(config)) targets.push('vercel');
  if (config?.cloudTargetsReady && render.isEnabled(config)) targets.push('render');
  return targets;
}

function getValidTargetsForSource(source, config) {
  const active = getActiveTargets(config);
  if (source === 'github_public') {
    // Public GitHub links are allowed ONLY for Vercel or Render
    return active.filter((t) => t === 'vercel' || t === 'render');
  }
  // ZIP uploads are allowed for VPS or Vercel
  return active.filter((t) => t === 'vps' || t === 'vercel');
}

async function loadRegistry(registryPath) {
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Deployment registry must be an array');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveRegistry(registryPath, items) {
  const dir = path.dirname(registryPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${registryPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(items, null, 2), 'utf8');
    await fs.rename(tempPath, registryPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function resolveAvailableSubdomain(baseName, config, deps = {}) {
  const depListAllDeployments = deps.listAllDeployments || listAllDeployments;

  let sanitized = (baseName || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!sanitized) sanitized = 'app';

  const existingDeployments = await depListAllDeployments(config).catch(() => []);
  const baseDomain = (config?.baseDomain || 'thienhn.io.vn').toLowerCase();

  const usedSubdomains = new Set();
  for (const dep of existingDeployments) {
    if (dep.name) usedSubdomains.add(dep.name.toLowerCase());
    if (dep.subdomain) usedSubdomains.add(dep.subdomain.toLowerCase());
    if (dep.domain) {
      const cleanDom = dep.domain.toLowerCase();
      if (cleanDom.endsWith(`.${baseDomain}`)) {
        const sub = cleanDom.replace(new RegExp(`\\.${baseDomain}$`), '');
        usedSubdomains.add(sub);
      } else {
        const first = cleanDom.split('.')[0];
        if (first) usedSubdomains.add(first);
      }
    }
  }

  // If not taken, use directly
  if (!usedSubdomains.has(sanitized)) {
    return sanitized;
  }

  // If taken, try suffix 0, then 1, 2, ...
  let counter = 0;
  while (true) {
    const candidate = `${sanitized}${counter}`;
    if (!usedSubdomains.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
}

async function listAllDeployments(config) {
  const registryPath = config.deployRegistryPath || path.resolve(process.cwd(), 'data/deployments.json');
  const registry = await loadRegistry(registryPath);

  // Sync with local VPS deployments
  let vpsDeployments = [];
  if (config.webDeployDir) {
    vpsDeployments = await sandbox.listDeployments(config.webDeployDir);
  }

  const vpsMap = new Map(vpsDeployments.map((d) => [d.name, d]));
  const seenNames = new Set();
  const merged = [];

  for (const item of registry) {
    seenNames.add(item.name);
    if (item.target === 'vps' && vpsMap.has(item.name)) {
      const vpsInfo = vpsMap.get(item.name);
      merged.push({
        ...item,
        port: vpsInfo.port,
        sizeFormatted: vpsInfo.sizeFormatted,
        status: item.status || 'online',
      });
    } else {
      merged.push(item);
    }
  }

  // Any VPS deployments not in registry
  for (const vps of vpsDeployments) {
    if (!seenNames.has(vps.name)) {
      merged.push({
        id: vps.name,
        name: vps.name,
        target: 'vps',
        source: 'zip_upload',
        domain: vps.domain || null,
        url: vps.url || null,
        port: vps.port,
        sizeFormatted: vps.sizeFormatted,
        status: 'legacy_unmanaged',
        deployedAt: vps.deployedAt || new Date().toISOString(),
      });
    }
  }

  return merged;
}

async function deployUnlocked(
  { source, sourcePath, repoUrl, projectName, target, subdomain, port },
  config,
  deps = {}
) {
  const depSandbox = deps.sandbox || sandbox;
  const depVercel = deps.vercel || vercel;
  const depRender = deps.render || render;
  const depCloudflare = deps.cloudflare || cloudflare;

  // 1. Validate Target and Source Compatibility
  if (source === 'github_public' && target === 'vps') {
    throw new Error('Không hỗ trợ deploy link GitHub public trực tiếp lên VPS. Vui lòng chọn Vercel hoặc Render.');
  }

  const validTargets = ['vps', 'vercel', 'render'];
  if (!validTargets.includes(target)) {
    throw new Error(`Nền tảng đích '${target}' không hợp lệ. Hỗ trợ: ${validTargets.join(', ')}`);
  }

  if (target !== 'vps' && !config.cloudTargetsReady) {
    throw new Error('Vercel and Render deployment targets are temporarily disabled until origin readiness is verified');
  }

  // 2. Validate Feature Flag for Target
  if (target === 'vercel' && !depVercel.isEnabled(config)) {
    throw new Error('Nền tảng Vercel chưa được cấu hình VERCEL_TOKEN trong .env.');
  }
  if (target === 'render' && !depRender.isEnabled(config)) {
    throw new Error('Nền tảng Render chưa được cấu hình RENDER_API_KEY hoặc RENDER_OWNER_ID trong .env.');
  }

  if (!projectName || typeof projectName !== 'string') throw new Error('Project name is required');
  const sanitizedName = projectName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  const baseDomain = config.baseDomain || 'thienhn.io.vn';
  const effectiveSubdomain = (subdomain || sanitizedName).toLowerCase();
  const fullDomain = depCloudflare.resolveFullDomain(effectiveSubdomain, baseDomain);
  if (!depCloudflare.isEnabled(config)) throw new Error('Cloudflare DNS credentials are required for deployment');
  const registryPath = config.deployRegistryPath || path.resolve(process.cwd(), 'data/deployments.json');
  const registry = await loadRegistry(registryPath);
  let existingIdx = registry.findIndex((item) => item.name === sanitizedName);
  const existing = existingIdx >= 0 ? registry[existingIdx] : null;
  if (existing && (!['failed_dns', 'failed_origin', 'provisioning_dns', 'provisioning_origin'].includes(existing.status) || existing.target !== target || existing.domain !== fullDomain)) {
    throw new Error(`Deployment ${sanitizedName} already exists; remove it before replacing`);
  }
  if (registry.some((item) => item.domain === fullDomain && item.name !== sanitizedName)) {
    throw new Error(`Subdomain ${fullDomain} is already assigned`);
  }
  if (target === 'vps' && !existing) {
    const localDir = path.join(config.webDeployDir, sanitizedName);
    try {
      await fs.access(localDir);
      throw new Error(`VPS origin ${sanitizedName} already exists outside the deployment registry`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let recoveredDnsId = null;
  if (typeof depCloudflare.findDnsRecord === 'function') {
    const currentDns = await depCloudflare.findDnsRecord(fullDomain, null, config);
    if (currentDns) {
      const expectedType = target === 'vps' ? 'A' : 'CNAME';
      const ownedById = currentDns.id === existing?.dnsRecordId;
      const ownedByTag = Boolean(existing?.dnsOwnershipTag && currentDns.comment === existing.dnsOwnershipTag);
      if (currentDns.type !== expectedType || (!ownedById && !ownedByTag)) {
        throw new Error(`DNS collision: ${fullDomain} already exists outside this deployment`);
      }
      recoveredDnsId = currentDns.id;
    }
  }
  const vpsIp = target === 'vps' ? await getVpsPublicIp(config, deps.client || axios) : null;
  if (target === 'vps' && !vpsIp) throw new Error('Unable to determine VPS public IP');

  let deployResult = existing;

  // 3. Execute Deployment per Target
  if ((!existing || ['failed_origin', 'provisioning_origin'].includes(existing.status)) && target === 'vps') {
    const reservation = {
      id: sanitizedName,
      name: sanitizedName,
      target: 'vps',
      source: source || 'zip_upload',
      sourceDetail: path.basename(sourcePath || sanitizedName),
      domain: fullDomain,
      url: `https://${fullDomain}`,
      status: 'provisioning_origin',
      dnsStatus: 'pending',
      dnsOwnershipTag: existing?.dnsOwnershipTag || `assistant-bot:${crypto.randomUUID()}`,
    };
    if (existingIdx >= 0) {
      registry[existingIdx] = reservation;
    } else {
      registry.push(reservation);
      existingIdx = registry.length - 1;
    }
    await saveRegistry(registryPath, registry);

    if (existing) {
      try {
        const cleanup = await depSandbox.removeProject(sanitizedName, config);
        if (!cleanup?.ok) throw new Error('Previous incomplete VPS origin cleanup was not confirmed');
      } catch (error) {
        reservation.status = 'failed_origin';
        reservation.lastError = error.message;
        await saveRegistry(registryPath, registry);
        throw error;
      }
    }
    let vpsRes;
    try {
      vpsRes = await depSandbox.deployProject(sourcePath, sanitizedName, port, config, effectiveSubdomain);
    } catch (error) {
      if (error.code === 'ORIGIN_EXISTS') {
        if (existingIdx >= 0) registry[existingIdx] = existing;
        else registry.splice(registry.indexOf(reservation), 1);
        await saveRegistry(registryPath, registry);
        throw error;
      }
      let cleanupError = null;
      if (error.originCreated) {
        try {
          const cleanup = await depSandbox.removeProject(sanitizedName, config);
          if (!cleanup?.ok) cleanupError = 'Origin cleanup was not confirmed';
        } catch (failure) {
          cleanupError = failure.message;
        }
      }
      const failed = {
        ...reservation,
        status: 'failed_origin',
        dnsStatus: 'pending',
        lastError: cleanupError ? `${error.message}; cleanup: ${cleanupError}` : error.message,
      };
      if (existingIdx >= 0) registry[existingIdx] = failed;
      else registry.push(failed);
      await saveRegistry(registryPath, registry);
      throw error;
    }
    if (!vpsRes.ok) throw new Error('VPS origin deployment failed');

    deployResult = {
      id: sanitizedName,
      name: sanitizedName,
      target: 'vps',
      source: source || 'zip_upload',
      sourceDetail: path.basename(sourcePath || sanitizedName),
      domain: vpsRes.domain || fullDomain,
      url: vpsRes.url || `https://${fullDomain}`,
      port: vpsRes.type === 'backend' ? vpsRes.port : null,
      type: vpsRes.type,
      dnsOwnershipTag: reservation.dnsOwnershipTag,
      dnsStatus: 'pending',
      status: 'provisioning_dns',
      deployedAt: new Date().toISOString(),
    };
  } else if (!existing && target === 'vercel') {
    const vercelRes = await depVercel.deploy(
      {
        projectName: sanitizedName,
        subdomain: effectiveSubdomain,
        source,
        sourcePath,
        repoUrl,
      },
      config
    );

    deployResult = {
      id: sanitizedName,
      name: sanitizedName,
      target: 'vercel',
      source: source || 'github_public',
      sourceDetail: repoUrl || path.basename(sourcePath || ''),
      domain: vercelRes.domain || fullDomain,
      url: vercelRes.url || `https://${fullDomain}`,
      cnameTarget: vercelRes.cnameTarget,
      dnsStatus: 'pending',
      status: 'provisioning_dns',
      deployedAt: vercelRes.deployedAt || new Date().toISOString(),
    };
  } else if (!existing && target === 'render') {
    const renderRes = await depRender.deploy(
      {
        projectName: sanitizedName,
        subdomain: effectiveSubdomain,
        repoUrl,
      },
      config
    );

    deployResult = {
      id: sanitizedName,
      name: sanitizedName,
      target: 'render',
      serviceId: renderRes.serviceId,
      source: 'github_public',
      sourceDetail: repoUrl,
      domain: renderRes.domain || fullDomain,
      url: renderRes.url || `https://${fullDomain}`,
      cnameTarget: renderRes.cnameTarget,
      dnsStatus: 'pending',
      status: 'provisioning_dns',
      deployedAt: renderRes.deployedAt || new Date().toISOString(),
    };
  }

  // Persist the origin before provisioning DNS so a failed API call can be retried.
  deployResult.dnsOwnershipTag ||= `assistant-bot:${crypto.randomUUID()}`;
  if (recoveredDnsId) deployResult.dnsRecordId = recoveredDnsId;
  if (existingIdx >= 0) {
    registry[existingIdx] = deployResult;
  } else {
    registry.push(deployResult);
  }
  await saveRegistry(registryPath, registry);

  try {
    let dnsRes;
    if (target === 'vps') {
      dnsRes = await depCloudflare.upsertARecord({
        subdomain: effectiveSubdomain,
        ip: vpsIp,
        proxied: true,
        ownedRecordId: deployResult.dnsRecordId,
        ownershipTag: deployResult.dnsOwnershipTag,
      }, config);
    } else {
      dnsRes = await depCloudflare.upsertCnameRecord({
        subdomain: effectiveSubdomain,
        targetCname: deployResult.cnameTarget,
        proxied: false,
        ownedRecordId: deployResult.dnsRecordId,
        ownershipTag: deployResult.dnsOwnershipTag,
      }, config);
    }
    if (!dnsRes?.ok || !dnsRes.recordId) throw new Error('Cloudflare did not confirm a DNS record ID');
    deployResult.dnsRecordId = dnsRes.recordId;
    deployResult.dnsRecordType = target === 'vps' ? 'A' : 'CNAME';
    deployResult.dnsStatus = 'provisioned';
    deployResult.status = 'online';
    delete deployResult.lastError;
  } catch (error) {
    deployResult.dnsStatus = 'failed';
    deployResult.status = 'failed_dns';
    deployResult.lastError = error.message;
    await saveRegistry(registryPath, registry);
    throw error;
  }
  await saveRegistry(registryPath, registry);

  return { ok: true, deployment: deployResult };
}

async function undeployUnlocked(projectName, config, deps = {}) {
  const depSandbox = deps.sandbox || sandbox;
  const depVercel = deps.vercel || vercel;
  const depRender = deps.render || render;
  const depCloudflare = deps.cloudflare || cloudflare;

  if (!projectName || typeof projectName !== 'string') throw new Error('Project name is required');
  const targetId = projectName.toLowerCase().trim();
  const registryPath = config.deployRegistryPath || path.resolve(process.cwd(), 'data/deployments.json');
  const registry = await loadRegistry(registryPath);
  const found = registry.find(
    (d) => d.name === targetId || d.id === targetId || d.domain === targetId || d.domain?.startsWith(`${targetId}.`)
  );

  if (!found) {
    const local = config.webDeployDir && typeof depSandbox.listDeployments === 'function'
      ? (await depSandbox.listDeployments(config.webDeployDir)).find((item) => item.name === targetId)
      : null;
    if (!local) throw new Error(`Deployment ${targetId} is not in the registry`);
    if (!depCloudflare.isEnabled(config) || typeof depCloudflare.findDnsRecord !== 'function') {
      throw new Error('Cloudflare lookup is required before removing a legacy VPS deployment');
    }
    const legacyDomain = depCloudflare.resolveFullDomain(local.domain || targetId, config.baseDomain || 'thienhn.io.vn');
    if (await depCloudflare.findDnsRecord(legacyDomain, null, config)) {
      throw new Error(`Legacy deployment ${targetId} has an unowned DNS record; reconcile it before removal`);
    }
    const removal = await depSandbox.removeProject(targetId, config);
    if (!removal?.ok) throw new Error(`Could not remove legacy VPS origin for ${targetId}`);
    return { ok: true, name: targetId, target: 'vps', dnsDeleted: false };
  }
  const target = found.target;
  const actualName = found.name;
  if (depCloudflare.isEnabled(config) && !found.dnsRecordId) {
    const incomplete = ['failed_origin', 'failed_dns'].includes(found.status);
    const dnsRecord = incomplete && typeof depCloudflare.findDnsRecord === 'function'
      ? await depCloudflare.findDnsRecord(found.domain, null, config)
      : null;
    const expectedType = target === 'vps' ? 'A' : 'CNAME';
    if (dnsRecord && found.dnsOwnershipTag && dnsRecord.comment === found.dnsOwnershipTag && dnsRecord.type === expectedType) {
      found.dnsRecordId = dnsRecord.id;
      found.dnsRecordType = expectedType;
      await saveRegistry(registryPath, registry);
    } else if (!incomplete || dnsRecord || typeof depCloudflare.findDnsRecord !== 'function') {
      throw new Error(`Deployment ${actualName} has no owned DNS record ID; reconcile legacy DNS before removal`);
    }
  }
  if (found.dnsRecordId && !depCloudflare.isEnabled(config)) {
    throw new Error('Cloudflare credentials are required to remove an owned DNS record');
  }

  let dnsDeleted = false;
  try {
    let originRes;
    if (target === 'vps') originRes = await depSandbox.removeProject(actualName, config);
    else if (target === 'vercel') originRes = await depVercel.remove(actualName, config);
    else if (target === 'render') originRes = await depRender.remove(found.serviceId || actualName, config);
    else throw new Error(`Unknown deployment target ${target}`);
    if (!originRes?.ok) throw new Error(`Could not remove ${target} origin for ${actualName}`);

    if (found.dnsRecordId) {
      const dnsRes = await depCloudflare.deleteDnsRecord({
        subdomain: found.domain,
        type: found.dnsRecordType || (target === 'vps' ? 'A' : 'CNAME'),
        recordId: found.dnsRecordId,
      }, config);
      if (!dnsRes?.ok) throw new Error(`Could not remove DNS for ${found.domain}`);
      dnsDeleted = dnsRes.deleted === true;
    }
  } catch (error) {
    found.status = 'cleanup_pending';
    found.lastError = error.message;
    await saveRegistry(registryPath, registry);
    throw error;
  }

  await saveRegistry(registryPath, registry.filter((item) => item !== found));
  return { ok: true, name: actualName, target, dnsDeleted };
}

async function deploy(input, config, deps = {}) {
  const registryPath = config.deployRegistryPath || path.resolve(process.cwd(), 'data/deployments.json');
  return withRegistryLock(registryPath, () => deployUnlocked(input, config, deps));
}

async function undeploy(projectName, config, deps = {}) {
  const registryPath = config.deployRegistryPath || path.resolve(process.cwd(), 'data/deployments.json');
  return withRegistryLock(registryPath, () => undeployUnlocked(projectName, config, deps));
}

module.exports = {
  getVpsPublicIp,
  getActiveTargets,
  getValidTargetsForSource,
  loadRegistry,
  saveRegistry,
  listAllDeployments,
  resolveAvailableSubdomain,
  deploy,
  undeploy,
};
