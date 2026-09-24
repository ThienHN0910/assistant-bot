const http = require('http');
const crypto = require('crypto');
const axios = require('axios');
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

function createSessionToken(email, secret) {
  const payload = {
    email: (email || '').toLowerCase().trim(),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days expiration
  };
  const dataStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret || 'default-salt').update(dataStr).digest('base64url');
  return `${dataStr}.${signature}`;
}

function verifySessionToken(token, secret, authorizedEmail) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [dataStr, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret || 'default-salt').update(dataStr).digest('base64url');
  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(dataStr, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    if (authorizedEmail && payload.email !== authorizedEmail.toLowerCase().trim()) return null;
    return payload;
  } catch {
    return null;
  }
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
  // If no authorized email configured in dev, allow access
  if (!config.authorizedGoogleEmail) {
    return true;
  }

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

    // 2. Auth Config - Public endpoint returning Google Client ID for GIS button
    if (pathname === '/api/auth/config' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        googleClientId: config.googleClientId || '',
        authType: 'google',
      });
      return;
    }

    // 3. Google Sign-In Authentication Endpoint
    if (pathname === '/api/auth/google' && req.method === 'POST') {
      try {
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

        // Verify authorized email
        const targetEmail = (config.authorizedGoogleEmail || '').toLowerCase().trim();
        if (targetEmail && verifyRes.email !== targetEmail) {
          sendJson(res, 403, {
            ok: false,
            error: `Tài khoản Google (${verifyRes.email}) không có quyền truy cập hệ thống.`,
          });
          return;
        }

        // Verify Google Client ID if configured
        if (config.googleClientId && verifyRes.aud && verifyRes.aud !== config.googleClientId) {
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

    // 5. System Status
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

    // 6. List All Deployments
    if (pathname === '/api/deployments' && req.method === 'GET') {
      try {
        const deployments = await deployer.listAllDeployments(config);
        sendJson(res, 200, { ok: true, deployments });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    // 7. Undeploy
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
  createSessionToken,
  verifySessionToken,
  verifyGoogleIdToken,
  createDashboardServer,
  startDashboardServer,
  stopDashboardServer,
};
