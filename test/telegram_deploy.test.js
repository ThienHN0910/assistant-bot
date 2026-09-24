const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { createTextHandler, GITHUB_REPO_REGEX } = require('../handlers/textHandler');
const deployStore = require('../lib/deployStore');
const deployCommand = require('../commands/deploy');

async function testTelegramDeploy() {
  const testRoot = path.join(__dirname, 'test_telegram_env');
  const notesPath = path.join(testRoot, 'notes.txt');
  await fs.mkdir(testRoot, { recursive: true });

  try {
    // 1. Test GITHUB_REPO_REGEX
    const url1 = 'https://github.com/facebook/react';
    const match1 = url1.match(GITHUB_REPO_REGEX);
    assert(match1, 'Should match standard github url');
    assert.strictEqual(match1[1], 'facebook');
    assert.strictEqual(match1[2], 'react');

    const url2 = 'https://github.com/vuejs/core.git';
    const match2 = url2.match(GITHUB_REPO_REGEX);
    assert(match2, 'Should match github url with .git');

    const notGit = 'Hôm nay đi chợ mua rau';
    assert.strictEqual(notGit.match(GITHUB_REPO_REGEX), null, 'Should not match plain note');
    console.log('✅ GITHUB_REPO_REGEX test passed');

    // 2. Test deployStore
    deployStore.setPending('test-id-1', { repoUrl: 'https://github.com/a/b', projectName: 'b' });
    const stored = deployStore.getPending('test-id-1');
    assert.strictEqual(stored.projectName, 'b');
    deployStore.deletePending('test-id-1');
    assert.strictEqual(deployStore.getPending('test-id-1'), undefined);
    console.log('✅ deployStore test passed');

    // 3. Test createTextHandler with GitHub link and no cloud credentials
    let repliedHtml = '';
    const mockCtxNoKeys = {
      message: { text: 'https://github.com/org/my-web' },
      replyWithHTML: async (html) => { repliedHtml = html; },
      reply: async () => {},
    };

    const handlerNoKeys = createTextHandler({
      notesFilePath: notesPath,
      timezone: 'Asia/Ho_Chi_Minh',
    });
    await handlerNoKeys(mockCtxNoKeys);
    assert(repliedHtml.includes('chưa cấu hình'), 'Should notify missing Vercel/Render tokens');
    console.log('✅ textHandler missing tokens notification test passed');

    // 4. Test createTextHandler with GitHub link and Vercel configured
    let inlineKeyboard = null;
    const mockCtxWithKeys = {
      message: { text: 'https://github.com/org/vue-dashboard' },
      replyWithHTML: async (html, opts) => {
        repliedHtml = html;
        inlineKeyboard = opts?.reply_markup?.inline_keyboard;
      },
      reply: async () => {},
    };

    const handlerWithKeys = createTextHandler({
      notesFilePath: notesPath,
      timezone: 'Asia/Ho_Chi_Minh',
      vercelToken: 'v-token',
      baseDomain: 'thienhn.io.vn',
    });
    await handlerWithKeys(mockCtxWithKeys);
    assert(repliedHtml.includes('PHÁT HIỆN KHO LƯU TRỮ GITHUB'));
    assert(inlineKeyboard, 'Should produce inline keyboard');
    assert.strictEqual(inlineKeyboard.length, 1, 'Should have 1 target button (Vercel)');
    assert(inlineKeyboard[0][0].text.includes('Vercel'));
    console.log('✅ textHandler GitHub detection and inline keyboard test passed');

    // 5. Test createTextHandler with normal note
    const mockCtxNote = {
      message: { text: 'Ghi chú công việc hôm nay' },
      replyWithHTML: async () => {},
      reply: async (msg) => { repliedHtml = msg; },
    };
    await handlerWithKeys(mockCtxNote);
    assert(repliedHtml.includes('Đã lưu ghi chú thành công'));
    const notesContent = await fs.readFile(notesPath, 'utf8');
    assert(notesContent.includes('Ghi chú công việc hôm nay'));
    console.log('✅ textHandler regular note taking preserved test passed');

    // 6. Test deploy command interface
    assert.strictEqual(deployCommand.name, 'deploy');
    assert(typeof deployCommand.execute === 'function');
    assert(typeof deployCommand.register === 'function');
    console.log('✅ deployCommand definition and register test passed');
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }
}

testTelegramDeploy().catch((err) => {
  console.error('Telegram deploy test failed:', err);
  process.exit(1);
});
