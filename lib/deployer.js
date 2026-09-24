const fs = require('fs/promises');
const path = require('path');
const cloudflare = require('./providers/cloudflare');
const vercel = require('./providers/vercel');
const render = require('./providers/render');
const sandbox = require('./sandbox');

function getActiveTargets(config) {
  const targets = ['vps'];
  if (vercel.isEnabled(config)) targets.push('vercel');
  if (render.isEnabled(config)) targets.push('render');
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
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveRegistry(registryPath, items) {
  const dir = path.dirname(registryPath);
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  await fs.writeFile(registryPath, JSON.stringify(items, null, 2), 'utf8');
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
        status: 'online',
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
        domain: vps.domain || `${vps.name}.${config.baseDomain || 'thienhn.io.vn'}`,
        url: vps.url || `https://${vps.name}.${config.baseDomain || 'thienhn.io.vn'}`,
        port: vps.port,
        sizeFormatted: vps.sizeFormatted,
        status: 'online',
        deployedAt: vps.deployedAt || new Date().toISOString(),
      });
    }
  }

  return merged;
}

async function deploy(
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

  // 2. Validate Feature Flag for Target
  if (target === 'vercel' && !depVercel.isEnabled(config)) {
    throw new Error('Nền tảng Vercel chưa được cấu hình VERCEL_TOKEN trong .env.');
  }
  if (target === 'render' && !depRender.isEnabled(config)) {
    throw new Error('Nền tảng Render chưa được cấu hình RENDER_API_KEY hoặc RENDER_OWNER_ID trong .env.');
  }

  const sanitizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const baseDomain = config.baseDomain || 'thienhn.io.vn';
  const effectiveSubdomain = (subdomain || sanitizedName).toLowerCase();
  const fullDomain = depCloudflare.resolveFullDomain(effectiveSubdomain, baseDomain);

  let deployResult = null;

  // 3. Execute Deployment per Target
  if (target === 'vps') {
    const allocatedPort = port || (await depSandbox.getNextAvailablePort(config.webDeployDir, config.webPortStart));
    const vpsRes = await depSandbox.deployProject(sourcePath, sanitizedName, allocatedPort, config);
    deployResult = {
      id: sanitizedName,
      name: sanitizedName,
      target: 'vps',
      source: source || 'zip_upload',
      sourceDetail: path.basename(sourcePath || sanitizedName),
      domain: vpsRes.domain || fullDomain,
      url: vpsRes.url || `https://${fullDomain}`,
      port: vpsRes.port || allocatedPort,
      type: vpsRes.type,
      status: 'online',
      deployedAt: new Date().toISOString(),
    };
  } else if (target === 'vercel') {
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

    // Provision Cloudflare CNAME record if configured
    let dnsStatus = 'skipped';
    if (depCloudflare.isEnabled(config)) {
      const dnsRes = await depCloudflare.upsertCnameRecord(
        {
          subdomain: effectiveSubdomain,
          targetCname: vercelRes.cnameTarget || 'cname.vercel-dns.com',
          proxied: false,
        },
        config
      );
      dnsStatus = dnsRes.ok ? 'provisioned' : 'failed';
    }

    deployResult = {
      id: sanitizedName,
      name: sanitizedName,
      target: 'vercel',
      source: source || 'github_public',
      sourceDetail: repoUrl || path.basename(sourcePath || ''),
      domain: vercelRes.domain || fullDomain,
      url: vercelRes.url || `https://${fullDomain}`,
      cnameTarget: vercelRes.cnameTarget,
      dnsStatus,
      status: 'online',
      deployedAt: vercelRes.deployedAt || new Date().toISOString(),
    };
  } else if (target === 'render') {
    const renderRes = await depRender.deploy(
      {
        projectName: sanitizedName,
        subdomain: effectiveSubdomain,
        repoUrl,
      },
      config
    );

    // Provision Cloudflare CNAME record if configured
    let dnsStatus = 'skipped';
    if (depCloudflare.isEnabled(config)) {
      const dnsRes = await depCloudflare.upsertCnameRecord(
        {
          subdomain: effectiveSubdomain,
          targetCname: renderRes.cnameTarget,
          proxied: false,
        },
        config
      );
      dnsStatus = dnsRes.ok ? 'provisioned' : 'failed';
    }

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
      dnsStatus,
      status: 'online',
      deployedAt: renderRes.deployedAt || new Date().toISOString(),
    };
  }

  // 4. Update Registry
  const registryPath = config.deployRegistryPath || path.resolve(process.cwd(), 'data/deployments.json');
  const registry = await loadRegistry(registryPath);
  const existingIdx = registry.findIndex((d) => d.name === sanitizedName);
  if (existingIdx >= 0) {
    registry[existingIdx] = deployResult;
  } else {
    registry.push(deployResult);
  }
  await saveRegistry(registryPath, registry);

  return { ok: true, deployment: deployResult };
}

async function undeploy(projectName, config, deps = {}) {
  const depSandbox = deps.sandbox || sandbox;
  const depVercel = deps.vercel || vercel;
  const depRender = deps.render || render;
  const depCloudflare = deps.cloudflare || cloudflare;

  const targetId = projectName.replace(/[^a-zA-Z0-9_.-]/g, '-').toLowerCase();
  const registryPath = config.deployRegistryPath || path.resolve(process.cwd(), 'data/deployments.json');
  const registry = await loadRegistry(registryPath);
  const found = registry.find(
    (d) => d.name === targetId || d.id === targetId || d.domain === targetId || d.domain?.startsWith(`${targetId}.`)
  );

  const target = found?.target || 'vps';
  const actualName = found?.name || targetId;

  // 1. Remove from infrastructure
  if (target === 'vps') {
    await depSandbox.removeProject(actualName, config);
  } else if (target === 'vercel') {
    await depVercel.remove(actualName, config);
    if (depCloudflare.isEnabled(config) && found?.domain) {
      await depCloudflare.deleteCnameRecord({ subdomain: found.domain }, config).catch(() => {});
    }
  } else if (target === 'render') {
    await depRender.remove(found?.serviceId || actualName, config);
    if (depCloudflare.isEnabled(config) && found?.domain) {
      await depCloudflare.deleteCnameRecord({ subdomain: found.domain }, config).catch(() => {});
    }
  }

  // 2. Remove from Registry
  const filtered = registry.filter((d) => d.name !== actualName && d.id !== actualName);
  await saveRegistry(registryPath, filtered);

  return { ok: true, name: actualName, target };
}

module.exports = {
  getActiveTargets,
  getValidTargetsForSource,
  loadRegistry,
  saveRegistry,
  listAllDeployments,
  deploy,
  undeploy,
};
