const fs = require('fs/promises');
const path = require('path');

function maskIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  const parts = ip.trim().split('.');
  if (parts.length === 4) {
    return `${parts[0]}.***.***.${parts[3]}`;
  }
  return ip;
}

function getDefaultLocalNode(config = {}) {
  return {
    id: 'gcp-master',
    name: 'GCP e2-micro (Master)',
    ip: config.vpsPublicIp || '127.0.0.1',
    isLocal: true,
    status: 'online',
  };
}

async function getNodes(config = {}) {
  const filePath = config.nodesConfigPath || path.resolve(process.cwd(), 'data/nodes.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[NODE_MANAGER] Failed reading nodes.json: ${err.message}`);
    }
  }

  if (config.nodesConfig) {
    try {
      const parsedEnv = typeof config.nodesConfig === 'string' ? JSON.parse(config.nodesConfig) : config.nodesConfig;
      if (Array.isArray(parsedEnv) && parsedEnv.length > 0) return parsedEnv;
    } catch {}
  }

  return [getDefaultLocalNode(config)];
}

async function saveNodes(nodes, config = {}) {
  const filePath = config.nodesConfigPath || path.resolve(process.cwd(), 'data/nodes.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(nodes, null, 2), 'utf8');
}

async function getNode(id, config = {}) {
  const nodes = await getNodes(config);
  return nodes.find((n) => n.id === id) || null;
}

async function addNode(node, config = {}) {
  if (!node || !node.id || !node.ip) {
    throw new Error('Node must specify id and ip');
  }
  const nodes = await getNodes(config);
  const existingIdx = nodes.findIndex((n) => n.id === node.id);
  const cleanNode = {
    ...node,
    isLocal: Boolean(node.isLocal),
    status: node.status || 'online',
  };

  if (existingIdx >= 0) {
    nodes[existingIdx] = cleanNode;
  } else {
    nodes.push(cleanNode);
  }
  await saveNodes(nodes, config);
  return cleanNode;
}

async function removeNode(id, config = {}) {
  const nodes = await getNodes(config);
  const filtered = nodes.filter((n) => n.id !== id);
  if (filtered.length === nodes.length) return false;
  await saveNodes(filtered, config);
  return true;
}

module.exports = {
  maskIp,
  getDefaultLocalNode,
  getNodes,
  saveNodes,
  getNode,
  addNode,
  removeNode,
};
