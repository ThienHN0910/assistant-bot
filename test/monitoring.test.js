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
  let sentMessage = null;
  const mockBot = {
    telegram: {
      sendMessage: async (chatId, msg) => { sentMessage = { chatId, msg }; },
    },
  };
  const mockConfig = { authorizedTelegramId: 12345 };

  // Should run check without throwing
  await checkSystemHealth(mockBot, mockConfig);
  console.log('✅ watchdog check test passed');
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
