const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const si = require('systeminformation');
const deployer = require('../lib/deployer');
const repoInspector = require('../lib/repoInspector');
const nodeManager = require('../lib/nodeManager');
const nodeClient = require('../lib/nodeClient');
const { formatFileSize, readLastLines } = require('../config/utils');

let serverInstance = null;

function setCorsHeaders(req, res, config) {
  const origin = req.headers.origin;
  if (!origin || !config.dashboardAllowedOrigin || origin !== config.dashboardAllowedOrigin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

function createSessionToken(email, secret) {
  if (!secret) throw new Error('Dashboard session secret is required');
  const payload = {
    email: (email || '').toLowerCase().trim(),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days expiration
  };
  const dataStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(dataStr).digest('base64url');
  return `${dataStr}.${signature}`;
}

function verifySessionToken(token, secret, authorizedEmail) {
  if (!token || typeof token !== 'string' || !secret || !authorizedEmail) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [dataStr, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(dataStr).digest('base64url');
  const actualBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expectedSig, 'utf8');
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return null;

  try {
    const payload = JSON.parse(Buffer.from(dataStr, 'base64url').toString('utf8'));
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    if (payload.email !== authorizedEmail.toLowerCase().trim()) return null;
    return payload;
  } catch {
    return null;
  }
}

function isDashboardAuthReady(config) {
  return Boolean(config?.authorizedGoogleEmail && config?.googleClientId && config?.sessionSecret);
}

async function verifyGoogleIdToken(idToken, client = axios) {
  if (!idToken) {
    return { ok: false, error: 'Thiếu Google ID Token' };
  }

  try {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    const res = await client.get(url, { timeout: 10000 });
    const data = res.data;

    if (!data || !data.email) {
      return { ok: false, error: 'Token Google không hợp lệ hoặc thiếu email' };
    }

    return {
      ok: true,
      email: data.email.toLowerCase().trim(),
      emailVerified: data.email_verified === 'true' || data.email_verified === true,
      aud: data.aud,
      name: data.name || data.email,
      picture: data.picture || null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.response?.data?.error_description || error.message || 'Lỗi khi xác thực token Google',
    };
  }
}

function checkAuth(req, config) {
  if (!isDashboardAuthReady(config)) return false;

  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const verified = verifySessionToken(token, config.sessionSecret, config.authorizedGoogleEmail);
    if (verified) {
      req.user = verified;
      return true;
    }
  }

  return false;
}

function createDashboardServer(config, deps = {}) {
  const httpClient = deps.axios || axios;
  const depDeployer = deps.deployer || deployer;
  const depInspector = deps.inspector || repoInspector;
  const depNodeManager = deps.nodeManager || nodeManager;
  const depNodeClient = deps.nodeClient || nodeClient;
  const depSi = deps.si || si;

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

    // 0. Serve Dashboard UI index.html (public)
    if ((pathname === '/' || pathname === '/index.html') && req.method === 'GET') {
      try {
        const htmlPath = path.resolve(__dirname, '../dashboard/index.html');
        const html = await fs.readFile(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      } catch (err) {
        sendJson(res, 500, { ok: false, error: 'Dashboard UI HTML file not found' });
        return;
      }
    }

    // 1. Health check (no auth needed)
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, name: 'assistant-bot-dashboard-api', timestamp: new Date().toISOString() });
      return;
    }

    // 2. Auth Config - Public endpoint returning Google Client ID for GIS button
    if (pathname === '/api/auth/config' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        googleClientId: config.googleClientId || '',
        authType: 'google',
      });
      return;
    }

    // 2.1 Cluster Nodes (public - IPs masked, no secrets)
    if (pathname === '/api/nodes' && req.method === 'GET') {
      try {
        const rawNodes = await depNodeManager.getNodes(config);
        const nodes = rawNodes.map((n) => {
          const ipMasked = depNodeManager.maskIp ? depNodeManager.maskIp(n.ip) : (n.ip ? `${n.ip.split('.')[0]}.***` : '');
          return {
            id: n.id,
            name: n.name || n.id,
            isLocal: Boolean(n.isLocal),
            status: n.status || 'online',
            ipMasked,
            ip: ipMasked,
          };
        });
        sendJson(res, 200, { ok: true, nodes });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 3. Google Sign-In Authentication Endpoint
    if (pathname === '/api/auth/google' && req.method === 'POST') {
      try {
        if (!isDashboardAuthReady(config)) {
          sendJson(res, 503, { ok: false, error: 'Dashboard authentication is not configured' });
          return;
        }
        const body = await parseJsonBody(req);
        const credential = body.credential || body.id_token;

        if (!credential) {
          sendJson(res, 400, { ok: false, error: 'Thiếu Google Credential Token (credential)' });
          return;
        }

        const verifyRes = await verifyGoogleIdToken(credential, httpClient);
        if (!verifyRes.ok) {
          sendJson(res, 401, { ok: false, error: verifyRes.error });
          return;
        }

        if (!verifyRes.emailVerified) {
          sendJson(res, 403, { ok: false, error: 'Google email is not verified' });
          return;
        }

        // Verify authorized email
        const targetEmail = (config.authorizedGoogleEmail || '').toLowerCase().trim();
        if (verifyRes.email !== targetEmail) {
          sendJson(res, 403, {
            ok: false,
            error: `Tài khoản Google (${verifyRes.email}) không có quyền truy cập hệ thống.`,
          });
          return;
        }

        // Verify Google Client ID if configured
        if (verifyRes.aud !== config.googleClientId) {
          sendJson(res, 403, {
            ok: false,
            error: 'Google Client ID không khớp với cấu hình hệ thống.',
          });
          return;
        }

        const sessionToken = createSessionToken(verifyRes.email, config.sessionSecret);

        sendJson(res, 200, {
          ok: true,
          token: sessionToken,
          user: {
            email: verifyRes.email,
            name: verifyRes.name,
            picture: verifyRes.picture,
          },
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message || 'Lỗi xử lý đăng nhập Google' });
      }
      return;
    }

    // 4. Session Token Verification Endpoint
    if (pathname === '/api/auth/verify' && req.method === 'POST') {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';

      if (!token) {
        sendJson(res, 401, { ok: false, error: 'Chưa cung cấp token phiên đăng nhập' });
        return;
      }

      const verified = verifySessionToken(token, config.sessionSecret, config.authorizedGoogleEmail);
      if (verified) {
        sendJson(res, 200, { ok: true, authenticated: true, user: verified });
      } else {
        sendJson(res, 401, { ok: false, error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ' });
      }
      return;
    }

    // All subsequent endpoints require valid authentication
    if (!checkAuth(req, config)) {
      sendJson(res, 401, { ok: false, error: 'Yêu cầu đăng nhập Google hợp lệ (Unauthorized)' });
      return;
    }

    // 5. System Status & Multi-Node Cluster Telemetry
    if (pathname === '/api/status' && req.method === 'GET') {
      try {
        const [cpu, mem, fsSize, time] = await Promise.all([
          depSi.currentLoad().catch(() => ({ currentLoad: 0 })),
          depSi.mem().catch(() => ({ total: 1, used: 0, free: 0 })),
          depSi.fsSize().catch(() => []),
          depSi.time(),
        ]);

        const rootDisk = fsSize.find((f) => f.mount === '/') || fsSize[0] || { size: 0, used: 0 };
        const localUptime = time?.uptime || process.uptime();

        const system = {
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
          uptimeSeconds: localUptime,
          uptimeFormatted: `${Math.floor(localUptime / 86400)}d ${Math.floor((localUptime % 86400) / 3600)}h`,
        };

        const clusterNodesRaw = await depNodeManager.getNodes(config);
        const nodes = await Promise.all(
          clusterNodesRaw.map(async (node) => {
            const ipMasked = depNodeManager.maskIp ? depNodeManager.maskIp(node.ip) : (node.ip ? `${node.ip.split('.')[0]}.***` : '');
            if (node.isLocal) {
              return {
                id: node.id,
                name: node.name || node.id,
                isLocal: true,
                status: 'online',
                ipMasked,
                cpuLoad: system.cpuLoad,
                memory: system.memory,
                disk: system.disk,
                uptimeSeconds: system.uptimeSeconds,
                uptimeFormatted: system.uptimeFormatted,
              };
            }

            try {
              const res = await depNodeClient.getMetrics(node, httpClient);
              if (res && res.ok && res.metrics) {
                const memUsed = res.metrics.memory?.usedBytes || 0;
                const memTotal = res.metrics.memory?.totalBytes || 0;
                const memPct = memTotal > 0
                  ? Math.round((memUsed / memTotal) * 100)
                  : (Number(res.metrics.memory?.usedPercentage) || 0);
                const upSec = res.metrics.uptimeSeconds || 0;

                return {
                  id: node.id,
                  name: node.name || node.id,
                  isLocal: false,
                  status: 'online',
                  ipMasked,
                  cpuLoad: Number(res.metrics.cpuLoad) || 0,
                  memory: {
                    totalBytes: memTotal,
                    usedBytes: memUsed,
                    usedPercentage: memPct,
                    formatted: `${formatFileSize(memUsed)} / ${formatFileSize(memTotal)}`,
                  },
                  disk: res.metrics.disk || {
                    totalBytes: 0,
                    usedBytes: 0,
                    usedPercentage: 0,
                    formatted: 'N/A',
                  },
                  uptimeSeconds: upSec,
                  uptimeFormatted: `${Math.floor(upSec / 86400)}d ${Math.floor((upSec % 86400) / 3600)}h`,
                };
              }
              return {
                id: node.id,
                name: node.name || node.id,
                isLocal: false,
                status: 'offline',
                ipMasked,
                cpuLoad: 0,
                memory: { totalBytes: 0, usedBytes: 0, usedPercentage: 0, formatted: 'Offline' },
                disk: { totalBytes: 0, usedBytes: 0, usedPercentage: 0, formatted: 'Offline' },
                uptimeSeconds: 0,
                uptimeFormatted: 'Offline',
                error: res?.error || 'Node unreachable',
              };
            } catch (remoteErr) {
              return {
                id: node.id,
                name: node.name || node.id,
                isLocal: false,
                status: 'offline',
                ipMasked,
                cpuLoad: 0,
                memory: { totalBytes: 0, usedBytes: 0, usedPercentage: 0, formatted: 'Offline' },
                disk: { totalBytes: 0, usedBytes: 0, usedPercentage: 0, formatted: 'Offline' },
                uptimeSeconds: 0,
                uptimeFormatted: 'Offline',
                error: remoteErr.message,
              };
            }
          })
        );

        sendJson(res, 200, {
          ok: true,
          system,
          nodes,
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 6. List All Deployments
    if (pathname === '/api/deployments' && req.method === 'GET') {
      try {
        const clusterNodesRaw = await depNodeManager.getNodes(config).catch(() => []);
        const clusterNodesMap = new Map(clusterNodesRaw.map((n) => [n.id, n]));
        const rawDeployments = await depDeployer.listAllDeployments(config);
        const deployments = rawDeployments.map((d) => {
          let dnsTarget = 'Chưa xác định';
          if (d.target === 'vps') {
            const node = clusterNodesMap.get(d.nodeId || 'gcp-master');
            const targetIp = node?.ip || config.vpsPublicIp || '';
            const maskedIp = depNodeManager.maskIp ? depNodeManager.maskIp(targetIp) : (targetIp ? `${targetIp.split('.')[0]}.***` : 'VPS IP');
            dnsTarget = `A Record -> ${maskedIp || 'VPS IP'}`;
          } else if (d.target === 'vercel') {
            dnsTarget = `CNAME -> ${d.cnameTarget || 'cname.vercel-dns.com'}`;
          } else if (d.target === 'render') {
            dnsTarget = `CNAME -> ${d.cnameTarget || '*.onrender.com'}`;
          }
          return { ...d, dnsTarget };
        });
        sendJson(res, 200, { ok: true, deployments });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 7. Inspect GitHub Repo (Dashboard)
    if (pathname === '/api/deployments/inspect' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (!body.repoUrl) {
          sendJson(res, 400, { ok: false, error: 'Thiếu repoUrl' });
          return;
        }
        const inspection = await depInspector.inspectRepo(body.repoUrl, { client: httpClient });
        const suggestedSubdomain = await depDeployer.resolveAvailableSubdomain(inspection.repo, config);
        sendJson(res, 200, {
          ok: true,
          inspection,
          suggestedSubdomain,
          baseDomain: config.baseDomain || 'thienhn.io.vn',
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 8. Deploy GitHub Repo (Dashboard)
    if (pathname === '/api/deployments/deploy-git' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (!body.repoUrl || !body.target) {
          sendJson(res, 400, { ok: false, error: 'Thiếu thông tin repoUrl hoặc target' });
          return;
        }
        const result = await depDeployer.deploy(
          {
            source: 'github_public',
            repoUrl: body.repoUrl,
            projectName: body.projectName || body.subdomain,
            target: body.target,
            subdomain: body.subdomain,
            nodeId: body.nodeId,
          },
          config
        );
        sendJson(res, 200, { ok: true, deployment: result.deployment });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 9. Undeploy
    if (pathname === '/api/deployments/undeploy' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (!body.name) {
          sendJson(res, 400, { ok: false, error: 'Thiếu tên dự án cần xóa (name)' });
          return;
        }
        const result = await depDeployer.undeploy(body.name, config);
        sendJson(res, 200, { ok: true, undeployed: result });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 10. Top Processes (/ps)
    if (pathname === '/api/processes' && req.method === 'GET') {
      try {
        const requestedNodeId = urlObj.searchParams.get('nodeId');
        let selectedNode = null;
        if (requestedNodeId) {
          selectedNode = await depNodeManager.getNode(requestedNodeId, config);
        } else {
          selectedNode = await depNodeManager.getNode('gcp-master', config).catch(() => ({ id: 'gcp-master', name: 'Master', isLocal: true }));
        }

        if (!selectedNode) {
          sendJson(res, 404, { ok: false, error: 'Không tìm thấy node' });
          return;
        }

        let rawProcesses = [];
        if (selectedNode.isLocal) {
          const procs = await depSi.processes().catch(() => ({ list: [] }));
          rawProcesses = procs.list || [];
        } else {
          const remoteRes = await depNodeClient.getProcesses(selectedNode, httpClient);
          if (!remoteRes.ok) {
            sendJson(res, 502, { ok: false, error: remoteRes.error || 'Không thể lấy tiến trình từ worker' });
            return;
          }
          rawProcesses = remoteRes.processes || [];
        }

        const sorted = [...rawProcesses]
          .sort((a, b) => (Number(b.mem) || 0) - (Number(a.mem) || 0))
          .slice(0, 10)
          .map((p) => ({
            pid: Number(p.pid) || 0,
            name: p.name || 'unknown',
            mem: Number(p.mem) || 0,
            cpu: Number(p.cpu) || 0,
            user: p.user || 'root',
          }));

        sendJson(res, 200, {
          ok: true,
          node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
          processes: sorted,
        });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 11. PM2 Logs (/logs)
    if (pathname === '/api/logs' && req.method === 'GET') {
      try {
        const requestedNodeId = urlObj.searchParams.get('nodeId');
        const count = Math.max(1, Math.min(Number(urlObj.searchParams.get('lines')) || 20, 200));
        let selectedNode = null;
        if (requestedNodeId) {
          selectedNode = await depNodeManager.getNode(requestedNodeId, config);
        } else {
          selectedNode = await depNodeManager.getNode('gcp-master', config).catch(() => ({ id: 'gcp-master', name: 'Master', isLocal: true }));
        }

        if (!selectedNode) {
          sendJson(res, 404, { ok: false, error: 'Không tìm thấy node' });
          return;
        }

        let logsText = '';
        if (selectedNode.isLocal) {
          const logPath = config?.pm2ErrorLogPath || process.env.PM2_ERROR_LOG_PATH;
          if (!logPath) {
            logsText = 'Chưa cấu hình PM2_ERROR_LOG_PATH';
          } else {
            try {
              await fs.access(logPath);
              logsText = await readLastLines(logPath, count);
            } catch {
              logsText = 'Không tìm thấy file log PM2 tại ' + logPath;
            }
          }
        } else {
          const remoteRes = await depNodeClient.getLogs(selectedNode, count, httpClient);
          if (!remoteRes.ok) {
            sendJson(res, 502, { ok: false, error: remoteRes.error || 'Không thể lấy log từ worker' });
            return;
          }
          logsText = remoteRes.log || '';
        }

        sendJson(res, 200, {
          ok: true,
          node: { id: selectedNode.id, name: selectedNode.name || selectedNode.id },
          logs: logsText,
        });
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
  isDashboardAuthReady,
  createSessionToken,
  verifySessionToken,
  verifyGoogleIdToken,
  createDashboardServer,
  startDashboardServer,
  stopDashboardServer,
};
