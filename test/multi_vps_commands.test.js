const assert = require('assert');
const { createTextHandler } = require('../handlers/textHandler');
const deployStore = require('../lib/deployStore');
const deployer = require('../lib/deployer');

const local = { id: 'gcp-master', name: 'GCP Master', ip: '192.0.2.1', isLocal: true };
const remote = { id: 'oracle-worker', name: 'Oracle Worker', ip: '198.51.100.2', isLocal: false };
const calls = [];
const nodeManager = {
  getNode: async (id) => [local, remote].find((node) => node.id === id) || null,
  getNodes: async () => [local, remote],
  maskIp: () => '***',
};
const nodeClient = {
  getProcesses: async (node) => { calls.push(['processes', node.id]); return { ok: true, processes: [{ name: 'node', pid: 7, cpu: 1, mem: 2, user: 'worker' }] }; },
  getLogs: async (node, count) => { calls.push(['logs', node.id, count]); return { ok: true, log: '<remote log>' }; },
  getMetrics: async (node) => { calls.push(['metrics', node.id]); return { ok: true, metrics: { uptimeSeconds: 172800 } }; },
  cleanCache: async (node) => { calls.push(['clean', node.id]); return { ok: true, result: { pm2Flush: 'OK', cacheFreed: '20 MB' } }; },
  restartAgent: async (node) => { calls.push(['restart', node.id]); return { ok: true }; },
  execCommand: async (node, command) => { calls.push(['exec', node.id, command]); return { ok: true, stdout: '<worker>', stderr: '' }; },
};

async function invoke(name, text, extra = {}) {
  const replies = [];
  const ctx = {
    message: { text },
    replyWithHTML: async (value) => replies.push(value),
    reply: async (value) => replies.push(value),
  };
  await require(`../commands/${name}`).execute(ctx, {}, { nodeManager, nodeClient, ...extra });
  return replies.join('\n');
}

async function runTests() {
  assert.match(await invoke('ps', '/ps oracle-worker'), /Oracle Worker/);
  assert.deepStrictEqual(calls.pop(), ['processes', 'oracle-worker']);
  assert.match(await invoke('uptime', '/uptime', { si: { time: () => ({ uptime: 86400 }) } }), /Oracle Worker/);
  assert.deepStrictEqual(calls.pop(), ['metrics', 'oracle-worker']);
  assert.match(await invoke('logs', '/logs 8 oracle-worker'), /&lt;remote log&gt;/);
  assert.deepStrictEqual(calls.pop(), ['logs', 'oracle-worker', 8]);
  assert.match(await invoke('cleancache', '/cleancache oracle-worker'), /Oracle Worker/);
  assert.deepStrictEqual(calls.pop(), ['clean', 'oracle-worker']);
  await invoke('cleancache', '/cleancache all');
  assert(calls.some((call) => call[0] === 'clean' && call[1] === 'oracle-worker'), 'all cleans remote worker');
  calls.length = 0;
  assert.match(await invoke('restart', '/restart oracle-worker'), /Oracle Worker/);
  assert.deepStrictEqual(calls.pop(), ['restart', 'oracle-worker']);
  assert.match(await invoke('sh', '/sh oracle-worker hostname'), /&lt;worker&gt;/);
  assert.deepStrictEqual(calls.pop(), ['exec', 'oracle-worker', 'hostname']);
  assert.match(await invoke('sh', '/sh oracle-worker /pm2-list'), /&lt;worker&gt;/);
  assert.deepStrictEqual(calls.pop(), ['exec', 'oracle-worker', '/pm2-list']);
  assert.match(await invoke('sh', '/sh /uptime', { runner: { runSequence: async () => [{ ok: true, stdout: 'up 1 day' }] } }), /up 1 day/);
  const before = calls.length;
  assert.match(await invoke('restart', '/restart missing-node'), /không|not found|không tồn tại/i);
  assert.strictEqual(calls.length, before, 'unknown node cannot restart local master');

  let keyboard;
  await createTextHandler({ baseDomain: 'example.test' }, {
    nodeManager,
    inspector: { inspectRepo: async () => ({ type: 'static_pure', owner: 'example', repo: 'site' }) },
  })({
    from: { id: 42 }, message: { text: 'https://github.com/example/site' },
    replyWithHTML: async (_html, options) => { keyboard = options?.reply_markup?.inline_keyboard; },
    reply: async () => {},
  });
  const buttons = (keyboard || []).flat().filter((button) => button.callback_data.startsWith('git_target:') && button.callback_data.includes(':vps'));
  assert.strictEqual(buttons.length, 2, 'static GitHub repo offers both VPS nodes');
  const selected = buttons.find((button) => button.callback_data.endsWith(':oracle-worker'));
  assert(selected, 'Oracle button carries node ID');
  const callback = [];
  const bot = { action: (pattern, handler) => callback.push({ pattern, handler }) };
  require('../commands/deploy').register(bot, { baseDomain: 'example.test' });
  const action = callback.find((item) => item.pattern.test(selected.callback_data));
  assert(action, 'GitHub callback pattern accepts a node ID');
  const originalDeploy = deployer.deploy;
  let input;
  try {
    deployer.deploy = async (request) => { input = request; return { deployment: { name: 'site', target: 'vps', sourceDetail: 'https://github.com/example/site', domain: 'site.example.test', url: 'https://site.example.test' } }; };
    await action.handler({
      match: selected.callback_data.match(action.pattern),
      answerCbQuery: async () => {}, replyWithHTML: async () => {}, reply: async () => {},
    });
    assert.strictEqual(input.nodeId, 'oracle-worker');
  } finally {
    deployer.deploy = originalDeploy;
    deployStore.deletePending(selected.callback_data.split(':')[1]);
  }
  console.log('multi-vps command routing tests passed');
}

runTests().catch((err) => { console.error(err); process.exitCode = 1; });
