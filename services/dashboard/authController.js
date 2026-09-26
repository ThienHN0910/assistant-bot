const crypto = require('crypto');
const axios = require('axios');

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

function handleAuthConfig(req, res, { config, sendJson }) {
  sendJson(res, 200, {
    ok: true,
    googleClientId: config.googleClientId || '',
    authType: 'google',
  });
}

async function handleGoogleLogin(req, res, { config, httpClient, sendJson, parseJsonBody }) {
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

    const targetEmail = (config.authorizedGoogleEmail || '').toLowerCase().trim();
    if (verifyRes.email !== targetEmail) {
      sendJson(res, 403, {
        ok: false,
        error: `Tài khoản Google (${verifyRes.email}) không có quyền truy cập hệ thống.`,
      });
      return;
    }

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
}

function handleVerifySession(req, res, { config, sendJson }) {
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
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  isDashboardAuthReady,
  verifyGoogleIdToken,
  checkAuth,
  handleAuthConfig,
  handleGoogleLogin,
  handleVerifySession,
};
