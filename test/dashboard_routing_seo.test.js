const assert = require('assert');
const axios = require('axios');
const { createDashboardServer } = require('../services/dashboardApi');

async function testDashboardRoutingAndSeo() {
  const config = {
    dashboardPort: 0,
    googleClientId: 'test-client-id',
    authorizedGoogleEmail: 'admin@thienhn.io.vn',
    sessionSecret: 'test-secret',
    dashboardAllowedOrigin: '',
    deployRegistryPath: '',
    baseDomain: 'thienhn.io.vn',
  };

  const server = createDashboardServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const client = axios.create({
    baseURL: `http://127.0.0.1:${port}`,
    validateStatus: () => true,
  });

  try {
    // 1. Robots.txt test
    const robotsRes = await client.get('/robots.txt');
    assert.strictEqual(robotsRes.status, 200, 'robots.txt should return status 200');
    assert(
      robotsRes.headers['content-type'] && robotsRes.headers['content-type'].includes('text/plain'),
      `robots.txt content-type must be text/plain, got: ${robotsRes.headers['content-type']}`
    );
    assert(robotsRes.data.includes('User-agent: *'), 'robots.txt must contain User-agent: *');
    assert(robotsRes.data.includes('Disallow: /api/'), 'robots.txt must disallow /api/');
    assert(robotsRes.data.includes('Disallow: /dashboard'), 'robots.txt must disallow /dashboard');
    assert(robotsRes.data.includes('Sitemap: https://bot.thienhn.io.vn/sitemap.xml'), 'robots.txt must declare sitemap URL');
    console.log('✅ GET /robots.txt test passed');

    // 2. Sitemap.xml test
    const sitemapRes = await client.get('/sitemap.xml');
    assert.strictEqual(sitemapRes.status, 200, 'sitemap.xml should return status 200');
    assert(
      sitemapRes.headers['content-type'] && sitemapRes.headers['content-type'].includes('xml'),
      `sitemap.xml content-type must be xml, got: ${sitemapRes.headers['content-type']}`
    );
    assert(sitemapRes.data.includes('<urlset'), 'sitemap.xml must have urlset root');
    assert(sitemapRes.data.includes('https://bot.thienhn.io.vn/'), 'sitemap.xml must contain base URL');
    assert(sitemapRes.data.includes('https://bot.thienhn.io.vn/commands'), 'sitemap.xml must contain /commands URL');
    console.log('✅ GET /sitemap.xml test passed');

    // 3. SPA Fallback tests for HTML5 History API routes
    const routesToTest = [
      '/dashboard',
      '/dashboard/telemetry',
      '/dashboard/deployments',
      '/dashboard/operations',
      '/dashboard/notes',
      '/dashboard/commands',
      '/commands',
      '/features',
      '/architecture',
      '/cluster',
    ];

    for (const route of routesToTest) {
      const res = await client.get(route);
      assert.strictEqual(res.status, 200, `${route} should return 200 via SPA fallback`);
      assert(
        res.headers['content-type'] && res.headers['content-type'].includes('text/html'),
        `${route} content-type should be text/html`
      );
      assert(
        typeof res.data === 'string' && res.data.includes('DevOps Dashboard'),
        `${route} should return index.html content`
      );
    }
    console.log('✅ SPA Fallback for all clean routes passed');

    // 4. Verification that non-existent API routes DO NOT fallback to index.html
    const badApiRes = await client.get('/api/nonexistent-route-for-testing');
    assert.notStrictEqual(badApiRes.status, 200, 'API 404/401 should not return 200 index.html');
    if (badApiRes.headers['content-type']) {
      assert(
        !badApiRes.headers['content-type'].includes('text/html'),
        'API route should return JSON, not text/html'
      );
    }
    console.log('✅ API non-fallback isolation test passed');
  } finally {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

testDashboardRoutingAndSeo().catch((err) => {
  console.error('Routing and SEO tests failed:', err);
  process.exit(1);
});
