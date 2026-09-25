const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { createTextHandler, GITHUB_REPO_REGEX } = require('../handlers/textHandler');
const deployStore = require('../lib/deployStore');
const deployCommand = require('../commands/deploy');
const deployWebCommand = require('../commands/deploy_web');
const deployer = require('../lib/deployer');

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
    assert(repliedHtml.includes('tạm ẩn'), 'Should explain cloud deployments are temporarily hidden');
    console.log('✅ textHandler missing tokens notification test passed');

    // 4. Test createTextHandler with GitHub link and Vercel configured
    let inlineKeyboard = null;
    const mockCtxWithKeys = {
      from: { id: 12345 },
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
      cloudTargetsReady: true,
      baseDomain: 'thienhn.io.vn',
    });
    await handlerWithKeys(mockCtxWithKeys);
    assert(repliedHtml.includes('PHÁT HIỆN KHO LƯU TRỮ GITHUB'));
    assert(inlineKeyboard, 'Should produce inline keyboard');
    assert.strictEqual(inlineKeyboard.length, 2, 'Should have 2 rows of buttons (target + control)');
    assert(inlineKeyboard[0][0].text.includes('Vercel (vue-dashboard)'), 'Should include auto subdomain in button label');
    assert(inlineKeyboard[1][0].text.includes('Đổi Subdomain'), 'Should have rename button');
    assert(inlineKeyboard[1][1].text.includes('Hủy'), 'Should have cancel button');
    console.log('✅ textHandler GitHub detection and 1-click inline keyboard test passed');

    // 4b. Test awaiting subdomain rename input
    const deployId = inlineKeyboard[0][0].callback_data.split(':')[1];
    deployStore.setAwaitingSubdomain(12345, deployId);

    const mockCtxRename = {
      from: { id: 12345 },
      message: { text: 'my-custom-sub' },
      replyWithHTML: async (html, opts) => {
        repliedHtml = html;
        inlineKeyboard = opts?.reply_markup?.inline_keyboard;
      },
      reply: async () => {},
    };
    await handlerWithKeys(mockCtxRename);
    assert(repliedHtml.includes('Đã cập nhật tên miền thành công!'));
    assert(inlineKeyboard[0][0].text.includes('my-custom-sub'), 'Button should reflect custom subdomain');
    assert.strictEqual(deployStore.getAwaitingSubdomain(12345), undefined, 'Awaiting state should be cleared');
    console.log('✅ textHandler custom subdomain input test passed');

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

    const uploadDir = path.join(testRoot, 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, 'site.zip'), 'fixture');
    const replies = [];
    const originalDeploy = deployer.deploy;
    let received = null;
    try {
      deployer.deploy = async (input) => {
        received = input;
        return { ok: true, deployment: { name: 'test', domain: 'test.thienhn.io.vn', url: 'https://test.thienhn.io.vn', target: 'vps', type: 'static', port: null, status: 'online' } };
      };
      await deployWebCommand.execute({
        message: { text: '/deploy_web test site.zip' },
        replyWithHTML: async (message) => { replies.push(message); },
      }, { uploadDir });
      assert.strictEqual(received.projectName, 'test');
      assert.strictEqual(received.target, 'vps');
      assert(replies.some((message) => message.includes('https://test.thienhn.io.vn')));
      assert(replies.every((message) => !message.includes(':8081')));
    } finally {
      deployer.deploy = originalDeploy;
    }
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }
}

testTelegramDeploy().catch((err) => {
  console.error('Telegram deploy test failed:', err);
  process.exit(1);
});
