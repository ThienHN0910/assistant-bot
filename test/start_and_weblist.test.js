const assert = require('assert');
const startCommand = require('../commands/start');
const webListCommand = require('../commands/web_list');

async function runTests() {
  console.log('🧪 Bắt đầu kiểm thử lệnh /start và /web_list...');

  // --- 1. KIỂM THỬ LỆNH /start ---
  let startReplied = null;
  let startOptions = null;
  const mockCtxStart = {
    message: { text: '/start' },
    reply: async (text, options) => {
      startReplied = text;
      startOptions = options;
    },
  };

  await startCommand.execute(mockCtxStart);
  assert(startReplied.includes('GIÁM SÁT & CỤM SERVER'), '/start phải có nhóm giám sát');
  assert(startReplied.includes('• /nodes'), '/start phải có lệnh /nodes');
  assert(startReplied.includes('• /status'), '/start phải có lệnh /status');
  assert(startReplied.includes('• /web_list'), '/start phải có lệnh /web_list');
  assert(startReplied.includes('TRIỂN KHAI & QUẢN LÝ WEB'), '/start phải có nhóm web');
  assert(startReplied.includes('HỆ THỐNG & ĐIỀU HÀNH'), '/start phải có nhóm điều hành');
  assert(startReplied.includes('-h'), '/start phải có hướng dẫn flag -h');

  // Kiểm tra keyboard
  const kb = startOptions.reply_markup.keyboard;
  const allButtons = kb.flat().map((b) => b.text);
  assert(allButtons.includes('/nodes'), 'Keyboard phải chứa nút /nodes');
  assert(allButtons.includes('/web_list'), 'Keyboard phải chứa nút /web_list');
  assert(allButtons.includes('/status'), 'Keyboard phải chứa nút /status');
  console.log('✅ start command test passed');

  // Test /start -h
  let helpReplied = null;
  await startCommand.execute({
    message: { text: '/start -h' },
    replyWithHTML: async (html) => { helpReplied = html; },
  });
  assert(helpReplied.includes('Hướng dẫn lệnh /start'), '/start -h phải trả về hướng dẫn');
  console.log('✅ start command -h test passed');

  // --- 2. KIỂM THỬ LỆNH /web_list ---
  // Test resolveServerLabel
  const mockNodes = [
    { id: 'gcp-master', name: 'GCP Master', isLocal: true },
    { id: 'oracle-worker', name: 'Oracle Cloud VM', isLocal: false },
  ];

  assert.strictEqual(
    webListCommand.resolveServerLabel({ target: 'vps', nodeId: 'gcp-master' }, mockNodes),
    '🖥️ GCP Master (Master)'
  );
  assert.strictEqual(
    webListCommand.resolveServerLabel({ target: 'vps', nodeId: 'oracle-worker' }, mockNodes),
    '☁️ Oracle Cloud VM (Worker)'
  );
  assert.strictEqual(
    webListCommand.resolveServerLabel({ target: 'vercel' }, mockNodes),
    '▲ Vercel Cloud'
  );
  assert.strictEqual(
    webListCommand.resolveServerLabel({ target: 'render' }, mockNodes),
    '⚡ Render Cloud'
  );
  console.log('✅ web_list resolveServerLabel test passed');

  // Test buildWebListKeyboard
  const smallList = [
    { name: 'app1' },
    { name: 'app2' },
  ];
  const smallKb = webListCommand.buildWebListKeyboard(smallList);
  assert.strictEqual(smallKb.inline_keyboard.length, 3); // 2 rows of actions + 1 row refresh
  assert.strictEqual(smallKb.inline_keyboard[0][0].callback_data, 'weblist_perf:app1');
  assert.strictEqual(smallKb.inline_keyboard[0][1].callback_data, 'weblist_rm:app1');
  assert.strictEqual(smallKb.inline_keyboard[2][0].callback_data, 'weblist_refresh');

  const largeList = [
    { name: 'app1' }, { name: 'app2' }, { name: 'app3' }, { name: 'app4' }, { name: 'app5' }
  ];
  const largeKb = webListCommand.buildWebListKeyboard(largeList);
  assert.strictEqual(largeKb.inline_keyboard.length, 2); // 1 row menu selectors + 1 row refresh
  assert.strictEqual(largeKb.inline_keyboard[0][0].callback_data, 'weblist_menu_perf');
  assert.strictEqual(largeKb.inline_keyboard[0][1].callback_data, 'weblist_menu_rm');
  console.log('✅ web_list buildWebListKeyboard hybrid test passed');

  // Test web_list execute with empty deployments
  let emptyReply = null;
  const mockDepsEmpty = {
    deployer: {
      listAllDeployments: async () => [],
    },
    nodeManager: {
      getNodes: async () => mockNodes,
    },
  };
  await webListCommand.execute({
    message: { text: '/web_list' },
    replyWithHTML: async (html) => { emptyReply = html; },
  }, {}, mockDepsEmpty);
  assert(emptyReply.includes('CHƯA CÓ WEB NÀO ĐƯỢC TRIỂN KHAI'));

  // Test web_list execute with deployments
  let listReply = null;
  let listOptions = null;
  const mockDepsPopulated = {
    deployer: {
      listAllDeployments: async () => [
        { name: 'test1', target: 'vps', nodeId: 'gcp-master', domain: 'test1.thienhn.io.vn', status: 'online' },
        { name: 'test2', target: 'vps', nodeId: 'oracle-worker', domain: 'test2.thienhn.io.vn', status: 'online' },
      ],
    },
    nodeManager: {
      getNodes: async () => mockNodes,
    },
  };
  await webListCommand.execute({
    message: { text: '/web_list' },
    replyWithHTML: async (html, opts) => {
      listReply = html;
      listOptions = opts;
    },
  }, {}, mockDepsPopulated);
  assert(listReply.includes('test1') && listReply.includes('GCP Master'));
  assert(listReply.includes('test2') && listReply.includes('Oracle Cloud VM'));
  assert(listReply.includes('/perf test1'));
  assert(listReply.includes('/web_remove test1'));
  assert(listOptions.reply_markup.inline_keyboard.length >= 2);
  console.log('✅ web_list execute populated test passed');

  // Test web_list register action handlers
  const registeredActions = new Map();
  const mockBot = {
    action: (pattern, handler) => {
      registeredActions.set(pattern, handler);
    },
  };

  let undeployCalledWith = null;
  const mockDepsActions = {
    deployer: {
      listAllDeployments: async () => [
        { name: 'my-site', target: 'vps', nodeId: 'oracle-worker' }
      ],
      undeploy: async (name) => {
        undeployCalledWith = name;
        return { ok: true, name, target: 'vps', dnsDeleted: true };
      },
    },
  };

  webListCommand.register(mockBot, {}, mockDepsActions);

  // 1. Test weblist_rm prompt
  const rmHandler = [...registeredActions.entries()].find(([p]) => p instanceof RegExp && p.test('weblist_rm:my-site'))[1];
  let promptHtml = '';
  let promptOpts = null;
  await rmHandler({
    match: ['weblist_rm:my-site', 'my-site'],
    answerCbQuery: async () => {},
    replyWithHTML: async (html, opts) => {
      promptHtml = html;
      promptOpts = opts;
    },
  });
  assert(promptHtml.includes('XÁC NHẬN GỠ BỎ WEBSITE'));
  assert(promptHtml.includes('my-site'));
  assert(promptOpts.reply_markup.inline_keyboard[0][0].callback_data === 'weblist_confirm_rm:my-site');

  // 2. Test weblist_confirm_rm execution
  const confirmHandler = [...registeredActions.entries()].find(([p]) => p instanceof RegExp && p.test('weblist_confirm_rm:my-site'))[1];
  let editHtml = '';
  await confirmHandler({
    match: ['weblist_confirm_rm:my-site', 'my-site'],
    answerCbQuery: async () => {},
    editMessageText: async (html) => { editHtml = html; },
  });
  assert.strictEqual(undeployCalledWith, 'my-site');
  assert(editHtml.includes('ĐÃ GỠ BỎ THÀNH CÔNG DỰ ÁN "my-site"'));

  // 3. Test weblist_cancel_rm
  const cancelHandler = registeredActions.get('weblist_cancel_rm');
  let cancelEditHtml = '';
  await cancelHandler({
    answerCbQuery: async () => {},
    editMessageText: async (html) => { cancelEditHtml = html; },
  });
  assert(cancelEditHtml.includes('Đã hủy thao tác gỡ bỏ'));

  console.log('✅ web_list register actions test passed');
  console.log('🎉 Toàn bộ kiểm thử cho start và web_list đã thành công!');
}

runTests().catch((err) => {
  console.error('❌ start and web_list test failed:', err);
  process.exit(1);
});
