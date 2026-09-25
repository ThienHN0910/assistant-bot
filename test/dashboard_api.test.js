const assert = require('assert');
const axios = require('axios');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const {
  createDashboardServer,
  createSessionToken,
  verifySessionToken,
  startDashboardServer,
  stopDashboardServer,
} = require('../services/dashboardApi');

async function testDashboardApi() {
  const testRoot = path.join(__dirname, 'test_dashboard_env');
  const registryPath = path.join(testRoot, 'deployments.json');
  await fs.mkdir(testRoot, { recursive: true });

  await fs.writeFile(
    registryPath,
    JSON.stringify([
      { name: 'app-test', target: 'vps', domain: 'app-test.thienhn.io.vn', url: 'https://app-test.thienhn.io.vn', status: 'online' },
    ]),
    'utf8'
  );

  const sessionSecret = 'test-session-secret-12345';
  const authorizedEmail = 'admin@thienhn.io.vn';
  const googleClientId = 'test-google-client-id.apps.googleusercontent.com';

  const config = {
    dashboardPort: 0,
    googleClientId,
    authorizedGoogleEmail: authorizedEmail,
    sessionSecret,
    dashboardAllowedOrigin: 'https://dashboard.example.invalid',
    deployRegistryPath: registryPath,
    baseDomain: 'thienhn.io.vn',
  };

  // Mock Axios for Google TokenInfo
  const mockHttpClient = {
    get: async (url) => {
      if (url.includes('token=valid-admin-token')) {
        return {
          data: {
            email: authorizedEmail,
            email_verified: true,
            aud: googleClientId,
            name: 'Thien Admin',
            picture: 'https://example.com/avatar.png',
          },
        };
      }
      if (url.includes('token=unauthorized-user-token')) {
        return {
          data: {
            email: 'stranger@gmail.com',
            email_verified: true,
            aud: googleClientId,
            name: 'Stranger',
          },
        };
      }
      if (url.includes('token=unverified-admin-token')) {
        return { data: { email: authorizedEmail, email_verified: false, aud: googleClientId } };
      }
      if (url.includes('token=missing-audience-token')) {
        return { data: { email: authorizedEmail, email_verified: true } };
      }
      if (url.includes('token=wrong-audience-token')) {
        return { data: { email: authorizedEmail, email_verified: true, aud: 'other-client-id' } };
      }
      const err = new Error('Invalid token');
      err.response = { data: { error_description: 'Token invalid' } };
      throw err;
    },
  };

  const server = createDashboardServer(config, { axios: mockHttpClient });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const testPort = server.address().port;
  config.dashboardPort = testPort;

  const client = axios.create({
    baseURL: `http://127.0.0.1:${testPort}`,
    validateStatus: () => true,
  });

  try {
    const missingConfigServer = createDashboardServer({ deployRegistryPath: registryPath }, { axios: mockHttpClient });
    await new Promise((resolve) => missingConfigServer.listen(0, '127.0.0.1', resolve));
    try {
      const missingConfigClient = axios.create({
        baseURL: `http://127.0.0.1:${missingConfigServer.address().port}`,
        validateStatus: () => true,
      });
      const protectedRes = await missingConfigClient.get('/api/deployments');
      assert.strictEqual(protectedRes.status, 401, 'Missing auth config must never open management endpoints');
      const loginRes = await missingConfigClient.post('/api/auth/google', { credential: 'valid-admin-token' });
      assert.strictEqual(loginRes.status, 503, 'Missing auth config must not issue a session');
      assert.strictEqual(loginRes.data.token, undefined);
    } finally {
      missingConfigServer.closeAllConnections?.();
      await new Promise((resolve) => missingConfigServer.close(resolve));
    }

    const sameOriginServer = createDashboardServer({ ...config, dashboardAllowedOrigin: '' }, { axios: mockHttpClient });
    await new Promise((resolve) => sameOriginServer.listen(0, '127.0.0.1', resolve));
    try {
      const sameOriginUrl = `http://127.0.0.1:${sameOriginServer.address().port}`;
      const sameOriginClient = axios.create({ baseURL: sameOriginUrl, validateStatus: () => true });
      const sameOriginLogin = await sameOriginClient.post(
        '/api/auth/google',
        { credential: 'valid-admin-token' },
        { headers: { Origin: sameOriginUrl } }
      );
      assert.strictEqual(sameOriginLogin.status, 200, 'Unconfigured CORS must not break same-origin login');
      const sameOriginVerify = await sameOriginClient.post(
        '/api/auth/verify',
        {},
        { headers: { Origin: sameOriginUrl, Authorization: `Bearer ${sameOriginLogin.data.token}` } }
      );
      assert.strictEqual(sameOriginVerify.status, 200, 'Unconfigured CORS must not break same-origin verification');
    } finally {
      sameOriginServer.closeAllConnections?.();
      await new Promise((resolve) => sameOriginServer.close(resolve));
    }

    // 1. Session Token Unit Tests
    assert.throws(() => createSessionToken(authorizedEmail, ''), /secret/i);
    const validToken = createSessionToken(authorizedEmail, sessionSecret);
    assert.strictEqual(verifySessionToken(validToken, '', authorizedEmail), null);
    assert.strictEqual(verifySessionToken(validToken, sessionSecret, ''), null);
    assert.strictEqual(verifySessionToken('broken.' + validToken.split('.')[1], sessionSecret, authorizedEmail), null);
    const expiredPayload = Buffer.from(JSON.stringify({ email: authorizedEmail, exp: 0 })).toString('base64url');
    const expiredSignature = crypto.createHmac('sha256', sessionSecret).update(expiredPayload).digest('base64url');
    assert.strictEqual(verifySessionToken(`${expiredPayload}.${expiredSignature}`, sessionSecret, authorizedEmail), null);
    const verified = verifySessionToken(validToken, sessionSecret, authorizedEmail);
    assert(verified, 'Session token should verify successfully');
    assert.strictEqual(verified.email, authorizedEmail);

    const wrongEmail = verifySessionToken(validToken, sessionSecret, 'other@email.com');
    assert.strictEqual(wrongEmail, null, 'Should reject token with mismatched email');

    const wrongSecret = verifySessionToken(validToken, 'wrong-secret', authorizedEmail);
    assert.strictEqual(wrongSecret, null, 'Should reject token signed with different secret');
    console.log('✅ session token creation and verification unit test passed');

    // 2. Health check (unauthenticated)
    const healthRes = await client.get('/api/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.data.ok, true);
    console.log('✅ dashboardApi /api/health test passed');

    // 3. Auth config endpoint
    const configRes = await client.get('/api/auth/config');
    assert.strictEqual(configRes.status, 200);
    assert.strictEqual(configRes.data.googleClientId, googleClientId);
    console.log('✅ dashboardApi /api/auth/config test passed');

    // 4. Google Auth - Invalid token
    const invalidGoogleRes = await client.post('/api/auth/google', { credential: 'bad-token' });
    assert.strictEqual(invalidGoogleRes.status, 401);
    console.log('✅ dashboardApi /api/auth/google bad token rejection test passed');

    // 5. Google Auth - Unauthorized email (403 Forbidden)
    const strangerRes = await client.post('/api/auth/google', { credential: 'unauthorized-user-token' });
    assert.strictEqual(strangerRes.status, 403);
    assert(strangerRes.data.error.includes('không có quyền truy cập'));
    console.log('✅ dashboardApi /api/auth/google unauthorized email 403 test passed');


    // 6. Google Auth - Authorized email (200 OK + returns session token)
    const unverifiedRes = await client.post('/api/auth/google', { credential: 'unverified-admin-token' });
    assert.strictEqual(unverifiedRes.status, 403);
    const missingAudienceRes = await client.post('/api/auth/google', { credential: 'missing-audience-token' });
    assert.strictEqual(missingAudienceRes.status, 403);
    const wrongAudienceRes = await client.post('/api/auth/google', { credential: 'wrong-audience-token' });
    assert.strictEqual(wrongAudienceRes.status, 403);

    const adminRes = await client.post('/api/auth/google', { credential: 'valid-admin-token' });
    assert.strictEqual(adminRes.status, 200);
    assert.strictEqual(adminRes.data.ok, true);
    assert(adminRes.data.token, 'Should return session token');
    assert.strictEqual(adminRes.data.user.email, authorizedEmail);
    const sessionToken = adminRes.data.token;
    console.log('✅ dashboardApi /api/auth/google authorized login success test passed');

    // 7. Verify session token endpoint
    const verifyPassRes = await client.post(
      '/api/auth/verify',
      {},
      { headers: { Authorization: `Bearer ${sessionToken}` } }
    );
    assert.strictEqual(verifyPassRes.status, 200);
    assert.strictEqual(verifyPassRes.data.authenticated, true);
    console.log('✅ dashboardApi /api/auth/verify success test passed');

    // 8. Access protected endpoint without auth
    const unauthRes = await client.get('/api/deployments');
    assert.strictEqual(unauthRes.status, 401);
    console.log('✅ dashboardApi protected endpoint unauthorized test passed');

    // 9. Access protected endpoint with Bearer session token
    const authHeaders = { Authorization: `Bearer ${sessionToken}` };
    const rejectedOriginRes = await client.post(
      '/api/deployments/undeploy',
      { name: 'app-test' },
      { headers: { ...authHeaders, Origin: 'https://foreign.example.invalid' } }
    );
    assert.strictEqual(rejectedOriginRes.status, 403);
    assert.notStrictEqual(rejectedOriginRes.headers['access-control-allow-origin'], '*');
    const allowedOriginRes = await client.post(
      '/api/auth/verify',
      {},
      { headers: { ...authHeaders, Origin: 'https://dashboard.example.invalid' } }
    );
    assert.strictEqual(allowedOriginRes.status, 200);
    assert.strictEqual(allowedOriginRes.headers['access-control-allow-origin'], 'https://dashboard.example.invalid');
    const rejectedPreflight = await client.options('/api/deployments/undeploy', {
      headers: { Origin: 'https://foreign.example.invalid' },
    });
    assert.strictEqual(rejectedPreflight.status, 403);
    const depRes = await client.get('/api/deployments', { headers: authHeaders });
    assert.strictEqual(depRes.status, 200);
    assert.strictEqual(depRes.data.ok, true);
    assert(Array.isArray(depRes.data.deployments));
    assert.strictEqual(depRes.data.deployments[0].name, 'app-test');
    console.log('✅ dashboardApi /api/deployments with Bearer session token test passed');

    // 10. Access /api/status telemetry with session token
    const statusRes = await client.get('/api/status', { headers: authHeaders });
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.data.ok, true);
    assert(typeof statusRes.data.system.cpuLoad === 'number');
    assert(statusRes.data.system.memory);
    console.log('✅ dashboardApi /api/status telemetry test passed');

    // 11. Undeploy endpoint
    const undeployRes = await client.post('/api/deployments/undeploy', { name: 'app-test' }, { headers: authHeaders });
    assert.strictEqual(undeployRes.status, 200);
    assert.strictEqual(undeployRes.data.ok, true);

    const afterRes = await client.get('/api/deployments', { headers: authHeaders });
    assert.strictEqual(afterRes.data.deployments.some((d) => d.name === 'app-test'), false);
    console.log('✅ dashboardApi /api/deployments/undeploy test passed');
  } finally {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }

  const boundServer = startDashboardServer({ ...config, dashboardPort: 0 });
  try {
    await new Promise((resolve) => boundServer.once('listening', resolve));
    assert.strictEqual(boundServer.address().address, '127.0.0.1');
  } finally {
    if (typeof boundServer.closeAllConnections === 'function') {
      boundServer.closeAllConnections();
    }
    await new Promise((resolve) => boundServer.close(resolve));
    stopDashboardServer();
  }
}

testDashboardApi().catch((err) => {
  console.error('Dashboard API test failed:', err);
  process.exit(1);
});
