const assert = require('assert');
const statusCmd = require('../commands/status');

async function testStatusMultiNode() {
  let repliedText = '';
  const fakeCtx = {
    message: { text: '/status' },
    replyWithHTML: async (text) => { repliedText = text; },
    reply: async (text) => { repliedText = text; },
  };

  const mockNodeManager = {
    getNodes: async () => [
      { id: 'gcp-master', name: 'GCP Master', ip: '104.1.2.3', isLocal: true },
      { id: 'oracle-worker', name: 'Oracle VM', ip: '140.4.5.6', isLocal: false },
      { id: 'warning-worker', name: 'Warning VM', ip: '140.7.8.9', isLocal: false },
      { id: 'offline-worker', name: 'Offline VM', ip: '140.9.9.9', isLocal: false },
    ],
    maskIp: (ip) => `${ip.split('.')[0]}.***.***`,
  };

  const mockNodeClient = {
    getMetrics: async (node) => {
      if (node.id === 'offline-worker') {
        return { ok: false, error: 'Connection refused' };
      }
      if (node.id === 'warning-worker') {
        return {
          ok: true,
          metrics: {
            cpuLoad: 88,
            memory: { usedBytes: 900000000, totalBytes: 1000000000 },
          },
        };
      }
      return {
        ok: true,
        metrics: {
          cpuLoad: 8,
          memory: { usedBytes: 400000000, totalBytes: 1000000000 },
        },
      };
    },
  };

  await statusCmd.execute(fakeCtx, {
    nodeManager: mockNodeManager,
    nodeClient: mockNodeClient,
  });

  assert(repliedText.includes('GCP Master'), 'Status report should include GCP Master');
  assert(repliedText.includes('Oracle VM'), 'Status report should include Oracle VM');
  assert(repliedText.includes('104.***.***'), 'Status report should include masked IP for GCP Master');
  assert(repliedText.includes('140.***.***'), 'Status report should include masked IP for Oracle VM');
  assert(repliedText.includes('Warning VM'), 'Status report should include Warning VM');
  assert(repliedText.includes('⚠️'), 'Warning VM should have warning badge for >=80%');
  assert(repliedText.includes('Offline VM'), 'Status report should include Offline VM');
  console.log('✅ multi-vps telegram status test passed');

  // Help flag test
  let helpText = '';
  await statusCmd.execute({
    message: { text: '/status -h' },
    replyWithHTML: async (text) => { helpText = text; },
  });
  assert(helpText.includes('Hướng dẫn lệnh /status'), 'Status -h should show help text');
}

async function testNodesCommand() {
  const nodesCmd = require('../commands/nodes');
  assert.strictEqual(nodesCmd.name, 'nodes');
  assert.strictEqual(nodesCmd.description, 'Xem danh sách các máy chủ trong cụm (Multi-VPS)');

  let repliedText = '';
  const fakeCtx = {
    message: { text: '/nodes' },
    replyWithHTML: async (text) => { repliedText = text; },
    reply: async (text) => { repliedText = text; },
  };

  const mockNodeManager = {
    getNodes: async () => [
      { id: 'gcp-master', name: 'GCP Master', ip: '104.1.2.3', isLocal: true },
      { id: 'oracle-worker', name: 'Oracle VM', ip: '140.4.5.6', isLocal: false },
    ],
    maskIp: (ip) => `${ip.split('.')[0]}.***.***`,
  };

  const mockNodeClient = {
    getMetrics: async () => ({ ok: true, metrics: { cpuLoad: 5 } }),
  };

  await nodesCmd.execute(fakeCtx, {}, {
    nodeManager: mockNodeManager,
    nodeClient: mockNodeClient,
  });

  assert(repliedText.includes('GCP Master'), 'Nodes list should include GCP Master');
  assert(repliedText.includes('Oracle VM'), 'Nodes list should include Oracle VM');
  assert(repliedText.includes('104.***.***'), 'Nodes list should show masked IP');
  assert(repliedText.includes('140.***.***'), 'Nodes list should show masked IP');
  assert(repliedText.includes('Master'), 'Should indicate Master node');
  assert(repliedText.includes('Online'), 'Should indicate Online status');
  console.log('✅ nodes command test passed');
}

