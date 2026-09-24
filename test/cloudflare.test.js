const assert = require('assert');
const cloudflare = require('../lib/providers/cloudflare');

async function testCloudflareProvider() {
  // 1. Test isEnabled
  assert.strictEqual(cloudflare.isEnabled({}), false, 'Should be disabled with empty config');
  assert.strictEqual(cloudflare.isEnabled({ cloudflareApiToken: 'tok' }), false, 'Should be disabled without zoneId');
  assert.strictEqual(cloudflare.isEnabled({ cloudflareApiToken: 'tok', cloudflareZoneId: 'zone' }), true, 'Should be enabled with both');
  console.log('✅ cloudflare isEnabled test passed');

  // 2. Test resolveFullDomain
  assert.strictEqual(cloudflare.resolveFullDomain('app', 'thienhn.io.vn'), 'app.thienhn.io.vn');
  assert.strictEqual(cloudflare.resolveFullDomain('app.thienhn.io.vn', 'thienhn.io.vn'), 'app.thienhn.io.vn');
  console.log('✅ cloudflare resolveFullDomain test passed');

  // 3. Test upsertCnameRecord when disabled (Feature flag)
  const disabledRes = await cloudflare.upsertCnameRecord({ subdomain: 'test', targetCname: 'target.com' }, {});
  assert.strictEqual(disabledRes.ok, false);
  assert.strictEqual(disabledRes.skipped, true);
  console.log('✅ cloudflare upsertCnameRecord skipped when disabled test passed');

  // 4. Test upsertCnameRecord - Create new record
  const mockCalls = [];
  const mockClientCreate = {
    get: async (url, opts) => {
      mockCalls.push({ method: 'GET', url, opts });
      return { data: { result: [] } }; // No existing record
    },
    post: async (url, body, opts) => {
      mockCalls.push({ method: 'POST', url, body, opts });
      return { data: { result: { id: 'rec-123', name: body.name } } };
    },
  };

  const config = {
    cloudflareApiToken: 'mock-token',
    cloudflareZoneId: 'mock-zone',
    baseDomain: 'thienhn.io.vn',
  };

  const createRes = await cloudflare.upsertCnameRecord(
    { subdomain: 'my-app', targetCname: 'cname.vercel-dns.com', proxied: false },
    config,
    mockClientCreate
  );

  assert.strictEqual(createRes.ok, true);
  assert.strictEqual(createRes.action, 'created');
  assert.strictEqual(createRes.recordId, 'rec-123');
  assert.strictEqual(createRes.domain, 'my-app.thienhn.io.vn');
  assert.strictEqual(mockCalls.length, 2);
  assert.strictEqual(mockCalls[1].method, 'POST');
  assert.strictEqual(mockCalls[1].body.content, 'cname.vercel-dns.com');
  assert.strictEqual(mockCalls[1].opts.headers.Authorization, 'Bearer mock-token');
  console.log('✅ cloudflare upsertCnameRecord create test passed');

  // 5. Test upsertCnameRecord - Update existing record
  const updateCalls = [];
  const mockClientUpdate = {
    get: async (url, opts) => {
      updateCalls.push({ method: 'GET', url });
      return { data: { result: [{ id: 'existing-id', name: 'my-app.thienhn.io.vn' }] } };
    },
    put: async (url, body, opts) => {
      updateCalls.push({ method: 'PUT', url, body });
      return { data: { result: { id: 'existing-id' } } };
    },
  };

  const updateRes = await cloudflare.upsertCnameRecord(
    { subdomain: 'my-app', targetCname: 'new-target.onrender.com' },
    config,
    mockClientUpdate
  );

  assert.strictEqual(updateRes.ok, true);
  assert.strictEqual(updateRes.action, 'updated');
  assert.strictEqual(updateRes.recordId, 'existing-id');
  assert.strictEqual(updateCalls.length, 2);
  assert.strictEqual(updateCalls[1].method, 'PUT');
  assert.strictEqual(updateCalls[1].body.content, 'new-target.onrender.com');
  console.log('✅ cloudflare upsertCnameRecord update test passed');

  // 6. Test deleteCnameRecord
  const deleteCalls = [];
  const mockClientDelete = {
    get: async (url) => {
      deleteCalls.push({ method: 'GET', url });
      return { data: { result: [{ id: 'del-id', name: 'my-app.thienhn.io.vn' }] } };
    },
    delete: async (url, opts) => {
      deleteCalls.push({ method: 'DELETE', url, opts });
      return { data: { success: true } };
    },
  };

  const deleteRes = await cloudflare.deleteCnameRecord(
    { subdomain: 'my-app' },
    config,
    mockClientDelete
  );

  assert.strictEqual(deleteRes.ok, true);
  assert.strictEqual(deleteRes.deleted, true);
  assert.strictEqual(deleteRes.recordId, 'del-id');
  assert.strictEqual(deleteCalls.length, 2);
  assert.strictEqual(deleteCalls[1].method, 'DELETE');
  console.log('✅ cloudflare deleteCnameRecord test passed');
}

testCloudflareProvider().catch((err) => {
  console.error('Cloudflare provider test failed:', err);
  process.exit(1);
});
