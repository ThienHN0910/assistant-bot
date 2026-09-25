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
      return { data: { success: true, result: [] } }; // No existing record
    },
    post: async (url, body, opts) => {
      mockCalls.push({ method: 'POST', url, body, opts });
      return { data: { success: true, result: { id: 'rec-123', name: body.name } } };
    },
  };

  const config = {
    cloudflareApiToken: 'mock-token',
    cloudflareZoneId: 'mock-zone',
    baseDomain: 'thienhn.io.vn',
  };

  const createRes = await cloudflare.upsertCnameRecord(
    { subdomain: 'my-app', targetCname: 'cname.vercel-dns.com', proxied: false, ownershipTag: 'assistant-bot:test-cname' },
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
  assert.strictEqual(mockCalls[1].body.comment, 'assistant-bot:test-cname');
  assert.strictEqual(mockCalls[1].opts.headers.Authorization, 'Bearer mock-token');
  console.log('✅ cloudflare upsertCnameRecord create test passed');

  // 5. Test upsertCnameRecord - Update existing record
  const updateCalls = [];
  const mockClientUpdate = {
    get: async (url, opts) => {
      updateCalls.push({ method: 'GET', url });
      return { data: { success: true, result: [{ id: 'existing-id', name: 'my-app.thienhn.io.vn' }] } };
    },
    put: async (url, body, opts) => {
      updateCalls.push({ method: 'PUT', url, body });
      return { data: { success: true, result: { id: 'existing-id' } } };
    },
  };

  const updateRes = await cloudflare.upsertCnameRecord(
    { subdomain: 'my-app', targetCname: 'new-target.onrender.com', ownedRecordId: 'existing-id' },
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
      return { data: { success: true, result: { id: 'del-id', name: 'my-app.thienhn.io.vn', type: 'CNAME' } } };
    },
    delete: async (url, opts) => {
      deleteCalls.push({ method: 'DELETE', url, opts });
      return { data: { success: true, result: { id: 'del-id' } } };
    },
  };

  const deleteRes = await cloudflare.deleteCnameRecord(
    { subdomain: 'my-app', recordId: 'del-id' },
    config,
    mockClientDelete
  );

  assert.strictEqual(deleteRes.ok, true);
  assert.strictEqual(deleteRes.deleted, true);
  assert.strictEqual(deleteRes.recordId, 'del-id');
  assert.strictEqual(deleteCalls.length, 2);
  assert.strictEqual(deleteCalls[1].method, 'DELETE');
  console.log('✅ cloudflare deleteCnameRecord test passed');

  // 7. Test upsertARecord - Create new A record (VPS)
  const aCalls = [];
  const mockClientA = {
    get: async (url) => {
      aCalls.push({ method: 'GET', url });
      return { data: { success: true, result: [] } };
    },
    post: async (url, body) => {
      aCalls.push({ method: 'POST', url, body });
      return { data: { success: true, result: { id: 'rec-a-1', name: body.name } } };
    },
  };

  const aRes = await cloudflare.upsertARecord(
    { subdomain: 'portfolio', ip: '8.8.4.4', proxied: true, ownershipTag: 'assistant-bot:test-a' },
    config,
    mockClientA
  );

  assert.strictEqual(aRes.ok, true);
  assert.strictEqual(aRes.action, 'created');
  assert.strictEqual(aRes.recordId, 'rec-a-1');
  assert.strictEqual(aRes.domain, 'portfolio.thienhn.io.vn');
  assert.strictEqual(aCalls.length, 2);
  assert.strictEqual(aCalls[1].method, 'POST');
  assert.strictEqual(aCalls[1].body.type, 'A');
  assert.strictEqual(aCalls[1].body.content, '8.8.4.4');
  assert.strictEqual(aCalls[1].body.comment, 'assistant-bot:test-a');
  assert.strictEqual(aCalls[1].body.proxied, true);
  console.log('✅ cloudflare upsertARecord create test passed');

  // 8. Test upsertARecord - Update existing A record
  const aUpdateCalls = [];
  const mockClientAUpdate = {
    get: async (url) => {
      aUpdateCalls.push({ method: 'GET', url });
      return { data: { success: true, result: [{ id: 'existing-a-id', name: 'portfolio.thienhn.io.vn' }] } };
    },
    put: async (url, body) => {
      aUpdateCalls.push({ method: 'PUT', url, body });
      return { data: { success: true, result: { id: 'existing-a-id' } } };
    },
  };

  const aUpdateRes = await cloudflare.upsertARecord(
    { subdomain: 'portfolio', ip: '8.8.8.8', proxied: true, ownedRecordId: 'existing-a-id' },
    config,
    mockClientAUpdate
  );

  assert.strictEqual(aUpdateRes.ok, true);
  assert.strictEqual(aUpdateRes.action, 'updated');
  assert.strictEqual(aUpdateRes.recordId, 'existing-a-id');
  assert.strictEqual(aUpdateCalls[1].method, 'PUT');
  assert.strictEqual(aUpdateCalls[1].body.content, '8.8.8.8');
  console.log('✅ cloudflare upsertARecord update test passed');

  // 9. Test deleteDnsRecord (both A and CNAME)
  const dnsDelCalls = [];
  const mockClientDnsDel = {
    get: async (url) => {
      dnsDelCalls.push({ method: 'GET', url });
      return { data: { success: true, result: { id: 'a-del-id', name: 'portfolio.thienhn.io.vn', type: 'A' } } };
    },
    delete: async (url) => {
      dnsDelCalls.push({ method: 'DELETE', url });
      return { data: { success: true, result: { id: 'a-del-id' } } };
    },
  };

  const dnsDelRes = await cloudflare.deleteDnsRecord(
    { subdomain: 'portfolio', type: 'A', recordId: 'a-del-id' },
    config,
    mockClientDnsDel
  );
  assert.strictEqual(dnsDelRes.ok, true);
  assert.strictEqual(dnsDelRes.deleted, true);
  assert.strictEqual(dnsDelCalls.some((c) => c.method === 'DELETE' && c.url.includes('a-del-id')), true);
  console.log('✅ cloudflare deleteDnsRecord general test passed');
  let foreignPut = false;
  await assert.rejects(
    cloudflare.upsertARecord(
      { subdomain: 'portfolio', ip: '192.0.2.1' },
      config,
      {
        get: async () => ({ data: { success: true, result: [{ id: 'manual-a', name: 'portfolio.thienhn.io.vn', type: 'A' }] } }),
        put: async () => { foreignPut = true; },
      }
    ),
    /owned|collision/i
  );
  assert.strictEqual(foreignPut, false);

  await assert.rejects(
    cloudflare.upsertARecord(
      { subdomain: 'fresh', ip: '192.0.2.2' },
      config,
      {
        get: async () => ({ data: { success: true, result: [] } }),
        post: async () => ({ data: { success: false, errors: [{ code: 81057 }] } }),
      }
    ),
    /Cloudflare/i
  );

  let foreignDelete = false;
  await assert.rejects(
    cloudflare.deleteDnsRecord(
      { subdomain: 'portfolio', type: 'A', recordId: 'foreign-id' },
      config,
      {
        get: async () => ({ data: { success: true, result: { id: 'foreign-id', name: 'bot.thienhn.io.vn', type: 'A' } } }),
        delete: async () => { foreignDelete = true; },
      }
    ),
    /mismatch|ownership/i
  );
  assert.strictEqual(foreignDelete, false);

  await assert.rejects(
    cloudflare.findDnsRecord('portfolio.thienhn.io.vn', null, config, {
      get: async () => ({ data: { result: [] } }),
    }),
    /Cloudflare.*lookup/i
  );
  await assert.rejects(
    cloudflare.findDnsRecord('portfolio.thienhn.io.vn', null, config, {
      get: async () => ({ data: { success: true } }),
    }),
    /Cloudflare.*lookup/i
  );
  await assert.rejects(
    cloudflare.findDnsRecord('portfolio.thienhn.io.vn', null, config, {
      get: async (url) => ({ data: url.includes('page=2')
        ? { success: true, result: [{ id: 'second', name: 'portfolio.thienhn.io.vn', type: 'A' }], result_info: { total_pages: 2 } }
        : { success: true, result: [{ id: 'first', name: 'portfolio.thienhn.io.vn', type: 'A' }], result_info: { total_pages: 2 } } }),
    }),
    /multiple|collision/i
  );
  await assert.rejects(
    cloudflare.deleteDnsRecord({ subdomain: 'portfolio', type: 'A', recordId: 'a-del-id' }, config, {
      get: mockClientDnsDel.get,
      delete: async () => ({ data: {} }),
    }),
    /Cloudflare.*delete/i
  );
}

testCloudflareProvider().catch((err) => {
  console.error('Cloudflare provider test failed:', err);
  process.exit(1);
});