async function testUpdateMultiNode() {
  const updateCmd = require('../commands/update');

  const mockNodeManager = {
    getNodes: async () => [
      { id: 'gcp-master', name: 'GCP Master', ip: '104.1.2.3', isLocal: true },
      { id: 'oracle-worker', name: 'Oracle VM', ip: '140.4.5.6', isLocal: false },
    ],
    getNode: async (id) => {
      if (id === 'oracle-worker') {
        return { id: 'oracle-worker', name: 'Oracle VM', ip: '140.4.5.6', isLocal: false };
      }
      if (id === 'gcp-master') {
        return { id: 'gcp-master', name: 'GCP Master', ip: '104.1.2.3', isLocal: true };
      }
      return null;
    },
  };

  let remoteUpdatedNode = null;
  const mockNodeClient = {
    update: async (node) => {
      remoteUpdatedNode = node;
      return { ok: true, output: 'Remote updated successfully' };
    },
  };

  let localSequenceRun = false;
  const mockRunner = {
    runSequence: async (commands) => {
      localSequenceRun = true;
      return commands.map((c) => ({ ok: true, stdout: 'ok', code: 0 }));
    },
  };

  // 1. Remote update: /update oracle-worker
  const repliesRemote = [];
  await updateCmd.execute(
    {
      message: { text: '/update oracle-worker' },
      replyWithHTML: async (text) => { repliesRemote.push(text); },
    },
    {},
    {
      nodeManager: mockNodeManager,
      nodeClient: mockNodeClient,
    }
  );

  assert.strictEqual(remoteUpdatedNode?.id, 'oracle-worker', 'Should update remote node oracle-worker');
  assert(repliesRemote.some((r) => r.includes('Oracle VM') && r.includes('thành công')), 'Should notify remote update success');
  console.log('✅ update remote node test passed');

  // 2. All update: /update all
  remoteUpdatedNode = null;
  localSequenceRun = false;
  const repliesAll = [];
  await updateCmd.execute(
    {
      message: { text: '/update all' },
      replyWithHTML: async (text) => { repliesAll.push(text); },
    },
    {},
    {
      nodeManager: mockNodeManager,
      nodeClient: mockNodeClient,
      runner: mockRunner,
      exec: (cmd, cb) => { if (cb) cb(null); },
      restartDelay: 10,
    }
  );

  assert.strictEqual(remoteUpdatedNode?.id, 'oracle-worker', 'Should have updated remote node');
  assert.strictEqual(localSequenceRun, true, 'Should have run local update sequence');
  console.log('✅ update all nodes test passed');
}

async function testDeployZipMultiVpsOptions() {
  const deployCmd = require('../commands/deploy');
  const mockNodeManager = {
    getNodes: async () => [
      { id: 'gcp-master', name: 'GCP Master', ip: '104.1.2.3', isLocal: true },
      { id: 'oracle-worker', name: 'Oracle VM', ip: '140.4.5.6', isLocal: false },
    ],
  };

  const actionHandlers = new Map();
  const fakeBot = {
    action: (regex, handler) => {
      actionHandlers.set(regex.toString(), handler);
    },
  };

  deployCmd.register(fakeBot, {
    uploadDir: 'uploads',
    nodeManager: mockNodeManager,
  });

  // Find deploy_zip handler
  let deployZipHandler = null;
  for (const [key, handler] of actionHandlers.entries()) {
    if (key.includes('deploy_zip')) {
      deployZipHandler = handler;
      break;
    }
  }
  assert(deployZipHandler, 'deploy_zip action handler must be registered');

  let sentKeyboard = null;
  const mockActionCtx = {
    match: ['deploy_zip:my-app.zip', 'my-app.zip'],
    answerCbQuery: async () => {},
    replyWithHTML: async (text, opts) => {
      sentKeyboard = opts?.reply_markup?.inline_keyboard;
    },
  };

  await deployZipHandler(mockActionCtx);

  assert(sentKeyboard, 'Should present inline keyboard when multiple VPS nodes exist');
  const callbacks = sentKeyboard.flat().map((b) => b.callback_data);
  assert(callbacks.includes('zip_target:vps:gcp-master:my-app.zip'), 'Should contain option for gcp-master');
  assert(callbacks.includes('zip_target:vps:oracle-worker:my-app.zip'), 'Should contain option for oracle-worker');
  console.log('✅ deploy zip multi-vps selection buttons test passed');
}

async function runTests() {
  await testStatusMultiNode();
  await testNodesCommand();
  await testUpdateMultiNode();
  await testDeployZipMultiVpsOptions();
  console.log('🎉 All multi-vps telegram tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ multi-vps telegram test failed:', err);
  process.exit(1);
});
