const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const si = require('systeminformation');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);

const deployer = require('../lib/deployer');
const repoInspector = require('../lib/repoInspector');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');
const whitelist = require('../lib/whitelist');
const runner = require('../lib/runner');
const perf = require('../lib/perf');
const { resolveTargetUrl } = require('../commands/perf');
const { formatFileSize, readLastLines } = require('../config/utils');

const authController = require('./dashboard/authController');
const telemetryController = require('./dashboard/telemetryController');
const terminalController = require('./dashboard/terminalController');
const deploymentsController = require('./dashboard/deploymentsController');
const notesController = require('./dashboard/notesController');
const perfController = require('./dashboard/perfController');

let serverInstance = null;

function setCorsHeaders(req, res, config) {
  const origin = req.headers.origin;
  if (!origin || !config.dashboardAllowedOrigin || origin !== config.dashboardAllowedOrigin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function isAllowedOrigin(req, config) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (config.dashboardAllowedOrigin) return origin === config.dashboardAllowedOrigin;

  const host = req.headers.host;
  if (!host) return false;
  const loopbackProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const protocol = req.socket.encrypted || (loopbackProxy && req.headers['x-forwarded-proto'] === 'https')
    ? 'https:'
    : 'http:';
  try {
    return origin === new URL(`${protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, data) {
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

function createDashboardServer(config, deps = {}) {
  const httpClient = deps.axios || axios;
  const depDeployer = deps.deployer || deployer;
  const depInspector = deps.inspector || repoInspector;
  const depNodeManager = deps.nodeManager || nodeManager;
  const depNodeClient = deps.nodeClient || nodeClient;
  const depSi = deps.si || si;
  const depWhitelist = deps.whitelist || whitelist;
  const depRunner = deps.runner || runner;
  const depExecAsync = deps.execAsync || execAsync;
  const depPerf = deps.perf || perf;
  const depResolveTargetUrl = deps.resolveTargetUrl || resolveTargetUrl;

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(req, res, config);

    const origin = req.headers.origin;
    if (req.method !== 'GET' && req.method !== 'HEAD' && origin && !isAllowedOrigin(req, config)) {
      sendJson(res, 403, { ok: false, error: 'Origin not allowed' });
      return;
    }

    if (req.method === 'OPTIONS') {
      if (!origin || !isAllowedOrigin(req, config)) {
        sendJson(res, 403, { ok: false, error: 'Origin not allowed' });
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const pathname = urlObj.pathname;

    // 0. Serve Dashboard UI static files (public)
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      const safePath = pathname === '/' ? '/index.html' : pathname;
      const dashboardDir = path.resolve(__dirname, '../dashboard');
      const targetPath = path.resolve(dashboardDir, '.' + safePath);

      if (targetPath.startsWith(dashboardDir)) {
        try {
          const stats = await fs.stat(targetPath);
          if (stats.isFile()) {
            const ext = path.extname(targetPath).toLowerCase();
            const mimeMap = {
              '.html': 'text/html; charset=utf-8',
              '.js': 'application/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8',
              '.json': 'application/json; charset=utf-8',
              '.png': 'image/png',
              '.ico': 'image/x-icon',
              '.svg': 'image/svg+xml',
            };
            const contentType = mimeMap[ext] || 'application/octet-stream';
            const content = await fs.readFile(targetPath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
            return;
          }
        } catch {}
      }
      if (pathname === '/' || pathname === '/index.html') {
        sendJson(res, 500, { ok: false, error: 'Dashboard UI HTML file not found' });
        return;
      }
    }

    // 1. Health check (no auth needed)
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, name: 'assistant-bot-dashboard-api', timestamp: new Date().toISOString() });
      return;
    }

    // 2. Auth Config - Public
    if (pathname === '/api/auth/config' && req.method === 'GET') {
      authController.handleAuthConfig(req, res, { config, sendJson });
      return;
    }

    // 3. Cluster Nodes (public - IPs masked, no secrets)
    if (pathname === '/api/nodes' && req.method === 'GET') {
      await telemetryController.handleNodes(req, res, { config, depNodeManager, sendJson });
      return;
    }

    // 4. Google Sign-In Authentication
    if (pathname === '/api/auth/google' && req.method === 'POST') {
      await authController.handleGoogleLogin(req, res, {
        config,
        httpClient,
        sendJson,
        parseJsonBody,
      });
      return;
    }

    // 5. Session Token Verification
    if (pathname === '/api/auth/verify' && req.method === 'POST') {
      authController.handleVerifySession(req, res, { config, sendJson });
      return;
    }

    // All subsequent endpoints require valid authentication
    if (!authController.checkAuth(req, config)) {
      sendJson(res, 401, { ok: false, error: 'Yêu cầu đăng nhập Google hợp lệ (Unauthorized)' });
      return;
    }

    // 6. System Status & Multi-Node Cluster Telemetry
    if (pathname === '/api/status' && req.method === 'GET') {
      await telemetryController.handleStatus(req, res, {
        config,
        depSi,
        depNodeManager,
        depNodeClient,
        httpClient,
        formatFileSize,
        sendJson,
      });
      return;
    }

    // 7. List All Deployments
    if (pathname === '/api/deployments' && req.method === 'GET') {
      await deploymentsController.handleDeploymentsList(req, res, {
        config,
        depNodeManager,
        depDeployer,
        sendJson,
      });
      return;
    }

    // 8. Inspect GitHub Repo
    if (pathname === '/api/deployments/inspect' && req.method === 'POST') {
      await deploymentsController.handleInspectRepo(req, res, {
        config,
        depInspector,
        depDeployer,
        httpClient,
        sendJson,
        parseJsonBody,
      });
      return;
    }

    // 9. Deploy GitHub Repo
    if (pathname === '/api/deployments/deploy-git' && req.method === 'POST') {
      await deploymentsController.handleDeployGit(req, res, {
        config,
        depDeployer,
        sendJson,
        parseJsonBody,
      });
      return;
    }

    // 10. Undeploy
    if (pathname === '/api/deployments/undeploy' && req.method === 'POST') {
      await deploymentsController.handleUndeploy(req, res, {
        config,
        depDeployer,
        sendJson,
        parseJsonBody,
      });
      return;
    }

    // 11. Top Processes (/ps)
    if (pathname === '/api/processes' && req.method === 'GET') {
      await telemetryController.handleProcesses(req, res, {
        config,
        depNodeManager,
        depNodeClient,
        depSi,
        httpClient,
        urlObj,
        sendJson,
      });
      return;
    }

    // 12. PM2 Logs (/logs)
    if (pathname === '/api/logs' && req.method === 'GET') {
      await telemetryController.handleLogs(req, res, {
        config,
        depNodeManager,
        depNodeClient,
        httpClient,
        readLastLines,
        urlObj,
        sendJson,
      });
      return;
    }

    // 13. Clean Cache (/cleancache)
    if (pathname === '/api/cleancache' && req.method === 'POST') {
      await deploymentsController.handleCleanCache(req, res, {
        config,
        depNodeManager,
        depNodeClient,
        depExecAsync,
        httpClient,
        sendJson,
        parseJsonBody,
      });
      return;
    }

    // 14. Restart PM2 (/restart)
    if (pathname === '/api/restart' && req.method === 'POST') {
      await deploymentsController.handleRestartApp(req, res, {
        config,
        depNodeManager,
        depNodeClient,
        httpClient,
        sendJson,
        parseJsonBody,
      });
      return;
    }

    // 15. Update Source Code & Restart (/update)
    if (pathname === '/api/update' && req.method === 'POST') {
      await deploymentsController.handleUpdateNode(req, res, {
        config,
        depNodeManager,
        depNodeClient,
        depWhitelist,
        depRunner,
        httpClient,
        sendJson,
        parseJsonBody,
      });
      return;
    }

    // 16. Terminal Aliases & Exec (/sh)
    if (pathname === '/api/sh/aliases' && req.method === 'GET') {
      terminalController.handleAliases(req, res, { depWhitelist, sendJson });
      return;
    }

    if (pathname === '/api/sh' && req.method === 'POST') {
      await terminalController.handleExecSh(req, res, {
        config,
        depNodeManager,
        depNodeClient,
        depWhitelist,
        depRunner,
        httpClient,
        sendJson,
        parseJsonBody,
      });
      return;
    }

    // 17. Performance Test (/perf)
    if (pathname === '/api/perf' && req.method === 'POST') {
      await perfController.handlePerfAudit(req, res, {
        config,
        depResolveTargetUrl,
        depPerf,
        sendJson,
        parseJsonBody,
      });
      return;
    }

    // 18. Notes Manager (/notes)
    if (pathname === '/api/notes' && req.method === 'GET') {
      await notesController.handleGetNotes(req, res, { config, sendJson });
      return;
    }

    if (pathname === '/api/notes' && req.method === 'POST') {
      await notesController.handleCreateNote(req, res, { config, sendJson, parseJsonBody });
      return;
    }

    if (pathname === '/api/notes' && req.method === 'DELETE') {
      await notesController.handleDeleteNotes(req, res, { config, sendJson });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Endpoint không tồn tại' });
  });

  return server;
}

function startDashboardServer(config) {
  const port = config.dashboardPort ?? 3001;
  serverInstance = createDashboardServer(config);
  serverInstance.listen(port, '127.0.0.1', () => {
    console.log(`Dashboard API listening on localhost:${serverInstance.address().port}`);
  });
  return serverInstance;
}

function stopDashboardServer() {
  if (serverInstance) {
    if (typeof serverInstance.closeAllConnections === 'function') {
      serverInstance.closeAllConnections();
    }
    serverInstance.close();
    serverInstance = null;
  }
}

module.exports = {
  isDashboardAuthReady: authController.isDashboardAuthReady,
  createSessionToken: authController.createSessionToken,
  verifySessionToken: authController.verifySessionToken,
  verifyGoogleIdToken: authController.verifyGoogleIdToken,
  createDashboardServer,
  startDashboardServer,
  stopDashboardServer,
};
