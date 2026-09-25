const assert = require('assert');
const { createTextHandler } = require('../handlers/textHandler');
const deployStore = require('../lib/deployStore');

async function testMonorepoTelegram() {
  const mockInspector = {
    inspectRepo: async () => ({
      ok: true,
      type: 'monorepo',
      title: 'Monorepo (Frontend + Backend)',
      frontend: { dir: 'frontend', frameworks: ['React'] },
      backend: { dir: 'backend', frameworks: ['Express'] },
      targets: ['vercel', 'render', 'both'],
      defaultTarget: 'both',
    }),
  };

  let repliedHtml = '';
  let inlineKeyboard = null;
  const mockCtx = {
    from: { id: 8888 },
    message: { text: 'https://github.com/my-org/shop-monorepo' },
    replyWithHTML: async (html, opts) => {
      repliedHtml = html;
      inlineKeyboard = opts?.reply_markup?.inline_keyboard;
    },
    reply: async () => {},
  };

  const handler = createTextHandler(
    {
      notesFilePath: 'notes.txt',
      timezone: 'Asia/Ho_Chi_Minh',
      baseDomain: 'thienhn.io.vn',
      vercelToken: 'tok-ver',
      renderApiKey: 'key-ren',
      renderOwnerId: 'own-ren',
      cloudTargetsReady: true,
    },
    { inspector: mockInspector }
  );

  await handler(mockCtx);

  assert(repliedHtml.includes('MONOREPO'), 'Should announce monorepo in message header');
  assert(repliedHtml.includes('Frontend (frontend): React'));
  assert(repliedHtml.includes('Backend (backend): Express'));
  assert(inlineKeyboard, 'Should output inline keyboard');
  // Check buttons: FE, BE, Deploy Cả Hai, Rename, Cancel
  const buttonTexts = inlineKeyboard.flat().map((b) => b.text);
  assert(buttonTexts.some((t) => t.includes('Frontend')), 'Should have Frontend button');
  assert(buttonTexts.some((t) => t.includes('Backend')), 'Should have Backend button');
  assert(buttonTexts.some((t) => t.includes('Deploy Cả Hai')), 'Should have Deploy Both button');
  console.log('✅ monorepo telegram interactive keyboard test passed');
}

testMonorepoTelegram().catch((err) => {
  console.error('Monorepo telegram test failed:', err);
  process.exit(1);
});
