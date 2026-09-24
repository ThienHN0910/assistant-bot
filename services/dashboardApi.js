const http = require('http');
const si = require('systeminformation');
const deployer = require('../lib/deployer');
const { formatFileSize } = require('../config/utils');

let serverInstance = null;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function checkAuth(req, config) {
  if (!config.dashboardSecretKey) {
    return true; // Unprotected if no secret key configured
  }

  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    return token === config.dashboardSecretKey;
  }

  // Also accept ?key= query parameter
  const urlObj = new URL(req.url, 'http://localhost');
  const queryKey = urlObj.searchParams.get('key');
  return queryKey === config.dashboardSecretKey;
}

function createDashboardServer(config) {
  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const pathname = urlObj.pathname;

    // 1. Health check (no auth needed)
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, name: 'assistant-bot-dashboard-api', timestamp: new Date().toISOString() });
      return;
    }

    // 2. Auth verify
    if (pathname === '/api/auth/verify' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const provided = body.key || req.headers.authorization?.replace(/^Bearer\s+/, '');
      const valid = !config.dashboardSecretKey || provided === config.dashboardSecretKey;

      if (valid) {
        sendJson(res, 200, { ok: true, authenticated: true });
      } else {
        sendJson(res, 401, { ok: false, error: 'Mã xác thực không chính xác' });
      }
      return;
    }

    // All subsequent endpoints require authentication
    if (!checkAuth(req, config)) {
      sendJson(res, 401, { ok: false, error: 'Yêu cầu mã xác thực hợp lệ (Unauthorized)' });
      return;
    }

    // 3. System Status
    if (pathname === '/api/status' && req.method === 'GET') {
      try {
        const [cpu, mem, fsSize, time] = await Promise.all([
          si.currentLoad().catch(() => ({ currentLoad: 0 })),
          si.mem().catch(() => ({ total: 1, used: 0, free: 0 })),
          si.fsSize().catch(() => []),
          si.time(),
        ]);

        const rootDisk = fsSize.find((f) => f.mount === '/') || fsSize[0] || { size: 0, used: 0 };

        sendJson(res, 200, {
          ok: true,
          system: {
            cpuLoad: Math.round(cpu.currentLoad || 0),
            memory: {
              totalBytes: mem.total,
              usedBytes: mem.used,
              usedPercentage: Math.round((mem.used / (mem.total || 1)) * 100),
              formatted: `${formatFileSize(mem.used)} / ${formatFileSize(mem.total)}`,
            },
            disk: {
              totalBytes: rootDisk.size,
              usedBytes: rootDisk.used,
              usedPercentage: Math.round(rootDisk.use || 0),
              formatted: `${formatFileSize(rootDisk.used)} / ${formatFileSize(rootDisk.size)}`,
            },
            uptimeSeconds: time?.uptime || process.uptime(),
            uptimeFormatted: `${Math.floor((time?.uptime || process.uptime()) / 86400)}d ${Math.floor(((time?.uptime || process.uptime()) % 86400) / 3600)}h`,
          },
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 4. List All Deployments
    if (pathname === '/api/deployments' && req.method === 'GET') {
      try {
        const deployments = await deployer.listAllDeployments(config);
        sendJson(res, 200, { ok: true, deployments });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 5. Undeploy
    if (pathname === '/api/deployments/undeploy' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (!body.name) {
          sendJson(res, 400, { ok: false, error: 'Thiếu tên dự án cần xóa (name)' });
          return;
        }
        const result = await deployer.undeploy(body.name, config);
        sendJson(res, 200, { ok: true, undeployed: result });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Endpoint không tồn tại' });
  });

  return server;
}

function startDashboardServer(config) {
  const port = config.dashboardPort || 3001;
  serverInstance = createDashboardServer(config);
  serverInstance.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Dashboard API đang lắng nghe trên cổng: ${port}`);
  });
  return serverInstance;
}

function stopDashboardServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

module.exports = {
  createDashboardServer,
  startDashboardServer,
  stopDashboardServer,
};
