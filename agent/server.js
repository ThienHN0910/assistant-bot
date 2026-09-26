const http = require('http');
const path = require('path');
const crypto = require('crypto');
const si = require('systeminformation');
const agentSandbox = require('./agentSandbox');

// Load worker settings from the agent directory, then let the repository .env take precedence.
// A missing dotenv dependency must fail startup instead of silently dropping the worker secret and deploy path.
const dotenv = require('dotenv');
for (const envPath of [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../.env')]) {
  const result = dotenv.config({ path: envPath, quiet: true, override: true });
  if (result.error && result.error.code !== 'ENOENT') {
    throw new Error(`Cannot load worker environment: ${result.error.message}`);
  }
}

function validateWorkerConfig(env = process.env) {
  for (const key of ['NODE_AGENT_SECRET', 'WEB_DEPLOY_DIR']) {
    if (typeof env[key] !== 'string' || !env[key].trim()) {
      throw new Error(`${key} must be configured in worker environment`);
    }
  }
}


const DEFAULT_MAX_JSON_BYTES = 1024 * 1024; // 1MB
const DEFAULT_MAX_ZIP_BYTES = 50 * 1024 * 1024; // 50MB
const EXEC_COMMANDS = new Map([
  ['df -h', ['df', ['-h']]],
  ['disk-usage', ['df', ['-h']]],
  ['free -m', ['free', ['-m']]],
  ['free -h', ['free', ['-h']]],
  ['mem-check', ['free', ['-h']]],
  ['uptime', ['uptime', []]],
  ['whoami', ['whoami', []]],
  ['hostname', ['hostname', []]],
  ['lscpu', ['lscpu', []]],
  ['cpu-info', ['lscpu', []]],
  ['cat /etc/os-release', ['cat', ['/etc/os-release']]],
  ['os-release', ['cat', ['/etc/os-release']]],
  ['ss -tuln', ['ss', ['-tuln']]],
  ['netstat-listen', ['ss', ['-tuln']]],
  ['ps aux --sort=-%mem', ['ps', ['aux', '--sort=-%mem']]],
  ['top-procs', ['ps', ['aux', '--sort=-%mem']]],
  ['git status', ['git', ['status']]],
  ['git-status', ['git', ['status']]],
  ['git log --oneline -5', ['git', ['log', '--oneline', '-5']]],
  ['git-log', ['git', ['log', '--oneline', '-5']]],
  ['pm2 list', ['pm2', ['list']]],
  ['pm2-list', ['pm2', ['list']]],
  ['pm2 status', ['pm2', ['status']]],
  ['pm2-status', ['pm2', ['status']]],
  ['nginx -t', ['nginx', ['-t']]],
  ['nginx-test', ['nginx', ['-t']]],
  ['cat /proc/meminfo', ['cat', ['/proc/meminfo']]],
]);

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req, maxBytes = DEFAULT_MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let exceeded = false;

    req.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > maxBytes) {
        exceeded = true;
        req.pause();
        reject(new Error(`Payload exceeds maximum allowed size of ${maxBytes} bytes`));
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (exceeded) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

function parseBufferBody(req, maxBytes = DEFAULT_MAX_ZIP_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;

    req.on('data', (c) => {
      if (exceeded) return;
      size += c.length;
      if (size > maxBytes) {
        exceeded = true;
        req.pause();
        reject(new Error(`Payload exceeds maximum allowed size of ${maxBytes} bytes`));
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (exceeded) return;
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

function checkAgentAuth(req, expectedSecret) {
  if (!expectedSecret || typeof expectedSecret !== 'string' || expectedSecret.trim() === '') {
    return false; // Fail-closed when secret is missing or unset
  }
  const provided = req.headers['x-agent-secret'];
  if (!provided || typeof provided !== 'string') {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(provided).digest();
  const hashB = crypto.createHash('sha256').update(expectedSecret).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function createAgentServer(options = {}) {
  const secret = (options.secret !== undefined) ? options.secret : (process.env.NODE_AGENT_SECRET || '');
  const sandbox = options.sandbox || agentSandbox;
  const maxJsonBytes = options.maxJsonBytes || DEFAULT_MAX_JSON_BYTES;
  const maxZipBytes = options.maxZipBytes || DEFAULT_MAX_ZIP_BYTES;

  const metricsProvider = options.metricsProvider || (async () => {
    const [cpu, mem, time] = await Promise.all([
      si.currentLoad().catch(() => ({ currentLoad: 0 })),
      si.mem().catch(() => ({ total: 1, used: 0 })),
      si.time(),
    ]);
    return {
      cpuLoad: Math.round(cpu.currentLoad || 0),
      memory: {
        totalBytes: mem.total,
        usedBytes: mem.used,
        usedPercentage: Math.round((mem.used / (mem.total || 1)) * 100),
      },
      uptimeSeconds: time?.uptime || process.uptime(),
    };
  });

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://localhost');
    const pathname = urlObj.pathname;

    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, status: 'healthy', version: '2.0.0' });
      return;
    }

    if (!checkAgentAuth(req, secret)) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized: Invalid X-Agent-Secret' });
      return;
    }

    if (pathname === '/api/metrics' && req.method === 'GET') {
      try {
        const metrics = await metricsProvider();
        sendJson(res, 200, { ok: true, metrics });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/deploy' && req.method === 'POST') {
      try {
        const projectName = req.headers['x-project-name'] || urlObj.searchParams.get('project');
        const subdomain = req.headers['x-subdomain'] || projectName;
        if (!projectName) {
          sendJson(res, 400, { ok: false, error: 'x-project-name header is required' });
          return;
        }
        const zipBuffer = await parseBufferBody(req, maxZipBytes);
        if (!zipBuffer || zipBuffer.length === 0) {
          sendJson(res, 400, { ok: false, error: 'ZIP binary payload is empty' });
          return;
        }
        const deployRes = await sandbox.deployZipPayload(zipBuffer, projectName, subdomain);
        sendJson(res, 200, { ok: true, deployment: deployRes });
      } catch (err) {
        const isPayloadTooLarge = err.message && err.message.includes('maximum allowed size');
        sendJson(res, isPayloadTooLarge ? 413 : 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/undeploy' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req, maxJsonBytes);
        const projectName = body.projectName || urlObj.searchParams.get('project');
        if (!projectName) {
          sendJson(res, 400, { ok: false, error: 'projectName is required' });
          return;
        }
        const result = await sandbox.removeProject(projectName);
        sendJson(res, 200, { ok: true, removed: result });
      } catch (err) {
        const isPayloadTooLarge = err.message && err.message.includes('maximum allowed size');
        sendJson(res, isPayloadTooLarge ? 413 : 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/update' && req.method === 'POST') {
      try {
        const result = await sandbox.runSelfUpdate();
        sendJson(res, result.ok ? 200 : 500, { ok: result.ok, update: result });
        if (result.ok && options.autoRestart !== false) {
          setTimeout(() => {
            if (typeof sandbox.restartSelf === 'function') sandbox.restartSelf();
          }, 500);
        }
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (pathname === '/api/processes' && req.method === 'GET') {
      try {
        const result = await sandbox.getProcessList();
        sendJson(res, result.ok ? 200 : 500, result);
      } catch (err) { sendJson(res, 500, { ok: false, error: err.message }); }
      return;
    }

    if (pathname === '/api/logs' && req.method === 'GET') {
      try {
        const requested = Number.parseInt(urlObj.searchParams.get('lines'), 10);
        const lines = Number.isFinite(requested) ? Math.max(1, Math.min(requested, 100)) : 20;
        const result = await sandbox.getAgentLogs(lines);
        sendJson(res, result.ok ? 200 : 500, result);
      } catch (err) { sendJson(res, 500, { ok: false, error: err.message }); }
      return;
    }

    if (pathname === '/api/cleancache' && req.method === 'POST') {
      try {
        const result = await sandbox.cleanCacheAndLogs();
        sendJson(res, result.ok ? 200 : 500, { ok: result.ok, result });
      } catch (err) { sendJson(res, 500, { ok: false, error: err.message }); }
      return;
    }

    if (pathname === '/api/restart' && req.method === 'POST') {
      sendJson(res, 200, { ok: true, message: 'Worker agent restarting' });
      if (options.autoRestart !== false) setTimeout(() => sandbox.restartSelf(), 500);
      return;
    }

    if (pathname === '/api/exec' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req, Math.min(maxJsonBytes, 4096));
        const rawCommand = typeof body.command === 'string' ? body.command.trim() : '';
        const command = rawCommand.replace(/^\//, '').trim();
        let entry = EXEC_COMMANDS.get(command) || EXEC_COMMANDS.get(rawCommand);

        if (!entry) {
          const parts = command.split(/\s+/);
          const base = parts[0];
          const allowedApps = ['assistant-bot', 'app', 'server', 'worker', 'all'];
          if ((base === 'pm2-restart' || (base === 'pm2' && parts[1] === 'restart')) && allowedApps.includes(parts[base === 'pm2' ? 2 : 1])) {
            const targetApp = parts[base === 'pm2' ? 2 : 1];
            entry = ['pm2', ['restart', targetApp]];
          } else if ((base === 'pm2-logs' || (base === 'pm2' && parts[1] === 'logs')) && allowedApps.includes(parts[base === 'pm2' ? 2 : 1])) {
            const targetApp = parts[base === 'pm2' ? 2 : 1];
            entry = ['pm2', ['logs', targetApp, '--lines', '30', '--nostream']];
          }
        }

        if (!entry) { sendJson(res, 403, { ok: false, error: 'Command not allowed' }); return; }
        const result = await sandbox.runCmd(entry[0], entry[1], { timeout: 10000, maxBuffer: 64 * 1024 });
        sendJson(res, result.ok ? 200 : 500, result);
      } catch (err) {
        sendJson(res, err.message.includes('maximum allowed size') ? 413 : 500, { ok: false, error: err.message });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not Found' });
  });

  return server;
}

if (require.main === module) {
  validateWorkerConfig();
  const port = process.env.AGENT_PORT || 3001;
  const server = createAgentServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`[ASSISTANT_NODE_AGENT] Listening on port ${port}`);
  });
}

module.exports = {
  createAgentServer,
  checkAgentAuth,
  parseJsonBody,
  parseBufferBody,
  validateWorkerConfig,
};
