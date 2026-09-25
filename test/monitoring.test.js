const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const psCommand = require('../commands/ps');
const notesCommand = require('../commands/notes');
const { checkSystemHealth } = require('../services/watchdog');

async function testPsCommand() {
  assert.strictEqual(psCommand.name, 'ps');
  assert.strictEqual(typeof psCommand.execute, 'function');

  let repliedHtml = '';
  const mockCtx = {
    message: { text: '/ps' },
    replyWithHTML: async (html) => { repliedHtml = html; },
    reply: async (text) => { repliedHtml = text; },
  };

  await psCommand.execute(mockCtx);
  assert(repliedHtml.length > 0, 'ps command should produce output');
  assert(repliedHtml.includes('TOP 5 TIẾN TRÌNH'), 'ps command should contain header');
  console.log('✅ ps command test passed');
}

async function testNotesCommand() {
  assert.strictEqual(notesCommand.name, 'notes');
  assert.strictEqual(typeof notesCommand.execute, 'function');

  const tempNotes = path.join(__dirname, 'test_notes.txt');
  await fs.writeFile(tempNotes, '[03/09/2026 17:00] Test note 1\n[03/09/2026 17:01] Test note 2\n', 'utf8');

  try {
    let repliedHtml = '';
    const mockCtx = {
      message: { text: '/notes' },
      replyWithHTML: async (html) => { repliedHtml = html; },
      reply: async (text) => { repliedHtml = text; },
    };

    await notesCommand.execute(mockCtx, { notesFilePath: tempNotes });
    assert(repliedHtml.includes('10 dòng ghi chú gần nhất'), 'notes command should show header');
    assert(repliedHtml.includes('Test note 1'), 'notes command should display note content');

    // Test clear notes
    const mockClearCtx = {
      message: { text: '/notes clear' },
      replyWithHTML: async (html) => { repliedHtml = html; },
      reply: async (text) => { repliedHtml = text; },
    };
    await notesCommand.execute(mockClearCtx, { notesFilePath: tempNotes });
    const remaining = await fs.readFile(tempNotes, 'utf8');
    assert.strictEqual(remaining, '', 'notes file should be empty after clear');

    console.log('✅ notes command test passed');
  } finally {
    await fs.unlink(tempNotes).catch(() => {});
  }
}

async function testWatchdog() {
  const { resetAlertState } = require('../services/watchdog');
  resetAlertState();

  const sentMessages = [];
  const mockBot = {
    telegram: {
      sendMessage: async (chatId, msg) => {
        sentMessages.push({ chatId, msg });
      },
    },
  };
  const mockConfig = { authorizedTelegramId: 12345 };

  // 1. Bình thường: RAM dùng 85% nhưng available vẫn còn 180MB -> KHÔNG BÁO ĐỘNG
  const normalSi = {
    mem: async () => ({
      total: 1000 * 1024 * 1024,
      used: 850 * 1024 * 1024,
      available: 180 * 1024 * 1024,
    }),
    fsSize: async () => [{ mount: '/', use: 50 }],
    currentLoad: async () => ({ currentLoad: 20 }),
  };

  await checkSystemHealth(mockBot, mockConfig, { si: normalSi });
  assert.strictEqual(sentMessages.length, 0, 'Normal 85% RAM with 180MB available should NOT trigger false alarm');

  // 2. Nguy cấp: RAM available tụt xuống dưới 60MB -> Báo động LẦN 1
  const criticalRamSi = {
    mem: async () => ({
      total: 1000 * 1024 * 1024,
      used: 960 * 1024 * 1024,
      available: 40 * 1024 * 1024,
    }),
    fsSize: async () => [{ mount: '/', use: 50 }],
    currentLoad: async () => ({ currentLoad: 20 }),
  };

  await checkSystemHealth(mockBot, mockConfig, { si: criticalRamSi });
  assert.strictEqual(sentMessages.length, 1, 'Critical RAM should trigger exactly 1 alert');
  assert(sentMessages[0].msg.includes('RAM CẠN KIỆT'), 'Message should indicate critical RAM');

  // 3. Chu kỳ tiếp theo vẫn nguy cấp: KHÔNG GỬI LẶP LẠI (Chống spam)
  await checkSystemHealth(mockBot, mockConfig, { si: criticalRamSi });
  assert.strictEqual(sentMessages.length, 1, 'Subsequent check with same critical state should NOT repeat alert');

  // 4. Hồi phục: RAM available tăng lại trên 120MB -> Gửi thông báo HỒI PHỤC 1 lần
  await checkSystemHealth(mockBot, mockConfig, { si: normalSi });
  assert.strictEqual(sentMessages.length, 2, 'Recovery should trigger recovery message');
  assert(sentMessages[1].msg.includes('HỆ THỐNG ĐÃ ỔN ĐỊNH TRỞ LẠI'), 'Message should announce recovery');

  // 5. Chu kỳ tiếp theo vẫn bình thường: KHÔNG gửi thêm tin nhắn
  await checkSystemHealth(mockBot, mockConfig, { si: normalSi });
  assert.strictEqual(sentMessages.length, 2, 'Stable state should not produce new messages');

  console.log('✅ watchdog edge-triggered & recovery tests passed');
}

async function run() {
  await testPsCommand();
  await testNotesCommand();
  await testWatchdog();
}

run().catch((err) => {
  console.error('Monitoring test failed:', err);
  process.exit(1);
});
