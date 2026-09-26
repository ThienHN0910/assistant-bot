const axios = require('axios');

function resolveAgentUrl(node) {
  if (node.agentUrl) return node.agentUrl.replace(/\/+$/, '');
  const port = node.port || 3001;
  return `http://${node.ip}:${port}`;
}

function resolveSecret(secret) {
  if (typeof secret === 'string' && secret.startsWith('env:')) {
    const varName = secret.slice(4).trim();
    return process.env[varName] || '';
  }
  return secret || process.env.NODE_AGENT_SECRET || '';
}

function throwAgentError(error) {
  const reason = error.response?.data?.error;
  if (typeof reason === 'string' && reason.trim()) throw new Error(reason);
  throw error;
}

async function getMetrics(node, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/metrics`;
  try {
    const res = await client.get(url, {
      headers: { 'X-Agent-Secret': resolveSecret(node.secret) },
      timeout: 5000,
    });
    return res.data;
  } catch (err) {
    return { ok: false, error: err.message, status: 'offline' };
  }
}

async function deploy(node, { projectName, subdomain, zipBuffer }, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/deploy`;
  try {
    const res = await client.post(url, zipBuffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Agent-Secret': resolveSecret(node.secret),
        'x-project-name': projectName,
        'x-subdomain': subdomain || projectName,
      },
      timeout: 60000,
    });
    return res.data;
  } catch (err) {
    throwAgentError(err);
  }
}

async function undeploy(node, projectName, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/undeploy`;
  try {
    const res = await client.post(url, { projectName }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Secret': resolveSecret(node.secret),
      },
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    throwAgentError(err);
  }
}

async function update(node, client = axios) {
  const url = `${resolveAgentUrl(node)}/api/update`;
  const res = await client.post(url, {}, {
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Secret': resolveSecret(node.secret),
    },
    timeout: 30000,
  });
  return res.data;
}

async function requestNode(node, method, endpoint, body, timeout, client) {
  const url = `${resolveAgentUrl(node)}${endpoint}`;
  const options = { headers: { 'X-Agent-Secret': resolveSecret(node.secret) }, timeout };
  try {
    const response = method === 'GET'
      ? await client.get(url, options)
      : await client.post(url, body, { ...options, headers: { ...options.headers, 'Content-Type': 'application/json' } });
    return response.data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getProcesses(node, client = axios) {
  return requestNode(node, 'GET', '/api/processes', null, 5000, client);
}

function getLogs(node, lines = 20, client = axios) {
  const count = Math.max(1, Math.min(Number(lines) || 20, 100));
  return requestNode(node, 'GET', `/api/logs?lines=${count}`, null, 8000, client);
}

function cleanCache(node, client = axios) {
  return requestNode(node, 'POST', '/api/cleancache', {}, 30000, client);
}

function restartAgent(node, client = axios) {
  return requestNode(node, 'POST', '/api/restart', {}, 5000, client);
}

function execCommand(node, command, client = axios) {
  return requestNode(node, 'POST', '/api/exec', { command }, 15000, client);
}


module.exports = {
  resolveAgentUrl,
  getMetrics,
  deploy,
  undeploy,
  update,
  getProcesses,
  getLogs,
  cleanCache,
  restartAgent,
  execCommand,
};
