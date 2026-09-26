const axios = require('axios');

function resolveAgentUrl(node) {
  if (node.agentUrl) return node.agentUrl.replace(/\/+$/, '');
  const port = node.port || 3001;
  return `http://${node.ip}:${port}`;
}

async function getMetrics(node, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/metrics`;
  try {
    const res = await client.get(url, {
      headers: { 'X-Agent-Secret': node.secret || '' },
      timeout: 5000,
    });
    return res.data;
  } catch (err) {
    return { ok: false, error: err.message, status: 'offline' };
  }
}

async function deploy(node, { projectName, subdomain, zipBuffer }, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/deploy`;
  const res = await client.post(url, zipBuffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Agent-Secret': node.secret || '',
      'x-project-name': projectName,
      'x-subdomain': subdomain || projectName,
    },
    timeout: 60000,
  });
  return res.data;
}

async function undeploy(node, projectName, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/undeploy`;
  const res = await client.post(url, { projectName }, {
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Secret': node.secret || '',
    },
    timeout: 15000,
  });
  return res.data;
}

async function update(node, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/update`;
  const res = await client.post(url, {}, {
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Secret': node.secret || '',
    },
    timeout: 30000,
  });
  return res.data;
}

module.exports = {
  resolveAgentUrl,
  getMetrics,
  deploy,
  undeploy,
  update,
};
